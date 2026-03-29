// src/storage/cursors.js
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function cursorId({ exchange, symbol, tf }) {
  return `${exchange}__${symbol}__${tf}`;
}

function normalizeCursorArgs(arg) {
  if (typeof arg === "string") {
    const parts = arg.split("__");
    if (parts.length >= 3) {
      const exchange = parts.shift();
      const tf = parts.pop();
      const symbol = parts.join("__");
      return { exchange, symbol, tf, cursor_id: arg };
    }
    return { cursor_id: arg };
  }
  if (arg && typeof arg === "object") return arg;
  return {};
}

async function getBarCursor(arg = {}) {
  const { exchange, symbol, tf, cursor_id } = normalizeCursorArgs(arg);
  const db = getFirestore();
  const id = cursor_id || cursorId({ exchange, symbol, tf });
  const ref = db.collection("processed_cursors").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data();
}

// Backward-compatible aliases (older code expects getCursor/setCursor)
async function getCursor(arg = {}) {
  return getBarCursor(arg);
}

async function setCursor(arg = {}) {
  return setBarCursor(arg);
}

async function setBarCursor({
  exchange,
  symbol,
  tf,
  cursor_id,
  barCloseTimeUtc,
  barCloseTimeUtcMs,
  runId,
} = {}) {
  if (cursor_id) {
    const parsed = normalizeCursorArgs(cursor_id);
    exchange = exchange || parsed.exchange;
    symbol = symbol || parsed.symbol;
    tf = tf || parsed.tf;
  }
  const db = getFirestore();
  const id = cursor_id || cursorId({ exchange, symbol, tf });
  const ref = db.collection("processed_cursors").doc(id);

  const payload = {
    cursor_id: id,
    exchange,
    symbol,
    tf,
    last_processed_bar_close_time_utc: barCloseTimeUtc || null,
    last_processed_bar_close_time_utc_ms: Number(barCloseTimeUtcMs),
    last_processed_run_id: runId || null,
    updated_at: nowIso(),
  };

  await ref.set(payload, { merge: true });
  return payload;
}

module.exports = { getBarCursor, setBarCursor, getCursor, setCursor };

module.exports.getCursor = getCursor;

module.exports.setCursor = setCursor;
