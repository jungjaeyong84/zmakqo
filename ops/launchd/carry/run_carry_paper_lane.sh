#!/bin/zsh
# Funding carry, on paper, forward only. Books the previous UTC day once a day.
# PAPER ONLY: no keys, no order path. Its series exists to be combined with the
# forced-exit lane at that lane's decision dates.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "ops/runtime/local_cost_saver_runtime.env" ]] && source "ops/runtime/local_cost_saver_runtime.env"
exec node scripts/run-carry-paper-lane.js
