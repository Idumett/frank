# Frank Server

Frank is an AI accessibility assistant for blind and low-vision users. The server
turns speech, deliberately selected camera evidence, short-lived device context,
conversation history and user-owned memories into a concise spoken response.

## Current position

Frank V1 is running as a staging service at
`https://35.242.143.73.sslip.io`. The Android client uses its authenticated HTTPS
and WebSocket APIs. The current release includes:

- speech-to-text, Gemini reasoning and text-to-speech;
- deliberate camera evidence with freshness, quality and frame identity checks;
- short-term conversation and owner-scoped long-term memory;
- Context Snapshot for time, permissions, app state, movement and foreground location;
- user-confirmed known places, approximate orientation and remembered hazards;
- natural-language, confirmed product actions with reconnect-safe pending writes;
- deterministic mobility and road-crossing safety boundaries;
- typed, versioned product-data contracts with a persistent local adapter and
  Chivora-compatible fixtures;
- request tracing, incident diagnostics, provider usage and latency reporting;
- authenticated product and diagnostics boundaries, retention controls, rate
  limits and bounded provider calls; and
- staged deployment, rollback, health monitoring and verified off-VM backups.

V1 is a working private-test release. It is not presented as dependable navigation,
obstacle avoidance or a road-crossing system. Lost Assistance gives conservative
orientation using fresh, sufficiently accurate context and the user's confirmed
places. Frank does not collect route history or request background location.

The remaining product work is physical testing with blind and low-vision users,
production identity and account recovery, final Play declarations and review,
provider tuning based on real traces, and offline support where it is useful.

## Architecture

```text
Android / device clients
        |
        | HTTPS + WebSocket, authenticated and versioned
        v
Frank API adapters
        |
        v
Frank orchestrator
  |-- deterministic policy and context selection
  |-- conversation, memory and product data
  |-- image quality, OCR and labels when evidence is needed
  |-- Gemini response generation
  `-- speech synthesis
        |
        v
Owner-scoped SQLite today / Chivora adapter later
```

`packages/core` owns orchestration and policy. `packages/contracts` contains the
internal and product-data contracts, `packages/protocol` defines client transport,
and `packages/providers` isolates Gemini and Google Cloud speech and vision. The
API in `apps/api` remains a thin adapter around those boundaries.

Stable prompt instructions are kept ahead of changing turn context. Conversation,
memory and evidence are bounded, token and cache metadata are recorded, and the
uncached Gemini path remains available. Camera analysis only runs for intents that
need visual evidence; a previous frame must never be represented as a current view.

## Context and safety

Context Snapshot distinguishes known, unknown, denied, stale and conflicting
signals, with provenance and expiry. The server selects only the context relevant
to the current turn. Device context, memories, OCR text, place names and external
provider output are treated as untrusted data and cannot override assistant policy.

Road-crossing decisions, movement-safety questions and requests for turn-by-turn
navigation are intercepted in code before Gemini. Poor or stale GPS produces an
explicit limitation instead of false precision. Places and hazards require user
confirmation, remain owner-scoped and can be reviewed, corrected or deleted.

See [Context Snapshot release gate](docs/context-snapshot-release.md),
[Lost Assistance](docs/lost-assistance-v1.md) and
[camera evidence](docs/camera-evidence.md).

## API surface

```text
GET  /health
GET  /privacy
POST /v1/analyze
POST /v1/stt
POST /v1/tts
WS   /v1/device/stream
POST /v1/device/frame

POST /v1/memory/add
POST /v1/memory/search
POST /v1/memory/delete
GET  /v1/memory/recent

GET  /v1/diag/traces
GET  /v1/diag/summary
GET  /v1/diag/provider-usage
GET  /v1/diag/context-incidents
```

Product routes and diagnostic routes use separate credentials. A product bearer
token maps to a server-owned user ID; clients cannot choose ownership. The current
private demo maps its configured token to the demo user. Multi-user sign-in and
account recovery are a later product boundary, not an assumption made by V1.

## Local development

Use the Node and pnpm versions declared by the project, then provide the Google
provider credentials and local auth configuration described by the environment
example.

```sh
pnpm install
pnpm typecheck
pnpm test:v1
pnpm dev
```

Useful validation commands include:

```sh
pnpm test:v1:report
pnpm benchmark:gemini
pnpm compare:vision
```

The repeatable V1 set covers conversation, recall, weak evidence, empty speech,
provider failures, cancellation, reconnection, stale frames, context conflicts,
lost assistance and mobility safety wording. Passing automated tests does not
replace the physical-device and user validation required before broader release.

## Staging operations

The VM checks the `main` branch every two minutes and applies new commits through
staged container updates. Operators can
update, roll back, refresh secrets, back up and verify a restore without changing
the architecture.

```sh
sudo frank-update
sudo frank-rollback
sudo frank-refresh-secrets
sudo frank-backup
sudo frank-restore latest --verify-only
```

SQLite and the TTS cache live on persistent storage. Daily integrity-checked
backups are retained locally and copied to a private Cloud Storage bucket. Public
health is checked every two minutes, failure alerts are configured, and provider
usage can be reviewed through the protected diagnostics API. See
[deployment operations](deploy/README.md).

## Data boundary

Raw audio and camera frames are processed in memory and are not retained. Context
Snapshots expire with the connection, conversation turns are short-lived, traces
and synthesized speech have bounded retention, and confirmed memories, places and
preferences remain until deleted. Ordinary logs omit authorization values, request
bodies, spoken text and location values.

The local typed product-data adapter is intentionally replaceable. Chivora can be
connected behind the same versioned schemas, ownership rules, idempotency behavior
and typed errors without changing Frank's reasoning code. See
[product data](docs/product-data-v1.md) and
[online security boundary](docs/security-boundary.md).

## Copyright

This repository is published to showcase the project and its implementation.
All source code remains the intellectual property of **Hilary Asogwa**. No
permission is granted to copy, modify, redistribute or use this software without
prior written consent.

**© 2026 Hilary Asogwa. All Rights Reserved.**
