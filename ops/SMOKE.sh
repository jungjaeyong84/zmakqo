#!/bin/zsh
set -e
cd /Users/jeongjaeyong/Projects/donbeolja

if [ -f ops/.env.runtime.local ]; then
  set -a
  source ops/.env.runtime.local
  set +a
fi

PORT="${PORT:-3000}"
MARKETS="${UPBIT_MARKETS:-KRW-BTC,KRW-ETH,KRW-XRP,KRW-SOL,KRW-ADA,KRW-DOGE}"

echo "[SMOKE] wait server ready (max 20s)"
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:${PORT}/health/firestore >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[SMOKE] health/firestore"
curl -fsS http://127.0.0.1:${PORT}/health/firestore >/dev/null
echo "OK"

echo "[SMOKE] webhook/echo"
curl -fsS -X POST http://127.0.0.1:${PORT}/webhook/echo \
  -H "Content-Type: application/json" \
  -d '{"ping":"pong"}' >/dev/null
echo "OK"

# 마지막 확정봉(UTC 기준) 계산
NOW_MS=$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)
HOUR_MS=3600000
BAR_MS=$(( (NOW_MS / HOUR_MS) * HOUR_MS ))
ISO=$(python3 - <<PY
import datetime
ms=int("$BAR_MS")
print(datetime.datetime.utcfromtimestamp(ms/1000).replace(tzinfo=datetime.timezone.utc).isoformat().replace("+00:00","Z"))
PY
)

echo "[SMOKE] markets=${MARKETS}"
echo "[SMOKE] bar=${ISO}"

for M in $(echo "$MARKETS" | tr "," " "); do
  SUF=$(date +%H%M%S)
  EV_BUY="SMOKE_BUY_${M}_${SUF}"
  EV_SELL="SMOKE_SELL_${M}_${SUF}"

  echo "[SMOKE] inject ${M} BUY+SELL, expect SELL consumed"

  curl -fsS -X POST http://127.0.0.1:${PORT}/webhook/signal \
    -H "Content-Type: application/json" \
    -d "{\"exchange\":\"UPBIT\",\"symbol\":\"${M}\",\"tf\":\"60m\",\"bar_close_time_utc_ms\":${BAR_MS},\"bar_close_time_utc\":\"${ISO}\",\"event\":\"${EV_BUY}\",\"side\":\"BUY\",\"qty_pct\":0.5,\"reason\":\"SMOKE\",\"features\":{\"price\":101}}" >/dev/null

  curl -fsS -X POST http://127.0.0.1:${PORT}/webhook/signal \
    -H "Content-Type: application/json" \
    -d "{\"exchange\":\"UPBIT\",\"symbol\":\"${M}\",\"tf\":\"60m\",\"bar_close_time_utc_ms\":${BAR_MS},\"bar_close_time_utc\":\"${ISO}\",\"event\":\"${EV_SELL}\",\"side\":\"SELL\",\"qty_pct\":1.0,\"reason\":\"SMOKE\",\"features\":{\"price\":101}}" >/dev/null

  TMP_JSON="/tmp/donbeolja_smoke_tick.json"
  curl -fsS -X POST http://127.0.0.1:${PORT}/scheduler/tick > "${TMP_JSON}"

  export SMOKE_M="${M}"

  python3 - <<'PYC'
import json, sys, pathlib, os
raw = pathlib.Path("/tmp/donbeolja_smoke_tick.json").read_text().strip()
o = json.loads(raw)
cons = o.get("consumes") or []

M = os.environ.get("SMOKE_M", "")
hit = None
for c in cons:
  if c.get("market") == M:
    hit = c
    break

if not hit:
  print("[SMOKE] FAIL: market not in consumes", {"market": M, "consumes": [x.get("market") for x in cons]})
  sys.exit(1)

if hit.get("consumed") is not True:
  print("[SMOKE] FAIL: not consumed", {"market": M, "reason": hit.get("reason")})
  sys.exit(1)

sig = (hit.get("payload") or {}).get("signal")
paper_action = (((hit.get("paper") or {}).get("results") or [{}])[0]).get("action")

if sig == "SELL" or paper_action == "SELL":
  print("[SMOKE] OK: SELL selected", {"market": M})
  sys.exit(0)

print("[SMOKE] FAIL: not SELL", {"market": M, "payload.signal": sig, "paper.results[0].action": paper_action})
sys.exit(1)
PYC
done

echo "[SMOKE] report/latest"
curl -fsS "http://127.0.0.1:${PORT}/report/latest?n=5" >/dev/null
echo "OK"

echo "[SMOKE] PASS"
