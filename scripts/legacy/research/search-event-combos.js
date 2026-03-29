#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
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

function symbolOf(x) {
  return String(x.symbol || x.symbol_or_pair_id || x.market || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/i, "");
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

function sideToDir(side) {
  const s = String(side || "").toUpperCase();
  if (s === "BUY") return 1;
  if (s === "SELL") return -1;
  return 0;
}

function eventTier(event) {
  const e = String(event || "").toUpperCase();
  if (e.startsWith("REAL_")) return "REAL";
  if (e.startsWith("PRE_REAL_")) return "PRE_REAL";
  if (e.startsWith("CORE_")) return "CORE";
  if (e.startsWith("EARLY_")) return "EARLY";
  if (e.startsWith("EMO_")) return "EMO";
  if (e.startsWith("SS_")) return "SS";
  if (e.startsWith("TD9P_")) return "TD9P";
  if (e.startsWith("ICHI_BELL_")) return "ICHI";
  return null;
}

function eventDir(event, side) {
  const e = String(event || "").toUpperCase();
  if (e.endsWith("_LONG")) return "LONG";
  if (e.endsWith("_SHORT")) return "SHORT";
  if (e.endsWith("_BUY")) return "LONG";
  if (e.endsWith("_SELL")) return "SHORT";
  const d = sideToDir(side);
  if (d > 0) return "LONG";
  if (d < 0) return "SHORT";
  return null;
}

function isExitEvent(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("EXIT_") || e === "FORCE_EXIT_ALL";
}

function entryGroupKey(event, side) {
  const tier = eventTier(event);
  const dir = eventDir(event, side);
  if (!tier || !dir) return null;
  return `${tier}_${dir}`;
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
      _event: String(f.event || "").toUpperCase(),
    });
  });
  out.sort((a, b) => a._ms - b._ms);
  return out;
}

function evaluateDisabledGroups(fills, disabledGroups) {
  const blockedSignalKeys = new Set();
  const filtered = [];
  let droppedEntry = 0;
  let droppedExit = 0;

  for (const f of fills) {
    const ev = f._event;
    if (isExitEvent(ev)) continue;
    const key = entryGroupKey(ev, f.side);
    if (key && disabledGroups.has(key)) {
      droppedEntry += 1;
      if (f.signal_doc_id) blockedSignalKeys.add(String(f.signal_doc_id));
      if (f.signal_id) blockedSignalKeys.add(String(f.signal_id));
      continue;
    }
    filtered.push(f);
  }

  const out = [];
  for (const f of fills) {
    const ev = f._event;
    if (!isExitEvent(ev)) {
      const blockedOwn = (f.signal_doc_id && blockedSignalKeys.has(String(f.signal_doc_id))) ||
        (f.signal_id && blockedSignalKeys.has(String(f.signal_id)));
      if (!blockedOwn) out.push(f);
      continue;
    }
    const entrySignalId = entrySignalIdFromFill(f);
    const blockedByEntry = entrySignalId && blockedSignalKeys.has(entrySignalId);
    if (blockedByEntry) {
      droppedExit += 1;
      continue;
    }
    out.push(f);
  }

  const trades = buildTradesGrouped(out);
  const summary = summarizeTrades(trades);
  return {
    summary,
    dropped_entries: droppedEntry,
    dropped_exits: droppedExit,
  };
}

function allCombos(groups) {
  const out = [];
  const n = groups.length;
  const total = 1 << n;
  for (let mask = 0; mask < total; mask += 1) {
    const set = new Set();
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) !== 0) set.add(groups[i]);
    }
    out.push(set);
  }
  return out;
}

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const fromMs = toMs(getArg("from", "2026-01-19T00:00:00+09:00"));
  const toMsBound = toMs(getArg("to", "2026-02-21T00:00:00+09:00"));
  const limitFills = Math.max(10000, Number(getArg("limit_fills", "120000")));
  const minTrades = Math.max(1, Number(getArg("min_trades", "100")));
  const targetWin = Number(getArg("target_win", "0.55"));
  const targetWinMax = Number(getArg("target_win_max", "0.60"));
  const targetPnl = Number(getArg("target_pnl", "714.2857"));
  const dumpAll = String(getArg("dump_all", "0")).trim() === "1";

  const groups = [
    "EARLY_LONG",
    "EARLY_SHORT",
    "CORE_LONG",
    "CORE_SHORT",
    "PRE_REAL_LONG",
    "PRE_REAL_SHORT",
    "REAL_LONG",
    "REAL_SHORT",
    "EMO_LONG",
    "EMO_SHORT",
  ];

  const db = getFirestore();
  const fills = await fetchFills(db, {
    exchange,
    tf,
    fromMs,
    toMs: toMsBound,
    limitFills,
  });

  const baseline = evaluateDisabledGroups(fills, new Set());
  const combos = allCombos(groups);
  let bestWin = { disabled: [], ...baseline };
  let bestPnl = { disabled: [], ...baseline };
  let bestTarget = null;
  let bestTargetByPnl = null;
  const top = [];
  const all = [];

  for (const disabled of combos) {
    const result = disabled.size === 0 ? baseline : evaluateDisabledGroups(fills, disabled);
    const s = result.summary;
    const wr = s.win_rate ?? -1;
    const pnl = s.total_pnl_krw ?? -1e18;
    const trades = s.trades ?? 0;

    if (trades >= minTrades && (wr > (bestWin.summary.win_rate ?? -1) || (wr === (bestWin.summary.win_rate ?? -1) && pnl > (bestWin.summary.total_pnl_krw ?? -1e18)))) {
      bestWin = { disabled: Array.from(disabled), ...result };
    }
    if (trades >= minTrades && (pnl > (bestPnl.summary.total_pnl_krw ?? -1e18) || (pnl === (bestPnl.summary.total_pnl_krw ?? -1e18) && wr > (bestPnl.summary.win_rate ?? -1)))) {
      bestPnl = { disabled: Array.from(disabled), ...result };
    }
    if (trades >= minTrades && wr >= targetWin && wr <= targetWinMax && pnl >= targetPnl) {
      if (!bestTarget || wr > (bestTarget.summary.win_rate ?? -1) || (wr === (bestTarget.summary.win_rate ?? -1) && pnl > (bestTarget.summary.total_pnl_krw ?? -1e18))) {
        bestTarget = { disabled: Array.from(disabled), ...result };
      }
      if (!bestTargetByPnl || pnl > (bestTargetByPnl.summary.total_pnl_krw ?? -1e18) || (pnl === (bestTargetByPnl.summary.total_pnl_krw ?? -1e18) && wr > (bestTargetByPnl.summary.win_rate ?? -1))) {
        bestTargetByPnl = { disabled: Array.from(disabled), ...result };
      }
    }

    top.push({
      disabled: Array.from(disabled),
      ...result,
    });
    if (dumpAll) {
      all.push({
        disabled: Array.from(disabled),
        ...result,
      });
    }
  }

  top.sort((a, b) => {
    const wrA = a.summary.win_rate ?? -1;
    const wrB = b.summary.win_rate ?? -1;
    if (wrB !== wrA) return wrB - wrA;
    return (b.summary.total_pnl_krw ?? -1e18) - (a.summary.total_pnl_krw ?? -1e18);
  });

  console.log(JSON.stringify({
    scope: {
      exchange,
      tf,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      to_iso: toMsBound ? new Date(toMsBound).toISOString() : null,
      fills: fills.length,
      combos: combos.length,
      min_trades: minTrades,
    },
    baseline: {
      disabled: [],
      ...baseline,
    },
    best_by_win_rate: bestWin,
    best_by_pnl: bestPnl,
    best_target_match: bestTarget,
    best_target_by_pnl: bestTargetByPnl,
    top_20: top.slice(0, 20),
    all_results: dumpAll ? all : undefined,
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
