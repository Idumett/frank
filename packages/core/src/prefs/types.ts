export type TtsPrefs = {
  languageCode?: string;
  voiceName?: string;
  speakingRate?: number;
  pitch?: number;
};

export type UserPrefs = {
  sessionId: string;
  tts?: TtsPrefs;
  updatedAt: string;
};

export interface IUserPrefsStore {
  get(sessionId: string): Promise<{ tts?: TtsPrefs } | null>;
  set(sessionId: string, tts: TtsPrefs): Promise<void>;
}
