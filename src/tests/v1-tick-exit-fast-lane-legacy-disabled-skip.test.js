"use strict";

// 2026-04-29 Stage U-1 — V1 tick-exit fast-lane skip test.
//
// Operator escalation: "V1 자체가 작동하면 안 되고 V2 가 모든 처리를
// 인계받아야 한다." The remaining V1 emit-driven exit channel was
// binanceTickExit.js's fast-lane (runPaperMarket EXIT_ONLY) which fires
// when price approaches a TP/SL/TRAIL trigger. Under
// DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 the V1 executor would reject
// every order anyway — so the fast-lane just burns CPU and produces
// alert noise without affecting actual exit behavior. Broker-side
// native protection (closePosition STOP_MARKET) handles real exits.
//
// This test pins the structural invariant: the fast-lane's
// runPaperMarket call site must check
// DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED *before* the runActionPreHooks
// + runPaperMarket call, must emit the structured skip log, and must
// `continue` the loop without invoking V1.

const assert = require("assert");
const fs = require("fs");

function run() {
  const src = fs.readFileSync(require.resolve("../services/binanceTickExit"), "utf8");

  // (A) The skip branch must exist immediately above the fast-lane
  //     runPaperMarket call.
  const fastLaneCallIdx = src.indexOf("const runResult = await runPaperMarket({");
  assert.ok(fastLaneCallIdx > 0, "fast-lane runPaperMarket call site not found");

  // Stage U-followup-1 expanded the skip block (V2 direct dispatch
  // placement). Stage U-followup-2 expanded it further (symbol info
  // fetch + ledger stamp + runId entropy). 2026-04-29 R1 root-cause
  // fix added an exit-in-flight mark inside the place-success branch.
  // Each expansion widens the gap between the legacy-disabled skip
  // and the eventual fast-lane runPaperMarket call. Widen the
  // lookback again so the structural anchors still land inside
  // `region`.
  const region = src.slice(Math.max(0, fastLaneCallIdx - 16000), fastLaneCallIdx);

  // (B) The skip branch must exist with the structured skip log.
  assert.ok(
    region.includes("v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled"),
    "(B) fast-lane skip branch must emit structured skip log"
  );

  // (C) The skip branch must read DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED.
  assert.ok(
    region.includes("DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"),
    "(C) skip branch must check DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED"
  );

  // (D) The skip branch must use `continue` to exit the loop iteration.
  assert.ok(
    region.includes("continue;"),
    "(D) skip branch must use continue to bypass the fast-lane"
  );

  // (E) The skip branch must precede the runActionPreHooks call so no
  //     pre-hook side effect happens before bailing.
  const preHookIdx = src.indexOf('action: "BINANCE_TICK_EXIT_MARKET_RUN"', fastLaneCallIdx - 2500);
  const skipIdx = src.indexOf("v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled");
  assert.ok(preHookIdx > 0 && skipIdx > 0, "(E) anchors not found");
  assert.ok(
    skipIdx < preHookIdx,
    "(E) skip branch must precede the BINANCE_TICK_EXIT_MARKET_RUN pre-hook"
  );
}

try {
  run();
  console.log("V1_TICK_EXIT_FAST_LANE_LEGACY_DISABLED_SKIP_TEST_OK");
} catch (err) {
  console.error("V1_TICK_EXIT_FAST_LANE_LEGACY_DISABLED_SKIP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
