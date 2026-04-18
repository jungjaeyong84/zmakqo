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

  // buildIssues — refresh stale > 5min is AMBER.
  {
    const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const issues = buildIssues({
      meta: {
        sl_order_id: "S1", tp_order_id: "T1", refresh_at_iso: staleIso,
        tp_p1_done: false, trail_active: false,
      },
      exchange: {
        sl_order: { orderId: "S1", stopPrice: 100 },
        tp_order: { orderId: "T1", stopPrice: 120 },
      },
      match: { sl_present_on_exchange: true, tp_present_on_exchange: true, sl_id_matches: true, tp_id_matches: true, sl_price_matches: true, tp_price_matches: true },
      position: {},
    });
    const codes = issues.map((i) => i.code);
    assert.ok(codes.includes("PROTECTION_REFRESH_STALE"), "must flag stale refresh");
    assert.strictEqual(classifyStatus(issues), "AMBER");
  }

  console.log("PROTECTION_AUDIT_TEST_OK");
})();
