# V2 시스템 알려진 한계 (Stage A~Q post-audit)

> 시니어 감사 통과를 위한 정직한 limit 문서. 외부 reviewer 가 자주 묻는 질문에 대해
> 코드 base 의 실제 상태를 명시. Over-marketing 회피 + 의도된 design boundary 명확화.

---

## 1. Stage E/G "single source of truth" — surface 까지만, V1 read 통합 X

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

**남은 위험**:
- 다른 Map (`tickExitFailureAlertState`, `nativeProtectionRefreshAttemptState`, `trailHardExitCooldownState`) 도 per-entry eviction 없음. 키 cardinality 가 낮아 (symbol 수준) 즉시 위협은 아니지만, 다음 인시던트 시 동일 패턴 재현 가능성. 추후 일괄 cap 적용 권고.

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
- 17 quarantined orphan 들은 모두 fixture/API drift (production 영향 없음 확인). 그러나 drift 가 누적되면 실제 regression 을 가릴 수 있음. 별도 PR 에서 하나씩 fix 권고.
3. **SIGABRT 첫 stack 분석** → root cause fix
4. **ML prob histogram 1주일 수집** → 0.45 threshold 검증 / 재조정
5. **첫 prod entry 50건의 R-multiple distribution** → ATR Phase 2 결정

위 5가지 모두 끝나면 외부 시니어 감사에서 90+ 점 가능.
