#!/bin/zsh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
RUNTIME_ENV_FILE="$REPO_ROOT/ops/runtime/local_cost_saver_runtime.env"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"

cd "$REPO_ROOT"

# TELEGRAM_BOT_TOKEN lives in the export-form runtime env; TELEGRAM_CHAT_ID +
# EXIT_INTEGRITY_ALERT_CHANNEL live in .env and are loaded by the node script
# via dotenv. Source the export-form file here for the token.
if [[ -f "$RUNTIME_ENV_FILE" ]]; then
  source "$RUNTIME_ENV_FILE"
fi

exec node scripts/watch-v3-readiness-alert.js
