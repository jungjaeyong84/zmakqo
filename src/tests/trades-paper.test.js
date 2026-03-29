const assert = require("assert");
const { __test } = require("../storage/tradesPaper");

function run() {
  assert.strictEqual(
    __test.tradeId({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1",
      execBarCloseMs: 1711670400000,
    }),
    "TRADE__BINANCEFUT__BTCUSDT__EXIT_TP_P1__1711670400000"
  );
  assert.strictEqual(
    __test.tradeId({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1",
      execBarCloseMs: 1711670400000,
      execMs: 1711670400123,
    }),
    "TRADE__BINANCEFUT__BTCUSDT__EXIT_TP_P1__1711670400000__1711670400123"
  );
  console.log("TRADES_PAPER_TEST_OK");
}

run();
