#!/bin/bash
set -euo pipefail
exec 9>/run/lock/frank-deploy.lock
flock -n 9 || exit 0
. /etc/frank/deployment.env
if ! curl -fsS --max-time 15 "https://$DOMAIN/health" >/dev/null; then
  docker restart frank caddy >/dev/null
  sleep 5
  curl -fsS --max-time 15 --retry 5 --retry-delay 2 --retry-connrefused "https://$DOMAIN/health" >/dev/null
fi
