"use strict";

// 2026-04-29 Stage U-followup-1 (option A) — V2 direct exit dispatch
// helper.
//
// Background: under DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 (Stage T/U-1
// active) the V1 fast-lane runPaperMarket call is bypassed. Real exits
// remain on the broker-side native STOP_MARKET, which is robust until
// `refreshBinanceTickExitNativeProtection` fails (e.g. EGRESS_PROXY_TIMEOUT
// on the cancel-then-place path). When that refresh fails the system has
// no automated exit channel and a stale stop can leave a position
// exposed past TP1/SL/TRAIL trigger.
//
// This helper turns the fast-lane trigger detection into a direct
// `placeFuturesMarketOrder({reduceOnly:true})` payload. It is *pure*:
// given the triggered kinds, position side, qty, etc., it returns
// either { dispatch:true, ... } describing the order to send or
// { dispatch:false, reason } explaining why no order is needed. The
// caller (binanceTickExit fast-lane skip branch) is responsible for
// the actual exchange call.
//
// Safety contract:
//   - Only fires when at least one trigger is hit.
//   - reduceOnly:true so over-close is impossible (Binance dedup if
//     qty > position).
//   - Idempotency key includes runId + sorted kinds so retries inside
//     the same fast-lane cycle dedup.
//   - Returns { dispatch:false } on any input invariant violation
//     (caller logs and continues).
//   - Never throws.

function trim(s) {
  if (s === null || s === undefined) return "";
  return String(s).trim();
}

function upper(s) {
  return trim(s).toUpperCase();
}

function isFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n);
}

// Round qty down to the exchange step size. Step <= 0 disables rounding.
function roundQtyToStep(qty, stepSize) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const step = Number(stepSize);
  if (!Number.isFinite(step) || step <= 0) return n;
  // Floor to the nearest step. Use integer math to avoid float drift.
  const ratio = Math.floor(n / step);
  const out = ratio * step;
  // Trim float drift to 12 sig digits.
  return Math.round(out * 1e12) / 1e12;
}

// Decide which fraction of the position to close given the triggered
// kinds. V2 simplified exit is full TP only: SL/TRAIL/TP_P1/TP_C all close
// the full remaining position.
// BE is intentionally NOT actionable here. BE is a native STOP management
// layer after TP1, not a direct reduceOnly MARKET close signal. Keeping BE
// non-actionable prevents "TP1 reached -> BE direct dispatch -> full runner
// close" on normal post-TP1 noise or immediate-trigger protection refreshes.
// If BE is observed together with SL/TRAIL, the real hard trigger still wins.
function resolveCloseFraction(triggeredKinds = []) {
  const set = new Set(
    Array.isArray(triggeredKinds)
      ? triggeredKinds.map((k) => upper(k)).filter(Boolean)
      : []
  );
  const isFullCloseTrigger = set.has("SL") || set.has("TRAIL");
  const isPartialCloseTrigger = set.has("TP_P1") || set.has("TP_C");
  if (isFullCloseTrigger) return { fraction: 1.0, reason: "FULL_CLOSE_SL_OR_TRAIL" };
  if (isPartialCloseTrigger) return { fraction: 1.0, reason: "FULL_CLOSE_TP1" };
  if (set.has("BE")) return { fraction: 0, reason: "BE_NATIVE_STOP_MANAGEMENT_ONLY" };
  return { fraction: 0, reason: "NO_ACTIONABLE_TRIGGER" };
}

function resolveCloseSide(positionSide) {
  const side = upper(positionSide);
  if (side === "LONG") return "SELL";
  if (side === "SHORT") return "BUY";
  return null;
}

function buildIdempotencyKey({ symbol, runId, triggeredKinds }) {
  const sym = upper(symbol) || "UNKNOWN";
  const run = trim(runId) || `run_${Date.now()}`;
  const kinds = Array.isArray(triggeredKinds)
    ? Array.from(new Set(triggeredKinds.map((k) => upper(k)).filter(Boolean))).sort().join("_")
    : "";
  return `tickExitV2__${sym}__${run}__${kinds || "NA"}`;
}

function buildV2DirectExitDispatch({
  triggeredKinds = [],
  positionSide = null,
  positionQtyBase = null,
  symbol = null,
  runId = null,
  stepSize = null,
  minQty = null,
  minQtyDustFraction = 0.001,
} = {}) {
  // Inputs.
  const sym = upper(symbol);
  if (!sym) return { dispatch: false, reason: "SYMBOL_REQUIRED" };
  const closeSide = resolveCloseSide(positionSide);
  if (!closeSide) return { dispatch: false, reason: "POSITION_SIDE_INVALID" };
  if (!isFiniteNumber(positionQtyBase) || Number(positionQtyBase) <= 0) {
    return { dispatch: false, reason: "POSITION_QTY_INVALID" };
  }
  // Trigger.
  const { fraction, reason: triggerReason } = resolveCloseFraction(triggeredKinds);
  if (fraction <= 0) return { dispatch: false, reason: triggerReason };

  // Quantity.
  const rawQty = Number(positionQtyBase) * fraction;
  const qty = roundQtyToStep(rawQty, stepSize);
  if (!(qty > 0)) return { dispatch: false, reason: "QTY_AFTER_ROUNDING_ZERO" };

  // Optional: bail when the rounded qty falls below the symbol's minQty
  // threshold AND the residual fraction is dust. This prevents a partial
  // close that the exchange would reject and that would otherwise loop
  // forever in the fast-lane.
  if (isFiniteNumber(minQty) && Number(minQty) > 0 && qty < Number(minQty)) {
    const dustRatio = qty / Number(positionQtyBase);
    if (dustRatio < minQtyDustFraction) return { dispatch: false, reason: "QTY_BELOW_MIN_QTY_DUST" };
  }

  return Object.freeze({
    dispatch: true,
    symbol: sym,
    closeSide,
    fraction,
    qty,
    triggeredKinds: Array.from(new Set(
      (Array.isArray(triggeredKinds) ? triggeredKinds : []).map((k) => upper(k)).filter(Boolean)
    )).sort(),
    triggerReason,
    idempotencyKey: buildIdempotencyKey({ symbol: sym, runId, triggeredKinds }),
  });
}

module.exports = {
  buildV2DirectExitDispatch,
  __test: {
    roundQtyToStep,
    resolveCloseFraction,
    resolveCloseSide,
    buildIdempotencyKey,
  },
};
