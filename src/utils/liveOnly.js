const { BINANCE_ONLY_PROVIDER } = require("./providerUtils");

function normalizeExchangeId() {
  return BINANCE_ONLY_PROVIDER;
}

function resolveExecutionMode(doc) {
  if (!doc || typeof doc !== "object") return null;
  if (doc.execution_mode) return doc.execution_mode;
  if (doc.meta && doc.meta.execution_mode) return doc.meta.execution_mode;
  return null;
}

function isLiveDocForExchange(_exchange, doc) {
  const mode = String(resolveExecutionMode(doc) || "").toUpperCase();
  if (mode === "LIVE" || mode === "LIVE_DRY_RUN") return true;
  if (!mode && doc && doc.live_order_id) return true;
  return false;
}

module.exports = { normalizeExchangeId, resolveExecutionMode, isLiveDocForExchange };
