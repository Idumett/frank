# Context Snapshot V1 Release Gate

Status: sealed for V1.

Context Snapshot is a short-lived, foreground-only accessibility signal. Lost Assistance can orient a user relative to their own confirmed places, but it is not navigation, obstacle avoidance, or a road-crossing system.

## Deterministic safety boundary

Road-crossing decisions, movement-safety questions, and turn-by-turn navigation requests are handled in code before camera analysis, memory retrieval, external data, or Gemini. Context, memories, conversation, OCR, labels, place names, and provider output are treated as data and cannot change that decision.

Missing, denied, stale, conflicting, and inaccurate location states each produce explicit wording and a diagnostic incident code. Location uncertainty above 200 metres is not used for orientation. A request to save a place requires 100 metres or better; a hazard requires 50 metres or better.

## Retention and privacy

| Data | Retention |
| --- | --- |
| Context Snapshot | Connection memory only; normally expires after 30 seconds |
| Unconfirmed place or hazard | Connection memory only; confirmation expires after 2 minutes |
| Confirmed place | Until the user deletes it |
| Active hazard | 30 days by default; contract maximum 90 days |
| Resolved hazard | 7 days by default, configurable up to 30 days |
| Idempotency response payload | 30 days by default, configurable up to 90 days |
| Context incident diagnostic | Follows the existing trace-retention setting |

Ordinary Context Assistance traces omit spoken responses and location values. Incident summaries contain only request ID, time, and a bounded incident code. Saved points remain owner-scoped and no route history is created.

## Release checks

- Context and product-data schemas reject malformed chronology, ownership, excessive hazard retention, and unsafe place-label characters.
- Android does not request background location.
- Phone lock state does not disable voice or foreground location assistance.
- Poor GPS, stale location, denied permission, contradictory signals, route-deviation language, lost mode, and expired hazards have deterministic tests.
- Accessibility wording does not tell the user to look, assume a sighted companion, claim movement is safe, or provide turns.
- `/v1/diag/context-incidents` is protected by the separate diagnostics credential.

Future place providers may add named public places, but their text and coordinates must enter through the same untrusted-data and accuracy boundaries.
