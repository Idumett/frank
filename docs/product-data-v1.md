# V1 product data

`ProductDataPort` is the storage boundary for data that belongs to a Frank user.
The local implementation is `SqliteProductDataAdapter`; a future Chivora adapter
must implement the same port and pass the same conformance suite. API and Android
code use the versioned contract rather than database rows.

## Entities

- `user_profile`: identity-facing profile fields.
- `session`: ownership, device association and last activity.
- `memory`: text, object and scene memories plus optional media references.
- `conversation_turn`: ordered user and assistant messages for a session.
- `preferences`: session-scoped TTS choices.

Every entity carries `schemaVersion`, `id`, `ownerId`, `createdAt`, `updatedAt`
and `provenance`. Provenance identifies the source and request, with optional
provider and capture time. Media remains a reference; image bytes do not enter
the product-data contract.

## Operations

`POST /v1/product-data` accepts the discriminated V1 operations `put`, `get`,
`list` and `delete`. The access token supplies the authenticated owner. A body
claiming another owner receives the typed `unauthorised` error.

Writes require an idempotency key. Repeating the same write returns its stored
response with `idempotentReplay: true`; reusing the key for different data returns
`idempotency_conflict`. The adapter commits the entity and receipt in one SQLite
transaction.

Errors are one of `invalid_request`, `unauthorised`, `not_found`,
`idempotency_conflict` or `storage_unavailable`, and state whether retrying is
safe. Zod validates requests before the adapter and responses before they leave
the server. Android has matching models and runtime guards for data it sends or
accepts.

## Chivora handoff

The files under `docs/conformance/product-data-v1` are dummy Chivora payloads,
not live Chivora data. A Chivora adapter is ready to replace SQLite when it can:

1. accept every request fixture and produce a response accepted by the V1 schema;
2. enforce owner isolation using the server-authenticated owner;
3. preserve idempotency receipts across restarts and concurrent retries;
4. retain timestamps and provenance without rewriting their meaning;
5. return only declared typed errors and never provider-specific payloads;
6. pass malformed, duplicate, unauthorised and persistence tests.

The adapter selection should eventually come from configuration such as
`PRODUCT_DATA_ADAPTER=sqlite|chivora`. Chivora credentials and transport types
belong inside its adapter, keeping them out of the shared entity contract.
