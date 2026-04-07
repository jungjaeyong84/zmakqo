const assert = require("assert");
const { __test } = require("../storage/tradesPaper");

function run() {
  const refs = __test.resolveTradeSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    execBarCloseTimeUtcMs: 1775091600000,
    event: "SHORT",
    signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT",
    featuresJson: {},
  });

  assert.strictEqual(refs.signalId, "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT");
  assert.strictEqual(refs.signalDocId, "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT");

  const traceMeta = __test.buildTraceMeta({
    signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT",
    intentId: "INTENT__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT",
    fillId: "FILL__1",
    tradeId: "TRADE__1",
    runId: "RUN__TEST__ETHUSDT",
    requestId: "REQ__TEST__ETHUSDT",
    decisionReason: "SHORT",
  });

  assert.strictEqual(
    traceMeta,
    "signal:SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT | intent:INTENT__BINANCEFUT__ETHUSDT__15m__1775091600000__SHORT | fill:FILL__1 | trade:TRADE__1 | run:RUN__TEST__ETHUSDT | req:REQ__TEST__ETHUSDT | reason:SHORT"
  );

  console.log("TRADE_TRACE_META_TEST_OK");
}

run();
