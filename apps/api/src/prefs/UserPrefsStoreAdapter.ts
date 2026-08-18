import type { IUserPrefsStore as CoreUserPrefsStore, TtsPrefs } from '@frank/core';
import type { UserPrefsStore as ApiUserPrefsStore } from './UserPrefsStore.js';

export class UserPrefsStoreAdapter implements CoreUserPrefsStore {
  constructor(private inner: ApiUserPrefsStore, private userId = 'legacy') {}

  async get(sessionId: string) {
    const res = await this.inner.get(this.userId, sessionId);
    return res ? { tts: res.tts } : null;
  }

  async set(sessionId: string, tts: TtsPrefs) {
    await this.inner.set(this.userId, sessionId, tts);
  }
}
