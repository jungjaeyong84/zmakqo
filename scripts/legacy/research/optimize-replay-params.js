#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { resolveEventMapping } = require("../src/services/signalMapping");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");

const HOUR_MS = 60 * 60 * 1000;

function getArg(name, defVal) {
  const key = `--${name}=`;
  const found = process.argv.find((x) => x.startsWith(key));
  if (!found) return defVal;
  return found.slice(key.length);
}

function parseBool(x, defVal = false) {
  if (x == null) return defVal;
  const s = String(x).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return defVal;
}

function toMs(x) {
  if (x == null) return null;
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const t = Date.parse(x);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function normalizeExchange(x) {
  const s = String(x || "").trim().toUpperCase();
  if (!s) return null;
  if (s.includes("BINANCE")) return "BINANCEFUT";
  if (s.includes("KIWOOM")) return "KIWOOM";
  return s;
}

function normalizeTf(x) {
  const s = String(x || "").trim().toLowerCase();
  if (!s) return null;
  if (s.endsWith("m") || s.endsWith("h") || s.endsWith("d") || s.endsWith("w")) return s;
  if (s === "60") return "60m";
  if (s === "15") return "15m";
  if (s === "240") return "4h";
  return s;
}

function parseFeatures(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function extractSignalAction(features, signalId) {
  const direct = features && (features.action || features._intent_override_action_raw);
  if (direct) return String(direct || "").toUpperCase();
  const sid = String(signalId || "");
  if (sid.includes("|")) {
    const parts = sid.split("|").map((p) => p.trim()).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1].toUpperCase() : "";
    if (last === "ADD" || last === "ENTRY" || last === "EXIT") return last;
  }
  return null;
}

function isRealEvent(event) {
  return String(event || "").toUpperCase().startsWith("REAL_");
}

function isPreRealEvent(event) {
  return String(event || "").toUpperCase().startsWith("PRE_REAL_");
}

function isCoreEvent(event) {
  return String(event || "").toUpperCase().startsWith("CORE_");
}

function isEarlyEvent(event) {
  return String(event || "").toUpperCase().startsWith("EARLY_");
}

function isEmoEvent(event) {
  return String(event || "").toUpperCase().startsWith("EMO_");
}

function tierOfEvent(event) {
  const e = String(event || "").toUpperCase();
  if (isRealEvent(e)) return "REAL";
  if (isPreRealEvent(e)) return "PRE_REAL";
  if (isCoreEvent(e)) return "CORE";
  if (isEarlyEvent(e) || isEmoEvent(e)) return "EARLY";
  return null;
}

function sideToDir(side) {
  const s = String(side || "").toUpperCase();
  if (s === "BUY") return 1;
  if (s === "SELL") return -1;
  return 0;
}

function signalDir(event, side) {
  const e = String(event || "").toUpperCase();
  if (e.endsWith("_LONG")) return 1;
  if (e.endsWith("_SHORT")) return -1;
  return sideToDir(side);
}

function symbolOf(x) {
  return String(x.symbol || x.symbol_or_pair_id || x.market || "").trim().toUpperCase().replace(/\.P$/i, "");
}

function signalBarMs(sig) {
  return toMs(sig.bar_close_time_utc_ms) ?? toMs(sig.created_at);
}

function fillMs(fill) {
  return toMs(fill.exec_bar_close_time_utc_ms) ?? toMs(fill.bar_close_time_utc_ms) ?? toMs(fill.created_at);
}

function buildSignalDocId({ exchange, symbol, tf, barMs, event }) {
  if (!exchange || !symbol || !tf || !barMs || !event) return null;
  return `SIG__${exchange}__${symbol}__${tf}__${barMs}__${event}`;
}

function entrySignalIdFromFill(fill) {
  const entryId = String(fill.entry_event_id || "").trim();
  if (!entryId || !entryId.includes("|")) return null;
  const parts = entryId.split("|");
  if (parts.length < 6) return null;
  const exchange = normalizeExchange(parts[0]);
  const symbol = String(parts[1] || "").trim().toUpperCase();
  const tf = normalizeTf(parts[2]);
  const barMs = Number(parts[3]);
  const event = String(parts[4] || "").trim().toUpperCase();
  if (!Number.isFinite(barMs)) return null;
  return buildSignalDocId({ exchange, symbol, tf, barMs, event });
}

function barKey(symbol, ms) {
  return `${symbol}__${ms}`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function summarizeTrades(trades) {
  let totalPnlPct = 0;
  let totalPnlKrw = 0;
  let count = 0;
  let wins = 0;
  for (const t of trades) {
    if (!Number.isFinite(t.pnl_pct)) continue;
    count += 1;
    totalPnlPct += t.pnl_pct;
    if (Number.isFinite(t.pnl_krw)) totalPnlKrw += t.pnl_krw;
    if (t.pnl_pct > 0) wins += 1;
  }
  return {
    trades: count,
    win_rate: count ? Number((wins / count).toFixed(4)) : null,
    avg_pnl_pct: count ? Number((totalPnlPct / count).toFixed(6)) : null,
    total_pnl_krw: Number.isFinite(totalPnlKrw) ? Number(totalPnlKrw.toFixed(2)) : null,
  };
}

function buildTradesGrouped(fills) {
  const byKey = new Map();
  for (const f of fills) {
    const key = `${symbolOf(f)}__${f.tf || ""}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  const allTrades = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => (fillMs(a) || 0) - (fillMs(b) || 0));
    const { trades } = buildTradesFromFills(group);
    if (Array.isArray(trades) && trades.length) allTrades.push(...trades);
  }
  return allTrades;
}

function shortTimingCheck({ symbol, barMs, barsMap, dumpPct, wickMin }) {
  const cur = barsMap.get(barKey(symbol, barMs));
  const prev = barsMap.get(barKey(symbol, barMs - HOUR_MS));
  const next = barsMap.get(barKey(symbol, barMs + HOUR_MS));
  if (!cur || !prev || !next) return { ok: true, reason: "SHORT_TIMING_SKIPPED_MISSING_BARS" };
  const breakLow = next.low < cur.low;
  if (!breakLow) return { ok: false, reason: "REAL_SHORT_NO_FOLLOW_BREAK" };
  const prevClose = prev.close;
  const drop = prevClose > 0 ? ((prevClose - cur.close) / prevClose) * 100 : 0;
  const range = Math.max(cur.high - cur.low, 1e-9);
  const lowerWick = Math.max(0, Math.min(cur.open, cur.close) - cur.low);
  const lowerWickRatio = lowerWick / range;
  const reboundLike = cur.close > cur.open && drop >= dumpPct && lowerWickRatio >= wickMin;
  if (reboundLike) return { ok: false, reason: "REAL_SHORT_DUMP_REBOUND_GUARD" };
  return { ok: true, reason: "OK" };
}

function longTimingCheck({ symbol, barMs, barsMap, dumpPct, wickMin }) {
  const cur = barsMap.get(barKey(symbol, barMs));
  const prev = barsMap.get(barKey(symbol, barMs - HOUR_MS));
  const next = barsMap.get(barKey(symbol, barMs + HOUR_MS));
  if (!cur || !prev || !next) return { ok: true, reason: "LONG_TIMING_SKIPPED_MISSING_BARS" };
  const breakHigh = next.high > cur.high;
  if (!breakHigh) return { ok: false, reason: "REAL_LONG_NO_FOLLOW_BREAK" };
  const prevClose = prev.close;
  const rise = prevClose > 0 ? ((cur.close - prevClose) / prevClose) * 100 : 0;
  const range = Math.max(cur.high - cur.low, 1e-9);
  const upperWick = Math.max(0, cur.high - Math.max(cur.open, cur.close));
  const upperWickRatio = upperWick / range;
  const rejectLike = cur.close < cur.open && rise >= dumpPct && upperWickRatio >= wickMin;
  if (rejectLike) return { ok: false, reason: "REAL_LONG_PUMP_REJECT_GUARD" };
  return { ok: true, reason: "OK" };
}

async function fetchSignals(db, { exchange, tf, fromMs, toMs, limitSignals }) {
  const snap = await db.collection("signals").orderBy("created_at", "desc").limit(limitSignals).get();
  const out = [];
  snap.forEach((d) => {
    const s = d.data() || {};
    const ex = normalizeExchange(s.exchange);
    if (exchange && ex !== exchange) return;
    const tfNorm = normalizeTf(s.tf);
    if (tf && tfNorm && tfNorm !== tf) return;
    const ms = signalBarMs(s);
    if (!Number.isFinite(ms)) return;
    if (Number.isFinite(fromMs) && ms < fromMs) return;
    if (Number.isFinite(toMs) && ms >= toMs) return;
    const symbol = symbolOf(s);
    if (!symbol) return;
    out.push({
      id: d.id,
      signal_id: s.signal_id ? String(s.signal_id) : null,
      event: String(s.event || "").toUpperCase(),
      side: s.side,
      exchange: ex,
      tf: tfNorm,
      symbol,
      _ms: ms,
      _features: parseFeatures(s.features_json) || parseFeatures(s.features) || {},
    });
  });
  out.sort((a, b) => a._ms - b._ms);
  return out;
}

async function fetchFills(db, { exchange, tf, fromMs, toMs, limitFills }) {
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limitFills).get();
  const out = [];
  snap.forEach((d) => {
    const f = d.data() || {};
    const ex = normalizeExchange(f.exchange);
    if (exchange && ex !== exchange) return;
    if (exchange && !isLiveDocForExchange(exchange, f)) return;
    const tfNorm = normalizeTf(f.tf);
    if (tf && tfNorm && tfNorm !== tf) return;
    const ms = fillMs(f);
    if (!Number.isFinite(ms)) return;
    if (Number.isFinite(fromMs) && ms < fromMs) return;
    if (Number.isFinite(toMs) && ms >= toMs) return;
    out.push({
      ...f,
      id: d.id,
      exchange: ex,
      tf: tfNorm,
      symbol: symbolOf(f),
      _ms: ms,
    });
  });
  out.sort((a, b) => a._ms - b._ms);
  return out;
}

async function fetchBars(db, { exchange, tf, fromMs, toMsBound, symbolsSet, limitBars }) {
  const snap = await db.collection("bars_snapshots").orderBy("created_at", "desc").limit(limitBars).get();
  const barsMap = new Map();
  snap.forEach((d) => {
    const b = d.data() || {};
    const ex = normalizeExchange(b.exchange);
    if (exchange && ex !== exchange) return;
    const tfNorm = normalizeTf(b.tf);
    if (tf && tfNorm && tfNorm !== tf) return;
    const symbol = symbolOf(b);
    if (!symbol || (symbolsSet && !symbolsSet.has(symbol))) return;
    const ms = toMs(b.bar_close_time_utc_ms);
    if (!Number.isFinite(ms)) return;
    if (Number.isFinite(fromMs) && ms < fromMs - HOUR_MS) return;
    if (Number.isFinite(toMsBound) && ms >= toMsBound + HOUR_MS) return;
    const ohlcv = b.ohlcv_json || b.ohlcv || b.ohlc || {};
    const open = num(ohlcv.open ?? b.open);
    const high = num(ohlcv.high ?? b.high);
    const low = num(ohlcv.low ?? b.low);
    const close = num(ohlcv.close ?? b.close);
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;
    barsMap.set(barKey(symbol, ms), { open, high, low, close });
  });
  return barsMap;
}

function normalizeCfg(raw) {
  const cfg = { ...raw };
  cfg.realScoreMin = Math.max(0, Number(cfg.realScoreMin));
  cfg.realPostMin = Math.max(0, Math.min(0.99, Number(cfg.realPostMin)));
  cfg.realWaveMin = Math.max(0, Math.min(0.99, Number(cfg.realWaveMin)));
  cfg.preScoreMin = Math.max(0, Number(cfg.preScoreMin));
  cfg.prePostMin = Math.max(0, Math.min(0.99, Number(cfg.prePostMin)));
  cfg.preWaveMin = Math.max(0, Math.min(0.99, Number(cfg.preWaveMin)));
  cfg.earlyScoreMin = Math.max(0, Number(cfg.earlyScoreMin));
  cfg.earlyPostMin = Math.max(0, Math.min(0.99, Number(cfg.earlyPostMin)));
  cfg.earlyWaveMin = Math.max(0, Math.min(0.99, Number(cfg.earlyWaveMin)));
  cfg.coreScoreMin = Math.max(cfg.earlyScoreMin, Number(cfg.coreScoreMin));
  cfg.corePostMin = Math.max(cfg.earlyPostMin, Math.min(0.99, Number(cfg.corePostMin)));
  cfg.coreWaveMin = Math.max(cfg.earlyWaveMin, Math.min(0.99, Number(cfg.coreWaveMin)));
  cfg.preTierScoreMin = Math.max(cfg.coreScoreMin, Number(cfg.preTierScoreMin));
  cfg.preTierPostMin = Math.max(cfg.corePostMin, Math.min(0.99, Number(cfg.preTierPostMin)));
  cfg.preTierWaveMin = Math.max(cfg.coreWaveMin, Math.min(0.99, Number(cfg.preTierWaveMin)));
  cfg.realTierScoreMin = Math.max(cfg.preTierScoreMin, Number(cfg.realTierScoreMin));
  cfg.realTierPostMin = Math.max(cfg.preTierPostMin, Math.min(0.99, Number(cfg.realTierPostMin)));
  cfg.realTierWaveMin = Math.max(cfg.preTierWaveMin, Math.min(0.99, Number(cfg.realTierWaveMin)));
  cfg.dumpPct = Math.max(0.1, Number(cfg.dumpPct));
  cfg.wickMin = Math.max(0, Math.min(1, Number(cfg.wickMin)));
  return cfg;
}

function evaluateOne({ signals, fills, barsMap, cfg }) {
  const failedSignalKeys = new Set();
  const failedReasons = {};
  const posBySymbol = new Map();
  let shortTimingSkippedMissing = 0;
  let longTimingSkippedMissing = 0;

  for (const s of signals) {
    const event = s.event;
    const mapping = resolveEventMapping({ event: s.event, side: s.side });
    const intent = String(mapping.intent || "").toUpperCase();
    const dir = signalDir(event, mapping.side || s.side);
    const features = s._features || {};
    const action = extractSignalAction(features, s.signal_id || s.id);
    const symbol = s.symbol;
    const pos = posBySymbol.get(symbol) || 0;
    const tier = tierOfEvent(event);

    let blockReason = null;
    const gateReal = isRealEvent(event);
    const gatePreReal = cfg.applyPreRealGate && isPreRealEvent(event);
    if (intent !== "EXIT" && dir !== 0 && (gateReal || gatePreReal)) {
      const label = gateReal ? "REAL" : "PRE_REAL";
      const scoreMin = gateReal ? cfg.realScoreMin : cfg.preScoreMin;
      const postMin = gateReal ? cfg.realPostMin : cfg.prePostMin;
      const waveMin = gateReal ? cfg.realWaveMin : cfg.preWaveMin;
      const mustAddOnly = gateReal || cfg.preRealAddOnly;
      const useTimingCheck = gateReal || cfg.preRealTimingCheck;

      if (gateReal && cfg.blockRealAll) {
        blockReason = "REAL_BLOCK_ALL";
      } else if (mustAddOnly && pos !== dir) {
        blockReason = `${label}_NOT_ADD`;
      } else if (dir === 1 && (cfg.realLongSameAsShort || !gateReal)) {
        const score = num(features.score);
        const postLong = num(features.zz_post_prob_long);
        const waveConf = num(features.zz_wave_conf);
        if (Number.isFinite(score) && score < scoreMin) {
          blockReason = `${label}_LONG_SCORE_LOW`;
        } else if (Number.isFinite(postLong) && postLong < postMin) {
          blockReason = `${label}_LONG_POST_LOW`;
        } else if (Number.isFinite(waveConf) && waveConf < waveMin) {
          blockReason = `${label}_LONG_WAVE_LOW`;
        } else if (useTimingCheck) {
          const t = longTimingCheck({
            symbol,
            barMs: s._ms,
            barsMap,
            dumpPct: cfg.dumpPct,
            wickMin: cfg.wickMin,
          });
          if (!t.ok) {
            blockReason = String(t.reason || "").replace("REAL_", `${label}_`);
          } else if (t.reason === "LONG_TIMING_SKIPPED_MISSING_BARS") {
            longTimingSkippedMissing += 1;
          }
        }
      } else if (dir === -1) {
        const score = num(features.score);
        const postShort = num(features.zz_post_prob_short);
        const waveConf = num(features.zz_wave_conf);
        if (Number.isFinite(score) && score > -scoreMin) {
          blockReason = `${label}_SHORT_SCORE_LOW`;
        } else if (Number.isFinite(postShort) && postShort < postMin) {
          blockReason = `${label}_SHORT_POST_LOW`;
        } else if (Number.isFinite(waveConf) && waveConf < waveMin) {
          blockReason = `${label}_SHORT_WAVE_LOW`;
        } else if (useTimingCheck) {
          const t = shortTimingCheck({
            symbol,
            barMs: s._ms,
            barsMap,
            dumpPct: cfg.dumpPct,
            wickMin: cfg.wickMin,
          });
          if (!t.ok) {
            blockReason = String(t.reason || "").replace("REAL_", `${label}_`);
          } else if (t.reason === "SHORT_TIMING_SKIPPED_MISSING_BARS") {
            shortTimingSkippedMissing += 1;
          }
        }
      }
    }

    if (!blockReason && cfg.applyAllTierGate && intent !== "EXIT" && dir !== 0 && tier) {
      if (cfg.allTierBlockEmo && isEmoEvent(event)) {
        blockReason = "EMO_ENTRY_BLOCKED";
      } else {
        const isLong = dir === 1;
        const score = num(features.score);
        const postLong = num(features.zz_post_prob_long);
        const postShort = num(features.zz_post_prob_short);
        const waveConf = num(features.zz_wave_conf);
        const regime = String(features.pro_regime_state || features.regime_state || "").toLowerCase();
        const conflictAny = parseBool(features.pro_conflict ?? features.conflict, false);
        const conflictDir = isLong
          ? parseBool(features.pro_conflict_long ?? features.conflict_long, false)
          : parseBool(features.pro_conflict_short ?? features.conflict_short, false);
        let scoreMinTier = 0;
        let postMinTier = 0;
        let waveMinTier = 0;
        if (tier === "EARLY") {
          scoreMinTier = cfg.earlyScoreMin;
          postMinTier = cfg.earlyPostMin;
          waveMinTier = cfg.earlyWaveMin;
        } else if (tier === "CORE") {
          scoreMinTier = cfg.coreScoreMin;
          postMinTier = cfg.corePostMin;
          waveMinTier = cfg.coreWaveMin;
        } else if (tier === "PRE_REAL") {
          scoreMinTier = cfg.preTierScoreMin;
          postMinTier = cfg.preTierPostMin;
          waveMinTier = cfg.preTierWaveMin;
        } else {
          scoreMinTier = cfg.realTierScoreMin;
          postMinTier = cfg.realTierPostMin;
          waveMinTier = cfg.realTierWaveMin;
        }
        if (cfg.allTierTrendOnly && regime && regime !== "trend") {
          blockReason = `${tier}_REGIME_NOT_TREND`;
        } else if (cfg.allTierBlockConflict && (conflictAny || conflictDir)) {
          blockReason = `${tier}_CONFLICT`;
        } else if (Number.isFinite(score) && (Math.abs(score) < scoreMinTier || (isLong ? score < 0 : score > 0))) {
          blockReason = `${tier}_${isLong ? "LONG" : "SHORT"}_SCORE_LOW`;
        } else if (Number.isFinite(waveConf) && waveConf < waveMinTier) {
          blockReason = `${tier}_${isLong ? "LONG" : "SHORT"}_WAVE_LOW`;
        } else {
          const post = isLong ? postLong : postShort;
          if (Number.isFinite(post) && post < postMinTier) {
            blockReason = `${tier}_${isLong ? "LONG" : "SHORT"}_POST_LOW`;
          }
        }
      }
    }

    if (blockReason) {
      failedReasons[blockReason] = (failedReasons[blockReason] || 0) + 1;
      failedSignalKeys.add(s.id);
      if (s.signal_id) failedSignalKeys.add(String(s.signal_id));
      continue;
    }

    if (intent === "EXIT") {
      posBySymbol.set(symbol, 0);
    } else if (dir !== 0) {
      if (action === "ADD") posBySymbol.set(symbol, pos === dir ? dir : dir);
      else posBySymbol.set(symbol, dir);
    }
  }

  const strictFills = [];
  const strictDropFillReasons = {};
  for (const f of fills) {
    const mapping = resolveEventMapping({ event: f.event, side: f.side });
    const intent = String(mapping.intent || "").toUpperCase();
    const signalDocId = f.signal_doc_id ? String(f.signal_doc_id) : null;
    const signalId = f.signal_id ? String(f.signal_id) : null;
    const entrySignalId = entrySignalIdFromFill(f);
    const failedOwnSignal = (signalDocId && failedSignalKeys.has(signalDocId)) || (signalId && failedSignalKeys.has(signalId));
    if (failedOwnSignal) {
      strictDropFillReasons.FILL_SIGNAL_BLOCKED = (strictDropFillReasons.FILL_SIGNAL_BLOCKED || 0) + 1;
      continue;
    }
    if (intent === "EXIT" && entrySignalId && failedSignalKeys.has(entrySignalId)) {
      strictDropFillReasons.EXIT_OF_BLOCKED_ENTRY = (strictDropFillReasons.EXIT_OF_BLOCKED_ENTRY || 0) + 1;
      continue;
    }
    strictFills.push(f);
  }

  const strictTrades = buildTradesGrouped(strictFills);
  const strictSummary = summarizeTrades(strictTrades);
  return {
    strict: strictSummary,
    blocked_total: Object.values(failedReasons).reduce((a, b) => a + b, 0),
    blocked_reasons: failedReasons,
    dropped_fills: fills.length - strictFills.length,
    shortTimingSkippedMissing,
    longTimingSkippedMissing,
  };
}

function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) / 4294967296);
  };
}

function randInt(next, min, max) {
  return Math.floor(next() * (max - min + 1)) + min;
}

function randFloat(next, min, max, step = 0.01) {
  const n = randInt(next, 0, Math.round((max - min) / step));
  return Number((min + n * step).toFixed(4));
}

function pickBool(next, p = 0.5) {
  return next() < p;
}

function randomConfig(next) {
  const realScoreMin = randInt(next, 50, 95);
  const realPostMin = randFloat(next, 0.63, 0.88, 0.01);
  const realWaveMin = randFloat(next, 0.65, 0.88, 0.01);
  const applyPreRealGate = pickBool(next, 0.65);
  const preRealAddOnly = pickBool(next, 0.6);
  const preRealTimingCheck = pickBool(next, 0.5);
  const preScoreMin = randInt(next, 35, Math.max(35, realScoreMin - 5));
  const prePostMin = randFloat(next, 0.55, Math.max(0.55, Math.min(0.86, realPostMin)), 0.01);
  const preWaveMin = randFloat(next, 0.55, Math.max(0.55, Math.min(0.86, realWaveMin)), 0.01);
  const applyAllTierGate = pickBool(next, 0.35);
  const allTierTrendOnly = pickBool(next, 0.6);
  const allTierBlockConflict = true;
  const allTierBlockEmo = pickBool(next, 0.4);
  const earlyScoreMin = randInt(next, 10, 28);
  const earlyPostMin = randFloat(next, 0.50, 0.68, 0.01);
  const earlyWaveMin = randFloat(next, 0.50, 0.68, 0.01);
  const coreScoreMin = randInt(next, Math.max(earlyScoreMin, 18), 42);
  const corePostMin = randFloat(next, Math.max(earlyPostMin, 0.53), 0.78, 0.01);
  const coreWaveMin = randFloat(next, Math.max(earlyWaveMin, 0.53), 0.78, 0.01);
  const preTierScoreMin = randInt(next, Math.max(coreScoreMin, 25), Math.max(coreScoreMin, realScoreMin - 2));
  const preTierPostMin = randFloat(next, Math.max(corePostMin, 0.56), Math.max(corePostMin, Math.min(0.84, realPostMin)), 0.01);
  const preTierWaveMin = randFloat(next, Math.max(coreWaveMin, 0.56), Math.max(coreWaveMin, Math.min(0.84, realWaveMin)), 0.01);
  const realTierScoreMin = randInt(next, Math.max(preTierScoreMin, 35), Math.max(preTierScoreMin, realScoreMin + 5));
  const realTierPostMin = randFloat(next, Math.max(preTierPostMin, 0.60), Math.max(preTierPostMin, Math.min(0.90, realPostMin + 0.03)), 0.01);
  const realTierWaveMin = randFloat(next, Math.max(preTierWaveMin, 0.60), Math.max(preTierWaveMin, Math.min(0.90, realWaveMin + 0.03)), 0.01);
  return normalizeCfg({
    blockRealAll: false,
    realLongSameAsShort: true,
    realScoreMin,
    realPostMin,
    realWaveMin,
    applyPreRealGate,
    preRealAddOnly,
    preRealTimingCheck,
    preScoreMin,
    prePostMin,
    preWaveMin,
    applyAllTierGate,
    allTierTrendOnly,
    allTierBlockConflict,
    allTierBlockEmo,
    earlyScoreMin,
    earlyPostMin,
    earlyWaveMin,
    coreScoreMin,
    corePostMin,
    coreWaveMin,
    preTierScoreMin,
    preTierPostMin,
    preTierWaveMin,
    realTierScoreMin,
    realTierPostMin,
    realTierWaveMin,
    dumpPct: 1.8,
    wickMin: 0.45,
  });
}

function randomConfigPreRealOnly(next, baselineCfg) {
  const base = { ...baselineCfg };
  const preScoreMin = randInt(next, 28, 60);
  const prePostMin = randFloat(next, 0.54, 0.78, 0.01);
  const preWaveMin = randFloat(next, 0.54, 0.82, 0.01);
  const preTierScoreMin = randInt(next, Math.max(28, preScoreMin), 70);
  const preTierPostMin = randFloat(next, Math.max(0.54, prePostMin), 0.84, 0.01);
  const preTierWaveMin = randFloat(next, Math.max(0.54, preWaveMin), 0.86, 0.01);
  return normalizeCfg({
    ...base,
    applyPreRealGate: true,
    preRealAddOnly: pickBool(next, 0.6),
    preRealTimingCheck: pickBool(next, 0.7),
    preScoreMin,
    prePostMin,
    preWaveMin,
    preTierScoreMin,
    preTierPostMin,
    preTierWaveMin,
    applyAllTierGate: false,
    allTierTrendOnly: base.allTierTrendOnly,
    allTierBlockConflict: true,
    allTierBlockEmo: base.allTierBlockEmo,
  });
}

function cfgKey(cfg) {
  return JSON.stringify(cfg);
}

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const fromMs = toMs(getArg("from", "2026-01-19T00:00:00+09:00"));
  const toMsBound = toMs(getArg("to", "2026-02-21T00:00:00+09:00"));
  const limitSignals = Math.max(20000, Number(getArg("limit_signals", "70000")));
  const limitFills = Math.max(20000, Number(getArg("limit_fills", "70000")));
  const limitBars = Math.max(40000, Number(getArg("limit_bars", "160000")));
  const iterations = Math.max(100, Number(getArg("iterations", "2500")));
  const seed = Math.floor(Number(getArg("seed", "20260221")));
  const minTrades = Math.max(1, Number(getArg("min_trades", "250")));
  const focusPreRealOnly = parseBool(getArg("focus_pre_real_only", "0"), false);
  const forceBlockReal = parseBool(getArg("force_block_real", "0"), false);
  const targetWin = Number(getArg("target_win", "0.55"));
  const targetWinMax = Number(getArg("target_win_max", "0.60"));
  const capitalKrw = Number(getArg("capital_krw", "20000000"));
  const targetMonthlyPct = Number(getArg("target_monthly_pct", "5"));
  const usdtKrw = Number(getArg("usdt_krw", "1400"));

  const db = getFirestore();
  const signals = await fetchSignals(db, {
    exchange,
    tf,
    fromMs,
    toMs: toMsBound,
    limitSignals,
  });
  const fills = await fetchFills(db, {
    exchange,
    tf,
    fromMs,
    toMs: toMsBound,
    limitFills,
  });
  const symbolsSet = new Set();
  signals.forEach((s) => symbolsSet.add(s.symbol));
  fills.forEach((f) => symbolsSet.add(f.symbol));
  const barsMap = await fetchBars(db, {
    exchange,
    tf,
    fromMs,
    toMsBound,
    symbolsSet,
    limitBars,
  });

  const targetKrw = (capitalKrw * targetMonthlyPct) / 100.0;
  const targetUnits = usdtKrw > 0 ? (targetKrw / usdtKrw) : targetKrw;

  const baselineCfg = normalizeCfg({
    blockRealAll: false,
    realLongSameAsShort: true,
    realScoreMin: 58,
    realPostMin: 0.69,
    realWaveMin: 0.73,
    applyPreRealGate: false,
    preRealAddOnly: false,
    preRealTimingCheck: false,
    preScoreMin: 48,
    prePostMin: 0.66,
    preWaveMin: 0.70,
    applyAllTierGate: false,
    allTierTrendOnly: true,
    allTierBlockConflict: true,
    allTierBlockEmo: true,
    earlyScoreMin: 22,
    earlyPostMin: 0.56,
    earlyWaveMin: 0.58,
    coreScoreMin: 32,
    corePostMin: 0.59,
    coreWaveMin: 0.61,
    preTierScoreMin: 48,
    preTierPostMin: 0.66,
    preTierWaveMin: 0.70,
    realTierScoreMin: 58,
    realTierPostMin: 0.70,
    realTierWaveMin: 0.74,
    dumpPct: 1.8,
    wickMin: 0.45,
  });
  if (forceBlockReal) baselineCfg.blockRealAll = true;

  const baseline = evaluateOne({ signals, fills, barsMap, cfg: baselineCfg });
  const seen = new Set([cfgKey(baselineCfg)]);
  const next = rng(seed);

  let bestByWin = {
    cfg: baselineCfg,
    result: baseline,
  };
  let bestByPnl = {
    cfg: baselineCfg,
    result: baseline,
  };
  let bestTarget = null;
  const topCandidates = [];

  function pushTop(item) {
    topCandidates.push(item);
    topCandidates.sort((a, b) => {
      const wrA = a.result.strict.win_rate ?? -1;
      const wrB = b.result.strict.win_rate ?? -1;
      if (wrB !== wrA) return wrB - wrA;
      return (b.result.strict.total_pnl_krw ?? -1e18) - (a.result.strict.total_pnl_krw ?? -1e18);
    });
    while (topCandidates.length > 20) topCandidates.pop();
  }

  pushTop({ cfg: baselineCfg, result: baseline, source: "baseline" });

  for (let i = 0; i < iterations; i += 1) {
    let cfg = focusPreRealOnly
      ? randomConfigPreRealOnly(next, baselineCfg)
      : randomConfig(next);
    if (forceBlockReal) cfg.blockRealAll = true;
    let key = cfgKey(cfg);
    if (seen.has(key)) continue;
    seen.add(key);

    const result = evaluateOne({ signals, fills, barsMap, cfg });
    const wr = result.strict.win_rate ?? -1;
    const pnl = result.strict.total_pnl_krw ?? -1e18;
    const trades = result.strict.trades ?? 0;

    if (wr > (bestByWin.result.strict.win_rate ?? -1) || (wr === (bestByWin.result.strict.win_rate ?? -1) && pnl > (bestByWin.result.strict.total_pnl_krw ?? -1e18))) {
      bestByWin = { cfg, result };
    }
    if (pnl > (bestByPnl.result.strict.total_pnl_krw ?? -1e18) || (pnl === (bestByPnl.result.strict.total_pnl_krw ?? -1e18) && wr > (bestByPnl.result.strict.win_rate ?? -1))) {
      bestByPnl = { cfg, result };
    }
    if (
      trades >= minTrades &&
      wr >= targetWin &&
      wr <= targetWinMax &&
      pnl >= targetUnits
    ) {
      if (!bestTarget || wr > (bestTarget.result.strict.win_rate ?? -1) || (wr === (bestTarget.result.strict.win_rate ?? -1) && pnl > (bestTarget.result.strict.total_pnl_krw ?? -1e18))) {
        bestTarget = { cfg, result };
      }
    }
    pushTop({ cfg, result, source: "random" });
  }

  const out = {
    scope: {
      exchange,
      tf,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      to_iso: toMsBound ? new Date(toMsBound).toISOString() : null,
      signals_total: signals.length,
      fills_total: fills.length,
      bars_loaded: barsMap.size,
      symbols: symbolsSet.size,
      iterations,
      seed,
      focus_pre_real_only: focusPreRealOnly,
      force_block_real: forceBlockReal,
    },
    target: {
      win_rate_min: targetWin,
      win_rate_max: targetWinMax,
      min_trades: minTrades,
      capital_krw: capitalKrw,
      monthly_return_pct: targetMonthlyPct,
      usdt_krw: usdtKrw,
      required_pnl_units: Number(targetUnits.toFixed(4)),
    },
    baseline: {
      cfg: baselineCfg,
      strict: baseline.strict,
      blocked_total: baseline.blocked_total,
    },
    best_by_win_rate: {
      cfg: bestByWin.cfg,
      strict: bestByWin.result.strict,
      blocked_total: bestByWin.result.blocked_total,
    },
    best_by_pnl: {
      cfg: bestByPnl.cfg,
      strict: bestByPnl.result.strict,
      blocked_total: bestByPnl.result.blocked_total,
    },
    best_target_match: bestTarget ? {
      cfg: bestTarget.cfg,
      strict: bestTarget.result.strict,
      blocked_total: bestTarget.result.blocked_total,
    } : null,
    top_candidates: topCandidates.map((x) => ({
      source: x.source,
      strict: x.result.strict,
      blocked_total: x.result.blocked_total,
      cfg: x.cfg,
    })),
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
