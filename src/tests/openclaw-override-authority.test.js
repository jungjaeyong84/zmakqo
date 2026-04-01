"use strict";

const assert = require("assert");
const {
  summarizeOpenclawOverrideAuthority,
  evaluateOpenclawOverrideAuthority,
} = require("../utils/openclawOverrideAuthority");

(() => {
  const summary = summarizeOpenclawOverrideAuthority({
    currentSys: { canonical_engine_source_mode: "PINE_PRIMARY" },
    marketObjectiveScore: {
      summary: {
        top_recovery_markets: [{ market: "SOLUSDT" }, { market: "ETHUSDT" }],
      },
    },
    serverVsPinePerformanceDelta: {
      summary: {
        top_shadow_gap_markets: [{ market: "SOLUSDT" }, { market: "BNBUSDT" }],
      },
    },
    dropValidation: {
      summary: {
        top_watch_markets: [{ market: "SOLUSDT" }, { market: "XRPUSDT" }],
        top_rescue_market: "ETHUSDT",
      },
    },
  });
  assert.strictEqual(summary.status, "BOUNDED_AUTHORITY_ACTIVE");
  assert.strictEqual(summary.max_market_overrides_per_cycle, 2);
  assert.strictEqual(summary.top_priority_markets[0].market, "SOLUSDT");

  const allowed = evaluateOpenclawOverrideAuthority({
    stage: "EV",
    currentSys: {
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_full: 0.60,
      ev_gate_tp1_prob_kill: 0.50,
    },
    nextSettings: {
      ev_gate_tp1_prob_min: 0.535,
      ev_gate_tp1_prob_full: 0.59,
      ev_gate_tp1_prob_kill: 0.495,
    },
    authoritySummary: summary,
  });
  assert.strictEqual(allowed.allowed, true);
  assert.deepStrictEqual(allowed.blockers, []);

  const blocked = evaluateOpenclawOverrideAuthority({
    stage: "SOURCE_MODE",
    currentSys: {
      canonical_engine_market_overrides: {
        BTCUSDT: { source_mode: "PINE_PRIMARY" },
      },
    },
    nextSettings: {
      canonical_engine_market_overrides: {
        BTCUSDT: { source_mode: "SERVER_PRIMARY" },
        ETHUSDT: { source_mode: "SERVER_PRIMARY" },
        SOLUSDT: { source_mode: "SERVER_PRIMARY" },
      },
    },
    authoritySummary: summary,
  });
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("MARKET_OVERRIDE_LIMIT_EXCEEDED"));
})();

console.log("OPENCLAW_OVERRIDE_AUTHORITY_TEST_OK");
