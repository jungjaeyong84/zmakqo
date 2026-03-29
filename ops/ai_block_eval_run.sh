#!/usr/bin/env bash
set -euo pipefail

# Run AI_BLOCK vs KEEP evaluation and save a timestamped report.
#
# Usage:
#   BASE_URL=http://localhost:3000 ops/ai_block_eval_run.sh BINANCEFUT 30 /tmp
#
# Args:
#   $1 exchange (default: BINANCEFUT)
#   $2 days (default: 30)
#   $3 output dir (default: /tmp)

BASE_URL="${BASE_URL:-http://localhost:3000}"
EXCHANGE="${1:-BINANCEFUT}"
DAYS="${2:-30}"
OUTDIR="${3:-/tmp}"

mkdir -p "${OUTDIR}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
ex_lc="$(echo "${EXCHANGE}" | tr '[:upper:]' '[:lower:]')"

zip_path="${OUTDIR}/improvement-pack-${ex_lc}-${DAYS}d-${ts}.zip"
report_path="${OUTDIR}/ai_block_eval-${ex_lc}-${DAYS}d-${ts}.txt"
report_latest="${OUTDIR}/ai_block_eval-${ex_lc}-${DAYS}d-latest.txt"

echo "[AI_BLOCK_EVAL] base_url=${BASE_URL} exchange=${EXCHANGE} days=${DAYS}"
echo "[AI_BLOCK_EVAL] zip=${zip_path}"
echo "[AI_BLOCK_EVAL] report=${report_path}"

BASE_URL="${BASE_URL}" ops/download_improvement_pack.sh "${EXCHANGE}" "${DAYS}" "${zip_path}"

python3 ops/eval_ai_block.py "${zip_path}" | tee "${report_path}"
cp -f "${report_path}" "${report_latest}"
echo "[AI_BLOCK_EVAL] done"
