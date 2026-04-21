"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function pushCheck(checks, id, ok, detail = null) {
  checks.push(Object.freeze({
    id,
    ok: ok === true,
    detail: detail && typeof detail === "object" ? Object.freeze({ ...detail }) : null,
  }));
}

function evaluateRuntimeExecutionChain({
  executedEntry,
  placementRequest,
  protectionWriteResult,
  reductionResult = null,
  preparedAlert = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const request = validateRequiredObject("PLACEMENT_REQUEST", placementRequest);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const entryContract = validateRequiredObject("ENTRY_CONTRACT", executed.entryContract);
  const positionCycle = validateRequiredObject("POSITION_CYCLE", executed.positionCycle);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const writeDecision = validateRequiredObject("PROTECTION_WRITE_DECISION", protection.writeDecision);

  const cycleId = trimOrNull(positionCycle.position_cycle_id);
  const entryEventId = trimOrNull(positionCycle.entry_event_id);
  const entryIntentId = trimOrNull(positionCycle.entry_intent_id || entryContract.entry_intent_id);
  const signalIntentId = trimOrNull(positionCycle.signal_intent_id || entryContract.signal_intent_id);
  const openclawDecisionId = trimOrNull(positionCycle.openclaw_decision_id || entryContract.openclaw_decision_id);
  const signalSourceMode = upper(entryContract.signal_source_mode);
  const decisionMode = upper(entryContract.decision_mode);
  const policyScope = trimOrNull(entryContract.policy_scope);
  const positionStatus = upper(positionCycle.status);

  const checks = [];
  pushCheck(checks, "CHAIN_POSITION_CYCLE_PRESENT", !!cycleId, {
    expected: "position_cycle_id",
    actual: cycleId,
  });
  pushCheck(checks, "CHAIN_ENTRY_EVENT_PRESENT", !!entryEventId, {
    expected: "entry_event_id",
    actual: entryEventId,
  });
  pushCheck(checks, "HANDOFF_POSITION_CYCLE_MATCH", trimOrNull(request.position_cycle_id) === cycleId, {
    expected: cycleId,
    actual: trimOrNull(request.position_cycle_id),
  });
  pushCheck(checks, "HANDOFF_ENTRY_EVENT_MATCH", trimOrNull(request.entry_event_id) === entryEventId, {
    expected: entryEventId,
    actual: trimOrNull(request.entry_event_id),
  });
  pushCheck(checks, "HANDOFF_ENTRY_INTENT_MATCH", trimOrNull(request.entry_intent_id) === entryIntentId, {
    expected: entryIntentId,
    actual: trimOrNull(request.entry_intent_id),
  });
  pushCheck(checks, "HANDOFF_SIGNAL_INTENT_MATCH", trimOrNull(request.signal_intent_id) === signalIntentId, {
    expected: signalIntentId,
    actual: trimOrNull(request.signal_intent_id),
  });
  pushCheck(checks, "HANDOFF_OPENCLAW_DECISION_MATCH", trimOrNull(request.openclaw_decision_id) === openclawDecisionId, {
    expected: openclawDecisionId,
    actual: trimOrNull(request.openclaw_decision_id),
  });
  pushCheck(checks, "HANDOFF_SIGNAL_SOURCE_MODE_MATCH", upper(request.signal_source_mode) === signalSourceMode, {
    expected: signalSourceMode,
    actual: upper(request.signal_source_mode),
  });
  pushCheck(checks, "HANDOFF_DECISION_MODE_MATCH", upper(request.decision_mode) === decisionMode, {
    expected: decisionMode,
    actual: upper(request.decision_mode),
  });
  pushCheck(checks, "HANDOFF_POLICY_SCOPE_MATCH", trimOrNull(request.policy_scope) === policyScope, {
    expected: policyScope,
    actual: trimOrNull(request.policy_scope),
  });
  pushCheck(checks, "PROTECTION_RUNTIME_POSITION_CYCLE_MATCH", trimOrNull(runtimeDoc.position_cycle_id) === cycleId, {
    expected: cycleId,
    actual: trimOrNull(runtimeDoc.position_cycle_id),
  });

  const downstreamRequested = !!reductionResult || !!preparedAlert;
  if (downstreamRequested) {
    pushCheck(checks, "RUNTIME_CHAIN_PROTECTION_NOT_READY", writeDecision.ok === true, {
      expected: true,
      actual: writeDecision.ok === true,
      health_status: upper(runtimeDoc.health_status),
      runtime_write_reason: trimOrNull(writeDecision.runtime_write_reason),
    });
    pushCheck(checks, "RUNTIME_CHAIN_PROTECTION_HEALTHY", upper(runtimeDoc.health_status) === "HEALTHY", {
      expected: "HEALTHY",
      actual: upper(runtimeDoc.health_status),
    });
    pushCheck(checks, "RUNTIME_CHAIN_POSITION_ACTIVE_PROTECTED", positionStatus === "ACTIVE_PROTECTED", {
      expected: "ACTIVE_PROTECTED",
      actual: positionStatus,
    });
  }

  if (reductionResult) {
    const reduced = validateRequiredObject("REDUCTION_RESULT", reductionResult);
    const transition = validateRequiredObject("REDUCTION_TRANSITION", reduced.transition);
    const nextProjection = validateRequiredObject("REDUCTION_NEXT_PROJECTION", reduced.nextProjection);
    pushCheck(checks, "REDUCTION_POSITION_CYCLE_MATCH", trimOrNull(transition.position_cycle_id) === cycleId, {
      expected: cycleId,
      actual: trimOrNull(transition.position_cycle_id),
    });
    pushCheck(checks, "REDUCTION_ENTRY_EVENT_MATCH", trimOrNull(transition.entry_event_id) === entryEventId, {
      expected: entryEventId,
      actual: trimOrNull(transition.entry_event_id),
    });
    pushCheck(checks, "REDUCTION_PROJECTION_POSITION_CYCLE_MATCH", trimOrNull(nextProjection.position_cycle_id) === cycleId, {
      expected: cycleId,
      actual: trimOrNull(nextProjection.position_cycle_id),
    });
  }

  if (preparedAlert) {
    const prepared = validateRequiredObject("PREPARED_ALERT", preparedAlert);
    const outbox = validateRequiredObject("ALERT_OUTBOX", prepared.outbox);
    const payload = validateRequiredObject("ALERT_PAYLOAD", prepared.payload);
    pushCheck(checks, "ALERT_PREPARED_OK", prepared.ok === true, {
      expected: true,
      actual: prepared.ok === true,
      reason: trimOrNull(prepared.reason),
    });
    if (reductionResult) {
      const transition = reductionResult.transition;
      pushCheck(checks, "ALERT_OUTBOX_TRANSITION_MATCH", trimOrNull(outbox.canonical_transition_id) === trimOrNull(transition.canonical_transition_id), {
        expected: trimOrNull(transition.canonical_transition_id),
        actual: trimOrNull(outbox.canonical_transition_id),
      });
      pushCheck(checks, "ALERT_OUTBOX_POSITION_CYCLE_MATCH", trimOrNull(outbox.position_cycle_id) === cycleId, {
        expected: cycleId,
        actual: trimOrNull(outbox.position_cycle_id),
      });
      pushCheck(checks, "ALERT_PAYLOAD_POSITION_CYCLE_MATCH", trimOrNull(payload.position_cycle_id) === cycleId, {
        expected: cycleId,
        actual: trimOrNull(payload.position_cycle_id),
      });
      pushCheck(checks, "ALERT_PAYLOAD_EVENT_MATCH", upper(payload.event) === upper(transition.transition_event), {
        expected: upper(transition.transition_event),
        actual: upper(payload.event),
      });
      pushCheck(checks, "ALERT_PAYLOAD_STAGE_MATCH", upper(payload.stage) === upper(transition.next_stage), {
        expected: upper(transition.next_stage),
        actual: upper(payload.stage),
      });
    }
  }

  const failedChecks = checks.filter((check) => check.ok !== true);
  return Object.freeze({
    ok: failedChecks.length === 0,
    check_n: checks.length,
    fail_n: failedChecks.length,
    failed_check_ids: Object.freeze(failedChecks.map((check) => check.id)),
    checks: Object.freeze(checks),
  });
}

function assertRuntimeExecutionChain(input) {
  const audit = evaluateRuntimeExecutionChain(input);
  if (audit.ok) return audit;
  const error = new Error(audit.failed_check_ids[0] || "RUNTIME_EXECUTION_CHAIN_INVALID");
  error.audit = audit;
  throw error;
}

module.exports = {
  evaluateRuntimeExecutionChain,
  assertRuntimeExecutionChain,
  __test: {
    trimOrNull,
    upper,
    validateRequiredObject,
  },
};
