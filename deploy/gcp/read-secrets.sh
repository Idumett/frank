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
auth_value=$(secret_value frank-auth-config)
install -d -m 700 /etc/frank /etc/frank/secrets
umask 077
auth_tmp=$(mktemp /etc/frank/secrets/auth.json.XXXXXX)
printf '%s' "$auth_value" > "$auth_tmp"
jq -e '.users | length > 0' "$auth_tmp" >/dev/null
chmod 600 "$auth_tmp"
mv -f "$auth_tmp" /etc/frank/secrets/auth.json
cat > /etc/frank/runtime.env <<ENV
GEMINI_API_KEY=$gemini_value
GEMINI_MODEL=gemini-3.5-flash
GOOGLE_CLOUD_PROJECT=$PROJECT_ID
FRANK_AUTH_FILE=/run/secrets/auth.json
LEGACY_USER_ID=dan
OBSERVABILITY_ENABLED=true
LOG_LEVEL=info
TRACE_RETENTION_DAYS=14
CONVERSATION_RETENTION_DAYS=1
TTS_CACHE_RETENTION_DAYS=7
SESSION_RETENTION_DAYS=30
FRANK_TIME_ZONE=Europe/London
GEMINI_MAX_OUTPUT_TOKENS=180
GEMINI_TEMPERATURE=0.2
GEMINI_THINKING_LEVEL=minimal
GEMINI_INPUT_USD_PER_MILLION=0
GEMINI_OUTPUT_USD_PER_MILLION=0
LLM_MEMORY_HIT_LIMIT=4
LLM_MEMORY_ITEM_CHAR_LIMIT=400
LLM_CONVERSATION_TURN_LIMIT=6
LLM_CONVERSATION_CHAR_LIMIT=2400
FRAME_MAX_AGE_MS=4000
FRAME_WAIT_MS=3000
FRAME_CLOCK_SKEW_MS=10000
ENV
unset gemini_value auth_value
