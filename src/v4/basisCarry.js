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
//   sources: [{ kind, symbol, annualized_net_pct, detail }]
//   riskFreePct: the do-nothing benchmark (stablecoin yield)
//   minExcessPct: how much richer a source must be before it is worth the
//     operational risk of running a live delta-neutral book
// Returns sources sorted by excess, plus the deploy verdict.
function rankCarrySources({ sources = [], riskFreePct = 5, minExcessPct = 5 } = {}) {
  const scored = (Array.isArray(sources) ? sources : [])
    .map((s) => {
      const net = num(s && s.annualized_net_pct);
      if (net === null) return null;
      return Object.freeze({ ...s, annualized_net_pct: net, excess_pct: +(net - riskFreePct).toFixed(3) });
    })
    .filter(Boolean)
    .sort((a, b) => b.excess_pct - a.excess_pct);

  const best = scored[0] || null;
  const deployWorthy = scored.filter((s) => s.excess_pct >= minExcessPct);
  return Object.freeze({
    sources: Object.freeze(scored),
    best,
    deploy_worthy: Object.freeze(deployWorthy),
    // The default posture is explicitly "do nothing and hold the risk-free
    // asset" — that is the benchmark every source has to beat, and today it
    // wins.
    verdict: deployWorthy.length ? "CARRY_RICH_REVIEW_DEPLOY" : "HOLD_RISK_FREE",
    risk_free_pct: riskFreePct,
    min_excess_pct: minExcessPct,
  });
}

module.exports = Object.freeze({ computeBasisCarry, rankCarrySources });
