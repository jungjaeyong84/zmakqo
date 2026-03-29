# BEST_SELF_EVOLUTION_CANARY_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: 후보 변경을 shadow 이후 시장별 canary로 적용하고 실패 시 자동 rollback하는 규격

## 1. canary 단위

1. `market`
2. `tf`
3. `candidate_id`
4. `stage`
   - `SHADOW`, `SOFT`, `HARD`

## 2. canary 확대 규칙

1. BTCUSDT, SOLUSDT부터 시작
2. DOGEUSDT, AXSUSDT는 뒤로
3. `objective_score`와 `count_ratio_global`이 유지될 때만 확대

## 3. rollback 조건

1. `count_ratio_global < 1.00`
2. `replacement_ratio` 붕괴
3. `avg_ret_net` 열화
4. `latency_penalty` 초과
5. `duplicate/reject/stale` 급증

## 4. rollback 출력

1. `rollback_reason`
2. `rollback_target`
3. `rollback_scope`
4. `rollback_triggered_at`
