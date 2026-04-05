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

function dot(weights = [], vector = []) {
  let total = 0;
  const len = Math.min(weights.length, vector.length);
  for (let i = 0; i < len; i += 1) total += weights[i] * vector[i];
  return total;
}

function trainLogisticRegression(examples = [], labels = [], { epochs = 250, learningRate = 0.08, l2 = 0.0005 } = {}) {
  const dims = examples[0] ? examples[0].length : 0;
  const weights = new Array(dims).fill(0);
  let bias = 0;
  if (!dims || !labels.length) {
    return { weights, bias, epochs_completed: 0 };
  }
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(dims).fill(0);
    let biasGrad = 0;
    for (let i = 0; i < examples.length; i += 1) {
      const x = examples[i];
      const y = labels[i];
      const pred = sigmoid(bias + dot(weights, x));
      const err = pred - y;
      biasGrad += err;
      for (let j = 0; j < dims; j += 1) grad[j] += err * x[j];
    }
    const scale = 1 / examples.length;
    bias -= learningRate * biasGrad * scale;
    for (let j = 0; j < dims; j += 1) {
      const penalty = l2 * weights[j];
      weights[j] -= learningRate * ((grad[j] * scale) + penalty);
    }
  }
  return { weights, bias, epochs_completed: epochs };
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

function computeClassificationMetrics(rows = [], probs = []) {
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
    };
  }
  let brier = 0;
  let logLoss = 0;
  let correct = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let positiveN = 0;
  for (let i = 0; i < n; i += 1) {
    const y = labels[i];
    const p = clip(probs[i], 1e-6, 1 - 1e-6);
    if (y === 1) positiveN += 1;
    brier += ((p - y) ** 2);
    logLoss += -((y * Math.log(p)) + ((1 - y) * Math.log(1 - p)));
    const pred = p >= 0.5 ? 1 : 0;
    if (pred === y) correct += 1;
    if (pred === 1 && y === 1) tp += 1;
    if (pred === 1 && y === 0) fp += 1;
    if (pred === 0 && y === 1) fn += 1;
  }
  return {
    rows_n: n,
    positive_n: positiveN,
    positive_rate: safeDiv(positiveN, n),
    brier_score: brier / n,
    log_loss: logLoss / n,
    accuracy: safeDiv(correct, n),
    precision: safeDiv(tp, tp + fp),
    recall: safeDiv(tp, tp + fn),
  };
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
  const model = trainLogisticRegression(trainX, trainY);
  const trainMetrics = computeClassificationMetrics(split.trainRows, predictProbabilities(split.trainRows, spec, model));
  const validationMetrics = computeClassificationMetrics(split.validationRows, predictProbabilities(split.validationRows, spec, model));
  const testMetrics = computeClassificationMetrics(split.testRows, predictProbabilities(split.testRows, spec, model));
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
  buildExecutionFillBaselineModel,
};
