"use strict";

const { getFirestore } = require("../../src/storage/firestore");
const { buildTradesFromFillsWithFunding } = require("../../src/services/tradesFromFills");
const { estimateTp1ReachProbability } = require("../../src/services/evTp1Probability");
const { resolveWaitOneBarConfig, evaluateWaitOneBarTiming } = require("../../src/services/waitOneBarPolicy");
const { resolveExitRulesForPosition } = require("../../src/engine/signalEngine");
const { classifySignalReasonStage } = require("../../src/utils/signalReasonView");
const {
  isEntryTierEvent,
  resolveEntryTimingTier,
  resolveEntrySide,
} = require("../../src/utils/liveEntryTaxonomy");

const CURRENT_BAR_MODEL = "TP1_REACH_RECENT_BARS_V1";
const DEFAULT_LOOKBACK_BARS = 12;
const DEFAULT_ATR_BARS = 8;
const DEFAULT_BAR_FETCH_LIMIT = 12000;

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
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

function parseIsoMs(v) {
  const ms = Date.parse(String(v || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveDocMs(doc) {
  return (
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    parseIsoMs(doc && doc.created_at) ??
    parseIsoMs(doc && doc.updated_at) ??
    parseIsoMs(doc && doc.ts)
  );
}

function resolveFillMs(doc) {
  return (
    toNum(doc && doc.exec_bar_close_time_utc_ms) ??
    toNum(doc && doc.signal_bar_close_time_utc_ms) ??
    toNum(doc && doc.bar_close_time_utc_ms) ??
    parseIsoMs(doc && doc.created_at) ??
    parseIsoMs(doc && doc.updated_at) ??
    parseIsoMs(doc && doc.ts)
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

function buildEntryEventId({ exchange, symbol, tf, signalBarCloseMs, event } = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const timeframe = String(tf || "").trim();
  const ms = Number(signalBarCloseMs);
  const ev = String(event || "").trim().toUpperCase();
  if (!ex || !sym || !timeframe || !Number.isFinite(ms) || !ev) return null;
  return `${ex}|${sym}|${timeframe}|${ms}|${ev}|${ev}`;
}

function isTp1Event(eventRaw) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}

function isExitEvent(eventRaw) {
  return String(eventRaw || "").trim().toUpperCase().startsWith("EXIT_");
}

function extractEntryProbability(row) {
  const features = resolveFeatures(row);
  const lowerBound = toNum(features.ev_gate_tp1_reach_prob_lower_bound);
  const probability = toNum(features.ev_gate_tp1_reach_prob);
  return {
    source: String(features.ev_gate_source || "").trim(),
    lowerBound,
    probability,
  };
}

function resolveRules(row, sysCfg = {}, exchange = "") {
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

async function fetchBarsRange({ exchange, symbol, tf, fromMs, toMs, limitN = DEFAULT_BAR_FETCH_LIMIT } = {}) {
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

async function loadBarsByMarket(rows = [], { exchange, tf, lookbackBars = DEFAULT_LOOKBACK_BARS, horizonMs = 12 * 60 * 60 * 1000 } = {}) {
  const markets = new Map();
  const tfMs = 15 * 60 * 1000;
  const padMs = Math.max(tfMs * (Math.max(lookbackBars, DEFAULT_ATR_BARS) + 4), 4 * 60 * 60 * 1000);
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

function evaluatePathFromEntry({ bars = [], entryBarMs, entryPrice, side, rules, leverage, horizonMs = 12 * 60 * 60 * 1000, nowMs = Date.now() } = {}) {
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
    entry_price: entry,
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

function classifyEntryOutcome(entry, fillsByEntryEventId, nowMs, maturityMs) {
  const entryEventId = buildEntryEventId({
    exchange: entry.exchange,
    symbol: entry.symbol_or_pair_id || entry.symbol,
    tf: entry.tf,
    signalBarCloseMs: entry.signal_bar_close_time_utc_ms,
    event: entry.event,
  });
  const signalBarMs = toNum(entry.signal_bar_close_time_utc_ms);
  const fills = entryEventId ? (fillsByEntryEventId.get(entryEventId) || []) : [];
  const exitFills = fills.filter((row) => isExitEvent(row.event));
  const tp1Hit = exitFills.some((row) => isTp1Event(row.event));
  if (tp1Hit) return { status: "TP1_HIT", entryEventId, exitCount: exitFills.length };
  if (exitFills.length > 0) return { status: "NO_TP1_EXITED", entryEventId, exitCount: exitFills.length };
  if (Number.isFinite(signalBarMs) && (nowMs - signalBarMs) >= maturityMs) {
    return { status: "UNRESOLVED_STALE", entryEventId, exitCount: 0 };
  }
  return { status: "UNRESOLVED_OPEN", entryEventId, exitCount: 0 };
}

function mapPathOutcomeForTune(path = {}) {
  if (!path || path.ok !== true) {
    return {
      outcome: String(path && path.skip_reason || "UNRESOLVED_OPEN").toUpperCase() === "IMMATURE" ? "UNRESOLVED_OPEN" : "UNRESOLVED_STALE",
      resolved: false,
    };
  }
  if (path.outcome === "TP1_FIRST") return { outcome: "TP1_HIT", resolved: true };
  if (path.outcome === "SL_FIRST" || path.outcome === "AMBIGUOUS_BOTH" || path.outcome === "HOLD") {
    return { outcome: "NO_TP1_EXITED", resolved: true };
  }
  return { outcome: "UNRESOLVED_STALE", resolved: false };
}

function pickEntryFill(fills = [], side = null) {
  const targetSide = String(side || "").trim().toUpperCase();
  return (Array.isArray(fills) ? fills : []).find((row) => {
    if (isExitEvent(row && row.event)) return false;
    const fillSide = String(row && row.side || "").trim().toUpperCase();
    if (!targetSide) return true;
    return fillSide === (targetSide === "LONG" ? "BUY" : "SELL");
  }) || null;
}

function resolveEntryReference(row, fills = [], entryBar = null) {
  const entryFill = pickEntryFill(fills, resolveSide(row));
  const execPrice = toNum(entryFill && (entryFill.exec_price ?? entryFill.price));
  const signalPrice = toNum(row && (row.signal_price ?? row.price));
  const barClose = toNum(entryBar && entryBar.close);
  const notionalKrw = toNum(entryFill && (entryFill.notional_krw ?? entryFill.budget_used_krw))
    ?? toNum(row && (row.budget_used_krw ?? row.budget_max_krw))
    ?? 1000;
  return {
    entry_fill: entryFill,
    entry_price: execPrice ?? signalPrice ?? barClose,
    notional_krw: notionalKrw,
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

function isStage4DropCandidate(row) {
  const reason = String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase();
  const stage = classifySignalReasonStage(reason);
  const key = String(stage && stage.key || "OPS").toUpperCase();
  return key === "EV" || key === "TIMING";
}

async function buildEvResolvedLedger({
  provider,
  tf,
  fromMs,
  toMs,
  nowMs,
  maturityHours = 12,
  intents = [],
  fills = [],
  drops = [],
  sysCfg = {},
} = {}) {
  const maturityMs = Math.max(3, Number(maturityHours) || 12) * 60 * 60 * 1000;
  const intentRows = filterEntryRows(intents, { exchange: provider, tf, fromMs, toMs })
    .filter((row) => String(row.status || "").trim().toUpperCase() === "FILLED");
  const dropRows = filterEntryRows(drops, { exchange: provider, tf, fromMs, toMs })
    .filter((row) => isStage4DropCandidate(row));
  const fillRows = (Array.isArray(fills) ? fills : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const ms = resolveFillMs(row);
    if (provider && ex !== provider) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });

  const builtTrades = await buildTradesFromFillsWithFunding(fillRows, { exchange: provider });
  const tradeMap = new Map();
  for (const row of (builtTrades && Array.isArray(builtTrades.trades)) ? builtTrades.trades : []) {
    const key = String(row && row.entry_event_id || "").trim();
    if (!key) continue;
    if (!tradeMap.has(key)) tradeMap.set(key, row);
  }

  const fillsByEntryEventId = new Map();
  for (const row of fillRows) {
    const entryEventId = String(row && row.entry_event_id || "").trim();
    if (!entryEventId) continue;
    if (!fillsByEntryEventId.has(entryEventId)) fillsByEntryEventId.set(entryEventId, []);
    fillsByEntryEventId.get(entryEventId).push(row);
  }
  for (const rows of fillsByEntryEventId.values()) {
    rows.sort((a, b) => (resolveDocMs(a) || 0) - (resolveDocMs(b) || 0));
  }

  const barsByMarket = await loadBarsByMarket(dropRows, {
    exchange: provider,
    tf,
    lookbackBars: DEFAULT_LOOKBACK_BARS,
    horizonMs: maturityMs,
  });

  const rows = [];
  for (const row of intentRows) {
    const ev = extractEntryProbability(row);
    const predicted = ev.lowerBound ?? ev.probability;
    if (ev.source !== CURRENT_BAR_MODEL || !Number.isFinite(predicted)) continue;
    const outcome = classifyEntryOutcome(row, fillsByEntryEventId, nowMs, maturityMs);
    const trade = outcome.entryEventId ? tradeMap.get(outcome.entryEventId) : null;
    rows.push({
      signal_key: makeSignalKey(row),
      stage4_source: "EXECUTED_ENTRY",
      actual_stage4_decision: "ENTER",
      actual_final_decision: "ENTER",
      symbol: String((row.symbol_or_pair_id || row.symbol || row.market) || "").trim().toUpperCase(),
      side: resolveSide(row),
      tier: resolveTier(row.event),
      event: String(row.event || "").trim().toUpperCase(),
      bar_ms: resolveDocMs(row),
      predicted: roundTo(predicted, 6),
      probability: roundTo(ev.probability, 6),
      lower_bound: roundTo(ev.lowerBound, 6),
      outcome: outcome.status,
      resolved_for_tune: ["TP1_HIT", "NO_TP1_EXITED", "UNRESOLVED_STALE"].includes(outcome.status),
      entry_event_id: outcome.entryEventId,
      realized_pnl_quote: trade ? toNum(trade.pnl_krw) : null,
      realized_ret_net: trade ? toNum(trade.pnl_pct) : null,
      stage_drop_reason: null,
    });
  }

  for (const row of dropRows) {
    const market = String((row.symbol_or_pair_id || row.symbol || row.market) || "").trim().toUpperCase();
    const bars = barsByMarket.get(market) || [];
    const entryBar = pickBarByTimestamp(bars, resolveDocMs(row));
    const ev = extractEntryProbability(row);
    const predicted = ev.lowerBound ?? ev.probability;
    const stage = classifySignalReasonStage(row.drop_reason_code || row.reason);
    let path = { ok: false, skip_reason: "ENTRY_BAR_MISSING" };
    if (entryBar && Number.isFinite(entryBar.close)) {
      path = evaluatePathFromEntry({
        bars,
        entryBarMs: Number(entryBar.timestamp),
        entryPrice: Number(entryBar.close),
        side: resolveSide(row),
        rules: resolveRules(row, sysCfg, provider),
        leverage: resolveLeverage(row, sysCfg),
        horizonMs: maturityMs,
        nowMs,
      });
    }
    const mapped = mapPathOutcomeForTune(path);
    rows.push({
      signal_key: makeSignalKey(row),
      stage4_source: String(stage && stage.key || "OPS").toUpperCase() === "TIMING" ? "WAIT_AFTER_STAGE4" : "EV_DROP",
      actual_stage4_decision: String(stage && stage.key || "OPS").toUpperCase() === "TIMING" ? "ENTER" : "DROP",
      actual_final_decision: String(stage && stage.key || "OPS").toUpperCase() === "TIMING" ? "WAIT" : "DROP",
      symbol: market,
      side: resolveSide(row),
      tier: resolveTier(row.event),
      event: String(row.event || "").trim().toUpperCase(),
      bar_ms: resolveDocMs(row),
      predicted: Number.isFinite(predicted) ? roundTo(predicted, 6) : null,
      probability: roundTo(ev.probability, 6),
      lower_bound: roundTo(ev.lowerBound, 6),
      outcome: mapped.outcome,
      resolved_for_tune: mapped.resolved,
      entry_event_id: null,
      realized_pnl_quote: null,
      realized_ret_net: path.ok === true ? toNum(path.selected_ret_net) : null,
      path_outcome: path.ok === true ? path.outcome : null,
      stage_drop_reason: String(row.drop_reason_code || row.reason || "").trim().toUpperCase() || null,
    });
  }

  const resolvedRows = rows.filter((row) => row && row.resolved_for_tune === true && Number.isFinite(Number(row.predicted)));
  const summary = {
    total_n: rows.length,
    resolved_n: resolvedRows.length,
    executed_entry_n: rows.filter((row) => row.stage4_source === "EXECUTED_ENTRY").length,
    ev_drop_n: rows.filter((row) => row.stage4_source === "EV_DROP").length,
    wait_after_stage4_n: rows.filter((row) => row.stage4_source === "WAIT_AFTER_STAGE4").length,
    tp1_hit_n: resolvedRows.filter((row) => row.outcome === "TP1_HIT").length,
    no_tp1_n: resolvedRows.filter((row) => row.outcome === "NO_TP1_EXITED").length,
    unresolved_stale_n: rows.filter((row) => row.outcome === "UNRESOLVED_STALE").length,
    avg_ret_net: (() => {
      const vals = resolvedRows.map((row) => toNum(row.realized_ret_net)).filter((v) => v != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    })(),
  };

  return {
    provider,
    tf,
    model: CURRENT_BAR_MODEL,
    maturity_hours: Math.round(maturityMs / (60 * 60 * 1000)),
    rows,
    summary,
  };
}

async function buildProvisionalRealizedOutcomeLedger({
  provider,
  tf,
  fromMs,
  toMs,
  nowMs,
  maturityHours = 12,
  intents = [],
  fills = [],
  sysCfg = {},
} = {}) {
  const maturityMs = Math.max(3, Number(maturityHours) || 12) * 60 * 60 * 1000;
  const intentRows = filterEntryRows(intents, { exchange: provider, tf, fromMs, toMs })
    .filter((row) => String(row.status || "").trim().toUpperCase() === "FILLED");
  const fillRows = (Array.isArray(fills) ? fills : []).filter((row) => {
    const ex = String(row && row.exchange || "").trim().toUpperCase();
    const rowTf = String(row && row.tf || "").trim();
    const ms = resolveFillMs(row);
    if (provider && ex !== provider) return false;
    if (tf && rowTf && rowTf !== tf) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(ms) && ms < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(ms) && ms >= toMs) return false;
    return true;
  });

  const builtTrades = await buildTradesFromFillsWithFunding(fillRows, { exchange: provider });
  const tradeMap = new Map();
  for (const row of (builtTrades && Array.isArray(builtTrades.trades)) ? builtTrades.trades : []) {
    const key = String(row && row.entry_event_id || "").trim();
    if (!key) continue;
    if (!tradeMap.has(key)) tradeMap.set(key, row);
  }

  const fillsByEntryEventId = new Map();
  for (const row of fillRows) {
    const entryEventId = String(row && row.entry_event_id || "").trim();
    if (!entryEventId) continue;
    if (!fillsByEntryEventId.has(entryEventId)) fillsByEntryEventId.set(entryEventId, []);
    fillsByEntryEventId.get(entryEventId).push(row);
  }
  for (const rows of fillsByEntryEventId.values()) {
    rows.sort((a, b) => (resolveDocMs(a) || 0) - (resolveDocMs(b) || 0));
  }

  const barsByMarket = await loadBarsByMarket(intentRows, {
    exchange: provider,
    tf,
    lookbackBars: DEFAULT_LOOKBACK_BARS,
    horizonMs: maturityMs,
  });

  const rows = [];
  for (const row of intentRows) {
    const outcome = classifyEntryOutcome(row, fillsByEntryEventId, nowMs, maturityMs);
    const trade = outcome.entryEventId ? tradeMap.get(outcome.entryEventId) : null;
    const market = String((row.symbol_or_pair_id || row.symbol || row.market) || "").trim().toUpperCase();
    const bars = barsByMarket.get(market) || [];
    const entryBar = pickBarByTimestamp(bars, resolveDocMs(row));
    const reference = resolveEntryReference(row, outcome.entryEventId ? (fillsByEntryEventId.get(outcome.entryEventId) || []) : [], entryBar);
    const finalRetNet = trade ? toNum(trade.pnl_pct) : null;
    const finalPnlKrw = trade ? toNum(trade.pnl_krw) : null;
    let provisional = { ok: false, skip_reason: outcome.status };
    if (outcome.status === "UNRESOLVED_STALE" && entryBar && Number.isFinite(reference.entry_price)) {
      provisional = evaluatePathFromEntry({
        bars,
        entryBarMs: Number(entryBar.timestamp),
        entryPrice: Number(reference.entry_price),
        side: resolveSide(row),
        rules: resolveRules(row, sysCfg, provider),
        leverage: resolveLeverage(row, sysCfg),
        horizonMs: maturityMs,
        nowMs,
      });
    }
    const provisionalRetNet = provisional.ok === true ? toNum(provisional.selected_ret_net) : null;
    const provisionalPnlKrw = Number.isFinite(provisionalRetNet) && Number.isFinite(reference.notional_krw)
      ? Number(reference.notional_krw) * Number(provisionalRetNet)
      : null;
    const effectiveSource = Number.isFinite(finalRetNet)
      ? "FINAL"
      : (Number.isFinite(provisionalRetNet) ? "PROVISIONAL" : null);
    const effectiveRetNet = Number.isFinite(finalRetNet) ? finalRetNet : provisionalRetNet;
    const effectivePnlKrw = Number.isFinite(finalPnlKrw) ? finalPnlKrw : provisionalPnlKrw;
    rows.push({
      entry_event_id: outcome.entryEventId,
      market,
      tf: String(row.tf || "").trim() || null,
      event: String(row.event || "").trim().toUpperCase() || null,
      side: resolveSide(row),
      entry_bar_ms: resolveDocMs(row),
      entry_price: Number.isFinite(reference.entry_price) ? Number(reference.entry_price) : null,
      entry_notional_krw: Number.isFinite(reference.notional_krw) ? Number(reference.notional_krw) : null,
      outcome_status: outcome.status,
      final_realized: Number.isFinite(finalRetNet),
      final_realized_ret_net: finalRetNet,
      final_realized_pnl_krw: finalPnlKrw,
      provisional_ready: provisional.ok === true,
      provisional_outcome: provisional.ok === true ? String(provisional.outcome || "HOLD").trim().toUpperCase() : null,
      provisional_ret_net: provisionalRetNet,
      provisional_pnl_krw: provisionalPnlKrw,
      effective_source: effectiveSource,
      effective_realized_ret_net: effectiveRetNet,
      effective_realized_pnl_krw: effectivePnlKrw,
    });
  }

  const effectiveRows = rows.filter((row) => Number.isFinite(toNum(row.effective_realized_ret_net)));
  const finalRows = rows.filter((row) => row.final_realized === true && Number.isFinite(toNum(row.final_realized_ret_net)));
  const provisionalRows = rows.filter((row) => row.effective_source === "PROVISIONAL" && Number.isFinite(toNum(row.provisional_ret_net)));
  const byMarketMap = new Map();
  for (const row of rows) {
    const market = String(row.market || "").trim().toUpperCase();
    if (!market) continue;
    if (!byMarketMap.has(market)) {
      byMarketMap.set(market, {
        market,
        total_entry_n: 0,
        final_realized_n: 0,
        provisional_n: 0,
        unresolved_open_n: 0,
        unresolved_stale_n: 0,
        effective_realized_n: 0,
        win_n: 0,
        effective_ret_sum: 0,
        effective_pnl_sum_krw: 0,
      });
    }
    const bucket = byMarketMap.get(market);
    bucket.total_entry_n += 1;
    if (row.outcome_status === "UNRESOLVED_OPEN") bucket.unresolved_open_n += 1;
    if (row.outcome_status === "UNRESOLVED_STALE") bucket.unresolved_stale_n += 1;
    if (row.final_realized === true && Number.isFinite(toNum(row.final_realized_ret_net))) bucket.final_realized_n += 1;
    if (row.effective_source === "PROVISIONAL" && Number.isFinite(toNum(row.provisional_ret_net))) bucket.provisional_n += 1;
    if (Number.isFinite(toNum(row.effective_realized_ret_net))) {
      bucket.effective_realized_n += 1;
      bucket.effective_ret_sum += Number(row.effective_realized_ret_net);
      bucket.effective_pnl_sum_krw += Number(row.effective_realized_pnl_krw || 0);
      if (Number(row.effective_realized_ret_net) > 0) bucket.win_n += 1;
    }
  }

  const by_market = Array.from(byMarketMap.values())
    .map((row) => ({
      market: row.market,
      total_entry_n: row.total_entry_n,
      final_realized_n: row.final_realized_n,
      provisional_n: row.provisional_n,
      unresolved_open_n: row.unresolved_open_n,
      unresolved_stale_n: row.unresolved_stale_n,
      effective_realized_n: row.effective_realized_n,
      effective_win_rate: row.effective_realized_n > 0 ? (row.win_n / row.effective_realized_n) : null,
      effective_avg_ret_net: row.effective_realized_n > 0 ? (row.effective_ret_sum / row.effective_realized_n) : null,
      effective_net_pnl_krw: row.effective_realized_n > 0 ? row.effective_pnl_sum_krw : null,
    }))
    .sort((a, b) =>
      (b.provisional_n - a.provisional_n)
      || (b.effective_realized_n - a.effective_realized_n)
      || a.market.localeCompare(b.market)
    );

  const effectiveWinN = effectiveRows.filter((row) => Number(row.effective_realized_ret_net) > 0).length;
  return {
    provider,
    tf,
    maturity_hours: Math.round(maturityMs / (60 * 60 * 1000)),
    rows,
    by_market,
    summary: {
      total_entry_n: rows.length,
      final_realized_n: finalRows.length,
      provisional_realized_n: provisionalRows.length,
      unresolved_open_n: rows.filter((row) => row.outcome_status === "UNRESOLVED_OPEN").length,
      unresolved_stale_n: rows.filter((row) => row.outcome_status === "UNRESOLVED_STALE").length,
      effective_realized_n: effectiveRows.length,
      effective_win_rate: effectiveRows.length > 0 ? (effectiveWinN / effectiveRows.length) : null,
      effective_avg_ret_net: effectiveRows.length > 0
        ? (effectiveRows.reduce((acc, row) => acc + Number(row.effective_realized_ret_net || 0), 0) / effectiveRows.length)
        : null,
      effective_net_pnl_krw: effectiveRows.length > 0
        ? effectiveRows.reduce((acc, row) => acc + Number(row.effective_realized_pnl_krw || 0), 0)
        : null,
      top_provisional_market: provisionalRows.length > 0 && by_market.length > 0 ? by_market[0].market : null,
      status: provisionalRows.length > 0 ? "PROVISIONAL_ACTIVE" : (finalRows.length > 0 ? "FINAL_ONLY" : "NO_EFFECTIVE_OUTCOME"),
    },
  };
}

function evaluateWaitStateRow(row, bars = [], { sysCfg = {}, exchange = "", nowMs = Date.now(), horizonHours = 12 } = {}) {
  const horizonMs = Math.max(4, Number(horizonHours) || 12) * 60 * 60 * 1000;
  const side = resolveSide(row);
  const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
  const barMs = resolveDocMs(row);
  if (!market || !side || !Number.isFinite(barMs)) return { ok: false, skip_reason: "BAD_ROW" };
  const entryBar = pickBarByTimestamp(bars, barMs);
  const nextBar = pickNextBar(bars, barMs);
  if (!entryBar || !Number.isFinite(entryBar.close)) return { ok: false, skip_reason: "ENTRY_BAR_MISSING" };
  if (!nextBar || !Number.isFinite(nextBar.close)) return { ok: false, skip_reason: "NEXT_BAR_MISSING" };
  if (nowMs < (Number(nextBar.timestamp) + horizonMs)) return { ok: false, skip_reason: "IMMATURE" };

  const rules = resolveRules(row, sysCfg, exchange);
  const leverage = resolveLeverage(row, sysCfg);
  const estimate = estimateTp1ReachProbability({
    bars,
    dir: side,
    tp1Pct: Math.abs(Number(rules.TP_P1) || 0) * 100,
    slPct: Math.abs(Number(rules.SL) || 0) * 100,
    barCloseMs: barMs,
    lookbackBars: DEFAULT_LOOKBACK_BARS,
    atrBars: DEFAULT_ATR_BARS,
  });
  if (!estimate || estimate.ok !== true) return { ok: false, skip_reason: String(estimate && estimate.skipReason || "ESTIMATE_UNAVAILABLE") };

  const waitCfg = resolveWaitOneBarConfig(sysCfg, exchange);
  const waitDecision = evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: side,
    eventUpper: String(row && row.event || "").toUpperCase(),
    cfg: waitCfg,
    features: mapEstimateToWaitFeatures(estimate),
  });

  const nowEval = evaluatePathFromEntry({
    bars,
    entryBarMs: barMs,
    entryPrice: Number(entryBar.close),
    side,
    rules,
    leverage,
    horizonMs,
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
    horizonMs,
    nowMs,
  });
  if (!waitEval.ok) return { ok: false, skip_reason: `WAIT_${waitEval.skip_reason}` };

  const nowRet = Number(nowEval.selected_ret_net);
  const waitRet = Number(waitEval.selected_ret_net);
  const deltaRet = Number.isFinite(waitRet) && Number.isFinite(nowRet) ? (waitRet - nowRet) : null;
  const policyTriggered = waitDecision && waitDecision.ok === false && String(waitDecision.action || "").toUpperCase() === "WAIT_ONE_BAR";
  const beneficialWait = Number.isFinite(deltaRet) ? (deltaRet > 0.0010) : false;
  const harmfulWait = Number.isFinite(deltaRet) ? (deltaRet < -0.0010) : false;
  let waitState = "ALLOW";
  if (policyTriggered) {
    if (waitEval.outcome === "TP1_FIRST") waitState = "WAIT_THEN_ENTER_TP1";
    else if (waitEval.outcome === "SL_FIRST") waitState = "WAIT_THEN_ENTER_SL";
    else if (waitEval.outcome === "AMBIGUOUS_BOTH") waitState = "WAIT_THEN_ENTER_AMBIGUOUS";
    else waitState = "WAIT_THEN_ENTER_HOLD";
  } else if (String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase() === "DROP_WAIT_ONE_BAR_TIMING") {
    waitState = "CURRENT_POLICY_NO_LONGER_WAITS";
  }

  return {
    ok: true,
    signal_key: makeSignalKey(row),
    source: String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase() === "DROP_WAIT_ONE_BAR_TIMING" ? "WAIT_DROP" : "ENTRY",
    market,
    side,
    tier: resolveTier(row && row.event),
    event: String(row && row.event || "").trim().toUpperCase(),
    bar_ms: barMs,
    next_bar_ms: Number(nextBar.timestamp),
    estimate_probability: roundTo(estimate.probability, 6),
    estimate_lower_bound: roundTo(estimate.lowerBound, 6),
    policy_triggered: policyTriggered,
    wait_state: waitState,
    now_outcome: nowEval.outcome,
    wait_outcome: waitEval.outcome,
    now_ret_net: toNum(nowRet),
    wait_ret_net: toNum(waitRet),
    delta_ret_net: toNum(deltaRet),
    beneficial_wait: beneficialWait,
    harmful_wait: harmfulWait,
    policy_outcome: policyTriggered ? waitEval.outcome : nowEval.outcome,
    policy_ret_net: policyTriggered ? toNum(waitRet) : toNum(nowRet),
  };
}

async function buildWaitStateMachineLedger({
  provider,
  tf,
  fromMs,
  toMs,
  nowMs,
  horizonHours = 12,
  signals = [],
  drops = [],
  sysCfg = {},
} = {}) {
  const signalRows = filterEntryRows(signals, { exchange: provider, tf, fromMs, toMs });
  const waitDropRows = filterEntryRows(drops, { exchange: provider, tf, fromMs, toMs })
    .filter((row) => String(row && (row.drop_reason_code || row.reason) || "").trim().toUpperCase() === "DROP_WAIT_ONE_BAR_TIMING");
  const universeRows = uniqueBySignalKey(signalRows.concat(waitDropRows));
  const barsByMarket = await loadBarsByMarket(universeRows, {
    exchange: provider,
    tf,
    lookbackBars: DEFAULT_LOOKBACK_BARS,
    horizonMs: Math.max(4, Number(horizonHours) || 12) * 60 * 60 * 1000,
  });
  const rows = universeRows.map((row) => {
    const market = String((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "").trim().toUpperCase();
    return evaluateWaitStateRow(row, barsByMarket.get(market) || [], {
      sysCfg,
      exchange: provider,
      nowMs,
      horizonHours,
    });
  });
  const maturedRows = rows.filter((row) => row && row.ok === true);
  const summary = {
    total_n: rows.length,
    matured_n: maturedRows.length,
    skipped_n: rows.length - maturedRows.length,
    wait_trigger_n: maturedRows.filter((row) => row.policy_triggered).length,
    beneficial_wait_n: maturedRows.filter((row) => row.policy_triggered && row.beneficial_wait).length,
    harmful_wait_n: maturedRows.filter((row) => row.policy_triggered && row.harmful_wait).length,
    wait_drop_rows_n: maturedRows.filter((row) => row.source === "WAIT_DROP").length,
    avg_delta_ret_net: (() => {
      const vals = maturedRows.map((row) => toNum(row.delta_ret_net)).filter((v) => v != null);
      if (!vals.length) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    })(),
    by_state: maturedRows.reduce((acc, row) => {
      const key = String(row.wait_state || "UNKNOWN");
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {}),
  };
  return {
    provider,
    tf,
    horizon_hours: horizonHours,
    rows,
    summary,
  };
}

function buildCoverageGuard(mlPolicyReport = {}) {
  const coverage = mlPolicyReport && mlPolicyReport.coverage ? mlPolicyReport.coverage : {};
  const stageSamples = mlPolicyReport && mlPolicyReport.stage_samples ? mlPolicyReport.stage_samples : {};
  const selfValidation = mlPolicyReport && mlPolicyReport.self_validation ? mlPolicyReport.self_validation : {};
  const aiCoverage = toNum(coverage.ai_bias_rate);
  const aiN = Number(stageSamples.ai_n || 0);
  const marketN = Number(stageSamples.market_n || 0);
  const aiPass = selfValidation.ok === true && aiN >= 40;
  const marketPass = selfValidation.ok === true && marketN >= 30 && Number.isFinite(aiCoverage) && aiCoverage >= 0.05;
  return {
    ai: {
      sample_n: aiN,
      min_sample: 40,
      pass: aiPass,
      reason: aiPass ? "AI_COVERAGE_OK" : "AI_COVERAGE_BLOCK",
    },
    market: {
      sample_n: marketN,
      min_sample: 30,
      ai_bias_coverage: aiCoverage,
      min_ai_bias_coverage: 0.05,
      pass: marketPass,
      reason: marketPass ? "MARKET_COVERAGE_OK" : "MARKET_COVERAGE_BLOCK",
    },
    self_validation_ok: selfValidation.ok === true,
    pass: aiPass && marketPass,
  };
}

module.exports = {
  CURRENT_BAR_MODEL,
  buildCoverageGuard,
  buildEvResolvedLedger,
  buildProvisionalRealizedOutcomeLedger,
  buildWaitStateMachineLedger,
  __test: {
    mapPathOutcomeForTune,
    evaluatePathFromEntry,
    evaluateWaitStateRow,
    buildEntryEventId,
  },
};
