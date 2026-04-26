"use strict";

const { buildOpenClawExecutionAuditDoc } = require("./contracts");
const { putV2Doc } = require("./storage");

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function isOpenClawExecutionAuditLedgerWriteEnabled(env = process.env) {
  return parseBool(env.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, false);
}

async function persistOpenClawExecutionAudit({
  audit,
  db = null,
  env = process.env,
  positionCycleId = null,
  source = "PROMOTION_RUNTIME_COLLECTOR",
  artifactRunId = null,
  recordedAt = null,
  riskGovernorSurface = null,
} = {}) {
  const doc = buildOpenClawExecutionAuditDoc({
    audit,
    positionCycleId,
    source,
    artifactRunId,
    recordedAt,
    riskGovernorSurface,
  });

  if (!isOpenClawExecutionAuditLedgerWriteEnabled(env)) {
    return Object.freeze({
      ok: true,
      skipped: true,
      reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED",
      doc,
      persisted: null,
    });
  }

  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_EXECUTION_AUDITS",
    doc,
    merge: true,
  });

  return Object.freeze({
    ok: true,
    skipped: false,
    reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
    doc,
    persisted,
  });
}

module.exports = {
  isOpenClawExecutionAuditLedgerWriteEnabled,
  persistOpenClawExecutionAudit,
  __test: {
    parseBool,
  },
};
