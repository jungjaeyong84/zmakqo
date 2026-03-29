#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");

const DAY_MS = 24 * 60 * 60 * 1000;

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

function fillMs(fill) {
  return toMs(fill.exec_bar_close_time_utc_ms) ?? toMs(fill.bar_close_time_utc_ms) ?? toMs(fill.created_at);
}

function symbolOf(x) {
  return String(x.symbol || x.symbol_or_pair_id || x.market || "").trim().toUpperCase().replace(/\.P$/i, "");
}

function isPreRealEvent(ev) {
  return String(ev || "").toUpperCase().startsWith("PRE_REAL_");
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

async function fetchFills(db, { exchange, tf, fromMs, toMsBound, limitFills }) {
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
    if (Number.isFinite(toMsBound) && ms >= toMsBound) return;
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

function filterPreRealOnlyFills(fills) {
  const preEntryIds = new Set();
  const out = [];
  for (const f of fills) {
    const event = String(f.event || "").toUpperCase();
    const entryEventId = String(f.entry_event_id || "").trim();
    if (isPreRealEvent(event)) {
      out.push(f);
      const signalId = String(f.signal_id || "").trim();
      if (signalId) preEntryIds.add(signalId);
      if (entryEventId) preEntryIds.add(entryEventId);
      continue;
    }
    if (entryEventId && preEntryIds.has(entryEventId)) {
      out.push(f);
    }
  }
  return out;
}

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const days = Math.max(1, Number(getArg("days", "7")));
  const fromMsArg = toMs(getArg("from", null));
  const toMsArg = toMs(getArg("to", null));
  const fromMs = Number.isFinite(fromMsArg) ? fromMsArg : (Date.now() - days * DAY_MS);
  const toMsBound = Number.isFinite(toMsArg) ? toMsArg : Date.now();
  const limitFills = Math.max(5000, Number(getArg("limit_fills", "120000")));

  const db = getFirestore();
  const fills = await fetchFills(db, { exchange, tf, fromMs, toMsBound, limitFills });
  const preRealFills = filterPreRealOnlyFills(fills);
  const preRealTrades = buildTradesGrouped(preRealFills);
  const summary = summarizeTrades(preRealTrades);

  console.log(JSON.stringify({
    ok: true,
    scope: {
      exchange,
      tf,
      from_iso: new Date(fromMs).toISOString(),
      to_iso: new Date(toMsBound).toISOString(),
      fills_total: fills.length,
      pre_real_related_fills: preRealFills.length,
      pre_real_trades: summary.trades,
    },
    pre_real_summary: summary,
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
