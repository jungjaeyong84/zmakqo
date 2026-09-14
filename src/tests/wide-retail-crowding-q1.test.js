"use strict";

const assert = require("assert");
const { panelQ1, decide, TOP_N } = require("../../scripts/evaluate-wide-retail-crowding-q1");

// Deterministic noise in [-1, 1), 32-bit safe.
function noise(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

function panel({ n = 250, q1Return = 0, seed = 1 } = {}) {
  const rnd = noise(seed);
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    // score rises with i; oi falls with i, so the top 200 by oi are i < 200
    rows.push({ score: i, oi: 1e9 - i, c0: 100, c1: 100 * (1 + 0.001 * rnd()) });
  }
  const per = Math.floor(TOP_N / 5);
  for (let i = 0; i < per; i += 1) rows[i].c1 = 100 * (1 + q1Return);
  return rows;
}

// (P1) The universe is cut on open interest before prices are looked up. A name
// inside the top 200 that cannot be priced is counted missing, not replaced by
// the 201st name — replacing it is how a delisting disappears from a backtest.
{
  const rows = panel();
  rows[5].c1 = undefined;
  const p = panelQ1(rows);
  assert.strictEqual(p.missing, 1, "(P1) unpriceable name inside the band is counted");
  assert.strictEqual(p.priced, TOP_N - 1, "(P2) and not replaced from outside the band");
}

// (P3) A thin cross-section produces no panel rather than a small one.
assert.strictEqual(panelQ1(panel({ n: TOP_N - 1 })).q1, null, "(P3) fewer than 200 eligible names yields no panel");

// (P4) q1 reads the lowest-score quintile, demeaned.
{
  const p = panelQ1(panel({ q1Return: -0.01 }));
  assert.ok(p.q1 < -0.007, `(P4) q1 ${p.q1}`);
}

function series(n, meanQ1, spread, seed, missing = 0) {
  const rnd = noise(seed);
  return Array.from({ length: n }, (_, i) => ({ ts: i, q1: meanQ1 + spread * rnd(), priced: 200 - missing, missing }));
}

const frozen = { delta: 0.000745, nRequired: 423 };

// (D1) Short of N, no decision.
assert.strictEqual(decide(series(422, -0.01, 0.001, 2), frozen).decision, null, "(D1) no decision before N");

// (D2) A clear effect confirms.
assert.strictEqual(decide(series(423, -0.002, 0.004, 3), frozen).decision, "CONFIRMED", "(D2)");

// (D3) No effect with enough precision rules out the design effect.
assert.strictEqual(decide(series(423, 0, 0.004, 4), frozen).decision, "REJECTED", "(D3)");

// (D4) A confirming series with too many unpriced names cannot confirm.
{
  const out = decide(series(423, -0.002, 0.004, 5, 3), frozen);
  assert.ok(out.missing_share > 0.01, "(D4a) missing share above 1%");
  assert.strictEqual(out.decision, "INCONCLUSIVE", "(D4b) survivorship guard blocks confirmation");
}

// (D5) Only the first N panels count.
{
  const head = series(423, -0.002, 0.004, 6);
  const tail = series(200, 0.05, 0.001, 7);
  assert.strictEqual(decide(head, frozen).nw_t, decide([...head, ...tail], frozen).nw_t, "(D5) later panels ignored");
}

// (D6) The shipped constants are set.
assert.doesNotThrow(() => decide(series(10, 0, 0.001, 8)), "(D6) DELTA and N_REQUIRED are frozen in the file");

console.log("WIDE_RETAIL_CROWDING_Q1_TESTS_PASS");
