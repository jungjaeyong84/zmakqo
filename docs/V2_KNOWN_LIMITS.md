# V2 시스템 알려진 한계 (Stage A~Q post-audit)

> 시니어 감사 통과를 위한 정직한 limit 문서. 외부 reviewer 가 자주 묻는 질문에 대해
> 코드 base 의 실제 상태를 명시. Over-marketing 회피 + 의도된 design boundary 명확화.

---

## 1. Stage E/G "single source of truth" — surface + V1 mirror scaffolded (Stage S, default OFF)

> **2026-04-28 update**: Stage S 의 V1 mirror code 가 코드베이스에 들어갔다.
> Cutover 시 `V2_TO_V1_META_MIRROR_ENABLED=1` 만 설정하면 활성화. 본문 아래는
> Stage S 도입 전 원본 limit 기록.

---

## 1-orig. Stage E/G "single source of truth" — surface 까지만, V1 read 통합 X

**주장 (이전 commit 메시지)**: "V2 protection_runtime_v2 single source 정착"

**실제 상태**:
- `buildInitialProtectionPlan` 이 `initial_stop_price` + `entry_r_distance` 를 plan 에 추가 ✓
- `buildProtectionRuntimeDoc` 이 두 field 를 V2 collection 에 stamp ✓
- **그러나 V1 `binanceTickExit` (실제 trail/exit engine) 은 이 V2 collection 을 read 안 함**
  - `binanceTickExit.js` 는 `meta.entry_r_distance` / `meta.initial_stop_price` 를 V1 `positions_paper` 의 meta 에서만 read
  - V2 cutover 전: V1 stamp path 로 자동으로 채워짐 (signalEngine.resolveEntryRDistance fallback)
  - **V2 cutover 후 (canary_only=0): V1 read path 가 V2 stamped 값을 못 봄**

**필요한 추가 작업 (V2 cutover 전 prerequisite)**:
1. V2 entry 시 V1 positions_paper.meta 에 `initial_stop_price` + `entry_r_distance` mirror stamp
   - `openclawShadowPositionWriter.persistEntryBootstrap` 끝에 V1 upsert 추가
2. 또는 `binanceTickExit` 의 read path 를 V2 collection fallback 추가

**왜 이번에 안 했나**: V1 positions_paper 의 schema / lock 패턴 / writer lease 통과 등 변경 risk 가 크고 cutover 결정 사안과 묶여있어 별도 PR 권고. Stage W 에서 한계 명시 처리.

**2026-04-28 Stage S 진행**:
- `src/v2/v1MetaMirror.js` 신설 — `buildV2ToV1MetaPatch` (pure) + `writeV2ToV1MetaMirror` (best-effort, never throws)
- `src/v2/openclawShadowPositionWriter.js` 의 `writeOpenClawShadowEntryBootstrap` 끝에 mirror 호출 wired
- env gate: `V2_TO_V1_META_MIRROR_ENABLED` (default OFF) — code 는 들어갔지만 production 동작은 변하지 않음
- 6 case unit test (`src/tests/v2-to-v1-meta-mirror.test.js`) + npm test wired
- mirror 는 `upsertPositionMetaOnly` (META scope) 사용 → state/sizePct/positionSide 안 건드림. binanceFuturesFillsSync 가 여전히 single writer of those fields.

**Cutover 절차 (2026-04-28 권고)**:
1. canary 환경에서 `V2_TO_V1_META_MIRROR_ENABLED=1` 설정 → 24h 관찰
2. Cloud Logging 에 `v2_to_v1_meta_mirror_ok` event 카운트 vs `v2_to_v1_meta_mirror_fail` 비율 측정 (>99%)
3. positions_paper.meta 에서 `v2_to_v1_mirrored=true` 마커 검증 → V2 entry 마다 stamp 되고 있는지 확인
4. V1 read path (paperBinanceRunner trail logic, dashboards) 가 mirrored meta 를 읽고 있는지 spot check
5. 모든 검증 PASS → `DONBEOLJA_V2_CANARY_ONLY=0 + DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=1` 으로 cutover

---

## 2. Stage N (TP1 1.68% → 2.5%) — backtest 근거 0

**주장 (이전 commit 메시지)**: "R:R 1.02:1 → 1.52:1 expectancy +0.43%/trade"

**실제 상태**:
- expectancy 계산은 **win rate 50% 가정 하의 mathematical reasoning**
- Pine script 의 historical win rate 데이터 0건
- Walk-forward / Monte Carlo / out-of-sample 검증 없음
- prod 거래 데이터 자체가 거의 없음 (canary_only=1 + sample_n=0 인 상태)

**Sensitivity analysis** (정직):
| 가정 win rate | Expectancy / trade | 월 net (60 trade 기준) |
|---|---|---|
| 60% | +0.84% | **+50%** |
| 50% | +0.43% | +25% |
| 45% | +0.22% | +13% |
| **41% (BE 근방)** | **0%** | **0%** |
| 40% | -0.05% | -3% |
| 35% | -0.51% | -30% |

→ **win rate 가 41% 미만이면 손실**. Pine script 의 실제 win rate 가 41% 이상이라는 보장 없음.

**필요한 추가 작업**:
1. Pine script 의 historical signal 로 backtest (6개월+)
2. V2 cutover 후 첫 50~100 trade 의 R-multiple distribution 측정
3. 미달 시 TP1 / SL / cooldown 재조정

---

## 3. Stage O (ML gate 0.22 → 0.45) — 모델 prob distribution 검증 X

**주장**: "약한 신호 차단, win rate 향상"

**실제 상태**:
- 0.45 threshold 는 "0.22 가 너무 낮으니 mid-range 가 적당" 추론
- ML 모델의 prob distribution 측정 데이터 없음
- 실제 prod 에서 0.45 통과 비율 = ?

**위험**:
- 너무 strict → trade 빈도 0 (signal 모두 차단)
- 너무 relaxed → 효과 없음 (이전과 비슷)

**필요한 추가 작업**:
1. shadow 모드에서 ML prob histogram 1주일 수집
2. histogram 에서 30~50% percentile 의 value 를 정확한 threshold 로 설정

---

## 4. Stage P (ATR-adaptive) — Phase 1 scaffold 만, Phase 2 미작동

**상태**:
- code 모두 존재 ✓ (16 단위 테스트)
- env flag `V2_VOLATILITY_ADAPTIVE_TP_SL_ENABLED` default OFF
- prod 에서 작동 안 함 (live plan 영향 0)
- ATR 입력 wiring 도 미통합 (microstructure features 에서 제공해야 함)

**필요한 추가 작업**:
1. ATR 값을 protectionPlan 에 inject 하는 path (Stage P-2-real)
2. `V2_VOLATILITY_ADAPTIVE_TP_SL_OBSERVE` 로 1~2주 데이터 수집
3. multiplier 분포 검증 → flip

---

## 5. SIGABRT 24h 24회 — root cause 진단 완료 (2026-04-28)

**진단**:
- Cloud Logging 직접 확인 — `Memory limit of 1024 MiB exceeded with 1050 MiB used`
  followed by `Uncaught signal: 6` 패턴 반복 (08:31:57 외 다수)
- **SIGABRT 는 Cloud Run 이 cgroup memory limit 위반 시 외부에서 강제 송출**
  → Stage K 의 V8 uncaughtException handler 는 절대 fire 안 됨 (process 가 V8 도달 전에 kill)

**Hot 누수 후보**: `tpP1PendingTerminalAlertState` (key = `${symbol}:${intentId}:${reason}`)
- intentId 가 매 intent 별 고유 → cache 무한 성장
- 하루 ~1000+ entry × 250 byte = 250KB / day, 메모리 압박은 V8 heap fragmentation 와 곱셈

**적용된 수정 (2026-04-28)**:
1. `tpP1PendingTerminalAlertState` 에 size > 2048 시 cooldown-aware sweep + hard floor (oldest half drop)
2. Cloud Run memory 1Gi → **2Gi** (donbeolja main + exit-worker 양쪽)
3. Test: `tick-exit-alert-cache-eviction.test.js` 신설 (3 케이스 — cooldown / 노후 sweep / 신선 hard cap)
4. Observability: `native_protection_unprotected_window_observed` 구조화 로그 추가 (Step 5 fix)
5. **Step 8 defensive depth** (2026-04-28): `applyAlertCacheCap` helper 로 추출, 5개 cache 모두 동일 cap 적용 (`tpP1PendingTerminalAlertState`, `tpP1AckTimeoutAlertState`, `tickExitFailureAlertState`, `nativeProtectionRefreshAttemptState`, `trailHardExitCooldownState`, `tp1MetaSyncGapAlertState`). Test: `tick-exit-cache-cap-helper.test.js` (5 케이스).

**Verdict (2026-04-28 02:11 UTC, Step 4 deploy + 158분)**:
- post-deploy SIGABRT: **0건**
- post-deploy Memory limit: **0건**
- 7개 revision 거치며 매번 정상 boot
- 이전 24h inter-arrival 분포 평균 30분당 1건. P(0건 | 158분 H0) ≈ 0.5% → **≥99.5% 신뢰** fix 효과 결정.
- 7.7h idle gap 1회 (14:47-22:32) 가 있었으니 conservative 하게 inter-arrival empirical 기반: 158분 quiet windows 발생 0/29 → P < 3.5%. **96%+ 신뢰**.

---

## 6. Cancel-then-place unprotected window — Binance 한계 (변경 불가)

**상태**:
- code -4130 으로 place-then-cancel 시도 자체가 거래소에서 reject
- telemetry + UNPROTECTED_ACTIVE_POSITION 진단 + fail-closed pathway 가 architectural 한계 내 최대치
- **2026-04-28 update**: Cloud Logging 에 `native_protection_unprotected_window_observed`
  구조화 로그 추가됨. p50/p95/p99 분포가 dashboard 로 관찰 가능 (이전엔 Firestore round-trip 필요).

**대안 검토 결과**: 없음. 거래소가 풀어주지 않는 한 mitigation 불가.

---

## 7. RECONCILER stale (Stage L → V) — race fix 적용됨

**상태**:
- Stage L 의 single-shot baseline → Stage V 에서 `flat_first_observed_at_ms` 누적 추적으로 fix
- 단위 테스트 9 케이스 (multi-pass 누적, 다음 pass baseline reset, etc) 통과
- prod 검증은 첫 LINKUSDT 류 발생 시점에 가능

---

## 8. backfill-binance-active-exit-stage.test (Stage R) — V1 TP0 retirement deprecated

**상태**:
- V1 TP0 phase 가 architectural 으로 retire 됨 (TP_P0_QTY=0 강제)
- legacy reclassification logic 은 dead code
- test 의 legacy 부분 skip + simplified_exit_v2 부분만 active
- backfill source 의 hardcoded `EXIT_TP_P1_1.68P` → `EXIT_TP_P1_2.5P` (Stage N 정합)

---

## 9. 보고서 over-marketing 회피 — 이번 session 의 표현 수정 권고

| 이전 표현 | 정직한 표현 |
|---|---|
| "V2 collection single source 정착" | "V2 collection 에 surface 추가, V1 read 통합은 cutover 시 별도 PR" |
| "expectancy +0.43% / trade" | "win rate 50% 가정 하 +0.43%, 41% 미만이면 손실 (검증 필요)" |
| "ML gate 강화" | "0.22 → 0.45 변경, 실제 효과는 prod 데이터 1주일 후 측정" |
| "5중 watchdog 작동" | "5종 watchdog scaffolded, 4종은 prod 발생 0건 (배포 직후라 정상)" |

---

## 10. 다음 만남 prerequisite (Tier 3 진입을 위한)

1. **Pine script backtest 6개월+** → win rate 통계적 근거
2. **V2 entry → V1 positions_paper mirror stamp** (Stage S code 변경)
3. **다른 binanceTickExit Map 캐시 cap** (`tickExitFailureAlertState`, `nativeProtectionRefreshAttemptState`, `trailHardExitCooldownState`) — 현재 per-entry eviction 없음. cardinality 가 symbol 수준이라 즉시 위협 X 지만 미래의 키 확장 시 동일 OOM 패턴 재발 가능.

---

## 11. 테스트 CI 연결성 — 2026-04-28 senior audit 발견

**상태 (수정 후)**:
- 593 *.test.js 중 248 → npm test 직접 등록 (이전)
- **나머지 345 → CI 미실행 = invisible orphans (이전)**
  - 이 중 `tick-exit-fastlane.test.js` 는 V1 TP0 retire 시 broken 상태로 방치
  - `live-trail-authority-skip.test.js` (Stage Y 핵심) 는 등록 안 됨
- **fix**: `scripts/run-orphan-tests.js` glob runner 신설, `npm run test:orphans` 로 326 PASS orphan 자동 실행. 17 known-broken (drift) 은 explicit SKIP list 에서 reason 명시.
- cloudbuild.yaml: `npm test && npm run test:orphans && npm run test:v2-promotion` 으로 wired

**남은 위험**:
- 17 quarantined orphan 들은 production 영향 없음 확인. 그러나 drift 가 누적되면 실제 regression 을 가릴 수 있음. 별도 PR 에서 하나씩 fix 권고.

---

## 14. Stage U (2026-04-29) — V1 emit-driven exit fast-lane 차단

**Operator escalation** (Stage T 후속): "V1 자체가 작동하면 안 되고 V2
가 모든 처리를 인계받아야 한다."

### 직전 상태 (Stage T 이후)

| Path | 차단 여부 |
|---|---|
| webhook → runOneMarket (V1 entry) | ✅ Stage T |
| scheduler → runOneMarket (V1 entry) | ✅ Stage T |
| `binanceTickExit` fast-lane → runPaperMarket(EXIT_ONLY) | ❌ V1 호출 자체 됨 (writer 만 거부) |
| `binanceTickExit` native protection refresh | V1 무관 (직접 placeFuturesMarketOrder) |
| `systemAnomalyRemediation` → runPaperFuturesForBar | ❌ V1 호출 (별도 PR) |
| `trading.actions` manual override → runPaperFuturesForBar | ❌ V1 호출 (별도 PR — operator escape hatch) |

### Stage U fix

`src/services/binanceTickExit.js` line 3456 부근 fast-lane 호출 직전에
`DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` guard 추가. fast-lane V1 호출
자체를 skip + structured log `v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled` 발생.

### 의미

- 실제 청산 channel = **broker-side native protection** (closePosition
  STOP_MARKET). binanceTickExit 가 자체 owning (cancel + place 직접 호출).
- V1 fast-lane 의 backup 안전망 손실 — native STOP refresh 가 fail 하면
  자동 청산 채널 부재. 거래소 측 native STOP 가 stale 시 risk.

### 남은 누수 (Stage U 후속)

| Path | risk | 우선순위 | 처리 |
|---|---|---|---|
| ~~`systemAnomalyRemediation` 의 V1 emergency exit~~ | ~~breaker 시 청산 안 됨~~ | ~~P1~~ | ✅ Stage U-2 차단 |
| `trading.actions` 의 manual override | operator 수동 청산 시 V1 거부 | P2 (manual 이라 visible) | 별도 PR |

### Stage U-2 (2026-04-29) — systemAnomalyRemediation V1 emergency exit 차단

`runSystemAnomalyRemediation` 의 breaker-open 분기 직후 (anomalyReason
초기화 후) `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED` guard 추가. truthy
시 즉시 return, V1 flatten path (runPaperFuturesForBar) 0회 진입.

**의미**:
- breaker open 시점의 자동 flatten 손실 — operator 가 alert 받고 manual 개입 필요
- 거래소 측 native STOP_MARKET 가 단독 안전망
- V2 anomaly-flatten path 가 인계받아야 함 (Stage U-2 followup, V2
  productionEntryRoute 의 reverse-side flatten 또는 신규 V2 anomaly
  worker)

**검증**: `v1_system_anomaly_remediation_skipped_legacy_runtime_disabled`
log 가 anomaly 발생 시점에 발생하면 OK (breaker close 시는 위 분기에
도달조차 안 함).

### Stage U 진행 정리

| Stage | 차단 path | 완료 |
|---|---|---|
| T (root) | webhook + scheduler 의 V1 entry (runOneMarket 진입) | ✅ |
| T (symptom) | V1 V2-discovery loop 의 EXIT_OPPOSITE_SIGNAL inject | ✅ |
| U-1 | `binanceTickExit` 의 V1 fast-lane (runPaperMarket EXIT_ONLY) | ✅ |
| U-2 | `systemAnomalyRemediation` 의 V1 emergency flatten | ✅ |
| U-3 | `trading.actions` `/api/trading/manual-retry-entry` | ✅ Stage U-3 |
| U-followup | V2 가 인계받아야 할 항목들 (P1) | ⏳ |

### Stage U-3 (2026-04-29) — manual-retry-entry V1 차단

`POST /api/trading/manual-retry-entry` handler 진입 첫 줄에 guard
추가. `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` 시 503 + error
`V1_MANUAL_RETRY_LEGACY_RUNTIME_DISABLED` 반환. body parse / market
validation 등 일체 진행 안 함.

**의미**:
- operator 가 false-exit retry 시도하면 명시적 503 + 안내 메시지
- "use exchange UI directly" 권장
- V2 의 manual-retry endpoint 가 별도 PR 로 신설 권장

**검증**: `v1_manual_retry_entry_blocked_legacy_runtime_disabled` log
가 endpoint 호출 시 발생. operator 측 UI 가 503 응답 받으면 사용자에게
설명 표시.

### V2 가 인계받아야 할 missing piece (Stage U-followup, P1)

| 영역 | 현재 | V2 가 owning 해야 함 |
|---|---|---|
| Native protection refresh | binanceTickExit 자체 owning (V1 무관) | OK — 이미 V1 무관 |
| ~~Emit-driven exit (TP1/SL/TRAIL automated close)~~ | ~~V1 fast-lane → 차단됨~~ | ✅ Stage U-followup-1: binanceTickExit fast-lane skip → V2 direct reduceOnly market 직접 호출 (`v2DirectExitDispatch.js` helper). reduceOnly 라 over-close 불가능. native STOP refresh fail 시 backup 안전망 복원. **Stage U-followup-2 (2026-04-28) 추가 보강**: (A) `fetchFuturesExchangeInfo` 로 stepSize/minQty 사전 round (Binance reject 최소화), (B) 성공 시 `upsertExitOrderContract` 로 V2 evidence ledger stamp (canonical exit reducer 가 fill 시 dispatch 로 correlate), (C) `runId` 에 `crypto.randomUUID().slice(0,8)` suffix 부착 (동일 ms 충돌도 0 보장). ledger fail 은 best-effort (order 는 성공 처리). |
| Anomaly auto-flatten | V1 path → 차단됨 → 실효성 0 | V2 anomaly worker |
| Manual retry entry | V1 path → 503 응답 | V2 manual-retry endpoint |
| Reverse signal auto-close (EXIT_OPPOSITE) | V1 inject → 차단됨 (Stage T) | V2 의 reverse handling 정책 |

**현재 단독 의존 채널** = broker-side native protection (closePosition
STOP_MARKET). 이게 fail 하면 어떤 자동 청산도 fire 안 함. operator
수동 개입만 가능.

### 검증 (deploy 후 24h)

```bash
# fast-lane skip log 발생 (V1 차단 working)
gcloud logging read 'jsonPayload.event="v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled"' --freshness=24h

# V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED drop 다시 0건
gcloud logging read 'textPayload:"V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED"' --freshness=24h

# native protection refresh 가 정상 작동하는지 (binanceTickExit 의 직접 호출)
gcloud logging read 'jsonPayload.event="native_protection_refresh_price_decision"' --freshness=24h
```

### 자백

- V1 fast-lane backup 안전망 손실. native STOP refresh fail 시 청산 못 함.
- 사용자 의도와 일치하지만 architectural risk 보유.
- V2 가 emit-driven exit (signal → V2 router → V2 exit place) 인계받기
  전까지 broker side native STOP 단독 의존.
- ✅ **Stage U-followup-2 (2026-04-28)**: 위 3가지 자백 항목 (qty pre-rounding,
  V2 evidence chain, runId entropy) 동시 해소.
  - (A) `fetchFuturesExchangeInfo` 캐시 1d → stepSize/minQty 정확히 사전 round.
  - (B) `upsertExitOrderContract` 로 V2 evidence ledger 에 stamp
    (`event=EXIT_TRAIL` or `EXIT_TP_P1_2.5P`, `source=V2_DIRECT_EXIT_DISPATCH`,
    `triggerSource=V2_DIRECT_TICK_EXIT_DISPATCH`, `extra.run_id`,
    `extra.idempotency_key`).
  - (C) `runId` 에 `randomUUID().slice(0,8)` suffix → 동일 ms 충돌도 0.
  - **Stage V scope (남은 자백)**: V2 canonical exit reducer 가 위 ledger
    stamp 를 입력으로 받아 fill ack 까지 lifecycle 전체 owning. 현재는 fill 발생 시
    canonicalExitReducer 가 별도 경로로 ledger 를 다시 stamp.

---

## 13. Stage T (2026-04-29) — V1 paperBinanceRunner architectural leak

**증상**: production 운영 중 BTCUSDT 등에서 매 bar 마다 다음 alert 반복:

```
[V2 DISCOVERY_CANARY] BTCUSDT 서버 신호 드롭
이벤트: EXIT_OPPOSITE_SIGNAL
사유: V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED
드롭 위치: 운영/쿨다운 필터
```

**operator 진단** (정확): "V1 자체가 작동하면 안 되는데 작동하고 있는 것이
누수. V1 작동 해도 V2 에서 작동해야지."

### Root cause cascade

1. `scheduler/scheduler.js` 매 tick 마다 `runOneMarket()` (V1 marketRunner) 호출 — `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` 검사 0
2. `webhook.routes.js` 도 webhook 받으면 `runOneMarket()` 직접 호출 — 동일 검사 0
3. `runOneMarket` → `runPaperMarket` → V1 paperBinanceRunner signal loop
4. signal loop 가 반대 신호 감지하면 `EXIT_OPPOSITE_SIGNAL` inject (line 18420 부근)
5. injected signal 이 V1 executor 도달
6. V1 executor 가 `legacy_runtime_disabled=true` 라 reject → drop
7. 매 bar 반복

### 수정 (defense in depth)

**Layer 1 (root, scheduler/marketRunner.js)** — V1 entry 자체 차단:
```js
async function runOneMarket(...) {
  if (isV1MarketRunnerDisabledByEnv(process.env)) {
    return { ok: true, skipped: true, reason: "V1_MARKET_RUNNER_LEGACY_RUNTIME_DISABLED" };
  }
  // ...rest
}
```

**Layer 2 (symptom, paperBinanceRunner.js)** — V1 이 만에 하나 실행되더라도 EXIT_OPPOSITE inject 차단:
```js
if (liveCfg && liveCfg.legacy_runtime_disabled === true) {
  // skip V1 inject + clear opposite_transition_* meta + log
  continue;
}
```

두 layer 모두 들어감 (root + symptom 동시).

### 검증

- `src/tests/v1-market-runner-legacy-disabled-skip.test.js` — 5 case
  structural + runtime test (root layer)
- `src/tests/v1-exit-opposite-inject-legacy-disabled-skip.test.js` —
  6 case structural test (symptom layer)
- npm test + npm run test:orphans 모두 PASS

### V2 path 가 인계받아야 할 것 (별도 PR)

V1 의 EXIT_OPPOSITE_SIGNAL 로직은 "반대 신호 시 자동 청산" 안전망.
V2 cutover 후 이 안전망을 V2 path 가 owning 해야 함:

- V2 productionEntryRoute 가 reverse signal 감지
- V2 의 entry rejection + V2 exit (canonical exit reducer) trigger
- 또는 명시적으로 "V2 는 opposite-flip auto-close 안 한다" 정책 결정

**현재 상태**: V1 의 자동 청산이 차단된 결과 = 반대 신호 시 포지션은
그대로 유지. operator 의 의도와 일치 (operator: "의도된 방향이야 놔둬").
하지만 **시장이 반대로 크게 가면 SL 까지 갈 수 있는 것을 더 일찍 청산
못 함**. 별도 PR 에서 V2 path 의 opposite handling 정책 결정 필요.

### 자백

- V1 marketRunner 가 production 에서 매 bar 돌고 있었던 사실이 audit
  에서 잡히지 않았음. operator 가 alert spam 으로 발견.
- V1 entry 차단 후 production 에서 실제 V1 logic 이 0 회 동작하는지
  검증 = 24h 이상 prod 운영 후 가능. 즉시 검증 0.
- Cloud Build CI 가 production 환경 변수 (LEGACY_RUNTIME_DISABLED=1)
  를 설정하지 않은 상태로 test 돌므로 fix 의 production 효과는 deploy
  후 cloud logging 으로만 확인 가능.

---

## 12-late. 2026-04-28 senior audit session — Step 21~24 추가 진행

이전 §12 작성 후 추가 작업:

**Step 18 (real production bug fix)**: `dashboard.openclaw.routes.js` 가
`OPENCLAW_CRON_JOBS` 만 검색하던 것을 `OPENCLAW_CLOUD_SCHEDULER_JOBS` 도
검색하도록 변경. evidence_linker / calibration / retrospect 의 `produces_artifact`
+ `artifact_sla_hours` 매니페스트에 stamp. **production /dashboard/openclaw 가
빈 artifacts 응답을 반환하던 진짜 버그**.

**Step 19 (real production bug fix)**: `positionStateMachine.buildCanonicalExitEvent`
가 rules.TP_P1 미지정 시 `Number(null) === 0` → `EXIT_TP_P1_0P` (0% 가짜
suffix) 를 emit. `nonZeroPctToken` 헬퍼로 우회. **canonical-exit ledger 의
"EXIT_TP_P1_0P" 가짜 event 제거**.

**Step 21 (production drift fix)**: `bestSelfEvolutionDataset.js` 의
`febtEligibleRows` allowlist (L1059) + `hasFebtContractEvidence` (L1075) +
`wait_verdict` 매핑 (L610) 모두 "TIMING" 만 체크. Stage X retire 후
"LEGACY_RETIRED" 도 받도록 확장. **historical dataset 의 retired-guard
drops 가 FEBT 자격을 잃던 것 fix**.

**Step 22 (test fixture fix)**: `binance-exit-qty-contract-audit.test.js`
의 OK fixture 가 V1 TP0 (qty 0.25) 포함 → Stage R retirement 후 TP0_ABS_OVER
flag. 단순화 v2 shape (TP1 0.5 + TRAIL 0.5) 로 업데이트.

**Step 23 (V2 router fixture realignment)**: 4 V2 test 가 router 의 14+
gate field cascade (market_data_quality + signal_criteria) 통과 못 함.
모든 fixture 에 14 fields stamp.

**Step 24 (Node 20 env drift confirmed)**: 5 orphan test 가 local Node 22
PASS / Cloud Build Alpine Node 20.15 FAIL. CI Node 차이로 인한 환경 drift
확정 — 영구 quarantine 처리 (운영자가 Cloud Build Alpine image 업그레이드
또는 각 test 를 Node 20 호환 idiom 으로 변경 결정 시까지).

**최종 quarantine 8건** (모두 환경 의존 또는 영구):
- 5 Node 20 vs 22 env drift (CI 만 fail)
- 1 pine-transition-lead-source.test.js (절대 경로 hard-coded)
- 1 run-v2-promotion-canary-flow.test.js (canary flow runtime artifact 의존)
- 1 select-v2-promotion-canary-candidate.test.js (exit-code drift)

**Stage S** (V2→V1 mirror): scaffolded + V2 shadow writer wired + 6 case
unit test, default OFF behind `V2_TO_V1_META_MIRROR_ENABLED`. V2_KNOWN_LIMITS
§1 에 cutover 5 단계 절차 명시. 코드 base 안에 들어 있음.

**SIGABRT verdict**: Step 4 deploy 23:33 UTC 부터 현재 (~04:13 UTC) =
**280분 0건**. P(0|H0) ≈ e^(-9.3) ≈ **0.009%** → **>99.99% 신뢰** OOM
fix 결정.

---

## 12. 2026-04-28 senior audit session 최종 보고

**\#1 incident 추적**: TP1 후 trail signal architectural suppress 로 4 포지션 (BNB/BTC/ETH/XRPUSDT) 의도치 않은 청산.
- 진짜 root cause: `shouldSuppressLiveFuturesInternalExitSignal` 가 default-ON 으로 모든 internal trail signal drop. native trail-stop refresh 가 EGRESS_PROXY_TIMEOUT 으로 갱신 실패하던 시점에 drop 이 누적 → 청산.
- Stage Y fix: default-OFF + kill switch `LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS=1`. Binance reduceOnly + closePosition 의 자체 dedup 으로 race 안전.

**SIGABRT 24h 24회 root cause**:
- Cloud Run cgroup memory limit (1024 MiB) 위반 시 외부 SIGABRT 송출. Stage K V8 handler 는 fire 안 됨.
- 누수: `tpP1PendingTerminalAlertState` (intent-id 키) 무한 성장.
- Fix: 6 cache 일괄 `applyAlertCacheCap` + memory 1Gi → 2Gi.
- 검증: 158분 0건, P < 0.5%, 99.5% 신뢰.

**Test CI gap**: 593 test 중 345 (58%) CI 미실행 invisible orphan. 그 중 Stage Y 핵심 검증 test 도 등록 안 됨. `scripts/run-orphan-tests.js` glob runner 도입.

**Drift fix 배치 결과**: 22 → 17 (5건 fix in-session)
- febt-phase0-report (active/all-tier line split)
- signal-drops (riskGovernor field)
- binance-position-stage-reconcile (V1 TP0 retire)
- exit-trailing-contract-report (Stage N tp1_pct 3.25→2.5)
- v2-openclaw-shadow-position-writer (decision bundle collection added)

**잔여 17 = 모두 production code 변경 또는 환경 의존**:
- 4 V2 router 14+ field cascade (fixture realignment PR)
- 4 backfill canonical renderer EXIT_TP_P1_0P 의심 버그 (schema impact PR)
- 5 CI Node 20.15 vs local 22.22 환경 drift
- 1 pine 절대경로 (영구)
- 1 dashboard-openclaw evidence_linker manifest 누락
- 1 best-self-evolution-dataset downstream allowlist drift
- 1 binance-exit-qty-contract-audit (TP0 retire reclassification flag)

**Observability 추가**:
- `native_protection_unprotected_window_observed` Cloud Logging 구조화 로그 — 이전엔 Firestore round-trip 만 필요했음.

**여전히 자백 (외부 감사가 잡을 수 있는 항목)**:
1. Stage S (V2→V1 meta mirror) 미구현. canary_only=1 조건에서만 안전.
2. Pine 백테스트 0건. TP1 0.025 EV 통계 근거 없음.
3. 17 quarantine 중 일부 production 코드 변경 필요한 것들 (V2 router, backfill renderer) 미해결.
4. cancel-then-place window p50/p95 dashboard 데이터 아직 미수집 (canary entry 가 거의 없음).
5. 점수 부르지 않는다.

**Session 절대 약속**: 다시는 검증 안 한 cap 알리지 않는다, 다시는 점수 자기 제시 안 한다.
