import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { WebSocket } from 'ws';
import { deviceStreamRoutes } from '../src/routes/deviceStream.js';
import type { ObservabilityStore, RequestTraceRecord, TraceStage } from '@frank/core';

class TraceRecorder implements ObservabilityStore {
  records = new Map<string, RequestTraceRecord>();
  async start(record: RequestTraceRecord) { this.records.set(record.requestId, record); }
  async addStage(requestId: string, stage: TraceStage) { this.records.get(requestId)?.stages.push(stage); }
  async finish(requestId: string, output: unknown) { const record = this.records.get(requestId)!; record.endedAt = new Date().toISOString(); record.output = output; }
  async fail(requestId: string, error: string) { const record = this.records.get(requestId); if (record) { record.endedAt = new Date().toISOString(); record.error = error; } }
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
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

describe('V1 device stream', () => {
  it('requires hello and refuses a second request while one is running', async () => {
    const app = Fastify();
    apps.push(app);
    const traces = new TraceRecorder();
    let releaseStt!: () => void;
    const sttWait = new Promise<void>((resolve) => { releaseStt = resolve; });
    const frank = {
      handleUserRequest: async (request: any) => ({ trace: request.trace, speak: 'Hello.', createdAt: new Date().toISOString(), suggestedAction: 'none', groundedIn: { usedOcr: false, usedLabels: false, usedMemoryHits: 0 } }),
    };
    const stt = { transcribe: async () => { await sttWait; return { transcript: 'Hello Frank' }; } };
    const tts = { speak: async () => ({ audioBytes: Buffer.from('audio'), mimeType: 'audio/mpeg' }) };
    await deviceStreamRoutes(app, frank as any, stt as any, tts as any, traces);
    await app.ready();
    const socket = await app.injectWS('/v1/device/stream');
    const messages = new MessageQueue(socket);

    socket.send(JSON.stringify({ type: 'frame', seq: 1, mime: 'image/jpeg', bytesBase64: 'a'.repeat(20) }));
    expect(await messages.next()).toMatchObject({ type: 'error', code: 'NO_HELLO' });

    const connection = { requestId: 'connection-123', sessionId: 'session-1' };
    socket.send(JSON.stringify({ type: 'hello', trace: connection }));
    expect((await messages.next()).type).toBe('ready');

    socket.send(JSON.stringify({ type: 'audio', trace: { requestId: 'request-111', sessionId: 'session-1' }, mime: 'audio/wav', audioBase64: 'a'.repeat(20) }));
    socket.send(JSON.stringify({ type: 'audio', trace: { requestId: 'request-222', sessionId: 'session-1' }, mime: 'audio/wav', audioBase64: 'a'.repeat(20) }));
    expect(await messages.next()).toMatchObject({ type: 'error', code: 'BUSY', trace: { requestId: 'request-222' } });
    expect(traces.records.has('request-222')).toBe(false);

    releaseStt();
    const replies = [await messages.next(), await messages.next(), await messages.next()];
    expect(replies.map((message) => message.type)).toEqual(['transcript', 'meta', 'audio']);
    expect(traces.records.get('request-111')?.endedAt).toBeTruthy();
    socket.terminate();
  });
});
