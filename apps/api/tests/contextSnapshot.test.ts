import { describe, expect, it } from 'vitest';
import { ContextSnapshotV1Schema } from '@frank/contracts';
import {
  ContextSnapshotError,
  selectContext,
  validateSnapshot,
} from '../src/context/contextSnapshot.js';

const known = (value: unknown, now: number, source = 'android_system') => ({
  status: 'known',
  value,
  observedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 20_000).toISOString(),
  provenance: { source, collectedAt: new Date(now).toISOString() },
});
const denied = (permission: string, now: number) => ({
  status: 'denied',
  permission,
  provenance: { source: 'android_system', collectedAt: new Date(now).toISOString() },
});
const unknown = (now: number) => ({
  status: 'unknown',
  reason: 'not_collected',
  provenance: { source: 'android_app', collectedAt: new Date(now).toISOString() },
});

function snapshot(now = Date.now()) {
  return ContextSnapshotV1Schema.parse({
    schemaVersion: '1',
    snapshotId: 'snapshot-test-001',
    sessionId: 'session-1',
    capturedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20_000).toISOString(),
    time: known({ timezone: 'Europe/London', utcOffsetMinutes: 60 }, now),
    permissions: {
      microphone: known('granted', now),
      camera: denied('camera', now),
      location: known('granted', now),
      activity: denied('activity', now),
    },
    device: {
      connectivity: known('online', now),
      screen: known('locked', now),
      headphones: known(true, now),
      batteryPercent: known(72, now),
      cameraAvailable: known(true, now),
    },
    app: known({ state: 'listening', sessionOpen: true }, now, 'android_app'),
    location: known({ latitude: 51.5, longitude: -0.1, accuracyMeters: 14 }, now, 'android_sensor'),
    movement: {
      status: 'conflicting',
      reason: 'sensor_disagreement',
      sources: ['gps', 'activity'],
      provenance: { source: 'android_sensor', collectedAt: new Date(now).toISOString() },
    },
    evidence: unknown(now),
  });
}

describe('Context Snapshot V1', () => {
  it('accepts provenance from the iOS client', () => {
    const input = snapshot() as any;
    input.time.provenance.source = 'ios_system';
    expect(ContextSnapshotV1Schema.parse(input).time.provenance.source).toBe('ios_system');
  });

  it('preserves known, denied, unknown and conflicting signals', () => {
    const parsed = snapshot();
    expect(parsed.location.status).toBe('known');
    expect(parsed.permissions.camera.status).toBe('denied');
    expect(parsed.evidence.status).toBe('unknown');
    expect(parsed.movement.status).toBe('conflicting');
  });

  it('selects location context for a lost question without leaking unrelated device state', () => {
    const selected = selectContext(snapshot(), 'help', 'I am lost, where am I?')!;
    expect(selected.facts.map((fact) => fact.key)).toEqual([
      'location',
      'movement',
      'location_permission',
    ]);
    expect(selected.facts.find((fact) => fact.key === 'movement')?.status).toBe('conflicting');
  });

  it('selects no context for unrelated conversation', () => {
    expect(selectContext(snapshot(), 'help', 'Tell me a joke')?.facts).toEqual([]);
  });

  it('selects location for a typed action even when the wording has no location keyword', () => {
    const selected = selectContext(
      snapshot(),
      'help',
      'This is my base',
      undefined,
      Date.now(),
      { schemaVersion: '1', action: 'save_current_place', placeName: 'base' },
    )!;
    expect(selected.facts.map((fact) => fact.key)).toEqual([
      'location',
      'movement',
      'location_permission',
    ]);
  });

  it('rejects expired, cross-session and internally expired snapshots', () => {
    const now = Date.now();
    expect(() => validateSnapshot(snapshot(now - 30_000), 'session-1', now)).toThrow(
      ContextSnapshotError,
    );
    expect(() => validateSnapshot(snapshot(now), 'session-2', now)).toThrow(
      'CONTEXT_SESSION_MISMATCH',
    );
    const invalid = snapshot(now) as any;
    invalid.location.expiresAt = new Date(now - 1).toISOString();
    expect(() => validateSnapshot(invalid, 'session-1', now)).toThrow('CONTEXT_SIGNAL_INVALID');
  });

  it('downgrades an individually expired signal instead of exposing its value', () => {
    const now = Date.now();
    const input = snapshot(now) as any;
    input.location.observedAt = new Date(now - 10_000).toISOString();
    input.location.expiresAt = new Date(now - 1_000).toISOString();
    const validated = validateSnapshot(input, 'session-1', now);
    const selected = selectContext(validated, 'help', 'Where am I?', undefined, now)!;
    expect(selected.facts.find((fact) => fact.key === 'location')).toEqual({ key: 'location', status: 'stale' });
  });

  it('rejects contradictory permission and sensor claims', () => {
    const input = snapshot() as any;
    input.permissions.location = denied('location', Date.now());
    expect(() => validateSnapshot(input, 'session-1')).toThrow('CONTEXT_CONTRADICTORY');
  });
});
