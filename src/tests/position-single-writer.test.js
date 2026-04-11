"use strict";

const assert = require("assert");
const { __test } = require("../storage/positionsPaper");

async function run() {
  const order = [];
  const concurrent = [];

  const first = __test.serializePositionMutation({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    runner: async () => {
      order.push("start-1");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("end-1");
      return "first";
    },
  });

  const second = __test.serializePositionMutation({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    runner: async () => {
      order.push("start-2");
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("end-2");
      return "second";
    },
  });

  const third = __test.serializePositionMutation({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    runner: async () => {
      concurrent.push("eth-start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      concurrent.push("eth-end");
      return "third";
    },
  });

  const results = await Promise.all([first, second, third]);
  assert.deepStrictEqual(results, ["first", "second", "third"]);
  assert.deepStrictEqual(order, ["start-1", "end-1", "start-2", "end-2"]);
  assert.deepStrictEqual(concurrent, ["eth-start", "eth-end"]);

  console.log("POSITION_SINGLE_WRITER_TEST_OK");
}

run().catch((err) => {
  console.error("POSITION_SINGLE_WRITER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
