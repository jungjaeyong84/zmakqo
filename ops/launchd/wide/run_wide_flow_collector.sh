#!/bin/zsh
# Banks the rolling 30-day /futures/data window for the WIDE universe (all USDT
# perpetuals, not v5's 24). The API horizon never grows; this ledger is the only
# thing that does, and a cycle missed today is history that cannot be recovered.
#
# Runs on the same 4h cadence as v5flow but offset to :30, because both share an
# IP and there is no reason to double the instantaneous load on the same minute.
# The collector aborts on the first 429/418 rather than retrying into a block —
# losing this IP would take v5flow down with it, and v5flow is v7's only input.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "$RUNTIME_ENV_FILE" ]] && source "$RUNTIME_ENV_FILE"
exec node scripts/run-wide-flow-collector.js
