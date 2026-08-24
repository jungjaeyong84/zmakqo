"use strict";

// src/v4/basisCarry.js — contractual carry measurement (2026-08-01).
//
// WHY THIS EXISTS. Three months and 107 configurations of DIRECTIONAL search
// produced nothing that survives multiple-testing correction, and the power
// analysis showed a Sharpe-0.5 strategy needs ~20 years to validate. That is
// the wrong space to search: directional edge is zero-sum and statistical.
//
// Carry is different in kind. When you hold spot and short a dated future,
// the future MUST converge to spot at delivery — arbitrage enforces it — so
// the yield is written in today's contract price. No backtest, no p-value,
// no 20-year horizon. Same for funding: it is a payment received every 8h,
// not a prediction.
//
// The honest system therefore does not predict. It MEASURES every harvestable
// carry against the risk-free alternative and only deploys when a source is
// clearly richer. Today (2026-08-01) it is not: BTC quarterly basis ~4.1%/yr
// and perp funding ~5-7%/yr versus ~5% risk-free, i.e. the market pays almost
// nothing for crypto leverage right now. In a bull mania these run 15-50%.
// This module is what tells the difference, contractually.

function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

// Annualized basis carry of long-spot / short-dated-future held to delivery.
//   spotPrice, futurePrice, daysToExpiry
//   roundTripCostPct: total cost across BOTH legs, in percent (default 0.20%)
// A negative result means the future is in backwardation — the carry trade
// would pay rather than earn (the reverse trade is a different, harder thing
// because it needs borrow, so it is not implied here).
function computeBasisCarry({ spotPrice, futurePrice, daysToExpiry, roundTripCostPct = 0.20 } = {}) {
  const spot = num(spotPrice);
  const fut = num(futurePrice);
  const days = num(daysToExpiry);
  if (spot === null || fut === null || days === null || spot <= 0 || days <= 0) return null;

  const basisPct = (fut / spot - 1) * 100;
  const annualizedGrossPct = basisPct * (365 / days);
  // Costs are paid once over the life of the trade, so annualize them too.
  const annualizedCostPct = roundTripCostPct * (365 / days);
  return Object.freeze({
    basis_pct: +basisPct.toFixed(4),
    days_to_expiry: +days.toFixed(2),
    annualized_gross_pct: +annualizedGrossPct.toFixed(3),
    annualized_cost_pct: +annualizedCostPct.toFixed(3),
    annualized_net_pct: +(annualizedGrossPct - annualizedCostPct).toFixed(3),
  });
}

// Rank every measured carry source against the risk-free alternative.
//
// 2026-08-24 — thresholds re-anchored on the funding study, and capital
// efficiency added. Three things were wrong before:
//
//   1. minExcessPct was 5, picked as a round number. It corresponds to a raw
//      funding APY of about 10.4%, which sits just BELOW the 11% the study
//      validated as the lowest entry that beats doing nothing. So the verdict
//      could fire on carry the research says is not worth taking — and on
//      2026-08-24 it did, at BNB 10.62%.
//   2. The monitor carried a SECOND, unrelated threshold for its `hot` list
//      (raw APY 15%). The two disagreed, so the same artifact said "deploy"
//      while listing nothing as hot. One number now drives both.
//   3. Capital efficiency was ignored entirely. A delta-neutral book needs
//      spot plus perp margin, so holding N notional commits capMult x N of
//      capital while the funding is earned on N alone. Return on the capital
//      actually tied up is net/capMult, not net. At capMult 1.3 that turns
//      BNB's headline +5.22pp excess into +2.86pp — the difference between a
//      compelling number and a marginal one.
//
// Study values (2.7 years, per-symbol funding interval, switching costs
// charged): entry above 11%/yr returns 8.35%/yr and above 22%/yr returns
// 8.61%/yr, against 5% for holding the risk-free asset. Below 11% the excess
// stops covering the operational risk of running the book.
//
//   sources: [{ kind, symbol, annualized_net_pct, detail }]
//   riskFreePct: the do-nothing benchmark (stablecoin yield)
//   floorApyPct / richApyPct: RAW annualized funding, matching the study
//   fundingCostPct: annualized haircut already applied to annualized_net_pct,
//     needed to convert a raw-APY threshold into an excess threshold
//   capitalMultiplier: capital committed per unit of notional held
function rankCarrySources({
  sources = [],
  riskFreePct = 5,
  floorApyPct = 11,
  richApyPct = 22,
  fundingCostPct = 0.4,
  capitalMultiplier = 1.3,
} = {}) {
  const capMult = capitalMultiplier > 0 ? capitalMultiplier : 1;
  // raw APY threshold -> excess threshold, on the same capital-adjusted basis
  const excessFor = (rawApy) => +(((rawApy - fundingCostPct) / capMult) - riskFreePct).toFixed(3);
  const floorExcess = excessFor(floorApyPct);
  const richExcess = excessFor(richApyPct);

  const scored = (Array.isArray(sources) ? sources : [])
    .map((s) => {
      const net = num(s && s.annualized_net_pct);
      if (net === null) return null;
      // Return on capital ACTUALLY committed, which is what competes with the
      // risk-free rate. The headline net is kept alongside so the haircut is
      // visible rather than silently applied.
      const onCapital = +(net / capMult).toFixed(3);
      return Object.freeze({
        ...s,
        annualized_net_pct: net,
        annualized_on_capital_pct: onCapital,
        excess_pct: +(onCapital - riskFreePct).toFixed(3),
        excess_before_capital_pct: +(net - riskFreePct).toFixed(3),
      });
    })
    .filter(Boolean)
    .sort((a, b) => b.excess_pct - a.excess_pct);

  const best = scored[0] || null;
  const deployWorthy = scored.filter((s) => s.excess_pct >= richExcess);
  const watch = scored.filter((s) => s.excess_pct >= floorExcess && s.excess_pct < richExcess);

  // Three states, because the study describes a gradient rather than a switch.
  // MARGINAL is deliberately NOT a deploy signal: it is the band where carry
  // beats doing nothing but not by enough to pay for the operational risk, and
  // conflating it with RICH is what made the 2026-08-24 alert misleading.
  const verdict = deployWorthy.length
    ? "CARRY_RICH_REVIEW_DEPLOY"
    : (watch.length ? "CARRY_MARGINAL_WATCH" : "HOLD_RISK_FREE");

  return Object.freeze({
    sources: Object.freeze(scored),
    best,
    deploy_worthy: Object.freeze(deployWorthy),
    watch: Object.freeze(watch),
    verdict,
    risk_free_pct: riskFreePct,
    capital_multiplier: capMult,
    floor_apy_pct: floorApyPct,
    rich_apy_pct: richApyPct,
    floor_excess_pct: floorExcess,
    rich_excess_pct: richExcess,
    basis: "excess is on capital actually committed (net / capitalMultiplier)",
  });
}

module.exports = Object.freeze({ computeBasisCarry, rankCarrySources });
