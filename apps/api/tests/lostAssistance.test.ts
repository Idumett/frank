import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SelectedContextV1Schema } from '@frank/contracts';
import { LostAssistanceSession } from '../src/context/lostAssistance.js';
import { SqliteProductDataAdapter } from '../src/productData/SqliteProductDataAdapter.js';

function setup() {
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
  return { db, session: new LostAssistanceSession(new SqliteProductDataAdapter(db), 'dan') };
}

function context(latitude = 51.5, longitude = -0.1, accuracyMeters = 10) {
  return SelectedContextV1Schema.parse({
    schemaVersion: '1', snapshotId: 'snapshot-location-1', selectedAt: new Date().toISOString(),
    facts: [{ key: 'location', status: 'known', value: { latitude, longitude, accuracyMeters } }],
  });
}

describe('lost assistance', () => {
  it('requires confirmation, then locates the user relative to a saved place', () => {
    const { db, session } = setup();
    expect(session.handle('Save this place as gym', context(), 'request-save-001')).toMatchObject({ action: 'confirm_save_place' });
    expect(session.handle('yes', undefined, 'request-save-002')).toMatchObject({ action: 'place_saved', speak: 'Saved gym.' });
    const result = session.handle('Where am I?', context(51.5009, -0.1), 'request-where-01')!;
    expect(result.action).toBe('location_assistance');
    expect(result.speak).toContain('gym');
    expect(result.speak).toContain('south');
    db.close();
  });

  it('stores expiring user reports and warns only when the report is nearby', () => {
    const { db, session } = setup();
    expect(session.handle('Remember there is a pothole here', context(), 'request-hazard-1')).toMatchObject({ action: 'confirm_save_hazard' });
    expect(session.handle('confirm', undefined, 'request-hazard-2')).toMatchObject({ action: 'hazard_saved' });
    const nearby = session.handle("What's nearby?", context(), 'request-nearby-1')!;
    expect(nearby.speak).toContain('previously reported');
    expect(nearby.speak).toContain('unverified');
    db.close();
  });

  it('supports review, rename and deletion without exposing another owner', () => {
    const { db, session } = setup();
    session.handle('Save this place as supermarket', context(), 'request-place-01');
    session.handle('yes', undefined, 'request-place-02');
    expect(session.handle('List my saved places', undefined, 'request-list-001')?.speak).toContain('supermarket');
    session.handle('Rename supermarket to corner shop', undefined, 'request-rename-1');
    expect(session.handle('yes', undefined, 'request-rename-2')).toMatchObject({ action: 'place_renamed' });
    session.handle('Update corner shop to here', context(51.501, -0.1), 'request-move-001');
    expect(session.handle('yes', undefined, 'request-move-002')).toMatchObject({ action: 'place_relocated' });
    session.handle('Delete corner shop', undefined, 'request-delete-1');
    expect(session.handle('yes', undefined, 'request-delete-2')).toMatchObject({ action: 'deleted' });
    expect(session.handle('List my saved places', undefined, 'request-list-002')).toMatchObject({ action: 'places_empty' });
    expect(db.prepare('SELECT DISTINCT owner_id FROM product_entities').all()).toEqual([]);
    db.close();
  });

  it('lets the user resolve a hazard report', () => {
    const { db, session } = setup();
    session.handle('Report a pothole here', context(), 'request-report-1');
    session.handle('yes', undefined, 'request-report-2');
    session.handle('Mark pothole resolved', undefined, 'request-resolve-1');
    expect(session.handle('yes', undefined, 'request-resolve-2')).toMatchObject({ action: 'hazard_resolved' });
    expect(session.handle('Review my hazards', undefined, 'request-review-1')).toMatchObject({ action: 'hazards_empty' });
    db.close();
  });

  it('does not claim navigation or crossing safety when the user is lost', () => {
    const { db, session } = setup();
    session.handle('Save this place as home', context(), 'request-home-001');
    session.handle('yes', undefined, 'request-home-002');
    const result = session.handle("I'm lost", context(51.502, -0.1), 'request-lost-001')!;
    expect(result.speak).toContain('orientation only, not a route');
    expect(result.speak).not.toMatch(/safe to cross|turn left|turn right/i);
    db.close();
  });
});
