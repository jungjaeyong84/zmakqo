"use strict";

const assert = require("assert");
const firestoreStorage = require("../storage/firestore");
const {
  prepareFillSyncTradeAlertGate,
  markFillSyncTradeAlertGateResult,
  __test,
} = require("../storage/fillSyncTradeAlertGate");

async function run() {
  const originalGetFirestore = firestoreStorage.getFirestore;
  firestoreStorage.getFirestore = () => null;
  __test.fallbackGateState.clear();
  try {
    const first = await prepareFillSyncTradeAlertGate({
      key: "DOGEUSDT|EXIT_TP_P1_2.5P|EXIT|SELL|96035243539|doge_tp1_same_order",
      cooldownMs: 60_000,
      nowMs: 1_777_900_000_000,
    });
    assert.strictEqual(first.send, true, "first claimant must acquire the fill-sync trade alert gate");
    assert.ok(first.gateId, "gate must return a persistent gate id");
    assert.ok(first.claimToken, "gate must return a claim token");

    const concurrent = await prepareFillSyncTradeAlertGate({
      key: "DOGEUSDT|EXIT_TP_P1_2.5P|EXIT|SELL|96035243539|doge_tp1_same_order",
      cooldownMs: 60_000,
      nowMs: 1_777_900_000_100,
    });
    assert.strictEqual(concurrent.send, false, "second claimant must not bypass an active claim");
    assert.strictEqual(concurrent.reason, "CLAIM_HELD");

    const marked = await markFillSyncTradeAlertGateResult({
      gateId: first.gateId,
      claimToken: first.claimToken,
      ok: true,
      skipped: false,
      reason: null,
      nowMs: 1_777_900_000_200,
    });
    assert.strictEqual(marked.ok, true, "winning claimant must be able to finalize the gate");

    const cooldown = await prepareFillSyncTradeAlertGate({
      key: "DOGEUSDT|EXIT_TP_P1_2.5P|EXIT|SELL|96035243539|doge_tp1_same_order",
      cooldownMs: 60_000,
      nowMs: 1_777_900_030_000,
    });
    assert.strictEqual(cooldown.send, false, "same fill-sync chain must be suppressed during cooldown");
    assert.strictEqual(cooldown.reason, "COOLDOWN_ACTIVE");

    const afterCooldown = await prepareFillSyncTradeAlertGate({
      key: "DOGEUSDT|EXIT_TP_P1_2.5P|EXIT|SELL|96035243539|doge_tp1_same_order",
      cooldownMs: 60_000,
      nowMs: 1_777_900_070_000,
    });
    assert.strictEqual(afterCooldown.send, true, "same chain must be eligible again after cooldown expires");

    console.log("FILL_SYNC_TRADE_ALERT_GATE_TEST_OK");
  } finally {
    firestoreStorage.getFirestore = originalGetFirestore;
    __test.fallbackGateState.clear();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
