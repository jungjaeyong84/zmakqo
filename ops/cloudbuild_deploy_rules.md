# DONBEOLJA Cloud Build Deploy Rules (영구 규칙)

- 제정: 2026-04-18
- 제정자: 재용 (CEO)
- 적용 대상: deploy, ops, system_dev, 모든 워커
- 상태: **시행 중 (ACTIVE)**

---

## 배경

2026-04-18 이전까지 Cloud Build 트리거 `db7cd873-8927-419d-a232-855648b727f5`
(name: `rmgpgab-donbeolja-asia-northeast3-jungjaeyong84-zmakqo--mawpc`)는
자동 생성된 "Deploy to Cloud Run" 인라인 설정만 사용하여 `cloudbuild.yaml`을 **무시**했다.

결과:
- 트리거가 수행한 배포는 `gcloud run services update donbeolja --image=... --labels=... --region=... --quiet` 한 줄뿐.
- `--set-env-vars` / `--set-secrets` / `--memory` / `--max-instances` / `--timeout` 등 옵션이 전부 누락.
- 4개 서비스 중 메인 `donbeolja`만 배포되고 `donbeolja-egress`, `donbeolja-egress-private`, `donbeolja-exit-worker`는 **배포되지 않음**.
- env 변수 변경을 repo에 commit해도 live에 반영되지 않아, 매번 수동으로 `gcloud run services update --set-env-vars ...` 실행하여 복구해야 했음.
- 예: commit `2e2d82a2` 기반 build `4675754f-3c9e-4090-acd6-1dd437b24e44` 배포 후 `ENTRY_MAKER_FIRST_ENABLED=1` 등 누락 → 수동 복구.

## 변경 사항 (2026-04-18)

트리거를 `cloudbuild.yaml` 모드로 전환:

```yaml
# /tmp/dbj-trigger-backup/trigger-new.yaml (적용 완료)
filename: cloudbuild.yaml
# (기존 build: 블록 제거, 기존 substitutions: 제거)
```

적용 명령:

```bash
gcloud beta builds triggers export db7cd873-8927-419d-a232-855648b727f5 \
  --project=donbeolja-dev \
  --destination=/tmp/trigger-backup.yaml  # 백업

# 편집: build: 블록 삭제 → filename: cloudbuild.yaml 추가, substitutions: 삭제

gcloud beta builds triggers import \
  --project=donbeolja-dev \
  --source=/path/to/edited.yaml
```

---

## 규칙 1: env 변수 변경은 `cloudbuild.yaml`로만 한다

**2026-04-18부터 Cloud Run env 변수 변경은 반드시 `cloudbuild.yaml`을 git commit → trigger 실행으로 반영한다.**

### 금지 행위

- `gcloud run services update --set-env-vars=...` 를 **production 복구 목적 외에는** 직접 실행하지 말 것.
- 수동 `set-env-vars`로 복구한 경우, **즉시** 동일 변경을 `cloudbuild.yaml`에 commit하여 drift를 제거할 것 (다음 빌드에서 덮어쓰이지 않도록).

### 권장 흐름

1. `cloudbuild.yaml`의 해당 서비스 `--set-env-vars` 블록을 편집.
2. PR → review → merge.
3. 자동 또는 수동 트리거로 build 실행:
   ```bash
   gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 \
     --project=donbeolja-dev --branch=<target-branch>
   ```
4. build 성공 후 4개 서비스 env 값 확인:
   ```bash
   for s in donbeolja donbeolja-egress donbeolja-egress-private donbeolja-exit-worker; do
     echo "=== $s ==="
     gcloud run services describe $s --region=asia-northeast3 \
       --project=donbeolja-dev --format="value(spec.template.spec.containers[0].env)"
   done
   ```

---

## 규칙 2: `master` 브랜치 `cloudbuild.yaml` 최신화 의무

트리거의 push 필터는 `^master$`이다. 2026-04-18 기준 `origin/master`의 `cloudbuild.yaml`은 **74줄 구버전**이며, 현재 운영 중인 `cloudbuild.yaml` (120줄)과 크게 다르다 (`donbeolja-egress-private` 서비스 누락, OPENCLAW/OTEL/ENTRY_MAKER 등 env 변수 다수 누락).

### 경고

- **`master` 에 직접 push하면** 낡은 `cloudbuild.yaml` 로 배포되어 env 변수 누락 + egress-private 미배포 발생.
- **해결책**: 최신 `cloudbuild.yaml`을 `master`에 PR/merge하여 동기화할 것.

### 잠정 운영 방식 (master 동기화 전까지)

- 자동 push 배포 금지. 수동 트리거만 사용:
  ```bash
  gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 \
    --project=donbeolja-dev --branch=<good-branch>
  ```
- `<good-branch>`는 최신 `cloudbuild.yaml`이 있는 브랜치여야 한다.

---

## 규칙 3: 트리거 설정 변경 시 반드시 백업

```bash
# 변경 전
gcloud beta builds triggers export <TRIGGER_ID> \
  --project=donbeolja-dev \
  --destination=/tmp/trigger-backup-$(date +%Y%m%d-%H%M%S).yaml
```

롤백은 `gcloud beta builds triggers import --source=<backup>` 으로 즉시 가능.

---

## 참고 build ID (전환 검증)

- 전환 전 마지막 auto-gen build: `4675754f-3c9e-4090-acd6-1dd437b24e44` (env 누락, gate 우회하고 배포)
- 전환 후 첫 검증 build: `f9afd1fa-1998-4a7d-94f9-a3683eacf711` (branch `codex/google-grade-ml-cutover-20260411` @ `2e2d82a2`) → **gate 차단으로 배포 미진행**

---

## ⚠️ 중대 발견: gate가 처음으로 활성화됨 (2026-04-18)

전환 직후 첫 검증 빌드에서 `npm run check:binance-exit-integrity-gate`가 다음 이유로 배포를 block:

```
reason: EXIT_INTEGRITY_DEPLOY_GATE_BLOCKED
reasons:
  - STATUS_NOT_OK:WARN
  - LIVE_GATE_BLOCKED
  - EXIT_QTY_LIVE_ISSUE_CHAIN (2건)
  - AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION (2건)

summary:
  live_issue_count: 4
  actionable_live_issue_count: 4
  exit_qty_live_issue_chain_n: 2
  authority_actionable_live_issue_position_n: 2
  stage_issue_symbol_n: 1
  skipped_validation_families: [EXCHANGE_IO]  # EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 때문
```

### 해석

- 이전 auto-gen 트리거에선 `npm test` / `check:*gate` 가 아예 실행되지 않았다 → 이 gate들은 **처음부터 완전히 우회되고 있었음**.
- 따라서 위 live 이슈들은 최소 2025-12-17 이후 누적되어 온 것일 수 있음 (트리거 createTime 기준).
- `cloudbuild.yaml` 트리거 전환 후부터는 **Firestore 상의 live 상태가 건강해야 배포 가능**.

### 2026-04-18 검증 빌드 시점 live 이슈 상세

#### (A) BTCUSDT 체인 qty 이슈 2건 (`EXIT_QTY_LIVE_ISSUE_CHAIN`)
- 2026-04-17 15:45 UTC TP1 fill에서 **외부(EXTERNAL) fill 2개가 동일 event/price로 각각 50%씩** TP1에 분류되어 `tp1_qty=1.0` (chain 1), `tp1_qty=1.1667` (chain 2) — 예상 ≤ 0.53.
- issue codes: `TP1_ABS_OVER`, `TP_CHAIN_ABS_OVER`, `TOTAL_EXIT_OVER_100`
- 현재 BTCUSDT 포지션(qty_base 0.004 SHORT, 2026-04-18 새 엔트리)과는 별개의 **히스토리 감사 기록**이나, `binance_exit_qty_live_separation` 로직이 live로 분류 중.
- 관련 파일:
  - `ops/daily/binance_exit_qty_contract_audit_latest.json` — 체인 상세
  - `ops/daily/binance_exit_qty_live_separation_latest.json` — live/historical 분리
- **조치 방향 (CEO/operator 판단 필요)**:
  - 해당 체인을 historical로 이관하거나 `backfilled: true` 마킹
  - 또는 `binance_exit_qty_live_separation` 기준 재검토

#### (B) DOGEUSDT RUNNER_MIN_GUARANTEE_MISSED 1건 (`AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION`)
- 현재 SHORT 포지션 `qty_base=10112`, `avg_price=0.0984`
- stage `TRAIL`, `tp_p1_done=true`, `trail_active=true`
- `native_stop_order_id=4000001112563983` @ 0.09825
- `chosen_stop_source=RUNNER_FLOOR` @ 0.0975882
- `min_guaranteed_profit_pct=0.0165`, **`current_guaranteed_profit_pct=0.00305`** → 미달
- **조치 방향 (실제 trading action, CEO/operator 판단 필요)**:
  - native stop을 1.65% 보장 가능 수준으로 이동
  - 또는 해당 포지션 수동 청산
  - 또는 RUNNER_FLOOR 로직 자체 재검토 (최소 보장이 왜 깨졌는지)

#### (C) BTCUSDT artifact 1건 (`EXIT_QTY_LIVE_ISSUE_ARTIFACT`)
- 위 (A)가 clear 되면 자동 해제됨

### 배포 재개 경로

다음 중 택일:

1. **(권장) live 이슈 해결 후 재배포**
   - 위 (A)(B) 해결 (operator action)
   - 재검증: `EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 node scripts/check-binance-exit-integrity-gate.js`
   - 빌드: `gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 --project=donbeolja-dev --branch=<branch>`

2. **(긴급용) gate 단계만 임시 완화**
   - `cloudbuild.yaml` Step 1 args에서 `&& npm run check:binance-exit-integrity-gate` 만 임시 제거 → 빌드 → 즉시 git revert
   - **반드시 동일 영업일 내 revert 필수**

3. **(비권장) 트리거 롤백**
   ```bash
   gcloud beta builds triggers import \
     --project=donbeolja-dev \
     --source=/tmp/dbj-trigger-backup/trigger-original-20260418-175332.yaml
   ```
   → gate 우회로 되돌아가지만 env 전파도 다시 끊어짐.

### 상태 확인 명령

```bash
# 4개 서비스가 아직 갱신 안 됐는지 확인 (generation 번호 변동 없으면 미배포)
for s in donbeolja donbeolja-egress donbeolja-egress-private donbeolja-exit-worker; do
  gcloud run services describe $s --region=asia-northeast3 --project=donbeolja-dev \
    --format="value(metadata.generation,status.latestReadyRevisionName)"
done
```

### 2026-04-18 전환 직후 상태 스냅샷

- `donbeolja` gen=1439, revision=`donbeolja-01437-mbj` (전환 전 값 그대로)
- `donbeolja-egress` gen=656, revision=`donbeolja-egress-00656-gjc` (변동 없음)
- `donbeolja-egress-private` gen=202, revision=`donbeolja-egress-private-00202-8vb` (변동 없음)
- `donbeolja-exit-worker` gen=881, revision=`donbeolja-exit-worker-00762-hj5` (변동 없음)
- `ENTRY_MAKER_FIRST_ENABLED=1` 등 2026-04-18 수동 복구 env 값 보존됨

### 2026-04-18 후속 자동 복구 시도 + 잔존 인시던트

트리거 전환 후 gate 차단을 해소하기 위해 **가능한 자동 복구는 수행 완료**.

1. **히스토리컬 체인 backfill 완료** (BTCUSDT 2체인 → `extra.exit_qty_contract_issue_backfilled_at=2026-04-18T09:21:43.731Z`)
   - 실행: `EXIT_QTY_CONTRACT_BACKFILL_LOOKBACK_DAYS=7 node scripts/backfill-binance-exit-qty-contract-issues.js`
   - 결과: `EXIT_QTY_LIVE_ISSUE_CHAIN` gate reason 해제됨.

2. **live trailing stage 재동기화 요청 발행** (BTCUSDT + DOGEUSDT)
   - 실행: `node scripts/repair-live-trailing-stage.js --symbols=BTCUSDT,DOGEUSDT`
     (Secret Manager에서 BINANCEFUT API 키, EXIT_WORKER_TRIGGER_TOKEN 주입)
   - Firestore `position_meta` + `trail_observation` 정규화 기록 완료.
   - `EXIT_REPAIR_REQUEST__BINANCEFUT__{BTCUSDT,DOGEUSDT}__NATIVE_STOP_REFRESH` enqueued, exit-worker HTTP dispatch OK.

3. **잔존 원인**: egress-proxy의 Binance write-path 타임아웃
   - 2026-04-18 09:20+ 동안 `donbeolja-exit-worker` 로그에 지속적 `EGRESS_PROXY_TIMEOUT provider=binancefut action=cancelFuturesOpenOrders timeout_ms=20000` / `fetchBinanceFuturesAccount` 오류 발생.
   - 즉 native stop 재배치 요청은 접수됐으나, exit-worker가 Binance 쪽으로 실제 cancel+place를 보낼 수 없는 상태.
   - 로컬에서 직접 Binance 호출한 repair 스크립트는 정상 작동 (`fetchOpenOrderSnapshot` 성공).
   - `donbeolja-egress-private`는 read path 정상 (`fetchFuturesAlgoOpenOrders` 성공).
   - 현상은 `donbeolja-egress` (write path) 쪽 infra 이슈로 보이며, 별도 조사 필요.

4. **현재 포지션 실제 상태 (참고, 2026-04-18 09:25 UTC)**
   - mark: BTCUSDT 76501.55, DOGEUSDT 0.09675
   - BTCUSDT SHORT(entry 77156.3): unrealized +0.85% raw / +1.70% lev — **PnL 양호**, 다만 native stop(77798.1)은 -0.83% raw 손절선.
   - DOGEUSDT SHORT(entry 0.0984): unrealized +1.68% raw / +3.35% lev — **PnL 양호**, 다만 native stop(0.09825)은 +0.15% raw 보장선.
   - 두 포지션 모두 현재 수익 상태이나, 정책상 1.65% 레버리지 보장을 만족하는 수준까지 stop을 끌어당기지 못한 상태. egress timeout 해결 후 exit-worker가 자동으로 stop을 floor(BTC 76519.76 / DOGE 0.0975882) 수준으로 이동해야 함.

### 해결 (2026-04-18 ~09:45 UTC)

CEO가 **(B)** 경로 선택: BTCUSDT + DOGEUSDT 포지션 수동 청산.

- 청산 직후 gate 재실행 결과:
  ```
  {"ok":true,"reason":"EXIT_INTEGRITY_DEPLOY_GATE_PASS",
   "summary":{"status":"OK","live_gate_blocked":false,
              "live_issue_count":0,"actionable_live_issue_count":0, ... }}
  ```
- 검증 빌드: `87d8902d-78f2-4533-a06b-2ec477928146` (`--branch=master`) 실행.
  - 주의: master는 아직 구버전 `cloudbuild.yaml` (74줄). 빌드가 통과해도 구버전 config로 배포됨.
  - master 동기화는 PR #6 (`sync/master-cloudbuild-20260418` → `master`)에서 처리.

### 잔존 follow-up (별도 조사)

**egress write-path 타임아웃은 미해결** — 포지션이 flat이라 당장 배포는 막지 않으나, 다음 live 트레이딩 재개 전 반드시 해소 필요:

- 현상: `donbeolja-exit-worker` → `donbeolja-egress-private` (public *.run.app URL) 호출이 20초 타임아웃.
  - 새 revision `00763-tgz` (2026-04-18 09:19:13 start) 에서도 4분 만에 동일 타임아웃 재발 → **stale DNS/connection pool 가설 기각**.
  - 타임아웃된 request_id (`EGR__1776504889696__89a913af` 등)가 `donbeolja-egress-private` 인바운드 로그에 **전혀 없음** → exit-worker 컨테이너 레벨에서 요청이 drop됨.
  - `donbeolja-egress-private` 자체는 다른 호출자에게 SUMMARY 로그 생산 중 (정상 서빙).
  - 직접 curl (public URL → `x-egress-token` 헤더) 은 167ms 정상 200 응답.
- 확인된 정상 항목:
  - `ingress: all`, IAM `allUsers → run.invoker` (public) ✓
  - `EGRESS_PROXY_BINANCE_PRIVATE_URL`, `EGRESS_PROXY_TOKEN`, `BINANCEFUT_API_KEY/SECRET` 모두 exit-worker에 주입 확인 ✓
  - VPC connector — 필요 없음 (public URL 호출).
  - 컨테이너 CPU/memory 1/1Gi (부족 경고 없음).
- 가설 (미검증):
  - Node.js `undici` fetch 에서 특정 TLS/HTTP 에이전트 설정이 Cloud Run 내부 routing과 충돌.
  - Cloud Run 내부 service-to-service mesh에서 특정 경로만 비정상.
  - exit-worker 컨테이너 내부에서 `fetchBinanceFuturesAccount` 호출 경로에 알 수 없는 블로킹 코드.

- 재현 중단 조건: 현재 exit-worker의 reconciler 루프가 계속 호출 → 매 ~20-25초 타임아웃 로그. 포지션이 flat이라 실제 손실은 없음.
- 다음 세션에서 착수: 코드 레벨 디버그 로그 추가 (`fetch()` 앞뒤에 DNS lookup / TLS 시작 log) → 재배포 → 로그 분석.

---

## 2026-04-18 ~10:45 UTC — master sync + 즉시 revert 기록

### 전개

1. **10:05 UTC**: PR #6 머지로 master `cloudbuild.yaml` 74 → 120줄 동기화, auto-trigger 발동 (build `9c4c5f8c`).
2. **10:07 UTC**: build `9c4c5f8c` **FAILURE** (step 1, ~2분 만에).
   ```
   npm error Missing script: "check:simplified-exit-v2-gate"
   ```
3. **원인 진단**:
   - master의 `package.json` 에는 3개 check 스크립트만 존재 (`check:binance-exec-safety`, `check:scheduler-env`, `check:dup-helpers`).
   - 120줄 `cloudbuild.yaml` 이 추가로 요구하는 스크립트 — `check:binance-exit-integrity-gate`, `check:simplified-exit-v2-gate` — 는 통합 브랜치 `codex/google-grade-ml-cutover-20260411` 에만 존재.
   - 이 스크립트들을 master로 개별 cherry-pick 하려면 src/ 하위 수백 파일을 함께 가져와야 함 (PR #3, 855 files / +136k / -75k, 현재 `CONFLICTING`).
4. **10:43 UTC**: PR #7 생성 (PR #6 revert).
5. **10:44 UTC**: PR #7 머지, auto-trigger 발동 (build `6e9f3942`).
6. **10:46 UTC**: build `6e9f3942` 도 **FAILURE** (step 3, Cloud Run deploy).
   ```
   ERROR: (gcloud.run.deploy) Cannot update environment variable [WEBHOOK_TOKEN]
   to string literal because it has already been set with a different type.
   ```
7. **2차 진단**:
   - 74줄 구 config 는 `WEBHOOK_TOKEN` 을 `--set-env-vars` literal 로 지정.
   - 그러나 live `donbeolja` 서비스의 `WEBHOOK_TOKEN` 은 secret (`DONBEOLJA_WEBHOOK_TOKEN:latest`) 으로 설정돼 있음 (과거 수동 `--update-secrets` 결과).
   - Cloud Run은 동일 env var 를 literal ↔ secret 으로 전환하는 것을 거부.
   - → **revert 후에도 master auto-trigger 는 deploy 단계에서 실패**.

### 결론

트리거 flip 자체는 올바른 방향이지만, master 브랜치가 통합 브랜치와 구조적으로 drift 돼 있어 **어느 방향으로도 master 의 자동 배포는 작동하지 않음**.

| 상태                              | master push → 자동 빌드 결과                       |
| --------------------------------- | -------------------------------------------------- |
| 트리거 auto-gen (flip 이전)       | ✅ 성공 (env 무시, 1개 서비스만 deploy)            |
| 트리거 filename + master 74줄     | ❌ WEBHOOK_TOKEN literal/secret 충돌                |
| 트리거 filename + master 120줄    | ❌ 누락 npm script (check:simplified-exit-v2-gate)  |

### 운영 정책 (PR #3 머지 전까지)

1. **master 에 직접 push 금지**. 어떤 커밋이든 auto-trigger 가 실패함.
2. **모든 배포는 통합 브랜치 수동 트리거 경유**:
   ```bash
   gcloud beta builds triggers run db7cd873-8927-419d-a232-855648b727f5 \
     --project=donbeolja-dev \
     --branch=codex/google-grade-ml-cutover-20260411
   ```
3. **긴급 env 변경**은 `gcloud run services update --update-secrets=...` / `--update-env-vars=...` 로 수동 반영 (반드시 cloudbuild.yaml commit 동반).
4. **근본 해결**: PR #3 (`codex/google-grade-ml-cutover-20260411` → `master`) conflict 해소 + 머지. 이때 비로소:
   - master `package.json` 이 모든 check 스크립트 보유
   - master `cloudbuild.yaml` 의 `WEBHOOK_TOKEN` secret 전환 반영
   - 4 개 서비스 자동 deploy + gate 체크 완비

### 참고 commit / PR

- PR #6 (머지됨, reverted): `sync/master-cloudbuild-20260418` → master (merge commit `572c5151`)
- PR #7 (머지됨): revert of PR #6 (merge commit `6641e677`)
- PR #3 (open, CONFLICTING): `codex/google-grade-ml-cutover-20260411` → master — **이 PR 이 실제 unblocker**

### 트리거 자체는 유지

`gcloud beta builds triggers describe db7cd873-8927-419d-a232-855648b727f5` 확인 시 `filename: cloudbuild.yaml` 모드 **그대로 유지**. 이 flip 은 revert 하지 않음 — PR #3 머지 후 즉시 그 혜택을 가져가기 위함.

롤백이 필요하면:
```bash
gcloud beta builds triggers import \
  --project=donbeolja-dev \
  --source=/tmp/dbj-trigger-backup/trigger-original-20260418-175332.yaml
```
