#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider, invalidateSettingsCache } = require("../src/storage/settings");
const { buildTradesFromFillsWithFunding } = require("../src/services/tradesFromFills");
const { toKstString } = require("../src/utils/timeKst");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const { buildEvResolvedLedger } = require("./lib/stage-outcome-ledgers");
const { monthlyRunRateKrw } = require("./lib/objective-policy");
const { pickSettingsSnapshot, writeStageSnapshot } = require("./lib/stage-autopilot");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  isEntryTierEvent,
  resolveEntryTimingTier,
  describeTimingTierForUser,
} = require("../src/utils/liveEntryTaxonomy");

const PROVIDER = String(process.env.EV_TUNE_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.EV_TUNE_TF || "15m").trim();
const TARGET_HIT_RATE = Number(process.env.EV_TUNE_TARGET_TP1_HIT_RATE || 0.60);
const TARGET_MONTHLY_NET_KRW = Math.max(0, Number(
  process.env.EV_TUNE_MIN_MONTHLY_NET_KRW
  || process.env.OBJECTIVE_MIN_MONTHLY_NET_KRW
  || 1_500_000
));
const LOOKBACK_DAYS = Math.max(3, Number(process.env.EV_TUNE_LOOKBACK_DAYS || 9));
const MATURITY_HOURS = Math.max(3, Number(process.env.EV_TUNE_MATURITY_HOURS || 12));
const MIN_SAMPLE = Math.max(6, Number(process.env.EV_TUNE_MIN_SAMPLE || 10));
const THRESHOLD_MIN = Math.max(0, Number(process.env.EV_TUNE_THRESHOLD_MIN || 0.50));
const THRESHOLD_MAX = Math.min(1, Number(process.env.EV_TUNE_THRESHOLD_MAX || 0.85));
const MAX_STEP = Math.max(0.005, Number(process.env.EV_TUNE_MAX_STEP || 0.03));
const SCAN_LIMIT = Math.max(500, Number(process.env.EV_TUNE_SCAN_LIMIT || 6000));
const CURRENT_BAR_MODEL = "TP1_REACH_RECENT_BARS_V1";
const WILSON_Z = 1.2815515655446004;
const FULL_THRESHOLD_MIN = 0.58;
const KILL_THRESHOLD_MIN = 0.45;
const MID_SCALE_CANDIDATES = [0.60, 0.70, 0.80];
const LOW_SCALE_CANDIDATES = [0.25, 0.40, 0.50];
const TIERS = ["EARLY", "CORE"];
const ML_POLICY_MAX_AGE_HOURS = Math.max(6, Number(process.env.EV_TUNE_ML_POLICY_MAX_AGE_HOURS || 18));
const STAGE_LEDGER_MAX_AGE_HOURS = Math.max(6, Number(process.env.EV_TUNE_STAGE_LEDGER_MAX_AGE_HOURS || 18));
const TIER_THRESHOLD_KEYS = {
  EARLY: "ev_gate_tp1_prob_min_early",
  CORE: "ev_gate_tp1_prob_min_core",
};
const EV_SNAPSHOT_KEYS = Object.freeze([
  "ev_gate_enabled",
  "ev_gate_core_enabled",
  "ev_gate_early_enabled",
  "ev_gate_tp1_prob_min",
  "ev_gate_tp1_prob_min_early",
  "ev_gate_tp1_prob_min_core",
  "ev_gate_tp1_prob_full",
  "ev_gate_tp1_prob_kill",
  "ev_gate_qty_scale_mid",
  "ev_gate_qty_scale_low",
  "ev_gate_lookback_bars",
  "ev_gate_atr_bars",
  "ev_gate_default_tp1_pct",
  "ev_gate_default_sl_pct",
  "ev_gate_skip_missing_bars",
]);

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function roundTo(v, digits = 3) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function pct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function describeEvDecisionReasonForUser(reason) {
  const key = String(reason || "").trim().toUpperCase();
  switch (key) {
    case "INSUFFICIENT_SAMPLE":
      return "판단에 필요한 표본이 아직 부족합니다";
    case "TARGET_NUDGE":
      return "목표 hit rate 방향으로 threshold를 소폭 조정합니다";
    case "TARGET_THRESHOLD_SEARCH":
      return "목표와 기대값을 함께 만족하는 threshold 후보를 찾았습니다";
    case "INSUFFICIENT_SAMPLE_ML_HINT":
      return "표본이 부족해 ML 힌트를 참고합니다";
    case "INSUFFICIENT_BAND_SAMPLE":
      return "band 판단에 필요한 표본이 아직 부족합니다";
    case "INSUFFICIENT_BAND_SAMPLE_ML_HINT":
      return "band 표본이 부족해 ML 힌트를 참고합니다";
    case "BAND_OBJECTIVE_SEARCH":
      return "기대값과 월간 목표 기준으로 band 후보를 찾았습니다";
    case "ML_HINT_APPLIED":
      return "ML 힌트를 적용했습니다";
    case "ML_HINT_NOT_APPLIED":
      return "ML 힌트를 적용하지 않았습니다";
    case "ML_HINT_NOT_ELIGIBLE":
      return "ML 힌트를 적용할 조건이 아직 아닙니다";
    default:
      return key || "사유 정보 없음";
  }
}

function buildEntryEventId({ exchange, symbol, tf, signalBarCloseMs, event } = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const tf0 = String(tf || "").trim();
  const ms = Number(signalBarCloseMs);
  const ev = String(event || "").trim().toUpperCase();
  if (!ex || !sym || !tf0 || !Number.isFinite(ms) || !ev) return null;
  return `${ex}|${sym}|${tf0}|${ms}|${ev}|${ev}`;
}

function resolveEntryTier(rowOrEvent) {
  return resolveEntryTimingTier(rowOrEvent);
}

function isTp1Event(eventRaw) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}

function isExitEvent(eventRaw) {
  return String(eventRaw || "").trim().toUpperCase().startsWith("EXIT_");
}

function parseIsoMs(v) {
  const ms = Date.parse(String(v || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveDocMs(doc) {
  return (
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    parseIsoMs(doc && doc.created_at) ??
    parseIsoMs(doc && doc.updated_at)
  );
}

function extractEntryProbability(entry) {
  const features = entry && entry.features_json && typeof entry.features_json === "object" ? entry.features_json : {};
  const lowerBound = toNum(features.ev_gate_tp1_reach_prob_lower_bound);
  const probability = toNum(features.ev_gate_tp1_reach_prob);
  return {
    source: String(features.ev_gate_source || "").trim(),
    lowerBound,
    probability,
  };
}

function classifyEntryOutcome(entry, fillsByEntryEventId, nowMs, maturityMs) {
  const eventId = buildEntryEventId({
    exchange: entry.exchange,
    symbol: entry.symbol_or_pair_id || entry.symbol,
    tf: entry.tf,
    signalBarCloseMs: entry.signal_bar_close_time_utc_ms,
    event: entry.event,
  });
  const signalBarMs = toNum(entry.signal_bar_close_time_utc_ms);
  const fills = eventId ? (fillsByEntryEventId.get(eventId) || []) : [];
  const exitFills = fills.filter((row) => isExitEvent(row.event));
  const tp1Hit = exitFills.some((row) => isTp1Event(row.event));
  if (tp1Hit) return { status: "TP1_HIT", entryEventId: eventId, exitCount: exitFills.length };
  if (exitFills.length > 0) return { status: "NO_TP1_EXITED", entryEventId: eventId, exitCount: exitFills.length };
  if (Number.isFinite(signalBarMs) && (nowMs - signalBarMs) >= maturityMs) {
    return { status: "UNRESOLVED_STALE", entryEventId: eventId, exitCount: 0 };
  }
  return { status: "UNRESOLVED_OPEN", entryEventId: eventId, exitCount: 0 };
}

function wilsonLowerBound(successes, total, z = WILSON_Z) {
  const n = Number(total);
  const s = Number(successes);
  if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(s) || s < 0) return null;
  const phat = s / n;
  const z2 = z * z;
  const denom = 1 + (z2 / n);
  const center = phat + (z2 / (2 * n));
  const margin = z * Math.sqrt((phat * (1 - phat) / n) + (z2 / (4 * n * n)));
  return (center - margin) / denom;
}

function evaluateThreshold(entries, threshold) {
  const cutoff = Number(threshold);
  const scoped = entries.filter((row) => Number(row.predicted) >= cutoff);
  const resolved = scoped.filter((row) => row.outcome === "TP1_HIT" || row.outcome === "NO_TP1_EXITED" || row.outcome === "UNRESOLVED_STALE");
  const n = resolved.length;
  const hits = resolved.filter((row) => row.outcome === "TP1_HIT").length;
  const unresolvedStale = resolved.filter((row) => row.outcome === "UNRESOLVED_STALE").length;
  const retRows = resolved
    .map((row) => toNum(row.realizedRetNet))
    .filter((v) => v != null);
  const pnlRows = resolved
    .map((row) => toNum(row.realizedPnlQuote))
    .filter((v) => v != null);
  const hitRate = n > 0 ? (hits / n) : null;
  const wilsonLower = n > 0 ? wilsonLowerBound(hits, n) : null;
  const avgRetNet = retRows.length ? (retRows.reduce((a, b) => a + b, 0) / retRows.length) : null;
  const netPnlQuote = pnlRows.length ? pnlRows.reduce((a, b) => a + b, 0) : null;
  const monthlyRunRate = monthlyRunRateKrw(netPnlQuote, LOOKBACK_DAYS);
  const negPnlAbs = pnlRows.length
    ? pnlRows.filter((v) => v < 0).reduce((a, b) => a + Math.abs(b), 0)
    : null;
  return {
    threshold: cutoff,
    n,
    hits,
    unresolvedStale,
    hitRate,
    wilsonLower,
    avgRetNet,
    netPnlQuote,
    monthlyRunRateKrw: monthlyRunRate,
    monthlyTargetPass: Number.isFinite(monthlyRunRate) && monthlyRunRate >= TARGET_MONTHLY_NET_KRW,
    negPnlAbs,
  };
}

function compareThresholdPlans(a, b, targetHitRate) {
  const aExp = Number.isFinite(a.avgRetNet) ? a.avgRetNet : -1e18;
  const bExp = Number.isFinite(b.avgRetNet) ? b.avgRetNet : -1e18;
  if (Math.abs(aExp - bExp) > 1e-12) return bExp - aExp;
  const aTarget = Number.isFinite(a.hitRate) && a.hitRate >= targetHitRate ? 1 : 0;
  const bTarget = Number.isFinite(b.hitRate) && b.hitRate >= targetHitRate ? 1 : 0;
  if (aTarget !== bTarget) return bTarget - aTarget;
  const aMonthlyPass = a.monthlyTargetPass ? 1 : 0;
  const bMonthlyPass = b.monthlyTargetPass ? 1 : 0;
  if (aMonthlyPass !== bMonthlyPass) return bMonthlyPass - aMonthlyPass;
  const aMonthly = Number.isFinite(a.monthlyRunRateKrw) ? a.monthlyRunRateKrw : -1e18;
  const bMonthly = Number.isFinite(b.monthlyRunRateKrw) ? b.monthlyRunRateKrw : -1e18;
  if (Math.abs(aMonthly - bMonthly) > 1e-12) return bMonthly - aMonthly;
  const aDd = Number.isFinite(a.negPnlAbs) ? a.negPnlAbs : 1e18;
  const bDd = Number.isFinite(b.negPnlAbs) ? b.negPnlAbs : 1e18;
  if (Math.abs(aDd - bDd) > 1e-12) return aDd - bDd;
  return (b.n || 0) - (a.n || 0);
}

function uniqueSorted(values = []) {
  return Array.from(new Set(
    values
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v))
      .map((v) => roundTo(v, 3))
  )).sort((a, b) => a - b);
}

function resolveBandScale({ predicted, minThreshold, fullThreshold, killThreshold, midScale, lowScale } = {}) {
  const p = Number(predicted);
  if (!Number.isFinite(p)) return 0;
  if (p < killThreshold) return 0;
  if (p < minThreshold) return lowScale;
  if (p < fullThreshold) return midScale;
  return 1;
}

function evaluateSizingBand(entries, config = {}) {
  const minThreshold = clamp(Number(config.minThreshold), THRESHOLD_MIN, THRESHOLD_MAX);
  const fullThreshold = clamp(Math.max(minThreshold, Number(config.fullThreshold)), THRESHOLD_MIN, THRESHOLD_MAX);
  const killThreshold = clamp(Math.min(minThreshold, Number(config.killThreshold)), 0, THRESHOLD_MAX);
  const midScale = clamp(Number(config.midScale), 0, 1);
  const lowScale = clamp(Number(config.lowScale), 0, 1);
  const resolved = Array.isArray(entries) ? entries : [];
  const kept = [];
  let hits = 0;
  let unresolvedStale = 0;
  let netPnlQuote = 0;
  let negPnlAbs = 0;
  let retNetSum = 0;
  let retNetN = 0;
  for (const row of resolved) {
    const scale = resolveBandScale({
      predicted: row.predicted,
      minThreshold,
      fullThreshold,
      killThreshold,
      midScale,
      lowScale,
    });
    if (!(scale > 0)) continue;
    kept.push({ ...row, appliedScale: scale });
    if (row.outcome === "TP1_HIT") hits += 1;
    if (row.outcome === "UNRESOLVED_STALE") unresolvedStale += 1;
    const pnlQuote = toNum(row.realizedPnlQuote);
    if (pnlQuote != null) {
      const scaled = pnlQuote * scale;
      netPnlQuote += scaled;
      if (scaled < 0) negPnlAbs += Math.abs(scaled);
    }
    const retNet = toNum(row.realizedRetNet);
    if (retNet != null) {
      retNetSum += (retNet * scale);
      retNetN += 1;
    }
  }
  const n = kept.length;
  const hitRate = n > 0 ? (hits / n) : null;
  const avgRetNet = retNetN > 0 ? (retNetSum / retNetN) : null;
  const monthlyRunRate = monthlyRunRateKrw(n > 0 ? netPnlQuote : null, LOOKBACK_DAYS);
  return {
    minThreshold,
    fullThreshold,
    killThreshold,
    midScale,
    lowScale,
    n,
    hits,
    unresolvedStale,
    hitRate,
    avgRetNet,
    netPnlQuote: n > 0 ? netPnlQuote : null,
    monthlyRunRateKrw: monthlyRunRate,
    monthlyTargetPass: Number.isFinite(monthlyRunRate) && monthlyRunRate >= TARGET_MONTHLY_NET_KRW,
    negPnlAbs: n > 0 ? negPnlAbs : null,
  };
}

function compareBandPlans(a, b, targetHitRate) {
  const ax = Number.isFinite(a.avgRetNet) ? a.avgRetNet : -1e18;
  const bx = Number.isFinite(b.avgRetNet) ? b.avgRetNet : -1e18;
  if (ax !== bx) return bx - ax;
  const aTarget = Number.isFinite(a.hitRate) && a.hitRate >= targetHitRate ? 1 : 0;
  const bTarget = Number.isFinite(b.hitRate) && b.hitRate >= targetHitRate ? 1 : 0;
  if (aTarget !== bTarget) return bTarget - aTarget;
  const aMonthlyPass = a.monthlyTargetPass ? 1 : 0;
  const bMonthlyPass = b.monthlyTargetPass ? 1 : 0;
  if (aMonthlyPass !== bMonthlyPass) return bMonthlyPass - aMonthlyPass;
  const aMonthly = Number.isFinite(a.monthlyRunRateKrw) ? a.monthlyRunRateKrw : -1e18;
  const bMonthly = Number.isFinite(b.monthlyRunRateKrw) ? b.monthlyRunRateKrw : -1e18;
  if (aMonthly !== bMonthly) return bMonthly - aMonthly;
  const aDd = Number.isFinite(a.negPnlAbs) ? a.negPnlAbs : 1e18;
  const bDd = Number.isFinite(b.negPnlAbs) ? b.negPnlAbs : 1e18;
  if (aDd !== bDd) return aDd - bDd;
  const aNet = Number.isFinite(a.netPnlQuote) ? a.netPnlQuote : -1e18;
  const bNet = Number.isFinite(b.netPnlQuote) ? b.netPnlQuote : -1e18;
  if (aNet !== bNet) return bNet - aNet;
  return (b.n || 0) - (a.n || 0);
}

function readFreshMlPolicyReport(nowMs = Date.now()) {
  const filePath = path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json");
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const ageMs = Math.max(0, Number(nowMs) - Number(stat.mtimeMs || 0));
    if (ageMs > (ML_POLICY_MAX_AGE_HOURS * 60 * 60 * 1000)) {
      return { filePath, stale: true, age_ms: ageMs, data: null };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return { filePath, stale: false, age_ms: ageMs, data };
  } catch (err) {
    return {
      filePath,
      stale: true,
      age_ms: null,
      error: err && err.message ? err.message : String(err),
      data: null,
    };
  }
}

function readFreshEvResolvedLedger(nowMs = Date.now()) {
  const filePath = path.join(OPS_DAILY_DIR, "ev_resolved_ledger_latest.json");
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const ageMs = Math.max(0, Number(nowMs) - Number(stat.mtimeMs || 0));
    if (ageMs > (STAGE_LEDGER_MAX_AGE_HOURS * 60 * 60 * 1000)) {
      return { filePath, stale: true, age_ms: ageMs, data: null };
    }
    const data = readJsonRawSafe(filePath, null);
    if (!data) return { filePath, stale: true, age_ms: ageMs, data: null };
    return { filePath, stale: false, age_ms: ageMs, data };
  } catch (err) {
    return {
      filePath,
      stale: true,
      age_ms: null,
      error: err && err.message ? err.message : String(err),
      data: null,
    };
  }
}

function applyMlEvGuidance({ plan, bandPlan, currentThreshold, currentBand, mlPolicyReport } = {}) {
  const report = mlPolicyReport && mlPolicyReport.data;
  const evRec = report && report.recommendations && report.recommendations.EV;
  const next = evRec && evRec.next && typeof evRec.next === "object" ? evRec.next : null;
  const sampleN = toNum(report && report.model && report.model.sample_n) || 0;
  const barCoverage = toNum(report && report.coverage && report.coverage.bar_context_rate) || 0;
  const validationMode = String(report && report.validation && report.validation.mode || "").trim().toUpperCase();
  const holdoutOk = validationMode === "HOLDOUT" && report && report.metrics && report.metrics.ok === true;
  if (!next || evRec.action !== "REVIEW_UPDATE" || sampleN < 120 || barCoverage < 0.9 || !holdoutOk) {
    return { plan, bandPlan, applied: false, reason: "ML_HINT_NOT_ELIGIBLE" };
  }

  const lowBucketN = toNum(evRec && evRec.buckets && evRec.buckets.low && evRec.buckets.low.n) || 0;
  const midBucketN = toNum(evRec && evRec.buckets && evRec.buckets.mid && evRec.buckets.mid.n) || 0;
  let nextPlan = plan;
  let nextBand = bandPlan;
  const hint = {
    source: "ml_filter_policy_latest.json",
    filePath: mlPolicyReport.filePath,
    age_ms: mlPolicyReport.age_ms,
    sample_n: sampleN,
    low_bucket_n: lowBucketN,
    mid_bucket_n: midBucketN,
    threshold_applied: false,
    band_applied: false,
  };

  const mlThreshold = clamp(toNum(next.ev_gate_tp1_prob_min), THRESHOLD_MIN, THRESHOLD_MAX);
  if (Number.isFinite(mlThreshold) && plan && (plan.reason === "INSUFFICIENT_SAMPLE" || Number(plan.current && plan.current.n) < MIN_SAMPLE)) {
    const appliedThreshold = roundTo(
      clamp(currentThreshold + clamp(mlThreshold - currentThreshold, -MAX_STEP, MAX_STEP), THRESHOLD_MIN, THRESHOLD_MAX),
      3
    );
    const thresholdChanged = Math.abs(appliedThreshold - currentThreshold) >= 0.005;
    nextPlan = {
      ...plan,
      next: appliedThreshold,
      changed: thresholdChanged,
      reason: thresholdChanged ? "INSUFFICIENT_SAMPLE_ML_HINT" : plan.reason,
      ml_hint: {
        recommended_threshold: mlThreshold,
      },
    };
    hint.threshold_applied = thresholdChanged;
  }

  if (bandPlan && bandPlan.reason === "INSUFFICIENT_BAND_SAMPLE") {
    const bandNext = { ...bandPlan.next };
    let bandChanged = false;
    const mlLow = clamp(toNum(next.ev_gate_qty_scale_low), 0, 1);
    const mlMid = clamp(toNum(next.ev_gate_qty_scale_mid), 0, 1);
    if (lowBucketN >= 8 && Number.isFinite(mlLow) && Math.abs(mlLow - Number(currentBand.lowScale)) >= 0.005) {
      bandNext.lowScale = mlLow;
      bandChanged = true;
    }
    if (midBucketN >= 8 && Number.isFinite(mlMid) && Math.abs(mlMid - Number(currentBand.midScale)) >= 0.005) {
      bandNext.midScale = mlMid;
      bandChanged = true;
    }
    if (bandChanged) {
      nextBand = {
        ...bandPlan,
        next: bandNext,
        changed: true,
        reason: "INSUFFICIENT_BAND_SAMPLE_ML_HINT",
        ml_hint: {
          recommended_low_scale: mlLow,
          recommended_mid_scale: mlMid,
        },
      };
      hint.band_applied = true;
    }
  }

  return {
    plan: nextPlan,
    bandPlan: nextBand,
    applied: hint.threshold_applied || hint.band_applied,
    reason: hint.threshold_applied || hint.band_applied ? "ML_HINT_APPLIED" : "ML_HINT_NOT_APPLIED",
    hint,
  };
}

function pickBandPlan({
  resolvedEntries,
  currentThreshold,
  currentFullThreshold,
  currentKillThreshold,
  currentMidScale,
  currentLowScale,
  targetHitRate,
  minSample,
} = {}) {
  const entries = Array.isArray(resolvedEntries) ? resolvedEntries : [];
  const baseMin = clamp(Number(currentThreshold), THRESHOLD_MIN, THRESHOLD_MAX);
  const current = evaluateSizingBand(entries, {
    minThreshold: baseMin,
    fullThreshold: currentFullThreshold,
    killThreshold: currentKillThreshold,
    midScale: currentMidScale,
    lowScale: currentLowScale,
  });
  const fullCandidates = uniqueSorted([
    Math.max(baseMin, currentFullThreshold),
    Math.max(baseMin, Math.max(FULL_THRESHOLD_MIN, baseMin + 0.03)),
    Math.max(baseMin, Math.max(FULL_THRESHOLD_MIN, baseMin + 0.05)),
    Math.max(baseMin, Math.max(FULL_THRESHOLD_MIN, baseMin + 0.07)),
  ]);
  const killCandidates = uniqueSorted([
    Math.min(baseMin, currentKillThreshold),
    Math.min(baseMin - 0.01, Math.max(KILL_THRESHOLD_MIN, baseMin - 0.07)),
    Math.min(baseMin - 0.01, Math.max(KILL_THRESHOLD_MIN, baseMin - 0.05)),
    Math.min(baseMin - 0.01, Math.max(KILL_THRESHOLD_MIN, baseMin - 0.03)),
  ]).filter((v) => Number.isFinite(v) && v < baseMin);
  const midCandidates = uniqueSorted([currentMidScale, ...MID_SCALE_CANDIDATES]).filter((v) => v > 0 && v <= 1);
  const lowCandidates = uniqueSorted([currentLowScale, ...LOW_SCALE_CANDIDATES]).filter((v) => v > 0 && v <= 1);
  const candidates = [];
  for (const fullThreshold of fullCandidates) {
    for (const killThreshold of killCandidates) {
      for (const midScale of midCandidates) {
        for (const lowScale of lowCandidates) {
          if (lowScale > midScale) continue;
          candidates.push(evaluateSizingBand(entries, {
            minThreshold: baseMin,
            fullThreshold,
            killThreshold,
            midScale,
            lowScale,
          }));
        }
      }
    }
  }
  const viable = candidates.filter((row) => row.n >= minSample);
  if (viable.length === 0) {
    return {
      current,
      best: current,
      next: {
        fullThreshold: current.fullThreshold,
        killThreshold: current.killThreshold,
        midScale: current.midScale,
        lowScale: current.lowScale,
      },
      changed: false,
      reason: "INSUFFICIENT_BAND_SAMPLE",
      candidates: candidates.slice().sort((a, b) => compareBandPlans(a, b, targetHitRate)).slice(0, 20),
    };
  }
  const ordered = viable.slice().sort((a, b) => compareBandPlans(a, b, targetHitRate));
  const best = ordered[0] || current;
  return {
    current,
    best,
    next: {
      fullThreshold: best.fullThreshold,
      killThreshold: best.killThreshold,
      midScale: best.midScale,
      lowScale: best.lowScale,
    },
    changed: Math.abs(best.fullThreshold - current.fullThreshold) >= 0.005
      || Math.abs(best.killThreshold - current.killThreshold) >= 0.005
      || Math.abs(best.midScale - current.midScale) >= 0.005
      || Math.abs(best.lowScale - current.lowScale) >= 0.005,
    reason: "BAND_OBJECTIVE_SEARCH",
    candidates: ordered.slice(0, 20),
  };
}

function pickThresholdPlan({ resolvedEntries, currentThreshold, targetHitRate, minSample, thresholdMin, thresholdMax, maxStep }) {
  const candidates = [];
  for (let t = thresholdMin; t <= thresholdMax + 1e-9; t += 0.01) {
    candidates.push(roundTo(t, 2));
  }
  const currentRounded = roundTo(currentThreshold, 2);
  if (Number.isFinite(currentRounded) && !candidates.includes(currentRounded)) candidates.push(currentRounded);
  const evaluated = candidates
    .map((threshold) => evaluateThreshold(resolvedEntries, threshold))
    .sort((a, b) => a.threshold - b.threshold);

  const viable = evaluated
    .filter((row) => row.n >= minSample && Number.isFinite(row.hitRate) && row.hitRate >= targetHitRate && Number.isFinite(row.avgRetNet) && row.avgRetNet > 0)
    .sort((a, b) => compareThresholdPlans(a, b, targetHitRate));

  const currentStats = evaluateThreshold(resolvedEntries, currentThreshold);
  if (viable.length > 0) {
    const best = viable[0];
    const desired = clamp(best.threshold, thresholdMin, thresholdMax);
    const next = roundTo(clamp(currentThreshold + clamp(desired - currentThreshold, -maxStep, maxStep), thresholdMin, thresholdMax), 3);
    return {
      current: currentStats,
      best,
      next,
      changed: Math.abs(next - currentThreshold) >= 0.005,
      reason: "TARGET_THRESHOLD_SEARCH",
      candidates: evaluated,
    };
  }

  const shortfall = Number.isFinite(currentStats.hitRate) ? (targetHitRate - currentStats.hitRate) : 0;
  const delta = currentStats.n >= minSample
    ? clamp(shortfall * 0.50, -maxStep, maxStep)
    : 0;
  const next = roundTo(clamp(currentThreshold + delta, thresholdMin, thresholdMax), 3);
  return {
    current: currentStats,
    best: null,
    next,
    changed: Math.abs(next - currentThreshold) >= 0.005,
    reason: currentStats.n >= minSample ? "TARGET_NUDGE" : "INSUFFICIENT_SAMPLE",
    candidates: evaluated,
  };
}

async function updateProviderEvSettings({ provider, nextThreshold, tierThresholds, currentSys, bandPlan }) {
  const db = getFirestore();
  const ref = db.collection("settings").doc("system");
  const prefix = `providers.${provider}`;
  const updatedAt = new Date().toISOString();
  const patch = {
    [`${prefix}.provider`]: provider,
    [`${prefix}.updated_at`]: updatedAt,
    [`${prefix}.updated_by`]: "automation-ev-tp1-threshold-tune",
    [`${prefix}.ev_gate_enabled`]: true,
    [`${prefix}.ev_gate_core_enabled`]: true,
    [`${prefix}.ev_gate_pre_real_enabled`]: false,
    [`${prefix}.ev_gate_real_enabled`]: false,
    [`${prefix}.ev_gate_early_enabled`]: true,
    [`${prefix}.ev_gate_tp1_prob_min`]: nextThreshold,
    [`${prefix}.ev_gate_tp1_prob_min_early`]: clamp(Number((tierThresholds && tierThresholds.EARLY) ?? currentSys.ev_gate_tp1_prob_min_early ?? nextThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
    [`${prefix}.ev_gate_tp1_prob_min_core`]: clamp(Number((tierThresholds && tierThresholds.CORE) ?? currentSys.ev_gate_tp1_prob_min_core ?? nextThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
    [`${prefix}.ev_gate_tp1_prob_min_pre_real`]: clamp(Number(currentSys.ev_gate_tp1_prob_min_core ?? nextThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
    [`${prefix}.ev_gate_tp1_prob_min_real`]: clamp(Number(currentSys.ev_gate_tp1_prob_min_core ?? nextThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
    [`${prefix}.ev_gate_tp1_prob_full`]: clamp(Number((bandPlan && bandPlan.fullThreshold) ?? currentSys.ev_gate_tp1_prob_full ?? Math.max(0.60, nextThreshold)), THRESHOLD_MIN, THRESHOLD_MAX),
    [`${prefix}.ev_gate_tp1_prob_kill`]: clamp(Number((bandPlan && bandPlan.killThreshold) ?? currentSys.ev_gate_tp1_prob_kill ?? 0.50), 0, THRESHOLD_MAX),
    [`${prefix}.ev_gate_qty_scale_mid`]: clamp(Number((bandPlan && bandPlan.midScale) ?? currentSys.ev_gate_qty_scale_mid ?? 0.70), 0, 1),
    [`${prefix}.ev_gate_qty_scale_low`]: clamp(Number((bandPlan && bandPlan.lowScale) ?? currentSys.ev_gate_qty_scale_low ?? 0.40), 0, 1),
    [`${prefix}.ev_gate_lookback_bars`]: Math.max(8, Number(currentSys.ev_gate_lookback_bars || 12)),
    [`${prefix}.ev_gate_atr_bars`]: Math.max(4, Number(currentSys.ev_gate_atr_bars || 8)),
    [`${prefix}.ev_gate_default_tp1_pct`]: Math.max(0.1, Number(currentSys.ev_gate_default_tp1_pct || 3.25)),
    [`${prefix}.ev_gate_default_sl_pct`]: Math.max(0.1, Number(currentSys.ev_gate_default_sl_pct || 1.65)),
    [`${prefix}.ev_gate_skip_missing_bars`]: true,
    [`${prefix}.bar_context_gate_enabled`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_core_enabled`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_pre_real_enabled`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_real_enabled`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_early_enabled`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_lookback_bars`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_move_bars`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_min_consecutive_bars`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_max_move_pct`]: FieldValue.delete(),
    [`${prefix}.bar_context_gate_max_move_range_mult`]: FieldValue.delete(),
    [`${prefix}.ev_gate_gain_pct`]: FieldValue.delete(),
    [`${prefix}.ev_gate_loss_pct`]: FieldValue.delete(),
    [`${prefix}.ev_gate_cost_pct`]: FieldValue.delete(),
    [`${prefix}.ev_gate_edge_min`]: FieldValue.delete(),
    [`${prefix}.ev_gate_skip_missing_posterior`]: FieldValue.delete(),
    updated_at: updatedAt,
  };
  const strayLiteralKeys = [
    `providers.${provider}.ev_gate_enabled`,
    `providers.${provider}.ev_gate_core_enabled`,
    `providers.${provider}.ev_gate_pre_real_enabled`,
    `providers.${provider}.ev_gate_real_enabled`,
    `providers.${provider}.ev_gate_early_enabled`,
    `providers.${provider}.ev_gate_tp1_prob_min`,
    `providers.${provider}.ev_gate_tp1_prob_min_early`,
    `providers.${provider}.ev_gate_tp1_prob_min_core`,
    `providers.${provider}.ev_gate_tp1_prob_min_pre_real`,
    `providers.${provider}.ev_gate_tp1_prob_min_real`,
    `providers.${provider}.ev_gate_tp1_prob_full`,
    `providers.${provider}.ev_gate_tp1_prob_kill`,
    `providers.${provider}.ev_gate_qty_scale_mid`,
    `providers.${provider}.ev_gate_qty_scale_low`,
    `providers.${provider}.ev_gate_lookback_bars`,
    `providers.${provider}.ev_gate_atr_bars`,
    `providers.${provider}.ev_gate_default_tp1_pct`,
    `providers.${provider}.ev_gate_default_sl_pct`,
    `providers.${provider}.ev_gate_skip_missing_bars`,
    `providers.${provider}.bar_context_gate_enabled`,
  ];
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      tx.set(ref, { providers: { [provider]: { provider } } }, { merge: true });
    }
    tx.update(ref, patch);
    const deleteArgs = [];
    for (const key of strayLiteralKeys) {
      deleteArgs.push(new FieldPath(key), FieldValue.delete());
    }
    if (deleteArgs.length) tx.update(ref, ...deleteArgs);
  });
  invalidateSettingsCache("system");
  return patch;
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function needsLegacyCleanup(currentSys = {}) {
  const legacyKeys = [
    "bar_context_gate_enabled",
    "bar_context_gate_core_enabled",
    "bar_context_gate_pre_real_enabled",
    "bar_context_gate_real_enabled",
    "bar_context_gate_early_enabled",
    "bar_context_gate_lookback_bars",
    "bar_context_gate_move_bars",
    "bar_context_gate_min_consecutive_bars",
    "bar_context_gate_max_move_pct",
    "bar_context_gate_max_move_range_mult",
    "ev_gate_gain_pct",
    "ev_gate_loss_pct",
    "ev_gate_cost_pct",
    "ev_gate_edge_min",
    "ev_gate_skip_missing_posterior",
  ];
  return legacyKeys.some((key) => hasOwn(currentSys, key));
}

function needsTierThresholdInitialization(currentSys = {}) {
  return TIERS.some((tier) => !hasOwn(currentSys, TIER_THRESHOLD_KEYS[tier]));
}

async function getRawProviderSettings(provider) {
  const db = getFirestore();
  const snap = await db.collection("settings").doc("system").get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const providers = data.providers && typeof data.providers === "object" ? data.providers : {};
  return providers && typeof providers[provider] === "object" ? providers[provider] : {};
}

function renderMarkdown({ nowMeta, windowDays, maturityHours, currentThreshold, currentTierThresholds, nextTierThresholds, plan, bandPlan, resolvedEntries, unresolvedOpenCount, unresolvedStaleCount, provider, tf, cacheMeta, mlPolicyReport, mlHint, stageLedger, bestFebtContract, bestFebtMarketGuard }) {
  const lines = [];
  lines.push(`# EV Composite Threshold Tune`);
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push(`- 대상: ${provider} ${tf}`);
  lines.push(`- 목표 TP1 도달률: ${pct(TARGET_HIT_RATE)}`);
  lines.push(`- 목표 월간 순수익: ${roundTo(TARGET_MONTHLY_NET_KRW, 0)} KRW`);
  lines.push(`- 평가 윈도우: 최근 ${windowDays}일`);
  lines.push(`- maturity 기준: ${maturityHours}시간`);
  lines.push(`- resolved sample: ${resolvedEntries.length}`);
  lines.push(`- unresolved open: ${unresolvedOpenCount}`);
  lines.push(`- unresolved stale: ${unresolvedStaleCount}`);
  lines.push(`- 현재 threshold: ${pct(currentThreshold)}`);
  lines.push(`- 라이브 LONG/SHORT threshold: ${pct(currentTierThresholds && currentTierThresholds.EARLY)} -> ${pct(nextTierThresholds && nextTierThresholds.EARLY)}`);
  lines.push(`- 현재 hit rate: ${pct(plan.current.hitRate)}`);
  lines.push(`- 현재 Wilson LB: ${pct(plan.current.wilsonLower)}`);
  lines.push(`- 현재 월간페이스: ${plan.current.monthlyRunRateKrw == null ? "N/A" : `${roundTo(plan.current.monthlyRunRateKrw, 0)} KRW`}`);
  lines.push(`- 현재 sample: ${plan.current.n}`);
  lines.push(`- BEST/FEBT contract: ${bestFebtContract && bestFebtContract.mode || "N/A"} / replacement ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "N/A"} / count ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`);
  lines.push(`- market guard: ${bestFebtMarketGuard && bestFebtMarketGuard.market ? `${bestFebtMarketGuard.market} / ${bestFebtMarketGuard.mode}` : "N/A"}`);
  if (plan.best) {
    lines.push(`- 추천 threshold: ${pct(plan.best.threshold)}`);
    lines.push(`- 추천 hit rate: ${pct(plan.best.hitRate)}`);
    lines.push(`- 추천 Wilson LB: ${pct(plan.best.wilsonLower)}`);
    lines.push(`- 추천 월간페이스: ${plan.best.monthlyRunRateKrw == null ? "N/A" : `${roundTo(plan.best.monthlyRunRateKrw, 0)} KRW`}`);
    lines.push(`- 추천 sample: ${plan.best.n}`);
  } else {
    lines.push(`- 추천 threshold: 없음`);
  }
  lines.push(`- 적용 threshold: ${pct(plan.next)}`);
  lines.push(`- 변경 여부: ${plan.changed ? "UPDATE" : "KEEP"}`);
  lines.push(`- 결정 사유: ${plan.reason}`);
  if (bandPlan) {
    lines.push(`- 현재 EV band: full ${pct(bandPlan.current.fullThreshold)} / kill ${pct(bandPlan.current.killThreshold)} / mid ${pct(bandPlan.current.midScale)} / low ${pct(bandPlan.current.lowScale)}`);
    lines.push(`- 적용 EV band: full ${pct(bandPlan.next.fullThreshold)} / kill ${pct(bandPlan.next.killThreshold)} / mid ${pct(bandPlan.next.midScale)} / low ${pct(bandPlan.next.lowScale)}`);
    lines.push(`- band expectancy(avg_ret_net): ${pct(bandPlan.current.avgRetNet)} -> ${pct(bandPlan.best && bandPlan.best.avgRetNet)}`);
    lines.push(`- band 순손익: ${bandPlan.current.netPnlQuote == null ? "N/A" : roundTo(bandPlan.current.netPnlQuote, 2)} -> ${bandPlan.best && bandPlan.best.netPnlQuote != null ? roundTo(bandPlan.best.netPnlQuote, 2) : "N/A"}`);
    lines.push(`- band 월간페이스: ${bandPlan.current.monthlyRunRateKrw == null ? "N/A" : `${roundTo(bandPlan.current.monthlyRunRateKrw, 0)} KRW`} -> ${bandPlan.best && bandPlan.best.monthlyRunRateKrw != null ? `${roundTo(bandPlan.best.monthlyRunRateKrw, 0)} KRW` : "N/A"}`);
    lines.push(`- band 드로우다운프록시: ${bandPlan.current.negPnlAbs == null ? "N/A" : roundTo(bandPlan.current.negPnlAbs, 2)} -> ${bandPlan.best && bandPlan.best.negPnlAbs != null ? roundTo(bandPlan.best.negPnlAbs, 2) : "N/A"}`);
    lines.push(`- band 결정 사유: ${bandPlan.reason}`);
  }
  lines.push("");
  lines.push(`## 최근 후보`);
  for (const row of plan.candidates
    .filter((x) => x.n >= Math.min(5, MIN_SAMPLE))
    .sort((a, b) => a.threshold - b.threshold)
    .slice(0, 12)) {
    lines.push(`- ${pct(row.threshold)} -> hit_rate=${pct(row.hitRate)} / wilson_lb=${pct(row.wilsonLower)} / n=${row.n}`);
  }
  if (cacheMeta) {
    lines.push("");
    lines.push("## 로컬 증분 캐시");
    lines.push(`- order_intents_paper: ${cacheMeta.intents.filePath} / cached=${cacheMeta.intents.count} / new=${cacheMeta.intents.fetched_new} / overlap=${cacheMeta.intents.overlap_fetched}`);
    lines.push(`- fills_paper: ${cacheMeta.fills.filePath} / cached=${cacheMeta.fills.count} / new=${cacheMeta.fills.fetched_new} / overlap=${cacheMeta.fills.overlap_fetched}`);
  }
  if (stageLedger) {
    lines.push("");
    lines.push("## Stage Outcome Ledger");
    lines.push(`- source: ${stageLedger.source}`);
    lines.push(`- file: ${stageLedger.filePath || "N/A"}`);
    lines.push(`- age: ${Number.isFinite(stageLedger.age_ms) ? `${Math.round(stageLedger.age_ms / 60000)}분` : "N/A"}`);
    lines.push(`- fresh: ${stageLedger.fresh ? "YES" : "NO"}`);
  }
  lines.push("");
  lines.push("## ML 정책 연계");
  lines.push(`- ML report: ${(mlPolicyReport && mlPolicyReport.filePath) || "N/A"}`);
  lines.push(`- ML report age: ${mlPolicyReport && Number.isFinite(mlPolicyReport.age_ms) ? `${Math.round(mlPolicyReport.age_ms / 60000)}분` : "N/A"}`);
  lines.push(`- ML hint applied: ${mlHint && mlHint.applied ? "YES" : "NO"}`);
  if (mlHint && mlHint.hint) {
    lines.push(`- ML hint threshold_applied=${mlHint.hint.threshold_applied ? "YES" : "NO"} / band_applied=${mlHint.hint.band_applied ? "YES" : "NO"} / sample=${mlHint.hint.sample_n}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildTierThresholdRows(tierPlans = {}, currentTierThresholds = {}, nextTierThresholds = {}) {
  return TIERS.map((tier) => {
    const row = tierPlans[tier] || {};
    return {
      tier,
      display_tier: describeTimingTierForUser(tier),
      current_threshold: Number(currentTierThresholds[tier]),
      next_threshold: Number(nextTierThresholds[tier]),
      decision_reason: row.reason || null,
      display_reason: describeEvDecisionReasonForUser(row.reason),
      current_sample: row.current ? row.current.n : null,
      current_hit_rate: row.current ? row.current.hitRate : null,
      current_wilson_lower: row.current ? row.current.wilsonLower : null,
      best_threshold: row.best ? row.best.threshold : null,
      best_hit_rate: row.best ? row.best.hitRate : null,
      best_sample: row.best ? row.best.n : null,
    };
  });
}

function buildMlTierPlanRows(tierPlans = {}) {
  return TIERS.map((tier) => {
    const row = tierPlans[tier] || {};
    return {
      tier,
      display_tier: describeTimingTierForUser(tier),
      current_threshold: Number.isFinite(Number(row.currentThreshold)) ? Number(row.currentThreshold) : null,
      next_threshold: Number.isFinite(Number(row.next)) ? Number(row.next) : null,
      changed: row.changed === true,
      decision_reason: row.reason || null,
      display_reason: describeEvDecisionReasonForUser(row.reason),
      current_sample: row.current ? row.current.n : null,
      current_hit_rate: row.current ? row.current.hitRate : null,
      current_wilson_lower: row.current ? row.current.wilsonLower : null,
      current_monthly_run_rate_krw: row.current ? row.current.monthlyRunRateKrw : null,
      best_threshold: row.best ? row.best.threshold : null,
      best_hit_rate: row.best ? row.best.hitRate : null,
      best_sample: row.best ? row.best.n : null,
      best_monthly_run_rate_krw: row.best ? row.best.monthlyRunRateKrw : null,
    };
  });
}

function isEvThresholdHardening(currentThreshold, nextThreshold) {
  return Number(nextThreshold) > Number(currentThreshold);
}

function isEvBandHardening(currentBand = {}, nextBand = {}) {
  return (
    Number(nextBand.fullThreshold) > Number(currentBand.fullThreshold)
    || Number(nextBand.killThreshold) > Number(currentBand.killThreshold)
    || Number(nextBand.midScale) < Number(currentBand.midScale)
    || Number(nextBand.lowScale) < Number(currentBand.lowScale)
  );
}

function applyBestFebtEvGuard({ plan, bandPlan, currentThreshold, currentBand, bestFebtContract } = {}) {
  if (!bestFebtContract || typeof bestFebtContract !== "object") {
    return { plan, bandPlan, blocked: false, reason: null };
  }
  const tighteningBlocked = bestFebtContract.tightening_allowed === false || bestFebtContract.recovery_priority === true;
  if (!tighteningBlocked) {
    return { plan, bandPlan, blocked: false, reason: null };
  }
  const reason = bestFebtContract.tightening_allowed === false
    ? "BEST_FEBT_COUNT_GUARD_BLOCK"
    : "BEST_FEBT_RECOVERY_GUARD_BLOCK";
  const nextPlan = { ...(plan || {}) };
  const nextBandPlan = { ...(bandPlan || {}) };
  let blocked = false;
  if (nextPlan && nextPlan.changed && isEvThresholdHardening(currentThreshold, nextPlan.next)) {
    nextPlan.changed = false;
    nextPlan.next = currentThreshold;
    nextPlan.reason = reason;
    blocked = true;
  }
  if (nextBandPlan && nextBandPlan.changed && isEvBandHardening(currentBand, nextBandPlan.next || {})) {
    nextBandPlan.changed = false;
    nextBandPlan.next = { ...currentBand };
    nextBandPlan.reason = reason;
    blocked = true;
  }
  return { plan: nextPlan, bandPlan: nextBandPlan, blocked, reason: blocked ? reason : null };
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const nowMs = Date.now();
  const fromMs = nowMs - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const maturityMs = MATURITY_HOURS * 60 * 60 * 1000;

  const [currentSysRes, currentRawProvider] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getRawProviderSettings(PROVIDER),
  ]);
  const currentSys = currentSysRes.data || {};
  const currentThreshold = clamp(Number(currentSys.ev_gate_tp1_prob_min || 0.55), THRESHOLD_MIN, THRESHOLD_MAX);
  const currentTierThresholds = {
    EARLY: clamp(Number(currentSys.ev_gate_tp1_prob_min_early ?? currentThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
    CORE: clamp(Number(currentSys.ev_gate_tp1_prob_min_core ?? currentThreshold), THRESHOLD_MIN, THRESHOLD_MAX),
  };
  const currentBand = {
    fullThreshold: clamp(Number(currentSys.ev_gate_tp1_prob_full ?? Math.max(0.60, currentThreshold)), THRESHOLD_MIN, THRESHOLD_MAX),
    killThreshold: clamp(Number(currentSys.ev_gate_tp1_prob_kill ?? 0.50), 0, THRESHOLD_MAX),
    midScale: clamp(Number(currentSys.ev_gate_qty_scale_mid ?? 0.70), 0, 1),
    lowScale: clamp(Number(currentSys.ev_gate_qty_scale_low ?? 0.40), 0, 1),
  };
  const mlPolicyReport = readFreshMlPolicyReport(nowMs);
  const stageLedgerReport = readFreshEvResolvedLedger(nowMs);
  const bestFebtContext = readBestFebtSupervisorContext(nowMs);
  const bestFebtContract = bestFebtContext.contract;
  const bestFebtMarketGuard = bestFebtContext.marketGuardContract;

  const [intentRes, fillRes, dropsRes] = await Promise.all([
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
  ]);
  const intentRows = intentRes.rows;
  const fillRows = fillRes.rows;
  let evLedger = null;
  let stageLedgerMeta = {
    source: "REBUILT_FROM_CACHE",
    filePath: stageLedgerReport && stageLedgerReport.filePath ? stageLedgerReport.filePath : null,
    age_ms: stageLedgerReport && Number.isFinite(stageLedgerReport.age_ms) ? stageLedgerReport.age_ms : null,
    fresh: false,
  };
  if (
    stageLedgerReport &&
    stageLedgerReport.stale === false &&
    stageLedgerReport.data &&
    String(stageLedgerReport.data.provider || "").toUpperCase() === PROVIDER &&
    String(stageLedgerReport.data.tf || "") === TF &&
    String(stageLedgerReport.data.model || "") === CURRENT_BAR_MODEL
  ) {
    evLedger = stageLedgerReport.data;
    stageLedgerMeta = {
      source: "FRESH_LEDGER",
      filePath: stageLedgerReport.filePath,
      age_ms: stageLedgerReport.age_ms,
      fresh: true,
    };
  } else {
    evLedger = await buildEvResolvedLedger({
      provider: PROVIDER,
      tf: TF,
      fromMs,
      toMs: nowMs,
      nowMs,
      maturityHours: MATURITY_HOURS,
      intents: intentRows,
      fills: fillRows,
      drops: dropsRes.rows,
      sysCfg: currentSys,
    });
  }

  const classified = (Array.isArray(evLedger && evLedger.rows) ? evLedger.rows : [])
    .map((row) => ({
      signalId: row.signal_id || row.signal_key || null,
      symbol: String(row.symbol || "").toUpperCase(),
      event: String(row.event || "").toUpperCase(),
      tier: resolveEntryTier(row.event) || row.tier || null,
      predicted: toNum(row.predicted ?? row.lower_bound ?? row.probability),
      outcome: String(row.outcome || "").toUpperCase(),
      entryEventId: row.entry_event_id || null,
      realizedPnlQuote: toNum(row.realized_pnl_quote),
      realizedRetNet: toNum(row.realized_ret_net),
      stage4Source: row.stage4_source || null,
      resolvedForTune: row.resolved_for_tune === true,
    }))
    .filter((row) => Number.isFinite(row.predicted));

  const resolvedEntries = classified.filter((row) => row.resolvedForTune === true);
  const unresolvedOpenCount = classified.filter((row) => row.outcome === "UNRESOLVED_OPEN").length;
  const unresolvedStaleCount = classified.filter((row) => row.outcome === "UNRESOLVED_STALE").length;

  const plan = pickThresholdPlan({
    resolvedEntries,
    currentThreshold,
    targetHitRate: TARGET_HIT_RATE,
    minSample: MIN_SAMPLE,
    thresholdMin: THRESHOLD_MIN,
    thresholdMax: THRESHOLD_MAX,
    maxStep: MAX_STEP,
  });
  const tierPlans = {};
  for (const tier of TIERS) {
    tierPlans[tier] = {
      currentThreshold: currentTierThresholds[tier],
      ...pickThresholdPlan({
        resolvedEntries: resolvedEntries.filter((row) => row.tier === tier),
        currentThreshold: currentTierThresholds[tier],
        targetHitRate: TARGET_HIT_RATE,
        minSample: Math.max(6, Math.min(MIN_SAMPLE, 8)),
        thresholdMin: THRESHOLD_MIN,
        thresholdMax: THRESHOLD_MAX,
        maxStep: MAX_STEP,
      }),
    };
  }
  plan.tierPlans = tierPlans;
  const nextTierThresholds = Object.fromEntries(
    TIERS.map((tier) => [tier, clamp(Number(tierPlans[tier].next), THRESHOLD_MIN, THRESHOLD_MAX)])
  );
  let bandPlan = pickBandPlan({
    resolvedEntries,
    currentThreshold,
    currentFullThreshold: currentBand.fullThreshold,
    currentKillThreshold: currentBand.killThreshold,
    currentMidScale: currentBand.midScale,
    currentLowScale: currentBand.lowScale,
    targetHitRate: TARGET_HIT_RATE,
    minSample: MIN_SAMPLE,
  });
  const mlGuidance = applyMlEvGuidance({
    plan,
    bandPlan,
    currentThreshold,
    currentBand,
    mlPolicyReport,
  });
  let effectivePlan = mlGuidance.plan || plan;
  bandPlan = mlGuidance.bandPlan || bandPlan;
  const bestFebtGuard = applyBestFebtEvGuard({
    plan: effectivePlan,
    bandPlan,
    currentThreshold,
    currentBand,
    bestFebtContract: bestFebtMarketGuard || bestFebtContract,
  });
  effectivePlan = bestFebtGuard.plan;
  bandPlan = bestFebtGuard.bandPlan;

  let settingsUpdated = false;
  let autopilotSnapshot = null;
  if (
    effectivePlan.changed ||
    TIERS.some((tier) => tierPlans[tier].changed) ||
    (bandPlan && bandPlan.changed) ||
    needsLegacyCleanup(currentRawProvider) ||
    needsTierThresholdInitialization(currentRawProvider)
  ) {
    autopilotSnapshot = writeStageSnapshot({
      stage: "EV",
      provider: PROVIDER,
      snapshot: pickSettingsSnapshot(currentSys, EV_SNAPSHOT_KEYS),
      meta: {
        source: "automation-ev-tp1-threshold-tune",
        current_threshold: currentThreshold,
        next_threshold: effectivePlan.next,
        current_band: currentBand,
        next_band: bandPlan ? bandPlan.next : currentBand,
      },
    });
    await updateProviderEvSettings({
      provider: PROVIDER,
      nextThreshold: effectivePlan.next,
      tierThresholds: nextTierThresholds,
      currentSys,
      bandPlan: bandPlan && bandPlan.next,
    });
    settingsUpdated = true;
  }

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    canonical_artifact_name: "ev_composite_threshold_tune",
    legacy_artifact_alias: "ev_tp1_threshold_tune",
    canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
    compatibility_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1",
    threshold_metric: "exit_value_lower_bound",
    provider: PROVIDER,
    tf: TF,
    model: CURRENT_BAR_MODEL,
    target_tp1_hit_rate: TARGET_HIT_RATE,
    target_monthly_net_krw: TARGET_MONTHLY_NET_KRW,
    lookback_days: LOOKBACK_DAYS,
    maturity_hours: MATURITY_HOURS,
    min_sample: MIN_SAMPLE,
    current_threshold: currentThreshold,
    next_threshold: effectivePlan.next,
    current_band: currentBand,
    next_band: bandPlan ? bandPlan.next : currentBand,
    settings_updated: settingsUpdated,
    decision_reason: effectivePlan.reason,
    summary: {
      entries_seen: classified.length,
      resolved_entries: resolvedEntries.length,
      unresolved_open_entries: unresolvedOpenCount,
      unresolved_stale_entries: unresolvedStaleCount,
      current_sample: effectivePlan.current.n,
      current_hit_rate: effectivePlan.current.hitRate,
      current_wilson_lower: effectivePlan.current.wilsonLower,
      current_monthly_run_rate_krw: effectivePlan.current.monthlyRunRateKrw,
      best_threshold: effectivePlan.best ? effectivePlan.best.threshold : null,
      best_hit_rate: effectivePlan.best ? effectivePlan.best.hitRate : null,
      best_wilson_lower: effectivePlan.best ? effectivePlan.best.wilsonLower : null,
      best_monthly_run_rate_krw: effectivePlan.best ? effectivePlan.best.monthlyRunRateKrw : null,
      best_sample: effectivePlan.best ? effectivePlan.best.n : null,
      band_current_hit_rate: bandPlan ? bandPlan.current.hitRate : null,
      band_current_avg_ret_net: bandPlan ? bandPlan.current.avgRetNet : null,
      band_current_net_pnl_quote: bandPlan ? bandPlan.current.netPnlQuote : null,
      band_current_monthly_run_rate_krw: bandPlan ? bandPlan.current.monthlyRunRateKrw : null,
    band_current_neg_pnl_abs: bandPlan ? bandPlan.current.negPnlAbs : null,
    band_best_hit_rate: bandPlan && bandPlan.best ? bandPlan.best.hitRate : null,
    band_best_avg_ret_net: bandPlan && bandPlan.best ? bandPlan.best.avgRetNet : null,
    band_best_net_pnl_quote: bandPlan && bandPlan.best ? bandPlan.best.netPnlQuote : null,
    band_best_monthly_run_rate_krw: bandPlan && bandPlan.best ? bandPlan.best.monthlyRunRateKrw : null,
    band_best_neg_pnl_abs: bandPlan && bandPlan.best ? bandPlan.best.negPnlAbs : null,
    },
    artifacts: {
      ml_policy_report: mlPolicyReport && mlPolicyReport.filePath ? mlPolicyReport.filePath : null,
      objective_supervisor_report: bestFebtContext.objectiveSupervisorArtifact && bestFebtContext.objectiveSupervisorArtifact.filePath ? bestFebtContext.objectiveSupervisorArtifact.filePath : null,
      stage_ev_resolved_ledger: stageLedgerMeta.filePath,
      stage_ev_resolved_ledger_source: stageLedgerMeta.source,
      autopilot_snapshot_path: autopilotSnapshot && autopilotSnapshot.filePath ? autopilotSnapshot.filePath : null,
      cache: {
        intents: intentRes.meta,
        fills: fillRes.meta,
        drops: dropsRes.meta,
      },
    },
    ml_guidance: mlGuidance,
    best_febt_tuning_contract: bestFebtContract,
    best_febt_market_guard_contract: bestFebtMarketGuard,
    best_febt_guard: bestFebtGuard,
    tier_thresholds: Object.fromEntries(TIERS.map((tier) => [tier, {
      current_threshold: currentTierThresholds[tier],
      next_threshold: nextTierThresholds[tier],
      decision_reason: tierPlans[tier].reason,
      current_sample: tierPlans[tier].current.n,
      current_hit_rate: tierPlans[tier].current.hitRate,
      current_wilson_lower: tierPlans[tier].current.wilsonLower,
      best_threshold: tierPlans[tier].best ? tierPlans[tier].best.threshold : null,
      best_hit_rate: tierPlans[tier].best ? tierPlans[tier].best.hitRate : null,
      best_sample: tierPlans[tier].best ? tierPlans[tier].best.n : null,
    }])),
    tier_threshold_rows: buildTierThresholdRows(tierPlans, currentTierThresholds, nextTierThresholds),
    candidates: effectivePlan.candidates,
    band_candidates: bandPlan ? bandPlan.candidates : [],
    recent_resolved_examples: resolvedEntries
      .slice()
      .sort((a, b) => b.predicted - a.predicted)
      .slice(0, 20),
  };
  if (report.ml_guidance && report.ml_guidance.plan && report.ml_guidance.plan.tierPlans) {
    report.ml_guidance.plan.tier_plan_rows = buildMlTierPlanRows(report.ml_guidance.plan.tierPlans);
  }

  const jsonPath = path.join(
    OPS_DAILY_DIR,
    `${nowMeta.dateKey}_${nowMeta.hhmm}_ev_composite_threshold_tune.json`
  );
  const mdPath = path.join(
    OPS_DAILY_DIR,
    `${nowMeta.dateKey}_${nowMeta.hhmm}_ev_composite_threshold_tune.md`
  );
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown({
    nowMeta,
    windowDays: LOOKBACK_DAYS,
    maturityHours: MATURITY_HOURS,
    currentThreshold,
    currentTierThresholds,
    nextTierThresholds,
    plan: effectivePlan,
    bandPlan,
    resolvedEntries,
    unresolvedOpenCount,
    unresolvedStaleCount,
    provider: PROVIDER,
    tf: TF,
    cacheMeta: report.artifacts.cache,
    mlPolicyReport,
    mlHint: mlGuidance,
    stageLedger: stageLedgerMeta,
    bestFebtContract,
    bestFebtMarketGuard,
  }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "ev_composite_threshold_tune_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "ev_composite_threshold_tune_latest.md"));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.md"));

  const severity = (
    effectivePlan.reason === "TARGET_THRESHOLD_SEARCH"
    || bandPlan.reason === "BAND_OBJECTIVE_SEARCH"
    || (report.ml_guidance && report.ml_guidance.applied)
  ) ? "INFO" : "WARN";

  await sendKoreanTelegramSummary({
    title: `[4차 EV/시간가치층 복합 기대값 자동 조정] ${PROVIDER}`,
    severity,
    provider: PROVIDER,
    sections: [
      {
        header: "이번 평가",
        lines: [
          `모델 ${CURRENT_BAR_MODEL}`,
          `목표 TP1 도달률 ${pct(TARGET_HIT_RATE)}`,
          `목표 월간 순수익 ${roundTo(TARGET_MONTHLY_NET_KRW, 0)} KRW`,
          `평가 윈도우 최근 ${LOOKBACK_DAYS}일 / maturity ${MATURITY_HOURS}시간`,
          `resolved sample ${resolvedEntries.length}건`,
          `unresolved open ${unresolvedOpenCount}건 / stale ${unresolvedStaleCount}건`,
          `cache intents new ${intentRes.meta.fetched_new} / fills new ${fillRes.meta.fetched_new} / drops new ${dropsRes.meta.fetched_new}`,
          `stage ledger ${stageLedgerMeta.source} / ${stageLedgerMeta.filePath || "N/A"}`,
          `ML report ${mlPolicyReport && mlPolicyReport.filePath ? "연계" : "없음"} / hint ${mlGuidance.applied ? "적용" : "미적용"}`,
          `BEST/FEBT ${bestFebtContract && bestFebtContract.mode || "N/A"} / replacement ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "N/A"} / count ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`,
          `market guard ${bestFebtMarketGuard && bestFebtMarketGuard.market ? `${bestFebtMarketGuard.market} / ${bestFebtMarketGuard.mode}` : "N/A"}`,
        ],
      },
      {
        header: "threshold",
        lines: [
          `라이브 LONG/SHORT 기준 현재 ${pct(currentTierThresholds.EARLY)} -> 적용 ${pct(nextTierThresholds.EARLY)}`,
          `현재 hit_rate ${pct(effectivePlan.current.hitRate)} / wilson_lb ${pct(effectivePlan.current.wilsonLower)} / 월간페이스 ${effectivePlan.current.monthlyRunRateKrw == null ? "N/A" : `${roundTo(effectivePlan.current.monthlyRunRateKrw, 0)} KRW`} / n=${effectivePlan.current.n}`,
          effectivePlan.best
            ? `추천 ${pct(effectivePlan.best.threshold)} / hit_rate ${pct(effectivePlan.best.hitRate)} / wilson_lb ${pct(effectivePlan.best.wilsonLower)} / 월간페이스 ${effectivePlan.best.monthlyRunRateKrw == null ? "N/A" : `${roundTo(effectivePlan.best.monthlyRunRateKrw, 0)} KRW`} / n=${effectivePlan.best.n}`
            : "추천 threshold 없음",
          `결정 사유 ${effectivePlan.reason}`,
          `설정 반영 ${settingsUpdated ? "UPDATE" : "KEEP"}`,
        ],
      },
      {
        header: "band",
        lines: [
          `현재 full ${pct(currentBand.fullThreshold)} / kill ${pct(currentBand.killThreshold)} / mid ${pct(currentBand.midScale)} / low ${pct(currentBand.lowScale)}`,
          `적용 full ${pct(bandPlan.next.fullThreshold)} / kill ${pct(bandPlan.next.killThreshold)} / mid ${pct(bandPlan.next.midScale)} / low ${pct(bandPlan.next.lowScale)}`,
          `현재 expectancy ${pct(bandPlan.current.avgRetNet)} / hit_rate ${pct(bandPlan.current.hitRate)} / net ${bandPlan.current.netPnlQuote == null ? "N/A" : roundTo(bandPlan.current.netPnlQuote, 2)} / 월간페이스 ${bandPlan.current.monthlyRunRateKrw == null ? "N/A" : `${roundTo(bandPlan.current.monthlyRunRateKrw, 0)} KRW`}`,
          `추천 expectancy ${pct(bandPlan.best.avgRetNet)} / hit_rate ${pct(bandPlan.best.hitRate)} / net ${bandPlan.best.netPnlQuote == null ? "N/A" : roundTo(bandPlan.best.netPnlQuote, 2)} / 월간페이스 ${bandPlan.best.monthlyRunRateKrw == null ? "N/A" : `${roundTo(bandPlan.best.monthlyRunRateKrw, 0)} KRW`}`,
          `band 결정 사유 ${bandPlan.reason}`,
        ],
      },
      {
        header: "티어별",
        lines: TIERS.map((tier) => {
          const row = tierPlans[tier];
          return `${describeTimingTierForUser(tier)} ${pct(row.currentThreshold)} -> ${pct(row.next)} / hit_rate ${pct(row.current.hitRate)} / n=${row.current.n} / ${describeEvDecisionReasonForUser(row.reason)}`;
        }),
      },
      {
        header: "보고서",
        lines: [
          mdPath,
          jsonPath,
          stageLedgerMeta.filePath || "stage ledger 없음",
          mlPolicyReport && mlPolicyReport.filePath ? mlPolicyReport.filePath : "ML report 없음",
        ],
      },
    ],
  });

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: report.generated_at_kst,
    provider: report.provider,
    tf: report.tf,
    current_threshold: report.current_threshold,
    next_threshold: report.next_threshold,
    current_band: report.current_band,
    next_band: report.next_band,
    settings_updated: report.settings_updated,
    decision_reason: report.decision_reason,
    resolved_entries: report.summary && report.summary.resolved_entries,
    ml_hint_applied: report.ml_guidance && report.ml_guidance.applied,
    ml_policy_report: report.artifacts && report.artifacts.ml_policy_report,
    json_path: jsonPath,
    md_path: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-ev-tp1-threshold-tune failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    applyMlEvGuidance,
    buildTierThresholdRows,
    buildMlTierPlanRows,
    isEvThresholdHardening,
    isEvBandHardening,
    applyBestFebtEvGuard,
    describeEvDecisionReasonForUser,
    renderMarkdown,
    buildEntryEventId,
    classifyEntryOutcome,
    compareThresholdPlans,
    evaluateSizingBand,
    evaluateThreshold,
    pickBandPlan,
    pickThresholdPlan,
    wilsonLowerBound,
  },
};
