const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function normalizeUpper(v) {
  return String(v || "").trim().toUpperCase();
}

function buildExitOrderContractId({ exchange, symbol, orderId } = {}) {
  const ex = normalizeUpper(exchange);
  const sym = normalizeUpper(symbol);
  const oid = Number(orderId);
  if (!ex || !sym || !Number.isFinite(oid)) return null;
  return `EXIT_ORDER_CONTRACT__${ex}__${sym}__${oid}`;
}

function inferExitStage(event) {
  const ev = normalizeUpper(event);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  return "OTHER_EXIT";
}

async function upsertExitOrderContract({
  exchange,
  symbol,
  orderId,
  clientOrderId = null,
  event,
  stage = null,
  intentId = null,
  signalId = null,
  signalDocId = null,
  entryEventId = null,
  positionSide = null,
  closeSide = null,
  expectedQtyBase = null,
  expectedQtyRatio = null,
  triggerPrice = null,
  triggerSource = null,
  reduceOnly = null,
  closePosition = null,
  status = "OPEN",
  source = null,
  createdAt = null,
  extra = null,
} = {}) {
  const id = buildExitOrderContractId({ exchange, symbol, orderId });
  if (!id) throw new Error("EXIT_ORDER_CONTRACT_ID_REQUIRED");
  const db = getFirestore();
  const ref = db.collection("exit_order_contracts").doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() || {}) : {};
    const ts = nowIso();
    const payload = {
      contract_id: id,
      exchange: normalizeUpper(exchange),
      symbol: normalizeUpper(symbol),
      order_id: Number(orderId),
      client_order_id: String(clientOrderId || "").trim() || null,
      event: normalizeUpper(event) || null,
      stage: normalizeUpper(stage) || inferExitStage(event),
      intent_id: String(intentId || "").trim() || null,
      signal_id: String(signalId || "").trim() || null,
      signal_doc_id: String(signalDocId || "").trim() || null,
      entry_event_id: String(entryEventId || "").trim() || null,
      position_side: normalizeUpper(positionSide) || null,
      close_side: normalizeUpper(closeSide) || null,
      expected_qty_base: Number.isFinite(Number(expectedQtyBase)) ? Number(expectedQtyBase) : null,
      expected_qty_ratio: Number.isFinite(Number(expectedQtyRatio)) ? Number(expectedQtyRatio) : null,
      trigger_price: Number.isFinite(Number(triggerPrice)) ? Number(triggerPrice) : null,
      trigger_source: String(triggerSource || "").trim() || null,
      reduce_only: reduceOnly === true,
      close_position: closePosition === true,
      status: normalizeUpper(status) || "OPEN",
      source: String(source || "").trim() || null,
      created_at: current.created_at || createdAt || ts,
      updated_at: ts,
    };
    if (extra && typeof extra === "object") Object.assign(payload, extra);
    tx.set(ref, payload, { merge: true });
    return payload;
  });
}

async function getExitOrderContractByOrderId({ exchange, symbol, orderId } = {}) {
  const id = buildExitOrderContractId({ exchange, symbol, orderId });
  if (!id) return null;
  const snap = await getFirestore().collection("exit_order_contracts").doc(id).get();
  return snap.exists ? (snap.data() || null) : null;
}

async function markExitOrderContractConsumed({
  exchange,
  symbol,
  orderId,
  fillId = null,
  tradeId = null,
  consumedEvent = null,
  consumedQtyBase = null,
  consumedAt = null,
} = {}) {
  const id = buildExitOrderContractId({ exchange, symbol, orderId });
  if (!id) return null;
  const ref = getFirestore().collection("exit_order_contracts").doc(id);
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const ts = consumedAt || nowIso();
    const payload = {
      status: "CONSUMED",
      consumed_at: ts,
      consumed_fill_id: String(fillId || "").trim() || null,
      consumed_trade_id: String(tradeId || "").trim() || null,
      consumed_event: normalizeUpper(consumedEvent) || null,
      consumed_qty_base: Number.isFinite(Number(consumedQtyBase)) ? Number(consumedQtyBase) : null,
      updated_at: ts,
    };
    tx.set(ref, payload, { merge: true });
    return payload;
  });
}

module.exports = {
  buildExitOrderContractId,
  inferExitStage,
  upsertExitOrderContract,
  getExitOrderContractByOrderId,
  markExitOrderContractConsumed,
};
