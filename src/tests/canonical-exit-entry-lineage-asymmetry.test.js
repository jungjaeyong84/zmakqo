"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// canonical-exit-entry-lineage-asymmetry.test.js
//
// 2026-04-20 senior-audit P4 invariant lock.
//
// `requiresCanonicalExitEntryLineage` gates TP0/TP1/TRAIL alerts on a
// non-empty entry lineage id (positions_paper.meta.entry_event_id). It
// INTENTIONALLY returns false for SL, EXTERNAL_SYNC, FORCE_EXIT_*, and
// OTHER_EXIT. This asymmetry is load-bearing for reconciliation paths:
//
//   - An `EXIT_SL` fill can arrive from the exchange via user-data-stream
//     reconciliation BEFORE the local intent-chain has been materialised
//     (e.g. the exchange triggered the stop during a local outage, and we
//     only see the fill on recovery). Requiring lineage there would drop
//     the exit from the Telegram alert + canonical ledger, producing the
//     silent-drop failure mode the P0 fix was designed to eliminate.
//
//   - `EXIT_EXTERNAL_SYNC` is, by definition, an exchange-initiated
//     reconciliation — the original intent may never have existed in our
//     store (user manually closed on Binance Web, for instance). Gating
//     it on local lineage would make every manual intervention look like
//     a canonical-transition violation.
//
//   - `FORCE_EXIT_ALL / FORCE_EXIT_HALF` are operator-driven escape
//     hatches — they deliberately bypass the intent chain so ops can
//     liquidate a position under adverse conditions (exchange IO down,
//     etc.) without hunting for the entry event.
//
// If a future refactor tightens the gate to require lineage for SL or
// EXTERNAL_SYNC, these cases would silently drop from Telegram alerts
// (the same way TP1 did before the P0 fix). This test locks the
// asymmetry in so that regression surfaces immediately in CI rather
// than during an incident.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");
const {
  __test: {
    requiresCanonicalExitEntryLineage,
  },
} = require("../services/positionStateMachine");

assert.strictEqual(
  typeof requiresCanonicalExitEntryLineage,
  "function",
  "requiresCanonicalExitEntryLineage must be exported for lineage gating"
);

// ── (A) Stages that DO require lineage — TP0/TP1/TRAIL ──────────────────────
// These are canonical exit stages where the entry_event_id must be present
// so that the (entry_signal → exits) chain can be reconstructed end-to-end
// for canonical_exit_transitions + Telegram + ML feature labels.
for (const stage of ["TP0", "TP1", "TRAIL"]) {
  assert.strictEqual(
    requiresCanonicalExitEntryLineage({ currentStage: stage }),
    true,
    `stage ${stage} MUST require canonical entry lineage — dropping this `
    + "would break intent→exit reconstruction"
  );
}

// The same predicate also accepts an event string (no stage context). Verify
// a representative event per lineage-required stage.
const lineageRequiredEvents = [
  { event: "EXIT_TP_P0_0_8P", stage: "TP0" },
  { event: "EXIT_TP_P1_1_65P", stage: "TP1" },
  { event: "EXIT_TP_C_3_0P", stage: "TP1" },
  { event: "EXIT_TRAIL", stage: "TRAIL" },
  { event: "EXIT_TRAIL_1_0P", stage: "TRAIL" },
];
for (const { event } of lineageRequiredEvents) {
  assert.strictEqual(
    requiresCanonicalExitEntryLineage({ event }),
    true,
    `event ${event} must resolve to a lineage-required stage`
  );
}

// ── (B) Stages/events that MUST NOT require lineage ─────────────────────────
// These are reconciliation / operator-override / fallback paths where the
// local intent chain is allowed to be absent. Requiring lineage here would
// silently drop legitimate exit alerts — the exact failure mode the 2026-04
// TP1 silent-drop incident exposed in the TP1 path.
const lineageOptionalCases = [
  { label: "SL (local-initiated)", args: { currentStage: "SL" } },
  { label: "SL event from fills sync", args: { event: "EXIT_SL" } },
  { label: "SL event with pct token", args: { event: "EXIT_SL_1_65P" } },
  {
    label: "EXTERNAL_SYNC — exchange-initiated reconciliation",
    args: { event: "EXIT_EXTERNAL_SYNC" },
  },
  { label: "FORCE_EXIT_ALL operator override", args: { event: "FORCE_EXIT_ALL" } },
  { label: "FORCE_EXIT_HALF operator override", args: { event: "FORCE_EXIT_HALF" } },
  { label: "EXIT_ALL alias", args: { event: "EXIT_ALL" } },
  { label: "EXIT_FORCE_ALL alias", args: { event: "EXIT_FORCE_ALL" } },
  { label: "OTHER_EXIT catch-all", args: { event: "EXIT_MARKET" } },
  { label: "unknown stage — must default to false", args: { currentStage: "UNKNOWN" } },
  { label: "null stage AND null event — must default to false", args: {} },
];
for (const { label, args } of lineageOptionalCases) {
  assert.strictEqual(
    requiresCanonicalExitEntryLineage(args),
    false,
    `${label}: must NOT require lineage — otherwise reconciliation fills `
    + "silently drop from Telegram and canonical ledger"
  );
}

// ── (C) currentStage takes precedence over event when both supplied ─────────
// This matters because callers sometimes pass a resolved stage from
// positionStateMachine but also the raw event for debugging. The function
// must prefer the resolved stage so upstream classification (incl. the
// live-namespace-aware variant that distinguishes TP0 vs TP1) is
// preserved rather than re-derived from the event string.
assert.strictEqual(
  requiresCanonicalExitEntryLineage({ currentStage: "SL", event: "EXIT_TP_P1_1_65P" }),
  false,
  "explicit stage=SL must override event-based classification as TP1"
);
assert.strictEqual(
  requiresCanonicalExitEntryLineage({ currentStage: "TRAIL", event: "EXIT_SL" }),
  true,
  "explicit stage=TRAIL must override event-based classification as SL"
);

// ── (D) Case insensitivity — function must accept lowercase inputs ─────────
// Protects against accidental lowercase drift upstream (e.g. legacy writers
// that emit stage strings in mixed case). The normalization layer is part
// of the contract.
assert.strictEqual(
  requiresCanonicalExitEntryLineage({ currentStage: "tp1" }),
  true,
  "lowercase stage 'tp1' must still resolve to lineage-required"
);
assert.strictEqual(
  requiresCanonicalExitEntryLineage({ event: "exit_sl" }),
  false,
  "lowercase event 'exit_sl' must still resolve to lineage-optional"
);

console.log("CANONICAL_EXIT_ENTRY_LINEAGE_ASYMMETRY_TEST_OK");
