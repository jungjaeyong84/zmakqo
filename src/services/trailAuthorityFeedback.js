"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");
const {
  getTrailAuthorityFeedbackState,
  recordTrailAuthorityFeedbackState,
} = require("../storage/trailAuthorityFeedbackStates");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const LOCAL_LATEST_PATH = path.join(OPS_DAILY_DIR, "trail_authority_feedback_latest.json");
const LOCAL_LATEST_MD_PATH = path.join(OPS_DAILY_DIR, "trail_authority_feedback_latest.md");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const CACHE_TTL_MS = Math.max(5000, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_RUNTIME_CACHE_TTL_MS || 30000));
const DEFAULT_LOOKBACK_HOURS = Math.max(1, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_LOOKBACK_HOURS || 24));
const DEFAULT_FETCH_LIMIT = Math.max(100, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_FETCH_LIMIT || 3000));
const DEFAULT_MAX_AGE_MS = Math.max(60 * 1000, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_MAX_AGE_MS || (6 * 60 * 60 * 1000)));
const FALSE_POSITIVE_WINDOW_MS = Math.max(60 * 1000, Number(process.env.TRAIL_AUTHORITY_FALSE_POSITIVE_WINDOW_MS || (15 * 60 * 1000)));
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

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readSummary(doc = null) {
  if (!doc || typeof doc !== "object") return {};
  if (doc.summary && typeof doc.summary === "object") return doc.summary;
  if (doc.state && typeof doc.state === "object") return doc.state;
  return doc;
}

function pickEventReason(row = null) {
  return upper(
    row
    && row.payload
    && (row.payload.reason || row.payload.status || row.payload.remediation_action || row.event)
  ) || upper(row && row.event) || "UNKNOWN";
}

function groupTrailSessions(events = []) {
  const sessions = new Map();
  const falsePositiveCandidates = [];
  const blockedRecent = [];
  const latencies = [];
  const counts = {
    blocked_n: 0,
    enqueued_n: 0,
    completed_n: 0,
    watermark_updated_n: 0,
    authority_status_n: 0,
  };
  const blockedByReason = new Map();
  const completedByReason = new Map();

  for (const row of Array.isArray(events) ? events : []) {
    const event = upper(row && row.event);
    const symbol = upper(row && row.symbol);
    const tsMs = toNum(row && row.ts_ms) || parseDateMs(row && row.created_at) || Date.now();
    const key = [
      symbol || "UNKNOWN",
      String(row && row.run_id || "").trim() || String(row && row.trace_id || "").trim() || String(row && row.request_id || "").trim() || "NOCTX",
    ].join("|");
    const reason = pickEventReason(row);
    if (event === "TRAIL_TRIGGER_BLOCKED") {
      counts.blocked_n += 1;
      blockedByReason.set(reason, (blockedByReason.get(reason) || 0) + 1);
      blockedRecent.push({
        symbol,
        ts_ms: tsMs,
        reason,
        status: upper(row && row.payload && row.payload.status),
        issues: Array.isArray(row && row.payload && row.payload.issues) ? row.payload.issues.slice(0, 10) : [],
      });
      sessions.set(key, {
        symbol,
        blocked_at_ms: tsMs,
        blocked_reason: reason,
        row,
      });
      continue;
    }
    if (event === "TRAIL_TRIGGER_ENQUEUED") {
      counts.enqueued_n += 1;
      const prev = sessions.get(key) || { symbol };
      sessions.set(key, {
        ...prev,
        symbol,
        enqueued_at_ms: tsMs,
        enqueued_reason: reason,
      });
      continue;
    }
    if (event === "TRAIL_TRIGGER_COMPLETED") {
      counts.completed_n += 1;
      completedByReason.set(reason, (completedByReason.get(reason) || 0) + 1);
      const prev = sessions.get(key) || { symbol };
      if (Number.isFinite(prev.enqueued_at_ms) && tsMs >= prev.enqueued_at_ms) {
        latencies.push(tsMs - prev.enqueued_at_ms);
      }
      if (
        Number.isFinite(prev.blocked_at_ms)
        && tsMs >= prev.blocked_at_ms
        && (tsMs - prev.blocked_at_ms) <= FALSE_POSITIVE_WINDOW_MS
      ) {
        falsePositiveCandidates.push({
          symbol,
          blocked_at_ms: prev.blocked_at_ms,
          completed_at_ms: tsMs,
          delta_ms: tsMs - prev.blocked_at_ms,
          blocked_reason: prev.blocked_reason || null,
          completed_reason: reason,
        });
      }
      sessions.set(key, {
        ...prev,
        symbol,
        completed_at_ms: tsMs,
        completed_reason: reason,
      });
      continue;
    }
    if (event === "TRAIL_WATERMARK_UPDATED") {
      counts.watermark_updated_n += 1;
      continue;
    }
    if (event === "TRAIL_AUTHORITY_STATUS") {
      counts.authority_status_n += 1;
    }
  }

  return {
    counts,
    blocked_by_reason: Array.from(blockedByReason.entries()).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key))),
    completed_by_reason: Array.from(completedByReason.entries()).map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key))),
    blocked_recent: blockedRecent.sort((a, b) => (b.ts_ms - a.ts_ms)).slice(0, 10),
    false_positive_candidates: falsePositiveCandidates.sort((a, b) => (a.delta_ms - b.delta_ms)).slice(0, 10),
    completion_latencies_ms: latencies.sort((a, b) => a - b),
  };
}

function percentile(values = [], p = 0.95) {
  const arr = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * p)));
  return arr[idx];
}

function buildTrailAuthorityFeedbackState({
  exchange = null,
  events = [],
  executionQuality = null,
  nowMs = Date.now(),
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
} = {}) {
  const ex = upper(exchange);
  const grouped = groupTrailSessions(events);
  const counts = grouped.counts;
  const totalDecisionN = counts.blocked_n + counts.enqueued_n;
  const blockedRatePct = totalDecisionN > 0 ? (counts.blocked_n / totalDecisionN) * 100 : 0;
  const completionP95Ms = percentile(grouped.completion_latencies_ms, 0.95);
  const quality = readSummary(executionQuality);
  const slippageP95Bps = toNum(quality.adverse_slippage_p95_bps);
  const partialFillRatePct = toNum(quality.partial_fill_rate_pct);
  const latencyP95Ms = toNum(quality.guard_created_to_fill_p95_ms ?? quality.created_to_fill_p95_ms);

  let regime = "NORMAL";
  let nearPctMultiplierBias = 1;
  let nearPctMultiplierMin = 1;
  let forceFastLaneOnWarn = false;
  const falsePositiveCandidateN = grouped.false_positive_candidates.length;

  if (
    (Number.isFinite(slippageP95Bps) && slippageP95Bps >= 80)
    || (Number.isFinite(partialFillRatePct) && partialFillRatePct >= 60)
    || (Number.isFinite(blockedRatePct) && blockedRatePct >= 15)
    || (Number.isFinite(completionP95Ms) && completionP95Ms >= 60 * 1000)
  ) {
    regime = "DEGRADED";
    nearPctMultiplierBias = 1.15;
    nearPctMultiplierMin = 1.2;
    forceFastLaneOnWarn = true;
  }
  if (
    (Number.isFinite(slippageP95Bps) && slippageP95Bps >= 120)
    || (Number.isFinite(partialFillRatePct) && partialFillRatePct >= 80)
    || (Number.isFinite(blockedRatePct) && blockedRatePct >= 35)
    || (Number.isFinite(completionP95Ms) && completionP95Ms >= 3 * 60 * 1000)
  ) {
    regime = "SEVERE";
    nearPctMultiplierBias = 1.35;
    nearPctMultiplierMin = 1.5;
    forceFastLaneOnWarn = true;
  }

  let status = "PASS";
  let reason = "TRAIL_AUTHORITY_FEEDBACK_STABLE";
  if (falsePositiveCandidateN > 0) {
    status = "REVIEW";
    reason = "TRAIL_AUTHORITY_FALSE_POSITIVE_REVIEW_REQUIRED";
  } else if (regime === "SEVERE") {
    status = "WARN";
    reason = "TRAIL_AUTHORITY_EXECUTION_REGIME_SEVERE";
  } else if (regime === "DEGRADED") {
    status = "WARN";
    reason = "TRAIL_AUTHORITY_EXECUTION_REGIME_DEGRADED";
  }

  return {
    exchange: ex,
    status,
    reason,
    generated_at_ms: nowMs,
    generated_at: new Date(nowMs).toISOString(),
    lookback_hours: lookbackHours,
    summary: {
      trail_runtime_rows_n: Array.isArray(events) ? events.length : 0,
      blocked_n: counts.blocked_n,
      enqueued_n: counts.enqueued_n,
      completed_n: counts.completed_n,
      blocked_rate_pct: blockedRatePct,
      completion_p95_ms: completionP95Ms,
      false_positive_candidate_n: falsePositiveCandidateN,
      blocked_by_reason: grouped.blocked_by_reason,
      completed_by_reason: grouped.completed_by_reason,
      execution_quality_slippage_p95_bps: slippageP95Bps,
      execution_quality_partial_fill_rate_pct: partialFillRatePct,
      execution_quality_latency_p95_ms: latencyP95Ms,
    },
    tuning: {
      regime,
      near_pct_multiplier_bias: nearPctMultiplierBias,
      near_pct_multiplier_min: nearPctMultiplierMin,
      force_fast_lane_on_warn: forceFastLaneOnWarn,
      synthetic_block_review_required: falsePositiveCandidateN > 0,
      false_positive_window_ms: FALSE_POSITIVE_WINDOW_MS,
    },
    samples: {
      blocked_recent: grouped.blocked_recent,
      false_positive_candidates: grouped.false_positive_candidates,
    },
  };
}

function renderTrailAuthorityFeedbackMarkdown(payload = null) {
  const row = payload && typeof payload === "object" ? payload : {};
  const state = row.state && typeof row.state === "object" ? row.state : {};
  const summary = state.summary && typeof state.summary === "object" ? state.summary : {};
  const tuning = state.tuning && typeof state.tuning === "object" ? state.tuning : {};
  const samples = state.samples && typeof state.samples === "object" ? state.samples : {};
  const lines = [];
  lines.push("# Trail Authority Feedback");
  lines.push("");
  lines.push(`- generated_at_kst: ${row.generated_at_kst || "N/A"}`);
  lines.push(`- exchange: ${state.exchange || row.exchange || "N/A"}`);
  lines.push(`- status: ${state.status || "N/A"} / reason: ${state.reason || "N/A"}`);
  lines.push(`- regime: ${tuning.regime || "N/A"} / near_bias: ${tuning.near_pct_multiplier_bias != null ? tuning.near_pct_multiplier_bias : "N/A"} / near_min: ${tuning.near_pct_multiplier_min != null ? tuning.near_pct_multiplier_min : "N/A"}`);
  lines.push(`- force_fast_lane_on_warn: ${tuning.force_fast_lane_on_warn === true ? "YES" : "NO"} / synthetic_block_review_required: ${tuning.synthetic_block_review_required === true ? "YES" : "NO"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- trail_runtime_rows_n: ${summary.trail_runtime_rows_n != null ? summary.trail_runtime_rows_n : "N/A"}`);
  lines.push(`- blocked_n: ${summary.blocked_n != null ? summary.blocked_n : "N/A"} / enqueued_n: ${summary.enqueued_n != null ? summary.enqueued_n : "N/A"} / completed_n: ${summary.completed_n != null ? summary.completed_n : "N/A"}`);
  lines.push(`- blocked_rate_pct: ${summary.blocked_rate_pct != null ? summary.blocked_rate_pct.toFixed(2) : "N/A"}`);
  lines.push(`- completion_p95_ms: ${summary.completion_p95_ms != null ? summary.completion_p95_ms : "N/A"}`);
  lines.push(`- false_positive_candidate_n: ${summary.false_positive_candidate_n != null ? summary.false_positive_candidate_n : "N/A"}`);
  lines.push(`- execution_quality_latency_p95_ms: ${summary.execution_quality_latency_p95_ms != null ? summary.execution_quality_latency_p95_ms : "N/A"}`);
  lines.push(`- execution_quality_slippage_p95_bps: ${summary.execution_quality_slippage_p95_bps != null ? summary.execution_quality_slippage_p95_bps : "N/A"}`);
  lines.push(`- execution_quality_partial_fill_rate_pct: ${summary.execution_quality_partial_fill_rate_pct != null ? summary.execution_quality_partial_fill_rate_pct : "N/A"}`);
  lines.push("");
  lines.push("## Top Reasons");
  lines.push("");
  const blockedReasons = Array.isArray(summary.blocked_by_reason) ? summary.blocked_by_reason : [];
  if (blockedReasons.length === 0) {
    lines.push("- blocked_by_reason: none");
  } else {
    for (const item of blockedReasons.slice(0, 5)) {
      lines.push(`- blocked: ${item.key || "UNKNOWN"} / n=${item.n != null ? item.n : 0}`);
    }
  }
  const completedReasons = Array.isArray(summary.completed_by_reason) ? summary.completed_by_reason : [];
  if (completedReasons.length === 0) {
    lines.push("- completed_by_reason: none");
  } else {
    for (const item of completedReasons.slice(0, 5)) {
      lines.push(`- completed: ${item.key || "UNKNOWN"} / n=${item.n != null ? item.n : 0}`);
    }
  }
  lines.push("");
  lines.push("## Samples");
  lines.push("");
  const blockedRecent = Array.isArray(samples.blocked_recent) ? samples.blocked_recent : [];
  if (blockedRecent.length === 0) {
    lines.push("- blocked_recent: none");
  } else {
    for (const item of blockedRecent.slice(0, 5)) {
      lines.push(`- blocked_recent: ${item.symbol || "UNKNOWN"} / reason=${item.reason || "UNKNOWN"} / ts_ms=${item.ts_ms != null ? item.ts_ms : "N/A"}`);
    }
  }
  const fp = Array.isArray(samples.false_positive_candidates) ? samples.false_positive_candidates : [];
  if (fp.length === 0) {
    lines.push("- false_positive_candidates: none");
  } else {
    for (const item of fp.slice(0, 5)) {
      lines.push(`- false_positive_candidate: ${item.symbol || "UNKNOWN"} / blocked=${item.blocked_reason || "UNKNOWN"} / completed=${item.completed_reason || "UNKNOWN"} / delta_ms=${item.delta_ms != null ? item.delta_ms : "N/A"}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function fetchRecentTrailRuntimeEvents({
  exchange = null,
  sinceMs = null,
  limit = DEFAULT_FETCH_LIMIT,
} = {}) {
  const db = getFirestore();
  const ex = upper(exchange);
  const resolvedSinceMs = Number.isFinite(Number(sinceMs))
    ? Number(sinceMs)
    : (Date.now() - (DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000));
  const snap = await db.collection("unified_event_timeline")
    .where("ts_ms", ">=", resolvedSinceMs)
    .orderBy("ts_ms", "desc")
    .limit(Math.max(100, Math.trunc(Number(limit) || DEFAULT_FETCH_LIMIT)))
    .get();
  return snap.docs
    .map((doc) => doc.data() || {})
    .filter((row) => upper(row.exchange) === ex && upper(row.event_kind) === "TRAIL_RUNTIME")
    .sort((a, b) => (Number(a.ts_ms || 0) - Number(b.ts_ms || 0)));
}

async function runTrailAuthorityFeedbackJob({
  exchange = "BINANCEFUT",
  lookbackHours = DEFAULT_LOOKBACK_HOURS,
  fetchLimit = DEFAULT_FETCH_LIMIT,
  nowMs = Date.now(),
} = {}) {
  const ex = upper(exchange);
  const sinceMs = nowMs - (Math.max(1, Number(lookbackHours || DEFAULT_LOOKBACK_HOURS)) * 60 * 60 * 1000);
  const events = await fetchRecentTrailRuntimeEvents({
    exchange: ex,
    sinceMs,
    limit: fetchLimit,
  }).catch(() => []);
  const executionQuality = safeReadJson(EXECUTION_QUALITY_PATH);
  const state = buildTrailAuthorityFeedbackState({
    exchange: ex,
    events,
    executionQuality,
    nowMs,
    lookbackHours,
  });
  const payload = {
    ok: true,
    generated_at_kst: new Date(nowMs).toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", " ") + " KST",
    exchange: ex,
    state,
  };
  ensureDir(path.dirname(LOCAL_LATEST_PATH));
  fs.writeFileSync(LOCAL_LATEST_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(LOCAL_LATEST_MD_PATH, renderTrailAuthorityFeedbackMarkdown(payload), "utf8");
  await recordTrailAuthorityFeedbackState({
    exchange: ex,
    generatedAt: state.generated_at,
    state,
    source: "RUN_TRAIL_AUTHORITY_FEEDBACK",
    artifacts: {
      latest_json: LOCAL_LATEST_PATH,
      latest_md: LOCAL_LATEST_MD_PATH,
      lookback_hours: lookbackHours,
      fetched_rows_n: events.length,
    },
  }).catch(() => null);
  runtimeCache.set(ex || "ALL", { ts_ms: nowMs, value: state });
  return payload;
}

function normalizeLoadedFeedbackState(state = null, nowMs = Date.now()) {
  const raw = state && typeof state === "object" ? JSON.parse(JSON.stringify(state)) : null;
  if (!raw) return null;
  const generatedAtMs = parseDateMs(raw.generated_at_ms || raw.generated_at || null);
  raw.generated_at_ms = generatedAtMs;
  raw.max_age_ms = Math.max(60 * 1000, Number(raw.max_age_ms || DEFAULT_MAX_AGE_MS));
  raw.stale = Number.isFinite(generatedAtMs) ? (Math.max(0, nowMs - generatedAtMs) > raw.max_age_ms) : true;
  return raw;
}

async function loadTrailAuthorityFeedbackRuntime({
  exchange = null,
  force = false,
} = {}) {
  const ex = upper(exchange);
  const cacheKey = ex || "ALL";
  const nowMs = Date.now();
  if (!force) {
    const cached = runtimeCache.get(cacheKey);
    if (cached && (nowMs - cached.ts_ms) <= CACHE_TTL_MS) return safeClone(cached.value);
  }
  const stateDoc = await getTrailAuthorityFeedbackState({ exchange: ex }).catch(() => null);
  if (stateDoc && stateDoc.state && typeof stateDoc.state === "object") {
    const value = normalizeLoadedFeedbackState(stateDoc.state, nowMs);
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value });
    return safeClone(value);
  }
  const local = safeReadJson(LOCAL_LATEST_PATH);
  const localState = normalizeLoadedFeedbackState(local && local.state, nowMs);
  if (localState) {
    runtimeCache.set(cacheKey, { ts_ms: nowMs, value: localState });
    return safeClone(localState);
  }
  const fallback = buildTrailAuthorityFeedbackState({
    exchange: ex,
    events: [],
    executionQuality: safeReadJson(EXECUTION_QUALITY_PATH),
    nowMs,
    lookbackHours: DEFAULT_LOOKBACK_HOURS,
  });
  runtimeCache.set(cacheKey, { ts_ms: nowMs, value: fallback });
  return safeClone(fallback);
}

module.exports = {
  buildTrailAuthorityFeedbackState,
  fetchRecentTrailRuntimeEvents,
  runTrailAuthorityFeedbackJob,
  loadTrailAuthorityFeedbackRuntime,
  renderTrailAuthorityFeedbackMarkdown,
  __test: {
    groupTrailSessions,
    normalizeLoadedFeedbackState,
    percentile,
  },
};
