"use strict";

const assert = require("assert");
const {
  buildEntryMicroSnapshotFromBars,
  buildEntryMicroSnapshotFromFeatures,
  buildEntryMicroDetail,
} = require("../utils/entryMicroSnapshot");

function nearlyEqual(a, b, epsilon = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= epsilon;
}

function run() {
  const bars = [
    { open: 100, high: 101.2, low: 99.8, close: 100.9, closeTimeUtcMs: 1000 },
    { open: 100.9, high: 102.0, low: 100.7, close: 101.8, closeTimeUtcMs: 2000 },
    { open: 101.8, high: 103.1, low: 101.6, close: 102.9, closeTimeUtcMs: 3000 },
    { open: 102.9, high: 104.0, low: 102.5, close: 103.8, closeTimeUtcMs: 4000 },
    { open: 103.8, high: 105.0, low: 103.6, close: 104.6, closeTimeUtcMs: 5000 },
    { open: 104.6, high: 105.9, low: 104.4, close: 105.3, closeTimeUtcMs: 6000 },
    { open: 105.3, high: 106.7, low: 105.1, close: 106.1, closeTimeUtcMs: 7000 },
    { open: 106.1, high: 107.4, low: 105.9, close: 106.8, closeTimeUtcMs: 8000 },
  ];

  const snapshot = buildEntryMicroSnapshotFromBars({
    bars,
    dir: "LONG",
    barCloseMs: 8000,
    lookbackBars: 8,
    atrBars: 4,
  });

  assert.strictEqual(snapshot.ok, true);
  assert.strictEqual(snapshot.barsSeen, 8);
  assert.ok(Number.isFinite(snapshot.atrPct) && snapshot.atrPct > 0);
  assert.ok(Number.isFinite(snapshot.recentMove1Pct) && snapshot.recentMove1Pct > 0);
  assert.ok(Number.isFinite(snapshot.sameDirStreak) && snapshot.sameDirStreak >= 1);

  const detail = buildEntryMicroDetail("ev_gate", snapshot);
  const rebuilt = buildEntryMicroSnapshotFromFeatures(detail);

  assert.ok(nearlyEqual(rebuilt.atrPct, snapshot.atrPct));
  assert.ok(nearlyEqual(rebuilt.recentMove1Pct, snapshot.recentMove1Pct));
  assert.ok(nearlyEqual(rebuilt.chaseRatio, snapshot.chaseRatio));
  assert.ok(nearlyEqual(rebuilt.lastCloseControl, snapshot.lastCloseControl));
  assert.ok(nearlyEqual(rebuilt.lastOppWick, snapshot.lastOppWick));
  assert.ok(nearlyEqual(rebuilt.lastDirBody, snapshot.lastDirBody));
  assert.ok(nearlyEqual(rebuilt.sameDirStreak, snapshot.sameDirStreak));
  assert.ok(nearlyEqual(rebuilt.counterDirBars, snapshot.counterDirBars));

  console.log("ENTRY_MICRO_SNAPSHOT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("ENTRY_MICRO_SNAPSHOT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
