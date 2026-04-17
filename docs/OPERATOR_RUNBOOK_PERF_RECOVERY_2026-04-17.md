# Operator Runbook — Perf Recovery Sequence (2026-04-17)

This runbook executes the four actions from the 2026-04-17 performance
diagnosis. Each step has a clear success criterion and a clean rollback.

**Context**: `objective_score -8.26` has auto-quarantined entry flow.
Sample size has dropped to n=14 realized outcomes — too few for any
statistical conclusion. The diagnosis indicates the root cause is not
signal quality but **(a) TP1/SL payoff asymmetry, (b) execution latency
drag, (c) recent regime deterioration**, amplified by quarantine feedback.

The recovery sequence breaks the feedback loop, gathers clean samples,
then runs a grid search so we can commit to a new exit contract with
data, not intuition.

---

## Step 0 — Preconditions (do once before Step 1)

- Phase 3c commit `ca4c4e0` or later is deployed (Firestore emulator env,
  drop panel, gate skip-list, migration script).
- Phase 3d commit (below) is deployed (operator override, grid tool,
  bottleneck analyzer).
- You have write access to `ops/runtime/` on the production host.
- You have run `npm test` locally and it passes (exit 0).

---

## Step 1 — Execution bottleneck waterfall (read-only, do first)

**What**: Run the bottleneck analyzer. It reads existing ops artifacts and
prints the stage breakdown + recommendations. No production writes.

```
node scripts/analyze-execution-bottleneck.js --write
```

**Success**: `ops/daily/exit_exec_bottleneck_waterfall_latest.json` shows
the top bottleneck stage and per-market verdict.

**Baseline (2026-04-17 snapshot)**:
- `top_bottleneck_stage`: `intent_to_fill_measured` (~56min p95)
- `partial_fill_rate_pct`: 67.6 (global)
- `adverse_slippage_p95_bps`: 81.4
- Urgent partial-fill markets: DOGEUSDT 90%, LINKUSDT 83%, BNBUSDT 82%,
  AXSUSDT 78%, SOLUSDT 77%

**Action**: Feed the partial-fill recommendation to the SRE / execution
team. This is the largest single contributor to the negative PnL but is
independent of strategy — resolving it does not require new signals.

---

## Step 2 — Grid search on current 244 trades (offline)

**What**: Sweep SL/TP1/TP1_QTY/trail_R against the real trade episodes so
we know what the right exit contract is before we commit to any change.

### 2a — Export episodes from production (one-time)

Write a small loader that pulls entry fills + subsequent bar paths into
the JSON shape described at the top of
`scripts/backtest-exit-params-grid.js`. Save to
`ops/runtime/exit_grid_episodes.json`.

### 2b — Run grid

```
node scripts/backtest-exit-params-grid.js \
  --fixture ops/runtime/exit_grid_episodes.json \
  --top 20 \
  --write
```

**Success**: `ops/daily/exit_params_grid_latest.json` ranks parameter
combos by `total_ret_net`. The current contract (SL 1.65 / TP1 3.25 /
TP1_QTY 0.375 / trailR 0.9) should appear somewhere in the ranking so you
can see its delta against the top combo.

**Action**: Do NOT auto-apply the top combo. Pick a combo that meets at
least:
- `tp1_first_rate >= 0.25`
- `sl_first_rate <= 0.40`
- `avg_ret_net` in top quartile

Then schedule the swap for the next release cycle with a canary rollout.

### 2c — Smoke (no real data yet)

```
node scripts/backtest-exit-params-grid.js --n 60 --top 5
```

This runs synthetic episodes and verifies the tool works end-to-end. Use
it to sanity-check that the tool is wired in your environment before
spending time on the export loader.

---

## Step 3 — Temporarily relax quarantine so we can gather samples

**Problem**: With `objective_score=-8.26` the allocator quarantines
entries. We cannot gather n>=50 clean samples under quarantine. We also
cannot learn whether any new exit contract helps.

**Solution**: file-based operator override (`ops/runtime/operator_overrides.json`)
with a short TTL. The code refuses any override that has no expiry, is
expired, malformed, or scales > 2x.

### 3a — Write the override

```
mkdir -p ops/runtime
cat > ops/runtime/operator_overrides.json <<'EOF'
{
  "expires_at_iso": "2026-04-24T09:00:00.000Z",
  "quarantine_hard_block_relaxed": true,
  "market_qty_scales": { "AXSUSDT": 1.2 },
  "operator": "jihye",
  "reason": "perf_recovery_sample_acquisition_phase3d"
}
EOF
```

Notes:
- `expires_at_iso` is MANDATORY. The default override path is rejected if
  it is missing, past, or malformed.
- `AXSUSDT 1.2x` is the only market with empirical evidence from the
  drop_validation report (`FAVOR_RESCUE`, avg +1.09% on drop matured).
  All other markets stay at 1.0.
- The file is only consulted by `liveExecutionPolicy.evaluateLiveEntryPolicy`.
  Stop writer authority / ledger invariants / integrity guard are not
  affected.

### 3b — Verify it took effect

Check the service logs for exactly one of each line (emitted the first
time each override key is applied):

```
[OPERATOR_OVERRIDE_APPLIED] {"family":"QUARANTINE_HARD_BLOCK", ...}
[OPERATOR_OVERRIDE_APPLIED] {"family":"MARKET_QTY_SCALE","market":"AXSUSDT","scale":1.2, ...}
```

### 3c — Rollback (any of the following)

- Delete the file: `rm ops/runtime/operator_overrides.json`
- Replace with an immediately-expired payload.
- Wait — the file self-expires on `expires_at_iso`.

---

## Step 4 — Observation window (7 days)

During the override window, monitor daily:

| Metric | Source | Target |
|---|---|---|
| `realized_n` | `best_self_evolution_provisional_realized_outcome_latest.json` | climb from 14 → ≥ 50 |
| `tp1_first_rate` | ditto | ≥ 0.20 by day 7 |
| `sl_first_rate` | ditto | ≤ 0.50 |
| `LEDGER_INVARIANT_VIOLATION` | service logs | 0 (any hit = halt override) |
| `FILL_SYNC_CHAIN_KEY_LOW_CONFIDENCE` (STAGE level) | service logs | < 5/day |
| `RECONCILER_FLAT_PROJECTION_TRAIL_CONTEXT_LOST` | service logs | < 2/day |
| `EXIT_AUTHORITY_STATE_PERSIST_DEGRADED` | service logs | 0 |
| `BINANCE_USER_STREAM_DRIFT_ALERT` | service logs | < 1/day |

Any red condition → delete the override immediately and file an incident.

---

## Step 5 — After the window — pick the new exit contract

With fresh samples (n≥50) and the bottleneck waterfall output:

1. Re-export episodes, re-run the grid.
2. Pick the combo that satisfies the hygiene thresholds from 2b above.
3. Ship the new `sl_pct_abs` / `tp1_pct` / `tp1_qty_pct` / `trail_r_multiple`
   values in the exit-trailing-contract config.
4. Canary to 2-3 markets first for another 7 days.
5. Flip everywhere if canary holds.

---

## Failure modes / never do

- **Never** write an override with no `expires_at_iso`. The code will
  reject it but the file lying around invites confusion.
- **Never** scale above 2x. The code clamps to 2x but the intent should
  not exceed 1.3x.
- **Never** relax the quarantine without the bottleneck waterfall in
  hand — if execution is still partial-filling 90%, relaxing quarantine
  just grows the losing cohort.
- **Never** commit `ops/runtime/operator_overrides.json` to git. It is
  meant to be a host-local lever.
