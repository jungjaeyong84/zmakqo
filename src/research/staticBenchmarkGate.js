"use strict";

// src/research/staticBenchmarkGate.js — the control that kills directional bias (2026-09-13).
//
// WHY THIS EXISTS
// ---------------
// v1 through v8 all died the same death: an apparent edge that resolved into
// a directional bet which happened to be right for one quarter. Each time the
// headline number looked fine and the failure was only visible against the
// right control.
//
// v8 is the clean example. Beta-weighted compression cut turnover 5x and
// flipped the book from -5.29% to +5.89% net. It looked like the hypothesis
// had worked. But over the same window a STATIC SHORT at the same average
// exposure — zero turnover, zero decisions — earned +5.95%. The strategy lost
// to doing nothing, and its timing component sat at t = 0.26.
//
// So the standing question for any book is not "did it make money" but
// "did it beat holding its own average exposure constant". A strategy that
// cannot clear that bar has no demonstrated skill: it has a market call.
//
// This same test would have killed v3 (701 short / 392 long into a -20.85%
// BTC quarter) and v4 (92% of return from the day-0 portfolio) years earlier.
//
// TWO CONDITIONS, BOTH REQUIRED
//   1. excess > 0        — beats its own average exposure held constant
//   2. timing t is real  — the variation in position, not its mean, earned it
//
// Condition 2 uses Newey-West, not the plain t. Every overlap-inflated t-stat
// in this project's history (per-bar 4.36 vs portfolio -0.04; exposure 13.19
// vs NW 4.98) came from treating autocorrelated series as iid. The plain t is
// still reported so the gap between them stays visible.

const DEFAULT_T_THRESHOLD = 1.96;

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

// Newey-West t on the mean of x, with Bartlett weights out to `lag`.
// lag=0 reduces to the ordinary iid t.
function neweyWestT(x, lag) {
  const n = x.length;
  if (n < 3) return 0;
  const m = mean(x);
  const d = x.map((v) => v - m);
  let s = d.reduce((acc, v) => acc + v * v, 0) / n;
  const L = Math.max(0, Math.min(Math.floor(lag), n - 1));
  for (let l = 1; l <= L; l += 1) {
    let g = 0;
    for (let i = l; i < n; i += 1) g += d[i] * d[i - l];
    g /= n;
    s += 2 * (1 - l / (L + 1)) * g;
  }
  const se = Math.sqrt(Math.max(s, 1e-12) / n);
  return se > 0 ? m / se : 0;
}

// Compound a series of per-period percent returns and track peak-to-trough.
function compound(returnsPct) {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const r of returnsPct) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = equity / peak - 1;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return { equity, netPct: (equity - 1) * 100, maxDrawdownPct: maxDrawdown * 100 };
}

// Walk a position series against market returns, charging `costPerTurnPct`
// on every unit of |Δposition| (so a flip from -1 to +1 costs two units).
function runBook(positions, marketReturns, costPerTurnPct) {
  const perPeriod = [];
  let grossPct = 0;
  let costPct = 0;
  let turnover = 0;
  let prev = 0;
  for (let i = 0; i < marketReturns.length; i += 1) {
    const pos = positions[i];
    const delta = Math.abs(pos - prev);
    prev = pos;
    turnover += delta;
    const cost = delta * costPerTurnPct;
    costPct += cost;
    grossPct += pos * marketReturns[i];
    perPeriod.push(pos * marketReturns[i] - cost);
  }
  return { perPeriod, grossPct, costPct, turnover, ...compound(perPeriod) };
}

/**
 * Evaluate a book against a static position at its own average exposure.
 *
 * positions      signed target position per period (e.g. -1..+1); length >= marketReturns
 * marketReturns  percent return of the traded instrument per period
 * costPerTurnPct one-way cost in percent, charged on |Δposition|
 * neweyWestLag   Bartlett lag for the timing t (default 24; use ~the number of
 *                periods a position is typically held)
 */
function evaluateAgainstStaticBenchmark({
  positions,
  marketReturns,
  costPerTurnPct = 0.07,
  neweyWestLag = 24,
  tThreshold = DEFAULT_T_THRESHOLD,
  label = "strategy",
} = {}) {
  if (!Array.isArray(positions) || !Array.isArray(marketReturns)) {
    throw new Error("STATIC_BENCHMARK_GATE_REQUIRES_ARRAYS");
  }
  const n = marketReturns.length;
  if (n < 3 || positions.length < n) {
    throw new Error(`STATIC_BENCHMARK_GATE_TOO_SHORT: positions=${positions.length} returns=${n}`);
  }
  if (!positions.slice(0, n).every(Number.isFinite) || !marketReturns.every(Number.isFinite)) {
    throw new Error("STATIC_BENCHMARK_GATE_NON_FINITE");
  }

  const pos = positions.slice(0, n);
  const strategy = runBook(pos, marketReturns, costPerTurnPct);

  // The control: the same average exposure, held from the first period to the
  // last. It pays entry and exit once and makes no decisions in between.
  const meanPosition = mean(pos);
  const benchPositions = new Array(n).fill(meanPosition);
  const benchmark = runBook(benchPositions, marketReturns, costPerTurnPct);

  // Split the book's gross P&L into the part any constant position at the same
  // average would have earned, and the part that came from moving.
  const biasPct = meanPosition * marketReturns.reduce((s, v) => s + v, 0);
  const timingSeries = pos.map((p, i) => (p - meanPosition) * marketReturns[i]);
  const timingPct = timingSeries.reduce((s, v) => s + v, 0);
  const timingT = neweyWestT(timingSeries, neweyWestLag);
  const timingTPlain = neweyWestT(timingSeries, 0);

  const excessPct = strategy.netPct - benchmark.netPct;

  const reasons = [];
  if (excessPct <= 0) {
    reasons.push(
      `net ${strategy.netPct.toFixed(2)}% did not beat a static ${meanPosition.toFixed(3)} position at ${benchmark.netPct.toFixed(2)}% (excess ${excessPct.toFixed(2)}pp)`
    );
  }
  if (Math.abs(timingT) < tThreshold) {
    reasons.push(
      `timing component NW-t ${timingT.toFixed(2)} is inside +/-${tThreshold} — the position's variation earned nothing distinguishable from zero`
    );
  }

  let verdict = "PASS";
  if (excessPct <= 0 && Math.abs(timingT) < tThreshold) verdict = "FAIL_BOTH";
  else if (excessPct <= 0) verdict = "FAIL_BENCHMARK";
  else if (Math.abs(timingT) < tThreshold) verdict = "FAIL_TIMING";

  return {
    label,
    n,
    meanPosition,
    turnover: strategy.turnover,
    costPerTurnPct,
    strategy: {
      grossPct: strategy.grossPct,
      costPct: strategy.costPct,
      netPct: strategy.netPct,
      maxDrawdownPct: strategy.maxDrawdownPct,
    },
    benchmark: {
      position: meanPosition,
      grossPct: benchmark.grossPct,
      costPct: benchmark.costPct,
      netPct: benchmark.netPct,
      maxDrawdownPct: benchmark.maxDrawdownPct,
      turnover: benchmark.turnover,
    },
    excessPct,
    decomposition: {
      biasPct,
      timingPct,
      timingShare: strategy.grossPct !== 0 ? timingPct / strategy.grossPct : 0,
      timingT,
      timingTPlain,
      neweyWestLag,
    },
    verdict,
    reasons,
    passed: verdict === "PASS",
  };
}

function formatGateReport(result) {
  const lines = [];
  lines.push(`[${result.label}] ${result.verdict}`);
  lines.push(`  기간 ${result.n} · 평균 포지션 ${result.meanPosition.toFixed(3)} · 회전 Σ|Δ| ${result.turnover.toFixed(1)}`);
  lines.push(
    `  전략   비용전 ${result.strategy.grossPct.toFixed(2)}%  비용 ${result.strategy.costPct.toFixed(2)}%  비용후 ${result.strategy.netPct.toFixed(2)}%  MDD ${result.strategy.maxDrawdownPct.toFixed(1)}%`
  );
  lines.push(
    `  대조군 고정 ${result.benchmark.position.toFixed(3)}  비용후 ${result.benchmark.netPct.toFixed(2)}%  MDD ${result.benchmark.maxDrawdownPct.toFixed(1)}%`
  );
  lines.push(`  초과   ${result.excessPct >= 0 ? "+" : ""}${result.excessPct.toFixed(2)}pp`);
  lines.push(
    `  분해   편향 ${result.decomposition.biasPct.toFixed(2)}%  타이밍 ${result.decomposition.timingPct.toFixed(2)}% (NW-t ${result.decomposition.timingT.toFixed(2)}, 단순 t ${result.decomposition.timingTPlain.toFixed(2)})`
  );
  for (const r of result.reasons) lines.push(`  × ${r}`);
  return lines.join("\n");
}

module.exports = {
  evaluateAgainstStaticBenchmark,
  formatGateReport,
  neweyWestT,
  compound,
  DEFAULT_T_THRESHOLD,
};
