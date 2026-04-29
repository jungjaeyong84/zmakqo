"use strict";

// 2026-04-29 P1-1.1 — first stateless-helper extraction from
// src/engine/paperBinanceRunner.js (20 704 lines).
//
// Three TF/bar-count utilities historically lived inline in
// paperBinanceRunner alongside V1 entry/exit logic. They are pure
// — no side effects, no state, no module-level cache, no async —
// and several callers outside paperBinanceRunner already need them
// (the V2 server-native signal generator, the discovery-canary
// bridge, the runner-floor trail logic). Moving them here makes
// the dependency direction sane: utilities at the bottom, business
// logic on top.
//
// `paperBinanceRunner.js` re-exports the same names through its
// `__test` surface and module.exports so existing test files and
// external callers keep working unchanged. This commit is a
// surgical seam — no behaviour change. Future P1-1.x sub-steps
// will continue extracting in small, audit-able chunks until the
// file is small enough to split into marketRunner / orderManager /
// positionStateMachine.

const { tfToMs } = require("./marketConfig");

function normalizeIntLocal(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// resolveTfFromMs — given a tf-in-milliseconds, return the human TF
// label ("15m" / "30m" / "60m") that produced it. Returns null for
// any TF the rest of the codebase doesn't accept on the entry path.
function resolveTfFromMs(ms) {
  const tfNum = Number(ms);
  if (!Number.isFinite(tfNum) || tfNum <= 0) return null;
  const known = ["15m", "30m", "60m"];
  for (const tf of known) {
    if (tfToMs(tf) === tfNum) return tf;
  }
  return null;
}

// scaleBaseBarCountByTf — convert a 60m-anchored bar count to the
// equivalent count on `signalTfMs`. The strategy was originally
// authored against a 60m baseline (e.g. "max hold 12 bars" meant
// 12 × 60m = 12 hours), so when a market runs on 15m we need 4×
// as many bars to cover the same wall-clock window. Returns the
// rounded scaled count, never below 1.
function scaleBaseBarCountByTf(baseBars, signalTfMs) {
  const base = normalizeIntLocal(baseBars, 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(signalTfMs) || signalTfMs <= 0) return base;
  const tf60mMs = 60 * 60 * 1000;
  const scaled = Math.round(base * (tf60mMs / signalTfMs));
  return Math.max(1, scaled);
}

// resolveBinanceMaxHoldBars — operator-tunable max hold bars (env
// BINANCE_MAX_HOLD_BARS, default 12 on the 60m anchor). Always
// returned scaled into the caller's signalTfMs so downstream
// consumers don't re-scale.
function resolveBinanceMaxHoldBars(sysCfg, signalTfMs) {
  const envDefault = normalizeIntLocal(process.env.BINANCE_MAX_HOLD_BARS, 12);
  const fallback = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : 12;
  const configured = Math.max(0, normalizeIntLocal(sysCfg && sysCfg.max_hold_bars, fallback));
  return scaleBaseBarCountByTf(configured, signalTfMs);
}

module.exports = {
  resolveTfFromMs,
  scaleBaseBarCountByTf,
  resolveBinanceMaxHoldBars,
};
