"use strict";

const { buildOpenClawLearnerShadowEvaluationDoc } = require("./contracts");
const { putV2Doc } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function proposeShadowPolicyPatch(adjudication) {
  const row = asObject(adjudication);
  const label = upper(row && row.adjudication_label);
  if (label === "MODEL_WIN") {
    return Object.freeze({
      action: "KEEP_POLICY",
      patch: Object.freeze({}),
      confidence: 0.55,
      reasons: Object.freeze(["OUTCOME_MODEL_WIN"]),
    });
  }
  if (label === "MODEL_ERROR") {
    return Object.freeze({
      action: "SHADOW_REDUCE_SIZE_OR_BLOCK_COHORT",
      patch: Object.freeze({
        sizing_multiplier_delta: -0.1,
        require_additional_evidence: true,
      }),
      confidence: 0.7,
      reasons: Object.freeze(["OUTCOME_MODEL_ERROR", "SHADOW_ONLY_NO_LIVE_POLICY_WRITE"]),
    });
  }
  if (label === "PROTECTION_ERROR" || label === "EXECUTION_ERROR") {
    return Object.freeze({
      action: "SHADOW_BLOCK_UNTIL_SYSTEM_HEALTHY",
      patch: Object.freeze({
        require_runtime_health_green: true,
      }),
      confidence: 0.9,
      reasons: Object.freeze([`OUTCOME_${label}`, "SYSTEM_ERROR_NOT_MODEL_ALPHA"]),
    });
  }
  return Object.freeze({
    action: "SHADOW_MORE_EVIDENCE",
    patch: Object.freeze({ require_more_outcomes: true }),
    confidence: 0.4,
    reasons: Object.freeze(["OUTCOME_NOT_DECISIVE"]),
  });
}

function buildOpenClawLearnerShadowEvaluation({
  adjudication,
  learnerVersion = "openclaw-shadow-learner-v1",
  evaluatedAt = null,
} = {}) {
  const row = asObject(adjudication);
  if (!row) throw new Error("OPENCLAW_OUTCOME_ADJUDICATION_REQUIRED");
  const proposal = proposeShadowPolicyPatch(row);
  return Object.freeze(buildOpenClawLearnerShadowEvaluationDoc({
    sourceAdjudicationId: row.openclaw_outcome_adjudication_id,
    openclawDecisionId: row.openclaw_decision_id,
    positionCycleId: row.position_cycle_id,
    learnerVersion,
    shadowOnly: true,
    proposedAction: proposal.action,
    proposedPolicyPatch: proposal.patch,
    confidence: proposal.confidence,
    reasonTrace: proposal.reasons,
    evaluatedAt,
  }));
}

async function persistOpenClawLearnerShadowEvaluation({
  evaluation,
  db = null,
  env = process.env,
  merge = true,
} = {}) {
  const doc = asObject(evaluation);
  if (!doc) throw new Error("OPENCLAW_LEARNER_SHADOW_EVALUATION_REQUIRED");
  if (doc.shadow_only !== true) throw new Error("OPENCLAW_LEARNER_MUST_BE_SHADOW_ONLY");
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_LEARNER_SHADOW_EVALUATIONS",
    doc,
    merge,
  });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_LEARNER_SHADOW_EVALUATION_LEDGER_WRITTEN",
    openclaw_learner_shadow_evaluation_id: trimOrNull(doc.openclaw_learner_shadow_evaluation_id),
    persisted,
  });
}

function evaluateOpenClawLearnerShadowPromotionReadiness(summary) {
  const row = asObject(summary);
  const evalN = Number(row && row.evaluation_n);
  const shadowOnlyN = Number(row && row.shadow_only_n);
  const liveAppliedN = Number(row && row.live_applied_n);
  const staleN = Number(row && row.stale_evaluation_n);
  const blockers = [];
  if (!row) blockers.push("LEARNER_SHADOW_SUMMARY_REQUIRED");
  if (!(Number.isFinite(evalN) && evalN > 0)) blockers.push("LEARNER_SHADOW_EVALUATION_REQUIRED");
  if (!(Number.isFinite(shadowOnlyN) && shadowOnlyN === evalN)) blockers.push("LEARNER_SHADOW_ONLY_COVERAGE_REQUIRED");
  if (!(Number.isFinite(liveAppliedN) && liveAppliedN === 0)) blockers.push("LEARNER_LIVE_APPLICATION_FORBIDDEN");
  if (!(Number.isFinite(staleN) && staleN === 0)) blockers.push("LEARNER_STALE_EVALUATION_BLOCKED");
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "OPENCLAW_LEARNER_SHADOW_READY" : "OPENCLAW_LEARNER_SHADOW_BLOCKED",
    blockers,
  });
}

module.exports = {
  proposeShadowPolicyPatch,
  buildOpenClawLearnerShadowEvaluation,
  persistOpenClawLearnerShadowEvaluation,
  evaluateOpenClawLearnerShadowPromotionReadiness,
  __test: {
    trimOrNull,
    upper,
    asObject,
  },
};
