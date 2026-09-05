#!/bin/bash
set -euo pipefail
. /etc/frank/deployment.env
exec 9>/run/lock/frank-deploy.lock
flock -n 9 || exit 0
install -d -m 700 /var/backups/frank
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target=/var/backups/frank/frank-$stamp.db
if [[ -f /var/lib/frank/frank.db ]]; then
  sqlite3 /var/lib/frank/frank.db ".timeout 10000" ".backup '$target'"
  [[ "$(sqlite3 "$target" 'PRAGMA integrity_check;')" == "ok" ]]
  gzip "$target"
  if [[ -n "${BACKUP_BUCKET:-}" ]]; then
    token=$(curl -fsS -H 'Metadata-Flavor: Google' \
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' | jq -r .access_token)
    object=$(basename "$target.gz")
    curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/gzip' \
      --data-binary "@$target.gz" \
      "https://storage.googleapis.com/upload/storage/v1/b/$BACKUP_BUCKET/o?uploadType=media&name=$object" >/dev/null
  fi
fi
find /var/backups/frank -type f -name 'frank-*.db.gz' -mtime +14 -delete
