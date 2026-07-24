"use strict";

// src/v3/fundingMonitor.js — structural-carry opportunity watcher (2026-07-24).
//
// The 2026-07-24 measurement showed perp funding carry is REAL but currently
// thin (3-6% APY gross on the majors). Funding is regime-dependent and runs
// hot (20-50%+ APY) in bull manias — the honest system therefore WATCHES and
// alerts when sustained carry crosses a threshold, instead of deploying
// capital into a cold carry. Delta-neutral execution gets built only after
// the first real alert (v3 lesson: never build execution before the edge is
// observed).
//
// Pure logic here; the runner fetches /fapi/v1/fundingRate history.

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

function resolveAlertApyPct() {
  const raw = num(process.env.V3_FUNDING_ALERT_APY_PCT);
  return raw !== null && raw > 0 ? raw : 15;
}
function resolveWindowDays() {
  const raw = num(process.env.V3_FUNDING_WINDOW_DAYS);
  return raw !== null && raw >= 1 ? raw : 7;
}
function resolveSymbols() {
  const raw = String(process.env.V3_FUNDING_SYMBOLS || "").trim();
  const list = raw ? raw.split(",") : ["BTCUSDT", "ETHUSDT", "BNBUSDT", "DOGEUSDT", "SOLUSDT", "XRPUSDT"];
  return list.map((s) => s.trim().toUpperCase()).filter(Boolean);
}

// rows: [{fundingTime, fundingRate}] — trailing-window annualized APY (%).
// Positive = longs pay shorts = the carry a delta-neutral short-perp collects.
function computeTrailingFundingApy(rows = [], windowDays = 7, nowMs = Date.now()) {
  const cut = nowMs - windowDays * 24 * 3600 * 1000;
  const win = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ t: Number(r.fundingTime), rate: num(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.t) && r.rate !== null && r.t >= cut && r.t <= nowMs);
  if (!win.length) return { apy_pct: null, events: 0, negative_events: 0 };
  const sum = win.reduce((s, r) => s + r.rate, 0);
  return {
    apy_pct: +(sum / windowDays * 365 * 100).toFixed(2),
    events: win.length,
    negative_events: win.filter((r) => r.rate < 0).length,
  };
}

// Which symbols are hot enough to alert on. Sustained = full window of
// events present (8h funding → 3/day; require >= 2.5/day coverage so a
// data gap can't fake an annualized spike).
function decideHotSymbols(perSymbol = {}, { alertApyPct = 15, windowDays = 7 } = {}) {
  const minEvents = Math.floor(windowDays * 2.5);
  const hot = [];
  for (const [sym, m] of Object.entries(perSymbol)) {
    if (!m || m.apy_pct === null) continue;
    if (m.events < minEvents) continue;
    if (m.apy_pct >= alertApyPct) hot.push({ symbol: sym, ...m });
  }
  return hot.sort((a, b) => b.apy_pct - a.apy_pct);
}

module.exports = Object.freeze({
  computeTrailingFundingApy,
  decideHotSymbols,
  resolveAlertApyPct,
  resolveWindowDays,
  resolveSymbols,
});
