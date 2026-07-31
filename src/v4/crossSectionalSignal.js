"use strict";

// src/v4/crossSectionalSignal.js — v4 cross-sectional momentum (2026-08-01).
//
// A DIFFERENT EDGE CLASS from v3, not a rewrite of it. v3 predicted absolute
// direction on 15m bars; five independent studies showed that edge is ~zero
// after costs. v4 instead ranks symbols AGAINST EACH OTHER on a daily
// horizon and holds long-the-strongest / short-the-weakest — a relative-value,
// market-neutral factor. Research (scripts/analyze-v4-cross-sectional.js):
//   - beats a shuffled-rank control by ~50pp/yr (real information content)
//   - +10.1%/yr (12-symbol) and +3.1%/yr (27-symbol) at maker cost over the
//     common window; both positive in 2026
//   - max drawdown -14..-19% vs -75% for buy&hold (market-neutral helps)
// Honest caveats carried into the build: Sharpe is modest (0.26-0.54), the
// 2024 sign flips between universes, and NOTHING here is forward-validated.
// That is exactly why this ships as a PAPER lane with pre-committed criteria.
//
// This module is pure (no network, no clock, no files) so every number the
// paper lane records is reproducible from the ledger alone.

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function upper(v) { const s = String(v == null ? "" : v).trim(); return s ? s.toUpperCase() : null; }

// Target positions from trailing-return ranks.
//   closesBySymbol: Map|Object of symbol -> array of daily closes (oldest→newest)
//   lookback: trailing window in days
//   kFraction: fraction of the universe held on each leg (default 1/3)
// Returns { positions: {SYM: +1|-1|0}, ranked: [{symbol, momentum}], k, eligible_n }
function computeTargetPositions({ closesBySymbol, lookback = 14, kFraction = 1 / 3 } = {}) {
  const entries = closesBySymbol instanceof Map
    ? [...closesBySymbol.entries()]
    : Object.entries(closesBySymbol || {});

  const ranked = [];
  for (const [sym, closes] of entries) {
    const s = upper(sym);
    if (!s || !Array.isArray(closes) || closes.length < lookback + 1) continue;
    const last = num(closes[closes.length - 1]);
    const past = num(closes[closes.length - 1 - lookback]);
    if (last === null || past === null || past <= 0) continue;
    ranked.push({ symbol: s, momentum: last / past - 1 });
  }
  ranked.sort((a, b) => b.momentum - a.momentum);

  const positions = {};
  for (const r of ranked) positions[r.symbol] = 0;
  // Need at least 2 names per leg for the portfolio to be meaningfully
  // diversified; below that the "factor" is a single-pair bet.
  const k = Math.max(0, Math.floor(ranked.length * kFraction));
  if (k >= 2) {
    ranked.slice(0, k).forEach((r) => { positions[r.symbol] = 1; });
    ranked.slice(-k).forEach((r) => { positions[r.symbol] = -1; });
  }
  return Object.freeze({
    positions: Object.freeze(positions),
    ranked: Object.freeze(ranked),
    k,
    eligible_n: ranked.length,
  });
}

// Realized performance of the positions held since the previous rebalance,
// plus the cost of moving to the new ones.
//   prevPositions / newPositions: {SYM: -1|0|+1}
//   prevPrices / currentPrices:   {SYM: price}
//   costPct: per-unit-of-weight round-trip cost (0.0009 = maker-first 0.09%)
// Weights are equal across the 2k held names, so each name carries
// 1/(2k) of the book. Cost is charged on |Δposition| * weight.
function computePeriodResult({ prevPositions = {}, newPositions = {}, prevPrices = {}, currentPrices = {}, costPct = 0.0009 } = {}) {
  const held = Object.entries(prevPositions).filter(([, p]) => Number(p) !== 0);
  const weight = held.length > 0 ? 1 / held.length : 0;

  let gross = 0;
  let priced = 0;
  for (const [sym, pos] of held) {
    const p0 = num(prevPrices[sym]);
    const p1 = num(currentPrices[sym]);
    if (p0 === null || p1 === null || p0 <= 0) continue;
    gross += Number(pos) * (p1 / p0 - 1) * weight;
    priced += 1;
  }

  // Turnover: total absolute weight traded moving prev -> new. Both sides are
  // normalised by their own leg counts, so a full flip costs ~2x weight.
  const prevHeldN = held.length || 1;
  const newHeld = Object.entries(newPositions).filter(([, p]) => Number(p) !== 0);
  const newHeldN = newHeld.length || 1;
  const syms = new Set([...Object.keys(prevPositions), ...Object.keys(newPositions)]);
  let turnover = 0;
  for (const sym of syms) {
    const before = (Number(prevPositions[sym]) || 0) / prevHeldN;
    const after = (Number(newPositions[sym]) || 0) / newHeldN;
    turnover += Math.abs(after - before);
  }
  const cost = turnover * costPct;

  const round = (v, d = 6) => Math.round(v * 10 ** d) / 10 ** d;
  return Object.freeze({
    gross_return: round(gross),
    cost: round(cost),
    net_return: round(gross - cost),
    turnover: round(turnover, 4),
    priced_symbol_n: priced,
    held_symbol_n: held.length,
  });
}

module.exports = Object.freeze({ computeTargetPositions, computePeriodResult });
