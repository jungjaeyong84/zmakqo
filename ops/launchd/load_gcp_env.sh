#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:$HOME/google-cloud-sdk/bin"
export CLOUDSDK_CONFIG="/Users/jeongjaeyong/Projects/donbeolja/.gcloud"
export GOOGLE_APPLICATION_CREDENTIALS="/Users/jeongjaeyong/Projects/donbeolja/.gcloud/application_default_credentials.json"
export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-donbeolja-dev}"
export GCLOUD_PROJECT="${GCLOUD_PROJECT:-donbeolja-dev}"

if [ -f "$HOME/.env.openclaw" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  . "$HOME/.env.openclaw"
  set +o allexport
fi
