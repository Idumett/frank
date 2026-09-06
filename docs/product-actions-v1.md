# Product actions V1

Frank separates language understanding from authority. Gemini classifies a turn into an evidence intent and a versioned product-action proposal. The proposal contains only a small allowlisted action and typed arguments; it never contains database commands or coordinates.

The server selects the required Context Snapshot facts and validates ownership, freshness, accuracy and field limits. Writes require an explicit confirmation. Pending confirmations are stored by owner for two minutes, so a WebSocket reconnect does not silently lose the operation. SQLite writes remain idempotent and are reported as complete only after the adapter returns success.

Supported actions cover saving, moving, renaming, reviewing and deleting known places; saving, reviewing and resolving local hazard reports; and location, nearby-place and lost-assistance queries. The original deterministic parser remains as an offline provider fallback. If Gemini classification fails, Frank may handle the narrow fallback forms but cannot claim that a product-data change succeeded.

Ordinary prompts are explicitly prohibited from claiming that data was saved, updated, deleted or sent. Coordinates and private place labels are excluded from ordinary diagnostics; traces record only the action type and result.
