"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dailySystemOpsCheck = require("../../scripts/daily-system-ops-check.js");

(() => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daily-system-ops-check-"));
  const recentDir = path.join(tmpRoot, "ops", "daily", "cache", "firestore_recent");
  fs.mkdirSync(recentDir, { recursive: true });

  fs.writeFileSync(path.join(recentDir, "signals.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:00:14.348Z", id: "SIG1" },
      { created_at: "2026-04-01T14:45:14.348Z", id: "SIG0" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "order_intents_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:01:14.348Z", id: "INTENT1" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "fills_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:02:14.348Z", id: "FILL1" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "trades_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:03:14.348Z", id: "TRADE1" },
    ],
  }), "utf8");

  const health = dailySystemOpsCheck.__test.loadExecutionHealth({
    repoRoot: tmpRoot,
    dateKey: "2026-04-02",
  });

  assert.strictEqual(health.available, true);
  assert.strictEqual(health.signals_count, 1);
  assert.strictEqual(health.intents_count, 1);
  assert.strictEqual(health.fills_count, 1);
  assert.strictEqual(health.trades_count, 1);
  assert.strictEqual(dailySystemOpsCheck.__test.hasExecutionFlowCoverage(health), true);

  console.log("DAILY_SYSTEM_OPS_CHECK_TEST_OK");
})();
