"use strict";

const assert = require("assert");
const { __test } = require("../services/exitIntegrityAudit");

function pendingFreshSkipsNativeTp1Verification() {
  const now = 1000;
  const meta = {
    tp_p1_pending: true,
    tp_p1_pending_until_ms: 2000,
  };
  const state = __test.resolveTp1PendingState(meta, now);
  assert.strictEqual(state.pending, true);
  assert.strictEqual(state.fresh, true);
  assert.strictEqual(state.expired, false);
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection(meta, now), false);
}

function pendingExpiredRequiresNativeTp1Verification() {
  const now = 3000;
  const meta = {
    tp_p1_pending: true,
    tp_p1_pending_until_ms: 2000,
  };
  const state = __test.resolveTp1PendingState(meta, now);
  assert.strictEqual(state.pending, true);
  assert.strictEqual(state.fresh, false);
  assert.strictEqual(state.expired, true);
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection(meta, now), true);
}

function pendingWithoutDeadlineRequiresNativeTp1Verification() {
  const now = 3000;
  const meta = {
    tp_p1_pending: true,
    tp_p1_pending_until_ms: null,
  };
  const state = __test.resolveTp1PendingState(meta, now);
  assert.strictEqual(state.pending, true);
  assert.strictEqual(state.unbounded, true);
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection(meta, now), true);
}

function doneOrTrailSkipsNativeTp1Verification() {
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection({ tp_p1_done: true }, 3000), false);
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection({ trail_active: true }, 3000), false);
}

function noPendingRequiresNativeTp1Verification() {
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection({}, 3000), true);
  assert.strictEqual(__test.shouldVerifyNativeTp1Protection({ tp_p1_pending: false }, 3000), true);
}

function main() {
  pendingFreshSkipsNativeTp1Verification();
  pendingExpiredRequiresNativeTp1Verification();
  pendingWithoutDeadlineRequiresNativeTp1Verification();
  doneOrTrailSkipsNativeTp1Verification();
  noPendingRequiresNativeTp1Verification();
}

main();
console.log("EXIT_INTEGRITY_TP1_PENDING_EXPIRED_TEST_OK");
