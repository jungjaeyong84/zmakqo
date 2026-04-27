"use strict";

// 2026-04-28 Stage Y (root-cause fix) — historically `shouldSuppressLive
// FuturesInternalExitSignal` dropped every internal EXIT_TRAIL signal in
// BINANCEFUT LIVE on the assumption that exchange-side native trail stops
// would always close the runner. That assumption silently broke when the
// native trail-stop refresh hit EGRESS_PROXY_TIMEOUT and never updated;
// trail close then never executed. Default behaviour now lets internal
// trail signals through (so they can race the native stop, with Binance
// itself dedupping the loser via reduce-only / closePosition empty
// expiration). The legacy suppression remains available behind the
// LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS=1 kill switch for emergency
// rollback.

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function withEnv(name, value, fn) {
  const prior = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { fn(); } finally {
    if (prior === undefined) delete process.env[name];
    else process.env[name] = prior;
  }
}

function run() {
  const liveCfg = { executionMode: "LIVE" };
  const internalTrailSignal = { event: "EXIT_TRAIL", reason: "EXIT_TRAIL_STOP_RUNNER_FLOOR", side: "SELL" };
  const externalTrailSignal = { ...internalTrailSignal, signal_id: "SIG__EXT" };
  const tp1Signal = { event: "EXIT_TP_P1_2.5P", reason: "EXIT_TAKE_PROFIT_P1", side: "SELL" };

  // Default (Stage Y) — suppress OFF; internal trail signals pass through.
  withEnv("LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS", undefined, () => {
    assert.strictEqual(
      __test.shouldSuppressLiveFuturesInternalExitSignal({
        exchange: "BINANCEFUT",
        liveCfg,
        signal: internalTrailSignal,
      }),
      false,
      "Stage Y default — internal trail signals are no longer auto-suppressed"
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
      [internalTrailSignal, externalTrailSignal, tp1Signal],
      "Stage Y default — all signals (incl. internal trail) flow through"
    );
  });

  // Legacy suppress kill-switch — restores pre-Stage Y behaviour for
  // emergency rollback.
  withEnv("LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS", "1", () => {
    assert.strictEqual(
      __test.shouldSuppressLiveFuturesInternalExitSignal({
        exchange: "BINANCEFUT",
        liveCfg,
        signal: internalTrailSignal,
      }),
      true,
      "kill switch — legacy suppress restored"
    );

    assert.strictEqual(
      __test.shouldSuppressLiveFuturesInternalExitSignal({
        exchange: "BINANCEFUT",
        liveCfg,
        signal: externalTrailSignal,
      }),
      false,
      "external trail signals (signal_id present) always pass through"
    );

    assert.strictEqual(
      __test.shouldSuppressLiveFuturesInternalExitSignal({
        exchange: "BINANCEFUT",
        liveCfg,
        signal: tp1Signal,
      }),
      false,
      "TP signals are never suppressed regardless of kill switch"
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
      "kill switch — internal trail dropped, external/TP retained"
    );
  });

  // Internal-exit-fill alert suppression is unrelated to Stage Y; it stays
  // ON for BINANCEFUT LIVE EXIT fills (external/authoritative fills are the
  // alert source of truth) and OFF for ENTRY fills.
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
