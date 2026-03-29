# FEBT_PHASE1_PINE_FIELD_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT`를 Pine에 `SHADOW` 모드로 넣기 위한 필드/계산/페이로드 계약 정의
- 대상 파일:
  - `/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.0.pine.txt`
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 목적

`Phase 1`의 목표는 아래 3개다.

1. Pine가 `FEBT`를 계산하되 live decision은 바꾸지 않는다.
2. 서버와 자동화가 `phase별 shadow 성과`를 수집할 수 있게 한다.
3. 계산 실패, payload 누락, phase 해석 불일치를 방지하는 계약을 만든다.

## 불변 조건

1. `SHADOW`에서는 `LONG / SHORT` 신호 수가 바뀌면 안 된다.
2. `FEBT`는 `1~5차 활성 필터`를 우회하지 않는다.
3. `FEBT`는 `2차/3차/4차`의 본판정을 다시 하지 않는다.
4. `FEBT`는 `BEST` 상위 이론 안에서 `timing core` 역할만 수행한다.

## 운영 모드

1. `OFF`
   - 계산 안 함
2. `SHADOW`
   - 계산만 하고 기록
3. `SOFT`
   - 제한적 보조 규칙
4. `HARD`
   - 5차 주판정

초기 구현은 `SHADOW`만 허용한다.

## 신규 Pine 입력

1. `grp_febt = "═══ FEBT Timing ═══"`
2. `febt_mode`
3. `febt_lock_arm_min`
4. `febt_lock_fire_min`
5. `febt_fire_edge_min`
6. `febt_late_hard_max`
7. `febt_fail_max`
8. `febt_debug_enable`
9. `febt_payload_enable`

first SHADOW seed:

1. `febt_lock_arm_min = 0.48`
2. `febt_lock_fire_min = 0.62`
3. `febt_fire_edge_min = 0.12`
4. `febt_late_hard_max = 0.74`
5. `febt_fail_max = 0.68`

## 입력 재료

### candle / extension

1. `range_pos`
2. `body_ratio`
3. `upper_wick_ratio`
4. `lower_wick_ratio`
5. `same_dir_streak`
6. `recent_move_1_pct`
7. `recent_move_2_pct`

### structure retention

1. `break_retention`
2. `close_control`

### exhaustion / reversal

1. `impulse_decay`
2. `counter_rejection`
3. `micro_absorption`

### state summary inputs

기존 Pine 변수 재사용:

1. 기존 `sp_entropy_score`, `sp_coherence_score`, `sp_transition_risk`를 그대로 읽는다.
2. `FEBT` 전용 stat-physics 재계산 금지

1. `regime_state`
2. `sp_entropy_score`
3. `sp_coherence_score`
4. `sp_transition_risk`

## 내부 필드

1. `febt_lock_score_long`
2. `febt_lock_score_short`
3. `febt_delay_cost_long`
4. `febt_delay_cost_short`
5. `febt_late_risk_long`
6. `febt_late_risk_short`
7. `febt_failure_risk_long`
8. `febt_failure_risk_short`
9. `febt_edge_long`
10. `febt_edge_short`
11. `febt_phase_long`
12. `febt_phase_short`
13. `febt_phase_selected`

세부 계산식:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
2. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`

## phase 판정

롱 기준:

```text
if not state_valid:
  phase = VOID
else if failure_risk > fail_max:
  phase = VOID
else if late_risk >= late_hard_max:
  phase = LATE
else if lock_score < lock_arm_min:
  phase = PREPARE
else if lock_score >= lock_fire_min and edge >= fire_edge_min:
  phase = FIRE
else:
  phase = ARMED
```

숏은 대칭 구현한다.

## payload 필드

필수:

1. `febt_mode`
2. `febt_phase`
3. `febt_lock_score`
4. `febt_delay_cost`
5. `febt_late_risk`
6. `febt_failure_risk`
7. `febt_edge`
8. `febt_state_valid`
9. `febt_calc_ok`
10. `febt_calc_reason`

허용 값:

1. `febt_phase`
   - `PREPARE`
   - `ARMED`
   - `FIRE`
   - `LATE`
   - `VOID`
   - `UNKNOWN`
2. `febt_calc_reason`
   - `OK`
   - `OFF`
   - `SIDE_UNKNOWN`
   - `MISSING_INPUT`
   - `DIV_BY_ZERO_GUARD`
   - `SHADOW_FAILSAFE`

## fail-safe

1. 계산 실패 시
   - `febt_calc_ok = false`
   - `febt_phase = UNKNOWN`
   - live decision 영향 없음
2. payload 누락 시
   - 서버에서 `febt_payload_missing = true`로 기록
3. side 불명확 시
   - selected 필드는 `UNKNOWN`

세부 fallback 규칙:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_FAILSAFE_POLICY.md`

## 표시 원칙

1. 차트에서는 새 entry 체계처럼 보이면 안 된다.
2. `LONG / SHORT` triangle 의미는 유지한다.
3. debug label/panel row는 optional이다.

## 테스트 계약

1. `SHADOW`에서 신호 수 변화 `0`
2. payload에 `febt_phase`, `febt_edge` 존재
3. `febt_calc_ok = false`여도 alert 생성 유지
4. long/short 대칭 보장

## 한 줄 결론

`Phase 1`은 `FEBT`를 차트에 새 신호로 보이게 만드는 단계가 아니라, Pine를 `BEST` timing sensor로 바꾸는 shadow instrumentation 단계다.
