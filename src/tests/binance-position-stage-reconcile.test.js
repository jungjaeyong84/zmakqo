const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.strictEqual(typeof __test.pickLatestTpP0Fill, "function", "pickLatestTpP0Fill export missing");
  assert.strictEqual(typeof __test.reconcileTpP0MetaFromFill, "function", "reconcileTpP0MetaFromFill export missing");
  assert.strictEqual(typeof __test.pickLatestTpP1Fill, "function", "pickLatestTpP1Fill export missing");
  assert.strictEqual(typeof __test.reconcileTpP1MetaFromFill, "function", "reconcileTpP1MetaFromFill export missing");

  const rows = [
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P0_0.8P",
      exec_price: 0.1,
      close_ratio: 0.25,
      entry_event_id: "SIG1",
      exec_bar_close_time_utc_ms: 1000,
      created_at: "2026-04-10T00:00:01.000Z",
    },
    {
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      event: "EXIT_TP_P1_1.65P",
      exec_price: 0.11,
      close_ratio: 0.5,
      entry_event_id: "SIG1",
      exec_bar_close_time_utc_ms: 2000,
      created_at: "2026-04-10T00:00:02.000Z",
    },
  ];

  const tp0 = __test.pickLatestTpP0Fill(rows, "BINANCEFUT", "DOGEUSDT");
  assert.strictEqual(tp0.event, "EXIT_TP_P0_0.8P");

  const tp1 = __test.pickLatestTpP1Fill(rows, "BINANCEFUT", "DOGEUSDT");
  assert.strictEqual(tp1.event, "EXIT_TP_P1_1.65P");

  const baseMeta = {
    entry_event_id: "SIG1",
    entry_exec_bar_ms: 500,
    tp_p0_done: false,
    tp_p1_done: false,
    tp_p1_pending: false,
    trail_active: false,
  };

  // 2026-04-28 senior audit Step 13 — drift fix. V1 TP0 retired in
  // Stage Z (DEFAULT_SIMPLIFIED_EXIT_V2_ENABLED=true), so any reconcile
  // call without an explicit `simplified_exit_v2_enabled: false` falls
  // through the simplified-exit-v2 short-circuit at line 5760 of
  // paperBinanceRunner.js → posMeta is returned unchanged. The legacy
  // "tp0 fill projects tp_p0_done=true" path now requires explicit
  // opt-out.
  const afterTp0 = __test.reconcileTpP0MetaFromFill({
    posMeta: baseMeta,
    pos: { exchange: "BINANCEFUT", position_side: "LONG" },
    fill: tp0,
  });
  assert.strictEqual(afterTp0.tp_p0_done, false, "post-retirement default — no V1 TP0 projection");
  assert.strictEqual(afterTp0.tp_p0_price, undefined);

  // Legacy V1 TP0 path is preserved behind explicit
  // `simplified_exit_v2_enabled: false` — used by historical replay
  // and the legacy backfill harness.
  const legacyAfterTp0 = __test.reconcileTpP0MetaFromFill({
    posMeta: { ...baseMeta, simplified_exit_v2_enabled: false },
    pos: { exchange: "BINANCEFUT", position_side: "LONG" },
    fill: tp0,
  });
  assert.strictEqual(legacyAfterTp0.tp_p0_done, true, "legacy opt-out — V1 TP0 projection still works");
  assert.strictEqual(legacyAfterTp0.tp_p0_price, 0.1);

  const simplifiedAfterTp0 = __test.reconcileTpP0MetaFromFill({
    posMeta: {
      ...baseMeta,
      simplified_exit_v2_enabled: true,
    },
    pos: { exchange: "BINANCEFUT", position_side: "LONG" },
    fill: tp0,
  });
  assert.strictEqual(simplifiedAfterTp0.tp_p0_done, false, "simplified v2 must ignore tp0 reconcile projection");
  assert.strictEqual(simplifiedAfterTp0.tp_p0_price, undefined);

  const afterTp1 = __test.reconcileTpP1MetaFromFill({
    posMeta: afterTp0,
    pos: { exchange: "BINANCEFUT", position_side: "LONG" },
    fill: tp1,
  });
  assert.strictEqual(afterTp1.tp_p1_done, true);
  assert.strictEqual(afterTp1.tp_p1_price, 0.11);
  assert.strictEqual(afterTp1.trail_active, false);

  console.log("BINANCE_POSITION_STAGE_RECONCILE_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
