"use strict";

const { getV2Doc, listV2Docs, putV2Doc, queryV2DocsByField } = require("./storage");
const { getFirestore } = require("../storage/firestore");
const { buildRepairQueueBatch } = require("./repairQueueService");
const {
  buildDelegatedRepairExecutionLedgerDoc,
  buildSkippedRepairExecutionLedgerDoc,
} = require("./repairExecutionLedger");

const ACTIVE_READ_MODEL_STATES = Object.freeze([
  "ACTIVE",
  "ACTIVE_PROTECTED",
  "COMMIT",
  "PROBE",
  "SCALE_OUT",
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function boolEnv(env, name, fallback = false) {
  const raw = String(env && env[name] == null ? "" : env[name]).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function resolveRepairQueueBatchLimit(env = process.env, fallback = 10) {
  const raw = Number(env && env.DONBEOLJA_V2_REPAIR_QUEUE_BATCH_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return Math.max(1, Number(fallback) || 1);
}

function resolveRepairQueueScanLimit(env = process.env, batchLimit = 10) {
  const raw = Number(env && env.DONBEOLJA_V2_REPAIR_QUEUE_SCAN_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.max(1, Math.floor(raw));
  return Math.max(1, Math.floor(Number(batchLimit) || 1) * 5);
}

function isPendingRepairRequest(row = {}) {
  const status = String(row && row.status || "").trim().toUpperCase();
  return status === "PENDING";
}

function resolveRequireLatestActiveReadModel(env = process.env) {
  return boolEnv(env, "DONBEOLJA_V2_REPAIR_QUEUE_REQUIRE_LATEST_ACTIVE_READ_MODEL",
    boolEnv(env, "POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY", false));
}

function sortRepairRequestsByCreatedAt(repairRequests = []) {
  return Object.freeze((Array.isArray(repairRequests) ? repairRequests : []).slice().sort((left, right) => {
    const leftMs = Date.parse(String(left && left.created_at || "").trim());
    const rightMs = Date.parse(String(right && right.created_at || "").trim());
    if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) return leftMs - rightMs;
    return String(left && left.exit_repair_request_id || "").localeCompare(String(right && right.exit_repair_request_id || ""));
  }));
}

function dedupePositionCycleIds(repairRequests = []) {
  return Array.from(new Set(
    (Array.isArray(repairRequests) ? repairRequests : [])
      .map((row) => trimOrNull(row && row.position_cycle_id))
      .filter(Boolean)
  ));
}

function indexRowsByPositionCycle(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const cycleId = trimOrNull(row && row.position_cycle_id);
    if (!cycleId) continue;
    map.set(cycleId, row);
  }
  return map;
}

function dedupeSymbolsFromPositionCycles(positionCycles = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(positionCycles) ? positionCycles : []) {
    const symbol = upper(row && row.symbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function dedupeSymbolsFromRepairRequests(repairRequests = []) {
  const out = [];
  const seen = new Set();
  for (const row of Array.isArray(repairRequests) ? repairRequests : []) {
    const detail = row && row.detail && typeof row.detail === "object" ? row.detail : {};
    const symbol = upper(row && (row.symbol || detail.symbol));
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function buildPositionReadModelLatestId(exchange, symbol) {
  return `POSITION_READ_MODEL_LATEST__${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function resolveLatestReadModelSnapshot(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.after_snapshot && typeof doc.after_snapshot === "object") return safeClone(doc.after_snapshot);
  if (doc.after_summary && typeof doc.after_summary === "object") return safeClone(doc.after_summary);
  return safeClone(doc);
}

function resolveReadModelPositionCycleId(doc = null, snapshot = null) {
  return trimOrNull(snapshot && (
    snapshot.position_cycle_id ||
    snapshot.active_position_cycle_id ||
    snapshot.current_position_cycle_id ||
    snapshot.cycle_id ||
    snapshot["meta.position_cycle_id"] ||
    (snapshot.meta && snapshot.meta.position_cycle_id)
  )) || trimOrNull(doc && (
    doc.position_cycle_id ||
    doc.active_position_cycle_id ||
    doc.current_position_cycle_id
  ));
}

function readModelQtyAbs(snapshot = null) {
  const raw = snapshot && (
    snapshot.qty_base ??
    snapshot.position_qty_base ??
    snapshot.remaining_qty_base ??
    snapshot.size_base ??
    snapshot.qty
  );
  const value = Number(raw);
  return Number.isFinite(value) ? Math.abs(value) : null;
}

function isLatestReadModelActiveCandidate(doc = null) {
  const snapshot = resolveLatestReadModelSnapshot(doc);
  if (!snapshot || typeof snapshot !== "object") return false;
  const state = upper(snapshot.state || snapshot.position_state || snapshot.lifecycle_state);
  const status = upper(snapshot.status || snapshot.position_status);
  const terminal = upper(snapshot.terminal_reason || snapshot.close_reason || snapshot.exit_reason);
  if (["FLAT", "CLOSED", "EXITED", "TERMINAL", "NO_POSITION"].includes(state)) return false;
  if (["FLAT", "CLOSED", "EXITED", "TERMINAL"].includes(status)) return false;
  if (terminal) return false;
  const qtyAbs = readModelQtyAbs(snapshot);
  if (qtyAbs != null && qtyAbs <= 0) return false;
  if (ACTIVE_READ_MODEL_STATES.includes(state) || ACTIVE_READ_MODEL_STATES.includes(status)) return true;
  return qtyAbs != null && qtyAbs > 0;
}

async function fetchLatestReadModelsForPositionCycles({
  db = null,
  env = process.env,
  positionCycles = [],
} = {}) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") {
    return Object.freeze({ ok: false, rows_by_symbol: Object.freeze({}), error_code: "FIRESTORE_REQUIRED" });
  }
  const exchange = upper(env && env.DONBEOLJA_V2_REPAIR_QUEUE_EXCHANGE) || "BINANCEFUT";
  const symbols = dedupeSymbolsFromPositionCycles(positionCycles);
  const docs = await Promise.all(symbols.map(async (symbol) => {
    const snap = await firestore.collection("position_read_model_latest")
      .doc(buildPositionReadModelLatestId(exchange, symbol))
      .get()
      .catch(() => null);
    return snap && snap.exists ? (snap.data() || null) : null;
  }));
  const rowsBySymbol = {};
  symbols.forEach((symbol, index) => {
    if (docs[index]) rowsBySymbol[symbol] = docs[index];
  });
  return Object.freeze({
    ok: true,
    exchange,
    symbol_n: symbols.length,
    rows_by_symbol: Object.freeze(rowsBySymbol),
  });
}

async function fetchLatestReadModelsForRepairRequests({
  db = null,
  env = process.env,
  repairRequests = [],
} = {}) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") {
    return Object.freeze({ ok: false, rows_by_symbol: Object.freeze({}), error_code: "FIRESTORE_REQUIRED" });
  }
  const exchange = upper(env && env.DONBEOLJA_V2_REPAIR_QUEUE_EXCHANGE) || "BINANCEFUT";
  const symbols = dedupeSymbolsFromRepairRequests(repairRequests);
  const docs = await Promise.all(symbols.map(async (symbol) => {
    const snap = await firestore.collection("position_read_model_latest")
      .doc(buildPositionReadModelLatestId(exchange, symbol))
      .get()
      .catch(() => null);
    return snap && snap.exists ? (snap.data() || null) : null;
  }));
  const rowsBySymbol = {};
  symbols.forEach((symbol, index) => {
    if (docs[index]) rowsBySymbol[symbol] = docs[index];
  });
  return Object.freeze({
    ok: true,
    exchange,
    symbol_n: symbols.length,
    rows_by_symbol: Object.freeze(rowsBySymbol),
  });
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readSnapshotMeta(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return {};
  return snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
}

function readMetaValue(snapshot = null, key) {
  const meta = readSnapshotMeta(snapshot);
  if (meta[key] !== undefined) return meta[key];
  const dotted = `meta.${key}`;
  return snapshot && snapshot[dotted] !== undefined ? snapshot[dotted] : undefined;
}

function hasPositionCycle(rows = [], positionCycleId) {
  const cycleId = trimOrNull(positionCycleId);
  return !!cycleId && (Array.isArray(rows) ? rows : []).some((row) => trimOrNull(row && row.position_cycle_id) === cycleId);
}

function hasProjection(rows = [], positionCycleId) {
  const cycleId = trimOrNull(positionCycleId);
  return !!cycleId && (Array.isArray(rows) ? rows : []).some((row) => trimOrNull(row && row.position_cycle_id) === cycleId);
}

function hasProtectionRuntime(rows = [], positionCycleId) {
  const cycleId = trimOrNull(positionCycleId);
  return !!cycleId && (Array.isArray(rows) ? rows : []).some((row) => trimOrNull(row && row.position_cycle_id) === cycleId);
}

function resolveRepairDetail(row = {}) {
  return row && row.detail && typeof row.detail === "object" ? row.detail : {};
}

function resolveSyntheticTp1Quantity({ repairRequest, snapshot } = {}) {
  const detail = resolveRepairDetail(repairRequest);
  return toNumberOrNull(detail.tp1_qty_abs)
    ?? toNumberOrNull(detail.expected_tp_qty_base)
    ?? toNumberOrNull(detail.expected_tp1_qty_abs)
    ?? toNumberOrNull(readMetaValue(snapshot, "tp1_target_qty_abs"))
    ?? toNumberOrNull(readMetaValue(snapshot, "tp_p1_target_qty_abs"))
    ?? toNumberOrNull(readMetaValue(snapshot, "entry_qty_abs"))
    ?? toNumberOrNull(readMetaValue(snapshot, "entry_qty_base"))
    ?? readModelQtyAbs(snapshot);
}

function resolveSyntheticTp1Price({ repairRequest, snapshot } = {}) {
  const detail = resolveRepairDetail(repairRequest);
  return toNumberOrNull(detail.tp1_target_price)
    ?? toNumberOrNull(detail.tp1_trigger_price)
    ?? toNumberOrNull(readMetaValue(snapshot, "tp1_target_price"))
    ?? toNumberOrNull(readMetaValue(snapshot, "tp_p1_target_price"))
    ?? toNumberOrNull(readMetaValue(snapshot, "native_protection_tp_price"));
}

function resolveSyntheticStopPrice({ repairRequest, snapshot } = {}) {
  const detail = resolveRepairDetail(repairRequest);
  return toNumberOrNull(detail.final_effective_stop)
    ?? toNumberOrNull(detail.chosen_stop_price)
    ?? toNumberOrNull(detail.native_stop_price)
    ?? toNumberOrNull(readMetaValue(snapshot, "final_effective_stop"))
    ?? toNumberOrNull(readMetaValue(snapshot, "native_protection_stop_price"))
    ?? toNumberOrNull(readMetaValue(snapshot, "initial_stop_price"));
}

function buildSyntheticRepairContextFromLatestReadModel({
  repairRequest = null,
  latestReadModel = null,
  recordedAt = null,
} = {}) {
  const snapshot = resolveLatestReadModelSnapshot(latestReadModel);
  if (!snapshot || typeof snapshot !== "object") return null;
  if (isLatestReadModelActiveCandidate(latestReadModel) !== true) return null;
  const requestedCycleId = trimOrNull(repairRequest && repairRequest.position_cycle_id);
  const latestCycleId = resolveReadModelPositionCycleId(latestReadModel, snapshot);
  if (!requestedCycleId || requestedCycleId !== latestCycleId) return null;
  const detail = resolveRepairDetail(repairRequest);
  const symbol = upper(detail.symbol || snapshot.symbol || snapshot.symbol_or_pair_id || latestReadModel.symbol);
  const exchange = upper(snapshot.exchange || latestReadModel.exchange) || "BINANCEFUT";
  const positionSide = upper(detail.position_side || snapshot.position_side || readMetaValue(snapshot, "position_side"));
  const entryQtyAbs = toNumberOrNull(readMetaValue(snapshot, "entry_qty_abs"))
    ?? toNumberOrNull(readMetaValue(snapshot, "entry_qty_base"))
    ?? readModelQtyAbs(snapshot);
  const entryPrice = toNumberOrNull(readMetaValue(snapshot, "entry_price"))
    ?? toNumberOrNull(snapshot.avg_price)
    ?? toNumberOrNull(readMetaValue(snapshot, "avg_price"));
  const tp1QtyAbs = resolveSyntheticTp1Quantity({ repairRequest, snapshot });
  const tp1TargetPrice = resolveSyntheticTp1Price({ repairRequest, snapshot });
  const stopPrice = resolveSyntheticStopPrice({ repairRequest, snapshot });
  if (!symbol || !positionSide || !(entryQtyAbs > 0) || !(entryPrice > 0)) return null;
  const at = trimOrNull(recordedAt) || new Date().toISOString();
  const protectionRuntimeId = trimOrNull(readMetaValue(snapshot, "protection_runtime_id"))
    || `PRTV2__${requestedCycleId}`;
  const positionCycle = Object.freeze({
    position_cycle_id: requestedCycleId,
    exchange,
    symbol,
    position_side: positionSide,
    entry_event_id: trimOrNull(readMetaValue(snapshot, "entry_event_id")),
    entry_order_id: trimOrNull(readMetaValue(snapshot, "entry_order_id")),
    entry_fill_group_id: trimOrNull(readMetaValue(snapshot, "entry_fill_group_id")),
    entry_intent_id: trimOrNull(readMetaValue(snapshot, "entry_intent_id")),
    signal_intent_id: trimOrNull(readMetaValue(snapshot, "signal_intent_id")),
    openclaw_decision_id: trimOrNull(readMetaValue(snapshot, "openclaw_decision_id")),
    entry_price: entryPrice,
    entry_qty_abs: entryQtyAbs,
    status: "ACTIVE_PROTECTED",
    protection_runtime_id: protectionRuntimeId,
    protection_activated_at: trimOrNull(readMetaValue(snapshot, "protection_activated_at")),
    native_protection_health_status: "HEALTHY",
    synthetic_repair_context: true,
    synthetic_repair_context_source: "POSITION_READ_MODEL_LATEST",
    synthetic_repair_context_at: at,
  });
  const projection = Object.freeze({
    exit_runtime_projection_id: `ERPv2__${requestedCycleId}`,
    position_cycle_id: requestedCycleId,
    stage: upper(repairRequest && repairRequest.stage) || "PRE_TP1",
    tp1_done: readMetaValue(snapshot, "tp_p1_done") === true,
    trail_active: readMetaValue(snapshot, "trail_active") === true,
    entry_qty_abs: entryQtyAbs,
    tp1_target_price: tp1TargetPrice,
    tp1_target_qty_abs: tp1QtyAbs,
    tp1_filled_qty_abs: 0,
    runner_remaining_qty_abs: entryQtyAbs,
    runner_floor_stop: null,
    trail_stop_by_r: null,
    chosen_stop_source: "SL",
    chosen_stop_price: stopPrice,
    final_effective_stop: stopPrice,
    native_stop_price: toNumberOrNull(readMetaValue(snapshot, "native_protection_stop_price")) ?? stopPrice,
    health_status: "HEALTHY",
    initial_stop_price: toNumberOrNull(readMetaValue(snapshot, "initial_stop_price")) ?? stopPrice,
    entry_r_distance: toNumberOrNull(readMetaValue(snapshot, "entry_r_distance")),
    synthetic_repair_context: true,
    synthetic_repair_context_source: "POSITION_READ_MODEL_LATEST",
    synthetic_repair_context_at: at,
  });
  const protectionRuntime = Object.freeze({
    protection_runtime_id: protectionRuntimeId,
    position_cycle_id: requestedCycleId,
    exchange,
    symbol,
    position_side: positionSide,
    sl_order_id: trimOrNull(readMetaValue(snapshot, "native_protection_stop_order_id")) || trimOrNull(detail.sl_order_id),
    sl_order_status: trimOrNull(readMetaValue(snapshot, "native_protection_stop_order_id")) || trimOrNull(detail.sl_order_id) ? "PLACED" : null,
    tp1_order_id: trimOrNull(readMetaValue(snapshot, "native_protection_tp_order_id")) || trimOrNull(detail.tp1_order_id),
    tp1_order_status: trimOrNull(readMetaValue(snapshot, "native_protection_tp_order_id")) || trimOrNull(detail.tp1_order_id) ? "PLACED" : null,
    native_stop_price: toNumberOrNull(readMetaValue(snapshot, "native_protection_stop_price")) ?? stopPrice,
    native_tp1_price: toNumberOrNull(readMetaValue(snapshot, "native_protection_tp_price")) ?? tp1TargetPrice,
    native_refresh_status: upper(readMetaValue(snapshot, "native_protection_refresh_status")) || "OK",
    health_status: upper(readMetaValue(snapshot, "native_protection_health_status")) || "HEALTHY",
    last_refresh_at: trimOrNull(readMetaValue(snapshot, "external_synced_at")) || at,
    synthetic_repair_context: true,
    synthetic_repair_context_source: "POSITION_READ_MODEL_LATEST",
    synthetic_repair_context_at: at,
  });
  return Object.freeze({
    positionCycle,
    projection,
    protectionRuntime,
  });
}

function synthesizeRepairContextsFromLatestReadModels({
  repairRequests = [],
  positionCycles = [],
  projections = [],
  protectionRuntimes = [],
  latestReadModelsBySymbol = {},
  recordedAt = null,
} = {}) {
  const syntheticPositionCycles = [];
  const syntheticProjections = [];
  const syntheticProtectionRuntimes = [];
  for (const repairRequest of Array.isArray(repairRequests) ? repairRequests : []) {
    const detail = resolveRepairDetail(repairRequest);
    const symbol = upper(detail.symbol || repairRequest.symbol);
    const latestDoc = symbol ? latestReadModelsBySymbol[symbol] : null;
    const context = buildSyntheticRepairContextFromLatestReadModel({
      repairRequest,
      latestReadModel: latestDoc,
      recordedAt,
    });
    if (!context) continue;
    const cycleId = context.positionCycle.position_cycle_id;
    if (!hasPositionCycle(positionCycles, cycleId) && !hasPositionCycle(syntheticPositionCycles, cycleId)) {
      syntheticPositionCycles.push(context.positionCycle);
    }
    if (!hasProjection(projections, cycleId) && !hasProjection(syntheticProjections, cycleId)) {
      syntheticProjections.push(context.projection);
    }
    if (!hasProtectionRuntime(protectionRuntimes, cycleId) && !hasProtectionRuntime(syntheticProtectionRuntimes, cycleId)) {
      syntheticProtectionRuntimes.push(context.protectionRuntime);
    }
  }
  return Object.freeze({
    position_cycles: Object.freeze(syntheticPositionCycles),
    projections: Object.freeze(syntheticProjections),
    protection_runtimes: Object.freeze(syntheticProtectionRuntimes),
    synthesized_position_cycle_n: syntheticPositionCycles.length,
    synthesized_projection_n: syntheticProjections.length,
    synthesized_protection_runtime_n: syntheticProtectionRuntimes.length,
  });
}

async function filterRepairRequestsByLatestActiveReadModel({
  db = null,
  env = process.env,
  repairRequests = [],
  positionCycles = [],
  recordedAt = null,
} = {}) {
  const requireLatest = resolveRequireLatestActiveReadModel(env);
  const rows = Array.isArray(repairRequests) ? repairRequests.slice() : [];
  if (requireLatest !== true) {
    return Object.freeze({
      ok: true,
      required: false,
      kept_repair_requests: Object.freeze(rows),
      skipped_repairs: Object.freeze([]),
      latest_read_models_by_symbol: Object.freeze({}),
    });
  }
  const cycleMap = indexRowsByPositionCycle(positionCycles);
  const latest = await fetchLatestReadModelsForPositionCycles({ db, env, positionCycles });
  const kept = [];
  const skipped = [];
  for (const request of rows) {
    const cycleId = trimOrNull(request && request.position_cycle_id);
    const positionCycle = cycleMap.get(cycleId);
    const symbol = upper(positionCycle && positionCycle.symbol);
    const latestDoc = symbol ? latest.rows_by_symbol[symbol] || null : null;
    const snapshot = resolveLatestReadModelSnapshot(latestDoc);
    const latestCycleId = resolveReadModelPositionCycleId(latestDoc, snapshot);
    const active = isLatestReadModelActiveCandidate(latestDoc);
    if (positionCycle && latestDoc && active && latestCycleId === cycleId) {
      kept.push(request);
      continue;
    }
    skipped.push(Object.freeze({
      exit_repair_request_id: trimOrNull(request && request.exit_repair_request_id),
      position_cycle_id: cycleId,
      issue_code: upper(request && request.issue_code),
      requested_action: upper(request && request.requested_action),
      skip_reason: !positionCycle
        ? "POSITION_CYCLE_REQUIRED"
        : (!latestDoc
            ? "LATEST_ACTIVE_READ_MODEL_REQUIRED"
            : "STALE_REPAIR_REQUEST_NOT_LATEST_ACTIVE_POSITION"),
      latest_symbol: symbol,
      latest_position_cycle_id: latestCycleId,
      latest_active: active === true,
      recorded_at: recordedAt || new Date().toISOString(),
    }));
  }
  return Object.freeze({
    ok: true,
    required: true,
    kept_repair_requests: Object.freeze(kept),
    skipped_repairs: Object.freeze(skipped),
    latest_read_models_by_symbol: latest.rows_by_symbol,
  });
}

async function fetchPendingRepairRequests({
  db = null,
  env = process.env,
  batchLimit = null,
} = {}) {
  const boundedLimit = resolveRepairQueueBatchLimit(env, batchLimit == null ? 10 : batchLimit);
  const scanLimit = resolveRepairQueueScanLimit(env, boundedLimit);
  const pendingList = await queryV2DocsByField({
    db,
    env,
    collectionKey: "REPAIR_REQUESTS",
    field: "status",
    value: "PENDING",
    limit: scanLimit,
  });
  const rows = sortRepairRequestsByCreatedAt(pendingList.rows);
  return Object.freeze({
    ok: true,
    repair_request_limit: boundedLimit,
    repair_request_scan_limit: scanLimit,
    repair_requests: Object.freeze(rows),
    rows: Object.freeze(rows),
    collectionName: pendingList.collectionName,
  });
}

async function fetchRepairQueueInputs({
  db = null,
  env = process.env,
  repairRequestLimit = null,
} = {}) {
  const boundedLimit = resolveRepairQueueBatchLimit(env, repairRequestLimit == null ? 10 : repairRequestLimit);
  const pendingOnly = String(env && env.DONBEOLJA_V2_REPAIR_QUEUE_PENDING_ONLY || "1").trim() !== "0";
  const repairRequestList = pendingOnly
    ? await fetchPendingRepairRequests({
        db,
        env,
        batchLimit: boundedLimit,
      })
    : await listV2Docs({
        db,
        env,
        collectionKey: "REPAIR_REQUESTS",
        limit: boundedLimit,
      });
  const repairRequests = Array.isArray(repairRequestList.rows) ? repairRequestList.rows : [];
  const cycleIds = dedupePositionCycleIds(repairRequests);
  const positionCycleResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: positionCycleId,
  })));
  const projectionResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    docId: `ERPv2__${positionCycleId}`,
  })));
  const protectionRuntimeResults = await Promise.all(cycleIds.map((positionCycleId) => getV2Doc({
    db,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: `PRTV2__${positionCycleId}`,
  })));
  const positionCycles = Object.freeze(positionCycleResults.filter((row) => row.ok === true).map((row) => row.doc));
  const projections = Object.freeze(projectionResults.filter((row) => row.ok === true).map((row) => row.doc));
  const protectionRuntimes = Object.freeze(protectionRuntimeResults.filter((row) => row.ok === true).map((row) => row.doc));
  const latestByRepairRequest = await fetchLatestReadModelsForRepairRequests({
    db,
    env,
    repairRequests,
  });
  const synthesizedContexts = synthesizeRepairContextsFromLatestReadModels({
    repairRequests,
    positionCycles,
    projections,
    protectionRuntimes,
    latestReadModelsBySymbol: latestByRepairRequest.rows_by_symbol || {},
  });
  const hydratedPositionCycles = Object.freeze([
    ...positionCycles,
    ...synthesizedContexts.position_cycles,
  ]);
  const hydratedProjections = Object.freeze([
    ...projections,
    ...synthesizedContexts.projections,
  ]);
  const hydratedProtectionRuntimes = Object.freeze([
    ...protectionRuntimes,
    ...synthesizedContexts.protection_runtimes,
  ]);
  const latestFilter = pendingOnly
    ? await filterRepairRequestsByLatestActiveReadModel({
        db,
        env,
        repairRequests,
        positionCycles: hydratedPositionCycles,
      })
    : Object.freeze({
        required: false,
        kept_repair_requests: Object.freeze(repairRequests.slice()),
        skipped_repairs: Object.freeze([]),
        latest_read_models_by_symbol: Object.freeze({}),
      });
  const selectedRepairRequests = latestFilter.kept_repair_requests.slice(0, boundedLimit);
  const selectedCycleIds = dedupePositionCycleIds(selectedRepairRequests);
  const selectedCycleIdSet = new Set(selectedCycleIds);
  return Object.freeze({
    ok: true,
    repair_request_limit: boundedLimit,
    repair_request_scan_limit: repairRequestList.repair_request_scan_limit || boundedLimit,
    pending_only: pendingOnly,
    repair_requests_scanned_n: repairRequests.length,
    latest_active_read_model_required: latestFilter.required === true,
    latest_active_read_model_skipped_n: latestFilter.skipped_repairs.length,
    latest_active_read_model_skipped_repairs: Object.freeze(latestFilter.skipped_repairs.slice()),
    repair_requests: Object.freeze(selectedRepairRequests.slice()),
    synthetic_repair_context_n: synthesizedContexts.synthesized_position_cycle_n,
    synthetic_projection_context_n: synthesizedContexts.synthesized_projection_n,
    synthetic_protection_runtime_context_n: synthesizedContexts.synthesized_protection_runtime_n,
    position_cycles: Object.freeze(hydratedPositionCycles.filter((row) => selectedCycleIdSet.has(trimOrNull(row && row.position_cycle_id)))),
    projections: Object.freeze(hydratedProjections.filter((row) => selectedCycleIdSet.has(trimOrNull(row && row.position_cycle_id)))),
    protection_runtimes: Object.freeze(hydratedProtectionRuntimes.filter((row) => selectedCycleIdSet.has(trimOrNull(row && row.position_cycle_id)))),
    requested_position_cycle_ids: Object.freeze(selectedCycleIds),
    missing_position_cycle_ids: Object.freeze(
      selectedCycleIds.filter((cycleId) => !hasPositionCycle(hydratedPositionCycles, cycleId))
    ),
    missing_projection_cycle_ids: Object.freeze(
      selectedCycleIds.filter((cycleId) => !hasProjection(hydratedProjections, cycleId))
    ),
    missing_protection_runtime_cycle_ids: Object.freeze(
      selectedCycleIds.filter((cycleId) => !hasProtectionRuntime(hydratedProtectionRuntimes, cycleId))
    ),
  });
}

async function runRepairQueueWorker({
  db = null,
  env = process.env,
  repairRequestLimit = null,
  placementStartedAt = null,
  placementRetryIdPrefix = "RQ",
  persistExecutionLedger = false,
  recordedAt = null,
} = {}) {
  const inputs = await fetchRepairQueueInputs({
    db,
    env,
    repairRequestLimit,
  });
  const batch = buildRepairQueueBatch({
    repairRequests: inputs.repair_requests,
    projections: inputs.projections,
    protectionRuntimes: inputs.protection_runtimes,
    positionCycles: inputs.position_cycles,
    maxBatchSize: inputs.repair_request_limit,
    placementStartedAt,
    placementRetryIdPrefix,
  });
  const executionLedgerDocs = Object.freeze([
    ...batch.delegated_repairs.map((row) => buildDelegatedRepairExecutionLedgerDoc({
      delegatedRepair: row,
      recordedAt,
    })),
    ...inputs.latest_active_read_model_skipped_repairs.map((row) => buildSkippedRepairExecutionLedgerDoc({
      skippedRepair: row,
      recordedAt,
    })),
    ...batch.skipped_repairs.map((row) => buildSkippedRepairExecutionLedgerDoc({
      skippedRepair: row,
      recordedAt,
    })),
  ]);
  const persistedExecutionLedger = persistExecutionLedger === true
    ? Object.freeze(await Promise.all(executionLedgerDocs.map((doc) => putV2Doc({
        db,
        env,
        collectionKey: "REPAIR_EXECUTION_LEDGER",
        doc,
      }))))
    : Object.freeze([]);
  return Object.freeze({
    ok: true,
    repair_request_limit: inputs.repair_request_limit,
    requested_repair_n: inputs.repair_requests.length,
    repair_requests_scanned_n: inputs.repair_requests_scanned_n,
    latest_active_read_model_required: inputs.latest_active_read_model_required,
    latest_active_read_model_skipped_n: inputs.latest_active_read_model_skipped_n,
    latest_active_read_model_skipped_repairs: inputs.latest_active_read_model_skipped_repairs,
    requested_position_cycle_ids: inputs.requested_position_cycle_ids,
    missing_position_cycle_ids: inputs.missing_position_cycle_ids,
    missing_projection_cycle_ids: inputs.missing_projection_cycle_ids,
    missing_protection_runtime_cycle_ids: inputs.missing_protection_runtime_cycle_ids,
    batch,
    execution_ledger_docs: executionLedgerDocs,
    persisted_execution_ledger: persistedExecutionLedger,
  });
}

module.exports = {
  fetchPendingRepairRequests,
  fetchRepairQueueInputs,
  runRepairQueueWorker,
  __test: {
    trimOrNull,
    resolveRepairQueueBatchLimit,
    resolveRepairQueueScanLimit,
    isPendingRepairRequest,
    sortRepairRequestsByCreatedAt,
    dedupePositionCycleIds,
    dedupeSymbolsFromRepairRequests,
    toNumberOrNull,
    readSnapshotMeta,
    readMetaValue,
    buildSyntheticRepairContextFromLatestReadModel,
    synthesizeRepairContextsFromLatestReadModels,
  },
};
