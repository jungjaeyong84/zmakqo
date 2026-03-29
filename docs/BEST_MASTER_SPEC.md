# BEST_MASTER_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `BEST/FEBT` 체계를 Claude가 한 번에 검증할 수 있도록 개념, 철학, 구현, 성능, count, 운영 가드를 단일 문서로 통합 요약
- 원문 분할 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_IMPLEMENTATION_FRAMEWORK.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_SYSTEM_ROLLOUT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_INTERFACE_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_OPERATIONAL_GUARDS.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_BASELINE_SNAPSHOT_2026W13.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_OVERLAP_MATRIX_SCHEMA.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_BRIDGE_LATENCY_BUDGET.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 1. 한 줄 정의

`BEST`는 모든 학문 조각을 통합해 `너무 빠르지도, 너무 늦지도, 너무 보수적이지도 않은` 최적 실행 신호를 만드는 상위 이론이다.

`FEBT`는 `BEST` 내부에서 `최초 실행 가능 봉`을 판정하는 timing core다.

## 2. 최종 목표

이 체계의 운영 목표는 아래 2개를 동시에 잡는 것이다.

1. 승인 시장군 기준 `승률 60%+`
2. baseline 대비 `신호 수 감소 금지`

단, 이 목표는 전 시장/전 시간대의 보장이 아니라 `승인 시장군 x 승인 시간대` 기준의 운영 목표다.

## 3. 상위 철학

### 핵심 관점

1. 나쁜 신호를 무작정 줄이는 것이 목표가 아니다.
2. 같은 수의 신호를 더 좋은 위치로 재배치하는 것이 목표다.
3. 차트상 좋아 보여도 실체결이 나쁘면 실패다.

### 핵심 법칙

1. `Signal Conservation`
   - 신호를 줄이기보다 더 좋은 시점으로 재배치
2. `Regret Minimization`
   - 가장 빠른 진입이 아니라 후회 비용이 가장 낮은 진입
3. `Non-Redundancy`
   - 상태/구조/시간가치/타이밍/행동의 역할 중복 금지
4. `No-Bypass`
   - Pine timing verdict가 활성 필터를 우회하면 안 됨
5. `Execution Reality`
   - alert -> webhook -> intent -> fill 전체 브리지 기준 검증

## 4. 구조

`BEST`는 아래 5층 합의로 신호를 본다.

1. `L1 상태층`
   - 통계물리학, regime, change-point
2. `L2 구조층`
   - 시장 미시구조, 구조 품질
3. `L3 시간가치층`
   - EV, survival, hazard
4. `L4 타이밍층`
   - `FEBT`
5. `L5 행동층`
   - 베이지안 의사결정, 제어이론, risk/execution policy

초기 구현 원칙:

1. `L5`는 first release에서 기존 서버 policy 로직의 재정의다.
2. `Phase 0/1`에서 L5 신규 엔진 구현은 범위 밖이다.

현재 운영 체계 대응:

1. `1차 상태/무결성`
2. `2차 진입 품질`
3. `3차 상태 기반 Soft Sizing`
4. `4차 EV/시간가치층`
5. `5차 WAIT 타이밍층`

## 5. FEBT의 정의

`FEBT`는 아래 질문만 다룬다.

1. 지금 봉이 너무 빠른가
2. 지금 봉이 최초 실행 가능 봉인가
3. 지금 봉이 이미 늦은 추격인가

`FEBT`는 다음을 하지 않는다.

1. 상태층 재판정
2. 구조층 재판정
3. EV/시간가치 재판정
4. 최종 행동 결정

## 6. BEST ↔ FEBT 인터페이스

### 호출 시점

1. `L1~L3` 평가 완료 후
2. `DROP`이 아닌 경우에만 `FEBT` 호출
3. `L5`가 `FEBT` 결과를 소비

### FEBT 입력

1. state summary
2. entry structure summary
3. EV/hold value summary
4. candle/microstructure 입력

### FEBT 출력

1. `febt_phase`
2. `febt_lock_score`
3. `febt_delay_cost`
4. `febt_late_risk`
5. `febt_failure_risk`
6. `febt_edge`
7. `febt_timing_action`
8. `febt_authority`

## 7. phase 정의

1. `PREPARE`
  - 아직 이르다
2. `ARMED`
   - 거의 됐지만 한 박자 이르다
3. `FIRE`
   - 최초 실행 가능 봉
4. `LATE`
   - 이미 추격 위험이 높다
5. `VOID`
   - timing 구조가 무효다
6. `UNKNOWN`
   - 계산 실패 또는 side 불명확

canonical precedence:

1. `VOID (state invalid)`
2. `VOID (failure risk)`
3. `LATE`
4. `PREPARE`
5. `FIRE`
6. `ARMED`

## 8. Pine 역할

Pine는 `BEST`의 센서다.

담당:

1. 상태 센서 일부
2. 구조 센서 일부
3. 타이밍 센서
4. chart-visible metadata
5. payload emission

비담당:

1. execution reality
2. reject handling
3. partial fill
4. account-level risk

## 9. 서버 역할

서버는 `BEST`의 정책/실행 엔진이다.

담당:

1. 시간가치 최종 판단
2. 최종 action selection
3. dedupe/reject/partial fill
4. risk sizing / cap / cooldown
5. trace/audit logging

## 10. 자동화 역할

자동화는 `BEST`의 반증 장치다.

담당:

1. overlap matrix
2. disagreement attribution
3. saved loss / missed gain
4. latency / duplicate / stale / reject
5. drift

## 11. 승률 60%+ 검증 계약

### 승인 시장군

1. `BTCUSDT`
2. `ETHUSDT`
3. `BNBUSDT`
4. `XRPUSDT`
5. `SOLUSDT`
6. `AXSUSDT`
7. `DOGEUSDT`

### 승인 시간대

1. `15m`
2. `1h`

### 최소 표본

1. 전체 `>= 200 signals`
2. long `>= 80`
3. short `>= 80`
4. 각 시장 `56d >= 20`

### 합격선

1. `approved markets aggregated win_rate >= 0.60`
2. `56d window >= 0.60`
3. `100-signal window >= 0.60`
4. `95% Wilson lower bound >= 0.55`
5. `avg_ret_net`, `expectancy`, `tp1_first_rate` non-inferior
6. 단계 승격:
   - `52%` = `SHADOW -> SOFT` 후보선
   - `58%` = `SOFT 유지선`
   - `60%` = `HARD 승격선`

## 12. 신호 수 감소 금지 계약

### baseline

1. 최근 `56d`
2. 승인 시장군 x 승인 시간대
3. 현행 production `1~5차`

### 핵심 지표

1. `count_ratio_global >= 1.00`
2. `replacement_ratio >= 0.80` before `SOFT`
3. `replacement_ratio >= 0.90` before `HARD`

### recovery 정의

`blocked signal`이 아래 조건을 만족하는 더 좋은 시점의 신호로 대체되어야 `recovered`로 인정한다.

1. 같은 symbol
2. 같은 side
3. 같은 tier
4. 같은 approved timeframe
5. `max 2 bars` 안
6. 성과 동등 이상

세부 측정 규칙:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`

## 13. 운영 가드

### 초기 live risk cap

1. `max_risk_per_trade = 1.0%`
2. `max_daily_drawdown = 5.0%`
3. `max_symbol_concentration = 25%`
4. `max_concurrent_positions = 4`
5. `max_add_per_position = 1`

### auto stop

1. `duplicate_rate > 0.5%`
2. `reject_rate > 0.5%`
3. `stale_rate > 1.0%`
4. `alert_to_fill_ms_p95 > bar_ms * 0.20`
5. `daily_drawdown >= 5.0%`

fallback:

1. `UNKNOWN` 또는 계산 실패 시 `legacy 5차 WAIT`로 복귀
2. `HARD`에서도 double-fail이면 `NO_NEW_ENTRY`

### duplicate / reject / partial fill

1. dedupe key는 `signal_key`, `signal_id`, `strategy_id`, `symbol`, `tf`, `bar_close_time_utc_ms`
2. reject 시 자동 재발주 금지
3. partial fill은 partial-aware risk로 재계산

## 14. FEBT rollout

### Phase 0

1. baseline 측정
2. overlap matrix
3. disagreement attribution
4. bridge latency baseline

### Phase 1

1. Pine `SHADOW`
2. `febt_*` payload emit
3. live decision 영향 없음

### Phase 2

1. 서버 shadow logging
2. 자동화 phase report

### Phase 3

1. `SOFT`
2. 제한적 timing advisory
3. replacement accounting 검증

### Phase 4

1. `HARD`
2. 5차 주판정 승격
3. testnet/모의 execution 검증 필수

## 15. 현재 미구현 영역

현재 문서상 아직 코드/운영으로 내려오지 않은 핵심 항목:

1. `BEST ↔ FEBT` JSON schema 실제 구현
2. Pine `febt_*` shadow emit
3. weekly/hourly/objective automation의 phase 집계
4. count floor / replacement accounting 리포트
5. live guard runbook

## 16. Claude 검증 초점

Claude는 아래를 검증해야 한다.

1. `BEST`가 진짜 상위 이론으로 성립하는가
2. `FEBT`가 timing core로 과잉 확장되지 않았는가
3. `60%+`와 `count floor`가 현실적이고 검증 가능한가
4. Pine / 서버 / 자동화 역할 경계가 충분히 명확한가
5. live 운영 승인 전 추가해야 할 문서/가드가 무엇인가

## 17. 한 줄 결론

이 문서는 `BEST/FEBT`를 철학 문서에서 운영 검증 가능한 master spec으로 압축한 것이다. Claude 검증은 이 문서를 우선 읽고, 세부 분할 문서를 근거로 삼아야 한다.
