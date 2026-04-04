"use strict";

const assert = require("assert");
const { deriveExplorationBudget } = require("../../src/utils/explorationBudget");

(() => {
  const originalProduction = process.env.OPENCLAW_PRODUCTION_SLOT_N;
  const originalExploration = process.env.OPENCLAW_EXPLORATION_SLOT_N;
  const originalLearningMode = process.env.OPENCLAW_SERVER_SIGNAL_LEARNING_MODE;
  try {
    process.env.OPENCLAW_PRODUCTION_SLOT_N = "4";
    process.env.OPENCLAW_EXPLORATION_SLOT_N = "2";
    process.env.OPENCLAW_SERVER_SIGNAL_LEARNING_MODE = "1";

    const boosted = deriveExplorationBudget({
      overrideAuthority: {
        summary: {
          max_market_overrides_per_cycle: 4,
          top_priority_markets: ["SOLUSDT", "BTCUSDT", "ETHUSDT", "BNBUSDT"],
          execution_quality_penalty_markets: ["AXSUSDT"],
          reverse_policy_penalty_markets: ["XRPUSDT"],
        },
      },
      marketObjectiveScore: {
        summary: {
          top_recovery_market: "SOLUSDT",
          top_watch_markets: ["XRPUSDT", "AXSUSDT", "DOGEUSDT"],
        },
      },
      serverVsPinePerformanceDelta: {
        summary: {
          top_shadow_gap_market: "XRPUSDT",
          top_watch_markets: ["XRPUSDT", "AXSUSDT"],
        },
      },
      executionQuality: { summary: { top_latency_market: "AXSUSDT" } },
      reversePolicy: { summary: { top_watch_market: "XRPUSDT" } },
      serverPrimaryLearningEpoch: {
        summary: {
          status: "SERVER_PRIMARY_EPOCH_ACTIVE",
          active: true,
          exploration_boost: 1.3,
        },
      },
      changeResultAttribution: {
        summary: {
          success_rate: 0.2,
          positive_change_n: 1,
          adverse_change_n: 5,
        },
      },
      reasoningJournal: {
        summary: {
          verification_rate: 0,
          verified_n: 0,
        },
      },
    });

    assert.strictEqual(boosted.production_slot_n, 3);
    assert.strictEqual(boosted.exploration_slot_n, 3);
    assert.ok(boosted.adaptive_budget_reasons.includes("LOW_VERIFICATION_RATE_EXPLORE_UP"));
    assert.ok(boosted.adaptive_budget_reasons.includes("ADVERSE_ATTRIBUTION_STREAK_BUDGET_DOWN"));
    assert.strictEqual(boosted.learning_epoch_exploration_min, 3);

    const positive = deriveExplorationBudget({
      overrideAuthority: {
        summary: {
          max_market_overrides_per_cycle: 4,
          top_priority_markets: ["SOLUSDT", "BTCUSDT", "ETHUSDT", "BNBUSDT"],
        },
      },
      marketObjectiveScore: {
        summary: {
          top_recovery_market: "SOLUSDT",
          top_watch_markets: ["XRPUSDT", "AXSUSDT", "DOGEUSDT", "LTCUSDT"],
        },
      },
      serverVsPinePerformanceDelta: {
        summary: {
          top_shadow_gap_market: "SOLUSDT",
          top_watch_markets: ["XRPUSDT", "AXSUSDT", "DOGEUSDT", "LTCUSDT"],
        },
      },
      serverPrimaryLearningEpoch: {
        summary: {
          status: "SERVER_PRIMARY_EPOCH_ACTIVE",
          active: true,
          exploration_boost: 1.3,
        },
      },
      changeResultAttribution: {
        summary: {
          success_rate: 0.75,
          positive_change_n: 5,
          adverse_change_n: 1,
        },
      },
      reasoningJournal: {
        summary: {
          verification_rate: 0.7,
          verified_n: 5,
        },
      },
    });

    assert.ok(positive.exploration_slot_n >= 4);
    assert.ok(positive.adaptive_budget_reasons.includes("POSITIVE_ATTRIBUTION_STREAK_EXPLORE_UP"));

    const floored = deriveExplorationBudget({
      overrideAuthority: { summary: { max_market_overrides_per_cycle: 4 } },
      marketObjectiveScore: { summary: { top_watch_markets: ["XRPUSDT", "AXSUSDT", "DOGEUSDT"] } },
      serverVsPinePerformanceDelta: { summary: { top_watch_markets: ["XRPUSDT", "AXSUSDT", "DOGEUSDT"] } },
      serverPrimaryLearningEpoch: {
        summary: {
          status: "SERVER_PRIMARY_EPOCH_ACTIVE",
          active: true,
          exploration_boost: 1.0,
        },
      },
      changeResultAttribution: {
        summary: {
          success_rate: 0.1,
          positive_change_n: 0,
          adverse_change_n: 9,
        },
      },
      reasoningJournal: {
        summary: {
          verification_rate: 1,
          verified_n: 5,
        },
      },
    });
    assert.strictEqual(floored.exploration_slot_n, 3);

    console.log("EXPLORATION_BUDGET_TEST_OK");
  } finally {
    if (originalProduction === undefined) delete process.env.OPENCLAW_PRODUCTION_SLOT_N;
    else process.env.OPENCLAW_PRODUCTION_SLOT_N = originalProduction;
    if (originalExploration === undefined) delete process.env.OPENCLAW_EXPLORATION_SLOT_N;
    else process.env.OPENCLAW_EXPLORATION_SLOT_N = originalExploration;
    if (originalLearningMode === undefined) delete process.env.OPENCLAW_SERVER_SIGNAL_LEARNING_MODE;
    else process.env.OPENCLAW_SERVER_SIGNAL_LEARNING_MODE = originalLearningMode;
  }
})();
