"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/replay-missing-trade-execution-alerts");

(async () => {
  const crossAudit = {
    issues: [
      { fill_id: "ENTRY_1", symbol: "BTCUSDT", event: "LONG", fill_created_at: "2026-04-16T01:00:00.000Z" },
      { fill_id: "EXIT_1", symbol: "AXSUSDT", event: "FORCE_EXIT_ALL", fill_created_at: "2026-04-16T01:57:11.214Z" },
      { fill_id: "EXIT_2", symbol: "AXSUSDT", event: "FORCE_EXIT_ALL", fill_created_at: "2026-04-16T01:57:11.214Z" },
    ],
    actionable_issues: [
      { fill_id: "EXIT_1", symbol: "AXSUSDT", event: "FORCE_EXIT_ALL", fill_created_at: "2026-04-16T01:57:11.214Z" },
      { fill_id: "EXIT_2", symbol: "AXSUSDT", event: "FORCE_EXIT_ALL", fill_created_at: "2026-04-16T01:57:11.214Z" },
    ],
  };

  const actionableOnly = __test.selectReplayIssues(crossAudit, { includeNonActionable: false });
  assert.strictEqual(actionableOnly.length, 2);
  assert.ok(actionableOnly.every((row) => row.symbol === "AXSUSDT"));

  const allIssues = __test.selectReplayIssues(crossAudit, { includeNonActionable: true });
  assert.strictEqual(allIssues.length, 3);

  const grouped = __test.groupReplayIssues(actionableOnly);
  assert.strictEqual(grouped.length, 1);
  assert.strictEqual(grouped[0].issue.fill_id, "EXIT_1");
  assert.strictEqual(grouped[0].key, "AXSUSDT|FORCE_EXIT_ALL|2026-04-16T01:57:11.214Z");

  console.log("REPLAY_MISSING_TRADE_EXECUTION_ALERTS_TEST_OK");
})().catch((err) => {
  console.error("REPLAY_MISSING_TRADE_EXECUTION_ALERTS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
