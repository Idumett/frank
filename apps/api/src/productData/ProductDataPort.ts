import type { ProductDataRequestV1, ProductDataResponseV1 } from '@frank/contracts';
import type { ConversationStore, MemoryStore, TtsPrefs, UserPrefs } from '@frank/core';

export interface ProductDataPort extends MemoryStore, ConversationStore {
  execute(authenticatedOwnerId: string, request: ProductDataRequestV1): ProductDataResponseV1;
  claimSession(userId: string, sessionId?: string): void;
  setPreferences(userId: string, sessionId: string, tts: TtsPrefs): UserPrefs;
  getPreferences(userId: string, sessionId: string): UserPrefs | null;
}
