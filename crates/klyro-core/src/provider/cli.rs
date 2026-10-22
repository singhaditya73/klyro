//! The agent CLIs: Claude Code and Codex.
//!
//! These are programs, not endpoints. They are run, they answer on stdout,
//! and they use the login the user already has. The daemon runs them the
//! same way the app did, so the answers do not change — only the process
//! that waits for them does.

use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use super::Chunk;
use crate::protocol::ImageInput;

/// Claude Code, with its own sign-in.
pub struct ClaudeCode {
    binary: String,
}

/// Codex, with its own sign-in.
pub struct Codex {
    binary: String,
}

impl ClaudeCode {
    pub fn new(binary: &str) -> Self {
        Self {
            binary: binary.to_string(),
        }
    }

    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<super::AnswerStream, String> {
        let mut args: Vec<String> = vec![
            "-p".to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
        ];
        if !model.is_empty() {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        // With a picture the CLI reads the message from stdin, so the picture
        // can travel with it.
        let mut command = Command::new(&self.binary);
        command.args(&args);
        if images.is_empty() {
            args.insert(1, prompt.to_string());
            command = Command::new(&self.binary);
            command.args(&args);
            command.stdin(Stdio::null());
        } else {
            command.args(&mut args);
            command.args(["--input-format", "stream-json"]);
            command.stdin(Stdio::piped());
        }
        command.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start Claude Code: {error}"))?;

        if !images.is_empty() {
            let mut content: Vec<serde_json::Value> =
                vec![serde_json::json!({ "type": "text", "text": prompt })];
            for image in images {
                let base64 = image
                    .data_url
                    .split_once(',')
                    .map(|(_, rest)| rest.to_string())
                    .unwrap_or_default();
                content.push(serde_json::json!({
                    "type": "image",
                    "source": { "type": "base64", "media_type": image.mime, "data": base64 }
                }));
            }
            let message = serde_json::json!({
                "type": "user",
                "message": { "role": "user", "content": content }
            });
            if let Some(stdin) = child.stdin.as_mut() {
                use tokio::io::AsyncWriteExt;
                let _ = stdin.write_all(format!("{message}\n").as_bytes()).await;
                let _ = stdin.flush().await;
            }
            drop(child.stdin.take());
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Claude Code did not answer on stdout.".to_string())?;
        let stderr = child.stderr.take();

        // The stderr is read alongside, so a failure is not hidden behind a
        // full pipe.
        let errors = tokio::spawn(async move {
            let mut errors = String::new();
            if let Some(stderr) = stderr {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    errors.push_str(&line);
                    errors.push('\n');
                }
            }
            errors
        });

        let stream = async_stream::stream! {
            let mut lines = BufReader::new(stdout).lines();
            let mut delivered = String::new();
            let mut failure: Option<String> = None;
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let Ok(event) = serde_json::from_str::<serde_json::Value>(trimmed) else {
                    continue;
                };
                let kind = event.get("type").and_then(|kind| kind.as_str()).unwrap_or("");
                if kind == "assistant" {
                    let text = event
                        .get("message")
                        .and_then(|message| message.get("content"))
                        .and_then(|content| content.as_array())
                        .map(|parts| {
                            parts
                                .iter()
                                .filter(|part| part.get("type").and_then(|kind| kind.as_str()) == Some("text"))
                                .filter_map(|part| part.get("text").and_then(|text| text.as_str()))
                                .collect::<Vec<&str>>()
                                .join("")
                        })
                        .unwrap_or_default();
                    if !text.is_empty() {
                        delivered.push_str(&text);
                        yield Ok(Chunk::Text(text));
                    }
                    continue;
                }
                if kind == "result" {
                    let text = event
                        .get("result")
                        .and_then(|result| result.as_str())
                        .unwrap_or("")
                        .to_string();
                    if event.get("is_error").and_then(|flag| flag.as_bool()) == Some(true) {
                        failure = Some(if text.is_empty() {
                            "Claude Code reported an error.".to_string()
                        } else {
                            text
                        });
                    } else if delivered.is_empty() && !text.is_empty() {
                        // The CLI's own result is the answer when it said
                        // nothing else.
                        delivered.push_str(&text);
                        yield Ok(Chunk::Text(text));
                    }
                    break;
                }
            }
            let _ = child.wait().await;
            let stderr_text = errors.await.unwrap_or_default();
            if let Some(message) = failure {
                yield Err(message);
                return;
            }
            if delivered.is_empty() {
                let detail = if stderr_text.trim().is_empty() {
                    "Claude Code did not answer. Run \"claude\" in a terminal and use /login.".to_string()
                } else {
                    stderr_text.trim().to_string()
                };
                yield Err(detail);
                return;
            }
            yield Ok(Chunk::Done);
        };
        Ok(Box::pin(stream))
    }
}

impl Codex {
    pub fn new(binary: &str) -> Self {
        Self {
            binary: binary.to_string(),
        }
    }

    pub async fn ask(
        &self,
        model: &str,
        prompt: &str,
        images: &[ImageInput],
    ) -> Result<super::AnswerStream, String> {
        let mut args: Vec<String> = vec!["exec".to_string(), prompt.to_string()];
        if !model.is_empty() {
            args.push("--model".to_string());
            args.push(model.to_string());
        }

        // The CLI takes a picture as a file, so the images are written out for
        // the length of the call and removed afterwards.
        let mut files: Vec<std::path::PathBuf> = Vec::new();
        for (index, image) in images.iter().enumerate() {
            let base64 = image
                .data_url
                .split_once(',')
                .map(|(_, rest)| rest.to_string())
                .unwrap_or_default();
            let extension = image.mime.split('/').nth(1).unwrap_or("png");
            let path = std::env::temp_dir().join(format!(
                "klyro-image-{}-{}.{}",
                std::process::id(),
                index,
                extension
            ));
            let bytes = decode_base64(&base64).unwrap_or_default();
            if std::fs::write(&path, bytes).is_ok() {
                args.push("--image".to_string());
                args.push(path.to_string_lossy().to_string());
                files.push(path);
            }
        }

        let mut command = Command::new(&self.binary);
        command.args(&args);
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start the Codex CLI: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "The Codex CLI did not answer on stdout.".to_string())?;
        let stderr = child.stderr.take();

        let errors = tokio::spawn(async move {
            let mut errors = String::new();
            if let Some(stderr) = stderr {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    errors.push_str(&line);
                    errors.push('\n');
                }
            }
            errors
        });

        let stream = async_stream::stream! {
            let mut lines = BufReader::new(stdout).lines();
            let mut delivered = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                // Codex writes the final message on stdout, and progress on
                // stderr; the JSON events are read when they come.
                if let Ok(event) = serde_json::from_str::<serde_json::Value>(trimmed) {
                    if let Some(text) = event
                        .get("item")
                        .and_then(|item| item.get("text"))
                        .and_then(|text| text.as_str())
                    {
                        if !text.is_empty() {
                            delivered.push_str(text);
                            yield Ok(Chunk::Text(text.to_string()));
                            continue;
                        }
                    }
                }
                // Plain output is the answer.
                delivered.push_str(trimmed);
                yield Ok(Chunk::Text(trimmed.to_string()));
            }
            let status = child.wait().await;
            let stderr_text = errors.await.unwrap_or_default();
            for file in &files {
                let _ = std::fs::remove_file(file);
            }
            if delivered.is_empty() {
                let detail = if stderr_text.trim().is_empty() {
                    match status {
                        Ok(status) => format!("The Codex CLI exited with code {}.", status.code().unwrap_or(-1)),
                        Err(_) => "The Codex CLI did not answer.".to_string(),
                    }
                } else {
                    stderr_text.trim().to_string()
                };
                yield Err(detail);
                return;
            }
            yield Ok(Chunk::Done);
        };
        Ok(Box::pin(stream))
    }
}

/// base64, without a crate: the pictures arrive as data URLs.
fn decode_base64(input: &str) -> Option<Vec<u8>> {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut lookup = [255u8; 256];
    for (index, byte) in ALPHABET.iter().enumerate() {
        lookup[*byte as usize] = index as u8;
    }
    let mut out: Vec<u8> = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in input.bytes() {
        if byte == b'=' || byte == b'\n' || byte == b'\r' {
            continue;
        }
        let value = lookup[byte as usize];
        if value == 255 {
            return None;
        }
        buffer = (buffer << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_decodes_a_picture() {
        // "hello" in base64.
        assert_eq!(decode_base64("aGVsbG8="), Some(b"hello".to_vec()));
        assert_eq!(decode_base64("YQ=="), Some(b"a".to_vec()));
        assert_eq!(decode_base64("!!"), None);
    }
}
