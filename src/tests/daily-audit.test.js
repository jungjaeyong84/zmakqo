"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-daily-audit");

(() => {
  const line = __test.buildBestFebtDailyAuditLine({
    mode: "RECOVERY_FIRST",
    tightening_allowed: false,
    recovery_priority: true,
    projected_replacement_ratio: 0.73,
    projected_count_ratio_global: 0.98,
    projected_net_signal_delta_n: -1,
  });
  assert.ok(line.includes("RECOVERY_FIRST"));
  assert.ok(line.includes("tightening BLOCK"));
  assert.ok(line.includes("recovery FIRST"));
  assert.ok(line.includes("0.73"));
  assert.ok(line.includes("0.98x"));

  console.log("DAILY_AUDIT_TEST_OK");
})();
