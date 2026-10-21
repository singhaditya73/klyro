//! The daemon: one small process that owns the hot path.
//!
//! It listens on a local socket, keeps the provider connections warm, and
//! answers questions. The app is its control panel; the overlay is its
//! client. Nothing here knows about Electron.

use std::collections::HashMap;
use std::path::PathBuf;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

use crate::protocol::{ProviderConfig, Request, Response};
use crate::provider::{Chunk, Client, Ollama, OpenAi};

/// The version of the daemon, reported to the app.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Where the daemon listens. A Unix socket on Unix, a named pipe on Windows.
pub fn socket_path() -> PathBuf {
    let base = std::env::var("KLYRO_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
            PathBuf::from(home).join(".config").join("klyro")
        });
    base.join("klyro-core.sock")
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
    ) -> Option<Client> {
        let stored = self.providers.get(provider);
        let url = if base_url.is_empty() {
            stored.map(|config| config.base_url.clone()).unwrap_or_default()
        } else {
            base_url.to_string()
        };
        let key = api_key.or_else(|| stored.and_then(|config| config.api_key.clone()));
        if url.is_empty() {
            return None;
        }
        Some(if provider == "ollama" {
            Client::Ollama(Ollama::new(&url))
        } else {
            Client::OpenAi(OpenAi::new(&url, key))
        })
    }

    /// The client for a catalogue lookup.
    fn client_for_models(&self, provider: &str) -> Option<Client> {
        let stored = self.providers.get(provider)?;
        if stored.base_url.is_empty() {
            return None;
        }
        Some(if provider == "ollama" {
            Client::Ollama(Ollama::new(&stored.base_url))
        } else {
            Client::OpenAi(OpenAi::new(&stored.base_url, stored.api_key.clone()))
        })
    }
}

/// Serve until the process is asked to stop.
pub async fn serve(listener: UnixListener, state: &PathBuf) -> std::io::Result<()> {
    tracing::info!(socket = %state.display(), "klyro-core listening");
    let state = State::default();
    loop {
        let (stream, _peer) = match listener.accept().await {
            Ok(pair) => pair,
            Err(error) => {
                tracing::warn!(%error, "could not accept a connection");
                continue;
            }
        };
        let mut state = State {
            providers: state.providers.clone(),
        };
        tokio::spawn(async move {
            if let Err(error) = handle(stream, &mut state).await {
                tracing::warn!(%error, "a connection ended badly");
            }
        });
    }
}

/// One connection: requests in, events out.
async fn handle(stream: UnixStream, state: &mut State) -> std::io::Result<()> {
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();

    // The daemon says hello first, so the app knows it is talking to it.
    let hello = Response::Hello {
        version: VERSION.to_string(),
        pid: std::process::id(),
        socket: socket_path().display().to_string(),
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
            Request::Hello { .. } => {
                // Already said hello.
            }
            Request::Configure { providers } => {
                for config in providers {
                    state.providers.insert(config.id.clone(), config);
                }
            }
            Request::Ping => {
                write_line(&mut write_half, &Response::Pong).await?;
            }
            Request::Models { provider } => {
                let response = match state.client_for_models(&provider) {
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
            } => {
                let client = match state.client_for_ask(&provider, &base_url, api_key.clone()) {
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
                // The stream is not Unpin (it is an async block), so it is
                // pinned before it is polled.
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
    write_half: &mut tokio::net::unix::OwnedWriteHalf,
    response: &Response,
) -> std::io::Result<()> {
    let mut line = serde_json::to_string(response).unwrap_or_default();
    line.push('\n');
    write_half.write_all(line.as_bytes()).await?;
    write_half.flush().await
}
