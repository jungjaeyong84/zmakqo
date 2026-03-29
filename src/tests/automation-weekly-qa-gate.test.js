"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-weekly-pine-upgrade");

function run() {
  assert.strictEqual(typeof __test.qaGateStatus, "function", "qaGateStatus export missing");

  const failed = __test.qaGateStatus({
    qaData: {},
    qaReplay: {},
    artifacts: {
      qaData: { ok: false, error: "unzip failed" },
      qaReplay: { ok: true, data: { match_pct: 1 } },
    },
  });
  assert.strictEqual(failed.pass, false);
  assert.strictEqual(failed.required_artifacts_ok, false);
  assert.ok(Array.isArray(failed.missing_required_artifacts));
  assert.ok(failed.missing_required_artifacts.includes("qa/data_quality_report.json"));

  const passed = __test.qaGateStatus({
    qaData: {
      integrity: {
        join_rate: 1,
        label_join_rate: 1,
        trade_entry_event_link_rate: 1,
      },
      summary: {
        missing: 0,
        duplicate: 0,
        misaligned: 0,
      },
      auto_repair: {},
    },
    qaReplay: {
      match_pct: 1,
    },
    artifacts: {
      qaData: { ok: true },
      qaReplay: { ok: true },
    },
  });
  assert.strictEqual(passed.pass, true);
  assert.strictEqual(passed.required_artifacts_ok, true);
}

try {
  run();
  console.log("AUTOMATION_WEEKLY_QA_GATE_TEST_OK");
} catch (err) {
  console.error("AUTOMATION_WEEKLY_QA_GATE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
