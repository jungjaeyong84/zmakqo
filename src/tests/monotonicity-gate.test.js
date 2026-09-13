"use strict";

const assert = require("assert");
const { evaluateMonotonicity, isMonotone, spearman } = require("../research/monotonicityGate");

// Deterministic pseudo-random so the suite never flaps.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// The case this gate was built from: xs-reversal-classic-ta. A strong negative
// cross-sectional IC whose tails invert, so a long/short book trades the wrong
// way while the IC looks excellent. The middle of the distribution carries the
// rank agreement; the extremes do not.
// Constructed, not tuned. 25 names ranked 0..24. The first 23 fall steadily
// with the score, so 23 of 25 follow a downward slope and Spearman stays
// clearly negative. Only the top TWO are lifted, which is too few to move the
// rank correlation but enough to pull the fifth bucket's MEAN above the first.
// That is the shape bb_width actually has: IC -0.0513 at NW-t -5.96 with a Q5
// mean of +0.0211.
{
  const rand = rng(11);
  const panels = [];
  for (let t = 0; t < 300; t += 1) {
    const scores = [];
    const forwardReturns = [];
    for (let i = 0; i < 25; i += 1) {
      scores.push(i);
      const base = i < 23 ? -0.01 * i : 0.30;
      forwardReturns.push(base + (rand() - 0.5) * 0.02);
    }
    panels.push({ scores, forwardReturns });
  }
  const r = evaluateMonotonicity({ panels, buckets: 5, neweyWestLag: 3, label: "inverted-tails" });

  assert.ok(r.ic.mean < 0, "(A1) the middle produces a negative cross-sectional IC");
  assert.ok(r.tailSpread.mean < 0, "(A2) but the tail spread is negative too");
  assert.strictEqual(r.signAgreement, false, "(A3) IC and tail spread disagree");
  assert.notStrictEqual(r.verdict, "PASS", "(A4) a signal whose tails oppose its IC must not pass");
  assert.ok(
    r.reasons.some((x) => x.includes("opposite ways")),
    "(A5) and the report must name the disagreement, not just fail quietly"
  );
}

// A genuinely monotonic signal with a real tail spread clears all three.
{
  const rand = rng(23);
  const panels = [];
  for (let t = 0; t < 300; t += 1) {
    const scores = [];
    const forwardReturns = [];
    for (let i = 0; i < 25; i += 1) {
      const s = rand();
      scores.push(s);
      forwardReturns.push(-1.2 * (s - 0.5) + (rand() - 0.5) * 0.25);
    }
    panels.push({ scores, forwardReturns });
  }
  const r = evaluateMonotonicity({ panels, buckets: 5, neweyWestLag: 3, label: "clean-reversal" });

  assert.strictEqual(r.monotone, "decreasing", "(B1) low score → high return reads as a decreasing profile");
  assert.ok(r.ic.mean < 0, "(B2) with a negative IC");
  assert.ok(r.tailSpread.mean > 0, "(B3) and a positive long-bottom / short-top spread");
  assert.strictEqual(r.signAgreement, true, "(B4) the two agree");
  assert.strictEqual(r.verdict, "PASS", "(B5) monotonic + significant + agreeing => PASS");
}

// Pure noise fails on the tail-significance condition rather than passing by luck.
{
  const rand = rng(37);
  const panels = [];
  for (let t = 0; t < 300; t += 1) {
    const scores = [];
    const forwardReturns = [];
    for (let i = 0; i < 25; i += 1) {
      scores.push(rand());
      forwardReturns.push((rand() - 0.5) * 2);
    }
    panels.push({ scores, forwardReturns });
  }
  const r = evaluateMonotonicity({ panels, buckets: 5, neweyWestLag: 3, label: "noise" });
  assert.notStrictEqual(r.verdict, "PASS", "(C1) noise must not pass");
  assert.ok(Math.abs(r.tailSpread.neweyWestT) < 1.96, "(C2) its tail spread is not significant");
}

// Market drift must not manufacture a profile. Every bucket in a falling sample
// is negative; only the SHAPE is evidence, so the gate demeans per timestamp.
{
  const rand = rng(53);
  const panels = [];
  for (let t = 0; t < 300; t += 1) {
    const drift = -5;                       // everything falls hard
    const scores = [];
    const forwardReturns = [];
    for (let i = 0; i < 25; i += 1) {
      scores.push(rand());
      forwardReturns.push(drift + (rand() - 0.5) * 0.5);
    }
    panels.push({ scores, forwardReturns });
  }
  const r = evaluateMonotonicity({ panels, buckets: 5, neweyWestLag: 3, label: "drift-only" });
  const maxAbs = Math.max(...r.bucketMeans.map((v) => Math.abs(v)));
  assert.ok(maxAbs < 0.2, "(D1) a common drift is removed, so buckets sit near zero");
  assert.notStrictEqual(r.verdict, "PASS", "(D2) drift alone is not a signal");
}

// Monotonicity helper, both directions and the flat case.
{
  assert.strictEqual(isMonotone([3, 2, 1, 0]), "decreasing", "(E1)");
  assert.strictEqual(isMonotone([0, 1, 2, 3]), "increasing", "(E2)");
  assert.strictEqual(isMonotone([0, 2, 1, 3]), "none", "(E3) a dip in the middle is not monotonic");
  assert.strictEqual(isMonotone([1, 1, 1]), "none", "(E4) flat is not monotonic either");
  assert.ok(spearman([1, 2, 3], [3, 2, 1]) < -0.99, "(E5) spearman sign");
}

// Malformed input fails loudly rather than returning a confident verdict.
{
  assert.throws(() => evaluateMonotonicity({ panels: null }), /REQUIRES_PANELS/, "(F1)");
  assert.throws(
    () => evaluateMonotonicity({ panels: [{ scores: [1, 2], forwardReturns: [1] }] }),
    /PANEL_SHAPE/,
    "(F2) mismatched lengths throw"
  );
  const tiny = [];
  for (let t = 0; t < 5; t += 1) {
    tiny.push({ scores: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], forwardReturns: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] });
  }
  assert.throws(() => evaluateMonotonicity({ panels: tiny }), /TOO_FEW_PANELS/, "(F3) too few timestamps throw");
  assert.throws(
    () => evaluateMonotonicity({ panels: [{ scores: [1, 2], forwardReturns: [1, 2] }], buckets: 1 }),
    /BAD_BUCKETS/,
    "(F4) fewer than two buckets is meaningless"
  );
}

console.log("MONOTONICITY_GATE_TESTS_PASS");
