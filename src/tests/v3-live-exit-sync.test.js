"use strict";

// Tests for the micro-live exit-sync pure logic (increment 2). Focus: the
// measurement math — realized R net of fees, slippage sign conventions
// (positive = favorable), bracket resolution including the both-legs-filled
// anomaly, fee summarization with non-USDT commission assets, and the
// dry-run mirror that lets the pipeline run end-to-end with zero orders.

const assert = require("assert");
const {
  buildOpenLiveEntries,
  resolveLiveExitFromBracket,
  summarizeFees,
  computeLiveRealizedMetrics,
  mirrorDryRunExit,
} = require("../v3/liveExitSync");

// ---- buildOpenLiveEntries ---------------------------------------------------
(() => {
  const entries = [
    { signal_id: "A", status: "OPEN", dry_run: false },
    { signal_id: "B", status: "OPEN_BRACKET_INCOMPLETE", dry_run: false },
    { signal_id: "C", status: "DRY_RUN", dry_run: true },
    { signal_id: "D", status: "OPEN", dry_run: false },   // already closed below
    { signal_id: "E", status: "ERROR", dry_run: false },  // never opened
  ];
  const exits = [{ signal_id: "D", status: "CLOSED" }];
  const r = buildOpenLiveEntries(entries, exits);
  assert.deepStrictEqual(r.real.map((x) => x.signal_id), ["A", "B"]);
  assert.deepStrictEqual(r.dry_run.map((x) => x.signal_id), ["C"]);
})();

// ---- resolveLiveExitFromBracket --------------------------------------------
(() => {
  const open = { status: "NEW", orderId: 1 };
  assert.strictEqual(resolveLiveExitFromBracket({ stopOrder: open, tpOrder: { status: "NEW", orderId: 2 } }), null, "still open");
  const r1 = resolveLiveExitFromBracket({ stopOrder: { status: "FILLED", orderId: 1, avgPrice: "98" }, tpOrder: { status: "NEW", orderId: 2 } });
  assert.strictEqual(r1.exit_event, "SL_HIT");
  assert.strictEqual(r1.sibling_order_id, 2, "surviving TP leg must be reported for cancellation");
  const r2 = resolveLiveExitFromBracket({ stopOrder: open, tpOrder: { status: "FILLED", orderId: 2 } });
  assert.strictEqual(r2.exit_event, "TP_HIT");
  // anomaly: both filled — earlier updateTime wins, anomaly flagged
  const r3 = resolveLiveExitFromBracket({
    stopOrder: { status: "FILLED", orderId: 1, updateTime: 100 },
    tpOrder: { status: "FILLED", orderId: 2, updateTime: 200 },
  });
  assert.strictEqual(r3.exit_event, "SL_HIT");
  assert.strictEqual(r3.anomaly, "BOTH_BRACKET_LEGS_FILLED");
})();

// ---- summarizeFees ----------------------------------------------------------
(() => {
  const trades = [
    { orderId: 11, commission: "0.004", commissionAsset: "USDT" },
    { orderId: 11, commission: "0.003", commissionAsset: "USDT" }, // partial fills
    { orderId: 22, commission: "0.002", commissionAsset: "USDT" },
    { orderId: 22, commission: "0.0001", commissionAsset: "BNB" },
    { orderId: 99, commission: "5", commissionAsset: "USDT" },     // unrelated order
  ];
  const f = summarizeFees(trades, [11, 22]);
  assert.ok(Math.abs(f.fee_usdt - 0.009) < 1e-12);
  assert.ok(Math.abs(f.other_assets.BNB - 0.0001) < 1e-12, "non-USDT commissions surfaced, not folded in");
})();

// ---- computeLiveRealizedMetrics — SHORT SL with slippage + fees -------------
(() => {
  // SHORT: signal 100, stop 102 (risk 2/unit), target 97.6 (RR 1.2), qty 0.2
  // actual: entered at 100.1 (favorable for SHORT = entered HIGHER... no:
  // SHORT enters by selling — higher entry is favorable). exit stopped at
  // 102.3 (worse than 102). fees 0.008 USDT.
  const m = computeLiveRealizedMetrics({
    entryRow: { side: "SHORT", signal_price: 100, stop_price: 102, target_price: 97.6, qty: 0.2 },
    exitEvent: "SL_HIT",
    entryAvgPrice: 100.1,
    exitAvgPrice: 102.3,
    feeUsdt: 0.008,
  });
  // gross R = dir*(exit-entry)/risk = -1*(102.3-100.1)/2 = -1.1
  assert.ok(Math.abs(m.realized_r_gross - (-1.1)) < 1e-9);
  // entry slippage = dir*(sig-entry)/risk = -1*(100-100.1)/2 = +0.05 (favorable)
  assert.ok(Math.abs(m.slippage_entry_r - 0.05) < 1e-9);
  // exit slippage vs stop 102 = -1*(102.3-102)/2 = -0.15 (adverse)
  assert.ok(Math.abs(m.slippage_exit_r - (-0.15)) < 1e-9);
  // risk_usdt = 2*0.2 = 0.4 ; fee_r = 0.008/0.4 = 0.02 ; net = -1.12
  assert.ok(Math.abs(m.fee_r - 0.02) < 1e-9);
  assert.ok(Math.abs(m.realized_r - (-1.12)) < 1e-9);
})();

// ---- computeLiveRealizedMetrics — LONG TP clean -----------------------------
(() => {
  const m = computeLiveRealizedMetrics({
    entryRow: { side: "LONG", signal_price: 50, stop_price: 49, target_price: 51.55, qty: 0.4 },
    exitEvent: "TP_HIT",
    entryAvgPrice: 50,
    exitAvgPrice: 51.55,
    feeUsdt: 0,
  });
  assert.ok(Math.abs(m.realized_r_gross - 1.55) < 1e-9);
  assert.strictEqual(m.slippage_entry_r, 0);
  assert.strictEqual(m.slippage_exit_r, 0);
  assert.ok(Math.abs(m.realized_r - 1.55) < 1e-9);
})();

// ---- mirrorDryRunExit --------------------------------------------------------
(() => {
  const entry = { signal_id: "S1", symbol: "btcusdt", side: "short", signal_price: 100, dry_run: true, status: "DRY_RUN" };
  const paperExit = { signal_id: "S1", status: "CLOSED", closed_at: "2026-07-15T04:00:00.000Z", exit_event: "TP_HIT", exit_price: 97.6, realized_r: 1.2 };
  const row = mirrorDryRunExit(entry, paperExit);
  assert.strictEqual(row.status, "CLOSED");
  assert.strictEqual(row.dry_run, true);
  assert.strictEqual(row.realized_r, 1.2);
  assert.strictEqual(row.fee_r, 0);
  assert.strictEqual(row.slippage_entry_r, 0);
  // mismatched signal or still-open paper exit → null
  assert.strictEqual(mirrorDryRunExit(entry, { ...paperExit, signal_id: "S2" }), null);
  assert.strictEqual(mirrorDryRunExit(entry, { ...paperExit, status: "OPEN" }), null);
})();

console.log("v3-live-exit-sync.test.js PASS");
