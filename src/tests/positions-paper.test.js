const assert = require("assert");
const { __test } = require("../storage/positionsPaper");

async function run() {
  assert.strictEqual(
    __test.posId({ exchange: "binancefut", symbol: "btcusdt" }),
    "POS__BINANCEFUT__BTCUSDT"
  );
  assert.strictEqual(
    __test.posId({ exchange: " BinanceFut ", symbol: " EthUsdt " }),
    "POS__BINANCEFUT__ETHUSDT"
  );
  assert.strictEqual(
    __test.matchesTpP1PendingSnapshot(
      {
        tp_p1_pending: true,
        tp_p1_pending_at_ms: 100,
        tp_p1_pending_until_ms: 200,
        tp_p1_pending_event: "EXIT_TP_P1_3P",
      },
      {
        pendingAtMs: 100,
        pendingUntilMs: 200,
        pendingEvent: "exit_tp_p1_3p",
      }
    ),
    true
  );
  const clearedMeta = __test.buildTpP1PendingClearedMeta(
    {
      tp_p1_pending: true,
      tp_p1_pending_at_ms: 100,
      tp_p1_pending_until_ms: 200,
      tp_p1_pending_event: "EXIT_TP_P1_3P",
    },
    {
      clearedAt: "2026-03-29T00:00:00.000Z",
      clearedReason: "TEST_CLEAR",
    }
  );
  assert.strictEqual(clearedMeta.tp_p1_pending, false);
  assert.strictEqual(clearedMeta.tp_p1_pending_until_ms, null);
  assert.strictEqual(clearedMeta.tp_p1_pending_cleared_reason, "TEST_CLEAR");
  const versions = __test.resolveNextWriterVersion({
    writer_version: 3,
    core_writer_version: 2,
    meta_writer_version: 1,
  }, "CORE");
  assert.deepStrictEqual(versions, {
    writer_version: 4,
    core_writer_version: 3,
    meta_writer_version: 1,
  });
  __test.assertExpectedWriteTokenProvided(true);
  assert.throws(
    () => __test.assertExpectedWriteTokenProvided(false),
    /POSITION_WRITE_TOKEN_REQUIRED/
  );
  assert.strictEqual(
    __test.buildPositionWriterLeaseDocPath("binancefut", "xrpusdt"),
    "runtime_locks/positions_paper_writer__BINANCEFUT__XRPUSDT"
  );
  let acquireCount = 0;
  const leased = await __test.runWithPositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    waitMs: 250,
    acquireLease: async () => {
      acquireCount += 1;
      if (acquireCount === 1) return { acquired: false, holder: "other-writer" };
      return { acquired: true, holderId: "test-writer" };
    },
    heartbeatLease: async () => ({ ok: true, holderId: "test-writer" }),
    releaseLease: async () => ({ ok: true }),
    runner: async () => "LEASED_OK",
  });
  assert.strictEqual(leased, "LEASED_OK");
  assert.ok(acquireCount >= 2, "writer lease should retry before acquiring");

  await assert.rejects(
    () => __test.runWithPositionWriterLease({
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      waitMs: 0,
      acquireLease: async () => ({ acquired: false, holder: "existing-writer" }),
      runner: async () => "SHOULD_NOT_RUN",
    }),
    /POSITION_WRITE_LEASE_HELD/
  );

  let nestedAcquireCount = 0;
  let nestedReleaseCount = 0;
  const nestedResult = await __test.runWithPositionWriterLease({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    acquireLease: async () => {
      nestedAcquireCount += 1;
      return { acquired: true, holderId: "nested-writer" };
    },
    heartbeatLease: async () => ({ ok: true, holderId: "nested-writer" }),
    releaseLease: async () => {
      nestedReleaseCount += 1;
      return { ok: true };
    },
    runner: async () => __test.runWithPositionWriterLease({
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      acquireLease: async () => {
        nestedAcquireCount += 100;
        return { acquired: true, holderId: "nested-inner" };
      },
      heartbeatLease: async () => ({ ok: true, holderId: "nested-inner" }),
      releaseLease: async () => {
        nestedReleaseCount += 100;
        return { ok: true };
      },
      runner: async () => "NESTED_OK",
    }),
  });
  assert.strictEqual(nestedResult, "NESTED_OK");
  assert.strictEqual(nestedAcquireCount, 1);
  assert.strictEqual(nestedReleaseCount, 1);
  console.log("POSITIONS_PAPER_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
