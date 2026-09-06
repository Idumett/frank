import {
  ContextSnapshotV1Schema,
  SelectedContextV1Schema,
  type ContextSnapshotV1,
  type Intent,
  type ProductActionProposalV1,
  type SelectedContextV1,
} from '@frank/contracts';

const MAX_SNAPSHOT_LIFETIME_MS = 60_000;
const MAX_CLOCK_SKEW_MS = 10_000;

export function validateSnapshot(input: unknown, sessionId: string, now = Date.now()) {
  const snapshot = ContextSnapshotV1Schema.parse(input);
  if (snapshot.sessionId !== sessionId) throw new ContextSnapshotError('CONTEXT_SESSION_MISMATCH');
  const capturedAt = Date.parse(snapshot.capturedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (
    capturedAt > now + MAX_CLOCK_SKEW_MS ||
    expiresAt <= capturedAt ||
    expiresAt - capturedAt > MAX_SNAPSHOT_LIFETIME_MS
  ) {
    throw new ContextSnapshotError('CONTEXT_TIME_INVALID');
  }
  if (expiresAt <= now) throw new ContextSnapshotError('CONTEXT_STALE');
  const signals: any[] = [
    snapshot.time,
    ...Object.values(snapshot.permissions),
    ...Object.values(snapshot.device),
    snapshot.app,
    snapshot.location,
    snapshot.movement,
    snapshot.evidence,
  ];
  for (const signal of signals) {
    const collectedAt = Date.parse(signal.provenance.collectedAt);
    if (collectedAt > now + MAX_CLOCK_SKEW_MS)
      throw new ContextSnapshotError('CONTEXT_SIGNAL_INVALID');
    if (signal.status === 'known') {
      const observedAt = Date.parse(signal.observedAt);
      const signalExpiresAt = Date.parse(signal.expiresAt);
      if (
        observedAt > now + MAX_CLOCK_SKEW_MS ||
        signalExpiresAt <= observedAt
      ) {
        throw new ContextSnapshotError('CONTEXT_SIGNAL_INVALID');
      }
    }
  }
  if (
    snapshot.permissions.location.status === 'denied' &&
    (snapshot.location.status === 'known' || snapshot.movement.status === 'known')
  ) throw new ContextSnapshotError('CONTEXT_CONTRADICTORY');
  if (
    snapshot.permissions.camera.status === 'denied' &&
    snapshot.evidence.status === 'known'
  ) throw new ContextSnapshotError('CONTEXT_CONTRADICTORY');
  if (
    snapshot.device.cameraAvailable.status === 'known' &&
    snapshot.device.cameraAvailable.value === false &&
    snapshot.evidence.status === 'known'
  ) throw new ContextSnapshotError('CONTEXT_CONTRADICTORY');
  return snapshot;
}

export function selectContext(
  snapshot: ContextSnapshotV1 | null,
  intent: Intent,
  utterance: string,
  processedFrameId?: string,
  now = Date.now(),
  productAction?: ProductActionProposalV1,
): SelectedContextV1 | undefined {
  if (!snapshot || Date.parse(snapshot.expiresAt) <= now) return undefined;
  const text = utterance.toLowerCase();
  const keys = new Set<SelectedContextV1['facts'][number]['key']>();
  const actionNeedsLocation = productAction && [
    'save_current_place', 'update_saved_place', 'save_current_hazard',
    'where_am_i', 'whats_nearby', 'lost_assistance',
  ].includes(productAction.action);
  if (/\b(time|date|day|today|tonight|morning|afternoon|evening)\b/.test(text)) keys.add('time');
  if (actionNeedsLocation || /\b(where am i|lost|location|nearby|near me|around here|which way|direction|save|remember|report|pothole|hazard)\b/.test(text)) {
    keys.add('location');
    keys.add('movement');
    keys.add('location_permission');
  }
  if (/\b(battery|charge)\b/.test(text)) keys.add('battery');
  if (/\b(internet|online|offline|connection|network)\b/.test(text)) keys.add('connectivity');
  if (/\b(headphones|earphones|screen|locked|camera|microphone|permission)\b/.test(text)) {
    keys.add('headphones');
    keys.add('screen');
    keys.add('camera');
    keys.add('microphone_permission');
  }
  if (/\b(listening|speaking|thinking|what are you doing)\b/.test(text)) keys.add('app');
  if (['read_text', 'describe_scene', 'remember_this'].includes(intent)) keys.add('evidence');

  const facts: SelectedContextV1['facts'] = [];
  const add = (key: SelectedContextV1['facts'][number]['key'], signal: any, value?: unknown) => {
    if (!keys.has(key)) return;
    const expired = signal.status === 'known' && Date.parse(signal.expiresAt) <= now;
    facts.push({
      key,
      status: expired ? 'stale' : signal.status,
      ...(!expired && signal.status === 'known' && value !== undefined
        ? { value: value as any }
        : {}),
    });
  };
  add('time', snapshot.time, snapshot.time.status === 'known' ? snapshot.time.value : undefined);
  add(
    'location',
    snapshot.location,
    snapshot.location.status === 'known' ? snapshot.location.value : undefined,
  );
  add(
    'movement',
    snapshot.movement,
    snapshot.movement.status === 'known' ? snapshot.movement.value : undefined,
  );
  add(
    'connectivity',
    snapshot.device.connectivity,
    snapshot.device.connectivity.status === 'known'
      ? snapshot.device.connectivity.value
      : undefined,
  );
  add(
    'screen',
    snapshot.device.screen,
    snapshot.device.screen.status === 'known' ? snapshot.device.screen.value : undefined,
  );
  add(
    'headphones',
    snapshot.device.headphones,
    snapshot.device.headphones.status === 'known' ? snapshot.device.headphones.value : undefined,
  );
  add(
    'battery',
    snapshot.device.batteryPercent,
    snapshot.device.batteryPercent.status === 'known'
      ? snapshot.device.batteryPercent.value
      : undefined,
  );
  add(
    'camera',
    snapshot.device.cameraAvailable,
    snapshot.device.cameraAvailable.status === 'known'
      ? snapshot.device.cameraAvailable.value
      : undefined,
  );
  add(
    'microphone_permission',
    snapshot.permissions.microphone,
    snapshot.permissions.microphone.status === 'known'
      ? snapshot.permissions.microphone.value
      : undefined,
  );
  add(
    'location_permission',
    snapshot.permissions.location,
    snapshot.permissions.location.status === 'known'
      ? snapshot.permissions.location.value
      : undefined,
  );
  add('app', snapshot.app, snapshot.app.status === 'known' ? snapshot.app.value : undefined);
  add(
    'evidence',
    snapshot.evidence.status === 'known' && snapshot.evidence.value.frameId !== processedFrameId
      ? { status: 'unknown' }
      : snapshot.evidence,
    snapshot.evidence.status === 'known' && snapshot.evidence.value.frameId === processedFrameId
      ? snapshot.evidence.value
      : undefined,
  );
  return SelectedContextV1Schema.parse({
    schemaVersion: '1',
    snapshotId: snapshot.snapshotId,
    selectedAt: new Date(now).toISOString(),
    facts,
  });
}

export function contextForPrompt(context?: SelectedContextV1) {
  if (!context?.facts.length) return '(none)';
  return context.facts
    .map(
      (fact) =>
        `${fact.key}=${fact.status}${fact.value === undefined ? '' : `:${JSON.stringify(fact.value)}`}`,
    )
    .join(' | ');
}

export function isRoadCrossingQuestion(text: string) {
  return /\b(safe|okay|ok|clear|can i|should i|when should i)\b.{0,35}\b(cross|crossing|road|street|traffic)\b|\b(cross|crossing)\b.{0,35}\b(safe|clear|now)\b/i.test(
    text,
  );
}

export class ContextSnapshotError extends Error {
  constructor(
    readonly code:
      | 'CONTEXT_SESSION_MISMATCH'
      | 'CONTEXT_TIME_INVALID'
      | 'CONTEXT_STALE'
      | 'CONTEXT_SIGNAL_INVALID'
      | 'CONTEXT_CONTRADICTORY',
  ) {
    super(code);
  }
}
