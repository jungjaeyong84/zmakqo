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

## Gate Definitions

### 1. No-Trade Gate

Purpose: reject structurally unsafe market states.

Current default thresholds:

- `spread_bps <= 8`
- `mark_index_gap_bps <= 10`
- `funding_penalty_bps <= 3`
- `market_data_quality.ok === true`

Blocker families:

- `NO_TRADE:MARKET_DATA_QUALITY_NOT_OK`
- `NO_TRADE:SPREAD_TOO_WIDE`
- `NO_TRADE:MARK_INDEX_GAP_TOO_WIDE`
- `NO_TRADE:FUNDING_PENALTY_TOO_HIGH`

### 2. HTF Regime

Purpose: only trade in aligned higher-timeframe direction.

Current contract:

- `htf_regime === signal_side`
- `htf_alignment_score >= 0.6`

Blocker:

- `HTF_REGIME:ALIGNMENT_REQUIRED`

### 3. Setup Gate

Purpose: require a valid trade location, not just direction.

Allowed setup types:

- `PULLBACK_RECLAIM`
- `BREAKOUT_RETEST`

Current contract:

- `setup_type !== NONE`
- `setup_quality_score >= 0.6`

Blocker:

- `SETUP:QUALITY_REQUIRED`

### 4. Trigger Gate

Purpose: require real acceleration confirmation, not anticipation.

Current contract:

- `trigger_confirmed === true`
- `volume_zscore >= 1.0`
- for `LONG`: `rsi_entry_tf >= 55`
- for `SHORT`: `rsi_entry_tf <= 45`

Blocker:

- `TRIGGER:CONFIRMATION_REQUIRED`

### 5. Expected Edge Gate

Purpose: reject trades that do not survive cost.

Current contract:

- `expected_gross_r >= 1.8`
- `expected_net_r_after_cost >= 0.25`

Blocker:

- `EXPECTED_EDGE:NET_R_REQUIRED`

## Score Model

Current score components:

- `htf_regime`: 25 points
- `setup_quality`: 20 points
- `trigger_quality`: 20 points
- `market_quality`: 15 points
- `expected_edge`: 20 points

Production approval floor:

- `signal_score >= 80`

Blocker:

- `SIGNAL_SCORE:MIN_SCORE_REQUIRED`

## Runtime Integration

Implemented in:

- [signalCriteria.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalCriteria.js)
- [openclawControlPlane.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/openclawControlPlane.js)
- [signalAuthorityRouter.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/signalAuthorityRouter.js)
- [mlAiSignalProposal.js](/Users/jeongjaeyong/Projects/donbeolja/src/v2/mlAiSignalProposal.js)

Runtime behavior:

- OpenClaw builds `canonical_evidence_summary.signal_criteria`
- Router blocks entry if `signal_criteria.verdict !== PASS`
- Proposal stores `setup_type`, `signal_score`, `expected_net_r_after_cost`

## Performance Stages

Performance gate now evaluates three stages:

- `DISCOVERY`
- `CANARY`
- `LIVE`

Defaults:

| Stage | sample_n | win_rate_pct | profit_factor | expectancy_r | net_pnl_pct | max_drawdown_pct |
|---|---:|---:|---:|---:|---:|---:|
| DISCOVERY | 20 | 45 | 1.05 | >0 | >0 | -5 |
| CANARY | 50 | 48 | 1.10 | >0 | >0 | -6 |
| LIVE | 100 | 50 | 1.15 | >0 | >0 | -5 |

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

## Non-Goals

This contract is not a claim of profitability.

It is a production-grade minimum filter set intended to:

- remove structurally bad trades
- make signal quality explainable
- support discovery/canary/live stage promotion with explicit thresholds
