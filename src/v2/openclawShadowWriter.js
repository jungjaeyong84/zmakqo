"use strict";

const crypto = require("crypto");

const { buildSignalIntentId, buildOpenClawDecisionId } = require("./contracts");
const { resolveV2RuntimeConfig } = require("./runtime");
const {
  buildOpenClawDecisionBundle,
  buildOpenClawDecisionBundleLedgerDoc,
} = require("./openclawControlPlane");
const { putV2Doc } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function normalizeSide(value) {
  const token = upper(value);
  if (token === "BUY") return "LONG";
  if (token === "SELL") return "SHORT";
  if (token === "LONG" || token === "SHORT") return token;
  return null;
}

function hash16(payload) {
  try {
    return crypto.createHash("sha256").update(JSON.stringify(payload || {})).digest("hex").slice(0, 16);
  } catch (_) {
    return null;
  }
}

function isWriterEnabled({ env = process.env, symbol = null } = {}) {
  const cfg = resolveV2RuntimeConfig(env);
  if (cfg.enabled !== true) return { ok: false, reason: "V2_DISABLED" };
  if (cfg.dryRun === true) return { ok: false, reason: "V2_DRY_RUN" };
  if (!parseBool(env.DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED, false)) {
    return { ok: false, reason: "V2_SHADOW_SIGNAL_WRITE_DISABLED" };
  }
  const normalizedSymbol = upper(symbol);
  if (
    cfg.canaryOnly === true &&
    Array.isArray(cfg.canarySymbols) &&
    cfg.canarySymbols.length > 0 &&
    normalizedSymbol &&
    !cfg.canarySymbols.includes(normalizedSymbol)
  ) {
    return { ok: false, reason: "V2_CANARY_SYMBOL_FILTERED" };
  }
  return { ok: true, reason: "V2_SHADOW_SIGNAL_WRITE_ENABLED" };
}

function inferSignalSourceMode({ input = {}, features = {} } = {}) {
  const explicit = upper(
    input.signalSourceMode ||
    input.sourceMode ||
    input.signal_source_mode ||
    features.signal_source_mode
  );
  if (explicit === "WEBHOOK_ASSISTED" || explicit === "SERVER_NATIVE_ML_AI" || explicit === "OPENCLAW_RECOMMENDED") {
    return explicit;
  }
  const origin = upper(
    input.sourceOrigin ||
    input.source_origin ||
    input.origin ||
    input.eventSource ||
    features.source_origin ||
    features.canonical_engine_candidate_source
  );
  if (origin === "SERVER_NATIVE" || origin === "SERVER_NATIVE_ML_AI") return "SERVER_NATIVE_ML_AI";
  return "WEBHOOK_ASSISTED";
}

function buildFallbackLineageId({
  signalSourceMode,
  exchange,
  symbol,
  side,
  timeframe,
  event,
  barCloseMs,
  nowMs,
} = {}) {
  const at = Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : (Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now());
  return [
    signalSourceMode || "UNKNOWN",
    upper(exchange) || "UNKNOWN_EXCHANGE",
    upper(symbol) || "UNKNOWN_SYMBOL",
    normalizeSide(side) || "UNKNOWN_SIDE",
    upper(timeframe) || "UNKNOWN_TF",
    upper(event) || "UNKNOWN_EVENT",
    String(at),
  ].join("__");
}

function resolveSignalLineageId({ input = {}, features = {}, signalSourceMode } = {}) {
  const candidates = [
    input.signalLineageId,
    input.signal_lineage_id,
    input.signalId,
    input.signal_id,
    input.signalDocId,
    input.signal_doc_id,
    features.signal_lineage_id,
    features.signal_id,
    features.signalId,
    features.signal_doc_id,
    features.signalDocId,
  ];
  for (const candidate of candidates) {
    const resolved = trimOrNull(candidate);
    if (resolved) return resolved;
  }
  return buildFallbackLineageId({
    signalSourceMode,
    exchange: input.exchange,
    symbol: input.symbol,
    side: input.side,
    timeframe: input.signalTf || input.tf || features.tf || features.timeframe,
    event: input.event || input.intent,
    barCloseMs: input.barCloseMs || input.signal_bar_close_time_utc_ms || features.signal_bar_close_time_utc_ms,
    nowMs: input.nowMs,
  });
}

function resolveShadowSignalIdentity({
  input = {},
  recommendedAction = "APPROVE_ENTRY",
  decisionMode = "SHADOW",
} = {}) {
  const features = input.features && typeof input.features === "object" ? input.features : {};
  const signalSourceMode = inferSignalSourceMode({ input, features });
  const symbol = upper(input.symbol);
  const side = normalizeSide(input.side);
  const signalLineageId = resolveSignalLineageId({ input, features, signalSourceMode });
  const signalIntentId = buildSignalIntentId({
    signalLineageId,
    signalSourceMode,
    symbol,
    side,
  });
  const openclawDecisionId = buildOpenClawDecisionId({
    signalIntentId,
    decisionMode,
    recommendedAction,
  });
  return Object.freeze({
    signalSourceMode,
    signalLineageId,
    signalIntentId,
    openclawDecisionId,
    symbol,
    side,
    decisionMode: upper(decisionMode),
    recommendedAction: upper(recommendedAction),
  });
}

function resolveBudgetSignals({ ruleResult = {} } = {}) {
  const guard = ruleResult && ruleResult.authority && ruleResult.authority.entryBudgetGuard
    ? ruleResult.authority.entryBudgetGuard
    : null;
  const reason = upper(ruleResult && ruleResult.reason);
  if (guard && guard.applicable === true) {
    const verdict = guard.ok === true ? "PASS" : "BLOCKED";
    return {
      budgetCheckResult: verdict,
      minOrderCheckResult: verdict,
    };
  }
  if (reason === "MIN_ORDER_EXCEEDS_BUDGET") {
    return {
      budgetCheckResult: "BLOCKED",
      minOrderCheckResult: "BLOCKED",
    };
  }
  return {
    budgetCheckResult: "NOT_EVALUATED",
    minOrderCheckResult: "NOT_EVALUATED",
  };
}

function resolveQualityScore({ input = {}, ruleResult = {}, features = {} } = {}) {
  const candidates = [
    input.qualityScore,
    input.quality_score,
    features.quality_score,
    features._quality_score,
    features._openclaw_executor_confidence,
    ruleResult && ruleResult.decision && ruleResult.decision.confidence,
    ruleResult && ruleResult.decision && ruleResult.decision.posterior,
  ];
  for (const candidate of candidates) {
    const value = toNumberOrNull(candidate);
    if (value !== null) return value;
  }
  return null;
}

function resolveDecisionStatus({ approved, decisionMode } = {}) {
  if (approved !== true) return "BLOCKED";
  if (upper(decisionMode) === "SHADOW") return "SHADOW_ONLY";
  return "APPROVED";
}

function resolveRationaleSummary({ ruleResult = {}, composite = null, mlVote = null, narrativeVote = null } = {}) {
  const parts = [];
  if (Array.isArray(composite && composite.reason_trace) && composite.reason_trace.length) {
    parts.push(composite.reason_trace.join(","));
  }
  const ruleReason = trimOrNull(ruleResult && ruleResult.reason);
  if (ruleReason) parts.push(ruleReason);
  if (trimOrNull(mlVote && mlVote.reason)) parts.push(`ML:${mlVote.reason}`);
  if (trimOrNull(narrativeVote && narrativeVote.error)) parts.push(`NARRATIVE:${narrativeVote.error}`);
  return parts.filter(Boolean).join(" | ") || "OPENCLAW_SHADOW_RECORDED";
}

function resolvePolicyScope({ input = {}, symbol = null, timeframe = null } = {}) {
  const explicit = trimOrNull(
    input.policyScope ||
    input.policy_scope ||
    (input.features && input.features.policy_scope)
  );
  if (explicit) return explicit;
  return `${upper(symbol) || "UNKNOWN"}_${upper(timeframe) || "UNKNOWN"}`;
}

function resolveStrategyFilterResult({ input = {}, side = null, qualityScore = null } = {}) {
  const explicit = input.strategyFilterResult;
  if (explicit && typeof explicit === "object") return explicit;

  const features = input.features && typeof input.features === "object" ? input.features : {};
  const signalSide = normalizeSide(side);
  const htfDirection = normalizeSide(
    input.htfDirection ||
    input.htf_direction ||
    features.htf_direction ||
    features._htf_direction
  );
  if (signalSide && htfDirection) {
    const aligned = signalSide === htfDirection;
    return {
      filter_name: "HTF_DIRECTION_ALIGNMENT",
      verdict: aligned ? "PASS" : "BLOCK",
      reason: aligned ? "HTF_DIRECTION_ALIGNED" : "HTF_DIRECTION_MISMATCH",
      signal_side: signalSide,
      htf_direction: htfDirection,
      htf_confidence: qualityScore,
      min_confidence: 0.6,
    };
  }
  return {
    filter_name: "HTF_DIRECTION_ALIGNMENT",
    verdict: "SHADOW",
    reason: "OPENCLAW_SHADOW_FILTER_NOT_CAPTURED",
    signal_side: signalSide,
    htf_direction: signalSide,
    htf_confidence: qualityScore,
    min_confidence: 0.6,
  };
}

function buildShadowBundlePayload({
  input = {},
  ruleResult = {},
  composite = null,
  mlVote = null,
  narrativeVote = null,
} = {}) {
  const features = input.features && typeof input.features === "object" ? input.features : {};
  const signalSourceMode = inferSignalSourceMode({ input, features });
  const symbol = upper(input.symbol);
  const side = normalizeSide(input.side);
  const timeframe = upper(input.signalTf || input.tf || features.tf || features.timeframe);
  const decisionMode = "SHADOW";
  const approved = ruleResult && ruleResult.ok === true && Number(ruleResult.qtyPctFinal) > 0;
  const qualityScore = resolveQualityScore({ input, ruleResult, features });
  const budgetSignals = resolveBudgetSignals({ ruleResult });
  const rationaleSummary = resolveRationaleSummary({ ruleResult, composite, mlVote, narrativeVote });
  const signalLineageId = resolveSignalLineageId({ input, features, signalSourceMode });
  const strategyFilterResult = resolveStrategyFilterResult({ input, side, qualityScore });
  const recommendedAction = approved ? "APPROVE_ENTRY" : "BLOCK_ENTRY";
  const payload = {
    signalSourceMode,
    signalLineageId,
    symbol,
    side,
    qualityScore,
    budgetCheckResult: budgetSignals.budgetCheckResult,
    minOrderCheckResult: budgetSignals.minOrderCheckResult,
    decisionStatus: resolveDecisionStatus({ approved, decisionMode }),
    decisionMode,
    recommendedAction,
    approved,
    rationaleSummary,
    policyScope: resolvePolicyScope({ input, symbol, timeframe }),
    strategyFilterResult,
    createdAt: trimOrNull(input.createdAt) || new Date().toISOString(),
  };

  if (signalSourceMode === "SERVER_NATIVE_ML_AI") {
    const featureValues = (input.featureValues && typeof input.featureValues === "object")
      ? input.featureValues
      : features;
    payload.timeframe = timeframe;
    payload.featureSchemaVersion = trimOrNull(
      input.featureSchemaVersion ||
      input.feature_schema_version ||
      features.feature_schema_version ||
      features._feature_schema_version
    ) || "openclaw_shadow_v1";
    payload.featureValues = featureValues;
    payload.marketRegime = trimOrNull(input.marketRegime || input.market_regime || features.market_regime || features._openclaw_executor_regime);
    payload.featuresHash = trimOrNull(input.featuresHash || input.features_hash) || hash16(featureValues);
    payload.modelVersion = trimOrNull(
      input.modelVersion ||
      input.model_version ||
      features.model_version ||
      features._ml_model_version
    ) || "OPENCLAW_SHADOW_UNKNOWN";
    payload.decisionSummary = trimOrNull(input.decisionSummary || input.decision_summary) || rationaleSummary;
    payload.proposalVerdict = upper(input.proposalVerdict || input.proposal_verdict) || (approved ? "SHADOW" : "BLOCK");
    payload.rankScore = toNumberOrNull(input.rankScore || input.rank_score) ?? qualityScore ?? 0;
    payload.sizeRatio = toNumberOrNull(input.sizeRatio || input.size_ratio) ?? toNumberOrNull(ruleResult && ruleResult.qtyPctFinal) ?? 0;
    payload.riskBand = upper(input.riskBand || input.risk_band) || "MEDIUM";
  }

  return payload;
}

async function persistBundle({ db = null, env = process.env, bundle } = {}) {
  const writes = [];
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "SIGNAL_INTENTS",
    doc: bundle.signalIntent,
  }));
  if (bundle.featureSnapshot) {
    writes.push(await putV2Doc({
      db,
      env,
      collectionKey: "FEATURE_SNAPSHOTS",
      doc: bundle.featureSnapshot,
    }));
  }
  if (bundle.mlAiSignalProposal) {
    writes.push(await putV2Doc({
      db,
      env,
      collectionKey: "ML_AI_SIGNAL_PROPOSALS",
      doc: bundle.mlAiSignalProposal,
    }));
  }
  if (bundle.mlAiEvidence) {
    writes.push(await putV2Doc({
      db,
      env,
      collectionKey: "ML_AI_EVIDENCE_LEDGER",
      doc: bundle.mlAiEvidence,
    }));
  }
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISIONS",
    doc: bundle.openclawDecision,
  }));
  writes.push(await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISION_BUNDLES",
    doc: buildOpenClawDecisionBundleLedgerDoc({
      bundle,
      source: "OPENCLAW_SHADOW_WRITER",
    }),
  }));
  return writes;
}

async function writeOpenClawShadowDecision({
  db = null,
  env = process.env,
  input = {},
  ruleResult = {},
  composite = null,
  mlVote = null,
  narrativeVote = null,
} = {}) {
  const symbol = upper(input && input.symbol);
  const gate = isWriterEnabled({ env, symbol });
  if (gate.ok !== true) {
    return {
      ok: true,
      written: false,
      skipped: true,
      reason: gate.reason,
    };
  }

  try {
    const payload = buildShadowBundlePayload({
      input,
      ruleResult,
      composite,
      mlVote,
      narrativeVote,
    });
    const bundle = buildOpenClawDecisionBundle(payload);
    const writes = await persistBundle({ db, env, bundle });
    return {
      ok: true,
      written: true,
      skipped: false,
      reason: "V2_SHADOW_SIGNAL_WRITE_OK",
      signal_intent_id: bundle.signalIntent.signal_intent_id,
      openclaw_decision_id: bundle.openclawDecision.openclaw_decision_id,
      writes,
    };
  } catch (error) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: error && error.message ? error.message : String(error),
    };
  }
}

module.exports = {
  writeOpenClawShadowDecision,
  resolveShadowSignalIdentity,
  __test: {
    isWriterEnabled,
    inferSignalSourceMode,
    resolveSignalLineageId,
    resolveBudgetSignals,
    resolveDecisionStatus,
    resolveStrategyFilterResult,
    buildShadowBundlePayload,
  },
};
