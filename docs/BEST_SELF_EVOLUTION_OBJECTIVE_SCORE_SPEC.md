# BEST_SELF_EVOLUTION_OBJECTIVE_SCORE_SPEC

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: 감독관과 자동화가 같은 목적함수로 후보를 비교하게 만들기 위한 점수 규격

## 1. 전역 목적함수

`objective_score = profit_score + count_score + replacement_score + tp1_score - drawdown_penalty - latency_penalty - instability_penalty`

## 2. 필수 구성

1. `profit_score`
   - 월간 순수익, avg_ret_net, expectancy
2. `count_score`
   - `count_ratio_global >= 1.00` 유지 여부
3. `replacement_score`
   - blocked 신호를 더 좋은 봉으로 복구한 정도
4. `tp1_score`
   - `tp1_first_rate`, `fire_win_rate`
5. `drawdown_penalty`
   - negative pnl, adverse excursion, objective fail
6. `latency_penalty`
   - webhook->fill p95, duplicate, reject, stale
7. `instability_penalty`
   - drift, payload missing, disagreement 과다

## 3. 산출 단위

1. `global_objective_score`
2. `market_objective_score`
3. `candidate_objective_delta`

## 4. 헌법 규칙

1. `count_ratio_global < 1.00`이면 profit_score가 좋아도 승격 금지
2. `replacement_ratio < 0.80`이면 tightening 우선 금지
3. `latency_penalty`가 임계 초과면 canary 확대 금지
