"use strict";

const { V2_SERVICES } = require("./constants");

const V2_SERVICE_BOUNDARIES = Object.freeze({
  [V2_SERVICES.OPENCLAW_CONTROL_PLANE]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "decide_signal_mode",
      "approve_or_block_signal",
      "set_policy_scope",
      "recommend_repair_or_rollback",
    ]),
  }),
  [V2_SERVICES.SIGNAL_AUTHORITY_ROUTER]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "normalize_signal_intent",
      "enforce_budget_guard",
      "enforce_min_order_guard",
      "dispatch_approved_entry_intent",
    ]),
  }),
  [V2_SERVICES.ML_AI_SIGNAL_ENGINE]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "build_feature_snapshot",
      "score_signal_quality",
      "emit_ml_ai_evidence",
    ]),
  }),
  [V2_SERVICES.ENTRY_EXECUTOR]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "submit_entry",
      "persist_position_cycle",
      "request_initial_protection",
    ]),
  }),
  [V2_SERVICES.PROTECTION_WRITER]: Object.freeze({
    mayWriteExchange: true,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "place_native_sl",
      "place_native_tp1",
      "refresh_native_stop",
      "measure_unprotected_gap",
    ]),
  }),
  [V2_SERVICES.USER_TRADE_SYNC]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "ingest_exchange_fill_evidence",
    ]),
  }),
  [V2_SERVICES.CANONICAL_EXIT_REDUCER]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: true,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "reduce_canonical_transition",
      "update_absolute_qty_ledger",
      "update_runtime_projection",
    ]),
  }),
  [V2_SERVICES.TICK_EXIT_WORKER]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "compute_trail_watermark",
      "request_stop_refresh",
    ]),
  }),
  [V2_SERVICES.WATCHDOG]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "compare_projection_vs_exchange",
      "emit_repair_request",
    ]),
  }),
  [V2_SERVICES.REPAIR_EXECUTOR]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: false,
    responsibilities: Object.freeze([
      "consume_repair_queue",
      "delegate_protection_writer",
    ]),
  }),
  [V2_SERVICES.ALERT_WORKER]: Object.freeze({
    mayWriteExchange: false,
    mayWriteCanonicalTransitions: false,
    mayWriteAlerts: true,
    responsibilities: Object.freeze([
      "build_alert_from_transition",
      "persist_alert_outbox",
      "deliver_alert",
    ]),
  }),
});

function assertSingleExchangeWriter(serviceName) {
  const writerNames = Object.entries(V2_SERVICE_BOUNDARIES)
    .filter(([, boundary]) => boundary.mayWriteExchange === true)
    .map(([name]) => name);
  const isSingleWriter = writerNames.length === 1 && writerNames[0] === serviceName;
  return {
    ok: isSingleWriter,
    writerNames,
  };
}

module.exports = {
  V2_SERVICE_BOUNDARIES,
  assertSingleExchangeWriter,
};
