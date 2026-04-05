"use strict";

const { sha1, stableStringify } = require("./mlArtifactVersion");
const { deriveExecutionEntryLabelScope } = require("./executionEntryLabelScope");

const EXECUTION_SCOPE_MODEL_KIND = "EXECUTION_SCOPE_OVR_LOGISTIC_V1";
const EXECUTION_SCOPE_SPLIT_STRATEGY = "SOURCE_AWARE_TIME_SERIES_70_15_15";
const TARGET_CLASSES = Object.freeze(["FILLABLE", "POLICY_BLOCKED", "RUNTIME_EXCEPTION"]);
const NUMERIC_FEATURES = Object.freeze([
  "execution.signal_to_intent_ms",
  "execution.webhook_to_intent_ms",
  "execution.qty_fraction",
  "execution.scheduled_exec_gap_ms",
  "features.score",
  "features.zz_wave_conf",
  "features.ev_gate_tp1_prob_full",
  "features.ev_gate_qty_scale_applied",
  "features.ev_gate_qty_before",
  "features.ev_gate_qty_after_suggested",
  "features.posterior",
  "features.risk_efficiency",
  "features.canonical_engine_score",
  "features.commission_ratio",
]);
const CATEGORICAL_FEATURES = Object.freeze([
  "context.source",
  "context.event",
  "context.side",
  "context.market",
  "execution.entry_schedule_reason",
  "execution.entry_schedule_note_kind",
  "execution.webhook_decision",
  "execution.webhook_reason",
  "features.source_origin",
  "features.signal_family",
  "features.entry_grade",
  "features.risk_mode",
  "features.htf_mode",
  "features.ev_gate_action",
  "features.canonical_engine_execution_source",
  "features.canonical_engine_source_mode_effective",
  "features.pine_overlay_runtime_role",
  "features.strategy_id",
  "features.ai_signal.ai_decision",
  "features._entry_exec_timing",
  "features.cost_shield_block_add",
  "features.pine_shadow_pass",
  "features._live_exec_policy_objective_constrained",
  "features._live_exec_policy_portfolio_cluster_enabled",
  "features._live_exec_policy_quality_scale",
  "features._live_exec_policy_action_scale",
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

function deriveTargetClass(row) {
  const scope = deriveExecutionEntryLabelScope(row);
  if (scope.learning_bucket === "FILLABLE") return "FILLABLE";
  if (scope.scope === "POLICY_BLOCKED") return "POLICY_BLOCKED";
  if (scope.scope === "RUNTIME_EXCEPTION") return "RUNTIME_EXCEPTION";
  return null;
}

function getContextSource(row) {
  return toUpper(getPath(row, "context.source")) || "UNKNOWN";
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

function splitGroupCounts(n) {
  if (n <= 3) return { trainN: n, validationN: 0, testN: 0 };
  if (n <= 6) return { trainN: n - 1, validationN: 0, testN: 1 };
  let trainN = Math.max(1, Math.floor(n * 0.7));
  let validationN = Math.max(1, Math.floor(n * 0.15));
  let testN = n - trainN - validationN;
  if (testN <= 0) {
    testN = 1;
    if (validationN > 1) validationN -= 1;
    else trainN = Math.max(1, trainN - 1);
  }
  if (validationN <= 0 && n >= 8) {
    validationN = 1;
    trainN = Math.max(1, trainN - 1);
    testN = n - trainN - validationN;
  }
  return { trainN, validationN, testN };
}

function buildSourceAwareChronologicalSplit(rows = []) {
  const groups = new Map();
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter((row) => row && typeof row === "object")
    .slice()
    .sort((a, b) => rowTimestampMs(a) - rowTimestampMs(b));
  for (const row of ordered) {
    const key = `${deriveTargetClass(row) || "UNKNOWN"}|${getContextSource(row)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const trainRows = [];
  const validationRows = [];
  const testRows = [];
  for (const rowsForKey of groups.values()) {
    const { trainN, validationN } = splitGroupCounts(rowsForKey.length);
    trainRows.push(...rowsForKey.slice(0, trainN));
    validationRows.push(...rowsForKey.slice(trainN, trainN + validationN));
    testRows.push(...rowsForKey.slice(trainN + validationN));
  }
  const sortRows = (list) => list.slice().sort((a, b) => rowTimestampMs(a) - rowTimestampMs(b));
  const total = ordered.length || 1;
  return {
    ordered,
    trainRows: sortRows(trainRows),
    validationRows: sortRows(validationRows),
    testRows: sortRows(testRows),
    train_split_pct: Number(((trainRows.length / total) * 100).toFixed(2)),
    validation_split_pct: Number(((validationRows.length / total) * 100).toFixed(2)),
    test_split_pct: Number(((testRows.length / total) * 100).toFixed(2)),
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
    const values = rows.map((row) => transformNumeric(path, getPath(row, path))).filter(Number.isFinite);
    const avg = mean(values);
    stats[path] = { mean: avg, std: stddev(values, avg) };
  }
  return stats;
}

function buildCategoricalVocab(rows = []) {
  const vocab = {};
  for (const path of CATEGORICAL_FEATURES) {
    const values = new Set(["UNKNOWN"]);
    for (const row of rows) values.add(toUpper(getPath(row, path)) || "UNKNOWN");
    vocab[path] = Array.from(values).sort();
  }
  return vocab;
}

function buildFeatureIndex(numericStats = {}, categoricalVocab = {}) {
  const features = [];
  for (const path of NUMERIC_FEATURES) {
    features.push({ kind: "numeric", path, key: path });
    features.push({ kind: "numeric_missing", path, key: `${path}__missing` });
  }
  for (const path of CATEGORICAL_FEATURES) {
    for (const value of (categoricalVocab[path] || ["UNKNOWN"])) {
      features.push({ kind: "categorical", path, value, key: `${path}=${value}` });
    }
  }
  return { features, numericStats, categoricalVocab };
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

function deriveClassWeights(binaryLabels = []) {
  const positiveN = binaryLabels.filter((value) => value === 1).length;
  const negativeN = Math.max(0, binaryLabels.length - positiveN);
  if (!binaryLabels.length || !positiveN || !negativeN) return { positive_weight: 1, negative_weight: 1 };
  return {
    positive_weight: binaryLabels.length / (2 * positiveN),
    negative_weight: binaryLabels.length / (2 * negativeN),
  };
}

function trainBinaryLogistic(examples = [], labels = [], { epochs = 250, learningRate = 0.08, l2 = 0.0005 } = {}) {
  const dims = examples[0] ? examples[0].length : 0;
  const weights = new Array(dims).fill(0);
  let bias = 0;
  const classWeights = deriveClassWeights(labels);
  if (!dims || !labels.length) return { weights, bias, class_weights: classWeights };
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const grad = new Array(dims).fill(0);
    let biasGrad = 0;
    let totalWeight = 0;
    for (let i = 0; i < examples.length; i += 1) {
      const x = examples[i];
      const y = labels[i];
      const sampleWeight = y === 1 ? classWeights.positive_weight : classWeights.negative_weight;
      const err = (sigmoid(bias + dot(weights, x)) - y) * sampleWeight;
      totalWeight += sampleWeight;
      biasGrad += err;
      for (let j = 0; j < dims; j += 1) grad[j] += err * x[j];
    }
    const scale = totalWeight > 0 ? 1 / totalWeight : 1 / examples.length;
    bias -= learningRate * biasGrad * scale;
    for (let j = 0; j < dims; j += 1) {
      weights[j] -= learningRate * ((grad[j] * scale) + (l2 * weights[j]));
    }
  }
  return { weights, bias, class_weights: classWeights };
}

function scoreRows(rows = [], spec, modelByClass = {}) {
  return rows.map((row) => {
    const x = encodeRow(row, spec);
    const rawScores = Object.fromEntries(TARGET_CLASSES.map((label) => {
      const model = modelByClass[label] || { weights: [], bias: 0 };
      return [label, sigmoid((model.bias || 0) + dot(model.weights || [], x))];
    }));
    const ranked = Object.entries(rawScores).sort((a, b) => b[1] - a[1]);
    return {
      row_id: String(row && row.row_id || "").trim() || null,
      pred_class: ranked[0] ? ranked[0][0] : null,
      pred_class_prob: ranked[0] ? ranked[0][1] : null,
      class_probs: rawScores,
    };
  });
}

function computeMulticlassMetrics(rows = [], predictions = []) {
  if (!rows.length) return { rows_n: 0, accuracy: null, macro_recall: null };
  const labels = rows.map(deriveTargetClass);
  let correct = 0;
  const recallByClass = {};
  for (const label of TARGET_CLASSES) {
    const classRows = labels.map((value, idx) => ({ value, pred: predictions[idx] && predictions[idx].pred_class }));
    const tp = classRows.filter((row) => row.value === label && row.pred === label).length;
    const fn = classRows.filter((row) => row.value === label && row.pred !== label).length;
    recallByClass[label] = fn + tp > 0 ? tp / (tp + fn) : null;
  }
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] && predictions[i] && labels[i] === predictions[i].pred_class) correct += 1;
  }
  const recalls = Object.values(recallByClass).filter((value) => value != null);
  return {
    rows_n: rows.length,
    accuracy: correct / rows.length,
    recall_by_class: recallByClass,
    macro_recall: recalls.length ? mean(recalls) : null,
  };
}

function buildSplitSupport(rows = []) {
  const byClassSource = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const klass = deriveTargetClass(row);
    const source = getContextSource(row);
    if (!klass) continue;
    if (!byClassSource[klass]) byClassSource[klass] = {};
    byClassSource[klass][source] = (byClassSource[klass][source] || 0) + 1;
  }
  return byClassSource;
}

function deriveSourceDriftDiagnostics({ trainRows = [], testRows = [] } = {}) {
  const trainSupport = buildSplitSupport(trainRows);
  const testSupport = buildSplitSupport(testRows);
  const policyTrain = trainSupport.POLICY_BLOCKED || {};
  const policyTest = testSupport.POLICY_BLOCKED || {};
  const totalPolicyTest = Object.values(policyTest).reduce((sum, value) => sum + value, 0);
  const rows = Object.entries(policyTest)
    .map(([source, test_n]) => ({
      source,
      test_n,
      train_n: policyTrain[source] || 0,
      test_share: totalPolicyTest > 0 ? test_n / totalPolicyTest : null,
    }))
    .sort((a, b) => b.test_n - a.test_n);
  const top = rows[0] || null;
  return {
    policy_blocked_train_support_by_source: policyTrain,
    policy_blocked_test_support_by_source: policyTest,
    policy_blocked_source_rows: rows,
    top_policy_blocked_test_source: top ? top.source : null,
    top_policy_blocked_test_source_train_n: top ? top.train_n : null,
    top_policy_blocked_test_source_test_n: top ? top.test_n : null,
    top_policy_blocked_test_source_test_share: top ? top.test_share : null,
  };
}

function deriveQualityGate(metrics = {}, diagnostics = {}) {
  const macroRecall = toNum(metrics.macro_recall);
  const accuracy = toNum(metrics.accuracy);
  const recallByClass = metrics && metrics.recall_by_class && typeof metrics.recall_by_class === "object"
    ? metrics.recall_by_class
    : {};
  const fillableRecall = toNum(recallByClass.FILLABLE);
  const policyBlockedRecall = toNum(recallByClass.POLICY_BLOCKED);
  const runtimeExceptionRecall = toNum(recallByClass.RUNTIME_EXCEPTION);
  const topPolicySourceTrainN = toNum(diagnostics.top_policy_blocked_test_source_train_n);
  const topPolicySourceTestShare = toNum(diagnostics.top_policy_blocked_test_source_test_share);
  if (topPolicySourceTestShare != null && topPolicySourceTestShare >= 0.5 && (topPolicySourceTrainN == null || topPolicySourceTrainN < 3)) {
    return { status: "POLICY_BLOCKED_SOURCE_SUPPORT_TOO_LOW", ready: false };
  }
  if (macroRecall == null || macroRecall < 0.45) return { status: "MACRO_RECALL_TOO_LOW", ready: false };
  if (accuracy == null || accuracy < 0.55) return { status: "ACCURACY_TOO_LOW", ready: false };
  if (fillableRecall == null || fillableRecall < 0.6) return { status: "FILLABLE_RECALL_TOO_LOW", ready: false };
  if (policyBlockedRecall == null || policyBlockedRecall < 0.2) return { status: "POLICY_BLOCKED_RECALL_TOO_LOW", ready: false };
  if (runtimeExceptionRecall == null || runtimeExceptionRecall < 0.4) return { status: "RUNTIME_EXCEPTION_RECALL_TOO_LOW", ready: false };
  return { status: "QUALITY_GATE_PASS", ready: true };
}

function filterTrainingRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => TARGET_CLASSES.includes(deriveTargetClass(row)));
}

function buildExecutionScopeBaselineModel({
  rows = [],
  experimentId = null,
  datasetVersionId = null,
  featureStoreVersionId = null,
  executionDatasetVersionId = null,
  trainedAtKst = null,
} = {}) {
  const filteredRows = filterTrainingRows(rows);
  const split = buildSourceAwareChronologicalSplit(filteredRows);
  const numericStats = buildNumericStats(split.trainRows);
  const categoricalVocab = buildCategoricalVocab(split.trainRows);
  const spec = buildFeatureIndex(numericStats, categoricalVocab);
  const trainX = split.trainRows.map((row) => encodeRow(row, spec));
  const modelByClass = {};
  for (const label of TARGET_CLASSES) {
    const binaryLabels = split.trainRows.map((row) => deriveTargetClass(row) === label ? 1 : 0);
    modelByClass[label] = trainBinaryLogistic(trainX, binaryLabels);
  }
  const trainPred = scoreRows(split.trainRows, spec, modelByClass);
  const validationPred = scoreRows(split.validationRows, spec, modelByClass);
  const testPred = scoreRows(split.testRows, spec, modelByClass);
  const trainMetrics = computeMulticlassMetrics(split.trainRows, trainPred);
  const validationMetrics = computeMulticlassMetrics(split.validationRows, validationPred);
  const testMetrics = computeMulticlassMetrics(split.testRows, testPred);
  const splitDiagnostics = deriveSourceDriftDiagnostics({
    trainRows: split.trainRows,
    testRows: split.testRows,
  });
  const qualityGate = deriveQualityGate(testMetrics, splitDiagnostics);
  const trainedAt = String(trainedAtKst || "").trim() || null;
  const trainRunSeed = stableStringify({
    experiment_id: experimentId,
    dataset_version_id: datasetVersionId,
    execution_dataset_version_id: executionDatasetVersionId,
    trained_at_kst: trainedAt,
    model_kind: EXECUTION_SCOPE_MODEL_KIND,
    test_macro_recall: testMetrics.macro_recall,
  });
  const trainRunId = `TRAIN_EXEC_SCOPE__${sha1(trainRunSeed).slice(0, 16)}`;
  const modelArtifactId = `MODEL_EXEC_SCOPE__${sha1(stableStringify({
    train_run_id: trainRunId,
    model_kind: EXECUTION_SCOPE_MODEL_KIND,
    feature_keys: spec.features.map((row) => row.key),
    model_by_class: Object.fromEntries(TARGET_CLASSES.map((label) => [label, modelByClass[label].weights])),
  })).slice(0, 16)}`;

  return {
    trainRun: {
      status: "ML_TRAIN_RUN_REPORTED",
      train_run_id: trainRunId,
      model_artifact_id: modelArtifactId,
      experiment_id: experimentId,
      dataset_version_id: datasetVersionId,
      feature_store_version_id: featureStoreVersionId,
      execution_dataset_version_id: executionDatasetVersionId,
      model_kind: EXECUTION_SCOPE_MODEL_KIND,
      split_strategy: EXECUTION_SCOPE_SPLIT_STRATEGY,
      target_classes: TARGET_CLASSES.slice(),
      quality_gate_status: qualityGate.status,
      quality_gate_ready: qualityGate.ready,
      train_split_pct: split.train_split_pct,
      validation_split_pct: split.validation_split_pct,
      test_split_pct: split.test_split_pct,
      metrics_snapshot: { train: trainMetrics, validation: validationMetrics, test: testMetrics },
      split_diagnostics: splitDiagnostics,
      trained_at_kst: trainedAt,
    },
    modelArtifact: {
      status: "EXECUTION_SCOPE_MODEL_READY",
      model_artifact_id: modelArtifactId,
      train_run_id: trainRunId,
      experiment_id: experimentId,
      dataset_version_id: datasetVersionId,
      feature_store_version_id: featureStoreVersionId,
      execution_dataset_version_id: executionDatasetVersionId,
      model_kind: EXECUTION_SCOPE_MODEL_KIND,
      split_strategy: EXECUTION_SCOPE_SPLIT_STRATEGY,
      target_classes: TARGET_CLASSES.slice(),
      quality_gate_status: qualityGate.status,
      quality_gate_ready: qualityGate.ready,
      feature_count: spec.features.length,
      metrics_snapshot: { train: trainMetrics, validation: validationMetrics, test: testMetrics },
      split_diagnostics: splitDiagnostics,
      model_params: {
        feature_keys: spec.features.map((row) => row.key),
        numeric_stats: numericStats,
        categorical_vocab: categoricalVocab,
        model_by_class: modelByClass,
      },
      trained_at_kst: trainedAt,
    },
  };
}

function scoreExecutionScopeBaselineRows(rows = [], modelArtifact = null) {
  const summary = modelArtifact && modelArtifact.summary && typeof modelArtifact.summary === "object"
    ? modelArtifact.summary
    : (modelArtifact || {});
  const params = modelArtifact && modelArtifact.model && typeof modelArtifact.model === "object"
    ? modelArtifact.model
    : (summary.model_params && typeof summary.model_params === "object" ? summary.model_params : null);
  if (!params) throw new Error("EXECUTION_SCOPE_MODEL_PARAMS_MISSING");
  const spec = buildFeatureIndex(params.numeric_stats || {}, params.categorical_vocab || {});
  return scoreRows(rows, spec, params.model_by_class || {});
}

module.exports = {
  TARGET_CLASSES,
  EXECUTION_SCOPE_MODEL_KIND,
  EXECUTION_SCOPE_SPLIT_STRATEGY,
  deriveTargetClass,
  filterTrainingRows,
  buildExecutionScopeBaselineModel,
  scoreExecutionScopeBaselineRows,
  deriveQualityGate,
  deriveSourceDriftDiagnostics,
  buildSourceAwareChronologicalSplit,
};
