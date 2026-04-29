"use strict";

// 2026-04-29 P1-1.20 — twentieth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Six same-direction trail-profit cooldown helpers historically
// inline at paperBinanceRunner.js lines 3557-3683:
//
//   resolveSameDirectionTrailProfitCooldownConfig
//                       sysCfg → { enabled, cooldownMs }
//                       (default 4h cooldown when enabled)
//   buildSameDirectionTrailProfitCooldownMetaPatch
//                       fill event + realized pnl → meta patch
//                       capturing the trail-profit exit so the
//                       next same-direction entry can be blocked
//   buildSameDirectionTrailProfitObservationPayload
//                       meta patch → observation payload (the
//                       projection used by the live snapshot
//                       writer)
//   buildSameDirectionTrailProfitLegacyResetMetaPatch
//                       null-out all five same_direction_*
//                       meta fields (used when an opposite-
//                       direction transition is forced)
//   resolveSameDirectionTrailProfitCooldownBlock
//                       cfg + posMeta + intentDir + nowMs →
//                       cooldown block reason if same-direction
//                       re-entry is still inside the window;
//                       null if cleared
//   resolveSameDirectionTrailProfitCooldownSnapshot
//                       posMeta + observation merge → resolved
//                       meta after picking newer-of-the-two
//
// Pure functions: object-property reads + arithmetic + side
// normalization. Self-contained call graph (none of the six
// directly call each other; the meta-patch / observation /
// snapshot triplet bracket the same data shape from different
// directions).
//
// Why this group is the next safe cohesive unit after P1-1.19:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — all six together implement the entire "after a
//     winning trail-profit exit, block same-side re-entries for
//     N ms" policy. Co-locating in a named module makes the
//     policy auditable at one read.
//   - Already covered by
//     src/tests/same-direction-profit-trail-cooldown.test.js
//     (lines 8-30+) via the runner's __test surface — that
//     integration test continues to pass unchanged because the
//     runner re-exports the SAME function references (no fork).
//   - The observation-vs-meta merge in
//     resolveSameDirectionTrailProfitCooldownSnapshot picks the
//     newer exit_wall_ms — a pre-existing race-prevention
//     contract: if both meta (Firestore) and observation
//     (snapshot writer) carry a record, the one with the larger
//     wall-time wins. Pinning that in tests so a future
//     simplification can't regress.

const { normalizePositionSide } = require("./positionSide");

// Local primitive coercers — identical semantics to the runner's
// normalizeBool / normalizeInt. Inlined so this module stays a
// leaf with no internal-engine dependencies. Same pattern as
// P1-1.2 (qtyCalculation), P1-1.8 (signalTypeNormalization),
// P1-1.14 (signalFeaturePickers), P1-1.16 (oppositeCooldownWindow).
function normalizeBoolLocal(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}
function normalizeIntLocal(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

// resolveSameDirectionTrailProfitCooldownConfig — operator config
// surface. Returns { enabled, cooldownMs } with sane defaults
// (disabled by default; 4h cooldown when enabled).
function resolveSameDirectionTrailProfitCooldownConfig(sysCfg = {}) {
  const enabled = normalizeBoolLocal(sysCfg.same_direction_trail_profit_cooldown_enabled, false);
  const cooldownMsRaw = normalizeIntLocal(sysCfg.same_direction_trail_profit_cooldown_ms, 4 * 60 * 60 * 1000);
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, cooldownMsRaw) : (4 * 60 * 60 * 1000);
  return {
    enabled,
    cooldownMs,
  };
}

// buildSameDirectionTrailProfitCooldownMetaPatch — capture the
// exit details so the next same-direction entry can compare
// against them. Only fires for EXIT_TRAIL* events with positive
// realized pnl (we only care about WINNING trail-profit exits;
// losing trail exits are the regular trail-stop loss path and
// don't impose a same-direction cooldown).
function buildSameDirectionTrailProfitCooldownMetaPatch({
  event,
  realizedPnlQuote,
  positionSide,
  exitWallMs,
  source = "INTENT_FILL",
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const pnl = Number(realizedPnlQuote);
  const dir = normalizePositionSide(positionSide);
  const refMs = Number(exitWallMs);
  if (!ev.startsWith("EXIT_TRAIL")) return null;
  if (!Number.isFinite(pnl) || pnl <= 0) return null;
  if (!dir || !Number.isFinite(refMs) || refMs <= 0) return null;
  return {
    same_direction_trail_profit_exit_dir: dir,
    same_direction_trail_profit_exit_wall_ms: refMs,
    same_direction_trail_profit_exit_event: ev,
    same_direction_trail_profit_exit_realized_pnl: pnl,
    same_direction_trail_profit_exit_source: String(source || "INTENT_FILL").trim().slice(0, 80) || "INTENT_FILL",
  };
}

// buildSameDirectionTrailProfitObservationPayload — flat shape
// the live snapshot writer emits to the observation projection
// (separate Firestore doc that lifecycle-watches the runtime).
function buildSameDirectionTrailProfitObservationPayload(metaPatch = null) {
  const patch = (metaPatch && typeof metaPatch === "object") ? metaPatch : {};
  const exitDir = normalizePositionSide(patch.same_direction_trail_profit_exit_dir);
  const exitWallMs = Number(patch.same_direction_trail_profit_exit_wall_ms);
  const exitEvent = String(patch.same_direction_trail_profit_exit_event || "").trim().toUpperCase() || null;
  const realizedPnl = Number(patch.same_direction_trail_profit_exit_realized_pnl);
  const source = String(patch.same_direction_trail_profit_exit_source || "").trim().toUpperCase() || null;
  if (!exitDir || !Number.isFinite(exitWallMs) || exitWallMs <= 0 || !exitEvent) return null;
  return {
    exit_dir: exitDir,
    exit_wall_ms: exitWallMs,
    exit_event: exitEvent,
    realized_pnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
    source,
  };
}

// buildSameDirectionTrailProfitLegacyResetMetaPatch — null-out
// all five same_direction_* fields. Used when an opposite-
// direction transition forces us to clear the prior same-side
// cooldown record (the operator switched directions; the prior
// long-trail-profit cooldown no longer applies).
function buildSameDirectionTrailProfitLegacyResetMetaPatch() {
  return {
    same_direction_trail_profit_exit_dir: null,
    same_direction_trail_profit_exit_wall_ms: null,
    same_direction_trail_profit_exit_event: null,
    same_direction_trail_profit_exit_realized_pnl: null,
    same_direction_trail_profit_exit_source: null,
  };
}

// resolveSameDirectionTrailProfitCooldownBlock — evaluate whether
// to block the next entry. Returns the block-reason payload (so
// callers can log it) or null if the gate is open. Pre-existing
// constraints:
//   - cfg.enabled must be true
//   - cfg.cooldownMs must be finite and > 0
//   - intentDir must equal exit_dir (same direction)
//   - eventRefMs must be ≥ exit_wall_ms (no time-travel)
//   - elapsed must be < cooldownMs (still inside the window)
function resolveSameDirectionTrailProfitCooldownBlock({
  cfg,
  posMeta,
  intentDir,
  eventRefMs,
} = {}) {
  const cooldownCfg = (cfg && typeof cfg === "object") ? cfg : {};
  if (cooldownCfg.enabled !== true) return null;
  const cooldownMs = Number(cooldownCfg.cooldownMs);
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return null;
  const nextDir = normalizePositionSide(intentDir);
  const exitDir = normalizePositionSide(posMeta && posMeta.same_direction_trail_profit_exit_dir);
  const exitWallMs = Number(posMeta && posMeta.same_direction_trail_profit_exit_wall_ms);
  const refMs = Number(eventRefMs);
  if (!nextDir || !exitDir || nextDir !== exitDir) return null;
  if (!Number.isFinite(exitWallMs) || !Number.isFinite(refMs) || refMs < exitWallMs) return null;
  const elapsedMs = refMs - exitWallMs;
  if (elapsedMs < 0 || elapsedMs >= cooldownMs) return null;
  return {
    exit_dir: exitDir,
    exit_wall_ms: exitWallMs,
    exit_event: String(posMeta && posMeta.same_direction_trail_profit_exit_event || "").trim().toUpperCase() || null,
    realized_pnl: Number.isFinite(Number(posMeta && posMeta.same_direction_trail_profit_exit_realized_pnl))
      ? Number(posMeta.same_direction_trail_profit_exit_realized_pnl)
      : null,
    elapsed_ms: elapsedMs,
    cooldown_ms: cooldownMs,
    source: String(posMeta && posMeta.same_direction_trail_profit_exit_source || "").trim().toUpperCase() || null,
  };
}

// resolveSameDirectionTrailProfitCooldownSnapshot — merge
// posMeta (Firestore) with observation (snapshot writer),
// preferring the newer exit_wall_ms. This is the race-prevention
// path: if both stores carry a record, the one with the larger
// wall-time wins. observationOnly=true is used by callers that
// want to read the observation as-if it were the canonical
// posMeta (e.g. cross-doc consistency checks).
function resolveSameDirectionTrailProfitCooldownSnapshot({
  posMeta = null,
  observation = null,
  observationOnly = false,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const observed = (observation && typeof observation === "object" && observation.same_direction_trail_profit && typeof observation.same_direction_trail_profit === "object")
    ? observation.same_direction_trail_profit
    : {};
  if (observationOnly === true) {
    if (!Number.isFinite(Number(observed.exit_wall_ms))) return {};
    return {
      same_direction_trail_profit_exit_dir: observed.exit_dir || null,
      same_direction_trail_profit_exit_wall_ms: Number(observed.exit_wall_ms),
      same_direction_trail_profit_exit_event: observed.exit_event || null,
      same_direction_trail_profit_exit_realized_pnl: Number.isFinite(Number(observed.realized_pnl))
        ? Number(observed.realized_pnl)
        : null,
      same_direction_trail_profit_exit_source: observed.source || null,
    };
  }
  const metaExitWallMs = Number(metaSafe.same_direction_trail_profit_exit_wall_ms);
  const obsExitWallMs = Number(observed.exit_wall_ms);
  const useObserved = Number.isFinite(obsExitWallMs)
    && (!Number.isFinite(metaExitWallMs) || obsExitWallMs > metaExitWallMs);
  if (!useObserved) return metaSafe;
  return {
    ...metaSafe,
    same_direction_trail_profit_exit_dir: observed.exit_dir || null,
    same_direction_trail_profit_exit_wall_ms: obsExitWallMs,
    same_direction_trail_profit_exit_event: observed.exit_event || null,
    same_direction_trail_profit_exit_realized_pnl: Number.isFinite(Number(observed.realized_pnl))
      ? Number(observed.realized_pnl)
      : null,
    same_direction_trail_profit_exit_source: observed.source || null,
  };
}

module.exports = {
  resolveSameDirectionTrailProfitCooldownConfig,
  buildSameDirectionTrailProfitCooldownMetaPatch,
  buildSameDirectionTrailProfitObservationPayload,
  buildSameDirectionTrailProfitLegacyResetMetaPatch,
  resolveSameDirectionTrailProfitCooldownBlock,
  resolveSameDirectionTrailProfitCooldownSnapshot,
};
