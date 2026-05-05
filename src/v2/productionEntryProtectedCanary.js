"use strict";

const { buildReferenceNativeMlEvidencePack } = require("./replayFixtureFactory");
const { buildOpenClawDecisionBundle } = require("./openclawControlPlane");
const { runV2ProductionEntryRoute } = require("./productionEntryRoute");
const {
  LIVE_CONFIRM_PHRASE,
  runV2ProductionEntryLiveEndpoint,
} = require("./productionEntryLiveEndpoint");
const { buildV2ProductionEntryLiveRequest } = require("./productionEntryLiveRequest");
const { resolveV2CollectionName } = require("./storage");

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
  const docs = new Map();
  function keyOf(ref) {
    return `${ref.collectionName}/${ref.id}`;
  }
  function writeDoc(ref, payload, options = {}) {
    const key = keyOf(ref);
    const prev = docs.get(key) || {};
    const next = options && options.merge === true
      ? { ...prev, ...(payload || {}) }
      : { ...(payload || {}) };
    docs.set(key, next);
    const write = Object.freeze({
      type: "set",
      ref,
      payload: Object.freeze({ ...(payload || {}) }),
      options: Object.freeze({ ...(options || {}) }),
    });
    writes.push(write);
    return write;
  }
  const firestore = {
    collection(collectionName) {
      return {
        doc(docId) {
          const ref = {
            collectionName,
            id: docId,
            path: `${collectionName}/${docId}`,
            async set(payload, options) {
              writeDoc(ref, payload, options);
            },
            async get() {
              const doc = docs.get(keyOf(ref));
              return {
                exists: !!doc,
                data: () => (doc ? { ...doc } : null),
              };
            },
          };
          return Object.freeze(ref);
        },
        where(field, op, value) {
          return {
            limit(maxRows) {
              return {
                async get() {
                  const matched = writes
                    .filter((write) => write && write.ref && write.ref.collectionName === collectionName)
                    .map((write) => write.payload || {})
                    .filter((payload) => {
                      if (op !== "==") return false;
                      return payload && payload[field] === value;
                    })
                    .slice(0, Math.max(1, Number(maxRows) || 1));
                  return {
                    docs: matched.map((payload) => ({
                      data: () => ({ ...payload }),
                    })),
                  };
                },
              };
            },
          };
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
          for (const op of frozenOps) {
            writeDoc(op.ref, op.payload, op.options);
          }
          return frozenOps.map((_, index) => Object.freeze({ writeTime: `MEMORY_WRITE_${commits.length}_${index}` }));
        },
      };
    },
    async runTransaction(fn) {
      const txWrites = [];
      const tx = {
        async get(ref) {
          const doc = docs.get(keyOf(ref));
          return {
            exists: !!doc,
            data: () => (doc ? { ...doc } : null),
          };
        },
        set(ref, payload, options) {
          txWrites.push({ ref, payload, options });
        },
      };
      const result = await fn(tx);
      for (const op of txWrites) {
        writeDoc(op.ref, op.payload, op.options);
      }
      return result;
    },
    __seedDoc(collectionName, docId, payload) {
      docs.set(`${collectionName}/${docId}`, { ...(payload || {}) });
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

function buildDefaultLiveEndpointBundle({ createdAt } = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETHUSDT__V2_PROTECTED_CANARY_LIVE_ENDPOINT",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.78,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "protected canary live endpoint probe",
    policyScope: "ETHUSDT_15M",
    htfDirection: "LONG",
    htfConfidence: 0.74,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: Object.freeze({
      trend_bias: 0.74,
      volatility_rank: 0.46,
      volume_impulse: 0.63,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
    }),
    proposalVerdict: "PASS",
    rankScore: 0.77,
    sizeRatio: 0.5,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_v2_protected_canary_live_endpoint_v1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "protected canary live endpoint evidence complete",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "ETHUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: {
      htf_regime: { regime: "LONG", alignment_score: 0.94 },
      setup_gate: { setup_type: "PULLBACK_RECLAIM", setup_quality_score: 0.92 },
      trigger_gate: { trigger_confirmed: true, volume_zscore: 2.1, rsi_entry_tf: 65 },
      no_trade_gate: { market_quality_score: 1, spread_bps: 2, mark_index_gap_bps: 1, funding_penalty_bps: 1 },
      expected_edge_gate: { expected_gross_r: 2.2, expected_net_r_after_cost: 0.5, cost_estimate_bps: 5, cost_r_equivalent: 1.7 },
      feature_snapshot_contract: { btc_1h_trend: "LONG", mtf_1h_direction: "LONG" },
    },
    createdAt,
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

function summarizeLiveEndpointProbe({ result, exchangeWriteLedger, request }) {
  const row = asObject(result);
  const runtime = asObject(row && row.runtime);
  const transport = asObject(row && row.transport_resolution);
  const requestBundle = asObject(request && request.body && request.body.bundle);
  const decision = asObject(requestBundle && requestBundle.openclawDecision);
  return Object.freeze({
    ok: row && row.ok === true,
    reason: trimOrNull(row && row.reason),
    endpoint_enabled: row && row.endpoint_enabled === true,
    route_called: row && row.route_called === true,
    transport_resolution_ok: transport && transport.ok === true,
    transport_reason: trimOrNull(transport && transport.reason),
    exchange_write_performed: exchangeWriteLedger.exchange_write_performed === true,
    decision_mode: trimOrNull(decision && decision.decision_mode),
    runtime_enabled: runtime && runtime.enabled === true,
    runtime_dry_run: runtime ? runtime.dry_run === true : null,
    runtime_canary_only: runtime ? runtime.canary_only === true : null,
  });
}

async function runProtectedCanaryLiveEndpointProbe({
  env = process.env,
  sizing = buildDefaultSizing(),
  nowIso,
  runLiveEndpoint = runV2ProductionEntryLiveEndpoint,
} = {}) {
  if (typeof runLiveEndpoint !== "function") throw new Error("RUN_LIVE_ENDPOINT_REQUIRED");
  const startedAt = trimOrNull(nowIso) || new Date().toISOString();
  const bundle = buildDefaultLiveEndpointBundle({ createdAt: startedAt });
  const request = buildV2ProductionEntryLiveRequest({
    bundle,
    sizing,
    confirm: LIVE_CONFIRM_PHRASE,
    now: () => startedAt,
  });
  const exchangeWriteLedger = {
    exchange_write_performed: false,
    live_endpoint_route_called: false,
  };
  if (!request.ok) {
    return Object.freeze({
      ok: false,
      reason: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_REQUEST_BLOCKED",
      summary: Object.freeze({
        ok: false,
        reason: trimOrNull(request.reason),
        endpoint_enabled: false,
        route_called: false,
        transport_resolution_ok: false,
        transport_reason: null,
        exchange_write_performed: false,
        decision_mode: null,
        runtime_enabled: null,
        runtime_dry_run: null,
        runtime_canary_only: null,
      }),
    });
  }

  const endpointEnv = {
    ...env,
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "5000",
    DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "5000",
    DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: "5000",
  };
  const result = await runLiveEndpoint({
    env: endpointEnv,
    body: {
      ...request.body,
      riskGovernor: {
        account: { equity_quote: 1000, daily_loss_quote: 0, consecutive_loss_n: 0, trade_count_24h: 0 },
        positions: [],
        candidate: { symbol: "ETHUSDT", notional_quote: Number(request.entrySizingDecision && request.entrySizingDecision.notional_quote) || 1 },
        market: { volatility_bps: 80 },
      },
    },
    requestId: "REQ__NO_EXCHANGE__V2_PROTECTED_CANARY_LIVE_ENDPOINT",
    buildLiveTransports: async () => Object.freeze({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
      entry_intent_id: trimOrNull(request.entrySizingDecision && request.entrySizingDecision.entry_intent_id),
      symbol: trimOrNull(request.entrySizingDecision && request.entrySizingDecision.symbol),
      side: trimOrNull(request.entrySizingDecision && request.entrySizingDecision.side),
      entry_qty_abs: request.entrySizingDecision ? Number(request.entrySizingDecision.entry_qty_abs) : null,
      live_cfg_summary: Object.freeze({
        exchange: "BINANCEFUT",
        symbol: trimOrNull(request.entrySizingDecision && request.entrySizingDecision.symbol),
        live_enabled: true,
        live_dry_run: false,
        api_key_present: false,
        api_secret_present: false,
        reason: "NO_EXCHANGE_PROBE",
      }),
      entryTransport: Object.freeze({
        submitEntryOrder: async () => { throw new Error("LIVE_ENDPOINT_PROBE_ROUTE_STUB_SHOULD_NOT_SUBMIT"); },
      }),
      protectionTransports: Object.freeze({
        placeInitialSl: async () => { throw new Error("LIVE_ENDPOINT_PROBE_ROUTE_STUB_SHOULD_NOT_PLACE_SL"); },
        placeInitialTp1: async () => { throw new Error("LIVE_ENDPOINT_PROBE_ROUTE_STUB_SHOULD_NOT_PLACE_TP1"); },
      }),
    }),
    runProductionEntryRoute: async ({ bundle: routedBundle, entryTransport, protectionTransports }) => {
      exchangeWriteLedger.live_endpoint_route_called = true;
      if (!routedBundle || !entryTransport || !protectionTransports) {
        return Object.freeze({ ok: false, reason: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_INPUT_MISSING" });
      }
      return Object.freeze({ ok: true, reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" });
    },
    now: () => startedAt,
  });
  const summary = summarizeLiveEndpointProbe({ result, exchangeWriteLedger, request });
  return Object.freeze({
    ok: summary.ok === true,
    reason: summary.reason,
    summary,
  });
}

function buildProtectedCanaryChecks({ request, routeResult, firestore, exchangeWriteLedger, liveEndpointProbe }) {
  const kernelAudit = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.kernelAudit);
  const submitterResult = asObject(routeResult && routeResult.kernelResult && routeResult.kernelResult.submitterResult);
  const protectionResult = asObject(submitterResult && submitterResult.protectionResult);
  const activationCommit = asObject(protectionResult && protectionResult.activationCommit);
  const protectionWriteResult = asObject(protectionResult && protectionResult.protectionWriteResult);
  const runtimeDoc = asObject(protectionWriteResult && protectionWriteResult.runtimeDoc);
  const entrySizingDecision = asObject(request && request.entrySizingDecision);
  const liveEndpointSummary = asObject(liveEndpointProbe && liveEndpointProbe.summary);
  const activationWrites = Array.isArray(activationCommit && activationCommit.writes)
    ? activationCommit.writes
    : [];
  return Object.freeze([
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_REQUEST_SIZING_APPROVED", ok: entrySizingDecision && entrySizingDecision.ok === true && entrySizingDecision.status === "APPROVED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ROUTE_OK", ok: routeResult && routeResult.ok === true }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ROUTE_REASON", ok: routeResult && routeResult.reason === "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_KERNEL_AUDIT_OK", ok: kernelAudit && kernelAudit.ok === true && Number(kernelAudit.fail_n) === 0 }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ACTIVATION_COMMIT_OK", ok: activationCommit && activationCommit.ok === true }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_ACTIVE_PROTECTED", ok: activationCommit && activationCommit.position_cycle_status === "ACTIVE_PROTECTED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT", ok: !!trimOrNull(runtimeDoc && runtimeDoc.sl_order_id) }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT", ok: !!trimOrNull(runtimeDoc && runtimeDoc.tp1_order_id) }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_READ_MODEL_LATEST_WRITTEN", ok: activationWrites.some((row) => row && row.collectionName === "position_read_model_latest") }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT", ok: Array.isArray(firestore && firestore.__v2_canary_commits) && firestore.__v2_canary_commits.length >= 2 }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_NO_EXCHANGE_WRITE", ok: exchangeWriteLedger.exchange_write_performed === false }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_PROBE_OK", ok: liveEndpointSummary && liveEndpointSummary.ok === true && liveEndpointSummary.reason === "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_CALLED", ok: liveEndpointSummary && liveEndpointSummary.route_called === true }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_TRANSPORTS_READY", ok: liveEndpointSummary && liveEndpointSummary.transport_resolution_ok === true && liveEndpointSummary.transport_reason === "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY" }),
    Object.freeze({ id: "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_NO_EXCHANGE_WRITE", ok: liveEndpointSummary && liveEndpointSummary.exchange_write_performed === false }),
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
  firestore.__seedDoc(
    resolveV2CollectionName("OPENCLAW_EXECUTION_PERMITS", canaryEnv),
    request.executionPermit.openclaw_execution_permit_id,
    request.executionPermit,
  );
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
    worldState: request.worldState,
    executionPermit: request.executionPermit,
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

  const liveEndpointProbe = await runProtectedCanaryLiveEndpointProbe({ env, sizing, nowIso: startedAt });
  const checks = buildProtectedCanaryChecks({ request, routeResult, firestore, exchangeWriteLedger, liveEndpointProbe });
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
    live_endpoint_probe_summary: liveEndpointProbe.summary,
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
      world_state_hash: trimOrNull(request.worldState && request.worldState.world_state_hash),
      openclaw_execution_permit_id: trimOrNull(request.executionPermit && request.executionPermit.openclaw_execution_permit_id),
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
    buildDefaultLiveEndpointBundle,
    summarizeSizingDecision,
    summarizeLiveEndpointProbe,
    runProtectedCanaryLiveEndpointProbe,
    collectRouteFailedChecks,
    buildNoExchangeEntryTransport,
    buildNoExchangeProtectionTransports,
    buildProtectedCanaryChecks,
  },
};
