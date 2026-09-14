"use strict";

const assert = require("assert");
const { bookedNets, decide, MU_BT } = require("../../scripts/evaluate-v7-forward-futility");

const PERIOD_MS = 4 * 3600e3;
const T0 = 1786896000000;

// Deterministic noise in [-1, 1). mulberry32 stays inside 32-bit arithmetic —
// an earlier hand-rolled LCG in this project overflowed 2^53 and quietly
// produced a non-random stream.
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

// Ledger rows with net_pct in percent, as the v7 cycle writes them.
function rows(n, meanPct, spreadPct, seed, startIndex = 0) {
  const rnd = noise(seed);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ ts: T0 + (startIndex + i) * PERIOD_MS, prior_gross_pct: 0, net_pct: meanPct + spreadPct * rnd() });
  }
  return out;
}

// (M1) The frozen backtest edge is 85.3%/yr compounded over 2190 4h periods.
assert.ok(Math.abs(MU_BT * 100 - 0.02817) < 0.0001, `(M1) mu_bt ${MU_BT * 100}`);

// (S1) Short of the look, no decision and no statistic leaks out.
{
  const out = decide({ booked: bookedNets(rows(399, -1, 0.1, 1)), look: 1 });
  assert.strictEqual(out.decision, null, "(S1) no decision before n");
  assert.ok(!("z_vs_backtest_nw" in out), "(S2) the statistic is withheld before n");
}

// (R1) Forward mean far below the backtest edge is rejected at look 1.
{
  const out = decide({ booked: bookedNets(rows(400, -0.05, 0.3, 2)), look: 1 });
  assert.strictEqual(out.decision, "REJECTED", `(R1) got ${out.decision} z=${out.z_vs_backtest_nw}`);
}

// (I1) Forward mean equal to the backtest edge is not rejected.
{
  const out = decide({ booked: bookedNets(rows(400, MU_BT * 100, 0.3, 3)), look: 1 });
  assert.strictEqual(out.decision, "INCONCLUSIVE", `(I1) got ${out.decision} z=${out.z_vs_backtest_nw}`);
}

// (C1) Look 1 never confirms, however strong the series.
// (C2) Look 2 does.
{
  const strong = bookedNets(rows(800, 0.2, 0.3, 4));
  assert.strictEqual(decide({ booked: strong, look: 1 }).decision, "INCONCLUSIVE", "(C1) no confirmation at look 1");
  assert.strictEqual(decide({ booked: strong, look: 2 }).decision, "CONFIRMED", "(C2) confirmation at look 2");
}

// (W1) Only the first n booked rows count. Appending a disastrous tail after
// the look must not change the look's answer — otherwise the look is not fixed.
{
  const first = rows(400, MU_BT * 100, 0.3, 5);
  const tail = rows(300, -1, 0.1, 6, 400);
  const a = decide({ booked: bookedNets(first), look: 1 });
  const b = decide({ booked: bookedNets([...first, ...tail]), look: 1 });
  assert.strictEqual(a.z_vs_backtest_nw, b.z_vs_backtest_nw, "(W1) later rows are ignored");
  assert.strictEqual(b.last_ts, new Date(T0 + 399 * PERIOD_MS).toISOString(), "(W2) window ends at row 400");
}

// (B1) Unbooked rows are skipped, not counted as zero returns.
{
  const r = rows(5, 0.1, 0, 7);
  r[2] = { ...r[2], prior_gross_pct: null, net_pct: 0 };
  assert.strictEqual(bookedNets(r).length, 4, "(B1) unbooked row skipped");
}

// (L1) A ledger that is out of order or off the 4h grid is refused rather than
// evaluated.
{
  const r = rows(3, 0, 0, 8);
  assert.throws(() => bookedNets([r[1], r[0]]), /NOT_INCREASING/, "(L1) out of order");
  assert.throws(() => bookedNets([{ ...r[0], ts: r[0].ts + 1 }]), /OFF_GRID/, "(L2) off grid");
}

console.log("V7_FORWARD_FUTILITY_TESTS_PASS");
