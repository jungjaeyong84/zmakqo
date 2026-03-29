#!/usr/bin/env node
"use strict";

const https = require("https");
const { getFirestore } = require("../src/storage/firestore");

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

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
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

function signalDirFromEvent(event) {
  const e = String(event || "").toUpperCase();
  if (e.includes("_LONG")) return "LONG";
  if (e.includes("_SHORT")) return "SHORT";
  return null;
}

function isCoreOrReal(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("CORE_") || e.startsWith("REAL_");
}

function isExitEvent(event) {
  const e = String(event || "").toUpperCase();
  return e.startsWith("EXIT_") || e === "EXIT_ALL";
}

function shouldEarlyEntry(features, dir, scoreMin) {
  const regime = String(features.pro_regime_state || "").toLowerCase();
  if (regime === "range") return false;
  const trend = String(features.pro_trend_state || "").toLowerCase();
  const htf = String(features.pro_htf_state || "").toLowerCase();
  if (!trend || !htf || trend !== htf) return false;
  const score = Number(features.score);
  if (Number.isFinite(score)) {
    if (dir === "LONG" && score < scoreMin) return false;
    if (dir === "SHORT" && score > -scoreMin) return false;
  }
  return true;
}

function summarize(trades) {
  let wins = 0;
  let total = 0;
  let sum = 0;
  for (const t of trades) {
    total += 1;
    sum += t.pnl_pct;
    if (t.pnl_pct > 0) wins += 1;
  }
  return {
    trades: total,
    win_rate: total ? Number((wins / total).toFixed(4)) : null,
    avg_pnl_pct: total ? Number((sum / total).toFixed(6)) : null,
    total_pnl_pct: Number(sum.toFixed(6)),
  };
}

(async () => {
  const symbol = String(getArg("symbol", "BTCUSDT")).toUpperCase();
  const interval = String(getArg("interval", "1h")).toLowerCase();
  const days = Number(getArg("days", "30"));
  const scoreMin = Number(getArg("early_score_min", "35"));
  const earlyRatioRaw = Number(getArg("early_ratio", "0.5"));
  const earlyRatio = Number.isFinite(earlyRatioRaw) ? Math.min(Math.max(earlyRatioRaw, 0.0), 1.0) : 0.5;
  const limitSignals = Number(getArg("limit_signals", "20000"));
  const now = Date.now();
  const fromMs = now - days * 24 * 60 * 60 * 1000;
  const tfMs = 60 * 60 * 1000;

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`;
  const klines = await fetchJson(url);
  const bars = new Map();
  for (const k of klines) {
    const closeTime = Number(k[6]);
    if (!Number.isFinite(closeTime) || closeTime < fromMs) continue;
    const close = Number(k[4]);
    if (!Number.isFinite(close)) continue;
    const aligned = Math.round(closeTime / tfMs) * tfMs;
    bars.set(aligned, close);
  }

  const db = getFirestore();
  const snap = await db.collection("signals").orderBy("created_at", "desc").limit(limitSignals).get();
  const signals = [];
  snap.forEach((d) => {
    const s = d.data() || {};
    if (String(s.exchange || "").toUpperCase() !== "BINANCEFUT") return;
    const sym = s.symbol || s.symbol_or_pair_id || "";
    if (sym !== symbol) return;
    const barMs = Number(s.bar_close_time_utc_ms);
    const refMs = Number.isFinite(barMs) ? barMs : toMs(s.created_at);
    if (!Number.isFinite(refMs) || refMs < fromMs) return;
    const event = s.event;
    if (!isCoreOrReal(event) && !isExitEvent(event)) return;
    signals.push({ ...s, _bar_ms: refMs, _features: parseFeatures(s.features_json) || {} });
  });

  signals.sort((a, b) => a._bar_ms - b._bar_ms);

  function runSim(useEarly) {
    const trades = [];
    let pos = null;
    for (const s of signals) {
      const event = s.event;
      const barMs = s._bar_ms;
      const closePx = bars.get(barMs);
      if (!Number.isFinite(closePx)) continue;

      if (isExitEvent(event)) {
        if (pos) {
          const pnl = pos.side === "LONG" ? (closePx / pos.entry - 1) : (pos.entry / closePx - 1);
          trades.push({ entry_ms: pos.ms, exit_ms: barMs, side: pos.side, pnl_pct: pnl });
          pos = null;
        }
        continue;
      }

      const dir = signalDirFromEvent(event);
      if (!dir) continue;

      let entryPx = closePx;
      if (useEarly && isCoreOrReal(event)) {
        const earlyOk = shouldEarlyEntry(s._features || {}, dir, scoreMin);
        if (earlyOk) {
          const prevClose = bars.get(barMs - tfMs);
          if (Number.isFinite(prevClose)) {
            entryPx = prevClose * earlyRatio + closePx * (1.0 - earlyRatio);
          }
        }
      }

      if (!pos) {
        pos = { side: dir, entry: entryPx, ms: barMs };
        continue;
      }

      if (pos.side !== dir) {
        const pnl = pos.side === "LONG" ? (closePx / pos.entry - 1) : (pos.entry / closePx - 1);
        trades.push({ entry_ms: pos.ms, exit_ms: barMs, side: pos.side, pnl_pct: pnl });
        pos = { side: dir, entry: entryPx, ms: barMs };
      }
    }
    return trades;
  }

  const baseTrades = runSim(false);
  const earlyTrades = runSim(true);

  const out = {
    scope: {
      symbol,
      interval,
      days,
      from_iso: new Date(fromMs).toISOString(),
      bars_loaded: bars.size,
      signals_used: signals.length,
      early_score_min: scoreMin,
      early_ratio: earlyRatio,
      note: "Approx: CORE/REAL entries are shifted by partial early entry if trend/HTF aligned and regime != range.",
    },
    baseline: summarize(baseTrades),
    early_core_real: summarize(earlyTrades),
  };

  console.log(JSON.stringify(out, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
