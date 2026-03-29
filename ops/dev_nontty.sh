#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")/.."

TOK="$(cat .scheduler_token)"
export SCHEDULER_TOKEN="$TOK"
export ALLOW_LOCAL_NO_OAUTH="1"
export ALLOW_LOCAL_NO_OAUTH="1"

# kill existing
lsof -ti tcp:3000 | xargs -r kill -9

# run without tty dependency: detach stdin/out/err
# (nohup + redirect prevents TTY read EIO crash)
nohup npm run dev </dev/null > /tmp/donbeolja_dev.log 2>&1 &

echo "started pid(s):"
lsof -ti tcp:3000 || true
echo "log: /tmp/donbeolja_dev.log"
