"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function envNum(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function readRows(value) {
  if (!value || typeof value !== "object") return [];
  return Array.isArray(value.rows) ? value.rows : [];
}

function countRows(rows, predicate) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    try {
      return predicate(row);
    } catch (_err) {
      return false;
    }
  }).length;
}

function deriveModelReadiness(value = null) {
  const summary = readSummary(value);
  const rows = readRows(value);
  const rowsN = toNum(summary.rows_n) || 0;
  const validN = toNum(summary.valid_n) || 0;
  const invalidN = toNum(summary.invalid_n) || 0;
  const realizedN = toNum(summary.realized_n) || 0;
  const minRows = Math.max(50, envNum("OPENCLAW_MODEL_READINESS_MIN_ROWS", 100));
  const minRealized = Math.max(5, envNum("OPENCLAW_MODEL_READINESS_MIN_REALIZED", 10));

  const rowReady = rowsN >= minRows;
  const realizedReady = realizedN >= minRealized;
  const integrityReady = invalidN === 0 && validN === rowsN;
  const tp0TimeLabeledN = countRows(rows, (row) => Number.isFinite(toNum(row && row.lifecycle && row.lifecycle.time_to_tp0_minutes)));
  const tp1TimeLabeledN = countRows(rows, (row) => Number.isFinite(toNum(row && row.lifecycle && row.lifecycle.time_to_tp1_minutes)));
  const mfeMaeLabeledN = countRows(rows, (row) => (
    Number.isFinite(toNum(row && row.lifecycle && row.lifecycle.mfe_pct))
    && Number.isFinite(toNum(row && row.lifecycle && row.lifecycle.mae_pct))
  ));
  const tp0ToTp1ConvertedN = countRows(rows, (row) => row && row.lifecycle && row.lifecycle.tp0_to_tp1_converted === true);
  const preTp1TimeStopN = countRows(rows, (row) => row && row.lifecycle && row.lifecycle.pre_tp1_time_stop === true);

  let status = "MODEL_READINESS_BLOCKED";
  if (rowReady && realizedReady && integrityReady) status = "MODEL_READINESS_READY";
  else if ((rowReady && integrityReady) || (realizedReady && integrityReady)) status = "MODEL_READINESS_BOOTSTRAPPING";

  return {
    status,
    rows_n: rowsN,
    valid_n: validN,
    invalid_n: invalidN,
    realized_n: realizedN,
    min_rows: minRows,
    min_realized_n: minRealized,
    row_ready: rowReady,
    realized_ready: realizedReady,
    integrity_ready: integrityReady,
    tp0_time_labeled_n: tp0TimeLabeledN,
    tp1_time_labeled_n: tp1TimeLabeledN,
    mfe_mae_labeled_n: mfeMaeLabeledN,
    tp0_to_tp1_converted_n: tp0ToTp1ConvertedN,
    pre_tp1_time_stop_n: preTp1TimeStopN,
    tp0_time_label_rate: rowsN > 0 ? (tp0TimeLabeledN / rowsN) : null,
    tp1_time_label_rate: rowsN > 0 ? (tp1TimeLabeledN / rowsN) : null,
    mfe_mae_label_rate: rowsN > 0 ? (mfeMaeLabeledN / rowsN) : null,
    schema_version: String(value && value.schema_version || "").trim() || null,
  };
}

module.exports = {
  deriveModelReadiness,
};
