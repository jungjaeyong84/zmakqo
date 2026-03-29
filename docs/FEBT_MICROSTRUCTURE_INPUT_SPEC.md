# FEBT_MICROSTRUCTURE_INPUT_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT`가 사용하는 microstructure 중간 입력을 `OHLCV` 기준으로 고정
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE1_PINE_FIELD_SPEC.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_SCORE_CALCULATION_SPEC.md`

## 목적

이 문서는 `FEBT_SCORE_CALCULATION_SPEC`에서 사용하는 아래 8개 입력이 구현자마다 다르게 해석되지 않게 막는다.

1. `same_dir_streak`
2. `recent_move_1_pct`
3. `recent_move_2_pct`
4. `break_retention`
5. `close_control`
6. `impulse_decay`
7. `counter_rejection`
8. `micro_absorption`

원칙:

1. first release는 `OHLCV + volume SMA(20)`만 사용한다.
2. 추가 oscillator, AI score, stat-physics 재계산은 금지한다.
3. 모든 방향성 변수는 `LONG` / `SHORT` 대칭으로 정의한다.

## 공통 보조값

```text
range_safe = max(high - low, syminfo.mintick)
body = abs(close - open)
body_ratio = body / range_safe
range_pos = (close - low) / range_safe
upper_wick_ratio = (high - max(open, close)) / range_safe
lower_wick_ratio = (min(open, close) - low) / range_safe
vol_ma_20 = max(ta.sma(volume, 20), 1.0)
vol_ratio = volume / vol_ma_20
```

방향 보조값:

```text
dir_close_pos_long = clamp01(range_pos)
dir_close_pos_short = clamp01(1 - range_pos)
dir_reject_long = clamp01(lower_wick_ratio)
dir_reject_short = clamp01(upper_wick_ratio)
opp_reject_long = clamp01(upper_wick_ratio)
opp_reject_short = clamp01(lower_wick_ratio)
```

## 1. same_dir_streak

정의:

1. 현재 bar를 포함해, `close-to-close` 기준으로 같은 방향 종가 이동이 연속된 bar 수
2. `LONG`는 `close >= close[1]`
3. `SHORT`는 `close <= close[1]`
4. 첫 release는 최대 10봉까지만 추적한다.

의사 코드:

```text
same_dir_streak_long = 0
for i = 0 to 9:
  if close[i] >= close[i + 1]:
    same_dir_streak_long += 1
  else:
    break

same_dir_streak_short = 0
for i = 0 to 9:
  if close[i] <= close[i + 1]:
    same_dir_streak_short += 1
  else:
    break
```

선택 규칙:

```text
same_dir_streak = signal_dir == LONG ? same_dir_streak_long : same_dir_streak_short
```

## 2. recent_move_1_pct

정의:

1. 현재 종가 기준 최근 1봉 순이동률
2. `close-to-close` 기준을 사용한다.
3. 방향은 선택 단계에서 제거하고, 절댓값은 score 문서에서 정규화한다.

공식:

```text
recent_move_1_pct = ((close - close[1]) / max(close[1], syminfo.mintick)) * 100
```

## 3. recent_move_2_pct

정의:

1. 현재 종가 기준 최근 2봉 누적 이동률
2. `close-to-close` 2봉 누적 기준을 사용한다.

공식:

```text
recent_move_2_pct = ((close - close[2]) / max(close[2], syminfo.mintick)) * 100
```

## 4. break_retention

정의:

1. 직전 2봉 구조 돌파 후 종가가 얼마나 유지됐는지 측정
2. 현재 bar가 구조 ref 위에서 마감하면 `0.5` 초과
3. ref 아래로 복귀하면 `0.5` 미만

참조값:

```text
break_ref_long = max(high[1], high[2])
break_ref_short = min(low[1], low[2])
```

공식:

```text
break_retention_long = clamp01(0.5 + ((close - break_ref_long) / range_safe))
break_retention_short = clamp01(0.5 + ((break_ref_short - close) / range_safe))
```

선택 규칙:

```text
break_retention = signal_dir == LONG ? break_retention_long : break_retention_short
```

## 5. close_control

정의:

1. 방향성 종가 지배력
2. 종가 위치와 body 확정력을 함께 본다.
3. close가 방향 끝단에 가깝고 body가 크면 높다.

공식:

```text
close_control_long = clamp01(0.65 * dir_close_pos_long + 0.35 * body_ratio)
close_control_short = clamp01(0.65 * dir_close_pos_short + 0.35 * body_ratio)
```

선택 규칙:

```text
close_control = signal_dir == LONG ? close_control_long : close_control_short
```

## 6. impulse_decay

정의:

1. 직전 방향성 impulse 대비 현재 impulse가 약해졌는지 측정
2. 방향 body 약화와 종가 확장 실패를 동시에 본다.
3. 높을수록 현재 봉의 추세 지속력이 약해진 상태다.

보조값:

```text
body_ratio_prev = abs(close[1] - open[1]) / max(high[1] - low[1], syminfo.mintick)

dir_body_prev_long =
  close[1] >= open[1] ? clamp01(body_ratio_prev) : 0.0

dir_body_prev_short =
  close[1] <= open[1] ? clamp01(body_ratio_prev) : 0.0

dir_body_now_long =
  close >= open ? clamp01(body_ratio) : 0.0

dir_body_now_short =
  close <= open ? clamp01(body_ratio) : 0.0

extension_fail_long = clamp01((high[1] - close) / range_safe)
extension_fail_short = clamp01((close - low[1]) / range_safe)
```

공식:

```text
impulse_decay_long =
  clamp01(
    0.60 * max(dir_body_prev_long - dir_body_now_long, 0.0) +
    0.40 * extension_fail_long
  )

impulse_decay_short =
  clamp01(
    0.60 * max(dir_body_prev_short - dir_body_now_short, 0.0) +
    0.40 * extension_fail_short
  )
```

선택 규칙:

```text
impulse_decay = signal_dir == LONG ? impulse_decay_long : impulse_decay_short
```

## 7. counter_rejection

정의:

1. 반대방향 압력이 wick으로만 남고 종가가 다시 주도 방향으로 회복됐는지 측정
2. 방향 wick rejection과 방향 close dominance를 같이 본다.

공식:

```text
counter_rejection_long =
  clamp01(0.60 * dir_reject_long + 0.40 * dir_close_pos_long)

counter_rejection_short =
  clamp01(0.60 * dir_reject_short + 0.40 * dir_close_pos_short)
```

선택 규칙:

```text
counter_rejection = signal_dir == LONG ? counter_rejection_long : counter_rejection_short
```

## 8. micro_absorption

정의:

1. 높은 거래량 아래에서 반대 압력을 흡수하고 방향 종가를 회복한 정도
2. volume spike, 방향 rejection, close dominance를 결합한다.

보조값:

```text
vol_spike = clamp01(vol_ratio / 2.5)
```

공식:

```text
micro_absorption_long =
  clamp01(
    0.45 * vol_spike +
    0.35 * dir_reject_long +
    0.20 * dir_close_pos_long
  )

micro_absorption_short =
  clamp01(
    0.45 * vol_spike +
    0.35 * dir_reject_short +
    0.20 * dir_close_pos_short
  )
```

선택 규칙:

```text
micro_absorption = signal_dir == LONG ? micro_absorption_long : micro_absorption_short
```

## 구현 원칙

1. `signal_dir`는 `LONG` 또는 `SHORT`만 허용한다.
2. `signal_dir`가 없으면 `calc_ok = false`로 내리고 `UNKNOWN` 경로를 탄다.
3. score 문서는 이 문서에서 정의한 선택값을 그대로 입력으로 받는다.
4. Phase 1에서는 이 문서의 공식 외 추가 smoothing 금지

## Calibration 메모

아래 상수는 first release 고정값이다.

1. `same_dir_streak / 4.0`
2. `recent_move_1_pct / 2.5`
3. `recent_move_2_pct / 4.0`
4. `vol_ratio / 2.5`

이 값들은 `BTCUSDT 15m` 보수적 분포 기준 seed이며, `Phase 0` 이후에만 조정할 수 있다.

## 한 줄 결론

`FEBT`는 추상 timing 직관이 아니라, 8개 microstructure 입력을 `OHLCV`로 재현 가능하게 계산한 뒤 score 문서로 넘기는 2단 구조여야 한다.
