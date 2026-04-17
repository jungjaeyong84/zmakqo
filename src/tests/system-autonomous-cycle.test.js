"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/system-autonomous-cycle");

function run() {
  assert.strictEqual(typeof __test.buildTasks, "function", "buildTasks export missing");

  const tasks = __test.buildTasks();
  const tp1Index = tasks.findIndex((task) => task.id === "tp1_fail_closed");
  const systemOpsIndex = tasks.findIndex((task) => task.id === "system_ops");

  assert.ok(tp1Index >= 0, "tp1_fail_closed task missing");
  assert.ok(systemOpsIndex >= 0, "system_ops task missing");
  assert.strictEqual(systemOpsIndex, tp1Index + 1, "tp1_fail_closed must run immediately before system_ops");
  assert.deepStrictEqual(tasks[tp1Index].args, ["scripts/report-tp1-fail-closed-events.js"]);
}

try {
  run();
  console.log("SYSTEM_AUTONOMOUS_CYCLE_TEST_OK");
} catch (err) {
  console.error("SYSTEM_AUTONOMOUS_CYCLE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
