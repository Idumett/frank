#!/bin/bash
set -euo pipefail
exec 9>/run/lock/frank-deploy.lock
flock -x 9
if ! docker inspect frank-previous >/dev/null 2>&1; then
  echo 'No previous container is available' >&2
  exit 1
fi
docker rm -f frank-failed >/dev/null 2>&1 || true
docker stop frank >/dev/null
docker rename frank frank-failed
docker rename frank-previous frank
docker update --restart unless-stopped frank >/dev/null
docker start frank >/dev/null
docker restart caddy >/dev/null
curl -fsS --retry 10 --retry-delay 2 --retry-connrefused "https://$(. /etc/frank/deployment.env; echo "$DOMAIN")/health"
