import type { DeviceTrace } from './v1.js';
import type { ContextSnapshotV1 } from '@frank/contracts';

export type ClientMsg =
  | { type: 'hello'; trace: DeviceTrace; device?: { model?: string; fw?: string } }
  | {
      type: 'intent';
      intent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help';
      query?: string;
    }
  | { type: 'utterance'; trace?: DeviceTrace; text: string; sentAt?: string }
  | {
      type: 'audio';
      trace?: DeviceTrace;
      mime: 'audio/wav' | 'audio/webm' | 'audio/mpeg';
      audioBase64: string;
      sentAt?: string;
    }
  | {
      type: 'frame';
      trace: DeviceTrace;
      frameRequestId: string;
      frameId: string;
      seq: number;
      mime: 'image/jpeg' | 'image/png' | 'image/webp';
      bytesBase64: string;
      capturedAt: string;
      ageMs: number;
      quality?: 'unknown' | 'good' | 'poor';
    }
  | { type: 'stop' }
  | { type: 'context_snapshot'; snapshot: ContextSnapshotV1 }
  | { type: 'repeat' }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'connected'; trace: DeviceTrace }
  | { type: 'ready'; trace: DeviceTrace }
  | { type: 'context_ack'; snapshotId: string; acceptedAt: string }
  | {
      type: 'frame_required';
      trace: DeviceTrace;
      maxAgeMs: number;
      reason: 'read_text' | 'describe_scene' | 'remember_this';
      frameRequestId: string;
    }
  | { type: 'ack'; seq: number; trace?: DeviceTrace; processed?: boolean }
  | { type: 'transcript'; trace: DeviceTrace; transcript: string; confidence?: number }
  | {
      type: 'meta';
      trace: DeviceTrace;
      reply: {
        speak: string;
        suggestedAction?: 'recapture' | 'none';
        confidence?: 'low' | 'medium' | 'high';
      };
      timings?: { totalMs?: number; frameSeq?: number };
      costUnits?: number;
      evidence?: {
        frameId: string;
        capturedAt: string;
        ageMs: number;
        quality: 'good' | 'ok' | 'poor';
      };
    }
  | { type: 'audio'; trace?: DeviceTrace; mime: 'audio/mpeg'; bytesBase64: string }
  | { type: 'stopped'; trace?: DeviceTrace | null }
  | { type: 'error'; trace?: DeviceTrace; message: string; code?: string }
  | { type: 'pong'; t: number };
