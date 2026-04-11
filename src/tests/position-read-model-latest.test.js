"use strict";

const assert = require("assert");
const { __test: latestTest } = require("../storage/positionReadModelLatest");
const { __test: backfillTest } = require("../services/positionReadModelBackfill");
const { __test: readModelTest } = require("../services/positionReadModel");

function run() {
  assert.strictEqual(
    latestTest.buildPositionReadModelLatestId("binancefut", "xrpusdt"),
    "POSITION_READ_MODEL_LATEST__BINANCEFUT__XRPUSDT"
  );
  assert.strictEqual(
    latestTest.shouldReplaceLatestPositionReadModel(
      { ts_ms: 100, created_at: "2026-04-11T00:00:00.000Z" },
      { ts_ms: 200, created_at: "2026-04-11T00:00:01.000Z" }
    ),
    true
  );
  assert.strictEqual(
    latestTest.shouldReplaceLatestPositionReadModel(
      { ts_ms: 200, created_at: "2026-04-11T00:00:01.000Z" },
      { ts_ms: 100, created_at: "2026-04-11T00:00:02.000Z" }
    ),
    false
  );

  const reduced = backfillTest.reduceLatestPositionEvents([
    { exchange: "BINANCEFUT", symbol: "XRPUSDT", sequence_ms: 100 },
    { exchange: "BINANCEFUT", symbol: "XRPUSDT", sequence_ms: 200 },
    { exchange: "BINANCEFUT", symbol: "ETHUSDT", sequence_ms: 150 },
  ]);
  assert.strictEqual(reduced.length, 2);
  assert.strictEqual(reduced.find((row) => row.symbol === "XRPUSDT").sequence_ms, 200);

  const merged = backfillTest.mergeLatestPositionEvents(
    { "BINANCEFUT::XRPUSDT": { exchange: "BINANCEFUT", symbol: "XRPUSDT", sequence_ms: 150 } },
    [
      { exchange: "BINANCEFUT", symbol: "XRPUSDT", sequence_ms: 120 },
      { exchange: "BINANCEFUT", symbol: "ETHUSDT", sequence_ms: 180 },
      { exchange: "BINANCEFUT", symbol: "XRPUSDT", sequence_ms: 220 },
    ]
  );
  assert.strictEqual(Object.keys(merged).length, 2);
  assert.strictEqual(merged["BINANCEFUT::XRPUSDT"].sequence_ms, 220);
  assert.strictEqual(merged["BINANCEFUT::ETHUSDT"].sequence_ms, 180);

  const bootstrap = backfillTest.buildBootstrapLatestRow({
    id: "POS__BINANCEFUT__XRPUSDT",
    exchange: "binancefut",
    symbol_or_pair_id: "xrpusdt",
    updated_at: "2026-04-11T00:00:03.000Z",
    state: "ACTIVE",
    position_side: "LONG",
    size_pct: 0.5,
    qty_base: 100,
    avg_price: 2.1,
    meta: { tp_p1_done: true, trail_active: true },
  });
  assert.strictEqual(bootstrap.exchange, "BINANCEFUT");
  assert.strictEqual(bootstrap.symbol, "XRPUSDT");
  assert.strictEqual(bootstrap.mutation_kind, "POSITION_SNAPSHOT_BOOTSTRAP");
  assert.strictEqual(bootstrap.after_summary.tp_p1_done, true);
  assert.strictEqual(bootstrap.after_summary.trail_active, true);

  const latestRow = readModelTest.buildLatestTimelineRowFromIndex({
    ts_ms: 250,
    created_at: "2026-04-11T00:00:02.000Z",
    mutation_kind: "POSITION_UPSERT",
    position_event_id: "evt-1",
    after_summary: { state: "ACTIVE" },
    after_snapshot: { state: "SCALE_OUT", qty_base: 0.49 },
  });
  assert.strictEqual(latestRow.event_kind, "POSITION_MUTATION");
  assert.strictEqual(latestRow.raw.after_snapshot.state, "SCALE_OUT");

  console.log("POSITION_READ_MODEL_LATEST_TEST_OK");
}

run();
