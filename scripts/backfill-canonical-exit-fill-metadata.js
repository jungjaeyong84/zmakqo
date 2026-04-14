#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.CANONICAL_EXIT_FILL_BACKFILL_LOOKBACK_DAYS || 30));
const PAGE_SIZE = Math.max(100, Number(process.env.CANONICAL_EXIT_FILL_BACKFILL_PAGE_SIZE || 1000));

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function classifyStage(event) {
  const ev = upper(event);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return null;
}

function buildTransitionEvents(stage, row) {
  const qty = Number(row.qty_fraction ?? row.qty_pct);
  if (stage === "TP0") return ["TP0_REACHED"];
  if (stage === "TP1") return ["TP1_REACHED", "TRAIL_ACTIVE"];
  if (stage === "TRAIL") return [qty >= 0.999 ? "TRAIL_FINAL_EXIT" : "TRAIL_PARTIAL"];
  return [];
}

async function main() {
  const db = getFirestore();
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  let scanned = 0;
  let updated = 0;
  const rows = [];
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.exchange) !== "BINANCEFUT") continue;
      if (String(row.created_at || "") < sinceIso) continue;
      scanned += 1;
      const stage = classifyStage(row.event);
      if (!stage) continue;
      const transitionEvents = buildTransitionEvents(stage, row);
      const patch = {
        canonical_exit_stage: stage,
        canonical_transition_events: transitionEvents,
        canonical_primary_transition_event: transitionEvents[transitionEvents.length - 1] || null,
        canonical_metadata_backfilled_at: new Date().toISOString(),
      };
      const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
      patch.extra = {
        ...extra,
        canonical_exit_stage: stage,
        canonical_exit_reason: extra.canonical_exit_reason || "EVENT_STAGE_METADATA_BACKFILL",
        canonical_transition_events: transitionEvents,
        canonical_primary_transition_event: transitionEvents[transitionEvents.length - 1] || null,
        canonical_metadata_backfilled_at: patch.canonical_metadata_backfilled_at,
      };
      const unchanged =
        upper(row.canonical_exit_stage) === stage
        && Array.isArray(row.canonical_transition_events)
        && JSON.stringify(row.canonical_transition_events) === JSON.stringify(transitionEvents)
        && extra
        && upper(extra.canonical_exit_stage) === stage;
      if (unchanged) continue;
      await db.collection("fills_paper").doc(doc.id).set(patch, { merge: true });
      updated += 1;
      rows.push({
        fill_id: row.fill_id || doc.id,
        symbol: upper(row.symbol),
        event: upper(row.event),
        canonical_exit_stage: stage,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(JSON.stringify({
    ok: true,
    lookback_days: LOOKBACK_DAYS,
    scanned_fill_n: scanned,
    updated_n: updated,
    rows: rows.slice(0, 100),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_CANONICAL_EXIT_FILL_METADATA_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
