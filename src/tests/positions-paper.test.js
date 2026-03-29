const assert = require("assert");
const { __test } = require("../storage/positionsPaper");

function run() {
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
  console.log("POSITIONS_PAPER_TEST_OK");
}

run();
