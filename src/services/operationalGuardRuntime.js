"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const LATEST_PATH = path.join(OPS_DAILY_DIR, "system_ops_check_latest.json");
const CACHE_TTL_MS = Math.max(5000, Number(process.env.OPERATIONAL_GUARD_CACHE_TTL_MS || 30000));
const runtimeCache = new Map();

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

function buildOperationalGuardState({
  summary = null,
  nowMs = Date.now(),
  failClosed = null,
  maxAgeMs = null,
} = {}) {
  const doc = summary && typeof summary === "object" ? summary : {};
  const resolvedFailClosed = failClosed == null
    ? (String(process.env.OPERATIONAL_GUARD_FAIL_CLOSED || "1").trim() !== "0")
    : (failClosed === true);
  const resolvedMaxAgeMs = Math.max(5 * 60 * 1000, Number(maxAgeMs || process.env.OPERATIONAL_GUARD_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
  const generatedAtMs = toTimeMs(doc.generated_at_iso || doc.generated_at_kst || null);
  const stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > resolvedMaxAgeMs) : true;
  const status = String(doc.status || "").trim();
  const mode = String(doc.mode || "").trim();
  const executionHealth = doc.execution_health && typeof doc.execution_health === "object"
    ? doc.execution_health
    : {};

  let blockNewEntries = false;
  let reason = null;
  if (stale) {
    blockNewEntries = resolvedFailClosed;
    reason = "OPS_GUARD_STALE";
  } else if (status === "중단") {
    blockNewEntries = true;
    reason = "OPS_GUARD_STOP";
  } else if (status === "보류") {
    blockNewEntries = true;
    reason = "OPS_GUARD_HOLD";
  } else if (!status) {
    blockNewEntries = resolvedFailClosed;
    reason = "OPS_GUARD_MISSING";
  }

  return {
    available: !!summary,
    status: status || null,
    mode: mode || null,
    reason,
    block_new_entries: blockNewEntries,
    fail_closed: resolvedFailClosed,
    stale,
    generated_at_ms: generatedAtMs,
    max_age_ms: resolvedMaxAgeMs,
    error_count: toNum(doc.error_count),
    cost_ratio_pct: toNum(doc.cost_ratio_pct),
    cost_limit_pct: toNum(doc.cost_limit_pct),
    net_pnl_pct: toNum(doc.net_pnl_pct),
    execution_health_available: executionHealth.available === true,
    drop_tp1_pending_count: toNum(executionHealth.drop_tp1_pending_count),
    qty_pct_non_positive_count: toNum(executionHealth.qty_pct_non_positive_count),
    audit_issue_count: toNum(executionHealth.audit_issue_count),
    duplicate_signal_fill_count: toNum(executionHealth.duplicate_signal_fill_count),
  };
}

async function loadOperationalGuardRuntime({
  exchange = null,
  force = false,
} = {}) {
  const cacheKey = String(exchange || "ALL").trim().toUpperCase() || "ALL";
  const nowMs = Date.now();
  if (!force) {
    const cached = runtimeCache.get(cacheKey);
    if (cached && (nowMs - cached.ts_ms) <= CACHE_TTL_MS) {
      return JSON.parse(JSON.stringify(cached.value));
    }
  }
  const summary = safeReadJson(LATEST_PATH);
  const value = buildOperationalGuardState({ summary, nowMs });
  runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  buildOperationalGuardState,
  loadOperationalGuardRuntime,
};
