const { normalizeMarketSymbolForProvider, normalizeTf } = require("./marketConfig");
const { normalizeProviderId } = require("./providerUtils");

function isSignalDocId(id) {
  return String(id || "").startsWith("SIG__");
}

function buildSignalDocId({ exchange, symbol, tf, barCloseMs, event } = {}) {
  const ex = normalizeProviderId(exchange || "");
  const symRaw = String(symbol || "").trim();
  const sym = normalizeMarketSymbolForProvider(symRaw, ex) || symRaw;
  const t = normalizeTf(tf || "");
  const ms = Number(barCloseMs);
  const ev = String(event || "").trim();
  if (!ex || !sym || !t || !Number.isFinite(ms) || !ev) return null;
  return `SIG__${ex}__${sym}__${t}__${ms}__${ev}`;
}

function parseLegacySignalId(signalId, exchange) {
  const raw = String(signalId || "").trim();
  if (!raw || isSignalDocId(raw)) return null;
  const parts = raw.split("|");
  if (parts.length < 4) return null;
  const symbolRaw = parts[0];
  const tfRaw = parts[1];
  const p2Num = Number(parts[2]);
  const p3Num = Number(parts[3]);
  const p2IsNum = Number.isFinite(p2Num);
  const p3IsNum = Number.isFinite(p3Num);
  // Support both legacy formats:
  // 1) SYMBOL|TF|BAR_MS|EVENT
  // 2) SYMBOL|TF|EVENT|BAR_MS|DIR|ACTION
  let barMsRaw = null;
  let eventRaw = null;
  if (p2IsNum && !p3IsNum) {
    barMsRaw = p2Num;
    eventRaw = parts[3];
  } else if (!p2IsNum && p3IsNum) {
    barMsRaw = p3Num;
    eventRaw = parts[2];
  } else {
    // Fallback to old parser behavior.
    barMsRaw = p2Num;
    eventRaw = parts[3];
  }
  const barMs = Number.isFinite(barMsRaw) && barMsRaw > 0 && barMsRaw < 1e12
    ? barMsRaw * 1000
    : barMsRaw;
  const event = String(eventRaw || "").trim();
  const ex = normalizeProviderId(exchange || "");
  const symbol = normalizeMarketSymbolForProvider(symbolRaw, ex) || symbolRaw;
  const tf = normalizeTf(tfRaw);
  return {
    symbol,
    tf,
    barCloseMs: Number.isFinite(barMs) ? barMs : null,
    event: /[A-Za-z_]/.test(event) ? event : null,
  };
}

function deriveSignalDocId({ exchange, symbol, tf, barCloseMs, event, signalId } = {}) {
  if (isSignalDocId(signalId)) return String(signalId);
  const parsed = parseLegacySignalId(signalId, exchange) || {};
  const symbolFinal = parsed.symbol || symbol;
  const tfFinal = parsed.tf || tf;
  const barMsFinal = Number.isFinite(parsed.barCloseMs) ? parsed.barCloseMs : barCloseMs;
  const eventFinal = parsed.event || event;
  return buildSignalDocId({
    exchange,
    symbol: symbolFinal,
    tf: tfFinal,
    barCloseMs: barMsFinal,
    event: eventFinal,
  });
}

module.exports = {
  buildSignalDocId,
  deriveSignalDocId,
  isSignalDocId,
  parseLegacySignalId,
};
