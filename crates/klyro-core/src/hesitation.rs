//! Proprietary Acoustic Psychometrics & Buyer Hesitation Engine (klyro-core Layer 2)
//!
//! Evaluates vocal latency, speech rate, and disfluency friction directly in native
//! machine code with zero external symbols and link-time obfuscation.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HesitationLevel {
    Decisive,
    Neutral,
    Guarded,
    Hesitant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcousticSample {
    pub latency_ms: u64,
    pub duration_ms: u64,
    pub word_count: usize,
    pub filler_count: usize,
    pub pause_count: usize,
    pub max_pause_ms: u64,
    pub is_pricing_topic: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HesitationMetrics {
    pub score: u8, // 0..100
    pub level: HesitationLevel,
    pub confidence: u8,
    pub wpm: u16,
}

/// Evaluates buyer hesitation score from raw acoustic metrics.
pub fn calculate_hesitation(sample: &AcousticSample) -> HesitationMetrics {
    let mut raw_score: i32 = 15;

    // 1. Latency impact
    if sample.latency_ms > 1100 {
        raw_score += 35;
    } else if sample.latency_ms > 650 {
        raw_score += 20;
    } else if sample.latency_ms < 350 && sample.word_count > 3 {
        raw_score -= 10;
    }

    // 2. Speech rate (WPM)
    let wpm = if sample.duration_ms > 0 && sample.word_count > 0 {
        let mins = sample.duration_ms as f64 / 60000.0;
        (sample.word_count as f64 / mins).round() as u16
    } else {
        140
    };

    if wpm < 95 && sample.word_count >= 4 {
        raw_score += 25;
    } else if wpm < 115 && sample.word_count >= 4 {
        raw_score += 15;
    } else if wpm > 140 && wpm < 190 {
        raw_score -= 10;
    }

    // 3. Fillers
    if sample.filler_count >= 3 {
        raw_score += 30;
    } else if sample.filler_count >= 1 {
        raw_score += (sample.filler_count as i32) * 10;
    }

    // 4. Pauses
    if sample.max_pause_ms > 700 || sample.pause_count >= 3 {
        raw_score += 20;
    }

    // 5. Topic weighting
    let topic_multiplier = if sample.is_pricing_topic { 1.45 } else { 1.0 };
    let final_score = ((raw_score as f64 * topic_multiplier).round() as i32).clamp(0, 100) as u8;

    let level = if final_score >= 68 {
        HesitationLevel::Hesitant
    } else if final_score >= 45 {
        HesitationLevel::Guarded
    } else if final_score <= 22 {
        HesitationLevel::Decisive
    } else {
        HesitationLevel::Neutral
    };

    let confidence = (30 + sample.word_count * 5 + if sample.latency_ms > 0 { 20 } else { 0 }).clamp(40, 95) as u8;

    HesitationMetrics {
        score: final_score,
        level,
        confidence,
        wpm,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hesitation_scoring() {
        let sample = AcousticSample {
            latency_ms: 1200,
            duration_ms: 6000,
            word_count: 8,
            filler_count: 3,
            pause_count: 2,
            max_pause_ms: 800,
            is_pricing_topic: true,
        };

        let metrics = calculate_hesitation(&sample);
        assert_eq!(metrics.level, HesitationLevel::Hesitant);
        assert!(metrics.score >= 68);
    }
}

