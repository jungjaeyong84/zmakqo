#!/bin/zsh
set -e
cd /Users/jeongjaeyong/Projects/donbeolja
TARGET="${1:-v1.0.0}"

git fetch --all --tags

if [ -n "$(git status --porcelain)" ]; then
  echo "[ROLLBACK] working tree dirty. commit/stash first."
  git status --porcelain
  exit 1
fi

git checkout "$TARGET"
rm -rf node_modules
npm ci

if [ -f ops/.env.runtime.local ]; then
  set -a
  source ops/.env.runtime.local
  set +a
fi

pm2 delete donbeolja 2>/dev/null || true
pm2 start ecosystem.config.cjs --only donbeolja --update-env
pm2 save --force

echo "[ROLLBACK] done -> $TARGET"
pm2 status
