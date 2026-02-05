import type { Trace } from '@frank/contracts';

export interface SttProvider {
  /**
   * Simple non-streaming transcription for V1.
   * (Streaming can be added later without changing this interface.)
   */
  transcribe(args: {
    trace: Trace;
    audioBytes: Buffer;
    mimeType?: string; // e.g. "audio/wav"
    languageCode?: string; // e.g. "en-GB"
    sampleRateHertz?: number;
  }): Promise<{ transcript: string; confidence?: number }>;
}
