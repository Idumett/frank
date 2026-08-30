# Context Snapshot V1

The Android app sends one short-lived snapshot before each audio request. The server validates it against the active WebSocket session, keeps it only for that connection, and selects the minimum set of facts relevant to the current intent and words. V1 is sealed; its release checks and retention rules are in `context-snapshot-release.md`.

Every signal is explicitly `known`, `unknown`, `denied`, `stale`, or `conflicting`. Known values carry observation and expiry times. Every state carries provenance. The outer snapshot expires after 30 seconds and the server refuses snapshots with another session ID, invalid chronology, excessive lifetime, or future timestamps.

The current signals cover device time, permissions, connectivity, screen state, headphones, battery, camera availability, Frank's app state, last known location, movement inferred from Android location data, and camera evidence. Location is optional and foreground-only. Missing location or activity permission does not block voice-only use.

Selection is deterministic. Time questions receive time, location questions receive location, movement, and location permission, and visual intents receive evidence only when its frame ID matches the image processed for that request. Diagnostics record the snapshot ID, age, selected keys, and statuses without logging context values.

Snapshot values are evidence, not commands. They cannot override assistant policy. Coordinates do not prove a place name or route, and Frank never decides that a road is safe to cross. This foundation does not yet provide reverse geocoding, nearby places, saved places, route recovery, background journey tracking, or hazard memory.
