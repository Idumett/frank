#!/bin/bash
set -euo pipefail
. /etc/frank/deployment.env
repo=/opt/frank/repo
if [[ ! -d "$repo/.git" ]]; then
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$repo"
fi
git -C "$repo" fetch --prune origin "$BRANCH"
git -C "$repo" checkout -q "$BRANCH"
git -C "$repo" reset --hard "origin/$BRANCH"
revision=$(git -C "$repo" rev-parse --short=12 HEAD)
/etc/frank/read-secrets.sh
docker build -t "frank-demo:$revision" -f "$repo/deploy/Dockerfile" "$repo"
docker network inspect frank-demo >/dev/null 2>&1 || docker network create frank-demo >/dev/null
docker rm -f frank-candidate >/dev/null 2>&1 || true
docker run -d --name frank-candidate --restart=no --network frank-demo \
  --env-file /etc/frank/runtime.env -v /var/lib/frank:/data "frank-demo:$revision" >/dev/null
for _ in $(seq 1 30); do
  if docker exec frank-candidate node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})"; then
    break
  fi
  sleep 1
done
docker exec frank-candidate node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})"
docker rm -f frank-previous >/dev/null 2>&1 || true
if docker inspect frank >/dev/null 2>&1; then
  docker stop frank >/dev/null
  docker rename frank frank-previous
fi
docker rename frank-candidate frank
docker update --restart unless-stopped frank >/dev/null
docker start frank >/dev/null
docker restart caddy >/dev/null 2>&1 || true
if ! curl -fsS --retry 10 --retry-delay 2 "https://$DOMAIN/health" >/dev/null; then
  docker rm -f frank >/dev/null 2>&1 || true
  if docker inspect frank-previous >/dev/null 2>&1; then
    docker rename frank-previous frank
    docker start frank >/dev/null
    docker restart caddy >/dev/null 2>&1 || true
  fi
  exit 1
fi
printf '%s\n' "$revision" > /var/lib/frank/deployed-revision
printf 'Deployed %s\n' "$revision"
