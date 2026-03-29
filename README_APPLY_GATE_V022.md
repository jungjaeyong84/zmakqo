# donbeolja PATCH (Gate v0.2.2)

## 목적
- scheduler/tick이 `overall_gate: FAIL_HARD`로 고정되고 `actor_allowed: false`로 모의 체결이 진행되지 않는 문제를 수정.

## 변경 파일
- `src/storage/gate.js`

## 적용 방법
```bash
cd ~/Projects/donbeolja || exit 1

# 1) 백업(권장)
BACKUP_DIR=~/Projects/donbeolja_backup_$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
rsync -a --exclude node_modules --exclude .git ./ "$BACKUP_DIR/donbeolja/"

# 2) 패치 적용(zip을 풀어 덮어쓰기)
unzip -q ~/Downloads/donbeolja_PATCH_GATE_V022_20260104.zip -d /tmp/donbeolja_patch_gate_v022
rsync -a /tmp/donbeolja_patch_gate_v022/ ./

# 3) 문법 검사
node -c src/storage/gate.js

# 4) 재기동
pkill -f "node server.js" || true
PID="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
[ -n "${PID:-}" ] && kill -9 "$PID" || true
sleep 1

export PORT=3000
export ALLOW_LOCAL_NO_OAUTH=1
nohup node server.js > /tmp/donbeolja_run.log 2>&1 &

# 5) 확인
curl -sS -o /dev/null -w "HEALTH:%{http_code}\n" http://127.0.0.1:3000/health
curl -sS -X POST http://127.0.0.1:3000/scheduler/tick \
  | egrep -o '"overall_gate":[^,}]*|"overall_gate_detail":[^,}]*|"trading_mode":\{[^}]*\}|"actor_allowed":[^,}]+' \
  | head -n 120
