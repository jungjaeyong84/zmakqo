"use strict";

const { resolveV2RuntimeConfig } = require("./runtime");
const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { runV2EntryExecutionKernel } = require("./entryExecutionKernel");
const { evaluateOpenClawExecutionSeparation } = require("./openclawExecutionSeparationAudit");
const { persistOpenClawExecutionAudit } = require("./openclawExecutionAuditLedger");

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

async function runV2ProductionEntryRoute({
  db = null,
  env = process.env,
  bundle,
  entryTransport,
  protectionTransports,
  runEntryKernel = runV2EntryExecutionKernel,
  persistExecutionAudit = persistOpenClawExecutionAudit,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
  stopLossPct = 0.0165,
  tp1TargetPct = 0.0168,
  tp1QtyRatio = 0.5,
} = {}) {
  if (typeof runEntryKernel !== "function") throw new Error("RUN_ENTRY_KERNEL_REQUIRED");
  if (typeof persistExecutionAudit !== "function") throw new Error("PERSIST_EXECUTION_AUDIT_REQUIRED");

  const runtimeConfig = resolveV2RuntimeConfig(env);
  const runtime = summarizeRuntimeConfig(runtimeConfig);

  if (!runtimeConfig.enabled) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DISABLED", {
      runtime,
      routedDecision: null,
      kernelResult: null,
      openclawExecutionAudit: null,
      auditLedgerResult: null,
    });
  }
  if (runtimeConfig.dryRun) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED", {
      runtime,
      routedDecision: null,
      kernelResult: null,
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
      openclawExecutionAudit,
      auditLedgerResult: Object.freeze({
        ok: false,
        reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_THROWN",
        error_message: trimOrNull(error && error.message) || String(error),
      }),
    });
  }

  if (!kernelResult || kernelResult.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_KERNEL_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      openclawExecutionAudit,
      auditLedgerResult,
    });
  }

  if (!openclawExecutionAudit.ok) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED", {
      runtime,
      routedDecision,
      kernelResult,
      openclawExecutionAudit,
      auditLedgerResult,
    });
  }

  if (auditLedgerResult && auditLedgerResult.ok !== true) {
    return buildRouteBlock("V2_PRODUCTION_ENTRY_AUDIT_LEDGER_NOT_OK", {
      runtime,
      routedDecision,
      kernelResult,
      openclawExecutionAudit,
      auditLedgerResult,
    });
  }

  return buildRouteAllow({
    runtime,
    routedDecision,
    kernelResult,
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
  },
};
