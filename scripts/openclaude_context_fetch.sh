#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

BASE_URL="${BASE_URL:-https://donbeolja-350958953672.asia-northeast3.run.app}"
EXCHANGE="${EXCHANGE:-BINANCEFUT}"
DAYS="${DAYS:-7}"
LEVEL="${LEVEL:-STANDARD}"
FORMAT="${1:-json}" # json | digest | prompt

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [[ -z "${BASE_URL:-}" ]]; then
  BASE_URL="https://donbeolja-350958953672.asia-northeast3.run.app"
fi
if [[ "${FORCE_LOCAL_BASE:-0}" != "1" ]] && [[ "$BASE_URL" == *"localhost"* ]]; then
  BASE_URL="https://donbeolja-350958953672.asia-northeast3.run.app"
fi

TOKEN="${SCHEDULER_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: SCHEDULER_TOKEN is empty. Check $ENV_FILE" >&2
  exit 1
fi

curl -sS --get "$BASE_URL/scheduler/openclaude-context" \
  --data-urlencode "exchange=$EXCHANGE" \
  --data-urlencode "days=$DAYS" \
  --data-urlencode "level=$LEVEL" \
  --data-urlencode "format=$FORMAT" \
  --data-urlencode "token=$TOKEN"
