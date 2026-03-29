#!/bin/zsh
set -e

PORT="${PORT:-3000}"

TS="$(date +%Y%m%d_%H%M%S)"
OUTDIR="/tmp/donbeolja_debug_${TS}"
mkdir -p "${OUTDIR}"

cp -f public/risk_budget.html "${OUTDIR}/risk_budget.html" 2>/dev/null || true
cp -f src/routes/settings.routes.js "${OUTDIR}/settings.routes.js" 2>/dev/null || true
cp -f src/paper/engine.js "${OUTDIR}/paper_engine.js" 2>/dev/null || true
cp -f src/auth/google.js "${OUTDIR}/auth_google.js" 2>/dev/null || true
cp -f src/server/app.js "${OUTDIR}/server_app.js" 2>/dev/null || true
cp -f ops/SMOKE.sh "${OUTDIR}/SMOKE.sh" 2>/dev/null || true
cp -f ecosystem.config.cjs "${OUTDIR}/ecosystem.config.cjs" 2>/dev/null || true
cp -f package.json "${OUTDIR}/package.json" 2>/dev/null || true

find . -maxdepth 4 -type f | sort > "${OUTDIR}/repo_tree.txt" || true
git rev-parse HEAD > "${OUTDIR}/git_head.txt" 2>/dev/null || true
git status -sb > "${OUTDIR}/git_status.txt" 2>/dev/null || true
git log -n 20 --oneline > "${OUTDIR}/git_log_20.txt" 2>/dev/null || true

pm2 status --no-color > "${OUTDIR}/pm2_status.txt" 2>/dev/null || true
pm2 describe donbeolja > "${OUTDIR}/pm2_describe.txt" 2>/dev/null || true

pm2 env 2 > "${OUTDIR}/pm2_env_2.txt" 2>/dev/null || true
pm2 env 2 | egrep -n "PORT:|RUNTIME_MODE:|NODE_ENV:|GOOGLE_CLOUD_PROJECT:|GCLOUD_PROJECT:|UPBIT_MARKETS:|UPBIT_MARKET:|ALLOWLIST_EMAIL:|REQUIRE_SIGNAL_PRICE:|SCHEDULE_POLL_MS:|SCHEDULE_GRACE_MS:" > "${OUTDIR}/pm2_env_key.txt" 2>/dev/null || true

curl -i "http://127.0.0.1:${PORT}/health/firestore" > "${OUTDIR}/curl_health_firestore.txt" 2>/dev/null || true
curl -i "http://127.0.0.1:${PORT}/api/settings/risk-budget" > "${OUTDIR}/curl_api_get_risk_budget.txt" 2>/dev/null || true
curl -i "http://127.0.0.1:${PORT}/ui/settings/risk?v=debug_${TS}" > "${OUTDIR}/curl_ui_risk_headers_and_html.txt" 2>/dev/null || true

curl -sS "http://127.0.0.1:${PORT}/ui/settings/risk?v=debug_${TS}" | egrep -n "SAVE_IN_FLIGHT|__RB_SAVE_LOCK__|async function save|async function load|addEventListener\\(\"click\"|onclick=|fetch\\(API|/api/settings/risk-budget" > "${OUTDIR}/ui_risk_grep.txt" 2>/dev/null || true

pm2 logs donbeolja --nostream --lines 300 > "${OUTDIR}/pm2_logs_last_300.txt" 2>/dev/null || true

TGZ="/tmp/donbeolja_debug_${TS}.tgz"
tar -czf "${TGZ}" -C "/tmp" "donbeolja_debug_${TS}"

echo "${TGZ}"
