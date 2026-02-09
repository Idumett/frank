import type { Trace } from '@frank/contracts';
import type { IUserPrefsStore } from './types.js';

export async function resolveTtsPrefs(args: {
  trace: Trace;
  prefs: IUserPrefsStore;
  defaults: { languageCode: string; voiceName?: string };
}) {
  const sessionId = args.trace.sessionId;
  const stored = sessionId ? await args.prefs.get(sessionId) : null;

  return {
    languageCode:
      args.trace.tts?.languageCode ?? stored?.tts?.languageCode ?? args.defaults.languageCode,
    voiceName: args.trace.tts?.voiceName ?? stored?.tts?.voiceName ?? args.defaults.voiceName,
    speakingRate: args.trace.tts?.speakingRate ?? stored?.tts?.speakingRate,
    pitch: args.trace.tts?.pitch ?? stored?.tts?.pitch,
  };
}
