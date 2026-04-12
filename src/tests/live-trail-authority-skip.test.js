"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  const liveCfg = { executionMode: "LIVE" };
  const internalTrailSignal = { event: "EXIT_TRAIL", reason: "EXIT_TRAIL_STOP_RUNNER_FLOOR", side: "SELL" };
  const externalTrailSignal = { ...internalTrailSignal, signal_id: "SIG__EXT" };
  const tp1Signal = { event: "EXIT_TP_P1_1.65P", reason: "EXIT_TAKE_PROFIT_P1", side: "SELL" };

  assert.strictEqual(
    __test.shouldSuppressLiveFuturesInternalExitSignal({
      exchange: "BINANCEFUT",
      liveCfg,
      signal: internalTrailSignal,
    }),
    true,
    "live binance futures internal trail exits must defer to tick/native authority"
  );

  assert.strictEqual(
    __test.shouldSuppressLiveFuturesInternalExitSignal({
      exchange: "BINANCEFUT",
      liveCfg,
      signal: externalTrailSignal,
    }),
    false,
    "external trailing signals must remain consumable"
  );

  assert.strictEqual(
    __test.shouldSuppressLiveFuturesInternalExitSignal({
      exchange: "BINANCEFUT",
      liveCfg,
      signal: tp1Signal,
    }),
    false,
    "tp signals must not be suppressed by the live trail guard"
  );

  const filtered = __test.filterLiveFuturesInternalSignals({
    exchange: "BINANCEFUT",
    liveCfg,
    signals: [internalTrailSignal, externalTrailSignal, tp1Signal],
    runId: "RUN__TEST",
    symbol: "XRPUSDT",
    tf: "15m",
  });

  assert.deepStrictEqual(
    filtered,
    [externalTrailSignal, tp1Signal],
    "only internal trailing exits should be removed from live futures internal signal list"
  );

  assert.strictEqual(
    __test.shouldSuppressInternalLiveExitFillAlert({
      exchange: "BINANCEFUT",
      executionMode: "LIVE",
      intent: "EXIT",
    }),
    true,
    "live binance futures internal exit fills must defer alerts to external authoritative fills"
  );

  assert.strictEqual(
    __test.shouldSuppressInternalLiveExitFillAlert({
      exchange: "BINANCEFUT",
      executionMode: "LIVE",
      intent: "ENTRY",
    }),
    false,
    "entry fills must keep internal alerts"
  );
}

try {
  run();
  console.log("LIVE_TRAIL_AUTHORITY_SKIP_TEST_OK");
} catch (err) {
  console.error("LIVE_TRAIL_AUTHORITY_SKIP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
