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
  });

  assert.strictEqual(blocked.status, "ML_GLOBAL_CANARY_EVIDENCE_READY");
  assert.strictEqual(blocked.global_canary_ready, false);
  assert.strictEqual(blocked.evidence_status, "GLOBAL_CANARY_REPLAY_BLOCKED");
  assert.strictEqual(blocked.dominant_blocker, "SELF_EVOLUTION_REPLAY_NOT_PASS");
  assert.strictEqual(blocked.replay_evidence_status, "REPLAY_WARN_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.replay_dominant_issue, "EV_TUNER_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(blocked.replay_sample_gap_n, 1);
  assert.ok(blocked.blocking_reasons.includes("GLOBAL_CANARY_BLOCKER_SELF_EVOLUTION_REPLAY_NOT_PASS"));

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
  });

  assert.strictEqual(ready.global_canary_ready, true);
  assert.strictEqual(ready.evidence_status, "GLOBAL_CANARY_PASS_READY");

  console.log("ML_GLOBAL_CANARY_EVIDENCE_TEST_OK");
})();
