"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const gateScript = require("../../scripts/check-v2-performance-gate");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-perf-gate-script-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

(() => {
  const tmp = mkTmp();
  const inputFile = path.join(tmp, "report.json");
  const outputFile = path.join(tmp, "gate.json");
  writeJson(inputFile, {
    generated_at: "2026-05-01T00:00:00.000Z",
    run_id: "cycle_test",
    source_cycle_id: "cycle_test",
    sample_n: 97,
    win_rate_pct: 30.9,
    profit_factor: 0.73,
    expectancy: -0.1,
    net_pnl_pct: -0.5,
  });
  const result = gateScript.main({
    V2_PERFORMANCE_GATE_INPUT_FILE: inputFile,
    V2_PERFORMANCE_GATE_OUTPUT_FILE: outputFile,
    V2_PERFORMANCE_GATE_SOFT: "1",
    V2_EVIDENCE_CYCLE_MANUAL_RUN: "1",
  });
  assert.strictEqual(result.run_id, "cycle_test");
  assert.strictEqual(result.source_cycle_id, "cycle_test");
  assert.strictEqual(result.manual_run, true);
  assert.strictEqual(result.input_generated_at, "2026-05-01T00:00:00.000Z");
})();

console.log("CHECK_V2_PERFORMANCE_GATE_SCRIPT_TEST_OK");
