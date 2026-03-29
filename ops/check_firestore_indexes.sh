#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${REPO_ROOT}"

FILE="firestore.indexes.json"
if [[ ! -f "${FILE}" ]]; then
  echo "[INDEX_CHECK] missing ${FILE}"
  exit 1
fi

required=(
  '"collectionGroup": "signals"'
  '"collectionGroup": "funding_fees"'
  '"fieldPath": "symbol_or_pair_id"'
  '"fieldPath": "symbol"'
  '"fieldPath": "created_at"'
  '"fieldPath": "time_ms"'
)

for pattern in "${required[@]}"; do
  if ! grep -q "${pattern}" "${FILE}"; then
    echo "[INDEX_CHECK] required pattern missing: ${pattern}"
    exit 1
  fi
done

echo "[INDEX_CHECK] ok"
