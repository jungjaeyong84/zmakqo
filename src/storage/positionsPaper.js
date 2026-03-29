// src/storage/positionsPaper.js
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function posId({ exchange, symbol }) {
  return `POS__${String(exchange || "").toUpperCase().trim()}__${String(symbol || "").toUpperCase().trim()}`;
}

function derivePositionState(sizePct, meta = {}) {
  const size = Number(sizePct);
  if (!Number.isFinite(size) || size <= 0) return "FLAT";
  if (meta && meta.tp_p1_done === true) return "SCALE_OUT";
  if (size < 0.5) return "PROBE";
  return "COMMIT";
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
    return {
      pos_id: id,
      exchange,
      symbol_or_pair_id: symbol,
      state: "FLAT",
      position_state: "FLAT",
      position_side: null,
      size_pct: 0.0,      // 0~1 (분할)
      avg_price: null,
      qty_base: null,
      updated_at: null,
    };
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
  } = {}) {
  const db = getFirestore();
  const id = posId({ exchange, symbol });
  const ref = db.collection("positions_paper").doc(id);

  const positionState = derivePositionState(sizePct, meta);
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
    updated_at: nowIso(),
  };

  await ref.set(payload, { merge: true });
  return payload;
}

module.exports = {
  getPosition,
  upsertPosition,
  clearTpP1PendingIfUnchanged,
  __test: {
    posId,
    derivePositionState,
    matchesTpP1PendingSnapshot,
    buildTpP1PendingClearedMeta,
  },
};
