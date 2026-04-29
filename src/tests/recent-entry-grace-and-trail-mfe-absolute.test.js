"use strict";

// 2026-04-29 — Two structural fixes from the DOGEUSDT 00:46-00:50 UTC
// chop investigation:
//
// (1) Issue 2 — paperBinanceRunner.repairActivePositionExitRuntimeState
//     must skip its repair dispatch when we're inside the
//     RECENT_ENTRY_GRACE window (≤ 2 minutes from last fill / entry
//     bar / native protection refresh). The previous chop sequence
//     was: entry → native protection not yet placed → invariant
//     "NATIVE_STOP_MISSING" → repair dispatch → trail hard exit →
//     FORCE_EXIT_ALL. The grace skip cuts the chain at step 3.
//
// (2) Issue 3 — signalEngine.resolveTrailDelayState was computing
//     mfeMove as `mfePctRequired / leverageEff`, which on
//     leverage=3 turns the documented "0.5% MFE past TP1 before
//     trail engages" into a 0.167% price move that intra-bar noise
//     covers within the same bar. Treat it as an absolute price
//     percent by default (preserves the leveraged-divided behaviour
//     behind ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED for back-compat).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const paperRunnerSrc = fs.readFileSync(
  path.join(__dirname, "..", "engine", "paperBinanceRunner.js"),
  "utf8"
);
const signalEngineSrc = fs.readFileSync(
  path.join(__dirname, "..", "engine", "signalEngine.js"),
  "utf8"
);

// (A) RECENT_ENTRY_GRACE guard exists and lives at the top of
//     repairActivePositionExitRuntimeState.
(function testRepairGuardStructure() {
  const fnIdx = paperRunnerSrc.indexOf("async function repairActivePositionExitRuntimeState(");
  assert.ok(fnIdx > 0, "(A) repairActivePositionExitRuntimeState not found");
  const window = paperRunnerSrc.slice(fnIdx, fnIdx + 16000);

  assert.ok(
    window.includes("RECENT_ENTRY_GRACE_MS"),
    "(A1) repair function must declare RECENT_ENTRY_GRACE_MS"
  );
  assert.ok(
    /RECENT_ENTRY_GRACE_MS\s*=\s*120_000/.test(window) || /RECENT_ENTRY_GRACE_MS\s*=\s*120000/.test(window),
    "(A2) grace window must be 120000ms (2 minutes)"
  );
  assert.ok(
    window.includes("active_position_exit_runtime_repair_grace_skip"),
    "(A3) grace branch must emit active_position_exit_runtime_repair_grace_skip log"
  );
  // Grace skip must precede the dispatch (return metaSafe before
  // requestBinanceNativeProtectionRefresh)
  const skipIdx = window.indexOf("active_position_exit_runtime_repair_grace_skip");
  const dispatchIdx = window.indexOf("requestBinanceNativeProtectionRefresh");
  assert.ok(skipIdx > 0 && dispatchIdx > 0, "(A4) anchors not found");
  assert.ok(
    skipIdx < dispatchIdx,
    "(A5) grace skip must short-circuit before requestBinanceNativeProtectionRefresh"
  );
})();

// (B) Trail-after-TP1 mfeMove uses absolute pct by default.
(function testTrailMfeAbsoluteMode() {
  const fnIdx = signalEngineSrc.indexOf("function resolveTrailDelayState(");
  assert.ok(fnIdx > 0, "(B) resolveTrailDelayState not found");
  const window = signalEngineSrc.slice(fnIdx, fnIdx + 3000);

  assert.ok(
    window.includes("ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED"),
    "(B1) leverage-divided legacy escape hatch must exist (env var ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED)"
  );
  assert.ok(
    window.includes("mfeAbsoluteMode"),
    "(B2) mfeAbsoluteMode flag must exist"
  );
  // The absolute branch (mfeAbsoluteMode=true) must use mfePctRequired
  // directly, not divided.
  assert.ok(
    /mfeAbsoluteMode[\s\S]*\?\s*mfePctRequired\s*\n/.test(window)
    || window.includes("? mfePctRequired"),
    "(B3) mfeAbsoluteMode true branch must use raw mfePctRequired"
  );
  // The legacy fallback (lev>0) must still divide by lev.
  assert.ok(
    /mfePctRequired\s*\/\s*lev/.test(window),
    "(B4) legacy branch must still divide by leverage when ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED=1"
  );
})();

// (C) Runtime check on resolveTrailDelayState: with absolute mode (the
//     default) and the documented mfePctRequired=0.005, mfeReady stays
//     false until closePx ≥ tp1*1.005, regardless of leverage.
(function testTrailMfeRuntime() {
  const prev = process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED;
  delete process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED; // ensure absolute mode default
  delete require.cache[require.resolve("../engine/signalEngine")];
  const { resolveTrailDelayState } = require("../engine/signalEngine");

  const lev = 3;
  const tp1 = 100;
  // Just above TP1 by 0.167% — would have fired under the old
  // leverage-divided behaviour. Should NOT fire under absolute mode.
  const closeAt0p17 = tp1 * 1.00167;
  const result0p17 = resolveTrailDelayState({
    meta: {
      tp_p1_target_price: tp1,
      tp_p1_bar_ms: 1700000000000,
      entry_exec_tf_ms: 15 * 60 * 1000,
      trail_delay_bars_required: 1,
      trail_delay_mfe_pct_required: 0.005, // 0.5% absolute
    },
    tpP1Done: true,
    currentBarMs: 1700000000000, // same bar as TP1, so barsReady=false
    closePx: closeAt0p17,
    side: "LONG",
    leverageEff: lev,
    rules: null,
  });
  assert.strictEqual(result0p17.mfeReady, false,
    `(C1) mfeReady must be false at +0.167% past TP1 in absolute mode (was: ${result0p17.mfeReady})`);

  // Above TP1 by 0.6% — should fire (≥0.5% absolute).
  const closeAt0p6 = tp1 * 1.006;
  const result0p6 = resolveTrailDelayState({
    meta: {
      tp_p1_target_price: tp1,
      tp_p1_bar_ms: 1700000000000,
      entry_exec_tf_ms: 15 * 60 * 1000,
      trail_delay_bars_required: 1,
      trail_delay_mfe_pct_required: 0.005,
    },
    tpP1Done: true,
    currentBarMs: 1700000000000,
    closePx: closeAt0p6,
    side: "LONG",
    leverageEff: lev,
    rules: null,
  });
  assert.strictEqual(result0p6.mfeReady, true,
    `(C2) mfeReady must be true at +0.6% past TP1 in absolute mode (was: ${result0p6.mfeReady})`);

  // Restore env.
  if (prev !== undefined) process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED = prev;
})();

// (D) Legacy escape hatch: ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED=1
//     restores the old leverage-divided behaviour for any cohort
//     already tuned around it.
(function testTrailMfeLegacyEscapeHatch() {
  process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED = "1";
  delete require.cache[require.resolve("../engine/signalEngine")];
  const { resolveTrailDelayState } = require("../engine/signalEngine");

  const lev = 3;
  const tp1 = 100;
  // +0.167% past TP1 fires under leverage-divided mode.
  const closeAt0p17 = tp1 * 1.00167;
  const result = resolveTrailDelayState({
    meta: {
      tp_p1_target_price: tp1,
      tp_p1_bar_ms: 1700000000000,
      entry_exec_tf_ms: 15 * 60 * 1000,
      trail_delay_bars_required: 1,
      trail_delay_mfe_pct_required: 0.005,
    },
    tpP1Done: true,
    currentBarMs: 1700000000000,
    closePx: closeAt0p17,
    side: "LONG",
    leverageEff: lev,
    rules: null,
  });
  assert.strictEqual(result.mfeReady, true,
    `(D) legacy escape hatch must fire mfeReady at +0.167% (was: ${result.mfeReady})`);

  delete process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED;
  delete require.cache[require.resolve("../engine/signalEngine")];
})();

console.log("RECENT_ENTRY_GRACE_AND_TRAIL_MFE_ABSOLUTE_TEST_OK");
