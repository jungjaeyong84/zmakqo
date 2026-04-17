const assert = require("assert");
const { __test } = require("../storage/positionsPaper");
const { __test: runnerTest } = require("../engine/paperBinanceRunner");

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
  assert.strictEqual(
    __test.shouldSuppressPositionWriterAuthorityAlert(
      { code: "POSITION_WRITE_LEASE_HELD", holder: "positions_paper_writer__donbeolja-exit-worker-00627-b7m__1" },
      { source: "BINANCE_FUTURES_POSITION_SYNC" }
    ),
    true
  );
  assert.strictEqual(
    __test.shouldSuppressPositionWriterAuthorityAlert(
      { code: "POSITION_WRITE_LEASE_HELD", holder: "positions_paper_writer__donbeolja-main-00012-aa1__1" },
      { source: "BINANCE_FUTURES_POSITION_SYNC" }
    ),
    false
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

  {
    let readCount = 0;
    const stalePos = {
      position_write_token: "stale-token",
      meta: {
        last_fill_intent: "INTENT_OLD",
        local_hint: "OLD",
        tp_p1_done: true,
      },
    };
    const freshPos = {
      position_write_token: "fresh-token",
      meta: {
        last_fill_intent: "INTENT_SYNC",
        other_runtime_flag: "KEEP",
        trail_active: true,
      },
    };
    const writes = [];
    const result = await runnerTest.upsertPositionMetaOnlyWithLatestRetry({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      runId: "RUN__TEST__WEBHOOK__XRPUSDT",
      executionMode: "LIVE",
      position: stalePos,
      metaPatch: {
        last_fill_intent: "INTENT_NEW",
        local_hint: "LATEST",
      },
      source: "INTENT_FILL",
      reason: "INTENT_FILL_FORCE_LIVE_RECONCILE",
      maxAttempts: 2,
      retryDelayMs: 0,
      readPosition: async () => {
        readCount += 1;
        return freshPos;
      },
      writePositionMeta: async (args) => {
        writes.push(args);
        if (writes.length === 1) {
          const err = new Error("POSITION_WRITE_TOKEN_MISMATCH expected=stale-token actual=fresh-token");
          err.code = "POSITION_WRITE_TOKEN_MISMATCH";
          throw err;
        }
        return args;
      },
    });
    assert.strictEqual(readCount, 1);
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[0].expectedWriteToken, "stale-token");
    assert.strictEqual(writes[0].suppressAuthorityAlert, true);
    assert.strictEqual(writes[0].suppressAuthorityRuntimeFamily, true);
    assert.strictEqual(writes[1].expectedWriteToken, "fresh-token");
    assert.strictEqual(writes[1].suppressAuthorityAlert, false);
    assert.strictEqual(writes[1].suppressAuthorityRuntimeFamily, false);
    assert.strictEqual(writes[1].source, "INTENT_FILL");
    assert.strictEqual(writes[1].reason, "INTENT_FILL_FORCE_LIVE_RECONCILE");
    assert.strictEqual(writes[1].meta.last_fill_intent, "INTENT_NEW");
    assert.strictEqual(writes[1].meta.local_hint, "LATEST");
    assert.strictEqual(writes[1].meta.other_runtime_flag, "KEEP");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(writes[1].meta, "trail_active"), false);
    assert.strictEqual(result.expectedWriteToken, "fresh-token");
  }

  {
    let readCount = 0;
    const writes = [];
    const tokens = ["stale-token", "fresh-token-1", "fresh-token-2", "fresh-token-3"];
    const result = await runnerTest.upsertPositionMetaOnlyWithLatestRetry({
      exchange: "BINANCEFUT",
      symbol: "SOLUSDT",
      runId: "RUN__TEST__WEBHOOK__SOLUSDT",
      executionMode: "LIVE",
      position: {
        position_write_token: tokens[0],
        meta: {
          last_fill_intent: "INTENT_OLD",
        },
      },
      metaPatch: {
        last_fill_intent: "INTENT_NEW",
      },
      source: "INTENT_FILL",
      reason: "INTENT_FILL_FORCE_LIVE_RECONCILE",
      maxAttempts: 4,
      retryDelayMs: 0,
      readPosition: async () => {
        const idx = Math.min(readCount + 1, tokens.length - 1);
        readCount += 1;
        return {
          position_write_token: tokens[idx],
          meta: {
            last_fill_intent: `INTENT_SYNC_${idx}`,
          },
        };
      },
      writePositionMeta: async (args) => {
        writes.push(args);
        if (writes.length < 4) {
          const err = new Error(`POSITION_WRITE_TOKEN_MISMATCH expected=${args.expectedWriteToken} actual=${tokens[Math.min(writes.length, tokens.length - 1)]}`);
          err.code = "POSITION_WRITE_TOKEN_MISMATCH";
          throw err;
        }
        return args;
      },
    });
    assert.strictEqual(readCount, 3);
    assert.strictEqual(writes.length, 4);
    assert.deepStrictEqual(
      writes.map((row) => row.expectedWriteToken),
      ["stale-token", "fresh-token-1", "fresh-token-2", "fresh-token-3"]
    );
    assert.deepStrictEqual(
      writes.map((row) => row.suppressAuthorityRuntimeFamily),
      [true, true, true, false]
    );
    assert.strictEqual(result.expectedWriteToken, "fresh-token-3");
  }

  {
    let readCount = 0;
    const stalePos = {
      position_write_token: "stale-token",
      state: "ACTIVE",
      position_side: "LONG",
      size_pct: 1,
      avg_price: 1.23,
      qty_base: 100,
      budget_max_krw: null,
      budget_used_krw: null,
      budget_source: null,
      meta: {
        entry_event_id: "ENTRY_OLD",
      },
    };
    const freshPos = {
      ...stalePos,
      position_write_token: "fresh-token",
      meta: {
        entry_event_id: "ENTRY_SYNC",
      },
    };
    const writes = [];
    const result = await runnerTest.upsertPositionWithLatestRetry({
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      runId: "RUN__TEST__WEBHOOK__DOGEUSDT",
      executionMode: "LIVE",
      position: stalePos,
      state: "ACTIVE",
      positionSide: "LONG",
      sizePct: 0.75,
      avgPrice: 0.091,
      qtyBase: 250,
      meta: {
        entry_event_id: "ENTRY_NEW",
        tp_p0_done: true,
      },
      source: "INTENT_FILL",
      reason: "INTENT_FILL_PROJECTED_POSITION_WRITE",
      maxAttempts: 2,
      retryDelayMs: 0,
      readPosition: async () => {
        readCount += 1;
        return freshPos;
      },
      writePosition: async (args) => {
        writes.push(args);
        if (writes.length === 1) {
          const err = new Error("POSITION_WRITE_TOKEN_MISMATCH expected=stale-token actual=fresh-token");
          err.code = "POSITION_WRITE_TOKEN_MISMATCH";
          throw err;
        }
        return args;
      },
    });
    assert.strictEqual(readCount, 1);
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes[0].expectedWriteToken, "stale-token");
    assert.strictEqual(writes[0].suppressAuthorityAlert, true);
    assert.strictEqual(writes[0].suppressAuthorityRuntimeFamily, true);
    assert.strictEqual(writes[1].expectedWriteToken, "fresh-token");
    assert.strictEqual(writes[1].suppressAuthorityAlert, false);
    assert.strictEqual(writes[1].suppressAuthorityRuntimeFamily, false);
    assert.strictEqual(writes[1].source, "INTENT_FILL");
    assert.strictEqual(writes[1].reason, "INTENT_FILL_PROJECTED_POSITION_WRITE");
    assert.strictEqual(writes[1].meta.entry_event_id, "ENTRY_NEW");
    assert.strictEqual(writes[1].qtyBase, 250);
    assert.strictEqual(result.expectedWriteToken, "fresh-token");
  }

  {
    let readCount = 0;
    const writes = [];
    const result = await runnerTest.upsertPositionWithLatestRetry({
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      runId: "RUN__TEST__LEASE_HELD__BNBUSDT",
      executionMode: "LIVE",
      position: {
        position_write_token: "lease-token-0",
        state: "ACTIVE",
        position_side: "LONG",
        size_pct: 1,
        avg_price: 100,
        qty_base: 1,
        meta: {},
      },
      state: "ACTIVE",
      positionSide: "LONG",
      sizePct: 1,
      avgPrice: 101,
      qtyBase: 1,
      meta: {
        native_protection_refresh_status: "OK",
      },
      source: "BINANCE_FUTURES_POSITION_SYNC",
      reason: "BINANCE_FUTURES_POSITION_SYNC",
      maxAttempts: 4,
      retryDelayMs: 0,
      readPosition: async () => {
        readCount += 1;
        return {
          position_write_token: `lease-token-${readCount}`,
          state: "ACTIVE",
          position_side: "LONG",
          size_pct: 1,
          avg_price: 100,
          qty_base: 1,
          meta: {},
        };
      },
      writePosition: async (args) => {
        writes.push(args);
        if (writes.length < 3) {
          const err = new Error(`POSITION_WRITE_LEASE_HELD BINANCEFUT BNBUSDT holder=positions_paper_writer__donbeolja-exit-worker-00748-rpd__1`);
          err.code = "POSITION_WRITE_LEASE_HELD";
          throw err;
        }
        return args;
      },
    });
    assert.strictEqual(readCount, 2);
    assert.strictEqual(writes.length, 3);
    assert.deepStrictEqual(
      writes.map((row) => row.expectedWriteToken),
      ["lease-token-0", "lease-token-1", "lease-token-2"]
    );
    assert.strictEqual(result.expectedWriteToken, "lease-token-2");
  }

  console.log("POSITIONS_PAPER_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
