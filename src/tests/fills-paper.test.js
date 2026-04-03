"use strict";

const assert = require("assert");
const { __test } = require("../storage/fillsPaper");

(() => {
  assert.strictEqual(
    __test.canonicalEventId({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      tf: "15m",
      signalBarCloseMs: 1775091600000,
      event: "LONG",
      side: "BUY",
    }),
    "EVENT__BINANCEFUT__BTCUSDT__15m__1775091600000__LONG__BUY"
  );
  console.log("FILLS_PAPER_TEST_OK");
})();
