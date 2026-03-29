"use strict";

const assert = require("assert");
const { __test } = require("../services/evTp1Probability");

function makeBars({
  count = 12,
  start = 100,
  driftPct = 0.35,
  rangePct = 1.30,
  closeControl = 0.78,
  direction = "LONG",
  adverseEvery = 0,
} = {}) {
  const bars = [];
  let close = start;
  let ts = 1_700_000_000_000;
  for (let i = 0; i < count; i += 1) {
    const sign = (adverseEvery > 0 && i > 0 && i % adverseEvery === 0) ? -1 : 1;
    const drift = driftPct * sign * (direction === "SHORT" ? -1 : 1);
    const open = close;
    close = open * (1 + (drift / 100));
    const center = Math.max(open, close);
    const floor = Math.min(open, close);
    const fullRange = open * (rangePct / 100);
    const high = center + (fullRange * (1 - closeControl));
    const low = floor - (fullRange * closeControl);
    bars.push({
      open,
      high,
      low,
      close,
      bar_close_time_utc_ms: ts,
    });
    ts += 900_000;
  }
  return bars;
}

function run() {
  assert.strictEqual(typeof __test.estimateTp1ReachProbability, "function");

  const strongLong = __test.estimateTp1ReachProbability({
    bars: makeBars({ direction: "LONG", driftPct: 0.50, rangePct: 1.80, closeControl: 0.92, adverseEvery: 0 }),
    dir: "LONG",
    tp1Pct: 3.25,
    slPct: 1.65,
    lookbackBars: 12,
    atrBars: 8,
  });
  assert.strictEqual(strongLong.ok, true);
  assert.ok(strongLong.probability > 0.55, `strongLong.probability=${strongLong.probability}`);
  assert.ok(strongLong.lowerBound > 0.55, `strongLong.lowerBound=${strongLong.lowerBound}`);
  assert.strictEqual(strongLong.policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(strongLong.policy_source, "DEFAULT");

  const weakLong = __test.estimateTp1ReachProbability({
    bars: makeBars({ direction: "LONG", driftPct: 0.05, rangePct: 1.35, closeControl: 0.40, adverseEvery: 2 }),
    dir: "LONG",
    tp1Pct: 3.25,
    slPct: 1.65,
    lookbackBars: 12,
    atrBars: 8,
  });
  assert.strictEqual(weakLong.ok, true);
  assert.ok(weakLong.lowerBound < 0.55, `weakLong.lowerBound=${weakLong.lowerBound}`);

  const strongShort = __test.estimateTp1ReachProbability({
    bars: makeBars({ direction: "SHORT", driftPct: 0.50, rangePct: 1.75, closeControl: 0.92, adverseEvery: 0 }),
    dir: "SHORT",
    tp1Pct: 3.25,
    slPct: 1.65,
    lookbackBars: 12,
    atrBars: 8,
  });
  assert.strictEqual(strongShort.ok, true);
  assert.ok(strongShort.lowerBound > 0.55, `strongShort.lowerBound=${strongShort.lowerBound}`);

  const shortBars = makeBars({ count: 5 });
  const skipped = __test.estimateTp1ReachProbability({
    bars: shortBars,
    dir: "LONG",
    tp1Pct: 3.25,
    slPct: 1.65,
  });
  assert.strictEqual(skipped.ok, false);
  assert.strictEqual(skipped.skipReason, "INSUFFICIENT_BARS");

  const overriddenWeights = __test.resolveTp1ProbabilityWeights({
    target_ease: 2.2,
    wick_safety: -1,
  });
  assert.strictEqual(overriddenWeights.target_ease, 2.2);
  assert.strictEqual(
    overriddenWeights.wick_safety,
    __test.DEFAULT_TP1_COMPONENT_WEIGHTS.wick_safety
  );

  const weightedRun = __test.estimateTp1ReachProbability({
    bars: makeBars({ direction: "LONG", driftPct: 0.45, rangePct: 1.60, closeControl: 0.88, adverseEvery: 0 }),
    dir: "LONG",
    tp1Pct: 3.25,
    slPct: 1.65,
    lookbackBars: 12,
    atrBars: 8,
    componentWeights: {
      target_ease: 2.4,
      chase_safety: 0.5,
    },
  });
  assert.strictEqual(weightedRun.ok, true);
  assert.strictEqual(weightedRun.policy_version, "TP1_WEIGHT_V1_OVERRIDE");
  assert.strictEqual(weightedRun.policy_source, "DIRECT_OVERRIDE");
  assert.strictEqual(weightedRun.componentWeights.target_ease, 2.4);
  assert.strictEqual(weightedRun.componentWeights.chase_safety, 0.5);

  console.log("EV_TP1_PROBABILITY_TEST_OK");
}

run();
