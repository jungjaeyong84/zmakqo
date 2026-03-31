"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-server-primary-canary");

(() => {
  const report = __test.deriveServerPrimaryCanary({
    dataset: {
      rows: [
        {
          source_row_type: "EXECUTED",
          event: "LONG",
          market: "AXSUSDT",
          realized_ret_net: 0.02,
          features_json: {
            canonical_engine_source_mode_effective: "SERVER_PRIMARY",
            pine_shadow_parity_match: true,
          },
        },
        {
          source_row_type: "EXECUTED",
          event: "SHORT",
          market: "AXSUSDT",
          realized_ret_net: -0.01,
          features_json: {
            canonical_engine_source_mode_effective: "SERVER_PRIMARY",
            pine_shadow_parity_match: false,
          },
        },
        {
          source_row_type: "DROP",
          event: "LONG",
          market: "BTCUSDT",
          realized_ret_net: null,
          features_json: {
            canonical_engine_source_mode_effective: "PINE_PRIMARY",
          },
        },
      ],
    },
  });

  assert.strictEqual(report.summary.row_n, 2);
  assert.strictEqual(report.summary.server_primary_markets_n, 1);
  assert.strictEqual(report.summary.server_primary_executed_n, 2);
  assert.strictEqual(report.summary.server_primary_realized_n, 2);
  assert.strictEqual(report.summary.pine_shadow_disagreement_n, 1);
  assert.strictEqual(report.summary.rollback_trigger_n, 1);
  assert.strictEqual(report.summary.acceptance_ready, false);
  assert.strictEqual(report.summary.acceptance_reason, "SERVER_PRIMARY_CANARY_BLOCK");
  assert.strictEqual(report.summary.by_source_mode[0].key, "SERVER_PRIMARY");
  assert.strictEqual(report.rows[0].market, "AXSUSDT");
  assert.strictEqual(report.rows[0].rollback_triggers[0], "PINE_SHADOW_DISAGREEMENT");

  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-31 17:00:00 KST",
    cycle_id: "cycle-d",
    summary: report.summary,
    rows: report.rows,
  });
  assert.match(md, /cycle-d/);
  assert.match(md, /rows \/ markets: 2 \/ 1/);
  assert.match(md, /acceptance: PENDING/);
  assert.match(md, /AXSUSDT/);

  const empty = __test.deriveServerPrimaryCanary({
    dataset: { rows: [] },
  });
  assert.strictEqual(empty.summary.acceptance_ready, false);
  assert.strictEqual(empty.summary.acceptance_reason, "NO_SERVER_PRIMARY_ROWS");
  console.log("SERVER_PRIMARY_CANARY_REPORT_TEST_OK");
})();
