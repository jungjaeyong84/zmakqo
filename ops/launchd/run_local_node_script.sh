#!/bin/zsh
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: run_local_node_script.sh <script> [args...]" >&2
  exit 64
fi

# shellcheck disable=SC1091
. /Users/jeongjaeyong/Projects/donbeolja/ops/launchd/load_gcp_env.sh

cd /Users/jeongjaeyong/Projects/donbeolja
exec node "$@"
