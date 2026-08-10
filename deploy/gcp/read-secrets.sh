#!/bin/bash
set -euo pipefail
[[ -f /etc/frank/deployment.env ]] && . /etc/frank/deployment.env
PROJECT_ID=${PROJECT_ID:?PROJECT_ID is required}
metadata_token() {
  curl -fsS -H 'Metadata-Flavor: Google' \
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' |
    jq -r .access_token
}
secret_value() {
  local name=$1 token
  token=$(metadata_token)
  curl -fsS -H "Authorization: Bearer $token" \
    "https://secretmanager.googleapis.com/v1/projects/$PROJECT_ID/secrets/$name/versions/latest:access" |
    jq -r .payload.data | base64 -d
}
gemini_value=$(secret_value frank-gemini-api-key)
demo_value=$(secret_value frank-demo-access-token)
install -d -m 700 /etc/frank
umask 077
cat > /etc/frank/runtime.env <<ENV
GEMINI_API_KEY=$gemini_value
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
DEMO_ACCESS_TOKEN=$demo_value
LOG_LEVEL=info
ENV
unset gemini_value demo_value
