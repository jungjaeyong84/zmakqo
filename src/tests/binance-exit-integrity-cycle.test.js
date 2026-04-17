"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runBinanceExitIntegrityCycle, __test } = require("../../scripts/run-binance-exit-integrity-cycle");

function buildScriptResult(parsed) {
  return {
    ok: true,
    exit_code: 0,
    parsed,
    stdout_tail: [],
    stderr_tail: [],
  };
}

(async () => {
  const opsDailyDir = fs.mkdtempSync(path.join(os.tmpdir(), "exit-integrity-cycle-"));
  let nativeGapCallN = 0;
  const result = await runBinanceExitIntegrityCycle({
    apply: true,
    exchange: "BINANCEFUT",
    opsDailyDir,
    reportNativeGap: async () => {
      nativeGapCallN += 1;
      if (nativeGapCallN === 1) {
        return {
          summary: {
            gap_count: 2,
            rows: [{ symbol: "ETHUSDT" }, { symbol: "XRPUSDT" }],
          },
        };
      }
      return {
        summary: {
          gap_count: 0,
          rows: [],
        },
      };
    },
    selfHeal: async ({ symbols }) => ({
      ok: true,
      scanned: symbols.length,
      healed_n: symbols.length,
      skipped_n: 0,
      results: symbols.map((symbol) => ({ ok: true, symbol, repaired: true })),
    }),
    runWatchdog: async () => ({
      ok: true,
      status: "OK",
      active_symbol_n: 2,
      target_symbol_n: 2,
      issue_symbol_n: 0,
      issue_symbols: [],
      repaired_symbol_n: 0,
      repaired_symbols: [],
      rows: [],
      actionable_rows: [],
      repaired_rows: [],
    }),
    runScriptImpl: (script) => {
      if (script === "backfill-binance-active-exit-stage.js") return buildScriptResult({ issue_symbol_n: 2 });
      if (script === "backfill-canonical-exit-transitions.js") return buildScriptResult({ created_transition_n: 5 });
      if (script === "report-fill-sync-alert-duplication.js") return buildScriptResult({ duplicate_group_n: 0, report: { duplicate_group_n: 0 } });
      if (script === "report-fill-sync-alert-event-consistency.js") return buildScriptResult({ issue_n: 0 });
      if (script === "report-trade-execution-alert-cross-audit.js") return buildScriptResult({ coverage_ready: true, missing_alert_fill_n: 0 });
      if (script === "report-fill-sync-alert-duplication-live-separation.js") return buildScriptResult({ live_duplicate_group_n: 0 });
      if (script === "report-binance-exit-qty-contract-audit.js") return buildScriptResult({ issue_chain_count: 0 });
      if (script === "report-binance-exit-qty-live-separation.js") return buildScriptResult({ live_issue_chain_n: 0 });
      if (script === "report-trail-runner-floor-audit.js") return buildScriptResult({ violation_n: 0 });
      if (script === "report-trail-runner-floor-live-separation.js") return buildScriptResult({ live_violation_n: 0 });
      if (script === "report-binance-exit-authority-live-board.js") {
        return buildScriptResult({
          live_issue_position_n: 0,
          actionable_live_issue_position_n: 0,
          artifact_only_live_issue_position_n: 0,
        });
      }
      if (script === "report-binance-canonical-exit-stage-qa.js") return buildScriptResult({ fail_n: 0 });
      if (script === "report-simplified-exit-v2-live-flow.js") return buildScriptResult({ actionable_symbol_n: 0, issue_code_counts: {} });
      if (script === "report-simplified-exit-v2-tp1-drilldown.js") return buildScriptResult({ actionable_symbol_n: 0, issue_code_counts: {} });
      throw new Error(`unexpected script ${script}`);
    },
  });

  assert.strictEqual(result.status, "OK");
  assert.strictEqual(result.summary.native_gap_before, 2);
  assert.strictEqual(result.summary.native_gap_after, 0);
  assert.strictEqual(result.summary.canonical_transition_backfill_ok, true);
  assert.strictEqual(result.summary.canonical_transition_backfill_created_transition_n, 5);
  assert.ok(fs.existsSync(path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.json")));
  assert.ok(fs.existsSync(path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.md")));

  const warnSummary = __test.buildSummary({
    native_trail_gap_before: { summary: { gap_count: 1 } },
    native_trail_gap_after: { summary: { gap_count: 1 } },
    active_exit_stage_backfill: { parsed: { issue_symbol_n: 3 } },
    active_exit_watchdog: {
      actionable_rows: [
        { symbol: "ETHUSDT", actionable_issue_codes: ["TRAIL_STOP_CHOSEN_SOURCE_MISMATCH"] },
        { symbol: "BTCUSDT", actionable_issue_codes: ["RUNNER_MIN_GUARANTEE_MISSED"] },
        { symbol: "XRPUSDT", actionable_issue_codes: ["TP1_ORDER_MISSING"] },
      ],
    },
    canonical_exit_transition_backfill: { ok: true, parsed: { created_transition_n: 7 } },
    binance_exit_qty_live_separation: { parsed: { live_issue_chain_n: 2 } },
    trail_runner_floor_live_separation: { parsed: { live_violation_n: 1 } },
    fill_sync_alert_duplication: { parsed: { duplicate_group_n: 4 } },
    fill_sync_alert_event_consistency: { parsed: { issue_n: 2 } },
    trade_execution_alert_cross_audit: {
      parsed: {
        coverage_ready: true,
        missing_alert_fill_n: 7,
        missing_verified_exit_alert_fill_n: 3,
        missing_non_actionable_alert_fill_n: 4,
      },
    },
    fill_sync_alert_duplication_live_separation: { parsed: { live_duplicate_group_n: 2 } },
    binance_exit_authority_live_board: { parsed: { live_issue_position_n: 3, actionable_live_issue_position_n: 1, artifact_only_live_issue_position_n: 2 } },
    binance_canonical_exit_stage_qa: { parsed: { fail_n: 2 } },
    simplified_exit_v2_live_flow: { parsed: { actionable_symbol_n: 2, issue_code_counts: { V2_FORBIDDEN_TRAIL_PARTIAL_TRANSITION: 2 } } },
    simplified_exit_v2_tp1_drilldown: { ok: true, parsed: { actionable_symbol_n: 1, issue_code_counts: { V2_TP1_ACK_WITHOUT_META_SYNC: 1, V2_TP1_ORDER_ID_MISMATCH: 2, V2_TP1_TRANSITION_WITHOUT_ALERT: 9 } } },
  });
  assert.strictEqual(warnSummary.status, "WARN");
  assert.strictEqual(warnSummary.live_issue_count, 19);
  assert.strictEqual(warnSummary.fill_sync_alert_event_issue_n, 2);
  assert.strictEqual(warnSummary.trade_execution_alert_missing_fill_n, 3);
  assert.strictEqual(warnSummary.trade_execution_alert_missing_fill_total_n, 3);
  assert.strictEqual(warnSummary.trade_execution_alert_missing_fill_non_actionable_n, 4);
  assert.strictEqual(warnSummary.trade_execution_alert_missing_fill_raw_total_n, 7);
  assert.strictEqual(warnSummary.trade_execution_alert_coverage_ready, true);
  assert.strictEqual(warnSummary.authority_live_issue_position_n, 3);
  assert.strictEqual(warnSummary.authority_actionable_live_issue_position_n, 1);
  assert.strictEqual(warnSummary.authority_artifact_only_live_issue_position_n, 2);
  assert.strictEqual(warnSummary.canonical_exit_stage_fail_n, 2);
  assert.strictEqual(warnSummary.canonical_exit_stage_gate, "BLOCK");
  assert.strictEqual(warnSummary.canonical_transition_backfill_ok, true);
  assert.strictEqual(warnSummary.canonical_transition_backfill_created_transition_n, 7);
  assert.strictEqual(warnSummary.simplified_exit_v2_live_flow_actionable_symbol_n, 2);
  assert.strictEqual(warnSummary.simplified_exit_v2_live_flow_gate, "BLOCK");
  assert.strictEqual(warnSummary.tp1_meta_sync_gap_n, 3);
  assert.strictEqual(warnSummary.tp1_meta_sync_gate, "BLOCK");
  assert.strictEqual(warnSummary.stop_divergence_symbol_n, 2);
  assert.strictEqual(warnSummary.stop_divergence_gate, "BLOCK");
  assert.strictEqual(warnSummary.live_gate_blocked, true);

  const md = __test.buildMarkdown({
    generated_at: "2026-04-13T00:00:00.000Z",
    apply: true,
    summary: warnSummary,
    self_heal: { scanned: 2, healed_n: 1, skipped_n: 1 },
  });
  assert.ok(md.includes("native_gap_after"));
  assert.ok(md.includes("simplified_exit_v2_live_flow_actionable_symbol_n"));
  assert.ok(md.includes("tp1_meta_sync_gap_n"));
  assert.ok(md.includes("stop_divergence_gate"));

  const scriptFailureSummary = __test.buildSummary({
    native_trail_gap_before: { summary: { gap_count: 0 } },
    native_trail_gap_after: { summary: { gap_count: 0 } },
    active_exit_watchdog: { actionable_rows: [] },
    canonical_exit_transition_backfill: { ok: true, parsed: { created_transition_n: 0 } },
    simplified_exit_v2_live_flow: { ok: true, parsed: { actionable_symbol_n: 0, issue_code_counts: {} } },
    simplified_exit_v2_tp1_drilldown: { ok: true, parsed: { actionable_symbol_n: 0, issue_code_counts: {} } },
    active_exit_stage_backfill: { ok: false, timed_out: true },
  });
  assert.strictEqual(scriptFailureSummary.script_failure_n, 1);
  assert.deepStrictEqual(scriptFailureSummary.script_failures, ["active_exit_stage_backfill:TIMEOUT"]);
  assert.strictEqual(scriptFailureSummary.live_gate_blocked, true);

  let reportNativeGapCalled = false;
  let runWatchdogCalled = false;
  const ciModeResult = await runBinanceExitIntegrityCycle({
    apply: false,
    exchange: "BINANCEFUT",
    opsDailyDir,
    disableExchangeIo: true,
    reportNativeGap: async () => {
      reportNativeGapCalled = true;
      throw new Error("reportNativeGap must be skipped when exchange IO is disabled");
    },
    runWatchdog: async () => {
      runWatchdogCalled = true;
      throw new Error("runWatchdog must be skipped when exchange IO is disabled");
    },
    runScriptImpl: (script) => {
      if (script === "backfill-binance-active-exit-stage.js") return buildScriptResult({ issue_symbol_n: 0 });
      if (script === "backfill-canonical-exit-transitions.js") throw new Error("canonical exit transition backfill must be skipped when exchange IO is disabled");
      if (script === "report-fill-sync-alert-duplication.js") return buildScriptResult({ duplicate_group_n: 0, report: { duplicate_group_n: 0 } });
      if (script === "report-fill-sync-alert-event-consistency.js") return buildScriptResult({ issue_n: 0 });
      if (script === "report-trade-execution-alert-cross-audit.js") return buildScriptResult({ coverage_ready: false, missing_alert_fill_n: 0, missing_verified_exit_alert_fill_n: 0 });
      if (script === "report-fill-sync-alert-duplication-live-separation.js") return buildScriptResult({ live_duplicate_group_n: 0 });
      if (script === "report-binance-exit-qty-contract-audit.js") return buildScriptResult({ issue_chain_count: 0 });
      if (script === "report-binance-exit-qty-live-separation.js") return buildScriptResult({ live_issue_chain_n: 0 });
      if (script === "report-trail-runner-floor-audit.js") return buildScriptResult({ violation_n: 0 });
      if (script === "report-trail-runner-floor-live-separation.js") return buildScriptResult({ live_violation_n: 0 });
      if (script === "report-binance-exit-authority-live-board.js") return buildScriptResult({ live_issue_position_n: 0, actionable_live_issue_position_n: 0, artifact_only_live_issue_position_n: 0 });
      if (script === "report-binance-canonical-exit-stage-qa.js") throw new Error("canonical exit stage qa must be skipped when exchange IO is disabled");
      if (script === "report-simplified-exit-v2-live-flow.js") throw new Error("simplified exit v2 live flow must be skipped when exchange IO is disabled");
      if (script === "report-simplified-exit-v2-tp1-drilldown.js") throw new Error("tp1 drilldown must be skipped when exchange IO is disabled");
      throw new Error(`unexpected ci-mode script ${script}`);
    },
  });
  assert.strictEqual(reportNativeGapCalled, false);
  assert.strictEqual(runWatchdogCalled, false);
  assert.strictEqual(ciModeResult.summary.live_gate_blocked, false);

  assert.strictEqual(__test.countStopDivergenceSymbols({
    actionable_rows: [
      { symbol: "ETHUSDT", actionable_issue_codes: ["TRAIL_R_STOP_MISSING"] },
      { symbol: "ETHUSDT", actionable_issue_codes: ["RUNNER_MIN_GUARANTEE_MISSED"] },
      { symbol: "BNBUSDT", actionable_issue_codes: ["TP1_ORDER_MISSING"] },
    ],
  }), 1);

  assert.strictEqual(__test.countTp1MetaSyncGapIssues({
    parsed: {
      issue_code_counts: {
        V2_TP1_ACK_WITHOUT_META_SYNC: 1,
        V2_TP1_ORDER_ID_MISMATCH: 2,
        V2_TP1_TRANSITION_WITHOUT_ALERT: 99,
      },
    },
  }), 3);

  const parsedPretty = __test.extractJson('{\n  "ok": true,\n  "duplicate_group_n": 6\n}\n');
  assert.deepStrictEqual(parsedPretty, { ok: true, duplicate_group_n: 6 });

  const disabledOpsDailyDir = fs.mkdtempSync(path.join(os.tmpdir(), "exit-integrity-disabled-"));
  const disabledResult = await runBinanceExitIntegrityCycle({
    apply: false,
    exchange: "BINANCEFUT",
    opsDailyDir: disabledOpsDailyDir,
    enabled: false,
    reportNativeGap: async () => {
      throw new Error("disabled cycle must not execute reportNativeGap");
    },
    runWatchdog: async () => {
      throw new Error("disabled cycle must not execute runWatchdog");
    },
    runScriptImpl: async () => {
      throw new Error("disabled cycle must not execute scripts");
    },
  });
  assert.strictEqual(disabledResult.status, "SKIP");
  assert.strictEqual(disabledResult.summary.skip_reason, "EXIT_INTEGRITY_CYCLE_DISABLED");
  assert.ok(fs.existsSync(disabledResult.output_json));

  const noActiveOpsDailyDir = fs.mkdtempSync(path.join(os.tmpdir(), "exit-integrity-no-active-"));
  const noActiveResult = await runBinanceExitIntegrityCycle({
    apply: false,
    exchange: "BINANCEFUT",
    opsDailyDir: noActiveOpsDailyDir,
    skipWhenNoActivePositions: true,
    listActivePositions: async () => [],
    reportNativeGap: async () => {
      throw new Error("no-active cycle must not execute reportNativeGap");
    },
    runWatchdog: async () => {
      throw new Error("no-active cycle must not execute runWatchdog");
    },
    runScriptImpl: async () => {
      throw new Error("no-active cycle must not execute scripts");
    },
  });
  assert.strictEqual(noActiveResult.status, "SKIP");
  assert.strictEqual(noActiveResult.summary.skip_reason, "NO_ACTIVE_POSITIONS");
  assert.strictEqual(noActiveResult.summary.active_position_precheck_n, 0);

  assert.strictEqual(__test.isActivePositionRow({ runner_remaining_abs: 0.1 }), true);
  assert.strictEqual(__test.isActivePositionRow({ stage: "CLOSED", runner_remaining_abs: 1 }), false);
  assert.strictEqual(__test.isActivePositionRow({ status: "OPEN" }), true);

  console.log("BINANCE_EXIT_INTEGRITY_CYCLE_TEST_OK");
})().catch((err) => {
  console.error("BINANCE_EXIT_INTEGRITY_CYCLE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
