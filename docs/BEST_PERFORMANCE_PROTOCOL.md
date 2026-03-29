# BEST_PERFORMANCE_PROTOCOL

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `승률 60%+` 목표를 실제 검증 프로토콜로 정의
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_PHILOSOPHY.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_IMPLEMENTATION_FRAMEWORK.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`

## 목적

`승률 60%+`는 슬로건이 아니라 아래 4개가 동시에 성립할 때만 의미가 있다.

1. 어느 시장군에서
2. 어느 시간대에서
3. 어느 기간 동안
4. 어느 표본 수 위에서

이 문서는 그 운영 기준을 고정한다.

## 승인 시장군

초기 승인 시장군:

1. `BTCUSDT`
2. `ETHUSDT`
3. `BNBUSDT`
4. `XRPUSDT`
5. `SOLUSDT`
6. `AXSUSDT`
7. `DOGEUSDT`

원칙:

1. `60%+`는 우선 승인 시장군 기준이다.
2. 승인 시장군 밖 결과는 참고값이지 승격 근거가 아니다.

## 승인 시간대

초기 검증 시간대:

1. `15m`
2. `1h`

원칙:

1. 다른 시간대는 별도 승인 없이는 `참고값`

## 핵심 지표

### primary

1. `win_rate`
2. `avg_ret_net`
3. `expectancy`
4. `tp1_first_rate`
5. `sl_first_rate`
6. `signal_count`
7. `count_ratio_vs_baseline`

### secondary

1. `avg_mfe_pct`
2. `avg_mae_pct`
3. `time_to_tp1_bars`
4. `time_to_sl_bars`
5. `alert_to_fill_ms_p95`

## 측정 창

성능은 아래 두 축을 모두 본다.

### signal-count window

1. 최근 `50 signals`
2. 최근 `100 signals`

### time window

1. 최근 `28d`
2. 최근 `56d`

원칙:

1. `signal-count window`와 `time window` 둘 다 나빠지면 실패
2. 하나만 좋고 하나가 나쁘면 `HOLD`

## 최소 표본

### global

1. 전체 `approved markets` 합계 `>= 200 signals`

### per side

1. `long >= 80`
2. `short >= 80`

### per market

1. 각 승인 시장 `>= 20 signals` in `56d`

### per market-timeframe pair

1. 각 승인 `market x timeframe >= 12 signals` in `56d`

표본이 부족하면 성능 승인은 불가다.

## 승률 판정

`60%+` 목표는 아래를 모두 만족해야 한다.

### global pass

1. `approved markets aggregated point-estimate win_rate >= 0.60`
2. `56d window point-estimate win_rate >= 0.60`
3. `100-signal window point-estimate win_rate >= 0.60`

### confidence guard

1. `95% Wilson lower bound >= 0.55`

원칙:

1. 점추정치만 60%고 신뢰구간이 너무 약하면 `HOLD`

## non-inferiority 판정

`BEST/FEBT`는 아래를 baseline 대비 훼손하면 안 된다.

1. `avg_ret_net`
2. `expectancy`
3. `tp1_first_rate`
4. `signal_count`

### non-inferiority margin

1. `avg_ret_net delta >= -0.05R`
2. `expectancy delta >= -0.03R`
3. `tp1_first_rate delta >= -0.02`

margin을 넘게 나빠지면 `NO-GO`

## 시장별 승인 판정

개별 시장은 아래로 본다.

### market pass

1. `56d win_rate >= 0.58`
2. `95% Wilson lower bound >= 0.52`
3. `avg_ret_net non-inferior`
4. `count_ratio >= floor`

### global hard pass

1. `approved markets aggregated win_rate >= 0.60`
2. `count floor` 충족
3. `latency floor` 충족

## latency floor

1. `alert_to_fill_ms_p95 <= bar_ms * 0.20`
2. `duplicate rate <= 0.5%`
3. `reject rate <= 0.5%`
4. `stale rate <= 1.0%`

위 조건이 깨지면 chart win rate는 보조지표로 격하된다.

## phase별 검증

승격 단계 관계:

1. `52%` = `SHADOW -> SOFT` 후보선
2. `58%` = `SOFT 유지선`
3. `60%` = `HARD 승격선`

### FIRE

1. `win_rate non-inferior`
2. `avg_ret_net non-inferior`
3. `tp1_first_rate` 우세 또는 동등

### ARMED

1. 1봉 대기 성과가 immediate보다 동등 이상

### LATE

1. `saved_loss_minus_missed_gain > 0`

### VOID

1. 차단 케이스가 실제 손실 회피에 기여

## 결과 해석

### APPROVE

1. `60%+` 충족
2. `count floor` 충족
3. `non-inferiority` 충족
4. `latency floor` 충족

### HOLD

1. 일부 지표는 좋지만 표본/신뢰구간/latency가 약함
2. `52%` 또는 `58%`는 넘지만 `60%`는 못 넘는 구간

### REJECT

1. `60%+` 미달
2. `count floor` 미달
3. `expectancy` 악화
4. `latency floor` 위반

## 한 줄 결론

`승률 60%+`는 문구가 아니라, 승인 시장군과 표본 수, 신뢰구간, latency, count floor를 모두 포함한 운영 검증 계약이어야 한다.
