import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { deviceStreamRoutes, privacySafeContextUtterance } from '../src/routes/deviceStream.js';
import type { ObservabilityStore, RequestTraceRecord, TraceStage } from '@frank/core';

class TraceRecorder implements ObservabilityStore {
  records = new Map<string, RequestTraceRecord>();
  async start(record: RequestTraceRecord) {
    this.records.set(record.requestId, record);
  }
  async addStage(requestId: string, stage: TraceStage) {
    this.records.get(requestId)?.stages.push(stage);
  }
  async finish(requestId: string, output: unknown) {
    const record = this.records.get(requestId)!;
    record.endedAt = new Date().toISOString();
    record.output = output;
  }
  async fail(requestId: string, error: string) {
    const record = this.records.get(requestId);
    if (record) {
      record.endedAt = new Date().toISOString();
      record.error = error;
    }
  }
}

class MessageQueue {
  private messages: any[] = [];
  private waiters: Array<(message: any) => void> = [];

  constructor(socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.messages.push(message);
    });
  }

  next(): Promise<any> {
    const message = this.messages.shift();
    if (message) return Promise.resolve(message);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('V1 device stream', () => {
  it('redacts place and hazard commands from retained trace input', () => {
    expect(privacySafeContextUtterance('Save this place as my private gym')).toBe(
      '[context data command]',
    );
    expect(privacySafeContextUtterance('Report a pothole outside my house')).toBe(
      '[context data command]',
    );
    expect(privacySafeContextUtterance('Where am I?')).toBe('Where am I?');
  });
  it('requires hello and refuses a second request while one is running', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    let releaseStt!: () => void;
    const sttWait = new Promise<void>((resolve) => {
      releaseStt = resolve;
    });
    const frank = {
      handleUserRequest: async (request: any) => ({
        trace: request.trace,
        speak: 'Hello.',
        createdAt: new Date().toISOString(),
        suggestedAction: 'none',
        groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
      }),
    };
    const stt = {
      transcribe: async () => {
        await sttWait;
        return { transcript: 'Tell me how a camera works' };
      },
    };
    const tts = {
      speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }),
    };
    await deviceStreamRoutes(
      app,
      frank as any,
      stt as any,
      tts as any,
      traces,
      undefined,
      undefined,
      undefined,
      async () => 'help',
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);

    socket.send(
      JSON.stringify({
        type: 'frame',
        trace: { requestId: 'before-hello', sessionId: 'session-1' },
        frameId: 'frame-before-hello',
        seq: 1,
        mime: 'image/jpeg',
        bytesBase64: 'a'.repeat(20),
        capturedAt: new Date().toISOString(),
        ageMs: 0,
      }),
    );
    expect(await messages.next()).toMatchObject({ type: 'error', code: 'NO_HELLO' });

    const connection = { requestId: 'connection-123', sessionId: 'session-1' };
    socket.send(JSON.stringify({ type: 'hello', trace: connection }));
    expect((await messages.next()).type).toBe('ready');

    socket.send(
      JSON.stringify({
        type: 'audio',
        trace: { requestId: 'request-111', sessionId: 'session-1' },
        mime: 'audio/wav',
        audioBase64: 'a'.repeat(20),
      }),
    );
    socket.send(
      JSON.stringify({
        type: 'audio',
        trace: { requestId: 'request-222', sessionId: 'session-1' },
        mime: 'audio/wav',
        audioBase64: 'a'.repeat(20),
      }),
    );
    expect(await messages.next()).toMatchObject({
      type: 'error',
      code: 'BUSY',
      trace: { requestId: 'request-222' },
    });
    expect(traces.records.has('request-222')).toBe(false);

    releaseStt();
    const replies = [await messages.next(), await messages.next(), await messages.next()];
    expect(replies.map((message) => message.type)).toEqual(['transcript', 'meta', 'audio']);
    expect(traces.records.get('request-111')?.endedAt).toBeTruthy();
    socket.terminate();
  });

  it('rejects silence and records the STT failure', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    await deviceStreamRoutes(
      app,
      {
        handleUserRequest: async () => {
          throw new Error('should not run');
        },
      } as any,
      { transcribe: async () => ({ transcript: '' }) } as any,
      { speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }) } as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    socket.send(
      JSON.stringify({
        type: 'hello',
        trace: { requestId: 'connection-silence', sessionId: 'session-1' },
      }),
    );
    expect((await messages.next()).type).toBe('ready');
    socket.send(
      JSON.stringify({
        type: 'audio',
        trace: { requestId: 'request-silence', sessionId: 'session-1' },
        mime: 'audio/wav',
        audioBase64: 'a'.repeat(20),
      }),
    );
    expect(await messages.next()).toMatchObject({
      type: 'error',
      code: 'STT_FAIL',
      message: 'No speech recognized',
    });
    expect(traces.records.get('request-silence')?.error).toBe('No speech recognized');
    socket.terminate();
  });

  it('acknowledges a snapshot and selects only context relevant to the turn', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    let received: any;
    await deviceStreamRoutes(
      app,
      {
        handleUserRequest: async (request: any) => {
          received = request.context;
          return {
            trace: request.trace,
            speak: 'You appear to be nearby.',
            createdAt: new Date().toISOString(),
            suggestedAction: 'none',
            groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
          };
        },
      } as any,
      { transcribe: async () => ({ transcript: 'Where am I?' }) } as any,
      { speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }) } as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    socket.send(
      JSON.stringify({
        type: 'hello',
        trace: { requestId: 'connection-context', sessionId: 'session-context' },
      }),
    );
    await messages.next();
    socket.send(
      JSON.stringify({ type: 'context_snapshot', snapshot: contextSnapshot('session-context') }),
    );
    expect(await messages.next()).toMatchObject({
      type: 'context_ack',
      snapshotId: 'snapshot-context-001',
    });
    socket.send(
      JSON.stringify({
        type: 'audio',
        trace: { requestId: 'request-context', sessionId: 'session-context' },
        mime: 'audio/wav',
        audioBase64: 'a'.repeat(20),
      }),
    );
    await messages.next();
    await messages.next();
    await messages.next();
    expect(received.facts.map((fact: any) => fact.key)).toEqual([
      'location',
      'movement',
      'location_permission',
    ]);
    expect(traces.records.get('request-context')?.stages.map((stage) => stage.name)).toContain(
      'context.select',
    );
    socket.terminate();
  });

  it.each([
    ['What am I looking at?', 'audio'],
    ['Is this apple bruised?', 'audio'],
    ['And the one beside it?', 'audio'],
    ['Is this apple bruised?', 'utterance'],
  ])('requests evidence after semantic routing: %s (%s)', async (utterance, transport) => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    const images: number[] = [];
    await deviceStreamRoutes(
      app,
      {
        handleUserRequest: async (request: any, image?: Buffer) => {
          images.push(image?.length ?? 0);
          return {
            trace: request.trace,
            speak: 'A door is visible.',
            createdAt: new Date().toISOString(),
            suggestedAction: 'none',
            groundedIn: { usedOcr: false, usedLabels: true, usedMemoryHits: 0 },
            imageEvidence: { quality: 'good', notes: [] },
          };
        },
      } as any,
      { transcribe: async () => ({ transcript: utterance }) } as any,
      {
        speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }),
      } as any,
      traces,
      undefined,
      undefined,
      undefined,
      async (text, userId, sessionId) => {
        expect(text).toBe(utterance);
        expect(sessionId).toBe('session-visual');
        return 'describe_scene';
      },
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    const session = { requestId: 'connection-visual', sessionId: 'session-visual' };
    const turn = { requestId: 'request-visual', sessionId: 'session-visual' };
    socket.send(JSON.stringify({ type: 'hello', trace: session }));
    await messages.next();
    socket.send(
      JSON.stringify({
        type: transport,
        text: utterance,
        trace: turn,
        mime: 'audio/wav',
        audioBase64: 'a'.repeat(20),
      }),
    );
    if (transport === 'audio') expect((await messages.next()).type).toBe('transcript');
    expect(await messages.next()).toMatchObject({
      type: 'frame_required',
      trace: turn,
      reason: 'describe_scene',
    });
    socket.send(
      JSON.stringify({
        type: 'frame',
        trace: turn,
        frameId: 'fresh-frame-visual',
        seq: 9,
        mime: 'image/jpeg',
        bytesBase64: 'a'.repeat(20),
        capturedAt: new Date().toISOString(),
        ageMs: 0,
      }),
    );
    expect(await messages.next()).toMatchObject({ type: 'ack', seq: 9 });
    expect(await messages.next()).toMatchObject({
      type: 'meta',
      evidence: { frameId: 'fresh-frame-visual', quality: 'good' },
    });
    expect((await messages.next()).type).toBe('audio');
    expect(images).toEqual([15]);
    socket.terminate();
  });

  it('refuses stale camera evidence', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    await deviceStreamRoutes(
      app,
      {} as any,
      { transcribe: async () => ({ transcript: 'Describe what is in front of me' }) } as any,
      {} as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    const trace = { requestId: 'request-stale', sessionId: 'session-stale' };
    socket.send(
      JSON.stringify({
        type: 'hello',
        trace: { requestId: 'connection-stale', sessionId: 'session-stale' },
      }),
    );
    await messages.next();
    socket.send(
      JSON.stringify({ type: 'audio', trace, mime: 'audio/wav', audioBase64: 'a'.repeat(20) }),
    );
    await messages.next();
    await messages.next();
    socket.send(
      JSON.stringify({
        type: 'frame',
        trace,
        frameId: 'stale-frame-1',
        seq: 1,
        mime: 'image/jpeg',
        bytesBase64: 'a'.repeat(20),
        capturedAt: new Date(Date.now() - 10_000).toISOString(),
        ageMs: 10_000,
      }),
    );
    expect(await messages.next()).toMatchObject({ type: 'error', code: 'STALE_FRAME' });
    socket.terminate();
  });

  it('reports TTS failures and repeats the last successful response', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    let failTts = false;
    const reply = {
      speak: 'Previous response.',
      createdAt: new Date().toISOString(),
      suggestedAction: 'none',
      groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
    };
    await deviceStreamRoutes(
      app,
      { handleUserRequest: async (request: any) => ({ ...reply, trace: request.trace }) } as any,
      { transcribe: async () => ({ transcript: 'Hello' }) } as any,
      {
        speak: async () => {
          if (failTts) throw new Error('TTS unavailable');
          return { audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' };
        },
      } as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    socket.send(
      JSON.stringify({
        type: 'hello',
        trace: { requestId: 'connection-repeat', sessionId: 'session-1' },
      }),
    );
    await messages.next();
    socket.send(
      JSON.stringify({
        type: 'utterance',
        trace: { requestId: 'request-good', sessionId: 'session-1' },
        text: 'Hello',
      }),
    );
    expect((await messages.next()).type).toBe('meta');
    expect((await messages.next()).type).toBe('audio');
    socket.send(JSON.stringify({ type: 'repeat' }));
    expect(await messages.next()).toMatchObject({
      type: 'meta',
      reply: { speak: 'Previous response.' },
    });
    expect((await messages.next()).type).toBe('audio');

    failTts = true;
    socket.send(
      JSON.stringify({
        type: 'utterance',
        trace: { requestId: 'request-tts-fail', sessionId: 'session-1' },
        text: 'Again',
      }),
    );
    expect((await messages.next()).type).toBe('meta');
    expect(await messages.next()).toMatchObject({
      type: 'error',
      code: 'PROCESS_FAIL',
      message: 'TTS unavailable',
    });
    expect(traces.records.get('request-tts-fail')?.error).toBe('TTS unavailable');
    socket.terminate();
  });

  it('stops an old request and never lets its reply complete', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    await deviceStreamRoutes(
      app,
      {
        handleUserRequest: async (request: any) => {
          await wait;
          return {
            trace: request.trace,
            speak: 'Too late.',
            createdAt: new Date().toISOString(),
            suggestedAction: 'none',
            groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
          };
        },
      } as any,
      { transcribe: async () => ({ transcript: 'Hello' }) } as any,
      { speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }) } as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    socket.send(
      JSON.stringify({
        type: 'hello',
        trace: { requestId: 'connection-stop', sessionId: 'session-1' },
      }),
    );
    await messages.next();
    socket.send(
      JSON.stringify({
        type: 'utterance',
        trace: { requestId: 'request-stop', sessionId: 'session-1' },
        text: 'Wait',
      }),
    );
    socket.send(JSON.stringify({ type: 'stop' }));
    expect((await messages.next()).type).toBe('stopped');
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(traces.records.get('request-stop')?.error).toBe('Stopped by client');
    socket.terminate();
  });

  it('rejects camera frames the server did not request', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    const images: Array<number | undefined> = [];
    await deviceStreamRoutes(
      app,
      {
        handleUserRequest: async (request: any, image?: Buffer) => {
          images.push(image?.length);
          return {
            trace: request.trace,
            speak: 'Done.',
            createdAt: new Date().toISOString(),
            suggestedAction: 'none',
            groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 },
          };
        },
      } as any,
      { transcribe: async () => ({ transcript: 'Hello' }) } as any,
      { speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }) } as any,
      traces,
    );
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);
    const connection = { requestId: 'connection-frame', sessionId: 'session-1' };
    const turn = { requestId: 'request-frame', sessionId: 'session-1' };
    socket.send(JSON.stringify({ type: 'hello', trace: connection }));
    await messages.next();
    socket.send(
      JSON.stringify({
        type: 'frame',
        trace: turn,
        frameId: 'frame-request-7',
        seq: 7,
        mime: 'image/jpeg',
        bytesBase64: 'a'.repeat(20),
        capturedAt: new Date().toISOString(),
        ageMs: 0,
      }),
    );
    expect(await messages.next()).toMatchObject({
      type: 'error',
      code: 'UNEXPECTED_FRAME',
      trace: turn,
    });
    expect(images).toEqual([]);
    socket.terminate();
  });
});

function contextSnapshot(sessionId: string) {
  const now = Date.now();
  const provenance = (source = 'android_system') => ({
    source,
    collectedAt: new Date(now).toISOString(),
  });
  const known = (value: unknown, source?: string) => ({
    status: 'known',
    value,
    observedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20_000).toISOString(),
    provenance: provenance(source),
  });
  const unknown = () => ({
    status: 'unknown',
    reason: 'not_collected',
    provenance: provenance('android_app'),
  });
  return {
    schemaVersion: '1',
    snapshotId: 'snapshot-context-001',
    sessionId,
    capturedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 20_000).toISOString(),
    time: known({ timezone: 'Europe/London', utcOffsetMinutes: 60 }),
    permissions: {
      microphone: known('granted'),
      camera: known('granted'),
      location: known('granted'),
      activity: unknown(),
    },
    device: {
      connectivity: known('online'),
      screen: known('locked'),
      headphones: known(true),
      batteryPercent: known(80),
      cameraAvailable: known(true),
    },
    app: known({ state: 'listening', sessionOpen: true }, 'android_app'),
    location: known({ latitude: 51.5, longitude: -0.1, accuracyMeters: 12 }, 'android_sensor'),
    movement: known({ state: 'stationary', confidence: 0.8 }, 'android_sensor'),
    evidence: unknown(),
  };
}
