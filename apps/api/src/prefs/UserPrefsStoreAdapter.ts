import type { IUserPrefsStore as CoreUserPrefsStore, TtsPrefs } from '@frank/core';
type ApiUserPrefsStore = {
  getPreferences(userId: string, sessionId: string): { tts?: TtsPrefs } | null;
  setPreferences(userId: string, sessionId: string, tts: TtsPrefs): unknown;
};

export class UserPrefsStoreAdapter implements CoreUserPrefsStore {
  constructor(private inner: ApiUserPrefsStore, private userId = 'legacy') {}

  async get(sessionId: string) {
    const res = await this.inner.getPreferences(this.userId, sessionId);
    return res ? { tts: res.tts } : null;
  }

  async set(sessionId: string, tts: TtsPrefs) {
    await this.inner.setPreferences(this.userId, sessionId, tts);
  }
}
