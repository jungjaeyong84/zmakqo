#!/bin/zsh
# Paper lane for the forced-exit short: reads Binance announcements, books paper
# shorts, marks them, and writes ops/daily/forced_exit_paper_latest.json.
#
# PAPER ONLY. No keys are read, no order path exists, live exposure is 0. The
# rule is frozen until 2027-09-20; changing it before then voids the test that
# this lane exists to run.
#
# Runs hourly at :05 so it never shares a minute with v5flow (:10) or wideflow
# (:30); all three share one IP and the announcement feed is cheap but the
# kline calls are not free.
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$REPO_ROOT"
[[ -f "$RUNTIME_ENV_FILE" ]] && source "$RUNTIME_ENV_FILE"
exec node scripts/run-forced-exit-paper-lane.js
