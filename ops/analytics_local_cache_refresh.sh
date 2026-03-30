#!/bin/zsh
set -euo pipefail

ROOT="/Users/jeongjaeyong/Projects/donbeolja"
RUNTIME_ENV="${RUNTIME_ENV:-${ROOT}/ops/.env.runtime.local}"

if [ -f "${RUNTIME_ENV}" ]; then
  set -a
  source "${RUNTIME_ENV}"
  set +a
fi

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TOKEN="${SCHEDULER_TOKEN:-}"
FORCE="${FORCE:-0}"

if [ -z "${TOKEN}" ]; then
  echo "SCHEDULER_TOKEN missing" >&2
  exit 1
fi

BODY='{}'
if [ "${FORCE}" = "1" ]; then
  BODY='{"force":true}'
fi

curl -sS -X POST "${BASE_URL}/scheduler/analytics-local-cache-refresh" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${TOKEN}" \
  -d "${BODY}"
