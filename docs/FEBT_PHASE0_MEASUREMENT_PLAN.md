# FEBT_PHASE0_MEASUREMENT_PLAN

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT` 도입 전 `현행 5차 WAIT 타이밍층` baseline과 `FEBT`의 독립 기여도를 정량 측정
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_CONCEPT.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PINE_INTRODUCTION_PLAN.md`

## 측정 목표

1. 현행 `5차 WAIT`의 saved loss / missed gain 구조 고정
2. `FEBT`와 기존 `2차/3차/4차/현행 5차` overlap 정량화
3. `FIRE`, `ARMED`, `LATE`, `VOID`가 실제 성과 차이를 갖는지 증명
4. `TradingView -> webhook -> intent -> fill` 지연이 timing 이론을 훼손하지 않는지 확인

## 핵심 질문

1. `FEBT`는 현행 5차보다 더 나은 timing 분류를 제공하는가
2. `FEBT`는 기존 2차/3차/4차를 중복 설명하는가, 아니면 다른 timing 정보를 주는가
3. `FIRE`는 너무 빠르지 않고, `LATE`는 너무 늦은 진입을 실제로 걸러내는가

## 필수 집계 창

1. `7d`
2. `14d`
3. `28d`
4. `56d`

## 필수 drill-down 축

1. `symbol`
2. `side`
3. `tier`
4. `regime`
5. `market_state_summary_state`
6. `market_state_summary_action`
7. `provider`
8. `timeframe`

## 필수 baseline

### 현행 5차 WAIT

1. `wait_trigger_count`
2. `wait_defer_count`
3. `wait_drop_count`
4. `avg_ret_immediate`
5. `avg_ret_waited`
6. `saved_loss_pct`
7. `missed_gain_pct`
8. `saved_loss_minus_missed_gain`

### 역할 분리

1. `FEBT_FIRE` vs `2차 pass`
2. `FEBT_FIRE` vs `3차 action != DROP`
3. `FEBT_FIRE` vs `4차 EV pass`
4. `FEBT_FIRE` vs `현행 5차 immediate pass`
5. `FEBT_LATE` vs `현행 5차 defer/drop`

필수 산출:

1. `co_occurrence_ratio`
2. `jaccard_similarity`
3. `disagreement_count`
4. `avg_ret_delta`

## 필수 outcome

1. `tp1_first_rate`
2. `sl_first_rate`
3. `avg_ret_net`
4. `avg_mfe_pct`
5. `avg_mae_pct`
6. `time_to_tp1_bars`
7. `time_to_sl_bars`

## 브리지 latency

필수 측정:

1. `alert_to_webhook_ms`
2. `webhook_to_intent_ms`
3. `intent_to_fill_ms`
4. `alert_to_fill_ms`
5. `duplicate_count`
6. `stale_count`
7. `reject_count`

필수 통계:

1. `p50`
2. `p95`
3. `max`

## 최소 표본 기준

1. `shadow observation >= 4주`
2. `FIRE sample >= 200`
3. `LATE sample >= 200`
4. `long/short each >= 80`
5. `major market each >= 30`

## 합격선

### SOFT 전환 전

1. `FIRE` win rate non-inferior
2. `FIRE` avg_ret_net non-inferior
3. `LATE`의 `saved_loss_minus_missed_gain > 0`
4. `ARMED`의 1봉 대기 성과가 immediate 이상
5. `alert_to_fill_ms p95`가 허용 budget 이내

### HARD 전환 전

1. `FIRE precision`이 현행 5차보다 우세
2. 월간 순수익 pace 악화 없음
3. symbol/regime drift 없음
4. duplicate/stale/reject runbook 검증 완료

## 산출물

1. `febt_wait_baseline.md/json`
2. `febt_overlap_matrix.md/json`
3. `febt_disagreement_report.md/json`
4. `febt_bridge_latency.md/json`

## 실패 조건

1. `FEBT_FIRE`가 기존 5차 immediate와 사실상 동일
2. `FEBT_LATE`가 좋은 추세 진입을 과도하게 자름
3. `FIRE/LATE`가 성과적으로 분리되지 않음
4. 브리지 지연 때문에 `FIRE` 의미가 실전에서 붕괴

## 한 줄 결론

`Phase 0`는 `FEBT`가 멋진 개념인지가 아니라, 실제로 현행 5차보다 다른 timing 정보를 제공하는지를 숫자로 증명하는 단계다.
