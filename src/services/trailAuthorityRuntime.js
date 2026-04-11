"use strict";

const fs = require("fs");
const path = require("path");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadSystemSloRuntime } = require("./systemSloRuntime");
const { loadSystemAnomalyRuntime } = require("./systemAnomalyRuntime");
const { loadTrailAuthorityFeedbackRuntime } = require("./trailAuthorityFeedback");
const { recordTrailAuthorityState } = require("../storage/trailAuthorityStates");
const { recordUnifiedEvent } = require("../storage/unifiedEventTimeline");
const { resolvePositionSideFromPosition } = require("../utils/positionSide");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const EXECUTION_QUALITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");

const TRAIL_AUTHORITY_RECORD_TTL_MS = Math.max(5000, Number(process.env.TRAIL_AUTHORITY_RECORD_TTL_MS || 60000));
const TRAIL_WARN_LATENCY_P95_MS = Math.max(1000, Number(process.env.TRAIL_AUTHORITY_WARN_LATENCY_P95_MS || 3000));
const TRAIL_BLOCK_LATENCY_P95_MS = Math.max(TRAIL_WARN_LATENCY_P95_MS, Number(process.env.TRAIL_AUTHORITY_BLOCK_LATENCY_P95_MS || 12000));
const TRAIL_WARN_SLIPPAGE_P95_BPS = Math.max(1, Number(process.env.TRAIL_AUTHORITY_WARN_SLIPPAGE_P95_BPS || 70));
const TRAIL_BLOCK_SLIPPAGE_P95_BPS = Math.max(TRAIL_WARN_SLIPPAGE_P95_BPS, Number(process.env.TRAIL_AUTHORITY_BLOCK_SLIPPAGE_P95_BPS || 120));
const TRAIL_WARN_PARTIAL_FILL_RATE_PCT = Math.max(1, Number(process.env.TRAIL_AUTHORITY_WARN_PARTIAL_FILL_RATE_PCT || 60));
const TRAIL_BLOCK_PARTIAL_FILL_RATE_PCT = Math.max(TRAIL_WARN_PARTIAL_FILL_RATE_PCT, Number(process.env.TRAIL_AUTHORITY_BLOCK_PARTIAL_FILL_RATE_PCT || 85));
const TRAIL_ACCELERATE_SAME_SIDE_AFTER = Math.max(2, Math.floor(Number(process.env.TRAIL_AUTHORITY_ACCELERATE_SAME_SIDE_AFTER || 3)));
const TRAIL_ACCELERATE_CORRELATED_AFTER = Math.max(2, Math.floor(Number(process.env.TRAIL_AUTHORITY_ACCELERATE_CORRELATED_AFTER || 2)));
const TRAIL_ACCELERATE_SAME_SIDE_EXPOSURE = Math.max(0.1, Number(process.env.TRAIL_AUTHORITY_ACCELERATE_SAME_SIDE_EXPOSURE || 2));
const TRAIL_ACCELERATE_CORRELATED_EXPOSURE = Math.max(0.1, Number(process.env.TRAIL_AUTHORITY_ACCELERATE_CORRELATED_EXPOSURE || 1.5));
const TRAIL_ACCELERATE_NEAR_MULTIPLIER = Math.max(1, Number(process.env.TRAIL_AUTHORITY_ACCELERATE_NEAR_MULTIPLIER || 1.75));
const TRAIL_SEVERE_NEAR_MULTIPLIER = Math.max(TRAIL_ACCELERATE_NEAR_MULTIPLIER, Number(process.env.TRAIL_AUTHORITY_SEVERE_NEAR_MULTIPLIER || 2.5));
const CORRELATED_MARKETS = new Set(
  String(process.env.TRAIL_AUTHORITY_CORRELATED_MARKETS || "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,DOGEUSDT,AXSUSDT,LINKUSDT")
    .split(",")
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean)
);

const recordCache = new Map();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

function normalizeFeedbackState(state = null) {
  const row = state && typeof state === "object" ? state : {};
  const tuning = row.tuning && typeof row.tuning === "object" ? row.tuning : {};
  const summary = row.summary && typeof row.summary === "object" ? row.summary : {};
  return {
    status: upper(row.status),
    reason: upper(row.reason),
    regime: upper(tuning.regime || row.regime),
    nearPctMultiplierBias: Math.max(1, toNum(tuning.near_pct_multiplier_bias) || 1),
    nearPctMultiplierMin: Math.max(1, toNum(tuning.near_pct_multiplier_min) || 1),
    forceFastLaneOnWarn: tuning.force_fast_lane_on_warn === true,
    syntheticBlockReviewRequired: tuning.synthetic_block_review_required === true,
    blockedRatePct: toNum(summary.blocked_rate_pct),
    falsePositiveCandidateN: toNum(summary.false_positive_candidate_n),
  };
}

function normalizeRuntimeGuard(runtime = null) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const components = row.components && typeof row.components === "object" ? row.components : {};
  return {
    status: upper(row.status),
    reason: upper(row.reason),
    blockNewEntries: row.block_new_entries === true,
    stale: row.stale === true,
    circuitBreakerOpen: row.circuit_breaker_open === true,
    issues: Array.isArray(row.issues) ? row.issues.map((issue) => upper(issue)).filter(Boolean) : [],
    auditIssueCount: toNum(row.audit_issue_count ?? components.operational_audit_issue_count),
    qtyPctNonPositiveCount: toNum(row.qty_pct_non_positive_count ?? components.operational_qty_pct_non_positive_count),
    errorCount: toNum(row.error_count ?? components.operational_error_count),
    latencyP95Ms: toNum(row.execution_quality_latency_p95_ms ?? components.execution_quality_latency_p95_ms),
    slippageP95Bps: toNum(row.execution_quality_slippage_p95_bps ?? components.execution_quality_slippage_p95_bps),
    partialFillRatePct: toNum(row.execution_quality_partial_fill_rate_pct ?? components.execution_quality_partial_fill_rate_pct),
  };
}

function buildExecutionQualitySnapshot(summary = null) {
  const row = summary && typeof summary === "object" ? (summary.summary && typeof summary.summary === "object" ? summary.summary : summary) : {};
  return {
    status: upper(row.status),
    createdToFillP95Ms: toNum(row.created_to_fill_p95_ms),
    guardCreatedToFillP95Ms: toNum(row.guard_created_to_fill_p95_ms ?? row.created_to_fill_p95_ms),
    adverseSlippageP95Bps: toNum(row.adverse_slippage_p95_bps),
    partialFillRatePct: toNum(row.partial_fill_rate_pct),
    generatedAt: row.generated_at || row.generated_at_kst || null,
  };
}

function summarizePortfolioExposure({
  positions = [],
  exchange = null,
  symbol = null,
  desiredSide = null,
} = {}) {
  const ex = upper(exchange);
  const market = upper(symbol);
  const side = upper(desiredSide);
  const active = Array.isArray(positions) ? positions : [];
  const sameSide = [];
  const correlatedSameSide = [];
  let sameSideExposure = 0;
  let correlatedExposure = 0;

  for (const pos of active) {
    const posExchange = upper(pos && pos.exchange);
    const posSymbol = upper(pos && (pos.symbol_or_pair_id || pos.symbol));
    const posSide = upper(resolvePositionSideFromPosition(pos, pos && pos.meta, null));
    const state = upper(pos && (pos.position_state || pos.state));
    const sizePct = toNum(pos && pos.size_pct);
    if (posExchange !== ex || !posSymbol || posSymbol === market) continue;
    if (!Number.isFinite(sizePct) || sizePct <= 0 || state === "FLAT") continue;
    if (!side || !posSide || side !== posSide) continue;
    sameSide.push(posSymbol);
    sameSideExposure += sizePct;
    if (CORRELATED_MARKETS.has(posSymbol) && CORRELATED_MARKETS.has(market)) {
      correlatedSameSide.push(posSymbol);
      correlatedExposure += sizePct;
    }
  }

  return {
    desiredSide: side,
    sameSideMarkets: Array.from(new Set(sameSide)),
    correlatedSameSideMarkets: Array.from(new Set(correlatedSameSide)),
    sameSideCount: Array.from(new Set(sameSide)).length,
    correlatedSameSideCount: Array.from(new Set(correlatedSameSide)).length,
    sameSideExposure,
    correlatedSameSideExposure: correlatedExposure,
  };
}

function buildTrailAuthorityState({
  exchange = null,
  symbol = null,
  position = null,
  operationalGuard = null,
  systemSlo = null,
  systemAnomaly = null,
  executionQuality = null,
  feedbackState = null,
  activePositions = null,
  nowMs = Date.now(),
} = {}) {
  const ex = upper(exchange);
  const market = upper(symbol);
  const resolvedPosition = position && typeof position === "object" ? position : {};
  const desiredSide = upper(resolvePositionSideFromPosition(resolvedPosition, resolvedPosition.meta, null));
  const ops = normalizeRuntimeGuard(operationalGuard);
  const slo = normalizeRuntimeGuard(systemSlo);
  const anomaly = normalizeRuntimeGuard(systemAnomaly);
  const quality = buildExecutionQualitySnapshot(executionQuality);
  const feedback = normalizeFeedbackState(feedbackState);
  const exposure = summarizePortfolioExposure({
    positions: activePositions,
    exchange: ex,
    symbol: market,
    desiredSide,
  });

  const issues = [];
  let status = "CLEAR";
  let reason = "TRAIL_AUTHORITY_OK";
  let blockSyntheticTrail = false;
  let forceFastLane = false;
  let nearPctMultiplier = 1;
  let remediationAction = null;

  if (anomaly.circuitBreakerOpen) {
    issues.push("SYSTEM_ANOMALY_CIRCUIT_BREAKER_OPEN");
    status = "BLOCK";
    reason = anomaly.reason || "SYSTEM_ANOMALY_CIRCUIT_BREAKER_OPEN";
    blockSyntheticTrail = true;
    remediationAction = "SYSTEM_ANOMALY_FLATTEN";
  }

  const latencyP95Ms = quality.createdToFillP95Ms ?? slo.latencyP95Ms;
  const slippageP95Bps = quality.adverseSlippageP95Bps ?? slo.slippageP95Bps;
  const partialFillRatePct = quality.partialFillRatePct ?? slo.partialFillRatePct;

  if (toNum(ops.auditIssueCount) > 0) {
    issues.push("TRAIL_AUTHORITY_AUDIT_ISSUE_PRESENT");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_ACCELERATE_NEAR_MULTIPLIER);
  }
  if (toNum(ops.qtyPctNonPositiveCount) > 0) {
    issues.push("TRAIL_AUTHORITY_QTY_PCT_NON_POSITIVE");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_SEVERE_NEAR_MULTIPLIER);
  }
  if (Number.isFinite(latencyP95Ms) && latencyP95Ms >= TRAIL_BLOCK_LATENCY_P95_MS) {
    issues.push("TRAIL_AUTHORITY_EXECUTION_LATENCY_BLOCK");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_SEVERE_NEAR_MULTIPLIER);
  } else if (Number.isFinite(latencyP95Ms) && latencyP95Ms >= TRAIL_WARN_LATENCY_P95_MS) {
    issues.push("TRAIL_AUTHORITY_EXECUTION_LATENCY_WARN");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_ACCELERATE_NEAR_MULTIPLIER);
  }
  if (Number.isFinite(slippageP95Bps) && slippageP95Bps >= TRAIL_BLOCK_SLIPPAGE_P95_BPS) {
    issues.push("TRAIL_AUTHORITY_EXECUTION_SLIPPAGE_BLOCK");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_SEVERE_NEAR_MULTIPLIER);
  } else if (Number.isFinite(slippageP95Bps) && slippageP95Bps >= TRAIL_WARN_SLIPPAGE_P95_BPS) {
    issues.push("TRAIL_AUTHORITY_EXECUTION_SLIPPAGE_WARN");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_ACCELERATE_NEAR_MULTIPLIER);
  }
  if (Number.isFinite(partialFillRatePct) && partialFillRatePct >= TRAIL_BLOCK_PARTIAL_FILL_RATE_PCT) {
    issues.push("TRAIL_AUTHORITY_PARTIAL_FILL_BLOCK");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_SEVERE_NEAR_MULTIPLIER);
  } else if (Number.isFinite(partialFillRatePct) && partialFillRatePct >= TRAIL_WARN_PARTIAL_FILL_RATE_PCT) {
    issues.push("TRAIL_AUTHORITY_PARTIAL_FILL_WARN");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_ACCELERATE_NEAR_MULTIPLIER);
  }

  if (
    exposure.sameSideCount >= TRAIL_ACCELERATE_SAME_SIDE_AFTER
    || (Number.isFinite(exposure.sameSideExposure) && exposure.sameSideExposure >= TRAIL_ACCELERATE_SAME_SIDE_EXPOSURE)
  ) {
    issues.push("TRAIL_AUTHORITY_PORTFOLIO_SAME_SIDE_ACCELERATE");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_ACCELERATE_NEAR_MULTIPLIER);
  }
  if (
    exposure.correlatedSameSideCount >= TRAIL_ACCELERATE_CORRELATED_AFTER
    || (Number.isFinite(exposure.correlatedSameSideExposure) && exposure.correlatedSameSideExposure >= TRAIL_ACCELERATE_CORRELATED_EXPOSURE)
  ) {
    issues.push("TRAIL_AUTHORITY_PORTFOLIO_CORRELATED_ACCELERATE");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
    nearPctMultiplier = Math.max(nearPctMultiplier, TRAIL_SEVERE_NEAR_MULTIPLIER);
  }

  if (feedback.regime === "SEVERE") {
    issues.push("TRAIL_AUTHORITY_FEEDBACK_REGIME_SEVERE");
    if (status !== "BLOCK") status = "WARN";
    forceFastLane = true;
  } else if (feedback.regime === "DEGRADED") {
    issues.push("TRAIL_AUTHORITY_FEEDBACK_REGIME_DEGRADED");
    if (status !== "BLOCK") status = "WARN";
  }
  if (feedback.syntheticBlockReviewRequired) {
    issues.push("TRAIL_AUTHORITY_FEEDBACK_SYNTHETIC_BLOCK_REVIEW");
    if (status !== "BLOCK") status = "WARN";
  }
  if (status === "WARN" && feedback.forceFastLaneOnWarn) {
    forceFastLane = true;
  }
  nearPctMultiplier = Math.max(nearPctMultiplier, feedback.nearPctMultiplierMin);
  nearPctMultiplier = Math.max(1, nearPctMultiplier * feedback.nearPctMultiplierBias);

  if (status !== "BLOCK" && issues.length > 0) {
    reason = issues[0];
  }

  return {
    exchange: ex,
    symbol: market,
    desired_side: desiredSide,
    status,
    reason,
    issues,
    block_synthetic_trail: blockSyntheticTrail,
    allow_watermark_update: true,
    allow_native_refresh: true,
    force_fast_lane: forceFastLane,
    near_pct_multiplier: nearPctMultiplier,
    remediation_action: remediationAction,
    generated_at_ms: nowMs,
    generated_at: new Date(nowMs).toISOString(),
    components: {
      operational_guard_status: ops.status,
      operational_guard_reason: ops.reason,
      system_slo_status: slo.status,
      system_slo_reason: slo.reason,
      system_anomaly_status: anomaly.status,
      system_anomaly_reason: anomaly.reason,
      system_anomaly_circuit_breaker_open: anomaly.circuitBreakerOpen,
      execution_quality_status: quality.status,
      execution_quality_latency_p95_ms: latencyP95Ms,
      execution_quality_slippage_p95_bps: slippageP95Bps,
      execution_quality_partial_fill_rate_pct: partialFillRatePct,
      feedback_status: feedback.status,
      feedback_reason: feedback.reason,
      feedback_regime: feedback.regime,
      feedback_near_pct_multiplier_bias: feedback.nearPctMultiplierBias,
      feedback_near_pct_multiplier_min: feedback.nearPctMultiplierMin,
      feedback_blocked_rate_pct: feedback.blockedRatePct,
      feedback_false_positive_candidate_n: feedback.falsePositiveCandidateN,
    },
    portfolio: {
      same_side_markets: exposure.sameSideMarkets,
      correlated_same_side_markets: exposure.correlatedSameSideMarkets,
      same_side_count: exposure.sameSideCount,
      correlated_same_side_count: exposure.correlatedSameSideCount,
      same_side_exposure: exposure.sameSideExposure,
      correlated_same_side_exposure: exposure.correlatedSameSideExposure,
    },
  };
}

async function loadTrailAuthorityRuntime({
  exchange = null,
  symbol = null,
  position = null,
  activePositions = null,
  operationalGuard = null,
  systemSlo = null,
  systemAnomaly = null,
  executionQuality = null,
  feedbackState = null,
} = {}) {
  const ex = upper(exchange);
  const [resolvedOps, resolvedSlo, resolvedAnomaly, resolvedFeedback] = await Promise.all([
    operationalGuard && typeof operationalGuard === "object" ? operationalGuard : loadOperationalGuardRuntime({ exchange: ex }).catch(() => null),
    systemSlo && typeof systemSlo === "object" ? systemSlo : loadSystemSloRuntime({ exchange: ex }).catch(() => null),
    systemAnomaly && typeof systemAnomaly === "object" ? systemAnomaly : loadSystemAnomalyRuntime({ exchange: ex }).catch(() => null),
    feedbackState && typeof feedbackState === "object" ? feedbackState : loadTrailAuthorityFeedbackRuntime({ exchange: ex }).catch(() => null),
  ]);

  return buildTrailAuthorityState({
    exchange: ex,
    symbol,
    position,
    activePositions,
    operationalGuard: resolvedOps,
    systemSlo: resolvedSlo,
    systemAnomaly: resolvedAnomaly,
    executionQuality: executionQuality || safeReadJson(EXECUTION_QUALITY_PATH),
    feedbackState: resolvedFeedback,
  });
}

function buildTrailAuthorityRecordKey(exchange, symbol) {
  return `${upper(exchange) || "ALL"}::${upper(symbol) || "ALL"}`;
}

function shouldPublishTrailAuthorityState(state = null, nowMs = Date.now()) {
  const ex = upper(state && state.exchange);
  const market = upper(state && state.symbol);
  if (!ex || !market || !state || typeof state !== "object") return false;
  const key = buildTrailAuthorityRecordKey(ex, market);
  const previous = recordCache.get(key);
  const summary = {
    status: upper(state.status),
    reason: upper(state.reason),
    block_synthetic_trail: state.block_synthetic_trail === true,
    force_fast_lane: state.force_fast_lane === true,
    near_pct_multiplier: toNum(state.near_pct_multiplier),
    issues: Array.isArray(state.issues) ? state.issues.slice() : [],
    same_side_count: toNum(state.portfolio && state.portfolio.same_side_count),
    correlated_same_side_count: toNum(state.portfolio && state.portfolio.correlated_same_side_count),
  };
  if (!previous || (nowMs - previous.at_ms) >= TRAIL_AUTHORITY_RECORD_TTL_MS) {
    recordCache.set(key, { at_ms: nowMs, summary });
    return true;
  }
  const same = JSON.stringify(previous.summary) === JSON.stringify(summary);
  if (!same) {
    recordCache.set(key, { at_ms: nowMs, summary });
    return true;
  }
  return false;
}

async function publishTrailAuthorityState({
  state = null,
  source = "BINANCE_TICK_EXIT",
  runId = null,
  triggerKinds = null,
} = {}) {
  if (!state || typeof state !== "object") return null;
  const nowMs = Number(state.generated_at_ms) || Date.now();
  if (!shouldPublishTrailAuthorityState(state, nowMs)) return null;
  const record = await recordTrailAuthorityState({
    exchange: state.exchange,
    symbol: state.symbol,
    generatedAt: state.generated_at || new Date(nowMs).toISOString(),
    source,
    state,
    artifacts: {
      trigger_kinds: Array.isArray(triggerKinds) ? triggerKinds.slice() : [],
    },
  });
  await recordUnifiedEvent({
    eventKind: "TRAIL_RUNTIME",
    eventSource: "TRAIL_AUTHORITY_STATE",
    exchange: state.exchange,
    symbol: state.symbol,
    event: "TRAIL_AUTHORITY_STATUS",
    runId,
    sourceDocumentId: record.trail_authority_state_id,
    tsMs: nowMs,
    createdAt: state.generated_at || new Date(nowMs).toISOString(),
    payload: {
      status: state.status,
      reason: state.reason,
      issues: safeClone(state.issues),
      block_synthetic_trail: state.block_synthetic_trail === true,
      force_fast_lane: state.force_fast_lane === true,
      near_pct_multiplier: toNum(state.near_pct_multiplier),
      components: safeClone(state.components),
      portfolio: safeClone(state.portfolio),
    },
    raw: record,
  }).catch(() => null);
  return record;
}

async function recordTrailRuntimeEvent({
  exchange = null,
  symbol = null,
  event = null,
  runId = null,
  requestId = null,
  traceId = null,
  tsMs = null,
  payload = null,
  raw = null,
} = {}) {
  const resolvedTsMs = Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now();
  return recordUnifiedEvent({
    eventKind: "TRAIL_RUNTIME",
    eventSource: "BINANCE_TICK_EXIT",
    exchange,
    symbol,
    event,
    runId,
    requestId,
    traceId,
    tsMs: resolvedTsMs,
    createdAt: new Date(resolvedTsMs).toISOString(),
    payload,
    raw,
  });
}

module.exports = {
  buildTrailAuthorityState,
  loadTrailAuthorityRuntime,
  publishTrailAuthorityState,
  recordTrailRuntimeEvent,
  __test: {
    buildExecutionQualitySnapshot,
    summarizePortfolioExposure,
    shouldPublishTrailAuthorityState,
  },
};
