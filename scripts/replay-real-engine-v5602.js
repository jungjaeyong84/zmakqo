#!/usr/bin/env node
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const settings = require("../src/storage/settings");

const originalGetSystemSettingsForProvider = settings.getSystemSettingsForProvider;
settings.getSystemSettingsForProvider = async function patchedGetSystemSettingsForProvider(provider, ttlMs) {
  const res = await originalGetSystemSettingsForProvider(provider, ttlMs);
  const data = { ...(res && res.data ? res.data : {}) };
  // Safety: force replay path to PAPER to prevent any live order calls.
  data.execution_mode = "PAPER";
  data.live_enabled = false;
  data.live_dry_run = false;
  data.phase0_paper_only = true;
  data.binance_real_trading_enabled = false;
  data.alert_channel = "";
  return { ...(res || {}), data };
};

const { runPaperFuturesForBar } = require("../src/engine/paperBinanceRunner");
const { upsertBarSnapshot } = require("../src/storage/barsSnapshots");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");

const HOUR_MS = 60 * 60 * 1000;

function getArg(name, fallback = "") {
  const k = `--${name}=`;
  const hit = process.argv.find((x) => String(x || "").startsWith(k));
  if (!hit) return fallback;
  return hit.slice(k.length);
}

function parseBool(raw, fallback = false) {
  if (raw == null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseNum(raw, fallback = null) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toMs(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : null;
}

function nowIso() {
  return new Date().toISOString();
}

function kst(ms) {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + (9 * HOUR_MS));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${h}:${mi}:${s} KST`;
}

function unique(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

function pct(x) {
  if (!Number.isFinite(x)) return null;
  return Number((x * 100).toFixed(2));
}

function n(v, fallback = null) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function toBinanceInterval(tf) {
  const t = String(tf || "").trim().toLowerCase();
  if (t === "60m" || t === "1h") return "1h";
  if (t === "15m") return "15m";
  if (t === "4h") return "4h";
  if (t === "1d") return "1d";
  return "1h";
}

async function fetchBarsFromBinanceApi({ symbol, tf, fromMs, toMs, maxBars } = {}) {
  const interval = toBinanceInterval(tf);
  const out = [];
  const hardLimit = Math.max(120, Number(maxBars) || 1200);
  let cursor = Number(fromMs);
  const endMs = Number(toMs);
  if (!Number.isFinite(cursor) || !Number.isFinite(endMs) || cursor >= endMs) return out;

  while (cursor < endMs && out.length < hardLimit) {
    const remaining = hardLimit - out.length;
    const limit = Math.max(1, Math.min(1500, remaining));
    const url = new URL("https://fapi.binance.com/fapi/v1/klines");
    url.searchParams.set("symbol", String(symbol || "").toUpperCase());
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(endMs));
    url.searchParams.set("limit", String(limit));

    const res = await fetch(url.toString(), { method: "GET" });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`BINANCE_KLINES_HTTP_${res.status}: ${txt.slice(0, 200)}`);
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) break;

    let lastCloseMs = null;
    for (const r of rows) {
      const closeMs = Number(r && r[6]);
      if (!Number.isFinite(closeMs)) continue;
      if (closeMs < fromMs || closeMs >= endMs) continue;
      out.push({
        closeTimeUtcMs: closeMs,
        closeTimeUtc: new Date(closeMs).toISOString(),
        timestamp: closeMs,
        open: n(r && r[1], null),
        high: n(r && r[2], null),
        low: n(r && r[3], null),
        close: n(r && r[4], null),
        volume: n(r && r[5], null),
        t: new Date(closeMs).toISOString(),
        o: n(r && r[1], null),
        h: n(r && r[2], null),
        l: n(r && r[3], null),
        c: n(r && r[4], null),
        v: n(r && r[5], null),
        created_at: null,
      });
      lastCloseMs = closeMs;
    }
    if (!Number.isFinite(lastCloseMs)) break;
    cursor = lastCloseMs + 1;
    if (rows.length < limit) break;
  }

  out.sort((a, b) => n(a.closeTimeUtcMs, 0) - n(b.closeTimeUtcMs, 0));
  if (out.length > hardLimit) return out.slice(out.length - hardLimit);
  return out;
}

function symbolOf(row) {
  return String(row && (row.symbol_or_pair_id || row.symbol || row.market) || "").trim().toUpperCase();
}

function extractStrategyId(row) {
  if (!row || typeof row !== "object") return null;
  if (row.strategy_id) return String(row.strategy_id);
  const f = row.features_json && typeof row.features_json === "object" ? row.features_json : {};
  return String(
    f.strategy_id ||
    f.strategyId ||
    f._strategy_id_received ||
    f._strategy_id_default ||
    ""
  ).trim() || null;
}

function shouldKeepSignal(row, { fromMs, toMs, symbolSet, tf, strategyId, strictStrategy }) {
  const ms = n(row && row.bar_close_time_utc_ms);
  if (!Number.isFinite(ms)) return false;
  if (Number.isFinite(fromMs) && ms < fromMs) return false;
  if (Number.isFinite(toMs) && ms >= toMs) return false;
  const sym = symbolOf(row);
  if (!sym || !symbolSet.has(sym)) return false;
  if (String(row.tf || "").trim().toLowerCase() !== String(tf || "").trim().toLowerCase()) return false;
  if (!strategyId) return true;
  const sid = extractStrategyId(row);
  if (strictStrategy) return sid === strategyId;
  return !sid || sid === strategyId;
}

function byMsAsc(a, b) {
  return (n(a && a.bar_close_time_utc_ms, 0) - n(b && b.bar_close_time_utc_ms, 0));
}

async function fetchSignalsForReplay(db, {
  exchange,
  symbols,
  tf,
  fromMs,
  toMs,
  strategyId,
  strictStrategy,
  hardMaxDocs,
}) {
  const out = [];
  const symbolSet = new Set((symbols || []).map((s) => String(s).trim().toUpperCase()));
  const page = 1000;
  let scanned = 0;
  let cursor = null;

  while (scanned < hardMaxDocs) {
    const remaining = hardMaxDocs - scanned;
    const lim = Math.max(1, Math.min(page, remaining));
    let snap = null;
    try {
      let q = db
        .collection("signals")
        .where("exchange", "==", exchange)
        .orderBy("created_at", "desc")
        .limit(lim);
      if (cursor) q = q.startAfter(cursor);
      snap = await q.get();
    } catch (_e) {
      let q = db.collection("signals").orderBy("created_at", "desc").limit(lim);
      if (cursor) q = q.startAfter(cursor);
      snap = await q.get();
    }
    if (!snap || snap.empty) break;

    scanned += snap.size;
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      if (String(row.exchange || "").toUpperCase() !== exchange) continue;
      if (!shouldKeepSignal(row, { fromMs, toMs, symbolSet, tf, strategyId, strictStrategy })) continue;
      out.push({ _id: doc.id, ...row });
    }

    const last = snap.docs[snap.docs.length - 1];
    cursor = last;

    const oldestCreated = Date.parse(String((last && last.data() && last.data().created_at) || ""));
    if (Number.isFinite(fromMs) && Number.isFinite(oldestCreated) && oldestCreated < fromMs) {
      // Enough history for requested window.
      break;
    }
    if (snap.size < lim) break;
  }

  out.sort(byMsAsc);
  return out;
}

async function fetchBarsForReplay(db, {
  exchange,
  symbol,
  tf,
  fromMs,
  toMs,
  maxBars,
  hardScan,
  barsSource,
}) {
  const source = String(barsSource || "AUTO").trim().toUpperCase();
  if (source === "BINANCE") {
    return fetchBarsFromBinanceApi({ symbol, tf, fromMs, toMs, maxBars });
  }

  const out = [];
  const push = (doc) => {
    const row = doc.data ? doc.data() : doc;
    const ms = n(row && row.bar_close_time_utc_ms);
    if (!Number.isFinite(ms)) return;
    if (Number.isFinite(fromMs) && ms < fromMs) return;
    if (Number.isFinite(toMs) && ms >= toMs) return;
    if (String(row.exchange || "").toUpperCase() !== exchange) return;
    if (String(row.symbol || "").toUpperCase() !== symbol) return;
    if (String(row.tf || "").toLowerCase() !== String(tf || "").toLowerCase()) return;
    const ohlcv = row.ohlcv_json && typeof row.ohlcv_json === "object" ? row.ohlcv_json : {};
    out.push({
      closeTimeUtcMs: ms,
      closeTimeUtc: row.bar_close_time_utc || ohlcv.closeTimeUtc || null,
      timestamp: ms,
      open: n(ohlcv.open, null),
      high: n(ohlcv.high, null),
      low: n(ohlcv.low, null),
      close: n(ohlcv.close, null),
      volume: n(ohlcv.volume, null),
      t: row.bar_close_time_utc || ohlcv.closeTimeUtc || null,
      o: n(ohlcv.open, null),
      h: n(ohlcv.high, null),
      l: n(ohlcv.low, null),
      c: n(ohlcv.close, null),
      v: n(ohlcv.volume, null),
      created_at: row.created_at || null,
    });
  };

  try {
    const snap = await db
      .collection("bars_snapshots")
      .where("exchange", "==", exchange)
      .where("symbol", "==", symbol)
      .where("tf", "==", tf)
      .where("bar_close_time_utc_ms", ">=", fromMs)
      .where("bar_close_time_utc_ms", "<", toMs)
      .orderBy("bar_close_time_utc_ms", "asc")
      .limit(maxBars)
      .get();
    snap.forEach((d) => push(d));
  } catch (_errIndexed) {
    let scanned = 0;
    let cursor = null;
    const page = 1000;
    while (scanned < hardScan && out.length < maxBars) {
      const remaining = hardScan - scanned;
      const lim = Math.max(1, Math.min(page, remaining));
      let snap = null;
      try {
        let q = db.collection("bars_snapshots")
          .where("exchange", "==", exchange)
          .orderBy("created_at", "desc")
          .limit(lim);
        if (cursor) q = q.startAfter(cursor);
        snap = await q.get();
      } catch (_errEqOrder) {
        let q = db.collection("bars_snapshots").orderBy("created_at", "desc").limit(lim);
        if (cursor) q = q.startAfter(cursor);
        snap = await q.get();
      }
      if (!snap || snap.empty) break;
      scanned += snap.size;
      snap.forEach((d) => push(d));
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < lim) break;
    }
  }

  out.sort((a, b) => n(a.closeTimeUtcMs, 0) - n(b.closeTimeUtcMs, 0));
  if (out.length <= 1 && String(exchange || "").toUpperCase() === "BINANCEFUT") {
    return fetchBarsFromBinanceApi({ symbol, tf, fromMs, toMs, maxBars });
  }
  if (out.length > maxBars) return out.slice(out.length - maxBars);
  return out;
}

async function writeReplaySignals(db, { replayExchange, tf, signals }) {
  const now = nowIso();
  const batchSize = 350;
  let wrote = 0;
  for (let i = 0; i < signals.length; i += batchSize) {
    const chunk = signals.slice(i, i + batchSize);
    const batch = db.batch();
    for (const row of chunk) {
      const sym = symbolOf(row);
      const ms = n(row.bar_close_time_utc_ms);
      const ev = String(row.event || "").toUpperCase();
      if (!sym || !Number.isFinite(ms) || !ev) continue;
      const id = `SIG__${replayExchange}__${sym}__${tf}__${ms}__${ev}`;
      const ref = db.collection("signals").doc(id);
      const features = row.features_json && typeof row.features_json === "object"
        ? { ...row.features_json }
        : {};
      features._replay_original_exchange = row.exchange || null;
      features._replay_original_signal_id = row.signal_id || row._id || null;
      features._replay_original_created_at = row.created_at || null;
      const payload = {
        signal_id: id,
        exchange: replayExchange,
        symbol_or_pair_id: sym,
        tf: tf,
        bar_close_time_utc: row.bar_close_time_utc || (Number.isFinite(ms) ? new Date(ms).toISOString() : null),
        bar_close_time_utc_ms: ms,
        event: ev,
        side: row.side || null,
        qty_pct: n(row.qty_pct, null),
        reason: row.reason || "REPLAY_COPY",
        features_json: features,
        execution_mode: "PAPER",
        event_intent: row.event_intent || null,
        event_group: row.event_group || null,
        event_subtype: row.event_subtype || null,
        mapping_version: row.mapping_version || null,
        mapping_source: row.mapping_source || null,
        mapping_side_expected: row.mapping_side_expected || null,
        mapping_ok: row.mapping_ok === true,
        payload_hash: row.payload_hash || null,
        revision: 1,
        received_count: 1,
        dup_count: 0,
        consumed_at: null,
        consumed_run_id: null,
        locked_at: null,
        locked_run_id: null,
        created_at: now,
        updated_at: now,
      };
      batch.set(ref, payload, { merge: true });
      wrote += 1;
    }
    await batch.commit();
  }
  return wrote;
}

async function copyReplayBars({ replayExchange, tf, barsBySymbol, runIdPrefix }) {
  let wrote = 0;
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    for (const b of bars) {
      const ms = n(b && (b.closeTimeUtcMs || b.timestamp || b.close_ms));
      if (!Number.isFinite(ms)) continue;
      const closeUtc = b.closeTimeUtc || b.t || new Date(ms).toISOString();
      await upsertBarSnapshot({
        runId: `${runIdPrefix}__BARCOPY__${symbol}__${ms}`,
        exchange: replayExchange,
        symbol,
        tf,
        barCloseTimeUtc: closeUtc,
        barCloseTimeUtcMs: ms,
        bar: {
          open: n(b.open ?? b.o, null),
          high: n(b.high ?? b.h, null),
          low: n(b.low ?? b.l, null),
          close: n(b.close ?? b.c, null),
          volume: n(b.volume ?? b.v, null),
          closeTimeUtc: closeUtc,
          closeTimeUtcMs: ms,
          timestamp: ms,
          t: closeUtc,
        },
      });
      wrote += 1;
    }
  }
  return wrote;
}

function buildTimeline(barsBySymbol) {
  const out = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    for (const b of bars) {
      const ms = n(b && (b.closeTimeUtcMs || b.timestamp || b.close_ms));
      if (!Number.isFinite(ms)) continue;
      out.push({
        symbol,
        ms,
        bar: {
          open: n(b.open ?? b.o, null),
          high: n(b.high ?? b.h, null),
          low: n(b.low ?? b.l, null),
          close: n(b.close ?? b.c, null),
          volume: n(b.volume ?? b.v, null),
          closeTimeUtc: b.closeTimeUtc || b.t || new Date(ms).toISOString(),
          closeTimeUtcMs: ms,
          timestamp: ms,
          t: b.closeTimeUtc || b.t || new Date(ms).toISOString(),
        },
      });
    }
  }
  out.sort((a, b) => (a.ms - b.ms) || String(a.symbol).localeCompare(String(b.symbol)));
  return out;
}

async function fetchByExchange(db, collection, exchange, hardLimit = 20000) {
  const out = [];
  const snap = await db.collection(collection).where("exchange", "==", exchange).limit(hardLimit).get();
  snap.forEach((d) => out.push({ _id: d.id, ...d.data() }));
  return out;
}

function summarizeTrades(trades) {
  let total = 0;
  let wins = 0;
  let pnlSum = 0;
  let pnlPctSum = 0;
  for (const t of trades || []) {
    const p = n(t && t.pnl_krw);
    const pp = n(t && t.pnl_pct);
    if (!Number.isFinite(pp)) continue;
    total += 1;
    if (pp > 0) wins += 1;
    if (Number.isFinite(p)) pnlSum += p;
    pnlPctSum += pp;
  }
  return {
    trades: total,
    win_rate: total > 0 ? Number((wins / total).toFixed(4)) : null,
    avg_pnl_pct: total > 0 ? Number((pnlPctSum / total).toFixed(6)) : null,
    total_pnl_quote: Number(pnlSum.toFixed(4)),
  };
}

function countBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows || []) {
    const k = String(keyFn(r) || "UNKNOWN");
    m.set(k, (m.get(k) || 0) + 1);
  }
  return Array.from(m.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ key: k, count: v }));
}

async function deleteByExchange(db, collection, exchange) {
  let deleted = 0;
  while (true) {
    const snap = await db.collection(collection).where("exchange", "==", exchange).limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.size;
  }
  return deleted;
}

async function cleanupReplayData(db, exchange) {
  const targets = [
    "signals",
    "signals_dropped",
    "order_intents_paper",
    "fills_paper",
    "trades_paper",
    "positions_paper",
    "bars_snapshots",
    "processed_cursors",
  ];
  const out = {};
  for (const col of targets) {
    try {
      out[col] = await deleteByExchange(db, col, exchange);
    } catch (_e) {
      out[col] = null;
    }
  }
  return out;
}

async function main() {
  const exchange = String(getArg("exchange", "BINANCEFUT")).trim().toUpperCase();
  const tf = String(getArg("tf", process.env.EXECUTION_TF || process.env.EXEC_TF || "15m")).trim().toLowerCase();
  const days = Math.max(1, Math.min(60, Math.floor(parseNum(getArg("days", "7"), 7))));
  const toMsBound = toMs(getArg("to", "")) || Date.now();
  const fromMsBound = toMs(getArg("from", "")) || (toMsBound - (days * 24 * HOUR_MS));
  const strategyId = String(getArg("strategy_id", "donbeolja_v5.6.0.2")).trim();
  const strictStrategy = parseBool(getArg("strategy_strict", "1"), true);
  const symbolsArg = String(getArg("symbols", "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT")).trim();
  const symbols = unique(symbolsArg.split(",").map((s) => s.trim().toUpperCase()));
  const keep = parseBool(getArg("keep", "0"), false);
  const outFile = String(getArg("out", "")).trim();
  const hardSignals = Math.max(2000, Math.min(250000, Math.floor(parseNum(getArg("hard_signals", "90000"), 90000))));
  const maxBars = Math.max(120, Math.min(3500, Math.floor(parseNum(getArg("max_bars", "1200"), 1200))));
  const hardScan = Math.max(
    maxBars * 8,
    Math.floor(parseNum(getArg("hard_scan", String(maxBars * 8)), maxBars * 8))
  );
  const barsSource = String(getArg("bars_source", "AUTO")).trim().toUpperCase();

  process.env.SIGNALS_LATE_MAX_AGE_MS = String(365 * 24 * 60 * 60 * 1000);
  process.env.DROP_FILTERS_MODE = "record";
  process.env.BINANCE_REAL_TRADING_ENABLED = "0";

  const runTs = Date.now();
  const replayExchange = `${exchange}_REPLAY_${runTs}`;
  const runIdPrefix = `RUN__REAL_ENGINE_REPLAY__${runTs}`;
  const db = getFirestore();

  const barsBySymbol = {};
  for (const symbol of symbols) {
    const bars = await fetchBarsForReplay(db, {
      exchange,
      symbol,
      tf,
      fromMs: fromMsBound,
      toMs: toMsBound,
      maxBars,
      hardScan,
      barsSource,
    });
    barsBySymbol[symbol] = bars;
  }

  const activeSymbols = Object.entries(barsBySymbol)
    .filter(([, bars]) => Array.isArray(bars) && bars.length > 1)
    .map(([s]) => s);

  if (!activeSymbols.length) {
    throw new Error("NO_BARS_IN_RANGE_FOR_SYMBOLS");
  }

  const sourceSignals = await fetchSignalsForReplay(db, {
    exchange,
    symbols: activeSymbols,
    tf,
    fromMs: fromMsBound,
    toMs: toMsBound,
    strategyId,
    strictStrategy,
    hardMaxDocs: hardSignals,
  });

  if (!sourceSignals.length) {
    throw new Error("NO_SIGNALS_MATCHED_FOR_REPLAY");
  }

  await copyReplayBars({ replayExchange, tf, barsBySymbol, runIdPrefix });
  await writeReplaySignals(db, { replayExchange, tf, signals: sourceSignals });

  const timeline = buildTimeline(
    Object.fromEntries(
      activeSymbols.map((s) => [s, barsBySymbol[s]])
    )
  );

  let stepOk = 0;
  let stepFail = 0;
  for (const step of timeline) {
    try {
      await runPaperFuturesForBar({
        runId: `${runIdPrefix}__${step.symbol}__${step.ms}`,
        exchange: replayExchange,
        symbol: step.symbol,
        tf,
        execTf: tf,
        barCloseUtc: step.bar.closeTimeUtc,
        barCloseMs: step.ms,
        bar: step.bar,
        gate: {
          ok: true,
          status: "PASS",
          severity: "SOFT",
          reasonCodes: [],
          trading_mode: "RUNNING",
          metrics: {
            bar_close_time_utc_ms: step.ms,
            bar_close_time_utc: step.bar.closeTimeUtc,
            lagMs: 0,
          },
        },
        trading_mode: "RUNNING",
      });
      stepOk += 1;
    } catch (e) {
      stepFail += 1;
      console.error("[REPLAY_STEP_FAIL]", step.symbol, step.ms, e && e.message ? e.message : String(e));
    }
  }

  const fills = await fetchByExchange(db, "fills_paper", replayExchange, 30000);
  const drops = await fetchByExchange(db, "signals_dropped", replayExchange, 30000);
  const intents = await fetchByExchange(db, "order_intents_paper", replayExchange, 30000);

  const bySymbolFills = new Map();
  for (const f of fills) {
    const s = symbolOf(f);
    if (!s) continue;
    if (!bySymbolFills.has(s)) bySymbolFills.set(s, []);
    bySymbolFills.get(s).push(f);
  }
  const allTrades = [];
  const symbolTrades = {};
  for (const [sym, list] of bySymbolFills.entries()) {
    list.sort((a, b) => n(a.exec_bar_close_time_utc_ms, 0) - n(b.exec_bar_close_time_utc_ms, 0));
    const built = buildTradesFromFills(list, { mode: "FULL_CLOSE" });
    const trades = Array.isArray(built && built.trades) ? built.trades : [];
    symbolTrades[sym] = summarizeTrades(trades);
    allTrades.push(...trades);
  }

  const tp1Fills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("EXIT_TP_P1"));
  const trailFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("EXIT_TRAIL"));
  const slFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("EXIT_SL"));

  const summary = {
    scope: {
      baseline_strategy_id: strategyId || null,
      strict_strategy_filter: strictStrategy,
      source_exchange: exchange,
      replay_exchange: replayExchange,
      tf,
      symbols: activeSymbols,
      from_utc: new Date(fromMsBound).toISOString(),
      to_utc: new Date(toMsBound).toISOString(),
      from_kst: kst(fromMsBound),
      to_kst: kst(toMsBound),
    },
    input: {
      bars_by_symbol: Object.fromEntries(activeSymbols.map((s) => [s, barsBySymbol[s].length])),
      source_signals: sourceSignals.length,
      source_signals_by_event: countBy(sourceSignals, (r) => r.event).slice(0, 20),
    },
    replay: {
      timeline_steps: timeline.length,
      steps_ok: stepOk,
      steps_failed: stepFail,
      intents: intents.length,
      fills: fills.length,
      drops: drops.length,
      drops_top: countBy(drops, (r) => r.reason || r.drop_reason_code || "UNKNOWN").slice(0, 20),
      exit_counts: {
        tp1: tp1Fills.length,
        trail: trailFills.length,
        sl: slFills.length,
        trail_after_tp1_ratio_pct: tp1Fills.length > 0
          ? Number(((trailFills.length / tp1Fills.length) * 100).toFixed(2))
          : null,
      },
      trades_overall: summarizeTrades(allTrades),
      trades_by_symbol: symbolTrades,
    },
  };

  if (outFile) {
    const abs = path.resolve(outFile);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    summary.output_file = abs;
  }

  console.log(JSON.stringify(summary, null, 2));

  if (!keep) {
    const cleanup = await cleanupReplayData(db, replayExchange);
    console.error("[REPLAY_CLEANUP]", JSON.stringify(cleanup));
  } else {
    console.error("[REPLAY_KEEP_DATA]", replayExchange);
  }
}

main().catch((err) => {
  console.error("REAL_ENGINE_REPLAY_FAILED:", err && err.stack ? err.stack : (err && err.message ? err.message : String(err)));
  process.exit(1);
});
