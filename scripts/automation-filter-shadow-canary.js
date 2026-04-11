#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { queryBars } = require("../src/storage/barsSnapshots");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const engineTest = require("../src/engine/paperUpbitRunner").__test;
const { classifySignalReasonStage } = require("../src/utils/signalReasonView");
const { resolveEntryTimingTier, resolveEntrySide } = require("../src/utils/liveEntryTaxonomy");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const { loadSystemOpsLatestSync } = require("./lib/system-ops-runtime");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

const PROVIDER = String(process.env.FILTER_SHADOW_CANARY_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.FILTER_SHADOW_CANARY_TF || "15m").trim();
const GOLDEN_DIR = path.join(path.resolve(__dirname, ".."), "ops", "golden");
const GOLDEN_FIXTURE_PATH = path.join(GOLDEN_DIR, "filter_stage_golden_cases.json");
const MAX_SHADOW_PER_STAGE = Math.max(2, Number(process.env.FILTER_SHADOW_CANARY_MAX_PER_STAGE || 4));
const SHADOW_SCAN_LIMIT = Math.max(500, Number(process.env.FILTER_SHADOW_CANARY_SCAN_LIMIT || 4000));
const LOOKBACK_BARS = Math.max(12, Number(process.env.FILTER_SHADOW_CANARY_LOOKBACK_BARS || 16));
const AFTER_BARS = Math.max(1, Number(process.env.FILTER_SHADOW_CANARY_AFTER_BARS || 2));
const FLOAT_TOL = Number(process.env.FILTER_SHADOW_CANARY_FLOAT_TOL || 1e-9);
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json");
const SYSTEM_OPS_LATEST_JSON = path.join(OPS_DAILY_DIR, "system_ops_check_latest.json");
const GOLDEN_FIXTURE_VERSION = 2;

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(v, digits = 12) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function pct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function formatQty(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return n.toFixed(digits);
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return !!fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return !!fallback;
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function approxEqual(a, b, tol = FLOAT_TOL) {
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isFinite(an) || !Number.isFinite(bn)) return an === bn;
  return Math.abs(an - bn) <= tol;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolveCreatedMs(doc) {
  return (
    toNum(doc && doc.created_at_ms) ??
    parseIsoMs(doc && doc.created_at) ??
    toNum(doc && doc.updated_at_ms) ??
    parseIsoMs(doc && doc.updated_at) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms)
  );
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

async function fetchBarsWindow({ exchange, symbol, tf, barCloseMs, beforeBars = LOOKBACK_BARS, afterBars = AFTER_BARS } = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const timeframe = String(tf || "").trim();
  const endMs = Number(barCloseMs);
  if (!ex || !sym || !timeframe || !Number.isFinite(endMs)) return [];
  try {
    const tfMs = timeframe === "15m" ? 15 * 60 * 1000 : 60 * 60 * 1000;
    const fromMs = endMs - (Math.max(4, beforeBars) * tfMs);
    const toMs = endMs + (Math.max(1, afterBars) * tfMs);
    const prefix = `${ex}__${sym}__${timeframe}__`;
    const startKey = `${prefix}${Math.floor(fromMs)}`;
    const endKey = `${prefix}${Math.floor(toMs)}\uf8ff`;
    const snap = await getFirestore().collection("bars_snapshots")
      .orderBy("__name__")
      .startAt(startKey)
      .endAt(endKey)
      .limit(beforeBars + afterBars + 12)
      .get();
    const rows = [];
    snap.forEach((d) => {
      const row = parseBarSnapshot(d);
      if (row) rows.push(row);
    });
    rows.sort((a, b) => a.timestamp - b.timestamp);
    return rows;
  } catch (_err) {
    return [];
  }
}

function pickFirstEvDropRow(rows = []) {
  return (Array.isArray(rows) ? rows : []).find((row) => String(row && (row.drop_reason_code || row.reason) || "").toUpperCase() === "DROP_EV_GATE_TP1_PROB") || null;
}

function fallbackEvBars() {
  const baseTs = 1774491300000;
  const values = [
    [2198, 2201, 2195, 2199],
    [2199, 2200, 2193, 2194],
    [2194, 2196, 2189, 2190],
    [2190, 2192, 2185, 2187],
    [2187, 2188, 2182, 2183],
    [2183, 2185, 2178, 2180],
    [2180, 2182, 2175, 2177],
    [2177, 2179, 2172, 2175],
    [2175, 2178, 2170, 2176],
    [2176, 2177, 2169, 2171],
    [2171, 2174, 2168, 2173],
    [2173, 2174, 2160, 2159],
  ];
  return values.map((row, idx) => ({
    open: row[0],
    high: row[1],
    low: row[2],
    close: row[3],
    timestamp: baseTs - ((values.length - 1 - idx) * 15 * 60 * 1000),
  }));
}

function inferAiBiasCfgFromFeatures(features = {}, eventUpper = "LONG") {
  const f = (features && typeof features === "object") ? features : {};
  const event = String(eventUpper || f.event || "LONG").toUpperCase();
  const tier = resolveEntryTimingTier({ event, features: f });
  return {
    enabled: true,
    neutralPolicy: String(f.ai_bias_policy || "allow").trim().toLowerCase() || "allow",
    applyCore: tier === "CORE" ? true : true,
    applyPreReal: tier === "PRE_REAL" ? true : true,
    applyReal: tier === "REAL" ? true : true,
    applyEarly: tier === "EARLY",
    applyEmo: false,
    scoreThreshold: Number.isFinite(Number(f.ai_bias_score_threshold)) ? Number(f.ai_bias_score_threshold) : 0.01,
    confMin: Number.isFinite(Number(f.ai_bias_conf_min)) ? Number(f.ai_bias_conf_min) : 0,
    neutralMult: Number.isFinite(Number(f.ai_bias_gate_neutral_mult)) ? Number(f.ai_bias_gate_neutral_mult) : 0.5,
    oppositeMult: Number.isFinite(Number(f.ai_bias_gate_opposite_mult)) ? Number(f.ai_bias_gate_opposite_mult) : 0.35,
    strongOppositeScore: Number.isFinite(Number(f.ai_bias_gate_strong_opposite_score)) ? Number(f.ai_bias_gate_strong_opposite_score) : 0.2,
    strongOppositeConf: Number.isFinite(Number(f.ai_bias_gate_strong_opposite_conf)) ? Number(f.ai_bias_gate_strong_opposite_conf) : 0.55,
  };
}

function inferAiRiskBudgetFromFeatures(features = {}) {
  const f = (features && typeof features === "object") ? features : {};
  const dir = String(f.ai_bias_dir || "NEUTRAL").toUpperCase();
  const score = toNum(f.ai_bias_score);
  const conf = toNum(f.ai_bias_confidence);
  return {
    sideAllocation: {
      biasDirection: dir || "NEUTRAL",
      biasScore: Number.isFinite(score) ? score : 0,
      biasConfidence: Number.isFinite(conf) ? conf : 0,
    },
  };
}

function inferEvCfgFromFeatures(features = {}, cfgOverrides = {}) {
  const f = (features && typeof features === "object") ? features : {};
  const base = {
    enabled: true,
    applyCore: true,
    applyPreReal: true,
    applyReal: true,
    applyEarly: true,
    tp1ProbMin: Number.isFinite(Number(f.ev_gate_tp1_prob_min_global)) ? Number(f.ev_gate_tp1_prob_min_global) : 0.55,
    tp1ProbMinEarly: Number.isFinite(Number(f.ev_gate_tp1_prob_min)) ? Number(f.ev_gate_tp1_prob_min) : 0.55,
    tp1ProbMinCore: Number.isFinite(Number(f.ev_gate_tp1_prob_min)) ? Number(f.ev_gate_tp1_prob_min) : 0.55,
    tp1ProbMinPreReal: Number.isFinite(Number(f.ev_gate_tp1_prob_min)) ? Number(f.ev_gate_tp1_prob_min) : 0.55,
    tp1ProbMinReal: Number.isFinite(Number(f.ev_gate_tp1_prob_min)) ? Number(f.ev_gate_tp1_prob_min) : 0.55,
    tp1ProbFull: Number.isFinite(Number(f.ev_gate_tp1_prob_full)) ? Number(f.ev_gate_tp1_prob_full) : 0.60,
    tp1ProbKill: Number.isFinite(Number(f.ev_gate_tp1_prob_kill)) ? Number(f.ev_gate_tp1_prob_kill) : 0.50,
    qtyScaleMid: Number.isFinite(Number(f.ev_gate_qty_scale_mid)) ? Number(f.ev_gate_qty_scale_mid) : 0.70,
    qtyScaleLow: Number.isFinite(Number(f.ev_gate_qty_scale_low)) ? Number(f.ev_gate_qty_scale_low) : 0.40,
    lookbackBars: Number.isFinite(Number(f.ev_gate_lookback_bars)) ? Number(f.ev_gate_lookback_bars) : 12,
    atrBars: Number.isFinite(Number(f.ev_gate_atr_bars)) ? Number(f.ev_gate_atr_bars) : 8,
    defaultTp1Pct: Number.isFinite(Number(f.ev_gate_tp1_pct)) ? Number(f.ev_gate_tp1_pct) : 3.25,
    defaultSlPct: Number.isFinite(Number(f.ev_gate_sl_pct)) ? Number(f.ev_gate_sl_pct) : 1.65,
    skipMissingBars: false,
  };
  return { ...base, ...(cfgOverrides || {}) };
}

function inferWaitCfgFromFeatures(features = {}, eventUpper = "LONG") {
  const f = (features && typeof features === "object") ? features : {};
  const ev = String(eventUpper || f.event || "LONG").toUpperCase();
  const tier = resolveEntryTimingTier({ event: ev, features: f });
  return {
    enabled: true,
    applyCore: tier === "CORE" ? true : true,
    applyPreReal: tier === "PRE_REAL" ? true : true,
    applyReal: tier === "REAL" ? true : true,
    applyEarly: tier === "EARLY" ? true : true,
    sameDirStreakMin: Number.isFinite(Number(f.wait_one_bar_same_dir_streak_min)) ? Number(f.wait_one_bar_same_dir_streak_min) : 3,
    chaseRatioMin: Number.isFinite(Number(f.wait_one_bar_chase_ratio_min)) ? Number(f.wait_one_bar_chase_ratio_min) : 1.75,
    lastCloseControlMin: Number.isFinite(Number(f.wait_one_bar_last_close_control_min)) ? Number(f.wait_one_bar_last_close_control_min) : 0.80,
    lastDirBodyMin: Number.isFinite(Number(f.wait_one_bar_last_dir_body_min)) ? Number(f.wait_one_bar_last_dir_body_min) : 0.45,
    lastOppWickMax: Number.isFinite(Number(f.wait_one_bar_last_opposite_wick_max)) ? Number(f.wait_one_bar_last_opposite_wick_max) : 0.18,
    recentMove1PctMin: Number.isFinite(Number(f.wait_one_bar_recent_move1_pct_min)) ? Number(f.wait_one_bar_recent_move1_pct_min) : 0.45,
    counterDirBarsMax: Number.isFinite(Number(f.wait_one_bar_counter_dir_bars_max)) ? Number(f.wait_one_bar_counter_dir_bars_max) : 0,
  };
}

function inferQualityCfgFromRow(row = {}) {
  const reason = String(row.drop_reason_code || row.reason || "").toUpperCase();
  const event = String(row.event || "").toUpperCase();
  const f = (row.features_json && typeof row.features_json === "object") ? row.features_json : {};
  const tier = resolveEntryTimingTier({ event, features: f });
  const minScoreAbs = Number.isFinite(Number(f.min_score_abs))
    ? Number(f.min_score_abs)
    : (tier === "CORE" ? 24 : tier === "PRE_REAL" ? 30 : tier === "REAL" ? 36 : 16);
  return {
    enabled: true,
    trendOnly: reason.endsWith("_REGIME"),
    applyCore: true,
    applyPreReal: true,
    applyReal: true,
    applyEarly: true,
    minCoreScoreAbs: tier === "CORE" ? minScoreAbs : 24,
    minPreRealScoreAbs: tier === "PRE_REAL" ? minScoreAbs : 30,
    minRealScoreAbs: tier === "REAL" ? minScoreAbs : 36,
    minEarlyScoreAbs: tier === "EARLY" ? minScoreAbs : 16,
    minConfidence: reason.endsWith("_CONF") ? (Number.isFinite(Number(f.min_confidence)) ? Number(f.min_confidence) : 0.55) : 0,
    minWaveConf: reason.endsWith("_WAVE") ? (Number.isFinite(Number(f.min_wave_conf)) ? Number(f.min_wave_conf) : 0.60) : 0,
    blockConflict: reason.endsWith("_CONFLICT"),
    transitionExceptionEnabled: false,
    transitionExceptionCoreEnabled: false,
    transitionExceptionPreRealEnabled: false,
    transitionExceptionRealEnabled: false,
    transitionExceptionEarlyEnabled: false,
    transitionExceptionScoreAbs: 40,
    transitionExceptionWaveConfMin: 0.60,
  };
}

function summarizeStageResult(stage, raw) {
  if (stage === "AI") {
    return {
      drop: raw && raw.drop === true,
      reason: raw && raw.reason ? String(raw.reason) : null,
      qtyFraction: Number.isFinite(Number(raw && raw.qtyFraction)) ? roundTo(Number(raw.qtyFraction), 12) : null,
      aiPolicy: raw && raw.features ? String(raw.features.ai_missing_policy || "") : null,
      aiFallback: raw && raw.features ? String(raw.features.ai_missing_fallback || "") : null,
    };
  }
  if (stage === "PIPELINE") return raw;
  const ok = raw && raw.ok !== false;
  const action = raw && raw.action
    ? String(raw.action)
    : (!ok ? "DROP" : null);
  const qtyScale = Number.isFinite(Number(raw && raw.qtyScale))
    ? roundTo(Number(raw.qtyScale), 12)
    : (!ok ? 0 : null);
  return {
    ok,
    action,
    reason: raw && raw.reason ? String(raw.reason) : null,
    qtyScale,
    lowerBound: Number.isFinite(Number(raw && raw.detail && raw.detail.ev_gate_tp1_reach_prob_lower_bound))
      ? roundTo(Number(raw.detail.ev_gate_tp1_reach_prob_lower_bound), 12)
      : null,
  };
}

async function replayCase(caseDef = {}) {
  const stage = String(caseDef.stage || "").toUpperCase();
  const input = cloneJson(caseDef.input || {});
  if (stage === "QUALITY") {
    return summarizeStageResult(stage, engineTest.evaluateShortEntryGate(input));
  }
  if (stage === "AI") {
    return summarizeStageResult(stage, engineTest.resolveAiMissingPolicy(input));
  }
  if (stage === "MARKET") {
    return summarizeStageResult(stage, engineTest.evaluateAiBiasEntryGate(input));
  }
  if (stage === "EV") {
    return summarizeStageResult(stage, await engineTest.evaluateEvEntryGate(input));
  }
  if (stage === "WAIT") {
    return summarizeStageResult(stage, engineTest.evaluateWaitOneBarTiming(input));
  }
  if (stage === "PIPELINE") {
    const baseQty = Number(input.baseQty);
    const out = {
      ok: true,
      action: "ALLOW",
      droppedStage: null,
      reason: null,
      baseQty: Number.isFinite(baseQty) ? roundTo(baseQty, 12) : null,
      marketBiasMult: 1,
      evMult: 1,
      finalQty: Number.isFinite(baseQty) ? roundTo(baseQty, 12) : null,
      waitAction: "ALLOW",
    };
    if (!Number.isFinite(baseQty) || baseQty <= 0) {
      return { ...out, ok: false, action: "DROP", droppedStage: "PIPELINE", reason: "INVALID_BASE_QTY", finalQty: null };
    }
    const market = engineTest.evaluateAiBiasEntryGate(input.market || {});
    if (!market.ok) {
      return { ...out, ok: false, action: "DROP", droppedStage: "MARKET", reason: market.reason || null, marketBiasMult: 0, finalQty: 0 };
    }
    const marketScale = Number.isFinite(Number(market.qtyScale)) ? Number(market.qtyScale) : 1;
    out.marketBiasMult = roundTo(marketScale, 12);
    let qty = baseQty * marketScale;
    const ev = await engineTest.evaluateEvEntryGate(input.ev || {});
    if (!ev.ok) {
      return {
        ...out,
        ok: false,
        action: "DROP",
        droppedStage: "EV",
        reason: ev.reason || null,
        evMult: 0,
        finalQty: 0,
        lowerBound: Number.isFinite(Number(ev.detail && ev.detail.ev_gate_tp1_reach_prob_lower_bound))
          ? roundTo(Number(ev.detail.ev_gate_tp1_reach_prob_lower_bound), 12)
          : null,
      };
    }
    const evScale = Number.isFinite(Number(ev.qtyScale)) ? Number(ev.qtyScale) : 1;
    out.evMult = roundTo(evScale, 12);
    qty *= evScale;
    const wait = engineTest.evaluateWaitOneBarTiming(input.wait || {});
    out.waitAction = String(wait && wait.action || "ALLOW");
    if (!wait.ok) {
      return {
        ...out,
        ok: false,
        action: "WAIT_ONE_BAR",
        droppedStage: "WAIT",
        reason: wait.reason || null,
        finalQty: roundTo(qty, 12),
      };
    }
    return {
      ...out,
      finalQty: roundTo(qty, 12),
      lowerBound: Number.isFinite(Number(ev.detail && ev.detail.ev_gate_tp1_reach_prob_lower_bound))
        ? roundTo(Number(ev.detail.ev_gate_tp1_reach_prob_lower_bound), 12)
        : null,
    };
  }
  throw new Error(`UNSUPPORTED_STAGE:${stage}`);
}

function compareCanaryOutcome(expected = {}, actual = {}, caseDef = {}) {
  const mismatches = [];
  const stage = String(caseDef.stage || "").toUpperCase();
  const scalarKeys = stage === "PIPELINE"
    ? ["ok", "action", "droppedStage", "reason", "marketBiasMult", "evMult", "finalQty", "waitAction", "lowerBound"]
    : stage === "AI"
      ? ["drop", "reason", "qtyFraction", "aiPolicy", "aiFallback"]
      : ["ok", "action", "reason", "qtyScale", "lowerBound"];
  for (const key of scalarKeys) {
    let ev = expected[key];
    let av = actual[key];
    if (stage !== "AI" && stage !== "PIPELINE" && stage !== "WAIT") {
      const dropLike = expected.ok === false || actual.ok === false;
      if (dropLike && key === "action") {
        if (ev == null) ev = "DROP";
        if (av == null) av = "DROP";
      }
      if (dropLike && key === "qtyScale") {
        if (ev == null) ev = 0;
        if (av == null) av = 0;
      }
    }
    const bothNumeric = Number.isFinite(Number(ev)) && Number.isFinite(Number(av));
    const matched = bothNumeric ? approxEqual(ev, av) : (ev === av);
    if (!matched) mismatches.push({ key, expected: ev ?? null, actual: av ?? null });
  }
  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

function pickEvExitRules(features = {}) {
  return resolveExitRulesForPosition({ exchange: PROVIDER, exitProfileMode: String(features.exit_profile || "BASE").toUpperCase() || "BASE" });
}

async function buildGoldenFixture() {
  ensureDir(GOLDEN_DIR);
  const recent = await getCachedRecentByCreatedAt("signals_dropped", {
    limit: SHADOW_SCAN_LIMIT,
    maxDocs: Math.max(SHADOW_SCAN_LIMIT, 12000),
    refresh: false,
  });
  const evRow = pickFirstEvDropRow(recent.rows);
  const evBars = evRow
    ? await fetchBarsWindow({
      exchange: evRow.exchange || PROVIDER,
      symbol: evRow.symbol_or_pair_id || evRow.symbol || evRow.market,
      tf: evRow.tf || TF,
      barCloseMs: evRow.bar_close_time_utc_ms || evRow.signal_bar_close_time_utc_ms,
    })
    : fallbackEvBars();
  const evFeatures = cloneJson((evRow && evRow.features_json) || {
    event: "SHORT",
    exit_profile: "BASE",
    exit_policy_tp1_pct: 3.25,
    exit_policy_sl_pct: 1.65,
  });
  const evExchange = String((evRow && evRow.exchange) || PROVIDER).trim().toUpperCase();
  const evSymbol = String((evRow && (evRow.symbol_or_pair_id || evRow.symbol || evRow.market)) || "ETHUSDT").trim().toUpperCase();
  const evTf = String((evRow && evRow.tf) || TF).trim();
  const evBarCloseMs = Number((evRow && (evRow.bar_close_time_utc_ms || evRow.signal_bar_close_time_utc_ms)) || (evBars[evBars.length - 1] && evBars[evBars.length - 1].timestamp));
  const evEvent = String((evRow && evRow.event) || evFeatures.event || "SHORT").trim().toUpperCase();
  const evDir = resolveEntrySide(evEvent, (evRow && evRow.side) || evFeatures.side) || "LONG";
  const aiMissingResult = engineTest.resolveAiMissingPolicy({ qtyFraction: 0.08, features: {} });

  const cases = [
    {
      id: "quality_drop_core_long_score",
      stage: "QUALITY",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        features: { score: 20.056604493, confidence: 0.3248693773, zz_wave_conf: 0.6127122668, regime: "trend", pro_conflict: false, pro_conflict_long: false, pro_conflict_short: false },
        cfg: {
          enabled: true,
          trendOnly: true,
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          minCoreScoreAbs: 24,
          minPreRealScoreAbs: 30,
          minRealScoreAbs: 36,
          minEarlyScoreAbs: 16,
          minConfidence: 0,
          minWaveConf: 0,
          blockConflict: true,
          transitionExceptionEnabled: false,
          transitionExceptionCoreEnabled: false,
          transitionExceptionPreRealEnabled: false,
          transitionExceptionRealEnabled: false,
          transitionExceptionEarlyEnabled: false,
          transitionExceptionScoreAbs: 40,
          transitionExceptionWaveConfMin: 0.60,
        },
      },
    },
    {
      id: "quality_allow_core_long",
      stage: "QUALITY",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        features: { score: 41.2, confidence: 0.71, zz_wave_conf: 0.73, regime: "trend", pro_conflict: false, pro_conflict_long: false, pro_conflict_short: false },
        cfg: {
          enabled: true,
          trendOnly: true,
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          minCoreScoreAbs: 24,
          minPreRealScoreAbs: 30,
          minRealScoreAbs: 36,
          minEarlyScoreAbs: 16,
          minConfidence: 0,
          minWaveConf: 0,
          blockConflict: true,
          transitionExceptionEnabled: true,
          transitionExceptionCoreEnabled: true,
          transitionExceptionPreRealEnabled: true,
          transitionExceptionRealEnabled: false,
          transitionExceptionEarlyEnabled: false,
          transitionExceptionScoreAbs: 40,
          transitionExceptionWaveConfMin: 0.60,
        },
      },
    },
    {
      id: "ai_missing_policy_current",
      stage: "AI",
      source: "synthetic",
      input: {
        qtyFraction: 0.08,
        features: {},
      },
    },
    {
      id: "market_reduce_neutral_long",
      stage: "MARKET",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        cfg: {
          enabled: true,
          neutralPolicy: "allow",
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          applyEmo: false,
          scoreThreshold: 0.01,
          confMin: 0,
          neutralMult: 0.5,
          oppositeMult: 0.35,
          strongOppositeScore: 0.2,
          strongOppositeConf: 0.55,
        },
        riskBudget: { sideAllocation: { biasDirection: "NEUTRAL", biasScore: 0, biasConfidence: 0.25 } },
      },
    },
    {
      id: "market_drop_strong_opposite_short_bias",
      stage: "MARKET",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        cfg: {
          enabled: true,
          neutralPolicy: "allow",
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          applyEmo: false,
          scoreThreshold: 0.01,
          confMin: 0,
          neutralMult: 0.5,
          oppositeMult: 0.35,
          strongOppositeScore: 0.2,
          strongOppositeConf: 0.55,
        },
        riskBudget: { sideAllocation: { biasDirection: "SHORT", biasScore: -0.31, biasConfidence: 0.72 } },
      },
    },
    {
      id: "ev_drop_historical_or_fallback",
      stage: "EV",
      source: evRow ? "historical" : "fallback",
      input: {
        exchange: evExchange,
        symbol: evSymbol,
        tf: evTf,
        barCloseMs: evBarCloseMs,
        intent: "ENTRY",
        intentDir: evDir,
        eventUpper: evEvent,
        features: evFeatures,
        cfg: inferEvCfgFromFeatures(evFeatures, {}),
        exitRules: pickEvExitRules(evFeatures),
        exitProfile: String(evFeatures.exit_profile || "BASE").toUpperCase(),
        exitProfileReason: "GOLDEN_FIXTURE_BASE",
        bars: evBars,
      },
    },
    {
      id: "ev_reduce_mid_historical_or_fallback",
      stage: "EV",
      source: evRow ? "historical" : "fallback",
      input: {
        exchange: evExchange,
        symbol: evSymbol,
        tf: evTf,
        barCloseMs: evBarCloseMs,
        intent: "ENTRY",
        intentDir: evDir,
        eventUpper: evEvent,
        features: evFeatures,
        cfg: inferEvCfgFromFeatures(evFeatures, { tp1ProbMin: 0.40, tp1ProbMinEarly: 0.40, tp1ProbMinCore: 0.40, tp1ProbMinPreReal: 0.40, tp1ProbMinReal: 0.40, tp1ProbFull: 0.50, tp1ProbKill: 0.30, qtyScaleMid: 0.70, qtyScaleLow: 0.40 }),
        exitRules: pickEvExitRules(evFeatures),
        exitProfile: String(evFeatures.exit_profile || "BASE").toUpperCase(),
        exitProfileReason: "GOLDEN_FIXTURE_REDUCE_MID",
        bars: evBars,
      },
    },
    {
      id: "ev_allow_full_historical_or_fallback",
      stage: "EV",
      source: evRow ? "historical" : "fallback",
      input: {
        exchange: evExchange,
        symbol: evSymbol,
        tf: evTf,
        barCloseMs: evBarCloseMs,
        intent: "ENTRY",
        intentDir: evDir,
        eventUpper: evEvent,
        features: evFeatures,
        cfg: inferEvCfgFromFeatures(evFeatures, { tp1ProbMin: 0.35, tp1ProbMinEarly: 0.35, tp1ProbMinCore: 0.35, tp1ProbMinPreReal: 0.35, tp1ProbMinReal: 0.35, tp1ProbFull: 0.40, tp1ProbKill: 0.25, qtyScaleMid: 0.70, qtyScaleLow: 0.40 }),
        exitRules: pickEvExitRules(evFeatures),
        exitProfile: String(evFeatures.exit_profile || "BASE").toUpperCase(),
        exitProfileReason: "GOLDEN_FIXTURE_ALLOW_FULL",
        bars: evBars,
      },
    },
    {
      id: "wait_one_bar_trigger",
      stage: "WAIT",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        cfg: {
          enabled: true,
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          sameDirStreakMin: 3,
          chaseRatioMin: 1.75,
          lastCloseControlMin: 0.80,
          lastDirBodyMin: 0.45,
          lastOppWickMax: 0.18,
          recentMove1PctMin: 0.45,
          counterDirBarsMax: 0,
        },
        features: {
          ev_gate_same_dir_streak: 3,
          ev_gate_chase_ratio: 1.92,
          ev_gate_last_close_control: 0.86,
          ev_gate_last_dir_body: 0.56,
          ev_gate_last_opposite_wick: 0.10,
          ev_gate_recent_move_1_pct: 0.58,
          ev_gate_counter_dir_bars: 0,
        },
      },
    },
    {
      id: "wait_one_bar_allow",
      stage: "WAIT",
      source: "synthetic",
      input: {
        intent: "ENTRY",
        intentDir: "LONG",
        eventUpper: "CORE_LONG",
        cfg: {
          enabled: true,
          applyCore: true,
          applyPreReal: true,
          applyReal: true,
          applyEarly: true,
          sameDirStreakMin: 3,
          chaseRatioMin: 1.75,
          lastCloseControlMin: 0.80,
          lastDirBodyMin: 0.45,
          lastOppWickMax: 0.18,
          recentMove1PctMin: 0.45,
          counterDirBarsMax: 0,
        },
        features: {
          ev_gate_same_dir_streak: 2,
          ev_gate_chase_ratio: 1.10,
          ev_gate_last_close_control: 0.74,
          ev_gate_last_dir_body: 0.34,
          ev_gate_last_opposite_wick: 0.24,
          ev_gate_recent_move_1_pct: 0.22,
          ev_gate_counter_dir_bars: 1,
        },
      },
    },
    {
      id: "pipeline_market_reduce_ev_mid_wait_allow",
      stage: "PIPELINE",
      source: evRow ? "hybrid" : "synthetic",
      input: {
        baseQty: 0.22,
        market: {
          intent: "ENTRY",
          intentDir: "LONG",
          eventUpper: "CORE_LONG",
          cfg: {
            enabled: true,
            neutralPolicy: "allow",
            applyCore: true,
            applyPreReal: true,
            applyReal: true,
            applyEarly: true,
            applyEmo: false,
            scoreThreshold: 0.01,
            confMin: 0,
            neutralMult: 0.5,
            oppositeMult: 0.35,
            strongOppositeScore: 0.2,
            strongOppositeConf: 0.55,
          },
          riskBudget: { sideAllocation: { biasDirection: "NEUTRAL", biasScore: 0, biasConfidence: 0.25 } },
        },
        ev: {
          exchange: evExchange,
          symbol: evSymbol,
          tf: evTf,
          barCloseMs: evBarCloseMs,
          intent: "ENTRY",
          intentDir: evDir,
          eventUpper: evEvent,
          features: evFeatures,
          cfg: inferEvCfgFromFeatures(evFeatures, { tp1ProbMin: 0.40, tp1ProbMinEarly: 0.40, tp1ProbMinCore: 0.40, tp1ProbMinPreReal: 0.40, tp1ProbMinReal: 0.40, tp1ProbFull: 0.50, tp1ProbKill: 0.30, qtyScaleMid: 0.70, qtyScaleLow: 0.40 }),
          exitRules: pickEvExitRules(evFeatures),
          exitProfile: String(evFeatures.exit_profile || "BASE").toUpperCase(),
          exitProfileReason: "GOLDEN_PIPELINE_REDUCE",
          bars: evBars,
        },
        wait: {
          intent: "ENTRY",
          intentDir: evDir,
          eventUpper: evEvent,
          cfg: {
            enabled: true,
            applyCore: true,
            applyPreReal: true,
            applyReal: true,
            applyEarly: true,
            sameDirStreakMin: 3,
            chaseRatioMin: 1.75,
            lastCloseControlMin: 0.80,
            lastDirBodyMin: 0.45,
            lastOppWickMax: 0.18,
            recentMove1PctMin: 0.45,
            counterDirBarsMax: 0,
          },
          features: {
            ev_gate_same_dir_streak: 1,
            ev_gate_chase_ratio: 1.01,
            ev_gate_last_close_control: 0.73,
            ev_gate_last_dir_body: 0.59,
            ev_gate_last_opposite_wick: 0.14,
            ev_gate_recent_move_1_pct: 0.21,
            ev_gate_counter_dir_bars: 1,
          },
        },
      },
    },
  ];

  for (const caseDef of cases) {
    caseDef.expected = await replayCase(caseDef);
  }

  return {
    version: GOLDEN_FIXTURE_VERSION,
    provider: PROVIDER,
    tf: TF,
    baseline_created_at: new Date().toISOString(),
    baseline_created_at_ms: Date.now(),
    ev_fixture_source: evRow ? {
      signal_id: evRow.signal_id || null,
      symbol: evSymbol,
      event: evEvent,
      reason: evRow.drop_reason_code || evRow.reason || null,
      created_at: evRow.created_at || null,
    } : { signal_id: null, symbol: evSymbol, event: evEvent, reason: "FALLBACK", created_at: null },
    cases,
  };
}

const GOLDEN_RUNTIME_REFRESH_CASE_IDS = new Set(["ai_missing_policy_current"]);

async function goldenFixtureNeedsRuntimeRefresh(loaded) {
  if (!loaded || !Array.isArray(loaded.cases) || !loaded.cases.length) return true;
  for (const caseDef of loaded.cases) {
    if (!caseDef || !GOLDEN_RUNTIME_REFRESH_CASE_IDS.has(String(caseDef.id || ""))) continue;
    const replayed = await replayCase(caseDef);
    const cmp = compareCanaryOutcome(caseDef.expected || {}, replayed || {}, caseDef || {});
    if (!cmp.ok) return true;
  }
  return false;
}

async function ensureGoldenFixture() {
  try {
    const loaded = JSON.parse(fs.readFileSync(GOLDEN_FIXTURE_PATH, "utf8"));
    if (
      loaded
      && Number(loaded.version) === GOLDEN_FIXTURE_VERSION
      && Array.isArray(loaded.cases)
      && loaded.cases.length
      && !(await goldenFixtureNeedsRuntimeRefresh(loaded))
    ) return loaded;
  } catch (_err) {}
  const fixture = await buildGoldenFixture();
  ensureDir(path.dirname(GOLDEN_FIXTURE_PATH));
  fs.writeFileSync(GOLDEN_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return fixture;
}

function buildShadowAiCase(row) {
  const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || null;
  return {
    id: `shadow_ai__${String(row.signal_id || row.id || "").replace(/[^A-Za-z0-9_\-]/g, "_")}`,
    stage: "AI",
    source: "shadow",
    sourceDoc: { id: row.id || null, signal_id: row.signal_id || null, market, reason: row.drop_reason_code || row.reason || null, created_at: row.created_at || null },
    input: {
      qtyFraction: Number(row.qty_pct),
      features: (() => {
        const features = cloneJson(row.features_json || {});
        delete features.ai_signal;
        return features;
      })(),
    },
    expected: {
      drop: true,
      reason: String(row.drop_reason_code || row.reason || "") || null,
      qtyFraction: null,
      aiPolicy: row.features_json && row.features_json.ai_missing_policy ? String(row.features_json.ai_missing_policy) : null,
      aiFallback: row.features_json && row.features_json.ai_missing_fallback ? String(row.features_json.ai_missing_fallback) : null,
    },
  };
}

function buildShadowQualityCase(row) {
  const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || null;
  return {
    id: `shadow_quality__${String(row.signal_id || row.id || "").replace(/[^A-Za-z0-9_\-]/g, "_")}`,
    stage: "QUALITY",
    source: "shadow",
    sourceDoc: { id: row.id || null, signal_id: row.signal_id || null, market, reason: row.drop_reason_code || row.reason || null, created_at: row.created_at || null },
    input: {
      intent: String(row.event_intent || "ENTRY").toUpperCase(),
      intentDir: String(row.side || "").toUpperCase() === "SELL" ? "SHORT" : "LONG",
      eventUpper: String(row.event || "").toUpperCase(),
      features: cloneJson(row.features_json || {}),
      cfg: inferQualityCfgFromRow(row),
    },
    expected: {
      ok: false,
      action: "DROP",
      reason: String(row.drop_reason_code || row.reason || "") || null,
      qtyScale: 0,
      lowerBound: null,
    },
  };
}

function buildShadowMarketCase(row) {
  const features = cloneJson(row.features_json || {});
  const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || null;
  return {
    id: `shadow_market__${String(row.signal_id || row.id || "").replace(/[^A-Za-z0-9_\-]/g, "_")}`,
    stage: "MARKET",
    source: "shadow",
    sourceDoc: { id: row.id || null, signal_id: row.signal_id || null, market, reason: row.drop_reason_code || row.reason || null, created_at: row.created_at || null },
    input: {
      intent: String(row.event_intent || "ENTRY").toUpperCase(),
      intentDir: String(row.side || "").toUpperCase() === "SELL" ? "SHORT" : "LONG",
      eventUpper: String(row.event || "").toUpperCase(),
      cfg: inferAiBiasCfgFromFeatures(features, row.event),
      riskBudget: inferAiRiskBudgetFromFeatures(features),
    },
    expected: {
      ok: false,
      action: "DROP",
      reason: String(row.drop_reason_code || row.reason || "") || null,
      qtyScale: 0,
      lowerBound: null,
    },
  };
}

async function buildShadowEvCase(row) {
  const features = cloneJson(row.features_json || {});
  const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || null;
  const bars = await fetchBarsWindow({
    exchange: row.exchange || PROVIDER,
    symbol: row.symbol_or_pair_id || row.symbol || row.market,
    tf: row.tf || TF,
    barCloseMs: row.bar_close_time_utc_ms || row.signal_bar_close_time_utc_ms,
  });
  if (!bars.length) return null;
  return {
    id: `shadow_ev__${String(row.signal_id || row.id || "").replace(/[^A-Za-z0-9_\-]/g, "_")}`,
    stage: "EV",
    source: "shadow",
    sourceDoc: { id: row.id || null, signal_id: row.signal_id || null, market, reason: row.drop_reason_code || row.reason || null, created_at: row.created_at || null },
    input: {
      exchange: String(row.exchange || PROVIDER).toUpperCase(),
      symbol: String(row.symbol_or_pair_id || row.symbol || row.market || "").toUpperCase(),
      tf: String(row.tf || TF),
      barCloseMs: Number(row.bar_close_time_utc_ms || row.signal_bar_close_time_utc_ms),
      intent: String(row.event_intent || "ENTRY").toUpperCase(),
      intentDir: String(row.side || "").toUpperCase() === "SELL" ? "SHORT" : "LONG",
      eventUpper: String(row.event || "").toUpperCase(),
      features,
      cfg: inferEvCfgFromFeatures(features),
      exitRules: pickEvExitRules(features),
      exitProfile: String(features.exit_profile || "BASE").toUpperCase(),
      exitProfileReason: "SHADOW_DOC_REPLAY",
      bars,
    },
    expected: {
      ok: false,
      action: "DROP",
      reason: String(row.drop_reason_code || row.reason || "") || null,
      qtyScale: 0,
      lowerBound: Number.isFinite(Number(features.ev_gate_tp1_reach_prob_lower_bound)) ? roundTo(Number(features.ev_gate_tp1_reach_prob_lower_bound), 12) : null,
    },
  };
}

function buildShadowWaitCase(row) {
  const features = cloneJson(row.features_json || {});
  const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || null;
  return {
    id: `shadow_wait__${String(row.signal_id || row.id || "").replace(/[^A-Za-z0-9_\-]/g, "_")}`,
    stage: "WAIT",
    source: "shadow",
    sourceDoc: { id: row.id || null, signal_id: row.signal_id || null, market, reason: row.drop_reason_code || row.reason || null, created_at: row.created_at || null },
    input: {
      intent: String(row.event_intent || "ENTRY").toUpperCase(),
      intentDir: String(row.side || "").toUpperCase() === "SELL" ? "SHORT" : "LONG",
      eventUpper: String(row.event || "").toUpperCase(),
      cfg: inferWaitCfgFromFeatures(features, row.event),
      features,
    },
    expected: {
      ok: false,
      action: "WAIT_ONE_BAR",
      reason: String(row.drop_reason_code || row.reason || "") || null,
      qtyScale: null,
      lowerBound: null,
    },
  };
}

async function buildShadowCases({ baselineMs } = {}) {
  const recent = await getCachedRecentByCreatedAt("signals_dropped", {
    limit: SHADOW_SCAN_LIMIT,
    maxDocs: Math.max(SHADOW_SCAN_LIMIT, 12000),
    refresh: false,
  });
  const rows = (Array.isArray(recent.rows) ? recent.rows : []).filter((row) => {
    const createdMs = resolveCreatedMs(row);
    return Number.isFinite(createdMs) && createdMs >= Number(baselineMs || 0);
  });
  const out = [];
  const counters = { QUALITY: 0, AI: 0, MARKET: 0, EV: 0, TIMING: 0 };
  for (const row of rows) {
    const reason = String(row.drop_reason_code || row.reason || "");
    const stage = classifySignalReasonStage(reason);
    const key = String(stage.key || "OPS").toUpperCase();
    if (!["QUALITY", "AI", "MARKET", "EV", "TIMING"].includes(key)) continue;
    if (counters[key] >= MAX_SHADOW_PER_STAGE) continue;
    let caseDef = null;
    if (key === "QUALITY") caseDef = buildShadowQualityCase(row);
    else if (key === "AI") caseDef = buildShadowAiCase(row);
    else if (key === "MARKET") caseDef = buildShadowMarketCase(row);
    else if (key === "EV") caseDef = await buildShadowEvCase(row);
    else if (key === "TIMING") caseDef = buildShadowWaitCase(row);
    if (!caseDef) continue;
    counters[key] += 1;
    out.push(caseDef);
  }
  return { cases: out, counters, scanned: rows.length };
}

async function replayCases(cases = []) {
  const results = [];
  for (const caseDef of Array.isArray(cases) ? cases : []) {
    const actual = await replayCase(caseDef);
    const compare = compareCanaryOutcome(caseDef.expected || {}, actual || {}, caseDef);
    results.push({
      id: caseDef.id,
      stage: caseDef.stage,
      source: caseDef.source,
      sourceDoc: caseDef.sourceDoc || null,
      market: resolveCaseMarket(caseDef, actual),
      expected: caseDef.expected,
      actual,
      ok: compare.ok,
      mismatches: compare.mismatches,
    });
  }
  return results;
}

function parseMarketFromSignalId(signalId) {
  const raw = String(signalId || "").trim();
  if (!raw.startsWith("SIG__")) return null;
  const parts = raw.split("__");
  const market = String(parts[2] || "").trim().toUpperCase();
  return market || null;
}

function resolveCaseMarket(caseDef = {}, actual = null) {
  const candidates = [
    caseDef && caseDef.sourceDoc && caseDef.sourceDoc.market,
    caseDef && caseDef.input && caseDef.input.symbol,
    caseDef && caseDef.input && caseDef.input.ev && caseDef.input.ev.symbol,
    actual && actual.symbol,
    actual && actual.market,
    caseDef && caseDef.sourceDoc && parseMarketFromSignalId(caseDef.sourceDoc.signal_id),
  ];
  for (const value of candidates) {
    const market = String(value || "").trim().toUpperCase();
    if (market) return market;
  }
  return "GLOBAL";
}

function summarizeResults(results = []) {
  const rows = Array.isArray(results) ? results : [];
  const byStage = {};
  const byMarket = {};
  let drift = 0;
  for (const row of rows) {
    const stage = String(row.stage || "UNKNOWN").toUpperCase();
    const market = String(row.market || "GLOBAL").trim().toUpperCase() || "GLOBAL";
    if (!byStage[stage]) byStage[stage] = { total: 0, drift: 0 };
    byStage[stage].total += 1;
    if (!byMarket[market]) byMarket[market] = { total: 0, drift: 0, byStage: {} };
    byMarket[market].total += 1;
    if (!byMarket[market].byStage[stage]) byMarket[market].byStage[stage] = { total: 0, drift: 0 };
    byMarket[market].byStage[stage].total += 1;
    if (!row.ok) {
      byStage[stage].drift += 1;
      byMarket[market].drift += 1;
      byMarket[market].byStage[stage].drift += 1;
      drift += 1;
    }
  }
  return { total: rows.length, drift, byStage, byMarket };
}

function buildMarkdown(report) {
  const lines = [];
  lines.push(`# Filter Shadow Canary`);
  lines.push(`- 생성 시각: ${report.generated_at_kst}`);
  lines.push(`- provider/tf: ${report.provider} / ${report.tf}`);
  lines.push(`- golden fixture: ${report.fixture_path}`);
  lines.push(`- baseline: ${report.fixture_baseline_at || "N/A"}`);
  lines.push("");
  lines.push(`## 판정`);
  lines.push(`- golden drift: ${report.golden.summary.drift}/${report.golden.summary.total}`);
  lines.push(`- shadow drift: ${report.shadow.summary.drift}/${report.shadow.summary.total}`);
  lines.push(`- shadow scanned: ${report.shadow.scanned}`);
  lines.push("");
  lines.push(`## Golden Replay`);
  for (const [stage, meta] of Object.entries(report.golden.summary.byStage || {})) {
    lines.push(`- ${stage}: ${meta.total} cases / drift ${meta.drift}`);
  }
  for (const [market, meta] of Object.entries(report.golden.summary.byMarket || {})) {
    const driftStages = Object.entries(meta.byStage || {}).filter(([, value]) => Number(value && value.drift || 0) > 0).map(([stage]) => stage).join("|") || "none";
    lines.push(`- market ${market}: ${meta.total} cases / drift ${meta.drift} / stages ${driftStages}`);
  }
  lines.push("");
  lines.push(`## Shadow Replay`);
  for (const [stage, meta] of Object.entries(report.shadow.summary.byStage || {})) {
    lines.push(`- ${stage}: ${meta.total} cases / drift ${meta.drift}`);
  }
  for (const [market, meta] of Object.entries(report.shadow.summary.byMarket || {})) {
    const driftStages = Object.entries(meta.byStage || {}).filter(([, value]) => Number(value && value.drift || 0) > 0).map(([stage]) => stage).join("|") || "none";
    lines.push(`- market ${market}: ${meta.total} cases / drift ${meta.drift} / stages ${driftStages}`);
  }
  lines.push(`- stage coverage: QUALITY ${report.shadow.counters.QUALITY}, AI ${report.shadow.counters.AI}, MARKET ${report.shadow.counters.MARKET}, EV ${report.shadow.counters.EV}, WAIT ${report.shadow.counters.TIMING}`);
  lines.push("");
  lines.push("## System Ops");
  lines.push(`- available: ${report.system_ops && report.system_ops.available ? "YES" : "NO"}`);
  lines.push(`- status: ${report.system_ops && report.system_ops.status || "N/A"}`);
  lines.push(`- approvals: ${report.system_ops && report.system_ops.approval_n != null ? report.system_ops.approval_n : "N/A"}`);
  if (report.system_ops && Array.isArray(report.system_ops.approvals) && report.system_ops.approvals.length) {
    for (const row of report.system_ops.approvals.slice(0, 10)) {
      lines.push(`- approval: ${row.title || "N/A"} / ${row.reason || "N/A"}`);
    }
  }
  lines.push("");
  const driftRows = [
    ...report.golden.results.filter((row) => !row.ok).map((row) => ({ lane: "golden", ...row })),
    ...report.shadow.results.filter((row) => !row.ok).map((row) => ({ lane: "shadow", ...row })),
  ];
  lines.push(`## Drift Detail`);
  if (!driftRows.length) {
    lines.push(`- 없음`);
  } else {
    for (const row of driftRows.slice(0, 20)) {
      lines.push(`- [${row.lane}] ${row.id} (${row.stage})`);
      for (const mm of row.mismatches || []) {
        lines.push(`  - ${mm.key}: expected=${JSON.stringify(mm.expected)} / actual=${JSON.stringify(mm.actual)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function summarizeSystemOps(raw = null) {
  const src = raw && typeof raw === "object"
    ? (raw.raw && typeof raw.raw === "object" ? raw.raw : raw)
    : {};
  const approvals = Array.isArray(src.approvals) ? src.approvals : [];
  return {
    available: Object.keys(src).length > 0,
    generated_at_kst: String(src.generated_at_kst || "").trim() || null,
    status: String(src.status || "").trim() || null,
    mode: String(src.mode || "").trim() || null,
    approval_n: approvals.length,
    approvals: approvals.map((row) => ({
      title: String(row && row.title || "").trim() || null,
      reason: String(row && row.reason || "").trim() || null,
      action: String(row && row.action || "").trim() || null,
    })),
  };
}

async function main() {
  loadLocalEnv();
  const meta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "filter_shadow_canary", nowMeta: meta });
  const fixture = await ensureGoldenFixture();
  const goldenResults = await replayCases(fixture.cases || []);
  const shadow = await buildShadowCases({ baselineMs: fixture.baseline_created_at_ms });
  const shadowResults = await replayCases(shadow.cases || []);
  const systemOps = summarizeSystemOps(loadSystemOpsLatestSync({ fallbackPath: SYSTEM_OPS_LATEST_JSON }));
  const report = {
    generated_at_kst: meta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    provider: PROVIDER,
    tf: TF,
    fixture_path: GOLDEN_FIXTURE_PATH,
    fixture_baseline_at: fixture.baseline_created_at || null,
    fixture_case_n: Array.isArray(fixture.cases) ? fixture.cases.length : 0,
    golden: {
      summary: summarizeResults(goldenResults),
      results: goldenResults,
    },
    shadow: {
      scanned: shadow.scanned,
      counters: shadow.counters,
      summary: summarizeResults(shadowResults),
      results: shadowResults,
    },
    system_ops: systemOps,
  };
  const jsonPath = path.join(OPS_DAILY_DIR, `${meta.dateKey}_${meta.hhmm}_filter_shadow_canary.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${meta.dateKey}_${meta.hhmm}_filter_shadow_canary.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, buildMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const severity = report.golden.summary.drift > 0
    ? "ERROR"
    : report.shadow.summary.drift > 0
      ? "WARN"
      : "INFO";

  await sendKoreanTelegramSummary({
    title: `[자동화 변경 이상 여부 점검] ${PROVIDER}`,
    severity,
    provider: PROVIDER,
    sections: [
      {
        header: "검증 결과",
        lines: [
          `golden drift ${report.golden.summary.drift}/${report.golden.summary.total}`,
          `shadow drift ${report.shadow.summary.drift}/${report.shadow.summary.total}`,
          `shadow scanned ${report.shadow.scanned}`,
        ],
      },
      {
        header: "커버리지",
        lines: [
          `QUALITY ${report.shadow.counters.QUALITY} / AI ${report.shadow.counters.AI} / MARKET ${report.shadow.counters.MARKET}`,
          `EV ${report.shadow.counters.EV} / WAIT ${report.shadow.counters.TIMING}`,
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
    golden_cases: report.golden.summary.total,
    golden_drift: report.golden.summary.drift,
    shadow_cases: report.shadow.summary.total,
    shadow_drift: report.shadow.summary.drift,
    json_path: jsonPath,
    md_path: mdPath,
    fixture_path: GOLDEN_FIXTURE_PATH,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-filter-shadow-canary failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    approxEqual,
    compareCanaryOutcome,
    parseIsoMs,
    resolveCreatedMs,
    inferAiBiasCfgFromFeatures,
    inferEvCfgFromFeatures,
    inferQualityCfgFromRow,
    inferWaitCfgFromFeatures,
    summarizeStageResult,
  },
};
