"use strict";

const assert = require("assert");
const { buildMlGlobalCanaryEvidence } = require("../utils/mlGlobalCanaryEvidence");

(() => {
  const blocked = buildMlGlobalCanaryEvidence({
    canary: {
      summary: {
        total_n: 3,
        ready_n: 0,
        blocked_n: 3,
        rollback_ready_n: 0,
        apply_pass: false,
        global_canary_pass: false,
        shadow_global_drift: 0,
        golden_global_drift: 0,
        model_binding_source: "EXECUTION_SERVING_CONTRACT",
        model_artifact_id: "MODEL_SCOPE__1",
        train_run_id: "TRAIN_SCOPE__1",
      },
      rows: [
        { market: "BTCUSDT", current_stage: "SHADOW", canary_verdict: "BLOCK", blockers: ["SELF_EVOLUTION_REPLAY_NOT_PASS"] },
        { market: "ETHUSDT", current_stage: "SHADOW", canary_verdict: "BLOCK", blockers: ["SELF_EVOLUTION_REPLAY_NOT_PASS", "WAVE_NOT_OPEN"] },
        { market: "ALL", current_stage: "SHADOW", canary_verdict: "BLOCK", blockers: ["SELF_EVOLUTION_REPLAY_NOT_PASS"] },
      ],
    },
    replayEvidence: {
      summary: {
        evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
      },
    },
    evReplaySampleGap: {
      summary: {
        evidence_status: "EV_REPLAY_SAMPLE_GAP",
        requirement_source: "OBJECTIVE_SUPERVISOR_GOVERNANCE_EFFECTIVE_REALIZED",
        required_realized_n: 8,
        governance_effective_realized_n: 7,
        governance_effective_gap_n: 1,
        dominant_sample_dimension: "GOVERNANCE_EFFECTIVE_REALIZED",
      },
    },
    replayUnblockProjection: {
      summary: {
        projected_replay_ready_if_sample_gap_closed: false,
        projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA",
      },
    },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: false,
        evidence_status: "EVENT_TRUTH_ALPHA_NOT_POSITIVE",
        positive_rate: 0.42,
        avg_realized_ret_net: -0.001,
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_NEGATIVE_DOMINANT",
        fail_rate: 0.55,
        dominant_failure_pattern: "SL_FIRST",
        top_failure_market: "BTCUSDT",
      },
    },
  });

  assert.strictEqual(blocked.status, "ML_GLOBAL_CANARY_EVIDENCE_READY");
  assert.strictEqual(blocked.global_canary_ready, false);
  assert.strictEqual(blocked.evidence_status, "GLOBAL_CANARY_ALPHA_BLOCKED");
  assert.strictEqual(blocked.dominant_blocker, "SELF_EVOLUTION_REPLAY_NOT_PASS");
  assert.strictEqual(blocked.alpha_validation_ready, false);
  assert.strictEqual(blocked.alpha_evidence_status, "EVENT_TRUTH_ALPHA_NOT_POSITIVE");
  assert.strictEqual(blocked.failure_learning_evidence_status, "FAILURE_LEARNING_NEGATIVE_DOMINANT");
  assert.strictEqual(blocked.replay_evidence_status, "REPLAY_WARN_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.replay_dominant_issue, "EV_TUNER_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(blocked.replay_sample_gap_n, 1);
  assert.strictEqual(blocked.replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(blocked.replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.ok(blocked.blocking_reasons.includes("GLOBAL_CANARY_BLOCKER_SELF_EVOLUTION_REPLAY_NOT_PASS"));
  assert.ok(blocked.blocking_reasons.includes("GLOBAL_CANARY_ALPHA_EVENT_TRUTH_ALPHA_NOT_POSITIVE"));
  assert.ok(blocked.blocking_reasons.includes("GLOBAL_CANARY_FAILURE_FAILURE_LEARNING_NEGATIVE_DOMINANT"));

  const ready = buildMlGlobalCanaryEvidence({
    canary: {
      summary: {
        total_n: 2,
        ready_n: 2,
        blocked_n: 0,
        rollback_ready_n: 0,
        apply_pass: true,
        global_canary_pass: true,
      },
      rows: [
        { market: "BTCUSDT", current_stage: "SOFT", canary_verdict: "READY", blockers: [] },
        { market: "SOLUSDT", current_stage: "SOFT", canary_verdict: "READY", blockers: [] },
      ],
    },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_PASS",
      },
    },
  });

  assert.strictEqual(ready.global_canary_ready, true);
  assert.strictEqual(ready.evidence_status, "GLOBAL_CANARY_PASS_READY");

  console.log("ML_GLOBAL_CANARY_EVIDENCE_TEST_OK");
})();
