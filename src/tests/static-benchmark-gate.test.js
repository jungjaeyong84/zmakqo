"use strict";

const assert = require("assert");
const { evaluateAgainstStaticBenchmark, neweyWestT } = require("../research/staticBenchmarkGate");

// The case this gate was built from: v8's beta-weighted compression. A book
// that is net short through a falling market posts a positive net return and
// still has no demonstrated skill, because a constant position at the same
// average exposure earns the same thing with no turnover.
{
  // 200 periods, market drifts down, position is constant-ish short with noise
  // that carries NO information about the next return.
  const n = 200;
  const marketReturns = [];
  const positions = [];
  for (let i = 0; i < n; i += 1) {
    marketReturns.push(-0.1 + (i % 7 - 3) * 0.15);      // downward drift + cycle
    positions.push(-0.3 + ((i % 5) - 2) * 0.02);        // short bias, uninformative wiggle
  }
  const r = evaluateAgainstStaticBenchmark({ positions, marketReturns, costPerTurnPct: 0.07, neweyWestLag: 6 });

  assert.ok(r.strategy.netPct > 0, "(A1) the short-biased book is profitable in a falling market");
  assert.ok(r.benchmark.netPct > 0, "(A2) so is a constant position at its average exposure");
  assert.ok(r.meanPosition < 0, "(A3) average exposure is short");
  assert.ok(
    Math.abs(r.decomposition.biasPct) > Math.abs(r.decomposition.timingPct),
    "(A4) the bias term dominates — this is a market call, not timing"
  );
  assert.notStrictEqual(r.verdict, "PASS", "(A5) a profitable book with no edge over its own bias must not PASS");
}

// A book whose position genuinely leads the market must clear both conditions.
{
  const n = 300;
  const marketReturns = [];
  const positions = [];
  for (let i = 0; i < n; i += 1) {
    const r = (i % 2 === 0 ? 1 : -1) * 0.8;
    marketReturns.push(r);
    positions.push(r > 0 ? 1 : -1);   // perfectly anticipates, zero net bias
  }
  const r = evaluateAgainstStaticBenchmark({ positions, marketReturns, costPerTurnPct: 0.01, neweyWestLag: 2 });

  assert.ok(r.excessPct > 0, "(B1) real timing beats the static benchmark");
  assert.ok(Math.abs(r.meanPosition) < 1e-9, "(B2) no directional bias in this book");
  assert.ok(Math.abs(r.decomposition.biasPct) < 1e-9, "(B3) so the bias term contributes nothing");
  assert.strictEqual(r.verdict, "PASS", "(B4) beats benchmark with significant timing => PASS");
}

// Turnover must be charged on |Δposition|, so a flip costs two units, not one.
// v8's original script charged a flat fee per "change", which understated cost.
{
  const marketReturns = [0, 0, 0, 0];
  const positions = [1, -1, 1, -1];
  const r = evaluateAgainstStaticBenchmark({ positions, marketReturns, costPerTurnPct: 0.1, neweyWestLag: 1 });
  // 0->1 (1) + 1->-1 (2) + -1->1 (2) + 1->-1 (2) = 7 units
  assert.strictEqual(r.turnover, 7, "(C1) turnover counts |Δpos|, so flips cost double");
  assert.ok(Math.abs(r.strategy.costPct - 0.7) < 1e-9, "(C2) cost = turnover x per-turn rate");
}

// The benchmark is a real position and pays entry and exit — it is not free.
{
  const marketReturns = new Array(50).fill(0.1);
  const positions = new Array(50).fill(0.5);
  const r = evaluateAgainstStaticBenchmark({ positions, marketReturns, costPerTurnPct: 0.2, neweyWestLag: 4 });
  assert.ok(r.benchmark.costPct > 0, "(D1) the static benchmark is charged for entering");
  assert.ok(Math.abs(r.excessPct) < 1e-9, "(D2) a constant book IS its own benchmark — zero excess");
  assert.strictEqual(r.verdict, "FAIL_BOTH", "(D3) a pure constant position has no timing and no excess");
}

// Newey-West must widen the standard error on an autocorrelated series, which
// is the correction that moved v3's exposure t from 13.19 to 4.98.
{
  const x = [];
  let prev = 0;
  for (let i = 0; i < 400; i += 1) {
    prev = 0.9 * prev + ((i * 2654435761) % 1000) / 1000 - 0.5;  // strongly autocorrelated
    x.push(prev + 0.25);
  }
  const plain = Math.abs(neweyWestT(x, 0));
  const hac = Math.abs(neweyWestT(x, 20));
  assert.ok(hac < plain, "(E1) HAC t must be smaller than the iid t on an autocorrelated series");
}

// Malformed input fails loudly rather than producing a confident wrong number.
{
  assert.throws(
    () => evaluateAgainstStaticBenchmark({ positions: [1, 2], marketReturns: [1, 2, 3] }),
    /TOO_SHORT/,
    "(F1) fewer positions than returns must throw"
  );
  assert.throws(
    () => evaluateAgainstStaticBenchmark({ positions: [1, NaN, 1], marketReturns: [1, 1, 1] }),
    /NON_FINITE/,
    "(F2) NaN must throw instead of silently poisoning comparisons"
  );
}

console.log("STATIC_BENCHMARK_GATE_TESTS_PASS");
