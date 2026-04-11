// src/storage/gateEvents.js
const { getFirestore } = require("./firestore");

function normalizeExchange(raw) {
  const v = String(raw || "").trim().toUpperCase();
  if (!v) return null;
  if (v.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function normalizeGateEvent(input = {}) {
  const exchange = normalizeExchange(input.exchange);
  const market = input.market ? String(input.market) : null;
  const tf = input.tf ? String(input.tf) : null;
  const barCloseMs = Number.isFinite(Number(input.barCloseMs)) ? Number(input.barCloseMs) : null;
  const status = input.status ? String(input.status).toUpperCase() : null;
  const severity = input.severity ? String(input.severity).toUpperCase() : null;
  const reasonCodes = Array.isArray(input.reasonCodes) ? input.reasonCodes : [];
  const metrics = input.metrics && typeof input.metrics === "object" ? input.metrics : {};
  const runId = input.runId ? String(input.runId) : (metrics.run_id ? String(metrics.run_id) : null);
  return { exchange, market, tf, barCloseMs, status, severity, reasonCodes, metrics, runId };
}

async function upsertGateEvent(payload = {}) {
  const { exchange, market, tf, barCloseMs, status, severity, reasonCodes, metrics, runId } = normalizeGateEvent(payload);
  const now = new Date().toISOString();
  const idParts = [
    exchange || "UNKNOWN",
    market || "UNKNOWN",
    tf || "UNKNOWN",
    Number.isFinite(barCloseMs) ? String(barCloseMs) : "NA",
  ];
  const docId = `GATE__${idParts.join("__")}`;
  const doc = {
    exchange,
    market,
    symbol: market,
    tf,
    bar_close_time_utc_ms: barCloseMs,
    status,
    severity,
    reason_codes: reasonCodes,
    metrics_json: metrics,
    run_id: runId,
    created_at: now,
    updated_at: now,
  };

  try {
    const db = getFirestore();
    await db.collection("gate_events").doc(docId).set(doc, { merge: true });
    return { ok: true, id: docId, event: doc };
  } catch (e) {
    return { ok: false, error: "GATE_EVENT_WRITE_FAILED", message: e?.message || String(e), event: doc };
  }
}

async function getLatestGateEvent() {
  try {
    const db = getFirestore();
    const snap = await db.collection("gate_events").orderBy("created_at", "desc").limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data() || null;
  } catch (e) {
    return null;
  }
}

module.exports = { upsertGateEvent, getLatestGateEvent };
