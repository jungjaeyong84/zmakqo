#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");

const HOUR_MS = 60 * 60 * 1000;

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

function symbolOf(x) {
  return String(x.symbol || x.symbol_or_pair_id || x.market || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "");
}

function fillMs(fill) {
  return toMs(fill.exec_bar_close_time_utc_ms) ?? toMs(fill.bar_close_time_utc_ms) ?? toMs(fill.created_at);
}

function signalMs(sig) {
  return toMs(sig.bar_close_time_utc_ms) ?? toMs(sig.created_at);
}

function tierOfEvent(event) {
  const e = String(event || "").toUpperCase();
  if (e.startsWith("EARLY_") || e.startsWith("EMO_")) return "EARLY";
  if (e.startsWith("CORE_")) return "CORE";
  if (e.startsWith("PRE_REAL_")) return "PRE_REAL";
  if (e.startsWith("REAL_")) return "REAL";
  return "OTHER";
}

function sideOfEvent(event, side) {
  const e = String(event || "").toUpperCase();
  if (e.endsWith("_LONG") || e.endsWith("_BUY")) return "LONG";
  if (e.endsWith("_SHORT") || e.endsWith("_SELL")) return "SHORT";
  const s = String(side || "").toUpperCase();
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return "NA";
}

function isExitEvent(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("EXIT_") || e === "FORCE_EXIT_ALL";
}

function parseEntryEventFromFill(fill) {
  const explicit = String(fill.entry_event || fill.entry_signal_event || "").trim().toUpperCase();
  if (explicit) return explicit;

  const raw = String(fill.entry_event_id || "").trim();
  if (!raw) return "";

  // BINANCEFUT|BTCUSDT|60|1772532000000|EARLY_SHORT|ENTRY
  if (raw.includes("|")) {
    const parts = raw.split("|");
    if (parts.length >= 5) return String(parts[4] || "").trim().toUpperCase();
  }

  // SIG__BINANCEFUT__BTCUSDT__60m__1772532000000__EARLY_SHORT
  if (raw.startsWith("SIG__")) {
    const parts = raw.split("__");
    if (parts.length >= 6) return String(parts[5] || "").trim().toUpperCase();
  }

  return "";
}

function initSignalBucket() {
  return {
    total_entry_signals: 0,
    by_tier: { EARLY: 0, CORE: 0, PRE_REAL: 0, REAL: 0, OTHER: 0 },
    by_event: {},
    by_tier_side: {},
  };
}

function initTradeBucket() {
  return {
    trades: 0,
    wins: 0,
    total_pnl_pct: 0,
    total_pnl_krw: 0,
  };
}

function finalizeTradeBucket(x) {
  const count = x.trades;
  return {
    trades: count,
    win_rate: count ? Number((x.wins / count).toFixed(4)) : null,
    avg_pnl_pct: count ? Number((x.total_pnl_pct / count).toFixed(6)) : null,
    total_pnl_krw: Number(x.total_pnl_krw.toFixed(2)),
  };
}

function summarizeTradesByTier(trades, fillById, fromMs, toMsBound) {
  const total = initTradeBucket();
  const byTier = new Map();
  const byTierSide = new Map();

  for (const t of trades) {
    const closeMs = toMs(t.close_ms);
    if (!Number.isFinite(closeMs) || closeMs < fromMs || closeMs >= toMsBound) continue;
    if (!Number.isFinite(t.pnl_pct)) continue;

    const closeFill = fillById.get(String(t.fill_id || ""));
    const entryEvent = parseEntryEventFromFill(closeFill || {});
    const tier = tierOfEvent(entryEvent);
    const side = sideOfEvent(entryEvent, closeFill && closeFill.side);
    const tierSide = `${tier}_${side}`;

    const bucket = byTier.get(tier) || initTradeBucket();
    const bucketSide = byTierSide.get(tierSide) || initTradeBucket();
    const isWin = t.pnl_pct > 0;
    const pnlPct = Number(t.pnl_pct) || 0;
    const pnlKrw = Number.isFinite(t.pnl_krw) ? Number(t.pnl_krw) : 0;

    bucket.trades += 1;
    bucket.wins += isWin ? 1 : 0;
    bucket.total_pnl_pct += pnlPct;
    bucket.total_pnl_krw += pnlKrw;

    bucketSide.trades += 1;
    bucketSide.wins += isWin ? 1 : 0;
    bucketSide.total_pnl_pct += pnlPct;
    bucketSide.total_pnl_krw += pnlKrw;

    total.trades += 1;
    total.wins += isWin ? 1 : 0;
    total.total_pnl_pct += pnlPct;
    total.total_pnl_krw += pnlKrw;

    byTier.set(tier, bucket);
    byTierSide.set(tierSide, bucketSide);
  }

  const byTierObj = {};
  for (const [k, v] of byTier.entries()) byTierObj[k] = finalizeTradeBucket(v);
  const byTierSideObj = {};
  for (const [k, v] of byTierSide.entries()) byTierSideObj[k] = finalizeTradeBucket(v);

  return {
    total: finalizeTradeBucket(total),
    by_tier: byTierObj,
    by_tier_side: byTierSideObj,
  };
}

function summarizeSignals(signals, fromMs, toMs) {
  const out = initSignalBucket();
  for (const s of signals) {
    const ms = signalMs(s);
    if (!Number.isFinite(ms) || ms < fromMs || ms >= toMs) continue;
    const event = String(s.event || "").toUpperCase();
    if (!event || isExitEvent(event)) continue;
    const tier = tierOfEvent(event);
    const side = sideOfEvent(event, s.side);
    const tierSide = `${tier}_${side}`;
    out.total_entry_signals += 1;
    out.by_tier[tier] = (out.by_tier[tier] || 0) + 1;
    out.by_event[event] = (out.by_event[event] || 0) + 1;
    out.by_tier_side[tierSide] = (out.by_tier_side[tierSide] || 0) + 1;
  }
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

async function fetchSignals(db, { exchange, tf, fromMs, limitSignals }) {
  const snap = await db.collection("signals").orderBy("created_at", "desc").limit(limitSignals).get();
  const out = [];
  snap.forEach((d) => {
    const s = d.data() || {};
    const ex = normalizeExchange(s.exchange);
    if (exchange && ex !== exchange) return;
    const tfNorm = normalizeTf(s.tf);
    if (tf && tfNorm && tfNorm !== tf) return;
    const ms = signalMs(s);
    if (!Number.isFinite(ms) || ms < fromMs) return;
    out.push({ id: d.id, ...s, _ms: ms, exchange: ex, tf: tfNorm });
  });
  return out;
}

async function fetchFills(db, { exchange, tf, fromMs, limitFills }) {
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
    if (!Number.isFinite(ms) || ms < fromMs) return;
    out.push({ id: d.id, ...f, _ms: ms, exchange: ex, tf: tfNorm });
  });
  return out;
}

function parseWindows(raw) {
  return String(raw || "24,72")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0)
    .sort((a, b) => a - b);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const windows = parseWindows(getArg("windows", "24,72"));
  const limitSignals = Math.max(5000, Number(getArg("limit_signals", "80000")));
  const limitFills = Math.max(5000, Number(getArg("limit_fills", "80000")));
  const outPathArg = getArg("out", "");
  const nowMs = Date.now();
  const maxWindowHours = Math.max(...windows);
  const fromMs = nowMs - maxWindowHours * HOUR_MS;

  const db = getFirestore();
  const [signals, fills] = await Promise.all([
    fetchSignals(db, { exchange, tf, fromMs, limitSignals }),
    fetchFills(db, { exchange, tf, fromMs, limitFills }),
  ]);

  const trades = buildTradesGrouped(fills);
  const fillById = new Map(fills.map((f) => [String(f.id), f]));

  const windowsReport = {};
  for (const hours of windows) {
    const winFrom = nowMs - hours * HOUR_MS;
    const signalsSummary = summarizeSignals(signals, winFrom, nowMs);
    const tradesSummary = summarizeTradesByTier(trades, fillById, winFrom, nowMs);
    windowsReport[`${hours}h`] = {
      from_iso: new Date(winFrom).toISOString(),
      to_iso: new Date(nowMs).toISOString(),
      signals: signalsSummary,
      trades: tradesSummary,
    };
  }

  const payload = {
    ok: true,
    generated_at: new Date(nowMs).toISOString(),
    scope: {
      exchange,
      tf,
      windows_hours: windows,
      loaded: {
        signals: signals.length,
        fills: fills.length,
        trades: trades.length,
      },
    },
    report: windowsReport,
  };

  const root = process.cwd();
  const opsDaily = path.join(root, "ops", "daily");
  ensureDir(opsDaily);
  const latestPath = path.join(opsDaily, "tier_health_latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));

  if (outPathArg) {
    const outPath = path.isAbsolute(outPathArg) ? outPathArg : path.join(root, outPathArg);
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }

  console.log(JSON.stringify(payload, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
