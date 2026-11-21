# Klyro — Product Roadmap & Next-Gen Differentiators

This document outlines the strategic product vision, high-moat differentiators, and scientific foundations for upcoming Klyro feature iterations.

---

## 1. Competitive Landscape & The "Real-Time Advantage"

Current meeting and conversation intelligence tools (Gong, Otter, Fathom, Chorus) operate under a cloud-first, post-call paradigm:
- **Cloud Bot Intrusion:** They require an overt bot (e.g., "Otter.ai Notetaker") to join the call, altering participant behavior and raising corporate compliance hurdles.
- **Post-Call Latency:** Insights, summaries, and sentiment analysis are delivered hours *after* the meeting has concluded.
- **Text-Only Processing:** They analyze transcripts purely via text NLP, missing critical non-verbal paralinguistic and acoustic signals.

### Klyro's Architectural Advantage
Because Klyro runs as a native desktop application with an embedded Rust daemon (`klyro-core`) and local Web Audio PCM streaming:
1. **Sub-30ms Latency:** Acoustic DSP and vector search happen locally on-device.
2. **Zero Server Costs:** Audio processing runs directly on the user's CPU.
3. **True Stealth & Privacy:** Operates via system audio capture; no bot joins the meeting, and no audio is piped to third-party recording servers.
4. **Actionable In-Call Assistance:** Shifts intelligence from *post-mortem debriefing* to *real-time guidance* that saves deals and interviews while they are happening.

---

## 2. Flagship Next-Gen Features

### Feature 1: Live Buyer Hesitation & Intent Heatmap (Acoustic Psychology)
- **Concept:** Continuous local acoustic analysis of the buyer's/interviewer's voice stream to detect subconscious friction, hesitation, or cognitive overload in real time.
- **Acoustic Markers Analyzed:**
  - **Response Latency (Inter-Speaker Silence):** Delay between seller finishing a question/pitch and buyer beginning their reply (elevated latency >600ms–1.2s indicates high cognitive deliberation).
  - **Intra-Phrase Micro-Pauses:** Frequency and duration of internal pauses (>500ms) mid-sentence.
  - **Speech Rate Deceleration:** Syllables-per-second slowdown when addressing sensitive topics (e.g., pricing, budget, authority, integration hurdles).
  - **Disfluency & Filler Bursts:** Spikes in filled pauses ("um", "uh", "sort of", "kind of").
  - **Pitch Instability ($F_0$ Jitter):** Micro-tremors in vocal fold vibration reflecting laryngeal muscle tension under stress.
- **HUD Experience:**
  - Minimalist ambient intent bar in the overlay.
  - Contextual real-time prompt:
    > *"Hesitation detected on annual pricing (38% speech slowdown, 850ms latency). Action: Probe budget allocation and approval chain now."*
- **Scientific Foundation:**
  - *Psycholinguistics of Speech Planning:* Levelt (1989), Clark & Fox Tree (2002).
  - *Cognitive Load & Acoustic Variability:* Sweller (Cognitive Load Theory), NIH & Frontiers in Psychology voice biomarker research.
  - *Negotiation Non-Verbal Dynamics:* Stanford computational linguistics & MIT Lincoln Laboratory vocal biomarker frameworks.

---

### Feature 2: OS-Wide Hold-to-Talk Whisper Dictation (Daily Retention Superpower)
- **Concept:** A global keyboard trigger (e.g., Hold `Caps Lock`, `Fn`, or `Ctrl+Alt`) that captures speech system-wide, runs it through the local offline Whisper model, and injects clean text into whatever application is currently focused.
- **The Problem It Solves:** Meeting apps suffer from churn and low engagement on days without calls.
- **The Retention Moat:**
  - Users dictate emails, Slack messages, Notion docs, terminal commands, and code comments 50–100+ times per day.
  - Klyro becomes an indispensable daily OS utility (competing directly with Superwhisper / Wispr Flow, but with zero cloud subscriptions and 100% privacy).
- **Technical Architecture:**
  - Low-level OS keyboard hook in the Rust daemon (`klyro-core`).
  - Direct microphone stream to local GGML Whisper tiny/base model.
  - Simulated keypress / clipboard paste injection on release.

---

### Feature 3: Real-Time "Steer Back to Agenda" & Tangent Alarm
- **Concept:** Intelligent monitoring of meeting time versus scheduled topics from the calendar invitation.
- **HUD Experience:**
  - Analyzes the live transcript against agenda milestones.
  - When the discussion drifts off-topic for > 5 minutes:
    > *"Off-track (8m on legacy database migration) — 2 core agenda items remaining with 12m left. Suggested bridge: 'Before we wrap up today, let's make sure we lock in the rollout timeline...' "*

---

### Feature 4: Instant In-Call Document Grounding & Fact-Check HUD
- **Concept:** Sub-100ms local retrieval across connected private documentation (pitch decks, compliance certifications, pricing calculators, technical API docs).
- **The Problem It Solves:** During sales calls or technical interviews, unexpected questions (e.g., *"Do you support SOC2 Type II in APAC?"* or *"What is your SLA on enterprise failover?"*) cause hesitation and awkward pauses.
- **HUD Experience:**
  - Automatically surfaces exact verified clauses and answers inside the overlay HUD as soon as the question is asked, without requiring the user to switch windows or search Confluence.

---

### Feature 5: Pre-Flight "Ghost Prep" & Contact Memory Dossier
- **Concept:** An autonomous briefing card triggered 5 minutes before scheduled meetings.
- **Capabilities:**
  - Scans past local meeting transcripts, notes, and CRM records matching attendee email domains.
  - Summarizes:
    1. Unresolved objections from the previous conversation.
    2. Deliverables you committed to send.
    3. Personal rapport cues (e.g., weekend plans, personal milestones mentioned previously).

---

### Feature 6: Direct 1-Click CRM Webhook Dispatch
- **Concept:** Direct API integration from the GTM Deal Dispatch Modal to external platforms:
  - **HubSpot & Salesforce:** Update deal stage, MEDDPICC fields, and create follow-up tasks.
  - **Notion & Linear:** Create structured meeting review pages or engineering sync issue tickets.
  - **Slack:** Post clean executive summaries directly to deal channels (`#deal-acme-corp`).

---

### Feature 7: Post-Call Key Moment Audio Bookmarking
- **Concept:** Automatically bookmarking 15-to-30 second audio clips corresponding to critical moments (buyer objections, verbal purchase commitments, or feature requests).
- **Capabilities:**
  - 1-click sharing of the exact audio soundbite for internal team review or manager coaching.

---

## 3. Prioritized Implementation Roadmap

| Priority | Feature | Complexity | Key Tech Stack |
| :---: | :--- | :---: | :--- |
| **P1** | **OS-Wide Hold-to-Talk Dictation** | Medium | Rust daemon (`klyro-core`), local Whisper GGML, OS input synthesis |
| **P1** | **Live Buyer Hesitation Engine** | Medium-High | Web Audio PCM analysis, zero-crossing VAD, pitch contouring, pause timing |
| **P2** | **Real-Time Tangent / Agenda Drift Alarm** | Low-Medium | Calendar domain integration, transcript semantic distance check |
| **P2** | **In-Call Document Grounding HUD** | Medium | Local BM25 + embedding retriever (`src/main/knowledge/`) |
| **P3** | **Pre-Flight Ghost Prep Dossier** | Low-Medium | Calendar trigger, contact memory matcher |
| **P3** | **Direct CRM Webhook Dispatch** | Low | HTTP REST / Webhooks (HubSpot, Salesforce, Notion) |

