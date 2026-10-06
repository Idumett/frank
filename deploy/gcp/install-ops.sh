#!/bin/bash
set -euo pipefail
repo=${1:-/opt/frank/repo}
install -d -m 700 /etc/frank /var/lib/frank /var/backups/frank
install -m 600 "$repo/deploy/gcp/frank-demo.env" /etc/frank/deployment.env
install -m 700 "$repo/deploy/gcp/read-secrets.sh" /etc/frank/read-secrets.sh
ln -sfn /etc/frank/read-secrets.sh /usr/local/sbin/frank-refresh-secrets
install -m 700 "$repo/deploy/gcp/update.sh" /usr/local/sbin/frank-update
install -m 700 "$repo/deploy/gcp/rollback.sh" /usr/local/sbin/frank-rollback
install -m 700 "$repo/deploy/gcp/backup.sh" /usr/local/sbin/frank-backup
install -m 700 "$repo/deploy/gcp/restore.sh" /usr/local/sbin/frank-restore
install -m 700 "$repo/deploy/gcp/healthcheck.sh" /usr/local/sbin/frank-healthcheck
cat > /etc/systemd/system/frank-backup.service <<UNIT
[Unit]
Description=Back up Frank SQLite database
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/frank-backup
UNIT
cat > /etc/systemd/system/frank-backup.timer <<UNIT
[Unit]
Description=Daily Frank database backup
[Timer]
OnCalendar=*-*-* 03:20:00 UTC
Persistent=true
RandomizedDelaySec=10m
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/frank-health.service <<UNIT
[Unit]
Description=Check Frank demo health
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/frank-healthcheck
UNIT
cat > /etc/systemd/system/frank-health.timer <<UNIT
[Unit]
Description=Check Frank demo every two minutes
[Timer]
OnBootSec=2m
OnUnitActiveSec=2m
[Install]
WantedBy=timers.target
UNIT
cat > /etc/systemd/system/frank-deploy.service <<UNIT
[Unit]
Description=Deploy a new Frank main revision
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/frank-update
UNIT
cat > /etc/systemd/system/frank-deploy.timer <<UNIT
[Unit]
Description=Check Frank main for a new revision
[Timer]
OnBootSec=1m
OnUnitActiveSec=2m
RandomizedDelaySec=15s
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now frank-backup.timer frank-health.timer frank-deploy.timer
. /etc/frank/deployment.env
docker network inspect frank-demo >/dev/null 2>&1 || docker network create frank-demo >/dev/null
docker volume inspect frank-caddy-data >/dev/null 2>&1 || docker volume create frank-caddy-data >/dev/null
docker volume inspect frank-caddy-config >/dev/null 2>&1 || docker volume create frank-caddy-config >/dev/null
cat > /etc/frank/Caddyfile <<CADDY
$DOMAIN {
  encode zstd gzip
  reverse_proxy frank:3000
}
CADDY
if ! docker inspect caddy >/dev/null 2>&1; then
  docker run -d --name caddy --restart unless-stopped --network frank-demo \
    -p 80:80 -p 443:443 -v /etc/frank/Caddyfile:/etc/caddy/Caddyfile:ro \
    -v frank-caddy-data:/data -v frank-caddy-config:/config caddy:2-alpine >/dev/null
fi
