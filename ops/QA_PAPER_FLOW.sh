#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "BASE_URL=$BASE_URL"
echo "=== health ==="
curl -fsS "$BASE_URL/health" | head -c 300; echo

echo "=== scheduler status ==="
curl -fsS "$BASE_URL/scheduler/status" | head -c 1200; echo

echo "=== state markets ==="
curl -fsS "$BASE_URL/api/state" | head -c 2000; echo

echo "=== done ==="
