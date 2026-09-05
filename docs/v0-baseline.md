# v0 notes

Frank works on the local Windows server with `gemini-3.5-flash`. Both projects build, and the missing Zod dependency is fixed. These notes mark where things stand before starting v1.

The starting points are:

- Server: `28cc1e2` — Fix contracts zod dependency
- Android: `283332f` — Add image rep to readme

## Build checks

The server passed `pnpm build` and `pnpm typecheck` from a fresh copy, without the old Zod workaround. The install used the frozen lockfile and cached packages. Install scripts were skipped initially, then the SQLite binary was installed for Node 24. The only dependency change was adding the existing Zod version to the contracts package.

The server also started with a fresh database. `/health` returned `{"ok":true}` and diagnostics returned an empty trace list. This check used placeholder credentials, so it didn't call Gemini, speech or vision services.

Android's `assembleDebug` passed in 1m39s and produced a debug APK. The build uses JDK 21, Gradle 9.3.1 and compile SDK 36.1. The app supports Android API 28 and above and targets API 36.

To repeat the server build, use Node 24.12.0 and pnpm 10.26.2:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
```

Make sure better-sqlite3 has its native binary installed for the Node version in use. Switching Node versions can require reinstalling it.

For Android, use JDK 21 and run:

```sh
sh gradlew --no-daemon --console=plain assembleDebug
```

The APK is in `app/build/outputs/apk/debug/`. The READMEs cover server setup and activating Frank as the phone's assistant. The app still points to a local network address, which needs changing before testing against another server.

## Still to check on a device

The emulator couldn't start in the test environment, so there isn't a launch screenshot yet. The local setup is reported working, but these checks still need a separate device run:

- Launch, permissions and the assistant screen.
- A spoken question through to an audible answer.
- Scene descriptions, reading text and follow-up questions.
- Stop, repeat and memory behavior.
- Losing the connection, reconnecting and recovering from a failed request.

There is no v0 release tag yet. Builds and startup are checked; the full device run is still outstanding.

## Issues to carry into v1

The code checks used fake providers and a temporary database. All 12 checks reproduced the expected behavior, including several known problems. That doesn't mean all 12 features work correctly.

- Saving a conversation can use `reply` before it has been initialized.
- Deleting memory fails because the SQLite transaction callback returns a Promise.
- Stopping a request and starting another can let the old request interfere with the new one.
- A turn can reuse an old camera frame or report the wrong frame number.
- Empty speech transcripts still reach the core. Spoken and displayed fallback replies also need checking.
- Turns share a request ID across the connection, making individual requests harder to trace.
- The data layer still needs validation and separation between users before the online demo.

These came up in code checks; they aren't reports of failures on the local PC. Only the Zod build issue has been fixed so far.

## Current timings

The local trace sample has 62 LLM calls: average 5,377 ms, median 3,897 ms, p95 14,448 ms and maximum 41,502 ms. Four LLM stages failed. Labels averaged 920 ms and OCR 844 ms across 60 calls each.

This doesn't yet tell us how long a user waits to hear a reply. Recording, silence detection, speech recognition, TTS, transfer and playback still need timing. The failed stages also need checking before treating them as failed conversations.

## Next

Start with tracing the whole conversation and fixing request handling and recovery. Then get a protected demo online, measure the LLM delays, improve camera selection and build the local data adapter. Chivora can connect later once the types and expected behavior are ready.

Context Snapshot comes after that, followed by the remaining device and accessibility checks. Offline support comes last.

The built APK's SHA-256 is `331cccc7728bc1f7175a521787f5e4f0107b8b2922989a20d9f1425f5a47f62e`.
