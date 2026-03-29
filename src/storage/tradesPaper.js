// src/storage/tradesPaper.js
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function normalizeFeaturesJson(featuresJson) {
  if (!featuresJson || typeof featuresJson !== "object" || Array.isArray(featuresJson)) return null;
  try {
    return JSON.parse(JSON.stringify(featuresJson));
  } catch (_err) {
    return null;
  }
}

function buildTradeId({ exchange, symbol, event, execBarCloseMs, execMs }) {
  const execSuffix = Number.isFinite(execMs) ? `__${Math.trunc(execMs)}` : "";
  return `TRADE__${exchange}__${symbol}__${event}__${execBarCloseMs}${execSuffix}`;
}

async function upsertTradeEvent({
  runId,
  exchange,
  symbol,
  tf,
  event,
  side,
  execBarCloseTimeUtc,
  execBarCloseTimeUtcMs,
  execMs = null,
  intentId = null,
  fillId = null,
  entryEventId = null,
  entrySignalType = null,
  execPrice,
  qtyPct,
  feeValue,
  note,
  pnl,
  notionalKrw = null,
  budgetMaxKrw = null,
  budgetUsedKrw = null,
  qtyFraction = null,
  meta = {},
  executionMode = null,
  featuresJson = null,
} = {}) {
  const db = getFirestore();
  const execMsNum = Number(execMs);
  const normalizedExecMs = Number.isFinite(execMsNum) ? Math.trunc(execMsNum) : null;
  const id = buildTradeId({
    exchange,
    symbol,
    event,
    execBarCloseMs: execBarCloseTimeUtcMs,
    execMs: normalizedExecMs,
  });
  const ref = db.collection("trades_paper").doc(id);

  let createdAt = nowIso();
  try {
    const existing = await ref.get();
    if (existing.exists) createdAt = existing.data()?.created_at || createdAt;
  } catch (_) {}

  const normalizedFeaturesJson = normalizeFeaturesJson(featuresJson);
  const payload = {
    trade_id: id,
    run_id: runId || null,
    intent_id: intentId || null,
    fill_id: fillId || null,
    exchange,
    symbol_or_pair_id: symbol,
    tf,

    event,
    side,

    exec_bar_close_time_utc: execBarCloseTimeUtc || null,
    exec_bar_close_time_utc_ms: Number(execBarCloseTimeUtcMs),
    exec_ms: normalizedExecMs,
    entry_event_id: entryEventId || null,
    entry_signal_type: entrySignalType || null,

    exec_price: Number(execPrice),
    qty_pct: Number(qtyPct),
    qty_fraction: (qtyFraction == null ? null : Number(qtyFraction)),
    execution_mode: executionMode || null,

    fee_value: Number(feeValue || 0),
    pnl: pnl === null || pnl === undefined ? null : Number(pnl),
    notional_krw: (notionalKrw === null || notionalKrw === undefined) ? null : Number(notionalKrw),
    budget_max_krw: (budgetMaxKrw === null || budgetMaxKrw === undefined) ? null : Number(budgetMaxKrw),
    budget_used_krw: (budgetUsedKrw === null || budgetUsedKrw === undefined) ? null : Number(budgetUsedKrw),

    note: note || null,
    meta: meta || {},

    created_at: createdAt,
    updated_at: nowIso(),
  };

  if (normalizedFeaturesJson) payload.features_json = normalizedFeaturesJson;

  await ref.set(payload, { merge: true });
  return payload;
}

module.exports = {
  buildTradeId,
  upsertTradeEvent,
  __test: {
    tradeId: buildTradeId,
  },
};
