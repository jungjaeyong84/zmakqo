"use strict";

const assert = require("assert");
const { buildMemoryLedger } = require("../utils/bestSelfEvolutionMemoryLedger");

(() => {
  const originalTtl = process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS;
  process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS = "2";

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
  assert.strictEqual(current.summary.fingerprint_block_ttl_weeks >= 1, true);
  assert.strictEqual(current.summary.blocked_candidate_ids.includes("AUTO_CORE_REGIME_TIGHTEN"), true);
  const blocked = current.current_rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  const success = current.current_rows.find((row) => row.candidate_id === "WAIT_ONE_BAR_TUNE");
  assert.strictEqual(blocked.memory_blocked, true);
  assert.strictEqual(blocked.previous_fail_week_key, "2026W12");
  assert.strictEqual(success.verdict, "SUCCESS");
  assert.strictEqual(current.summary.top_success_candidate_id, "WAIT_ONE_BAR_TUNE");
  assert.strictEqual(current.summary.top_failed_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");

  const expired = buildMemoryLedger({
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
          validation_verdict: "PASS",
          candidate_objective_delta: 0.2,
          count_delta: 0,
          replacement_delta: 0,
          avg_ret_net_delta: 0,
        },
      ],
    },
    canaryReport: { rows: [] },
    previousLedger: previous,
    nowMeta: { dateKey: "2026-04-12", kst: "2026-04-12 20:30:00 KST" },
  });
  const expiredRow = expired.current_rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(expiredRow.memory_blocked, false);
  assert.strictEqual(expiredRow.previous_fail_age_weeks, null);
  assert.strictEqual(expired.summary.blocked_candidate_n, 0);

  const releasedBySuccessLedger = buildMemoryLedger({
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
          validation_verdict: "PASS",
          candidate_objective_delta: 0.4,
          count_delta: 0.01,
          replacement_delta: 0.02,
          avg_ret_net_delta: 0.01,
        },
      ],
    },
    canaryReport: {
      rows: [
        {
          market: "BTCUSDT",
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          current_stage: "SOFT",
          canary_action: "PROMOTE_SOFT",
          canary_verdict: "READY",
          rollback_ready: false,
        },
      ],
    },
    previousLedger: previous,
    nowMeta: { dateKey: "2026-03-29", kst: "2026-03-29 21:30:00 KST" },
  });

  const releasedCurrent = buildMemoryLedger({
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
          validation_verdict: "PASS",
          candidate_objective_delta: 0.3,
          count_delta: 0.01,
          replacement_delta: 0.01,
          avg_ret_net_delta: 0.01,
        },
      ],
    },
    canaryReport: { rows: [] },
    previousLedger: releasedBySuccessLedger,
    nowMeta: { dateKey: "2026-04-05", kst: "2026-04-05 20:30:00 KST" },
  });
  const releasedRow = releasedCurrent.current_rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(releasedRow.memory_released_by_success, true);
  assert.strictEqual(releasedRow.memory_blocked, false);

  if (originalTtl == null) delete process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS;
  else process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS = originalTtl;

  console.log("BEST_SELF_EVOLUTION_MEMORY_LEDGER_TEST_OK");
})();
