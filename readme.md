# Frank — System Overview & API Map

**As of:** **2026-08-03**

Frank is a **personal visual reasoning assistant** designed to help blind and visually impaired users by combining computer vision, language models, memory, conversation context and natural voice interaction.

Frank is intentionally built as a **provider-agnostic reasoning engine** with **multiple client adapters** (Android, Raspberry Pi and future devices) that all route into the same core logic.

This document describes the current architecture, available APIs and how the system is organised.

---

# 1. High-level architecture

```
        Android App
        Raspberry Pi
      Future Wearables
             │
             ▼
     HTTP / WebSocket API
             │
             ▼
      Frank Orchestrator
             │
 ┌───────────┼────────────┐
 ▼           ▼            ▼
Vision     Memory     Conversation
             │
             ▼
        LLM Reasoning
             │
             ▼
        Assistant Reply
```

### Design principle

> **Frank has one brain.**
> Every client talks to the same reasoning engine.

The Android app, Raspberry Pi and future devices should behave identically because none of them contain assistant logic.

---

# 2. Frank Core

**Location:** `packages/core`

The orchestrator is the single entry point for intelligence.

```ts
handleUserRequest(
    request: UserRequest,
    imageBytes?: Buffer
): Promise<AssistantReply>
```

The orchestrator currently performs:

* Image quality assessment
* OCR
* Object / label detection
* Memory retrieval
* Conversation history retrieval
* Policy evaluation
* Grounded LLM reasoning
* Conversation storage
* Optional long-term memory storage
* Structured observability logging
* Final response generation

The core intentionally contains no provider-specific code.

---

# 3. Providers

**Location:** `packages/providers`

Current providers:

### Vision

* Google Cloud Vision OCR
* Google Cloud Vision Labels

### Language

* Google Gemini

### Speech

* Google Speech-to-Text
* Google Text-to-Speech

Providers are interchangeable.

The core only consumes Frank contracts.

---

# 4. Internal contracts

**Location:** `packages/contracts`

Important contracts include:

* UserRequest
* AssistantReply
* MemoryItem
* PerceptionResult
* PolicyDecision

These define how Frank thinks internally.

---

# 5. External protocol

**Location:** `packages/protocol`

Defines how external devices communicate with Frank.

Examples:

* ClientMsg
* ServerMsg
* WebSocket messages
* Protocol versioning

This allows devices to evolve independently of the brain.

---

# 6. Client adapters

Frank currently supports multiple entry points.

## Android App

```
POST /v1/analyze
POST /v1/stt
POST /v1/tts
```

Designed for:

* Push-to-talk
* Camera capture
* Conversation mode
* Natural mobile UX

---

## Raspberry Pi

```
WS /v1/device/stream
```

Features:

* Wake word detection (Porcupine)
* Voice activity detection (Cobra)
* Automatic recording
* Automatic playback
* Streaming responses

---

## Device Frame API

```
POST /v1/device/frame
```

Simple request-response endpoint intended for embedded devices.

---

### Important invariant

All clients eventually execute:

```
FrankOrchestrator.handleUserRequest()
```

No client contains reasoning logic.

---

# 7. Current API

## Core

```
POST /v1/analyze
POST /v1/tts
POST /v1/stt
GET  /health
```

---

## Memory

```
POST /v1/memory/add
POST /v1/memory/search
POST /v1/memory/delete
GET  /v1/memory/recent
```

---

## Device

```
POST /v1/device/frame
WS   /v1/device/stream
```

---

## Diagnostics

```
GET /v1/diag/traces
GET /v1/diag/traces/:requestId
GET /v1/diag/session/:sessionId
```

These routes expose detailed request observability for development and debugging.

---

# 8. Conversation system

Frank maintains short-term conversation context.

Conversation history is used to resolve follow-up questions naturally.

Example:

> "Tell me more."

instead of asking:

> "Tell you more about what?"

Recent conversation is retrieved before LLM reasoning and updated after every successful response.

Conversation context is separate from long-term memory.

---

# 9. Memory system

Frank currently supports long-term memory.

Memory is used for:

* Remembered facts
* User preferences
* Important information
* Future recall

Memory retrieval happens before reasoning.

Low-confidence responses are intentionally not stored.

---

# 10. Observability

Frank includes a full request tracing system.

Every request records:

* Request metadata
* Session
* Timing
* Every processing stage
* Stage durations
* Errors
* Final response

Typical stages include:

* quality.assess
* vision.ocr
* vision.labels
* memory.search
* policy.decide
* conversation.get_recent
* llm.generate_reply
* conversation.add_user_turn
* conversation.add_assistant_turn

Observability exists solely for development and can be disabled without affecting the core assistant.

---

# 11. Guardrails

Current guardrails include:

* Provider call budgets
* Image quality assessment
* Confidence-aware responses
* Hallucination reduction
* Grounding using OCR, labels, memory and conversation
* Short response enforcement
* Low-confidence memory protection
* Structured request tracing

---

# 12. Current architecture principles

Frank is intentionally built around:

* One reasoning engine
* Thin clients
* Provider abstraction
* Deterministic orchestration
* Clear contracts
* Easy extensibility

The long-term goal is to allow additional providers and devices without modifying the assistant's reasoning.

---

# 13. Current development stage

Current status:

* ✅ Core reasoning engine
* ✅ Android client
* ✅ Raspberry Pi voice client
* ✅ Conversation context
* ✅ Long-term memory
* ✅ Structured observability
* ✅ OCR + scene understanding
* ✅ Speech pipeline

Current focus:

* Improve reasoning quality
* Reduce response latency
* Improve prompt engineering
* Better memory retrieval
* UX refinement
* Tool integration (calendar, weather, Spotify, etc.)

---

# 14. Future roadmap

Planned work includes:

* Tool calling architecture
* Calendar integration
* Weather
* Music control
* Alarm and timer support
* Semantic memory (embeddings)
* Binary WebSocket streaming
* Offline capabilities where practical
* Wearable device support
* Personalisation

These additions will extend Frank's abilities without changing the core architecture.

---

# Mental model

```
@frank/core
        ↓
     The Brain

@frank/contracts
        ↓
 Brain's Internal Language

@frank/providers
        ↓
 External AI Services

@frank/protocol
        ↓
 Device Communication

API Routes
        ↓
 Thin Adapters
```

> **Frank is one brain with many ears, eyes and voices.**

---

# Copyright

This repository is published to showcase the project and its implementation.

All source code remains the intellectual property of **Hilary Asogwa**. No permission is granted to copy, modify, redistribute, or use this software without prior written consent.

**© 2026 Hilary Asogwa. All Rights Reserved.**

---

*End of document — valid as of 2026-08-03*
