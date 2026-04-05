"use strict";

const { sha1, stableStringify } = require("./mlArtifactVersion");

const EXECUTION_FILL_MODEL_KIND = "EXECUTION_FILL_LOGISTIC_V1";
const EXECUTION_FILL_SPLIT_STRATEGY = "TIME_SERIES_70_15_15";
const NUMERIC_FEATURES = Object.freeze([
  "execution.signal_to_intent_ms",
  "execution.webhook_to_intent_ms",
  "execution.qty_fraction",
  "features.score",
  "features.zz_wave_conf",
]);
const CATEGORICAL_FEATURES = Object.freeze([
  "context.source",
  "context.event",
  "context.side",
  "context.market",
  "execution.entry_schedule_reason",
  "execution.webhook_decision",
  "execution.webhook_reason",
]);

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function clip(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

function sigmoid(value) {
  const x = clip(Number(value) || 0, -40, 40);
  return 1 / (1 + Math.exp(-x));
}

function getPath(row, path) {
  const parts = String(path || "").split(".");
  let cur = row;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return null;
    cur = cur[part];
  }
  return cur;
}

function transformNumeric(path, value) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return null;
  if (path.endsWith("_ms") || path.endsWith("_bps")) return Math.log1p(Math.max(0, n));
  return n;
}

function rowTimestampMs(row) {
  return (
    toNum(getPath(row, "execution.signal_bar_close_ms"))
    ?? toNum(getPath(row, "execution.intent_created_at_ms"))
    ?? 0
  );
}

function rowLabel(row) {
  return getPath(row, "labels.was_filled") === true ? 1 : 0;
}

function buildChronologicalSplit(rows = []) {
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .slice()
    .sort((a, b) => rowTimestampMs(a) - rowTimestampMs(b));
  const n = ordered.length;
  const trainEnd = Math.max(1, Math.floor(n * 0.7));
  const validationEnd = Math.max(trainEnd + 1, Math.floor(n * 0.85));
  return {
    ordered,
    trainRows: ordered.slice(0, trainEnd),
    validationRows: ordered.slice(trainEnd, validationEnd),
    testRows: ordered.slice(validationEnd),
    train_split_pct: 70,
    validation_split_pct: 15,
    test_split_pct: 15,
  };
}

function mean(values = []) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values = [], avg = 0) {
  if (!values.length) return 1;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  const std = Math.sqrt(variance);
  return std > 1e-9 ? std : 1;
}

function buildNumericStats(rows = []) {
  const stats = {};
  for (const path of NUMERIC_FEATURES) {
    const values = rows
      .map((row) => transformNumeric(path, getPath(row, path)))
      .filter((value) => Number.isFinite(value));
    const avg = mean(values);
    stats[path] = {
      mean: avg,
      std: stddev(values, avg),
    };
  }
  return stats;
}

function buildCategoricalVocab(rows = []) {
  const vocab = {};
  for (const path of CATEGORICAL_FEATURES) {
    const values = new Set(["UNKNOWN"]);
    for (const row of rows) {
      values.add(toUpper(getPath(row, path)) || "UNKNOWN");
    }
    vocab[path] = Array.from(values).sort();
  }
  return vocab;
}

function buildFeatureIndex(numericStats = {}, categoricalVocab = {}) {
  const index = [];
  for (const path of NUMERIC_FEATURES) {
    index.push({ kind: "numeric", path, key: path });
    index.push({ kind: "numeric_missing", path, key: `${path}__missing` });
  }
  for (const path of CATEGORICAL_FEATURES) {
    for (const value of (categoricalVocab[path] || ["UNKNOWN"])) {
      index.push({ kind: "categorical", path, value, key: `${path}=${value}` });
    }
  }
  return {
    features: index,
    numericStats,
    categoricalVocab,
  };
}

function encodeRow(row, spec) {
  const vector = [];
  for (const feature of spec.features) {
    if (feature.kind === "numeric") {
      const raw = transformNumeric(feature.path, getPath(row, feature.path));
      if (Number.isFinite(raw)) {
        const stats = spec.numericStats[feature.path] || { mean: 0, std: 1 };
        vector.push((raw - stats.mean) / (stats.std || 1));
      } else {
        vector.push(0);
      }
      continue;
    }
    if (feature.kind === "numeric_missing") {
      vector.push(Number.isFinite(transformNumeric(feature.path, getPath(row, feature.path))) ? 0 : 1);
      continue;
    }
    const actual = toUpper(getPath(row, feature.path)) || "UNKNOWN";
    vector.push(actual === feature.value ? 1 : 0);
  }
  return vector;
}

function buildScoringSpec(modelParams = {}) {
  const featureKeys = Array.isArray(modelParams.feature_keys) ? modelParams.feature_keys : [];
  return {
    features: featureKeys.map((key) => {
      if (key.endsWith("__missing")) {
        return { kind: "numeric_missing", path: key.slice(0, -10), key };
      }
      if (key.includes("=")) {
        const eq = key.indexOf("=");
        return { kind: "categorical", path: key.slice(0, eq), value: key.slice(eq + 1), key };
      }
      return { kind: "numeric", path: key, key };
    }),
    numericStats: modelParams.numeric_stats && typeof modelParams.numeric_stats === "object" ? modelParams.numeric_stats : {},
    categoricalVocab: modelParams.categorical_vocab && typeof modelParams.categorical_vocab === "object" ? modelParams.categorical_vocab : {},
  };
}

function dot(weights = [], vector = []) {
  let total = 0;
  const len = Math.min(weights.length, vector.length);
  for (let i = 0; i < len; i += 1) total += weights[i] * vector[i];
  return total;
}

function predictProbabilities(rows = [], spec, model) {
  return rows.map((row) => {
    const x = encodeRow(row, spec);
    return sigmoid((model.bias || 0) + dot(model.weights || [], x));
  });
}

function safeDiv(num, den) {
  return den ? num / den : null;
}

function deriveClassWeights(labels = []) {
  const positiveN = labels.filter((value) => value === 1).length;
  const negativeN = Math.max(0, labels.length - positiveN);
  if (!labels.length || !positiveN || !negativeN) {
    return { positive_weight: 1, negative_weight: 1 };
  }
  return {
    positive_weight: labels.length / (2 * positiveN),
    negative_weight: labels.length / (2 * negativeN),
  };
}

function trainLogisticRegression(examples = [], labels = [], { epochs = 250, learningRate = 0.08, l2 = 0.0005, classWeights = null } = {}) {
  const dims = examples[0] ? examples[0].length : 0;
  const weights = new Array(dims).fill(0);
  let bias = 0;
  const resolvedClassWeights = classWeights || deriveClassWeights(labels);
  if (!dims || !labels.length) {
    return { weights, bias, epochs_completed: 0, class_weights: resolvedClassWeights };
  }
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(dims).fill(0);
    let biasGrad = 0;
    let totalWeight = 0;
    for (let i = 0; i < examples.length; i += 1) {
      const x = examples[i];
      const y = labels[i];
      const sampleWeight = y === 1 ? resolvedClassWeights.positive_weight : resolvedClassWeights.negative_weight;
      const pred = sigmoid(bias + dot(weights, x));
      const err = (pred - y) * sampleWeight;
      totalWeight += sampleWeight;
      biasGrad += err;
      for (let j = 0; j < dims; j += 1) grad[j] += err * x[j];
    }
    const scale = totalWeight > 0 ? 1 / totalWeight : 1 / examples.length;
    bias -= learningRate * biasGrad * scale;
    for (let j = 0; j < dims; j += 1) {
      const penalty = l2 * weights[j];
      weights[j] -= learningRate * ((grad[j] * scale) + penalty);
    }
  }
  return { weights, bias, epochs_completed: epochs, class_weights: resolvedClassWeights };
}

function computeClassificationMetrics(rows = [], probs = [], threshold = 0.5) {
  const labels = rows.map((row) => rowLabel(row));
  const n = labels.length;
  if (!n) {
    return {
      rows_n: 0,
      positive_n: 0,
      positive_rate: null,
      brier_score: null,
      log_loss: null,
      accuracy: null,
      precision: null,
      recall: null,
      f1_score: null,
      balanced_accuracy: null,
      threshold,
    };
  }
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let positiveN = 0;
  for (let i = 0; i < n; i += 1) {
    const y = labels[i];
    const p = clip(probs[i], 1e-6, 1 - 1e-6);
    if (y === 1) positiveN += 1;
    brier += ((p - y) ** 2);
    logLoss += -((y * Math.log(p)) + ((1 - y) * Math.log(1 - p)));
    const pred = p >= threshold ? 1 : 0;
    if (pred === y) correct += 1;
    if (pred === 1 && y === 1) tp += 1;
    if (pred === 1 && y === 0) fp += 1;
    if (pred === 0 && y === 1) fn += 1;
    if (pred === 0 && y === 0) tn += 1;
  }
  const recall = safeDiv(tp, tp + fn);
  const specificity = safeDiv(tn, tn + fp);
  const precision = safeDiv(tp, tp + fp);
  const f1 = (precision != null && recall != null && (precision + recall) > 0)
    ? ((2 * precision * recall) / (precision + recall))
    : null;
  return {
    rows_n: n,
    positive_n: positiveN,
    positive_rate: safeDiv(positiveN, n),
    brier_score: brier / n,
    log_loss: logLoss / n,
    accuracy: safeDiv(correct, n),
    precision,
    recall,
    f1_score: f1,
    balanced_accuracy: (recall != null && specificity != null) ? ((recall + specificity) / 2) : null,
    threshold,
  };
}

function selectDecisionThreshold(rows = [], probs = []) {
  if (!rows.length || !probs.length) return 0.5;
  const candidates = [];
  for (let threshold = 0.2; threshold <= 0.8; threshold += 0.02) {
    candidates.push(Number(threshold.toFixed(2)));
  }
  let best = { threshold: 0.5, f1_score: -1, balanced_accuracy: -1, brier_score: Infinity, recall: -1 };
  for (const threshold of candidates) {
    const metrics = computeClassificationMetrics(rows, probs, threshold);
    const score = metrics.f1_score != null ? metrics.f1_score : -1;
    const recall = metrics.recall != null ? metrics.recall : -1;
    const viable = recall >= 0.35;
    if (
      (viable && best.recall < 0.35)
      || (viable === (best.recall >= 0.35) && score > best.f1_score)
      || (viable === (best.recall >= 0.35) && score === best.f1_score && (metrics.balanced_accuracy || -1) > best.balanced_accuracy)
      || (viable === (best.recall >= 0.35) && score === best.f1_score && (metrics.balanced_accuracy || -1) === best.balanced_accuracy && (metrics.brier_score || Infinity) < best.brier_score)
    ) {
      best = {
        threshold,
        f1_score: score,
        balanced_accuracy: metrics.balanced_accuracy || -1,
        brier_score: metrics.brier_score || Infinity,
        recall,
      };
    }
  }
  return best.threshold;
}

function buildWeightSummary(spec, model, limit = 12) {
  const rows = (spec.features || []).map((feature, idx) => ({
    key: feature.key,
    weight: Number(model.weights[idx] || 0),
    abs_weight: Math.abs(Number(model.weights[idx] || 0)),
  }));
  const ranked = rows.sort((a, b) => b.abs_weight - a.abs_weight);
  return {
    bias: Number(model.bias || 0),
    top_positive: ranked.filter((row) => row.weight > 0).slice(0, limit),
    top_negative: ranked.filter((row) => row.weight < 0).slice(0, limit),
  };
}

function deriveQualityGate(metrics = {}, decisionThreshold = 0.5) {
  const threshold = toNum(decisionThreshold);
  const balancedAccuracy = toNum(metrics.balanced_accuracy);
  const precision = toNum(metrics.precision);
  const recall = toNum(metrics.recall);
  const positiveRate = toNum(metrics.positive_rate);
  const degenerateAllPositive = precision != null && recall != null && positiveRate != null
    && Math.abs(recall - 1) < 1e-9
    && Math.abs(precision - positiveRate) < 1e-9;
  const degenerateAllNegative = precision === 1 && recall != null && recall < 0.1;
  const thresholdExtreme = threshold != null && (threshold <= 0.2 || threshold >= 0.8);
  if (degenerateAllPositive) {
    return { status: "DEGENERATE_ALL_POSITIVE", ready: false };
  }
  if (degenerateAllNegative) {
    return { status: "DEGENERATE_ALL_NEGATIVE", ready: false };
  }
  if (thresholdExtreme) {
    return { status: "DEGENERATE_THRESHOLD_EXTREME", ready: false };
  }
  if (balancedAccuracy == null || balancedAccuracy < 0.55) {
    return { status: "BALANCED_ACCURACY_TOO_LOW", ready: false };
  }
  return { status: "QUALITY_GATE_PASS", ready: true };
}

function scoreExecutionFillBaselineRows(rows = [], modelArtifact = null) {
  const summary = modelArtifact && modelArtifact.summary && typeof modelArtifact.summary === "object"
    ? modelArtifact.summary
    : (modelArtifact || {});
  const params = modelArtifact && modelArtifact.model && typeof modelArtifact.model === "object"
    ? modelArtifact.model
    : (summary.model_params && typeof summary.model_params === "object" ? summary.model_params : null);
  if (!params) {
    throw new Error("EXECUTION_FILL_MODEL_PARAMS_MISSING");
  }
  const spec = buildScoringSpec(params);
  const weights = Array.isArray(params.weights) ? params.weights : [];
  const bias = toNum(params.bias) || 0;
  const threshold = toNum(summary.decision_threshold) ?? 0.5;
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const vector = encodeRow(row, spec);
    const prob = sigmoid(bias + dot(weights, vector));
    return {
      row_id: String(row && row.row_id || "").trim() || null,
      pred_fill_prob: prob,
      pred_fill_label: prob >= threshold,
      decision_threshold: threshold,
    };
  });
}

function buildExecutionFillBaselineModel({
  rows = [],
  experimentId = null,
  datasetVersionId = null,
  featureStoreVersionId = null,
  executionDatasetVersionId = null,
  trainedAtKst = null,
} = {}) {
  const split = buildChronologicalSplit(rows);
  const numericStats = buildNumericStats(split.trainRows);
  const categoricalVocab = buildCategoricalVocab(split.trainRows);
  const spec = buildFeatureIndex(numericStats, categoricalVocab);
  const trainX = split.trainRows.map((row) => encodeRow(row, spec));
  const trainY = split.trainRows.map((row) => rowLabel(row));
  const classWeights = deriveClassWeights(trainY);
  const model = trainLogisticRegression(trainX, trainY, { classWeights });
  const trainProbabilities = predictProbabilities(split.trainRows, spec, model);
  const validationProbabilities = predictProbabilities(split.validationRows, spec, model);
  const testProbabilities = predictProbabilities(split.testRows, spec, model);
  const decisionThreshold = selectDecisionThreshold(split.validationRows, validationProbabilities);
  const trainMetrics = computeClassificationMetrics(split.trainRows, trainProbabilities, decisionThreshold);
  const validationMetrics = computeClassificationMetrics(split.validationRows, validationProbabilities, decisionThreshold);
  const testMetrics = computeClassificationMetrics(split.testRows, testProbabilities, decisionThreshold);
  const qualityGate = deriveQualityGate(testMetrics, decisionThreshold);
  const trainedAt = String(trainedAtKst || "").trim() || null;
  const trainRunSeed = stableStringify({
    experiment_id: experimentId,
    dataset_version_id: datasetVersionId,
    feature_store_version_id: featureStoreVersionId,
    execution_dataset_version_id: executionDatasetVersionId,
    trained_at_kst: trainedAt,
    model_kind: EXECUTION_FILL_MODEL_KIND,
    test_brier_score: testMetrics.brier_score,
  });
  const trainRunId = `TRAIN_EXEC_FILL__${sha1(trainRunSeed).slice(0, 16)}`;
  const modelArtifactSeed = stableStringify({
    train_run_id: trainRunId,
    model_kind: EXECUTION_FILL_MODEL_KIND,
    split_strategy: EXECUTION_FILL_SPLIT_STRATEGY,
    weights: model.weights,
    bias: model.bias,
    spec: spec.features.map((row) => row.key),
  });
  const modelArtifactId = `MODEL_EXEC_FILL__${sha1(modelArtifactSeed).slice(0, 16)}`;

  return {
    trainRun: {
      status: "ML_TRAIN_RUN_REPORTED",
      train_run_id: trainRunId,
      model_artifact_id: modelArtifactId,
      experiment_id: experimentId,
      dataset_version_id: datasetVersionId,
      feature_store_version_id: featureStoreVersionId,
      execution_dataset_version_id: executionDatasetVersionId,
      model_kind: EXECUTION_FILL_MODEL_KIND,
      split_strategy: EXECUTION_FILL_SPLIT_STRATEGY,
      decision_threshold: decisionThreshold,
      quality_gate_status: qualityGate.status,
      quality_gate_ready: qualityGate.ready,
      train_split_pct: split.train_split_pct,
      validation_split_pct: split.validation_split_pct,
      test_split_pct: split.test_split_pct,
      metrics_snapshot: {
        train: trainMetrics,
        validation: validationMetrics,
        test: testMetrics,
      },
      trained_at_kst: trainedAt,
    },
    modelArtifact: {
      status: "EXECUTION_FILL_MODEL_READY",
      model_artifact_id: modelArtifactId,
      train_run_id: trainRunId,
      experiment_id: experimentId,
      dataset_version_id: datasetVersionId,
      feature_store_version_id: featureStoreVersionId,
      execution_dataset_version_id: executionDatasetVersionId,
      model_kind: EXECUTION_FILL_MODEL_KIND,
      split_strategy: EXECUTION_FILL_SPLIT_STRATEGY,
      decision_threshold: decisionThreshold,
      quality_gate_status: qualityGate.status,
      quality_gate_ready: qualityGate.ready,
      feature_count: spec.features.length,
      weights_n: model.weights.length,
      metrics_snapshot: {
        train: trainMetrics,
        validation: validationMetrics,
        test: testMetrics,
      },
      weight_summary: buildWeightSummary(spec, model),
      feature_spec: {
        numeric_features: NUMERIC_FEATURES.slice(),
        categorical_features: CATEGORICAL_FEATURES.slice(),
        categorical_vocabulary_sizes: Object.fromEntries(
          Object.entries(categoricalVocab).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
        ),
      },
      model_params: {
        bias: model.bias,
        weights: model.weights,
        class_weights: model.class_weights,
        feature_keys: spec.features.map((row) => row.key),
        numeric_stats: numericStats,
        categorical_vocab: categoricalVocab,
      },
      trained_at_kst: trainedAt,
    },
  };
}

module.exports = {
  EXECUTION_FILL_MODEL_KIND,
  EXECUTION_FILL_SPLIT_STRATEGY,
  NUMERIC_FEATURES,
  CATEGORICAL_FEATURES,
  deriveClassWeights,
  selectDecisionThreshold,
  deriveQualityGate,
  scoreExecutionFillBaselineRows,
  buildExecutionFillBaselineModel,
};
