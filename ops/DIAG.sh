#!/bin/zsh
set -e
cd /Users/jeongjaeyong/Projects/donbeolja

echo "=== GIT"
git status -sb || true
echo

echo "=== PM2"
pm2 status || true
echo

echo "=== LISTEN"
lsof -nP -iTCP:${PORT:-3000} -sTCP:LISTEN || true
echo

echo "=== HEALTH"
curl -s http://127.0.0.1:${PORT:-3000}/health/firestore || true
echo
echo

echo "=== SCHEDULER STATUS"
curl -s http://127.0.0.1:${PORT:-3000}/scheduler/status || true
echo
