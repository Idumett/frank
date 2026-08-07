# Demo deployment

The demo runs Frank behind Caddy on one Compute Engine VM. SQLite and the TTS cache live in `/var/lib/frank`, and Caddy handles HTTPS. Production startup requires `DEMO_ACCESS_TOKEN`; the Gemini key and demo token are read from Secret Manager on the VM.

Build the Android app with the server URL and token supplied as Gradle properties:

```sh
./gradlew assembleDebug -PfrankServerUrl=https://SERVER_NAME/ -PfrankDemoToken=TOKEN
```

Do not put either value in `gradle.properties` or commit them.
