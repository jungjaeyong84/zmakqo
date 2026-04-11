const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(typeof __test.normalizeEntryLineage, "function", "normalizeEntryLineage export missing");
  assert.strictEqual(typeof __test.buildEntryLineageMetaPatch, "function", "buildEntryLineageMetaPatch export missing");
  assert.strictEqual(typeof __test.resolveEntryLineageForFill, "function", "resolveEntryLineageForFill export missing");
  assert.strictEqual(typeof __test.extractEntryLineageCandidate, "function", "extractEntryLineageCandidate export missing");

  const normalized = __test.normalizeEntryLineage({
    entry_event_id: null,
    origin_entry_event_id: "ENTRY__BINANCEFUT__ETHUSDT__15m__1000__CORE_SHORT",
    origin_entry_signal_type: "CORE_SHORT",
    origin_entry_grade: "EARLY",
    origin_entry_qty_profile: "BASE",
    origin_entry_signal_bar_ms: 1000,
    origin_entry_exec_bar_ms: 1100,
  });
  assert.strictEqual(normalized.entry_event_id, "ENTRY__BINANCEFUT__ETHUSDT__15m__1000__CORE_SHORT");
  assert.strictEqual(normalized.entry_signal_type, "CORE_SHORT");
  assert.strictEqual(normalized.entry_exec_bar_ms, 1100);

  const patch = __test.buildEntryLineageMetaPatch(normalized);
  assert.strictEqual(patch.entry_event_id, normalized.entry_event_id);
  assert.strictEqual(patch.origin_entry_event_id, normalized.entry_event_id);
  assert.strictEqual(patch.origin_entry_signal_type, "CORE_SHORT");

  const resolvedExit = __test.resolveEntryLineageForFill({
    opening: false,
    intentEntryEventId: null,
    intentEntrySignalType: null,
    posMeta: {
      entry_event_id: null,
      origin_entry_event_id: "ENTRY__BINANCEFUT__SOLUSDT__15m__2000__EARLY_SHORT",
      origin_entry_signal_type: "EARLY_SHORT",
    },
  });
  assert.strictEqual(resolvedExit.entryEventId, "ENTRY__BINANCEFUT__SOLUSDT__15m__2000__EARLY_SHORT");
  assert.strictEqual(resolvedExit.entrySignalType, "EARLY_SHORT");

  const candidate = __test.extractEntryLineageCandidate({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    event: "CORE_SHORT",
    side: "SELL",
    entry_event_id: "ENTRY__BINANCEFUT__BTCUSDT__15m__3000__CORE_SHORT",
    entry_signal_type: "CORE_SHORT",
    signal_bar_close_time_utc_ms: 3000,
    exec_bar_close_time_utc_ms: 3150,
    created_at: "2026-04-05T00:00:00.000Z",
    features_json: { entry_grade: "CORE", entry_qty_profile: "BASE" },
  }, {
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    side: "SHORT",
  });
  assert.ok(candidate, "entry lineage candidate should be extracted");
  assert.strictEqual(candidate.entry_event_id, "ENTRY__BINANCEFUT__BTCUSDT__15m__3000__CORE_SHORT");
  assert.strictEqual(candidate.entry_signal_type, "CORE_SHORT");
}

try {
  run();
  console.log("ENTRY_LINEAGE_RECOVERY_TEST_OK");
} catch (err) {
  console.error("ENTRY_LINEAGE_RECOVERY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
