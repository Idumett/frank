# Demo deployment

Frank runs as **staging** on one Compute Engine VM behind Caddy at `35.242.143.73.sslip.io`. SQLite and the TTS cache live in `/var/lib/frank`. Gemini and the hashed product/diagnostics token registry come from Secret Manager through the VM's service account. This remains staging until the Android identity model, production domain, privacy policy and Play production review are complete.

## Update and rollback

The VM deployment follows the `main` branch using a read-only GitHub deploy key. An update builds the fetched commit, starts it as a candidate, checks its local health, swaps it into service, then checks public HTTPS. The previous container remains available for one-step rollback.

```sh
sudo frank-update
sudo frank-rollback
sudo frank-refresh-secrets
```

## Backups and health

`frank-backup.timer` makes a consistent SQLite backup every day and retains local backups for 14 days. A Compute Engine snapshot schedule protects the complete persistent disk separately. `frank-health.timer` checks public HTTPS every two minutes and restarts the application and proxy if the check fails.

```sh
systemctl list-timers 'frank-*'
sudo frank-backup
sudo frank-restore latest --verify-only
ls -lh /var/backups/frank
```

Backups are integrity checked, kept locally for 14 days and copied to the private
Cloud Storage bucket in `BACKUP_BUCKET`. `frank-restore` verifies into a temporary
database by default. An intentional replacement requires `--replace` and takes a
pre-restore copy first.

## Lifetime and operating model

The VM has no application expiry. Extending the demo means keeping billing enabled,
the reserved address, Secret Manager entries, backup bucket and monitoring policy.
No architecture migration is required. Review the monthly budget and API quotas
before inviting more testers.

## Android demo build

Supply the URL and token as Gradle properties. Never commit the token.

```sh
./gradlew assembleDebug \
  -PfrankServerUrl=https://35.242.143.73.sslip.io/ \
  -PfrankAccessToken=TOKEN
```

For local Android Studio use, an ignored `local.properties` can provide the same values when the local checkout's Gradle configuration reads them.
