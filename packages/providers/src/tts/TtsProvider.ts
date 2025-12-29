import type { Trace } from '@frank/contracts';

export interface TtsProvider {
  speak(args: {
    trace: Trace;
    text: string;
    languageCode?: string; // e.g. "en-GB"
    voiceName?: string; // optional specific voice
  }): Promise<{ audioBytes: Buffer; mimeType: string }>;
}
