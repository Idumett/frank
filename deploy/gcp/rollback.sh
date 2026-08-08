#!/bin/bash
set -euo pipefail
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
curl -fsS --retry 10 --retry-delay 2 "https://$(. /etc/frank/deployment.env; echo "$DOMAIN")/health"
