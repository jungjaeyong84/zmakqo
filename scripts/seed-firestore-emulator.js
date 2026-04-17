#!/usr/bin/env node
"use strict";

// P3-05 — seed the Firestore emulator with a minimal fixture so the deploy
// gate can run end-to-end without touching production data.
//
// Usage:
//   1. Start the emulator:
//        gcloud emulators firestore start --host-port=127.0.0.1:8080
//   2. Export the endpoint in the same shell as the gate:
//        export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
//        export GCLOUD_PROJECT=donbeolja-emulator
//   3. Run this seed script:
//        node scripts/seed-firestore-emulator.js
//   4. Run the gate:
//        npm run check:binance-exit-integrity-gate
//
// The fixture set is intentionally tiny — one active BINANCEFUT position with
// a clean exit ledger, a matching pending intent, one verified TP1 fill, and
// no open drops. It exists only so the gate can complete without production
// reads; real validation still happens in staging.

const { getFirestore, isFirestoreEmulatorConfigured } = require("../src/storage/firestore");

function iso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

async function main() {
  if (!isFirestoreEmulatorConfigured()) {
    console.error("[SEED_FIRESTORE_EMULATOR] FIRESTORE_EMULATOR_HOST is not set. Refusing to seed against live Firestore.");
    process.exit(1);
  }

  const db = getFirestore();

  const exchange = "BINANCEFUT";
  const symbol = "BTCUSDT";
  const entryEventId = "ENTRY__seed__1";
  const chainKey = `${exchange}__${symbol}__ENTRY__${entryEventId}`;
  const tf = "15m";

  const writes = [];

  writes.push(db.collection("positions_paper").doc(`POS__${exchange}__${symbol}`).set({
    exchange,
    symbol,
    state: "ACTIVE",
    position_state: "COMMIT",
    size_pct: 0.5,
    qty_base: 0.01,
    avg_price: 50000,
    leverage: 2,
    position_side: "LONG",
    entry_qty_base: 0.02,
    execution_mode: "LIVE",
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p0_done: false,
      tp_p1_done: true,
      trail_active: true,
      entry_event_id: entryEventId,
      canonical_exit_chain_key: chainKey,
      canonical_exit_stage: "TRAIL",
      entry_qty_base: 0.02,
      entry_qty_abs: 0.02,
      tp_p1_allowed_qty_abs: 0.01,
      tp_p1_consumed_qty_abs: 0.01,
      runner_allowed_qty_abs: 0.01,
      runner_remaining_qty_abs: 0.01,
    },
    created_at: iso(-60 * 60 * 1000),
    updated_at: iso(),
  }, { merge: true }));

  writes.push(db.collection("order_intents_paper").doc("INTENT__seed__entry_1").set({
    exchange,
    symbol,
    tf,
    event: "ENTRY_LONG_REAL",
    side: "BUY",
    intent_id: "INTENT__seed__entry_1",
    status: "FILLED",
    qty_fraction: 0.5,
    entry_event_id: entryEventId,
    created_at: iso(-120 * 60 * 1000),
    updated_at: iso(-60 * 60 * 1000),
  }, { merge: true }));

  writes.push(db.collection("fills_paper").doc("EXT__seed__tp1").set({
    exchange,
    symbol,
    event: "EXIT_TP_P1_3P",
    fill_id: "EXT__seed__tp1",
    entry_event_id: entryEventId,
    canonical_exit_chain_key: chainKey,
    side: "SELL",
    qty_pct: 0.5,
    qty_base: 0.01,
    price: 50500,
    created_at: iso(-30 * 60 * 1000),
  }, { merge: true }));

  writes.push(db.collection("trade_alert_outbox").doc("ALERT__seed__tp1").set({
    exchange,
    symbol,
    alert_type: "TRADE_EXECUTION_ALERT",
    canonical_exit_chain_key: chainKey,
    entry_event_id: entryEventId,
    sent_ok: true,
    created_at: iso(-29 * 60 * 1000),
  }, { merge: true }));

  writes.push(db.collection("position_exit_authority_state").doc(chainKey).set({
    chain_key: chainKey,
    exchange,
    symbol,
    entry_event_id: entryEventId,
    state: {
      tp0: 0,
      tp1: 0.5,
      trail: 0,
      sl: 0,
      forceExitAll: 0,
      forceExitHalf: 0,
      otherExit: 0,
      total: 0.5,
    },
    schema_version: 1,
    updated_at: iso(-30 * 60 * 1000),
  }, { merge: true }));

  await Promise.all(writes);

  console.log(JSON.stringify({
    ok: true,
    seeded: writes.length,
    exchange,
    symbol,
    chain_key: chainKey,
    emulator_host: process.env.FIRESTORE_EMULATOR_HOST,
    project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || null,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SEED_FIRESTORE_EMULATOR_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = { main };
}
