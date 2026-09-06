import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ProductDataRequestV1Schema, SelectedContextV1Schema } from '@frank/contracts';
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
    CREATE TABLE pending_product_actions (
      owner_id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
  `);
  const store = new SqliteProductDataAdapter(db);
  return { db, store, session: new LostAssistanceSession(store, 'dan') };
}

function contextStatus(status: 'unknown' | 'denied' | 'stale' | 'conflicting') {
  return SelectedContextV1Schema.parse({
    schemaVersion: '1', snapshotId: 'snapshot-degraded-1', selectedAt: new Date().toISOString(),
    facts: [{ key: 'location', status }],
  });
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

  it('executes a typed natural-language proposal and survives a reconnect before confirmation', () => {
    const { db, store, session } = setup();
    expect(
      session.handle(
        'Mark where I am as home',
        context(),
        'request-natural-001',
        { schemaVersion: '1', action: 'save_current_place', placeName: 'home' },
      ),
    ).toMatchObject({ action: 'confirm_save_place', speak: 'Save this location as home?' });

    const reconnected = new LostAssistanceSession(store, 'dan');
    expect(reconnected.handle('go ahead', undefined, 'request-natural-002')).toMatchObject({
      action: 'place_saved',
      speak: 'Saved home.',
    });
    expect(reconnected.handle('Where am I?', context(), 'request-natural-003')?.speak).toContain(
      'home',
    );
    db.close();
  });

  it('does not execute an expired confirmation after reconnecting', () => {
    const { db, store, session } = setup();
    session.handle(
      'This spot is my gym',
      context(),
      'request-expiring-001',
      { schemaVersion: '1', action: 'save_current_place', placeName: 'gym' },
    );
    db.prepare("UPDATE pending_product_actions SET expires_at = '2020-01-01T00:00:00.000Z'").run();
    const reconnected = new LostAssistanceSession(store, 'dan');
    expect(reconnected.handle('yes', undefined, 'request-expiring-002')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) count FROM product_entities').get()).toEqual({ count: 0 });
    db.close();
  });

  it('asks for a name when the user requests a save without supplying one', () => {
    const { db, session } = setup();
    expect(
      session.handle(
        'Save my current location',
        context(),
        'request-name-001',
        { schemaVersion: '1', action: 'save_current_place' },
      ),
    ).toMatchObject({ action: 'place_name_required' });
    expect(session.handle('Call it my flat', undefined, 'request-name-002')).toMatchObject({
      action: 'confirm_save_place',
      speak: 'Save this location as my flat?',
    });
    expect(session.handle('yes', undefined, 'request-name-003')).toMatchObject({
      action: 'place_saved',
      speak: 'Saved my flat.',
    });
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

  it.each([
    ['stale', 'too old', 'location_stale'],
    ['denied', 'permission is off', 'location_denied'],
    ['conflicting', 'signals disagree', 'location_conflicting'],
    ['unknown', "don't have a current location", 'location_unavailable'],
  ] as const)('handles %s location without guessing', (status, wording, action) => {
    const { db, session } = setup();
    const result = session.handle('Where am I?', contextStatus(status), `request-${status}-01`)!;
    expect(result.action).toBe(action);
    expect(result.speak.toLowerCase()).toContain(wording);
    expect(result.speak).not.toMatch(/you are at|turn left|turn right/i);
    db.close();
  });

  it('handles poor GPS and phone-in-pocket context conservatively', () => {
    const { db, session } = setup();
    const poor = session.handle('Where am I?', context(51.5, -0.1, 650), 'request-poor-gps')!;
    expect(poor).toMatchObject({ action: 'location_inaccurate', data: { accuracyBand: 'very_poor' } });
    const pocket = SelectedContextV1Schema.parse({
      ...context(), facts: [...context().facts, { key: 'screen', status: 'known', value: 'locked' }],
    });
    expect(session.handle('Where am I?', pocket, 'request-pocket-01')?.action).toBe('location_only');
    db.close();
  });

  it('treats route deviation and movement safety as incidents, not navigation prompts', () => {
    const { db, session } = setup();
    expect(session.handle('I think I went the wrong way', context(), 'request-deviation')).toMatchObject({ action: 'route_not_tracked', data: { incident: 'route_deviation' } });
    const move = session.handle('Is it safe to walk forward?', context(), 'request-movement')!;
    expect(move).toMatchObject({ action: 'mobility_movement_safety', data: { incident: 'movement_safety' } });
    expect(move.speak).toContain("can't confirm that it is safe");
    db.close();
  });

  it('physically removes expired hazards and old idempotency payloads', () => {
    const { db, store } = setup();
    const entity = {
      schemaVersion: '1', entityType: 'hazard', id: 'hazard-expired', ownerId: 'dan',
      createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z',
      provenance: { source: 'frank_server', requestId: 'request-expired-1' },
      hazardType: 'pothole', description: 'old pothole',
      location: { latitude: 51.5, longitude: -0.1, accuracyMeters: 10 }, radiusMeters: 12,
      reportedAt: '2026-07-01T10:00:00.000Z', expiresAt: '2026-07-31T10:00:00.000Z',
      confirmation: { confirmedBy: 'user', confirmedAt: '2026-07-01T10:00:00.000Z' }, status: 'active',
    } as const;
    store.execute('dan', ProductDataRequestV1Schema.parse({ schemaVersion: '1', requestId: 'request-expired-1', ownerId: 'dan', operation: 'put', idempotencyKey: 'write-expired-001', entity }));
    db.prepare("UPDATE product_operations SET created_at = '2026-07-01T10:00:00.000Z'").run();
    expect(store.applyRetention(new Date('2026-09-01T10:00:00.000Z'))).toEqual({ expiredHazards: 1, resolvedHazards: 0, operations: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM product_entities').get()).toEqual({ count: 0 });
    db.close();
  });

  it('uses screen-reader-friendly wording without sight-dependent instructions', () => {
    const { db, session } = setup();
    const replies = [
      session.handle("I'm lost", contextStatus('stale'), 'request-wording-1')!,
      session.handle('Is it safe to walk forward?', context(), 'request-wording-2')!,
      session.handle('Where am I?', context(51.5, -0.1, 600), 'request-wording-3')!,
    ];
    for (const reply of replies) {
      expect(reply.speak).not.toMatch(/look around|as you can see|ask a sighted|obviously|simply|just look/i);
      expect(reply.speak.length).toBeLessThan(500);
    }
    db.close();
  });
});
