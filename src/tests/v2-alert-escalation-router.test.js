"use strict";

const assert = require("assert");

const {
  SEVERITY_CANARY,
  SEVERITY_OPS,
  SEVERITY_CRITICAL,
  DEFAULT_REPEAT_INTERVAL_MS,
  resolveAlertEscalationPolicy,
  resolveAlertChannelMap,
  resolveTargetChannel,
  normalizeSeverityRoute,
  buildEscalationFingerprint,
  buildEscalationDocPath,
  evaluateCriticalDecision,
  routeEscalatedAlert,
  ackEscalation,
  recoverEscalation,
  __test,
} = require("../v2/alertEscalationRouter");

function makeFakeFirestore() {
  const docs = new Map();
  return {
    docs,
    doc(path) {
      return {
        path,
        async get() {
          return docs.has(path)
            ? { exists: true, data: () => ({ ...docs.get(path) }) }
            : { exists: false, data: () => null };
        },
        async set(payload, options = {}) {
          const merge = options && options.merge === true;
          if (merge && docs.has(path)) {
            docs.set(path, { ...docs.get(path), ...payload });
          } else {
            docs.set(path, { ...payload });
          }
          return null;
        },
      };
    },
  };
}

function makeSendAlertSpy({ ok = true } = {}) {
  const calls = [];
  return {
    calls,
    fn: async (args) => {
      calls.push({ ...args });
      return { ok, results: [] };
    },
  };
}

function assertEqualSeverityRoutes() {
  assert.strictEqual(normalizeSeverityRoute("INFO"), SEVERITY_CANARY);
  assert.strictEqual(normalizeSeverityRoute("WARN"), SEVERITY_CANARY);
  assert.strictEqual(normalizeSeverityRoute("WARNING"), SEVERITY_CANARY);
  assert.strictEqual(normalizeSeverityRoute("ERROR"), SEVERITY_OPS);
  assert.strictEqual(normalizeSeverityRoute("ERR"), SEVERITY_OPS);
  assert.strictEqual(normalizeSeverityRoute("CRIT"), SEVERITY_CRITICAL);
  assert.strictEqual(normalizeSeverityRoute("CRITICAL"), SEVERITY_CRITICAL);
  assert.strictEqual(normalizeSeverityRoute("FATAL"), SEVERITY_CRITICAL);
  assert.strictEqual(normalizeSeverityRoute("P0"), SEVERITY_CRITICAL);
  assert.strictEqual(normalizeSeverityRoute("UNKNOWN_LABEL"), SEVERITY_CANARY);
  assert.strictEqual(normalizeSeverityRoute(""), SEVERITY_CANARY);
}

function assertChannelMap() {
  const env = {
    DONBEOLJA_V2_ALERT_CANARY_CHANNEL: "telegram:111",
    DONBEOLJA_V2_ALERT_OPS_CHANNEL: "telegram:222",
    DONBEOLJA_V2_ALERT_CRITICAL_CHANNEL: "telegram:333",
  };
  const map = resolveAlertChannelMap(env);
  assert.strictEqual(map[SEVERITY_CANARY], "telegram:111");
  assert.strictEqual(map[SEVERITY_OPS], "telegram:222");
  assert.strictEqual(map[SEVERITY_CRITICAL], "telegram:333");

  // Critical falls back to ops if not set
  const map2 = resolveAlertChannelMap({
    DONBEOLJA_V2_ALERT_CANARY_CHANNEL: "telegram:111",
    DONBEOLJA_V2_ALERT_OPS_CHANNEL: "telegram:222",
  });
  assert.strictEqual(map2[SEVERITY_CRITICAL], "telegram:222");

  // Empty env
  const map3 = resolveAlertChannelMap({});
  assert.strictEqual(map3[SEVERITY_CANARY], null);
  assert.strictEqual(map3[SEVERITY_OPS], null);
  assert.strictEqual(map3[SEVERITY_CRITICAL], null);
}

function assertTargetChannelFallback() {
  const map = {
    [SEVERITY_CANARY]: null,
    [SEVERITY_OPS]: null,
    [SEVERITY_CRITICAL]: null,
  };
  // Should fall back when channelMap is empty
  assert.strictEqual(
    resolveTargetChannel({ route: SEVERITY_CRITICAL, channelMap: map, fallbackChannel: "telegram:fb" }),
    "telegram:fb"
  );
  // Channel map wins over fallback
  const filledMap = {
    [SEVERITY_CANARY]: null,
    [SEVERITY_OPS]: null,
    [SEVERITY_CRITICAL]: "telegram:333",
  };
  assert.strictEqual(
    resolveTargetChannel({ route: SEVERITY_CRITICAL, channelMap: filledMap, fallbackChannel: "telegram:fb" }),
    "telegram:333"
  );
}

function assertEscalationFingerprint() {
  const a = buildEscalationFingerprint({ severity: "CRITICAL", title: "X", body: "Y" });
  const b = buildEscalationFingerprint({ severity: "CRITICAL", title: "X", body: "Y" });
  assert.strictEqual(a, b, "deterministic for identical input");
  const c = buildEscalationFingerprint({ severity: "CRITICAL", title: "X", body: "Z" });
  assert.notStrictEqual(a, c, "body change changes fingerprint");
  const d = buildEscalationFingerprint({ fingerprint: "user_fp" });
  assert.strictEqual(d, "user_fp", "explicit fingerprint wins");
  const docPath = buildEscalationDocPath(a);
  assert.ok(docPath.startsWith("runtime_locks/v2_alert_escalation__"), "doc path namespaced");
}

function assertCriticalDecisionTransitions() {
  const policy = {
    enabled: true,
    repeat_interval_ms: 5 * 60 * 1000,
    max_repeat_n: 3,
    state_ttl_ms: 24 * 60 * 60 * 1000,
  };
  const t0 = 1_000_000_000_000;

  // No state -> SEND_FIRST
  const dFirst = evaluateCriticalDecision({ state: null, nowMs: t0, policy });
  assert.strictEqual(dFirst.action, "SEND_FIRST");
  assert.strictEqual(dFirst.next_repeat_n, 1);

  // Within interval -> SUPPRESS / REPEAT_INTERVAL_NOT_ELAPSED
  const dWithin = evaluateCriticalDecision({
    state: { repeat_n: 1, last_sent_ms: t0 - 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  assert.strictEqual(dWithin.action, "SUPPRESS");
  assert.strictEqual(dWithin.reason, "REPEAT_INTERVAL_NOT_ELAPSED");

  // After interval -> SEND_REPEAT
  const dRepeat = evaluateCriticalDecision({
    state: { repeat_n: 1, last_sent_ms: t0 - 6 * 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  assert.strictEqual(dRepeat.action, "SEND_REPEAT");
  assert.strictEqual(dRepeat.next_repeat_n, 2);

  // Acknowledged -> SUPPRESS
  const dAcked = evaluateCriticalDecision({
    state: { repeat_n: 2, last_sent_ms: t0 - 6 * 60_000, status: "ACKNOWLEDGED" },
    nowMs: t0,
    policy,
  });
  assert.strictEqual(dAcked.action, "SUPPRESS");
  assert.strictEqual(dAcked.reason, "ACKNOWLEDGED");

  // Recovered -> SUPPRESS
  const dRecovered = evaluateCriticalDecision({
    state: { repeat_n: 2, last_sent_ms: t0 - 6 * 60_000, status: "RECOVERED" },
    nowMs: t0,
    policy,
  });
  assert.strictEqual(dRecovered.action, "SUPPRESS");
  assert.strictEqual(dRecovered.reason, "ACKNOWLEDGED");

  // Max repeat -> SUPPRESS
  const dMax = evaluateCriticalDecision({
    state: { repeat_n: 3, last_sent_ms: t0 - 6 * 60_000, status: "ACTIVE" },
    nowMs: t0,
    policy,
  });
  assert.strictEqual(dMax.action, "SUPPRESS");
  assert.strictEqual(dMax.reason, "MAX_REPEAT_REACHED");
}

async function assertRouterPassthroughWhenDisabled() {
  const sendSpy = makeSendAlertSpy();
  const result = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Disabled passthrough",
    body: "x",
    fallbackChannel: "telegram:fallback",
    env: { DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "0" },
    sendAlertFn: sendSpy.fn,
    db: null,
  });
  assert.strictEqual(result.reason, "ROUTER_DISABLED_PASSTHROUGH");
  assert.strictEqual(sendSpy.calls.length, 1);
  assert.strictEqual(sendSpy.calls[0].channel, "telegram:fallback");
  assert.strictEqual(sendSpy.calls[0].severity, "CRITICAL");
}

async function assertRouterDirectInfoWarn() {
  const env = {
    DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "1",
    DONBEOLJA_V2_ALERT_CANARY_CHANNEL: "telegram:canary",
    DONBEOLJA_V2_ALERT_OPS_CHANNEL: "telegram:ops",
    DONBEOLJA_V2_ALERT_CRITICAL_CHANNEL: "telegram:crit",
  };
  const sendSpy = makeSendAlertSpy();
  const r1 = await routeEscalatedAlert({
    severity: "INFO",
    title: "info ping",
    body: "x",
    env,
    sendAlertFn: sendSpy.fn,
  });
  assert.strictEqual(r1.target_channel, "telegram:canary");
  assert.strictEqual(r1.route, SEVERITY_CANARY);

  const r2 = await routeEscalatedAlert({
    severity: "WARN",
    title: "warn ping",
    body: "x",
    env,
    sendAlertFn: sendSpy.fn,
  });
  assert.strictEqual(r2.target_channel, "telegram:canary");

  const r3 = await routeEscalatedAlert({
    severity: "ERROR",
    title: "error ping",
    body: "x",
    env,
    sendAlertFn: sendSpy.fn,
  });
  assert.strictEqual(r3.target_channel, "telegram:ops");
  assert.strictEqual(r3.route, SEVERITY_OPS);

  assert.strictEqual(sendSpy.calls.length, 3);
}

async function assertRouterCriticalRepeatLifecycle() {
  const env = {
    DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "1",
    DONBEOLJA_V2_ALERT_CANARY_CHANNEL: "telegram:canary",
    DONBEOLJA_V2_ALERT_OPS_CHANNEL: "telegram:ops",
    DONBEOLJA_V2_ALERT_CRITICAL_CHANNEL: "telegram:crit",
    DONBEOLJA_V2_ALERT_ESCALATION_REPEAT_INTERVAL_MS: String(5 * 60 * 1000),
    DONBEOLJA_V2_ALERT_ESCALATION_MAX_REPEAT_N: "3",
  };
  const fakeDb = makeFakeFirestore();
  const sendSpy = makeSendAlertSpy();
  let nowMs = 1_000_000_000_000;
  const fingerprint = "FP_UNPROTECTED_BNBUSDT";

  // 1) First sighting -> SEND_FIRST
  const r1 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r1.reason, "FIRST_SIGHTING_SENT");
  assert.strictEqual(r1.target_channel, "telegram:crit");
  assert.strictEqual(sendSpy.calls.length, 1);
  assert.ok(sendSpy.calls[0].title.includes("Unprotected position"));
  // No repeat label on first send
  assert.ok(!sendSpy.calls[0].title.includes("재알림"));

  // 2) Within 5 minutes -> COOLDOWN suppressed
  nowMs += 60 * 1000;
  const r2 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r2.suppressed, true);
  assert.strictEqual(r2.reason, "REPEAT_INTERVAL_NOT_ELAPSED");
  assert.strictEqual(sendSpy.calls.length, 1, "no extra send during cooldown");

  // 3) After interval -> SEND_REPEAT (#2)
  nowMs += 5 * 60 * 1000 + 1000;
  const r3 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r3.reason, "REPEAT_SENT");
  assert.strictEqual(sendSpy.calls.length, 2);
  assert.ok(sendSpy.calls[1].title.includes("재알림 2"));

  // 4) After interval -> SEND_REPEAT (#3) hits max boundary next time
  nowMs += 5 * 60 * 1000 + 1000;
  const r4 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r4.reason, "REPEAT_SENT");
  assert.strictEqual(sendSpy.calls.length, 3);
  assert.ok(sendSpy.calls[2].title.includes("재알림 3"));

  // 5) After interval -> max repeat reached, SUPPRESS
  nowMs += 5 * 60 * 1000 + 1000;
  const r5 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r5.suppressed, true);
  assert.strictEqual(r5.reason, "MAX_REPEAT_REACHED");
  assert.strictEqual(sendSpy.calls.length, 3, "no send when max reached");

  // 6) Acknowledge -> next call SUPPRESS / ACKNOWLEDGED
  const ack = await ackEscalation({ db: fakeDb, fingerprint, ackReason: "OPERATOR_ACK_TEST" });
  assert.strictEqual(ack.ok, true);
  assert.strictEqual(ack.status, "ACKNOWLEDGED");
  nowMs += 60 * 60 * 1000;
  const r6 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "BNBUSDT",
    fingerprint,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r6.suppressed, true);
  assert.strictEqual(r6.reason, "ACKNOWLEDGED");
  assert.strictEqual(sendSpy.calls.length, 3);

  // 7) Recover (alternative termination)
  const fingerprint2 = "FP_UNPROTECTED_XRPUSDT";
  await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "XRPUSDT",
    fingerprint: fingerprint2,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  const recover = await recoverEscalation({ db: fakeDb, fingerprint: fingerprint2 });
  assert.strictEqual(recover.ok, true);
  assert.strictEqual(recover.status, "RECOVERED");
  nowMs += 60 * 60 * 1000;
  const r7 = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "Unprotected position",
    body: "XRPUSDT",
    fingerprint: fingerprint2,
    env,
    db: fakeDb,
    sendAlertFn: sendSpy.fn,
    now: () => nowMs,
  });
  assert.strictEqual(r7.suppressed, true);
  assert.strictEqual(r7.reason, "ACKNOWLEDGED");
}

async function assertRouterNoChannelResolved() {
  const env = {
    DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "1",
    // no channel envs set
  };
  const sendSpy = makeSendAlertSpy();
  const r = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "no chan",
    body: "x",
    env,
    sendAlertFn: sendSpy.fn,
    db: null,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "NO_CHANNEL_RESOLVED");
  assert.strictEqual(sendSpy.calls.length, 0);
}

async function assertRouterFirestoreUnavailableDoesNotThrow() {
  const env = {
    DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "1",
    DONBEOLJA_V2_ALERT_CRITICAL_CHANNEL: "telegram:crit",
  };
  const sendSpy = makeSendAlertSpy();
  // db=null path: read returns null, persist returns false, but send still happens
  const r = await routeEscalatedAlert({
    severity: "CRITICAL",
    title: "fs missing",
    body: "x",
    env,
    db: null,
    sendAlertFn: sendSpy.fn,
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, "FIRST_SIGHTING_SENT");
  assert.strictEqual(r.persist_ok, false);
  assert.strictEqual(sendSpy.calls.length, 1);
}

function assertPolicyResolution() {
  const policyDefault = resolveAlertEscalationPolicy({});
  assert.strictEqual(policyDefault.enabled, false, "default OFF");
  assert.strictEqual(policyDefault.repeat_interval_ms, DEFAULT_REPEAT_INTERVAL_MS);
  assert.ok(policyDefault.max_repeat_n >= 1);

  const policyOn = resolveAlertEscalationPolicy({
    DONBEOLJA_V2_ALERT_ESCALATION_ROUTER_ENABLED: "1",
    DONBEOLJA_V2_ALERT_ESCALATION_REPEAT_INTERVAL_MS: "60000",
    DONBEOLJA_V2_ALERT_ESCALATION_MAX_REPEAT_N: "10",
  });
  assert.strictEqual(policyOn.enabled, true);
  assert.strictEqual(policyOn.repeat_interval_ms, 60000);
  assert.strictEqual(policyOn.max_repeat_n, 10);

  // minimum repeat interval clamp
  const policyClamp = resolveAlertEscalationPolicy({
    DONBEOLJA_V2_ALERT_ESCALATION_REPEAT_INTERVAL_MS: "100",
  });
  assert.ok(policyClamp.repeat_interval_ms >= 1000, "min repeat interval clamp");
}

(async () => {
  assertEqualSeverityRoutes();
  assertChannelMap();
  assertTargetChannelFallback();
  assertEscalationFingerprint();
  assertCriticalDecisionTransitions();
  assertPolicyResolution();
  await assertRouterPassthroughWhenDisabled();
  await assertRouterDirectInfoWarn();
  await assertRouterCriticalRepeatLifecycle();
  await assertRouterNoChannelResolved();
  await assertRouterFirestoreUnavailableDoesNotThrow();
  console.log("V2_ALERT_ESCALATION_ROUTER_TEST_OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
