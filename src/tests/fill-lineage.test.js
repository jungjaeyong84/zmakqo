"use strict";

const assert = require("assert");
const { __test } = require("../storage/fillsPaper");

(() => {
  const refs = __test.resolveFillSignalRefs({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    signalBarCloseTimeUtcMs: 1775114100000,
    event: "SHORT",
    signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1775114100000__SHORT",
  });
  assert.strictEqual(refs.signalId, "SIG__BINANCEFUT__ETHUSDT__15m__1775114100000__SHORT");
  assert.strictEqual(refs.signalDocId, "SIG__BINANCEFUT__ETHUSDT__15m__1775114100000__SHORT");
})();

(() => {
  assert.strictEqual(__test.shouldRequireLineageForFill("LONG"), true);
  assert.strictEqual(__test.shouldRequireLineageForFill("EXIT_TP_P1"), false);
})();

console.log("FILL_LINEAGE_TEST_OK");
