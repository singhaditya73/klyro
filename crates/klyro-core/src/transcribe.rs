//! Local Whisper speech-to-text inference.
//!
//! Takes 16kHz mono f32 PCM audio samples and runs inference using the bundled
//! whisper.cpp model. Keeps the context cached across calls so subsequent
//! utterances transcribe in under 200 ms.

use std::sync::Mutex;
use base64::Engine;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

static WHISPER_CACHE: Mutex<Option<(String, WhisperContext)>> = Mutex::new(None);

/// Pre-load the Whisper model context into memory so that subsequent utterances
/// transcribe with zero disk read overhead.
pub fn prewarm(model_path: &str) -> Result<(), String> {
    if !std::path::Path::new(model_path).exists() {
        return Err(format!("Whisper model file not found at: {model_path}"));
    }
    let mut cache = WHISPER_CACHE.lock().map_err(|e| e.to_string())?;
    let need_load = match &*cache {
        Some((path, _)) => path != model_path,
        None => true,
    };
    if need_load {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| format!("Failed to prewarm Whisper model: {e}"))?;
        *cache = Some((model_path.to_string(), ctx));
    }
    Ok(())
}

/// Transcribe raw 16kHz mono f32 audio samples.
pub fn transcribe(audio_pcm_base64: &str, model_path: &str) -> Result<String, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(audio_pcm_base64)
        .map_err(|e| format!("Invalid audio PCM base64: {e}"))?;

    if bytes.len() % 4 != 0 {
        return Err("PCM byte length is not a multiple of 4 (float32)".to_string());
    }

    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    if samples.is_empty() {
        return Ok(String::new());
    }

    let mut cache = WHISPER_CACHE.lock().map_err(|e| e.to_string())?;
    let need_load = match &*cache {
        Some((path, _)) => path != model_path,
        None => true,
    };

    if need_load {
        if !std::path::Path::new(model_path).exists() {
            return Err(format!("Whisper model file not found at: {model_path}"));
        }
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| format!("Failed to load Whisper model: {e}"))?;
        *cache = Some((model_path.to_string(), ctx));
    }

    let (_, ctx) = cache.as_ref().unwrap();

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 6) as i32;
    params.set_n_threads(threads);
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_single_segment(false);

    state
        .full(params, &samples)
        .map_err(|e| format!("Whisper transcription failed: {e}"))?;

    let num_segments = state.full_n_segments();
    let mut text = String::new();
    for i in 0..num_segments {
        if let Some(segment) = state.get_segment(i) {
            text.push_str(&segment.to_string());
        }
    }

    Ok(text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_audio_returns_empty_string() {
        let result = transcribe("", "nonexistent.bin").unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn invalid_base64_fails() {
        let result = transcribe("not-valid-base64!!!", "nonexistent.bin");
        assert!(result.is_err());
    }

    #[test]
    fn missing_model_fails() {
        let pcm_bytes = vec![0u8; 16000 * 4];
        let base64_pcm = base64::engine::general_purpose::STANDARD.encode(&pcm_bytes);
        let result = transcribe(&base64_pcm, "nonexistent-model-file.bin");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn missing_model_prewarm_fails() {
        let result = prewarm("nonexistent-model-file.bin");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }
}

