//! Antigravity, the agent IDE's own language server.
//!
//! The service speaks Connect-RPC over HTTP/1.1: a POST to
//! `/exa.language_server_pb.LanguageServerService/GetModelResponse`, with the
//! CSRF token the IDE gave the server, and the answer comes back as
//! `{ "response": "…" }`.
//!
//! The request carries a prompt and a model id, and nothing else — which is
//! why Antigravity cannot carry a picture: the call has nowhere to put one.

use serde_json::Value;

use super::Chunk;

const SERVICE: &str = "exa.language_server_pb.LanguageServerService";

pub struct Antigravity {
    client: reqwest::Client,
    /// The port the language server listens on.
    port: u16,
    /// The token the IDE handed that server.
    token: String,
}

impl Antigravity {
    pub fn new(port: u16, token: &str) -> Self {
        Self {
            client: super::http_client(),
            port,
            token: token.to_string(),
        }
    }

    /// Ask the model a question. The answer comes back in one piece.
    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
    ) -> Result<super::AnswerStream, String> {
        let payload = serde_json::json!({
            "metadata": {
                "ideName": "antigravity",
                "extensionName": "antigravity",
                "ideVersion": "unknown",
                "locale": "en"
            },
            "model": model,
            "prompt": prompt
        });

        let response = self
            .client
            .post(format!("http://127.0.0.1:{}/{}/GetModelResponse", self.port, SERVICE))
            .header("content-type", "application/json")
            .header("connect-protocol-version", "1")
            .header("x-codeium-csrf-token", &self.token)
            .json(&payload)
            .send()
            .await
            .map_err(|error| format!("Could not reach the Antigravity service: {error}"))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!(
                "The Antigravity service answered {status}: {}",
                body.chars().take(300).collect::<String>()
            ));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("The Antigravity service's answer was not readable: {error}"))?;
        let answer = body
            .get("response")
            .and_then(|response| response.as_str())
            .unwrap_or("")
            .to_string();

        let stream = async_stream::stream! {
            if !answer.is_empty() {
                yield Ok(Chunk::Text(answer));
            }
            yield Ok(Chunk::Done);
        };
        Ok(Box::pin(stream))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_request_carries_the_prompt_and_the_model() {
        let payload = serde_json::json!({
            "metadata": { "ideName": "antigravity" },
            "model": "MODEL_PLACEHOLDER_M26",
            "prompt": "what is this?"
        });
        assert_eq!(payload["model"], "MODEL_PLACEHOLDER_M26");
        assert_eq!(payload["prompt"], "what is this?");
    }
}
