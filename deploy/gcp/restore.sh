#!/bin/bash
set -euo pipefail
. /etc/frank/deployment.env
source_file=${1:-latest}
mode=${2:---verify-only}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
if [[ "$source_file" == latest ]]; then
  source_file=$(find /var/backups/frank -type f -name 'frank-*.db.gz' -print | sort | tail -1)
fi
[[ -f "$source_file" ]] || { echo "Backup not found: $source_file" >&2; exit 1; }
gzip -cd "$source_file" > "$work/frank.db"
[[ "$(sqlite3 "$work/frank.db" 'PRAGMA integrity_check;')" == "ok" ]]
sqlite3 "$work/frank.db" 'SELECT count(*) FROM sqlite_master;' >/dev/null
if [[ "$mode" == --verify-only ]]; then
  echo "Restore verified: $source_file"
  exit 0
fi
[[ "$mode" == --replace ]] || { echo 'Use --verify-only or --replace' >&2; exit 2; }
exec 9>/run/lock/frank-deploy.lock
flock -x 9
docker stop frank >/dev/null
cp /var/lib/frank/frank.db "/var/backups/frank/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).db"
install -m 600 "$work/frank.db" /var/lib/frank/frank.db
docker start frank >/dev/null
sleep 3
curl -fsS --retry 5 --retry-delay 2 "https://$DOMAIN/health" >/dev/null
echo "Restored: $source_file"
