"use strict";

// Tests for contractual carry measurement (2026-08-01). The point of this
// module is that its output needs no statistical validation — so the maths
// must be exactly right, including the cost annualization that makes short-
// dated carry look worse than it appears on a raw basis number.

const assert = require("assert");
const { computeBasisCarry, rankCarrySources } = require("../v4/basisCarry");

// ---- basis maths ------------------------------------------------------------
(() => {
  // 1% basis over 73 days => 5%/yr gross (365/73 = 5)
  const c = computeBasisCarry({ spotPrice: 100, futurePrice: 101, daysToExpiry: 73, roundTripCostPct: 0 });
  assert.ok(Math.abs(c.basis_pct - 1) < 1e-9);
  assert.ok(Math.abs(c.annualized_gross_pct - 5) < 1e-6, `gross ${c.annualized_gross_pct}`);
  assert.strictEqual(c.annualized_cost_pct, 0);
  assert.ok(Math.abs(c.annualized_net_pct - 5) < 1e-6);
})();

// ---- costs must be annualized too: short-dated carry is penalised harder ---
(() => {
  // same 0.2% round trip, but over 7 days it annualizes to ~10.4%/yr
  const short = computeBasisCarry({ spotPrice: 100, futurePrice: 100.1, daysToExpiry: 7, roundTripCostPct: 0.2 });
  const long = computeBasisCarry({ spotPrice: 100, futurePrice: 104, daysToExpiry: 365, roundTripCostPct: 0.2 });
  assert.ok(short.annualized_cost_pct > 10, `short-dated cost should annualize large, got ${short.annualized_cost_pct}`);
  assert.ok(Math.abs(long.annualized_cost_pct - 0.2) < 1e-6, "1-year trade pays the cost once");
  // a 0.1% basis over 7 days annualizes to ~5.2% gross but pays ~10.4% of
  // annualized cost — the raw basis looks like yield and is in fact a loss.
  assert.ok(short.annualized_gross_pct > 0 && short.annualized_net_pct < 0,
    "a thin short-dated basis must not masquerade as yield after costs");
  // break-even sanity: basis exactly equal to the round trip nets to zero
  const breakEven = computeBasisCarry({ spotPrice: 100, futurePrice: 100.2, daysToExpiry: 7, roundTripCostPct: 0.2 });
  assert.ok(Math.abs(breakEven.annualized_net_pct) < 1e-6, "basis == cost must net exactly zero");
})();

// ---- backwardation is reported as negative, never silently flipped --------
(() => {
  const c = computeBasisCarry({ spotPrice: 100, futurePrice: 99, daysToExpiry: 90 });
  assert.ok(c.basis_pct < 0 && c.annualized_net_pct < 0,
    "future below spot must read negative — the reverse trade needs borrow and is not implied");
})();

// ---- invalid inputs return null rather than a fabricated yield -------------
(() => {
  assert.strictEqual(computeBasisCarry({ spotPrice: 0, futurePrice: 100, daysToExpiry: 30 }), null);
  assert.strictEqual(computeBasisCarry({ spotPrice: 100, futurePrice: 101, daysToExpiry: 0 }), null);
  assert.strictEqual(computeBasisCarry({ spotPrice: 100, futurePrice: null, daysToExpiry: 30 }), null);
})();

// ---- ranking: today's real numbers must say HOLD_RISK_FREE ----------------
(() => {
  const r = rankCarrySources({
    sources: [
      { kind: "basis", symbol: "BTCUSDT_260925", annualized_net_pct: 3.7 },
      { kind: "funding", symbol: "BTCUSDT", annualized_net_pct: 6.4 },
      { kind: "funding", symbol: "BNBUSDT", annualized_net_pct: 4.8 },
    ],
    riskFreePct: 5,
    minExcessPct: 5,
  });
  assert.strictEqual(r.best.symbol, "BTCUSDT", "highest net carry ranks first");
  assert.ok(Math.abs(r.best.excess_pct - 1.4) < 1e-9, "excess is measured against risk-free");
  assert.strictEqual(r.verdict, "HOLD_RISK_FREE",
    "nothing beats risk-free by the required margin today — doing nothing is the correct output");
  assert.strictEqual(r.deploy_worthy.length, 0);
})();

// ---- ranking: a mania-level funding print flips the verdict ---------------
(() => {
  const r = rankCarrySources({
    sources: [
      { kind: "funding", symbol: "SOLUSDT", annualized_net_pct: 32 },
      { kind: "basis", symbol: "BTCUSDT_261225", annualized_net_pct: 18 },
      { kind: "funding", symbol: "XRPUSDT", annualized_net_pct: 4 },
    ],
    riskFreePct: 5, minExcessPct: 5,
  });
  assert.strictEqual(r.verdict, "CARRY_RICH_REVIEW_DEPLOY");
  assert.deepStrictEqual(r.deploy_worthy.map((s) => s.symbol), ["SOLUSDT", "BTCUSDT_261225"],
    "only sources clearing risk-free + margin are deploy-worthy");
})();

// ---- empty input is HOLD, never a crash or a false opportunity ------------
(() => {
  const r = rankCarrySources({ sources: [] });
  assert.strictEqual(r.verdict, "HOLD_RISK_FREE");
  assert.strictEqual(r.best, null);
})();

console.log("v4-basis-carry.test.js PASS");
