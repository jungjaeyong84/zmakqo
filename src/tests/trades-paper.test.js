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

  const refsFromSignalId = __test.resolveTradeSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    tf: "15m",
    execBarCloseTimeUtcMs: 1775082600000,
    event: "SHORT",
    signalId: "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
  });
  assert.strictEqual(
    refsFromSignalId.signalDocId,
    "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT"
  );

  const refsFromFeatures = __test.resolveTradeSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    execBarCloseTimeUtcMs: 1775091600000,
    event: "LONG",
    featuresJson: {
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__LONG",
    },
  });
  assert.strictEqual(
    refsFromFeatures.featuresJson.signal_doc_id,
    "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__LONG"
  );

  console.log("TRADES_PAPER_TEST_OK");
}

run();
