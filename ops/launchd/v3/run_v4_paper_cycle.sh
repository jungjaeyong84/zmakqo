#!/bin/zsh
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "$RUNTIME_ENV_FILE" ]] && source "$RUNTIME_ENV_FILE"
node scripts/run-v4-paper-rebalance.js || echo "{\"step\":\"v4_rebalance\",\"rc\":$?}"
node scripts/report-v4-paper-performance.js || echo "{\"step\":\"v4_report\",\"rc\":$?}"
