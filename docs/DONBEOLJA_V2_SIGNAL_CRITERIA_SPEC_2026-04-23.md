# DONBEOLJA V2 Signal Criteria Spec

## Purpose

This document defines the minimum production-grade signal contract for V2 server-native ML/AI entry approval.

The goal is not to maximize trade count. The goal is to reject low-quality trades before they reach `productionEntryRoute`.

## Core Principle

V2 server-native entry is allowed only when all five layers pass:

1. `no_trade_gate`
2. `htf_regime`
3. `setup_gate`
4. `trigger_gate`
5. `expected_edge_gate`

The final verdict is computed as:

- `PASS`: all gates pass and `signal_score >= 80`
- `BLOCK`: any gate fails or the minimum score is not reached

Evidence rule:

- required evidence missing => `BLOCK`
- V2 signal criteria is fail-closed, not best-effort
- runtime must not synthesize passing defaults for missing setup/trigger/edge inputs

## Gate Definitions

### 1. No-Trade Gate

Purpose: reject structurally unsafe market states.

Current default thresholds:

- `spread_bps <= 8`
- `mark_index_gap_bps <= 10`
- `funding_penalty_bps <= 3`
- `market_quality_score >= 0.7`
- `market_data_quality.ok === true`

Blocker families:

- `NO_TRADE:NO_EVIDENCE:MARKET_QUALITY_SCORE`
- `NO_TRADE:NO_EVIDENCE:SPREAD_BPS`
- `NO_TRADE:NO_EVIDENCE:MARK_INDEX_GAP_BPS`
- `NO_TRADE:NO_EVIDENCE:FUNDING_PENALTY_BPS`
- `NO_TRADE:MARKET_DATA_QUALITY_NOT_OK`
- `NO_TRADE:MARKET_QUALITY_TOO_LOW`
- `NO_TRADE:SPREAD_TOO_WIDE`
- `NO_TRADE:MARK_INDEX_GAP_TOO_WIDE`
- `NO_TRADE:FUNDING_PENALTY_TOO_HIGH`

### 2. HTF Regime

Purpose: only trade in aligned higher-timeframe direction.

Current contract:

- `htf_regime === signal_side`
- `htf_alignment_score >= 0.6`

Blocker:

- `HTF_REGIME:NO_EVIDENCE:HTF_REGIME`
- `HTF_REGIME:NO_EVIDENCE:HTF_ALIGNMENT_SCORE`
- `HTF_REGIME:ALIGNMENT_REQUIRED`

### 3. Setup Gate

Purpose: require a valid trade location, not just direction.

Allowed setup types:

- `PULLBACK_RECLAIM`
- `BREAKOUT_RETEST`

Current contract:

- `setup_type !== NONE`
- `setup_quality_score >= 0.6`
- `setup_type` is never auto-synthesized from HTF direction alone

Blocker:

- `SETUP:NO_EVIDENCE:SETUP_TYPE`
- `SETUP:NO_EVIDENCE:SETUP_QUALITY_SCORE`
- `SETUP:QUALITY_REQUIRED`

### 4. Trigger Gate

Purpose: require real acceleration confirmation, not anticipation.

Current contract:

- `trigger_confirmed === true`
- `volume_zscore >= 1.0`
- for `LONG`: `rsi_entry_tf >= 55`
- for `SHORT`: `rsi_entry_tf <= 45`

Blocker:

- `TRIGGER:NO_EVIDENCE:TRIGGER_CONFIRMED`
- `TRIGGER:NO_EVIDENCE:VOLUME_ZSCORE`
- `TRIGGER:NO_EVIDENCE:RSI_ENTRY_TF`
- `TRIGGER:CONFIRMATION_REQUIRED`

### 5. Expected Edge Gate

Purpose: reject trades that do not survive cost.

Current contract:

- `expected_gross_r >= 1.8`
- `expected_net_r_after_cost >= 0.25`
- `cost_estimate_bps` evidence required
- `cost_r_equivalent` evidence required
- `|(expected_gross_r - cost_r_equivalent) - expected_net_r_after_cost| <= 0.05`
- derived `expected_edge_model` must be computed from signal evidence, not injected as an override

Derived model outputs:

- `tp1_reach_probability`
- `continuation_probability`
- `stop_hit_probability`
- `edge_cohort`
- `edge_score_out_of_20`

Blocker:

- `EXPECTED_EDGE:NO_EVIDENCE:EXPECTED_GROSS_R`
- `EXPECTED_EDGE:NO_EVIDENCE:EXPECTED_NET_R_AFTER_COST`
- `EXPECTED_EDGE:NO_EVIDENCE:COST_ESTIMATE_BPS`
- `EXPECTED_EDGE:NO_EVIDENCE:COST_R_EQUIVALENT`
- `EXPECTED_EDGE:ACCOUNTING_INCONSISTENT`
- `EXPECTED_EDGE:NET_R_REQUIRED`

## Score Model

Current score components:

- `htf_regime`: 25 points
- `setup_quality`: 20 points
- `trigger_quality`: 20 points
- `market_quality`: 15 points
- `expected_edge`: 20 points, derived from the expected-edge model rather than raw net-R alone

Production approval floor:

- `signal_score >= 80`

Important:

- `signal_score` is computed inside [signalCriteria.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCriteria.js)
- external `signal_score` input is audit-only and must not override the computed score
- score is a second filter, not a cosmetic restatement of the five gate verdicts

Blocker:

- `SIGNAL_SCORE:MIN_SCORE_REQUIRED`

## Runtime Integration

Implemented in:

- [signalCriteria.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCriteria.js)
- [signalRegimeProfile.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalRegimeProfile.js)
- [expectedEdgeModel.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/expectedEdgeModel.js)
- [openclawControlPlane.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawControlPlane.js)
- [signalAuthorityRouter.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalAuthorityRouter.js)
- [mlAiSignalProposal.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/mlAiSignalProposal.js)
- [openclawOutcomeAdjudicator.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawOutcomeAdjudicator.js)
- [openclawDailyPerformanceReport.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawDailyPerformanceReport.js)
- [signalCohortReport.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCohortReport.js)

Runtime behavior:

- OpenClaw builds `canonical_evidence_summary.signal_criteria`
- Router blocks entry if `signal_criteria.verdict !== PASS`
- Proposal stores `setup_type`, `signal_score`, `expected_net_r_after_cost`, `structural_regime`, `regime_cohort`, `edge_cohort`
- Outcome adjudication auto-enriches `evidence` with `signal_criteria`, `signal_regime_profile`, `expected_edge_model`, and `openclaw_decision_bundle_hash`
- Daily performance reporting now emits `cohort_summary` by setup type, regime cohort, edge cohort, setup x regime, signal-score bucket, and trigger-quality bucket

## Regime Profile

The runtime now classifies a separate regime profile alongside the directional HTF gate.

Fields:

- `structural_regime`: `TREND | RANGE | TRANSITION | UNKNOWN`
- `volatility_regime`: `HIGH_VOL | NORMAL_VOL | LOW_VOL | UNKNOWN`
- `liquidity_regime`: `ADEQUATE | THIN | UNKNOWN`
- `directional_bias`: `ALIGNED | COUNTERTREND | NEUTRAL`
- `regime_cohort`
- `regime_score`

Important:

- this classifier is intended to improve explainability, cohort reporting, and expected-edge estimation
- it is not a silent override of the five hard gates
- if regime evidence is weak, the regime profile can degrade to `UNKNOWN` without synthesizing a passing gate verdict

## Performance Stages

Performance gate now evaluates three stages:

- `DISCOVERY`
- `CANARY`
- `LIVE`

Defaults:

| Stage | sample_n | win_rate_pct | profit_factor | expectancy_r | net_pnl_pct | max_drawdown_pct |
|---|---:|---:|---:|---:|---:|---:|
| DISCOVERY | 20 | 45 | 1.05 | >0 | >0 | -8 |
| CANARY | 50 | 48 | 1.10 | >0 | >0 | -6 |
| LIVE | 200 | 50 | 1.15 | >0 | >0 | -5 |

Implemented in:

- [performanceGate.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/performanceGate.js)
- [check-v2-performance-gate.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/check-v2-performance-gate.js)

## Discovery Canary Decision Table

Discovery preflight now emits both:

- streak/cutover readiness
- performance stage matrix

Implemented in:

- [run-v2-discovery-canary-preflight-deploy.js](/Users/jeongjaeyong/Projects/donbeolja/scripts/run-v2-discovery-canary-preflight-deploy.js)

Operational interpretation:

- Discovery deploy is still blocked by runtime preflight if entry/exit/repair streaks fail
- Performance stage matrix is advisory for capital expansion, not a replacement for preflight
- `LIVE` stage is still a minimum gate, not proof of production alpha by itself

## Non-Goals

This contract is not a claim of profitability.

It is a production-grade minimum filter set intended to:

- remove structurally bad trades
- make signal quality explainable
- support discovery/canary/live stage promotion with explicit thresholds

## Deferred Blocker Families Before Full LIVE

The following blocker families are intentionally not part of the seed contract yet and must be reviewed before capital expansion:

- liquidity / ADV floor by symbol and session
- event blackout windows around funding settlement and exchange event risk
- stop-distance sanity checks relative to ATR / tick noise
- leverage / notional regime caps beyond the current risk governor
- session filters for low-liquidity hours

These are deferred on purpose, not ignored. The current contract is `safe to test`, not `complete for scale`.
