#!/bin/zsh
# v7 positioning cross-sectional paper lane. Paper only — no keys, no order path.
#
# Runs hourly but only acts when the v5 collector has banked a NEW closed 4h
# period; otherwise it reports "already rebalanced" and exits. Hourly polling
# rather than a 4h timer means a missed collector run is picked up on the next
# hour instead of waiting a full period.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "$RUNTIME_ENV_FILE" ]] && source "$RUNTIME_ENV_FILE"
exec node scripts/run-v7-positioning-cycle.js
