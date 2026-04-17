#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export SCHEDULER_AUTOSTART="${SCHEDULER_AUTOSTART:-1}"

# OpenClaw Phase env — managed by ops/deploy/apply_openclaw_phase.sh.
# When the file is absent (pre-Day-0) the server starts with no OpenClaw
# flags set, which is the same as the legacy behavior.
if [ -f "$HOME/.env.openclaw" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . "$HOME/.env.openclaw"
  set +o allexport
fi

cd /Users/jeongjaeyong/Projects/donbeolja
exec node server.js
