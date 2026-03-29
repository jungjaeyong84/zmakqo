#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { summarizePineSignalQuality } = require("../src/services/pineSignalQuality");
const { classifySignalReasonStage } = require("../src/utils/signalReasonView");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { estimateTp1ReachProbability } = require("../src/services/evTp1Probability");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  buildAiRecommendation,
  buildEvRecommendation,
  buildMarketRecommendation,
  buildQualityRecommendations,
  evaluateBinaryModel,
  predictProbability,
  summarizeLatePenalty,
  trainBinaryLogisticModel,
} = require("./lib/filter-policy-ml");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  toIso,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const { DEFAULT_MIN_MONTHLY_NET_KRW } = require("./lib/objective-policy");
const { describeStageForUser, wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  isEntryTierEvent,
  resolveEntryTimingTier,
  resolveEntrySide,
} = require("../src/utils/liveEntryTaxonomy");

const PROVIDER = String(process.env.ML_FILTER_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.ML_FILTER_TF || "15m").trim();
const LOOKBACK_DAYS = Math.max(14, Number(process.env.ML_FILTER_LOOKBACK_DAYS || 56));
const SCAN_LIMIT = Math.max(3000, Number(process.env.ML_FILTER_SCAN_LIMIT || 30000));
const COUNTERFACTUAL_HOURS = Math.max(6, Number(process.env.ML_FILTER_COUNTERFACTUAL_HOURS || 12));
const COUNTERFACTUAL_HORIZON_MS = COUNTERFACTUAL_HOURS * 60 * 60 * 1000;
const BAR_FETCH_LIMIT = Math.max(4000, Number(process.env.ML_FILTER_BAR_FETCH_LIMIT || 12000));
const HOLDOUT_EVAL_RATIO = clamp(Number(process.env.ML_FILTER_HOLDOUT_RATIO || 0.2), 0.1, 0.4);
const HOLDOUT_MIN_EVAL = Math.max(24, Number(process.env.ML_FILTER_HOLDOUT_MIN_EVAL || 48));
const HOLDOUT_MIN_TRAIN = Math.max(80, Number(process.env.ML_FILTER_HOLDOUT_MIN_TRAIN || 160));
const QUALITY_MIN_SAMPLE = Math.max(40, Number(process.env.ML_FILTER_QUALITY_MIN_SAMPLE || 80));
const AI_MIN_SAMPLE = Math.max(20, Number(process.env.ML_FILTER_AI_MIN_SAMPLE || 40));
const MARKET_MIN_SAMPLE = Math.max(16, Number(process.env.ML_FILTER_MARKET_MIN_SAMPLE || 30));
const EV_MIN_SAMPLE = Math.max(12, Number(process.env.ML_FILTER_EV_MIN_SAMPLE || 20));
const AI_BIAS_MIN_COVERAGE = clamp(Number(process.env.ML_FILTER_AI_BIAS_MIN_COVERAGE || 0.05), 0, 1);
const WEEKLY_GOVERNANCE_MAX_AGE_HOURS = Math.max(6, Number(process.env.ML_FILTER_WEEKLY_GOVERNANCE_MAX_AGE_HOURS || 18));
const OBJECTIVE_TARGET_MONTHLY_KRW = Math.max(
  0,
  Number(process.env.ML_FILTER_MIN_MONTHLY_NET_KRW || process.env.OBJECTIVE_MIN_MONTHLY_NET_KRW || DEFAULT_MIN_MONTHLY_NET_KRW),
);
const STAGE_ORDER = Object.freeze({
  OPS: 0,
  QUALITY: 1,
  AI: 2,
  MARKET: 3,
  EV: 4,
  TIMING: 5,
});

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
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

function pct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function signedNum(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function sanitizeToken(v) {
  return String(v || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .toLowerCase();
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

function resolveRegime(row) {
  const direct = sanitizeToken(row && (row.regime || row.market_regime));
  if (direct === "trend" || direct === "transition" || direct === "range") return direct;
  const f = resolveFeatures(row);
  const feat = sanitizeToken(f.regime || f.market_regime || f.pro_regime_state);
  if (feat === "trend" || feat === "transition" || feat === "range") return feat;
  return "unknown";
}

function resolveDocMs(doc) {
  return (
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    Date.parse(String((doc && (doc.created_at || doc.updated_at || doc.ts)) || ""))
  );
}

function resolveFillMs(doc) {
  return (
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
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
  const snap = await db.collection("bars_snapshots")
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

async function loadBarsByMarket(rows = [], { exchange, tf, fromMs, toMs } = {}) {
  const markets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    if (!market || !Number.isFinite(ms)) continue;
    const range = markets.get(market) || { fromMs: ms, toMs: ms };
    range.fromMs = Math.min(range.fromMs, ms);
    range.toMs = Math.max(range.toMs, ms + COUNTERFACTUAL_HORIZON_MS);
    markets.set(market, range);
  }
  const out = new Map();
  for (const [market, range] of markets.entries()) {
    const bars = await fetchBarsRange({
      exchange,
      symbol: market,
      tf,
      fromMs: Number.isFinite(fromMs) ? Math.min(fromMs, range.fromMs) : range.fromMs,
      toMs: Number.isFinite(toMs) ? Math.max(toMs, range.toMs) : range.toMs,
    });
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

function resolveDropRules(row, sysCfg = {}, exchange = PROVIDER) {
  const f = resolveFeatures(row);
  const exitProfileMode = String(
    f.exit_profile ||
    f.exitProfile ||
    sysCfg.futures_exit_profile_mode ||
    "BASE"
  ).trim().toUpperCase();
  const rules = resolveExitRulesForPosition({ exchange, exitProfileMode });
  const nextRules = { ...rules };
  const dynTp1 = toNum(f.exit_policy_tp1_pct ?? f.exitPolicyTp1Pct);
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

function evaluateDropCounterfactual(row, bars = [], { sysCfg = {}, exchange = PROVIDER, nowMs = Date.now() } = {}) {
  const side = resolveSide(row);
  const barMs = resolveDocMs(row);
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  if (!market || !Number.isFinite(barMs) || !side) return { ok: false, skip_reason: "BAD_ROW" };
  const horizonEndMs = barMs + COUNTERFACTUAL_HORIZON_MS;
  if (!Number.isFinite(nowMs) || nowMs < horizonEndMs) return { ok: false, skip_reason: "IMMATURE" };
  const entryBar = (Array.isArray(bars) ? bars : []).find((x) => Number(x.timestamp) === Number(barMs));
  if (!entryBar || !Number.isFinite(entryBar.close)) return { ok: false, skip_reason: "ENTRY_BAR_MISSING" };
  const futureBars = (Array.isArray(bars) ? bars : []).filter((x) => Number(x.timestamp) > Number(barMs) && Number(x.timestamp) <= horizonEndMs);
  if (!futureBars.length) return { ok: false, skip_reason: "HORIZON_BARS_MISSING" };
  const rules = resolveDropRules(row, sysCfg, exchange);
  const leverage = resolveLeverage(row, sysCfg);
  const tpPx = pnlToPrice({ avg: entryBar.close, pnlPct: Number(rules.TP_P1), side, leverage });
  const slPx = pnlToPrice({ avg: entryBar.close, pnlPct: Number(rules.SL), side, leverage });
  let outcome = "HOLD";
  for (const bar of futureBars) {
    const tpHit = side === "LONG" ? (bar.high >= tpPx) : (bar.low <= tpPx);
    const slHit = side === "LONG" ? (bar.low <= slPx) : (bar.high >= slPx);
    if (tpHit && slHit) {
      outcome = "AMBIGUOUS_BOTH";
      break;
    }
    if (tpHit) {
      outcome = "TP1_FIRST";
      break;
    }
    if (slHit) {
      outcome = "SL_FIRST";
      break;
    }
  }
  const horizonClose = futureBars[futureBars.length - 1].close;
  const horizonRetNet = pctFromPriceMove({ entryPrice: entryBar.close, refPrice: horizonClose, side, leverage });
  return { ok: true, outcome, horizon_ret_net: horizonRetNet };
}

function filterEntryRows(rows = [], { exchange, tf, fromMs, toMs } = {}) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const event = String(row && row.event || "").trim().toUpperCase();
    const ms = resolveDocMs(row);
    if (exchange && ex !== exchange) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (!isEntryTierEvent(event)) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });
}

function pickConflict(row, side) {
  const f = resolveFeatures(row);
  if (side === "LONG") return Boolean(f.pro_conflict_long ?? f.conflict_long ?? f.pro_conflict);
  if (side === "SHORT") return Boolean(f.pro_conflict_short ?? f.conflict_short ?? f.pro_conflict);
  return Boolean(f.pro_conflict);
}

function resolveDirPosterior(row, side) {
  const f = resolveFeatures(row);
  if (side === "LONG") return toNum(f.zz_post_prob_long);
  if (side === "SHORT") return toNum(f.zz_post_prob_short);
  return null;
}

function resolveAiBiasInfo(row, side) {
  const f = resolveFeatures(row);
  const dir = String(f.ai_bias_dir || "").trim().toUpperCase() || "UNKNOWN";
  const score = toNum(f.ai_bias_score);
  const confidence = toNum(f.ai_bias_confidence);
  let relation = "UNKNOWN";
  if (dir === "NEUTRAL") relation = "NEUTRAL";
  else if ((dir === "LONG" && side === "LONG") || (dir === "SHORT" && side === "SHORT")) relation = "SAME";
  else if ((dir === "LONG" || dir === "SHORT") && side && dir !== side) relation = "OPPOSITE_WEAK";
  return { dir, score, confidence, relation };
}

function buildBarContext(row, barsByMarket, sysCfg = {}) {
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  const side = resolveSide(row);
  const barCloseMs = resolveDocMs(row);
  if (!market || !side || !Number.isFinite(barCloseMs)) return {};
  const bars = barsByMarket.get(market) || [];
  if (!bars.length) return {};
  const rules = resolveDropRules(row, sysCfg, PROVIDER);
  const est = estimateTp1ReachProbability({
    bars,
    dir: side,
    tp1Pct: Number(rules.TP_P1) * 100,
    slPct: Number(rules.SL) * 100,
    barCloseMs,
    lookbackBars: Math.max(8, Number(sysCfg.ev_gate_lookback_bars || 12)),
    atrBars: Math.max(4, Number(sysCfg.ev_gate_atr_bars || 8)),
  });
  if (!est || est.ok !== true) return {};
  return {
    barProbability: est.probability,
    barLowerBound: est.lowerBound,
    chaseRatio: est.chaseRatio,
    sameDirStreak: est.sameDirStreak,
    counterDirBars: est.counterDirBars,
    avgCloseControl: est.avgCloseControl,
    avgOppWick: est.avgOppWick,
    avgDirBody: est.avgDirBody,
    atrPct: est.atrPct,
  };
}

function createBaseExample(row, extras = {}, barsByMarket, sysCfg = {}) {
  const side = resolveSide(row);
  const tier = resolveTier(row && row.event);
  const regime = resolveRegime(row);
  const f = resolveFeatures(row);
  const aiBias = resolveAiBiasInfo(row, side);
  const lateByBars = toNum(f._late_by_bars ?? f.late_by_bars ?? f._lateByBars) ?? 0;
  const eventMs = resolveDocMs(row);
  return {
    signalKey: makeSignalKey(row),
    eventMs,
    source: extras.source || "UNKNOWN",
    dropStageKey: extras.dropStageKey || null,
    label: Number.isFinite(Number(extras.label)) ? Number(extras.label) : null,
    weight: Number(extras.weight) || 1,
    expectedRetNet: toNum(extras.expectedRetNet),
    realized: extras.realized === true,
    market: String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase(),
    side,
    tier,
    regime,
    scoreAbs: Math.abs(Number(f.score || 0)),
    confidence: toNum(f.confidence),
    waveConf: toNum(f.zz_wave_conf),
    postProbDir: resolveDirPosterior(row, side),
    lateByBars,
    conflict: pickConflict(row, side),
    aiBiasDir: aiBias.dir,
    aiBiasScore: aiBias.score,
    aiBiasConfidence: aiBias.confidence,
    aiBiasRelation: aiBias.relation,
    aiUsable: f.ai_signal !== undefined,
    aiMissing: String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase().startsWith("DROP_AI_MISSING"),
    ...buildBarContext(row, barsByMarket, sysCfg),
  };
}

function buildExecutedExamples(signals = [], chainRows = [], barsByMarket, sysCfg = {}) {
  const signalMap = new Map();
  for (const row of Array.isArray(signals) ? signals : []) {
    const key = makeSignalKey(row);
    if (key) signalMap.set(key, row);
  }
  const out = [];
  for (const chain of Array.isArray(chainRows) ? chainRows : []) {
    const key = `${String(chain.market || "").trim().toUpperCase()}__${String(chain.tf || "").trim()}__${Number(chain.entry_bar_ms || 0)}__${String(chain.entry_signal_type || "").trim().toUpperCase()}`;
    const row = signalMap.get(key);
    if (!row) continue;
    let label = null;
    if (chain.tp1_hit === true) label = 1;
    else if (chain.realized === true && Number.isFinite(Number(chain.realized_ret_net))) label = Number(chain.realized_ret_net) > 0 ? 1 : 0;
    if (!Number.isFinite(label)) continue;
    const ex = createBaseExample(row, {
      source: "EXECUTED",
      label,
      weight: 1.25,
      expectedRetNet: chain.realized_ret_net,
      realized: chain.realized === true,
    }, barsByMarket, sysCfg);
    out.push(ex);
  }
  return out;
}

function buildDropExamples(drops = [], barsByMarket, sysCfg = {}, nowMs = Date.now()) {
  const out = [];
  for (const row of Array.isArray(drops) ? drops : []) {
    const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
    const cf = evaluateDropCounterfactual(row, barsByMarket.get(market) || [], { sysCfg, exchange: PROVIDER, nowMs });
    if (!cf || cf.ok !== true) continue;
    let label = null;
    if (cf.outcome === "TP1_FIRST") label = 1;
    else if (cf.outcome === "SL_FIRST") label = 0;
    else if (Number.isFinite(Number(cf.horizon_ret_net))) label = Number(cf.horizon_ret_net) > 0 ? 1 : 0;
    if (!Number.isFinite(label)) continue;
    const ex = createBaseExample(row, {
      source: "DROP_COUNTERFACTUAL",
      dropStageKey: resolveDropStageKey(row),
      label,
      weight: 1,
      expectedRetNet: cf.horizon_ret_net,
      realized: false,
    }, barsByMarket, sysCfg);
    out.push(ex);
  }
  return out;
}

function resolveDropStageKey(row) {
  const reason = String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase();
  const stage = classifySignalReasonStage(reason);
  return String(stage && stage.key || "OPS").trim().toUpperCase();
}

function selectStageExamples(examples = [], stageKey = "QUALITY") {
  const target = String(stageKey || "").trim().toUpperCase();
  const targetOrder = STAGE_ORDER[target];
  return (Array.isArray(examples) ? examples : []).filter((row) => {
    if (!row) return false;
    if (row.source === "EXECUTED") return true;
    const dropStageKey = String(row.dropStageKey || "").trim().toUpperCase();
    const dropOrder = STAGE_ORDER[dropStageKey];
    if (!Number.isFinite(targetOrder) || !Number.isFinite(dropOrder)) return false;
    return dropOrder >= targetOrder;
  });
}

function splitExamplesChronologically(examples = [], {
  evalRatio = HOLDOUT_EVAL_RATIO,
  minEval = HOLDOUT_MIN_EVAL,
  minTrain = HOLDOUT_MIN_TRAIN,
} = {}) {
  const rows = (Array.isArray(examples) ? examples : [])
    .filter((row) => Number.isFinite(Number(row && row.eventMs)) && Number.isFinite(Number(row && row.label)))
    .slice()
    .sort((a, b) => Number(a.eventMs) - Number(b.eventMs));
  if (rows.length < (minEval + minTrain)) {
    return { mode: "INSUFFICIENT_HOLDOUT", train: rows, eval: [] };
  }
  const evalN = Math.max(minEval, Math.round(rows.length * evalRatio));
  const trainN = rows.length - evalN;
  if (trainN < minTrain) {
    return { mode: "INSUFFICIENT_HOLDOUT", train: rows, eval: [] };
  }
  return {
    mode: "HOLDOUT",
    train: rows.slice(0, trainN),
    eval: rows.slice(trainN),
  };
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
  const fs = require("fs");
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

function sharedObjectiveFailing(sharedObjective) {
  const current = sharedObjective && sharedObjective.currentObjective;
  if (!current || typeof current !== "object") return false;
  return current.monthly_pass === false || current.net_pass === false || current.ev_pass === false || current.win_pass === false;
}

function bestFebtGuardReason(bestFebtContract = null) {
  if (!bestFebtContract || typeof bestFebtContract !== "object") return null;
  const marketPrefix = bestFebtContract.market ? `[${bestFebtContract.market}] ` : "";
  if (bestFebtContract.tightening_allowed === false) {
    return `${marketPrefix}BEST/FEBT count 보존 기준(count_ratio_global < 1.00)에서는 tightening 자동 권고를 차단합니다.`;
  }
  if (bestFebtContract.recovery_priority === true) {
    return `${marketPrefix}BEST/FEBT replacement 회복 우선 상태에서는 tightening보다 recovery 우선입니다.`;
  }
  return null;
}

function isAiHardeningRecommendation(currentPolicy, currentReduce, aiRecommendation = null) {
  const action = String(aiRecommendation && aiRecommendation.action || "").trim().toUpperCase();
  if (action !== "REVIEW_UPDATE") return false;
  const nextPolicy = String(aiRecommendation && (aiRecommendation.next_policy || aiRecommendation.next) || currentPolicy).trim().toUpperCase();
  const nextReduce = Number(
    aiRecommendation && (
      aiRecommendation.next_reduce_pct != null
        ? aiRecommendation.next_reduce_pct
        : (aiRecommendation.key === "ai_missing_reduce_pct" ? aiRecommendation.next : currentReduce)
    )
  );
  return (
    (currentPolicy === "ALLOW" && (nextPolicy === "REDUCE" || nextPolicy === "BLOCK"))
    || (currentPolicy === "REDUCE" && nextPolicy === "BLOCK")
    || (currentPolicy === "REDUCE" && Number.isFinite(nextReduce) && nextReduce < currentReduce)
  );
}

function isEvHardeningRecommendation(settings = {}, evRecommendation = null) {
  if (String(evRecommendation && evRecommendation.action || "").trim().toUpperCase() !== "REVIEW_UPDATE") return false;
  const currentThreshold = Number(settings.ev_gate_tp1_prob_min || 0.55);
  const currentLow = Number(settings.ev_gate_qty_scale_low || 0.40);
  const currentMid = Number(settings.ev_gate_qty_scale_mid || 0.70);
  const evNext = evRecommendation && evRecommendation.next ? evRecommendation.next : null;
  if (!evNext || typeof evNext !== "object") return false;
  return (
    Number(evNext.ev_gate_tp1_prob_min) > currentThreshold
    || Number(evNext.ev_gate_qty_scale_low) < currentLow
    || Number(evNext.ev_gate_qty_scale_mid) < currentMid
  );
}

function applySharedObjectiveGuard(recommendations = {}, settings = {}, sharedObjective = null, bestFebtContract = null) {
  const next = {
    QUALITY: Array.isArray(recommendations.QUALITY) ? recommendations.QUALITY.map((row) => ({ ...row })) : [],
    AI: recommendations.AI ? { ...recommendations.AI } : { action: "HOLD", reason: "recommendation missing" },
    MARKET: recommendations.MARKET ? { ...recommendations.MARKET } : { action: "HOLD", reason: "recommendation missing" },
    EV: recommendations.EV ? { ...recommendations.EV } : { action: "HOLD", reason: "recommendation missing" },
  };
  const currentAiPolicy = String(settings.ai_missing_policy || "ALLOW").trim().toUpperCase();
  const currentAiReduce = Number(settings.ai_missing_reduce_pct || 0.5);
  const currentThreshold = Number(settings.ev_gate_tp1_prob_min || 0.55);
  const currentLow = Number(settings.ev_gate_qty_scale_low || 0.40);
  const currentMid = Number(settings.ev_gate_qty_scale_mid || 0.70);

  if (sharedObjectiveFailing(sharedObjective)) {
    const blockReason = `공통 목표(${Number(sharedObjective && sharedObjective.objectiveConfig && sharedObjective.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW/월 포함) 미달 상태에서는 완화안을 자동 권고하지 않습니다.`;
    next.QUALITY = next.QUALITY.map((row) => {
      if (String(row && row.action || "").toUpperCase() !== "REVIEW_LOOSEN") return row;
      return { action: "HOLD", reason: blockReason, blocked_action: row.action, blocked_key: row.key || null };
    });

    const aiNextPolicy = String(next.AI && (next.AI.next_policy || next.AI.next) || currentAiPolicy).trim().toUpperCase();
    const aiNextReduce = Number(
      next.AI && (
        next.AI.next_reduce_pct != null
          ? next.AI.next_reduce_pct
          : (next.AI.key === "ai_missing_reduce_pct" ? next.AI.next : currentAiReduce)
      )
    );
    const aiSoftening = String(next.AI && next.AI.action || "").toUpperCase() === "REVIEW_UPDATE" && (
      (currentAiPolicy === "BLOCK" && (aiNextPolicy === "REDUCE" || aiNextPolicy === "ALLOW"))
      || (currentAiPolicy === "REDUCE" && aiNextPolicy === "ALLOW")
      || (currentAiPolicy === "REDUCE" && Number.isFinite(aiNextReduce) && aiNextReduce > currentAiReduce)
    );
    if (aiSoftening) {
      next.AI = {
        action: "HOLD",
        reason: blockReason,
        blocked_action: "REVIEW_UPDATE",
        blocked_key: next.AI.key || "AI_SOFTENING",
        next: currentAiPolicy,
        next_policy: currentAiPolicy,
        next_reduce_pct: currentAiReduce,
      };
    }

    if (String(next.MARKET.action || "").toUpperCase() === "REVIEW_SOFTEN") {
      next.MARKET = { action: "HOLD", reason: blockReason, blocked_action: "REVIEW_SOFTEN", blocked_key: next.MARKET.key || null };
    }

    const evNext = next.EV && next.EV.next ? next.EV.next : null;
    const evSoftening = evNext && (
      Number(evNext.ev_gate_tp1_prob_min) < currentThreshold ||
      Number(evNext.ev_gate_qty_scale_low) > currentLow ||
      Number(evNext.ev_gate_qty_scale_mid) > currentMid
    );
    if (String(next.EV.action || "").toUpperCase() === "REVIEW_UPDATE" && evSoftening) {
      next.EV = {
        action: "HOLD",
        reason: blockReason,
        blocked_action: "REVIEW_UPDATE",
        blocked_key: "EV_SOFTENING",
        next: {
          ev_gate_tp1_prob_min: currentThreshold,
          ev_gate_qty_scale_low: currentLow,
          ev_gate_qty_scale_mid: currentMid,
        },
        threshold_eval: next.EV.threshold_eval,
        buckets: next.EV.buckets,
      };
    }
  }

  const bestFebtReason = bestFebtGuardReason(bestFebtContract);
  if (!bestFebtReason) return next;

  next.QUALITY = next.QUALITY.map((row) => {
    if (String(row && row.action || "").toUpperCase() !== "REVIEW_TIGHTEN") return row;
    return { action: "HOLD", reason: bestFebtReason, blocked_action: row.action, blocked_key: row.key || null };
  });

  if (isAiHardeningRecommendation(currentAiPolicy, currentAiReduce, next.AI)) {
    next.AI = {
      action: "HOLD",
      reason: bestFebtReason,
      blocked_action: next.AI.action || "REVIEW_UPDATE",
      blocked_key: next.AI.key || "AI_HARDENING",
      next: currentAiPolicy,
      next_policy: currentAiPolicy,
      next_reduce_pct: currentAiReduce,
    };
  }

  if (String(next.MARKET.action || "").toUpperCase() === "REVIEW_TIGHTEN") {
    next.MARKET = { action: "HOLD", reason: bestFebtReason, blocked_action: "REVIEW_TIGHTEN", blocked_key: next.MARKET.key || null };
  }

  if (isEvHardeningRecommendation(settings, next.EV)) {
    next.EV = {
      action: "HOLD",
      reason: bestFebtReason,
      blocked_action: next.EV.action || "REVIEW_UPDATE",
      blocked_key: "EV_HARDENING",
      next: {
        ev_gate_tp1_prob_min: currentThreshold,
        ev_gate_qty_scale_low: currentLow,
        ev_gate_qty_scale_mid: currentMid,
      },
      threshold_eval: next.EV.threshold_eval,
      buckets: next.EV.buckets,
    };
  }
  return next;
}

function buildMlSelfValidation({ validation, metrics, recommendations, stageSamples, coverage } = {}) {
  const checks = [];
  let ok = true;
  const validationMode = String(validation && validation.mode || "").toUpperCase();
  if (validationMode === "HOLDOUT" && metrics && metrics.ok === true) {
    checks.push("holdout validation available");
  } else {
    ok = false;
    checks.push("holdout validation unavailable");
  }

  const qualityActions = Array.isArray(recommendations && recommendations.QUALITY)
    ? recommendations.QUALITY.filter((row) => row && row.action && row.action !== "KEEP" && row.action !== "HOLD")
    : [];
  if (qualityActions.length && Number(stageSamples && stageSamples.quality_n) < QUALITY_MIN_SAMPLE) {
    ok = false;
    checks.push(`quality sample insufficient (${Number(stageSamples && stageSamples.quality_n) || 0} < ${QUALITY_MIN_SAMPLE})`);
  }

  const aiAction = String(recommendations && recommendations.AI && recommendations.AI.action || "").toUpperCase();
  if (aiAction && aiAction !== "KEEP" && aiAction !== "HOLD" && Number(stageSamples && stageSamples.ai_n) < AI_MIN_SAMPLE) {
    ok = false;
    checks.push(`ai sample insufficient (${Number(stageSamples && stageSamples.ai_n) || 0} < ${AI_MIN_SAMPLE})`);
  }

  const marketAction = String(recommendations && recommendations.MARKET && recommendations.MARKET.action || "").toUpperCase();
  if (marketAction && marketAction !== "KEEP" && marketAction !== "HOLD" && Number(stageSamples && stageSamples.market_n) < MARKET_MIN_SAMPLE) {
    ok = false;
    checks.push(`market sample insufficient (${Number(stageSamples && stageSamples.market_n) || 0} < ${MARKET_MIN_SAMPLE})`);
  }
  if (marketAction && marketAction !== "KEEP" && marketAction !== "HOLD" && Number(coverage && coverage.ai_bias_rate) < AI_BIAS_MIN_COVERAGE) {
    ok = false;
    checks.push(`ai bias coverage insufficient (${pct(coverage && coverage.ai_bias_rate)} < ${pct(AI_BIAS_MIN_COVERAGE)})`);
  }

  const evAction = String(recommendations && recommendations.EV && recommendations.EV.action || "").toUpperCase();
  if (evAction && evAction !== "KEEP" && evAction !== "HOLD" && Number(stageSamples && stageSamples.ev_n) < EV_MIN_SAMPLE) {
    ok = false;
    checks.push(`ev sample insufficient (${Number(stageSamples && stageSamples.ev_n) || 0} < ${EV_MIN_SAMPLE})`);
  }

  if (!checks.length) checks.push("no active stage recommendation");
  return {
    ok,
    result: ok ? "OK" : "WARN",
    checks,
  };
}

function describeQualityRecommendationKeyForUser(key) {
  const raw = String(key || "").trim();
  if (!raw) return "";
  if (raw === "gate_early_score_abs") return "LONG/SHORT 기본 진입 점수 기준";
  if (raw === "gate_core_score_abs") return "LONG/SHORT 확장 진입 점수 기준";
  if (raw === "gate_early_conf_min") return "LONG/SHORT 기본 진입 confidence 기준";
  if (raw === "gate_core_conf_min") return "LONG/SHORT 확장 진입 confidence 기준";
  if (raw === "gate_regime_allowlist") return "LONG/SHORT 1차 regime 기준";
  return raw;
}

function rewriteQualityRecommendationReasonForUser(reason) {
  let out = String(reason || "");
  out = out.replace(/\bEARLY\b score/g, "LONG/SHORT 기본 진입 점수 기준");
  out = out.replace(/\bCORE\b score/g, "LONG/SHORT 확장 진입 점수 기준");
  out = out.replace(/\bEARLY\b confidence/g, "LONG/SHORT 기본 진입 confidence 기준");
  out = out.replace(/\bCORE\b confidence/g, "LONG/SHORT 확장 진입 confidence 기준");
  out = out.replace(/\bEARLY\b/g, "LONG/SHORT 기본 진입");
  out = out.replace(/\bCORE\b/g, "LONG/SHORT 확장 진입");
  out = out.replace(/\bPRE_REAL\b/g, "레거시 진단 B(비활성)");
  out = out.replace(/\bREAL\b/g, "레거시 진단 C(비활성)");
  return out;
}

function buildStageSampleRows(stageSamples = {}) {
  return [
    { stage: "QUALITY", display_stage: describeStageForUser("QUALITY"), sample_n: Number(stageSamples.quality_n || 0) },
    { stage: "AI", display_stage: describeStageForUser("AI"), sample_n: Number(stageSamples.ai_n || 0) },
    { stage: "MARKET", display_stage: describeStageForUser("MARKET"), sample_n: Number(stageSamples.market_n || 0) },
    { stage: "EV", display_stage: describeStageForUser("EV"), sample_n: Number(stageSamples.ev_n || 0) },
  ];
}

function buildRecommendationRows(recommendations = {}) {
  const rows = [];
  for (const row of Array.isArray(recommendations.QUALITY) ? recommendations.QUALITY : []) {
    rows.push({
      stage: "QUALITY",
      display_stage: describeStageForUser("QUALITY"),
      action: row.action || null,
      key: row.key || null,
      display_key: row.display_key || describeQualityRecommendationKeyForUser(row.key),
      current: row.current ?? null,
      next: row.next ?? null,
      reason: row.reason || null,
      display_reason: row.display_reason || rewriteQualityRecommendationReasonForUser(row.reason),
      support_n: row.support_n ?? null,
      support_rate: row.support_rate ?? null,
    });
  }
  for (const stage of ["AI", "MARKET", "EV"]) {
    const row = recommendations[stage];
    if (!row || typeof row !== "object") continue;
    rows.push({
      stage,
      display_stage: describeStageForUser(stage),
      action: row.action || null,
      key: row.key || row.blocked_key || null,
      display_key: row.key || row.blocked_key || null,
      current: row.current ?? null,
      next: row.next ?? null,
      reason: row.reason || null,
      display_reason: row.display_reason || row.reason || null,
    });
  }
  return rows;
}

function renderMarkdown({ nowMeta, provider, tf, lookbackDays, model, metrics, trainMetrics, validation, latePenalty, recommendations, coverage, stageSamples, selfValidation, artifacts, sharedObjective, bestFebtContract, bestFebtMarketGuard }) {
  const lines = [];
  lines.push("# ML Filter Policy");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push(`- 대상: ${provider} ${tf}`);
  lines.push(`- 평가 윈도우: 최근 ${lookbackDays}일`);
  lines.push(`- 학습 표본: ${model.sample_n}`);
  lines.push(`- executed: ${model.executed_n}`);
  lines.push(`- drop counterfactual: ${model.drop_counterfactual_n}`);
  lines.push(`- positive rate: ${pct(model.positive_rate)}`);
  lines.push(`- 검증 방식: ${validation.mode}`);
  lines.push(`- train/eval: ${validation.train_n}/${validation.eval_n}`);
  lines.push(`- 공통 목표 월간 순수익: ${Number(sharedObjective && sharedObjective.objectiveConfig && sharedObjective.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW`);
  lines.push(`- 공통 목표 상태: ${sharedObjective && sharedObjective.currentObjective ? sharedObjective.currentObjective.verdict : "N/A"}`);
  lines.push(`- 월간 페이스: ${sharedObjective && sharedObjective.currentObjective && Number.isFinite(Number(sharedObjective.currentObjective.monthly_run_rate_krw)) ? `${Number(sharedObjective.currentObjective.monthly_run_rate_krw).toLocaleString("ko-KR")} KRW` : "N/A"}`);
  lines.push(`- holdout accuracy: ${pct(metrics.accuracy)}`);
  lines.push(`- holdout brier: ${metrics.brier == null ? "N/A" : metrics.brier.toFixed(4)}`);
  lines.push(`- holdout logloss: ${metrics.logloss == null ? "N/A" : metrics.logloss.toFixed(4)}`);
  lines.push(`- train accuracy: ${pct(trainMetrics.accuracy)}`);
  lines.push(`- train brier: ${trainMetrics.brier == null ? "N/A" : trainMetrics.brier.toFixed(4)}`);
  lines.push(`- self-validation: ${(selfValidation && selfValidation.result) || "N/A"}`);
  if (selfValidation && Array.isArray(selfValidation.checks)) {
    selfValidation.checks.forEach((row) => lines.push(`  - ${row}`));
  }
  lines.push("");
  lines.push("## BEST/FEBT 공통 계약");
  lines.push(`- mode: ${bestFebtContract && bestFebtContract.mode || "N/A"}`);
  lines.push(`- tightening allowed: ${bestFebtContract && bestFebtContract.tightening_allowed ? "YES" : "NO"} / recovery priority: ${bestFebtContract && bestFebtContract.recovery_priority ? "YES" : "NO"}`);
  lines.push(`- projected replacement ratio: ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "N/A"}`);
  lines.push(`- projected count ratio: ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`);
  lines.push(`- fire / late / disagree: ${bestFebtContract && bestFebtContract.fire_n != null ? bestFebtContract.fire_n : "N/A"} / ${bestFebtContract && bestFebtContract.late_n != null ? bestFebtContract.late_n : "N/A"} / ${bestFebtContract && bestFebtContract.disagreement_n != null ? bestFebtContract.disagreement_n : "N/A"}`);
  lines.push(`- market guard: ${bestFebtMarketGuard && bestFebtMarketGuard.market ? `${bestFebtMarketGuard.market} / ${bestFebtMarketGuard.mode}` : "N/A"}`);
  lines.push("");
  lines.push("## late-entry penalty");
  lines.push(`- on-time: n=${latePenalty.on_time.n} / success=${pct(latePenalty.on_time.labelRate)} / avg_ret_net=${signedPct(latePenalty.on_time.avgRetNet)}`);
  lines.push(`- late 1+: n=${latePenalty.late_1_plus.n} / success=${pct(latePenalty.late_1_plus.labelRate)} / avg_ret_net=${signedPct(latePenalty.late_1_plus.avgRetNet)} / delta=${signedPct(latePenalty.penalty_1_plus)}`);
  lines.push(`- late 2+: n=${latePenalty.late_2_plus.n} / success=${pct(latePenalty.late_2_plus.labelRate)} / avg_ret_net=${signedPct(latePenalty.late_2_plus.avgRetNet)} / delta=${signedPct(latePenalty.penalty_2_plus)}`);
  lines.push("");
  lines.push("## feature coverage");
  lines.push(`- ai bias coverage: ${coverage.ai_bias_n}/${coverage.total_n} (${pct(coverage.ai_bias_rate)})`);
  lines.push(`- bar context coverage: ${coverage.bar_context_n}/${coverage.total_n} (${pct(coverage.bar_context_rate)})`);
  lines.push(`- late marker coverage: ${coverage.late_marker_n}/${coverage.total_n} (${pct(coverage.late_marker_rate)})`);
  lines.push("");
  lines.push("## stage sample scope");
  lines.push(`- 1차 상태/무결성 표본: ${stageSamples.quality_n}`);
  lines.push(`- 2차 진입 품질 표본: ${stageSamples.ai_n}`);
  lines.push(`- 3차 상태 기반 Soft Sizing 표본: ${stageSamples.market_n}`);
  lines.push(`- 4차 EV/시간가치층 표본: ${stageSamples.ev_n}`);
  lines.push("");
  lines.push("## stage recommendations");
  for (const row of recommendations.QUALITY) {
    const keyText = row.display_key || describeQualityRecommendationKeyForUser(row.key);
    const reasonText = row.display_reason || rewriteQualityRecommendationReasonForUser(row.reason);
    lines.push(`- 1차 상태/무결성: ${row.action}${keyText ? ` / ${keyText} ${row.current} -> ${row.next}` : ""} / ${reasonText}`);
  }
  lines.push(`- 2차 진입 품질: ${recommendations.AI.action}${recommendations.AI.key ? ` / ${recommendations.AI.key} ${recommendations.AI.current} -> ${recommendations.AI.next}` : ""} / ${recommendations.AI.reason}`);
  lines.push(`- 3차 상태 기반 Soft Sizing: ${recommendations.MARKET.action}${recommendations.MARKET.key ? ` / ${recommendations.MARKET.key} ${recommendations.MARKET.current} -> ${recommendations.MARKET.next}` : ""} / ${recommendations.MARKET.reason}`);
  lines.push(`- 4차 EV/시간가치층: ${recommendations.EV.action} / ${recommendations.EV.reason}`);
  if (recommendations.EV && recommendations.EV.next) {
    lines.push(`  - ev_gate_tp1_prob_min: ${recommendations.EV.next.ev_gate_tp1_prob_min}`);
    lines.push(`  - ev_gate_qty_scale_mid: ${recommendations.EV.next.ev_gate_qty_scale_mid}`);
    lines.push(`  - ev_gate_qty_scale_low: ${recommendations.EV.next.ev_gate_qty_scale_low}`);
  }
  lines.push("");
  lines.push("## artifacts");
  lines.push(`- JSON: ${artifacts.jsonPath}`);
  lines.push(`- signals cache: ${artifacts.cache.signals.filePath}`);
  lines.push(`- drops cache: ${artifacts.cache.drops.filePath}`);
  lines.push(`- fills cache: ${artifacts.cache.fills.filePath}`);
  lines.push(`- weekly governance: ${artifacts.weeklyGovernancePath || "N/A"}`);
  lines.push(`- objective supervisor: ${artifacts.objectiveSupervisorPath || "N/A"}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const nowMs = nowMeta.nowMs;
  const fromMs = nowMs - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const sharedObjective = readFreshWeeklyGovernance(nowMs);
  const bestFebtContext = readBestFebtSupervisorContext(nowMs);
  const bestFebtContract = bestFebtContext.contract;
  const bestFebtMarketGuard = bestFebtContext.marketGuardContract;

  const [sysRes, signalsRes, dropsRes, fillsRes] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);
  const sysCfg = sysRes && sysRes.data ? sysRes.data : {};
  const signals = filterEntryRows(signalsRes.rows, { exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs });
  const drops = filterEntryRows(dropsRes.rows, { exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs });
  const fills = (Array.isArray(fillsRes.rows) ? fillsRes.rows : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const ms = resolveFillMs(row);
    if (ex !== PROVIDER) return false;
    if (TF && rowTf && rowTf !== TF) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    return true;
  });

  const barsByMarket = await loadBarsByMarket(signals.concat(drops), { exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs });
  const quality = await summarizePineSignalQuality({ signals, fills, exchange: PROVIDER, tf: TF, fromMs, toMs: nowMs });
  const executedExamples = buildExecutedExamples(signals, quality.chain_rows, barsByMarket, sysCfg);
  const dropExamples = buildDropExamples(drops, barsByMarket, sysCfg, nowMs);
  const examples = executedExamples.concat(dropExamples);

  const stageSamples = {
    QUALITY: selectStageExamples(examples, "QUALITY"),
    AI: selectStageExamples(examples, "AI"),
    MARKET: selectStageExamples(examples, "MARKET"),
    EV: selectStageExamples(examples, "EV"),
  };

  const split = splitExamplesChronologically(examples);
  const trainingRows = split.train.length ? split.train : examples;
  const model = trainBinaryLogisticModel(trainingRows);
  for (const row of examples) {
    row.predicted = predictProbability(model, row);
  }
  const trainMetrics = evaluateBinaryModel(model, trainingRows);
  const metrics = split.mode === "HOLDOUT"
    ? evaluateBinaryModel(model, split.eval)
    : {
      ok: false,
      sampleN: split.eval.length,
      brier: null,
      accuracy: null,
      logloss: null,
      avgPredicted: null,
      positiveRate: null,
    };
  const latePenalty = summarizeLatePenalty(examples);
  const coverage = {
    total_n: examples.length,
    ai_bias_n: examples.filter((row) => row.aiBiasDir && row.aiBiasDir !== "UNKNOWN").length,
    ai_bias_rate: examples.length > 0 ? (examples.filter((row) => row.aiBiasDir && row.aiBiasDir !== "UNKNOWN").length / examples.length) : null,
    bar_context_n: examples.filter((row) => Number.isFinite(Number(row.barLowerBound))).length,
    bar_context_rate: examples.length > 0 ? (examples.filter((row) => Number.isFinite(Number(row.barLowerBound))).length / examples.length) : null,
    late_marker_n: examples.filter((row) => Number(row.lateByBars) > 0).length,
    late_marker_rate: examples.length > 0 ? (examples.filter((row) => Number(row.lateByBars) > 0).length / examples.length) : null,
  };

  const rawRecommendations = {
    QUALITY: buildQualityRecommendations(stageSamples.QUALITY, metrics, sysCfg),
    AI: buildAiRecommendation(stageSamples.AI, sysCfg),
    MARKET: buildMarketRecommendation(stageSamples.MARKET, sysCfg),
    EV: buildEvRecommendation(stageSamples.EV, sysCfg),
  };
  const recommendations = applySharedObjectiveGuard(rawRecommendations, sysCfg, sharedObjective, bestFebtMarketGuard || bestFebtContract);
  recommendations.QUALITY = (Array.isArray(recommendations.QUALITY) ? recommendations.QUALITY : []).map((row) => ({
    ...row,
    display_key: describeQualityRecommendationKeyForUser(row.key),
    display_reason: rewriteQualityRecommendationReasonForUser(row.reason),
  }));
  const selfValidation = buildMlSelfValidation({
    validation: {
      mode: split.mode,
      train_n: trainingRows.length,
      eval_n: split.eval.length,
    },
    metrics,
    recommendations,
    stageSamples: {
      quality_n: stageSamples.QUALITY.length,
      ai_n: stageSamples.AI.length,
      market_n: stageSamples.MARKET.length,
      ev_n: stageSamples.EV.length,
    },
    coverage,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    lookback_days: LOOKBACK_DAYS,
    model: {
      type: "LOGISTIC_REGRESSION_V1",
      sample_n: examples.length,
      executed_n: executedExamples.length,
      drop_counterfactual_n: dropExamples.length,
      positive_rate: model && model.ok ? model.positiveRate : null,
      weights: model && model.ok ? model.weights : [],
    },
    validation: {
      mode: split.mode,
      train_n: trainingRows.length,
      eval_n: split.eval.length,
    },
    metrics,
    train_metrics: trainMetrics,
    late_penalty: latePenalty,
    coverage,
    stage_samples: {
      quality_n: stageSamples.QUALITY.length,
      ai_n: stageSamples.AI.length,
      market_n: stageSamples.MARKET.length,
      ev_n: stageSamples.EV.length,
    },
    self_validation: selfValidation,
    shared_objective: {
      current: sharedObjective.currentObjective,
      previous: sharedObjective.previousObjective,
      fresh: sharedObjective.fresh,
      target_monthly_net_krw: Number(sharedObjective && sharedObjective.objectiveConfig && sharedObjective.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW),
    },
    best_febt_tuning_contract: bestFebtContract,
    best_febt_market_guard_contract: bestFebtMarketGuard,
    recommendations,
    artifacts: {
      cache: {
        signals: signalsRes.meta,
        drops: dropsRes.meta,
        fills: fillsRes.meta,
      },
      weekly_governance_path: sharedObjective.filePath,
      objective_supervisor_path: bestFebtContext.objectiveSupervisorArtifact && bestFebtContext.objectiveSupervisorArtifact.filePath,
    },
  };
  report.stage_sample_rows = buildStageSampleRows(report.stage_samples);
  report.recommendation_rows = buildRecommendationRows(recommendations);

  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_ml_filter_policy.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_ml_filter_policy.md`);
  report.artifacts.jsonPath = jsonPath;
  report.artifacts.mdPath = mdPath;
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
    writeText(mdPath, renderMarkdown({
      nowMeta,
      provider: PROVIDER,
      tf: TF,
      lookbackDays: LOOKBACK_DAYS,
      model: report.model,
      metrics,
      trainMetrics,
      validation: report.validation,
      latePenalty,
      recommendations,
      coverage,
      stageSamples: report.stage_samples,
      selfValidation,
      artifacts: {
        jsonPath,
        cache: report.artifacts.cache,
        weeklyGovernancePath: sharedObjective.filePath,
        objectiveSupervisorPath: report.artifacts.objective_supervisor_path,
      },
      sharedObjective,
      bestFebtContract,
      bestFebtMarketGuard,
    }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.md"));

  await sendKoreanTelegramSummary({
    title: `[학습 기반 필터 점검] ${PROVIDER}`,
    severity: split.mode === "HOLDOUT"
      && metrics && metrics.ok
      && metrics.brier != null && metrics.brier < 0.24
      && selfValidation.ok
      && sharedObjective && sharedObjective.currentObjective
      && sharedObjective.currentObjective.verdict === "PASS"
      ? "INFO"
      : "WARN",
    provider: PROVIDER,
    sections: [
      {
        header: "학습 상태 요약",
        lines: [
          `학습에 쓴 전체 표본은 ${examples.length}건이고, 실제 체결 ${executedExamples.length}건, 드롭 반사실 ${dropExamples.length}건입니다.`,
          `검증 방식은 ${split.mode}, 학습 ${trainingRows.length}건, 평가 ${split.eval.length}건입니다.`,
          `공통 목표 상태는 ${sharedObjective && sharedObjective.currentObjective ? sharedObjective.currentObjective.verdict : "정보 없음"} / 월간 예상 ${sharedObjective && sharedObjective.currentObjective && Number.isFinite(Number(sharedObjective.currentObjective.monthly_run_rate_krw)) ? `${Number(sharedObjective.currentObjective.monthly_run_rate_krw).toLocaleString("ko-KR")} KRW` : "정보 없음"} / 목표 ${Number(sharedObjective && sharedObjective.objectiveConfig && sharedObjective.objectiveConfig.min_monthly_net_krw || OBJECTIVE_TARGET_MONTHLY_KRW).toLocaleString("ko-KR")} KRW 입니다.`,
          `BEST/FEBT 계약은 ${bestFebtContract && bestFebtContract.mode || "정보 없음"} / replacement ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? pct(bestFebtContract.projected_replacement_ratio) : "정보 없음"} / count ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? `${Number(bestFebtContract.projected_count_ratio_global).toFixed(2)}x` : "정보 없음"} 입니다.`,
          `평가 결과는 정확도 ${pct(metrics.accuracy)}, Brier ${metrics.brier == null ? "정보 없음" : metrics.brier.toFixed(4)}, logloss ${metrics.logloss == null ? "정보 없음" : metrics.logloss.toFixed(4)} 입니다.`,
          `자체 검증 ${selfValidation.result} / ${selfValidation.checks.join(" ; ")}`,
          `늦은 진입 1봉 이상 지연 성공률 ${pct(latePenalty.late_1_plus.labelRate)} / 제시간 진입 성공률 ${pct(latePenalty.on_time.labelRate)} / 차이 ${signedPct(latePenalty.penalty_1_plus)}`,
        ],
      },
      {
        header: "권고",
        lines: [
          ...recommendations.QUALITY.slice(0, 2).map((row) => {
            const keyText = row.display_key || describeQualityRecommendationKeyForUser(row.key);
            const reasonText = row.display_reason || rewriteQualityRecommendationReasonForUser(row.reason);
            return `1차 상태/무결성 ${row.action}${keyText ? ` ${keyText} ${row.current} -> ${row.next}` : ""} / ${reasonText}`;
          }),
          `2차 진입 품질 ${recommendations.AI.action} / ${recommendations.AI.reason}`,
          `3차 상태 기반 Soft Sizing ${recommendations.MARKET.action}${recommendations.MARKET.key ? ` ${recommendations.MARKET.key} ${recommendations.MARKET.current} -> ${recommendations.MARKET.next}` : ""} / ${recommendations.MARKET.reason}`,
          `4차 EV/시간가치층 ${recommendations.EV.action} / ${recommendations.EV.reason}`,
        ],
      },
      {
        header: "보고서",
        lines: [mdPath, jsonPath],
      },
    ],
  });

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: report.generated_at_kst,
    provider: report.provider,
    tf: report.tf,
    sample_n: report.model.sample_n,
    executed_n: report.model.executed_n,
    drop_counterfactual_n: report.model.drop_counterfactual_n,
    quality_action_count: Array.isArray(report.recommendations.QUALITY) ? report.recommendations.QUALITY.length : 0,
    ai_action: report.recommendations.AI && report.recommendations.AI.action,
    market_action: report.recommendations.MARKET && report.recommendations.MARKET.action,
    ev_action: report.recommendations.EV && report.recommendations.EV.action,
    json_path: jsonPath,
    md_path: mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-ml-filter-policy failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    buildExecutedExamples,
    buildDropExamples,
    createBaseExample,
    makeSignalKey,
    resolveRegime,
    resolveDropStageKey,
    selectStageExamples,
    splitExamplesChronologically,
    buildMlSelfValidation,
    applySharedObjectiveGuard,
    sharedObjectiveFailing,
    bestFebtGuardReason,
    isAiHardeningRecommendation,
    isEvHardeningRecommendation,
  },
};
