const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

(() => {
  const internal = {
    event: "LONG",
    side: "BUY",
    qty_pct: 0.5,
    reason: "SERVER_INTERNAL",
    features: {},
  };
  const external = {
    signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
    signal_doc_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
    event: "LONG",
    side: "BUY",
    qty_pct: 0.325,
    reason: "TV_WEBHOOK",
    features: {
      signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
      signal_doc_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
      _openclaw_executor_reason: "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE",
    },
  };

  const deduped = __test.dedupeEntrySignalsByFamily([internal, external]);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].signal_id, external.signal_id);
  assert.strictEqual(deduped[0].qty_pct, 0.325);
})();

(() => {
  const internal = {
    event: "LONG",
    side: "BUY",
    qty_pct: 0.5,
    reason: "SERVER_INTERNAL",
    features: {},
  };
  const external = {
    signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
    event: "LONG",
    side: "BUY",
    qty_pct: 0.325,
    reason: "TV_WEBHOOK",
    features: {
      signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1776148200000__LONG",
      _openclaw_executor_reason: "OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE",
    },
  };

  const resolved = __test.resolveEntrySignalsByFamily([internal, external]);
  assert.strictEqual(resolved.signals.length, 1);
  assert.strictEqual(resolved.resolutions.length, 1);
  assert.strictEqual(resolved.resolutions[0].selected_signal_id, external.signal_id);
  assert.strictEqual(resolved.resolutions[0].selected_external, true);
  assert.strictEqual(resolved.resolutions[0].suppressed_external, false);
  assert.strictEqual(resolved.resolutions[0].suppressed_qty_pct, 0.5);
})();

(() => {
  const external = {
    signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1776148200000__LONG",
    event: "LONG",
    side: "BUY",
    qty_pct: 0.325,
    reason: "TV_WEBHOOK",
    features: {
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1776148200000__LONG",
    },
  };
  const internal = {
    event: "LONG",
    side: "BUY",
    qty_pct: 0.5,
    reason: "SERVER_INTERNAL",
    features: {},
  };

  const deduped = __test.dedupeEntrySignalsByFamily([external, internal]);
  assert.strictEqual(deduped.length, 1);
  assert.strictEqual(deduped[0].signal_id, external.signal_id);
})();

(() => {
  const exitSignal = {
    event: "EXIT_TP_P1_1.65P",
    side: "SELL",
    qty_pct: 0.5,
    reason: "EXIT",
    features: {},
  };
  const internal = {
    event: "LONG",
    side: "BUY",
    qty_pct: 0.5,
    reason: "SERVER_INTERNAL",
    features: {},
  };
  const external = {
    signal_id: "SIG__BINANCEFUT__SOLUSDT__15m__1776148200000__LONG",
    event: "LONG",
    side: "BUY",
    qty_pct: 0.325,
    reason: "TV_WEBHOOK",
    features: {
      signal_id: "SIG__BINANCEFUT__SOLUSDT__15m__1776148200000__LONG",
    },
  };

  const deduped = __test.dedupeEntrySignalsByFamily([internal, exitSignal, external]);
  assert.strictEqual(deduped.length, 2);
  assert.strictEqual(deduped[0].signal_id, external.signal_id);
  assert.strictEqual(deduped[1].event, "EXIT_TP_P1_1.65P");
})();

console.log("paper-binance-runner-signal-dedupe.test.js OK");
