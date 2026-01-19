# Frank — System Overview & API Map

**As of:** **2026-01-19**

Frank is a **personal visual reasoning assistant** designed to help blind and visually impaired users by combining computer vision, language models, memory, and voice.

Frank is intentionally built as a **provider-agnostic brain** with **multiple client adapters** (apps, hardware, streaming devices) that all route into the same core logic.

This document describes **what exists today**, **how it’s structured**, and **how devices interact with it**.

---

## 1. High-level architecture

Frank is split into four conceptual layers:

[ Devices / Apps ]
v
[ API Adapters (HTTP / WS) ]
v
[ Frank Core (Brain) ]
v
[ Providers (Vision / LLM / Voice) ]

### Key principle

> **There is exactly ONE brain.**  
> All routes and protocols are just adapters into that brain.

---

## 2. The Core (the actual product)

### FrankOrchestrator

**Location:** `packages/core`

The orchestrator is the single entry point for intelligence:

```ts
handleUserRequest(
  request: UserRequest,
  imageBytes: Buffer
) -> AssistantReply
```

What it does:

- image quality assessment
- OCR + object/label detection (parallel)
- policy decision (Jarvis mode)
- LLM reasoning (grounded, short replies)
- memory read/write decisions
- returns a final AssistantReply

This logic is deterministic, boring, and testable by design.

## 3. Providers (Google-only for now)

**Location:** `packages/providers`

**Current providers**:

- Vision: Google Cloud Vision (OCR + labels)
- LLM: Google Gemini
- TTS: Google Text-to-Speech
- STT: Google Speech-to-Text

All provider responses are mapped into Frank’s internal contracts.
No provider-specific objects leak into the core.

## 4. Internal contracts vs external protocol

**Internal contracts** `(@frank/contracts)`

Used inside Frank only:

- UserRequest
- PerceptionResult
- PolicyDecision
- AssistantReply
- MemoryItem

These define how the brain thinks.

**External protocol** `(@frank/protocol)`
Used between Frank ↔ devices:

- ClientMsg
- ServerMsg
- protocol versioning

These defines how devices talk to Frank, independent of providers or internals.

## 5. Ways to call Frank (client options)

Frank supports multiple client entry points.
These are not different products — they are different adapters to the same orchestrator.

# Option 1: Simple client (easiest)

**Device** → `/v1/device/frame`

- one photo per request
- server sends audio + metadata back
- best for v1 hardware

# Option 2: App client (phone/web)

**Client** → `/v1/analyze + /v1/tts (+ /v1/stt)`

- more control for UX
- flexible playback and interruption handling
- best for mobile/web apps

# Option 3: Streaming glasses

**Device** → `WS /v1/device/stream`

- continuous frames
- persistent connection
- lower latency, more “live” feel

Important invariant
All of these options call the **SAME** orchestrator in the end.

```
/v1/analyze
/v1/device/frame
WS /v1/device/stream
        |
        v
FrankOrchestrator.handleUserRequest()
```

# 6. Existing API routes (summary)

**Core / App routes**
`POST /v1/analyze`
`POST /v1/tts`
`POST /v1/stt (optional)`
`GET /health`

**Memory routes**
`POST /v1/memory/add`
`POST /v1/memory/search`
`POST /v1/memory/delete`
`GET /v1/memory/recent`

**Device routes**
`POST /v1/device/frame`
`WS /v1/device/stream`

# 7. Guardrails currently implemented

As of today, Frank includes:

- rate limiting / cooldown
- provider call budget per request
- image quality gating
- Jarvis mode (answers even if image is poor when user asked something specific)
- hallucination prevention (LLM grounded only in OCR, labels, memory)
- hard short-reply enforcement
- confidence language (“Not sure.”)
- no memory storage on low confidence
- structured logging

# 8. What is intentionally NOT built yet

By design, Frank does not yet include:

- persistent device sessions
- true provider-level cancellation
- binary WebSocket frames (base64 for now)
- mobile or web UI
- hardware UX
- embeddings-based memory search
- personalization tuning

These are deferred until UX validation.

# 9. Current development stage

Frank is currently at:

- Backend complete, evaluation + UX-ready

Next steps:

- evaluation harness and tests
- thin UX (camera + push-to-talk)
- real user feedback
- policy and prompt iteration
- only then → hardware polish

# 10. Mental model to keep

`@frank/core` → the brain

`@frank/contracts` → brain language

`@frank/providers` → external services

`@frank/protocol` → device language

`API routes` → adapters, not logic

If you remember nothing else: **Frank is one brain with many mouths and ears.**

_End of document — valid as of 2026-01-19_
