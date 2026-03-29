#!/usr/bin/env bash
set -e

BAR_MS=1766253600000
INTENT_ID="INTENT__UPBIT__KRW-BTC__60m__1766250000000__ENTRY_CORE_50"
FILL_ID="FILL__${INTENT_ID}__${BAR_MS}"
POS_ID="POS__UPBIT__KRW-BTC"
TRADE_ID="TRADE__UPBIT__KRW-BTC__ENTRY_CORE_50__${BAR_MS}"

node - <<'NODE'
require('dotenv').config();
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });

(async () => {
  const db = admin.firestore();

  const INTENT_ID = process.env.INTENT_ID;
  const FILL_ID   = process.env.FILL_ID;
  const POS_ID    = process.env.POS_ID;
  const TRADE_ID  = process.env.TRADE_ID;

  async function show(col, id) {
    const snap = await db.collection(col).doc(id).get();
    console.log(col, id, "EXISTS:", snap.exists);
    if (snap.exists) console.log(JSON.stringify(snap.data(), null, 2));
  }

  console.log("=== CHECK INTENT ===");
  await show("order_intents_paper", INTENT_ID);

  console.log("=== CHECK FILL ===");
  await show("fills_paper", FILL_ID);

  console.log("=== CHECK POSITION ===");
  await show("positions_paper", POS_ID);

  console.log("=== CHECK TRADE ===");
  await show("trades_paper", TRADE_ID);
})();
NODE
