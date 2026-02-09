import { TtsPrefs, UserPrefs } from '@frank/core';

export class UserPrefsStore {
  constructor(private db: { prepare: (sql: string) => any }) {}

  set(sessionId: string, tts: TtsPrefs): UserPrefs {
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO user_prefs (
          session_id, tts_language_code, tts_voice_name, tts_speaking_rate, tts_pitch, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          tts_language_code = excluded.tts_language_code,
          tts_voice_name = excluded.tts_voice_name,
          tts_speaking_rate = excluded.tts_speaking_rate,
          tts_pitch = excluded.tts_pitch,
          updated_at = excluded.updated_at
      `,
      )
      .run(
        sessionId,
        tts.languageCode ?? null,
        tts.voiceName ?? null,
        tts.speakingRate ?? null,
        tts.pitch ?? null,
        updatedAt,
      );

    return { sessionId, tts, updatedAt };
  }

  get(sessionId: string): UserPrefs | null {
    const row = this.db
      .prepare(
        `
        SELECT session_id, tts_language_code, tts_voice_name, tts_speaking_rate, tts_pitch, updated_at
        FROM user_prefs
        WHERE session_id = ?
      `,
      )
      .get(sessionId);

    if (!row) return null;

    return {
      sessionId: row.session_id,
      tts: {
        languageCode: row.tts_language_code ?? undefined,
        voiceName: row.tts_voice_name ?? undefined,
        speakingRate: row.tts_speaking_rate ?? undefined,
        pitch: row.tts_pitch ?? undefined,
      },
      updatedAt: row.updated_at,
    };
  }
}
