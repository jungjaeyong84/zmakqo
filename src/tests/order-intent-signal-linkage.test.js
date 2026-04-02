const assert = require("assert");
const { __test } = require("../storage/orderIntentsPaper");

function run() {
  const refsFromSignalId = __test.resolveIntentSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    tf: "15m",
    signalBarCloseTimeUtcMs: 1775082600000,
    event: "SHORT",
    signalId: "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
    features: {},
  });
  assert.strictEqual(
    refsFromSignalId.signalId,
    "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT"
  );
  assert.strictEqual(
    refsFromSignalId.signalDocId,
    "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT"
  );
  assert.strictEqual(
    refsFromSignalId.features.signal_doc_id,
    "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT"
  );

  const refsFromFeatures = __test.resolveIntentSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    signalBarCloseTimeUtcMs: 1775091600000,
    event: "LONG",
    features: {
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__LONG",
    },
  });
  assert.strictEqual(
    refsFromFeatures.signalDocId,
    "SIG__BINANCEFUT__ETHUSDT__15m__1775091600000__LONG"
  );

  console.log("ORDER_INTENT_SIGNAL_LINKAGE_TEST_OK");
}

run();
