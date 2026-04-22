"use strict";

const { buildReferenceNativeMlEvidencePack } = require("./replayFixtureFactory");
const { runV2ProductionEntryRoute } = require("./productionEntryRoute");
const { buildV2ProductionEntryLiveRequest } = require("./productionEntryLiveRequest");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function createMemoryFirestore() {
  const writes = [];
  const commits = [];
  const firestore = {
    collection(collectionName) {
      return {
        doc(docId) {
          return Object.freeze({ collectionName, id: docId, path: `${collectionName}/${docId}` });
        },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, payload, options) {
          ops.push(Object.freeze({
            type: "set",
            ref,
            payload: Object.freeze({ ...(payload || {}) }),
            options: Object.freeze({ ...(options || {}) }),
          }));
        },
        async commit() {
          const frozenOps = Object.freeze(ops.slice());
          commits.push(frozenOps);
          writes.push(...frozenOps);
          return frozenOps.map((_, index) => Object.freeze({ writeTime: `MEMORY_WRITE_${commits.length}_${index}` }));
        },
      };
    },
    __v2_canary_writes: writes,
    __v2_canary_commits: commits,
  };
  return firestore;
}

function buildDefaultSizing() {
  return Object.freeze({
    referencePrice: 2500,
    requestedNotionalQuote: 2000,
    maxNotionalQuote: 2500,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    allowMinOrderBump: false,
  });
}

function summarizeSizingDecision(decision) {
  const row = asObject(decision);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    status: trimOrNull(row.status),
    reason: trimOrNull(row.reason),
    entry_intent_id: trimOrNull(row.entry_intent_id),
    symbol: trimOrNull(row.symbol),
    side: trimOrNull(row.side),
    entry_qty_abs: row.entry_qty_abs == null ? null : Number(row.entry_qty_abs),
    notional_quote: row.notional_quote == null ? null : Number(row.notional_quote),
    reference_price: row.reference_price == null ? null : Number(row.reference_price),
  });
}

function collectRouteFailedChecks(routeResult) {
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
  if (result && result.ok !== true && result.reason) failed.push(result.reason);
  return Object.freeze([...new Set(failed.map(trimOrNull).filter(Boolean))]);
}

function buildNoExchangeEntryTransport({ sizingDecision, nowIso, exchangeWriteLedger }) {
  return Object.freeze({
    async submitEntryOrder({ entryIntent }) {
      const intentId = trimOrNull(entryIntent && entryIntent.entry_intent_id);
      if (intentId !== trimOrNull(sizingDecision && sizingDecision.entry_intent_id)) {
        throw new Error("V2_PROTECTED_ENTRY_CANARY_SIZING_INTENT_MISMATCH");
      }
      exchangeWriteLedger.entry_submit_called = true;
      return Object.freeze({
        status: "FILLED",
        symbol: trimOrNull(entryIntent && entryIntent.symbol),
        side: trimOrNull(entryIntent && entryIntent.side),
        entry_event_id: "ENTRY__NO_EXCHANGE__V2_PROTECTED_CANARY",
        entry_order_id: "ORDER__NO_EXCHANGE__V2_PROTECTED_CANARY",
        entry_fill_group_id: "FILL_GROUP__NO_EXCHANGE__V2_PROTECTED_CANARY",
        entry_price: Number(sizingDecision.reference_price),
        entry_qty_abs: Number(sizingDecision.entry_qty_abs),
        exchange_write_performed: false,
        canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
        filled_at: nowIso,
      });
    },
  });
}

function buildNoExchangeProtectionTransports({ nowIso, exchangeWriteLedger }) {
  return Object.freeze({
    async placeInitialSl({ command }) {
      exchangeWriteLedger.initial_sl_called = true;
      return Object.freeze({
        status: "PLACED",
        order_id: `SL__NO_EXCHANGE__${trimOrNull(command && command.placement_attempt_id)}`,
        trigger_price: Number(command && command.trigger_price),
        ack_at: nowIso,
      });
    },
    async placeInitialTp1({ command }) {
      exchangeWriteLedger.initial_tp1_called = true;
      return Object.freeze({
        status: "PLACED",
        order_id: `TP1__NO_EXCHANGE__${trimOrNull(command && command.placement_attempt_id)}`,
        trigger_price: Number(command && command.trigger_price),
        ack_at: nowIso,
      });
    },
  });
}

function buildProtectedCanaryChecks({ request, routeResult, firestore, exchangeWriteLedger }) {
  const kernelAudit = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.kernelAudit);
  const submitterResult = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.submitterResult);
  const protectionResult = asObject(submitterResult && submitterResult.protectionResult);
  const activationCommit = asObject(protectionResult && protectionResult.activationCommit);
  const protectionWriteResult = asObject(protectionResult && protectionResult.protectionWriteResult);
  const runtimeDoc = asObject(protectionWriteResult && protectionWriteResult.runtimeDoc);
  const entrySizingDecision = asObject(request && request.entrySizingDecision);
  return Object.freeze([
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_REQUEST_SIZING_APPROVED", ok: entrySizingDecision && entrySizingDecision.ok === true && entrySizingDecision.status === "APPROVED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ROUTE_OK", ok: routeResult && routeResult.ok === true }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ROUTE_REASON", ok: routeResult && routeResult.reason === "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_KERNEL_AUDIT_OK", ok: kernelAudit && kernelAudit.ok === true && Number(kernelAudit.fail_n) === 0 }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ACTIVATION_COMMIT_OK", ok: activationCommit && activationCommit.ok === true }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ACTIVE_PROTECTED", ok: activationCommit && activationCommit.position_cycle_status === "ACTIVE_PROTECTED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT", ok: !!trimOrNull(runtimeDoc && runtimeDoc.sl_order_id) }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT", ok: !!trimOrNull(runtimeDoc && runtimeDoc.tp1_order_id) }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT", ok: Array.isArray(firestore && firestore.__v2_canary_commits) && firestore.__v2_canary_commits.length >= 2 }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_NO_EXCHANGE_WRITE", ok: exchangeWriteLedger.exchange_write_performed === false }),
  ]);
}

async function runV2ProductionEntryProtectedCanary({
  env = process.env,
  bundle = buildReferenceNativeMlEvidencePack(),
  sizing = buildDefaultSizing(),
  now = () => new Date().toISOString(),
  runProductionEntryRoute = runV2ProductionEntryRoute,
} = {}) {
  if (typeof runProductionEntryRoute !== "function") throw new Error("RUN_PRODUCTION_ENTRY_ROUTE_REQUIRED");
  const startedAt = trimOrNull(now()) || new Date().toISOString();
  const canaryEnv = {
    ...env,
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "0",
  };
  const request = buildV2ProductionEntryLiveRequest({
    bundle,
    sizing,
    now: () => startedAt,
  });
  if (!request.ok) {
    return Object.freeze({
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_REQUEST_BLOCKED",
      scope: "production_entry_protected_canary",
      canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
      exchange_write_performed: false,
      generated_at: startedAt,
      request_reason: trimOrNull(request.reason),
      check_n: 1,
      fail_n: 1,
      check_ids: Object.freeze(["V2_PROTECTED_ENTRY_CANARY_REQUEST_READY"]),
      passed_check_ids: Object.freeze([]),
      failed_check_ids: Object.freeze(["V2_PROTECTED_ENTRY_CANARY_REQUEST_READY"]),
      checks: Object.freeze([Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_REQUEST_READY", ok: false })]),
    });
  }

  const firestore = createMemoryFirestore();
  const exchangeWriteLedger = {
    exchange_write_performed: false,
    entry_submit_called: false,
    initial_sl_called: false,
    initial_tp1_called: false,
  };
  const routeResult = await runProductionEntryRoute({
    db: firestore,
    env: canaryEnv,
    bundle: request.body.bundle,
    entryTransport: buildNoExchangeEntryTransport({
      sizingDecision: request.entrySizingDecision,
      nowIso: startedAt,
      exchangeWriteLedger,
    }),
    protectionTransports: buildNoExchangeProtectionTransports({
      nowIso: startedAt,
      exchangeWriteLedger,
    }),
    persistExecutionAudit: async ({ audit, positionCycleId, source }) => Object.freeze({
      ok: true,
      skipped: true,
      reason: "PROTECTED_ENTRY_CANARY_AUDIT_LEDGER_WRITE_DISABLED",
      audit_id: trimOrNull(audit && audit.audit_id),
      position_cycle_id: trimOrNull(positionCycleId),
      source: trimOrNull(source),
      exchange_write_performed: false,
    }),
    now: () => startedAt,
  });

  const checks = buildProtectedCanaryChecks({ request, routeResult, firestore, exchangeWriteLedger });
  const failedChecks = checks.filter((row) => row.ok !== true);
  const kernelAudit = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.kernelAudit);
  const submitterResult = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.submitterResult);
  const protectionResult = asObject(submitterResult && submitterResult.protectionResult);
  const protectionWriteResult = asObject(protectionResult && protectionResult.protectionWriteResult);
  const runtimeDoc = asObject(protectionWriteResult && protectionWriteResult.runtimeDoc);
  const ledgerResult = asObject(routeResult && routeResult.auditLedgerResult);

  return Object.freeze({
    ok: failedChecks.length === 0,
    reason: failedChecks.length === 0 ? "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS" : "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_BLOCKED",
    scope: "production_entry_protected_canary",
    canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
    exchange_write_performed: false,
    generated_at: startedAt,
    route_called: true,
    kernel_called: routeResult && routeResult.kernelResult != null,
    entry_transport_called: exchangeWriteLedger.entry_submit_called === true,
    initial_sl_transport_called: exchangeWriteLedger.initial_sl_called === true,
    initial_tp1_transport_called: exchangeWriteLedger.initial_tp1_called === true,
    memory_firestore_batch_commit_n: firestore.__v2_canary_commits.length,
    memory_firestore_write_n: firestore.__v2_canary_writes.length,
    check_n: checks.length,
    fail_n: failedChecks.length,
    check_ids: Object.freeze(checks.map((row) => row.id)),
    passed_check_ids: Object.freeze(checks.filter((row) => row.ok).map((row) => row.id)),
    failed_check_ids: Object.freeze([
      ...failedChecks.map((row) => row.id),
      ...collectRouteFailedChecks(routeResult),
    ]),
    route_result_summary: Object.freeze({
      ok: routeResult && routeResult.ok === true,
      reason: trimOrNull(routeResult && routeResult.reason),
      position_cycle_id: trimOrNull(kernelAudit && kernelAudit.position_cycle_id),
      entry_event_id: trimOrNull(kernelAudit && kernelAudit.entry_event_id),
      protection_runtime_id: trimOrNull(kernelAudit && kernelAudit.protection_runtime_id),
      runtime_health_status: trimOrNull(runtimeDoc && runtimeDoc.health_status),
      sl_order_id: trimOrNull(runtimeDoc && runtimeDoc.sl_order_id),
      tp1_order_id: trimOrNull(runtimeDoc && runtimeDoc.tp1_order_id),
      audit_ledger_reason: trimOrNull(ledgerResult && ledgerResult.reason),
      entry_sizing_decision: summarizeSizingDecision(request.entrySizingDecision),
    }),
    checks,
  });
}

module.exports = {
  runV2ProductionEntryProtectedCanary,
  __test: {
    trimOrNull,
    asObject,
    createMemoryFirestore,
    buildDefaultSizing,
    summarizeSizingDecision,
    collectRouteFailedChecks,
    buildNoExchangeEntryTransport,
    buildNoExchangeProtectionTransports,
    buildProtectedCanaryChecks,
  },
};
