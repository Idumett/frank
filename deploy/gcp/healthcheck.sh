#!/bin/bash
set -euo pipefail
. /etc/frank/deployment.env
if ! curl -fsS --max-time 15 "https://$DOMAIN/health" >/dev/null; then
  docker restart frank caddy >/dev/null
  sleep 5
  curl -fsS --max-time 15 "https://$DOMAIN/health" >/dev/null
fi
