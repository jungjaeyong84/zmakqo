"use strict";

const assert = require("assert");
const { recordSignalDrops, __test } = require("../storage/signalDrops");

function buildFakeDb(calls) {
  return {
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", name, id });
          return {
            async set(payload, options) {
              calls.push({ type: "set", name, id, payload, options });
            },
          };
        },
      };
    },
  };
}

async function consumedSignalsAreSuppressedBeforeAlertWrites() {
  const drop = {
    signal_id: "SIG__BINANCEFUT__SOLUSDT__15m__1777094100000__SHORT",
    bar_close_time_utc_ms: 1777094100000,
    event: "SHORT",
    side: "SELL",
    reason: "V2_PRODUCTION_ENTRY_ROUTE_BLOCKED",
    execution_mode: "LIVE",
  };
  const filtered = await __test.filterDropsForConsumedSignals({
    drops: [drop],
    runId: "RUN__SUPPRESS",
    tryLockSignalFn: async () => ({ ok: false, reason: "ALREADY_CONSUMED" }),
  });
  assert.strictEqual(filtered.kept.length, 0);
  assert.strictEqual(filtered.suppressed.length, 1);
  assert.strictEqual(filtered.suppressed[0].signal_id, drop.signal_id);
  assert.strictEqual(filtered.suppressed[0].reason, "ALREADY_CONSUMED");
  assert.deepStrictEqual(filtered.suppressed[0].drop, drop);
}

async function lockedSignalsPersistSuppressedForensicRows() {
  const calls = [];
  const drop = {
    signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1777165200000__SHORT",
    bar_close_time_utc_ms: 1777165200000,
    event: "SHORT",
    side: "SELL",
    reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
    execution_mode: "LIVE",
    features_json: {
      run_id: "RUN__LOCKED",
    },
  };
  const result = await recordSignalDrops({
    db: buildFakeDb(calls),
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    tf: "15m",
    runId: "RUN__LOCKED",
    drops: [drop],
    tryLockSignalFn: async () => ({ ok: false, reason: "LOCKED" }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, 0);
  assert.strictEqual(result.suppressed, 1);
  assert.strictEqual(result.suppressed_commit.ok, true);
  assert.strictEqual(result.suppressed_commit.written, 1);
  const write = calls.find((row) => row.type === "set");
  assert.ok(write);
  assert.strictEqual(write.name, "v2__signals_dropped_suppressed");
  assert.strictEqual(write.payload.signal_id, drop.signal_id);
  assert.strictEqual(write.payload.suppress_reason, "LOCKED");
  assert.strictEqual(write.payload.alert_suppressed, true);
  assert.deepStrictEqual(write.payload.original_drop, drop);
  assert.strictEqual(calls.some((row) => row.name === "signals_dropped"), false);
}

async function freeSignalsRemainRecordable() {
  const drop = {
    signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1777167000000__LONG",
    bar_close_time_utc_ms: 1777167000000,
    event: "LONG",
    side: "BUY",
  };
  const filtered = await __test.filterDropsForConsumedSignals({
    drops: [drop],
    runId: "RUN__FREE",
    tryLockSignalFn: async () => ({ ok: true }),
  });
  assert.strictEqual(filtered.kept.length, 1);
  assert.strictEqual(filtered.suppressed.length, 0);
}

async function missingSignalIdKeepsLegacyBehavior() {
  const drop = {
    bar_close_time_utc_ms: 1777167000000,
    event: "LONG",
    side: "BUY",
  };
  const filtered = await __test.filterDropsForConsumedSignals({
    drops: [drop],
    runId: "RUN__NO_SIGNAL",
    tryLockSignalFn: async () => {
      throw new Error("should not lock without signal id");
    },
  });
  assert.strictEqual(filtered.kept.length, 1);
  assert.strictEqual(filtered.suppressed.length, 0);
}

async function main() {
  await consumedSignalsAreSuppressedBeforeAlertWrites();
  await lockedSignalsPersistSuppressedForensicRows();
  await freeSignalsRemainRecordable();
  await missingSignalIdKeepsLegacyBehavior();
}

main()
  .then(() => {
    console.log("SIGNAL_DROP_CONSUME_LOCK_SUPPRESSION_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
