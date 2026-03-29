#!/usr/bin/env node
require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { getExitRulesForExchange } = require("../src/engine/signalEngine");

const PAGE_SIZE = Number(process.env.PAGE_SIZE || 500);
const APPLY = String(process.env.APPLY || "0") === "1";

function nowIso() {
  return new Date().toISOString();
}

function pctLabel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const absPct = Math.abs(n) * 100;
  if (!Number.isFinite(absPct) || absPct <= 0) return null;
  const rounded = Math.round(absPct * 100) / 100;
  return String(rounded).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function buildSlEvent(rules) {
  const slLabel = pctLabel(rules && rules.SL);
  return slLabel ? `EXIT_SL_${slLabel}P` : "EXIT_SL";
}

function isTrackedClientOrder(v) {
  return /^(dbj_|fut_)/.test(String(v || "").trim());
}

function isBackfillCandidate(row) {
  if (!row || typeof row !== "object") return false;
  if (String(row.event || "").toUpperCase() !== "EXIT_EXTERNAL_SYNC") return false;
  if (String(row.external_order_type || "").toUpperCase() !== "MARKET") return false;
  if (row.external_order_close_position !== true) return false;
  if (!isTrackedClientOrder(row.external_client_order_id)) return false;
  const realized = Number(row.external_realized_pnl);
  if (!Number.isFinite(realized) || !(realized < 0)) return false;
  return true;
}

async function main() {
  const db = getFirestore();
  const rules = getExitRulesForExchange("BINANCEFUT");
  const targetEvent = buildSlEvent(rules);
  const ts = nowIso();

  let scanned = 0;
  let matched = 0;
  let updated = 0;
  let last = null;
  const bySymbol = {};
  const ids = [];
  let batch = db.batch();
  let batchOps = 0;

  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned += 1;
      const row = doc.data() || {};
      if (!isBackfillCandidate(row)) continue;
      matched += 1;
      const symbol = String(row.symbol || "UNKNOWN");
      bySymbol[symbol] = (bySymbol[symbol] || 0) + 1;
      ids.push(doc.id);
      if (!APPLY) continue;

      batch.set(doc.ref, {
        event: targetEvent,
        updated_at: ts,
        backfilled_from_event: "EXIT_EXTERNAL_SYNC",
        backfilled_at: ts,
        backfill_reason: "TRACKED_NATIVE_SL_CLOSEPOSITION_MARKET",
        backfill_script: "scripts/backfill-external-sync-sl.js",
      }, { merge: true });
      batchOps += 1;
      updated += 1;

      if (batchOps >= 400) {
        await batch.commit();
        batch = db.batch();
        batchOps = 0;
      }
    }

    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }

  if (APPLY && batchOps > 0) {
    await batch.commit();
  }

  console.log(JSON.stringify({
    apply: APPLY,
    scanned,
    matched,
    updated,
    targetEvent,
    bySymbol,
    ids,
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_EXTERNAL_SYNC_SL_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
