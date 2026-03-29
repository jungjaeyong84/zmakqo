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
  const e = String(event || "").toUpperCase();
  return e.startsWith("REAL_");
}

function isPreRealEvent(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("PRE_REAL_");
}

function isRealShortEvent(event) {
  const e = String(event || "").toUpperCase();
  return e === "REAL_SHORT";
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
  return (
    toMs(fill.exec_bar_close_time_utc_ms) ??
    toMs(fill.bar_close_time_utc_ms) ??
    toMs(fill.created_at)
  );
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

function maybeScale(v, ratio) {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n * ratio;
}

function scaleFillForDowngrade(fill, ratio) {
  const out = { ...fill };
  out.exec_qty_base = maybeScale(fill.exec_qty_base, ratio);
  out.qty_pct = maybeScale(fill.qty_pct, ratio);
  out.qty_fraction = maybeScale(fill.qty_fraction, ratio);
  out.notional_krw = maybeScale(fill.notional_krw, ratio);
  out.notional = maybeScale(fill.notional, ratio);
  if (out.event && String(out.event).toUpperCase() === "REAL_LONG") out.event = "PRE_REAL_LONG";
  if (out.event && String(out.event).toUpperCase() === "REAL_SHORT") out.event = "PRE_REAL_SHORT";
  return out;
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
  if (!cur || !prev || !next) {
    return { ok: true, reason: "SHORT_TIMING_SKIPPED_MISSING_BARS" };
  }
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
  if (!cur || !prev || !next) {
    return { ok: true, reason: "LONG_TIMING_SKIPPED_MISSING_BARS" };
  }
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
      ...s,
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
    const symbol = symbolOf(f);
    if (!symbol) return;
    out.push({
      id: d.id,
      ...f,
      exchange: ex,
      tf: tfNorm,
      symbol,
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

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const fromMs = toMs(getArg("from", "2026-02-01T00:00:00Z"));
  const toMsBound = toMs(getArg("to", "2026-02-21T00:00:00Z"));
  const limitSignals = Math.max(1000, Number(getArg("limit_signals", "30000")));
  const limitFills = Math.max(1000, Number(getArg("limit_fills", "30000")));
  const limitBars = Math.max(5000, Number(getArg("limit_bars", "60000")));

  const shortScoreMin = Number(getArg("short_score_min", "58"));
  const shortPostMin = Number(getArg("short_post_min", "0.69"));
  const shortWaveMin = Number(getArg("short_wave_min", "0.73"));
  const dumpPct = Number(getArg("dump_pct", "1.8"));
  const wickMin = Number(getArg("wick_min", "0.45"));
  const preRealRatio = Number(getArg("pre_real_ratio", "0.63"));
  const blockRealAll = parseBool(getArg("block_real_all", "0"), false);
  const realLongSameAsShort = parseBool(getArg("real_long_same_as_short", "1"), true);
  const applyPreRealGate = parseBool(getArg("apply_pre_real_gate", "0"), false);
  const preRealAddOnly = parseBool(getArg("pre_real_add_only", "0"), false);
  const preRealTimingCheck = parseBool(getArg("pre_real_timing_check", "0"), false);
  const preRealScoreMin = Number(getArg("pre_real_score_min", String(Math.max(0, Math.abs(shortScoreMin) - 10))));
  const preRealPostMin = Number(getArg("pre_real_post_min", String(Math.max(0, shortPostMin - 0.03))));
  const preRealWaveMin = Number(getArg("pre_real_wave_min", String(Math.max(0, shortWaveMin - 0.03))));
  const applyAllTierGate = parseBool(getArg("apply_all_tier_gate", "0"), false);
  const allTierTrendOnly = parseBool(getArg("all_tier_trend_only", "1"), true);
  const allTierBlockConflict = parseBool(getArg("all_tier_block_conflict", "1"), true);
  const allTierBlockEmo = parseBool(getArg("all_tier_block_emo", "1"), true);
  const earlyScoreMin = Number(getArg("early_score_min", "22"));
  const earlyPostMin = Number(getArg("early_post_min", "0.56"));
  const earlyWaveMin = Number(getArg("early_wave_min", "0.58"));
  const coreScoreMin = Number(getArg("core_score_min", "32"));
  const corePostMin = Number(getArg("core_post_min", "0.59"));
  const coreWaveMin = Number(getArg("core_wave_min", "0.61"));
  const preRealScoreMinTier = Number(getArg("pre_real_tier_score_min", String(Math.max(0, preRealScoreMin))));
  const preRealPostMinTier = Number(getArg("pre_real_tier_post_min", String(preRealPostMin)));
  const preRealWaveMinTier = Number(getArg("pre_real_tier_wave_min", String(preRealWaveMin)));
  const realScoreMinTier = Number(getArg("real_tier_score_min", String(Math.max(0, Math.abs(shortScoreMin)))));
  const realPostMinTier = Number(getArg("real_tier_post_min", String(Math.max(0, shortPostMin + 0.01))));
  const realWaveMinTier = Number(getArg("real_tier_wave_min", String(Math.max(0, shortWaveMin + 0.01))));

  const db = getFirestore();
  const signals = await fetchSignals(db, {
    exchange,
    tf,
    fromMs,
    toMsBound,
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
    toMs: toMsBound,
    symbolsSet,
    limitBars,
  });

  const failedRealSignalKeys = new Set();
  const failedRealReasons = {};
  const posBySymbol = new Map();
  let shortTimingSkippedMissing = 0;
  let longTimingSkippedMissing = 0;

  for (const s of signals) {
    const event = String(s.event || "").toUpperCase();
    const mapping = resolveEventMapping({ event: s.event, side: s.side });
    const intent = String(mapping.intent || "").toUpperCase();
    const dir = signalDir(event, mapping.side || s.side);
    const features = s._features || {};
    const action = extractSignalAction(features, s.signal_id || s.id);
    const symbol = s.symbol;
    const pos = posBySymbol.get(symbol) || 0;

    let blockReason = null;
    const tier = tierOfEvent(event);
    const gateReal = isRealEvent(event);
    const gatePreReal = applyPreRealGate && isPreRealEvent(event);
    if (intent !== "EXIT" && dir !== 0 && (gateReal || gatePreReal)) {
      const label = gateReal ? "REAL" : "PRE_REAL";
      const scoreMin = gateReal ? Math.abs(shortScoreMin) : Math.abs(preRealScoreMin);
      const postMin = gateReal ? shortPostMin : preRealPostMin;
      const waveMin = gateReal ? shortWaveMin : preRealWaveMin;
      const mustAddOnly = gateReal || preRealAddOnly;
      const useTimingCheck = gateReal || preRealTimingCheck;
      const allowLongByFlag = gateReal ? (realLongSameAsShort || event !== "REAL_LONG") : true;

      if (gateReal && blockRealAll) {
        blockReason = "REAL_BLOCK_ALL";
      } else if (mustAddOnly && pos !== dir) {
        blockReason = `${label}_NOT_ADD`;
      } else if (dir === 1 && allowLongByFlag) {
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
            dumpPct,
            wickMin,
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
            dumpPct,
            wickMin,
          });
          if (!t.ok) {
            blockReason = String(t.reason || "").replace("REAL_", `${label}_`);
          } else if (t.reason === "SHORT_TIMING_SKIPPED_MISSING_BARS") {
            shortTimingSkippedMissing += 1;
          }
        }
      }
    }
    if (!blockReason && applyAllTierGate && intent !== "EXIT" && dir !== 0 && tier) {
      if (allTierBlockEmo && isEmoEvent(event)) {
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
          scoreMinTier = Math.abs(earlyScoreMin);
          postMinTier = earlyPostMin;
          waveMinTier = earlyWaveMin;
        } else if (tier === "CORE") {
          scoreMinTier = Math.abs(coreScoreMin);
          postMinTier = corePostMin;
          waveMinTier = coreWaveMin;
        } else if (tier === "PRE_REAL") {
          scoreMinTier = Math.abs(preRealScoreMinTier);
          postMinTier = preRealPostMinTier;
          waveMinTier = preRealWaveMinTier;
        } else {
          scoreMinTier = Math.abs(realScoreMinTier);
          postMinTier = realPostMinTier;
          waveMinTier = realWaveMinTier;
        }
        if (allTierTrendOnly && regime && regime !== "trend") {
          blockReason = `${tier}_REGIME_NOT_TREND`;
        } else if (allTierBlockConflict && (conflictAny || conflictDir)) {
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
      failedRealReasons[blockReason] = (failedRealReasons[blockReason] || 0) + 1;
      failedRealSignalKeys.add(s.id);
      if (s.signal_id) failedRealSignalKeys.add(String(s.signal_id));
      continue;
    }

    if (intent === "EXIT") {
      posBySymbol.set(symbol, 0);
    } else if (dir !== 0) {
      if (action === "ADD") {
        posBySymbol.set(symbol, pos === dir ? dir : dir);
      } else {
        posBySymbol.set(symbol, dir);
      }
    }
  }

  const strictDropFillReasons = {};
  const strictFills = [];
  const downgradeFills = [];
  let downgradeScaledFills = 0;

  for (const f of fills) {
    const event = String(f.event || "").toUpperCase();
    const mapping = resolveEventMapping({ event: f.event, side: f.side });
    const intent = String(mapping.intent || "").toUpperCase();

    const signalDocId = f.signal_doc_id ? String(f.signal_doc_id) : null;
    const signalId = f.signal_id ? String(f.signal_id) : null;
    const entrySignalId = entrySignalIdFromFill(f);

    const failedOwnSignal = (signalDocId && failedRealSignalKeys.has(signalDocId)) || (signalId && failedRealSignalKeys.has(signalId));
    const failedEntrySignal = entrySignalId && failedRealSignalKeys.has(entrySignalId);

    // Strict mode: failed REAL entries are removed.
    const byOwnSignal = failedOwnSignal;
    if (byOwnSignal) {
      strictDropFillReasons.FILL_SIGNAL_BLOCKED = (strictDropFillReasons.FILL_SIGNAL_BLOCKED || 0) + 1;
    } else if (intent === "EXIT" && entrySignalId && failedRealSignalKeys.has(entrySignalId)) {
      strictDropFillReasons.EXIT_OF_BLOCKED_ENTRY = (strictDropFillReasons.EXIT_OF_BLOCKED_ENTRY || 0) + 1;
    } else {
      strictFills.push(f);
    }

    // Downgrade mode: keep fills, but apply PRE_REAL size/event semantics.
    if (failedOwnSignal || failedEntrySignal) {
      downgradeFills.push(scaleFillForDowngrade(f, preRealRatio));
      downgradeScaledFills += 1;
    } else {
      downgradeFills.push(f);
    }
  }

  const baselineTrades = buildTradesGrouped(fills);
  const strictTrades = buildTradesGrouped(strictFills);
  const downgradeTrades = buildTradesGrouped(downgradeFills);
  const baselineSummary = summarizeTrades(baselineTrades);
  const strictSummary = summarizeTrades(strictTrades);
  const downgradeSummary = summarizeTrades(downgradeTrades);

  const out = {
    scope: {
      exchange,
      tf,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      to_iso: toMsBound ? new Date(toMsBound).toISOString() : null,
      limit_signals: limitSignals,
      limit_fills: limitFills,
      limit_bars: limitBars,
    },
    policy: {
      real_entry: "ADD_ONLY",
      block_real_all: blockRealAll,
      real_long_same_as_short: realLongSameAsShort,
      real_short_extra: {
        score_min_abs: Math.abs(shortScoreMin),
        post_short_min: shortPostMin,
        wave_conf_min: shortWaveMin,
        follow_break_low: true,
        dump_pct: dumpPct,
        lower_wick_min: wickMin,
      },
      pre_real_extra: {
        enabled: applyPreRealGate,
        add_only: preRealAddOnly,
        timing_check: preRealTimingCheck,
        score_min_abs: Math.abs(preRealScoreMin),
        post_min: preRealPostMin,
        wave_conf_min: preRealWaveMin,
      },
      all_tier_gate: {
        enabled: applyAllTierGate,
        trend_only: allTierTrendOnly,
        block_conflict: allTierBlockConflict,
        block_emo: allTierBlockEmo,
        early: { score_min_abs: Math.abs(earlyScoreMin), post_min: earlyPostMin, wave_conf_min: earlyWaveMin },
        core: { score_min_abs: Math.abs(coreScoreMin), post_min: corePostMin, wave_conf_min: coreWaveMin },
        pre_real: { score_min_abs: Math.abs(preRealScoreMinTier), post_min: preRealPostMinTier, wave_conf_min: preRealWaveMinTier },
        real: { score_min_abs: Math.abs(realScoreMinTier), post_min: realPostMinTier, wave_conf_min: realWaveMinTier },
      },
      note: "Strict mode drops failed REAL signals. Downgrade mode keeps them as PRE_REAL proxy by scaling fill size.",
      pre_real_ratio: preRealRatio,
    },
    data: {
      signals_total: signals.length,
      fills_total: fills.length,
      bars_loaded: barsMap.size,
      symbols: symbolsSet.size,
    },
    blocked_signals: {
      total: Object.values(failedRealReasons).reduce((a, b) => a + b, 0),
      by_reason: failedRealReasons,
      short_timing_skipped_missing_bars: shortTimingSkippedMissing,
      long_timing_skipped_missing_bars: longTimingSkippedMissing,
    },
    fill_policy: {
      strict: {
        kept: strictFills.length,
        dropped: fills.length - strictFills.length,
        dropped_by_reason: strictDropFillReasons,
      },
      downgrade: {
        kept: downgradeFills.length,
        scaled: downgradeScaledFills,
        pre_real_ratio: preRealRatio,
      },
    },
    trades: {
      baseline: baselineSummary,
      strict: strictSummary,
      diff_strict_minus_baseline: {
        trades: (strictSummary.trades || 0) - (baselineSummary.trades || 0),
        win_rate: (strictSummary.win_rate ?? 0) - (baselineSummary.win_rate ?? 0),
        avg_pnl_pct: (strictSummary.avg_pnl_pct ?? 0) - (baselineSummary.avg_pnl_pct ?? 0),
        total_pnl_krw: (strictSummary.total_pnl_krw ?? 0) - (baselineSummary.total_pnl_krw ?? 0),
      },
      downgrade: downgradeSummary,
      diff_downgrade_minus_baseline: {
        trades: (downgradeSummary.trades || 0) - (baselineSummary.trades || 0),
        win_rate: (downgradeSummary.win_rate ?? 0) - (baselineSummary.win_rate ?? 0),
        avg_pnl_pct: (downgradeSummary.avg_pnl_pct ?? 0) - (baselineSummary.avg_pnl_pct ?? 0),
        total_pnl_krw: (downgradeSummary.total_pnl_krw ?? 0) - (baselineSummary.total_pnl_krw ?? 0),
      },
    },
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
