# BEST_SELF_EVOLUTION_WEIGHT_TUNING_SPEC

- 제정: 2026-03-29
- 상태: ACTIVE
- 목적: threshold 자동 튜닝만으로 부족할 때 `FEBT weight` 조정 방향을 advisory 형태로 제시한다.

## 0. 현재 SSOT

1. latest artifact
   - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_weight_tuning_latest.json`
2. 현재 성격
   - `auto apply 금지`
   - `Codex patch engine prompt advisory`

## 1. 다루는 축

1. `lock_score_weight`
2. `delay_cost_weight`
3. `late_risk_weight`
4. `failure_risk_weight`

## 2. 기본 규칙

1. `count_floor_pass = false`면 advisory는 `HOLD`
2. `memory_blocked = true`면 advisory는 `HOLD`
3. `canary_blocked = true`면 advisory는 `HOLD`
4. advisory가 `ADJUST`여도 즉시 자동 반영하지 않는다

## 3. 해석 예

1. `late_loss_top_market`가 크면
   - `delay_cost_weight` 상향
   - `late_risk_weight` 소폭 완화 검토
2. `false_fire_top_market`가 크면
   - `failure_risk_weight` 상향
   - `lock_score_weight` 상향
3. `missed_recovery_top_reason`가 크면
   - `delay_cost_weight` 상향
   - `lock_score_weight` 완화 검토
