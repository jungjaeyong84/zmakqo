#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const {
  classifyExitEventStage,
  buildCanonicalExitEvent,
} = require("../src/services/positionStateMachine");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.CANONICAL_EXIT_FILL_BACKFILL_LOOKBACK_DAYS || 30));
const PAGE_SIZE = Math.max(100, Number(process.env.CANONICAL_EXIT_FILL_BACKFILL_PAGE_SIZE || 1000));

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function isSimplifiedExitV2Row(row = {}) {
  const extra = row && row.extra && typeof row.extra === "object" ? row.extra : {};
  const meta = row && row.meta && typeof row.meta === "object" ? row.meta : {};
  return row.simplified_exit_v2_enabled === true
    || row.simplifiedExitV2Enabled === true
    || extra.simplified_exit_v2_enabled === true
    || extra.simplifiedExitV2Enabled === true
    || meta.simplified_exit_v2_enabled === true
    || meta.simplifiedExitV2Enabled === true;
}

function buildTransitionEvents(stage, row) {
  const qty = Number(row.qty_fraction ?? row.qty_pct);
  const simplifiedExitV2 = isSimplifiedExitV2Row(row);
  if (stage === "TP0") return simplifiedExitV2 ? [] : ["TP0_REACHED"];
  if (stage === "TP1") return simplifiedExitV2 ? ["TP1_REACHED", "TRAIL_ACTIVATED"] : ["TP1_REACHED", "TRAIL_ACTIVE"];
  if (stage === "TRAIL") return simplifiedExitV2 ? ["TRAIL_FINAL_EXIT"] : [qty >= 0.999 ? "TRAIL_FINAL_EXIT" : "TRAIL_PARTIAL"];
  return [];
}

function buildCanonicalFillMetadata(row = {}) {
  const fallbackEvent = upper(row.event);
  const stage = classifyExitEventStage(fallbackEvent);
  if (!stage) return null;
  const transitionEvents = buildTransitionEvents(stage, row);
  if (!transitionEvents.length) return null;
  const canonicalExitEvent = buildCanonicalExitEvent({
    stage,
    fallbackEvent,
  }) || fallbackEvent;
  return {
    canonical_exit_event: canonicalExitEvent,
    canonical_exit_stage: stage,
    canonical_transition_events: transitionEvents,
    canonical_primary_transition_event: transitionEvents[transitionEvents.length - 1] || null,
  };
}

function isMetadataUnchanged(row = {}, metadata = null) {
  if (!metadata) return true;
  const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
  return upper(row.canonical_exit_event) === upper(metadata.canonical_exit_event)
    && upper(row.canonical_exit_stage) === upper(metadata.canonical_exit_stage)
    && JSON.stringify(Array.isArray(row.canonical_transition_events) ? row.canonical_transition_events : []) === JSON.stringify(metadata.canonical_transition_events)
    && upper(row.canonical_primary_transition_event) === upper(metadata.canonical_primary_transition_event)
    && upper(extra.canonical_exit_event) === upper(metadata.canonical_exit_event)
    && upper(extra.canonical_exit_stage) === upper(metadata.canonical_exit_stage)
    && JSON.stringify(Array.isArray(extra.canonical_transition_events) ? extra.canonical_transition_events : []) === JSON.stringify(metadata.canonical_transition_events)
    && upper(extra.canonical_primary_transition_event) === upper(metadata.canonical_primary_transition_event);
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
      const metadata = buildCanonicalFillMetadata(row);
      if (!metadata) continue;
      const patch = {
        ...metadata,
        canonical_metadata_backfilled_at: new Date().toISOString(),
      };
      const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
      patch.extra = {
        ...extra,
        canonical_exit_event: metadata.canonical_exit_event,
        canonical_exit_stage: metadata.canonical_exit_stage,
        canonical_exit_reason: extra.canonical_exit_reason || "EVENT_STAGE_METADATA_BACKFILL",
        canonical_transition_events: metadata.canonical_transition_events,
        canonical_primary_transition_event: metadata.canonical_primary_transition_event,
        canonical_metadata_backfilled_at: patch.canonical_metadata_backfilled_at,
      };
      if (isMetadataUnchanged(row, metadata)) continue;
      await db.collection("fills_paper").doc(doc.id).set(patch, { merge: true });
      updated += 1;
      rows.push({
        fill_id: row.fill_id || doc.id,
        symbol: upper(row.symbol),
        event: upper(row.event),
        canonical_exit_event: metadata.canonical_exit_event,
        canonical_exit_stage: metadata.canonical_exit_stage,
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

if (require.main === module) {
  main().catch((err) => {
    console.error("BACKFILL_CANONICAL_EXIT_FILL_METADATA_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    upper,
    isSimplifiedExitV2Row,
    buildTransitionEvents,
    buildCanonicalFillMetadata,
    isMetadataUnchanged,
  },
};
