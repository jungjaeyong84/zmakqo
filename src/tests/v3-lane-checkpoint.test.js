"use strict";

const assert = require("assert");

const {
  resolveV3LaneSinceIso,
  buildV3LaneCheckpoint,
} = require("../v3/laneCheckpoint");

(() => {
  const sinceIso = resolveV3LaneSinceIso({
    checkpoint: null,
    now: new Date("2026-05-11T03:00:00.000Z"),
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  assert.strictEqual(sinceIso, "2026-05-11T00:00:00.000Z");
})();

(() => {
  const sinceIso = resolveV3LaneSinceIso({
    checkpoint: {
      last_seen_created_at: "2026-05-11T02:45:00.000Z",
    },
    now: new Date("2026-05-11T03:00:00.000Z"),
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  assert.strictEqual(sinceIso, "2026-05-11T02:30:00.000Z");
})();

(() => {
  const checkpoint = buildV3LaneCheckpoint({
    previousCheckpoint: {
      last_seen_created_at: "2026-05-11T02:45:00.000Z",
    },
    fetchedRows: [
      { created_at: "2026-05-11T02:40:00.000Z" },
      { created_at: "2026-05-11T02:55:00.000Z" },
    ],
    now: new Date("2026-05-11T03:00:00.000Z"),
    lookbackMinutes: 180,
    overlapMinutes: 15,
  });
  assert.strictEqual(checkpoint.last_seen_created_at, "2026-05-11T02:55:00.000Z");
  assert.strictEqual(checkpoint.fetched_row_n, 2);
  assert.strictEqual(checkpoint.lookback_minutes, 180);
  assert.strictEqual(checkpoint.overlap_minutes, 15);
})();

console.log("v3-lane-checkpoint.test.js PASS");
