"use strict";

const assert = require("assert");
const { buildCandidateChangeSets, __test } = require("../../src/utils/bestSelfEvolutionCandidates");
const { candidateFingerprint } = require("../utils/bestSelfEvolutionMemoryLedger");

function run() {
  assert.strictEqual(__test.resolveDiffDirection("foo_min", 1, 2), "TIGHTEN");
  assert.strictEqual(__test.resolveDiffDirection("foo_max", 1, 2), "LOOSEN");

  const report = buildCandidateChangeSets({
    objectiveSupervisor: {
      raw: {
        phase0: { tf: "15m" },
        best_febt_tuning_contract: {
          mode: "RECOVERY_FIRST",
          projected_count_ratio_global: 0.98,
          projected_replacement_ratio: 0.75,
          tightening_allowed: false,
          recovery_priority: true,
        },
        best_febt_market_contracts: [
          {
            market: "DOGEUSDT",
            mode: "COUNT_GUARD_ACTIVE",
            projected_count_ratio_global: 0.85,
            projected_replacement_ratio: 0.5,
            tightening_allowed: false,
            recovery_priority: true,
          },
        ],
      },
    },
    patchCandidates: {
      raw: {
        candidates: [
          {
            candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
            display_candidate_id: "AUTO_LONG_SHORT_REGIME_TIGHTEN",
            status: "WATCHLIST_TIGHTEN",
            direction: "TIGHTEN",
            ready_for_weekly_patch: false,
            pine_patch_axis: "shared_regime_transition_confirmation",
            pine_patch_delta: 2,
            rationale: "regime tighten",
            priority_score: 0.61,
            avg_dropped_ret_net: -0.015,
          },
        ],
      },
    },
    ml: {
      raw: {
        recommendations: {
          QUALITY: [
            {
              key: "gate_core_score_abs",
              current: 35,
              next: 37,
              action: "REVIEW_TIGHTEN",
              reason: "tighten quality",
              support_n: 25,
              support_rate: 0.32,
              display_key: "LONG/SHORT 확장 진입 점수 기준",
            },
          ],
          AI: { action: "KEEP", reason: "keep ai" },
          MARKET: { action: "KEEP", reason: "keep market" },
          EV: { action: "HOLD", reason: "hold ev", blocked_action: "REVIEW_UPDATE", blocked_key: "EV_SOFTENING", next: { ev_gate_tp1_prob_min: 0.55 } },
        },
      },
    },
    ev: {
      raw: {
        tf: "15m",
        current_threshold: 0.55,
        next_threshold: 0.52,
        current_band: { fullThreshold: 0.6, killThreshold: 0.5, midScale: 0.7, lowScale: 0.35 },
        next_band: { fullThreshold: 0.58, killThreshold: 0.48, midScale: 0.75, lowScale: 0.4 },
        settings_updated: true,
        decision_reason: "SOFTEN_TEST",
      },
    },
    wait: {
      raw: {
        tf: "15m",
        current: { wait_one_bar_same_dir_streak_min: 3, wait_one_bar_counter_dir_bars_max: 0 },
        next: { wait_one_bar_same_dir_streak_min: 2, wait_one_bar_counter_dir_bars_max: 1 },
        changed: true,
        reason: "RECOVERY_FIRST",
      },
    },
    changeControl: { raw: { auto_rollback: { rollback_file_path: "/tmp/rollback.json" } } },
    memoryLedger: {
      raw: {
        summary: {
          blocked_candidate_ids: ["AUTO_CORE_REGIME_TIGHTEN"],
          recent_failed_fingerprints: [],
        },
        current_rows: [
          {
            candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
            memory_blocked: true,
            memory_block_reason: "RECENT_FAIL_FINGERPRINT",
          },
        ],
      },
    },
  });

  assert.strictEqual(report.summary.generated_n >= 6, true);
  assert.strictEqual(report.summary.total_n >= 4, true);
  const pine = report.rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(pine, undefined);
  const blockedPine = report.blocked_rows.find((row) => row.candidate_id === "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(blockedPine.scope, "PINE");
  assert.ok(blockedPine.risk_flags.includes("COUNT_GUARD_ACTIVE"));
  assert.ok(blockedPine.risk_flags.includes("MEMORY_BLOCKED"));
  assert.strictEqual(blockedPine.ready_for_auto_apply, false);
  const ev = report.rows.find((row) => row.candidate_id === "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(ev.scope, "EV");
  assert.strictEqual(ev.ready_for_auto_apply, true);
  assert.strictEqual(report.summary.memory_blocked_n, 1);

  const fingerprintBaseArgs = {
    objectiveSupervisor: {
      raw: {
        phase0: { tf: "15m" },
        best_febt_tuning_contract: {
          mode: "NORMAL",
          projected_count_ratio_global: 1.01,
          projected_replacement_ratio: 0.82,
          tightening_allowed: true,
          recovery_priority: false,
        },
        best_febt_market_contracts: [],
      },
    },
    patchCandidates: { raw: { candidates: [] } },
    ml: { raw: { recommendations: { QUALITY: [], MARKET: { action: "KEEP" }, AI: { action: "KEEP" }, EV: { action: "KEEP" } } } },
    ev: {
      raw: {
        tf: "15m",
        current_threshold: 0.55,
        next_threshold: 0.52,
        current_band: { fullThreshold: 0.6, killThreshold: 0.5, midScale: 0.7, lowScale: 0.35 },
        next_band: { fullThreshold: 0.58, killThreshold: 0.48, midScale: 0.75, lowScale: 0.4 },
        settings_updated: true,
        decision_reason: "SOFTEN_TEST",
      },
    },
    wait: { raw: { tf: "15m", current: {}, next: {}, changed: false, reason: "KEEP" } },
    changeControl: { raw: {} },
    memoryLedger: { raw: { summary: { blocked_candidate_ids: [], recent_failed_fingerprints: [] }, current_rows: [] } },
  };
  const fingerprintBaseReport = buildCandidateChangeSets(fingerprintBaseArgs);
  const evFingerprint = candidateFingerprint(fingerprintBaseReport.rows.find((row) => row.candidate_id === "EV_TP1_THRESHOLD_TUNE"));
  const reportWithFingerprintBlock = buildCandidateChangeSets({
    ...fingerprintBaseArgs,
    memoryLedger: {
      raw: {
        summary: {
          blocked_candidate_ids: [],
          recent_failed_fingerprints: [evFingerprint],
        },
        current_rows: [],
      },
    },
  });
  const evBlocked = reportWithFingerprintBlock.blocked_rows.find((row) => row.candidate_id === "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(evBlocked.memory_blocked, true);
  assert.strictEqual(evBlocked.failed_fingerprint_repeat, true);
  assert.ok(evBlocked.risk_flags.includes("FAILED_FINGERPRINT_REPEAT"));
  assert.ok(evBlocked.risk_flags.includes("MEMORY_BLOCKED"));
  assert.strictEqual(reportWithFingerprintBlock.rows.some((row) => row.candidate_id === "EV_TP1_THRESHOLD_TUNE"), false);
  assert.strictEqual(reportWithFingerprintBlock.summary.memory_blocked_n, 1);

  const concentrationReport = buildCandidateChangeSets({
    objectiveSupervisor: {
      raw: {
        phase0: { tf: "15m" },
        best_febt_tuning_contract: {
          mode: "NORMAL",
          projected_count_ratio_global: 1.0,
          projected_replacement_ratio: 0.82,
          tightening_allowed: true,
          recovery_priority: false,
        },
        best_febt_market_contracts: [
          { market: "AXSUSDT", mode: "NORMAL", tightening_allowed: true, recovery_priority: false },
        ],
        self_evolution_objective: {
          market_concentration: {
            concentration_flag: true,
            dominant_negative_share: 1,
            bottom_market_drag_gap: 3.7445,
            dominant_negative_market: {
              market: "AXSUSDT",
              objective_score: -3.7445,
              realized_n: 5,
              avg_realized_ret_net: -0.0112,
            },
          },
        },
      },
    },
    patchCandidates: { raw: { candidates: [] } },
    ml: { raw: { recommendations: { QUALITY: [], MARKET: { action: "KEEP" }, AI: { action: "KEEP" }, EV: { action: "KEEP" } } } },
    ev: null,
    wait: null,
    changeControl: { raw: {} },
    memoryLedger: { raw: { summary: { blocked_candidate_ids: [], recent_failed_fingerprints: [] }, current_rows: [] } },
  });
  const axsRecovery = concentrationReport.rows.find((row) => row.candidate_id === "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");
  assert.ok(axsRecovery);
  assert.deepStrictEqual(axsRecovery.markets, ["AXSUSDT"]);
  assert.strictEqual(axsRecovery.scope, "PINE");
  assert.strictEqual(axsRecovery.market_concentration_recovery, true);
  assert.ok(axsRecovery.risk_flags.includes("MARKET_CONCENTRATION_RECOVERY"));

  console.log("BEST_SELF_EVOLUTION_CANDIDATES_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_CANDIDATES_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
