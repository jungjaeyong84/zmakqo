# FEBT_SCORE_CALCULATION_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT`의 핵심 4개 score와 `edge`의 수학적 정의를 고정
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_THRESHOLD_CALIBRATION_PROTOCOL.md`

## 목적

이 문서는 아래 값을 구현자마다 다르게 해석하지 못하게 막는다.

1. `febt_lock_score`
2. `febt_delay_cost`
3. `febt_late_risk`
4. `febt_failure_risk`
5. `febt_edge`

초기 구현 원칙:

1. first release는 `선형 가중합 + clamp`로 시작
2. 비선형 결합은 `Phase 0` 반증 이후에만 도입
3. 모든 원시 입력은 먼저 `[0, 1]`로 정규화

## 공통 규칙

### clamp

```text
clamp01(x) = min(max(x, 0), 1)
```

### weighted sum

```text
weighted_sum(items) = clamp01(sum(w_i * x_i))
```

원칙:

1. 각 score의 weight 합은 `1.00`
2. 결측값은 해당 항목 제외 후 남은 weight를 재정규화한다.

## 원시 입력 정의

세부 OHLCV 공식은 아래 문서를 우선한다.

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_MICROSTRUCTURE_INPUT_SPEC.md`

### 공통

1. `range_pos`
   - long: `(close - low) / max(high - low, syminfo.mintick)`
   - short: `(high - close) / max(high - low, syminfo.mintick)`
2. `body_ratio`
   - `abs(close - open) / max(high - low, syminfo.mintick)`
3. `upper_wick_ratio`
   - `(high - max(open, close)) / max(high - low, syminfo.mintick)`
4. `lower_wick_ratio`
   - `(min(open, close) - low) / max(high - low, syminfo.mintick)`

### 방향 변환

롱:

1. `dir_close_control_long = clamp01(range_pos)`
2. `dir_body_long = clamp01(body_ratio)`
3. `dir_reject_long = clamp01(lower_wick_ratio)`
4. `opp_wick_long = clamp01(upper_wick_ratio)`

숏:

1. `dir_close_control_short = clamp01(1 - range_pos)`
2. `dir_body_short = clamp01(body_ratio)`
3. `dir_reject_short = clamp01(upper_wick_ratio)`
4. `opp_wick_short = clamp01(lower_wick_ratio)`

### 구조/확장 보조 입력

1. `same_dir_streak_norm = clamp01(same_dir_streak / 4.0)`
2. `recent_move_1_norm = clamp01(abs(recent_move_1_pct) / 2.5)`
3. `recent_move_2_norm = clamp01(abs(recent_move_2_pct) / 4.0)`
4. `break_retention_norm = clamp01(break_retention)`
5. `close_control_norm = clamp01(close_control)`
6. `impulse_decay_norm = clamp01(impulse_decay)`
7. `counter_rejection_norm = clamp01(counter_rejection)`
8. `micro_absorption_norm = clamp01(micro_absorption)`

## score 정의

### 1. lock score

롱:

```text
lock_long =
  0.28 * dir_close_control_long +
  0.22 * break_retention_norm +
  0.20 * dir_body_long +
  0.18 * dir_reject_long +
  0.12 * micro_absorption_norm
```

숏:

```text
lock_short =
  0.28 * dir_close_control_short +
  0.22 * break_retention_norm +
  0.20 * dir_body_short +
  0.18 * dir_reject_short +
  0.12 * micro_absorption_norm
```

### 2. delay cost

```text
delay_cost =
  0.30 * close_control_norm +
  0.24 * break_retention_norm +
  0.18 * recent_move_1_norm +
  0.16 * counter_rejection_norm +
  0.12 * micro_absorption_norm
```

보정:

1. `impulse_decay_norm`가 높으면 `0.15 * impulse_decay_norm`만큼 감산
2. 감산 후 `clamp01`

### 3. late risk

```text
late_risk =
  0.34 * same_dir_streak_norm +
  0.26 * recent_move_1_norm +
  0.18 * recent_move_2_norm +
  0.12 * close_control_norm +
  0.10 * impulse_decay_norm
```

보정:

1. `micro_absorption_norm >= 0.70`이면 `late_risk -= 0.08`
2. 보정 후 `clamp01`

### 4. failure risk

롱:

```text
failure_long =
  0.30 * opp_wick_long +
  0.24 * impulse_decay_norm +
  0.18 * (1 - break_retention_norm) +
  0.16 * (1 - close_control_norm) +
  0.12 * (1 - counter_rejection_norm)
```

숏:

```text
failure_short =
  0.30 * opp_wick_short +
  0.24 * impulse_decay_norm +
  0.18 * (1 - break_retention_norm) +
  0.16 * (1 - close_control_norm) +
  0.12 * (1 - counter_rejection_norm)
```

### 5. edge

```text
edge = clamp01(0.5 + delay_cost - late_risk) - 0.5
```

## state valid

`FEBT`는 기존 stat-physics를 재계산하지 않는다.

```text
state_valid =
  regime_state != "range_hard_block"
  and sp_coherence_score >= 0.30
  and sp_transition_risk <= 0.84
```

원칙:

1. 기존 Pine `sp_entropy_score`, `sp_coherence_score`, `sp_transition_risk`를 그대로 읽는다.
2. `FEBT` 전용 stat-physics 재계산 금지

## first release 원칙

1. first release는 이 수식을 그대로 사용
2. weight 변경은 calibration 문서 업데이트와 재검증 없이는 금지
3. 비선형 함수나 regime별 별도 weight는 `Phase 0` 결과 전에는 도입 금지

## 한 줄 결론

`FEBT`는 직관적 구현이 아니라, 정규화된 microstructure 입력을 선형 가중합으로 결합한 명시적 timing score 체계로 시작해야 한다.
