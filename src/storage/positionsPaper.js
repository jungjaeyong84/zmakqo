// src/storage/positionsPaper.js
const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { recordPositionEvent } = require("./positionEvents");
const { validatePositionSnapshotTransition } = require("../services/positionStateMachine");
const { normalizeTraceContext } = require("../utils/traceContext");
const { sendAlert } = require("../utils/alerts");

function nowIso() {
  return new Date().toISOString();
}

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

const POSITION_STATE_MACHINE_STRICT = boolEnv("POSITION_STATE_MACHINE_STRICT", true);
const POSITION_EVENT_LOG_ENABLED = boolEnv("POSITION_EVENT_LOG_ENABLED", true);
const POSITION_EVENT_LOG_STRICT = boolEnv("POSITION_EVENT_LOG_STRICT", false);
const POSITION_WRITE_TOKEN_REQUIRED = boolEnv("POSITION_WRITE_TOKEN_REQUIRED", true);
const POSITION_WRITER_LEASE_ENABLED = boolEnv("POSITION_WRITER_LEASE_ENABLED", true);
const POSITION_WRITER_ALERT_ENABLED = boolEnv("POSITION_WRITER_ALERT_ENABLED", true);
const POSITION_WRITER_LEASE_TTL_MS = Math.max(3000, Math.floor(Number(process.env.POSITION_WRITER_LEASE_TTL_MS) || 15000));
const POSITION_WRITER_LEASE_WAIT_MS = Math.max(0, Math.floor(Number(process.env.POSITION_WRITER_LEASE_WAIT_MS) || 2000));
const POSITION_WRITER_ALERT_COOLDOWN_MS = Math.max(0, Math.floor(Number(process.env.POSITION_WRITER_ALERT_COOLDOWN_MS) || (5 * 60 * 1000)));
const POSITION_WRITER_ALERT_CHANNEL = String(
  process.env.POSITION_WRITER_ALERT_CHANNEL
  || process.env.EXIT_INTEGRITY_ALERT_CHANNEL
  || ""
).trim() || null;
const positionMutationQueue = new Map();
const positionWriterAlertState = new Map();
const positionWriterLeaseHolderId = `positions_paper_writer__${process.env.K_REVISION || process.env.HOSTNAME || "local"}__${process.pid}`;
const positionWriterLeaseDepth = new Map();

function posId({ exchange, symbol }) {
  return `POS__${String(exchange || "").toUpperCase().trim()}__${String(symbol || "").toUpperCase().trim()}`;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function cloneValue(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positionWriterLeaseKey(exchange, symbol) {
  return `${upper(exchange) || "UNKNOWN"}::${upper(symbol) || "UNKNOWN"}`;
}

async function serializePositionMutation({ exchange, symbol, runner } = {}) {
  if (typeof runner !== "function") throw new Error("serializePositionMutation: runner required");
  const key = `${upper(exchange) || "UNKNOWN"}::${upper(symbol) || "UNKNOWN"}`;
  const previous = positionMutationQueue.get(key) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => runner());
  positionMutationQueue.set(key, current);
  try {
    return await current;
  } finally {
    if (positionMutationQueue.get(key) === current) positionMutationQueue.delete(key);
  }
}

function derivePositionState(sizePct, meta = {}) {
  const size = Number(sizePct);
  if (!Number.isFinite(size) || size <= 0) return "FLAT";
  if (meta && meta.tp_p1_done === true) return "SCALE_OUT";
  if (size < 0.5) return "PROBE";
  return "COMMIT";
}

function buildFlatPositionSnapshot({ exchange, symbol, id = null } = {}) {
  return {
    pos_id: id || posId({ exchange, symbol }),
    exchange,
    symbol_or_pair_id: symbol,
    state: "FLAT",
    position_state: "FLAT",
    position_side: null,
    size_pct: 0,
    avg_price: null,
    qty_base: null,
    position_write_token: null,
    meta: {},
    updated_at: null,
  };
}

function formatTransitionIssues(issues = []) {
  return (Array.isArray(issues) ? issues : []).map((issue) => ({
    code: upper(issue && issue.code),
    severity: upper(issue && issue.severity),
    message: issue && issue.message ? String(issue.message) : null,
  }));
}

function buildTransitionError({ exchange, symbol, mutationKind, validation } = {}) {
  const issues = formatTransitionIssues(validation && validation.issues);
  const text = issues.map((issue) => `${issue.code}:${issue.severity}`).join(",");
  const err = new Error(`[POSITION_STATE_MACHINE] ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} ${upper(mutationKind) || "POSITION_UPSERT"} ${text || "INVALID"}`);
  err.code = "POSITION_STATE_MACHINE_REJECTED";
  err.validation = validation || null;
  return err;
}

function resolveNextWriterVersion(previous = {}, scope = "CORE") {
  const writerVersion = Number(previous.writer_version);
  const coreVersion = Number(previous.core_writer_version);
  const metaVersion = Number(previous.meta_writer_version);
  return {
    writer_version: (Number.isFinite(writerVersion) ? writerVersion : 0) + 1,
    core_writer_version: scope === "CORE"
      ? ((Number.isFinite(coreVersion) ? coreVersion : 0) + 1)
      : (Number.isFinite(coreVersion) ? coreVersion : 0),
    meta_writer_version: scope === "META"
      ? ((Number.isFinite(metaVersion) ? metaVersion : 0) + 1)
      : (Number.isFinite(metaVersion) ? metaVersion : 0),
  };
}

function buildNextPositionWriteToken() {
  return crypto.randomBytes(12).toString("hex");
}

function buildPositionWriterLeaseDocPath(exchange, symbol) {
  return `runtime_locks/positions_paper_writer__${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
}

async function acquirePositionWriterLease({
  exchange,
  symbol,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || POSITION_WRITER_LEASE_TTL_MS));
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
      return;
    }
    holder = owner || null;
  });
  return { acquired, holder, leaseUntil, holderId };
}

async function heartbeatPositionWriterLease({
  exchange,
  symbol,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || POSITION_WRITER_LEASE_TTL_MS));
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  let ok = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const owner = String(data.owner || "");
    if (owner !== String(holderId || "")) {
      holder = owner || null;
      return;
    }
    ok = true;
    tx.set(ref, {
      lease_until_ms: leaseUntil,
      heartbeat_ms: now,
      heartbeat_at: new Date(now).toISOString(),
    }, { merge: true });
  });
  return { ok, holder, leaseUntil, holderId };
}

async function releasePositionWriterLease({
  exchange,
  symbol,
  holderId = positionWriterLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

async function runWithPositionWriterLease({
  exchange,
  symbol,
  runner,
  leaseEnabled = POSITION_WRITER_LEASE_ENABLED,
  ttlMs = POSITION_WRITER_LEASE_TTL_MS,
  waitMs = POSITION_WRITER_LEASE_WAIT_MS,
  acquireLease = acquirePositionWriterLease,
  heartbeatLease = heartbeatPositionWriterLease,
  releaseLease = releasePositionWriterLease,
} = {}) {
  if (typeof runner !== "function") throw new Error("runWithPositionWriterLease: runner required");
  if (leaseEnabled !== true) return runner();
  const leaseKey = positionWriterLeaseKey(exchange, symbol);
  const activeDepth = Number(positionWriterLeaseDepth.get(leaseKey) || 0);
  if (activeDepth > 0) {
    positionWriterLeaseDepth.set(leaseKey, activeDepth + 1);
    try {
      return await runner();
    } finally {
      const nextDepth = Number(positionWriterLeaseDepth.get(leaseKey) || 1) - 1;
      if (nextDepth > 0) positionWriterLeaseDepth.set(leaseKey, nextDepth);
      else positionWriterLeaseDepth.delete(leaseKey);
    }
  }

  const deadline = Date.now() + Math.max(0, Math.floor(Number(waitMs) || 0));
  let lease = null;
  for (;;) {
    lease = await acquireLease({ exchange, symbol, ttlMs });
    if (lease && lease.acquired === true) break;
    if (Date.now() >= deadline) {
      const err = new Error(`POSITION_WRITE_LEASE_HELD ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} holder=${lease && lease.holder ? lease.holder : "UNKNOWN"}`);
      err.code = "POSITION_WRITE_LEASE_HELD";
      err.exchange = upper(exchange);
      err.symbol = upper(symbol);
      err.holder = lease && lease.holder ? lease.holder : null;
      throw err;
    }
    await sleep(200);
  }

  let heartbeatLost = false;
  const heartbeatEveryMs = Math.max(1000, Math.floor(Math.max(3000, ttlMs) / 3));
  const timer = setInterval(() => {
    heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId })
      .then((res) => {
        if (!res || res.ok !== true) heartbeatLost = true;
      })
      .catch(() => {
        heartbeatLost = true;
      });
  }, heartbeatEveryMs);

  try {
    positionWriterLeaseDepth.set(leaseKey, 1);
    const heartbeat = await heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId });
    if (!heartbeat || heartbeat.ok !== true) {
      const err = new Error(`POSITION_WRITE_LEASE_LOST ${upper(exchange) || "UNKNOWN"} ${upper(symbol) || "UNKNOWN"} holder=${heartbeat && heartbeat.holder ? heartbeat.holder : "UNKNOWN"}`);
      err.code = "POSITION_WRITE_LEASE_LOST";
      err.exchange = upper(exchange);
      err.symbol = upper(symbol);
      err.holder = heartbeat && heartbeat.holder ? heartbeat.holder : null;
      throw err;
    }
    const result = await runner();
    if (heartbeatLost && result && typeof result === "object") {
      return { ...result, position_writer_lease_lost_after_run: true };
    }
    return result;
  } finally {
    positionWriterLeaseDepth.delete(leaseKey);
    clearInterval(timer);
    await releaseLease({ exchange, symbol, holderId: lease && lease.holderId }).catch(() => {});
  }
}

function assertExpectedWriteToken(previous = {}, expectedWriteToken = null) {
  const expected = String(expectedWriteToken || "").trim() || null;
  if (!expected) return;
  const current = String(previous.position_write_token || "").trim() || null;
  if (current !== expected) {
    const err = new Error(`POSITION_WRITE_TOKEN_MISMATCH expected=${expected} actual=${current || "NULL"}`);
    err.code = "POSITION_WRITE_TOKEN_MISMATCH";
    err.expected_write_token = expected;
    err.actual_write_token = current;
    throw err;
  }
}

function assertExpectedWriteTokenProvided(provided = false) {
  if (!POSITION_WRITE_TOKEN_REQUIRED) return;
  if (provided === true) return;
  const err = new Error("POSITION_WRITE_TOKEN_REQUIRED");
  err.code = "POSITION_WRITE_TOKEN_REQUIRED";
  throw err;
}

function shouldSendPositionWriterAlert({
  exchange,
  symbol,
  mutationKind,
  code,
  nowMs = Date.now(),
  cooldownMs = POSITION_WRITER_ALERT_COOLDOWN_MS,
} = {}) {
  const key = [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(mutationKind) || "POSITION_UPSERT",
    upper(code) || "UNKNOWN",
  ].join("::");
  const lastAt = Number(positionWriterAlertState.get(key) || 0);
  if (Number.isFinite(lastAt) && lastAt > 0 && (nowMs - lastAt) < Math.max(0, Number(cooldownMs) || 0)) {
    return false;
  }
  positionWriterAlertState.set(key, nowMs);
  return true;
}

async function notifyPositionWriterAuthorityFailure(err, {
  exchange,
  symbol,
  mutationKind,
  source = null,
  requestId = null,
  runId = null,
  traceId = null,
} = {}) {
  const code = upper(err && err.code) || upper(err && err.message) || "UNKNOWN";
  if (!["POSITION_WRITE_TOKEN_REQUIRED", "POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
    return false;
  }
  if (POSITION_WRITER_ALERT_ENABLED !== true) return false;
  if (!POSITION_WRITER_ALERT_CHANNEL) return false;
  if (!shouldSendPositionWriterAlert({ exchange, symbol, mutationKind, code })) return false;
  const body = [
    `exchange=${upper(exchange) || "UNKNOWN"}`,
    `symbol=${upper(symbol) || "UNKNOWN"}`,
    `mutation=${upper(mutationKind) || "POSITION_UPSERT"}`,
    `source=${upper(source) || "UNKNOWN"}`,
    `code=${code}`,
    `request_id=${String(requestId || "").trim() || "NONE"}`,
    `run_id=${String(runId || "").trim() || "NONE"}`,
    `trace_id=${String(traceId || "").trim() || "NONE"}`,
    `error=${String((err && err.message) || err || "").trim() || "UNKNOWN"}`,
  ].join("\n");
  try {
    await sendAlert({
      channel: POSITION_WRITER_ALERT_CHANNEL,
      title: "positions_paper writer authority failure",
      body,
      severity: "WARN",
    });
    return true;
  } catch (alertErr) {
    const msg = alertErr && alertErr.message ? alertErr.message : String(alertErr);
    console.warn("[POSITION_WRITER_ALERT_FAIL]", msg);
    return false;
  }
}

async function recordPositionEventSafe(params = {}) {
  if (!POSITION_EVENT_LOG_ENABLED) return null;
  try {
    return await recordPositionEvent(params);
  } catch (err) {
    if (POSITION_EVENT_LOG_STRICT) throw err;
    const msg = err && err.message ? err.message : String(err);
    console.warn("[POSITION_EVENT_LOG_FAIL]", msg);
    return null;
  }
}

function matchesTpP1PendingSnapshot(meta = {}, {
  pendingAtMs = null,
  pendingUntilMs = null,
  pendingEvent = null,
} = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  if (state.tp_p1_pending !== true) return false;
  const currentAtMs = Number(state.tp_p1_pending_at_ms);
  const currentUntilMs = Number(state.tp_p1_pending_until_ms);
  const currentEvent = String(state.tp_p1_pending_event || "").trim().toUpperCase() || null;
  if (Number.isFinite(Number(pendingAtMs)) && currentAtMs !== Number(pendingAtMs)) return false;
  if (Number.isFinite(Number(pendingUntilMs)) && currentUntilMs !== Number(pendingUntilMs)) return false;
  if (pendingEvent != null && currentEvent !== (String(pendingEvent || "").trim().toUpperCase() || null)) return false;
  return true;
}

function buildTpP1PendingClearedMeta(meta = {}, {
  clearedAt,
  clearedReason = "PENDING_EXPIRED_NO_ACTIVE_INTENT",
} = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  return {
    ...state,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt || nowIso(),
    tp_p1_pending_cleared_reason: clearedReason,
  };
}

async function clearTpP1PendingIfUnchanged({
  exchange,
  symbol,
  pendingAtMs = null,
  pendingUntilMs = null,
  pendingEvent = null,
  clearedReason = "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  clearedAt = null,
} = {}) {
  const db = getFirestore();
  const id = posId({ exchange, symbol });
  const ref = db.collection("positions_paper").doc(id);
  const clearedAtIso = clearedAt || nowIso();
  let result = { ok: true, cleared: false, reason: "UNKNOWN", pos_id: id };

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      result = { ok: true, cleared: false, reason: "POSITION_NOT_FOUND", pos_id: id };
      return;
    }
    const current = snap.data() || {};
    const meta = (current && typeof current.meta === "object") ? current.meta : {};
    if (!matchesTpP1PendingSnapshot(meta, { pendingAtMs, pendingUntilMs, pendingEvent })) {
      result = { ok: true, cleared: false, reason: "PENDING_STATE_MISMATCH", pos_id: id };
      return;
    }
    const nextMeta = buildTpP1PendingClearedMeta(meta, {
      clearedAt: clearedAtIso,
      clearedReason,
    });
    tx.set(ref, {
      meta: nextMeta,
      updated_at: clearedAtIso,
    }, { merge: true });
    result = { ok: true, cleared: true, reason: "CLEARED", pos_id: id };
  });

  return result;
}

async function getPosition({ exchange, symbol } = {}) {
  const db = getFirestore();
  const id = posId({ exchange, symbol });
  const ref = db.collection("positions_paper").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return buildFlatPositionSnapshot({ exchange, symbol, id });
  }
  return snap.data();
}

async function upsertPosition({
  exchange,
  symbol,
  state,
  sizePct,
  avgPrice,
  runId,
  budgetMaxKrw,
  budgetUsedKrw,
    budgetSource,
  positionSide,
  meta = {},
  qtyBase = null,
  executionMode = null,
  requestId = null,
  traceId = null,
  source = null,
  mutationKind = "POSITION_UPSERT",
  reason = null,
  expectedWriteToken = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  return serializePositionMutation({
    exchange,
    symbol,
    runner: async () => {
      const db = getFirestore();
      const id = posId({ exchange, symbol });
        const ref = db.collection("positions_paper").doc(id);
      const trace = normalizeTraceContext({
        traceId,
        requestId,
        runId,
        exchange,
        symbol,
        mutationKind,
        source,
      });
      try {
        assertExpectedWriteTokenProvided(expectedWriteTokenProvided);
        const committed = await runWithPositionWriterLease({
          exchange,
          symbol,
          runner: () => db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const previous = snap.exists ? (snap.data() || {}) : buildFlatPositionSnapshot({ exchange, symbol, id });
            assertExpectedWriteToken(previous, expectedWriteToken);
            const positionState = derivePositionState(sizePct, meta);
            const transitionValidation = validatePositionSnapshotTransition({
              prev: previous,
              next: {
                ...previous,
                state: state || "FLAT",
                position_state: positionState,
                position_side: positionSide || null,
                size_pct: Number(sizePct),
                avg_price: avgPrice === null || avgPrice === undefined ? null : Number(avgPrice),
                qty_base: (qtyBase === null || qtyBase === undefined) ? null : Number(qtyBase),
                meta: meta || {},
              },
            });
            const transitionIssues = formatTransitionIssues(transitionValidation.issues);
            if (POSITION_STATE_MACHINE_STRICT && transitionValidation.ok !== true) {
              throw buildTransitionError({
                exchange,
                symbol,
                mutationKind,
                validation: transitionValidation,
              });
            }
            const versions = resolveNextWriterVersion(previous, "CORE");
            const nextWriteToken = buildNextPositionWriteToken();
            const payload = {
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              state: state || "FLAT",
              position_state: positionState,
              position_side: positionSide || null,
              size_pct: Number(sizePct),
              avg_price: avgPrice === null || avgPrice === undefined ? null : Number(avgPrice),
              qty_base: (qtyBase === null || qtyBase === undefined) ? null : Number(qtyBase),
              run_id: runId || null,
              execution_mode: executionMode || null,
              budget_max_krw: (budgetMaxKrw === null || budgetMaxKrw === undefined) ? null : Number(budgetMaxKrw),
              budget_used_krw: (budgetUsedKrw === null || budgetUsedKrw === undefined) ? null : Number(budgetUsedKrw),
              budget_source: budgetSource || null,
              meta: meta || {},
              trace_id: trace.trace_id,
              request_id: trace.request_id,
              last_mutation_kind: trace.mutation_kind,
              last_mutation_source: trace.source,
              last_mutation_reason: upper(reason),
              position_transition_ok: transitionValidation.ok === true,
              position_transition_issues: transitionIssues,
              previous_position_write_token: String(previous.position_write_token || "").trim() || null,
              position_write_token: nextWriteToken,
              writer_scope: "CORE",
              writer_authority_mode: POSITION_WRITER_LEASE_ENABLED ? "LEASED_TRANSACTIONAL" : "TRANSACTIONAL",
              writer_committed_at: nowIso(),
              ...versions,
              updated_at: nowIso(),
            };
            tx.set(ref, payload, { merge: true });
            return {
              previous,
              payload,
              transitionValidation,
            };
          }),
        });
        await recordPositionEventSafe({
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
          source: trace.source,
          reason,
          before: cloneValue(committed.previous),
          after: cloneValue({
            ...committed.previous,
            ...committed.payload,
            meta: committed.payload.meta,
          }),
          transition: committed.transitionValidation,
          extra: {
            execution_mode: executionMode || null,
            budget_source: budgetSource || null,
            writer_version: committed.payload.writer_version,
            core_writer_version: committed.payload.core_writer_version,
            previous_position_write_token: committed.payload.previous_position_write_token || null,
            position_write_token: committed.payload.position_write_token || null,
          },
        });
        return committed.payload;
      } catch (err) {
        await notifyPositionWriterAuthorityFailure(err, {
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          source: trace.source,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
        });
        throw err;
      }
    },
  });
}

async function upsertPositionMetaOnly({
  exchange,
  symbol,
  runId,
  executionMode,
  meta = {},
  requestId = null,
  traceId = null,
  source = null,
  mutationKind = "POSITION_META_UPSERT",
  reason = null,
  expectedWriteToken = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  return serializePositionMutation({
    exchange,
    symbol,
    runner: async () => {
      const db = getFirestore();
      const id = posId({ exchange, symbol });
      const ref = db.collection("positions_paper").doc(id);
      const trace = normalizeTraceContext({
        traceId,
        requestId,
        runId,
        exchange,
        symbol,
        mutationKind,
        source,
      });
      try {
        assertExpectedWriteTokenProvided(expectedWriteTokenProvided);
        const committed = await runWithPositionWriterLease({
          exchange,
          symbol,
          runner: () => db.runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            const previous = snap.exists ? (snap.data() || {}) : buildFlatPositionSnapshot({ exchange, symbol, id });
            assertExpectedWriteToken(previous, expectedWriteToken);
            const nextSnapshot = {
              ...previous,
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              run_id: runId || null,
              execution_mode: executionMode || null,
              meta: meta || {},
            };
            const transitionValidation = validatePositionSnapshotTransition({
              prev: previous,
              next: nextSnapshot,
            });
            const transitionIssues = formatTransitionIssues(transitionValidation.issues);
            if (POSITION_STATE_MACHINE_STRICT && transitionValidation.ok !== true) {
              throw buildTransitionError({
                exchange,
                symbol,
                mutationKind,
                validation: transitionValidation,
              });
            }
            const versions = resolveNextWriterVersion(previous, "META");
            const nextWriteToken = buildNextPositionWriteToken();
            const payload = {
              pos_id: id,
              exchange,
              symbol_or_pair_id: symbol,
              run_id: runId || null,
              execution_mode: executionMode || null,
              meta: meta || {},
              trace_id: trace.trace_id,
              request_id: trace.request_id,
              last_mutation_kind: trace.mutation_kind,
              last_mutation_source: trace.source,
              last_mutation_reason: upper(reason),
              position_transition_ok: transitionValidation.ok === true,
              position_transition_issues: transitionIssues,
              previous_position_write_token: String(previous.position_write_token || "").trim() || null,
              position_write_token: nextWriteToken,
              writer_scope: "META",
              writer_authority_mode: POSITION_WRITER_LEASE_ENABLED ? "LEASED_TRANSACTIONAL" : "TRANSACTIONAL",
              writer_committed_at: nowIso(),
              ...versions,
              updated_at: nowIso(),
            };
            tx.set(ref, payload, { merge: true });
            return {
              previous,
              payload,
              transitionValidation,
            };
          }),
        });
        await recordPositionEventSafe({
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
          source: trace.source,
          reason,
          before: cloneValue(committed.previous),
          after: cloneValue({
            ...committed.previous,
            ...committed.payload,
            meta: committed.payload.meta,
          }),
          transition: committed.transitionValidation,
          extra: {
            execution_mode: executionMode || null,
            writer_version: committed.payload.writer_version,
            meta_writer_version: committed.payload.meta_writer_version,
            previous_position_write_token: committed.payload.previous_position_write_token || null,
            position_write_token: committed.payload.position_write_token || null,
          },
        });
        return committed.payload;
      } catch (err) {
        await notifyPositionWriterAuthorityFailure(err, {
          exchange,
          symbol,
          mutationKind: trace.mutation_kind,
          source: trace.source,
          requestId: trace.request_id,
          runId: trace.run_id,
          traceId: trace.trace_id,
        });
        throw err;
      }
    },
  });
}

module.exports = {
  getPosition,
  upsertPosition,
  upsertPositionMetaOnly,
  clearTpP1PendingIfUnchanged,
  runWithPositionWriterLease,
  __test: {
    posId,
    derivePositionState,
    matchesTpP1PendingSnapshot,
    buildTpP1PendingClearedMeta,
    buildFlatPositionSnapshot,
    formatTransitionIssues,
    resolveNextWriterVersion,
    buildNextPositionWriteToken,
    buildPositionWriterLeaseDocPath,
    assertExpectedWriteToken,
    assertExpectedWriteTokenProvided,
    shouldSendPositionWriterAlert,
    serializePositionMutation,
    runWithPositionWriterLease,
  },
};
