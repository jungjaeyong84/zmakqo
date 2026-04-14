"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function kinds(list) {
  return list.map((x) => String(x.kind || "").toUpperCase()).sort();
}

(() => {
  const pos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      native_protection_refresh_status: "OK",
      native_protection_stale: false,
      native_protection_stop_order_id: "1",
      native_protection_tp_order_id: "2",
      native_protection_tp_status: "OK",
      native_protection_stop_price: 98.35,
      native_protection_tp_price: 103.25,
      tp_p1_done: false,
      trail_active: false,
    },
  };
  const rules = {
    SL: -0.0165,
    TP_P1: 0.0325,
    TRAIL_R_MULTIPLE: 0.9,
    TRAIL_PCT: 0.01,
    BE_ENABLE: true,
  };
  const triggerKinds = kinds(__test.computeExitTriggers({ pos, rules, leverageEff: 2 }));
  assert(!triggerKinds.includes("SL"), "native stop active should suppress internal SL trigger");
  assert(!triggerKinds.includes("TP_P1"), "native tp active should suppress internal TP1 trigger");
})();

(() => {
  const pos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      native_protection_refresh_status: "OK",
      native_protection_stale: false,
      native_protection_stop_order_id: "1",
      native_protection_tp_order_id: "2",
      native_protection_tp_status: "OK",
      native_protection_stop_price: 98.35,
      native_protection_tp_price: 103.25,
      tp_p1_done: false,
      trail_active: false,
    },
  };
  const rules = {
    SL: -0.0165,
    TP_P1: 0.0325,
    TRAIL_R_MULTIPLE: 0.9,
    TRAIL_PCT: 0.01,
    BE_ENABLE: true,
  };
  const triggerKinds = kinds(__test.computeExitTriggers({
    pos,
    rules,
    leverageEff: 2,
    nativeProtectionState: { stopActive: false, tpActive: false },
  }));
  assert(triggerKinds.includes("SL"), "live verification override should restore internal SL trigger when native stop is missing");
  assert(triggerKinds.includes("TP_P1"), "live verification override should restore internal TP1 trigger when native TP is missing");
})();

(() => {
  const pos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      native_protection_refresh_status: "OK",
      native_protection_stale: false,
      native_protection_stop_order_id: "1",
      native_protection_tp_order_id: "2",
      native_protection_tp_status: "OK",
      tp_p1_done: true,
      trail_active: true,
      trail_high: 104,
    },
  };
  const rules = {
    SL: -0.0165,
    TP_P1: 0.0325,
    TRAIL_R_MULTIPLE: 0.9,
    TRAIL_PCT: 0.01,
    BE_ENABLE: true,
  };
  const triggerKinds = kinds(__test.computeExitTriggers({ pos, rules, leverageEff: 2 }));
  assert(triggerKinds.includes("TRAIL"), "trailing trigger must remain active after TP1");
})();

(() => {
  const pos = {
    exchange: "BINANCEFUT",
    avg_price: 100,
    position_side: "LONG",
    meta: {
      native_protection_refresh_status: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER",
      native_protection_stale: true,
      tp_p1_done: false,
      trail_active: false,
    },
  };
  const eager = __test.shouldEagerRefreshNativeProtection({
    pos,
    nativeProtectionState: { stopActive: false, tpActive: false },
  });
  assert.strictEqual(eager.needed, true);
  assert.strictEqual(eager.needsStop, true);
  assert.strictEqual(eager.needsTp, true);
  assert.strictEqual(eager.reason, "REPAIR_REQUESTED_NON_AUTHORITY_LAYER");
})();

console.log("NATIVE_PROTECTION_TRIGGER_SKIP_TEST_OK");
