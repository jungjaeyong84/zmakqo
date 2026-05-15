"use strict";

// Compatibility shim for the post-cleanup local dashboard/runtime.
// The original module was removed with the legacy V2 execution stack,
// but several read-model and view helpers still depend on its contract.

const DEFAULT_TP1_TARGET_PCT = 0.025;
const DEFAULT_TP1_QTY_RATIO = 1;
const DEFAULT_TRAIL_PCT = 0.01;
const DEFAULT_FLOOR_LOCK_PCT = 0.003;

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toBoolFlag(value) {
  if (value === true || value === false) return value;
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return null;
}

function resolveExecutionMode(snapshot = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  const text = String(
    source.execution_mode
    || source.executionMode
    || meta.execution_mode
    || meta.executionMode
    || ""
  ).trim().toUpperCase();
  return text || null;
}

function resolveSimplifiedExitV2FlagFromSnapshot(snapshot = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};

  const explicit = toBoolFlag(source.simplified_exit_v2_enabled ?? source.simplifiedExitV2Enabled);
  if (explicit !== null) return explicit;

  const explicitMeta = toBoolFlag(meta.simplified_exit_v2_enabled ?? meta.simplifiedExitV2Enabled);
  if (explicitMeta !== null) return explicitMeta;

  const fullTpQty = toNum(
    source.TP_P1_QTY
    ?? source.tp1_qty_ratio
    ?? meta.TP_P1_QTY
    ?? meta.tp1_qty_ratio
    ?? meta.native_protection_tp_qty_ratio
  );
  if (fullTpQty !== null) return fullTpQty >= 0.999999;

  return null;
}

function isSimplifiedExitV2Active(snapshot = null) {
  const explicit = resolveSimplifiedExitV2FlagFromSnapshot(snapshot);
  if (explicit !== null) return explicit;
  const mode = resolveExecutionMode(snapshot);
  return mode === "LIVE" || mode === "LIVE_DRY_RUN" || mode === "PAPER";
}

function requireSimplifiedExitV2Flag(snapshot = null) {
  if (isSimplifiedExitV2Active(snapshot)) return true;
  throw new Error("SIMPLIFIED_EXIT_V2_DISABLED");
}

function assertSimplifiedExitV2EnabledForLiveRuntime(snapshot = null) {
  const mode = resolveExecutionMode(snapshot);
  if (mode === "LIVE" || mode === "LIVE_DRY_RUN" || mode === "PAPER") {
    if (!isSimplifiedExitV2Active(snapshot)) {
      throw new Error("SIMPLIFIED_EXIT_V2_REQUIRED_FOR_RUNTIME");
    }
  }
  return true;
}

function stampEntryMetaWithSimplifiedExitV2Policy(meta = {}) {
  return {
    ...(meta && typeof meta === "object" ? meta : {}),
    simplified_exit_v2_enabled: true,
    simplifiedExitV2Enabled: true,
    TP_P1_QTY: DEFAULT_TP1_QTY_RATIO,
    TP_P1: DEFAULT_TP1_TARGET_PCT,
    TRAIL_PCT: DEFAULT_TRAIL_PCT,
  };
}

function buildSimplifiedExitShadowView(snapshot = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : source;
  const entryQtyAbs = toNum(meta.entry_qty_base ?? meta.entry_qty_abs ?? source.entry_qty_base ?? source.qty_base);
  const tpP1Done = meta.tp_p1_done === true || source.tp_p1_done === true;
  const trailActive = meta.trail_active === true || source.trail_active === true;
  const floorStop = toNum(meta.runner_floor_stop ?? source.runner_floor_stop);
  const trailStop = toNum(meta.trail_stop_by_r ?? meta.trail_stop ?? source.trail_stop_by_r ?? source.trail_stop);
  const finalStop = toNum(meta.chosen_stop_price ?? source.chosen_stop_price ?? trailStop ?? floorStop);
  const chosenSource = String(meta.chosen_stop_source || source.chosen_stop_source || (trailActive ? "TRAIL" : "FLOOR")).trim().toUpperCase() || null;
  return {
    available: isSimplifiedExitV2Active(snapshot),
    economic_state: trailActive ? "RUNNER" : (tpP1Done ? "POST_TP1" : "PRE_TP1"),
    entry_qty_abs: entryQtyAbs,
    tp_p1_done: tpP1Done,
    trail_active: trailActive,
    runner_floor_stop: floorStop,
    trail_stop: trailStop,
    final_effective_stop: finalStop,
    chosen_stop_source: chosenSource,
    divergence_codes: Array.isArray(meta.simplified_exit_v2_divergence_codes)
      ? meta.simplified_exit_v2_divergence_codes
      : [],
  };
}

module.exports = Object.freeze({
  DEFAULT_TP1_TARGET_PCT,
  DEFAULT_TP1_QTY_RATIO,
  DEFAULT_TRAIL_PCT,
  DEFAULT_FLOOR_LOCK_PCT,
  resolveExecutionMode,
  resolveSimplifiedExitV2FlagFromSnapshot,
  isSimplifiedExitV2Active,
  requireSimplifiedExitV2Flag,
  assertSimplifiedExitV2EnabledForLiveRuntime,
  stampEntryMetaWithSimplifiedExitV2Policy,
  buildSimplifiedExitShadowView,
});
