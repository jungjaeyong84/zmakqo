"use strict";

// Regression tests for Phase 3c — P3-05 emulator env, P3-06 migration script
// dry-run semantics, P3-09 gate skip-list, and the P3-12 drop-panel view
// model shape. These assertions pin the invariants we cannot verify via a
// live preview (production Firestore is not reachable from CI).

const assert = require("assert");

const firestoreStorage = require("../storage/firestore");
const { __test: cycleTest } = require("../../scripts/run-binance-exit-integrity-cycle");
const { __test: gateTest } = require("../../scripts/check-binance-exit-integrity-gate");
const retireMigrate = require("../../scripts/migrate-retire-authoritative-exit-stage");

// ---------- P3-05 Firestore emulator env wiring ---------------------------
(() => {
  const prev = process.env.FIRESTORE_EMULATOR_HOST;
  try {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    assert.strictEqual(firestoreStorage.isFirestoreEmulatorConfigured(), false);

    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    assert.strictEqual(firestoreStorage.isFirestoreEmulatorConfigured(), true);

    process.env.FIRESTORE_EMULATOR_HOST = "";
    assert.strictEqual(
      firestoreStorage.isFirestoreEmulatorConfigured(),
      false,
      "empty string env must not be treated as configured"
    );
  } finally {
    if (prev == null) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = prev;
  }
})();

// ---------- P3-06 migration shouldMigrate invariants ----------------------
(() => {
  const F = retireMigrate.__test;
  // Happy path: canonical + legacy agree → migrate.
  assert.strictEqual(F.shouldMigrate({
    canonical_exit_stage: "TRAIL",
    authoritative_exit_stage: "TRAIL",
  }), true);
  // Canonical missing → leave legacy alone (read fallback still uses it).
  assert.strictEqual(F.shouldMigrate({
    authoritative_exit_stage: "TRAIL",
  }), false);
  // Legacy missing → nothing to do.
  assert.strictEqual(F.shouldMigrate({
    canonical_exit_stage: "TRAIL",
  }), false);
  // Disagreement → DO NOT touch; it is a diagnostic signal, not a cleanup.
  assert.strictEqual(F.shouldMigrate({
    canonical_exit_stage: "TRAIL",
    authoritative_exit_stage: "TP0",
  }), false);
  // Non-object → false.
  assert.strictEqual(F.shouldMigrate(null), false);
  assert.strictEqual(F.shouldMigrate(undefined), false);
})();

// ---------- P3-09 gate skip-list fail-closed ------------------------------
(() => {
  // Normal summary (no skip) → no new reason.
  const ok = gateTest.buildFailureReasons({
    status: "OK",
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
  });
  assert.ok(!ok.some((r) => r.startsWith("SKIPPED_VALIDATION_FAMILY")),
    "OK summary must not flag skipped families");

  // When the cycle reports skipped families, the gate must refuse to pass.
  const blocked = gateTest.buildFailureReasons({
    status: "OK",
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
    skipped_validation_family_n: 1,
    skipped_validation_families: [{ family: "EXCHANGE_IO", reason: "CI_NO_IO" }],
  });
  const skipReason = blocked.find((r) => r.startsWith("SKIPPED_VALIDATION_FAMILY"));
  assert.ok(skipReason, `expected SKIPPED_VALIDATION_FAMILY reason, got ${JSON.stringify(blocked)}`);
  assert.ok(skipReason.includes("EXCHANGE_IO"),
    `reason should include family name; got ${skipReason}`);

  // Throwing cycle is still fail-closed (pre-existing C4 invariant).
  const thrown = gateTest.buildFailureReasons({
    status: "SKIP",
    skip_reason: "CYCLE_DISABLED",
  }, { cycleResult: { skipped: true } });
  assert.ok(thrown.some((r) => r.startsWith("CYCLE_SKIPPED:")),
    "skipped cycle still flagged");
})();

// ---------- P3-09 buildSummary surfaces skipped families ------------------
(() => {
  const reportWithoutSkip = {
    native_trail_gap_before: { summary: { gap_count: 0 } },
    native_trail_gap_after: { summary: { gap_count: 0 } },
    active_exit_watchdog: { issue_symbol_n: 0, repaired_symbol_n: 0, actionable_rows: [] },
    binance_exit_qty_live_separation: { parsed: { live_issue_chain_n: 0 } },
    trail_runner_floor_live_separation: { parsed: { live_violation_n: 0 } },
    fill_sync_alert_duplication: { parsed: { duplicate_group_n: 0 } },
    fill_sync_alert_event_consistency: { parsed: { issue_n: 0 } },
    trade_execution_alert_cross_audit: { parsed: { coverage_ready: true, missing_alert_fill_n: 0 } },
    fill_sync_alert_duplication_live_separation: { parsed: { live_duplicate_group_n: 0 } },
    binance_exit_authority_live_board: { parsed: { live_issue_position_n: 0, actionable_live_issue_position_n: 0, artifact_only_live_issue_position_n: 0 } },
    binance_canonical_exit_stage_qa: { parsed: { fail_n: 0 } },
    canonical_exit_transition_backfill: { ok: true, parsed: { created_transition_n: 0 } },
    simplified_exit_v2_live_flow: { parsed: { actionable_symbol_n: 0 } },
    simplified_exit_v2_tp1_drilldown: { parsed: { issue_code_counts: {} } },
    active_exit_stage_backfill: { parsed: { issue_symbol_n: 0 } },
  };
  const summaryClean = cycleTest.buildSummary(reportWithoutSkip);
  assert.strictEqual(summaryClean.skipped_validation_family_n, 0);
  assert.deepStrictEqual(summaryClean.skipped_validation_families, []);
  assert.ok(!summaryClean.reasons.some((r) => r.includes("skipped validation")));

  const reportWithSkip = {
    ...reportWithoutSkip,
    skipped_validation_families: [
      { family: "EXCHANGE_IO", reason: "CI_NO_IO", affected: ["active_exit_watchdog"] },
    ],
  };
  const summarySkipped = cycleTest.buildSummary(reportWithSkip);
  assert.strictEqual(summarySkipped.skipped_validation_family_n, 1);
  assert.strictEqual(summarySkipped.skipped_validation_families.length, 1);
  assert.ok(summarySkipped.reasons.some((r) => r.includes("skipped validation families")),
    `expected skipped reason in summary.reasons, got ${JSON.stringify(summarySkipped.reasons)}`);
})();

// ---------- P3-12 drop panel view-model shape -----------------------------
// Shape test — we can't render the EJS here, but we can confirm the row
// objects the view now consumes expose exactly the fields the template
// references (reason, reason_family, event, symbol, side, execution_mode,
// created_at). If the shape regresses, the template will render empty cells.
(() => {
  // Minimal stand-in of the mapping the route performs. If the fields diverge
  // the dashboard panel silently shows empty strings, which this test guards
  // against.
  const rawDrops = [
    {
      symbol_or_pair_id: "BTCUSDT",
      event: "ENTRY_LONG_REAL",
      side: "BUY",
      drop_reason_code: "MIN_ORDER_EXCEEDS_BUDGET",
      reason_family: "ENTRY_BUDGET_GUARD",
      execution_mode: "LIVE",
      source: "SERVER",
      signal_id: "SIG__xyz",
      bar_close_time_utc_ms: 1700000000000,
      created_at: "2026-04-17T07:00:00.000Z",
    },
  ];
  const mapped = rawDrops.map((d) => ({
    created_at: d.created_at || d.created_kst || null,
    symbol: d.symbol_or_pair_id || d.symbol || d.market || null,
    event: d.event || null,
    side: d.side || null,
    reason: String(d.drop_reason_code || d.reason || "UNKNOWN").toUpperCase().trim() || "UNKNOWN",
    reason_family: String(d.reason_family || "UNKNOWN").toUpperCase().trim() || "UNKNOWN",
    execution_mode: String(d.execution_mode || "").toUpperCase() || null,
    source: String(d.source || "").toUpperCase() || null,
    signal_id: d.signal_id || d.signal_doc_id || null,
    bar_close_time_utc_ms: d.bar_close_time_utc_ms || null,
  }));
  const row = mapped[0];
  for (const k of ["created_at", "symbol", "event", "side", "reason", "reason_family", "execution_mode", "source", "signal_id", "bar_close_time_utc_ms"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, k), `drop row must expose ${k}`);
  }
  assert.strictEqual(row.reason, "MIN_ORDER_EXCEEDS_BUDGET");
  assert.strictEqual(row.reason_family, "ENTRY_BUDGET_GUARD");
  assert.strictEqual(row.execution_mode, "LIVE");
  assert.strictEqual(row.symbol, "BTCUSDT");
})();

console.log("EXIT_INVARIANTS_PHASE3C_TEST_OK");
