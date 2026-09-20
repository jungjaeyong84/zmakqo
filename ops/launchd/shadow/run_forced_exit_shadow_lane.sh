#!/bin/zsh
# Pre-registered variants of the forced-exit short. Records only; the frozen
# lane keeps all decision authority. Runs at :20, after the primary at :05.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "ops/runtime/local_cost_saver_runtime.env" ]] && source "ops/runtime/local_cost_saver_runtime.env"
exec node scripts/run-forced-exit-shadow-lane.js
