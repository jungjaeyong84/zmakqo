#!/bin/zsh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"

cd "$REPO_ROOT"

if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  # local_cost_saver_runtime.env is generated in `export KEY=VALUE` form.
  source "$RUNTIME_ENV_FILE"
fi

export PORT="${PORT:-3000}"

exec node scripts/run-v3-local-server.js
