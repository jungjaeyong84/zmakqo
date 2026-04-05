"use strict";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function clamp01(v) {
  return clamp(v, 0, 1);
}

function roundTo(v, digits = 6) {
  if (!Number.isFinite(Number(v))) return null;
  const f = 10 ** digits;
  return Math.round(Number(v) * f) / f;
}

function bucketFloor(value, bucketSize) {
  const n = Number(value);
  const size = Number(bucketSize);
  if (!Number.isFinite(n) || !Number.isFinite(size) || size <= 0) return null;
  return roundTo(Math.floor(n / size) * size, 6);
}

function summarizeRows(rows = []) {
  const usable = Array.isArray(rows) ? rows : [];
  const tp1HitN = usable.filter((row) => String(row.outcome || "").toUpperCase() === "TP1_HIT").length;
  const returns = usable
    .map((row) => toNum(row.realized_ret_net))
    .filter((v) => Number.isFinite(v));
  return {
    n: usable.length,
    tp1_hit_n: tp1HitN,
    tp1_hit_rate: usable.length > 0 ? (tp1HitN / usable.length) : null,
    avg_ret_net: returns.length > 0 ? (returns.reduce((sum, v) => sum + v, 0) / returns.length) : null,
  };
}

function buildTp1CalibrationReport(rows = [], options = {}) {
  const bucketSize = clamp(toNum(options.bucketSize) || 0.05, 0.01, 0.25);
  const minBucketSample = Math.max(1, Math.round(toNum(options.minBucketSample) || 8));
  const minGlobalSample = Math.max(minBucketSample, Math.round(toNum(options.minGlobalSample) || 40));
  const applyGapMin = clamp(toNum(options.applyGapMin) || 0.05, 0, 1);
  const priorStrength = Math.max(1, Math.round(toNum(options.priorStrength) || 12));

  const usableRows = (Array.isArray(rows) ? rows : []).filter((row) =>
    row
    && row.resolved_for_tune === true
    && Number.isFinite(toNum(row.lower_bound))
  );
  const globalSummary = summarizeRows(usableRows);
  const globalTp1Rate = clamp01(globalSummary.tp1_hit_rate == null ? 0.5 : globalSummary.tp1_hit_rate);

  const bucketMap = new Map();
  for (const row of usableRows) {
    const key = bucketFloor(row.lower_bound, bucketSize);
    if (!Number.isFinite(key)) continue;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key).push(row);
  }

  const orderedKeys = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const rawBuckets = orderedKeys.map((key) => {
    const summary = summarizeRows(bucketMap.get(key));
    return {
      bucket_min: roundTo(key, 6),
      bucket_max: roundTo(key + bucketSize, 6),
      ...summary,
      expected_lower_bound_mid: roundTo(key + (bucketSize / 2), 6),
      sample_ready: summary.n >= minBucketSample,
    };
  });

  let monotonicityViolations = 0;
  for (let i = 1; i < rawBuckets.length; i += 1) {
    const prev = rawBuckets[i - 1];
    const curr = rawBuckets[i];
    if (prev.sample_ready && curr.sample_ready && curr.tp1_hit_rate != null && prev.tp1_hit_rate != null && curr.tp1_hit_rate + 1e-12 < prev.tp1_hit_rate) {
      monotonicityViolations += 1;
    }
  }

  const bucketRecords = rawBuckets.map((bucket, idx) => {
    let fallback = bucket;
    if (bucket.n < minBucketSample) {
      for (let offset = 1; offset < rawBuckets.length; offset += 1) {
        const left = rawBuckets[idx - offset];
        const right = rawBuckets[idx + offset];
        if (left && left.n >= minBucketSample) {
          fallback = left;
          break;
        }
        if (right && right.n >= minBucketSample) {
          fallback = right;
          break;
        }
      }
    }
    const sampleN = fallback.n;
    const empiricalRate = fallback.tp1_hit_rate == null ? globalTp1Rate : fallback.tp1_hit_rate;
    const posteriorRate = clamp01(((globalTp1Rate * priorStrength) + (empiricalRate * sampleN)) / (priorStrength + sampleN));
    const expectedMid = bucket.expected_lower_bound_mid == null ? posteriorRate : bucket.expected_lower_bound_mid;
    const applyRecommended = globalSummary.n >= minGlobalSample
      && sampleN >= minBucketSample
      && expectedMid - posteriorRate >= applyGapMin;
    return {
      ...bucket,
      calibration_bucket_min: fallback.bucket_min,
      calibration_bucket_max: fallback.bucket_max,
      calibration_source_n: sampleN,
      empirical_tp1_hit_rate: roundTo(empiricalRate, 6),
      posterior_tp1_hit_rate: roundTo(posteriorRate, 6),
      raw_gap_vs_empirical: roundTo(expectedMid - empiricalRate, 6),
      raw_gap_vs_posterior: roundTo(expectedMid - posteriorRate, 6),
      calibration_probability_ceiling: roundTo(posteriorRate, 6),
      calibration_lower_bound_ceiling: roundTo(Math.min(expectedMid, posteriorRate), 6),
      apply_recommended: applyRecommended,
    };
  });

  const applyBucketN = bucketRecords.filter((bucket) => bucket.apply_recommended).length;
  return {
    ok: true,
    summary: {
      resolved_n: globalSummary.n,
      tp1_hit_n: globalSummary.tp1_hit_n,
      tp1_hit_rate: roundTo(globalSummary.tp1_hit_rate, 6),
      avg_ret_net: roundTo(globalSummary.avg_ret_net, 6),
      bucket_size: bucketSize,
      min_bucket_sample: minBucketSample,
      min_global_sample: minGlobalSample,
      monotonicity_violations: monotonicityViolations,
      apply_recommended_bucket_n: applyBucketN,
      recommended_action: applyBucketN > 0 ? "APPLY_EMPIRICAL_CALIBRATION" : "MONITOR",
    },
    buckets: bucketRecords,
  };
}

function findCalibrationBucket(calibrationReport, lowerBound) {
  const lb = toNum(lowerBound);
  if (!Number.isFinite(lb)) return null;
  const report = calibrationReport && calibrationReport.summary ? calibrationReport : null;
  const buckets = report && Array.isArray(report.buckets) ? report.buckets : [];
  return buckets.find((bucket) =>
    Number.isFinite(toNum(bucket.bucket_min))
    && Number.isFinite(toNum(bucket.bucket_max))
    && lb >= Number(bucket.bucket_min)
    && lb < Number(bucket.bucket_max)
  ) || null;
}

function applyTp1ProbabilityCalibration({ probability, lowerBound, calibrationReport } = {}) {
  const rawProbability = toNum(probability);
  const rawLowerBound = toNum(lowerBound);
  const bucket = findCalibrationBucket(calibrationReport, rawLowerBound);
  if (!bucket || bucket.apply_recommended !== true) {
    return {
      applied: false,
      probability: rawProbability,
      lowerBound: rawLowerBound,
      bucket: bucket || null,
    };
  }
  const calibratedProbability = Number.isFinite(rawProbability)
    ? Math.min(rawProbability, clamp01(bucket.calibration_probability_ceiling))
    : rawProbability;
  const calibratedLowerBound = Number.isFinite(rawLowerBound)
    ? Math.min(rawLowerBound, clamp01(bucket.calibration_lower_bound_ceiling))
    : rawLowerBound;
  return {
    applied: true,
    probability: roundTo(calibratedProbability, 6),
    lowerBound: roundTo(calibratedLowerBound, 6),
    bucket,
  };
}

module.exports = {
  buildTp1CalibrationReport,
  applyTp1ProbabilityCalibration,
  __test: {
    summarizeRows,
    findCalibrationBucket,
  },
};
