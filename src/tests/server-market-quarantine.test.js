"use strict";

const assert = require("assert");
const { deriveServerMarketQuarantine } = require("../../src/utils/serverMarketQuarantine");

(() => {
  const summary = deriveServerMarketQuarantine({
    serverMarketCapitalAllocator: {
      summary: {
        by_market: [
          { market: "AXSUSDT", active: true, recommended_action: "QUARANTINE", allocation_score: -8, execution_quality_penalty: true },
          { market: "BTCUSDT", active: true, recommended_action: "INCREASE", allocation_score: 1.2 },
        ],
      },
    },
    serverPrimaryLearningEpoch: {
      summary: { status: "SERVER_PRIMARY_EPOCH_ACTIVE", active: true },
    },
  });

  assert.strictEqual(summary.count_scope, "ALLOCATOR_QUARANTINE_ONLY");
  assert.strictEqual(summary.quarantine_market_n, 1);
  assert.strictEqual(summary.watch_only_review_market_n, 1);
  assert.strictEqual(summary.other_server_policy_watch_only_market_n, 0);
  assert.strictEqual(summary.top_quarantine_market, "AXSUSDT");
  console.log("SERVER_MARKET_QUARANTINE_TEST_OK");
})();
