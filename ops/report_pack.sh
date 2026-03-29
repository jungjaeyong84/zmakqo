#!/usr/bin/env sh
set -eu
BASE_URL="${BASE_URL:-https://donbeolja-350958953672.asia-northeast3.run.app}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/Projects/donbeolja/.scheduler_token}"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "TOKEN_FILE not found: $TOKEN_FILE" >&2
  exit 1
fi

SCHED_TOKEN="$(cat "$TOKEN_FILE")"
NOW_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
FROM_UTC="$(date -u -v-1d +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u -d "1 day ago" +"%Y-%m-%dT%H:%M:%SZ")"

OUT_ZIP="/tmp/donbeolja_report_pack.zip"
OUT_JSON="/tmp/donbeolja_report.json"

echo "[1/3] preview-token"
curl -sS "$BASE_URL/api/report/preview-token?from=$FROM_UTC&to=$NOW_UTC" \
  -H "x-scheduler-token: $SCHED_TOKEN" | python3 -m json.tool

echo "[2/3] pack -> $OUT_ZIP"
curl -sS -L "$BASE_URL/api/report/pack?from=$FROM_UTC&to=$NOW_UTC&mode=daily" \
  -H "x-scheduler-token: $SCHED_TOKEN" \
  -o "$OUT_ZIP"

echo "[3/3] extract report.json -> $OUT_JSON"
unzip -p "$OUT_ZIP" report.json > "$OUT_JSON"

ls -al "$OUT_ZIP" "$OUT_JSON"
