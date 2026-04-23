"use strict";

const assert = require("assert");
const {
  evaluateExitRuntimeCanaryState,
  loadExitRuntimeCanaryStateRows,
  resolveExitRuntimeCanaryConfig,
} = require("../v2/exitRuntimeCanary");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId } = require("../v2/contracts");

function cycle(overrides = {}) {
  return {
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    symbol: "ETHUSDT",
    status: "ACTIVE_PROTECTED",
    ...overrides,
  };
}

function projection(overrides = {}) {
  return {
    exit_runtime_projection_id: buildExitRuntimeProjectionId({ positionCycleId: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC" }),
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    stage: "PRE_TP1",
    tp1_done: false,
    trail_active: false,
    health_status: "HEALTHY",
    tp1_target_price: 2600,
    tp1_target_qty_abs: 0.5,
    chosen_stop_source: "SL",
    chosen_stop_price: 2400,
    native_stop_price: 2400,
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    protection_runtime_id: buildProtectionRuntimeId({ positionCycleId: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC" }),
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    sl_order_id: "SL__1",
    sl_order_status: "PLACED",
    tp1_order_id: "TP1__1",
    tp1_order_status: "PLACED",
    native_stop_price: 2400,
    native_tp1_price: 2600,
    native_refresh_status: "OK",
    health_status: "HEALTHY",
    last_gap_ms: 0,
    ...overrides,
  };
}

function transition(event, id = `CET__${event}`) {
  return {
    canonical_transition_id: id,
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    transition_event: event,
    next_stage: event === "TRAIL_ACTIVATED" ? "TRAIL_ACTIVE" : "TP1_DONE",
    source_exchange_evidence: event === "TRAIL_ACTIVATED"
      ? { evidence_kind: "TRAIL_ACTIVATION", raw_payload: { execution_type: "AMENDMENT" } }
      : null,
  };
}

function outbox(transitionId, status = "SENT") {
  return {
    alert_outbox_id: `TAO__${transitionId}`,
    position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    canonical_transition_id: transitionId,
    status,
    prepared_payload: {
      canonical_transition_id: transitionId,
      position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
    },
    delivery_request: {
      dedupeKey: `TAO__${transitionId}`,
      dedupeFingerprint: transitionId,
    },
  };
}

function stateRow({ projectionDoc = projection(), runtimeDoc = runtime(), transitions = [], outboxes = [], loadIssues = [] } = {}) {
  return {
    positionCycle: cycle(),
    projection: projectionDoc,
    protectionRuntime: runtimeDoc,
    transitions,
    outboxes,
    load_issue_codes: loadIssues,
  };
}

(function healthyPreTp1Passes() {
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow()],
    config: resolveExitRuntimeCanaryConfig({}),
    generatedAt: "2026-04-22T00:00:00.000Z",
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.reason, "V2_EXIT_RUNTIME_CANARY_PASS");
  assert.strictEqual(artifact.exchange_write_performed, false);
  assert.strictEqual(artifact.tp1_missing_n, 0);
  assert.strictEqual(artifact.native_refresh_unhealthy_n, 0);
  assert.strictEqual(artifact.unprotected_window_violation_n, 0);
  assert.strictEqual(artifact.alert_silent_drop_n, 0);
  assert.strictEqual(artifact.alert_outbox_integrity_gap_n, 0);
})();

(function preTp1MissingTp1OrderFailsClosed() {
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({ runtimeDoc: runtime({ tp1_order_id: null }) })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.reason, "V2_EXIT_RUNTIME_CANARY_BLOCKED");
  assert.strictEqual(artifact.tp1_missing_n, 1);
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_TP1_ORDER_MISSING"));
})();

(function nativeRefreshUnhealthyFailsClosed() {
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({ runtimeDoc: runtime({ native_refresh_status: "ERROR" }) })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.native_refresh_unhealthy_n, 1);
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_NATIVE_REFRESH_UNHEALTHY"));
})();

(function unprotectedWindowFailsClosed() {
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({ runtimeDoc: runtime({ last_gap_ms: 2500 }) })],
    config: resolveExitRuntimeCanaryConfig({ DONBEOLJA_V2_EXIT_RUNTIME_CANARY_MAX_UNPROTECTED_WINDOW_MS: "1000" }),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.unprotected_window_violation_n, 1);
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_VIOLATION"));
})();

(function tp1DoneRequiresTransitionAlertSent() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TP1_DONE", tp1_done: true }),
      transitions: [tp1],
      outboxes: [{
        alert_outbox_id: "TAO__CET__TP1",
        position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__ABC",
        canonical_transition_id: "CET__TP1",
        status: "FAILED",
      }],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.alert_silent_drop_n, 1);
  assert.strictEqual(artifact.alert_retry_unresolved_n, 0);
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_TP1_REACHED_TRANSITION_ALERT_OUTBOX_LINEAGE"));
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_ALERT_SILENT_DROP"));
})();

(function tp1DoneSeparatesRetryableOutboxFromSilentDrop() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TP1_DONE", tp1_done: true }),
      transitions: [tp1],
      outboxes: [outbox("CET__TP1", "FAILED")],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.alert_silent_drop_n, 0);
  assert.strictEqual(artifact.alert_retry_unresolved_n, 1);
  assert.strictEqual(artifact.alert_outbox_integrity_gap_n, 0);
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_TP1_REACHED_TRANSITION_ALERT_SENT"));
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_ALERT_RETRY_UNRESOLVED"));
})();

(function duplicateAlertOutboxFailsClosedSeparatelyFromRetry() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const duplicateOutbox = {
    ...outbox("CET__TP1"),
    alert_outbox_id: "TAO__CET__TP1__DUP",
    delivery_request: {
      dedupeKey: "TAO__CET__TP1__DUP",
      dedupeFingerprint: "CET__TP1",
    },
  };
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TP1_DONE", tp1_done: true }),
      transitions: [tp1],
      outboxes: [outbox("CET__TP1"), duplicateOutbox],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.alert_silent_drop_n, 0);
  assert.strictEqual(artifact.alert_retry_unresolved_n, 0);
  assert.strictEqual(artifact.alert_outbox_integrity_gap_n, 1);
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_SINGLETON_PER_TRANSITION"));
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_INTEGRITY_GAP"));
})();

(function orphanAlertOutboxFailsClosedSeparatelyFromLineage() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const orphanOutbox = outbox("CET__ORPHAN");
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TP1_DONE", tp1_done: true }),
      transitions: [tp1],
      outboxes: [outbox("CET__TP1"), orphanOutbox],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.alert_silent_drop_n, 0);
  assert.strictEqual(artifact.alert_retry_unresolved_n, 0);
  assert.strictEqual(artifact.alert_outbox_integrity_gap_n, 1);
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_HAS_TRANSITION"));
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_INTEGRITY_GAP"));
})();

(function trailActiveRequiresTrailStopAndTransitionAlerts() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const trail = transition("TRAIL_ACTIVATED", "CET__TRAIL");
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TRAIL_ACTIVE", tp1_done: true, trail_active: true, native_stop_price: 2410 }),
      runtimeDoc: runtime({
        tp1_order_id: null,
        native_stop_price: 2410,
        last_exchange_evidence: { evidence_kind: "TRAIL_ACTIVATION", raw_payload: { execution_type: "AMENDMENT" } },
      }),
      transitions: [tp1, trail],
      outboxes: [outbox("CET__TP1"), outbox("CET__TRAIL")],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.alert_silent_drop_n, 0);
  assert.strictEqual(artifact.alert_retry_unresolved_n, 0);
  assert.strictEqual(artifact.alert_outbox_integrity_gap_n, 0);
  assert.strictEqual(artifact.trail_activation_evidence_gap_n, 0);
})();

(function trailActiveRequiresNativeRefreshEvidenceChain() {
  const tp1 = transition("TP1_REACHED", "CET__TP1");
  const trail = {
    ...transition("TRAIL_ACTIVATED", "CET__TRAIL"),
    source_exchange_evidence: null,
  };
  const artifact = evaluateExitRuntimeCanaryState({
    rows: [stateRow({
      projectionDoc: projection({ stage: "TRAIL_ACTIVE", tp1_done: true, trail_active: true, native_stop_price: 2410 }),
      runtimeDoc: runtime({ tp1_order_id: null, native_stop_price: 2410 }),
      transitions: [tp1, trail],
      outboxes: [outbox("CET__TP1"), outbox("CET__TRAIL")],
    })],
    config: resolveExitRuntimeCanaryConfig({}),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.trail_activation_evidence_gap_n, 2);
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_PRESENT"));
  assert.ok(artifact.failed_check_ids.includes("EXIT_RUNTIME_CANARY_TRAIL_PROTECTION_EVIDENCE_PRESENT"));
  assert.ok(artifact.blockers.includes("EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_GAP"));
})();

function buildFakeDb(seed) {
  const docs = new Map();
  function key(collection, id) { return `${collection}/${id}`; }
  for (const [collection, rows] of Object.entries(seed)) {
    for (const row of rows) {
      const id = row.exit_runtime_projection_id
        || row.protection_runtime_id
        || row.canonical_transition_id
        || row.alert_outbox_id
        || row.position_cycle_id;
      docs.set(key(collection, id), { ...row });
    }
  }
  return {
    collection(collectionName) {
      return {
        doc(id) {
          return {
            async get() {
              const doc = docs.get(key(collectionName, id));
              return { exists: !!doc, data: () => ({ ...doc }) };
            },
          };
        },
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  const rows = Array.from(docs.entries())
                    .filter(([path]) => path.startsWith(`${collectionName}/`))
                    .map(([, doc]) => doc)
                    .filter((doc) => (op === "==" ? doc[field] === value : true))
                    .slice(0, limit)
                    .map((doc) => ({ data: () => ({ ...doc }) }));
                  return { docs: rows };
                },
              };
            },
          };
        },
      };
    },
  };
}

async function loaderUsesBoundedActiveCyclesAndLinkedDocs() {
  const positionCycle = cycle();
  const projectionDoc = projection();
  const runtimeDoc = runtime();
  const db = buildFakeDb({
    dbjv2__position_cycles_v2: [positionCycle],
    dbjv2__exit_runtime_projection_v2: [projectionDoc],
    dbjv2__protection_runtime_v2: [runtimeDoc],
    dbjv2__canonical_exit_transitions_v2: [],
    dbjv2__trade_alert_outbox_v2: [],
  });
  const loaded = await loadExitRuntimeCanaryStateRows({
    db,
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    config: resolveExitRuntimeCanaryConfig({ DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ACTIVE_POSITION_LIMIT: "5" }),
  });
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.rows.length, 1);
  assert.strictEqual(loaded.rows[0].projection.exit_runtime_projection_id, projectionDoc.exit_runtime_projection_id);
  assert.strictEqual(loaded.rows[0].protectionRuntime.protection_runtime_id, runtimeDoc.protection_runtime_id);
  assert.strictEqual(loaded.query_budget.active_position_limit, 5);
}

loaderUsesBoundedActiveCyclesAndLinkedDocs()
  .then(() => {
    console.log("V2_EXIT_RUNTIME_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
