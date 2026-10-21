//! The provider clients the daemon speaks to.
//!
//! Two shapes to begin with:
//!
//!   - the **OpenAI-shaped** family: OpenAI, Groq, any OpenAI-compatible
//!     server. `POST {base}/chat/completions`, streamed as server-sent events.
//!   - **Ollama**, which has its own native API: `POST {base}/api/chat`,
//!     streamed as newline-delimited JSON.
//!
//! The local agents (OpenCode, Claude Code, Codex, Antigravity) have their own
//! protocols and join the daemon one by one; the point of the daemon is that
//! the *hot path* does not depend on Electron.

use std::pin::Pin;

use bytes::Bytes;
use futures_core::Stream;

use crate::protocol::{ImageInput, ModelInfo};

/// One piece of an answer, as it arrives.
pub enum Chunk {
    Text(String),
    Done,
}

/// The byte stream a provider sends, boxed so the types stay simple.
type ByteStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

/// The answer, as it arrives.
type AnswerStream = Pin<Box<dyn Stream<Item = Result<Chunk, String>> + Send>>;

/// A provider the daemon can talk to.
pub enum Client {
    OpenAi(OpenAi),
    Ollama(Ollama),
}

impl Client {
    /// The models this provider serves.
    pub async fn models(&self) -> Result<Vec<ModelInfo>, String> {
        match self {
            Client::OpenAi(client) => client.models().await,
            Client::Ollama(client) => client.models().await,
        }
    }

    /// Ask a question, streaming the answer back.
    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<AnswerStream, String> {
        match self {
            Client::OpenAi(client) => Ok(Box::pin(client.ask(model, prompt, images).await?)),
            Client::Ollama(client) => Ok(Box::pin(client.ask(model, prompt, images).await?)),
        }
    }
}

/// An OpenAI-shaped endpoint.
pub struct OpenAi {
    client: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
}

impl OpenAi {
    pub fn new(base_url: &str, api_key: Option<String>) -> Self {
        Self {
            client: http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        }
    }

    pub async fn models(&self) -> Result<Vec<ModelInfo>, String> {
        let mut request = self.client.get(format!("{}/models", self.base_url));
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Could not reach the provider: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The provider answered {}.", response.status()));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("The provider's answer was not readable: {error}"))?;
        let list = body
            .get("data")
            .and_then(|data| data.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?.to_string();
                let owner = entry
                    .get("owned_by")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
                Some(ModelInfo {
                    name: id.clone(),
                    id,
                    provider: owner,
                })
            })
            .collect())
    }

    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<AnswerStream, String> {
        let mut content = vec![serde_json::json!({ "type": "text", "text": prompt })];
        for image in images {
            content.push(serde_json::json!({
                "type": "image_url",
                "image_url": { "url": image.data_url }
            }));
        }
        let payload = serde_json::json!({
            "model": model,
            "stream": true,
            "messages": [
                { "role": "system", "content": "You are a helpful assistant. Answer briefly." },
                { "role": "user", "content": content }
            ]
        });

        let mut request = self
            .client
            .post(format!("{}/chat/completions", self.base_url))
            .json(&payload);
        if let Some(key) = &self.api_key {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Could not reach the provider: {error}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "The provider answered {status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        let stream: ByteStream = Box::pin(response.bytes_stream());
        Ok(Box::pin(sse_stream(stream)))
    }
}

/// Ollama, with its own native API.
pub struct Ollama {
    client: reqwest::Client,
    base_url: String,
}

impl Ollama {
    pub fn new(base_url: &str) -> Self {
        // The OpenAI-compatible base URL carries a "/v1" that Ollama's own
        // routes do not have, so it comes off here.
        let base = base_url.trim_end_matches('/');
        let base = base.strip_suffix("/v1").unwrap_or(base);
        Self {
            client: http_client(),
            base_url: base.to_string(),
        }
    }

    pub async fn models(&self) -> Result<Vec<ModelInfo>, String> {
        let response = self
            .client
            .get(format!("{}/api/tags", self.base_url))
            .send()
            .await
            .map_err(|error| format!("Could not reach Ollama: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("Ollama answered {}.", response.status()));
        }
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("Ollama's answer was not readable: {error}"))?;
        let list = body
            .get("models")
            .and_then(|models| models.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .filter_map(|entry| {
                let id = entry
                    .get("name")
                    .or_else(|| entry.get("model"))
                    .and_then(|value| value.as_str())?
                    .to_string();
                Some(ModelInfo {
                    name: id.clone(),
                    id,
                    provider: "ollama".to_string(),
                })
            })
            .collect())
    }

    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<AnswerStream, String> {
        let mut images_payload = Vec::new();
        for image in images {
            if let Some(base64) = image.data_url.split_once(',').map(|(_, rest)| rest) {
                images_payload.push(base64.to_string());
            }
        }
        let mut message = serde_json::json!({ "role": "user", "content": prompt });
        if !images_payload.is_empty() {
            message["images"] = serde_json::Value::Array(
                images_payload.into_iter().map(serde_json::Value::String).collect(),
            );
        }
        let payload = serde_json::json!({
            "model": model,
            "stream": true,
            "messages": [message]
        });

        let response = self
            .client
            .post(format!("{}/api/chat", self.base_url))
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("Could not reach Ollama: {error}"))?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "Ollama answered {status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        let stream: ByteStream = Box::pin(response.bytes_stream());
        Ok(Box::pin(ndjson_stream(stream)))
    }
}

/// A client that does not hold a connection open for no reason.
fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

/// Read a server-sent-events body and pull the text out of it.
fn sse_stream(stream: ByteStream) -> impl Stream<Item = Result<Chunk, String>> {
    futures_util::stream::unfold(
        (stream, String::new()),
        |(mut stream, mut buffer)| async move {
            use futures_util::StreamExt;
            loop {
                let chunk = match stream.next().await {
                    Some(Ok(chunk)) => chunk,
                    Some(Err(error)) => {
                        return Some((Err(error.to_string()), (stream, buffer)))
                    }
                    None => return None,
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(index) = buffer.find('\n') {
                    let line: String = buffer.drain(..=index).collect();
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data == "[DONE]" {
                        return Some((Ok(Chunk::Done), (stream, buffer)));
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                        continue;
                    };
                    let delta = value
                        .get("choices")
                        .and_then(|choices| choices.get(0))
                        .and_then(|choice| choice.get("delta"))
                        .and_then(|delta| delta.get("content"))
                        .and_then(|content| content.as_str());
                    if let Some(text) = delta {
                        if !text.is_empty() {
                            return Some((Ok(Chunk::Text(text.to_string())), (stream, buffer)));
                        }
                    }
                }
            }
        },
    )
}

/// Read Ollama's newline-delimited JSON and pull the text out of it.
fn ndjson_stream(stream: ByteStream) -> impl Stream<Item = Result<Chunk, String>> {
    futures_util::stream::unfold(
        (stream, String::new()),
        |(mut stream, mut buffer)| async move {
            use futures_util::StreamExt;
            loop {
                let chunk = match stream.next().await {
                    Some(Ok(chunk)) => chunk,
                    Some(Err(error)) => {
                        return Some((Err(error.to_string()), (stream, buffer)))
                    }
                    None => return None,
                };
                buffer.push_str(&String::from_utf8_lossy(&chunk));
                while let Some(index) = buffer.find('\n') {
                    let line: String = buffer.drain(..=index).collect();
                    let line = line.trim().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                        continue;
                    };
                    if value.get("done").and_then(|done| done.as_bool()) == Some(true) {
                        return Some((Ok(Chunk::Done), (stream, buffer)));
                    }
                    let text = value
                        .get("message")
                        .and_then(|message| message.get("content"))
                        .and_then(|content| content.as_str());
                    if let Some(text) = text {
                        if !text.is_empty() {
                            return Some((Ok(Chunk::Text(text.to_string())), (stream, buffer)));
                        }
                    }
                }
            }
        },
    )
}
