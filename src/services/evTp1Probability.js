"use strict";

const fs = require("fs");
const path = require("path");
const {
  buildEntryMicroSnapshotFromBars,
  normalizeBar: normalizeEntryMicroBar,
} = require("../utils/entryMicroSnapshot");
const {
  applyTp1ProbabilityCalibration,
} = require("../utils/evTp1ProbabilityCalibration");

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

const DEFAULT_TP1_COMPONENT_WEIGHTS = Object.freeze({
  target_ease: 1.55,
  stop_room: 0.85,
  momentum_alignment: 1.25,
  close_control: 0.95,
  body_support: 0.80,
  wick_safety: 1.05,
  chase_safety: 1.30,
  reversal_safety: 0.95,
  impulse_freshness: 0.70,
});

const DEFAULT_CALIBRATION_PATH = path.join(process.cwd(), "ops", "daily", "best_self_evolution_ev_probability_calibration_latest.json");
let calibrationCache = {
  path: null,
  mtimeMs: null,
  report: null,
};

function sanitizeWeight(rawWeight, fallback) {
  const parsed = toNum(rawWeight);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return clamp(parsed, 0.05, 5.0);
}

function parseWeightsOverride(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === "object") ? parsed : null;
    } catch (_) {
      return null;
    }
  }
  return (typeof raw === "object") ? raw : null;
}

function resolveTp1ProbabilityWeights(rawOverride = null) {
  const merged = { ...DEFAULT_TP1_COMPONENT_WEIGHTS };
  const envOverride = parseWeightsOverride(process.env.EV_TP1_COMPONENT_WEIGHTS_JSON || null);
  const directOverride = parseWeightsOverride(rawOverride);
  for (const override of [envOverride, directOverride]) {
    if (!override) continue;
    for (const key of Object.keys(DEFAULT_TP1_COMPONENT_WEIGHTS)) {
      if (Object.prototype.hasOwnProperty.call(override, key)) {
        merged[key] = sanitizeWeight(override[key], merged[key]);
      }
    }
  }
  return merged;
}

function hasRecognizedWeightOverride(rawOverride) {
  const parsed = parseWeightsOverride(rawOverride);
  if (!parsed) return false;
  return Object.keys(DEFAULT_TP1_COMPONENT_WEIGHTS).some((key) =>
    Object.prototype.hasOwnProperty.call(parsed, key)
  );
}

function resolveTp1ProbabilityPolicySource(rawOverride = null) {
  if (hasRecognizedWeightOverride(rawOverride)) return "DIRECT_OVERRIDE";
  if (hasRecognizedWeightOverride(process.env.EV_TP1_COMPONENT_WEIGHTS_JSON || null)) return "ENV_OVERRIDE";
  return "DEFAULT";
}

function readCalibrationArtifact(calibrationPath = DEFAULT_CALIBRATION_PATH) {
  try {
    if (!calibrationPath || !fs.existsSync(calibrationPath)) return null;
    const stat = fs.statSync(calibrationPath);
    if (calibrationCache.path === calibrationPath && calibrationCache.mtimeMs === Number(stat.mtimeMs || 0)) {
      return calibrationCache.report;
    }
    const parsed = JSON.parse(fs.readFileSync(calibrationPath, "utf8"));
    const report = parsed && parsed.raw ? parsed.raw : parsed;
    calibrationCache = {
      path: calibrationPath,
      mtimeMs: Number(stat.mtimeMs || 0),
      report,
    };
    return report;
  } catch (_) {
    return null;
  }
}

function shouldUseCalibrationArtifact() {
  const raw = String(process.env.EV_TP1_PROBABILITY_CALIBRATION_ENABLED || "1").trim().toUpperCase();
  return raw !== "0" && raw !== "FALSE" && raw !== "OFF";
}

function sigmoid(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 0.5;
  if (n >= 40) return 1;
  if (n <= -40) return 0;
  return 1 / (1 + Math.exp(-n));
}

function normalizeBar(raw) {
  if (!raw || typeof raw !== "object") return null;
  const open = toNum(raw.open ?? raw.o);
  const high = toNum(raw.high ?? raw.h);
  const low = toNum(raw.low ?? raw.l);
  const close = toNum(raw.close ?? raw.c);
  const volume = toNum(raw.volume ?? raw.v);
  const timestamp = toNum(raw.closeTimeUtcMs ?? raw.bar_close_time_utc_ms ?? raw.timestamp ?? raw.t);
  if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close) || !Number.isFinite(timestamp)) {
    return null;
  }
  return { open, high, low, close, volume, timestamp };
}

function directionalMovePct(fromClose, toClose, dir) {
  const from = toNum(fromClose);
  const to = toNum(toClose);
  if (!Number.isFinite(from) || from <= 0 || !Number.isFinite(to) || to <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    return ((from - to) / from) * 100;
  }
  return ((to - from) / from) * 100;
}

function trueRangePct(curr, prevClose) {
  if (!curr || !Number.isFinite(curr.high) || !Number.isFinite(curr.low)) return null;
  const prev = toNum(prevClose);
  const ref = Number.isFinite(prev) && prev > 0 ? prev : curr.close;
  if (!Number.isFinite(ref) || ref <= 0) return null;
  const tr = Math.max(
    curr.high - curr.low,
    Math.abs(curr.high - ref),
    Math.abs(curr.low - ref)
  );
  return (tr / ref) * 100;
}

function computeDirectionalStreak(bars, dir) {
  let sameDirStreak = 0;
  let counterDirBars = 0;
  for (let i = bars.length - 1; i >= 1; i -= 1) {
    const prev = bars[i - 1];
    const curr = bars[i];
    const move = directionalMovePct(prev.close, curr.close, dir);
    if (!Number.isFinite(move)) break;
    if (move > 0) sameDirStreak += 1;
    else break;
  }
  const recent = bars.slice(-4);
  for (let i = 1; i < recent.length; i += 1) {
    const move = directionalMovePct(recent[i - 1].close, recent[i].close, dir);
    if (Number.isFinite(move) && move <= 0) counterDirBars += 1;
  }
  return { sameDirStreak, counterDirBars };
}

function closeControlRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    return clamp01((bar.high - bar.close) / range);
  }
  return clamp01((bar.close - bar.low) / range);
}

function oppositeWickRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  if (String(dir || "").toUpperCase() === "SHORT") {
    const wick = Math.max(0, bar.high - Math.max(bar.open, bar.close));
    return clamp01(wick / range);
  }
  const wick = Math.max(0, Math.min(bar.open, bar.close) - bar.low);
  return clamp01(wick / range);
}

function directionalBodyRatio(bar, dir) {
  if (!bar) return null;
  const range = bar.high - bar.low;
  if (!Number.isFinite(range) || range <= 0) return null;
  const body = String(dir || "").toUpperCase() === "SHORT"
    ? (bar.open - bar.close)
    : (bar.close - bar.open);
  return body / range;
}

function weightedMean(items) {
  const rows = (items || []).filter((x) => Number.isFinite(Number(x.weight)) && Number.isFinite(Number(x.value)));
  if (!rows.length) return null;
  let sumW = 0;
  let sumWV = 0;
  for (const row of rows) {
    const w = Number(row.weight);
    const v = Number(row.value);
    sumW += w;
    sumWV += (w * v);
  }
  if (!Number.isFinite(sumW) || sumW <= 0) return null;
  return sumWV / sumW;
}

function weightedVariance(items, mean) {
  const rows = (items || []).filter((x) => Number.isFinite(Number(x.weight)) && Number.isFinite(Number(x.value)));
  if (!rows.length || !Number.isFinite(mean)) return null;
  let sumW = 0;
  let sumSq = 0;
  for (const row of rows) {
    const w = Number(row.weight);
    const v = Number(row.value);
    sumW += w;
    sumSq += (w * ((v - mean) ** 2));
  }
  if (!Number.isFinite(sumW) || sumW <= 0) return null;
  return sumSq / sumW;
}

function kishEffectiveN(items) {
  const rows = (items || []).filter((x) => Number.isFinite(Number(x.weight)) && Number(x.weight) > 0);
  if (!rows.length) return null;
  let sumW = 0;
  let sumW2 = 0;
  for (const row of rows) {
    const w = Number(row.weight);
    sumW += w;
    sumW2 += (w * w);
  }
  if (!Number.isFinite(sumW) || !Number.isFinite(sumW2) || sumW <= 0 || sumW2 <= 0) return null;
  return (sumW * sumW) / sumW2;
}

function summarizeWeightedEstimate(components, confidenceZ) {
  const mean = weightedMean(components);
  const variance = weightedVariance(components, mean);
  const effectiveN = kishEffectiveN(components);
  if (!Number.isFinite(mean) || !Number.isFinite(variance) || !Number.isFinite(effectiveN) || effectiveN <= 0) {
    return null;
  }
  const stderr = Math.sqrt(Math.max(variance, 0) / effectiveN);
  const lowerBound = clamp01(mean - (Number(confidenceZ) * stderr));
  return {
    mean: clamp01(mean),
    variance,
    stderr,
    effectiveN,
    lowerBound,
  };
}

function estimateTp1ReachProbability({
  bars,
  dir,
  tp0Pct = 0.8,
  tp1Pct,
  slPct,
  tp0QtyRatio = null,
  tp1QtyRatio = null,
  runnerMinProfitPct = null,
  barCloseMs = null,
  lookbackBars = 12,
  atrBars = 8,
  confidenceZ = 1.2815515655446004,
  componentWeights = null,
  calibrationReport = null,
} = {}) {
  const direction = String(dir || "").toUpperCase();
  if (direction !== "LONG" && direction !== "SHORT") {
    return { ok: false, skipReason: "BAD_DIR" };
  }
  const micro = buildEntryMicroSnapshotFromBars({
    bars,
    dir: direction,
    barCloseMs,
    lookbackBars,
    atrBars,
  });
  if (!micro || micro.ok !== true) {
    return {
      ok: false,
      skipReason: micro && micro.skipReason ? micro.skipReason : "MODEL_INVALID",
      barsSeen: micro && micro.barsSeen != null ? micro.barsSeen : null,
    };
  }
  const atrPct = Number(micro.atrPct);
  const recentMove3Pct = Number.isFinite(Number(micro.recentMove3Pct)) ? Number(micro.recentMove3Pct) : null;
  const recentMove1Pct = Number.isFinite(Number(micro.recentMove1Pct)) ? Number(micro.recentMove1Pct) : null;
  const chaseRatio = Number.isFinite(Number(micro.chaseRatio)) ? Number(micro.chaseRatio) : null;
  const tp0TargetAtr = Number.isFinite(tp0Pct) && tp0Pct > 0 ? (tp0Pct / atrPct) : null;
  const targetAtr = Number.isFinite(tp1Pct) && tp1Pct > 0 ? (tp1Pct / atrPct) : null;
  const stopAtr = Number.isFinite(slPct) && slPct > 0 ? (slPct / atrPct) : null;
  const sameDirStreak = Number.isFinite(Number(micro.sameDirStreak)) ? Number(micro.sameDirStreak) : null;
  const counterDirBars = Number.isFinite(Number(micro.counterDirBars)) ? Number(micro.counterDirBars) : null;
  const avgCloseControl = Number.isFinite(Number(micro.avgCloseControl)) ? Number(micro.avgCloseControl) : null;
  const avgOppWick = Number.isFinite(Number(micro.avgOppWick)) ? Number(micro.avgOppWick) : null;
  const avgDirBody = Number.isFinite(Number(micro.avgDirBody)) ? Number(micro.avgDirBody) : null;
  const lastCloseControl = Number.isFinite(Number(micro.lastCloseControl)) ? Number(micro.lastCloseControl) : null;
  const lastOppWick = Number.isFinite(Number(micro.lastOppWick)) ? Number(micro.lastOppWick) : null;
  const lastDirBody = Number.isFinite(Number(micro.lastDirBody)) ? Number(micro.lastDirBody) : null;
  const prevCloseControl = Number.isFinite(Number(micro.prevCloseControl)) ? Number(micro.prevCloseControl) : null;
  const prevOppWick = Number.isFinite(Number(micro.prevOppWick)) ? Number(micro.prevOppWick) : null;
  const prevDirBody = Number.isFinite(Number(micro.prevDirBody)) ? Number(micro.prevDirBody) : null;
  const weights = resolveTp1ProbabilityWeights(componentWeights);
  const policySource = resolveTp1ProbabilityPolicySource(componentWeights);
  const policyVersion = policySource === "DEFAULT" ? "TP1_WEIGHT_V1" : "TP1_WEIGHT_V1_OVERRIDE";
  const canonicalPolicyVersion = policySource === "DEFAULT" ? "EV_COMPOSITE_EXIT_VALUE_V1" : "EV_COMPOSITE_EXIT_VALUE_V1_OVERRIDE";
  const sharedComponentValues = {
    stop_room: sigmoid((Number(stopAtr || 0) - 0.90) * 1.15),
    momentum_alignment: sigmoid(((Number(recentMove3Pct || 0) / atrPct) - 0.55) * 1.25),
    close_control: clamp01(avgCloseControl),
    body_support: sigmoid(((Number(avgDirBody || 0)) - 0.10) * 4.50),
    wick_safety: 1 - sigmoid(((Number(avgOppWick || 0.5)) - 0.24) * 7.00),
    chase_safety: 1 - sigmoid(((Number(chaseRatio || 0)) - 1.55) * 1.90),
    reversal_safety: 1 - clamp01(counterDirBars / 3),
    impulse_freshness: 1 - sigmoid(((Number(recentMove1Pct || 0) / atrPct) - 1.10) * 1.50),
  };
  const tp1Components = [
    {
      key: "target_ease",
      weight: weights.target_ease,
      value: sigmoid((2.60 - Number(targetAtr || 99)) * 1.30),
    },
    {
      key: "stop_room",
      weight: weights.stop_room,
      value: sharedComponentValues.stop_room,
    },
    {
      key: "momentum_alignment",
      weight: weights.momentum_alignment,
      value: sharedComponentValues.momentum_alignment,
    },
    {
      key: "close_control",
      weight: weights.close_control,
      value: sharedComponentValues.close_control,
    },
    {
      key: "body_support",
      weight: weights.body_support,
      value: sharedComponentValues.body_support,
    },
    {
      key: "wick_safety",
      weight: weights.wick_safety,
      value: sharedComponentValues.wick_safety,
    },
    {
      key: "chase_safety",
      weight: weights.chase_safety,
      value: sharedComponentValues.chase_safety,
    },
    {
      key: "reversal_safety",
      weight: weights.reversal_safety,
      value: sharedComponentValues.reversal_safety,
    },
    {
      key: "impulse_freshness",
      weight: weights.impulse_freshness,
      value: sharedComponentValues.impulse_freshness,
    },
  ].map((x) => ({ ...x, value: clamp01(x.value) }));
  const tp1Stats = summarizeWeightedEstimate(tp1Components, confidenceZ);
  if (!tp1Stats) {
    return { ok: false, skipReason: "MODEL_INVALID", barsSeen: micro.barsSeen };
  }

  const calibration = applyTp1ProbabilityCalibration({
    probability: tp1Stats.mean,
    lowerBound: tp1Stats.lowerBound,
    calibrationReport: calibrationReport || (shouldUseCalibrationArtifact() ? readCalibrationArtifact() : null),
  });
  const calibratedProbability = Number.isFinite(calibration.probability) ? calibration.probability : tp1Stats.mean;
  const calibratedLowerBound = Number.isFinite(calibration.lowerBound) ? calibration.lowerBound : tp1Stats.lowerBound;

  const tp0Qty = Number.isFinite(Number(tp0QtyRatio)) ? clamp01(Number(tp0QtyRatio)) : 0.25;
  const tp1Qty = Number.isFinite(Number(tp1QtyRatio)) ? clamp01(Number(tp1QtyRatio)) : 0.50;
  const runnerQty = clamp01(1 - tp0Qty - tp1Qty);
  const tp0Components = Number.isFinite(tp0TargetAtr) ? [
    {
      key: "target_ease",
      weight: weights.target_ease,
      value: sigmoid((1.45 - Number(tp0TargetAtr || 99)) * 1.45),
    },
    { key: "stop_room", weight: weights.stop_room, value: sharedComponentValues.stop_room },
    { key: "momentum_alignment", weight: weights.momentum_alignment, value: sharedComponentValues.momentum_alignment },
    { key: "close_control", weight: weights.close_control, value: sharedComponentValues.close_control },
    { key: "body_support", weight: weights.body_support, value: sharedComponentValues.body_support },
    { key: "wick_safety", weight: weights.wick_safety, value: sharedComponentValues.wick_safety },
    { key: "chase_safety", weight: weights.chase_safety, value: sharedComponentValues.chase_safety },
    { key: "reversal_safety", weight: weights.reversal_safety, value: sharedComponentValues.reversal_safety },
    { key: "impulse_freshness", weight: weights.impulse_freshness, value: sharedComponentValues.impulse_freshness },
  ].map((x) => ({ ...x, value: clamp01(x.value) })) : null;
  const tp0Stats = tp0Components ? summarizeWeightedEstimate(tp0Components, confidenceZ) : null;
  const tp0Probability = tp0Stats ? tp0Stats.mean : null;
  const tp0LowerBound = tp0Stats ? tp0Stats.lowerBound : null;

  const tp0ToTp1ConversionProbability = clamp01(
    Number.isFinite(tp0Probability) && tp0Probability > 0
      ? calibratedProbability / Math.max(tp0Probability, 0.05)
      : calibratedProbability
  );
  const preTp1TimeStopRisk = clamp01(
    (1 - tp0ToTp1ConversionProbability) * 0.45
    + clamp01((Number(chaseRatio || 0) - 1.15) / 1.35) * 0.20
    + clamp01((Number(counterDirBars || 0)) / 3) * 0.20
    + (1 - clamp01(Number(avgCloseControl || 0))) * 0.15
  );
  const runnerTargetPct = Number.isFinite(Number(runnerMinProfitPct)) && Number(runnerMinProfitPct) > 0
    ? Number(runnerMinProfitPct)
    : Math.max(0, Number(tp1Pct || 0));
  const expectedExitValuePct = (
    (Number.isFinite(tp0Probability) ? tp0Probability : calibratedProbability) * tp0Qty * (Number(tp0Pct) || 0)
    + calibratedProbability * tp1Qty * (Number(tp1Pct) || 0)
    + tp0ToTp1ConversionProbability * runnerQty * runnerTargetPct
    - preTp1TimeStopRisk * (Number(slPct) || 0)
  );
  const expectedExitValueR = Number.isFinite(Number(slPct)) && Number(slPct) > 0
    ? (expectedExitValuePct / Number(slPct))
    : null;
  const exitValueComponents = {
    tp1_hit: clamp01(calibratedProbability),
    tp0_hit: clamp01(Number.isFinite(tp0Probability) ? tp0Probability : calibratedProbability),
    tp0_to_tp1_conversion: clamp01(tp0ToTp1ConversionProbability),
    pre_tp1_time_stop_safety: clamp01(1 - preTp1TimeStopRisk),
    expected_exit_value: clamp01(sigmoid(((Number(expectedExitValueR || 0)) - 0.70) * 2.40)),
  };
  const exitValueProbability = clamp01(
    (exitValueComponents.tp1_hit * 0.78)
    + (exitValueComponents.tp0_hit * 0.12)
    + (exitValueComponents.tp0_to_tp1_conversion * 0.05)
    + (exitValueComponents.pre_tp1_time_stop_safety * 0.05)
  );
  const exitValueLowerBound = clamp01(
    ((Number.isFinite(calibratedLowerBound) ? calibratedLowerBound : exitValueComponents.tp1_hit) * 0.78)
    + ((Number.isFinite(tp0LowerBound) ? tp0LowerBound : exitValueComponents.tp0_hit) * 0.12)
    + (exitValueComponents.tp0_to_tp1_conversion * 0.05)
    + (exitValueComponents.pre_tp1_time_stop_safety * 0.05)
  );
  const exitValueStderr = Number.isFinite(confidenceZ) && confidenceZ > 0
    ? Math.max(0, (exitValueProbability - exitValueLowerBound) / confidenceZ)
    : null;

  return {
    ok: true,
    model: "TP1_REACH_RECENT_BARS_V1",
    policy_basis: "TP_COMPOSITE_EXIT_VALUE_V1",
    barsSeen: micro.barsSeen,
    atrPct,
    tp0TargetAtr,
    targetAtr,
    stopAtr,
    recentMove3Pct,
    recentMove1Pct,
    chaseRatio,
    sameDirStreak,
    counterDirBars,
    avgCloseControl,
    avgOppWick,
    avgDirBody,
    lastCloseControl,
    lastOppWick,
    lastDirBody,
    prevCloseControl,
    prevOppWick,
    prevDirBody,
    probability: calibratedProbability,
    lowerBound: calibratedLowerBound,
    stderr: tp1Stats.stderr,
    effectiveN: tp1Stats.effectiveN,
    confidenceZ,
    policy_version: policyVersion,
    canonical_policy_version: canonicalPolicyVersion,
    compatibility_policy_version: policyVersion,
    policy_source: policySource,
    calibration_applied: calibration.applied === true,
    calibration_bucket_min: calibration.bucket ? calibration.bucket.bucket_min : null,
    calibration_bucket_max: calibration.bucket ? calibration.bucket.bucket_max : null,
    calibration_probability_ceiling: calibration.bucket ? calibration.bucket.calibration_probability_ceiling : null,
    calibration_lower_bound_ceiling: calibration.bucket ? calibration.bucket.calibration_lower_bound_ceiling : null,
    raw_probability: tp1Stats.mean,
    raw_lower_bound: tp1Stats.lowerBound,
    tp0_probability: tp0Probability,
    tp0_lower_bound: tp0LowerBound,
    tp1_probability: calibratedProbability,
    tp1_lower_bound: calibratedLowerBound,
    tp0_to_tp1_conversion_probability: tp0ToTp1ConversionProbability,
    pre_tp1_time_stop_risk: preTp1TimeStopRisk,
    expected_exit_value_pct: Number.isFinite(expectedExitValuePct) ? expectedExitValuePct : null,
    expected_exit_value_r: Number.isFinite(expectedExitValueR) ? expectedExitValueR : null,
    exit_value_probability: exitValueProbability,
    exit_value_lower_bound: exitValueLowerBound,
    exit_value_stderr: exitValueStderr,
    exit_value_effective_n: tp1Stats.effectiveN,
    componentWeights: weights,
    components: Object.fromEntries(tp1Components.map((x) => [x.key, x.value])),
    exit_value_components: exitValueComponents,
  };
}

module.exports = {
  estimateTp1ReachProbability,
  resolveTp1ProbabilityWeights,
  __test: {
    normalizeBar: normalizeEntryMicroBar,
    estimateTp1ReachProbability,
    resolveTp1ProbabilityWeights,
    resolveTp1ProbabilityPolicySource,
    DEFAULT_TP1_COMPONENT_WEIGHTS,
    readCalibrationArtifact,
    applyTp1ProbabilityCalibration,
  },
};
