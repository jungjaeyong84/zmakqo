#!/usr/bin/env sh
set -eu
# 0) make sure report pack exists (creates /tmp/donbeolja_report.json + zip)
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

./ops/report_pack.sh >/tmp/donbeolja_report_pack.log 2>&1

OUT_ZIP="/tmp/donbeolja_patch_pack.zip"
TMP_DIR="/tmp/donbeolja_patch_pack_dir"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

# 1) core evidence
cp -f /tmp/donbeolja_report.json "$TMP_DIR/report.json" 2>/dev/null || true
cp -f /tmp/donbeolja_report_pack.zip "$TMP_DIR/report_pack.zip" 2>/dev/null || true
cp -f /tmp/donbeolja_report_pack.log "$TMP_DIR/report_pack.log" 2>/dev/null || true

# 2) version + git state (no secrets)
git rev-parse HEAD > "$TMP_DIR/GIT_HEAD.txt" 2>/dev/null || true
git status -sb     > "$TMP_DIR/GIT_STATUS.txt" 2>/dev/null || true
git diff           > "$TMP_DIR/GIT_DIFF.patch" 2>/dev/null || true

# 3) package manifests (no node_modules)
cp -f package.json       "$TMP_DIR/" 2>/dev/null || true
cp -f package-lock.json  "$TMP_DIR/" 2>/dev/null || true

# 4) env keys sample only (values removed)
if [ -f ops/.env.runtime.local ]; then
  grep -E '^[A-Z0-9_]+=' ops/.env.runtime.local \
    | sed 's/=.*$/=REDACTED/' \
    > "$TMP_DIR/ENV_KEYS_SAMPLE.txt"
fi

# 5) zip it
rm -f "$OUT_ZIP"
(cd "$TMP_DIR" && zip -r "$OUT_ZIP" . >/dev/null)

ls -al "$OUT_ZIP"
