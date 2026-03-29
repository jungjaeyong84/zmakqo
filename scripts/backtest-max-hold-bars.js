#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");
const { buildTradesFromFills } = require("../src/services/tradesFromFills");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const EXCHANGE = "BINANCEFUT";
const TF = "60m";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toMs(v) {
  const n = toNum(v);
  if (Number.isFinite(n)) return n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function pickExecMs(fill) {
  return (
    toMs(fill.exec_bar_close_time_utc_ms) ??
    toMs(fill.bar_close_time_utc_ms) ??
    toMs(fill.created_at)
  );
}

function getSymbol(fill) {
  const raw = String(fill.symbol || fill.symbol_or_pair_id || fill.market || "").toUpperCase();
  return raw.replace(/\.P$/i, "").trim();
}

function getEvent(fill) {
  return String(fill.event || fill.signal_event || fill.raw_event || "").toUpperCase();
}

function qtyFromFill(fill) {
  const qBase = toNum(fill.exec_qty_base);
  if (Number.isFinite(qBase) && qBase > 0) return qBase;
  const px = toNum(fill.exec_price);
  const notional = toNum(fill.notional_krw ?? fill.notional);
  if (Number.isFinite(px) && px > 0 && Number.isFinite(notional) && notional > 0) {
    return notional / px;
  }
  const qFrac = toNum(fill.qty_fraction);
  if (Number.isFinite(qFrac) && qFrac > 0) return qFrac;
  const qPct = toNum(fill.qty_pct);
  if (Number.isFinite(qPct) && qPct > 0) return qPct;
  return null;
}

function notionalFrom(fill, price, qty) {
  const n = toNum(fill.notional_krw ?? fill.notional);
  if (Number.isFinite(n) && n > 0) return n;
  if (Number.isFinite(price) && Number.isFinite(qty) && qty > 0) return Math.abs(price * qty);
  return null;
}

function externalRealized(fill) {
  const raw = fill.external_realized_pnl ?? fill.realized_pnl ?? fill.realizedPnl;
  const n = toNum(raw);
  return Number.isFinite(n) ? n : null;
}

function feeValue(fill) {
  return toNum(fill.fee_value) ?? 0;
}

function isTimeStop8(fill) {
  const ev = getEvent(fill);
  return ev.startsWith("EXIT_TIME_STOP_8B");
}

function isExitAgainst(stateSide, fillSide) {
  return (stateSide === "LONG" && fillSide === "SELL") || (stateSide === "SHORT" && fillSide === "BUY");
}

function pnlByPrice(stateSide, avg, exitPx, notional) {
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(exitPx) || !Number.isFinite(notional)) return null;
  const pct = stateSide === "LONG" ? ((exitPx - avg) / avg) : ((avg - exitPx) / avg);
  return pct * notional;
}

function summarizeTrades(trades) {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let flats = 0;
  let net = 0;
  let winSum = 0;
  let lossSumAbs = 0;
  let avgWin = 0;
  let avgLossAbs = 0;
  for (const t of trades) {
    const pnl = toNum(t.pnl_krw);
    if (!Number.isFinite(pnl)) continue;
    n += 1;
    net += pnl;
    if (pnl > 0) {
      wins += 1;
      winSum += pnl;
    } else if (pnl < 0) {
      losses += 1;
      lossSumAbs += Math.abs(pnl);
    } else {
      flats += 1;
    }
  }
  if (wins > 0) avgWin = winSum / wins;
  if (losses > 0) avgLossAbs = lossSumAbs / losses;
  const pf = lossSumAbs > 0 ? (winSum / lossSumAbs) : null;
  return {
    trades: n,
    wins,
    losses,
    flats,
    win_rate: n > 0 ? (wins / n) : null,
    net_pnl: net,
    avg_win: wins > 0 ? avgWin : null,
    avg_loss_abs: losses > 0 ? avgLossAbs : null,
    pf,
  };
}

async function fetchRecentFills(db, { days = 30, limit = 120000 } = {}) {
  const fromMs = Date.now() - days * DAY_MS;
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limit).get();
  const rows = [];
  snap.forEach((d) => {
    const f = { id: d.id, ...d.data() };
    const ex = String(f.exchange || "").toUpperCase();
    const tf = String(f.tf || "").toLowerCase();
    if (!ex.includes("BINANCE")) return;
    if (tf !== TF) return;
    if (!isLiveDocForExchange(EXCHANGE, f)) return;
    const ms = pickExecMs(f);
    if (!Number.isFinite(ms) || ms < fromMs) return;
    rows.push(f);
  });
  rows.sort((a, b) => (pickExecMs(a) || 0) - (pickExecMs(b) || 0));
  return rows;
}

const priceCache = new Map();

async function fetchCloseAtTarget(symbol, targetCloseMs) {
  const key = `${symbol}|${targetCloseMs}`;
  if (priceCache.has(key)) return priceCache.get(key);
  const start = targetCloseMs - 3 * HOUR_MS;
  const end = targetCloseMs + 3 * HOUR_MS;
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${start}&endTime=${end}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) {
    priceCache.set(key, null);
    return null;
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || !rows.length) {
    priceCache.set(key, null);
    return null;
  }
  let best = null;
  let bestDist = Infinity;
  for (const k of rows) {
    const closeTime = toNum(k[6]);
    const closePx = toNum(k[4]);
    if (!Number.isFinite(closeTime) || !Number.isFinite(closePx)) continue;
    const dist = Math.abs(closeTime - targetCloseMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = closePx;
    }
  }
  priceCache.set(key, best);
  return best;
}

async function buildDeltaByTimeStopFill(fills) {
  const state = new Map();
  const deltaByFillId = new Map();
  const sampled = [];
  for (const f of fills) {
    const symbol = getSymbol(f);
    if (!symbol) continue;
    const side = String(f.side || "").toUpperCase();
    const px = toNum(f.exec_price);
    const ms = pickExecMs(f);
    const qty = qtyFromFill(f);
    if (!Number.isFinite(px) || !Number.isFinite(ms) || !Number.isFinite(qty) || qty <= 0) continue;

    const st = state.get(symbol) || { side: null, size: 0, avg: null };
    if (!st.side || st.size <= 0) {
      st.side = side === "SELL" ? "SHORT" : "LONG";
      st.size = qty;
      st.avg = px;
      state.set(symbol, st);
      continue;
    }

    if (!isExitAgainst(st.side, side)) {
      const nextSize = st.size + qty;
      st.avg = ((st.avg * st.size) + (px * qty)) / nextSize;
      st.size = nextSize;
      state.set(symbol, st);
      continue;
    }

    const closeQty = Math.min(qty, st.size);
    const notional = notionalFrom(f, px, closeQty);
    const ext = externalRealized(f);
    const fee = feeValue(f);
    const actual = Number.isFinite(ext) ? (ext - fee) : pnlByPrice(st.side, st.avg, px, notional);

    if (isTimeStop8(f) && Number.isFinite(actual) && Number.isFinite(notional) && notional > 0) {
      const targetMs = ms + 4 * HOUR_MS;
      const altPx = await fetchCloseAtTarget(symbol, targetMs);
      if (Number.isFinite(altPx)) {
        const altByPrice = pnlByPrice(st.side, st.avg, altPx, notional);
        if (Number.isFinite(altByPrice)) {
          const alt = altByPrice - fee;
          const delta = alt - actual;
          const fillId = String(f.fill_id || f.id || "");
          if (fillId) deltaByFillId.set(fillId, delta);
          sampled.push({
            symbol,
            exit_ms_8b: ms,
            exit_px_8b: px,
            exit_px_12b: altPx,
            delta,
          });
        }
      }
    }

    st.size -= closeQty;
    if (st.size <= 1e-12) {
      st.side = null;
      st.size = 0;
      st.avg = null;
    }
    state.set(symbol, st);
  }
  return { deltaByFillId, sampled };
}

async function main() {
  const days = Math.max(1, Number(process.argv[2] || 30));
  const db = getFirestore();
  const fills = await fetchRecentFills(db, { days });
  if (!fills.length) {
    console.log(JSON.stringify({ ok: false, reason: "NO_FILLS", days }, null, 2));
    return;
  }

  const grouped = new Map();
  for (const f of fills) {
    const key = `${getSymbol(f)}__${String(f.tf || TF)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(f);
  }

  let trades = [];
  for (const arr of grouped.values()) {
    arr.sort((a, b) => (pickExecMs(a) || 0) - (pickExecMs(b) || 0));
    const built = buildTradesFromFills(arr, { mode: String(process.env.TRADE_PNL_MODE || "EACH_SELL") });
    if (built && Array.isArray(built.trades)) trades = trades.concat(built.trades);
  }

  const baseline = summarizeTrades(trades);
  const { deltaByFillId, sampled } = await buildDeltaByTimeStopFill(fills);

  const adjustedTrades = trades.map((t) => {
    const fillId = String(t.fill_id || "");
    const d = deltaByFillId.get(fillId);
    if (!Number.isFinite(d)) return t;
    return { ...t, pnl_krw: (toNum(t.pnl_krw) || 0) + d };
  });
  const hold12 = summarizeTrades(adjustedTrades);

  const deltaNet = hold12.net_pnl - baseline.net_pnl;
  const out = {
    ok: true,
    scope: { exchange: EXCHANGE, tf: TF, days },
    assumption: "Only EXIT_TIME_STOP_8B fills are shifted to +4 bars (12B). Funding/slippage change over extra 4 bars is not modeled.",
    sample_count_time_stop_shifted: sampled.length,
    baseline_8b: baseline,
    counterfactual_12b: hold12,
    diff_12b_minus_8b: {
      net_pnl: deltaNet,
      win_rate: (hold12.win_rate ?? 0) - (baseline.win_rate ?? 0),
      pf: (hold12.pf ?? 0) - (baseline.pf ?? 0),
      avg_win: (hold12.avg_win ?? 0) - (baseline.avg_win ?? 0),
      avg_loss_abs: (hold12.avg_loss_abs ?? 0) - (baseline.avg_loss_abs ?? 0),
    },
    top_shift_samples: sampled.slice(0, 20),
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

