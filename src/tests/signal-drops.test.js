const assert = require("assert");

const { __test } = require("../storage/signalDrops");

function run() {
  const liveDrop = {
    signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG",
    execution_mode: "LIVE",
    features_json: {
      strategy_id: "donbeolja_v6.0.3.1",
    },
  };
  assert.strictEqual(__test.pickDropStrategyId(liveDrop), "donbeolja_v6.0.3.1");
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(liveDrop), true);

  const paperDrop = {
    signal_id: liveDrop.signal_id,
    execution_mode: "PAPER",
    features_json: {
      strategy_id: "donbeolja_v6.0.3.1",
    },
  };
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(paperDrop), false);

  const missingStrategy = {
    signal_id: liveDrop.signal_id,
    execution_mode: "LIVE",
    features_json: {},
  };
  assert.strictEqual(__test.pickDropStrategyId(missingStrategy), null);
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(missingStrategy), false);

  const topLevelStrategy = {
    signal_id: liveDrop.signal_id,
    execution_mode: "LIVE",
    strategy_id: "donbeolja_v6.0.3.1",
  };
  assert.strictEqual(__test.pickDropStrategyId(topLevelStrategy), "donbeolja_v6.0.3.1");
  assert.strictEqual(__test.shouldConfirmSelfEvolutionFromDrop(topLevelStrategy), true);

  assert.strictEqual(
    __test.deriveCanonicalEventId({
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      tf: "15m",
      barCloseMs: 1774860300000,
      event: "LONG",
      side: "BUY",
    }),
    "EVENT__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG__BUY"
  );

  console.log("SIGNAL_DROPS_TEST_OK");
}

run();
