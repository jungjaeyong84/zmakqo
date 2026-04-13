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
    runScriptImpl: (script) => {
      if (script === "backfill-binance-active-exit-stage.js") return buildScriptResult({ issue_symbol_n: 2 });
      if (script === "report-fill-sync-alert-duplication.js") return buildScriptResult({ duplicate_group_n: 0, report: { duplicate_group_n: 0 } });
      if (script === "report-binance-exit-qty-contract-audit.js") return buildScriptResult({ issue_chain_count: 0 });
      if (script === "report-binance-exit-qty-live-separation.js") return buildScriptResult({ live_issue_chain_n: 0 });
      if (script === "report-trail-runner-floor-audit.js") return buildScriptResult({ violation_n: 0 });
      if (script === "report-trail-runner-floor-live-separation.js") return buildScriptResult({ live_violation_n: 0 });
      throw new Error(`unexpected script ${script}`);
    },
  });

  assert.strictEqual(result.status, "OK");
  assert.strictEqual(result.summary.native_gap_before, 2);
  assert.strictEqual(result.summary.native_gap_after, 0);
  assert.ok(fs.existsSync(path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.json")));
  assert.ok(fs.existsSync(path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.md")));

  const warnSummary = __test.buildSummary({
    native_trail_gap_before: { summary: { gap_count: 1 } },
    native_trail_gap_after: { summary: { gap_count: 1 } },
    active_exit_stage_backfill: { parsed: { issue_symbol_n: 3 } },
    binance_exit_qty_live_separation: { parsed: { live_issue_chain_n: 2 } },
    trail_runner_floor_live_separation: { parsed: { live_violation_n: 1 } },
    fill_sync_alert_duplication: { parsed: { duplicate_group_n: 4 } },
  });
  assert.strictEqual(warnSummary.status, "WARN");
  assert.strictEqual(warnSummary.live_issue_count, 8);

  const md = __test.buildMarkdown({
    generated_at: "2026-04-13T00:00:00.000Z",
    apply: true,
    summary: warnSummary,
    self_heal: { scanned: 2, healed_n: 1, skipped_n: 1 },
  });
  assert.ok(md.includes("native_gap_after"));

  const parsedPretty = __test.extractJson('{\n  "ok": true,\n  "duplicate_group_n": 6\n}\n');
  assert.deepStrictEqual(parsedPretty, { ok: true, duplicate_group_n: 6 });

  console.log("BINANCE_EXIT_INTEGRITY_CYCLE_TEST_OK");
})().catch((err) => {
  console.error("BINANCE_EXIT_INTEGRITY_CYCLE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
