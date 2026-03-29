#!/usr/bin/env node
"use strict";

const { getFirestore } = require("../src/storage/firestore");
const { isLiveDocForExchange } = require("../src/utils/liveOnly");

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const EXCHANGE = "BINANCEFUT";
const TF = "60m";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || String(val).startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

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

function pickMs(x) {
  return (
    toMs(x.exec_bar_close_time_utc_ms) ??
    toMs(x.signal_bar_close_time_utc_ms) ??
    toMs(x.created_at)
  );
}

function eventUpper(x) {
  return String(x.event || x.signal_event || "").toUpperCase();
}

function isEntryFill(x) {
  const ev = eventUpper(x);
  return !!ev && !ev.startsWith("EXIT_");
}

function symbolOf(x) {
  return String(x.symbol || x.symbol_or_pair_id || x.market || "").toUpperCase().replace(/\.P$/i, "");
}

function sideDir(x) {
  const s = String(x.side || "").toUpperCase();
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return null;
}

function parseLeverage(x, fallback = 2) {
  const a = toNum(x.leverage_applied);
  if (Number.isFinite(a) && a > 0) return a;
  const b = toNum(x.applied_leverage);
  if (Number.isFinite(b) && b > 0) return b;
  const r = String(x.applied_leverage || x.leverage_reason || "");
  const m = r.match(/(\d+(?:\.\d+)?)x/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

function notionalKrw(x) {
  const n = toNum(x.notional_krw ?? x.notional);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

async function fetchEntries(db, { days, fromMs, toMs }) {
  const fromBound = Number.isFinite(fromMs) ? fromMs : (Date.now() - days * DAY_MS);
  const toBound = Number.isFinite(toMs) ? toMs : Number.POSITIVE_INFINITY;
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(120000).get();
  const out = [];
  snap.forEach((d) => {
    const x = { id: d.id, ...d.data() };
    if (!isLiveDocForExchange(EXCHANGE, x)) return;
    const ex = String(x.exchange || "").toUpperCase();
    if (!ex.includes("BINANCE")) return;
    if (String(x.tf || "").toLowerCase() !== TF) return;
    if (!isEntryFill(x)) return;
    const ms = pickMs(x);
    if (!Number.isFinite(ms) || ms < fromBound || ms >= toBound) return;
    const sym = symbolOf(x);
    const dir = sideDir(x);
    const px = toNum(x.exec_price);
    const notional = notionalKrw(x);
    if (!sym || !dir || !Number.isFinite(px) || !Number.isFinite(notional) || notional <= 0) return;
    out.push({
      id: d.id,
      symbol: sym,
      dir,
      entryMs: ms,
      entryPx: px,
      notional,
      leverage: parseLeverage(x, 2),
    });
  });
  out.sort((a, b) => a.entryMs - b.entryMs);
  return out;
}

async function fetchKlines1h(symbol, startMs, endMs) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=1500`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KLINES_HTTP_${res.status}_${symbol}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) return [];
  return rows
    .map((k) => ({
      open: toNum(k[1]),
      high: toNum(k[2]),
      low: toNum(k[3]),
      closeTime: toNum(k[6]),
      close: toNum(k[4]),
    }))
    .filter((k) => Number.isFinite(k.closeTime) && Number.isFinite(k.close) && Number.isFinite(k.high) && Number.isFinite(k.low))
    .sort((a, b) => a.closeTime - b.closeTime);
}

function findBarsAfter(klines, fromMs, toMs) {
  const out = [];
  for (const k of klines) {
    if (k.closeTime <= fromMs) continue;
    if (k.closeTime > toMs) break;
    out.push(k);
  }
  return out;
}

function simulateOne(entry, bars, p) {
  const dir = entry.dir;
  const lev = Number.isFinite(entry.leverage) && entry.leverage > 0 ? entry.leverage : 2;
  const ep = entry.entryPx;
  let tp1 = false;
  let trailRef = null;
  let lastClose = ep;
  let reason = "HOLD_24H";

  for (const b of bars) {
    const c = b.close;
    lastClose = c;
    const rawPct = dir === "LONG" ? ((c - ep) / ep) : ((ep - c) / ep);
    const effPct = rawPct * lev;

    if (effPct <= p.sl) {
      reason = "SL";
      return { rawPct, reason };
    }
    if (!tp1 && effPct >= p.tp1) {
      tp1 = true;
      trailRef = c;
      continue;
    }
    if (tp1) {
      if (dir === "LONG") {
        trailRef = Math.max(trailRef, c);
        const trailStop = trailRef * (1 - p.trail);
        if (c <= trailStop) {
          reason = "TRAIL";
          return { rawPct, reason };
        }
      } else {
        trailRef = Math.min(trailRef, c);
        const trailStop = trailRef * (1 + p.trail);
        if (c >= trailStop) {
          reason = "TRAIL";
          return { rawPct, reason };
        }
      }
      if (effPct <= p.be) {
        reason = "BE";
        return { rawPct, reason };
      }
    }
  }

  const rawPct = dir === "LONG" ? ((lastClose - ep) / ep) : ((ep - lastClose) / ep);
  return { rawPct, reason };
}

function emaStep(prev, value, len) {
  const alpha = 2 / (len + 1);
  if (!Number.isFinite(prev)) return value;
  return prev + alpha * (value - prev);
}

function rmaStep(prev, value, len) {
  if (!Number.isFinite(prev)) return value;
  return ((prev * (len - 1)) + value) / len;
}

function buildRegimeIndex(klines) {
  const out = [];
  let ema21 = NaN;
  let ema55 = NaN;
  let trRma = NaN;
  let plusRma = NaN;
  let minusRma = NaN;
  let adxRma = NaN;
  for (let i = 0; i < klines.length; i += 1) {
    const cur = klines[i];
    const prev = i > 0 ? klines[i - 1] : null;
    const close = cur.close;
    ema21 = emaStep(ema21, close, 21);
    ema55 = emaStep(ema55, close, 55);

    let adx = NaN;
    if (prev) {
      const upMove = cur.high - prev.high;
      const downMove = prev.low - cur.low;
      const plusDM = (upMove > 0 && upMove > downMove) ? upMove : 0;
      const minusDM = (downMove > 0 && downMove > upMove) ? downMove : 0;
      const tr = Math.max(
        cur.high - cur.low,
        Math.abs(cur.high - prev.close),
        Math.abs(cur.low - prev.close)
      );
      trRma = rmaStep(trRma, tr, 14);
      plusRma = rmaStep(plusRma, plusDM, 14);
      minusRma = rmaStep(minusRma, minusDM, 14);
      if (Number.isFinite(trRma) && trRma > 0) {
        const pdi = (plusRma / trRma) * 100;
        const mdi = (minusRma / trRma) * 100;
        const dx = (pdi + mdi) > 0 ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0;
        adxRma = rmaStep(adxRma, dx, 14);
        adx = adxRma;
      }
    }

    out.push({
      closeTime: cur.closeTime,
      ema21,
      ema55,
      adx,
      trend: Number.isFinite(adx) && adx >= 25,
      bull: Number.isFinite(ema21) && Number.isFinite(ema55) && ema21 > ema55,
      bear: Number.isFinite(ema21) && Number.isFinite(ema55) && ema21 < ema55,
    });
  }
  return out;
}

function pickRegimeAtEntry(regimeSeries, entryMs) {
  if (!Array.isArray(regimeSeries) || !regimeSeries.length) return null;
  let best = null;
  for (let i = regimeSeries.length - 1; i >= 0; i -= 1) {
    const r = regimeSeries[i];
    if (r.closeTime <= entryMs) {
      best = r;
      break;
    }
  }
  return best;
}

function summarize(rows) {
  let n = 0;
  let wins = 0;
  let losses = 0;
  let net = 0;
  let winSum = 0;
  let lossSumAbs = 0;
  const byReason = {};
  for (const r of rows) {
    const pnl = r.pnlKrw;
    if (!Number.isFinite(pnl)) continue;
    n += 1;
    net += pnl;
    byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    if (pnl > 0) {
      wins += 1;
      winSum += pnl;
    } else if (pnl < 0) {
      losses += 1;
      lossSumAbs += Math.abs(pnl);
    }
  }
  return {
    trades: n,
    win_rate: n ? wins / n : null,
    net_pnl_krw: net,
    avg_win_krw: wins ? (winSum / wins) : null,
    avg_loss_abs_krw: losses ? (lossSumAbs / losses) : null,
    pf: lossSumAbs > 0 ? (winSum / lossSumAbs) : null,
    exit_reasons: byReason,
  };
}

async function runScenario(entries, klinesBySymbol, params) {
  const rows = [];
  for (const e of entries) {
    const all = klinesBySymbol.get(e.symbol) || [];
    const bars = findBarsAfter(all, e.entryMs, e.entryMs + 24 * HOUR_MS);
    if (!bars.length) continue;
    const sim = simulateOne(e, bars, params);
    const pnlKrw = sim.rawPct * e.notional;
    rows.push({
      symbol: e.symbol,
      entryMs: e.entryMs,
      pnlKrw,
      reason: sim.reason,
    });
  }
  return summarize(rows);
}

async function runConditionalScenario(entries, klinesBySymbol, regimeBySymbol, baselineParams, proposalParams) {
  const rows = [];
  let proposalApplied = 0;
  let baselineApplied = 0;
  for (const e of entries) {
    const all = klinesBySymbol.get(e.symbol) || [];
    const bars = findBarsAfter(all, e.entryMs, e.entryMs + 24 * HOUR_MS);
    if (!bars.length) continue;
    const regimeSeries = regimeBySymbol.get(e.symbol) || [];
    const r = pickRegimeAtEntry(regimeSeries, e.entryMs);
    const trendAligned = !!(r && r.trend && ((e.dir === "LONG" && r.bull) || (e.dir === "SHORT" && r.bear)));
    const p = trendAligned ? proposalParams : baselineParams;
    if (trendAligned) proposalApplied += 1;
    else baselineApplied += 1;
    const sim = simulateOne(e, bars, p);
    const pnlKrw = sim.rawPct * e.notional;
    rows.push({
      symbol: e.symbol,
      entryMs: e.entryMs,
      pnlKrw,
      reason: sim.reason,
      mode: trendAligned ? "PROPOSAL_IN_TREND" : "BASELINE_IN_NON_TREND",
    });
  }
  const summary = summarize(rows);
  summary.mix_applied = { proposal_in_trend: proposalApplied, baseline_in_non_trend: baselineApplied };
  return summary;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const daysRaw = cli.days != null ? Number(cli.days) : Number(process.argv[2] || 21);
  const days = Math.max(7, Number.isFinite(daysRaw) ? daysRaw : 21);
  const fromBoundMs = toMs(cli.from);
  const toBoundMs = toMs(cli.to);
  const proposalSl = toNum(cli["proposal-sl"]) ?? -0.02;
  const proposalTp1 = toNum(cli["proposal-tp1"]) ?? 0.035;
  const proposalTrail = toNum(cli["proposal-trail"]) ?? 0.015;
  const proposalBe = toNum(cli["proposal-be"]) ?? 0.0025;
  const proposalName = String(cli["proposal-name"] || `SL${Math.abs(proposalSl * 100).toFixed(1)}/TP${(proposalTp1 * 100).toFixed(1)}/Trail${(proposalTrail * 100).toFixed(1)}/BE${(proposalBe * 100).toFixed(2)}`);
  const db = getFirestore();
  const entries = await fetchEntries(db, { days, fromMs: fromBoundMs, toMs: toBoundMs });
  if (!entries.length) {
    console.log(JSON.stringify({ ok: false, reason: "NO_ENTRY_FILLS", days }, null, 2));
    return;
  }

  const minMs = entries[0].entryMs - 240 * HOUR_MS;
  const maxMs = entries[entries.length - 1].entryMs + 26 * HOUR_MS;
  const symbols = Array.from(new Set(entries.map((e) => e.symbol)));
  const klinesBySymbol = new Map();
  const regimeBySymbol = new Map();
  for (const s of symbols) {
    const rows = await fetchKlines1h(s, minMs, maxMs);
    klinesBySymbol.set(s, rows);
    regimeBySymbol.set(s, buildRegimeIndex(rows));
  }

  const baselineParams = { sl: -0.015, tp1: 0.03, trail: 0.01, be: 0.0025 };
  const proposalParams = { sl: proposalSl, tp1: proposalTp1, trail: proposalTrail, be: proposalBe };

  const [base, prop, cond] = await Promise.all([
    runScenario(entries, klinesBySymbol, baselineParams),
    runScenario(entries, klinesBySymbol, proposalParams),
    runConditionalScenario(entries, klinesBySymbol, regimeBySymbol, baselineParams, proposalParams),
  ]);

  const out = {
    ok: true,
    scope: {
      exchange: EXCHANGE,
      tf: TF,
      days,
      from: Number.isFinite(fromBoundMs) ? new Date(fromBoundMs).toISOString() : null,
      to: Number.isFinite(toBoundMs) ? new Date(toBoundMs).toISOString() : null,
      entries: entries.length,
      symbols: symbols.length
    },
    assumptions: [
      "Entry timing/size follows actual executed entry fills.",
      "Exit simulation uses 1h close-only engine logic (same style as signalEngine close trigger).",
      "Max hold 24h in this proxy; funding/fees/slippage path is not additionally modeled.",
      "Add/reduce multi-leg position interactions are simplified as independent entry tickets.",
    ],
    baseline: { name: "SL1.5/TP3.0/Trail1.0/BE0.25", ...base },
    proposal: { name: proposalName, ...prop },
    conditional: { name: `${proposalName}_ONLY_WHEN_TREND_ALIGNED`, ...cond },
    diff_proposal_minus_baseline: {
      win_rate: (prop.win_rate ?? 0) - (base.win_rate ?? 0),
      net_pnl_krw: (prop.net_pnl_krw ?? 0) - (base.net_pnl_krw ?? 0),
      pf: (prop.pf ?? 0) - (base.pf ?? 0),
      avg_win_krw: (prop.avg_win_krw ?? 0) - (base.avg_win_krw ?? 0),
      avg_loss_abs_krw: (prop.avg_loss_abs_krw ?? 0) - (base.avg_loss_abs_krw ?? 0),
    },
    diff_conditional_minus_baseline: {
      win_rate: (cond.win_rate ?? 0) - (base.win_rate ?? 0),
      net_pnl_krw: (cond.net_pnl_krw ?? 0) - (base.net_pnl_krw ?? 0),
      pf: (cond.pf ?? 0) - (base.pf ?? 0),
      avg_win_krw: (cond.avg_win_krw ?? 0) - (base.avg_win_krw ?? 0),
      avg_loss_abs_krw: (cond.avg_loss_abs_krw ?? 0) - (base.avg_loss_abs_krw ?? 0),
    },
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
