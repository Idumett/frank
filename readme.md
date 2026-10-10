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

### Project map

```text
apps/api/
  src/server.ts          Fastify entry point, auth hooks and route registration
  src/routes/            HTTP, WebSocket, memory, product-data and diagnostics APIs
  src/context/           Context Snapshot selection and Lost Assistance
  src/evidence/          image intent, freshness and quality policy
  src/productData/       persistent SQLite adapter and typed product actions
  src/security/          tokens, ownership, limits and retention
  src/observability/     trace, latency, incident and provider-usage storage
  tests/                 API and integration tests
packages/contracts/      versioned Zod domain and product-data contracts
packages/protocol/       device WebSocket envelopes
packages/core/           orchestration, safety policy and conversation behavior
packages/providers/      Gemini, STT, TTS, OCR and label provider adapters
tests/v1/                repeatable V1 behavior and failure scenarios
scripts/                 benchmarks, provider comparisons and operational helpers
deploy/                  Docker image and Google Cloud VM operations
docs/                    decisions, contracts, safety and release evidence
```

When changing a shared payload, update `packages/contracts` or
`packages/protocol` first, then update the API and every client mirror. Keep route
files small; business rules belong in `core`, `context`, `evidence` or the typed
data adapter.

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

### Fresh checkout

Install Node 24 and enable Corepack. The repository pins pnpm in `package.json`.

```sh
corepack enable
pnpm install
pnpm build
pnpm typecheck
pnpm test:v1
pnpm dev
```

The API listens on `http://localhost:3000` by default. Check it with
`curl http://localhost:3000/health`. Development mode can run without an auth
file; production deliberately refuses to start without `FRANK_AUTH_FILE`.

Provider-backed speech, vision and Gemini calls require Application Default
Credentials for the Google Cloud project and `GEMINI_API_KEY`. Common settings
include `GCP_PROJECT_ID`, `GEMINI_MODEL`, `DB_PATH`, `TTS_CACHE_DIR`,
`OBSERVABILITY_ENABLED`, `FRANK_TIME_ZONE`, `HOST` and `PORT`. Never commit API
keys, bearer tokens, service-account JSON or an auth file.

For authenticated local work, point `FRANK_AUTH_FILE` at JSON containing
server-owned user IDs, SHA-256 product-token hashes and separate diagnostics-token
hashes. The exact boundary and rotation behavior are documented in
[the security guide](docs/security-boundary.md).

### Checks to run

Use this normal pre-push sequence:

```sh
pnpm build
pnpm typecheck
pnpm test:v1
```

Useful validation commands include:

```sh
pnpm test:v1:report
pnpm benchmark:gemini
pnpm compare:vision
```

`benchmark:gemini` and `compare:vision` may call paid providers; use them only with
an intentional test budget. `test:v1` is deterministic and is the normal local
gate. A failing import immediately after cloning usually means the workspace
packages have not been built yet: run `pnpm build` before repeating the tests.

The repeatable V1 set covers conversation, recall, weak evidence, empty speech,
provider failures, cancellation, reconnection, stale frames, context conflicts,
lost assistance and mobility safety wording. Passing automated tests does not
replace the physical-device and user validation required before broader release.

## Staging operations

The staging server runs on the `frank-demo` Compute Engine VM in the Frank Google
Cloud project, behind Caddy HTTPS on the configured `sslip.io` domain. Persistent
SQLite data and the TTS cache live under `/var/lib/frank`; they are not stored in
the container or Git repository.

The VM checks `main` every two minutes. A changed revision is built as a candidate,
health-checked locally, swapped into service and checked again through public
HTTPS. The previous container remains available for rollback. Unchanged commits
are skipped after deployment. Therefore, pushing directly to `main` deploys
staging without another approval step; use a branch and pull request for unfinished
work.

```sh
gcloud compute ssh frank-demo --project=gen-lang-client-0124758441 --zone=europe-west2-a --tunnel-through-iap
systemctl status frank-deploy.timer
journalctl -u frank-deploy.service -n 100 --no-pager
sudo frank-update
sudo frank-rollback
sudo frank-refresh-secrets
sudo frank-backup
sudo frank-restore latest --verify-only
```

`sudo frank-update` is safe to run manually and skips the current revision. Set
`FRANK_FORCE_DEPLOY=1` only when the same commit genuinely needs rebuilding. If a
candidate fails either health check, inspect its logs and keep or restore the last
healthy container rather than editing persistent data by hand.

SQLite and the TTS cache live on persistent storage. Daily integrity-checked
backups are retained locally and copied to a private Cloud Storage bucket. Public
health is checked every two minutes, failure alerts are configured, and provider
usage can be reviewed through the protected diagnostics API. See
[deployment operations](deploy/README.md).

### Safe maintenance checklist

1. Work on a branch and run the build, typecheck and V1 suite.
2. Review schema changes against Android and iOS contract mirrors.
3. Merge to `main`; allow up to two minutes for the VM poll.
4. Confirm `/health`, the deployed revision and `frank-deploy.service` logs.
5. Check protected diagnostics for new failure or latency regressions.
6. Roll back immediately if the public health check or core scenarios regress.

Do not delete `/var/lib/frank`, replace the database, print runtime secrets or put
diagnostic credentials in the Android application. Secret values come from Secret
Manager and the hashed auth registry; `deploy/gcp/frank-demo.env` contains
deployment coordinates rather than provider credentials.

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
