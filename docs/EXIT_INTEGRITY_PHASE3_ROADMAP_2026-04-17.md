# Exit Integrity Phase 3 Roadmap — 2026-04-17

**Baseline**: commit `dfef0f2` (`fix(exit-integrity): phase 1+2 remediation for stage-authority audit (C1-C17)`)
**Scope**: Phase 3 closes the remaining audit follow-ups (C15/C16/C18) plus the
operational hardening deferred from Phase 1+2.
**Owner**: exit-integrity WG.
**Success criteria**: each ticket ships with (a) invariant enforced in code,
(b) regression test under `src/tests/exit-invariants-*.test.js`, (c) runtime
observability updated.

---

## Ticket P3-01 — Subscript cache migration (from C8 infrastructure)

**Why**: Phase 2 added `scripts/lib/exit-integrity-collection-cache.js` and the
integrity cycle writes the cache up front, but zero subscripts read from it
yet. Until at least the fills-scanning subscripts migrate, the per-cycle
Firestore read cost remains at the pre-Phase 2 baseline.

**Scope**
- Migrate in the following order, one PR per subscript to keep blast radius
  tight:
  1. `scripts/report-fill-sync-alert-duplication.js`
  2. `scripts/report-fill-sync-alert-event-consistency.js`
  3. `scripts/report-trade-execution-alert-cross-audit.js`
  4. `scripts/report-fill-sync-alert-duplication-live-separation.js`
  5. `scripts/report-binance-canonical-exit-stage-qa.js`
  6. `scripts/report-simplified-exit-v2-live-flow.js`
  7. `scripts/report-simplified-exit-v2-tp1-drilldown.js`
- Migration pattern: read cache via `readExitIntegrityCollectionCache()`; if
  null OR if `cached.__mtime_ms` is older than the subscript's own lookback,
  fall back to the legacy Firestore query.
- Collect rows via `getCachedCollectionRows(cache, collectionName)`.

**Acceptance**
- For each migrated subscript, add a test asserting: when cache is provided
  and fresh, no Firestore calls are made (mock verifies).
- Expected Firestore read reduction per 4h cycle: ≥ 50% once all 7 subscripts
  migrate.

**Risk**
- Cache rows may be missing fields subscripts rely on (`__id`, timestamps).
  Mitigate by keeping the fallback path and instrumenting fallback frequency.

---

## Ticket P3-02 — Authority state persist-failure alerting

**Why**: `syncMarketTrades` wraps `persistExitAuthorityStates` in a silent
try/catch (by design, to stay available), but a sustained persistence failure
would silently re-open the cross-run double-consume risk we just closed in C2.

**Scope**
- Add `telemetry/metric` on every call:
  - `exit_authority_state.persist_success_total{exchange,symbol}`
  - `exit_authority_state.persist_failure_total{exchange,symbol,reason}`
- Page an operational alert via `sendAlert(...)` / Slack when the failure
  counter exceeds N (default 3) within a rolling 15-minute window.
- Emit a structured log line every time the in-memory cap blocks a fill
  whose persisted state was stale or missing (i.e., the persistence
  fallback actually saved us).

**Acceptance**
- New test: stub Firestore `.set` to reject; assert that:
  - cycle still completes;
  - operational alert fires once the threshold is crossed;
  - counter is reset when `.set` succeeds again.

**Risk**
- Alert spam on Firestore degraded-mode incidents. Gate alerts behind the
  rolling-window threshold, not per-failure.

---

## Ticket P3-03 — C15: chainKey confidence telemetry

**Why**: `buildCanonicalExitChainKey` falls back to `orderId` /
`clientOrderId` / `stage` when the real entry lineage is missing. Today
this is silent — a position without entry lineage quietly ends up with a
low-confidence chainKey and downstream accounting continues as if nothing
were wrong.

**Scope**
- Extend the return of `buildCanonicalExitChainKey` to include a
  `confidence` field: `"ENTRY" | "SIGNAL" | "ORDER" | "CLIENT" | "STAGE"`.
- In `applyExternalExitQtyAuthority`, when confidence is `"STAGE"` (the
  loosest fallback):
  - Emit `fill_sync_chain_key_low_confidence` observation log.
  - Add to cycle summary counter (feed into the integrity cycle reasons).
- Gate default: ≥ 3 low-confidence chainKeys in a 4h window → `BLOCK`.

**Acceptance**
- Test: `buildCanonicalExitChainKey` returns the expected confidence for each
  fallback path.
- Test: the integrity cycle summary exposes `chain_key_low_confidence_n`
  and flips `stop_divergence_gate`-style block when threshold crossed.

---

## Ticket P3-04 — C16: Reconciler FLAT projection preserves trail context

**Why**: When the exchange reports qty=0 and internal meta has
`trail_active=true`, `buildFlatMetaProjection` currently zeroes the flags.
In the common case this is correct (position truly closed). In the rare
case of a WebSocket gap + reconciler-first flush, the trail context is
erased before the trailing exit event reaches the canonical transition
layer; downstream alert dedupe / stage authority can then classify the
final fill as `EXIT_EXTERNAL_SYNC` instead of `TRAIL_FINAL_EXIT`.

**Scope**
- In `binancePositionReconciler` (the FLAT projection path), detect the
  case (external=0 AND internal trail_active) and:
  - Log `reconciler_flat_projection_trail_context_lost` with the prior
    chainKey.
  - Preserve the prior `canonical_exit_stage` / `canonical_chain_key` /
    `trail_stop_raw` on the FLAT snapshot as `frozen_*` read-only mirror
    fields so the alert layer still classifies correctly.
- Add an operational alert when this path fires > 1× in 15 min (signals
  a websocket gap bigger than usual).

**Acceptance**
- Integration-style test with an in-memory reconciler double.
- FLAT projection still writes qty=0 / state=FLAT; only the mirror fields
  are added.

---

## Ticket P3-05 — C18: CI gate against Firestore emulator

**Why**: `check-binance-exit-integrity-gate.js` runs the full cycle during
CI and queries production Firestore. Phase 1 made the gate fail-closed and
Phase 2 narrowed the gate profile env; production read cost from CI runs
is now bounded, but we still touch real data for a deploy check.

**Scope**
- Introduce `FIRESTORE_EMULATOR_HOST` support in `src/storage/firestore.js`.
- Add a seed script `scripts/seed-firestore-emulator.js` that:
  - Boots the emulator with `@google-cloud/firestore` emulator APIs.
  - Loads a small, versioned fixture set (positions/fills/intents/outbox).
- Change `cloudbuild.yaml` to start the emulator before
  `npm run check:binance-exit-integrity-gate` and tear it down after.

**Acceptance**
- Local `make check-gate-emulator` works offline.
- Gate fails-closed in the expected ways against the fixture.
- Zero production Firestore reads during CI.

---

## Ticket P3-06 — `authoritative_exit_stage` field retirement (from C17)

**Why**: Phase 2 switched writers to `canonical_exit_stage` only, but the
legacy `authoritative_exit_stage` field still lingers on many position
meta docs. Readers continue to fall back for migration, which is correct
but keeps the dual-owner concept alive indefinitely.

**Scope**
- After 14 days of Phase 2 in staging:
  - Run a one-shot backfill that clears `authoritative_exit_stage` from
    every position doc whose `canonical_exit_stage` is non-null.
  - Remove the legacy branch from `resolveStoredCanonicalExitStage` and
    `resolveCanonicalPositionExitStage`.
- Keep the field in the ledger write payload (fills sync still records it
  per-fill — that's a separate concept and stays).

**Acceptance**
- Test update: `resolveStoredCanonicalExitStage` returns null when only
  `authoritative_exit_stage` is set.
- Backfill idempotent and dry-run-safe.

---

## Dependency graph

```
P3-02  (auth persist alerts)
   ↓
P3-01  (subscript cache migration)
   ↓
P3-06  (authoritative_exit_stage retirement — after 14d stage)

P3-03  (chainKey confidence)   → independent
P3-04  (reconciler trail context) → independent
P3-05  (emulator CI)           → independent
```

---

## Observation plan during the 7-day staging soak

Use the commit `dfef0f2` as the baseline. Record in `ops/runtime/` a daily
snapshot of:

- Count of `LEDGER_INVARIANT_VIOLATION` returns (C1 + C3) — expect ~0; any
  non-zero means a stage hint bypassed the validator. Investigate.
- Count of `SIDE_FLIP_WITHOUT_LEDGER_RESET` (C13) — expect exactly 0.
- Count of `LIVE_POLICY_EXIT_INTEGRITY_REPORT_STALE` blocks at runtime (C5)
  — expect 0 during normal cron cadence; 4h cron gap should still be under
  the 5h max-age.
- Firestore read volume delta vs the Phase 0 baseline — should be flat or
  slightly down (Phase 2 did not yet migrate subscripts).
- `position_exit_authority_state` collection doc growth — new docs appear
  only when fills touch them; verify TTL is not needed yet.

Any of the first three showing a non-zero count is an incident — file a
post-mortem and pause Phase 3 rollout until the root cause is known.
