"use strict";

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
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

function roundTo(v, digits = 4) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function sigmoid(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 0.5;
  if (n >= 40) return 1;
  if (n <= -40) return 0;
  return 1 / (1 + Math.exp(-n));
}

function sanitizeToken(v) {
  return String(v || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .toLowerCase();
}

function vectorizeExample(example = {}) {
  const regime = sanitizeToken(example.regime);
  const tier = sanitizeToken(example.tier);
  return [
    1,
    clamp((Number(example.scoreAbs) || 0) / 60, 0, 2),
    clamp01(Number(example.confidence) || 0),
    clamp01(Number(example.waveConf) || 0),
    clamp01(Number(example.postProbDir) || 0),
    clamp((Number(example.lateByBars) || 0) / 3, 0, 2),
    example.conflict ? 1 : 0,
    String(example.side || "").toUpperCase() === "SHORT" ? 1 : 0,
    tier === "early" ? 1 : 0,
    tier === "core" ? 1 : 0,
    tier === "pre_real" ? 1 : 0,
    tier === "real" ? 1 : 0,
    regime === "trend" ? 1 : 0,
    regime === "transition" ? 1 : 0,
    regime === "range" ? 1 : 0,
    regime === "unknown" ? 1 : 0,
    clamp01(Number(example.barLowerBound) || 0),
    clamp((Number(example.chaseRatio) || 0) / 3, 0, 2),
    clamp((Number(example.sameDirStreak) || 0) / 4, 0, 2),
    clamp((Number(example.counterDirBars) || 0) / 3, 0, 2),
    clamp01(Number(example.avgCloseControl) || 0),
    clamp01(Number(example.avgOppWick) || 0),
    clamp((Number(example.avgDirBody) || 0), -1, 1),
  ];
}

function scoreExample(weights, example) {
  const vec = vectorizeExample(example);
  let sum = 0;
  for (let i = 0; i < Math.min(weights.length, vec.length); i += 1) sum += (weights[i] * vec[i]);
  return sum;
}

function predictProbability(model, example) {
  const weights = Array.isArray(model && model.weights) ? model.weights : [];
  if (!weights.length) return null;
  return sigmoid(scoreExample(weights, example));
}

function trainBinaryLogisticModel(examples = [], {
  iterations = 600,
  learningRate = 0.08,
  l2 = 0.001,
} = {}) {
  const rows = (Array.isArray(examples) ? examples : []).filter((row) => Number.isFinite(Number(row.label)));
  const dim = vectorizeExample(rows[0] || {}).length;
  if (!rows.length || dim <= 1) {
    return { ok: false, reason: "INSUFFICIENT_SAMPLE", weights: [] };
  }
  const weights = new Array(dim).fill(0);
  for (let iter = 0; iter < iterations; iter += 1) {
    const grads = new Array(dim).fill(0);
    let weightSum = 0;
    for (const row of rows) {
      const vec = vectorizeExample(row);
      const y = clamp01(Number(row.label));
      const w = Math.max(0.1, Number(row.weight) || 1);
      const p = sigmoid(scoreExample(weights, row));
      const err = (p - y) * w;
      weightSum += w;
      for (let i = 0; i < dim; i += 1) grads[i] += (err * vec[i]);
    }
    const denom = weightSum > 0 ? weightSum : rows.length;
    for (let i = 0; i < dim; i += 1) {
      const reg = i === 0 ? 0 : (l2 * weights[i]);
      weights[i] -= learningRate * ((grads[i] / denom) + reg);
    }
  }
  return {
    ok: true,
    weights,
    sampleN: rows.length,
    positiveRate: rows.reduce((acc, row) => acc + clamp01(Number(row.label)), 0) / rows.length,
  };
}

function evaluateBinaryModel(model, examples = []) {
  const rows = (Array.isArray(examples) ? examples : []).filter((row) => Number.isFinite(Number(row.label)));
  if (!model || model.ok !== true || !rows.length) {
    return {
      ok: false,
      sampleN: rows.length,
      brier: null,
      accuracy: null,
      logloss: null,
      avgPredicted: null,
      positiveRate: null,
    };
  }
  let brier = 0;
  let correct = 0;
  let logloss = 0;
  let predSum = 0;
  let pos = 0;
  for (const row of rows) {
    const y = clamp01(Number(row.label));
    const p = clamp(predictProbability(model, row), 1e-6, 1 - 1e-6);
    predSum += p;
    pos += y;
    brier += ((p - y) ** 2);
    logloss += (-(y * Math.log(p)) - ((1 - y) * Math.log(1 - p)));
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
  }
  return {
    ok: true,
    sampleN: rows.length,
    brier: brier / rows.length,
    accuracy: correct / rows.length,
    logloss: logloss / rows.length,
    avgPredicted: predSum / rows.length,
    positiveRate: pos / rows.length,
  };
}

function groupRate(rows = []) {
  const labeled = rows.filter((row) => Number.isFinite(Number(row.label)));
  if (!labeled.length) return { n: 0, labelRate: null, predRate: null, avgRetNet: null };
  let y = 0;
  let p = 0;
  let retSum = 0;
  let retN = 0;
  let negN = 0;
  let negAbsSum = 0;
  for (const row of labeled) {
    y += clamp01(Number(row.label));
    if (Number.isFinite(Number(row.predicted))) p += Number(row.predicted);
    const ret = toNum(row.expectedRetNet);
    if (ret != null) {
      retSum += ret;
      retN += 1;
      if (ret < 0) {
        negN += 1;
        negAbsSum += Math.abs(ret);
      }
    }
  }
  return {
    n: labeled.length,
    labelRate: y / labeled.length,
    predRate: p / labeled.length,
    avgRetNet: retN > 0 ? (retSum / retN) : null,
    negRate: retN > 0 ? (negN / retN) : null,
    negAbsAvg: negN > 0 ? (negAbsSum / negN) : null,
  };
}

function summarizeLatePenalty(examples = []) {
  const labeled = (Array.isArray(examples) ? examples : []).filter((row) => Number.isFinite(Number(row.label)));
  const onTime = labeled.filter((row) => (Number(row.lateByBars) || 0) <= 0);
  const late1 = labeled.filter((row) => (Number(row.lateByBars) || 0) >= 1);
  const late2 = labeled.filter((row) => (Number(row.lateByBars) || 0) >= 2);
  const a = groupRate(onTime);
  const b = groupRate(late1);
  const c = groupRate(late2);
  return {
    on_time: a,
    late_1_plus: b,
    late_2_plus: c,
    penalty_1_plus: Number.isFinite(a.labelRate) && Number.isFinite(b.labelRate) ? (b.labelRate - a.labelRate) : null,
    penalty_2_plus: Number.isFinite(a.labelRate) && Number.isFinite(c.labelRate) ? (c.labelRate - a.labelRate) : null,
  };
}

function buildQualityRecommendations(examples = [], modelMetrics = {}, settings = {}) {
  const rows = (Array.isArray(examples) ? examples : []).filter((row) => row.source === "EXECUTED" || row.source === "DROP_COUNTERFACTUAL");
  const out = [];
  const sampleN = rows.length;
  if (sampleN < 60 || !(modelMetrics && modelMetrics.ok)) {
    return [{ action: "HOLD", reason: "표본 또는 모델 품질이 부족해 1차 무결성 가드 자동 조정을 보류합니다." }];
  }

  const scoreConfigs = [
    { tier: "EARLY", key: "gate_early_score_abs", current: Number(settings.gate_early_score_abs || 25), min: 12, max: 50 },
    { tier: "CORE", key: "gate_core_score_abs", current: Number(settings.gate_core_score_abs || 35), min: 20, max: 60 },
  ];
  for (const cfg of scoreConfigs) {
    const tierRows = rows.filter((row) => String(row.tier || "").toUpperCase() === cfg.tier && Number.isFinite(Number(row.scoreAbs)));
    const below = tierRows.filter((row) => row.scoreAbs >= (cfg.current - 4) && row.scoreAbs < cfg.current);
    const above = tierRows.filter((row) => row.scoreAbs >= cfg.current && row.scoreAbs < (cfg.current + 4));
    const belowStat = groupRate(below);
    const aboveStat = groupRate(above);
    if (belowStat.n >= 8 && Number.isFinite(belowStat.labelRate) && belowStat.labelRate >= 0.62) {
      out.push({
        key: cfg.key,
        current: cfg.current,
        next: clamp(cfg.current - 2, cfg.min, cfg.max),
        action: "REVIEW_LOOSEN",
        reason: `${cfg.tier} score 경계 아래 구간의 성공률이 높아 점수 문턱을 소폭 완화할 근거가 있습니다.`,
        support_n: belowStat.n,
        support_rate: belowStat.labelRate,
      });
      continue;
    }
    if (aboveStat.n >= 8 && Number.isFinite(aboveStat.labelRate) && aboveStat.labelRate <= 0.42) {
      out.push({
        key: cfg.key,
        current: cfg.current,
        next: clamp(cfg.current + 2, cfg.min, cfg.max),
        action: "REVIEW_TIGHTEN",
        reason: `${cfg.tier} score 경계 위 구간의 성공률이 낮아 점수 문턱을 소폭 강화할 근거가 있습니다.`,
        support_n: aboveStat.n,
        support_rate: aboveStat.labelRate,
      });
    }
  }

  const confCurrent = Number(settings.gate_conf_min || 0.55);
  const confBand = rows.filter((row) => Number.isFinite(Number(row.confidence)) && Math.abs(Number(row.confidence) - confCurrent) <= 0.04);
  const confStat = groupRate(confBand);
  if (confStat.n >= 12 && Number.isFinite(confStat.labelRate) && confStat.labelRate <= 0.45) {
    out.push({
      key: "gate_conf_min",
      current: confCurrent,
      next: clamp(roundTo(confCurrent + 0.02, 3), 0, 1),
      action: "REVIEW_TIGHTEN",
      reason: "신뢰도 경계 구간 성공률이 낮아 conf 최소값 강화 근거가 있습니다.",
      support_n: confStat.n,
      support_rate: confStat.labelRate,
    });
  }

  const waveCurrent = Number(settings.gate_wave_conf_min || 0.60);
  const waveBand = rows.filter((row) => Number.isFinite(Number(row.waveConf)) && Math.abs(Number(row.waveConf) - waveCurrent) <= 0.04);
  const waveStat = groupRate(waveBand);
  if (waveStat.n >= 12 && Number.isFinite(waveStat.labelRate) && waveStat.labelRate <= 0.45) {
    out.push({
      key: "gate_wave_conf_min",
      current: waveCurrent,
      next: clamp(roundTo(waveCurrent + 0.02, 3), 0, 1),
      action: "REVIEW_TIGHTEN",
      reason: "wave confidence 경계 구간 성공률이 낮아 wave 최소값 강화 근거가 있습니다.",
      support_n: waveStat.n,
      support_rate: waveStat.labelRate,
    });
  }

  return out.length ? out.slice(0, 4) : [{ action: "KEEP", reason: "1차 무결성 가드는 현재 학습 결과 기준 즉시 조정 근거가 약합니다." }];
}

function buildAiRecommendation(examples = [], settings = {}) {
  const currentPolicyRaw = String(settings.ai_missing_policy || "ALLOW").trim().toUpperCase();
  const currentPolicy = currentPolicyRaw === "ALLOW" || currentPolicyRaw === "REDUCE" || currentPolicyRaw === "BLOCK"
    ? currentPolicyRaw
    : "ALLOW";
  const currentReduce = clamp(roundTo(Number(settings.ai_missing_reduce_pct || 0.5), 2), 0, 1);
  const aiCoverage = (Array.isArray(examples) ? examples : []).filter((row) => row.aiUsable === true || row.aiMissing === true).length;
  if (aiCoverage < 20) {
    return { action: "HOLD", reason: "2차 AI usable 관련 표본이 부족해 자동 조정을 보류합니다." };
  }
  const missingRows = (Array.isArray(examples) ? examples : []).filter((row) => row.aiMissing === true);
  const missing = missingRows.length;
  const missingStat = groupRate(missingRows);
  if (
    missingStat.n >= 12
    && Number.isFinite(missingStat.avgRetNet)
    && (
      missingStat.avgRetNet < 0
      || (Number.isFinite(missingStat.labelRate) && missingStat.labelRate <= 0.45)
    )
  ) {
    if (currentPolicy === "ALLOW") {
      return {
        action: "REVIEW_UPDATE",
        key: "ai_missing_policy",
        current: "ALLOW",
        next: "REDUCE",
        next_reduce_pct: clamp(currentReduce, 0.2, 0.8),
        reason: "AI missing 구간 후속 성과가 약해 ALLOW 대신 REDUCE로 보수화할 근거가 있습니다.",
        support_n: missingStat.n,
        support_rate: missingStat.labelRate,
        support_avg_ret_net: missingStat.avgRetNet,
      };
    }
    if (currentPolicy === "REDUCE") {
      const nextReduce = clamp(roundTo(currentReduce - 0.10, 2), 0.2, 0.9);
      if (nextReduce < currentReduce - 0.001) {
        return {
          action: "REVIEW_UPDATE",
          key: "ai_missing_reduce_pct",
          current: currentReduce,
          next: nextReduce,
          next_policy: "REDUCE",
          reason: "AI missing 구간 후속 성과가 약해 REDUCE scale 축소 근거가 있습니다.",
          support_n: missingStat.n,
          support_rate: missingStat.labelRate,
          support_avg_ret_net: missingStat.avgRetNet,
        };
      }
      return {
        action: "REVIEW_UPDATE",
        key: "ai_missing_policy",
        current: "REDUCE",
        next: "BLOCK",
        reason: "AI missing 구간 후속 성과가 매우 약해 BLOCK 승격 근거가 있습니다.",
        support_n: missingStat.n,
        support_rate: missingStat.labelRate,
        support_avg_ret_net: missingStat.avgRetNet,
      };
    }
  }
  if (
    missingStat.n >= 12
    && Number.isFinite(missingStat.avgRetNet)
    && missingStat.avgRetNet > 0
    && Number.isFinite(missingStat.labelRate)
    && missingStat.labelRate >= 0.60
  ) {
    if (currentPolicy === "BLOCK") {
      return {
        action: "REVIEW_UPDATE",
        key: "ai_missing_policy",
        current: "BLOCK",
        next: "REDUCE",
        next_reduce_pct: 0.35,
        reason: "AI missing 구간도 후속 성과가 양호해 BLOCK 대신 REDUCE 완화 근거가 있습니다.",
        support_n: missingStat.n,
        support_rate: missingStat.labelRate,
        support_avg_ret_net: missingStat.avgRetNet,
      };
    }
    if (currentPolicy === "REDUCE") {
      const nextReduce = clamp(roundTo(currentReduce + 0.10, 2), 0.2, 1);
      if (nextReduce > currentReduce + 0.001) {
        return {
          action: "REVIEW_UPDATE",
          key: "ai_missing_reduce_pct",
          current: currentReduce,
          next: nextReduce,
          next_policy: "REDUCE",
          reason: "AI missing 구간 후속 성과가 양호해 REDUCE scale 완화 근거가 있습니다.",
          support_n: missingStat.n,
          support_rate: missingStat.labelRate,
          support_avg_ret_net: missingStat.avgRetNet,
        };
      }
      return {
        action: "REVIEW_UPDATE",
        key: "ai_missing_policy",
        current: "REDUCE",
        next: "ALLOW",
        reason: "AI missing 구간 후속 성과가 양호해 ALLOW 완화 근거가 있습니다.",
        support_n: missingStat.n,
        support_rate: missingStat.labelRate,
        support_avg_ret_net: missingStat.avgRetNet,
      };
    }
  }
  if (missing >= 8) {
    return { action: "REVIEW_DATA", reason: "2차 AI 판단은 임계값보다 AI missing/수집 안정화가 우선입니다." };
  }
  return { action: "KEEP", reason: "2차 AI 판단은 현재 학습 결과 기준 즉시 조정 근거가 약합니다." };
}

function buildMarketRecommendation(examples = [], settings = {}) {
  const rows = (Array.isArray(examples) ? examples : []).filter((row) => row.aiBiasDir && row.aiBiasDir !== "UNKNOWN");
  if (rows.length < 20) {
    return { action: "HOLD", reason: "3차 시황 학습 표본이 부족하거나 ai_bias feature coverage가 낮습니다." };
  }
  const neutralRows = rows.filter((row) => row.aiBiasDir === "NEUTRAL");
  const oppositeRows = rows.filter((row) => row.aiBiasRelation === "OPPOSITE_WEAK");
  const neutralStat = groupRate(neutralRows);
  const oppositeStat = groupRate(oppositeRows);
  if (neutralStat.n >= 10 && Number.isFinite(neutralStat.labelRate) && neutralStat.labelRate >= 0.62) {
    return {
      action: "REVIEW_SOFTEN",
      key: "ai_bias_gate_neutral_mult",
      current: Number(settings.ai_bias_gate_neutral_mult || 0.5),
      next: clamp(roundTo(Number(settings.ai_bias_gate_neutral_mult || 0.5) + 0.05, 2), 0, 1),
      reason: "AI 중립 구간의 실제 성공률이 높아 neutral 배수 완화 검토 근거가 있습니다.",
    };
  }
  if (oppositeStat.n >= 8 && Number.isFinite(oppositeStat.labelRate) && oppositeStat.labelRate <= 0.40) {
    return {
      action: "REVIEW_TIGHTEN",
      key: "ai_bias_gate_opposite_mult",
      current: Number(settings.ai_bias_gate_opposite_mult || 0.35),
      next: clamp(roundTo(Number(settings.ai_bias_gate_opposite_mult || 0.35) - 0.05, 2), 0, 1),
      reason: "약한 반대 bias 구간의 실제 성공률이 낮아 opposite 배수 축소 근거가 있습니다.",
    };
  }
  return { action: "KEEP", reason: "3차 시황 필터는 현재 학습 결과 기준 즉시 조정 근거가 약합니다." };
}

function deriveEvThresholdSearchRange(rows = [], {
  thresholdMin = 0.45,
  thresholdMax = 0.75,
  currentThreshold = null,
  fullThreshold = null,
} = {}) {
  const lbs = (Array.isArray(rows) ? rows : [])
    .map((row) => Number(row && row.barLowerBound))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!lbs.length) {
    const fallbackMin = clamp(roundTo(thresholdMin, 2), 0, 1);
    const fallbackMax = clamp(roundTo(Math.max(thresholdMin, thresholdMax), 2), 0, 1);
    return {
      searchMin: fallbackMin,
      searchMax: fallbackMax,
      observedMin: null,
      observedMax: null,
    };
  }
  const observedMin = lbs[0];
  const observedMax = lbs[lbs.length - 1];
  const searchMin = clamp(
    roundTo(Math.min(thresholdMin, Math.max(0.05, observedMin - 0.03)), 2),
    0,
    1
  );
  const searchMax = clamp(
    roundTo(Math.max(observedMax + 0.03, Number(currentThreshold) || 0, Number(fullThreshold) || 0, searchMin), 2),
    0,
    1
  );
  return {
    searchMin,
    searchMax,
    observedMin,
    observedMax,
  };
}

function evaluateEvThresholdCandidates(examples = [], {
  targetHitRate = 0.60,
  minSample = 20,
  thresholdMin = 0.45,
  thresholdMax = 0.75,
  currentThreshold = null,
  fullThreshold = null,
} = {}) {
  const rows = (Array.isArray(examples) ? examples : []).filter((row) => Number.isFinite(Number(row.barLowerBound)) && Number.isFinite(Number(row.label)));
  const support = deriveEvThresholdSearchRange(rows, {
    thresholdMin,
    thresholdMax,
    currentThreshold,
    fullThreshold,
  });
  const out = [];
  for (let t = support.searchMin; t <= support.searchMax + 1e-9; t += 0.01) {
    const threshold = roundTo(t, 2);
    const kept = rows.filter((row) => Number(row.barLowerBound) >= threshold);
    const stat = groupRate(kept);
    out.push({ threshold, ...stat });
  }
  const compareEvCandidate = (a, b) => {
    const aExp = Number.isFinite(a.avgRetNet) ? a.avgRetNet : -1e18;
    const bExp = Number.isFinite(b.avgRetNet) ? b.avgRetNet : -1e18;
    if (Math.abs(aExp - bExp) > 1e-12) return bExp - aExp;
    const aHit = Number.isFinite(a.labelRate) ? a.labelRate : -1e18;
    const bHit = Number.isFinite(b.labelRate) ? b.labelRate : -1e18;
    if (Math.abs(aHit - bHit) > 1e-12) return bHit - aHit;
    const aDd = Number.isFinite(a.negAbsAvg) ? a.negAbsAvg : 1e18;
    const bDd = Number.isFinite(b.negAbsAvg) ? b.negAbsAvg : 1e18;
    if (Math.abs(aDd - bDd) > 1e-12) return aDd - bDd;
    const aNeg = Number.isFinite(a.negRate) ? a.negRate : 1e18;
    const bNeg = Number.isFinite(b.negRate) ? b.negRate : 1e18;
    if (Math.abs(aNeg - bNeg) > 1e-12) return aNeg - bNeg;
    return (b.n || 0) - (a.n || 0);
  };
  const viable = out.filter((row) => row.n >= minSample && Number.isFinite(row.avgRetNet) && row.avgRetNet > 0 && Number.isFinite(row.labelRate) && row.labelRate >= targetHitRate)
    .sort(compareEvCandidate);
  return {
    candidates: out,
    best: viable[0] || null,
    rows,
    support,
  };
}

function buildEvRecommendation(examples = [], settings = {}) {
  const current = Number(settings.ev_gate_tp1_prob_min || 0.55);
  const full = Number(settings.ev_gate_tp1_prob_full || 0.60);
  const low = Number(settings.ev_gate_qty_scale_low || 0.40);
  const mid = Number(settings.ev_gate_qty_scale_mid || 0.70);
  const thresholdEval = evaluateEvThresholdCandidates(examples, {
    targetHitRate: 0.60,
    minSample: 20,
    thresholdMin: 0.45,
    thresholdMax: 0.75,
    currentThreshold: current,
    fullThreshold: full,
  });
  const bandRows = thresholdEval.rows;
  const next = {
    ev_gate_tp1_prob_min: current,
    ev_gate_qty_scale_low: low,
    ev_gate_qty_scale_mid: mid,
  };
  const reasons = [];
  if (thresholdEval.best && Math.abs(Number(thresholdEval.best.threshold) - current) >= 0.01) {
    next.ev_gate_tp1_prob_min = thresholdEval.best.threshold;
    reasons.push(`bar lower bound 기준 최적 threshold 후보 ${thresholdEval.best.threshold}`);
  }
  const bucketAnchor = thresholdEval.best && Number.isFinite(Number(thresholdEval.best.threshold))
    ? Number(thresholdEval.best.threshold)
    : current;
  const lowBucket = groupRate(
    bandRows.filter((row) => Number(row.barLowerBound) >= Math.max(Number(thresholdEval.support && thresholdEval.support.searchMin) || 0, bucketAnchor - 0.05)
      && Number(row.barLowerBound) < bucketAnchor)
  );
  const midBucket = groupRate(
    bandRows.filter((row) => Number(row.barLowerBound) >= bucketAnchor
      && Number(row.barLowerBound) < full)
  );
  if (lowBucket.n >= 8 && Number.isFinite(lowBucket.avgRetNet)) {
    if (lowBucket.avgRetNet > 0 && Number.isFinite(lowBucket.labelRate) && lowBucket.labelRate >= 0.55) {
      next.ev_gate_qty_scale_low = clamp(roundTo(low + 0.05, 2), 0.2, 0.8);
      reasons.push("저확률 구간 평균 수익이 양수라 low scale 완화 근거가 있습니다.");
    } else if (lowBucket.avgRetNet < 0) {
      next.ev_gate_qty_scale_low = clamp(roundTo(low - 0.05, 2), 0.2, 0.8);
      reasons.push("저확률 구간 평균 수익이 음수라 low scale 축소 근거가 있습니다.");
    }
  }
  if (midBucket.n >= 8 && Number.isFinite(midBucket.avgRetNet)) {
    if (midBucket.avgRetNet > 0 && Number.isFinite(midBucket.labelRate) && midBucket.labelRate >= 0.60) {
      next.ev_gate_qty_scale_mid = clamp(roundTo(mid + 0.05, 2), 0.4, 1.0);
      reasons.push("중간 확률 구간 성과가 양호해 mid scale 완화 근거가 있습니다.");
    } else if (midBucket.avgRetNet < 0 || (Number.isFinite(midBucket.labelRate) && midBucket.labelRate < 0.55)) {
      next.ev_gate_qty_scale_mid = clamp(roundTo(mid - 0.05, 2), 0.4, 1.0);
      reasons.push("중간 확률 구간 성과가 약해 mid scale 축소 근거가 있습니다.");
    }
  }
  const changed = Object.keys(next).some((key) => Math.abs(Number(next[key]) - Number(settings[key] || current)) >= 0.01);
  return {
    action: changed ? "REVIEW_UPDATE" : "KEEP",
    reason: reasons.length ? reasons.join(" / ") : "4차 EV는 현재 학습 결과 기준 즉시 조정 근거가 약합니다.",
    next,
    threshold_eval: thresholdEval,
    buckets: { low: lowBucket, mid: midBucket },
  };
}

module.exports = {
  buildAiRecommendation,
  buildEvRecommendation,
  buildMarketRecommendation,
  buildQualityRecommendations,
  evaluateBinaryModel,
  predictProbability,
  roundTo,
  sigmoid,
  summarizeLatePenalty,
  trainBinaryLogisticModel,
  vectorizeExample,
  __test: {
    deriveEvThresholdSearchRange,
    evaluateEvThresholdCandidates,
    groupRate,
    sanitizeToken,
  },
};
