"use strict";

const assert = require("assert");
const { buildMemoryLedger } = require("../utils/bestSelfEvolutionMemoryLedger");

(() => {
  const previous = buildMemoryLedger({
    candidateChangeSet: {
      rows: [
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          scope: "PINE",
          markets: ["ALL"],
          changes: [{ key: "core_regime_gate", current: 1, next: 2, direction: "TIGHTEN" }],
        },
      ],
    },
    replayReport: {
      validations: [
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          validation_verdict: "BLOCK",
          candidate_objective_delta: -0.8,
          count_delta: -0.05,
          replacement_delta: -0.2,
          avg_ret_net_delta: -0.01,
          blockers: ["COUNT_GUARD_ACTIVE"],
        },
      ],
    },
    canaryReport: { rows: [] },
    previousLedger: null,
    nowMeta: { dateKey: "2026-03-22", kst: "2026-03-22 09:00:00 KST" },
  });

  const current = buildMemoryLedger({
    candidateChangeSet: {
      rows: [
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          scope: "PINE",
          markets: ["ALL"],
          changes: [{ key: "core_regime_gate", current: 1, next: 2, direction: "TIGHTEN" }],
        },
        {
          candidate_id: "WAIT_ONE_BAR_TUNE",
          display_candidate_id: "WAIT_ONE_BAR_TUNE",
          scope: "WAIT",
          markets: ["BTCUSDT"],
          changes: [{ key: "wait_one_bar_same_dir_streak_min", current: 2, next: 1, direction: "LOOSEN" }],
        },
      ],
    },
    replayReport: {
      validations: [
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          validation_verdict: "PASS",
          candidate_objective_delta: 0.6,
          count_delta: 0.01,
          replacement_delta: 0.1,
          avg_ret_net_delta: 0.01,
        },
        {
          candidate_id: "WAIT_ONE_BAR_TUNE",
          validation_verdict: "PASS",
          candidate_objective_delta: 0.7,
          count_delta: 0.02,
          replacement_delta: 0.12,
          avg_ret_net_delta: 0.02,
        },
      ],
    },
    canaryReport: {
      rows: [
        {
          market: "BTCUSDT",
          candidate_id: "WAIT_ONE_BAR_TUNE",
          current_stage: "SOFT",
          canary_action: "PROMOTE_SOFT",
          canary_verdict: "READY",
          rollback_ready: false,
        },
      ],
    },
    previousLedger: previous,
    nowMeta: { dateKey: "2026-03-29", kst: "2026-03-29 20:30:00 KST" },
  });

  assert.strictEqual(current.summary.blocked_candidate_n, 1);
  assert.strictEqual(current.summary.blocked_candidate_ids.includes("AUTO_CORE_REGIME_TIGHTEN"), true);
  const blocked = current.current_rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  const success = current.current_rows.find((row) => row.candidate_id === "WAIT_ONE_BAR_TUNE");
  assert.strictEqual(blocked.memory_blocked, true);
  assert.strictEqual(success.verdict, "SUCCESS");
  assert.strictEqual(current.summary.top_success_candidate_id, "WAIT_ONE_BAR_TUNE");
  assert.strictEqual(current.summary.top_failed_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");

  console.log("BEST_SELF_EVOLUTION_MEMORY_LEDGER_TEST_OK");
})();
