import type { DeviceTrace } from './v1.js';

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
      frameId: string;
      seq: number;
      mime: 'image/jpeg' | 'image/png' | 'image/webp';
      bytesBase64: string;
      capturedAt: string;
      ageMs: number;
      quality?: 'unknown' | 'good' | 'poor';
    }
  | { type: 'stop' }
  | { type: 'repeat' }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | { type: 'connected'; trace: DeviceTrace }
  | { type: 'ready'; trace: DeviceTrace }
  | {
      type: 'frame_required';
      trace: DeviceTrace;
      maxAgeMs: number;
      reason: 'read_text' | 'describe_scene' | 'remember_this';
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
