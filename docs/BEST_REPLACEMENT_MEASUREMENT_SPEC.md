# BEST_REPLACEMENT_MEASUREMENT_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `blocked -> recovered` 비교의 maturity horizon과 pairwise/cohort 비교 규칙 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PERFORMANCE_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`

## 목적

`recovered signal`의 `성과 동등 이상`을 실제로 어떻게 비교할지 고정한다.

## 비교 단위

### 1차 비교

1. `pairwise blocked -> recovered`

### 2차 비교

1. `rolling cohort`

원칙:

1. `recovered 인정`은 pairwise 기준
2. `승격 판단`은 cohort 기준

## pairing 조건

1. 같은 `symbol`
2. 같은 `side`
3. 같은 `tier`
4. 같은 `approved timeframe`
5. blocked 후 `max 2 bars` 안
6. recovered는 새로운 `signal_id`

## maturity horizon

성과 비교 종료 시점은 아래 셋 중 가장 먼저 도달한 시점이다.

1. `TP1 first hit`
2. `SL first hit`
3. `max_eval_bars_by_tf`

### max_eval_bars_by_tf

1. `15m -> 16 bars`
2. `1h -> 8 bars`

## pairwise 비교 지표

1. `realized_r_at_maturity`
2. `mfe_r_at_maturity`
3. `mae_r_at_maturity`
4. `tp1_first`
5. `sl_first`
6. `bars_to_resolution`

## recovered 인정 규칙

아래 중 하나를 만족해야 한다.

### Rule A

1. `realized_r_recovered >= realized_r_blocked - 0.02R`
2. `mae_r_recovered <= mae_r_blocked`

### Rule B

1. `tp1_first_recovered = true`
2. `tp1_first_blocked = false`

### Rule C

1. `realized_r_recovered > realized_r_blocked`

## unrecovered loss

1. pairing 자체가 없음
2. pairing은 있으나 recovered 인정 규칙 불통과

## cohort 비교

key:

1. `market`
2. `timeframe`
3. `side`
4. `tier`
5. `regime`

지표:

1. `avg_realized_r_blocked`
2. `avg_realized_r_recovered`
3. `avg_mfe_r_blocked`
4. `avg_mfe_r_recovered`
5. `avg_mae_r_blocked`
6. `avg_mae_r_recovered`
7. `replacement_ratio`
8. `count_ratio`

## 산출 스키마

### pair row

1. `baseline_signal_id`
2. `recovered_signal_id`
3. `symbol`
4. `side`
5. `tier`
6. `tf`
7. `bars_delta`
8. `resolution_type`
9. `realized_r_blocked`
10. `realized_r_recovered`
11. `mfe_r_blocked`
12. `mfe_r_recovered`
13. `mae_r_blocked`
14. `mae_r_recovered`
15. `recovered_valid`

## 초기 구현 메모

1. 기존 `drop counterfactual` 로직 확장이 맞다.
2. `same symbol / side / tier / max 2 bars` pairing만 추가하면 초기 회계가 가능하다.

## 한 줄 결론

`recovered signal`은 `max 2 bars` 안의 pairwise 비교와 고정된 maturity horizon 위에서 성과가 동등 이상일 때만 인정해야 한다.
