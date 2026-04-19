"use strict";

// 2026-04-18 P2-2 (audit re-verified): legacy TP0 events are silently
// remapped to TP1 stage by `classifyExitEventStage`. That remap is
// correct for backfill/canonical-transition scripts (preserves historical
// records), but erases the "TP0 happened" signal in live namespace.
// `classifyExitEventStageLiveNamespace` preserves TP0 AND increments
// an observable counter + emits a structured warn so operators can
// quantify real-world legacy TP0 exposure on production.

const assert = require("assert");
const {
  classifyExitEventStage,
  classifyExitEventStageLiveNamespace,
  getLegacyTp0LiveNamespaceObservations,
  resetLegacyTp0LiveNamespaceObservationsForTest,
} = require("../services/positionStateMachine");

(function legacyClassifierStillRemapsTp0() {
  // Regression guard for backfill scripts — do NOT change this behavior
  // without also updating canonical-exit-transitions backfill expectations.
  assert.strictEqual(classifyExitEventStage("EXIT_TP_P0_50P"), "TP1",
    "legacy classifier must keep TP0→TP1 remap for historical compat");
  assert.strictEqual(classifyExitEventStage("EXIT_TP_P1"), "TP1");
  assert.strictEqual(classifyExitEventStage("EXIT_TRAIL"), "TRAIL");
  assert.strictEqual(classifyExitEventStage("EXIT_SL"), "SL");
})();

(function liveNamespaceClassifierPreservesTp0() {
  resetLegacyTp0LiveNamespaceObservationsForTest();
  const stage = classifyExitEventStageLiveNamespace("EXIT_TP_P0_50P", {
    symbol: "BTCUSDT",
  });
  assert.strictEqual(stage, "TP0",
    "live classifier must surface TP0 so downstream can tell it apart from TP1");
  const obs = getLegacyTp0LiveNamespaceObservations();
  assert.strictEqual(obs.count, 1);
  assert.deepStrictEqual(obs.recentEvents, ["EXIT_TP_P0_50P"]);
  assert.deepStrictEqual(obs.recentSymbols, ["BTCUSDT"]);
})();

(function liveNamespaceClassifierOnlyObservesTp0() {
  resetLegacyTp0LiveNamespaceObservationsForTest();
  classifyExitEventStageLiveNamespace("EXIT_TP_P1", { symbol: "ETHUSDT" });
  classifyExitEventStageLiveNamespace("EXIT_TRAIL", { symbol: "ETHUSDT" });
  classifyExitEventStageLiveNamespace("EXIT_SL", { symbol: "ETHUSDT" });
  const obs = getLegacyTp0LiveNamespaceObservations();
  assert.strictEqual(obs.count, 0,
    "non-TP0 events must not increment the legacy TP0 counter");
})();

(function liveNamespaceClassifierObserveCanBeDisabled() {
  resetLegacyTp0LiveNamespaceObservationsForTest();
  const stage = classifyExitEventStageLiveNamespace("EXIT_TP_P0_40P", {
    symbol: "BTCUSDT",
    observe: false,
  });
  assert.strictEqual(stage, "TP0");
  const obs = getLegacyTp0LiveNamespaceObservations();
  assert.strictEqual(obs.count, 0,
    "observe:false must classify without incrementing the counter (tests / bulk classification)");
})();

(function liveNamespaceClassifierDedupsRecentEntries() {
  resetLegacyTp0LiveNamespaceObservationsForTest();
  for (let i = 0; i < 5; i += 1) {
    classifyExitEventStageLiveNamespace("EXIT_TP_P0_50P", { symbol: "BTCUSDT" });
  }
  const obs = getLegacyTp0LiveNamespaceObservations();
  assert.strictEqual(obs.count, 5,
    "counter must count every observation, even repeats");
  assert.deepStrictEqual(obs.recentEvents, ["EXIT_TP_P0_50P"],
    "recentEvents must dedup so ops see the unique set");
})();

console.log("LEGACY_TP0_LIVE_NAMESPACE_TEST_OK");
