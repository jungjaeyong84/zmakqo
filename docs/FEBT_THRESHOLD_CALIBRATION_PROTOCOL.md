# FEBT_THRESHOLD_CALIBRATION_PROTOCOL

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT` phase 판정 5개 threshold의 seed 값과 보정 절차 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`

## 목적

아래 5개 파라미터를 구현 가능한 seed 값으로 고정한다.

1. `febt_lock_arm_min`
2. `febt_lock_fire_min`
3. `febt_fire_edge_min`
4. `febt_late_hard_max`
5. `febt_fail_max`

## first SHADOW seed 값

1. `febt_lock_arm_min = 0.48`
2. `febt_lock_fire_min = 0.62`
3. `febt_fire_edge_min = 0.12`
4. `febt_late_hard_max = 0.74`
5. `febt_fail_max = 0.68`

## 단계 성격

### SHADOW

1. seed 값은 관측용
2. live decision 영향 없음

### SOFT

1. `Phase 0/2` 결과를 반영해 한 번만 보정
2. 보정 폭은 `±0.08` 이내

### HARD

1. `SOFT`에서 안정화된 threshold만 승격
2. symbol-specific override 금지

## 보정 절차

각 phase 후보에 대해 아래를 본다.

1. `p25`
2. `p50`
3. `p75`
4. `p90`

대상 변수:

1. `lock_score`
2. `edge`
3. `late_risk`
4. `failure_risk`

## 보정 규칙

1. `lock_arm_min`
   - `PREPARE/ARMED` 경계의 `p50`
2. `lock_fire_min`
   - `FIRE` 표본의 `p25`
3. `fire_edge_min`
   - `FIRE edge`의 `p25`
4. `late_hard_max`
   - `LATE risk`의 `p50`
5. `fail_max`
   - `VOID failure`의 `p50`

## 승격용 단계 기준

### SHADOW -> SOFT

1. `FIRE win_rate >= 0.52`
2. `FIRE avg_ret_net non-inferior`
3. `LATE saved_loss_minus_missed_gain > 0`
4. `replacement_ratio >= 0.80`

의미:

1. `52%`는 `SOFT 진입 후보선`

### SOFT 유지

1. `approved markets aggregated win_rate >= 0.58`
2. `count_ratio_global >= 1.00`
3. `replacement_ratio >= 0.85`

### HARD 승격

1. `approved markets aggregated win_rate >= 0.60`
2. `95% Wilson lower bound >= 0.55`
3. `count_ratio_global >= 1.00`
4. `replacement_ratio >= 0.90`

## 금지 규칙

1. `Phase 0` 데이터 없이 threshold 변경 금지
2. `SOFT` 이전 symbol-specific tuning 금지
3. 여러 threshold를 한 번에 크게 움직이는 것 금지

## 재검증 트리거

1. `approved markets` 변경
2. `approved timeframes` 변경
3. score 수식 변경
4. `count_ratio_global < 1.00`
5. latency floor 위반

## 한 줄 결론

`FEBT` threshold는 seed 값을 먼저 고정한 뒤 shadow 분포와 phase 성과를 이용해 단계적으로만 보정해야 한다.
