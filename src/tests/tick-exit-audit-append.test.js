"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { __test } = require("../services/binanceTickExit");

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tick-exit-audit-"));
  const auditPath = path.join(tmpDir, "binance_tick_exit_audit.jsonl");

  const appended = __test.appendTickExitAudit({
    event: "tick_exit_tp1_native_gap_fail_closed",
    ts: "2026-04-17T00:00:00.000Z",
    symbol: "ETHUSDT",
    issue_codes: ["NATIVE_TP_MISSING"],
  }, auditPath);
  assert.strictEqual(appended, true);

  const skipped = __test.appendTickExitAudit({
    event: "tick_exit_native_protection_refresh",
    ts: "2026-04-17T00:00:01.000Z",
    symbol: "ETHUSDT",
  }, auditPath);
  assert.strictEqual(skipped, false);

  const rows = String(fs.readFileSync(auditPath, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].event, "tick_exit_tp1_native_gap_fail_closed");

  console.log("TICK_EXIT_AUDIT_APPEND_TEST_OK");
})().catch((err) => {
  console.error("TICK_EXIT_AUDIT_APPEND_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
