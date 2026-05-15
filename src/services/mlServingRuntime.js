"use strict";

const fs = require("fs");
const path = require("path");
const { getMlServingState } = require("../storage/mlServingStates");
const { getShadowCanaryGate } = require("../storage/shadowCanaryGates");
const { warnIfFailClosedDisabled } = require("../utils/failClosedEnvGuard");
// P3-08: emit a single startup WARN if ML_SERVING_FAIL_CLOSED is explicitly
// opted out of fail-closed mode.
warnIfFailClosedDisabled("ML_SERVING_FAIL_CLOSED", { context: "mlServingRuntime" });

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const LOCAL_LATEST_PATH = path.join(OPS_DAILY_DIR, "ml_serving_state_latest.json");
const V3_LEARNING_STATE_PATH = path.join(OPS_DAILY_DIR, "v3_openclaw_learning_state_latest.json");
const CACHE_TTL_MS = Math.max(5000, Number(process.env.ML_SERVING_RUNTIME_CACHE_TTL_MS || 30000));
const runtimeCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function resolvePrimaryLearningLane(env = process.env) {
  const explicit = upper(env.OPENCLAW_PRIMARY_LEARNING_LANE);
  if (explicit) return explicit;
  const scope = upper(env.DONBEOLJA_OPENCLAW_LEARNING_SCOPE);
  if (scope === "V3_PAPER_ONLY") return "V3_PAPER";
  return "V2_OPENCLAW";
}

function unwrapServingState(input = null) {
  if (!input || typeof input !== "object") return null;
  if (input.state && typeof input.state === "object") return input.state;
  return input;
}

function buildMlServingStateFromV3LearningState(state = null, nowMs = Date.now()) {
  const raw = state && typeof state === "object" ? state : {};
  const generatedAtMs = toTimeMs(raw.generated_at_ms || raw.generated_at || null);
  const maxAgeMs = Math.max(60 * 1000, Number(process.env.ML_SERVING_STATE_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const failClosed = String(process.env.ML_SERVING_FAIL_CLOSED || "1").trim() !== "0";
  const stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > maxAgeMs) : true;
  const shadowObservationReady = raw.shadow_observation_ready === true;
  const shadowEvaluationReady = raw.shadow_evaluation_ready === true
    || (raw.shadow_evaluation_ready == null && raw.shadow_ready === true);
  const enoughSamples = raw.validation_gate && raw.validation_gate.paper_sample_ok === true;
  let status = upper(raw.status) || "HOLD";
  let reason = upper(raw.reason) || "V3_PAPER_LEARNING_STATE_MISSING";
  if (stale) {
    status = failClosed ? "BLOCK" : "WARN";
    reason = "ML_V3_LEARNING_STATE_STALE";
  }
  return {
    exchange: null,
    status,
    reason,
    serving_mode: "SHADOW_ONLY",
    live_serving_armed: false,
    live_serving_allowed: false,
    block_new_entries: false,
    fail_closed: failClosed,
    gate_available: true,
    gate_status: status,
    gate_reason: reason,
    promotion_blocked: false,
    enough_samples: enoughSamples,
    shadow_observation_ready: shadowObservationReady,
    shadow_evaluation_ready: shadowEvaluationReady,
    shadow_ready: shadowEvaluationReady,
    policy_candidate_ready_for_shadow: shadowEvaluationReady,
    shadow_future_effective_meets_target: raw.bootstrap_metrics && raw.bootstrap_metrics.target_hit === true,
    shadow_raw_retained_meets_target: raw.bootstrap_metrics && raw.bootstrap_metrics.target_hit === true,
    runtime_blocked_historical_debt_sample_n: 0,
    stale,
    generated_at_ms: generatedAtMs,
    max_age_ms: maxAgeMs,
    preferred_model_artifact_id: null,
    preferred_train_run_id: null,
    contract_shadow_ready: shadowEvaluationReady,
    contract_live_serving_allowed: false,
    model_canary_ready: false,
    learning_scope: upper(raw.learning_scope),
    v1_learning_blocked: raw.v1_learning_blocked === true,
    v2_learning_blocked: raw.v2_learning_blocked === true,
    source_lane: upper(raw.source_lane),
  };
}

function normalizeLoadedServingState(state = null, nowMs = Date.now()) {
  const raw = unwrapServingState(state);
  if (!raw || typeof raw !== "object") return null;
  const value = JSON.parse(JSON.stringify(raw));
  const maxAgeMs = Math.max(60 * 1000, Number(value.max_age_ms || process.env.ML_SERVING_STATE_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const failClosed = value.fail_closed == null
    ? (String(process.env.ML_SERVING_FAIL_CLOSED || "1").trim() !== "0")
    : (value.fail_closed === true);
  const generatedAtMs = toTimeMs(value.generated_at_ms || value.generated_at || value.created_at || null);
  const stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > maxAgeMs) : true;

  value.generated_at_ms = generatedAtMs;
  value.max_age_ms = maxAgeMs;
  value.fail_closed = failClosed;
  value.stale = stale;

  if (stale) {
    value.live_serving_allowed = false;
    if (value.promotion_blocked === true) {
      value.status = "BLOCK";
      value.reason = "ML_SERVING_ROLLBACK_TRIGGERED";
      value.block_new_entries = true;
    } else {
      value.status = failClosed ? "BLOCK" : "WARN";
      value.reason = "ML_SERVING_GATE_STALE";
      value.block_new_entries = failClosed;
    }
  }

  return value;
}

function buildMlServingState({
  exchange = null,
  shadowCanaryGate = null,
  executionServingContract = null,
  mlModelContract = null,
  liveServingArmed = null,
  failClosed = null,
  maxAgeMs = null,
  nowMs = Date.now(),
} = {}) {
  const gatePayload = shadowCanaryGate && typeof shadowCanaryGate === "object"
    ? shadowCanaryGate
    : null;
  const gate = gatePayload && gatePayload.gate && typeof gatePayload.gate === "object"
    ? gatePayload.gate
    : gatePayload;
  const contractSummary = executionServingContract && typeof executionServingContract === "object"
    ? (executionServingContract.summary && typeof executionServingContract.summary === "object" ? executionServingContract.summary : executionServingContract)
    : {};
  const modelSummary = mlModelContract && typeof mlModelContract === "object"
    ? (mlModelContract.summary && typeof mlModelContract.summary === "object" ? mlModelContract.summary : mlModelContract)
    : {};
  const resolvedMaxAgeMs = Math.max(60 * 1000, Number(maxAgeMs || process.env.ML_SERVING_STATE_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const resolvedFailClosed = failClosed == null
    ? (String(process.env.ML_SERVING_FAIL_CLOSED || "1").trim() !== "0")
    : (failClosed === true);
  const resolvedLiveServingArmed = liveServingArmed == null
    ? (String(process.env.ML_LIVE_SERVING_ARMED || "0").trim() === "1")
    : (liveServingArmed === true);
  const generatedAtMs = toTimeMs(
    gatePayload && (gatePayload.generated_at || gatePayload.created_at)
    || contractSummary.generated_at
    || modelSummary.generated_at
    || null
  );
  const stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > resolvedMaxAgeMs) : true;
  const gateAvailable = !!gate;
  const promotionBlocked = gate && gate.promotion_blocked === true;
  const enoughSamples = gate && gate.enough_samples === true;
  const policyCandidateReadyForShadow = gate && gate.policy_candidate_ready_for_shadow === true;
  const shadowFutureEffectiveMeetsTarget = gate && gate.shadow_future_effective_meets_target === true;
  const shadowRawRetainedMeetsTarget = gate && gate.shadow_raw_retained_meets_target === true;
  const runtimeBlockedHistoricalDebtSampleN = Math.max(0, Number(gate && gate.runtime_blocked_historical_debt_sample_n) || 0);
  const shadowReady = gateAvailable && !stale && promotionBlocked !== true;
  const contractShadowReady = contractSummary.shadow_ready === true;
  const contractLiveAllowed = contractSummary.live_serving_allowed === true;
  const modelCanaryReady = String(modelSummary.status || "").trim().toUpperCase() === "ML_MODEL_CONTRACT_CANARY_READY";

  let servingMode = "OFFLINE_ONLY";
  let status = "HOLD";
  let reason = "ML_SERVING_NOT_READY";
  let liveServingAllowed = false;
  let blockNewEntries = false;

  if (!gateAvailable) {
    status = resolvedFailClosed ? "BLOCK" : "WARN";
    reason = "ML_SERVING_GATE_MISSING";
    blockNewEntries = resolvedFailClosed;
  } else if (stale) {
    status = resolvedFailClosed ? "BLOCK" : "WARN";
    reason = "ML_SERVING_GATE_STALE";
    blockNewEntries = resolvedFailClosed;
  } else if (promotionBlocked) {
    status = "BLOCK";
    reason = "ML_SERVING_ROLLBACK_TRIGGERED";
    blockNewEntries = true;
  } else if (resolvedLiveServingArmed && shadowReady && contractShadowReady && (modelCanaryReady || contractLiveAllowed)) {
    servingMode = "LIVE_ACTIVE";
    status = "PASS";
    reason = "ML_LIVE_SERVING_ACTIVE";
    liveServingAllowed = true;
  } else if (shadowReady && contractShadowReady) {
    servingMode = "SHADOW_ONLY";
    if (policyCandidateReadyForShadow && !shadowFutureEffectiveMeetsTarget) {
      status = "WARN";
      reason = "ML_SHADOW_READY_UNDER_TARGET";
    } else {
      status = "PASS";
      reason = shadowFutureEffectiveMeetsTarget
        ? (enoughSamples ? "ML_SHADOW_READY_TARGET_MET" : "ML_SHADOW_OBSERVING_TARGET_MET")
        : (enoughSamples ? "ML_SHADOW_READY" : "ML_SHADOW_OBSERVING");
    }
  } else if (shadowReady) {
    servingMode = "SHADOW_ONLY";
    status = "WARN";
    reason = "ML_SHADOW_READY_CONTRACT_PENDING";
  }

  return {
    exchange: upper(exchange),
    status,
    reason,
    serving_mode: servingMode,
    live_serving_armed: resolvedLiveServingArmed,
    live_serving_allowed: liveServingAllowed,
    block_new_entries: blockNewEntries,
    fail_closed: resolvedFailClosed,
    gate_available: gateAvailable,
    gate_status: upper(gate && gate.status),
    gate_reason: upper(gate && gate.reason),
    promotion_blocked: promotionBlocked,
    enough_samples: enoughSamples,
    shadow_ready: shadowReady,
    policy_candidate_ready_for_shadow: policyCandidateReadyForShadow,
    shadow_future_effective_meets_target: shadowFutureEffectiveMeetsTarget,
    shadow_raw_retained_meets_target: shadowRawRetainedMeetsTarget,
    runtime_blocked_historical_debt_sample_n: runtimeBlockedHistoricalDebtSampleN,
    stale,
    generated_at_ms: generatedAtMs,
    max_age_ms: resolvedMaxAgeMs,
    preferred_model_artifact_id: String(contractSummary.preferred_model_artifact_id || modelSummary.model_artifact_id || "").trim() || null,
    preferred_train_run_id: String(contractSummary.preferred_train_run_id || modelSummary.train_run_id || "").trim() || null,
    contract_shadow_ready: contractShadowReady,
    contract_live_serving_allowed: contractLiveAllowed,
    model_canary_ready: modelCanaryReady,
  };
}

async function loadMlServingRuntime({
  exchange = null,
  allowArtifactFallback = true,
  force = false,
} = {}) {
  const ex = upper(exchange);
  const learningLane = resolvePrimaryLearningLane(process.env);
  const cacheKey = `${learningLane}|${ex || "ALL"}|${allowArtifactFallback ? "ART" : "NOART"}`;
  const nowMs = Date.now();
  if (!force) {
    const cached = runtimeCache.get(cacheKey);
    if (cached && (nowMs - cached.ts_ms) <= CACHE_TTL_MS) return JSON.parse(JSON.stringify(cached.value));
  }
  if (learningLane === "V3_PAPER") {
    const artifact = safeReadJson(V3_LEARNING_STATE_PATH);
    const value = buildMlServingStateFromV3LearningState(artifact, nowMs);
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return JSON.parse(JSON.stringify(value));
  }
  const stateDoc = await getMlServingState({ exchange: ex }).catch(() => null);
  if (stateDoc && stateDoc.state && typeof stateDoc.state === "object") {
    const value = normalizeLoadedServingState(stateDoc.state, nowMs);
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return JSON.parse(JSON.stringify(value));
  }

  const gateDoc = await getShadowCanaryGate({ exchange: ex }).catch(() => null);
  if (gateDoc) {
    const value = buildMlServingState({ exchange: ex, shadowCanaryGate: gateDoc, nowMs });
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return JSON.parse(JSON.stringify(value));
  }

  if (allowArtifactFallback) {
    const artifact = safeReadJson(LOCAL_LATEST_PATH);
    if (artifact) {
      const state = unwrapServingState(artifact);
      if (state && typeof state === "object") {
        const value = normalizeLoadedServingState(state, nowMs);
        runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
        return JSON.parse(JSON.stringify(value));
      }
    }
  }
  const value = buildMlServingState({ exchange: ex, nowMs });
  runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  buildMlServingState,
  loadMlServingRuntime,
  __test: {
    normalizeLoadedServingState,
    unwrapServingState,
    resolvePrimaryLearningLane,
    buildMlServingStateFromV3LearningState,
  },
};
