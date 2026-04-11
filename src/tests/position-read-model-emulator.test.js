"use strict";

const assert = require("assert");

async function run() {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    console.log("POSITION_READ_MODEL_EMULATOR_TEST_SKIPPED");
    return;
  }

  process.env.PAPER_NAMESPACE = `emu_${Date.now()}`;
  process.env.POSITION_WRITE_TOKEN_REQUIRED = "1";
  process.env.POSITION_WRITER_LEASE_ENABLED = "1";
  process.env.POSITION_EVENT_LOG_ENABLED = "1";
  process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE = "1";

  const { getFirestore } = require("../storage/firestore");
  const { upsertPosition, upsertPositionMetaOnly, getPosition } = require("../storage/positionsPaper");
  const { getLatestPositionReadModel } = require("../storage/positionReadModelLatest");
  const { fetchPositionEvents } = require("../storage/positionEvents");
  const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");
  const { getPositionReadView } = require("../services/positionReadModel");
  const { backfillLatestPositionReadModel } = require("../services/positionReadModelBackfill");
  const { replayPositionEvents } = require("../services/positionEventReplay");

  const db = getFirestore();
  const exchange = "BINANCEFUT";
  const symbol = `EMU${Date.now()}USDT`;

  const initial = await upsertPosition({
    exchange,
    symbol,
    state: "ACTIVE",
    sizePct: 1,
    avgPrice: 1.23,
    qtyBase: 100,
    positionSide: "LONG",
    meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    source: "EMULATOR_TEST",
    mutationKind: "POSITION_UPSERT",
    expectedWriteToken: null,
  });
  assert.ok(initial.position_write_token);

  const current = await getPosition({ exchange, symbol });
  const sharedToken = current.position_write_token;
  const [a, b] = await Promise.allSettled([
    upsertPositionMetaOnly({
      exchange,
      symbol,
      meta: { ...(current.meta || {}), tp_p1_done: true, trail_active: true, emulator_branch: "A" },
      source: "EMULATOR_TEST",
      mutationKind: "POSITION_META_UPSERT",
      expectedWriteToken: sharedToken,
    }),
    upsertPositionMetaOnly({
      exchange,
      symbol,
      meta: { ...(current.meta || {}), tp_p1_done: false, trail_active: false, emulator_branch: "B" },
      source: "EMULATOR_TEST",
      mutationKind: "POSITION_META_UPSERT",
      expectedWriteToken: sharedToken,
    }),
  ]);
  const fulfilled = [a, b].filter((row) => row.status === "fulfilled");
  const rejected = [a, b].filter((row) => row.status === "rejected");
  assert.strictEqual(fulfilled.length, 1);
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].reason.code, "POSITION_WRITE_TOKEN_MISMATCH");

  const events = await fetchPositionEvents({ exchange, symbol, limit: 20 });
  const timeline = await fetchUnifiedEventTimeline({ exchange, symbol, limit: 20 });
  assert.strictEqual(events.length, 2);
  assert.strictEqual(timeline.filter((row) => row.event_kind === "POSITION_MUTATION").length, 2);

  const latestBeforeDelete = await getLatestPositionReadModel({ exchange, symbol });
  assert.ok(latestBeforeDelete);
  assert.strictEqual(latestBeforeDelete.position_event_id, events.slice().sort((x, y) => Number(y.sequence_ms) - Number(x.sequence_ms))[0].event_id);

  await db.collection("position_read_model_latest").doc(latestBeforeDelete.read_model_id).delete();
  const backfill = await backfillLatestPositionReadModel({ exchange, maxDocs: 20, dryRun: false });
  assert.strictEqual(backfill.ok, true);

  const readView = await getPositionReadView({ exchange, symbol });
  assert.ok(readView);
  assert.strictEqual(readView.meta.tp_p1_done, true);
  assert.strictEqual(readView.meta.trail_active, true);

  const replayed = await replayPositionEvents({ exchange, symbol, limit: 20 });
  assert.strictEqual(replayed.replayed_n, 2);
  assert.strictEqual(replayed.latest_snapshot.meta.tp_p1_done, true);

  console.log("POSITION_READ_MODEL_EMULATOR_TEST_OK");
}

run().catch((err) => {
  console.error("POSITION_READ_MODEL_EMULATOR_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
