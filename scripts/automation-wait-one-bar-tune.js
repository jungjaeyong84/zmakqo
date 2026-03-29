#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider, invalidateSettingsCache } = require("../src/storage/settings");
const { resolveWaitOneBarConfig, evaluateWaitOneBarTiming } = require("../src/services/waitOneBarPolicy");
const { estimateTp1ReachProbability } = require("../src/services/evTp1Probability");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
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
const { DEFAULT_MIN_MONTHLY_NET_KRW } = require("./lib/objective-policy");
const { buildWaitStateMachineLedger } = require("./lib/stage-outcome-ledgers");
const { pickSettingsSnapshot, writeStageSnapshot } = require("./lib/stage-autopilot");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const {
  isEntryTierEvent,
  resolveEntryTimingTier,
  resolveEntrySide,
  describeTimingTierForUser,
} = require("../src/utils/liveEntryTaxonomy");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

const PROVIDER = String(process.env.WAIT_TUNE_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.WAIT_TUNE_TF || "15m").trim();
const LOOKBACK_DAYS = Math.max(10, Number(process.env.WAIT_TUNE_LOOKBACK_DAYS || 15));
const HORIZON_HOURS = Math.max(4, Number(process.env.WAIT_TUNE_HORIZON_HOURS || 12));
const HORIZON_MS = HORIZON_HOURS * 60 * 60 * 1000;
const LOOKBACK_BARS = Math.max(8, Number(process.env.WAIT_TUNE_LOOKBACK_BARS || 12));
const ATR_BARS = Math.max(4, Number(process.env.WAIT_TUNE_ATR_BARS || 8));
const MIN_SAMPLE = Math.max(12, Number(process.env.WAIT_TUNE_MIN_SAMPLE || 24));
const MIN_TRIGGER_SAMPLE = Math.max(4, Number(process.env.WAIT_TUNE_MIN_TRIGGER_SAMPLE || 8));
const TARGET_BENEFICIAL_WAIT_RATE = clampNumber(process.env.WAIT_TUNE_TARGET_BENEFICIAL_RATE || 0.60, 0.5, 0.95, 0.60);
const BENEFIT_MARGIN = Math.max(0, Number(process.env.WAIT_TUNE_BENEFIT_MARGIN || 0.0010));
const SCAN_LIMIT = Math.max(3000, Number(process.env.WAIT_TUNE_SCAN_LIMIT || 12000));
const BAR_FETCH_LIMIT = Math.max(4000, Number(process.env.WAIT_TUNE_BAR_FETCH_LIMIT || 12000));
const WAIT_TUNE_MAX_AGE_HOURS = Math.max(24, Number(process.env.WAIT_TUNE_MAX_AGE_HOURS || 144));
const ML_POLICY_MAX_AGE_HOURS = Math.max(6, Number(process.env.WAIT_TUNE_ML_POLICY_MAX_AGE_HOURS || 18));
const STAGE_LEDGER_MAX_AGE_HOURS = Math.max(6, Number(process.env.WAIT_TUNE_STAGE_LEDGER_MAX_AGE_HOURS || 18));
const WEEKLY_GOVERNANCE_MAX_AGE_HOURS = Math.max(6, Number(process.env.WAIT_TUNE_WEEKLY_GOVERNANCE_MAX_AGE_HOURS || 18));
const OBJECTIVE_TARGET_MONTHLY_KRW = Math.max(
  0,
  Number(process.env.WAIT_TUNE_MIN_MONTHLY_NET_KRW || process.env.OBJECTIVE_MIN_MONTHLY_NET_KRW || DEFAULT_MIN_MONTHLY_NET_KRW),
);
const EPS = 1e-12;
const WAIT_SNAPSHOT_KEYS = Object.freeze([
  "wait_one_bar_enabled",
  "wait_one_bar_core_enabled",
  "wait_one_bar_early_enabled",
  "wait_one_bar_same_dir_streak_min",
  "wait_one_bar_chase_ratio_min",
  "wait_one_bar_last_close_control_min",
  "wait_one_bar_last_dir_body_min",
  "wait_one_bar_last_opposite_wick_max",
  "wait_one_bar_recent_move1_pct_min",
  "wait_one_bar_counter_dir_bars_max",
]);

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clampNumber(v, min, max, fallback = min) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clampInt(v, min, max, fallback = min) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
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

function ratioX(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}x`;
}

function signedPct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function uniqSorted(nums = []) {
  return Array.from(new Set((Array.isArray(nums) ? nums : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .map((v) => roundTo(v, 3))))
    .sort((a, b) => a - b);
}

function resolveTier(rowOrEvent) {
  return resolveEntryTimingTier(rowOrEvent);
}

function resolveSide(row) {
  return resolveEntrySide(row && row.event, row && (row.side || row.action));
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function resolveDocMs(doc) {
  return (
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    Date.parse(String((doc && (doc.created_at || doc.updated_at || doc.ts)) || ""))
  );
}

function makeSignalKey(row) {
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  const tf = String(row && row.tf || "").trim();
  const event = String(row && row.event || "").trim().toUpperCase();
  const ms = resolveDocMs(row);
  if (!market || !tf || !event || !Number.isFinite(ms)) return null;
  return `${market}__${tf}__${ms}__${event}`;
}

function parseBarSnapshot(doc) {
  const data = doc && typeof doc.data === "function" ? doc.data() : doc;
  const ohlcv = data && data.ohlcv_json && typeof data.ohlcv_json === "object" ? data.ohlcv_json : {};
  const open = toNum(ohlcv.open ?? data.open);
  const high = toNum(ohlcv.high ?? data.high);
  const low = toNum(ohlcv.low ?? data.low);
  const close = toNum(ohlcv.close ?? data.close);
  const timestamp = toNum(data && data.bar_close_time_utc_ms);
  if (![open, high, low, close, timestamp].every((x) => Number.isFinite(x))) return null;
  return { open, high, low, close, timestamp };
}

async function fetchBarsRange({ exchange, symbol, tf, fromMs, toMs, limitN = BAR_FETCH_LIMIT } = {}) {
  const db = getFirestore();
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const timeframe = String(tf || "").trim();
  if (!ex || !sym || !timeframe || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) return [];
  const prefix = `${ex}__${sym}__${timeframe}__`;
  const startKey = `${prefix}${Math.max(0, Math.floor(fromMs))}`;
  const endKey = `${prefix}${Math.max(0, Math.floor(toMs))}\uf8ff`;
  const snap = await getFirestore().collection("bars_snapshots")
    .orderBy("__name__")
    .startAt(startKey)
    .endAt(endKey)
    .limit(limitN)
    .get();
  const out = [];
  snap.forEach((d) => {
    const row = parseBarSnapshot(d);
    if (row) out.push(row);
  });
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

async function loadBarsByMarket(rows = [], { exchange, tf, lookbackBars = LOOKBACK_BARS, horizonMs = HORIZON_MS } = {}) {
  const markets = new Map();
  const tfMs = 15 * 60 * 1000;
  const padMs = Math.max(tfMs * (Math.max(lookbackBars, ATR_BARS) + 4), 4 * 60 * 60 * 1000);
  for (const row of Array.isArray(rows) ? rows : []) {
    const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    if (!market || !Number.isFinite(ms)) continue;
    const range = markets.get(market) || { fromMs: ms, toMs: ms };
    range.fromMs = Math.min(range.fromMs, ms - padMs);
    range.toMs = Math.max(range.toMs, ms + horizonMs + padMs);
    markets.set(market, range);
  }
  const out = new Map();
  for (const [market, range] of markets.entries()) {
    const bars = await fetchBarsRange({ exchange, symbol: market, tf, fromMs: range.fromMs, toMs: range.toMs });
    out.set(market, bars);
  }
  return out;
}

function pctFromPriceMove({ entryPrice, refPrice, side, leverage }) {
  const entry = Number(entryPrice);
  const ref = Number(refPrice);
  const lev = Number(leverage);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(ref) || ref <= 0) return null;
  const raw = side === "SHORT" ? ((entry - ref) / entry) : ((ref - entry) / entry);
  const levEff = Number.isFinite(lev) && lev > 0 ? lev : 1;
  return raw * levEff;
}

function pnlToPrice({ avg, pnlPct, side, leverage }) {
  const avgNum = Number(avg);
  const pnlNum = Number(pnlPct);
  const lev = Number(leverage);
  if (!Number.isFinite(avgNum) || avgNum <= 0 || !Number.isFinite(pnlNum)) return null;
  const levEff = Number.isFinite(lev) && lev > 0 ? lev : 1;
  const rawPct = pnlNum / levEff;
  if (String(side || "").toUpperCase() === "SHORT") return avgNum * (1 - rawPct);
  return avgNum * (1 + rawPct);
}

function resolveRules(row, sysCfg = {}, exchange = PROVIDER) {
  const f = resolveFeatures(row);
  const exitProfileMode = String(
    f.exit_profile ||
    f.exitProfile ||
    sysCfg.futures_exit_profile_mode ||
    "BASE"
  ).trim().toUpperCase();
  const rules = resolveExitRulesForPosition({ exchange, exitProfileMode });
  const nextRules = { ...rules };
  const dynSl = toNum(f.exit_policy_sl_pct ?? f.exitPolicySlPct);
  const dynTp1 = toNum(f.exit_policy_tp1_pct ?? f.exitPolicyTp1Pct);
  if (Number.isFinite(dynSl) && dynSl > 0) nextRules.SL = -(dynSl / 100);
  if (Number.isFinite(dynTp1) && dynTp1 > 0) nextRules.TP_P1 = dynTp1 / 100;
  return nextRules;
}

function resolveLeverage(row, sysCfg = {}) {
  const f = resolveFeatures(row);
  return (
    toNum(f.leverage) ??
    toNum(f.futures_leverage) ??
    toNum(f.external_leverage) ??
    toNum(row && row.leverage) ??
    toNum(sysCfg && sysCfg.futures_leverage) ??
    2
  );
}

function pickBarByTimestamp(bars = [], timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return null;
  return (Array.isArray(bars) ? bars : []).find((row) => Number(row.timestamp) === ts) || null;
}

function pickNextBar(bars = [], timestamp) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return null;
  return (Array.isArray(bars) ? bars : []).find((row) => Number(row.timestamp) > ts) || null;
}

function evaluatePathFromEntry({ bars = [], entryBarMs, entryPrice, side, rules, leverage, horizonMs = HORIZON_MS, nowMs = Date.now() } = {}) {
  const barMs = Number(entryBarMs);
  const entry = Number(entryPrice);
  if (!Number.isFinite(barMs) || !Number.isFinite(entry) || entry <= 0 || !side || !rules) {
    return { ok: false, skip_reason: "BAD_INPUT" };
  }
  const horizonEndMs = barMs + horizonMs;
  if (!Number.isFinite(nowMs) || nowMs < horizonEndMs) return { ok: false, skip_reason: "IMMATURE" };
  const futureBars = (Array.isArray(bars) ? bars : []).filter((row) => {
    const ts = Number(row && row.timestamp);
    return Number.isFinite(ts) && ts > barMs && ts <= horizonEndMs;
  });
  if (!futureBars.length) return { ok: false, skip_reason: "HORIZON_BARS_MISSING" };
  const tpPx = pnlToPrice({ avg: entry, pnlPct: Number(rules.TP_P1), side, leverage });
  const slPx = pnlToPrice({ avg: entry, pnlPct: Number(rules.SL), side, leverage });
  let outcome = "HOLD";
  let terminalRetNet = null;
  let exitBarMs = null;
  for (const bar of futureBars) {
    const tpHit = side === "LONG" ? (Number(bar.high) >= tpPx) : (Number(bar.low) <= tpPx);
    const slHit = side === "LONG" ? (Number(bar.low) <= slPx) : (Number(bar.high) >= slPx);
    if (tpHit && slHit) {
      outcome = "AMBIGUOUS_BOTH";
      exitBarMs = Number(bar.timestamp);
      break;
    }
    if (tpHit) {
      outcome = "TP1_FIRST";
      terminalRetNet = Number(rules.TP_P1);
      exitBarMs = Number(bar.timestamp);
      break;
    }
    if (slHit) {
      outcome = "SL_FIRST";
      terminalRetNet = Number(rules.SL);
      exitBarMs = Number(bar.timestamp);
      break;
    }
  }
  const horizonClose = Number(futureBars[futureBars.length - 1].close);
  const horizonRetNet = pctFromPriceMove({ entryPrice: entry, refPrice: horizonClose, side, leverage });
  const selectedRetNet = Number.isFinite(terminalRetNet) ? terminalRetNet : horizonRetNet;
  return {
    ok: true,
    outcome,
    exit_bar_ms: exitBarMs,
    horizon_ret_net: horizonRetNet,
    selected_ret_net: selectedRetNet,
    tp_price: tpPx,
    sl_price: slPx,
  };
}

function mapEstimateToWaitFeatures(estimate = {}) {
  return {
    ev_gate_same_dir_streak: estimate.sameDirStreak,
    ev_gate_chase_ratio: estimate.chaseRatio,
    ev_gate_last_close_control: estimate.lastCloseControl,
    ev_gate_last_dir_body: estimate.lastDirBody,
    ev_gate_last_opposite_wick: estimate.lastOppWick,
    ev_gate_recent_move_1_pct: estimate.recentMove1Pct,
    ev_gate_counter_dir_bars: estimate.counterDirBars,
  };
}

function evaluateWaitCounterfactual(row, bars = [], { sysCfg = {}, waitCfg = null, exchange = PROVIDER, nowMs = Date.now() } = {}) {
  const side = resolveSide(row);
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  const barMs = resolveDocMs(row);
  if (!market || !side || !Number.isFinite(barMs)) return { ok: false, skip_reason: "BAD_ROW" };
  const entryBar = pickBarByTimestamp(bars, barMs);
  const nextBar = pickNextBar(bars, barMs);
  if (!entryBar || !Number.isFinite(entryBar.close)) return { ok: false, skip_reason: "ENTRY_BAR_MISSING" };
  if (!nextBar || !Number.isFinite(nextBar.close)) return { ok: false, skip_reason: "NEXT_BAR_MISSING" };
  if (nowMs < (Number(nextBar.timestamp) + HORIZON_MS)) return { ok: false, skip_reason: "IMMATURE" };

  const rules = resolveRules(row, sysCfg, exchange);
  const leverage = resolveLeverage(row, sysCfg);
  const estimate = estimateTp1ReachProbability({
    bars,
    dir: side,
    tp1Pct: Math.abs(Number(rules.TP_P1) || 0) * 100,
    slPct: Math.abs(Number(rules.SL) || 0) * 100,
    barCloseMs: barMs,
    lookbackBars: LOOKBACK_BARS,
    atrBars: ATR_BARS,
  });
  if (!estimate || estimate.ok !== true) return { ok: false, skip_reason: String(estimate && estimate.skipReason || "ESTIMATE_UNAVAILABLE") };

  const waitFeatures = mapEstimateToWaitFeatures(estimate);
  const waitDecision = evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: side,
    eventUpper: String(row && row.event || "").toUpperCase(),
    cfg: waitCfg,
    features: waitFeatures,
  });

  const nowEval = evaluatePathFromEntry({
    bars,
    entryBarMs: barMs,
    entryPrice: Number(entryBar.close),
    side,
    rules,
    leverage,
    horizonMs: HORIZON_MS,
    nowMs,
  });
  if (!nowEval.ok) return { ok: false, skip_reason: `NOW_${nowEval.skip_reason}` };

  const waitEval = evaluatePathFromEntry({
    bars,
    entryBarMs: Number(nextBar.timestamp),
    entryPrice: Number(nextBar.close),
    side,
    rules,
    leverage,
    horizonMs: HORIZON_MS,
    nowMs,
  });
  if (!waitEval.ok) return { ok: false, skip_reason: `WAIT_${waitEval.skip_reason}` };

  const nowRet = Number(nowEval.selected_ret_net);
  const waitRet = Number(waitEval.selected_ret_net);
  const deltaRet = Number.isFinite(waitRet) && Number.isFinite(nowRet) ? (waitRet - nowRet) : null;
  const beneficialWait = Number.isFinite(deltaRet) ? (deltaRet > BENEFIT_MARGIN) : false;
  const harmfulWait = Number.isFinite(deltaRet) ? (deltaRet < (-BENEFIT_MARGIN)) : false;
  const policyTriggered = waitDecision && waitDecision.ok === false && String(waitDecision.action || "").toUpperCase() === "WAIT_ONE_BAR";
  const policyOutcome = policyTriggered ? waitEval : nowEval;

  return {
    ok: true,
    signal_key: makeSignalKey(row),
    source: String(row && row.drop_reason_code || "").toUpperCase() === "DROP_WAIT_ONE_BAR_TIMING" ? "WAIT_DROP" : "ENTRY",
    market,
    tier: resolveTier(row && row.event),
    side,
    event: String(row && row.event || "").toUpperCase(),
    bar_ms: barMs,
    next_bar_ms: Number(nextBar.timestamp),
    rules,
    leverage,
    wait_features: waitFeatures,
    estimate_probability: estimate.probability,
    estimate_lower_bound: estimate.lowerBound,
    now_outcome: nowEval.outcome,
    wait_outcome: waitEval.outcome,
    now_ret_net: nowRet,
    wait_ret_net: waitRet,
    delta_ret_net: deltaRet,
    beneficial_wait: beneficialWait,
    harmful_wait: harmfulWait,
    policy_triggered: policyTriggered,
    policy_ret_net: Number(policyOutcome.selected_ret_net),
    policy_outcome: policyOutcome.outcome,
  };
}

function uniqueBySignalKey(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = makeSignalKey(row);
    if (!key) continue;
    if (!map.has(key)) map.set(key, row);
  }
  return Array.from(map.values());
}

function filterEntryCandidates(rows = [], { exchange = PROVIDER, tf = TF, fromMs, toMs, waitOnly = false } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    const reason = String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase();
    if (ex !== exchange) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (!isEntryTierEvent(event)) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    if (waitOnly) return reason === "DROP_WAIT_ONE_BAR_TIMING";
    return true;
  });
}

function summarizePlan(evals = []) {
  const rows = Array.isArray(evals) ? evals.filter((row) => row && row.ok === true) : [];
  const summary = {
    sample_n: rows.length,
    trigger_n: 0,
    trigger_rate: null,
    beneficial_wait_n: 0,
    beneficial_wait_rate: null,
    harmful_wait_n: 0,
    harmful_wait_rate: null,
    avg_now_ret_net: null,
    avg_wait_ret_net: null,
    avg_policy_ret_net: null,
    delta_avg_ret_net: null,
    policy_tp1_rate: null,
    policy_sl_rate: null,
    policy_neg_rate: null,
  };
  if (!rows.length) return summary;
  let nowSum = 0;
  let waitSum = 0;
  let policySum = 0;
  let policyTp1 = 0;
  let policySl = 0;
  let policyNeg = 0;
  for (const row of rows) {
    nowSum += Number(row.now_ret_net || 0);
    waitSum += Number(row.wait_ret_net || 0);
    policySum += Number(row.policy_ret_net || 0);
    if (row.policy_triggered) summary.trigger_n += 1;
    if (row.policy_triggered && row.beneficial_wait) summary.beneficial_wait_n += 1;
    if (row.policy_triggered && row.harmful_wait) summary.harmful_wait_n += 1;
    if (String(row.policy_outcome || "") === "TP1_FIRST") policyTp1 += 1;
    if (String(row.policy_outcome || "") === "SL_FIRST") policySl += 1;
    if (Number(row.policy_ret_net) < 0) policyNeg += 1;
  }
  summary.trigger_rate = summary.sample_n > 0 ? (summary.trigger_n / summary.sample_n) : null;
  summary.beneficial_wait_rate = summary.trigger_n > 0 ? (summary.beneficial_wait_n / summary.trigger_n) : null;
  summary.harmful_wait_rate = summary.trigger_n > 0 ? (summary.harmful_wait_n / summary.trigger_n) : null;
  summary.avg_now_ret_net = nowSum / summary.sample_n;
  summary.avg_wait_ret_net = waitSum / summary.sample_n;
  summary.avg_policy_ret_net = policySum / summary.sample_n;
  summary.delta_avg_ret_net = summary.avg_policy_ret_net - summary.avg_now_ret_net;
  summary.policy_tp1_rate = policyTp1 / summary.sample_n;
  summary.policy_sl_rate = policySl / summary.sample_n;
  summary.policy_neg_rate = policyNeg / summary.sample_n;
  return summary;
}

function comparePlans(a, b, targetRate = TARGET_BENEFICIAL_WAIT_RATE) {
  const aTarget = Number.isFinite(a.beneficial_wait_rate) && a.beneficial_wait_rate >= targetRate ? 1 : 0;
  const bTarget = Number.isFinite(b.beneficial_wait_rate) && b.beneficial_wait_rate >= targetRate ? 1 : 0;
  if (aTarget !== bTarget) return bTarget - aTarget;
  const ax = Number.isFinite(a.avg_policy_ret_net) ? a.avg_policy_ret_net : -1e18;
  const bx = Number.isFinite(b.avg_policy_ret_net) ? b.avg_policy_ret_net : -1e18;
  if (Math.abs(ax - bx) > EPS) return bx - ax;
  const aDd = Number.isFinite(a.policy_neg_rate) ? a.policy_neg_rate : 1e18;
  const bDd = Number.isFinite(b.policy_neg_rate) ? b.policy_neg_rate : 1e18;
  if (Math.abs(aDd - bDd) > EPS) return aDd - bDd;
  const aTrigger = Number.isFinite(a.trigger_rate) ? a.trigger_rate : 1e18;
  const bTrigger = Number.isFinite(b.trigger_rate) ? b.trigger_rate : 1e18;
  if (Math.abs(aTrigger - bTrigger) > EPS) return aTrigger - bTrigger;
  return 0;
}

function meetsBeneficialTarget(summary, targetRate = TARGET_BENEFICIAL_WAIT_RATE) {
  const rate = Number(summary && summary.beneficial_wait_rate);
  return Number.isFinite(rate) && rate >= targetRate;
}

function shouldApplyBestPlan(currentSummary, bestSummary, cfgChanged, targetRate = TARGET_BENEFICIAL_WAIT_RATE, sharedObjective = null) {
  if (!cfgChanged || !bestSummary) return false;
  if (!meetsBeneficialTarget(bestSummary, targetRate)) return false;
  if (!sharedObjectiveAllowsPlan(sharedObjective, currentSummary, bestSummary)) return false;
  return comparePlans(currentSummary, bestSummary, targetRate) > 0;
}

function buildCandidateConfigs(currentCfg) {
  const streaks = uniqSorted([currentCfg.sameDirStreakMin - 1, currentCfg.sameDirStreakMin, currentCfg.sameDirStreakMin + 1].map((v) => clampInt(v, 2, 5, currentCfg.sameDirStreakMin)));
  const chase = uniqSorted([currentCfg.chaseRatioMin - 0.25, currentCfg.chaseRatioMin, currentCfg.chaseRatioMin + 0.25].map((v) => clampNumber(v, 0.8, 3.2, currentCfg.chaseRatioMin)));
  const closeControl = uniqSorted([currentCfg.lastCloseControlMin - 0.05, currentCfg.lastCloseControlMin, currentCfg.lastCloseControlMin + 0.05].map((v) => clampNumber(v, 0.6, 0.95, currentCfg.lastCloseControlMin)));
  const dirBody = uniqSorted([currentCfg.lastDirBodyMin - 0.05, currentCfg.lastDirBodyMin, currentCfg.lastDirBodyMin + 0.05].map((v) => clampNumber(v, 0.2, 0.75, currentCfg.lastDirBodyMin)));
  const oppWick = uniqSorted([currentCfg.lastOppWickMax - 0.04, currentCfg.lastOppWickMax, currentCfg.lastOppWickMax + 0.04].map((v) => clampNumber(v, 0.05, 0.35, currentCfg.lastOppWickMax)));
  const move1 = uniqSorted([currentCfg.recentMove1PctMin - 0.10, currentCfg.recentMove1PctMin, currentCfg.recentMove1PctMin + 0.10].map((v) => clampNumber(v, 0.10, 1.20, currentCfg.recentMove1PctMin)));
  const counterBars = uniqSorted([currentCfg.counterDirBarsMax, currentCfg.counterDirBarsMax + 1].map((v) => clampInt(v, 0, 2, currentCfg.counterDirBarsMax)));

  const out = [];
  for (const sameDirStreakMin of streaks) {
    for (const chaseRatioMin of chase) {
      for (const lastCloseControlMin of closeControl) {
        for (const lastDirBodyMin of dirBody) {
          for (const lastOppWickMax of oppWick) {
            for (const recentMove1PctMin of move1) {
              for (const counterDirBarsMax of counterBars) {
                out.push({
                  enabled: true,
                  applyCore: currentCfg.applyCore,
                  applyPreReal: currentCfg.applyPreReal,
                  applyReal: currentCfg.applyReal,
                  applyEarly: currentCfg.applyEarly,
                  sameDirStreakMin,
                  chaseRatioMin,
                  lastCloseControlMin,
                  lastDirBodyMin,
                  lastOppWickMax,
                  recentMove1PctMin,
                  counterDirBarsMax,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

function configKey(cfg = {}) {
  return [
    cfg.sameDirStreakMin,
    roundTo(cfg.chaseRatioMin, 2),
    roundTo(cfg.lastCloseControlMin, 2),
    roundTo(cfg.lastDirBodyMin, 2),
    roundTo(cfg.lastOppWickMax, 2),
    roundTo(cfg.recentMove1PctMin, 2),
    cfg.counterDirBarsMax,
  ].join("|");
}

function summarizeConfig(cfg = {}) {
  return {
    wait_one_bar_same_dir_streak_min: cfg.sameDirStreakMin,
    wait_one_bar_chase_ratio_min: roundTo(cfg.chaseRatioMin, 3),
    wait_one_bar_last_close_control_min: roundTo(cfg.lastCloseControlMin, 3),
    wait_one_bar_last_dir_body_min: roundTo(cfg.lastDirBodyMin, 3),
    wait_one_bar_last_opposite_wick_max: roundTo(cfg.lastOppWickMax, 3),
    wait_one_bar_recent_move1_pct_min: roundTo(cfg.recentMove1PctMin, 3),
    wait_one_bar_counter_dir_bars_max: cfg.counterDirBarsMax,
  };
}

function planReason({ current, best, changed, enoughSample, enoughTriggers, targetRate = TARGET_BENEFICIAL_WAIT_RATE, sharedObjective = null }) {
  if (!enoughSample) return "INSUFFICIENT_SAMPLE";
  if (!enoughTriggers) return "TRIGGER_SAMPLE_TOO_SMALL";
  if (!best) return "NO_CANDIDATE";
  const currentTarget = meetsBeneficialTarget(current, targetRate);
  const bestTarget = meetsBeneficialTarget(best, targetRate);
  if (!changed && !bestTarget && !currentTarget) return "TARGET_NOT_MET";
  if (!changed && bestTarget && !sharedObjectiveAllowsPlan(sharedObjective, current, best)) return "SHARED_OBJECTIVE_BLOCK";
  if (!changed) return "KEEP_CURRENT";
  const delta = Number(best.delta_avg_ret_net || 0) - Number(current.delta_avg_ret_net || 0);
  if (Math.abs(delta) <= EPS) return "NO_MATERIAL_IMPROVEMENT";
  return delta > 0 ? "EXPECTANCY_IMPROVED" : "EXPECTANCY_NOT_IMPROVED";
}

function evaluateConfigOnRows(cfg, rows = []) {
  const evals = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.ok !== true) continue;
    const waitDecision = evaluateWaitOneBarTiming({
      intent: "ENTRY",
      intentDir: row.side,
      eventUpper: row.event,
      cfg,
      features: row.wait_features,
    });
    const policyTriggered = waitDecision && waitDecision.ok === false && String(waitDecision.action || "").toUpperCase() === "WAIT_ONE_BAR";
    const policyRet = policyTriggered ? row.wait_ret_net : row.now_ret_net;
    const policyOutcome = policyTriggered ? row.wait_outcome : row.now_outcome;
    evals.push({
      ...row,
      policy_triggered: policyTriggered,
      policy_ret_net: policyRet,
      policy_outcome: policyOutcome,
    });
  }
  return summarizePlan(evals);
}

function pickBestPlan(currentCfg, rows = [], sharedObjective = null) {
  const current = evaluateConfigOnRows(currentCfg, rows);
  const candidates = buildCandidateConfigs(currentCfg)
    .map((cfg) => ({ cfg, summary: evaluateConfigOnRows(cfg, rows) }))
    .filter((row) => row.summary.sample_n >= MIN_SAMPLE)
    .filter((row) => row.summary.trigger_n >= MIN_TRIGGER_SAMPLE);

  let best = null;
  for (const row of candidates) {
    if (!best || comparePlans(best.summary, row.summary, TARGET_BENEFICIAL_WAIT_RATE) > 0) best = row;
  }
  const enoughSample = current.sample_n >= MIN_SAMPLE;
  const enoughTriggers = (best ? best.summary.trigger_n : current.trigger_n) >= MIN_TRIGGER_SAMPLE;
  const cfgChanged = !!best && configKey(best.cfg) !== configKey(currentCfg);
  const changed = !!best && shouldApplyBestPlan(current, best.summary, cfgChanged, TARGET_BENEFICIAL_WAIT_RATE, sharedObjective);
  return {
    current,
    best,
    nextCfg: changed ? best.cfg : currentCfg,
    changed,
    reason: planReason({ current, best: best && best.summary, changed, enoughSample, enoughTriggers, targetRate: TARGET_BENEFICIAL_WAIT_RATE, sharedObjective }),
    enoughSample,
    enoughTriggers,
    candidates: candidates.slice().sort((a, b) => comparePlans(a.summary, b.summary, TARGET_BENEFICIAL_WAIT_RATE)).slice(0, 12),
  };
}

function readFreshMlPolicyReport(nowMs) {
  const filePath = path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json");
  const data = readJsonRawSafe(filePath, null);
  if (!data || typeof data !== "object") return { filePath, data: null, age_ms: null, fresh: false };
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const mtimeMs = stat ? Number(stat.mtimeMs) : null;
  const ageMs = Number.isFinite(mtimeMs) ? Math.max(0, nowMs - mtimeMs) : null;
  const fresh = Number.isFinite(ageMs) ? ageMs <= (ML_POLICY_MAX_AGE_HOURS * 60 * 60 * 1000) : false;
  return { filePath, data, age_ms: ageMs, fresh };
}

function readFreshWaitStateMachineLedger(nowMs) {
  const filePath = path.join(OPS_DAILY_DIR, "wait_state_machine_latest.json");
  const data = readJsonRawSafe(filePath, null);
  if (!data || typeof data !== "object") return { filePath, data: null, age_ms: null, fresh: false };
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const mtimeMs = stat ? Number(stat.mtimeMs) : null;
  const ageMs = Number.isFinite(mtimeMs) ? Math.max(0, nowMs - mtimeMs) : null;
  const fresh = Number.isFinite(ageMs) ? ageMs <= (STAGE_LEDGER_MAX_AGE_HOURS * 60 * 60 * 1000) : false;
  return { filePath, data, age_ms: ageMs, fresh };
}

function readFreshWeeklyGovernance(nowMs) {
  const filePath = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
  const data = readJsonRawSafe(filePath, null);
  if (!data || typeof data !== "object") {
    return {
      filePath,
      data: null,
      age_ms: null,
      fresh: false,
      objectiveConfig: { min_monthly_net_krw: OBJECTIVE_TARGET_MONTHLY_KRW },
      currentObjective: null,
      previousObjective: null,
    };
  }
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  const mtimeMs = stat ? Number(stat.mtimeMs) : null;
  const ageMs = Number.isFinite(mtimeMs) ? Math.max(0, nowMs - mtimeMs) : null;
  const fresh = Number.isFinite(ageMs) ? ageMs <= (WEEKLY_GOVERNANCE_MAX_AGE_HOURS * 60 * 60 * 1000) : false;
  return {
    filePath,
    data,
    age_ms: ageMs,
    fresh,
    objectiveConfig: data.objective && typeof data.objective === "object"
      ? data.objective
      : { min_monthly_net_krw: OBJECTIVE_TARGET_MONTHLY_KRW },
    currentObjective: data.current && data.current.objective && typeof data.current.objective === "object" ? data.current.objective : null,
    previousObjective: data.previous && data.previous.objective && typeof data.previous.objective === "object" ? data.previous.objective : null,
  };
}

function sharedObjectiveNeedsProfitRecovery(sharedObjective) {
  const current = sharedObjective && sharedObjective.currentObjective;
  if (!current || typeof current !== "object") return false;
  return current.monthly_pass === false || current.net_pass === false || current.ev_pass === false || current.win_pass === false;
}

function sharedObjectiveAllowsPlan(sharedObjective, currentSummary, bestSummary) {
  if (!sharedObjectiveNeedsProfitRecovery(sharedObjective)) return true;
  const currentRet = Number(currentSummary && currentSummary.avg_policy_ret_net);
  const bestRet = Number(bestSummary && bestSummary.avg_policy_ret_net);
  const currentNeg = Number(currentSummary && currentSummary.policy_neg_rate);
  const bestNeg = Number(bestSummary && bestSummary.policy_neg_rate);
  if (!Number.isFinite(currentRet) || !Number.isFinite(bestRet)) return false;
  if (bestRet <= (currentRet + EPS)) return false;
  if (Number.isFinite(currentNeg) && Number.isFinite(bestNeg) && bestNeg > (currentNeg + EPS)) return false;
  return true;
}

function isWaitTighteningChange(currentCfg = {}, nextCfg = {}) {
  return (
    Number(nextCfg.sameDirStreakMin) > Number(currentCfg.sameDirStreakMin)
    || Number(nextCfg.chaseRatioMin) > Number(currentCfg.chaseRatioMin)
    || Number(nextCfg.lastCloseControlMin) > Number(currentCfg.lastCloseControlMin)
    || Number(nextCfg.lastDirBodyMin) > Number(currentCfg.lastDirBodyMin)
    || Number(nextCfg.lastOppWickMax) < Number(currentCfg.lastOppWickMax)
    || Number(nextCfg.recentMove1PctMin) > Number(currentCfg.recentMove1PctMin)
    || Number(nextCfg.counterDirBarsMax) < Number(currentCfg.counterDirBarsMax)
  );
}

function bestFebtAllowsWaitPlan(bestFebtContract = null, currentCfg = {}, nextCfg = {}) {
  if (!bestFebtContract || typeof bestFebtContract !== "object") return true;
  const tightening = isWaitTighteningChange(currentCfg, nextCfg);
  if (!tightening) return true;
  if (bestFebtContract.tightening_allowed === false) return false;
  if (bestFebtContract.recovery_priority === true) return false;
  return true;
}

function renderMarkdown({ nowMeta, provider, tf, currentCfg, plan, rows, cacheMeta, mlPolicyReport, stageLedger, weeklyGovernance, bestFebtContract }) {
  const lines = [];
  lines.push("# WAIT_ONE_BAR Tune");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push(`- 대상: ${provider} ${tf}`);
  lines.push(`- 평가 윈도우: 최근 ${LOOKBACK_DAYS}일`);
  lines.push(`- horizon: ${HORIZON_HOURS}시간`);
  lines.push(`- 목표 beneficial wait rate: ${pct(TARGET_BENEFICIAL_WAIT_RATE)}`);
  lines.push(`- 공통 목표 월간 순수익: ${Number(weeklyGovernance && weeklyGovernance.objectiveConfig && weeklyGovernance.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW`);
  lines.push(`- sample: ${plan.current.sample_n}`);
  lines.push(`- trigger sample(current): ${plan.current.trigger_n}`);
  lines.push(`- 현재 avg_now_ret_net: ${signedPct(plan.current.avg_now_ret_net)}`);
  lines.push(`- 현재 avg_policy_ret_net: ${signedPct(plan.current.avg_policy_ret_net)}`);
  lines.push(`- 현재 delta_avg_ret_net: ${signedPct(plan.current.delta_avg_ret_net)}`);
  lines.push(`- 현재 beneficial wait rate: ${pct(plan.current.beneficial_wait_rate)}`);
  lines.push(`- 현재 trigger rate: ${pct(plan.current.trigger_rate)}`);
  lines.push(`- 현재 policy TP1 rate: ${pct(plan.current.policy_tp1_rate)}`);
  lines.push(`- 현재 policy negative rate: ${pct(plan.current.policy_neg_rate)}`);
  lines.push(`- 결정: ${plan.changed ? "UPDATE" : "KEEP"}`);
  lines.push(`- 사유: ${plan.reason}`);
  lines.push(`- 공통 목표 상태: ${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"}`);
  lines.push(`- 월간 페이스: ${weeklyGovernance && weeklyGovernance.currentObjective && Number.isFinite(Number(weeklyGovernance.currentObjective.monthly_run_rate_krw)) ? `${Number(weeklyGovernance.currentObjective.monthly_run_rate_krw).toLocaleString("ko-KR")} KRW` : "N/A"}`);
  lines.push(`- BEST/FEBT contract: ${bestFebtContract && bestFebtContract.mode || "N/A"} / replacement ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "N/A"} / count ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`);
  lines.push("");
  lines.push("## 현재 설정");
  for (const [key, value] of Object.entries(summarizeConfig(currentCfg))) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push("## 적용 설정");
  for (const [key, value] of Object.entries(summarizeConfig(plan.nextCfg))) {
    lines.push(`- ${key}: ${value}`);
  }
  if (plan.best) {
    lines.push("");
    lines.push("## 추천 성과");
    lines.push(`- avg_policy_ret_net: ${signedPct(plan.best.summary.avg_policy_ret_net)}`);
    lines.push(`- delta_avg_ret_net: ${signedPct(plan.best.summary.delta_avg_ret_net)}`);
    lines.push(`- beneficial wait rate: ${pct(plan.best.summary.beneficial_wait_rate)}`);
    lines.push(`- trigger rate: ${pct(plan.best.summary.trigger_rate)}`);
    lines.push(`- policy TP1 rate: ${pct(plan.best.summary.policy_tp1_rate)}`);
    lines.push(`- policy negative rate: ${pct(plan.best.summary.policy_neg_rate)}`);
  }
  lines.push("");
  lines.push("## 상위 후보");
  for (const row of plan.candidates.slice(0, 8)) {
    const cfg = summarizeConfig(row.cfg);
    lines.push(`- streak=${cfg.wait_one_bar_same_dir_streak_min} / chase=${ratioX(cfg.wait_one_bar_chase_ratio_min)} / close=${cfg.wait_one_bar_last_close_control_min} / body=${cfg.wait_one_bar_last_dir_body_min} / wick=${cfg.wait_one_bar_last_opposite_wick_max} / move1=${cfg.wait_one_bar_recent_move1_pct_min} / counter=${cfg.wait_one_bar_counter_dir_bars_max}`);
    lines.push(`  - delta=${signedPct(row.summary.delta_avg_ret_net)} / beneficial=${pct(row.summary.beneficial_wait_rate)} / trigger=${pct(row.summary.trigger_rate)} / tp1=${pct(row.summary.policy_tp1_rate)} / neg=${pct(row.summary.policy_neg_rate)}`);
  }
  lines.push("");
  lines.push("## 실제 비교");
  const beneficial = rows.filter((row) => row.ok === true && row.beneficial_wait).length;
  const harmful = rows.filter((row) => row.ok === true && row.harmful_wait).length;
  const flat = rows.filter((row) => row.ok === true && !row.beneficial_wait && !row.harmful_wait).length;
  lines.push(`- beneficial waits: ${beneficial}`);
  lines.push(`- harmful waits: ${harmful}`);
  lines.push(`- flat/indifferent: ${flat}`);
  const byTier = ["EARLY", "CORE"].map((tier) => {
    const scoped = rows.filter((row) => row.ok === true && row.tier === tier);
    return {
      tier,
      n: scoped.length,
      beneficial: scoped.filter((row) => row.beneficial_wait).length,
      harmful: scoped.filter((row) => row.harmful_wait).length,
      avgDelta: scoped.length ? scoped.reduce((acc, row) => acc + Number(row.delta_ret_net || 0), 0) / scoped.length : null,
    };
  }).filter((row) => row.n > 0);
  for (const row of byTier) {
    lines.push(`- ${describeTimingTierForUser(row.tier)}: n=${row.n} / beneficial=${row.beneficial} / harmful=${row.harmful} / avg_delta=${signedPct(row.avgDelta)}`);
  }
  if (cacheMeta) {
    lines.push("");
    lines.push("## 로컬 증분 캐시");
    lines.push(`- signals: ${cacheMeta.signals.filePath} / cached=${cacheMeta.signals.count} / new=${cacheMeta.signals.fetched_new} / overlap=${cacheMeta.signals.overlap_fetched}`);
    lines.push(`- signals_dropped: ${cacheMeta.drops.filePath} / cached=${cacheMeta.drops.count} / new=${cacheMeta.drops.fetched_new} / overlap=${cacheMeta.drops.overlap_fetched}`);
  }
  lines.push("");
  lines.push("## Stage Outcome Ledger");
  lines.push(`- file: ${stageLedger && stageLedger.filePath ? stageLedger.filePath : "N/A"}`);
  lines.push(`- source: ${stageLedger && stageLedger.source ? stageLedger.source : "N/A"}`);
  lines.push(`- age: ${stageLedger && Number.isFinite(stageLedger.age_ms) ? `${Math.round(stageLedger.age_ms / 60000)}분` : "N/A"}`);
  lines.push(`- fresh: ${stageLedger && stageLedger.fresh ? "YES" : "NO"}`);
  lines.push("");
  lines.push("## ML 정책 연계");
  lines.push(`- ML report: ${(mlPolicyReport && mlPolicyReport.filePath) || "N/A"}`);
  lines.push(`- ML report age: ${mlPolicyReport && Number.isFinite(mlPolicyReport.age_ms) ? `${Math.round(mlPolicyReport.age_ms / 60000)}분` : "N/A"}`);
  lines.push(`- ML report fresh: ${mlPolicyReport && mlPolicyReport.fresh ? "YES" : "NO"}`);
  lines.push("");
  lines.push("## 공통 목표 연계");
  lines.push(`- governance: ${(weeklyGovernance && weeklyGovernance.filePath) || "N/A"}`);
  lines.push(`- governance age: ${weeklyGovernance && Number.isFinite(weeklyGovernance.age_ms) ? `${Math.round(weeklyGovernance.age_ms / 60000)}분` : "N/A"}`);
  lines.push(`- governance fresh: ${weeklyGovernance && weeklyGovernance.fresh ? "YES" : "NO"}`);
  lines.push(`- current verdict: ${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"}`);
  lines.push(`- monthly pass: ${weeklyGovernance && weeklyGovernance.currentObjective ? (weeklyGovernance.currentObjective.monthly_pass ? "YES" : "NO") : "N/A"}`);
  lines.push(`- monthly pace: ${weeklyGovernance && weeklyGovernance.currentObjective && Number.isFinite(Number(weeklyGovernance.currentObjective.monthly_run_rate_krw)) ? `${Number(weeklyGovernance.currentObjective.monthly_run_rate_krw).toLocaleString("ko-KR")} KRW` : "N/A"}`);
  return `${lines.join("\n")}\n`;
}

async function updateProviderWaitSettings({ provider, nextCfg, currentSys }) {
  const db = getFirestore();
  const ref = db.collection("settings").doc("system");
  const prefix = `providers.${provider}`;
  const updatedAt = new Date().toISOString();
  const patch = {
    [`${prefix}.provider`]: provider,
    [`${prefix}.updated_at`]: updatedAt,
    [`${prefix}.updated_by`]: "automation-wait-one-bar-tune",
    [`${prefix}.wait_one_bar_enabled`]: true,
    [`${prefix}.wait_one_bar_core_enabled`]: currentSys.wait_one_bar_core_enabled !== false,
    [`${prefix}.wait_one_bar_pre_real_enabled`]: false,
    [`${prefix}.wait_one_bar_real_enabled`]: false,
    [`${prefix}.wait_one_bar_early_enabled`]: currentSys.wait_one_bar_early_enabled !== false,
    [`${prefix}.wait_one_bar_same_dir_streak_min`]: clampInt(nextCfg.sameDirStreakMin, 2, 5, 3),
    [`${prefix}.wait_one_bar_chase_ratio_min`]: clampNumber(nextCfg.chaseRatioMin, 0.8, 3.2, 1.75),
    [`${prefix}.wait_one_bar_last_close_control_min`]: clampNumber(nextCfg.lastCloseControlMin, 0.6, 0.95, 0.80),
    [`${prefix}.wait_one_bar_last_dir_body_min`]: clampNumber(nextCfg.lastDirBodyMin, 0.2, 0.75, 0.45),
    [`${prefix}.wait_one_bar_last_opposite_wick_max`]: clampNumber(nextCfg.lastOppWickMax, 0.05, 0.35, 0.18),
    [`${prefix}.wait_one_bar_recent_move1_pct_min`]: clampNumber(nextCfg.recentMove1PctMin, 0.10, 1.20, 0.45),
    [`${prefix}.wait_one_bar_counter_dir_bars_max`]: clampInt(nextCfg.counterDirBarsMax, 0, 2, 0),
    updated_at: updatedAt,
  };
  const strayLiteralKeys = [
    `providers.${provider}.wait_one_bar_enabled`,
    `providers.${provider}.wait_one_bar_core_enabled`,
    `providers.${provider}.wait_one_bar_pre_real_enabled`,
    `providers.${provider}.wait_one_bar_real_enabled`,
    `providers.${provider}.wait_one_bar_early_enabled`,
    `providers.${provider}.wait_one_bar_same_dir_streak_min`,
    `providers.${provider}.wait_one_bar_chase_ratio_min`,
    `providers.${provider}.wait_one_bar_last_close_control_min`,
    `providers.${provider}.wait_one_bar_last_dir_body_min`,
    `providers.${provider}.wait_one_bar_last_opposite_wick_max`,
    `providers.${provider}.wait_one_bar_recent_move1_pct_min`,
    `providers.${provider}.wait_one_bar_counter_dir_bars_max`,
  ];
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.set(ref, { providers: { [provider]: { provider } } }, { merge: true });
    tx.update(ref, patch);
    const deleteArgs = [];
    for (const key of strayLiteralKeys) deleteArgs.push(new FieldPath(key), FieldValue.delete());
    if (deleteArgs.length) tx.update(ref, ...deleteArgs);
  });
  invalidateSettingsCache("system");
  return patch;
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const nowMs = nowMeta.nowMs;
  const fromMs = nowMs - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const sysRes = await getSystemSettingsForProvider(PROVIDER, 0);
  const currentSys = sysRes && sysRes.data ? sysRes.data : {};
  const currentCfg = resolveWaitOneBarConfig(currentSys, PROVIDER);
  const mlPolicyReport = readFreshMlPolicyReport(nowMs);
  const stageLedgerReport = readFreshWaitStateMachineLedger(nowMs);
  const weeklyGovernance = readFreshWeeklyGovernance(nowMs);
  const bestFebtContext = readBestFebtSupervisorContext(nowMs);
  const bestFebtContract = bestFebtContext.contract;

  const [signalsRes, dropsRes] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
  ]);

  const signalRows = filterEntryCandidates(signalsRes.rows, { exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs, waitOnly: false });
  const waitDropRows = filterEntryCandidates(dropsRes.rows, { exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs, waitOnly: true });
  const universeN = uniqueBySignalKey(signalRows.concat(waitDropRows)).length;
  let evaluatedRows = [];
  let stageLedgerMeta = {
    filePath: stageLedgerReport.filePath,
    age_ms: stageLedgerReport.age_ms,
    fresh: false,
    source: "REBUILT_FROM_CACHE",
  };
  if (
    stageLedgerReport &&
    stageLedgerReport.fresh === true &&
    stageLedgerReport.data &&
    String(stageLedgerReport.data.provider || "").toUpperCase() === PROVIDER &&
    String(stageLedgerReport.data.tf || "") === TF
  ) {
    evaluatedRows = Array.isArray(stageLedgerReport.data.rows) ? stageLedgerReport.data.rows : [];
    stageLedgerMeta = {
      filePath: stageLedgerReport.filePath,
      age_ms: stageLedgerReport.age_ms,
      fresh: true,
      source: "FRESH_LEDGER",
    };
  } else {
    const waitLedger = await buildWaitStateMachineLedger({
      provider: PROVIDER,
      tf: TF,
      fromMs,
      toMs: nowMs,
      nowMs,
      horizonHours: HORIZON_HOURS,
      signals: signalsRes.rows,
      drops: dropsRes.rows,
      sysCfg: currentSys,
    });
    evaluatedRows = Array.isArray(waitLedger.rows) ? waitLedger.rows : [];
  }
  const maturedRows = evaluatedRows.filter((row) => row && row.ok === true);
  const skippedRows = evaluatedRows.filter((row) => !row || row.ok !== true);

  const plan = pickBestPlan(currentCfg, maturedRows, weeklyGovernance);
  if (plan.changed && !bestFebtAllowsWaitPlan(bestFebtContract, currentCfg, plan.best && plan.best.cfg ? plan.best.cfg : currentCfg)) {
    plan.changed = false;
    plan.nextCfg = currentCfg;
    plan.reason = bestFebtContract && bestFebtContract.tightening_allowed === false
      ? "BEST_FEBT_COUNT_GUARD_BLOCK"
      : "BEST_FEBT_RECOVERY_GUARD_BLOCK";
  }
  let autopilotSnapshot = null;
  if (plan.changed && plan.enoughSample && plan.enoughTriggers) {
    autopilotSnapshot = writeStageSnapshot({
      stage: "WAIT",
      provider: PROVIDER,
      snapshot: pickSettingsSnapshot(currentSys, WAIT_SNAPSHOT_KEYS),
      meta: {
        source: "automation-wait-one-bar-tune",
        current: summarizeConfig(currentCfg),
        next: summarizeConfig(plan.nextCfg),
        reason: plan.reason,
      },
    });
    await updateProviderWaitSettings({ provider: PROVIDER, nextCfg: plan.nextCfg, currentSys });
  }

  const timestamp = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const baseName = `${timestamp}_wait_one_bar_tune`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${baseName}.md`);
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    lookback_days: LOOKBACK_DAYS,
    horizon_hours: HORIZON_HOURS,
    target_beneficial_wait_rate: TARGET_BENEFICIAL_WAIT_RATE,
    objective_target_monthly_net_krw: Number(weeklyGovernance && weeklyGovernance.objectiveConfig && weeklyGovernance.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW),
    current: summarizeConfig(currentCfg),
    next: summarizeConfig(plan.nextCfg),
    changed: plan.changed,
    reason: plan.reason,
    enough_sample: plan.enoughSample,
    enough_trigger_sample: plan.enoughTriggers,
    current_summary: plan.current,
    best_summary: plan.best ? plan.best.summary : null,
    candidates: plan.candidates.map((row) => ({ cfg: summarizeConfig(row.cfg), summary: row.summary })),
    counters: {
      universe_n: universeN,
      matured_n: maturedRows.length,
      skipped_n: skippedRows.length,
      wait_drop_rows_n: waitDropRows.length,
      signal_rows_n: signalRows.length,
    },
    skipped_top: skippedRows.reduce((acc, row) => {
      const key = String(row && row.skip_reason || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
    artifacts: {
      jsonPath,
      mdPath,
      cache: {
        signals: signalsRes.meta,
        drops: dropsRes.meta,
      },
      ml_policy_report: mlPolicyReport.filePath,
      weekly_governance_report: weeklyGovernance.filePath,
      wait_state_machine_ledger: stageLedgerMeta.filePath,
      wait_state_machine_ledger_source: stageLedgerMeta.source,
      autopilot_snapshot_path: autopilotSnapshot && autopilotSnapshot.filePath ? autopilotSnapshot.filePath : null,
    },
    shared_objective: {
      current: weeklyGovernance.currentObjective,
      previous: weeklyGovernance.previousObjective,
      fresh: weeklyGovernance.fresh,
    },
    best_febt_tuning_contract: bestFebtContract,
  };

  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown({
    nowMeta,
    provider: PROVIDER,
    tf: TF,
    currentCfg,
    plan,
    rows: maturedRows,
    cacheMeta: { signals: signalsRes.meta, drops: dropsRes.meta },
    mlPolicyReport,
    stageLedger: stageLedgerMeta,
    weeklyGovernance,
    bestFebtContract,
  }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.md"));

  await sendKoreanTelegramSummary({
    title: `[5차 진입 타이밍 자동 조정] ${PROVIDER}`,
    provider: PROVIDER,
    severity: plan.changed ? "INFO" : "WARN",
    sections: [
      {
        header: "이번 결론",
        lines: [
          `대상 ${PROVIDER} ${TF}`,
          `결정 ${plan.changed ? "UPDATE" : "KEEP"}`,
          `사유 ${plan.reason}`,
          `표본 ${plan.current.sample_n} / trigger ${plan.current.trigger_n}`,
          `stage ledger ${stageLedgerMeta.source} / ${stageLedgerMeta.filePath || "N/A"}`,
          `공통목표 ${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"} / 월간 ${weeklyGovernance && weeklyGovernance.currentObjective && Number.isFinite(Number(weeklyGovernance.currentObjective.monthly_run_rate_krw)) ? `${Number(weeklyGovernance.currentObjective.monthly_run_rate_krw).toLocaleString("ko-KR")} KRW` : "N/A"}`,
          `BEST/FEBT ${bestFebtContract && bestFebtContract.mode || "N/A"} / replacement ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "N/A"} / count ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`,
        ],
      },
      {
        header: "성과",
        lines: [
          `현재 delta ${signedPct(plan.current.delta_avg_ret_net)}`,
          `beneficial wait ${pct(plan.current.beneficial_wait_rate)}`,
          `trigger rate ${pct(plan.current.trigger_rate)}`,
          `TP1 ${pct(plan.current.policy_tp1_rate)} / negative ${pct(plan.current.policy_neg_rate)}`,
        ],
      },
      {
        header: "설정",
        lines: [
          `현재 streak ${currentCfg.sameDirStreakMin} / chase ${ratioX(roundTo(currentCfg.chaseRatioMin, 2))} / close ${roundTo(currentCfg.lastCloseControlMin, 2)} / body ${roundTo(currentCfg.lastDirBodyMin, 2)} / wick ${roundTo(currentCfg.lastOppWickMax, 2)} / move1 ${roundTo(currentCfg.recentMove1PctMin, 2)} / counter ${currentCfg.counterDirBarsMax}`,
          `적용 streak ${plan.nextCfg.sameDirStreakMin} / chase ${ratioX(roundTo(plan.nextCfg.chaseRatioMin, 2))} / close ${roundTo(plan.nextCfg.lastCloseControlMin, 2)} / body ${roundTo(plan.nextCfg.lastDirBodyMin, 2)} / wick ${roundTo(plan.nextCfg.lastOppWickMax, 2)} / move1 ${roundTo(plan.nextCfg.recentMove1PctMin, 2)} / counter ${plan.nextCfg.counterDirBarsMax}`,
          `리포트 ${mdPath}`,
          stageLedgerMeta.filePath || "wait state ledger 없음",
        ],
      },
    ],
  });

  console.log(JSON.stringify({
    ok: true,
    report: jsonPath,
    markdown: mdPath,
    latest: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.md"),
    changed: plan.changed,
    reason: plan.reason,
    sample_n: plan.current.sample_n,
    trigger_n: plan.current.trigger_n,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[automation-wait-one-bar-tune] failed", err);
    process.exitCode = 1;
  });
}

module.exports = {
  __test: {
    evaluatePathFromEntry,
    summarizePlan,
    comparePlans,
    meetsBeneficialTarget,
    shouldApplyBestPlan,
    buildCandidateConfigs,
    configKey,
    summarizeConfig,
    sharedObjectiveNeedsProfitRecovery,
    sharedObjectiveAllowsPlan,
    isWaitTighteningChange,
    bestFebtAllowsWaitPlan,
  },
};
