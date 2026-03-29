#!/usr/bin/env sh
set -eu
# 1) build patch pack (also refreshes /tmp/donbeolja_report.json)
./ops/patch_pack.sh >/tmp/donbeolja_patch_pack.log 2>&1 || {
  echo "[FAIL] patch_pack.sh"
  tail -n 80 /tmp/donbeolja_patch_pack.log || true
  exit 1
}

# 2) extract candidates from the refreshed report.json
node ./ops/extract_patch_candidates.js | tee /tmp/donbeolja_patch_candidates.json

# 3) generate proposal markdown (saved in repo root)
node ./ops/generate_patch_proposal.js | tee /tmp/donbeolja_patch_proposal.log

echo
echo "[OK] candidates saved:"
ls -al /tmp/donbeolja_patch_pack.zip /tmp/donbeolja_patch_candidates.json
