#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export SCHEDULER_AUTOSTART="${SCHEDULER_AUTOSTART:-1}"
# shellcheck disable=SC1091
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_gcp_env.sh

cd /Users/jeongjaeyong/Projects/donbeolja
exec node server.js
