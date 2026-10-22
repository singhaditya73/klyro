//! The wire protocol between Klyro's app and its daemon.
//!
//! One JSON object per line, in both directions. The client authenticates
//! first, then the daemon says hello, then the app may push provider
//! configuration, and then either side may send requests. Answers stream back
//! as `delta` events so the overlay can show the first words while the rest is
//! still arriving.

use serde::{Deserialize, Serialize};

/// What the app sends to the daemon.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Request {
    /// The first thing the app sends: the token from the state file.
    Auth { token: String },
    /// The app is here; the daemon answers with its own `hello`.
    Hello {
        #[allow(dead_code)]
        version: String,
    },
    /// The provider configuration the daemon should use, keys included.
    ///
    /// The keys live in Electron's encrypted store; the daemon never touches
    /// the file, it only holds them in memory for as long as it runs.
    Configure { providers: Vec<ProviderConfig> },
    /// List the models a provider can serve.
    Models { provider: String },
    /// Ask a question. The answer streams back as `delta` events.
    Ask {
        provider: String,
        model: String,
        base_url: String,
        api_key: Option<String>,
        prompt: String,
        /// Images as data URLs, for the providers that can read them.
        #[serde(default)]
        images: Vec<ImageInput>,
        /// The program to run, for the agent CLIs.
        #[serde(default)]
        binary: String,
        /// The port the Antigravity service listens on.
        #[serde(default)]
        port: u16,
        /// The token the Antigravity service was given.
        #[serde(default)]
        csrf: String,
    },
    /// Transcribe 16kHz mono f32 PCM audio (base64 encoded).
    Transcribe {
        /// Base64-encoded little-endian f32 PCM audio samples (16000Hz mono).
        audio_pcm_base64: String,
        /// Path to the GGML/GGUF model file on disk.
        model_path: String,
    },
    /// Is the daemon there?
    Ping,
}

/// One image, as the app already holds it.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ImageInput {
    pub data_url: String,
    pub mime: String,
}

/// A provider the daemon can talk to.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderConfig {
    pub id: String,
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
}

/// What the daemon sends back.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Response {
    /// The daemon is up; it says which version and where it listens.
    Hello {
        version: String,
        pid: u32,
        port: u16,
    },
    /// A piece of the answer.
    Delta { text: String },
    /// The answer is complete.
    Done { ms: u64 },
    /// The models a provider can serve.
    Models { models: Vec<ModelInfo> },
    /// Result of an audio transcription.
    Transcribed { text: String },
    /// Something went wrong, said in a way worth showing a person.
    Error { message: String },
    /// An answer to a `Ping`.
    Pong,
}

/// One model in a provider's catalogue.
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
}
