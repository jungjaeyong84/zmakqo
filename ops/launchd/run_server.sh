#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"

cd /Users/jeongjaeyong/Projects/donbeolja
exec node server.js
