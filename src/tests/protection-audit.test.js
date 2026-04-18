"use strict";

// Unit tests for protectionAudit — the service that powers
// /dashboard/protection. We don't hit real Firestore / Binance here;
// we exercise the pure helpers (price tolerance, order classification,
// issue detection, status rollup) with hand-crafted fixtures that
// cover every severity code the UI renders.

const assert = require("assert");
const { __test } = require("../services/protectionAudit");
const {
  pricesMatch,
  classifyOrder,
  extractMetaView,
  buildIssues,
  classifyStatus,
  pickSlOrder,
  pickTpOrder,
} = __test;

(function run() {
  // pricesMatch — 0.5% tolerance.
  assert.strictEqual(pricesMatch(100, 100), true);
  assert.strictEqual(pricesMatch(100, 100.4), true, "0.4% drift must match");
  assert.strictEqual(pricesMatch(100, 100.6), false, "0.6% drift must NOT match");
  assert.strictEqual(pricesMatch(null, 100), false);
  assert.strictEqual(pricesMatch(0, 0), true);
  assert.strictEqual(pricesMatch(0, 1), false);

  // classifyOrder
  assert.strictEqual(classifyOrder({ type: "STOP_MARKET" }), "SL");
  assert.strictEqual(classifyOrder({ type: "TAKE_PROFIT_MARKET" }), "TP");
  assert.strictEqual(classifyOrder({ type: "LIMIT" }), null);
  assert.strictEqual(classifyOrder({ orderType: "STOP" }), "SL");

  // pickSlOrder prefers closePosition:true.
  const stopA = { type: "STOP_MARKET", orderId: 1, closePosition: false };
  const stopB = { type: "STOP_MARKET", orderId: 2, closePosition: true };
  assert.strictEqual(pickSlOrder([stopA, stopB]).orderId, 2);

  // pickTpOrder prefers reduceOnly:true.
  const tpA = { type: "TAKE_PROFIT_MARKET", orderId: 10, reduceOnly: false };
  const tpB = { type: "TAKE_PROFIT_MARKET", orderId: 11, reduceOnly: true };
  assert.strictEqual(pickTpOrder([tpA, tpB]).orderId, 11);

  // extractMetaView — maps heterogeneous keys to a stable view.
  const view = extractMetaView({
    meta: {
      native_protection_stop_order_id: "abc",
      native_protection_stop_price: 100.5,
      native_protection_tp_order_id: "xyz",
      native_protection_tp_price: 120,
      trail_active: true,
      tp_p1_done: true,
      native_protection_refresh_status: "OK",
      native_protection_refresh_at_ms: Date.now() - 60 * 1000,
    },
  });
  assert.strictEqual(view.sl_order_id, "abc");
  assert.strictEqual(view.trail_active, true);
  assert.strictEqual(view.tp_p1_done, true);
  assert.ok(view.refresh_at_iso && view.refresh_at_iso.endsWith("Z"));

  // buildIssues — RED when SL is missing on exchange.
  {
    const issues = buildIssues({
      meta: { sl_order_id: null, tp_order_id: null, refresh_at_iso: null, tp_p1_done: false, trail_active: false },
      exchange: { sl_order: null, tp_order: null },
      match: { sl_present_on_exchange: false, tp_present_on_exchange: false, sl_id_matches: false, tp_id_matches: false, sl_price_matches: false, tp_price_matches: false },
      position: {},
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("SL_MISSING_ON_EXCHANGE"), "must flag SL missing");
    assert.ok(codes.includes("TP_MISSING_ON_EXCHANGE"), "must flag TP missing");
    assert.strictEqual(classifyStatus(issues), "RED");
  }

  // buildIssues — trail_active without tp1_done must be RED (invariant break).
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: "s1", tp_order_id: "t1", refresh_at_iso: new Date().toISOString(),
        tp_p1_done: false, trail_active: true,
      },
      exchange: { sl_order: { orderId: "s1", stopPrice: 100 }, tp_order: { orderId: "t1", stopPrice: 120 } },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: {},
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("TRAIL_WITHOUT_TP1"),
      "trail_active=true + tp_p1_done=false must flag invariant break");
    assert.strictEqual(classifyStatus(issues), "RED");
  }

  // buildIssues — id mismatch is RED.
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: "EXPECTED", tp_order_id: null, refresh_at_iso: new Date().toISOString(),
        tp_p1_done: false, trail_active: false,
      },
      exchange: { sl_order: { orderId: "ACTUAL", stopPrice: 100 }, tp_order: null },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: false, sl_id_matches: false, tp_id_matches: false, sl_price_matches: false, tp_price_matches: false },
      position: {},
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("SL_ORDER_ID_MISMATCH"), "must flag id mismatch");
    assert.strictEqual(classifyStatus(issues), "RED");
  }

  // buildIssues — DB missing id but exchange has it is AMBER (reconciler lag).
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: null, tp_order_id: null, refresh_at_iso: new Date().toISOString(),
        tp_p1_done: false, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 100 },
        tp_order: { orderId: "T1", stopPrice: 120 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: false, tp_id_matches: false, sl_price_matches: false, tp_price_matches: false },
      position: {},
    });
    assert.strictEqual(classifyStatus(issues), "AMBER",
      "DB meta lagging behind exchange should be AMBER, not RED");
  }

  // buildIssues — everything in sync is GREEN.
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: "S1", sl_price: 100, tp_order_id: "T1", tp_price: 120,
        refresh_at_iso: new Date().toISOString(), tp_p1_done: false, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 100 },
        tp_order: { orderId: "T1", stopPrice: 120 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: {},
    });
    assert.strictEqual(issues.length, 0, `expected no issues, got ${JSON.stringify(issues)}`);
    assert.strictEqual(classifyStatus(issues), "GREEN");
  }

  // 2026-04-18 regression guard: refresh staleness should NOT trigger any
  // issue. The refresh codepath is event-driven (entry/add/exit/trail),
  // not a periodic heartbeat, so "10 minutes since last refresh" is normal
  // for a quiet position.
  {
    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const issues = buildIssues({
      meta: {
        sl_order_id: "S1", sl_price: 100, tp_order_id: "T1", tp_price: 120,
        refresh_at_iso: staleIso,
        tp_p1_done: false, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 100 },
        tp_order: { orderId: "T1", stopPrice: 120, origQty: 1 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: { qty_base: 1 },
    });
    const codes = issues.map((i) => i.code);
    assert.ok(!codes.includes("PROTECTION_REFRESH_STALE"),
      "refresh staleness must NOT be flagged — it's event-driven");
    assert.ok(!codes.includes("PROTECTION_REFRESH_NEVER_RAN"),
      "refresh-never-ran must NOT be flagged when SL/TP exist on exchange");
    assert.strictEqual(classifyStatus(issues), "GREEN",
      "healthy position with stale refresh should be GREEN");
  }

  // evaluateBreakEvenFloor — TP1 done + stop below floor → STOP_BELOW_FLOOR.
  {
    const { evaluateBreakEvenFloor } = __test;
    // LONG entry 100, stop at 99 (0.99 of entry), tp1 done → floor should be 100.3
    const bf = evaluateBreakEvenFloor({
      meta: { tp_p1_done: true, entry_price: 100, sl_price: 99 },
      position: { position_side: "LONG" },
    });
    assert.strictEqual(bf.applicable, true);
    assert.strictEqual(bf.status, "STOP_BELOW_FLOOR",
      "LONG stop at 99 with entry 100 must violate BE floor");
  }
  {
    const { evaluateBreakEvenFloor } = __test;
    // LONG entry 100, stop at 100.3 (exactly at floor) → OK
    const bf = evaluateBreakEvenFloor({
      meta: { tp_p1_done: true, entry_price: 100, sl_price: 100.3 },
      position: { position_side: "LONG" },
    });
    assert.strictEqual(bf.status, "OK");
  }
  {
    const { evaluateBreakEvenFloor } = __test;
    // Not yet TP1 done — not applicable
    const bf = evaluateBreakEvenFloor({
      meta: { tp_p1_done: false, entry_price: 100, sl_price: 99 },
      position: { position_side: "LONG" },
    });
    assert.strictEqual(bf.applicable, false);
  }
  {
    const { evaluateBreakEvenFloor } = __test;
    // SHORT entry 100, stop at 101 (above floor 99.7, breach) → STOP_BELOW_FLOOR
    const bf = evaluateBreakEvenFloor({
      meta: { tp_p1_done: true, entry_price: 100, sl_price: 101 },
      position: { position_side: "SHORT" },
    });
    assert.strictEqual(bf.status, "STOP_BELOW_FLOOR");
  }

  // buildIssues integration: BE_STOP_NOT_RAISED_AFTER_TP1 appears as AMBER.
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: "S1", sl_price: 99, entry_price: 100,
        tp_order_id: "T1", tp_price: 103,
        refresh_at_iso: new Date().toISOString(),
        tp_p1_done: true, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 99 },
        tp_order: { orderId: "T1", stopPrice: 103, origQty: 1 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: { qty_base: 1, position_side: "LONG" },
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("BE_STOP_NOT_RAISED_AFTER_TP1"),
      "TP1 done + stop below BE floor must flag BE_STOP_NOT_RAISED_AFTER_TP1");
    assert.ok(codes.includes("TRAIL_DISARMED_AFTER_TP1"),
      "(sanity) trail disarmed after tp1 also fires here");
    // 둘 다 AMBER 니까 overall AMBER.
    assert.strictEqual(classifyStatus(issues), "AMBER");
  }

  // buildIssues — TP quantity exceeds position size → RED.
  {
    const issues = buildIssues({
      meta: {
        sl_order_id: "S1", sl_price: 100, tp_order_id: "T1", tp_price: 120,
        refresh_at_iso: new Date().toISOString(),
        tp_p1_done: false, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 100 },
        tp_order: { orderId: "T1", stopPrice: 120, origQty: 5 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: { qty_base: 1 },
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("TP_QTY_EXCEEDS_POSITION"),
      "must flag over-sized TP order");
    assert.strictEqual(classifyStatus(issues), "RED");
  }

  console.log("PROTECTION_AUDIT_TEST_OK");
})();
