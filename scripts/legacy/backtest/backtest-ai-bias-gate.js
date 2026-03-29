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

function isExitEvent(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("EXIT_") || e === "FORCE_EXIT_ALL";
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

function sideToDir(side) {
  const s = String(side || "").toUpperCase();
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return null;
}

function eventDir(event, side) {
  const e = String(event || "").toUpperCase();
  if (e.endsWith("_LONG")) return "LONG";
  if (e.endsWith("_SHORT")) return "SHORT";
  if (e.endsWith("_BUY")) return "LONG";
  if (e.endsWith("_SELL")) return "SHORT";
  return sideToDir(side);
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

async function fetchAiRuns(db, { exchange, fromMs, toMsBound, limitRuns }) {
  const snap = await db.collection("ai_allocation_runs").orderBy("created_at", "asc").limit(limitRuns).get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const provider = String(x.provider || "").toUpperCase();
    if (provider !== exchange) return;
    const ms = toMs(x.created_at);
    if (!Number.isFinite(ms)) return;
    if (Number.isFinite(fromMs) && ms < fromMs - (24 * 60 * 60 * 1000)) return;
    if (Number.isFinite(toMsBound) && ms >= toMsBound) return;
    const side = (x.side_allocation && typeof x.side_allocation === "object") ? x.side_allocation : {};
    const rawDir = String(x.direction || x.bias_direction || side.bias_direction || "").toUpperCase();
    let dir = "NEUTRAL";
    if (rawDir.startsWith("LONG")) dir = "LONG";
    else if (rawDir.startsWith("SHORT")) dir = "SHORT";
    const score = Number(x.direction_score ?? side.bias_score);
    const conf = Number(side.bias_confidence ?? x.direction_confidence);
    out.push({
      id: d.id,
      ms,
      dir,
      score: Number.isFinite(score) ? score : null,
      conf: Number.isFinite(conf) ? conf : null,
      source: x.side_allocation && x.side_allocation.source ? String(x.side_allocation.source) : null,
    });
  });
  out.sort((a, b) => a.ms - b.ms);
  return out;
}

function findAiAt(aiRuns, ms) {
  if (!Array.isArray(aiRuns) || !aiRuns.length || !Number.isFinite(ms)) return null;
  let lo = 0;
  let hi = aiRuns.length - 1;
  let ans = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = aiRuns[mid].ms;
    if (v <= ms) {
      ans = aiRuns[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function deriveBiasDir(ai, { scoreThr, confMin }) {
  if (!ai) return "NEUTRAL";
  const conf = Number(ai.conf);
  if (Number.isFinite(confMin) && confMin > 0 && Number.isFinite(conf) && conf < confMin) {
    return "NEUTRAL";
  }
  if (ai.dir === "LONG" || ai.dir === "SHORT") return ai.dir;
  const score = Number(ai.score);
  const thr = Number.isFinite(scoreThr) ? Math.max(0, scoreThr) : 0;
  if (!Number.isFinite(score)) return "NEUTRAL";
  if (score >= thr && thr > 0) return "LONG";
  if (score <= -thr && thr > 0) return "SHORT";
  return "NEUTRAL";
}

function evaluateScenario({ fills, aiRuns, cfg }) {
  if (!cfg || cfg.enabled === false) {
    const trades = buildTradesGrouped(fills);
    return {
      cfg: { enabled: false },
      summary: summarizeTrades(trades),
      checked_entries: 0,
      neutral_entries: 0,
      blocked_entries: 0,
      dropped_exits: 0,
      blocked_reasons: {},
    };
  }
  const blockedSignalKeys = new Set();
  const blockedReasons = {};
  const tierSet = new Set(cfg.applyTiers || []);
  let checkedEntries = 0;
  let blockedEntries = 0;
  let neutralSeen = 0;

  for (const f of fills) {
    const ev = f._event;
    if (isExitEvent(ev)) continue;
    const tier = eventTier(ev);
    if (tierSet.size && (!tier || !tierSet.has(tier))) continue;

    const entryDir = eventDir(ev, f.side);
    if (!entryDir) continue;
    checkedEntries += 1;

    const ai = findAiAt(aiRuns, f._ms);
    const aiDir = deriveBiasDir(ai, cfg);
    if (aiDir === "NEUTRAL") neutralSeen += 1;

    let block = false;
    let reason = null;
    if (aiDir === "LONG" && entryDir === "SHORT") {
      block = true;
      reason = "AI_BIAS_OPPOSITE_LONG";
    } else if (aiDir === "SHORT" && entryDir === "LONG") {
      block = true;
      reason = "AI_BIAS_OPPOSITE_SHORT";
    } else if (aiDir === "NEUTRAL") {
      if (cfg.neutralPolicy === "block") {
        block = true;
        reason = "AI_BIAS_NEUTRAL_BLOCK";
      } else if (cfg.neutralPolicy === "long_only" && entryDir === "SHORT") {
        block = true;
        reason = "AI_BIAS_NEUTRAL_LONG_ONLY";
      } else if (cfg.neutralPolicy === "short_only" && entryDir === "LONG") {
        block = true;
        reason = "AI_BIAS_NEUTRAL_SHORT_ONLY";
      }
    }

    if (block) {
      blockedEntries += 1;
      blockedReasons[reason] = (blockedReasons[reason] || 0) + 1;
      if (f.signal_doc_id) blockedSignalKeys.add(String(f.signal_doc_id));
      if (f.signal_id) blockedSignalKeys.add(String(f.signal_id));
    }
  }

  const kept = [];
  let droppedExit = 0;
  for (const f of fills) {
    const ev = f._event;
    if (!isExitEvent(ev)) {
      const blockedOwn = (f.signal_doc_id && blockedSignalKeys.has(String(f.signal_doc_id))) ||
        (f.signal_id && blockedSignalKeys.has(String(f.signal_id)));
      if (!blockedOwn) kept.push(f);
      continue;
    }
    const entrySignalId = entrySignalIdFromFill(f);
    if (entrySignalId && blockedSignalKeys.has(entrySignalId)) {
      droppedExit += 1;
      continue;
    }
    kept.push(f);
  }

  const trades = buildTradesGrouped(kept);
  const summary = summarizeTrades(trades);
  return {
    cfg,
    summary,
    checked_entries: checkedEntries,
    neutral_entries: neutralSeen,
    blocked_entries: blockedEntries,
    dropped_exits: droppedExit,
    blocked_reasons: blockedReasons,
  };
}

function configGrid() {
  const neutralPolicies = ["allow", "block", "short_only", "long_only"];
  const scoreThrs = [0, 0.01, 0.02, 0.03, 0.05, 0.08];
  const confMins = [0, 0.1, 0.2, 0.3, 0.4];
  const tierPresets = [
    ["EARLY", "CORE", "PRE_REAL", "REAL", "EMO"],
    ["CORE", "PRE_REAL", "REAL"],
    ["PRE_REAL", "REAL"],
    ["REAL"],
  ];
  const out = [];
  for (const neutralPolicy of neutralPolicies) {
    for (const scoreThr of scoreThrs) {
      for (const confMin of confMins) {
        for (const applyTiers of tierPresets) {
          out.push({ enabled: true, neutralPolicy, scoreThr, confMin, applyTiers });
        }
      }
    }
  }
  return out;
}

(async () => {
  const exchange = normalizeExchange(getArg("exchange", "BINANCEFUT"));
  const tf = normalizeTf(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m"));
  const fromMs = toMs(getArg("from", "2026-02-01T00:00:00+09:00"));
  const toMsBound = toMs(getArg("to", "2026-02-21T00:00:00+09:00"));
  const limitFills = Math.max(10000, Number(getArg("limit_fills", "120000")));
  const limitRuns = Math.max(1000, Number(getArg("limit_runs", "5000")));
  const minTrades = Math.max(1, Number(getArg("min_trades", "150")));
  const targetWin = Number(getArg("target_win", "0.55"));
  const targetWinMax = Number(getArg("target_win_max", "0.60"));
  const targetPnl = Number(getArg("target_pnl", "714.2857"));

  const db = getFirestore();
  const fills = await fetchFills(db, {
    exchange,
    tf,
    fromMs,
    toMs: toMsBound,
    limitFills,
  });
  const aiRuns = await fetchAiRuns(db, {
    exchange,
    fromMs,
    toMsBound,
    limitRuns,
  });

  const baseline = evaluateScenario({
    fills,
    aiRuns,
    cfg: { enabled: false },
  });

  const allCfg = configGrid();
  let bestByWin = baseline;
  let bestByPnl = baseline;
  let bestTargetByWin = null;
  let bestTargetByPnl = null;
  const top = [];

  for (const cfg of allCfg) {
    const r = evaluateScenario({ fills, aiRuns, cfg });
    const s = r.summary;
    const wr = s.win_rate ?? -1;
    const pnl = s.total_pnl_krw ?? -1e18;
    const tr = s.trades ?? 0;
    if (tr >= minTrades && (wr > (bestByWin.summary.win_rate ?? -1) || (wr === (bestByWin.summary.win_rate ?? -1) && pnl > (bestByWin.summary.total_pnl_krw ?? -1e18)))) bestByWin = r;
    if (tr >= minTrades && (pnl > (bestByPnl.summary.total_pnl_krw ?? -1e18) || (pnl === (bestByPnl.summary.total_pnl_krw ?? -1e18) && wr > (bestByPnl.summary.win_rate ?? -1)))) bestByPnl = r;
    if (tr >= minTrades && wr >= targetWin && wr <= targetWinMax && pnl >= targetPnl) {
      if (!bestTargetByWin || wr > (bestTargetByWin.summary.win_rate ?? -1) || (wr === (bestTargetByWin.summary.win_rate ?? -1) && pnl > (bestTargetByWin.summary.total_pnl_krw ?? -1e18))) {
        bestTargetByWin = r;
      }
      if (!bestTargetByPnl || pnl > (bestTargetByPnl.summary.total_pnl_krw ?? -1e18) || (pnl === (bestTargetByPnl.summary.total_pnl_krw ?? -1e18) && wr > (bestTargetByPnl.summary.win_rate ?? -1))) {
        bestTargetByPnl = r;
      }
    }
    top.push(r);
  }

  top.sort((a, b) => {
    const wa = a.summary.win_rate ?? -1;
    const wb = b.summary.win_rate ?? -1;
    if (wb !== wa) return wb - wa;
    return (b.summary.total_pnl_krw ?? -1e18) - (a.summary.total_pnl_krw ?? -1e18);
  });

  console.log(JSON.stringify({
    scope: {
      exchange,
      tf,
      from_iso: fromMs ? new Date(fromMs).toISOString() : null,
      to_iso: toMsBound ? new Date(toMsBound).toISOString() : null,
      fills: fills.length,
      ai_runs: aiRuns.length,
      min_trades: minTrades,
      searched: allCfg.length,
    },
    baseline_no_ai_bias_gate: baseline,
    best_by_win_rate: bestByWin,
    best_by_pnl: bestByPnl,
    best_target_by_win: bestTargetByWin,
    best_target_by_pnl: bestTargetByPnl,
    top_20: top.slice(0, 20),
  }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
