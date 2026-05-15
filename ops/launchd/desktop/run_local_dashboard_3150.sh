#!/bin/zsh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"

cd "$REPO_ROOT"

if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  source "$RUNTIME_ENV_FILE"
fi

export PORT="3150"
export HOST="127.0.0.1"
export PUBLIC_UI_NO_AUTH="${PUBLIC_UI_NO_AUTH:-1}"
export DESKTOP_MODE="1"

exec node server.js
