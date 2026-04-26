#!/usr/bin/env node
"use strict";

// P2-3 alert escalation router contract gate.
//
// Verifies the standalone routing module's invariants without
// touching live Firestore or live alert transport. Designed to be
// runnable in CI (no I/O) and as a sanity gate before any future
// caller migration.

const router = require("../src/v2/alertEscalationRouter");

function fail(reason, detail) {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_ALERT_ESCALATION_ROUTER_GATE_FAILED",
    blocker: reason,
    detail: detail || null,
  }));
  process.exit(1);
}

function require_(condition, reason, detail) {
  if (!condition) fail(reason, detail);
}

function assertExports() {
  const expected = [
    "SEVERITY_CANARY",
    "SEVERITY_OPS",
    "SEVERITY_CRITICAL",
    "DEFAULT_REPEAT_INTERVAL_MS",
    "DEFAULT_MAX_REPEAT_N",
    "resolveAlertEscalationPolicy",
    "resolveAlertChannelMap",
    "resolveTargetChannel",
    "normalizeSeverityRoute",
    "buildEscalationFingerprint",
    "buildEscalationDocPath",
    "evaluateCriticalDecision",
    "buildPersistedState",
    "routeEscalatedAlert",
    "ackEscalation",
    "recoverEscalation",
  ];
  for (const key of expected) {
    require_(router[key] !== undefined, "MISSING_EXPORT", { key });
  }
}

function assertSeverityRoutes() {
  require_(router.normalizeSeverityRoute("INFO") === router.SEVERITY_CANARY, "INFO_ROUTE");
  require_(router.normalizeSeverityRoute("WARN") === router.SEVERITY_CANARY, "WARN_ROUTE");
  require_(router.normalizeSeverityRoute("ERROR") === router.SEVERITY_OPS, "ERROR_ROUTE");
  require_(router.normalizeSeverityRoute("CRITICAL") === router.SEVERITY_CRITICAL, "CRITICAL_ROUTE");
  require_(router.normalizeSeverityRoute("CRIT") === router.SEVERITY_CRITICAL, "CRIT_ROUTE");
  require_(router.normalizeSeverityRoute("FATAL") === router.SEVERITY_CRITICAL, "FATAL_ROUTE");
  require_(router.normalizeSeverityRoute("P0") === router.SEVERITY_CRITICAL, "P0_ROUTE");
}

function assertPolicyDefaults() {
  const policy = router.resolveAlertEscalationPolicy({});
  require_(policy.enabled === false, "DEFAULT_ENABLED_MUST_BE_FALSE");
  require_(policy.repeat_interval_ms === router.DEFAULT_REPEAT_INTERVAL_MS, "DEFAULT_REPEAT_INTERVAL_MS");
  require_(policy.max_repeat_n === router.DEFAULT_MAX_REPEAT_N, "DEFAULT_MAX_REPEAT_N");
  require_(router.DEFAULT_REPEAT_INTERVAL_MS === 5 * 60 * 1000, "REPEAT_INTERVAL_5_MIN");
}

function assertChannelMapShape() {
  const map = router.resolveAlertChannelMap({
    DONBEOLJA_V2_ALERT_CANARY_CHANNEL: "telegram:111",
    DONBEOLJA_V2_ALERT_OPS_CHANNEL: "telegram:222",
  });
  require_(map[router.SEVERITY_CANARY] === "telegram:111", "CANARY_CHANNEL_RESOLVED");
  require_(map[router.SEVERITY_OPS] === "telegram:222", "OPS_CHANNEL_RESOLVED");
  // Critical falls back to ops when not explicitly set
  require_(map[router.SEVERITY_CRITICAL] === "telegram:222", "CRITICAL_FALLS_BACK_TO_OPS");
}

function assertCriticalDecisionContract() {
  const policy = {
    enabled: true,
    repeat_interval_ms: 5 * 60 * 1000,
    max_repeat_n: 3,
    state_ttl_ms: 24 * 60 * 60 * 1000,
  };
  const t0 = 1_700_000_000_000;
  const dFirst = router.evaluateCriticalDecision({ state: null, nowMs: t0, policy });
  require_(dFirst.action === "SEND_FIRST", "FIRST_SIGHTING_ACTION");
  const dCooldown = router.evaluateCriticalDecision({
    state: { repeat_n: 1, last_sent_ms: t0 - 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  require_(dCooldown.action === "SUPPRESS" && dCooldown.reason === "REPEAT_INTERVAL_NOT_ELAPSED", "COOLDOWN_SUPPRESS");
  const dRepeat = router.evaluateCriticalDecision({
    state: { repeat_n: 1, last_sent_ms: t0 - 6 * 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  require_(dRepeat.action === "SEND_REPEAT", "REPEAT_DUE_ACTION");
  const dAck = router.evaluateCriticalDecision({
    state: { repeat_n: 2, last_sent_ms: t0 - 6 * 60_000, status: "ACKNOWLEDGED" },
    nowMs: t0,
    policy,
  });
  require_(dAck.action === "SUPPRESS" && dAck.reason === "ACKNOWLEDGED", "ACK_SUPPRESS");
  const dRecov = router.evaluateCriticalDecision({
    state: { repeat_n: 2, last_sent_ms: t0 - 6 * 60_000, status: "RECOVERED" },
    nowMs: t0,
    policy,
  });
  require_(dRecov.action === "SUPPRESS" && dRecov.reason === "ACKNOWLEDGED", "RECOVERED_SUPPRESS");
  const dMax = router.evaluateCriticalDecision({
    state: { repeat_n: 3, last_sent_ms: t0 - 10 * 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  require_(dMax.action === "SUPPRESS" && dMax.reason === "MAX_REPEAT_REACHED", "MAX_REPEAT_SUPPRESS");
}

function assertFingerprintStability() {
  const a = router.buildEscalationFingerprint({ severity: "CRITICAL", title: "x", body: "y" });
  const b = router.buildEscalationFingerprint({ severity: "CRITICAL", title: "x", body: "y" });
  require_(a === b, "FINGERPRINT_DETERMINISTIC");
  const c = router.buildEscalationFingerprint({ fingerprint: "user_fp" });
  require_(c === "user_fp", "EXPLICIT_FINGERPRINT_WINS");
  const docPath = router.buildEscalationDocPath(a);
  require_(docPath.startsWith("runtime_locks/v2_alert_escalation__"), "DOC_PATH_NAMESPACED");
}

(async () => {
  assertExports();
  assertSeverityRoutes();
  assertPolicyDefaults();
  assertChannelMapShape();
  assertCriticalDecisionContract();
  assertFingerprintStability();
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_ALERT_ESCALATION_ROUTER_GATE_PASS",
    check_n: 6,
  }));
})().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_ALERT_ESCALATION_ROUTER_GATE_THROWN",
    error_message: error && error.message ? error.message : String(error),
  }));
  process.exit(1);
});
