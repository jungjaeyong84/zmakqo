"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function resolveTierFromEvent(event = null) {
  const normalized = toUpper(event);
  if (!normalized) return null;
  if (normalized.startsWith("EARLY_")) return "EARLY";
  if (normalized.startsWith("CORE_")) return "CORE";
  return null;
}

function summarizeExecutionScopeTierComparison({ inference = null, trainRun = null } = {}) {
  const inferenceSummary = inference && typeof inference === "object"
    ? (inference.summary && typeof inference.summary === "object" ? inference.summary : inference)
    : {};
  const inferenceRows = inference && Array.isArray(inference.rows) ? inference.rows : [];
  const trainRunSummary = trainRun && typeof trainRun === "object"
    ? (trainRun.summary && typeof trainRun.summary === "object" ? trainRun.summary : trainRun)
    : {};
  const tierMetrics = trainRunSummary.metrics_by_entry_grade && typeof trainRunSummary.metrics_by_entry_grade === "object"
    ? trainRunSummary.metrics_by_entry_grade
    : {};

  const tiers = ["EARLY", "CORE"].map((tier) => {
    const scopedRows = inferenceRows.filter((row) => resolveTierFromEvent(row && row.event) === tier);
    const mismatchN = scopedRows.filter((row) => row && row.actual_scope && row.pred_class && row.actual_scope !== row.pred_class).length;
    const testMetrics = tierMetrics.test && tierMetrics.test[tier] && typeof tierMetrics.test[tier] === "object"
      ? tierMetrics.test[tier]
      : {};
    return {
      tier,
      inference_rows_n: scopedRows.length,
      inference_mismatch_n: mismatchN,
      inference_mismatch_rate: scopedRows.length ? mismatchN / scopedRows.length : null,
      test_rows_n: toNum(testMetrics.rows_n),
      test_accuracy: toNum(testMetrics.accuracy),
      test_macro_recall: toNum(testMetrics.macro_recall),
      test_recall_by_class: testMetrics.recall_by_class && typeof testMetrics.recall_by_class === "object"
        ? testMetrics.recall_by_class
        : {},
    };
  });

  const early = tiers.find((row) => row.tier === "EARLY") || {};
  const core = tiers.find((row) => row.tier === "CORE") || {};
  const earlyMismatch = toNum(early.inference_mismatch_rate);
  const coreMismatch = toNum(core.inference_mismatch_rate);
  const earlyMacroRecall = toNum(early.test_macro_recall);
  const coreMacroRecall = toNum(core.test_macro_recall);
  const weakerTier = (() => {
    if (earlyMismatch != null && coreMismatch != null && earlyMismatch !== coreMismatch) {
      return earlyMismatch > coreMismatch ? "EARLY" : "CORE";
    }
    if (earlyMacroRecall != null && coreMacroRecall != null && earlyMacroRecall !== coreMacroRecall) {
      return earlyMacroRecall < coreMacroRecall ? "EARLY" : "CORE";
    }
    return null;
  })();

  return {
    summary: {
      status: "EXECUTION_SCOPE_TIER_COMPARISON_READY",
      model_artifact_id: String(inferenceSummary.model_artifact_id || trainRunSummary.model_artifact_id || "").trim() || null,
      train_run_id: String(inferenceSummary.train_run_id || trainRunSummary.train_run_id || "").trim() || null,
      tiers,
      weaker_tier: weakerTier,
      mismatch_rate_gap: earlyMismatch != null && coreMismatch != null ? Math.abs(earlyMismatch - coreMismatch) : null,
      macro_recall_gap: earlyMacroRecall != null && coreMacroRecall != null ? Math.abs(earlyMacroRecall - coreMacroRecall) : null,
    },
  };
}

module.exports = {
  summarizeExecutionScopeTierComparison,
};
