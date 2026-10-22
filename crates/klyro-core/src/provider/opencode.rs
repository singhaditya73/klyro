//! OpenCode, the local server.
//!
//! The server keeps a session; a question is a prompt queued into it, and
//! the answer is read back from the session's messages. The turn is over when
//! the server says so with an `idle` entry — the only honest signal, because a
//! model can go quiet for seconds between a tool call and the rest of its
//! reply.
//!
//! Two generations of the API are in the wild: the older one lives at `/session`
//! and takes `parts`, the newer one at `/api/session` and takes `text` and
//! `files`. Both are spoken here.

use serde_json::Value;

use super::{http_client, Chunk};
use crate::protocol::ImageInput;

/// How many quiet reads the server is allowed before a turn is assumed over:
/// eighteen seconds. A model can think for a while before it says its first
/// word, and a turn cut short is worse than a turn that waited.
const QUIET_POLLS: u32 = 60;
/// How long to wait between two reads of the session.
const POLL_MS: u64 = 300;

#[derive(Clone)]
pub struct OpenCode {
    client: reqwest::Client,
    base_url: String,
    password: Option<String>,
    /// How long between two reads of the session. A test shortens it.
    poll_ms: u64,
}

/// The shape of one message in a session.
#[derive(Clone)]
struct Message {
    kind: String,
    text: String,
    created: Option<i64>,
    outcome: Option<String>,
    error: Option<String>,
}

impl Message {
    fn parse(value: &Value) -> Message {
        let info = value.get("info");
        let kind = value
            .get("type")
            .and_then(|kind| kind.as_str())
            .or_else(|| {
                info.and_then(|info| info.get("role"))
                    .and_then(|role| role.as_str())
            })
            .unwrap_or("")
            .to_string();
        let parts = value
            .get("content")
            .or_else(|| value.get("parts"))
            .and_then(|parts| parts.as_array());
        let text = parts
            .map(|parts| {
                parts
                    .iter()
                    .filter(|part| part.get("type").and_then(|kind| kind.as_str()) == Some("text"))
                    .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
                    .collect::<Vec<&str>>()
                    .join("")
            })
            .unwrap_or_default();
        let created = value
            .get("time")
            .and_then(|time| time.get("created"))
            .and_then(|created| created.as_i64())
            .or_else(|| {
                info.and_then(|info| info.get("time"))
                    .and_then(|time| time.get("created"))
                    .and_then(|created| created.as_i64())
            });
        let outcome = value
            .get("outcome")
            .and_then(|outcome| outcome.as_str())
            .map(|outcome| outcome.to_string());
        let error = value
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(|message| message.as_str())
            .map(|message| message.to_string());
        Message {
            kind,
            text,
            created,
            outcome,
            error,
        }
    }

    fn is_user(&self) -> bool {
        self.kind == "user"
    }

    fn is_assistant(&self) -> bool {
        self.kind == "assistant"
    }
}

/// The messages oldest first: the server lists a session newest first.
fn chronological(messages: &[Message]) -> Vec<Message> {
    if messages.iter().any(|message| message.created.is_some()) {
        let mut sorted = messages.to_vec();
        sorted.sort_by_key(|message| message.created.unwrap_or(0));
        return sorted;
    }
    messages.iter().rev().cloned().collect()
}

/// Everything the assistant said during the current turn.
fn turn_text(messages: &[Message]) -> String {
    let ordered = chronological(messages);
    let mut start = 0;
    for index in (0..ordered.len()).rev() {
        if ordered[index].is_user() {
            start = index + 1;
            break;
        }
    }
    ordered[start..]
        .iter()
        .filter(|message| message.is_assistant())
        .map(|message| message.text.clone())
        .filter(|text| !text.is_empty())
        .collect::<Vec<String>>()
        .join("\n")
}

impl OpenCode {
    pub fn new(base_url: &str, password: Option<String>) -> Self {
        Self {
            client: http_client(),
            base_url: base_url.trim_end_matches('/').to_string(),
            password,
            poll_ms: POLL_MS,
        }
    }

    /// The same client, reading the session as fast as the test needs.
    #[cfg(test)]
    pub fn with_poll_ms(mut self, poll_ms: u64) -> Self {
        self.poll_ms = poll_ms;
        self
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let mut request = self.client.request(method, format!("{}{}", self.base_url, path));
        if let Some(password) = &self.password {
            let encoded = base64_encode(format!("opencode:{password}").as_bytes());
            request = request.header("authorization", format!("Basic {encoded}"));
        }
        request
    }

    /// The models this server can reach.
    pub async fn models(&self) -> Result<Vec<crate::protocol::ModelInfo>, String> {
        let response = self
            .request(reqwest::Method::GET, "/api/model")
            .send()
            .await
            .map_err(|error| format!("Could not reach the OpenCode server: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The OpenCode server answered {}.", response.status()));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("The OpenCode server's answer was not readable: {error}"))?;
        let list = body
            .get("data")
            .and_then(|data| data.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list
            .iter()
            .filter_map(|entry| {
                let id = entry
                    .get("modelID")
                    .or_else(|| entry.get("id"))
                    .and_then(|id| id.as_str())?
                    .to_string();
                let name = entry
                    .get("name")
                    .and_then(|name| name.as_str())
                    .unwrap_or(&id)
                    .to_string();
                let provider = entry
                    .get("providerID")
                    .and_then(|provider| provider.as_str())
                    .unwrap_or("opencode")
                    .to_string();
                Some(crate::protocol::ModelInfo { id, name, provider })
            })
            .collect())
    }

    /// Ask a question, streaming the answer back.
    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<super::AnswerStream, String> {
        let session_id = self.create_session().await?;
        if !model.is_empty() {
            self.choose_model(&session_id, model).await;
        }
        self.send_prompt(&session_id, prompt, images).await?;

        // The stream outlives this call, so it takes its own copy of the
        // client rather than borrowing it.
        let reader = OpenCode {
            client: self.client.clone(),
            base_url: self.base_url.clone(),
            password: self.password.clone(),
            poll_ms: self.poll_ms,
        };
        let stream = async_stream::stream! {
            let mut delivered = String::new();
            let mut quiet = 0;
            while quiet < QUIET_POLLS {
                tokio::time::sleep(std::time::Duration::from_millis(reader.poll_ms)).await;
                let messages = match reader.read_messages(&session_id).await {
                    Ok(messages) => messages,
                    Err(error) => {
                        yield Err(error);
                        return;
                    }
                };
                let idle = messages
                    .iter()
                    .rev()
                    .find(|message| message.kind == "idle");
                if let Some(idle) = idle {
                    if idle.outcome.as_deref() == Some("failed") {
                        let reason = idle.error.clone().unwrap_or_default();
                        yield Err(format!(
                            "OpenCode could not finish the turn{}",
                            if reason.is_empty() { ".".to_string() } else { format!(": {reason}") }
                        ));
                        return;
                    }
                    if idle.outcome.as_deref() == Some("interrupted") {
                        yield Err("OpenCode was interrupted before the turn finished.".to_string());
                        return;
                    }
                }
                let text = turn_text(&messages);
                if text.len() > delivered.len() {
                    let delta = text[delivered.len()..].to_string();
                    delivered = text;
                    quiet = 0;
                    yield Ok(Chunk::Text(delta));
                    if idle.is_some() {
                        break;
                    }
                    continue;
                }
                quiet += 1;
                if idle.is_some() {
                    break;
                }
                if quiet > QUIET_POLLS && !delivered.is_empty() {
                    break;
                }
            }
            if delivered.is_empty() {
                yield Err("OpenCode finished the turn without an answer. The model said nothing — try again, or pick another model in Settings.".to_string());
            } else {
                yield Ok(Chunk::Done);
            }
        };
        Ok(Box::pin(stream))
    }

    async fn create_session(&self) -> Result<String, String> {
        let response = self
            .request(reqwest::Method::POST, "/api/session")
            .json(&serde_json::json!({ "title": "Klyro" }))
            .send()
            .await
            .map_err(|error| format!("Could not reach the OpenCode server: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The OpenCode server answered {}.", response.status()));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("The OpenCode server's answer was not readable: {error}"))?;
        body.get("data")
            .and_then(|data| data.get("id"))
            .and_then(|id| id.as_str())
            .map(|id| id.to_string())
            .ok_or_else(|| "The OpenCode server did not return a session id.".to_string())
    }

    /// Tell the session which model to use. The model id alone is not enough:
    /// the server needs the provider that serves it.
    async fn choose_model(&self, session_id: &str, model: &str) {
        let provider = self.provider_for(model).await;
        let _ = self
            .request(reqwest::Method::POST, &format!("/api/session/{session_id}/model"))
            .json(&serde_json::json!({
                "model": { "id": model, "providerID": provider }
            }))
            .send()
            .await;
    }

    /// Which provider serves a model? The catalogue knows.
    async fn provider_for(&self, model: &str) -> String {
        let Ok(models) = self.models().await else {
            return "opencode".to_string();
        };
        models
            .iter()
            .find(|entry| entry.id == model)
            .map(|entry| entry.provider.clone())
            .unwrap_or_else(|| "opencode".to_string())
    }

    async fn send_prompt(
        &self,
        session_id: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<(), String> {
        // An image travels as a file whose uri is the data URL.
        let files: Vec<Value> = images
            .iter()
            .map(|image| {
                serde_json::json!({ "uri": image.data_url, "name": "klyro-image" })
            })
            .collect();
        let mut body = serde_json::json!({ "text": prompt });
        if !files.is_empty() {
            body["files"] = Value::Array(files);
        }
        let response = self
            .request(reqwest::Method::POST, &format!("/api/session/{session_id}/prompt"))
            .json(&body)
            .send()
            .await
            .map_err(|error| format!("Could not reach the OpenCode server: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The OpenCode server answered {}.", response.status()));
        }
        Ok(())
    }

    async fn read_messages(&self, session_id: &str) -> Result<Vec<Message>, String> {
        let response = self
            .request(reqwest::Method::GET, &format!("/api/session/{session_id}/message?limit=20"))
            .send()
            .await
            .map_err(|error| format!("Could not reach the OpenCode server: {error}"))?;
        if !response.status().is_success() {
            return Err(format!("The OpenCode server answered {}.", response.status()));
        }
        let body: Value = response
            .json()
            .await
            .map_err(|error| format!("The OpenCode server's answer was not readable: {error}"))?;
        let list = body
            .get("data")
            .and_then(|data| data.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(list.iter().map(Message::parse).collect())
    }
}

/// base64, without a crate: the OpenCode server wants a basic-auth header.
fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let bytes = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let triple = ((bytes[0] as u32) << 16) | ((bytes[1] as u32) << 8) | bytes[2] as u32;
        out.push(ALPHABET[((triple >> 18) & 0x3f) as usize] as char);
        out.push(ALPHABET[((triple >> 12) & 0x3f) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[((triple >> 6) & 0x3f) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(triple & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64_encode(b"opencode:secret"), "b3BlbmNvZGU6c2VjcmV0");
        assert_eq!(base64_encode(b"a"), "YQ==");
        assert_eq!(base64_encode(b"ab"), "YWI=");
        assert_eq!(base64_encode(b"abc"), "YWJj");
    }

    #[test]
    fn the_turn_is_what_the_assistant_said_after_the_last_question() {
        let messages = vec![
            Message {
                kind: "user".into(),
                text: "an earlier question".into(),
                created: Some(1),
                outcome: None,
                error: None,
            },
            Message {
                kind: "assistant".into(),
                text: "an earlier answer".into(),
                created: Some(2),
                outcome: None,
                error: None,
            },
            Message {
                kind: "user".into(),
                text: "the current question".into(),
                created: Some(3),
                outcome: None,
                error: None,
            },
            Message {
                kind: "assistant".into(),
                text: "the current answer".into(),
                created: Some(4),
                outcome: None,
                error: None,
            },
        ];
        assert_eq!(turn_text(&messages), "the current answer");
    }

    #[test]
    fn a_turn_can_be_several_messages() {
        let messages = vec![
            Message {
                kind: "user".into(),
                text: "q".into(),
                created: Some(1),
                outcome: None,
                error: None,
            },
            Message {
                kind: "assistant".into(),
                text: "part one ".into(),
                created: Some(2),
                outcome: None,
                error: None,
            },
            Message {
                kind: "assistant".into(),
                text: "part two".into(),
                created: Some(3),
                outcome: None,
                error: None,
            },
        ];
        assert_eq!(turn_text(&messages), "part one \npart two");
    }

    #[test]
    fn the_newest_first_order_is_undone_without_timestamps() {
        let messages = vec![
            Message {
                kind: "assistant".into(),
                text: "second".into(),
                created: None,
                outcome: None,
                error: None,
            },
            Message {
                kind: "user".into(),
                text: "first".into(),
                created: None,
                outcome: None,
                error: None,
            },
        ];
        // The server lists newest first, so without timestamps the list is
        // reversed to read oldest first.
        assert_eq!(turn_text(&messages), "second");
    }

    #[test]
    fn a_message_is_read_from_either_shape() {
        let modern = serde_json::json!({
            "id": "msg_1",
            "type": "assistant",
            "time": { "created": 10 },
            "content": [{ "type": "text", "text": "hello" }]
        });
        let message = Message::parse(&modern);
        assert_eq!(message.kind, "assistant");
        assert_eq!(message.text, "hello");
        assert_eq!(message.created, Some(10));

        let older = serde_json::json!({
            "id": "msg_2",
            "info": { "role": "user", "time": { "created": 5 } },
            "parts": [{ "type": "text", "text": "a question" }]
        });
        let message = Message::parse(&older);
        assert_eq!(message.kind, "user");
        assert_eq!(message.text, "a question");
        assert_eq!(message.created, Some(5));
    }
}
