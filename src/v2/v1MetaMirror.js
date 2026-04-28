"use strict";

// 2026-04-28 Stage S — V2→V1 positions_paper.meta mirror.
//
// Background: the V2 entry route (productionEntryRoute.js +
// openclawShadowPositionWriter.writeOpenClawShadowEntryBootstrap) writes
// only to V2 collections (signal_intents_v2, openclaw_decisions_v2,
// position_cycles_v2, exit_runtime_projection_v2,
// protection_runtime_v2). The V1 read path (paperBinanceRunner +
// binanceTickExit + dashboards) reads `positions_paper.meta` and
// expects fields such as:
//   - entry_event_id        — required by tickExit / fill matching
//   - entry_r_distance      — required by trail R-multiple math
//   - initial_stop_price    — required by BE-raise / trail floor
//   - tp_p1_target_price    — populated at TP1 fill, but the target
//                             price for pre-TP1 trail logic falls back
//                             to leverage-normalized defaults; mirror
//                             from V2 plan when available
//   - native_protection_*   — required by tickExit fast-lane verifier
//
// Without a mirror, V2 entries make these fields invisible to V1 until
// `binanceFuturesFillsSync` reconstructs the basic position (size,
// avg_price) via exchange poll — which never recovers the extended
// meta fields.
//
// Cutover impact: at canary_only=1, V2 entries are too rare for the gap
// to surface. At cutover_only=1 (production cutover), every entry is
// V2 and the gap blocks V1-side trail logic on every position.
//
// Safety contract:
//   - Default OFF behind `V2_TO_V1_META_MIRROR_ENABLED`. Operator
//     enables in canary first, observes mirror evidence, then flips
//     production cutover.
//   - Uses `upsertPositionMetaOnly` (META scope) — never disturbs
//     state/sizePct/positionSide. binanceFuturesFillsSync remains the
//     single writer of those fields.
//   - Writes are best-effort: failure logs to structured event but
//     never throws into the V2 entry write path. This guarantees the
//     mirror can only ADD information, never break a V2 entry.
//   - Idempotent: re-runs with the same V2 bootstrap produce the same
//     meta patch → repeated calls are safe.

const { upsertPositionMetaOnly } = require("../storage/positionsPaper");

function parseBoolEnv(name, defaultValue) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const norm = String(raw).trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
}

function isV2ToV1MetaMirrorEnabled(env = process.env) {
  // explicit env override wins over module-level default
  const raw = env && env.V2_TO_V1_META_MIRROR_ENABLED;
  if (raw === undefined || raw === null || raw === "") return false;
  const norm = String(raw).trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
}

// Deterministic shape of the V1 meta patch derived from a V2 entry
// bootstrap. Pure function — no I/O. Used by the live writer below and
// directly exercised by the unit test.
function buildV2ToV1MetaPatch({
  entryEventId = null,
  entryIntentId = null,
  positionCycleId = null,
  positionSide = null,
  entryPrice = null,
  entryQtyAbs = null,
  entryExecBarMs = null,
  initialStopPrice = null,
  entryRDistance = null,
  tp1TargetPct = null,
  nativeStopOrderId = null,
  nativeStopPrice = null,
  nativeTpOrderId = null,
  nativeTpPrice = null,
  nativeTpQtyBase = null,
  nativeTpQtyRatio = null,
  nativeRefreshStatus = null,
  nativeRefreshAtMs = null,
  nativeProtectionUnprotectedWindowMs = null,
} = {}) {
  const trim = (v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length ? s : null;
  };
  const numOrNull = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const upper = (v) => {
    const s = trim(v);
    return s ? s.toUpperCase() : null;
  };

  const entryEvent = trim(entryEventId);
  const sideUpper = upper(positionSide);
  const cycleId = trim(positionCycleId);
  const stopPrice = numOrNull(nativeStopPrice);
  const tpPrice = numOrNull(nativeTpPrice);

  const out = {
    // Stage S provenance — operators can grep this in positions_paper
    // to identify which records were mirrored from V2 vs the V1 native
    // entry path.
    v2_to_v1_mirrored: true,
    v2_to_v1_mirrored_at_ms: Date.now(),
    v2_to_v1_mirrored_position_cycle_id: cycleId,

    // V1 trail / fill matching fields.
    entry_event_id: entryEvent,
    entry_intent_id: trim(entryIntentId),
    position_side: sideUpper,
    entry_price: numOrNull(entryPrice),
    entry_qty_base: numOrNull(entryQtyAbs),
    entry_exec_bar_ms: numOrNull(entryExecBarMs),

    // V2 protection plan provenance (Stage E/G — required by V1 BE/trail
    // logic). When V2 didn't compute these (older bootstraps) they pass
    // through as null, leaving V1 to fall back to leverage-normalized
    // defaults exactly as today.
    initial_stop_price: numOrNull(initialStopPrice),
    entry_r_distance: numOrNull(entryRDistance),
    tp_p1_target_pct: numOrNull(tp1TargetPct),

    // V2 simplified-exit-v2 contract — V1 logic short-circuits TP0
    // reconcile when this flag is true (src/engine/paperBinanceRunner.js
    // resolveSimplifiedExitV2PositionFlag).
    simplified_exit_v2_enabled: true,

    // Native protection mirror — tickExit reads these to verify the
    // exchange-side stops match the V2 plan.
    native_protection_side: sideUpper,
    native_protection_entry_price: numOrNull(entryPrice),
    native_protection_stop_order_id: trim(nativeStopOrderId),
    native_protection_stop_price: stopPrice,
    native_protection_tp_order_id: trim(nativeTpOrderId),
    native_protection_tp_price: tpPrice,
    native_protection_tp_qty_base: numOrNull(nativeTpQtyBase),
    native_protection_tp_qty_ratio: numOrNull(nativeTpQtyRatio),
    native_protection_refresh_status: upper(nativeRefreshStatus) || "OK",
    native_protection_refresh_at_ms: numOrNull(nativeRefreshAtMs) || Date.now(),
    native_protection_unprotected_window_ms: numOrNull(nativeProtectionUnprotectedWindowMs),
    native_protection_stale: false,
    native_protection_refresh_context: "ENTRY",
  };

  return out;
}

// Live writer — gated behind `V2_TO_V1_META_MIRROR_ENABLED`. Returns a
// structured result object; never throws.
async function writeV2ToV1MetaMirror({
  exchange,
  symbol,
  positionCycleId,
  patchInputs,
  env = process.env,
  upsertFn = upsertPositionMetaOnly,
  logFn = (...args) => console.log(...args),
} = {}) {
  if (!isV2ToV1MetaMirrorEnabled(env)) {
    return { ok: true, skipped: true, reason: "V2_TO_V1_META_MIRROR_DISABLED" };
  }
  const exUpper = String(exchange || "").trim().toUpperCase();
  const symUpper = String(symbol || "").trim().toUpperCase();
  if (!exUpper || !symUpper) {
    return { ok: false, skipped: false, reason: "MIRROR_EXCHANGE_OR_SYMBOL_MISSING" };
  }
  const meta = buildV2ToV1MetaPatch({ ...(patchInputs || {}), positionCycleId });
  try {
    await upsertFn({
      exchange: exUpper,
      symbol: symUpper,
      meta,
      mutationKind: "V2_TO_V1_META_MIRROR",
      source: "V2_BOOTSTRAP",
      reason: "V2_TO_V1_META_MIRROR",
      // intentionally don't pass expectedWriteToken — meta-only writes
      // can run without a CAS guard since they never modify state /
      // size / side. The writer-lease protects concurrent writers
      // against each other.
    });
    try {
      logFn(JSON.stringify({
        event: "v2_to_v1_meta_mirror_ok",
        ts: new Date().toISOString(),
        exchange: exUpper,
        symbol: symUpper,
        position_cycle_id: meta.v2_to_v1_mirrored_position_cycle_id,
        entry_event_id: meta.entry_event_id,
      }));
    } catch (_) { /* observability only */ }
    return { ok: true, skipped: false, reason: "V2_TO_V1_META_MIRROR_OK" };
  } catch (err) {
    try {
      logFn(JSON.stringify({
        event: "v2_to_v1_meta_mirror_fail",
        ts: new Date().toISOString(),
        exchange: exUpper,
        symbol: symUpper,
        error: err && err.message ? err.message : String(err),
      }));
    } catch (_) { /* observability only */ }
    return { ok: false, skipped: false, reason: "V2_TO_V1_META_MIRROR_FAIL", error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  isV2ToV1MetaMirrorEnabled,
  buildV2ToV1MetaPatch,
  writeV2ToV1MetaMirror,
  __test: {
    parseBoolEnv,
  },
};
