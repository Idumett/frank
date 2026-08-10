# Demo deployment

Frank runs on one Compute Engine VM behind Caddy at `35.242.143.73.sslip.io`. SQLite and the TTS cache live in `/var/lib/frank`. Gemini and demo-access secrets come from Secret Manager through the VM's service account.

## Update and rollback

The VM deployment follows the `v1` branch using a read-only GitHub deploy key. An update builds the fetched commit, starts it as a candidate, checks its local health, swaps it into service, then checks public HTTPS. The previous container remains available for one-step rollback.

```sh
sudo frank-update
sudo frank-rollback
```

## Backups and health

`frank-backup.timer` makes a consistent SQLite backup every day and retains local backups for 14 days. A Compute Engine snapshot schedule protects the complete persistent disk separately. `frank-health.timer` checks public HTTPS every two minutes and restarts the application and proxy if the check fails.

```sh
systemctl list-timers 'frank-*'
sudo frank-backup
ls -lh /var/backups/frank
```

## Android demo build

Supply the URL and token as Gradle properties. Never commit the token.

```sh
./gradlew assembleDebug \
  -PfrankServerUrl=https://35.242.143.73.sslip.io/ \
  -PfrankDemoToken=TOKEN
```

For local Android Studio use, an ignored `local.properties` can provide the same values when the local checkout's Gradle configuration reads them.
