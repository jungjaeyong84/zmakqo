# FEBT_PHASE0_BASELINE_SNAPSHOT_2026W13

- 제정: 2026-03-29
- 상태: WORKING_BASELINE
- 목적: `BEST/FEBT` `Phase 0` 착수를 위한 현재 production baseline 수치 고정
- 기준 아티팩트:
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_1232_weekly_filter_governance.json`
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json`
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-28_2330_objective_retrospective.json`
  - `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_0800_ev_gate_impact_report_24h.json`

## 스코프

1. exchange: `BINANCEFUT`
2. timeframe baseline: `15m`
3. weekly baseline window:
   - `2026-03-21T15:00:00.000Z`
   - `2026-03-28T15:00:00.000Z`
4. 목적:
   - `FEBT` 도입 전 현재 `5차 WAIT` 체계의 entry/drop/performance 기준선 고정

## Baseline A. Weekly Entry Cohort

출처:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_1232_weekly_filter_governance.json`
2. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-28_2330_objective_retrospective.json`

핵심 수치:

1. `signals_n = 328`
2. `fills_n = 178`
3. `drops_n = 388`
4. `entry_cohort.signals_n = 252`
5. `entry_cohort.executed_n = 18`
6. `entry_cohort.execution_rate = 0.0714`
7. `realized_trades.trade_n = 87`
8. `realized_trades.win_rate = 0.4713`
9. `realized_trades.avg_ret_net = -0.001564`
10. `realized_trades.net_pnl_quote = -514.52`

해석:

1. 현재 baseline은 `승률 60%+`와 거리가 있다.
2. `FEBT`의 평가는 count만이 아니라 `47.13% -> 60%`로 향하는지 봐야 한다.
3. 다만 `entry_cohort.executed_n = 18`이므로 entry-level 실거래 표본은 아직 얇다.

## Baseline B. Tier Split

출처:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_1232_weekly_filter_governance.json`

`LONG/SHORT 기본 진입`

1. `signals_n = 42`
2. `executed_n = 16`
3. `execution_rate = 0.3810`
4. `tp1_hit_n = 5`
5. `tp1_hit_rate = 0.3125`
6. `sl_before_tp1_n = 3`
7. `sl_before_tp1_rate = 0.1875`

`LONG/SHORT 확장 진입`

1. `signals_n = 210`
2. `executed_n = 2`
3. `execution_rate = 0.0095`
4. `tp1_hit_n = 1`
5. `tp1_hit_rate = 0.5000`

해석:

1. baseline count의 대부분은 `확장 진입`에 있으나 실제 execution은 거의 없다.
2. `FEBT`는 count를 줄이지 않으면서도 `확장 진입`의 timing 재배치를 증명해야 한다.

## Baseline C. Current Drop Mix

출처:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_1232_weekly_filter_governance.json`

stage counts:

1. `OPS = 111`
2. `QUALITY = 222`
3. `AI = 1`
4. `MARKET = 1`
5. `EV = 53`
6. `TIMING = 0`

top reasons:

1. `숏 점수 무결성 미달 = 79`
2. `숏 confidence 무결성 미달 = 55`
3. `EV TP1 probability drop = 53`
4. `COST_SHIELD_ADD_BLOCKED = 45`
5. `숏 regime 무결성 미달 = 36`

해석:

1. 현재 production에서는 `TIMING` stage drop이 사실상 없다.
2. 따라서 `FEBT` 성공은 단순 `TIMING drop 대체`로 증명할 수 없다.
3. `FEBT`는 `legacy immediate/defer pass`와의 shadow disagreement로 가치를 보여야 한다.

## Baseline D. Drop Counterfactual

출처:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/weekly_filter_governance_latest.json`

overall:

1. `matured_n = 277`
2. `tp1_first_rate = 0.3827`
3. `sl_first_rate = 0.5199`
4. `hold_rate = 0.0975`
5. `horizon_pos_rate = 0.5379`
6. `avg_horizon_ret_net = -0.001341`

`QUALITY` stage:

1. `matured_n = 222`
2. `tp1_first_rate = 0.3468`
3. `sl_first_rate = 0.5495`
4. `avg_horizon_ret_net = -0.006762`

해석:

1. 현재 주요 차단 구간의 반사실은 평균적으로 방어적 성격이 강하다.
2. `FEBT LATE`는 최소한 이 정도의 `saved_loss > missed_gain` 구조를 만들어야 한다.

## Baseline E. EV Pressure Snapshot

출처:

1. `/Users/jeongjaeyong/Projects/donbeolja/ops/daily/2026-03-29_0800_ev_gate_impact_report_24h.json`

최근 24h:

1. `all_drops = 10`
2. `ev_gate_drops_total = 5`
3. `ev_drop_share_of_all_drops = 0.50`
4. `tp1_reach_prob_lower_bound.avg = 0.3774`

해석:

1. 최근 drop 압력은 EV층에서도 상당하다.
2. `FEBT`는 EV를 대체하는 게 아니라, EV를 통과한 신호의 timing 재배치를 담당해야 한다.

## 현재 공백

1. `bridge latency` baseline artifact는 아직 없다.
2. `legacy WAIT immediate/defer/drop` 분포를 직접 뽑은 전용 snapshot도 아직 없다.
3. `15m` 외 `1h` baseline snapshot은 아직 따로 고정하지 않았다.

## Phase 0 착수 판단

현재 문서 기준 판단:

1. baseline KPI snapshot은 시작 가능
2. overlap matrix schema 정의 필요
3. latency budget sheet 정의 필요
4. 이후 `legacy WAIT` 전용 추출 로직 또는 리포트 보강이 필요

## 한 줄 결론

현재 baseline은 `승률 47.13%`, `entry execution_rate 7.14%`, `TIMING drop 0` 상태다. `FEBT`는 이 baseline 위에서 `count를 깎지 않고 timing 분리를 만들어내는지`로 평가해야 한다.
