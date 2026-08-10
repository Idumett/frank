#!/bin/bash
set -euo pipefail
exec 9>/run/lock/frank-deploy.lock
flock -n 9 || exit 0
install -d -m 700 /var/backups/frank
stamp=$(date -u +%Y%m%dT%H%M%SZ)
target=/var/backups/frank/frank-$stamp.db
if [[ -f /var/lib/frank/frank.db ]]; then
  sqlite3 /var/lib/frank/frank.db ".timeout 10000" ".backup '$target'"
  gzip "$target"
fi
find /var/backups/frank -type f -name 'frank-*.db.gz' -mtime +14 -delete
