# Frank Voice Integration – Summary Notes

## Voice architecture (v1)

- Keep Frank as an API.
- Keep “assistant feel” (push-to-talk, stop, repeat) **client-side**.
- Flow:
  1. Client records audio
  2. POST /v1/stt → transcript
  3. POST /v1/analyze → AssistantReply
  4. POST /v1/tts → audio
  5. Client plays audio

## Stop / Interrupt

- Do NOT send “stop” to server.
- Client stops audio playback instantly.
- Optionally cancel in-flight requests client-side.

## Repeat

- Client replays last audio buffer.
- Server TTS caching makes re-requests cheap if needed.

## TTS

- Return audio as base64 JSON (simple) or raw audio (preferred later).
- Cache TTS by (text + voice + language).
- Same reply should never regenerate audio.

## STT

- Push-to-talk via POST /v1/stt.
- Start non-streaming; add streaming later if needed.
- Low STT confidence → ask user to repeat (no LLM call).

## Important audio note

- Google STT config MUST match audio encoding.
- Browsers often record WebM/Opus; mobile can do WAV/PCM.
- Decide client platform before final STT config.

## UX principle

- Server = brain (deterministic, boring).
- Client = UX (voice, playback, interruptions, state).

## Deterministic rules (v1)

- Empty transcript → ask to repeat.
- “Stop” → client stops audio.
- “Repeat” → client replays last audio.
- Bad input → no LLM call.
