#!/usr/bin/env bash
set -euo pipefail

# Weekly cycle runner for the "12주 테스트" loop.
#
# Inputs (env):
#   BASE_URL        default: http://localhost:3000
#   SCHEDULER_TOKEN required
#
# Inputs (env or args):
#   WEEK    optional (e.g., 2026W01). If omitted, server computes ISO week from TO.
#   FROM    required ISO timestamp (e.g., 2026-01-01T00:00:00.000Z)
#   TO      required ISO timestamp (e.g., 2026-01-08T00:00:00.000Z)
#   MARKETS optional comma-separated (e.g., KRW-BTC,KRW-ETH)
#   EXCHANGE optional (default: UPBIT)
#   TF      optional (default: 60m)
#
# Output:
#   - Prints JSON from each step
#   - Downloads report pack zip to ./report_pack_<week>.zip

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCHEDULER_TOKEN="${SCHEDULER_TOKEN:?SCHEDULER_TOKEN is required}"

WEEK="${WEEK:-}"
FROM="${FROM:-}"
TO="${TO:-}"
MARKETS="${MARKETS:-}"
EXCHANGE="${EXCHANGE:-UPBIT}"
TF="${TF:-60m}"

if [[ -z "$FROM" || -z "$TO" ]]; then
  echo "FROM and TO are required (ISO timestamps)." >&2
  exit 1
fi

# Build JSON payload (minimal dependencies; avoid jq).
json_payload="{"
if [[ -n "$WEEK" ]]; then
  json_payload+="\"week\":\"${WEEK}\","
fi
json_payload+="\"from\":\"${FROM}\",\"to\":\"${TO}\",\"exchange\":\"${EXCHANGE}\",\"tf\":\"${TF}\""

if [[ -n "$MARKETS" ]]; then
  # Convert comma-separated to JSON array.
  IFS=',' read -r -a arr <<<"$MARKETS"
  json_payload+=",\"markets\":["
  for i in "${!arr[@]}"; do
    m="${arr[$i]}"
    m="${m//\"/}"
    if [[ $i -gt 0 ]]; then json_payload+=","; fi
    json_payload+="\"$m\""
  done
  json_payload+="]"
fi

json_payload+="}"

echo "=== 1) eval_weekly ===" >&2
curl -sS \
  -X POST "${BASE_URL}/scheduler/eval-weekly" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d "${json_payload}"
echo

# If WEEK was omitted, we still want to download a pack; use weekly-close as a helper to resolve week + pack url.
resolved_week="$WEEK"
if [[ -z "$resolved_week" ]]; then
  echo "=== 1.5) resolve week via weekly-close (dry) ===" >&2
  resp=$(curl -sS \
    -X POST "${BASE_URL}/scheduler/weekly-close" \
    -H "content-type: application/json" \
    -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
    -d "${json_payload}")
  echo "$resp"
  echo
  # extract week field using python
  resolved_week=$(python - <<PY
import json,sys
try:
  o=json.loads(sys.stdin.read())
  print(o.get('week',''))
except Exception:
  print('')
PY
<<<"$resp")
fi

if [[ -z "$resolved_week" ]]; then
  echo "Could not resolve week id. Set WEEK explicitly." >&2
  exit 1
fi

echo "=== 2) filters_drop sync ===" >&2
curl -sS \
  -X POST "${BASE_URL}/scheduler/filters/drop-sync" \
  -H "content-type: application/json" \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  -d "{\"week\":\"${resolved_week}\"}"
echo

echo "=== 3) download report pack (includes eval_weekly + filters_drop snapshots) ===" >&2
out_file="report_pack_${resolved_week}.zip"
url="${BASE_URL}/api/report/pack?from=$(python - <<PY
import urllib.parse,os
print(urllib.parse.quote(os.environ.get("FROM","")))
PY
)&to=$(python - <<PY
import urllib.parse,os
print(urllib.parse.quote(os.environ.get("TO","")))
PY
)&mode=weekly&week=${resolved_week}"

curl -sS -L \
  -H "x-scheduler-token: ${SCHEDULER_TOKEN}" \
  "$url" \
  -o "$out_file"

echo "Saved: $out_file" >&2
