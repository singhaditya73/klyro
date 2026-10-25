//! The daemon: one small process that owns the hot path.
//!
//! It listens on the loopback interface, keeps the provider connections warm,
//! and answers questions. The app is its control panel; the overlay is its
//! client. Nothing here knows about Electron.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

use crate::protocol::{ProviderConfig, Request, Response};
use crate::provider::{Antigravity, Chunk, ClaudeCode, Client, Codex, Ollama, OpenAi, OpenCode};

/// The version of the daemon, reported to the app.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Where the daemon's state file lives: the port it listens on and the token
/// a client has to present.
///
/// This has to agree with `daemonStatePath()` in `src/main/domains/daemon.ts`,
/// which uses `os.homedir()`. On Windows `HOME` is normally unset, so without
/// the `USERPROFILE` fallback the daemon would look in `\tmp\.config\klyro`
/// (usually not writable) and exit, and the app would never find its port —
/// local speech and the warm overlay path would silently be off.
pub fn state_path() -> PathBuf {
    let base = std::env::var("KLYRO_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .unwrap_or_else(|_| "/tmp".to_string());
            PathBuf::from(home).join(".config").join("klyro")
        });
    base.join("klyro-core.json")
}

/// What the daemon remembers between requests.
#[derive(Default)]
struct State {
    providers: HashMap<String, ProviderConfig>,
}

impl State {
    /// The client for an ask: the request carries what it needs, and the
    /// stored configuration is the fallback for a caller that only names the
    /// provider.
    fn client_for_ask(
        &self,
        provider: &str,
        base_url: &str,
        api_key: Option<String>,
        binary: &str,
        port: u16,
        csrf: &str,
    ) -> Option<Client> {
        let stored = self.providers.get(provider);
        let url = if base_url.is_empty() {
            stored.map(|config| config.base_url.clone()).unwrap_or_default()
        } else {
            base_url.to_string()
        };
        let key = api_key.or_else(|| stored.and_then(|config| config.api_key.clone()));
        // The agent CLIs are programs: the request names the one to run.
        let program = if binary.is_empty() {
            String::new()
        } else {
            binary.to_string()
        };
        match provider {
            "ollama" => (!url.is_empty()).then(|| Client::Ollama(Ollama::new(&url))),
            "opencode" => (!url.is_empty()).then(|| Client::OpenCode(OpenCode::new(&url, key))),
            "claude-code" => (!program.is_empty()).then(|| Client::ClaudeCode(ClaudeCode::new(&program))),
            "codex" => (!program.is_empty()).then(|| Client::Codex(Codex::new(&program))),
            "antigravity" => (port > 0).then(|| Client::Antigravity(Antigravity::new(port, csrf))),
            _ => (!url.is_empty()).then(|| Client::OpenAi(OpenAi::new(&url, key))),
        }
    }

    /// The client for a catalogue lookup.
    fn client_for_models(&self, provider: &str) -> Option<Client> {
        let stored = self.providers.get(provider)?;
        if stored.base_url.is_empty() {
            return None;
        }
        Some(match provider {
            "ollama" => Client::Ollama(Ollama::new(&stored.base_url)),
            "opencode" => Client::OpenCode(OpenCode::new(&stored.base_url, stored.api_key.clone())),
            _ => Client::OpenAi(OpenAi::new(&stored.base_url, stored.api_key.clone())),
        })
    }
}

/// Serve until the process is asked to stop.
pub async fn serve(listener: TcpListener, token: String) -> std::io::Result<()> {
    // The configuration is shared: the app configures the daemon once and
    // then asks questions over any connection.
    let state = Arc::new(Mutex::new(State::default()));
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                tracing::warn!(%error, "could not accept a connection");
                continue;
            }
        };
        tracing::debug!(%peer, "a client connected");
        let token = token.clone();
        let state = Arc::clone(&state);
        tokio::spawn(async move {
            if let Err(error) = handle(stream, token, state).await {
                tracing::warn!(%error, "a connection ended badly");
            }
        });
    }
}

/// One connection: requests in, events out.
async fn handle(
    stream: TcpStream,
    token: String,
    state: Arc<Mutex<State>>,
) -> std::io::Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();

    // The first line has to be the token. Nothing else is served to a client
    // that cannot present it.
    let authenticated = match lines.next_line().await? {
        Some(line) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(Request::Auth { token: given }) => given == token,
            Ok(_) => false,
            Err(_) => false,
        },
        None => false,
    };
    if !authenticated {
        let response = Response::Error {
            message: "The daemon did not recognise that token.".to_string(),
        };
        write_line(&mut write_half, &response).await?;
        return Ok(());
    }

    // The daemon says hello, so the app knows it is talking to it.
    let hello = Response::Hello {
        version: VERSION.to_string(),
        pid: std::process::id(),
        port: 0,
    };
    write_line(&mut write_half, &hello).await?;

    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let request: Request = match serde_json::from_str(line) {
            Ok(request) => request,
            Err(error) => {
                let response = Response::Error {
                    message: format!("That was not a request I understand: {error}"),
                };
                write_line(&mut write_half, &response).await?;
                continue;
            }
        };
        match request {
            Request::Auth { .. } => {
                // Already done.
            }
            Request::Hello { .. } => {
                // Already said hello.
            }
            Request::Configure { providers } => {
                let mut state = state.lock().await;
                for config in providers {
                    state.providers.insert(config.id.clone(), config);
                }
            }
            Request::Ping => {
                write_line(&mut write_half, &Response::Pong).await?;
            }
            Request::Transcribe {
                audio_pcm_base64,
                model_path,
            } => {
                let result = tokio::task::spawn_blocking(move || {
                    crate::transcribe::transcribe(&audio_pcm_base64, &model_path)
                })
                .await;

                let response = match result {
                    Ok(Ok(text)) => Response::Transcribed { text },
                    Ok(Err(message)) => Response::Error { message },
                    Err(error) => Response::Error {
                        message: format!("Transcription task failed: {error}"),
                    },
                };
                write_line(&mut write_half, &response).await?;
            }
            Request::Prewarm { model_path } => {
                let result = tokio::task::spawn_blocking(move || {
                    crate::transcribe::prewarm(&model_path)
                })
                .await;

                let response = match result {
                    Ok(Ok(())) => Response::Prewarmed,
                    Ok(Err(message)) => Response::Error { message },
                    Err(error) => Response::Error {
                        message: format!("Prewarm task failed: {error}"),
                    },
                };
                write_line(&mut write_half, &response).await?;
            }
            Request::Models { provider } => {
                let client = state.lock().await.client_for_models(&provider);
                let response = match client {
                    Some(client) => match client.models().await {
                        Ok(models) => Response::Models { models },
                        Err(message) => Response::Error { message },
                    },
                    None => Response::Error {
                        message: format!("{provider} is not set up yet."),
                    },
                };
                write_line(&mut write_half, &response).await?;
            }
            Request::Ask {
                provider,
                model,
                base_url,
                api_key,
                prompt,
                images,
                binary,
                port,
                csrf,
            } => {
                let client = state.lock().await.client_for_ask(
                    &provider,
                    &base_url,
                    api_key.clone(),
                    &binary,
                    port,
                    &csrf,
                );
                let client = match client {
                    Some(client) => client,
                    None => {
                        let response = Response::Error {
                            message: format!("{provider} is not set up yet."),
                        };
                        write_line(&mut write_half, &response).await?;
                        continue;
                    }
                };
                let started = std::time::Instant::now();
                let stream = match client.ask(&model, &prompt, &images).await {
                    Ok(stream) => stream,
                    Err(message) => {
                        let response = Response::Error { message };
                        write_line(&mut write_half, &response).await?;
                        continue;
                    }
                };
                use futures_util::StreamExt;
                let mut stream = std::pin::pin!(stream);
                while let Some(item) = stream.next().await {
                    match item {
                        Ok(Chunk::Text(text)) => {
                            let response = Response::Delta { text };
                            if write_line(&mut write_half, &response).await.is_err() {
                                break;
                            }
                        }
                        Ok(Chunk::Done) => break,
                        Err(message) => {
                            let response = Response::Error { message };
                            let _ = write_line(&mut write_half, &response).await;
                            break;
                        }
                    }
                }
                let response = Response::Done {
                    ms: started.elapsed().as_millis() as u64,
                };
                write_line(&mut write_half, &response).await?;
            }
        }
    }
    Ok(())
}

/// Write one JSON object, on its own line.
async fn write_line(
    write_half: &mut tokio::net::tcp::OwnedWriteHalf,
    response: &Response,
) -> std::io::Result<()> {
    let mut line = serde_json::to_string(response).unwrap_or_default();
    line.push('\n');
    write_half.write_all(line.as_bytes()).await?;
    write_half.flush().await
}
