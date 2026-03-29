# donbeolja patch: server boot + paper trading gate

## 1) 적용 대상
- 로컬 프로젝트: `~/Projects/donbeolja`
- 목적
  - 서버 부팅 실패(MODULE_NOT_FOUND) 방지
  - gate 계산 정렬/필드명 정규화로 actor_allowed 정상화
  - scheduler가 paper runner를 호출하지 못하던 문제(runPaperMarket export mismatch) 해결

## 2) 적용 방법
```bash
cd ~/Projects/donbeolja || exit 1

# (권장) 백업
BACKUP_DIR=~/Projects/donbeolja_backup_$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
rsync -a --exclude node_modules --exclude .git ./ "$BACKUP_DIR/donbeolja/"

# 패치 풀기 (zip을 받은 경로에서)
unzip -q donbeolja_PATCH_SERVER_UP_PAPER_FIX_20260103.zip -d /tmp/donbeolja_patch

# 덮어쓰기
rsync -a /tmp/donbeolja_patch/ ./

node -c src/storage/gate.js
node -c src/routes/pipeline.routes.js
node -c src/engine/paperUpbitRunner.js
```

## 3) 검증 방법
```bash
pkill -f "node server.js" || true
export PORT=3000
export ALLOW_LOCAL_NO_OAUTH=1
nohup node server.js > /tmp/donbeolja_run.log 2>&1 &

curl -sS -o /dev/null -w "HEALTH:%{http_code}\n" http://localhost:3000/health

# 1) 데이터 라우트
curl -sS "http://localhost:3000/data/upbit/60m?market=KRW-BTC&count=2" | head -c 220; echo

# 2) 스케줄러 tick
curl -sS -X POST "http://localhost:3000/scheduler/tick" | egrep -o '"overall_gate":[^,}]*|"overall_gate_detail":[^,}]*|"trading_mode":\{[^}]*\}|"actor_allowed":[^,}]+' | head -n 80

# actor_allowed 가 true 인 tick에서 paper가 null이 아니고, fills/intents가 쌓여야 한다.
# (신호가 없는 bar에서는 paper.ok=true 이더라도 fills가 0일 수 있다.)
```

## 4) 변경 파일
- `src/routes/pipeline.routes.js`
  - runner를 lazy-load로 변경하여, runner 의존성이 깨져도 서버 부팅은 성공하도록 방어
- `src/storage/gate.js`
  - bars 정렬/필드명 정규화 + validateBars 시그니처 정합
  - stable_enough/graceMs 반영
- `src/engine/paperUpbitRunner.js`
  - `runPaperMarket` alias 추가 (scheduler import 호환)
