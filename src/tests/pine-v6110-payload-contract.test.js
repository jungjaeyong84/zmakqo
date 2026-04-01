"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { resolveEventMapping } = require("../services/signalMapping");
const { resolveEntryTimingTier, resolveEntryQtyProfile } = require("../utils/liveEntryTaxonomy");

const productionCandidatePath = path.join(__dirname, "../../code/donbeolja_v6.1.1.0_PRODUCTION_CANDIDATE.pine.txt");
const redesignPath = path.join(__dirname, "../../code/donbeolja_v6.1.1.0_SIGNAL_REDESIGN.pine.txt");
const tvImportFinalPath = path.join(__dirname, "../../code/donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt");

function assertAlertSurface(text) {
  const alertconditionCount = (text.match(/alertcondition\(/g) || []).length;
  const runtimeAlertCount = (text.match(/\balert\(/g) || []).length;
  assert.strictEqual(alertconditionCount, 4, "expected exactly 4 alertcondition declarations");
  assert.strictEqual(runtimeAlertCount, 4, "expected exactly 4 runtime alert() calls");
  assert.ok(!text.includes('f_json_pair_s("event", "ENTRY")'), "payload must not emit event=ENTRY");
  assert.ok(text.includes('f_json_pair_s("action", "ENTRY")'), "payload must emit action=ENTRY");
  assert.ok(text.includes('f_json_pair_s("event_intent", "ENTRY")'), "payload must emit event_intent=ENTRY");
  assert.ok(text.includes('f_json_pair_s("event", direction)'), "payload must emit event as LONG|SHORT direction");
  assert.ok(text.includes('f_json_pair_n("qtyPct", webhook_qty_pct)'), "payload must emit qtyPct");
  assert.ok(text.includes('f_json_pair_n("bar_close_time_utc_ms", time_close)'), "payload must emit bar_close_time_utc_ms");
}

(function testPineAlertPayloadContract() {
  const productionText = fs.readFileSync(productionCandidatePath, "utf8");
  const redesignText = fs.readFileSync(redesignPath, "utf8");
  const tvImportText = fs.readFileSync(tvImportFinalPath, "utf8");
  assertAlertSurface(productionText);
  assertAlertSurface(redesignText);
  assertAlertSurface(tvImportText);
  assert.ok(tvImportText.includes('indicator("돈벌자 :) Ω Full v6.1.1.0", overlay = true'), "tv import final should expose final TradingView title");
})();

(function testRepresentativePayloadConsumerSemantics() {
  const payload = {
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    market: "BTCUSDT",
    ticker: "BTCUSDT",
    tf: "15",
    strategy_id: "donbeolja_v6.1.1.0",
    engine_mode: "CLEAN_REDESIGN",
    action: "ENTRY",
    event_intent: "ENTRY",
    event: "LONG",
    side: "BUY",
    direction: "LONG",
    entry_grade: "CORE",
    qty_profile: "FIXED",
    qtyPct: 1,
    bar_close_time_utc_ms: 1775000000000,
    features: {
      strategy_id: "donbeolja_v6.1.1.0",
      entry_grade: "CORE",
      qty_profile: "FIXED",
      _event_intent: "ENTRY",
      signal_family: "LONG",
      source_band: "CORE",
    },
  };

  const mapping = resolveEventMapping({ event: payload.event, side: payload.side });
  assert.strictEqual(mapping.ok, true);
  assert.strictEqual(mapping.intent, "ENTRY");
  assert.strictEqual(mapping.side, "BUY");

  assert.strictEqual(resolveEntryTimingTier(payload.event, payload.features), "CORE");
  assert.strictEqual(resolveEntryQtyProfile(payload.event, payload.features), "FIXED");
})();

console.log("PINE_V6110_PAYLOAD_CONTRACT_TEST_OK");
