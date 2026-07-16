#!/bin/zsh
set -uo pipefail

# v3 micro-live cycle: executor -> exit sync -> live-vs-paper report.
# Inert until .env sets V3_LIVE_ENABLED=1 (executor skips everything and the
# other two steps no-op on empty ledgers). Rollout stages are driven purely
# from .env — see src/v3/README.md "마이크로-라이브 실행 레이어".
#
# NOTE: deliberately NOT `set -e` on the step lines — a transient failure in
# one step must not block the next cycle's steps; each step logs its own
# ok/fail JSON line.

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"

cd "$REPO_ROOT"

if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  source "$RUNTIME_ENV_FILE"
fi

node scripts/run-v3-live-executor.js || echo "{\"step\":\"live_executor\",\"rc\":$?}"
node scripts/run-v3-live-exit-sync.js || echo "{\"step\":\"live_exit_sync\",\"rc\":$?}"
node scripts/run-v3-live-reconcile.js || echo "{\"step\":\"live_reconcile\",\"rc\":$?}"
node scripts/report-v3-live-vs-paper.js || echo "{\"step\":\"live_vs_paper\",\"rc\":$?}"
