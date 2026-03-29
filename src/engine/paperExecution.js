// src/engine/paperExecution.js

function bpsToRate(bps) {
  const n = Number(bps);
  return Number.isFinite(n) ? n / 10000.0 : 0.0;
}

function computeFillPrice({ side, nextOpen, slippageBps }) {
  const s = bpsToRate(slippageBps);
  if (side === "BUY") return nextOpen * (1 + s);
  return nextOpen * (1 - s);
}

function computeFeeValue({ notional, feeBps }) {
  const f = bpsToRate(feeBps);
  return notional * f;
}

module.exports = { computeFillPrice, computeFeeValue };
