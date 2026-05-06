"use strict";

const assert = require("assert");
const fillsSync = require("../services/binanceFuturesFillsSync");

(function tp1HintCarriesEntryLineage() {
  const hinted = fillsSync.__test.buildStageHintedMeta(
    {
      entry_event_id: "ENTRYV2__DOGEUSDT__LONG__1",
      tp_p1_done: false,
      tp_p1_entry_event_id: null,
      trail_active: false,
    },
    "EXIT_TP_P1_2.5P",
    { time: 1_777_777_000_000, price: 0.11719 }
  );

  assert.strictEqual(hinted.tp_p1_done, true);
  assert.strictEqual(hinted.tp_p1_entry_event_id, "ENTRYV2__DOGEUSDT__LONG__1");
})();

(function recentTp1HintCarriesOriginLineageFallback() {
  const merged = fillsSync.__test.mergeRecentExitHintsIntoMeta(
    {
      entry_event_id: null,
      origin_entry_event_id: "ENTRYV2__INJUSDT__SHORT__9",
      tp_p1_done: false,
      tp_p1_entry_event_id: null,
      trail_active: false,
    },
    {
      recentTp1: { event: "EXIT_TP_P1_2.5P" },
      recentTrail: null,
    }
  );

  assert.strictEqual(merged.tp_p1_done, true);
  assert.strictEqual(merged.tp_p1_entry_event_id, "ENTRYV2__INJUSDT__SHORT__9");
})();

console.log("FILL_SYNC_STAGE_HINT_LINEAGE_TEST_OK");
