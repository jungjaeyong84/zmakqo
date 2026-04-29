"use strict";

// 2026-04-29 P1-1.16 — sixteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Three opposite-direction cooldown-window resolvers:
//
//   resolveCooldownProfileFromMeta              posMeta → "RESCUE"|
//                                               "MIXED"|"BASE"
//   resolveOppositeCooldownWindow               sysCfg + posMeta →
//                                               { cohort, profile,
//                                                 bars, timeMs }
//   resolveOppositeCooldownWindowFromPosition   thin wrapper that
//                                               unwraps position.meta
//                                               and delegates
//
// Pure functions: object-property reads + integer coercion. The
// runner used to host them inline at lines 650, 660, 691.
//
// Why this group is the next safe cohesive unit after P1-1.15:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — all three answer "how long should we cool-down
//     before allowing an opposite-direction re-entry on this
//     position?"
//   - Self-contained call graph: resolveOppositeCooldownWindow →
//     resolveCooldownProfileFromMeta + normalizeOpenClawCohort
//     (already extracted in P1-1.10) + local normalizeInt;
//     resolveOppositeCooldownWindowFromPosition →
//     resolveOppositeCooldownWindow.
//   - Already covered by
//     src/tests/opposite-transition-immediate-reentry.test.js
//     (lines 11-12, 77-145) via the runner's __test surface.
//     That integration test continues to pass unchanged because
//     the runner re-exports the SAME function references (no fork).
//   - The cohort → profile → cooldown-bars mapping is a pre-
//     existing operator-facing contract: RESCUE → 0/0 (immediate
//     re-entry allowed), MIXED → 1 bar / 60s, BASE → 3 bars / 300s
//     (sysCfg-overridable). Pinning that contract in a named
//     module makes the cohort-aware risk policy auditable at one
//     read.

const { normalizeOpenClawCohort } = require("./openClawCohort");

// Local normalizeInt — identical semantics to the runner's
// normalizeInt (~6443). Inlined rather than imported so this
// module stays a leaf with no internal-engine dependencies.
function normalizeIntLocal(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// resolveCooldownProfileFromMeta — collapse posMeta cohort into
// the three-state cooldown profile. KEEP_DROP / HOLD_SAMPLE /
// null cohorts collapse to "BASE" (the conservative default).
function resolveCooldownProfileFromMeta(posMeta = null) {
  const metaSafe = posMeta && typeof posMeta === "object" ? posMeta : {};
  const cohort = normalizeOpenClawCohort(
    metaSafe.openclaw_market_regime_cohort || metaSafe.market_regime_cohort
  );
  if (cohort === "RESCUE") return "RESCUE";
  if (cohort === "MIXED") return "MIXED";
  return "BASE";
}

// resolveOppositeCooldownWindow — the cohort-aware cooldown policy.
// Returns { cohort, profile, bars, timeMs }. RESCUE allows
// immediate re-entry (defaults 0 bars / 0 ms — operator can
// raise via sysCfg). MIXED uses moderate defaults (1 bar /
// 60 000 ms). BASE uses conservative defaults (3 bars /
// 300 000 ms). All four cooldown values are sysCfg-overridable
// via opposite_signal_cooldown_bars[_rescue|_mixed] and
// opposite_time_cooldown_ms[_rescue|_mixed]; the function clamps
// each at zero so a negative configuration value cannot
// accidentally turn the cooldown into a forward window.
function resolveOppositeCooldownWindow({ sysCfg = {}, posMeta = null } = {}) {
  const cohort = normalizeOpenClawCohort(
    posMeta && (posMeta.openclaw_market_regime_cohort || posMeta.market_regime_cohort)
  );
  const profile = resolveCooldownProfileFromMeta(posMeta);
  const defaultBars = Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_signal_cooldown_bars, 3));
  const defaultMs = Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_time_cooldown_ms, 300000));
  if (profile === "RESCUE") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_signal_cooldown_bars_rescue, 0)),
      timeMs: Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_time_cooldown_ms_rescue, 0)),
    };
  }
  if (profile === "MIXED") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_signal_cooldown_bars_mixed, 1)),
      timeMs: Math.max(0, normalizeIntLocal(sysCfg && sysCfg.opposite_time_cooldown_ms_mixed, 60000)),
    };
  }
  return {
    cohort: cohort || "BASE",
    profile: "BASE",
    bars: defaultBars,
    timeMs: defaultMs,
  };
}

// resolveOppositeCooldownWindowFromPosition — convenience wrapper
// for callers that have a position row in hand and don't want
// to pluck the meta themselves.
function resolveOppositeCooldownWindowFromPosition({ sysCfg = {}, position = null } = {}) {
  const posMeta = (position && typeof position.meta === "object") ? position.meta : null;
  return resolveOppositeCooldownWindow({ sysCfg, posMeta });
}

module.exports = {
  resolveCooldownProfileFromMeta,
  resolveOppositeCooldownWindow,
  resolveOppositeCooldownWindowFromPosition,
};
