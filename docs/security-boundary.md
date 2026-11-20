# Online product boundary

Frank maps each product bearer token to a server-owned user ID. The client never chooses that ID. Sessions are claimed by the first authenticated owner, and memory, preferences and conversation queries always include the owner. Existing V0 data is assigned to `LEGACY_USER_ID` during the first migration.

Diagnostics use a separate bearer token. A product token cannot read traces, and a diagnostics token cannot use product routes. The auth file stores SHA-256 token hashes, reloads when it changes and can contain two hashes briefly during a rotation. Run `sudo frank-refresh-secrets` after publishing a new `frank-auth-config` secret version; the application reloads the mounted file without restarting.

The API accepts at most 12 MiB per request and WebSocket message. Product routes allow 90 requests per user per minute, stream turns allow 20, and failed authentication allows 20 attempts per IP per minute. Voice streams allow three active connections per user and 64 across the service by default; `STREAM_MAX_CONNECTIONS_PER_USER` and `STREAM_MAX_CONNECTIONS` can tighten those limits. A socket is bound to the session established by its first `hello`, so later messages cannot switch session ownership. Provider deadlines and schema limits remain the final bounds for expensive work.

Auth configuration rejects duplicate owner IDs, unsafe owner identifiers and any token hash reused by another user or by diagnostics. This prevents an ambiguous credential from resolving to a different boundary because of registry order.

Audio and camera frames are processed in memory and are not persisted. Conversation turns are kept for one day, diagnostics for 14 days, synthesized speech cache files for seven days and inactive session claims for 30 days. Memories and preferences remain until the user deletes them or the product adds an account deletion flow. The cleanup runs at startup and once a day.

Ordinary request logs redact authorization and request bodies. They record IDs, sizes, timings and outcomes. Full trace details remain available only through the protected diagnostics routes.
