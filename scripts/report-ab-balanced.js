#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { resolveEventMapping } = require("../src/services/signalMapping");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");

function getArg(name, defVal) {
  const key = `--${name}=`;
  const found = process.argv.find((x) => x.startsWith(key));
  if (!found) return defVal;
  return found.slice(key.length);
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

function isCoreOrReal(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("CORE_") || e.startsWith("REAL_");
}

function isEntryLike(event, side) {
  const mapping = resolveEventMapping({ event, side });
  return String(mapping.intent || "").toUpperCase() !== "EXIT";
}

function isExitLike(event, side) {
  const mapping = resolveEventMapping({ event, side });
  return String(mapping.intent || "").toUpperCase() === "EXIT";
}

function buildSignalDocId({ exchange, symbol, tf, barMs, event }) {
  if (!exchange || !symbol || !tf || !barMs || !event) return null;
  return `SIG__${exchange}__${symbol}__${tf}__${barMs}__${event}`;
}

function entrySignalIdFromFill(f) {
  const entryId = String(f.entry_event_id || "").trim();
  if (!entryId || !entryId.includes("|")) return null;
  const parts = entryId.split("|");
  if (parts.length < 6) return null;
  const exchange = normalizeExchange(parts[0]);
  const symbol = parts[1];
  const tf = normalizeTf(parts[2]);
  const barMs = Number(parts[3]);
  const event = parts[4];
  if (!Number.isFinite(barMs)) return null;
  return buildSignalDocId({ exchange, symbol, tf, barMs, event });
}

function signalAllowedBalanced(signal, opts) {
  const features = parseFeatures(signal.features_json) || parseFeatures(signal.features) || {};
  const event = signal.event;
  const side = signal.side;
  const action = extractSignalAction(features, signal.signal_id || signal.id);
  const regime = String(features.pro_regime_state || "").toLowerCase();
  if (isCoreOrReal(event) && regime === "range") {
    return { ok: false, reason: "RANGE_BLOCK_CORE_REAL" };
  }

  if (action === "ADD") {
    const score = Number(features.score);
    const trend = String(features.pro_trend_state || "").toLowerCase();
    const htf = String(features.pro_htf_state || "").toLowerCase();
    const conflictLong = Boolean(features.pro_conflict_long);
    const conflictShort = Boolean(features.pro_conflict_short);
    const dirLong = String(side || "").toUpperCase() === "BUY" || String(event || "").toUpperCase().includes("LONG");
    const scoreOk = Number.isFinite(score) ? (dirLong ? score >= opts.addScoreMin : score <= -opts.addScoreMin) : true;
    const alignOk = dirLong ? (trend !== "bear" && htf !== "bear") : (trend !== "bull" && htf !== "bull");
    const regimeOk = regime !== "range";
    const conflictOk = dirLong ? !conflictLong : !conflictShort;
    if (!(scoreOk && alignOk && regimeOk && conflictOk)) {
      return { ok: false, reason: "ADD_BLOCKED" };
    }
  }

  return { ok: true };
}

function summarizeSignals(signals) {
  const tiers = {};
  const intents = { entry: 0, add: 0, exit: 0 };
  for (const s of signals) {
    const event = String(s.event || "").toUpperCase();
    if (event.startsWith("REAL_")) tiers.REAL = (tiers.REAL || 0) + 1;
    else if (event.startsWith("CORE_")) tiers.CORE = (tiers.CORE || 0) + 1;
    else if (event.startsWith("EARLY_")) tiers.EARLY = (tiers.EARLY || 0) + 1;
    else if (event.startsWith("EMO_")) tiers.EMO = (tiers.EMO || 0) + 1;
    else if (event.startsWith("SS_")) tiers.SS = (tiers.SS || 0) + 1;
    else if (event.startsWith("TD9P_")) tiers.TD9P = (tiers.TD9P || 0) + 1;
    else tiers.OTHER = (tiers.OTHER || 0) + 1;

    const features = parseFeatures(s.features_json) || {};
    const action = extractSignalAction(features, s.signal_id);
    const intent = resolveEventMapping({ event: s.event, side: s.side }).intent;
    if (String(intent || "").toUpperCase() === "EXIT") intents.exit += 1;
    else if (action === "ADD") intents.add += 1;
    else intents.entry += 1;
  }
  return { total: signals.length, intents, tiers };
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
    const key = `${f.symbol || ""}__${f.tf || ""}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(f);
  }
  const allTrades = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => {
      const am = toMs(a.exec_bar_close_time_utc_ms || a.exec_bar_close_time_utc || a.created_at) || 0;
      const bm = toMs(b.exec_bar_close_time_utc_ms || b.exec_bar_close_time_utc || b.created_at) || 0;
      return am - bm;
    });
    const { trades } = buildTradesFromFills(group);
    if (Array.isArray(trades) && trades.length) allTrades.push(...trades);
  }
  return allTrades;
}

(async () => {
  const exchangeArg = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tfArg = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const hours = Number(getArg("hours", "168"));
  const limitSignals = Number(getArg("limit_signals", "20000"));
  const limitFills = Number(getArg("limit_fills", "20000"));
  const fromArg = getArg("from", "");
  const fromMs = fromArg ? toMs(fromArg) : (Number.isFinite(hours) && hours > 0 ? Date.now() - hours * 60 * 60 * 1000 : null);
  const symbolsArg = getArg("symbols", "");
  const symbols = symbolsArg ? symbolsArg.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const addScoreMin = Number(getArg("add_score_min", "25"));

  const db = getFirestore();

  const sigSnap = await db.collection("signals").orderBy("created_at", "desc").limit(limitSignals).get();
  const signals = [];
  const signalById = new Map();
  for (const d of sigSnap.docs) {
    const s = d.data() || {};
    const ex = normalizeExchange(s.exchange);
    if (exchangeArg && ex !== exchangeArg) continue;
    const tf = normalizeTf(s.tf);
    if (tfArg && tf !== tfArg) continue;
    const sym = s.symbol || s.symbol_or_pair_id || "";
    if (symbols.length && !symbols.includes(sym)) continue;
    const createdMs = toMs(s.created_at);
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) continue;
    const row = { id: d.id, ...s, exchange: ex, tf, symbol: sym };
    signals.push(row);
    if (row.signal_id) signalById.set(row.signal_id, row);
    signalById.set(d.id, row);
  }

  const fillSnap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limitFills).get();
  const fills = [];
  for (const d of fillSnap.docs) {
    const f = d.data() || {};
    const ex = normalizeExchange(f.exchange);
    if (exchangeArg && ex !== exchangeArg) continue;
    if (exchangeArg && !isLiveDocForExchange(exchangeArg, f)) continue;
    const tf = normalizeTf(f.tf);
    if (tfArg && tf && tf !== tfArg) continue;
    const sym = f.symbol || f.market || f.symbol_or_pair_id || "";
    if (symbols.length && !symbols.includes(sym)) continue;
    const createdMs = toMs(f.created_at);
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) continue;
    fills.push({ id: d.id, ...f, exchange: ex, tf, symbol: sym });
  }
  fills.sort((a, b) => {
    const am = toMs(a.exec_bar_close_time_utc_ms || a.exec_bar_close_time_utc || a.created_at) || 0;
    const bm = toMs(b.exec_bar_close_time_utc_ms || b.exec_bar_close_time_utc || b.created_at) || 0;
    return am - bm;
  });

  const keepMap = new Map();
  const dropReasons = {};
  for (const s of signals) {
    const decision = signalAllowedBalanced(s, { addScoreMin });
    keepMap.set(s.id, decision);
    if (s.signal_id) keepMap.set(s.signal_id, decision);
    if (!decision.ok) dropReasons[decision.reason] = (dropReasons[decision.reason] || 0) + 1;
  }

  const balancedSignals = signals.filter((s) => keepMap.get(s.id)?.ok !== false);
  const baselineSignalSummary = summarizeSignals(signals);
  const balancedSignalSummary = summarizeSignals(balancedSignals);

  const balancedFills = [];
  let unknownSignal = 0;
  for (const f of fills) {
    const event = f.event;
    const side = f.side;
    const sigId = f.signal_doc_id || f.signal_id || null;
    const sigDecision = sigId ? keepMap.get(sigId) : null;
    const entrySigId = entrySignalIdFromFill(f);
    const entryDecision = entrySigId ? keepMap.get(entrySigId) : null;
    const isExit = isExitLike(event, side);

    if (sigDecision && sigDecision.ok === false) continue;
    if (isExit && entryDecision && entryDecision.ok === false) continue;
    if (!sigDecision && !entryDecision) unknownSignal += 1;
    balancedFills.push(f);
  }
  balancedFills.sort((a, b) => {
    const am = toMs(a.exec_bar_close_time_utc_ms || a.exec_bar_close_time_utc || a.created_at) || 0;
    const bm = toMs(b.exec_bar_close_time_utc_ms || b.exec_bar_close_time_utc || b.created_at) || 0;
    return am - bm;
  });

  const baselineTradesGrouped = buildTradesGrouped(fills);
  const balancedTradesGrouped = buildTradesGrouped(balancedFills);

  const out = {
    scope: {
      exchange: exchangeArg,
      tf: tfArg,
      symbols: symbols.length ? symbols : "ALL",
      from_ms: fromMs || null,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      limit_signals: limitSignals,
      limit_fills: limitFills,
      add_score_min: addScoreMin,
      note: "Balanced = range block for CORE/REAL + ADD gate. Score-boost effects are not re-simulated.",
    },
    signals: {
      baseline: baselineSignalSummary,
      balanced: balancedSignalSummary,
      dropped_by_reason: dropReasons,
    },
    fills: {
      baseline: { count: fills.length },
      balanced: { count: balancedFills.length, unknown_signal: unknownSignal },
    },
    trades: {
      baseline: summarizeTrades(baselineTradesGrouped),
      balanced: summarizeTrades(balancedTradesGrouped),
      note: "Trades are reconstructed per symbol+tf to avoid cross-asset mixing.",
    },
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
