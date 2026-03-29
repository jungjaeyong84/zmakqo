"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-signal-data-integrity");

(() => {
  const repair = __test.buildRegimeRepairPatch({
    id: "SIG__A",
    features_json: { pro_regime_state: "t\rend" },
  }, "signals");
  assert.strictEqual(repair.patchNeeded, true);
  assert.strictEqual(repair.patch.regime, "trend");
  assert.strictEqual(repair.patch.features_json.regime, "trend");
  assert.strictEqual(repair.patch.features_json.pro_regime_state, "trend");

  const intentRepair = __test.buildRegimeRepairPatch({
    id: "INTENT__A",
    event: "CORE_LONG",
    side: "BUY",
    features_json: { pro_regime_state: "t\rend" },
  }, "order_intents_paper");
  assert.strictEqual(intentRepair.patch.event_intent, "ENTRY");

  const fallbackRepair = __test.buildRegimeRepairPatch({
    id: "INTENT__B",
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "BTCUSDT",
    tf: "15m",
    signal_bar_close_time_utc_ms: 123,
    event: "CORE_LONG",
    side: "BUY",
    features_json: {},
  }, "order_intents_paper", new Map([
    ["SIG__BINANCEFUT__BTCUSDT__15m__123__CORE_LONG", { exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", tf: "15m", signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__123__CORE_LONG", event: "CORE_LONG", features_json: { pro_regime_state: "transition" } }],
  ]));
  assert.strictEqual(fallbackRepair.patch.regime, "transition");

  const rows = __test.applyLocalCachePatches(
    [{ id: "A", value: 1 }, { id: "B", value: 2 }],
    new Map([["B", { value: 20 }]]),
  );
  assert.strictEqual(rows[1].value, 20);

  const metrics = __test.summarizeCollectionMetrics({
    rows: [
      { exchange: "BINANCEFUT", tf: "15m", signal_id: "SIG__1", event: "CORE_LONG", side: "BUY", bar_close_time_utc_ms: 1, features_json: { pro_regime_state: "t\rend" } },
      { exchange: "BINANCEFUT", tf: "15m", signal_id: "", event: "", side: "", bar_close_time_utc_ms: null, features_json: {} },
    ],
    collection: { name: "signals", idField: "signal_id" },
    signalMsField: "bar_close_time_utc_ms",
  });
  assert.strictEqual(metrics.scoped_n, 2);
  assert.strictEqual(metrics.regime_scoped_n, 1);
  assert.strictEqual(metrics.missing_regime_n, 0);
  assert.strictEqual(metrics.control_char_n, 1);
  assert.strictEqual(metrics.missing_id_n, 1);
  console.log("SIGNAL_DATA_INTEGRITY_TEST_OK");
})();
