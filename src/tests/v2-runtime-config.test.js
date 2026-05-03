"use strict";

const assert = require("assert");
const { resolveV2RuntimeConfig } = require("../v2/runtime");
const { V2_NAMESPACE } = require("../v2/constants");
const { V2_SERVICE_BOUNDARIES, assertSingleExchangeWriter } = require("../v2/boundaries");

(function defaultConfigIsFailClosed() {
  const cfg = resolveV2RuntimeConfig({});
  assert.strictEqual(cfg.namespace, V2_NAMESPACE);
  assert.strictEqual(cfg.enabled, false);
  assert.strictEqual(cfg.dryRun, true);
  assert.strictEqual(cfg.canaryOnly, true);
  assert.ok(String(cfg.collections.POSITION_CYCLES).includes("position_cycles_v2"));
  assert.deepStrictEqual(Object.keys(cfg.defaultProtectionModel).sort(), [
    "beEnabled",
    "runnerEnabled",
    "stopLossPct",
    "tp1QtyRatio",
    "tp1TargetPct",
    "trailEnabled",
  ]);
  assert.strictEqual(cfg.defaultProtectionModel.tp1TargetPct, 0.025);
  assert.strictEqual(cfg.defaultProtectionModel.tp1QtyRatio, 1);
  assert.strictEqual(cfg.defaultProtectionModel.stopLossPct, 0.0165);
  assert.strictEqual(cfg.defaultProtectionModel.beEnabled, false);
  assert.strictEqual(cfg.defaultProtectionModel.runnerEnabled, false);
  assert.strictEqual(cfg.defaultProtectionModel.trailEnabled, false);
  assert.deepStrictEqual(Object.keys(cfg.defaultRepairQueuePolicy).sort(), [
    "batchLimit",
    "maxCompletionFailureCount",
    "maxMissingContextCount",
    "maxSkippedRepairCount",
  ]);
})();

(function envOverridesAreApplied() {
  const cfg = resolveV2RuntimeConfig({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_CANARY_SYMBOLS: "BTCUSDT, ethusdt ",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.dryRun, false);
  assert.strictEqual(cfg.canaryOnly, false);
  assert.deepStrictEqual(cfg.canarySymbols, ["BTCUSDT", "ETHUSDT"]);
  assert.strictEqual(cfg.collectionPrefix, "dbjv2__");
  assert.strictEqual(cfg.collections.TRADE_ALERT_OUTBOX, "dbjv2__trade_alert_outbox_v2");
})();

(function singleExchangeWriterBoundaryIsLocked() {
  const writerCheck = assertSingleExchangeWriter("V2_PROTECTION_WRITER");
  assert.strictEqual(writerCheck.ok, true);
  assert.deepStrictEqual(writerCheck.writerNames, ["V2_PROTECTION_WRITER"]);
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_WATCHDOG.mayWriteExchange, false);
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_ALERT_WORKER.mayWriteAlerts, true);
})();

console.log("V2_RUNTIME_CONFIG_TEST_OK");
