"use strict";

const assert = require("assert");
const { deriveDeploymentPlan } = require("../../src/utils/bestSelfEvolutionDeploymentPlan");

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: {
      summary: { open_wave: 1 },
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "SOFT", blockers: [] },
      ],
    },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: "/tmp/prepared.pine",
            latest_generated_file_path: "/tmp/latest.pine",
            rollback_source_file_path: "/tmp/rollback.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: {
      weeks: [
        {
          week_key: "2026W13",
          recommended_patch_id: "AUTO_CORE_REGIME_TIGHTEN",
          created_file_path: "/tmp/prepared.pine",
          latest_generated_file_path: "/tmp/latest.pine",
          rollback_source_file_path: "/tmp/rollback.pine",
        },
      ],
    },
  });

  assert.strictEqual(report.summary.plan_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.manual_step_required, true);
  assert.strictEqual(report.summary.prepared_file_path, "/tmp/prepared.pine");
  assert.strictEqual(report.summary.recommended_target_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(report.summary.prepared_origin_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(report.summary.market_scope_ready_n, 1);
  assert.strictEqual(report.handoff.checklist.length > 0, true);
  assert.strictEqual(Array.isArray(report.summary.next_actions), true);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, recovery_mode: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: {
      summary: { open_wave: 1 },
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "HARD", blockers: [] },
      ],
    },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: __filename,
            latest_generated_file_path: "/tmp/latest.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: { weeks: [] },
    manualPasteAck: {
      acknowledged: true,
      prepared_file_path: __filename,
      latest_generated_file_path: "/tmp/latest.pine",
      candidate_signature: "AUTO_CORE_REGIME_TIGHTEN",
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      applied_strategy_id: "donbeolja_v6.0.3.1",
      acknowledged_at_kst: "2026-03-30 13:40:00 KST",
    },
  });

  assert.strictEqual(report.summary.plan_status, "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS");
  assert.strictEqual(report.summary.ready_for_manual_paste, false);
  assert.strictEqual(report.summary.manual_step_required, false);
  assert.strictEqual(report.summary.manual_paste_acknowledged, true);
  assert.strictEqual(report.summary.live_signal_confirmation_pending, true);
  assert.strictEqual(report.summary.applied_strategy_id, "donbeolja_v6.0.3.1");
  assert.strictEqual(report.summary.authority_bypass_active, true);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_APPLIED_ACK_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, recovery_mode: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_LONG_SHORT_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: { summary: { open_wave: 1 }, rows: [] },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: "/tmp/donbeolja_v6.0.3.2.pine.txt",
            prepared_strategy_id: "donbeolja_v6.0.3.2",
            latest_generated_file_path: "/tmp/latest.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: { weeks: [] },
    manualPasteAck: {
      acknowledged: true,
      prepared_file_path: "/tmp/donbeolja_v6.0.3.1.pine.txt",
      latest_generated_file_path: "/tmp/latest.pine",
      candidate_signature: "AUTO_CORE_REGIME_TIGHTEN",
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      applied_strategy_id: "donbeolja_v6.0.3.1",
      live_signal_confirmed: true,
      confirmed_signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1774844100000__LONG",
      acknowledged_at_kst: "2026-03-30 13:40:00 KST",
    },
  });

  assert.strictEqual(report.summary.manual_paste_acknowledged, false);
  assert.strictEqual(report.summary.plan_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.prepared_strategy_id, "donbeolja_v6.0.3.2");
  assert.strictEqual(report.summary.live_signal_confirmed, false);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_STRATEGY_MISMATCH_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, recovery_mode: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: { summary: { open_wave: 1 }, rows: [] },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: __filename,
            latest_generated_file_path: "/tmp/latest.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: { weeks: [] },
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_kst: "2026-03-30 13:40:00 KST",
      acknowledged_at_iso: "2026-03-30T04:40:00.000Z",
      prepared_file_path: __filename,
      latest_generated_file_path: "/tmp/latest.pine",
      candidate_signature: "AUTO_CORE_REGIME_TIGHTEN",
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      applied_strategy_id: "donbeolja_v6.0.3.1",
    },
    signalsCache: {
      docs: [
        {
          signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1774844100000__LONG",
          created_at: "2026-03-30T04:55:00.000Z",
          event: "LONG",
          features_json: { strategy_id: "donbeolja_v6.0.3.1", event: "LONG" },
        },
      ],
    },
  });

  assert.strictEqual(report.summary.plan_status, "APPLIED_CONFIRMED_AUTHORITY_BYPASS");
  assert.strictEqual(report.summary.live_signal_confirmed, true);
  assert.strictEqual(report.summary.live_signal_confirmation_pending, false);
  assert.strictEqual(report.summary.confirmed_signal_id, "SIG__BINANCEFUT__BTCUSDT__15m__1774844100000__LONG");
  assert.strictEqual(report.summary.authority_bypass_active, true);
  assert.strictEqual(report.summary.applied_origin_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_SIGNAL_CONFIRM_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: false, candidate_id: null, display_candidate_id: null },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: false },
    },
    changeControl: {},
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: false, target_candidate_id: null, canary_open_wave: 1, blockers: [] } },
    canaryReport: { summary: { open_wave: 1 }, rows: [] },
    stageAutopilot: { raw: { stage_rows: [] } },
    weeklyHistory: { weeks: [] },
    manualPasteAck: {
      acknowledged: true,
      prepared_file_path: "/tmp/donbeolja_v6.0.3.2.pine.txt",
      applied_strategy_id: "donbeolja_v6.0.3.2",
      live_signal_confirmed: true,
      confirmed_signal_id: "SIG__OLD",
    },
    preparedOverride: {
      enabled: true,
      prepared_file_path: __filename,
      prepared_strategy_id: "donbeolja_v6.0.3.3",
      latest_generated_file_path: "/tmp/latest.pine",
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      display_candidate_id: "AUTO_LONG_SHORT_REGIME_TIGHTEN",
      prepared_stage_ready: true,
      ready_for_manual_paste: true,
    },
  });

  assert.strictEqual(report.summary.plan_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.prepared_strategy_id, "donbeolja_v6.0.3.3");
  assert.strictEqual(report.summary.applied_strategy_id, "donbeolja_v6.0.3.2");
  assert.strictEqual(report.summary.manual_paste_acknowledged, false);
  assert.strictEqual(report.summary.prepared_override_active, true);
  assert.strictEqual(report.summary.prepared_origin_candidate_id, "AUTO_CORE_REGIME_TIGHTEN");
  assert.strictEqual(report.summary.recommended_target_candidate_id, null);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_PREPARED_OVERRIDE_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, recovery_mode: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: { summary: { open_wave: 1 }, rows: [] },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: __filename,
            latest_generated_file_path: "/tmp/latest.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: { weeks: [] },
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-30T04:40:00.000Z",
      prepared_file_path: __filename,
      latest_generated_file_path: "/tmp/latest.pine",
      candidate_signature: "AUTO_CORE_REGIME_TIGHTEN",
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      applied_strategy_id: "donbeolja_v6.0.3.1",
      live_signal_confirmed: true,
      confirmed_signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG",
      confirmed_signal_created_at: "2026-03-30T11:15:00.000Z",
      confirmed_signal_event: "LONG",
    },
  });

  assert.strictEqual(report.summary.plan_status, "APPLIED_CONFIRMED_AUTHORITY_BYPASS");
  assert.strictEqual(report.summary.live_signal_confirmed, true);
  assert.strictEqual(report.summary.confirmed_signal_id, "SIG__BINANCEFUT__ETHUSDT__15m__1774858500000__LONG");
  assert.strictEqual(report.summary.authority_bypass_active, true);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_SHARED_CONFIRM_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: false, candidate_id: null, display_candidate_id: null },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: { verdict: "HOLD" },
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: {
      summary: { open_wave: 1 },
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "HARD", blockers: [] },
      ],
    },
    stageAutopilot: { raw: { stage_rows: [] } },
    weeklyHistory: { weeks: [] },
  });

  assert.strictEqual(report.summary.blockers.includes("CODEX_ACTION_NOT_APPROVED"), false);
  assert.strictEqual(report.summary.next_actions.some((row) => row.includes("change-control 상태를 재평가")), false);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_NONREADY_TEST_OK");
})();

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, recovery_mode: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: { verdict: "HOLD" },
    codexPatchReview: { verdict: "HOLD" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: {
      summary: { open_wave: 1 },
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "HARD", blockers: [] },
      ],
    },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "PENDING",
            reason: "DAILY_NO_TRADE_ACTIVITY",
            prepared_file_path: null,
            latest_generated_file_path: "/tmp/latest.pine",
          },
        ],
      },
    },
    weeklyHistory: { weeks: [] },
  });

  assert.strictEqual(report.summary.prepare_pass, true);
  assert.strictEqual(report.summary.dry_prepare_available, true);
  assert.strictEqual(report.summary.blockers.includes("CODEX_ACTION_NOT_APPROVED"), false);
  assert.strictEqual(report.summary.next_actions.some((row) => row.includes("change-control 상태를 재평가")), false);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_RECOVERY_TEST_OK");
})();
