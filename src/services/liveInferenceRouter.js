"use strict";

const { getAiGuardSettingsCached } = require("../storage/settings");
const { getMlServingBinding } = require("../storage/mlServingBindings");
const { loadMlServingRuntime } = require("./mlServingRuntime");

const CACHE_TTL_MS = Math.max(5000, Number(process.env.LIVE_INFERENCE_ROUTER_CACHE_TTL_MS || 30000));
const routerCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function norm(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildDefaultBinding({ aiGuard = null } = {}) {
  const guard = aiGuard && typeof aiGuard === "object" ? aiGuard : {};
  return {
    provider_mode: upper(process.env.SIGNAL_AI_PROVIDER_MODE) || "ENSEMBLE",
    claude_model: norm(process.env.SIGNAL_AI_CLAUDE_MODEL || process.env.SIGNAL_AI_MODEL || guard.claude_model || process.env.CLAUDE_MODEL || "claude-opus-4-5-20251101"),
    openai_model: norm(process.env.SIGNAL_AI_GPT_MODEL || process.env.SIGNAL_AI_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.2"),
    openai_reasoning_effort: norm(process.env.SIGNAL_AI_OPENAI_REASONING_EFFORT || process.env.OPENAI_REASONING_EFFORT || "medium"),
    ensemble_enabled: String(process.env.SIGNAL_AI_ENSEMBLE_ENABLED || "").trim()
      ? !["0", "false", "off", "no"].includes(String(process.env.SIGNAL_AI_ENSEMBLE_ENABLED || "").trim().toLowerCase())
      : true,
    require_live_serving: false,
  };
}

function resolveProviderMode(binding = null) {
  const mode = upper(binding && binding.provider_mode);
  if (mode === "CLAUDE_PRIMARY" || mode === "OPENAI_PRIMARY" || mode === "ENSEMBLE") return mode;
  return "ENSEMBLE";
}

function buildLiveInferenceRouterConfig({
  exchange = null,
  servingState = null,
  bindingDoc = null,
  aiGuard = null,
} = {}) {
  const state = servingState && typeof servingState === "object" ? servingState : {};
  const binding = bindingDoc && bindingDoc.binding && typeof bindingDoc.binding === "object"
    ? bindingDoc.binding
    : (bindingDoc && typeof bindingDoc === "object" ? bindingDoc : null);
  const fallback = buildDefaultBinding({ aiGuard });
  const active = binding ? { ...fallback, ...binding } : fallback;
  const providerMode = resolveProviderMode(active);
  const artifactId = norm(state.preferred_model_artifact_id || (bindingDoc && bindingDoc.artifact_id) || null);
  const requireLiveServing = active.require_live_serving === true;
  const liveServingAllowed = state.live_serving_allowed === true;
  const canUseBinding = !!binding && (!requireLiveServing || liveServingAllowed);
  const selected = canUseBinding ? active : fallback;
  const selectedProviderMode = resolveProviderMode(selected);
  const source = canUseBinding
    ? (bindingDoc && bindingDoc.artifact_id ? "ARTIFACT_BINDING" : "EXCHANGE_BINDING")
    : "DEFAULT";

  return {
    exchange: upper(exchange),
    source,
    serving_status: upper(state.status),
    serving_mode: upper(state.serving_mode),
    live_serving_allowed: liveServingAllowed,
    block_new_entries: state.block_new_entries === true,
    preferred_model_artifact_id: artifactId,
    provider_mode: selectedProviderMode,
    claude_model: norm(selected.claude_model),
    openai_model: norm(selected.openai_model),
    openai_reasoning_effort: norm(selected.openai_reasoning_effort) || "medium",
    ensemble_enabled: selectedProviderMode === "ENSEMBLE"
      ? selected.ensemble_enabled !== false
      : false,
    require_live_serving: requireLiveServing,
    binding_found: !!binding,
    binding_artifact_id: bindingDoc && bindingDoc.artifact_id ? String(bindingDoc.artifact_id) : null,
  };
}

async function loadLiveInferenceRouter({
  exchange = null,
  servingState = null,
  force = false,
} = {}) {
  const ex = upper(exchange);
  const cacheKey = `${ex || "ALL"}`;
  const nowMs = Date.now();
  if (!force) {
    const cached = routerCache.get(cacheKey);
    if (cached && (nowMs - cached.ts_ms) <= CACHE_TTL_MS) {
      return JSON.parse(JSON.stringify(cached.value));
    }
  }
  const [resolvedServingState, aiGuard] = await Promise.all([
    servingState && typeof servingState === "object" ? servingState : loadMlServingRuntime({ exchange: ex }).catch(() => null),
    getAiGuardSettingsCached(30_000).then((res) => (res && res.data) ? res.data : null).catch(() => null),
  ]);
  const bindingDoc = await getMlServingBinding({
    exchange: ex,
    artifactId: resolvedServingState && resolvedServingState.preferred_model_artifact_id,
  }).catch(() => null);
  const value = buildLiveInferenceRouterConfig({
    exchange: ex,
    servingState: resolvedServingState,
    bindingDoc,
    aiGuard,
  });
  routerCache.set(cacheKey, { ts_ms: nowMs, value });
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  loadLiveInferenceRouter,
  __test: {
    buildDefaultBinding,
    buildLiveInferenceRouterConfig,
  },
};
