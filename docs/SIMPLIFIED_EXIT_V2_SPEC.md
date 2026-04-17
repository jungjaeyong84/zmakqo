# Simplified Exit V2

## Goal

Replace the current multi-stage TP0/TP1/trailing design with a smaller and more reliable exit model that is easier to reason about, audit, and recover in live trading.

The primary objective is not feature richness. The primary objective is correctness under live execution.

## Core Decision

Simplified Exit V2 removes `TP0` completely.

The exit model becomes:

1. Entry fill completes.
2. A native `TP1` reduce-only order is placed immediately for `50%` of the filled position at `+1.68%` from entry.
3. A native full-position stop is placed immediately for `100%` of the position.
4. When `TP1` is fully filled, the remaining `50%` becomes the runner.
5. The runner is protected by a single trailing stop policy managed by the exit worker every `2s`.

This collapses the system into one deterministic partial take-profit and one deterministic runner.

## Why The Current Model Failed

The current runtime broke because too many layers inferred exit state independently:

- fill sync inferred stage
- alert path inferred stage
- tick exit inferred stage
- watchdog and repair flows inferred stage
- TP quantity contracts mixed percentage math with live quantity math

That design allows the system to disagree with itself.

The failure mode is structural, not incidental.

## Design Principles

1. One economic partial exit only: `TP1`
2. One runner only after `TP1` is complete
3. One stop writer only
4. One canonical source for exit state
5. One quantity contract based on absolute quantities
6. One alert source based on canonical transition only

## Economic State Model

Only three economic states are allowed:

- `FULL`: full position is still economically active, even if `TP1` is partially filled
- `RUNNER`: `TP1` target quantity has been fully consumed and only the runner remains
- `FLAT`: no open position remains

Important rule:

- Partial `TP1` fill does not move the position into `RUNNER`
- `RUNNER` starts only after `tp1_filled_qty_abs >= tp1_target_qty_abs`

## Execution State Model

Execution state is separate from economic state.

Allowed execution states:

- `SYNCED`
- `PENDING_SUBMIT`
- `PENDING_REPLACE`
- `RECOVERING`

This separation prevents transport or exchange-order lag from corrupting the economic contract.

## Canonical Orders

Only three order roles exist in the simplified model:

- `ENTRY_ORDER`
- `TP1_ORDER`
- `ACTIVE_STOP_ORDER`

Every live fill must be attributed to one of these order roles or be classified as `EXTERNAL_CLOSE_SYNC`.

## Quantity Contract

All quantity decisions must be absolute.

Required fields:

- `entry_qty_abs`
- `tp1_target_qty_abs`
- `runner_qty_abs`
- `tp1_filled_qty_abs`
- `runner_remaining_qty_abs`

Required invariants:

- `tp1_target_qty_abs + runner_qty_abs == entry_qty_abs`
- `0 <= tp1_filled_qty_abs <= tp1_target_qty_abs`
- `0 <= runner_remaining_qty_abs <= runner_qty_abs`
- `RUNNER` is forbidden before `tp1_filled_qty_abs >= tp1_target_qty_abs`
- no runtime path may recompute exit size as "current size * percentage"

## Price Contract

For `LONG`:

- `tp1_target_price = entry_price * (1 + tp1_target_pct)`
- `initial_stop_price = entry_price * (1 - stop_loss_pct)`
- `runner_floor_stop = entry_price * (1 + floor_lock_pct)`
- `r_based_trail_stop` is removed from V2 baseline
- `trail_stop = high_watermark * (1 - trail_pct)`
- `final_effective_stop = max(runner_floor_stop, trail_stop)`

For `SHORT`:

- `tp1_target_price = entry_price * (1 - tp1_target_pct)`
- `initial_stop_price = entry_price * (1 + stop_loss_pct)`
- `runner_floor_stop = entry_price * (1 - floor_lock_pct)`
- `r_based_trail_stop` is removed from V2 baseline
- `trail_stop = low_watermark * (1 + trail_pct)`
- `final_effective_stop = min(runner_floor_stop, trail_stop)`

## Native Protection Rules

At entry:

- place `TP1_ORDER` for `50%` of entry quantity
- place `ACTIVE_STOP_ORDER` for `100%` of entry quantity

After `TP1` completion:

- cancel and replace stop so that it protects only the runner
- trailing stop adjustments may only improve protection

Never do:

- multiple native TP ladders
- TP-stage inference from realized pnl
- TP-stage inference from residual percentage

## Canonical Events

Only the following exit events are allowed:

- `ENTRY_FILLED`
- `TP1_REACHED`
- `TRAIL_ACTIVATED`
- `TRAIL_FINAL_EXIT`
- `SL_HIT`
- `FORCE_EXIT_ALL`
- `EXTERNAL_CLOSE_SYNC`

Forbidden in V2 baseline:

- `TP0_REACHED`
- `TRAIL_PARTIAL`
- any alert that is derived from ad hoc fill interpretation

## Single Writer Rule

Only `binanceTickExit` may submit or replace native stop orders in live runtime.

All other components may only:

- detect drift
- emit repair requests
- emit diagnostics

They may not write live stop state directly.

## Exit Worker Rule

The exit worker runs every `2s`.

It is responsible for:

- refreshing watermark state
- recomputing `runner_floor_stop`
- recomputing `trail_stop`
- recomputing `final_effective_stop`
- deciding whether stop replacement is needed
- reconciling missing or stale stop orders

It is not responsible for inventing economic state.

## Recovery Rule

Recovery must use lineage, not heuristics.

Required recovery sources:

- `tp1_order_id`
- `active_stop_order_id`
- cumulative absolute fill quantity per order id
- current open position quantity

Forbidden recovery sources:

- raw percentage of current position
- realized pnl buckets
- alert event text

## Rollout Strategy

### Step 1

Add a standalone V2 contract module with no live integration.

Deliverables:

- constants for state and order roles
- absolute quantity plan builder
- TP1 fill accumulator
- canonical event classifier
- simplified trailing stop calculator
- focused unit tests

### Step 2

Wire read-only shadow computation into exit-path diagnostics.

Deliverables:

- existing runtime computes both legacy exit view and V2 shadow view
- differences are logged, not acted on

### Step 3

Replace alert generation with canonical V2 events.

Deliverables:

- alert path reads only canonical transition events
- fill-derived fallback alerts are disabled

### Step 4

Move live stop authority to a single writer.

Deliverables:

- only `binanceTickExit` can replace stop
- watchdog and repair flows emit requests only

### Step 5

Cut over live position management to the V2 economic contract.

Deliverables:

- TP0 code removed from live path
- TP1 is the only partial exit
- runner trailing uses only floor plus trailing percent

## Quality Gates

The rollout may not proceed unless the following tests pass:

- TP1 quantity split exactness
- partial TP1 fill stays `FULL`
- full TP1 fill enters `RUNNER`
- long trailing stop never degrades
- short trailing stop never degrades
- stop source selection matches floor versus trail rules
- event classifier does not emit `TP0`
- min-order and min-notional invalid plans hard fail

## Non-Goals For V2 Baseline

These are intentionally out of scope:

- multi-take-profit ladders
- R-multiple adaptive trail logic
- stage-specific alert variations
- percentage-based dynamic repartitioning after entry

Those features can return later only if they are rebuilt on top of the simplified contract.

## Summary

The current system needs less intelligence and more determinism.

Simplified Exit V2 does that by reducing the live exit contract to:

- one native partial take-profit
- one runner
- one trailing stop authority
- one canonical quantity ledger
- one canonical event stream
