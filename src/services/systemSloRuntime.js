"use strict";

const fs = require("fs");
const path = require("path");
const { getSystemSloState } = require("../storage/systemSloStates");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadMlServingRuntime } = require("./mlServingRuntime");
const {
  loadPreferredExecutionQualityInput,
  loadPreferredLineageHealthInput,
} = require("./systemSloArtifactInputs");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const LOCAL_LATEST_PATH = path.join(OPS_DAILY_DIR, "system_slo_state_latest.json");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const LINEAGE_HEALTH_PATH = path.join(OPS_DAILY_DIR, "signal_lineage_health_latest.json");
const CACHE_TTL_MS = Math.max(5000, Number(process.env.SYSTEM_SLO_RUNTIME_CACHE_TTL_MS || 30000));
const runtimeCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDateMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveExecutionQualityLatencyMs(summary = null) {
  const row = summary && typeof summary === "object" ? summary : {};
  return toNum(row.guard_created_to_fill_p95_ms ?? row.created_to_fill_p95_ms);
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.summary && typeof doc.summary === "object") return doc.summary;
  if (doc.state && typeof doc.state === "object") return doc.state;
  return doc;
}

function resolveGeneratedAtMs(summary = null, doc = null) {
  const s = summary && typeof summary === "object" ? summary : {};
  const d = doc && typeof doc === "object" ? doc : {};
  return parseDateMs(
    s.generated_at
    || s.generated_at_kst
    || d.generated_at
    || d.generated_at_kst
    || null
  );
}

function normalizeLoadedSystemSloState(state = null, nowMs = Date.now()) {
  const raw = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null;
  if (!raw) return null;
  const maxAgeMs = Math.max(60 * 1000, Number(raw.max_age_ms || process.env.SYSTEM_SLO_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const generatedAtMs = parseDateMs(raw.generated_at_ms || raw.generated_at || null);
  raw.generated_at_ms = generatedAtMs;
  raw.max_age_ms = maxAgeMs;
  raw.stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > maxAgeMs) : true;
  if (raw.stale) {
    raw.status = "BLOCK";
    raw.reason = "SYSTEM_SLO_STATE_STALE";
    raw.block_new_entries = true;
  }
  return raw;
}

function buildSystemSloState({
  exchange = null,
  operationalGuard = null,
  mlServing = null,
  executionQuality = null,
  lineageHealth = null,
  nativeTrailProtection = null,
  nowMs = Date.now(),
  maxAgeMs = null,
} = {}) {
  const ops = operationalGuard && typeof operationalGuard === "object" ? operationalGuard : {};
  const serving = mlServing && typeof mlServing === "object" ? mlServing : {};
  const qualityDoc = executionQuality && typeof executionQuality === "object" ? executionQuality : {};
  const lineageDoc = lineageHealth && typeof lineageHealth === "object" ? lineageHealth : {};
  const nativeProtection = nativeTrailProtection && typeof nativeTrailProtection === "object" ? nativeTrailProtection : {};
  const quality = readSummary(qualityDoc);
  const lineage = readSummary(lineageDoc);
  const resolvedMaxAgeMs = Math.max(60 * 1000, Number(maxAgeMs || process.env.SYSTEM_SLO_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const qualityGeneratedAtMs = resolveGeneratedAtMs(quality, qualityDoc);
  const lineageGeneratedAtMs = resolveGeneratedAtMs(lineage, lineageDoc);
  const qualityFresh = Number.isFinite(qualityGeneratedAtMs) ? (Math.max(0, nowMs - qualityGeneratedAtMs) <= resolvedMaxAgeMs) : false;
  const lineageFresh = Number.isFinite(lineageGeneratedAtMs) ? (Math.max(0, nowMs - lineageGeneratedAtMs) <= resolvedMaxAgeMs) : false;

  const issues = [];
  if (ops.block_new_entries === true) {
    if (upper(ops.reason) === "OPS_GUARD_STOP" || upper(ops.reason) === "OPS_GUARD_BLOCK" || upper(ops.status) === "중단".toUpperCase() || upper(ops.status) === "BLOCK") issues.push("OPS_GUARD_STOP");
    else issues.push("OPS_GUARD_HOLD");
  }
  if (serving.block_new_entries === true) issues.push("ML_SERVING_BLOCK");
  if (!qualityFresh) issues.push("EXECUTION_QUALITY_STALE");
  if (!lineageFresh) issues.push("LINEAGE_HEALTH_STALE");
  const nativeTrailProtectionGapCount = toNum(nativeProtection.gap_count);
  if (Number.isFinite(nativeTrailProtectionGapCount) && nativeTrailProtectionGapCount > 0) {
    issues.push("NATIVE_TRAIL_PROTECTION_GAP");
  }

  const qualityStatus = upper(quality.status);
  if (qualityStatus === "EXECUTION_QUALITY_FAIL") issues.push("EXECUTION_QUALITY_FAIL");
  const qualityLatencyP95Ms = resolveExecutionQualityLatencyMs(quality);
  const qualityPartialPct = toNum(quality.partial_fill_rate_pct);
  const qualitySlippageP95Bps = toNum(quality.adverse_slippage_p95_bps);
  if (Number.isFinite(qualityLatencyP95Ms) && qualityLatencyP95Ms > 3000) issues.push("EXECUTION_LATENCY_P95_HIGH");
  if (Number.isFinite(qualityPartialPct) && qualityPartialPct > 80) issues.push("EXECUTION_PARTIAL_HIGH");
  if (Number.isFinite(qualitySlippageP95Bps) && qualitySlippageP95Bps > 90) issues.push("EXECUTION_SLIPPAGE_HIGH");

  const lineageIntentSignalNullRate = toNum(lineage.intents_signal_doc_id_null_rate);
  const lineageFillSignalNullRate = toNum(lineage.fills_signal_doc_id_null_rate);
  const lineageEntryFillIntentNullRate = toNum(lineage.entry_fills_intent_id_null_rate);
  if (Number.isFinite(lineageIntentSignalNullRate) && lineageIntentSignalNullRate > 0.02) issues.push("LINEAGE_INTENT_SIGNAL_NULL_RATE");
  if (Number.isFinite(lineageFillSignalNullRate) && lineageFillSignalNullRate > 0.02) issues.push("LINEAGE_FILL_SIGNAL_NULL_RATE");
  if (Number.isFinite(lineageEntryFillIntentNullRate) && lineageEntryFillIntentNullRate > 0.02) issues.push("LINEAGE_FILL_INTENT_NULL_RATE");

  let status = "PASS";
  let reason = "SYSTEM_SLO_HEALTHY";
  let blockNewEntries = false;
  const hasHardBlock = issues.some((code) => code === "OPS_GUARD_STOP" || code.endsWith("_BLOCK") || code.endsWith("_FAIL") || code.includes("LINEAGE_"));
  if (hasHardBlock) {
    status = "BLOCK";
    reason = issues[0];
    blockNewEntries = true;
  } else if (issues.length > 0) {
    status = "WARN";
    reason = issues[0];
    if (issues.includes("OPS_GUARD_HOLD")) blockNewEntries = true;
    if (issues.includes("NATIVE_TRAIL_PROTECTION_GAP")) blockNewEntries = true;
  }

  return {
    exchange: upper(exchange),
    status,
    reason,
    block_new_entries: blockNewEntries,
    slo_budget: {
      execution_latency_p95_ms_budget: Number(process.env.SYSTEM_SLO_LATENCY_P95_BUDGET_MS || 3000),
      execution_partial_fill_rate_pct_budget: Number(process.env.SYSTEM_SLO_PARTIAL_FILL_RATE_BUDGET_PCT || 80),
      execution_slippage_p95_bps_budget: Number(process.env.SYSTEM_SLO_SLIPPAGE_P95_BUDGET_BPS || 90),
      lineage_null_rate_budget: Number(process.env.SYSTEM_SLO_LINEAGE_NULL_RATE_BUDGET || 0.02),
    },
    slo_budget_burn: {
      execution_latency_p95_ms_ratio: Number.isFinite(qualityLatencyP95Ms) ? (qualityLatencyP95Ms / Number(process.env.SYSTEM_SLO_LATENCY_P95_BUDGET_MS || 3000)) : null,
      execution_partial_fill_rate_pct_ratio: Number.isFinite(qualityPartialPct) ? (qualityPartialPct / Number(process.env.SYSTEM_SLO_PARTIAL_FILL_RATE_BUDGET_PCT || 80)) : null,
      execution_slippage_p95_bps_ratio: Number.isFinite(qualitySlippageP95Bps) ? (qualitySlippageP95Bps / Number(process.env.SYSTEM_SLO_SLIPPAGE_P95_BUDGET_BPS || 90)) : null,
      lineage_intent_signal_null_rate_ratio: Number.isFinite(lineageIntentSignalNullRate) ? (lineageIntentSignalNullRate / Number(process.env.SYSTEM_SLO_LINEAGE_NULL_RATE_BUDGET || 0.02)) : null,
      lineage_fill_signal_null_rate_ratio: Number.isFinite(lineageFillSignalNullRate) ? (lineageFillSignalNullRate / Number(process.env.SYSTEM_SLO_LINEAGE_NULL_RATE_BUDGET || 0.02)) : null,
      lineage_fill_intent_null_rate_ratio: Number.isFinite(lineageEntryFillIntentNullRate) ? (lineageEntryFillIntentNullRate / Number(process.env.SYSTEM_SLO_LINEAGE_NULL_RATE_BUDGET || 0.02)) : null,
    },
    issues,
    stale: false,
    generated_at_ms: nowMs,
    max_age_ms: resolvedMaxAgeMs,
    components: {
      operational_guard_status: upper(ops.status),
      operational_guard_reason: upper(ops.reason),
      ml_serving_status: upper(serving.status),
      ml_serving_reason: upper(serving.reason),
      execution_quality_status: qualityStatus,
      execution_quality_generated_at_ms: qualityGeneratedAtMs,
      execution_quality_fresh: qualityFresh,
      execution_quality_latency_p95_ms: qualityLatencyP95Ms,
      execution_quality_partial_fill_rate_pct: qualityPartialPct,
      execution_quality_slippage_p95_bps: qualitySlippageP95Bps,
      lineage_generated_at_ms: lineageGeneratedAtMs,
      lineage_fresh: lineageFresh,
      lineage_intent_signal_null_rate: lineageIntentSignalNullRate,
      lineage_fill_signal_null_rate: lineageFillSignalNullRate,
      lineage_fill_intent_null_rate: lineageEntryFillIntentNullRate,
      native_trail_protection_gap_count: nativeTrailProtectionGapCount,
      native_trail_protection_top_symbols: Array.isArray(nativeProtection.top_symbols) ? nativeProtection.top_symbols.slice(0, 10) : [],
    },
  };
}

async function loadSystemSloRuntime({
  exchange = null,
  operationalGuard = null,
  mlServing = null,
  force = false,
} = {}) {
  const ex = upper(exchange);
  const cacheKey = ex || "ALL";
  const nowMs = Date.now();
  if (!force) {
    const cached = runtimeCache.get(cacheKey);
    if (cached && (nowMs - cached.ts_ms) <= CACHE_TTL_MS) return JSON.parse(JSON.stringify(cached.value));
  }
  const stateDoc = await getSystemSloState({ exchange: ex }).catch(() => null);
  if (stateDoc && stateDoc.state && typeof stateDoc.state === "object") {
    const value = normalizeLoadedSystemSloState(stateDoc.state, nowMs);
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return JSON.parse(JSON.stringify(value));
  }

  const [resolvedOps, resolvedServing] = await Promise.all([
    operationalGuard && typeof operationalGuard === "object" ? operationalGuard : loadOperationalGuardRuntime({ exchange: ex }).catch(() => null),
    mlServing && typeof mlServing === "object" ? mlServing : loadMlServingRuntime({ exchange: ex }).catch(() => null),
  ]);
  const [executionQuality, lineageHealth] = await Promise.all([
    loadPreferredExecutionQualityInput(),
    loadPreferredLineageHealthInput(),
  ]);
  const value = buildSystemSloState({
    exchange: ex,
    operationalGuard: resolvedOps,
    mlServing: resolvedServing,
    executionQuality,
    lineageHealth,
    nowMs,
  });
  runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  buildSystemSloState,
  loadSystemSloRuntime,
  __test: {
    normalizeLoadedSystemSloState,
    resolveGeneratedAtMs,
    resolveExecutionQualityLatencyMs,
  },
};
