#!/bin/zsh
set -euo pipefail

# shellcheck disable=SC1091
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_gcp_env.sh

export PORT="${EXIT_WORKER_LOCAL_PORT:-8080}"
export EXIT_WORKER_SELF_URL="${EXIT_WORKER_SELF_URL:-http://127.0.0.1:${PORT}}"

cd /Users/jeongjaeyong/Projects/donbeolja
exec node src/worker/tickExitWorker.js
