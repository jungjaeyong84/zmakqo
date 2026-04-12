"use strict";

const fs = require("fs");
const path = require("path");
const { getSystemAnomalyState } = require("../storage/systemAnomalyStates");
const { loadSystemSloRuntime } = require("./systemSloRuntime");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadMlServingRuntime } = require("./mlServingRuntime");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const CACHE_TTL_MS = Math.max(5000, Number(process.env.SYSTEM_ANOMALY_RUNTIME_CACHE_TTL_MS || 30000));
const runtimeCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveOperationalErrorBurstCount(ops = null) {
  const row = ops && typeof ops === "object" ? ops : {};
  const active = toNum(row.active_error_count);
  const total = toNum(row.error_count);
  return Number.isFinite(active) ? active : total;
}

function resolveExecutionQualityLatencyMs(summary = null) {
  const row = summary && typeof summary === "object" ? summary : {};
  return toNum(row.guard_created_to_fill_p95_ms ?? row.created_to_fill_p95_ms);
}

function parseDateMs(value) {
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

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.summary && typeof doc.summary === "object") return doc.summary;
  if (doc.state && typeof doc.state === "object") return doc.state;
  return doc;
}

function normalizeLoadedSystemAnomalyState(state = null, nowMs = Date.now()) {
  const raw = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null;
  if (!raw) return null;
  const maxAgeMs = Math.max(60 * 1000, Number(raw.max_age_ms || process.env.SYSTEM_ANOMALY_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const generatedAtMs = parseDateMs(raw.generated_at_ms || raw.generated_at || null);
  raw.generated_at_ms = generatedAtMs;
  raw.max_age_ms = maxAgeMs;
  raw.stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > maxAgeMs) : true;
  if (raw.stale) {
    raw.status = "BLOCK";
    raw.reason = "SYSTEM_ANOMALY_STATE_STALE";
    raw.circuit_breaker_open = true;
  }
  return raw;
}

function buildSystemAnomalyState({
  exchange = null,
  systemSlo = null,
  operationalGuard = null,
  mlServing = null,
  executionQuality = null,
  nativeTrailProtection = null,
  nowMs = Date.now(),
} = {}) {
  const slo = systemSlo && typeof systemSlo === "object" ? systemSlo : {};
  const ops = operationalGuard && typeof operationalGuard === "object" ? operationalGuard : {};
  const serving = mlServing && typeof mlServing === "object" ? mlServing : {};
  const quality = readSummary(executionQuality);
  const nativeProtection = nativeTrailProtection && typeof nativeTrailProtection === "object" ? nativeTrailProtection : {};
  const issues = [];

  if (slo.block_new_entries === true) {
    if (upper(slo.status) === "BLOCK") issues.push("ANOMALY_SYSTEM_SLO_BLOCK");
    else issues.push("ANOMALY_SYSTEM_SLO_HOLD");
  }
  if (ops.block_new_entries === true) {
    if (upper(ops.reason) === "OPS_GUARD_STOP" || upper(ops.reason) === "OPS_GUARD_BLOCK" || upper(ops.status) === "중단".toUpperCase() || upper(ops.status) === "BLOCK") issues.push("ANOMALY_OPS_GUARD_BLOCK");
    else issues.push("ANOMALY_OPS_GUARD_HOLD");
  }
  if (serving.block_new_entries === true) issues.push("ANOMALY_ML_SERVING_BLOCK");
  if (toNum(ops.audit_issue_count) > 0) issues.push("ANOMALY_AUDIT_ISSUE_PRESENT");
  if (toNum(ops.qty_pct_non_positive_count) > 0) issues.push("ANOMALY_QTY_PCT_NON_POSITIVE");
  if (resolveOperationalErrorBurstCount(ops) >= 3) issues.push("ANOMALY_RUNTIME_ERROR_BURST");
  if (toNum(quality.partial_fill_rate_pct) >= 80) issues.push("ANOMALY_PARTIAL_FILL_BURST");
  if (resolveExecutionQualityLatencyMs(quality) >= 3000) issues.push("ANOMALY_LATENCY_P95_HIGH");
  if (toNum(nativeProtection.gap_count) > 0) issues.push("ANOMALY_NATIVE_TRAIL_PROTECTION_GAP");

  const hard = issues.some((code) => code.endsWith("_BLOCK") || code.includes("AUDIT_ISSUE") || code.includes("QTY_PCT") || code === "ANOMALY_NATIVE_TRAIL_PROTECTION_GAP");
  const autoRemediationEnabled = !["0", "false", "off", "no"].includes(String(process.env.SYSTEM_ANOMALY_AUTO_REMEDIATION_ENABLED || "true").trim().toLowerCase());
  const rollbackTriggered = autoRemediationEnabled && (
    serving.block_new_entries === true
    || issues.includes("ANOMALY_AUDIT_ISSUE_PRESENT")
    || issues.includes("ANOMALY_QTY_PCT_NON_POSITIVE")
  );
  return {
    exchange: upper(exchange),
    status: hard ? "BLOCK" : (issues.length ? "WARN" : "CLEAR"),
    reason: issues[0] || "SYSTEM_ANOMALY_CLEAR",
    circuit_breaker_open: hard,
    guard_action: hard ? "BLOCK_NEW_ENTRIES" : (issues.length ? "WARN_ONLY" : "ALLOW"),
    rollback_action: rollbackTriggered ? "REQUEST_ML_ROLLBACK" : "NONE",
    remediation_action: rollbackTriggered
      ? "ROLLBACK_ML_AND_BLOCK_ENTRIES"
      : (hard ? "BLOCK_ENTRIES" : (issues.length ? "MONITOR" : "NONE")),
    auto_remediation_enabled: autoRemediationEnabled,
    issues,
    stale: false,
    generated_at_ms: nowMs,
    max_age_ms: Math.max(60 * 1000, Number(process.env.SYSTEM_ANOMALY_MAX_AGE_MS || (6 * 60 * 60 * 1000))),
    components: {
      system_slo_status: upper(slo.status),
      operational_guard_status: upper(ops.status),
      ml_serving_status: upper(serving.status),
      execution_quality_status: upper(quality.status),
      execution_quality_latency_p95_ms: resolveExecutionQualityLatencyMs(quality),
      execution_quality_partial_fill_rate_pct: toNum(quality.partial_fill_rate_pct),
      operational_audit_issue_count: toNum(ops.audit_issue_count),
      operational_qty_pct_non_positive_count: toNum(ops.qty_pct_non_positive_count),
      operational_active_error_count: toNum(ops.active_error_count),
      operational_error_count: toNum(ops.error_count),
      native_trail_protection_gap_count: toNum(nativeProtection.gap_count),
    },
  };
}

async function loadSystemAnomalyRuntime({
  exchange = null,
  systemSlo = null,
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
  const stateDoc = await getSystemAnomalyState({ exchange: ex }).catch(() => null);
  if (stateDoc && stateDoc.state && typeof stateDoc.state === "object") {
    const value = normalizeLoadedSystemAnomalyState(stateDoc.state, nowMs);
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return JSON.parse(JSON.stringify(value));
  }

  const [resolvedOps, resolvedServing, resolvedSlo] = await Promise.all([
    operationalGuard && typeof operationalGuard === "object" ? operationalGuard : loadOperationalGuardRuntime({ exchange: ex }).catch(() => null),
    mlServing && typeof mlServing === "object" ? mlServing : loadMlServingRuntime({ exchange: ex }).catch(() => null),
    systemSlo && typeof systemSlo === "object" ? systemSlo : loadSystemSloRuntime({ exchange: ex, operationalGuard, mlServing }).catch(() => null),
  ]);
  const value = buildSystemAnomalyState({
    exchange: ex,
    systemSlo: resolvedSlo,
    operationalGuard: resolvedOps,
    mlServing: resolvedServing,
    executionQuality: safeReadJson(EXECUTION_QUALITY_PATH),
    nowMs,
  });
  runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  buildSystemAnomalyState,
  loadSystemAnomalyRuntime,
  __test: {
    normalizeLoadedSystemAnomalyState,
    resolveExecutionQualityLatencyMs,
    resolveOperationalErrorBurstCount,
  },
};
