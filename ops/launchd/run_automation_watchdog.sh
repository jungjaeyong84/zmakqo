#!/bin/zsh
set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_ai_cli_env.sh
cd /Users/jeongjaeyong/Projects/donbeolja
node scripts/automation-automation-watchdog.js
