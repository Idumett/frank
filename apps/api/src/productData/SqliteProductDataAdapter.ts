import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  ProductDataRequestV1Schema,
  ProductDataResponseV1Schema,
  ProductEntityV1Schema,
  type ProductDataRequestV1,
  type ProductDataResponseV1,
  type ProductEntityV1,
} from '@frank/contracts';
import type { ProductDataPort } from './ProductDataPort.js';
import type { ConversationTurn, TtsPrefs, UserPrefs } from '@frank/core';
import type { MemoryItem } from '@frank/contracts';
import { SqliteMemoryStore } from '../db/sqliteMemoryStore.js';
import { SqliteConversationStore } from '../conversation/SqliteConversationStore.js';
import { UserPrefsStore } from '../prefs/UserPrefsStore.js';
import { SessionOwnershipStore } from '../security/sessionOwnership.js';

export class SqliteProductDataAdapter implements ProductDataPort {
  private readonly memories: SqliteMemoryStore;
  private readonly conversations: SqliteConversationStore;
  private readonly preferences: UserPrefsStore;
  private readonly sessions: SessionOwnershipStore;

  constructor(private readonly db: Database.Database) {
    this.memories = new SqliteMemoryStore(db);
    this.conversations = new SqliteConversationStore(db);
    this.preferences = new UserPrefsStore(db);
    this.sessions = new SessionOwnershipStore(db);
  }

  add(userId: string, item: MemoryItem) { this.memories.add(userId, item); return Promise.resolve(); }
  search(userId: string, query: string, limit: number) { return this.memories.search(userId, query, { limit }); }
  recent(userId: string, limit: number) { return this.memories.recent(userId, limit); }
  delete(userId: string, ids: string[]) { return this.memories.delete(userId, ids); }
  addTurn(turn: ConversationTurn) { return this.conversations.addTurn(turn); }
  getRecent(userId: string, sessionId: string, limit: number) { return this.conversations.getRecent(userId, sessionId, limit); }
  setPreferences(userId: string, sessionId: string, tts: TtsPrefs): UserPrefs { return this.preferences.set(userId, sessionId, tts); }
  getPreferences(userId: string, sessionId: string): UserPrefs | null { return this.preferences.get(userId, sessionId); }
  claimSession(userId: string, sessionId?: string) { this.sessions.claim(userId, sessionId); }

  execute(authenticatedOwnerId: string, input: ProductDataRequestV1): ProductDataResponseV1 {
    const request = ProductDataRequestV1Schema.parse(input);
    if (request.ownerId !== authenticatedOwnerId) {
      return failure(
        request.requestId,
        'unauthorised',
        'The requested owner does not match the access token',
        false,
      );
    }
    if (request.operation === 'put' && request.entity.ownerId !== authenticatedOwnerId) {
      return failure(
        request.requestId,
        'unauthorised',
        'The entity belongs to another owner',
        false,
      );
    }

    try {
      return this.db.transaction(() => this.run(request))();
    } catch (error) {
      if (error instanceof IdempotencyConflict) {
        return failure(request.requestId, 'idempotency_conflict', error.message, false);
      }
      return failure(
        request.requestId,
        'storage_unavailable',
        'Product data could not be stored',
        true,
      );
    }
  }

  private run(request: ProductDataRequestV1): ProductDataResponseV1 {
    if (request.operation === 'put' || request.operation === 'delete') {
      const replay = this.replay(request);
      if (replay) return replay;
    }

    let response: ProductDataResponseV1;
    if (request.operation === 'put') {
      const entity = ProductEntityV1Schema.parse(request.entity);
      this.db
        .prepare(
          `
        INSERT INTO product_entities (owner_id, entity_type, entity_id, schema_version, payload_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(owner_id, entity_type, entity_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `,
        )
        .run(
          entity.ownerId,
          entity.entityType,
          entity.id,
          entity.schemaVersion,
          JSON.stringify(entity),
          entity.createdAt,
          entity.updatedAt,
        );
      response = success(request.requestId, { kind: 'entity', entity });
    } else if (request.operation === 'get') {
      const row = this.db
        .prepare(
          'SELECT payload_json FROM product_entities WHERE owner_id = ? AND entity_type = ? AND entity_id = ?',
        )
        .get(request.ownerId, request.entityType, request.entityId) as
        | { payload_json: string }
        | undefined;
      response = row
        ? success(request.requestId, { kind: 'entity', entity: parseEntity(row.payload_json) })
        : failure(request.requestId, 'not_found', 'Product entity was not found', false);
    } else if (request.operation === 'list') {
      const rows = this.db
        .prepare(
          `
        SELECT payload_json FROM product_entities
        WHERE owner_id = ? AND entity_type = ?
          AND (? IS NULL OR json_extract(payload_json, '$.sessionId') = ?)
        ORDER BY updated_at DESC LIMIT ?
      `,
        )
        .all(
          request.ownerId,
          request.entityType,
          request.sessionId ?? null,
          request.sessionId ?? null,
          request.limit,
        ) as Array<{ payload_json: string }>;
      const entities = rows.map((row) => parseEntity(row.payload_json));
      response = success(request.requestId, { kind: 'list', entities });
    } else {
      const result = this.db
        .prepare(
          'DELETE FROM product_entities WHERE owner_id = ? AND entity_type = ? AND entity_id = ?',
        )
        .run(request.ownerId, request.entityType, request.entityId);
      response = success(request.requestId, { kind: 'deleted', deleted: result.changes > 0 });
    }

    if (request.operation === 'put' || request.operation === 'delete')
      this.remember(request, response);
    return ProductDataResponseV1Schema.parse(response);
  }

  private replay(request: Extract<ProductDataRequestV1, { operation: 'put' | 'delete' }>) {
    const row = this.db
      .prepare(
        'SELECT request_hash, response_json FROM product_operations WHERE owner_id = ? AND idempotency_key = ?',
      )
      .get(request.ownerId, request.idempotencyKey) as
      | { request_hash: string; response_json: string }
      | undefined;
    if (!row) return null;
    if (row.request_hash !== hashRequest(request))
      throw new IdempotencyConflict('The idempotency key was already used for different data');
    const response = ProductDataResponseV1Schema.parse(JSON.parse(row.response_json));
    return response.ok ? { ...response, idempotentReplay: true } : response;
  }

  private remember(
    request: Extract<ProductDataRequestV1, { operation: 'put' | 'delete' }>,
    response: ProductDataResponseV1,
  ) {
    this.db
      .prepare(
        `INSERT INTO product_operations (owner_id, idempotency_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        request.ownerId,
        request.idempotencyKey,
        hashRequest(request),
        JSON.stringify(response),
        new Date().toISOString(),
      );
  }
}

class IdempotencyConflict extends Error {}
function hashRequest(request: ProductDataRequestV1) {
  return crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
}
function parseEntity(json: string): ProductEntityV1 {
  return ProductEntityV1Schema.parse(JSON.parse(json));
}
function success(
  requestId: string,
  result: Extract<ProductDataResponseV1, { ok: true }>['result'],
): ProductDataResponseV1 {
  return ProductDataResponseV1Schema.parse({
    schemaVersion: '1',
    requestId,
    ok: true,
    result,
    idempotentReplay: false,
  });
}
function failure(
  requestId: string,
  code: Extract<ProductDataResponseV1, { ok: false }>['error']['code'],
  message: string,
  retryable: boolean,
): ProductDataResponseV1 {
  return ProductDataResponseV1Schema.parse({
    schemaVersion: '1',
    requestId,
    ok: false,
    error: { code, message, retryable },
  });
}
