import type { DeviceTrace } from './v1.js';

export type ClientMsg =
  | {
      type: 'hello';
      protocol: 1;
      trace: DeviceTrace;
      device?: {
        model?: string;
        firmware?: string;
        capabilities?: {
          camera?: boolean;
          audioOut?: boolean;
          mic?: boolean;
        };
      };
    }
  | {
      type: 'intent';
      intent: 'read_text' | 'describe_scene' | 'remember_this' | 'recall' | 'help';
      query?: string;
    }
  | {
      type: 'utterance';
      text: string;
    }
  | {
      type: 'frame';
      seq: number;
      mime: 'image/jpeg' | 'image/png' | 'image/webp';
      bytesBase64: string;
    }
  | { type: 'stop' }
  | { type: 'repeat' }
  | { type: 'ping'; t: number };

export type ServerMsg =
  | {
      type: 'ready';
      protocol: 1;
      trace: DeviceTrace;
    }
  | {
      type: 'ack';
      seq: number;
    }
  | {
      type: 'meta';
      trace: DeviceTrace;
      reply: {
        speak: string;
        suggestedAction?: 'recapture' | 'none';
        confidence?: 'low' | 'medium' | 'high';
      };
      timings?: {
        totalMs?: number;
        frameSeq?: number;
      };
      costUnits?: number;
    }
  | {
      type: 'audio';
      mime: 'audio/mpeg';
      bytesBase64: string;
    }
  | { type: 'stopped' }
  | { type: 'error'; message: string; code?: string }
  | { type: 'pong'; t: number };
