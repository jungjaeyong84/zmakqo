"use strict";

const { getV2Doc, queryV2DocsByField } = require("./storage");
const { buildExitRuntimeProjectionId, buildProtectionRuntimeId } = require("./contracts");
const { evaluateActiveExitWatchdog } = require("./watchdog");

const DEFAULT_ACTIVE_POSITION_LIMIT = 25;
const DEFAULT_LINKED_DOC_LIMIT = 20;
const DEFAULT_MAX_UNPROTECTED_WINDOW_MS = 0;
const TERMINAL_STAGES = new Set(["EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);
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

async function loadExitRuntimeCanaryStateRows({ db = null, env = process.env, config = resolveExitRuntimeCanaryConfig(env) } = {}) {
  const activeCycles = await queryRows({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    field: "status",
    value: "ACTIVE_PROTECTED",
    limit: config.activePositionLimit,
  });
  const rows = [];
  for (const positionCycle of activeCycles) {
    const positionCycleId = trimOrNull(positionCycle && positionCycle.position_cycle_id);
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
    const [projection, protectionRuntime, transitions, outboxes] = await Promise.all([
      getOptionalDoc({ db, env, collectionKey: "EXIT_RUNTIME_PROJECTIONS", docId: buildExitRuntimeProjectionId({ positionCycleId }) }),
      getOptionalDoc({ db, env, collectionKey: "PROTECTION_RUNTIME", docId: buildProtectionRuntimeId({ positionCycleId }) }),
      queryRows({ db, env, collectionKey: "CANONICAL_EXIT_TRANSITIONS", field: "position_cycle_id", value: positionCycleId, limit: config.transitionLimit }),
      queryRows({ db, env, collectionKey: "TRADE_ALERT_OUTBOX", field: "position_cycle_id", value: positionCycleId, limit: config.outboxLimit }),
    ]);
    const loadIssues = [];
    if (!projection) loadIssues.push("PROJECTION_MISSING");
    if (!protectionRuntime) loadIssues.push("PROTECTION_RUNTIME_MISSING");
    if (countQueryLimitHits({ rows: transitions, limit: config.transitionLimit })) loadIssues.push("TRANSITION_QUERY_LIMIT_REACHED");
    if (countQueryLimitHits({ rows: outboxes, limit: config.outboxLimit })) loadIssues.push("OUTBOX_QUERY_LIMIT_REACHED");
    rows.push(Object.freeze({
      positionCycle,
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
    active_query_limit_reached: countQueryLimitHits({ rows: activeCycles, limit: config.activePositionLimit }),
    query_budget: Object.freeze({
      active_position_limit: config.activePositionLimit,
      transition_limit_per_position: config.transitionLimit,
      outbox_limit_per_position: config.outboxLimit,
      max_unprotected_window_ms: config.maxUnprotectedWindowMs,
    }),
  });
}

function hasSentOutboxForTransition({ transition, outboxes }) {
  const transitionId = trimOrNull(transition && transition.canonical_transition_id);
  if (!transitionId) return false;
  return asArray(outboxes).some((row) => {
    return trimOrNull(row && row.canonical_transition_id) === transitionId && upper(row && row.status) === "SENT";
  });
}

function findTransition(transitions, transitionEvent) {
  const expected = upper(transitionEvent);
  return asArray(transitions).find((row) => upper(row && row.transition_event) === expected) || null;
}

function buildPositionCanaryChecks({ row, config }) {
  const checks = [];
  const positionCycle = row && row.positionCycle && typeof row.positionCycle === "object" ? row.positionCycle : null;
  const projection = row && row.projection && typeof row.projection === "object" ? row.projection : null;
  const runtime = row && row.protectionRuntime && typeof row.protectionRuntime === "object" ? row.protectionRuntime : null;
  const transitions = asArray(row && row.transitions);
  const outboxes = asArray(row && row.outboxes);
  const positionCycleId = trimOrNull(positionCycle && positionCycle.position_cycle_id);
  const stage = upper(projection && projection.stage);
  const loadIssues = asArray(row && row.load_issue_codes).map(upper).filter(Boolean);

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
    positionCycle,
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

  const requiredTransitions = TRANSITION_ALERT_REQUIREMENTS[stage] || [];
  for (const transitionEvent of requiredTransitions) {
    const transition = findTransition(transitions, transitionEvent);
    checks.push(Object.freeze({
      id: `EXIT_RUNTIME_CANARY_${transitionEvent}_TRANSITION_ALERT_SENT`,
      ok: !!transition && hasSentOutboxForTransition({ transition, outboxes }),
      position_cycle_id: positionCycleId,
      transition_event: transitionEvent,
      canonical_transition_id: trimOrNull(transition && transition.canonical_transition_id),
    }));
  }
  return Object.freeze(checks);
}

function summarizeFailures({ rows, checks, activeQueryLimitReached }) {
  const failed = checks.filter((check) => check.ok !== true);
  const failedIds = failed.map((check) => check.id);
  const idSet = new Set(failedIds);
  const tp1Missing = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_TP1_ORDER_PRESENT_WHILE_PRE_TP1").length;
  const nativeUnhealthy = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_NATIVE_REFRESH_HEALTHY").length;
  const unprotectedWindow = failed.filter((check) => check.id === "EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_WITHIN_LIMIT" || check.id === "EXIT_RUNTIME_CANARY_NO_UNPROTECTED_ACTIVE_POSITION").length;
  const alertSilentDrop = failed.filter((check) => check.id.endsWith("_TRANSITION_ALERT_SENT")).length;
  const blockers = [];
  if (activeQueryLimitReached) blockers.push("EXIT_RUNTIME_CANARY_ACTIVE_QUERY_LIMIT_REACHED");
  if (idSet.has("EXIT_RUNTIME_CANARY_PROJECTION_MISSING")) blockers.push("EXIT_RUNTIME_CANARY_PROJECTION_MISSING");
  if (idSet.has("EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_MISSING")) blockers.push("EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_MISSING");
  if (tp1Missing > 0) blockers.push("EXIT_RUNTIME_CANARY_TP1_ORDER_MISSING");
  if (nativeUnhealthy > 0) blockers.push("EXIT_RUNTIME_CANARY_NATIVE_REFRESH_UNHEALTHY");
  if (unprotectedWindow > 0) blockers.push("EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_VIOLATION");
  if (alertSilentDrop > 0) blockers.push("EXIT_RUNTIME_CANARY_ALERT_SILENT_DROP");
  for (const id of failedIds) {
    if (id.includes("QUERY_LIMIT_REACHED") && !blockers.includes(id)) blockers.push(id);
  }
  return Object.freeze({
    active_position_n: asArray(rows).length,
    tp1_missing_n: tp1Missing,
    native_refresh_unhealthy_n: nativeUnhealthy,
    unprotected_window_violation_n: unprotectedWindow,
    alert_silent_drop_n: alertSilentDrop,
    blockers: Object.freeze(blockers),
  });
}

function evaluateExitRuntimeCanaryState({ rows, activeQueryLimitReached = false, queryBudget = null, config = resolveExitRuntimeCanaryConfig({}), generatedAt = new Date().toISOString() } = {}) {
  const normalizedRows = asArray(rows);
  const checks = normalizedRows.flatMap((row) => buildPositionCanaryChecks({ row, config }));
  if (activeQueryLimitReached) {
    checks.push(Object.freeze({ id: "EXIT_RUNTIME_CANARY_ACTIVE_QUERY_LIMIT_REACHED", ok: false }));
  }
  const failedChecks = checks.filter((check) => check.ok !== true);
  const summary = summarizeFailures({ rows: normalizedRows, checks, activeQueryLimitReached });
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
      max_unprotected_window_ms: config.maxUnprotectedWindowMs,
    }),
    position_summaries: Object.freeze(normalizedRows.map((row) => {
      const positionCycle = row && row.positionCycle ? row.positionCycle : {};
      const projection = row && row.projection ? row.projection : {};
      const runtime = row && row.protectionRuntime ? row.protectionRuntime : {};
      return Object.freeze({
        position_cycle_id: trimOrNull(positionCycle.position_cycle_id),
        symbol: upper(positionCycle.symbol),
        status: upper(positionCycle.status),
        stage: upper(projection.stage),
        health_status: upper(runtime.health_status || projection.health_status),
        native_refresh_status: upper(runtime.native_refresh_status),
        sl_order_present: hasPlacedOrder(runtime, "sl_order_id", "sl_order_status"),
        tp1_order_present: hasPlacedOrder(runtime, "tp1_order_id", "tp1_order_status"),
        native_stop_price: Number(runtime.native_stop_price) || null,
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
    parsePositiveInt,
    parseNonNegativeNumber,
    hasPlacedOrder,
    buildPositionCanaryChecks,
    hasSentOutboxForTransition,
    findTransition,
    summarizeFailures,
  },
};
