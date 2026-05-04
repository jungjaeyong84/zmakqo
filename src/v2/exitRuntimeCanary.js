"use strict";

const { getV2Doc, queryV2DocsByField } = require("./storage");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId } = require("./contracts");
const { evaluateActiveExitWatchdog } = require("./watchdog");

const DEFAULT_ACTIVE_POSITION_LIMIT = 25;
const DEFAULT_LINKED_DOC_LIMIT = 20;
const DEFAULT_MAX_UNPROTECTED_WINDOW_MS = 0;
const DEFAULT_ALERT_RETRY_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_OPERATIONAL_COLLECTION_PREFIX = "v2__";
const TERMINAL_STAGES = new Set(["EXITED_TP1", "EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);
const TERMINAL_POSITION_STATES = new Set(["FLAT", "CLOSED", "EXITED", "EXITED_TP1", "EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);
const ACTIVE_POSITION_STATES = new Set(["ACTIVE", "COMMIT", "PROBE", "SCALE_OUT"]);
const TRANSITION_ALERT_REQUIREMENTS = Object.freeze({
  TP1_DONE: Object.freeze(["TP1_REACHED"]),
  TRAIL_ACTIVE: Object.freeze(["TP1_REACHED", "TRAIL_ACTIVATED"]),
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function numbersMatch(left, right, epsilon = 1e-8) {
  const a = toNumber(left);
  const b = toNumber(right);
  return a != null && b != null && Math.abs(a - b) <= epsilon;
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function parseNonNegativeNumber(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

function parseBool(value, fallback = false) {
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasPlacedOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const status = upper(row[statusKey]);
  if (status) return status === "PLACED" && !!trimOrNull(row[orderKey]);
  return !!trimOrNull(row[orderKey]);
}

function resolveExitRuntimeCanaryConfig(env = process.env) {
  return Object.freeze({
    activePositionLimit: parsePositiveInt(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ACTIVE_POSITION_LIMIT, DEFAULT_ACTIVE_POSITION_LIMIT, { max: 100 }),
    transitionLimit: parsePositiveInt(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_TRANSITION_LIMIT, DEFAULT_LINKED_DOC_LIMIT, { max: 100 }),
    outboxLimit: parsePositiveInt(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_OUTBOX_LIMIT, DEFAULT_LINKED_DOC_LIMIT, { max: 100 }),
    maxUnprotectedWindowMs: parseNonNegativeNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_MAX_UNPROTECTED_WINDOW_MS, DEFAULT_MAX_UNPROTECTED_WINDOW_MS),
    alertRetryGraceMs: parseNonNegativeNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ALERT_RETRY_GRACE_MS, DEFAULT_ALERT_RETRY_GRACE_MS),
    useReadModelLatest: parseBool(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_USE_READ_MODEL_LATEST, true),
    readModelStrictLatestOnly: parseBool(env.POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY, false),
    readModelLatestLimit: parsePositiveInt(
      env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_READ_MODEL_LATEST_LIMIT,
      Math.max(100, parsePositiveInt(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ACTIVE_POSITION_LIMIT, DEFAULT_ACTIVE_POSITION_LIMIT, { max: 100 })),
      { min: 50, max: 2000 }
    ),
    exchange: upper(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_EXCHANGE || "BINANCEFUT"),
  });
}

function resolveExitRuntimeCanaryStorageEnv(env = process.env) {
  return Object.freeze({
    ...env,
    DONBEOLJA_V2_COLLECTION_PREFIX: trimOrNull(env.DONBEOLJA_V2_COLLECTION_PREFIX) || DEFAULT_OPERATIONAL_COLLECTION_PREFIX,
  });
}

async function getOptionalDoc({ db = null, env = process.env, collectionKey, docId } = {}) {
  const id = trimOrNull(docId);
  if (!id) return null;
  const result = await getV2Doc({ db, env, collectionKey, docId: id });
  return result && result.ok === true ? result.doc : null;
}

async function queryRows({ db = null, env = process.env, collectionKey, field, value, limit }) {
  const result = await queryV2DocsByField({ db, env, collectionKey, field, value, limit });
  return Array.isArray(result && result.rows) ? result.rows : [];
}

function countQueryLimitHits({ rows, limit }) {
  return asArray(rows).length >= Number(limit);
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function resolveLatestReadModelSnapshot(doc) {
  const row = doc && typeof doc === "object" ? doc : {};
  const snapshot = row.after_snapshot && typeof row.after_snapshot === "object" ? safeClone(row.after_snapshot) : null;
  const summary = row.after_summary && typeof row.after_summary === "object" ? safeClone(row.after_summary) : null;
  return Object.freeze({
    ...(summary || {}),
    ...(snapshot || {}),
    read_model_id: trimOrNull(row.read_model_id),
    read_model_ts_ms: toNumber(row.ts_ms),
    read_model_created_at: trimOrNull(row.created_at),
    read_model_source: "POSITION_READ_MODEL_LATEST",
    exchange: upper((snapshot && snapshot.exchange) || (summary && summary.exchange) || row.exchange),
    symbol: upper((snapshot && (snapshot.symbol || snapshot.symbol_or_pair_id)) || (summary && (summary.symbol || summary.symbol_or_pair_id)) || row.symbol),
  });
}

function resolveReadModelPositionCycleId(view) {
  const row = view && typeof view === "object" ? view : {};
  const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
  return trimOrNull(row.position_cycle_id)
    || trimOrNull(row.positionCycleId)
    || trimOrNull(row.cycle_id)
    || trimOrNull(meta.position_cycle_id)
    || trimOrNull(meta.positionCycleId)
    || null;
}

function isReadModelActiveProtectedCandidate(view) {
  const row = view && typeof view === "object" ? view : {};
  const status = upper(row.status || row.position_cycle_status);
  const state = upper(row.state || row.position_state);
  const qty = toNumber(row.qty_base ?? row.position_amt ?? row.size_base);
  if (status === "ACTIVE_PROTECTED") return !!resolveReadModelPositionCycleId(row);
  if (status && status !== "ACTIVE_PROTECTED") return false;
  if (TERMINAL_POSITION_STATES.has(state)) return false;
  if (!ACTIVE_POSITION_STATES.has(state)) return false;
  if (qty != null && Math.abs(qty) <= 0) return false;
  return !!resolveReadModelPositionCycleId(row);
}

async function queryLatestReadModels({ db = null, config = resolveExitRuntimeCanaryConfig({}) } = {}) {
  const firestore = db || require("../storage/firestore").getFirestore();
  const exchange = upper(config.exchange || "BINANCEFUT");
  const limit = Number(config.readModelLatestLimit) || 100;
  const snap = await firestore.collection("position_read_model_latest")
    .where("exchange", "==", exchange)
    .limit(limit)
    .get();
  const rows = snap.docs.map((doc) => ({ ...(doc.data() || {}) }));
  return Object.freeze({
    ok: true,
    rows: Object.freeze(rows),
    query_limit_reached: countQueryLimitHits({ rows, limit }),
    query_limit: limit,
    exchange,
  });
}

async function loadExitRuntimeCanaryStateRows({ db = null, env = process.env, config = resolveExitRuntimeCanaryConfig(env) } = {}) {
  const storageEnv = resolveExitRuntimeCanaryStorageEnv(env);
  const readModelLoad = config.useReadModelLatest === true
    ? await queryLatestReadModels({ db, config }).catch((error) => Object.freeze({
      ok: false,
      rows: Object.freeze([]),
      query_limit_reached: false,
      query_limit: config.readModelLatestLimit,
      error: error && error.message ? error.message : String(error),
    }))
    : Object.freeze({ ok: false, rows: Object.freeze([]), query_limit_reached: false, query_limit: 0, skipped: true });
  const readModelViews = readModelLoad.ok === true
    ? asArray(readModelLoad.rows).map(resolveLatestReadModelSnapshot)
    : [];
  const activeReadModelViews = readModelViews.filter(isReadModelActiveProtectedCandidate);
  const shouldUseReadModel = config.useReadModelLatest === true
    && (readModelLoad.ok === true || config.readModelStrictLatestOnly === true)
    && (readModelViews.length > 0 || config.readModelStrictLatestOnly === true);
  const activeCycles = shouldUseReadModel
    ? activeReadModelViews
    : await queryRows({
      db,
      env: storageEnv,
      collectionKey: "POSITION_CYCLES",
      field: "status",
      value: "ACTIVE_PROTECTED",
      limit: config.activePositionLimit,
    });
  const rows = [];
  for (const positionCycle of activeCycles) {
    const positionCycleId = shouldUseReadModel
      ? resolveReadModelPositionCycleId(positionCycle)
      : trimOrNull(positionCycle && positionCycle.position_cycle_id);
    if (!positionCycleId) {
      rows.push(Object.freeze({
        positionCycle,
        projection: null,
        protectionRuntime: null,
        transitions: Object.freeze([]),
        outboxes: Object.freeze([]),
        load_issue_codes: Object.freeze(["POSITION_CYCLE_ID_MISSING"]),
      }));
      continue;
    }
    const [canonicalPositionCycle, projection, protectionRuntime, transitions, outboxes] = await Promise.all([
      shouldUseReadModel
        ? getOptionalDoc({ db, env: storageEnv, collectionKey: "POSITION_CYCLES", docId: positionCycleId })
        : Promise.resolve(positionCycle),
      getOptionalDoc({ db, env: storageEnv, collectionKey: "EXIT_RUNTIME_PROJECTIONS", docId: buildExitRuntimeProjectionId({ positionCycleId }) }),
      getOptionalDoc({ db, env: storageEnv, collectionKey: "PROTECTION_RUNTIME", docId: buildProtectionRuntimeId({ positionCycleId }) }),
      queryRows({ db, env: storageEnv, collectionKey: "CANONICAL_EXIT_TRANSITIONS", field: "position_cycle_id", value: positionCycleId, limit: config.transitionLimit }),
      queryRows({ db, env: storageEnv, collectionKey: "TRADE_ALERT_OUTBOX", field: "position_cycle_id", value: positionCycleId, limit: config.outboxLimit }),
    ]);
    const loadIssues = [];
    if (!canonicalPositionCycle) loadIssues.push("POSITION_CYCLE_MISSING");
    if (!projection) loadIssues.push("PROJECTION_MISSING");
    if (!protectionRuntime) loadIssues.push("PROTECTION_RUNTIME_MISSING");
    if (countQueryLimitHits({ rows: transitions, limit: config.transitionLimit })) loadIssues.push("TRANSITION_QUERY_LIMIT_REACHED");
    if (countQueryLimitHits({ rows: outboxes, limit: config.outboxLimit })) loadIssues.push("OUTBOX_QUERY_LIMIT_REACHED");
    rows.push(Object.freeze({
      positionCycle: canonicalPositionCycle || positionCycle,
      readModelPosition: shouldUseReadModel ? positionCycle : null,
      projection,
      protectionRuntime,
      transitions: Object.freeze(transitions),
      outboxes: Object.freeze(outboxes),
      load_issue_codes: Object.freeze(loadIssues),
    }));
  }
  return Object.freeze({
    ok: true,
    rows: Object.freeze(rows),
    active_query_limit_reached: shouldUseReadModel
      ? false
      : countQueryLimitHits({ rows: activeCycles, limit: config.activePositionLimit }),
    read_model_latest_used: shouldUseReadModel,
    read_model_latest_query_ok: readModelLoad.ok === true,
    read_model_latest_query_limit_reached: readModelLoad.query_limit_reached === true,
    read_model_latest_row_n: readModelViews.length,
    read_model_latest_active_candidate_n: activeReadModelViews.length,
    query_budget: Object.freeze({
      active_position_limit: config.activePositionLimit,
      read_model_latest_limit: config.readModelLatestLimit,
      read_model_latest_used: shouldUseReadModel,
      read_model_latest_query_limit_reached: readModelLoad.query_limit_reached === true,
      read_model_latest_row_n: readModelViews.length,
      read_model_latest_active_candidate_n: activeReadModelViews.length,
      collection_prefix: storageEnv.DONBEOLJA_V2_COLLECTION_PREFIX,
      transition_limit_per_position: config.transitionLimit,
      outbox_limit_per_position: config.outboxLimit,
      max_unprotected_window_ms: config.maxUnprotectedWindowMs,
    }),
  });
}

function resolveAlertOutboxForTransition({ transition, outboxes }) {
  const transitionId = trimOrNull(transition && transition.canonical_transition_id);
  if (!transitionId) {
    return Object.freeze({
      ok: false,
      outbox: null,
      status: null,
      reason: "CANONICAL_TRANSITION_ID_MISSING",
    });
  }
  const outbox = asArray(outboxes).find((row) => trimOrNull(row && row.canonical_transition_id) === transitionId) || null;
  if (!outbox) {
    return Object.freeze({
      ok: false,
      outbox: null,
      status: null,
      reason: "ALERT_OUTBOX_MISSING",
    });
  }
  const preparedPayload = outbox.prepared_payload && typeof outbox.prepared_payload === "object" ? outbox.prepared_payload : null;
  const deliveryRequest = outbox.delivery_request && typeof outbox.delivery_request === "object" ? outbox.delivery_request : null;
  const alertOutboxId = trimOrNull(outbox.alert_outbox_id);
  const payloadTransitionId = trimOrNull(preparedPayload && preparedPayload.canonical_transition_id);
  const dedupeFingerprint = trimOrNull(deliveryRequest && deliveryRequest.dedupeFingerprint);
  const dedupeKey = trimOrNull(deliveryRequest && deliveryRequest.dedupeKey);
  const ok = !!alertOutboxId
    && payloadTransitionId === transitionId
    && dedupeFingerprint === transitionId
    && dedupeKey === alertOutboxId;
  return Object.freeze({
    ok,
    outbox,
    status: upper(outbox.status),
    reason: ok ? "ALERT_OUTBOX_LINEAGE_OK" : "ALERT_OUTBOX_LINEAGE_MISMATCH",
    alert_outbox_id: alertOutboxId,
    payload_transition_id: payloadTransitionId,
    dedupe_fingerprint: dedupeFingerprint,
    dedupe_key: dedupeKey,
  });
}

function hasSentOutboxForTransition({ transition, outboxes }) {
  const resolved = resolveAlertOutboxForTransition({ transition, outboxes });
  return resolved.ok === true && resolved.status === "SENT";
}

function resolveTransitionAlertDeliveryState({ resolvedOutbox, generatedAtMs, config }) {
  const row = resolvedOutbox && resolvedOutbox.outbox && typeof resolvedOutbox.outbox === "object"
    ? resolvedOutbox.outbox
    : {};
  const status = upper(resolvedOutbox && resolvedOutbox.status);
  const sentAtMs = toMs(row.sent_at);
  if (resolvedOutbox && resolvedOutbox.ok === true && status === "SENT") {
    return Object.freeze({
      ok: true,
      status,
      reason: "ALERT_OUTBOX_SENT",
      sent_at: trimOrNull(row.sent_at),
      last_attempt_at: trimOrNull(row.last_attempt_at),
      retry_grace_ms: Number(config && config.alertRetryGraceMs) || 0,
      age_ms: sentAtMs != null && Number.isFinite(Number(generatedAtMs)) ? Math.max(0, Number(generatedAtMs) - sentAtMs) : null,
    });
  }
  const lastAttemptMs = toMs(row.last_attempt_at) || toMs(row.created_at) || toMs(row.updated_at);
  const graceMs = Number(config && config.alertRetryGraceMs);
  const ageMs = Number.isFinite(Number(generatedAtMs)) && lastAttemptMs != null
    ? Math.max(0, Number(generatedAtMs) - Number(lastAttemptMs))
    : null;
  const retryRecoverable = resolvedOutbox && resolvedOutbox.ok === true
    && ["FAILED", "PENDING", "RETRYING", "QUEUED"].includes(status)
    && Number.isFinite(graceMs)
    && graceMs > 0
    && ageMs != null
    && ageMs <= graceMs;
  return Object.freeze({
    ok: retryRecoverable,
    status,
    reason: retryRecoverable ? "ALERT_OUTBOX_RETRY_WITHIN_GRACE" : "ALERT_OUTBOX_RETRY_UNRESOLVED",
    sent_at: trimOrNull(row.sent_at),
    last_attempt_at: trimOrNull(row.last_attempt_at),
    retry_grace_ms: Number.isFinite(graceMs) ? graceMs : 0,
    age_ms: ageMs,
  });
}

function buildAlertOutboxIntegrityChecks({ positionCycleId, transitions, outboxes }) {
  const transitionIds = new Set(
    asArray(transitions)
      .map((row) => trimOrNull(row && row.canonical_transition_id))
      .filter(Boolean)
  );
  const byTransitionId = new Map();
  const checks = [];
  for (const outbox of asArray(outboxes)) {
    const alertOutboxId = trimOrNull(outbox && outbox.alert_outbox_id);
    const transitionId = trimOrNull(outbox && outbox.canonical_transition_id);
    if (transitionId) {
      byTransitionId.set(transitionId, (byTransitionId.get(transitionId) || 0) + 1);
    }
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_POSITION_CYCLE_MATCH",
      ok: trimOrNull(outbox && outbox.position_cycle_id) === positionCycleId,
      position_cycle_id: positionCycleId,
      alert_outbox_id: alertOutboxId,
      outbox_position_cycle_id: trimOrNull(outbox && outbox.position_cycle_id),
    }));
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_HAS_TRANSITION",
      ok: !!transitionId && transitionIds.has(transitionId),
      position_cycle_id: positionCycleId,
      alert_outbox_id: alertOutboxId,
      canonical_transition_id: transitionId,
    }));
  }
  for (const [transitionId, count] of byTransitionId.entries()) {
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_SINGLETON_PER_TRANSITION",
      ok: count === 1,
      position_cycle_id: positionCycleId,
      canonical_transition_id: transitionId,
      outbox_n: count,
    }));
  }
  return Object.freeze(checks);
}

function findTransition(transitions, transitionEvent) {
  const expected = upper(transitionEvent);
  return asArray(transitions).find((row) => upper(row && row.transition_event) === expected) || null;
}

function buildPositionCanaryChecks({ row, config, generatedAt }) {
  const checks = [];
  const positionCycle = row && row.positionCycle && typeof row.positionCycle === "object" ? row.positionCycle : null;
  const projection = row && row.projection && typeof row.projection === "object" ? row.projection : null;
  const runtime = row && row.protectionRuntime && typeof row.protectionRuntime === "object" ? row.protectionRuntime : null;
  const transitions = asArray(row && row.transitions);
  const outboxes = asArray(row && row.outboxes);
  const positionCycleId = resolveReadModelPositionCycleId(positionCycle);
  const canonicalPositionCycle = positionCycle && positionCycleId
    ? Object.freeze({ ...positionCycle, position_cycle_id: positionCycleId })
    : positionCycle;
  const stage = upper(projection && projection.stage);
  const loadIssues = asArray(row && row.load_issue_codes).map(upper).filter(Boolean);
  const generatedAtMs = toMs(generatedAt) || Date.now();

  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_POSITION_CYCLE_ID_PRESENT",
    ok: !!positionCycleId,
    position_cycle_id: positionCycleId,
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_PROJECTION_PRESENT",
    ok: !!projection,
    position_cycle_id: positionCycleId,
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_PRESENT",
    ok: !!runtime,
    position_cycle_id: positionCycleId,
  }));
  for (const issue of loadIssues) {
    checks.push(Object.freeze({
      id: `EXIT_RUNTIME_CANARY_${issue}`,
      ok: false,
      position_cycle_id: positionCycleId,
    }));
  }
  if (!positionCycle || !projection || !runtime || !positionCycleId || !stage) return Object.freeze(checks);

  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: canonicalPositionCycle,
    projection,
    protectionRuntime: runtime,
    exchangeState: { has_active_position: !TERMINAL_STAGES.has(stage) },
    latestTransition: null,
    createdAt: trimOrNull(projection.updated_at) || new Date().toISOString(),
  });
  const issueCodes = new Set(asArray(watchdog && watchdog.issueCodes).map(upper).filter(Boolean));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_NATIVE_REFRESH_HEALTHY",
    ok: !issueCodes.has("NATIVE_REFRESH_UNHEALTHY"),
    position_cycle_id: positionCycleId,
    native_refresh_status: upper(runtime.native_refresh_status),
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_SL_ORDER_PRESENT",
    ok: hasPlacedOrder(runtime, "sl_order_id", "sl_order_status"),
    position_cycle_id: positionCycleId,
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_TP1_ORDER_PRESENT_WHILE_PRE_TP1",
    ok: stage !== "PRE_TP1" || hasPlacedOrder(runtime, "tp1_order_id", "tp1_order_status"),
    position_cycle_id: positionCycleId,
    stage,
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_TRAIL_STOP_PRESENT_WHILE_TRAIL_ACTIVE",
    ok: stage !== "TRAIL_ACTIVE" || Number(runtime.native_stop_price) > 0,
    position_cycle_id: positionCycleId,
    stage,
  }));
  const trailTransition = findTransition(transitions, "TRAIL_ACTIVATED");
  if (stage === "TRAIL_ACTIVE") {
    const transitionEvidence = trailTransition && trailTransition.source_exchange_evidence && typeof trailTransition.source_exchange_evidence === "object"
      ? trailTransition.source_exchange_evidence
      : null;
    const runtimeEvidence = runtime.last_exchange_evidence && typeof runtime.last_exchange_evidence === "object"
      ? runtime.last_exchange_evidence
      : null;
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_PRESENT",
      ok: !!trailTransition && upper(transitionEvidence && transitionEvidence.evidence_kind) === "TRAIL_ACTIVATION",
      position_cycle_id: positionCycleId,
      transition_event: "TRAIL_ACTIVATED",
      canonical_transition_id: trimOrNull(trailTransition && trailTransition.canonical_transition_id),
      evidence_kind: upper(transitionEvidence && transitionEvidence.evidence_kind),
    }));
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_TRAIL_PROTECTION_EVIDENCE_PRESENT",
      ok: upper(runtimeEvidence && runtimeEvidence.evidence_kind) === "TRAIL_ACTIVATION"
        && upper(runtime.native_refresh_status) === "OK",
      position_cycle_id: positionCycleId,
      evidence_kind: upper(runtimeEvidence && runtimeEvidence.evidence_kind),
      native_refresh_status: upper(runtime.native_refresh_status),
    }));
    checks.push(Object.freeze({
      id: "EXIT_RUNTIME_CANARY_TRAIL_NATIVE_STOP_MATCHES_PROJECTION",
      ok: numbersMatch(runtime.native_stop_price, projection.native_stop_price),
      position_cycle_id: positionCycleId,
      runtime_native_stop_price: toNumber(runtime.native_stop_price),
      projection_native_stop_price: toNumber(projection.native_stop_price),
    }));
  }
  const lastGapMs = Number(runtime.last_gap_ms);
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_WITHIN_LIMIT",
    ok: !Number.isFinite(lastGapMs) || lastGapMs <= config.maxUnprotectedWindowMs,
    position_cycle_id: positionCycleId,
    last_gap_ms: Number.isFinite(lastGapMs) ? lastGapMs : null,
    max_unprotected_window_ms: config.maxUnprotectedWindowMs,
  }));
  checks.push(Object.freeze({
    id: "EXIT_RUNTIME_CANARY_NO_UNPROTECTED_ACTIVE_POSITION",
    ok: !issueCodes.has("UNPROTECTED_ACTIVE_POSITION"),
    position_cycle_id: positionCycleId,
    issue_codes: Object.freeze(Array.from(issueCodes)),
  }));
  checks.push(...buildAlertOutboxIntegrityChecks({ positionCycleId, transitions, outboxes }));

  const requiredTransitions = TRANSITION_ALERT_REQUIREMENTS[stage] || [];
  for (const transitionEvent of requiredTransitions) {
    const transition = findTransition(transitions, transitionEvent);
    const resolvedOutbox = resolveAlertOutboxForTransition({ transition, outboxes });
    checks.push(Object.freeze({
      id: `EXIT_RUNTIME_CANARY_${transitionEvent}_TRANSITION_ALERT_OUTBOX_LINEAGE`,
      ok: !!transition && resolvedOutbox.ok === true,
      position_cycle_id: positionCycleId,
      transition_event: transitionEvent,
      canonical_transition_id: trimOrNull(transition && transition.canonical_transition_id),
      alert_outbox_id: resolvedOutbox.alert_outbox_id || null,
      outbox_status: resolvedOutbox.status || null,
      reason: resolvedOutbox.reason,
      payload_transition_id: resolvedOutbox.payload_transition_id || null,
      dedupe_fingerprint: resolvedOutbox.dedupe_fingerprint || null,
      dedupe_key: resolvedOutbox.dedupe_key || null,
    }));
    checks.push(Object.freeze({
      id: `EXIT_RUNTIME_CANARY_${transitionEvent}_TRANSITION_ALERT_SENT`,
      ok: resolvedOutbox.ok !== true || resolveTransitionAlertDeliveryState({ resolvedOutbox, generatedAtMs, config }).ok === true,
      skipped: resolvedOutbox.ok !== true,
      position_cycle_id: positionCycleId,
      transition_event: transitionEvent,
      canonical_transition_id: trimOrNull(transition && transition.canonical_transition_id),
      alert_outbox_id: resolvedOutbox.alert_outbox_id || null,
      outbox_status: resolvedOutbox.status || null,
      delivery_state: resolveTransitionAlertDeliveryState({ resolvedOutbox, generatedAtMs, config }),
    }));
  }
  return Object.freeze(checks);
}

function summarizeFailures({ rows, checks, activeQueryLimitReached, readModelLatestQueryLimitReached }) {
  const failed = checks.filter((check) => check.ok !== true);
  const failedIds = failed.map((check) => check.id);
  const idSet = new Set(failedIds);
  const tp1Missing = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_TP1_ORDER_PRESENT_WHILE_PRE_TP1").length;
  const nativeUnhealthy = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_NATIVE_REFRESH_HEALTHY").length;
  const unprotectedWindow = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_WITHIN_LIMIT" || check.id === "EXIT_RUNTIME_CANARY_NO_UNPROTECTED_ACTIVE_POSITION").length;
  const alertSilentDrop = failed.filter((check) => check.id.endsWith("_TRANSITION_ALERT_OUTBOX_LINEAGE")).length;
  const alertRetryUnresolved = failed.filter((check) => check.id.endsWith("_TRANSITION_ALERT_SENT")).length;
  const alertOutboxIntegrityGap = failed.filter((check) => [
    "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_POSITION_CYCLE_MATCH",
    "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_HAS_TRANSITION",
    "EXIT_RUNTIME_CANARY_ALERT_OUTBOX_SINGLETON_PER_TRANSITION",
  ].includes(check.id)).length;
  const trailActivationEvidenceGap = failed.filter((check) => [
    "EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_PRESENT",
    "EXIT_RUNTIME_CANARY_TRAIL_PROTECTION_EVIDENCE_PRESENT",
    "EXIT_RUNTIME_CANARY_TRAIL_NATIVE_STOP_MATCHES_PROJECTION",
  ].includes(check.id)).length;
  const blockers = [];
  if (activeQueryLimitReached) blockers.push("EXIT_RUNTIME_CANARY_ACTIVE_QUERY_LIMIT_REACHED");
  if (readModelLatestQueryLimitReached) blockers.push("EXIT_RUNTIME_CANARY_READ_MODEL_LATEST_QUERY_LIMIT_REACHED");
  if (idSet.has("EXIT_RUNTIME_CANARY_PROJECTION_MISSING")) blockers.push("EXIT_RUNTIME_CANARY_PROJECTION_MISSING");
  if (idSet.has("EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_MISSING")) blockers.push("EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_MISSING");
  if (tp1Missing > 0) blockers.push("EXIT_RUNTIME_CANARY_TP1_ORDER_MISSING");
  if (nativeUnhealthy > 0) blockers.push("EXIT_RUNTIME_CANARY_NATIVE_REFRESH_UNHEALTHY");
  if (unprotectedWindow > 0) blockers.push("EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_VIOLATION");
  if (alertSilentDrop > 0) blockers.push("EXIT_RUNTIME_CANARY_ALERT_SILENT_DROP");
  if (alertRetryUnresolved > 0) blockers.push("EXIT_RUNTIME_CANARY_ALERT_RETRY_UNRESOLVED");
  if (alertOutboxIntegrityGap > 0) blockers.push("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_INTEGRITY_GAP");
  if (trailActivationEvidenceGap > 0) blockers.push("EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_GAP");
  for (const id of failedIds) {
    if (id.includes("QUERY_LIMIT_REACHED") && !blockers.includes(id)) blockers.push(id);
  }
  return Object.freeze({
    active_position_n: asArray(rows).length,
    tp1_missing_n: tp1Missing,
    native_refresh_unhealthy_n: nativeUnhealthy,
    unprotected_window_violation_n: unprotectedWindow,
    alert_silent_drop_n: alertSilentDrop,
    alert_retry_unresolved_n: alertRetryUnresolved,
    alert_outbox_integrity_gap_n: alertOutboxIntegrityGap,
    trail_activation_evidence_gap_n: trailActivationEvidenceGap,
    blockers: Object.freeze(blockers),
  });
}

function evaluateExitRuntimeCanaryState({
  rows,
  activeQueryLimitReached = false,
  readModelLatestQueryLimitReached = false,
  queryBudget = null,
  config = resolveExitRuntimeCanaryConfig({}),
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedRows = asArray(rows);
  const checks = normalizedRows.flatMap((row) => buildPositionCanaryChecks({ row, config, generatedAt }));
  if (activeQueryLimitReached) {
    checks.push(Object.freeze({ id: "EXIT_RUNTIME_CANARY_ACTIVE_QUERY_LIMIT_REACHED", ok: false }));
  }
  if (readModelLatestQueryLimitReached) {
    checks.push(Object.freeze({ id: "EXIT_RUNTIME_CANARY_READ_MODEL_LATEST_QUERY_LIMIT_REACHED", ok: false }));
  }
  const failedChecks = checks.filter((check) => check.ok !== true);
  const summary = summarizeFailures({
    rows: normalizedRows,
    checks,
    activeQueryLimitReached,
    readModelLatestQueryLimitReached,
  });
  return Object.freeze({
    ok: failedChecks.length === 0,
    reason: failedChecks.length === 0 ? "V2_EXIT_RUNTIME_CANARY_PASS" : "V2_EXIT_RUNTIME_CANARY_BLOCKED",
    scope: "exit_runtime_canary",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
    exchange_write_performed: false,
    generated_at: generatedAt,
    active_position_n: summary.active_position_n,
    tp1_missing_n: summary.tp1_missing_n,
    native_refresh_unhealthy_n: summary.native_refresh_unhealthy_n,
    unprotected_window_violation_n: summary.unprotected_window_violation_n,
    alert_silent_drop_n: summary.alert_silent_drop_n,
    alert_retry_unresolved_n: summary.alert_retry_unresolved_n,
    alert_outbox_integrity_gap_n: summary.alert_outbox_integrity_gap_n,
    trail_activation_evidence_gap_n: summary.trail_activation_evidence_gap_n,
    check_n: checks.length,
    fail_n: failedChecks.length,
    check_ids: Object.freeze(checks.map((check) => check.id)),
    passed_check_ids: Object.freeze(checks.filter((check) => check.ok === true).map((check) => check.id)),
    failed_check_ids: Object.freeze(failedChecks.map((check) => check.id)),
    blockers: summary.blockers,
    query_budget: queryBudget || Object.freeze({
      active_position_limit: config.activePositionLimit,
      transition_limit_per_position: config.transitionLimit,
      outbox_limit_per_position: config.outboxLimit,
      read_model_latest_limit: config.readModelLatestLimit,
      read_model_latest_used: config.useReadModelLatest,
      max_unprotected_window_ms: config.maxUnprotectedWindowMs,
      alert_retry_grace_ms: config.alertRetryGraceMs,
    }),
    position_summaries: Object.freeze(normalizedRows.map((row) => {
      const positionCycle = row && row.positionCycle ? row.positionCycle : {};
      const projection = row && row.projection ? row.projection : {};
      const runtime = row && row.protectionRuntime ? row.protectionRuntime : {};
      const positionCycleId = resolveReadModelPositionCycleId(positionCycle);
      return Object.freeze({
        position_cycle_id: positionCycleId,
        symbol: upper(positionCycle.symbol),
        status: upper(positionCycle.status),
        stage: upper(projection.stage),
        health_status: upper(runtime.health_status || projection.health_status),
        native_refresh_status: upper(runtime.native_refresh_status),
        sl_order_present: hasPlacedOrder(runtime, "sl_order_id", "sl_order_status"),
        tp1_order_present: hasPlacedOrder(runtime, "tp1_order_id", "tp1_order_status"),
        native_stop_price: Number(runtime.native_stop_price) || null,
        alert_outbox_integrity_gap_n: buildAlertOutboxIntegrityChecks({
          positionCycleId,
          transitions: asArray(row && row.transitions),
          outboxes: asArray(row && row.outboxes),
        }).filter((check) => check.ok !== true).length,
        trail_activation_evidence_present: upper(projection.stage) === "TRAIL_ACTIVE"
          ? !!findTransition(asArray(row && row.transitions), "TRAIL_ACTIVATED")
          : null,
      });
    })),
    checks: Object.freeze(checks),
  });
}

async function runExitRuntimeCanary({ db = null, env = process.env, now = () => new Date().toISOString(), stateRows = null } = {}) {
  const config = resolveExitRuntimeCanaryConfig(env);
  const generatedAt = trimOrNull(now()) || new Date().toISOString();
  if (Array.isArray(stateRows)) {
    return evaluateExitRuntimeCanaryState({ rows: stateRows, config, generatedAt });
  }
  const loaded = await loadExitRuntimeCanaryStateRows({ db, env, config });
  return evaluateExitRuntimeCanaryState({
    rows: loaded.rows,
    activeQueryLimitReached: loaded.active_query_limit_reached,
    readModelLatestQueryLimitReached: loaded.read_model_latest_query_limit_reached,
    queryBudget: loaded.query_budget,
    config,
    generatedAt,
  });
}

module.exports = {
  resolveExitRuntimeCanaryConfig,
  loadExitRuntimeCanaryStateRows,
  evaluateExitRuntimeCanaryState,
  runExitRuntimeCanary,
  __test: {
    trimOrNull,
    upper,
    toNumber,
    numbersMatch,
    parsePositiveInt,
    parseNonNegativeNumber,
    parseBool,
    hasPlacedOrder,
    resolveExitRuntimeCanaryStorageEnv,
    resolveLatestReadModelSnapshot,
    resolveReadModelPositionCycleId,
    isReadModelActiveProtectedCandidate,
    buildPositionCanaryChecks,
    buildAlertOutboxIntegrityChecks,
    resolveAlertOutboxForTransition,
    hasSentOutboxForTransition,
    findTransition,
    summarizeFailures,
  },
};
