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
  assert.strictEqual(summary.max_market_overrides_per_cycle, summary.bounds.max_market_overrides_per_cycle);
  assert.ok(summary.max_market_overrides_per_cycle >= 1);
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
    authoritySummary: {
      ...summary,
      bounds: {
        ...summary.bounds,
        max_market_overrides_per_cycle: 2,
      },
    },
  });
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("MARKET_OVERRIDE_LIMIT_EXCEEDED"));

  const strategic = evaluateOpenclawOverrideAuthority({
    stage: "CANONICAL_POLICY",
    currentSys: {},
    nextSettings: {
      risk_daily_loss_limit: 100000,
    },
    authoritySummary: summary,
  });
  assert.strictEqual(strategic.allowed, false);
  assert.ok(strategic.blockers.includes("STRATEGIC_MUTATION_REQUIRES_APPROVAL"));
  assert.strictEqual(strategic.paper_only_mutation_required, true);
  assert.ok(strategic.non_allowlist_changed_keys.includes("risk_daily_loss_limit"));

  const budgetSummary = {
    ...summary,
    bounds: {
      ...summary.bounds,
      live_mutation_key_budget: 1,
      live_auto_apply_key_allowlist: ["ev_gate_tp1_prob_min", "ev_gate_tp1_prob_full"],
    },
  };
  const budgetBlocked = evaluateOpenclawOverrideAuthority({
    stage: "EV",
    currentSys: {
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_full: 0.60,
    },
    nextSettings: {
      ev_gate_tp1_prob_min: 0.54,
      ev_gate_tp1_prob_full: 0.59,
    },
    authoritySummary: budgetSummary,
  });
  assert.strictEqual(budgetBlocked.allowed, false);
  assert.ok(budgetBlocked.blockers.includes("LIVE_MUTATION_KEY_BUDGET_EXCEEDED"));
})();

console.log("OPENCLAW_OVERRIDE_AUTHORITY_TEST_OK");
