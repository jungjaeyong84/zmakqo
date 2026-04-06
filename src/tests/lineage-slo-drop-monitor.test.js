"use strict";

const assert = require("assert");
const { buildLineageSloDropMonitor } = require("../utils/lineageSloDropMonitor");

(() => {
  const report = buildLineageSloDropMonitor({
    signalLineageHealth: {
      generated_at: "2026-04-06T08:53:05.000Z",
      summary: {
        entry_fills_intent_id_null_rate: 0,
        external_reconciled_fills_intent_id_null_n: 4,
      },
    },
    droppedSignals: {
      docs: [
        {
          created_at: "2026-04-06T07:45:06.723Z",
          symbol_or_pair_id: "SOLUSDT",
          event: "SHORT",
          drop_reason_code: "LINEAGE_SLO_FILL_INTENT_NULL_RATE",
        },
        {
          created_at: "2026-04-06T06:30:07.838Z",
          symbol_or_pair_id: "ETHUSDT",
          event: "SHORT",
          drop_reason_code: "LINEAGE_SLO_FILL_INTENT_NULL_RATE",
        },
      ],
    },
  });

  assert.strictEqual(report.status, "LINEAGE_SLO_DROP_MONITOR_READY");
  assert.strictEqual(report.evidence_status, "AWAITING_POST_FIX_DROP_CACHE");
  assert.strictEqual(report.total_lineage_slo_drop_n, 2);
  assert.strictEqual(report.post_fix_lineage_slo_drop_n, 0);
  assert.strictEqual(report.pre_fix_lineage_slo_drop_n, 2);
  assert.strictEqual(report.latest_lineage_slo_drop_market, "SOLUSDT");
  assert.strictEqual(report.post_fix_clear, true);

  console.log("LINEAGE_SLO_DROP_MONITOR_TEST_OK");
})();
