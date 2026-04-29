# Codex 인계 핸드오프 — 2026-04-30

> 본 문서는 Claude → Codex 인계용 시스템 종합 안내. 한 번 읽고 (1) 품질 검사 → (2) production 검증 → (3) 후속 개발 진입할 수 있도록 작성.

---

## 0. TL;DR (60초 요약)

- **시스템**: `donbeolja` (돈벌자) — Binance Futures USDT-M 자동매매 봇. Pine v6.1.1.0 strategy의 server-native port.
- **운영 상태**: Cloud Run on GCP `donbeolja-dev`. V1→V2 cutover 진행 중 (현재 V2 DISCOVERY_CANARY phase).
- **이번 세션 (2026-04-29 ~ 04-30) 결과**:
  - **P0 hotfix 5건** (A/D/E/G/H) + **Step 1/2** (cron route + sibling consolidation)
  - **P1-1.x 리팩터링 21단계** (paperBinanceRunner.js 분리)
  - **Production stale cycle 43건 수동 정리**
- **현재 production state**: latest revision `donbeolja-01664-k4g` (build `5142cce5`). P0-fix-H/Step 2 빌드 진행 중일 수 있음 (commit `8ff7a6da` 가 최신 master).
- **즉시 검증 필요**:
  - P0-fix-H 빌드 통과 + 신규 8 코인 (WLD/TAO/ARB/INJ/SUI/AAVE/SAND/TIA)에 entry 발생 시작
  - DOGE TP1 50% 사고 유발한 BE buffer + broker-truth priority 효과 확인 (trade 발생 후)

---

## 1. 시스템 아키텍처 (수석급 설명)

### 1.1 운영 스택

```
┌──────────────────────────────────────────────────────────────────┐
│                    Cloud Run (asia-northeast3)                   │
│                                                                  │
│   donbeolja           donbeolja-exit-worker     donbeolja-egress │
│   (signal+entry)      (tick-exit fastlane)      (geo-proxy)      │
│   minScale=1          minScale=1                ─                │
│   maxScale=1          maxScale=1                                 │
│                                                                  │
│   POST /api/openclaw/cron/* ← Cloud Scheduler                    │
└──────────────────────────────────────────────────────────────────┘
        │                    │                          │
        ▼                    ▼                          ▼
┌──────────────┐    ┌──────────────┐       ┌────────────────────┐
│  Firestore   │    │  Firestore   │       │  Binance Futures   │
│  (V1 paper)  │    │  (V2 docs)   │       │  fapi.binance.com  │
└──────────────┘    └──────────────┘       └────────────────────┘
```

- **3 서비스, 동일 image** (`gcr.io/donbeolja-dev/donbeolja:latest`). 단일 cloudbuild가 동시 deploy.
- **Geo-block**: Cloud Run IPs는 `fapi.binance.com`에서 차단됨. **모든 Binance API 호출은 `donbeolja-egress` 통해야 함**. 직접 fetch 시 `TypeError: fetch failed` 발생 (P0-fix-E 사례).

### 1.2 Single-instance pin (P0-1)

- 양 서비스 모두 `min/maxScale=1` (cloudbuild.yaml 124-128 / 184-188).
- 이유: WS user-data stream lease를 Firestore-backed 로 관리 → 다중 인스턴스 시 매 30-60초마다 `LEASE_LOST` ping-pong 발생 (실측 167건/24h).
- 단점: deploy churn 자체가 LEASE_LOST 단기 유발. 빌드 횟수가 많을수록 누적.

### 1.3 V1 → V2 cutover

12개의 환경 flag로 단계별 통제 (`src/config/v2RuntimeMode.js` — P1-3.1에서 단일 phase 분류기로 통합):

| Phase | 의미 | 현재 |
|---|---|---|
| `DISCOVERY_CANARY` | V2 ON, real broker, canary 한도 안 (notional 6 USDT 등) | ✅ **현재** |
| `PRODUCTION_FULL` | 동일 stance, canary_only=false | 미래 |
| `PAUSED` | V2 off + V1 fully disabled | 비상시 |
| `UNKNOWN` | 12-flag matrix 부정합 | ⚠️ 알람 |

핵심 환경값 (cloudbuild.yaml `_DONBEOLJA_V2_*`):
- `DONBEOLJA_V2_ENABLED=1`
- `DONBEOLJA_V2_DRY_RUN=0` (실거래)
- `DONBEOLJA_V2_CANARY_ONLY=1`
- `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` (V1 차단)
- `DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED=1`
- `DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=1`
- `DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED=1`
- `DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED=1`

### 1.4 Signal flow (V2 Discovery Canary)

```
Cloud Scheduler (cron)
  → POST /api/openclaw/cron/openclaw-server-primary-tick
    → marketRunner.runOneMarket(exchange, symbol, tf="15m")
      → refreshLatestBarSnapshot(tf="15m")  ─ entry-tf bars warmup (P0-fix-H, 220 bars)
      → refreshLatestBarSnapshot(tf="240m") ─ HTF bars (P0-fix-A, 70 bars)
      → generateV2EntrySignals(symbol, signalTf, htfBars, executionTf)
        ├─ computeHtfBias (htfBars → BULL/BEAR/NEUTRAL)
        ├─ no-trade gate (spread, mark-index gap, funding)
        ├─ setup gate (PULLBACK_RECLAIM, etc.)
        ├─ trigger gate (volume z-score, RSI)
        ├─ expected-edge gate (gross R, net R after cost)
        └─ verdict: PASS / FAIL → signal_score 0-100
      → if PASS: entrySubmitter.placeProtectedEntry(...)
        → broker write: entry market order + native SL + native TP1
        → Firestore write: position_cycle ACTIVE_PROTECTED + projection
```

### 1.5 Exit flow (V2)

```
Tick (every 15s) → binanceTickExit.runTick
  ├─ fetchBinanceFuturesPrices ─ multi-symbol mark price (P0-fix-E: egress proxy)
  ├─ getBrokerPositionSnapshot ─ broker = truth (P0-4 helper, 5s TTL cache)
  └─ for each ACTIVE_PROTECTED position:
       ├─ R3 cooldown (snapshot invalidation)
       ├─ R2 broker truth pre-filter (skip if isFlat)
       ├─ R1 in-flight inhibit (intent claim)
       ├─ resolveV2DirectDispatchAlertEvent (BE > TRAIL > SL > TP_P1 priority)
       ├─ computeBreakEvenRaiseDecision (BE buffer 0.10% — bfa9e3eb)
       └─ if exit decided: place close order + alert dispatch
```

핵심 안전 invariant:
- **broker = truth**: Firestore가 stale이어도 broker가 정답. P0-3에서 `validateProtectionActivationResult` 가 broker truth를 8-check evidence보다 우선 사용하도록 변경.
- **BE+TRAIL 동시 트리거 방지**: BE_PCT 위 (close-px > avg×(1+BE+buffer)) 일 때만 BE 발동. fraction=1 (full close) 막음 — 04-29 DOGE 사고 root cause.

### 1.6 코드베이스 형상

```
src/
  engine/
    paperBinanceRunner.js       # 20,350 LOC (1차 추출 후 −354 LOC). 거대한 파일
                                 # V1 스케줄러 + V2 entry/exit 통합 중심
    signalEngine.js             # exit-rule 결정, runner-floor 등
  scheduler/
    marketRunner.js             # 16 symbols × 15m tick. P0-fix-H bars warmup 추가
    scheduler.js                # tick orchestrator
  v2/
    entrySubmitter.js           # V2 entry placement + broker-truth priority (P0-3)
    serverEntrySignalGenerator.js # F2 generator (220 bars/15m + 70 bars/240m 필요)
    canonicalExitReducer.js     # exit transition state machine
    exitRuntimeCanary.js        # hourly health canary (P0-fix-D limit 100)
    runtimeChainAudit.js        # 8-check evidence
  services/
    binanceTickExit.js          # 4,000+ LOC. tick-exit fastlane
    brokerPositionTruth.js      # P0-4 helper module (single broker snapshot)
    binancePositionReconciler.js # FLAT_STALE_BREACH detection (alarm only)
    tradeExecutionAlert.js      # alert dispatch (telegram/slack)
  utils/
    *.js                        # 22 helper modules (P1-1.x 추출본 21개)
  routes/
    openclaw.cron.routes.js     # Cloud Scheduler 엔드포인트
    webhook.routes.js           # TradingView webhook receiver (legacy V1)
    egress.proxy.routes.js      # Binance API geo-proxy
  exchanges/
    binanceFutures.js           # public API + tfToBinanceInterval (P0-fix-A, P0-fix-E)
    binanceFuturesPrivate.js    # signed API
  storage/
    positionsPaper.js           # V1 positions doc + lease/token enforcement
    positionRuntimeObservations.js
    bars.js                     # bars_snapshots (15m, 240m 등)

scripts/
  cleanup-stale-active-protected-cycles.js  # P0-fix-G one-shot tool
  run-v2-exit-runtime-canary.js              # cron worker
  ...
```

### 1.7 핵심 design 원칙

1. **Broker = Truth**: Firestore는 cache. 충돌 시 broker 우선.
2. **8-check evidence**: V2 entry 활성화 전 8 항목 (chain audit, runtime doc, activation commit, write decision 등) 모두 PLACED 확인. P0-3 이후 broker truth 가 evidence를 override할 수 있음.
3. **Fail-closed gates**: 모든 deploy 전 `check-binance-exit-integrity-gate` 검증 (live position issue 0건이어야 PASS). authority_actionable_live_issue_position 1건이라도 있으면 deploy 차단.
4. **single-source-of-truth**: 동일 helper 다중 사본 누적 → audit-significant. P1-1.x 추출본은 leaf 모듈로 다른 파일에서 import.

---

## 2. 이번 세션 변경사항 (시간순)

### 2.1 P0 hotfix 시리즈

| Fix | Commit | Production 효과 |
|---|---|---|
| **bfa9e3eb** | BE noise-buffer + alert classification (BE > TRAIL > SL > TP_P1) | DOGE TP1 50% → 100% 청산 root cause 차단 |
| **0a10a2db** | P0-1: donbeolja main service single-instance pin | LEASE_LOST ping-pong 차단 |
| **9ec7457a** | P0-2: V1 marketRunner cutover guard 제거 | V1 dead code 정리 |
| **f2d334f2** | P0-3: protection broker-truth priority | POST_FILL_PROTECTION_CRITICAL race 차단 |
| **60dd243c** | P0-4: brokerPositionTruth helper module | broker snapshot cache coherence |
| **ff2f5b00** | **P0-fix-A**: tf=240→4h Binance interval | F2 generator HTF cache 24h+ silent broken 해소 |
| **16d16cda** | **P0-fix-D**: canary active position limit 25→100 | exit-runtime-canary cron 500 해소 |
| **6481689d** | **P0-fix-E**: fetchBinanceFuturesPrices egress proxy routing | V2 Exit Worker tick-exit `fetch failed` 차단 |
| **a37ff8be** | **P0-fix-G**: stale cycle cleanup tool + 43건 apply | deploy gate 통과 가능 |
| **152a49f7** | **P0-fix-H**: 신규 코인 220-bar warmup | 신규 8 코인 entry 가능 (배포 대기) |

### 2.2 Refactor + audit

| 단계 | Commit | 내용 |
|---|---|---|
| P1-1.1 ~ 1.21 | 21 commits | paperBinanceRunner.js → 21 leaf util module로 분리. 20704 → 20350 LOC |
| P1-3.1 | 06acb4b0 | 12개 V2 cutover flag → 단일 phase resolver |
| **Step 1** | **2479c916** | recurring stale-cycle cleanup cron route (apply gated by env) |
| **Step 2** | **8ff7a6da** | normalizeTpP1EventForExchange 4-variant → 1 canonical |

### 2.3 새 도구 / 모듈 (재사용 가능)

- `scripts/cleanup-stale-active-protected-cycles.js` — diagnose + apply CLI
- `src/utils/qtyCalculation.js` (5 fn + POS_SIZE_EPSILON)
- `src/utils/eventNamePredicates.js` (3 fn)
- `src/utils/tradingActionEnums.js` (4 fn)
- `src/utils/runtimeConfigParsers.js` (4 fn)
- `src/utils/binanceMarginType.js` (3 fn)
- `src/utils/signalTypeNormalization.js` (3 fn) ← Step 2 canonical
- `src/utils/futuresExitProfileMode.js` (2 fn)
- `src/utils/openClawCohort.js` (2 fn)
- `src/utils/alertNumberFormat.js` (3 fn)
- `src/utils/liveInfraRetry.js` (3 fn)
- `src/utils/runnerScalarHelpers.js` (3 fn)
- `src/utils/signalFeaturePickers.js` (5 fn)
- `src/utils/signalClaimHelpers.js` (2 fn)
- `src/utils/oppositeCooldownWindow.js` (3 fn)
- `src/utils/tp1LadderKpiHelpers.js` (4 fn)
- `src/utils/exitEventPctToken.js` (1 fn)
- `src/utils/priceMathHelpers.js` (3 fn)
- `src/utils/sameDirectionTrailProfitCooldown.js` (6 fn)
- `src/utils/runnerObjectHelpers.js` (4 fn)
- `src/utils/barTfHelpers.js` (3 fn)
- `src/utils/channelList.js` (2 fn)
- `src/utils/exchanges/index.js → tfToBinanceInterval` ← P0-fix-A 신규

---

## 3. Codex 진입 시 품질 검사 절차 (단계별)

> **목표**: 시스템이 의도한 대로 작동하는지 5분 내 확인.

### Step A. Local sanity (2분)

```bash
# 1) Tree clean (commit이 모두 push 됐는지)
git status                       # → "nothing to commit"
git log --oneline -5             # → 8ff7a6da 가 latest 여야 함

# 2) Full npm test (642 test files; ~3분)
npm test 2>&1 | tail -5
#  → 마지막 라인 EGRESS_PROXY_PRODUCTION_STARTUP_GUARD_TEST_OK
#  → exit code 0

# 3) 핵심 모듈 로드 확인
node -e "require('./src/engine/paperBinanceRunner.js'); console.log('OK')"
node -e "require('./src/services/binanceTickExit.js'); console.log('OK')"
node -e "require('./src/scheduler/marketRunner.js'); console.log('OK')"
node -e "require('./src/v2/entrySubmitter.js'); console.log('OK')"
```

### Step B. Production deploy state (3분)

```bash
# 4) Cloud Build 최근 빌드 (P0-fix-H + Step 2가 SUCCESS인지)
gcloud builds list --limit=3 \
  --format="table(id,status,substitutions.SHORT_SHA,finishTime)"
#  → 8ff7a6d (Step 2) SUCCESS 가 최신
#  → 152a49f7 (P0-fix-H) SUCCESS

# 5) Cloud Run latest revision (build_id가 위 SUCCESS와 매칭)
gcloud run revisions list --service=donbeolja --region=asia-northeast3 \
  --limit=2 --format="value(metadata.name,metadata.labels.gcb-build-id)"
gcloud run revisions list --service=donbeolja-exit-worker --region=asia-northeast3 \
  --limit=2 --format="value(metadata.name,metadata.labels.gcb-build-id)"
gcloud run revisions list --service=donbeolja-egress --region=asia-northeast3 \
  --limit=2 --format="value(metadata.name,metadata.labels.gcb-build-id)"
#  → 3 서비스 모두 동일 build_id 여야 함

# 6) 4가지 핵심 알람 0건 확인 (배포 후 30분+)
gcloud logging read 'resource.type="cloud_run_revision"
  timestamp>="2026-04-30T00:00:00Z"
  textPayload=~"snapshot_refresh_fail.*tf=240(m)?\b|tick-exit 실패|TypeError.*fetch failed"' \
  --limit=5
#  → 0건 (P0-fix-A + P0-fix-E 효과)

# 7) 신규 코인 entry 발생 시작 확인 (P0-fix-H 효과, 배포 후 1-2시간)
gcloud logging read 'resource.type="cloud_run_revision"
  timestamp>="2026-04-30T00:00:00Z"
  jsonPayload.event="entry_tf_bars_warmup_triggered"' \
  --limit=20 \
  --format="value(timestamp,jsonPayload.symbol,jsonPayload.existing_bars_n)"
#  → 신규 8 코인이 적어도 한 번씩 backfill 트리거되어야 함
```

### Step C. Stale cycle 자연 정리 검증 (선택)

```bash
# 8) Stale cleanup script diagnose (mutation 없음)
DONBEOLJA_V2_COLLECTION_PREFIX="v2__" \
  node scripts/cleanup-stale-active-protected-cycles.js | tail -20
#  → "stale_broker_flat_n": 0 이어야 정상
#  → 만약 > 0 이면, 다시 stale 누적 중 — Step 1 cron 활성화 검토
```

### Step D. P0-3/P0-4 효과 검증 (trade 발생 후)

```bash
# 9) 새 ENTRY signal/trade 발생 여부
gcloud logging read 'resource.type="cloud_run_revision"
  timestamp>="2026-04-30T00:00:00Z"
  jsonPayload.event="v2_signal_criteria_evaluated"
  jsonPayload.verdict="PASS"' \
  --limit=10 \
  --format="value(timestamp,jsonPayload.symbol,jsonPayload.signal_score)"

# 10) Broker-truth degraded event (P0-3 효과 — 0건이어야 정상)
gcloud logging read 'resource.type="cloud_run_revision"
  timestamp>="2026-04-30T00:00:00Z"
  jsonPayload.event="v2_entry_protection_evidence_quality_degraded"' \
  --limit=5
```

---

## 4. 후속 개발 우선순위 (Codex 진입 후)

### P0 (배포 검증 후 즉시)

- [ ] **P0-fix-H 효과 확인**: 신규 8 코인 (WLD/TAO/ARB/INJ/SUI/AAVE/SAND/TIA) bars 220+ 도달 + entry signal 생성 시작
- [ ] **DOGE TP1 사고 재현 방지 검증**: 새 trade 발생 시 BE buffer + broker-truth priority 정상 작동 확인
- [ ] **canary cron 200 OK**: 다음 시간 단위 cron run에서 `authority_actionable_live_issue_position_n=0` 확인

### P1 (1주 안)

- [ ] **Reconciler auto-cleanup 통합**: Step 1 cron route는 manual trigger 필요. 매 reconciler tick에서 broker=FLAT 확인 후 자동 status:CLOSED 전환 (HARD: V1 reconciler hot path 영향 큼)
- [ ] **Sibling consolidation Step 4**:
  - `parseChannelList`/`filterTelegramChannels` × 6 sites — body 변형 다양 (deep-dive 필요)
  - `sleepMs` × 2 sites (aiSignalGuard.js, newsFetch.js) — byte-identical
  - `normalizeOpenClawCohort` × 1 site (signalEngine.js) — byte-identical
  - `ratioToPctTokenLocal` × 1 site (binanceTickExit.js) — byte-identical
- [ ] **Production verification 자동화**: 위 Step C/D를 cron으로

### P2 (옵션)

- [ ] paperBinanceRunner.js 추가 분리 (P1-1.22+) — 현재 20350 LOC → 더 작은 cohesive group 추출
- [ ] V1 dead code 제거 — `legacy_runtime_disabled` 가드 더 깊게
- [ ] Strategy/Execution 분리 (P2-1) — 큰 architectural work

### 알려진 Audit follow-up

1. **신규 코인 60m bars=0**: F2는 15m+240m 사용이라 영향 없음. 다른 cron 경로가 60m backfill 안 함.
2. **SUI 예외**: 신규인데 250 bars 보유. 다른 cohort로 추가됐을 가능성.
3. **Reconciler stale 알람**: `RECONCILER_FLAT_STALE_BREACH`만 발생, auto-cleanup 없음.
4. **`clamp` × 11 sites**: signature variants 존재, 통합 high-risk.
5. **`normalizeBool/Int/Number` × 100+ usages**: 통합 매우 high-risk.

---

## 5. 자주 쓰는 운영 명령

```bash
# 빌드 트리거 (수동)
git commit --allow-empty -m "trigger rebuild" && git push

# 특정 SHA 빌드 상태
gcloud builds list --filter="substitutions.SHORT_SHA:<7글자>" --limit=1

# 빌드 로그
gcloud builds log <build-id> | tail -100

# 최근 production 알람
gcloud logging read 'severity>=ERROR timestamp>="2026-04-30T00:00:00Z"' \
  --limit=20 --format="value(timestamp,textPayload)"

# Stale cycle apply (production mutation)
DONBEOLJA_V2_COLLECTION_PREFIX="v2__" \
  node scripts/cleanup-stale-active-protected-cycles.js --apply

# 특정 symbol 활동 확인
gcloud logging read 'jsonPayload.symbol="WLDUSDT" timestamp>="2026-04-30T00:00:00Z"' \
  --limit=20 --format="value(timestamp,jsonPayload.event)"

# Cron 수동 트리거 (Cloud Scheduler 토큰 필요)
curl -X POST https://donbeolja-4ljfegivrq-du.a.run.app/api/openclaw/cron/v2-stale-cycle-cleanup \
  -H "X-Scheduler-Token: $SCHEDULER_TOKEN"
```

---

## 6. 위험 신호 (Codex가 보면 즉시 alert)

| 신호 | 의미 | 조치 |
|---|---|---|
| `LEASE_LOST` 100건/24h+ | deploy churn 또는 multi-instance | minScale=maxScale=1 확인, 필요시 deploy 동결 |
| `snapshot_refresh_fail.*tf=240` | P0-fix-A 회귀 | `tfToBinanceInterval` 확인 |
| `TypeError: fetch failed` (binanceTickExit) | P0-fix-E 회귀 | 누군가 bare fetch 추가했음 |
| `authority_actionable_live_issue_position_n > 0` | deploy gate block | stale cycle cleanup 실행 |
| `RECONCILER_FLAT_STALE_BREACH` 빈발 | stale ACTIVE_PROTECTED 누적 | cleanup script apply |
| `EXIT_RUNTIME_CANARY_ACTIVE_QUERY_LIMIT_REACHED` | 100+ active position | 진짜 leak — 즉시 audit |
| `POST_FILL_PROTECTION_CRITICAL` | broker-truth priority 회귀 | P0-3 변경 확인 |
| TP1 50% close인데 size 100% 가는 fill | BE+TRAIL 동시 트리거 | bfa9e3eb BE buffer 확인 |

---

## 7. 비상 절차

```bash
# Trade 즉시 중단 (PAUSED phase 전환)
# cloudbuild.yaml에서:
#   _DONBEOLJA_V2_ENABLED: "0"
#   _DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1"
#   _DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1"
# 후 push → 다음 빌드에서 적용

# 특정 revision 롤백
gcloud run services update-traffic donbeolja \
  --region=asia-northeast3 \
  --to-revisions=donbeolja-01663-hfr=100

# Stale Firestore 강제 close (broker truth 검증 후)
DONBEOLJA_V2_COLLECTION_PREFIX="v2__" \
  node scripts/cleanup-stale-active-protected-cycles.js --apply
```

---

## 8. 참고 문서 / 이전 commit 메시지

각 commit message에 자세한 설명 + audit follow-up 명시. 특히:

- `bfa9e3eb` (BE buffer) — DOGE 사고 root cause + 수정 원리
- `f2d334f2` (P0-3) — broker truth priority decision matrix
- `60dd243c` (P0-4) — broker snapshot cache coherence
- `ff2f5b00` (P0-fix-A) — tf=240 → 4h **two-keyed contract** 설명 (storage doc-id vs Binance interval)
- `6481689d` (P0-fix-E) — 04-19 ETHUSDT blackout 패턴 + 3-leg fix
- `a37ff8be` (P0-fix-G) — stale cleanup safety contract (3-classification, hard caps)
- `152a49f7` (P0-fix-H) — F2 generator 220-bar requirement + warmup pattern
- `8ff7a6da` (Step 2) — sibling consolidation 시니어 결정 + production-equivalence proof

**`git log --oneline | head -40` 으로 최근 35건 commit 메시지 모두 읽기를 강력 권장**.

---

## 9. 사용자 컨벤션

- **언어**: 한국어 응답 (사용자 강력 요구). 영어 사용 시 짜증냄.
- **시각**: 30년 senior quant trader/developer. "근본 수정" (root cause fix) 강조. Patch/band-aid 싫어함.
- **자율성**: "알아서 진행" 지시 자주 — 단, 의미 있는 결정점에서는 confirm 받음.
- **세션**: 컨텍스트 회복 (`Compact summary`) 사용 — 핸드오프 시 세션이 길어지면 자주 발생.

---

**핸드오프 작성 완료**. Codex가 이 문서 + Step A~D 품질검사 + 최근 commit message 35개 읽으면 5-15분 내 컨텍스트 동기화 가능. 후속 개발은 §4 우선순위대로.
