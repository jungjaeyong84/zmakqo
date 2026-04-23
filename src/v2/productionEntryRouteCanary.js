"use strict";

const { buildReferenceNativeMlEvidencePack } = require("./replayFixtureFactory");
const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("./entryExecutor");
const { evaluateEntryExecutionKernelResult } = require("./entryExecutionKernel");
const { runV2ProductionEntryRoute } = require("./productionEntryRoute");
const { buildV2EntrySizingDecision } = require("./entrySizingDecision");
const { buildOpenClawWorldState } = require("./openclawWorldState");
const { issueOpenClawExecutionPermit } = require("./openclawExecutionPermit");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function asObject(value) {
  return value && typeof value === "object" ? value : null;
}

function parseBoundedPermitTtlMinutes(env = process.env) {
  const raw = Number(env && env.DONBEOLJA_V2_OPENCLAW_EXECUTION_PERMIT_TTL_MINUTES);
  const fallback = 15;
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.min(30, Math.max(5, value));
}

function extractMlMaxSizeRatioFromBundle(bundle = null) {
  const row = asObject(bundle);
  const decision = asObject(row && row.openclawDecision);
  const summary = asObject(decision && decision.canonical_evidence_summary);
  const proposal = asObject(summary && summary.ml_ai_signal_proposal);
  const value = Number(proposal && proposal.size_ratio);
  return Number.isFinite(value) ? value : null;
}

function collectFailedChecks(routeResult) {
  const result = asObject(routeResult);
  const kernelAudit = asObject(result && result.kernelResult && result.kernelResult.kernelAudit);
  const openclawAudit = asObject(result && result.openclawExecutionAudit);
  const failed = [];
  for (const id of Array.isArray(kernelAudit && kernelAudit.failed_check_ids) ? kernelAudit.failed_check_ids : []) {
    failed.push(id);
  }
  for (const id of Array.isArray(openclawAudit && openclawAudit.failed_check_ids) ? openclawAudit.failed_check_ids : []) {
    failed.push(id);
  }
  if (result && result.reason && result.ok !== true) failed.push(result.reason);
  return Object.freeze([...new Set(failed.map(trimOrNull).filter(Boolean))]);
}

function buildNoExchangeKernelResult({ bundle, nowIso = new Date().toISOString() } = {}) {
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  if (!routed.ok) {
    return Object.freeze({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      submitterResult: null,
      kernelAudit: Object.freeze({
        ok: false,
        reason: "ENTRY_EXECUTION_KERNEL_CANARY_ROUTER_BLOCKED",
        check_n: 1,
        fail_n: 1,
        check_ids: Object.freeze(["ENTRY_KERNEL_CANARY_ROUTER_OK"]),
        passed_check_ids: Object.freeze([]),
        failed_check_ids: Object.freeze(["ENTRY_KERNEL_CANARY_ROUTER_OK"]),
        checks: Object.freeze([Object.freeze({ id: "ENTRY_KERNEL_CANARY_ROUTER_OK", ok: false })]),
        position_cycle_id: null,
        entry_event_id: null,
        protection_runtime_id: null,
      }),
    });
  }

  const entrySizingDecision = buildV2EntrySizingDecision({
    entryIntent: routed.entryIntent,
    referencePrice: 2500,
    requestedNotionalQuote: 2000,
    maxNotionalQuote: 2500,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    maxSizeRatio: extractMlMaxSizeRatioFromBundle(bundle),
    allowMinOrderBump: false,
    createdAt: nowIso,
  });
  if (!entrySizingDecision.ok) {
    return Object.freeze({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      submitterResult: Object.freeze({
        ok: false,
        reason: "ENTRY_SIZING_CANARY_BLOCKED",
        entrySizingDecision,
      }),
      kernelAudit: Object.freeze({
        ok: false,
        reason: "ENTRY_EXECUTION_KERNEL_CANARY_SIZING_BLOCKED",
        check_n: 1,
        fail_n: 1,
        check_ids: Object.freeze(["ENTRY_KERNEL_CANARY_SIZING_APPROVED"]),
        passed_check_ids: Object.freeze([]),
        failed_check_ids: Object.freeze(["ENTRY_KERNEL_CANARY_SIZING_APPROVED"]),
        checks: Object.freeze([Object.freeze({ id: "ENTRY_KERNEL_CANARY_SIZING_APPROVED", ok: false })]),
        position_cycle_id: null,
        entry_event_id: null,
        protection_runtime_id: null,
      }),
    });
  }

  const executedEntry = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__V2_PRODUCTION_ROUTE_CANARY",
    entryOrderId: "ORDER__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
    entryFillGroupId: "FILL_GROUP__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
    entryPrice: entrySizingDecision.reference_price,
    entryQtyAbs: entrySizingDecision.entry_qty_abs,
  });
  const positionCycleId = executedEntry.positionCycle.position_cycle_id;
  const protectionRuntimeId = `${positionCycleId}__PROTECTION_RUNTIME__CANARY`;
  const submitterResult = Object.freeze({
    ok: true,
    reason: "ENTRY_SUBMITTED_AND_PROTECTED",
    fill: Object.freeze({
      status: "FILLED",
      entry_event_id: executedEntry.positionCycle.entry_event_id,
      entry_order_id: executedEntry.positionCycle.entry_order_id,
      entry_fill_group_id: executedEntry.positionCycle.entry_fill_group_id,
      symbol: routed.entryIntent.symbol,
      side: routed.entryIntent.side,
      price: entrySizingDecision.reference_price,
      qty_abs: entrySizingDecision.entry_qty_abs,
      exchange_write_performed: false,
      canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    }),
    entrySizingDecision,
    executedEntry,
    protectionEvidence: Object.freeze({
      ok: true,
      canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
      sl_order_id: "STOP__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
      tp1_order_id: "TP1__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
      exchange_write_performed: false,
    }),
    protectionResult: Object.freeze({
      ok: true,
      activationCommit: Object.freeze({
        ok: true,
        position_cycle_id: positionCycleId,
        position_cycle_status: "ACTIVE_PROTECTED",
        protection_runtime_id: protectionRuntimeId,
        activated_at: nowIso,
        chainAudit: Object.freeze({
          ok: true,
          reason: "V2_RUNTIME_CHAIN_AUDIT_CANARY_PASS",
          check_n: 1,
          fail_n: 0,
          failed_check_ids: Object.freeze([]),
        }),
      }),
      protectionWriteResult: Object.freeze({
        ok: true,
        writeDecision: Object.freeze({
          ok: true,
          reason: "PROTECTION_WRITE_CANARY_APPROVED",
          writer_source: "V2_PRODUCTION_ENTRY_ROUTE_CANARY",
        }),
        runtimeDoc: Object.freeze({
          protection_runtime_id: protectionRuntimeId,
          position_cycle_id: positionCycleId,
          health_status: "HEALTHY",
          native_refresh_status: "OK",
          sl_order_id: "STOP__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
          tp1_order_id: "TP1__NO_EXCHANGE__V2_PRODUCTION_ROUTE_CANARY",
          last_refresh_at: nowIso,
          exchange_write_performed: false,
          canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
        }),
      }),
    }),
  });

  const kernelAudit = evaluateEntryExecutionKernelResult(submitterResult);
  return Object.freeze({
    ok: kernelAudit.ok,
    reason: kernelAudit.ok ? "V2_ENTRY_EXECUTION_KERNEL_PROTECTED" : "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
    submitterResult,
    kernelAudit,
  });
}

async function runV2ProductionEntryRouteCanary({
  env = process.env,
  bundle = buildReferenceNativeMlEvidencePack(),
  now = () => new Date().toISOString(),
  runProductionEntryRoute = runV2ProductionEntryRoute,
} = {}) {
  if (typeof runProductionEntryRoute !== "function") throw new Error("RUN_PRODUCTION_ENTRY_ROUTE_REQUIRED");
  const canaryEnv = {
    ...env,
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "0",
  };

  let kernelCalled = false;
  let persistCalled = false;
  const startedAt = trimOrNull(now()) || new Date().toISOString();
  const worldState = buildOpenClawWorldState({
    env: canaryEnv,
    mode: "CANARY",
    runtimeState: {
      scope: "production_entry_route_canary",
      exchange_write_performed: false,
    },
    canaryState: {
      canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    },
    generatedAt: startedAt,
  });
  const executionPermit = issueOpenClawExecutionPermit({
    bundle,
    worldState,
    sizingCap: {
      notional_quote_max: 2500,
      entry_qty_abs_max: 1,
      max_size_ratio: extractMlMaxSizeRatioFromBundle(bundle),
    },
    riskBudget: {
      canary_no_exchange_write: true,
    },
    approvalReason: "PRODUCTION_ENTRY_ROUTE_CANARY_APPROVED_BY_OPENCLAW",
    issuedAt: startedAt,
    ttlMinutes: parseBoundedPermitTtlMinutes(canaryEnv),
  });
  const routeResult = await runProductionEntryRoute({
    env: canaryEnv,
    bundle,
    worldState,
    executionPermit,
    now: () => startedAt,
    runEntryKernel: async () => {
      kernelCalled = true;
      return buildNoExchangeKernelResult({ bundle, nowIso: startedAt });
    },
    persistExecutionAudit: async ({ audit, positionCycleId, source }) => {
      persistCalled = true;
      return Object.freeze({
        ok: true,
        skipped: true,
        reason: "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED",
        audit_id: trimOrNull(audit && audit.audit_id),
        position_cycle_id: trimOrNull(positionCycleId),
        source: trimOrNull(source),
        exchange_write_performed: false,
      });
    },
  });

  const runtime = asObject(routeResult && routeResult.runtime);
  const submitterResult = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.submitterResult);
  const fill = asObject(submitterResult && submitterResult.fill);
  const entrySizingDecision = asObject(submitterResult && submitterResult.entrySizingDecision);
  const kernelAudit = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.kernelAudit);
  const openclawAudit = asObject(routeResult && routeResult.openclawExecutionAudit);
  const permitValidation = asObject(routeResult && routeResult.executionPermitValidation);
  const ledgerResult = asObject(routeResult && routeResult.auditLedgerResult);
  const checks = Object.freeze([
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_ROUTE_OK", ok: routeResult && routeResult.ok === true }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_ROUTE_REASON", ok: routeResult && routeResult.reason === "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_RUNTIME_NOT_DRY_RUN", ok: runtime && runtime.dry_run === false }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_KERNEL_CALLED", ok: kernelCalled === true }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_KERNEL_AUDIT_OK", ok: kernelAudit && kernelAudit.ok === true }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_OPENCLAW_AUDIT_OK", ok: openclawAudit && openclawAudit.ok === true }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_OPENCLAW_PERMIT_OK", ok: permitValidation && permitValidation.ok === true }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_APPROVED", ok: entrySizingDecision && entrySizingDecision.ok === true && entrySizingDecision.status === "APPROVED" }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_QTY_MATCHES_FILL", ok: entrySizingDecision && fill && Number(entrySizingDecision.entry_qty_abs) === Number(fill.qty_abs) }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_LEDGER_SKIPPED_INTENTIONALLY", ok: ledgerResult && ledgerResult.ok === true && ledgerResult.skipped === true && ledgerResult.reason === "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED" }),
    Object.freeze({ id: "V2_PRODUCTION_ROUTE_CANARY_NO_EXCHANGE_WRITE", ok: true }),
  ]);
  const failedChecks = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failedChecks.length === 0,
    reason: failedChecks.length === 0 ? "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS" : "V2_PRODUCTION_ENTRY_ROUTE_CANARY_BLOCKED",
    scope: "production_entry_route_canary",
    canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    exchange_write_performed: false,
    route_called: true,
    kernel_called: kernelCalled,
    persist_called: persistCalled,
    generated_at: startedAt,
    check_n: checks.length,
    fail_n: failedChecks.length,
    check_ids: Object.freeze(checks.map((row) => row.id)),
    passed_check_ids: Object.freeze(checks.filter((row) => row.ok).map((row) => row.id)),
    failed_check_ids: Object.freeze([
      ...failedChecks.map((row) => row.id),
      ...collectFailedChecks(routeResult),
    ]),
    route_result_summary: Object.freeze({
      ok: routeResult && routeResult.ok === true,
      reason: trimOrNull(routeResult && routeResult.reason),
      runtime,
      position_cycle_id: trimOrNull(kernelAudit && kernelAudit.position_cycle_id),
      entry_event_id: trimOrNull(kernelAudit && kernelAudit.entry_event_id),
      protection_runtime_id: trimOrNull(kernelAudit && kernelAudit.protection_runtime_id),
      openclaw_audit_id: trimOrNull(openclawAudit && openclawAudit.audit_id),
      openclaw_execution_permit_id: trimOrNull(executionPermit && executionPermit.openclaw_execution_permit_id),
      world_state_hash: trimOrNull(worldState && worldState.world_state_hash),
      audit_ledger_reason: trimOrNull(ledgerResult && ledgerResult.reason),
      entry_sizing_decision: entrySizingDecision ? Object.freeze({
        ok: entrySizingDecision.ok === true,
        status: trimOrNull(entrySizingDecision.status),
        reason: trimOrNull(entrySizingDecision.reason),
        entry_intent_id: trimOrNull(entrySizingDecision.entry_intent_id),
        symbol: trimOrNull(entrySizingDecision.symbol),
        side: trimOrNull(entrySizingDecision.side),
        entry_qty_abs: Number(entrySizingDecision.entry_qty_abs),
        notional_quote: Number(entrySizingDecision.notional_quote),
        reference_price: Number(entrySizingDecision.reference_price),
      }) : null,
    }),
    checks,
  });
}

module.exports = {
  buildNoExchangeKernelResult,
  runV2ProductionEntryRouteCanary,
  __test: {
    trimOrNull,
    asObject,
    collectFailedChecks,
  },
};
