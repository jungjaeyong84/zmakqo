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

function deriveModelReadiness(value = null) {
  const summary = readSummary(value);
  const rowsN = toNum(summary.rows_n) || 0;
  const validN = toNum(summary.valid_n) || 0;
  const invalidN = toNum(summary.invalid_n) || 0;
  const realizedN = toNum(summary.realized_n) || 0;
  const minRows = Math.max(50, envNum("OPENCLAW_MODEL_READINESS_MIN_ROWS", 100));
  const minRealized = Math.max(5, envNum("OPENCLAW_MODEL_READINESS_MIN_REALIZED", 10));

  const rowReady = rowsN >= minRows;
  const realizedReady = realizedN >= minRealized;
  const integrityReady = invalidN === 0 && validN === rowsN;

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
    schema_version: String(value && value.schema_version || "").trim() || null,
  };
}

module.exports = {
  deriveModelReadiness,
};
