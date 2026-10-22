//! Reading the two streaming shapes a provider can answer in.

use bytes::Bytes;
use futures_core::Stream;
use futures_util::StreamExt;

use super::Chunk;

/// The byte stream a provider sends, boxed so the types stay simple.
pub type ByteStream = std::pin::Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

/// Read a server-sent-events body and pull the text out of it.
pub fn sse_stream(stream: ByteStream) -> impl Stream<Item = Result<Chunk, String>> {
    futures_util::stream::unfold(
        (stream, String::new()),
        |(mut stream, mut buffer)| async move {
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
pub fn ndjson_stream(stream: ByteStream) -> impl Stream<Item = Result<Chunk, String>> {
    futures_util::stream::unfold(
        (stream, String::new()),
        |(mut stream, mut buffer)| async move {
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
