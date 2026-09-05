# V1 test set

Run this before and after any large change:

```bash
pnpm build
pnpm test:v1
```

For a result file that can be compared between runs:

```bash
pnpm test:v1:report
mv .v1-test-results.json before.json
# make the change
pnpm test:v1:report
mv .v1-test-results.json after.json
```

The set covers requests without a camera, scene and text handling, conversation follow-ups, memory and recall, empty speech, poor images, provider failures, deadlines, overlapping requests, stop, repeat, one-use camera frames, diagnostics, and SQLite writes and deletion.

Android recovery is checked with:

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

A physical-device pass should still cover permission denial, background and foreground recovery, disabling the network during a request, stopping playback, and voice-only use after a camera failure.
