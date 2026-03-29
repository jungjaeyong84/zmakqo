#!/bin/zsh
set -e
cd /Users/jeongjaeyong/Projects/donbeolja

VER="${1:-v1.0.0}"
MSG="${2:-release ${VER}}"

# 비밀 파일은 커밋 금지
git status --porcelain | grep "ops/.env.runtime.local" >/dev/null 2>&1 && {
  echo "[RELEASE] ops/.env.runtime.local is tracked. STOP."
  exit 1
}

git add -A
git commit -m "$MSG" || true

if git rev-parse "$VER" >/dev/null 2>&1; then
  echo "[RELEASE] tag exists: $VER"
else
  git tag -a "$VER" -m "$MSG"
fi

git push origin HEAD:master
git push origin --tags

echo "[RELEASE] done -> $VER"
