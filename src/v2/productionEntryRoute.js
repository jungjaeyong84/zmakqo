"use strict";

const { resolveV2RuntimeConfig } = require("./runtime");
const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { runV2EntryExecutionKernel } = require("./entryExecutionKernel");
const { evaluateOpenClawExecutionSeparation } = require("./openclawExecutionSeparationAudit");
const { persistOpenClawExecutionAudit } = require("./openclawExecutionAuditLedger");
const { validateOpenClawExecutionPermit } = require("./openclawExecutionPermit");
const { queryV2DocsByField } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function summarizeRuntimeConfig(cfg) {
  return Object.freeze({
    enabled: cfg.enabled === true,
    dry_run: cfg.dryRun === true,
    canary_only: cfg.canaryOnly === true,
    exchange: trimOrNull(cfg.exchange),
    namespace: trimOrNull(cfg.namespace),
    collection_prefix: trimOrNull(cfg.collectionPrefix),
  });
}

function buildRouteBlock(reason, extra = {}) {
  return Object.freeze({
    ok: false,
    reason,
    ...extra,
  });
}

function buildRouteAllow(extra = {}) {
  return Object.freeze({
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
    ...extra,
  });
}

function extractExecutedEntry(kernelResult) {
  const result = asObject(kernelResult);
  const submitterResult = asObject(result && result.submitterResult);
  return asObject(submitterResult && submitterResult.executedEntry);
}

function extractSubmitterResult(kernelResult) {
  const result = asObject(kernelResult);
  return asObject(result && result.submitterResult);
}

function summarizePostFillSideEffect(kernelResult) {
  const submitterResult = extractSubmitterResult(kernelResult);
  const fill = asObject(submitterResult && submitterResult.fill);
  const executedEntry = asObject(submitterResult && submitterResult.executedEntry);
  const positionCycle = asObject(executedEntry && executedEntry.positionCycle);
  const protectionEvidence = asObject(submitterResult && submitterResult.protectionEvidence);
  const recoveryResult = asObject(submitterResult && submitterResult.recoveryResult);
  const fillStatus = upper(fill && fill.status);
  const entryOrderId = trimOrNull(
    (fill && fill.entry_order_id)
      || (fill && fill.exchange_order_id)
      || (fill && fill.submitted_order_id)
      || (executedEntry && executedEntry.entry_order_id),
  );
  const exchangeWritePerformed = fillStatus === "FILLED" && !!entryOrderId;
  const protectionOk = protectionEvidence && protectionEvidence.ok === true;
  const unprotectedPositionPossible = exchangeWritePerformed && protectionOk !== true;
  return Object.freeze({
    exchange_write_performed: exchangeWritePerformed,
    entry_order_id: entryOrderId,
    entry_event_id: trimOrNull(fill && fill.entry_event_id),
    position_cycle_id: trimOrNull(positionCycle && positionCycle.position_cycle_id),
    protection_ok: protectionOk === true,
    protection_recovery_attempted: recoveryResult ? recoveryResult.attempted === true : false,
    protection_recovery_ok: recoveryResult ? recoveryResult.ok === true : null,
    protection_recovery_reason: trimOrNull(recoveryResult && recoveryResult.reason),
    unprotected_position_possible: unprotectedPositionPossible,
    severity: unprotectedPositionPossible ? "CRITICAL" : "NONE",
    reason: unprotectedPositionPossible
      ? "POST_FILL_PROTECTION_NOT_CONFIRMED"
      : "NO_UNPROTECTED_POST_FILL_SIDE_EFFECT",
  });
}

function extractDecisionBundleHash(bundle) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  return trimOrNull(row && row.openclawDecisionBundleHash)
    || trimOrNull(decision && decision.openclaw_decision_bundle_hash);
}

async function findExistingDecisionBundleExecution({
  db = null,
  env = process.env,
  bundle,
} = {}) {
  const bundleHash = extractDecisionBundleHash(bundle);
  if (!bundleHash) {
    return Object.freeze({
      ok: false,
      replay: false,
      reason: "OPENCLAW_DECISION_BUNDLE_HASH_REQUIRED",
      openclaw_decision_bundle_hash: null,
      existing_execution_audit: null,
    });
  }
  const query = await queryV2DocsByField({
    db,
    env,
    collectionKey: "OPENCLAW_EXECUTION_AUDITS",
    field: "openclaw_decision_bundle_hash",
    value: bundleHash,
    limit: 1,
  });
  const existing = Array.isArray(query.rows) && query.rows.length ? query.rows[0] : null;
  return Object.freeze({
    ok: true,
    replay: !!existing,
    reason: existing
      ? "OPENCLAW_DECISION_BUNDLE_EXECUTION_ALREADY_EXISTS"
      : "OPENCLAW_DECISION_BUNDLE_EXECUTION_NOT_FOUND",
    openclaw_decision_bundle_hash: bundleHash,
    existing_execution_audit: existing ? Object.freeze({ ...existing }) : null,
  });
}

async function runV2ProductionEntryRoute({
  db = null,
  env = process.env,
  bundle,
  entryTransport,
  protectionTransports,
  executionPermit = null,
  worldState = null,
  runEntryKernel = runV2EntryExecutionKernel,
  persistExecutionAudit = persistOpenClawExecutionAudit,
  validateExecutionPermit = validateOpenClawExecutionPermit,
  findExistingBundleExecution = findExistingDecisionBundleExecution,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
} = {}) {
  if (typeof runEntryKernel !== "function") throw new Error("RUN_ENTRY_KERNEL_REQUIRED");
  if (typeof persistExecutionAudit !== "function") throw new Error("PERSIST_EXECUTION_AUDIT_REQUIRED");
  if (typeof validateExecutionPermit !== "function") throw new Error("VALIDATE_EXECUTION_PERMIT_REQUIRED");
  if (typeof findExistingBundleExecution !== "function") throw new Error("FIND_EXISTING_BUNDLE_EXECUTION_REQUIRED");

  const runtimeConfig = resolveV2RuntimeConfig(env);
  const runtime = summarizeRuntimeConfig(runtimeConfig);

  if (!runtimeConfig.enabled) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DISABLED", {
      runtime,
      routedDecision: null,
      kernelResult: null,
      executionPermitValidation: null,
      openclawExecutionAudit: null,
      auditLedgerResult: null,
    });
  }
  if (runtimeConfig.dryRun) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED", {
      runtime,
      routedDecision: null,
      kernelResult: null,
      executionPermitValidation: null,
      openclawExecutionAudit: null,
      auditLedgerResult: null,
    });
  }

  const routedDecision = resolveEntryIntentFromOpenClaw(bundle);
  const preExecutionAudit = evaluateOpenClawExecutionSeparation({
    bundle,
    routedDecision,
    now,
  });

  if (!routedDecision.ok) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_ROUTER_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation: null,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  const entryIntent = routedDecision.entryIntent;
  if (runtimeConfig.canaryOnly && upper(entryIntent && entryIntent.decision_mode) === "LIVE") {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_LIVE_BLOCKED_BY_CANARY_ONLY", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation: null,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  const currentWorldState = asObject(worldState);
  if (executionPermit && (!currentWorldState || !trimOrNull(currentWorldState.world_state_hash))) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_PERMIT_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation: Object.freeze({
        ok: false,
        reason: "OPENCLAW_EXECUTION_PERMIT_CURRENT_WORLD_STATE_REQUIRED",
        check_n: 1,
        fail_n: 1,
        failed_check_ids: Object.freeze(["PERMIT_CURRENT_WORLD_STATE_REQUIRED"]),
        checks: Object.freeze([
          Object.freeze({
            id: "PERMIT_CURRENT_WORLD_STATE_REQUIRED",
            ok: false,
            detail: Object.freeze({
              world_state_hash: null,
            }),
          }),
        ]),
      }),
      openclawExecutionAudit: preExecutionAudit,
      decisionBundleReplayGuard: null,
      auditLedgerResult: null,
    });
  }

  const executionPermitValidation = validateExecutionPermit({
    permit: executionPermit,
    bundle,
    worldState,
    now,
  });
  if (!executionPermitValidation || executionPermitValidation.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_PERMIT_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      openclawExecutionAudit: preExecutionAudit,
      decisionBundleReplayGuard: null,
      auditLedgerResult: null,
    });
  }

  let decisionBundleReplayGuard = null;
  try {
    decisionBundleReplayGuard = await findExistingBundleExecution({
      db,
      env,
      bundle,
      executionPermit,
      worldState,
      routedDecision,
      now,
    });
  } catch (error) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_GUARD_FAILED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard: Object.freeze({
        ok: false,
        replay: false,
        reason: "OPENCLAW_DECISION_BUNDLE_REPLAY_GUARD_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (!decisionBundleReplayGuard || decisionBundleReplayGuard.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_GUARD_FAILED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (decisionBundleReplayGuard.replay === true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  const kernelResult = await runEntryKernel({
    db,
    env,
    entryIntent,
    entryTransport,
    protectionTransports,
    now,
    placementRetryId,
    stopLossPct,
    tp1TargetPct,
    tp1QtyRatio,
  });
  const postFillSideEffect = summarizePostFillSideEffect(kernelResult);
  if (!kernelResult || kernelResult.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_KERNEL_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (postFillSideEffect.unprotected_position_possible === true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  const executedEntry = extractExecutedEntry(kernelResult);
  const openclawExecutionAudit = evaluateOpenClawExecutionSeparation({
    bundle,
    routedDecision,
    executedEntry,
    now,
  });

  let auditLedgerResult = null;
  try {
    auditLedgerResult = await persistExecutionAudit({
      audit: openclawExecutionAudit,
      db,
      env,
      positionCycleId: trimOrNull(executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id),
      source: "PRODUCTION_ENTRY_ROUTE",
      recordedAt: trimOrNull(now()) || new Date().toISOString(),
    });
  } catch (error) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_AUDIT_LEDGER_FAILED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit,
      auditLedgerResult: Object.freeze({
        ok: false,
        reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
    });
  }

  if (!openclawExecutionAudit.ok) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit,
      auditLedgerResult,
    });
  }

  if (auditLedgerResult && auditLedgerResult.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_AUDIT_LEDGER_NOT_OK", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      openclawExecutionAudit,
      auditLedgerResult,
    });
  }

  return buildRouteAllow({
    runtime,
    routedDecision,
    kernelResult,
    post_fill_side_effect: postFillSideEffect,
    executionPermitValidation,
    decisionBundleReplayGuard,
    openclawExecutionAudit,
    auditLedgerResult,
  });
}

module.exports = {
  runV2ProductionEntryRoute,
  __test: {
    trimOrNull,
    upper,
    asObject,
    summarizeRuntimeConfig,
    extractExecutedEntry,
    extractSubmitterResult,
    summarizePostFillSideEffect,
    extractDecisionBundleHash,
    findExistingDecisionBundleExecution,
  },
};
