#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   BASE_URL=http://localhost:3000 ops/download_improvement_pack.sh BINANCEFUT 30 /tmp/improvement-pack-30d.zip
# Defaults:
#   exchange=BINANCEFUT, days=30, output=/tmp/improvement-pack-binancefut-30d.zip

BASE_URL="${BASE_URL:-http://localhost:3000}"
EXCHANGE="${1:-BINANCEFUT}"
DAYS="${2:-30}"
OUT="${3:-/tmp/improvement-pack-${EXCHANGE,,}-${DAYS}d.zip}"
LEVEL="${LEVEL:-STANDARD}"
PACK_VER="${PACK_VER:-v1}"
TF="${TF:-${IMPROVEMENT_PACK_TF:-${EXCHANGE_TF_ALLOWLIST%%,*}}}"
TF="${TF:-60m}"

python3 - <<'PY' "$BASE_URL" "$EXCHANGE" "$DAYS" "$OUT" "$LEVEL" "$PACK_VER" "$TF"
import sys
from datetime import datetime, timedelta, timezone

base_url, exchange, days, out_path, level, pack_ver, tf = sys.argv[1:]
days_int = int(days)
now = datetime.now(timezone.utc)
start = now - timedelta(days=days_int)

print("BASE_URL:", base_url)
print("EXCHANGE:", exchange)
print("FROM:", start.isoformat())
print("TO:", now.isoformat())
print("OUT:", out_path)
print("TF:", tf)

query = (
    f"{base_url}/api/report/improvement-pack"
    f"?level={level}"
    f"&pack_ver={pack_ver}"
    f"&exchange={exchange}"
    f"&tf={tf}"
    f"&from={start.isoformat()}"
    f"&to={now.isoformat()}"
)
print("URL:", query)

import subprocess
subprocess.run(["curl", "-L", "--fail", "-o", out_path, query], check=True)
PY
