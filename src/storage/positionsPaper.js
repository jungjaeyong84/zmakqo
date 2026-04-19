// src/storage/positionsPaper.js
const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { __test: positionEventTest } = require("./positionEvents");
const { __test: latestReadModelTest } = require("./positionReadModelLatest");
const { recordPositionWriterAuthorityEvent } = require("./positionWriterAuthorityEvents");
const { validatePositionSnapshotTransition } = require("../services/positionStateMachine");
const {
  validatePositionMetaPrices,
  describeViolations: describeMetaPriceViolations,
} = require("../services/positionMetaSchema");
const { normalizeTraceContext } = require("../utils/traceContext");
const { sendAlert } = require("../utils/alerts");

function nowIso() {
  return new Date().toISOString();
}

// 2026-04-19 PR #10: position meta price schema warn-only observation.
//
// 이 validator 는 아직 write 를 막지 않는다 — Cloud Logging 의
// `position_meta_price_schema_violation` warn 카운트가 0 에 수렴하는
// 것을 확인한 뒤에야 dev/CI 에서 throw 로 격상한다. 경로는:
//
//   1. warn-only (현재)   — 여기서 잡는 모든 위반을 관찰
//   2. dev/CI throw       — 카운트 0 수렴 후 POSITION_META_PRICE_SCHEMA_STRICT
//                           로 dev 경로에서 실패로 바꿈
//   3. prod optional      — prod 런타임에도 optional throw 로 확장
//
// 지금 이 지점에서 warn 을 발화해두면 PR #8 (trail_low=0) / PR #9
// (native_protection_stop_price=null → downstream 에서 0 으로 전락)
// 같은 class 의 버그가 어느 write path 에서 유입되는지를
// `mutation_kind + source + reason` 로 근본 위치까지 추적 가능.
function structuredLog(event, payload = {}, level = "log") {
  const rec = {
    event,
    ts: new Date().toISOString(),
    ...payload,
  };
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(rec));
  } catch (_) {
    console[fn](`[${event}] ${event}`);
  }
}

function observeMetaPriceSchema({
  meta,
  mutationKind,
  writerScope,
  exchange,
  symbol,
  source,
  reason,
  requestId,
  traceId,
  runId,
} = {}) {
  // meta 가 object 가 아니면 validator 가 즉시 ok=true 를 돌려주므로
  // 호출측에서 따로 guard 할 필요 없음. validator 자체가 비싸지 않고
  // (필드 8개 × hasOwnProperty) write 는 이미 Firestore RTT 를 동반하는
  // 훨씬 무거운 연산이므로 여기서 분기 타이밍을 아낄 이유도 없다.
  const res = validatePositionMetaPrices(meta);
  if (res.ok) return;
  structuredLog("position_meta_price_schema_violation", {
    exchange: exchange || null,
    symbol: symbol || null,
    mutation_kind: mutationKind || null,
    writer_scope: writerScope || null,
    source: source || null,
    reason: reason || null,
    request_id: requestId || null,
    trace_id: traceId || null,
    run_id: runId || null,
    violation_n: res.violations.length,
    violations: res.violations.slice(0, 8), // 8개 필드가 최대이므로 cap
    summary: describeMetaPriceViolations(res.violations),
  }, "warn");
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

// 2026-04-19 ROOT-CAUSE FIX: heartbeat used `db.runTransaction` on the
// same lease doc that `runWithPositionWriterLease` was also transacting
// against — the enclosing function ran a `setInterval` heartbeat loop
// concurrent with the initial synchronous heartbeat AND the eventual
// release. Two concurrent transactions on one doc exhaust the SDK's
// internal 5-attempt ABORTED retry budget under any network pressure,
// causing `10 ABORTED: cross-transaction contention` to leak to callers
// (including the BTCUSDT BE-raise path, which is how this was found).
//
// The transaction was unnecessary: heartbeat only needs to extend TTL
// if we still own the lease. Switching to read+conditional update
// removes the self-contention entirely. See companion note in
// `heartbeatBinanceNativeRefreshLease` in paperBinanceRunner.js.
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
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, holder: null, leaseUntil, holderId };
  }
  const data = snap.data() || {};
  const owner = String(data.owner || "");
  if (owner !== String(holderId || "")) {
    return { ok: false, holder: owner || null, leaseUntil, holderId };
  }
  await ref.update({
    lease_until_ms: leaseUntil,
    heartbeat_ms: now,
    heartbeat_at: new Date(now).toISOString(),
  });
  return { ok: true, holder: null, leaseUntil, holderId };
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

// 2026-04-18 P0-3: operator-facing inspect + force-release.
//
// `runWithPositionWriterLease` is robust when holders exit cleanly — the
// finally block always calls `releasePositionWriterLease`. But if a Cloud
// Run instance dies mid-mutation (OOM kill, SIGTERM with pending I/O,
// crash loop), the Firestore doc keeps `owner` set until `lease_until_ms`
// (TTL default 15s) elapses. That is the *design* — so new holders pick
// up once the lease expires. The operational gap is that we had no
// explicit admin surface to (a) see who holds the lease and (b) force a
// release in the emergency case where the TTL is misbehaving or an
// operator needs to intervene before 15s. Below fills that gap.

function summarizeLeaseDoc(data = {}, nowMs = Date.now()) {
  const owner = String(data.owner || "") || null;
  const leaseUntilMs = Number(data.lease_until_ms);
  const heartbeatMs = Number(data.heartbeat_ms);
  const releasedAt = String(data.released_at || "") || null;
  const leaseUntilValid = Number.isFinite(leaseUntilMs);
  const heartbeatValid = Number.isFinite(heartbeatMs);
  const expired = leaseUntilValid ? leaseUntilMs <= nowMs : true;
  const ageMs = leaseUntilValid ? (nowMs - leaseUntilMs) : null;
  const heartbeatAgeMs = heartbeatValid ? (nowMs - heartbeatMs) : null;
  return {
    owner,
    lease_until_ms: leaseUntilValid ? leaseUntilMs : null,
    heartbeat_ms: heartbeatValid ? heartbeatMs : null,
    released_at: releasedAt,
    expired,
    // Positive when lease has ALREADY expired. Negative means still
    // holding. Use this to decide "is this stale enough to reclaim?"
    expired_age_ms: ageMs,
    heartbeat_age_ms: heartbeatAgeMs,
  };
}

async function inspectPositionWriterLease({ exchange, symbol, db: dbOverride = null } = {}) {
  const db = dbOverride || getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  const snap = await ref.get();
  const nowMs = Date.now();
  if (!snap.exists) {
    return {
      exchange: upper(exchange),
      symbol: upper(symbol),
      exists: false,
      owner: null,
      expired: true,
      expired_age_ms: null,
      heartbeat_age_ms: null,
      lease_until_ms: null,
      heartbeat_ms: null,
      released_at: null,
      now_ms: nowMs,
    };
  }
  const summary = summarizeLeaseDoc(snap.data() || {}, nowMs);
  return {
    exchange: upper(exchange),
    symbol: upper(symbol),
    exists: true,
    now_ms: nowMs,
    ...summary,
  };
}

// Force-releases a position-writer lease iff it is stale, OR if
// `force: true` is passed by an explicit operator call.
//
// Return contract:
//   { ok: true, released: true,  reason: "STALE_RELEASED"        , lease: ... }
//   { ok: true, released: true,  reason: "FORCE_RELEASED"        , lease: ... }
//   { ok: true, released: false, reason: "NO_LEASE_DOC"          , lease: ... }
//   { ok: true, released: false, reason: "LEASE_NOT_STALE"       , lease: ... }
//
// `minStaleMs` is an extra guard rail — by default we require the lease
// to be stale for at least 1×TTL beyond its expiry before reclaiming,
// because the heartbeat loop could be momentarily slow. Setting
// `force: true` bypasses this.
async function forceReleaseStalePositionWriterLease({
  exchange,
  symbol,
  minStaleMs = POSITION_WRITER_LEASE_TTL_MS,
  force = false,
  actor = null,
  db: dbOverride = null,
} = {}) {
  const db = dbOverride || getFirestore();
  const ref = db.doc(buildPositionWriterLeaseDocPath(exchange, symbol));
  const releasedAtIso = new Date().toISOString();
  let outcome = { ok: true, released: false, reason: "NO_LEASE_DOC", lease: null };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      outcome = {
        ok: true,
        released: false,
        reason: "NO_LEASE_DOC",
        lease: {
          exchange: upper(exchange),
          symbol: upper(symbol),
          exists: false,
          owner: null,
          expired: true,
          expired_age_ms: null,
          heartbeat_age_ms: null,
          lease_until_ms: null,
          heartbeat_ms: null,
          released_at: null,
        },
      };
      return;
    }
    const nowMs = Date.now();
    const summary = summarizeLeaseDoc(snap.data() || {}, nowMs);
    const staleEnough = summary.expired === true
      && Number.isFinite(summary.expired_age_ms)
      && summary.expired_age_ms >= Math.max(0, Math.floor(Number(minStaleMs) || 0));
    if (!staleEnough && force !== true) {
      outcome = {
        ok: true,
        released: false,
        reason: "LEASE_NOT_STALE",
        lease: { exchange: upper(exchange), symbol: upper(symbol), exists: true, ...summary },
      };
      return;
    }
    tx.set(ref, {
      lease_until_ms: nowMs - 1,
      released_at: releasedAtIso,
      // Audit fields — deliberately NOT merged into the snap view above
      // so operators querying inspectPositionWriterLease next tick see
      // the trail.
      force_released_by: actor ? String(actor).slice(0, 120) : null,
      force_released_reason: force === true ? "FORCE_RELEASED" : "STALE_RELEASED",
    }, { merge: true });
    outcome = {
      ok: true,
      released: true,
      reason: force === true ? "FORCE_RELEASED" : "STALE_RELEASED",
      lease: { exchange: upper(exchange), symbol: upper(symbol), exists: true, ...summary },
    };
  });
  return outcome;
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

function shouldSuppressPositionWriterAuthorityAlert(err, {
  source = null,
} = {}) {
  const code = upper(err && err.code) || upper(err && err.message) || null;
  const holder = String(err && err.holder || "").trim().toLowerCase();
  const src = upper(source);
  if (code !== "POSITION_WRITE_LEASE_HELD") return false;
  if (src !== "BINANCE_FUTURES_POSITION_SYNC") return false;
  if (!holder.includes("donbeolja-exit-worker")) return false;
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
  suppressAlert = false,
  suppressRuntimeFamily = false,
  suppressRuntimeFamilyReason = null,
} = {}) {
  const code = upper(err && err.code) || upper(err && err.message) || "UNKNOWN";
  if (!["POSITION_WRITE_TOKEN_REQUIRED", "POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
    return false;
  }
  try {
    await recordPositionWriterAuthorityEvent({
      exchange,
      symbol,
      mutationKind,
      source,
      code,
      requestId,
      runId,
      traceId,
      error: String((err && err.message) || err || "").trim() || "UNKNOWN",
      expectedWriteToken: err && err.expected_write_token ? err.expected_write_token : null,
      actualWriteToken: err && err.actual_write_token ? err.actual_write_token : null,
      holder: err && err.holder ? err.holder : null,
      runtimeFamilySuppressed: suppressRuntimeFamily === true,
      runtimeFamilySuppressedReason: suppressRuntimeFamilyReason || null,
    });
  } catch (recordErr) {
    const msg = recordErr && recordErr.message ? recordErr.message : String(recordErr);
    console.warn("[POSITION_WRITER_AUTHORITY_EVENT_FAIL]", msg);
  }
  if (suppressAlert === true) return false;
  if (shouldSuppressPositionWriterAuthorityAlert(err, { source })) return false;
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

async function commitPositionMutationTransaction({
  tx,
  ref,
  trace,
  exchange,
  symbol,
  reason = null,
  previous = null,
  payload = null,
  transitionValidation = null,
  extra = null,
} = {}) {
  if (!POSITION_EVENT_LOG_ENABLED) {
    tx.set(ref, payload, { merge: true });
    return { bundle: null, afterSnapshot: { ...(previous || {}), ...(payload || {}), meta: payload && payload.meta ? payload.meta : ((previous && previous.meta) || {}) } };
  }
  const afterSnapshot = {
    ...(previous && typeof previous === "object" ? previous : {}),
    ...(payload && typeof payload === "object" ? payload : {}),
    meta: payload && Object.prototype.hasOwnProperty.call(payload, "meta")
      ? payload.meta
      : ((previous && previous.meta) || {}),
  };
  const bundle = positionEventTest.buildPositionEventBundle({
    exchange,
    symbol,
    mutationKind: trace && trace.mutation_kind,
    requestId: trace && trace.request_id,
    runId: trace && trace.run_id,
    traceId: trace && trace.trace_id,
    source: trace && trace.source,
    reason,
    before: cloneValue(previous),
    after: cloneValue(afterSnapshot),
    transition: transitionValidation,
    extra,
  });
  const latestRef = ref.firestore.collection("position_read_model_latest").doc(bundle.latestReadModelDoc.read_model_id);
  const latestSnap = await tx.get(latestRef);
  const latestPrev = latestSnap.exists ? (latestSnap.data() || null) : null;
  tx.set(ref, payload, { merge: true });
  tx.set(ref.firestore.collection("position_events").doc(bundle.eventId), bundle.eventDoc, { merge: false });
  tx.set(ref.firestore.collection("unified_event_timeline").doc(bundle.unifiedEventDoc.unified_event_id), bundle.unifiedEventDoc, { merge: false });
  if (latestReadModelTest.shouldReplaceLatestPositionReadModel(latestPrev, bundle.latestReadModelDoc)) {
    tx.set(latestRef, bundle.latestReadModelDoc, { merge: false });
  }
  return {
    bundle,
    afterSnapshot,
  };
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
  const current = await getPosition({ exchange, symbol });
  if (!current || !current.pos_id) {
    return { ok: true, cleared: false, reason: "POSITION_NOT_FOUND", pos_id: posId({ exchange, symbol }) };
  }
  const meta = (current && typeof current.meta === "object") ? current.meta : {};
  if (!matchesTpP1PendingSnapshot(meta, { pendingAtMs, pendingUntilMs, pendingEvent })) {
    return { ok: true, cleared: false, reason: "PENDING_STATE_MISMATCH", pos_id: current.pos_id || posId({ exchange, symbol }) };
  }
  const nextMeta = buildTpP1PendingClearedMeta(meta, {
    clearedAt: clearedAt || nowIso(),
    clearedReason,
  });
  try {
    await upsertPositionMetaOnly({
      exchange,
      symbol,
      runId: current.run_id || null,
      executionMode: current.execution_mode || null,
      meta: nextMeta,
      source: "TP_P1_PENDING_CLEAR",
      mutationKind: "POSITION_META_CLEAR_TP_P1_PENDING",
      reason: clearedReason,
      expectedWriteToken: Object.prototype.hasOwnProperty.call(current || {}, "position_write_token")
        ? (current.position_write_token ?? null)
        : null,
    });
    return { ok: true, cleared: true, reason: "CLEARED", pos_id: current.pos_id || posId({ exchange, symbol }) };
  } catch (err) {
    const code = upper(err && err.code) || null;
    if (["POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
      return { ok: true, cleared: false, reason: code, pos_id: current.pos_id || posId({ exchange, symbol }) };
    }
    throw err;
  }
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
  suppressAuthorityAlert = false,
  suppressAuthorityRuntimeFamily = false,
  suppressAuthorityRuntimeFamilyReason = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  // PR #10: meta 가격 필드 schema 관찰 (warn-only, throw X).  트랜잭션
  // 밖에서 한 번만 발화 — 커밋 성공 여부와 무관하게 "writer 가 시도한
  // intent" 를 관찰하기 위함. 트랜잭션 retry 루프 안에 넣으면 같은
  // 논리적 intent 가 중복 warn 으로 튀어나와 카운트가 왜곡된다.
  observeMetaPriceSchema({
    meta,
    mutationKind,
    writerScope: "CORE",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
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
            const committed = await commitPositionMutationTransaction({
              tx,
              ref,
              trace,
              exchange,
              symbol,
              reason,
              previous,
              payload,
              transitionValidation,
              extra: {
                execution_mode: executionMode || null,
                budget_source: budgetSource || null,
                writer_version: payload.writer_version,
                core_writer_version: payload.core_writer_version,
                previous_position_write_token: payload.previous_position_write_token || null,
                position_write_token: payload.position_write_token || null,
              },
            });
            return {
              previous,
              payload,
              transitionValidation,
              bundle: committed.bundle,
            };
          }),
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
          suppressAlert: suppressAuthorityAlert === true,
          suppressRuntimeFamily: suppressAuthorityRuntimeFamily === true,
          suppressRuntimeFamilyReason: suppressAuthorityRuntimeFamilyReason || null,
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
  suppressAuthorityAlert = false,
  suppressAuthorityRuntimeFamily = false,
  suppressAuthorityRuntimeFamilyReason = null,
} = {}) {
  const expectedWriteTokenProvided = Object.prototype.hasOwnProperty.call(arguments[0] || {}, "expectedWriteToken");
  // PR #10: meta-only 경로는 trail_low / native_protection_stop_price
  // 등 가격 필드 업데이트가 가장 자주 들어오는 path.  bug class 검출
  // 밀도가 여기서 가장 높을 것으로 기대됨.  scope = "META".
  observeMetaPriceSchema({
    meta,
    mutationKind,
    writerScope: "META",
    exchange,
    symbol,
    source,
    reason,
    requestId,
    traceId,
    runId,
  });
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
            const committed = await commitPositionMutationTransaction({
              tx,
              ref,
              trace,
              exchange,
              symbol,
              reason,
              previous,
              payload,
              transitionValidation,
              extra: {
                execution_mode: executionMode || null,
                writer_version: payload.writer_version,
                meta_writer_version: payload.meta_writer_version,
                previous_position_write_token: payload.previous_position_write_token || null,
                position_write_token: payload.position_write_token || null,
              },
            });
            return {
              previous,
              payload,
              transitionValidation,
              bundle: committed.bundle,
            };
          }),
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
          suppressAlert: suppressAuthorityAlert === true,
          suppressRuntimeFamily: suppressAuthorityRuntimeFamily === true,
          suppressRuntimeFamilyReason: suppressAuthorityRuntimeFamilyReason || null,
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
  inspectPositionWriterLease,
  forceReleaseStalePositionWriterLease,
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
    shouldSuppressPositionWriterAuthorityAlert,
    notifyPositionWriterAuthorityFailure,
    serializePositionMutation,
    runWithPositionWriterLease,
    summarizeLeaseDoc,
    inspectPositionWriterLease,
    forceReleaseStalePositionWriterLease,
    heartbeatPositionWriterLease,
    observeMetaPriceSchema,
    structuredLog,
  },
};
