"use strict";

// 2026-04-20 senior-audit L1: single source of truth for unprotected-window
// math shared between the write-side and read-side.
//
// Before this module existed:
//   - write side: `resolveNativeProtectionUnprotectedWindowFields` in
//     `src/engine/paperBinanceRunner.js` computed `window_ms = max(stop_ack,
//     tp_ack) - cancel` at meta-stamp time.
//   - read side: `classifyUnprotectedWindowRecord` in
//     `src/services/nativeProtectionUnprotectedWindowRuntime.js` re-computed
//     `window_ms` from the stamped fields when the stamped value was
//     missing, using the *same* max-of-acks rule.
//
// Two copies of the same arithmetic diverge over time — one side might
// later switch to "min-of-acks" (partial protection = partially closed
// window) or clamp negative values, and the other wouldn't. Both sides
// now delegate the arithmetic here so the contract is byte-for-byte
// identical at the math level.
//
// Contract (both sides):
//   toPositiveMs(x)        → finite > 0 number or null (rejects 0)
//   latestAckMs(stop, tp)  → max of the two non-null values, or null
//   windowMs(cancel, acks) → latestAck - cancel if both present and
//                            latestAck >= cancel, else null

function toPositiveMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function latestAckMs(stopAckMs, tpAckMs) {
  const s = toPositiveMs(stopAckMs);
  const t = toPositiveMs(tpAckMs);
  if (s == null && t == null) return null;
  if (s == null) return t;
  if (t == null) return s;
  return Math.max(s, t);
}

// computeWindowMs: given the three raw timestamp inputs, return the
// unprotected-window duration in ms, or null if it cannot be computed.
//
// We return null (not 0 or -1) for the "cannot compute" case so callers
// can tell "the refresh was instantaneous" (0) from "we never saw an
// ack" (null) from "negative clock skew" (rejected → null). A negative
// would-be window indicates an ack timestamp that predates the cancel
// timestamp, which is clock-skew or a source bug; we refuse to emit it.
function computeWindowMs({ cancelMs, stopAckMs, tpAckMs } = {}) {
  const cancel = toPositiveMs(cancelMs);
  if (cancel == null) return null;
  const latest = latestAckMs(stopAckMs, tpAckMs);
  if (latest == null) return null;
  return latest >= cancel ? latest - cancel : null;
}

module.exports = {
  toPositiveMs,
  latestAckMs,
  computeWindowMs,
};
