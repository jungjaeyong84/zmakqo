# BEST_SELF_EVOLUTION_ATTRIBUTION_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: 손실과 missed gain을 어떤 레이어와 파라미터가 만들었는지 분해하는 규격

## 1. attribution 종류

1. `drop_attribution`
2. `late_loss_attribution`
3. `false_fire_attribution`
4. `missed_recovery_attribution`
5. `fallback_cost_attribution`

## 2. 최소 출력

1. `layer`
2. `market`
3. `reason`
4. `sample_n`
5. `net_pnl_quote`
6. `avg_ret_net`
7. `missed_gain_pct`
8. `saved_loss_pct`

## 3. 활용

1. 감독관 blocker 설명
2. Codex 후보 생성 근거
3. weekly governance 우선순위 결정
