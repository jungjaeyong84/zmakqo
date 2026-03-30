const { getFirestore } = require("./firestore");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { confirmSelfEvolutionRuntimeSignal } = require("../utils/selfEvolutionRuntimeState");

function nowIso() {
  return new Date().toISOString();
}

function normalizeExecutionMode(v) {
  const s = String(v || "").toUpperCase();
  if (s === "LIVE" || s === "LIVE_DRY_RUN" || s === "PAPER") return s;
  return null;
}

function dropId({ exchange, symbol, tf, barCloseMs, event, side, group, subtype }) {
  return [
    "DROP",
    String(exchange || ""),
    String(symbol || ""),
    String(tf || ""),
    String(barCloseMs || ""),
    String(event || ""),
    String(side || ""),
    String(group || ""),
    String(subtype || ""),
  ].join("__");
}

function pickDropStrategyId(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const features = payload.features_json && typeof payload.features_json === "object"
    ? payload.features_json
    : {};
  const strategyId = String(
    payload.strategy_id
    || features.strategy_id
    || ""
  ).trim();
  return strategyId || null;
}

function shouldConfirmSelfEvolutionFromDrop(payload = null) {
  if (!payload || typeof payload !== "object") return false;
  const executionMode = normalizeExecutionMode(payload.execution_mode);
  if (executionMode !== "LIVE") return false;
  if (!String(payload.signal_id || "").trim()) return false;
  if (!pickDropStrategyId(payload)) return false;
  return true;
}

async function recordSignalDrops({ exchange, symbol, tf, drops = [] } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return { ok: true, written: 0 };
  const db = getFirestore();
  const now = nowIso();

  const normalizedDrops = [];
  const writes = drops.map((d) => {
    const group = String(d.event_group || d.group || "UNKNOWN").toUpperCase();
    const subtype = String(d.event_subtype || d.subtype || "GEN").toUpperCase();
    const id = dropId({
      exchange,
      symbol,
      tf,
      barCloseMs: d.bar_close_time_utc_ms,
      event: d.event,
      side: d.side,
      group,
      subtype,
    });
    const regimeMeta = enrichFeaturesWithRegime(d.features_json || d.features || {});

    const payload = {
      drop_id: id,
      exchange: String(exchange || "").toUpperCase(),
      symbol_or_pair_id: String(symbol || ""),
      tf: String(tf || ""),
      bar_close_time_utc_ms: Number(d.bar_close_time_utc_ms || 0) || null,
      event: d.event || null,
      side: d.side || null,
      qty_pct: Number.isFinite(Number(d.qty_pct)) ? Number(d.qty_pct) : null,
      reason: d.reason || "DROP_FILTER",
      features_json: regimeMeta.features,
      execution_mode: normalizeExecutionMode(
        d.execution_mode ||
        (d.meta && d.meta.execution_mode) ||
        (d.features_json && d.features_json.execution_mode) ||
        (d.features && d.features.execution_mode)
      ),
      event_group: group,
      event_subtype: subtype,
      drop_key: d.drop_key || null,
      drop_reason_code: d.drop_reason_code || null,
      signal_id: d.signal_id || null,
      event_intent: d.event_intent || null,
      mapping_ok: d.mapping_ok === true,
      mapping_version: d.mapping_version || null,
      regime: regimeMeta.regime,
      market_regime: regimeMeta.market_regime,
      regime_source: regimeMeta.regime_source,
      created_at: now,
      updated_at: now,
    };
    normalizedDrops.push(payload);
    return db.collection("signals_dropped").doc(id).set(payload, { merge: true });
  });

  await Promise.allSettled(writes);
  const confirmations = normalizedDrops
    .filter((payload) => shouldConfirmSelfEvolutionFromDrop(payload))
    .map((payload) =>
      confirmSelfEvolutionRuntimeSignal({
        signalId: payload.signal_id || null,
        createdAt: payload.created_at || now,
        event: payload.event || null,
        strategyId: pickDropStrategyId(payload),
        updatedBy: "webhook_drop_signal_confirm",
      })
    );
  if (confirmations.length) {
    await Promise.allSettled(confirmations);
  }
  const alerts = normalizedDrops.map((d) =>
    sendSignalDroppedAlert({
      exchange: d.exchange,
      symbol: d.symbol_or_pair_id,
      tf: d.tf,
      event: d.event,
      side: d.side,
      qtyPct: d.qty_pct,
      reason: d.reason,
      dropReasonCode: d.drop_reason_code,
      signalId: d.signal_id,
      executionMode: d.execution_mode,
    })
  );
  await Promise.allSettled(alerts);
  return { ok: true, written: writes.length };
}

module.exports = {
  recordSignalDrops,
  __test: {
    pickDropStrategyId,
    shouldConfirmSelfEvolutionFromDrop,
  },
};
