import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ProductDataRequestV1Schema, ProductDataResponseV1Schema } from '@frank/contracts';
import { SqliteProductDataAdapter } from '../src/productData/SqliteProductDataAdapter.js';

function adapter() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE product_entities (
      owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      schema_version TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, entity_type, entity_id));
    CREATE TABLE product_operations (
      owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, idempotency_key));
  `);
  return { db, store: new SqliteProductDataAdapter(db) };
}

const put = {
  schemaVersion: '1',
  requestId: 'request-fixture-001',
  ownerId: 'dan',
  operation: 'put',
  idempotencyKey: 'write-fixture-001',
  entity: {
    schemaVersion: '1',
    entityType: 'memory',
    id: 'memory-fixture-001',
    ownerId: 'dan',
    memoryType: 'object',
    title: 'Front door key',
    content: 'The key is in the blue bowl.',
    tags: ['key'],
    createdAt: '2026-08-24T08:15:00.000Z',
    updatedAt: '2026-08-24T08:15:00.000Z',
    provenance: { source: 'chivora_fixture', requestId: 'request-fixture-001' },
  },
} as const;

describe('V1 product-data contract', () => {
  it('rejects malformed data before it reaches storage', () => {
    expect(
      ProductDataRequestV1Schema.safeParse({
        ...put,
        entity: { ...put.entity, createdAt: 'yesterday' },
      }).success,
    ).toBe(false);
  });

  it('persists typed entities and replays duplicate writes safely', () => {
    const { db, store } = adapter();
    const first = store.execute('dan', ProductDataRequestV1Schema.parse(put));
    const duplicate = store.execute('dan', ProductDataRequestV1Schema.parse(put));
    expect(ProductDataResponseV1Schema.parse(first)).toMatchObject({
      ok: true,
      idempotentReplay: false,
    });
    expect(duplicate).toMatchObject({ ok: true, idempotentReplay: true });
    expect(db.prepare('SELECT COUNT(*) count FROM product_entities').get()).toEqual({ count: 1 });
    db.close();
  });

  it('rejects an idempotency key reused for different data', () => {
    const { db, store } = adapter();
    store.execute('dan', ProductDataRequestV1Schema.parse(put));
    const changed = ProductDataRequestV1Schema.parse({
      ...put,
      entity: { ...put.entity, content: 'Changed' },
    });
    expect(store.execute('dan', changed)).toMatchObject({
      ok: false,
      error: { code: 'idempotency_conflict' },
    });
    db.close();
  });

  it("does not read or write another owner's data", () => {
    const { db, store } = adapter();
    expect(store.execute('someone-else', ProductDataRequestV1Schema.parse(put))).toMatchObject({
      ok: false,
      error: { code: 'unauthorised' },
    });
    expect(db.prepare('SELECT COUNT(*) count FROM product_entities').get()).toEqual({ count: 0 });
    db.close();
  });

  it('validates confirmed places and expiring hazards', () => {
    const base = {
      schemaVersion: '1', ownerId: 'dan', createdAt: '2026-08-28T10:00:00.000Z',
      updatedAt: '2026-08-28T10:00:00.000Z',
      provenance: { source: 'frank_server', requestId: 'request-location-001' },
      location: { latitude: 51.5, longitude: -0.1, accuracyMeters: 12 },
      confirmation: { confirmedBy: 'user', confirmedAt: '2026-08-28T10:00:00.000Z' },
    } as const;
    expect(ProductDataRequestV1Schema.safeParse({
      schemaVersion: '1', requestId: 'request-place-001', ownerId: 'dan', operation: 'put',
      idempotencyKey: 'write-place-001',
      entity: { ...base, entityType: 'known_place', id: 'place-gym', name: 'gym', category: 'gym', status: 'active' },
    }).success).toBe(true);
    expect(ProductDataRequestV1Schema.safeParse({
      schemaVersion: '1', requestId: 'request-hazard-001', ownerId: 'dan', operation: 'put',
      idempotencyKey: 'write-hazard-001',
      entity: { ...base, entityType: 'hazard', id: 'hazard-pothole', hazardType: 'pothole',
        description: 'pothole', radiusMeters: 12, reportedAt: '2026-08-28T10:00:00.000Z',
        expiresAt: '2026-08-27T10:00:00.000Z', status: 'active' },
    }).success).toBe(false);
  });
});
