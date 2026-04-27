"use strict";

const { resolveV2RuntimeConfig } = require("./runtime");
const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { runV2EntryExecutionKernel } = require("./entryExecutionKernel");
const { evaluateOpenClawExecutionSeparation } = require("./openclawExecutionSeparationAudit");
const { persistOpenClawExecutionAudit } = require("./openclawExecutionAuditLedger");
const { validateOpenClawExecutionPermit } = require("./openclawExecutionPermit");
const { queryV2DocsByField, resolveV2CollectionRef } = require("./storage");
const { evaluateV2SameDirectionCooldown, extractCurrentSignalContext } = require("./sameDirectionCooldown");

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

// Stage C — leverage 가 entry → kernel → submitter → entryBootstrap →
// protectionModel 까지 흘러가야 V2 protection plan 의 leverage 정규화 (Stage
// A/B/D) 가 prod 에서 발효된다. 후보 우선순위는 caller (entryIntent) 가 가장
// 강하고, 그다음 openclawDecision, signalIntent, env fallback 순.
//
// 모든 후보가 비어있으면 null 반환 → protectionModel 은 silent (raw mode 유지).
// Stage D 에서 env flag flip 후에도 leverage>1 이 안 들어오면 raw 동작 유지하기에
// 안전.
function resolveProductionEntryLeverage({ entryIntent, bundle, env } = {}) {
  const intent = asObject(entryIntent);
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  const evidence = asObject(decision && decision.canonical_evidence_summary);
  const signalIntent = asObject(row && row.signalIntent);
  const envObj = asObject(env) || {};
  const candidates = [
    intent && intent.leverage,
    intent && intent.futures_leverage,
    decision && decision.leverage,
    decision && decision.futures_leverage,
    evidence && evidence.leverage,
    evidence && evidence.futures_leverage,
    signalIntent && signalIntent.leverage,
    signalIntent && signalIntent.futures_leverage,
    envObj.V2_FUTURES_DEFAULT_LEVERAGE,
    envObj.DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE,
  ];
  for (const cand of candidates) {
    if (cand === undefined || cand === null || cand === "") continue;
    const num = Number(cand);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
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
  const protectionResult = asObject(submitterResult && submitterResult.protectionResult);
  const recoveryResult = asObject(submitterResult && submitterResult.recoveryResult);
  const initialRepairQueue = asObject(protectionResult && protectionResult.repairQueueCommit);
  const recoveryProtectionResult = asObject(recoveryResult && recoveryResult.protectionResult);
  const recoveryInitialProtectionResult = asObject(recoveryResult && recoveryResult.initialProtectionResult);
  const recoveryRepairQueue = asObject(recoveryProtectionResult && recoveryProtectionResult.repairQueueCommit)
    || asObject(recoveryInitialProtectionResult && recoveryInitialProtectionResult.repairQueueCommit)
    || asObject(recoveryResult && recoveryResult.repairQueueCommit);
  const repairQueueCommit = recoveryRepairQueue || initialRepairQueue;
  const fillStatus = upper(fill && fill.status);
  const entryOrderId = trimOrNull(
    (fill && fill.entry_order_id)
      || (fill && fill.exchange_order_id)
      || (fill && fill.submitted_order_id)
      || (executedEntry && executedEntry.entry_order_id),
  );
  const exchangeWritePerformed = !!entryOrderId && (
    fillStatus === "FILLED"
    || fillStatus === "NEW"
    || fillStatus === "PARTIALLY_FILLED"
  );
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
    protection_repair_queued: !!repairQueueCommit,
    protection_repair_queue_ok: repairQueueCommit ? repairQueueCommit.ok === true : null,
    protection_repair_queue_reason: trimOrNull(repairQueueCommit && repairQueueCommit.reason),
    protection_repair_request_id: trimOrNull(
      repairQueueCommit && (
        repairQueueCommit.exit_repair_request_id
        || repairQueueCommit.repair_request_id
        || repairQueueCommit.request_id
      ),
    ),
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

function extractExecutionPermitId(permit) {
  const row = asObject(permit);
  return trimOrNull(row && row.openclaw_execution_permit_id);
}

function stableIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160);
}

function buildExecutionClaimId({ bundleHash, permitId } = {}) {
  const hashPart = stableIdPart(bundleHash);
  const permitPart = stableIdPart(permitId);
  if (!hashPart || !permitPart) return null;
  return `OCEXCLAIMV2__${hashPart}__${permitPart}`;
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

async function claimOpenClawExecution({
  db = null,
  env = process.env,
  bundle,
  executionPermit,
  routedDecision = null,
  now = () => new Date().toISOString(),
} = {}) {
  const bundleHash = extractDecisionBundleHash(bundle);
  const permitId = extractExecutionPermitId(executionPermit);
  const claimId = buildExecutionClaimId({ bundleHash, permitId });
  if (!bundleHash) {
    return Object.freeze({ ok: false, claimed: false, replay: false, reason: "OPENCLAW_EXECUTION_CLAIM_BUNDLE_HASH_REQUIRED" });
  }
  if (!permitId || !claimId) {
    return Object.freeze({ ok: false, claimed: false, replay: false, reason: "OPENCLAW_EXECUTION_CLAIM_PERMIT_ID_REQUIRED" });
  }

  const claims = resolveV2CollectionRef({ db, env, collectionKey: "OPENCLAW_EXECUTION_CLAIMS" });
  const permits = resolveV2CollectionRef({ db: claims.db, env, collectionKey: "OPENCLAW_EXECUTION_PERMITS" });
  const firestore = claims.db;
  if (!firestore || typeof firestore.runTransaction !== "function") {
    return Object.freeze({ ok: false, claimed: false, replay: false, reason: "OPENCLAW_EXECUTION_CLAIM_TRANSACTION_REQUIRED" });
  }

  const claimedAt = trimOrNull(now()) || new Date().toISOString();
  const claimRef = claims.ref.doc(claimId);
  const permitRef = permits.ref.doc(permitId);
  return firestore.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    const permitSnap = await tx.get(permitRef);
    if (claimSnap && claimSnap.exists === true) {
      const existing = claimSnap.data ? (claimSnap.data() || {}) : {};
      return Object.freeze({
        ok: true,
        claimed: false,
        replay: true,
        reason: "OPENCLAW_EXECUTION_CLAIM_ALREADY_EXISTS",
        openclaw_execution_claim_id: claimId,
        openclaw_decision_bundle_hash: bundleHash,
        openclaw_execution_permit_id: permitId,
        existing_claim: Object.freeze({ ...existing }),
      });
    }
    if (!permitSnap || permitSnap.exists !== true) {
      return Object.freeze({
        ok: false,
        claimed: false,
        replay: false,
        reason: "OPENCLAW_EXECUTION_PERMIT_LEDGER_DOC_REQUIRED",
        openclaw_execution_claim_id: claimId,
        openclaw_decision_bundle_hash: bundleHash,
        openclaw_execution_permit_id: permitId,
      });
    }
    const permitDoc = permitSnap.data ? (permitSnap.data() || {}) : {};
    const permitStatus = upper(permitDoc.permit_status);
    if (permitStatus !== "ISSUED") {
      return Object.freeze({
        ok: false,
        claimed: false,
        replay: true,
        reason: "OPENCLAW_EXECUTION_PERMIT_ALREADY_CLAIMED",
        openclaw_execution_claim_id: claimId,
        openclaw_decision_bundle_hash: bundleHash,
        openclaw_execution_permit_id: permitId,
        permit_status: permitStatus,
      });
    }
    const entryIntent = asObject(routedDecision && routedDecision.entryIntent);
    const claimDoc = {
      openclaw_execution_claim_id: claimId,
      openclaw_decision_bundle_hash: bundleHash,
      openclaw_execution_permit_id: permitId,
      claim_status: "CLAIMED",
      claimed_at: claimedAt,
      symbol: upper(entryIntent && entryIntent.symbol) || upper(executionPermit && executionPermit.symbol),
      side: upper(entryIntent && entryIntent.side) || upper(executionPermit && executionPermit.side),
      decision_mode: upper(entryIntent && entryIntent.decision_mode) || upper(executionPermit && executionPermit.decision_mode),
      source: "PRODUCTION_ENTRY_ROUTE",
      schema_version: 1,
    };
    tx.set(claimRef, claimDoc, { merge: false });
    tx.set(permitRef, {
      permit_status: "CLAIMED",
      execution_claim_id: claimId,
      claimed_at: claimedAt,
      claim_source: "PRODUCTION_ENTRY_ROUTE",
    }, { merge: true });
    return Object.freeze({
      ok: true,
      claimed: true,
      replay: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_ACQUIRED",
      openclaw_execution_claim_id: claimId,
      openclaw_decision_bundle_hash: bundleHash,
      openclaw_execution_permit_id: permitId,
      claim_doc: Object.freeze({ ...claimDoc }),
    });
  });
}

async function finalizeOpenClawExecutionClaim({
  db = null,
  env = process.env,
  executionClaim,
  executionPermit,
  status,
  reason,
  positionCycleId = null,
  auditLedgerResult = null,
  postFillSideEffect = null,
  now = () => new Date().toISOString(),
} = {}) {
  const claimId = trimOrNull(executionClaim && executionClaim.openclaw_execution_claim_id);
  const permitId = trimOrNull(executionClaim && executionClaim.openclaw_execution_permit_id) || extractExecutionPermitId(executionPermit);
  if (!claimId || !permitId) {
    return Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZE_ID_REQUIRED",
      openclaw_execution_claim_id: claimId,
      openclaw_execution_permit_id: permitId,
    });
  }
  const finalizedAt = trimOrNull(now()) || new Date().toISOString();
  const claimStatus = upper(status) || "FINALIZED";
  const claims = resolveV2CollectionRef({ db, env, collectionKey: "OPENCLAW_EXECUTION_CLAIMS" });
  const permits = resolveV2CollectionRef({ db: claims.db, env, collectionKey: "OPENCLAW_EXECUTION_PERMITS" });
  const claimRef = claims.ref.doc(claimId);
  const permitRef = permits.ref.doc(permitId);
  await claimRef.set({
    claim_status: claimStatus,
    finalized_at: finalizedAt,
    finalize_reason: upper(reason) || claimStatus,
    position_cycle_id: trimOrNull(positionCycleId),
    audit_ledger_reason: trimOrNull(auditLedgerResult && auditLedgerResult.reason),
    audit_ledger_ok: auditLedgerResult ? auditLedgerResult.ok === true : null,
    audit_ledger_doc_id: trimOrNull(auditLedgerResult && auditLedgerResult.persisted && auditLedgerResult.persisted.docId),
    post_fill_side_effect: asObject(postFillSideEffect) ? { ...postFillSideEffect } : null,
  }, { merge: true });
  await permitRef.set({
    permit_status: claimStatus === "ABORTED_NO_EXCHANGE_WRITE" ? "VOIDED" : "USED",
    execution_claim_id: claimId,
    finalized_at: finalizedAt,
    finalize_reason: upper(reason) || claimStatus,
  }, { merge: true });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZED",
    openclaw_execution_claim_id: claimId,
    openclaw_execution_permit_id: permitId,
    claim_status: claimStatus,
  });
}

async function findRecentSameDirectionExecutions({
  db = null,
  env = process.env,
  bundle,
  limit = 20,
} = {}) {
  const context = extractCurrentSignalContext(bundle);
  if (!context.symbol) {
    return Object.freeze({
      ok: false,
      reason: "SAME_DIRECTION_COOLDOWN_SYMBOL_REQUIRED",
      rows: Object.freeze([]),
      context,
    });
  }
  const query = await queryV2DocsByField({
    db,
    env,
    collectionKey: "OPENCLAW_EXECUTION_AUDITS",
    field: "symbol",
    value: context.symbol,
    limit,
  });
  return Object.freeze({
    ok: true,
    reason: "SAME_DIRECTION_COOLDOWN_RECENT_EXECUTIONS_LOADED",
    rows: Object.freeze(Array.isArray(query.rows) ? query.rows : []),
    context,
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
  claimExecution = claimOpenClawExecution,
  finalizeExecutionClaim = finalizeOpenClawExecutionClaim,
  riskGovernorSurface = null,
  findRecentSameDirectionExecutionsFn = findRecentSameDirectionExecutions,
  evaluateSameDirectionCooldown = evaluateV2SameDirectionCooldown,
  routeEntryIntentFromOpenClaw = resolveEntryIntentFromOpenClaw,
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
  if (typeof claimExecution !== "function") throw new Error("CLAIM_EXECUTION_REQUIRED");
  if (typeof finalizeExecutionClaim !== "function") throw new Error("FINALIZE_EXECUTION_CLAIM_REQUIRED");
  if (typeof findRecentSameDirectionExecutionsFn !== "function") throw new Error("FIND_RECENT_SAME_DIRECTION_EXECUTIONS_REQUIRED");
  if (typeof evaluateSameDirectionCooldown !== "function") throw new Error("EVALUATE_SAME_DIRECTION_COOLDOWN_REQUIRED");

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

  const routedDecision = routeEntryIntentFromOpenClaw(bundle);
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

  let sameDirectionCooldownGuard = null;
  try {
    const recentExecutions = await findRecentSameDirectionExecutionsFn({
      db,
      env,
      bundle,
      executionPermit,
      worldState,
      routedDecision,
      now,
    });
    sameDirectionCooldownGuard = evaluateSameDirectionCooldown({
      bundle,
      env,
      recentExecutions: recentExecutions && Array.isArray(recentExecutions.rows) ? recentExecutions.rows : [],
      nowMs: Date.parse(now()),
    });
  } catch (error) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_SAME_DIRECTION_COOLDOWN_GUARD_FAILED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard: Object.freeze({
        ok: false,
        reason: "SAME_DIRECTION_COOLDOWN_GUARD_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (!sameDirectionCooldownGuard || sameDirectionCooldownGuard.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_SAME_DIRECTION_COOLDOWN_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  let executionClaim = null;
  try {
    executionClaim = await claimExecution({
      db,
      env,
      bundle,
      executionPermit,
      worldState,
      routedDecision,
      now,
    });
  } catch (error) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_FAILED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim: Object.freeze({
        ok: false,
        claimed: false,
        replay: false,
        reason: "OPENCLAW_EXECUTION_CLAIM_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (!executionClaim || executionClaim.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (executionClaim.replay === true || executionClaim.claimed !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_REPLAY_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult: null,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }

  const leverage = resolveProductionEntryLeverage({ entryIntent, bundle, env });
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
    leverage,
  });
  const postFillSideEffect = summarizePostFillSideEffect(kernelResult);
  if (!kernelResult || kernelResult.ok !== true) {
    const finalStatus = postFillSideEffect.exchange_write_performed === true
      ? (postFillSideEffect.unprotected_position_possible === true ? "POST_FILL_PROTECTION_CRITICAL" : "POST_FILL_ROUTE_FAILURE_PROTECTED")
      : "ABORTED_NO_EXCHANGE_WRITE";
    const claimFinalizeResult = await finalizeExecutionClaim({
      db,
      env,
      executionClaim,
      executionPermit,
      status: finalStatus,
      reason: kernelResult && kernelResult.reason ? kernelResult.reason : "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      positionCycleId: postFillSideEffect.position_cycle_id,
      postFillSideEffect,
      now,
    }).catch((error) => Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZE_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
    }));
    return buildRouteBlock("V2_PRODUCTION_ENTRY_KERNEL_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      claimFinalizeResult,
      openclawExecutionAudit: preExecutionAudit,
      auditLedgerResult: null,
    });
  }
  if (postFillSideEffect.unprotected_position_possible === true) {
    const claimFinalizeResult = await finalizeExecutionClaim({
      db,
      env,
      executionClaim,
      executionPermit,
      status: "POST_FILL_PROTECTION_CRITICAL",
      reason: "V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL",
      positionCycleId: postFillSideEffect.position_cycle_id,
      postFillSideEffect,
      now,
    }).catch((error) => Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZE_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
    }));
    return buildRouteBlock("V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      claimFinalizeResult,
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

  let claimFinalizeResult = null;
  try {
    claimFinalizeResult = await finalizeExecutionClaim({
      db,
      env,
      executionClaim,
      executionPermit,
      status: openclawExecutionAudit.ok ? "EXECUTED_PROTECTED_AUDIT_PENDING" : "EXECUTED_PROTECTED_SEPARATION_FAILED",
      reason: openclawExecutionAudit.reason,
      positionCycleId: trimOrNull(executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id),
      postFillSideEffect,
      now,
    });
  } catch (error) {
    claimFinalizeResult = Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZE_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
    });
  }

  let auditLedgerResult = null;
  try {
    auditLedgerResult = await persistExecutionAudit({
      audit: openclawExecutionAudit,
      db,
      env,
      positionCycleId: trimOrNull(executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id),
      source: "PRODUCTION_ENTRY_ROUTE",
      recordedAt: trimOrNull(now()) || new Date().toISOString(),
      riskGovernorSurface,
    });
  } catch (error) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_AUDIT_LEDGER_FAILED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      claimFinalizeResult,
      openclawExecutionAudit,
      auditLedgerResult: Object.freeze({
        ok: false,
        reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
    });
  }

  if (openclawExecutionAudit.ok && auditLedgerResult && auditLedgerResult.ok === true) {
    claimFinalizeResult = await finalizeExecutionClaim({
      db,
      env,
      executionClaim,
      executionPermit,
      status: "EXECUTED_PROTECTED",
      reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
      positionCycleId: trimOrNull(executedEntry && executedEntry.positionCycle && executedEntry.positionCycle.position_cycle_id),
      auditLedgerResult,
      postFillSideEffect,
      now,
    }).catch((error) => Object.freeze({
      ok: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZE_THROWN",
      error_message: trimOrNull(error && error.message) || String(error),
    }));
  }

  if (!openclawExecutionAudit.ok) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      post_fill_side_effect: postFillSideEffect,
      executionPermitValidation,
      decisionBundleReplayGuard,
      sameDirectionCooldownGuard,
      executionClaim,
      claimFinalizeResult,
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
      sameDirectionCooldownGuard,
      executionClaim,
      claimFinalizeResult,
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
    sameDirectionCooldownGuard,
    executionClaim,
    claimFinalizeResult,
    openclawExecutionAudit,
    auditLedgerResult,
  });
}

module.exports = {
  runV2ProductionEntryRoute,
  resolveProductionEntryLeverage,
  __test: {
    trimOrNull,
    upper,
    asObject,
    resolveProductionEntryLeverage,
    summarizeRuntimeConfig,
    extractExecutedEntry,
    extractSubmitterResult,
    summarizePostFillSideEffect,
    extractDecisionBundleHash,
    extractExecutionPermitId,
    stableIdPart,
    buildExecutionClaimId,
    findExistingDecisionBundleExecution,
    claimOpenClawExecution,
    finalizeOpenClawExecutionClaim,
    findRecentSameDirectionExecutions,
  },
};
