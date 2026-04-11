"use strict";

const assert = require("assert");
const { __test } = require("../services/positionReadModel");

function run() {
  const latest = __test.pickLatestPositionMutationRow([
    { event_kind: "POSITION_MUTATION", ts_ms: 100, payload: { after_summary: { state: "COMMIT" } } },
    { event_kind: "POSITION_MUTATION", ts_ms: 200, raw: { after_snapshot: { state: "SCALE_OUT", qty_base: 0.4 } } },
  ]);
  assert.strictEqual(latest.ts_ms, 200);

  const readView = __test.buildPositionReadView({
    storedPosition: {
      state: "COMMIT",
      qty_base: 1,
      updated_at: "2026-04-11T00:00:00.000Z",
      meta: { tp_p1_done: false },
    },
    latestTimelineRow: {
      ts_ms: Date.parse("2026-04-11T00:00:10.000Z"),
      raw: {
        after_snapshot: {
          state: "SCALE_OUT",
          qty_base: 0.4,
          meta: { tp_p1_done: true },
        },
      },
    },
  });
  assert.strictEqual(readView.state, "SCALE_OUT");
  assert.strictEqual(readView.qty_base, 0.4);
  assert.strictEqual(readView.meta.tp_p1_done, true);
  assert.strictEqual(readView.read_model_source, "UNIFIED_EVENT_TIMELINE");

  const staleReadView = __test.buildPositionReadView({
    storedPosition: {
      state: "ACTIVE",
      qty_base: 1,
      updated_at: "2026-04-11T00:00:20.000Z",
    },
    latestTimelineRow: {
      ts_ms: Date.parse("2026-04-11T00:00:10.000Z"),
      raw: {
        after_snapshot: {
          state: "SCALE_OUT",
          qty_base: 0.4,
        },
      },
    },
  });
  assert.strictEqual(staleReadView.state, "ACTIVE");

  const readViews = __test.buildPositionReadViews({
    positions: [
      {
        symbol: "XRPUSDT",
        state: "ACTIVE",
        qty_base: 1,
        updated_at: "2026-04-11T00:00:00.000Z",
      },
    ],
    latestTimelineRowsBySymbol: {
      XRPUSDT: {
        ts_ms: Date.parse("2026-04-11T00:00:10.000Z"),
        raw: {
          after_snapshot: {
            symbol: "XRPUSDT",
            state: "SCALE_OUT",
            qty_base: 0.49,
          },
        },
      },
    },
  });
  assert.strictEqual(readViews.length, 1);
  assert.strictEqual(readViews[0].state, "SCALE_OUT");

  console.log("POSITION_READ_MODEL_TEST_OK");
}

run();
