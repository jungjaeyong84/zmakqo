"use strict";

// src/research/monotonicityGate.js — a large IC can be untradable (2026-09-13).
//
// WHY THIS EXISTS
// ---------------
// xs-reversal-classic-ta was registered on eight classical-TA indicators with
// significant negative cross-sectional IC, measured per timestamp over a full
// year with Newey-West correction. bb_width reached NW-t -6.36. On that
// evidence it looked like the strongest cross-sectional finding this project
// had produced.
//
// It cannot be traded. The quintile profile is non-monotonic: at an 8h horizon,
// after removing market drift, the buckets run -0.0141, +0.0025, -0.0153,
// -0.0090, +0.0257 from lowest factor score to highest — the TOP of the factor
// has the best forward return, while the IC says the bottom should. And the
// Q1-Q5 spread is not significant in either direction (NW-t -0.95).
//
// The reason is structural, not a bug. Spearman IC reads rank agreement across
// the WHOLE cross-section, and most of the mass is in the middle. A long/short
// book only ever holds the extremes. If the relationship inverts in the tails —
// which it does here — the IC and the book point opposite ways.
//
// So IC is not a sufficient screen. This gate is the cheap check that should
// run BEFORE any cost study or book construction: bucket the cross-section,
// look at the shape, and require that the part a book can actually hold carries
// the sign the IC claims.
//
// Three conditions, all required:
//   1. the bucket profile is monotonic (allowing either direction)
//   2. the tail spread is significant under Newey-West
//   3. the tail spread's sign agrees with the IC's
//
// Condition 3 is the one that catches this failure mode. Conditions 1 and 2
// alone would pass a signal whose tails work by accident against its own IC.
//
// Forward returns are demeaned within each timestamp before bucketing, so a
// trending market cannot manufacture a profile — every bucket in a falling
// sample is negative, and the shape is what matters, not the level.

const DEFAULT_T_THRESHOLD = 1.96;

function mean(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

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

function spearman(xs, ys) {
  const n = xs.length;
  if (n < 3) return 0;
  const rank = (arr) => {
    const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const r = new Array(n);
    for (let i = 0; i < idx.length;) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) r[idx[k][1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const m = (n + 1) / 2;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = rx[i] - m;
    const b = ry[i] - m;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / (Math.sqrt(dx * dy) || 1e-12);
}

function isMonotone(values) {
  let dec = true;
  let inc = true;
  for (let i = 0; i < values.length - 1; i += 1) {
    if (!(values[i] > values[i + 1])) dec = false;
    if (!(values[i] < values[i + 1])) inc = false;
  }
  if (dec) return "decreasing";
  if (inc) return "increasing";
  return "none";
}

/**
 * Screen a cross-sectional signal for tradability.
 *
 * panels          one entry per timestamp: { scores, forwardReturns } of equal
 *                 length. scores are the signal; forwardReturns are raw (the
 *                 gate demeans them within each timestamp itself).
 * buckets         quantile buckets, low score first (default 5)
 * neweyWestLag    Bartlett lag for the tail-spread t; use roughly the number of
 *                 timestamps a position is held
 */
function evaluateMonotonicity({
  panels,
  buckets = 5,
  neweyWestLag = 5,
  tThreshold = DEFAULT_T_THRESHOLD,
  label = "signal",
} = {}) {
  if (!Array.isArray(panels)) throw new Error("MONOTONICITY_GATE_REQUIRES_PANELS");
  if (!Number.isInteger(buckets) || buckets < 2) throw new Error("MONOTONICITY_GATE_BAD_BUCKETS");

  const bucketSeries = [];
  for (let q = 0; q < buckets; q += 1) bucketSeries.push([]);
  const spreads = [];
  const ics = [];
  let used = 0;

  for (const panel of panels) {
    const scores = panel && panel.scores;
    const fwd = panel && panel.forwardReturns;
    if (!Array.isArray(scores) || !Array.isArray(fwd) || scores.length !== fwd.length) {
      throw new Error("MONOTONICITY_GATE_PANEL_SHAPE");
    }
    const n = scores.length;
    if (n < buckets * 2) continue;
    if (!scores.every(Number.isFinite) || !fwd.every(Number.isFinite)) {
      throw new Error("MONOTONICITY_GATE_NON_FINITE");
    }

    // Demean within the timestamp: a trending market must not create a profile.
    const mkt = mean(fwd);
    const rows = scores.map((s, i) => ({ s, r: fwd[i] - mkt }));
    rows.sort((a, b) => a.s - b.s);

    const per = Math.floor(n / buckets);
    const means = [];
    for (let q = 0; q < buckets; q += 1) {
      const slice = q < buckets - 1 ? rows.slice(q * per, (q + 1) * per) : rows.slice((buckets - 1) * per);
      const m = mean(slice.map((x) => x.r));
      bucketSeries[q].push(m);
      means.push(m);
    }
    spreads.push(means[0] - means[buckets - 1]);
    ics.push(spearman(rows.map((x) => x.s), rows.map((x) => x.r)));
    used += 1;
  }

  if (used < 30) throw new Error(`MONOTONICITY_GATE_TOO_FEW_PANELS: ${used}`);

  const bucketMeans = bucketSeries.map((b) => mean(b));
  const monotone = isMonotone(bucketMeans);
  // How ordered the profile is, independent of the strict test above.
  const profileIC = spearman(bucketMeans.map((_, i) => i), bucketMeans);

  const icMean = mean(ics);
  const icT = neweyWestT(ics, neweyWestLag);
  const spreadMean = mean(spreads);
  const spreadT = neweyWestT(spreads, neweyWestLag);

  // A negative IC means low scores lead to high returns, so a book that is long
  // the bottom bucket earns (Q1 - QN) > 0. Agreement means the signs oppose.
  const signAgreement =
    (icMean < 0 && spreadMean > 0) || (icMean > 0 && spreadMean < 0);

  const reasons = [];
  if (monotone === "none") {
    reasons.push(
      `bucket profile is not monotonic: [${bucketMeans.map((v) => v.toFixed(4)).join(", ")}] — the middle of the cross-section drives the IC and a long/short book cannot hold it`
    );
  }
  if (Math.abs(spreadT) < tThreshold) {
    reasons.push(
      `tail spread ${spreadMean.toFixed(4)} has NW-t ${spreadT.toFixed(2)}, inside +/-${tThreshold} — the part a book actually holds earns nothing distinguishable from zero`
    );
  }
  if (!signAgreement) {
    reasons.push(
      `IC ${icMean.toFixed(4)} and tail spread ${spreadMean.toFixed(4)} point opposite ways — trading the IC's direction loses in the tails`
    );
  }

  let verdict = "PASS";
  if (reasons.length === 1) {
    verdict = monotone === "none" ? "FAIL_NONMONOTONE" : (!signAgreement ? "FAIL_SIGN" : "FAIL_TAIL");
  } else if (reasons.length > 1) {
    verdict = "FAIL_MULTIPLE";
  }

  return {
    label,
    panels: used,
    buckets,
    bucketMeans,
    monotone,
    profileIC,
    ic: { mean: icMean, neweyWestT: icT },
    tailSpread: { mean: spreadMean, neweyWestT: spreadT },
    signAgreement,
    verdict,
    reasons,
    passed: verdict === "PASS",
  };
}

function formatMonotonicityReport(result) {
  const lines = [];
  lines.push(`[${result.label}] ${result.verdict}`);
  lines.push(`  시점 ${result.panels} · 분위 ${result.buckets}`);
  lines.push(`  분위 프로파일 (낮은 점수 → 높은 점수, 단면평균 제거)`);
  lines.push(`    ${result.bucketMeans.map((v, i) => `Q${i + 1} ${v.toFixed(4)}`).join("  ")}`);
  lines.push(`  단조성 ${result.monotone} (프로파일 IC ${result.profileIC.toFixed(2)})`);
  lines.push(`  횡단면 IC ${result.ic.mean.toFixed(4)} (NW-t ${result.ic.neweyWestT.toFixed(2)})`);
  lines.push(`  꼬리 스프레드 ${result.tailSpread.mean.toFixed(4)} (NW-t ${result.tailSpread.neweyWestT.toFixed(2)})`);
  for (const r of result.reasons) lines.push(`  × ${r}`);
  return lines.join("\n");
}

module.exports = {
  evaluateMonotonicity,
  formatMonotonicityReport,
  neweyWestT,
  spearman,
  isMonotone,
  DEFAULT_T_THRESHOLD,
};
