"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-hourly-overall-report");

function run() {
  assert.strictEqual(typeof __test.resolveComparisonLabel, "function", "resolveComparisonLabel export missing");
  assert.strictEqual(typeof __test.formatSignedPercent, "function", "formatSignedPercent export missing");
  assert.strictEqual(typeof __test.positionStatusLabel, "function", "positionStatusLabel export missing");

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_hour",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-19", hhmm: "1050" },
    }),
    "전시간 대비"
  );

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_hour",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-19", hhmm: "0840" },
    }),
    "직전 보고 대비"
  );

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_day_latest",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-17", hhmm: "2300" },
    }),
    "직전 보고일 마지막 보고 대비"
  );

  assert.strictEqual(__test.formatSignedPercent(-1.2345, 4), "-1.2345%");
  assert.strictEqual(
    __test.positionStatusLabel({
      tp_p1_done: false,
      trail_active: false,
      exit_stage_label: "트레일링",
    }),
    "트레일링"
  );
}

try {
  run();
  console.log("HOURLY_OVERALL_REPORT_FORMAT_TEST_OK");
} catch (err) {
  console.error("HOURLY_OVERALL_REPORT_FORMAT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
