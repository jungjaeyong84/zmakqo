"use strict";

// Phase B of the OpenClaw Decision Agent — ML soft-gate.
//
// Responsibility:
//   Given an incoming signal + its model-predicted TP1 probability (usually
//   carried in `features.ai_signal.tp1_probability` or
//   `features._ml_tp1_probability`), return a calibrated soft-gate vote:
//
//     { accept, tp1_probability, calibrated_probability, bucket, source,
//       version_id }
//
//   The vote veto's the entry when the calibrated TP1 probability falls
//   below `OPENCLAW_ML_MIN_TP1_PROB` (default 0.45). It also observes the
//   live inference router's `block_new_entries` flag which the ML serving
//   state may raise when the canary is stale / rolled back.
//
// Calibration source:
//   `ops/daily/best_self_evolution_ev_probability_calibration_latest.json`
//   has `.raw.buckets` — each bucket carries a realized empirical TP1 hit
//   rate for a range of predicted probabilities. The lookup returns the
//   empirical rate for the matching bucket; when `sample_ready: false`
//   we fall back to the raw predicted probability (but mark it unripe).
//
// Safety:
//   - Any missing / malformed calibration → neutral vote (accept=true,
//     calibrated_probability=null, reason="NO_CALIBRATION"). The rule
//     engine still has to approve for the trade to fire.
//   - Router `block_new_entries=true` → veto regardless of bucket.
//   - Every call is synchronous against a cached calibration doc (30s TTL
//     unless `OPENCLAW_ML_CALIBRATION_TTL_MS` overrides).

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_CALIBRATION_PATH = path.join(
  REPO_ROOT,
  "ops",
  "daily",
  "best_self_evolution_ev_probability_calibration_latest.json"
);

const DEFAULT_MIN_TP1_PROB = 0.22;
const DEFAULT_TTL_MS = 30_000;

let calibrationCache = null;
let calibrationCacheLoadedAtMs = 0;

function nowMs() { return Date.now(); }
function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ttlMs() {
  const raw = Number(process.env.OPENCLAW_ML_CALIBRATION_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS;
}

function minTp1Probability() {
  const raw = Number(process.env.OPENCLAW_ML_MIN_TP1_PROB);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return DEFAULT_MIN_TP1_PROB;
}

function resolveCalibrationPath() {
  const explicit = String(process.env.OPENCLAW_ML_CALIBRATION_PATH || "").trim();
  return explicit || DEFAULT_CALIBRATION_PATH;
}

function loadCalibration({ force = false, now = nowMs() } = {}) {
  if (!force && calibrationCache && (now - calibrationCacheLoadedAtMs) < ttlMs()) {
    return calibrationCache;
  }
  const p = resolveCalibrationPath();
  let raw = null;
  let mtimeMs = null;
  try {
    const stats = fs.statSync(p);
    mtimeMs = stats.mtimeMs || (stats.mtime && stats.mtime.getTime && stats.mtime.getTime()) || null;
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    raw = null;
  }
  const rawInner = raw && raw.raw ? raw.raw : raw || {};
  const buckets = Array.isArray(rawInner.buckets) ? rawInner.buckets : [];
  calibrationCache = {
    path: p,
    mtime_ms: mtimeMs,
    generated_at_kst: rawInner.generated_at_kst || (raw && raw.display && raw.display.generated_at_kst) || null,
    buckets: buckets.map((b) => ({
      bucket_min: toNum(b.bucket_min),
      bucket_max: toNum(b.bucket_max),
      n: toNum(b.n),
      tp1_hit_rate: toNum(b.tp1_hit_rate),
      empirical_tp1_hit_rate: toNum(b.empirical_tp1_hit_rate),
      posterior_tp1_hit_rate: toNum(b.posterior_tp1_hit_rate),
      sample_ready: b.sample_ready === true,
    })),
  };
  calibrationCacheLoadedAtMs = now;
  return calibrationCache;
}

function lookupBucket(calibration, predicted) {
  if (!calibration || !Array.isArray(calibration.buckets)) return null;
  const p = toNum(predicted);
  if (p == null) return null;
  for (const b of calibration.buckets) {
    if (!(Number.isFinite(b.bucket_min) && Number.isFinite(b.bucket_max))) continue;
    // Inclusive lower, exclusive upper; last bucket is inclusive both ends.
    if (p >= b.bucket_min && (p < b.bucket_max || (p === 1 && b.bucket_max === 1))) {
      return b;
    }
  }
  return null;
}

function extractPredictedProbability(features = null) {
  const f = features && typeof features === "object" ? features : {};
  const candidates = [
    f._ml_tp1_probability,
    f.ml_tp1_probability,
    f.tp1_probability,
    f._ev_tp1_probability,
    f.ev_tp1_probability,
    f.ai_signal && f.ai_signal.tp1_probability,
  ];
  for (const c of candidates) {
    const n = toNum(c);
    if (n != null) return n;
  }
  return null;
}

function evaluate({ features = null, liveInferenceRouter = null } = {}) {
  const predicted = extractPredictedProbability(features);
  const calibration = loadCalibration();
  const router = liveInferenceRouter && typeof liveInferenceRouter === "object"
    ? liveInferenceRouter
    : null;
  const routerBlock = router && router.block_new_entries === true;
  const threshold = minTp1Probability();

  if (routerBlock) {
    return {
      accept: false,
      tp1_probability: predicted,
      calibrated_probability: null,
      bucket: null,
      threshold,
      router_block_new_entries: true,
      reason: "ML_SERVING_BLOCK_NEW_ENTRIES",
      source: "ROUTER_BLOCK",
      version_id: router && router.active_model_artifact_id ? String(router.active_model_artifact_id) : null,
    };
  }

  if (predicted == null) {
    return {
      accept: true,
      tp1_probability: null,
      calibrated_probability: null,
      bucket: null,
      threshold,
      router_block_new_entries: false,
      reason: "NO_PREDICTED_PROBABILITY",
      source: "NEUTRAL",
      version_id: router && router.active_model_artifact_id ? String(router.active_model_artifact_id) : null,
    };
  }

  const bucket = lookupBucket(calibration, predicted);
  const calibrated = bucket && bucket.sample_ready === true && Number.isFinite(bucket.empirical_tp1_hit_rate)
    ? bucket.empirical_tp1_hit_rate
    : bucket && Number.isFinite(bucket.posterior_tp1_hit_rate)
      ? bucket.posterior_tp1_hit_rate
      : predicted;
  const accept = calibrated >= threshold;

  return {
    accept,
    tp1_probability: predicted,
    calibrated_probability: calibrated,
    bucket: bucket
      ? {
          bucket_min: bucket.bucket_min,
          bucket_max: bucket.bucket_max,
          n: bucket.n,
          sample_ready: bucket.sample_ready === true,
          empirical_tp1_hit_rate: bucket.empirical_tp1_hit_rate,
          posterior_tp1_hit_rate: bucket.posterior_tp1_hit_rate,
        }
      : null,
    threshold,
    router_block_new_entries: false,
    reason: accept ? "ML_SOFT_GATE_PASS" : "ML_LOW_TP1_PROB",
    source: bucket && bucket.sample_ready ? "EV_CALIBRATION_EMPIRICAL"
      : bucket ? "EV_CALIBRATION_POSTERIOR"
      : "EV_CALIBRATION_RAW",
    version_id: router && router.active_model_artifact_id ? String(router.active_model_artifact_id) : null,
  };
}

function resetCacheForTest() {
  calibrationCache = null;
  calibrationCacheLoadedAtMs = 0;
}

module.exports = {
  DEFAULT_MIN_TP1_PROB,
  DEFAULT_TTL_MS,
  evaluate,
  extractPredictedProbability,
  lookupBucket,
  loadCalibration,
  minTp1Probability,
  resolveCalibrationPath,
  __test: {
    resetCacheForTest,
  },
};
