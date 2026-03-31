"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-rollback-monitor");

(() => {
  const stale = __test.evaluateRollbackMonitor({
    rollback: { ready: true },
    rollbackFilePath: "/tmp/rollback.pine",
    codexFresh: false,
    codexVerdict: "ROLLBACK",
    codexRollbackPath: "/tmp/rollback.pine",
    state: {},
  });
  assert.strictEqual(stale.verdict, "HOLD");
  assert.strictEqual(stale.reason, "EXTERNAL_AUTHORITY_REQUIRED_ROLLBACK");

  const blocked = __test.evaluateRollbackMonitor({
    rollback: { ready: true },
    rollbackFilePath: "/tmp/rollback.pine",
    codexFresh: true,
    codexVerdict: "HOLD",
    codexRollbackPath: null,
    state: {},
  });
  assert.strictEqual(blocked.verdict, "HOLD");
  assert.strictEqual(blocked.reason, "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");

  const alreadyPrepared = __test.evaluateRollbackMonitor({
    rollback: { ready: true },
    rollbackFilePath: "/tmp/rollback.pine",
    codexFresh: true,
    codexVerdict: "ROLLBACK",
    codexRollbackPath: "/tmp/rollback.pine",
    state: {
      rollback_file_path: "/tmp/rollback.pine",
      prepared_at: "2026-03-26 21:00:00 KST",
      latest_alias_path: "/tmp/latest.pine",
      open_method: "code -g",
    },
  });
  assert.strictEqual(alreadyPrepared.verdict, "ROLLBACK_PREPARED");
  assert.strictEqual(alreadyPrepared.reason, "ALREADY_PREPARED");
  assert.strictEqual(alreadyPrepared.opened, true);
  assert.strictEqual(alreadyPrepared.writeState, false);

  console.log("ROLLBACK_MONITOR_TEST_OK");
})();
