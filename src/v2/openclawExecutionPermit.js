"use strict";

const { buildOpenClawExecutionPermitDoc } = require("./contracts");
const { putV2Doc } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function addMinutesIso(iso, minutes) {
  const baseMs = Date.parse(iso);
  const ttl = Number(minutes);
  if (!Number.isFinite(baseMs)) throw new Error("ISSUED_AT_INVALID");
  return new Date(baseMs + Math.max(1, Number.isFinite(ttl) ? ttl : 5) * 60_000).toISOString();
}

function extractBundleDecision(bundle) {
  const row = asObject(bundle);
  if (!row) throw new Error("OPENCLAW_BUNDLE_REQUIRED");
  const signalIntent = asObject(row.signalIntent);
  const openclawDecision = asObject(row.openclawDecision);
  if (!signalIntent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!openclawDecision) throw new Error("OPENCLAW_DECISION_REQUIRED");
  return Object.freeze({ signalIntent, openclawDecision });
}

function issueOpenClawExecutionPermit({
  bundle,
  worldState,
  sizingCap = null,
  riskBudget = null,
  exitContract = null,
  approvalReason = "OPENCLAW_WORLD_STATE_APPROVED",
  source = "OPENCLAW_SUPREME_CONTROL_PLANE",
  issuedAt = null,
  ttlMinutes = 5,
  expiresAt = null,
} = {}) {
  const { signalIntent, openclawDecision } = extractBundleDecision(bundle);
  const state = asObject(worldState);
  if (!state) throw new Error("OPENCLAW_WORLD_STATE_REQUIRED");
  const worldStateHash = trimOrNull(state.world_state_hash);
  if (!worldStateHash) throw new Error("WORLD_STATE_HASH_REQUIRED");
  const issued = trimOrNull(issuedAt) || new Date().toISOString();
  const expires = trimOrNull(expiresAt) || addMinutesIso(issued, ttlMinutes);
  return Object.freeze(buildOpenClawExecutionPermitDoc({
    openclawDecisionId: openclawDecision.openclaw_decision_id,
    signalIntentId: signalIntent.signal_intent_id,
    worldStateHash,
    decisionMode: openclawDecision.decision_mode,
    symbol: signalIntent.symbol,
    side: signalIntent.side,
    recommendedAction: openclawDecision.recommended_action,
    permitStatus: "ISSUED",
    sizingCap: sizingCap || {
      max_size_ratio: rowNumberOrNull(openclawDecision.canonical_evidence_summary && openclawDecision.canonical_evidence_summary.ml_ai_signal_proposal && openclawDecision.canonical_evidence_summary.ml_ai_signal_proposal.size_ratio),
    },
    riskBudget: riskBudget || {},
    exitContract: exitContract || {
      tp1_qty_ratio: 0.5,
      tp1_target_pct: 0.0168,
      tp0_supported: false,
    },
    approvalReason,
    issuedAt: issued,
    expiresAt: expires,
    source,
  }));
}

function rowNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildPermitCheck(id, ok, detail = null) {
  return Object.freeze({
    id,
    ok: ok === true,
    detail: asObject(detail) ? Object.freeze({ ...detail }) : null,
  });
}

function validateOpenClawExecutionPermit({
  permit,
  bundle,
  worldState = null,
  now = () => new Date().toISOString(),
} = {}) {
  const checks = [];
  const doc = asObject(permit);
  let signalIntent = null;
  let openclawDecision = null;
  try {
    const extracted = extractBundleDecision(bundle);
    signalIntent = extracted.signalIntent;
    openclawDecision = extracted.openclawDecision;
  } catch (error) {
    checks.push(buildPermitCheck("PERMIT_BUNDLE_VALID", false, { reason: trimOrNull(error && error.message) }));
  }

  checks.push(buildPermitCheck("PERMIT_PRESENT", !!doc));
  if (!doc) {
    return finalizePermitValidation(checks, "OPENCLAW_EXECUTION_PERMIT_REQUIRED");
  }

  const nowMs = Date.parse(trimOrNull(now()) || new Date().toISOString());
  const expiresMs = Date.parse(trimOrNull(doc.expires_at));
  checks.push(buildPermitCheck("PERMIT_STATUS_ISSUED", upper(doc.permit_status) === "ISSUED", {
    permit_status: upper(doc.permit_status),
  }));
  checks.push(buildPermitCheck("PERMIT_NOT_EXPIRED", Number.isFinite(nowMs) && Number.isFinite(expiresMs) && expiresMs > nowMs, {
    now: Number.isFinite(nowMs) ? new Date(nowMs).toISOString() : null,
    expires_at: trimOrNull(doc.expires_at),
  }));

  if (signalIntent && openclawDecision) {
    checks.push(buildPermitCheck("PERMIT_DECISION_MATCH", trimOrNull(doc.openclaw_decision_id) === trimOrNull(openclawDecision.openclaw_decision_id), {
      expected: trimOrNull(openclawDecision.openclaw_decision_id),
      actual: trimOrNull(doc.openclaw_decision_id),
    }));
    checks.push(buildPermitCheck("PERMIT_SIGNAL_INTENT_MATCH", trimOrNull(doc.signal_intent_id) === trimOrNull(signalIntent.signal_intent_id), {
      expected: trimOrNull(signalIntent.signal_intent_id),
      actual: trimOrNull(doc.signal_intent_id),
    }));
    checks.push(buildPermitCheck("PERMIT_DECISION_MODE_MATCH", upper(doc.decision_mode) === upper(openclawDecision.decision_mode), {
      expected: upper(openclawDecision.decision_mode),
      actual: upper(doc.decision_mode),
    }));
    checks.push(buildPermitCheck("PERMIT_SYMBOL_SIDE_MATCH", upper(doc.symbol) === upper(signalIntent.symbol) && upper(doc.side) === upper(signalIntent.side), {
      expected_symbol: upper(signalIntent.symbol),
      actual_symbol: upper(doc.symbol),
      expected_side: upper(signalIntent.side),
      actual_side: upper(doc.side),
    }));
    checks.push(buildPermitCheck("PERMIT_RECOMMENDED_ACTION_MATCH", upper(doc.recommended_action) === upper(openclawDecision.recommended_action), {
      expected: upper(openclawDecision.recommended_action),
      actual: upper(doc.recommended_action),
    }));
  }

  const state = asObject(worldState);
  if (state) {
    checks.push(buildPermitCheck("PERMIT_WORLD_STATE_HASH_MATCH", trimOrNull(doc.world_state_hash) === trimOrNull(state.world_state_hash), {
      expected: trimOrNull(state.world_state_hash),
      actual: trimOrNull(doc.world_state_hash),
    }));
  } else {
    checks.push(buildPermitCheck("PERMIT_WORLD_STATE_HASH_PRESENT", !!trimOrNull(doc.world_state_hash), {
      world_state_hash: trimOrNull(doc.world_state_hash),
    }));
  }

  return finalizePermitValidation(checks);
}

function finalizePermitValidation(checks, missingReason = null) {
  const failed = checks.filter((check) => check.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "OPENCLAW_EXECUTION_PERMIT_VALID" : (missingReason || "OPENCLAW_EXECUTION_PERMIT_INVALID"),
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((check) => check.id)),
    checks: Object.freeze(checks),
  });
}

async function persistOpenClawExecutionPermit({
  permit,
  db = null,
  env = process.env,
  merge = true,
} = {}) {
  const doc = asObject(permit);
  if (!doc) throw new Error("OPENCLAW_EXECUTION_PERMIT_REQUIRED");
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_EXECUTION_PERMITS",
    doc,
    merge,
  });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_WRITTEN",
    openclaw_execution_permit_id: trimOrNull(doc.openclaw_execution_permit_id),
    persisted,
  });
}

module.exports = {
  issueOpenClawExecutionPermit,
  validateOpenClawExecutionPermit,
  persistOpenClawExecutionPermit,
  __test: {
    trimOrNull,
    upper,
    asObject,
    addMinutesIso,
    extractBundleDecision,
    rowNumberOrNull,
  },
};
