const assert = require("assert");
const { deriveSignalDocId } = require("../utils/signalDocId");

function run() {
  const exchange = "BINANCEFUT";

  // Legacy format: SYMBOL|TF|BAR_MS|EVENT
  const legacy = deriveSignalDocId({
    exchange,
    signalId: "XRPUSDT.P|60|1771815600000|PRE_REAL_SHORT",
  });
  assert.strictEqual(
    legacy,
    "SIG__BINANCEFUT__XRPUSDT__60m__1771815600000__PRE_REAL_SHORT"
  );

  // Current payload format: SYMBOL|TF|EVENT|BAR_MS|DIR|ACTION
  const current = deriveSignalDocId({
    exchange,
    signalId: "XRPUSDT.P|60|PRE_REAL_SHORT|1771815600000|-1|ENTRY",
  });
  assert.strictEqual(
    current,
    "SIG__BINANCEFUT__XRPUSDT__60m__1771815600000__PRE_REAL_SHORT"
  );

  // Seconds timestamp should be normalized to milliseconds.
  const secondsTs = deriveSignalDocId({
    exchange,
    signalId: "BTCUSDT.P|60|CORE_SHORT|1771815600|-1|ENTRY",
  });
  assert.strictEqual(
    secondsTs,
    "SIG__BINANCEFUT__BTCUSDT__60m__1771815600000__CORE_SHORT"
  );

  console.log("SIGNAL_DOC_ID_TEST_OK");
}

run();
