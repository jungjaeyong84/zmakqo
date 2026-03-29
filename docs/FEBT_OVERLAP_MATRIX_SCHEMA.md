# FEBT_OVERLAP_MATRIX_SCHEMA

- 제정: 2026-03-29
- 상태: PROPOSED
- 목적: `FEBT`와 기존 `1~5차` 판정의 중복/비중복을 측정하는 overlap matrix 스키마 고정
- 연계 문서:
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/FEBT_PHASE0_MEASUREMENT_PLAN.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SIGNAL_COUNT_PROTOCOL.md`
  - `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`

## 목적

이 문서는 아래 질문을 같은 표로 답하기 위한 스키마다.

1. `FEBT_FIRE`가 기존 `legacy WAIT immediate pass`와 얼마나 겹치는가
2. `FEBT_LATE`가 현재 `defer/drop`와 얼마나 겹치는가
3. `FEBT`가 기존 `2차/3차/4차/legacy 5차`를 중복 설명하는가
4. `FEBT`의 disagreement가 실제 성과 차이로 이어지는가

## row grain

기본 row grain:

1. `exchange`
2. `symbol`
3. `tf`
4. `side`
5. `bar_close_time_utc_ms`
6. `entry_grade`
7. `event`

권장 primary key:

```text
exchange|symbol|tf|side|bar_close_time_utc_ms|event|entry_grade
```

## source collections

최소 source:

1. `signals`
2. `signals_dropped`
3. `order_intents_paper`
4. `fills_paper`
5. `trades_paper`
6. `webhook_ledger`

보조 source:

1. `features_json`
2. `drop reason`
3. `market_state_summary_*`
4. `wait_one_bar_*`
5. `ev_gate_*`
6. `febt_*`

## input columns

### common identity

1. `exchange`
2. `symbol`
3. `tf`
4. `side`
5. `event`
6. `entry_grade`
7. `bar_close_time_utc_ms`
8. `signal_key`
9. `signal_id`

### upstream stage verdicts

1. `stage1_integrity_pass`
2. `stage2_structure_pass`
3. `stage3_market_action`
4. `stage4_ev_pass`
5. `legacy_wait_action`
6. `legacy_wait_reason`

### FEBT shadow fields

1. `febt_mode`
2. `febt_phase`
3. `febt_timing_action`
4. `febt_lock_score`
5. `febt_delay_cost`
6. `febt_late_risk`
7. `febt_failure_risk`
8. `febt_edge`
9. `febt_calc_ok`
10. `febt_calc_reason`

### context fields

1. `market_state_summary_state`
2. `market_state_summary_action`
3. `score_abs`
4. `confidence`
5. `wave_conf`
6. `tp1_reach_prob`
7. `tp1_reach_prob_lower_bound`

### outcome fields

1. `executed`
2. `tp1_first`
3. `sl_first`
4. `hold`
5. `avg_ret_net`
6. `mfe_pct`
7. `mae_pct`
8. `time_to_tp1_bars`
9. `time_to_sl_bars`

## derived comparison columns

### pair flags

1. `pair_fire_vs_wait_immediate`
2. `pair_fire_vs_ev_pass`
3. `pair_fire_vs_stage2_pass`
4. `pair_late_vs_wait_defer_or_drop`
5. `pair_late_vs_stage4_drop`

### disagreement flags

1. `disagree_fire_wait`
2. `disagree_late_wait`
3. `disagree_fire_ev`
4. `disagree_fire_stage2`
5. `disagree_phase_calc`

### replacement accounting

1. `blocked_by_febt`
2. `recovered_by_febt`
3. `replacement_pair_id`
4. `replacement_bars_delta`
5. `replacement_maturity_horizon_hours`

## matrix outputs

필수 집계:

1. `co_occurrence_ratio`
2. `jaccard_similarity`
3. `disagreement_count`
4. `disagreement_rate`
5. `avg_ret_delta`
6. `saved_loss_pct`
7. `missed_gain_pct`
8. `saved_loss_minus_missed_gain`

## breakdown axes

필수 breakdown:

1. `overall`
2. `symbol`
3. `tf`
4. `side`
5. `entry_grade`
6. `market_state_summary_state`
7. `market_state_summary_action`
8. `legacy_wait_action`
9. `febt_phase`

## canonical comparison sets

### Set A. timing distinctiveness

1. `FEBT_FIRE` vs `legacy_wait_immediate_pass`
2. `FEBT_LATE` vs `legacy_wait_defer_or_drop`

목표:

1. `FEBT`가 legacy WAIT와 사실상 동일한지만 먼저 본다.

### Set B. upstream redundancy

1. `FEBT_FIRE` vs `stage2_structure_pass`
2. `FEBT_FIRE` vs `stage3_market_action != DROP`
3. `FEBT_FIRE` vs `stage4_ev_pass`

목표:

1. `FEBT`가 2차/3차/4차를 다시 말하는 중복 계층인지 본다.

### Set C. outcome attribution

1. `FEBT_FIRE & disagree_fire_wait`
2. `FEBT_LATE & disagree_late_wait`
3. `blocked_by_febt`
4. `recovered_by_febt`

목표:

1. disagreement가 실제로 saved loss 또는 missed gain 개선을 만드는지 본다.

## pairing rule

`replacement_pair_id` 규칙:

1. same `symbol`
2. same `side`
3. same `entry_grade`
4. same `tf`
5. `max 2 bars`
6. 복수 후보면 `bars_delta` 최소 우선
7. `bars_delta` 동률이면 `febt_lock_score` 높은 후보 우선

세부 측정:

1. `/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_REPLACEMENT_MEASUREMENT_SPEC.md`

## null / unknown handling

1. `febt_calc_ok = false`면 `febt_phase = UNKNOWN`
2. `UNKNOWN`은 matrix에서 별도 bucket으로 유지
3. `legacy_wait_action` 미존재는 `WAIT_MISSING`
4. outcome 미성숙 row는 `matured = false`로 분리

## acceptance usage

### SHADOW

필수:

1. `Set A`
2. `Set B`
3. `UNKNOWN rate`

### SOFT

추가:

1. `Set C`
2. `replacement_ratio`
3. `count_ratio_global`

### HARD

추가:

1. `Wilson bound`
2. `approved market aggregation`
3. `latency / duplicate / reject interaction`

## 한 줄 결론

overlap matrix는 `FEBT가 새 이름만 붙인 중복인지`, `정말 timing 차이를 만드는지`, `그 차이가 saved loss / missed gain으로 이어지는지`를 같은 구조로 검증하는 핵심 테이블이다.
