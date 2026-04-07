#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { deriveSignalDocId } = require("../src/utils/signalDocId");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();

function nowIso() {
  return new Date().toISOString();
}

function toMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function isRecent(row, windowMs) {
  const ts = toMs(row && (row.updated_at || row.created_at));
  return Number.isFinite(ts) && ts >= (Date.now() - windowMs);
}

function buildSyntheticIntentId({ exchange, symbol, tf, barMs, event } = {}) {
  const ex = upper(exchange);
  const sym = upper(symbol);
  const tfSafe = String(tf || "").trim() || "15m";
  const ms = Number(barMs);
  const ev = upper(event) || "EXIT_EXTERNAL_SYNC";
  if (!ex || !sym || !Number.isFinite(ms) || ms <= 0) return null;
  return `INTENT__${ex}__${sym}__${tfSafe}__${Math.trunc(ms)}__${ev}`;
}

function deriveIntentSignalRefs(intent = {}) {
  const signalIdRaw = String(intent.signal_id || (intent.features_json && intent.features_json.signal_id) || "").trim() || null;
  const signalDocIdRaw = String(intent.signal_doc_id || (intent.features_json && intent.features_json.signal_doc_id) || "").trim() || null;
  const signalDocId = signalDocIdRaw || deriveSignalDocId({
    exchange: intent.exchange,
    symbol: intent.symbol_or_pair_id || intent.symbol,
    tf: intent.tf,
    barCloseMs: intent.signal_bar_close_time_utc_ms || intent.scheduled_exec_bar_close_time_utc_ms,
    event: intent.event,
    signalId: signalIdRaw,
  });
  const signalId = signalIdRaw || signalDocId || null;
  return { signalId, signalDocId };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Signal Lineage 24h Backfill",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- apply: ${report.apply === true ? "YES" : "NO"}`,
    `- window_hours: ${report.window_hours || 24}`,
    "",
    "## Summary",
    `- intents_scanned: ${report.summary && report.summary.intents_scanned || 0}`,
    `- fills_scanned: ${report.summary && report.summary.fills_scanned || 0}`,
    `- intents_patched: ${report.summary && report.summary.intents_patched || 0}`,
    `- synthetic_intents_created: ${report.summary && report.summary.synthetic_intents_created || 0}`,
    `- fills_patched: ${report.summary && report.summary.fills_patched || 0}`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const apply = String(process.env.APPLY || "0").trim() === "1";
  const windowHours = Math.max(1, Number(process.env.LINEAGE_BACKFILL_WINDOW_HOURS || 24) || 24);
  const windowMs = windowHours * 60 * 60 * 1000;
  const meta = nowKstMeta();
  const db = getFirestore();

  const [intentSnap, fillSnap] = await Promise.all([
    db.collection("order_intents_paper").orderBy("updated_at", "desc").limit(2000).get(),
    db.collection("fills_paper").orderBy("updated_at", "desc").limit(3000).get(),
  ]);

  const intents = intentSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((row) => isRecent(row, windowMs));
  const fills = fillSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((row) => isRecent(row, windowMs));

  const intentMap = new Map(intents.map((row) => [String(row.intent_id || row.id), row]));
  let intentsPatched = 0;
  let fillsPatched = 0;
  let syntheticIntentsCreated = 0;

  for (const intent of intents) {
    const intentId = String(intent.intent_id || intent.id || "").trim();
    if (!intentId) continue;
    const refs = deriveIntentSignalRefs(intent);
    const needPatch = (!String(intent.signal_doc_id || "").trim() && refs.signalDocId)
      || (!String(intent.signal_id || "").trim() && refs.signalId);
    if (!needPatch) continue;
    const nextFeatures = (intent.features_json && typeof intent.features_json === "object")
      ? { ...intent.features_json }
      : {};
    if (refs.signalDocId && !nextFeatures.signal_doc_id) nextFeatures.signal_doc_id = refs.signalDocId;
    if (refs.signalId && !nextFeatures.signal_id) nextFeatures.signal_id = refs.signalId;
    if (apply) {
      await db.collection("order_intents_paper").doc(intentId).set({
        signal_doc_id: refs.signalDocId || null,
        signal_id: refs.signalId || null,
        features_json: nextFeatures,
        updated_at: nowIso(),
      }, { merge: true });
    }
    intent.signal_doc_id = refs.signalDocId || intent.signal_doc_id || null;
    intent.signal_id = refs.signalId || intent.signal_id || null;
    intent.features_json = nextFeatures;
    intentMap.set(intentId, intent);
    intentsPatched += 1;
  }

  for (const fill of fills) {
    const fillId = String(fill.fill_id || fill.id || "").trim();
    if (!fillId) continue;
    const event = upper(fill.event);
    const isExit = event.startsWith("EXIT_");
    const exchange = upper(fill.exchange) || "BINANCEFUT";
    const symbol = upper(fill.symbol || fill.symbol_or_pair_id);
    const tf = String(fill.tf || "15m").trim() || "15m";
    const execMs = Number(fill.exec_bar_close_time_utc_ms);
    let intentId = String(fill.intent_id || "").trim() || null;
    let intent = intentId ? intentMap.get(intentId) : null;

    if (!intentId && isExit && symbol && Number.isFinite(execMs)) {
      const syntheticIntentId = buildSyntheticIntentId({
        exchange,
        symbol,
        tf,
        barMs: execMs,
        event,
      });
      if (syntheticIntentId) {
        const syntheticSignalDocId = deriveSignalDocId({
          exchange,
          symbol,
          tf,
          barCloseMs: Number(fill.signal_bar_close_time_utc_ms) || execMs,
          event: event === "EXIT_EXTERNAL_SYNC" ? "SHORT" : event,
          signalId: null,
        });
        const syntheticSignalId = syntheticSignalDocId || null;
        const syntheticDoc = {
          intent_id: syntheticIntentId,
          exchange,
          symbol_or_pair_id: symbol,
          tf,
          event,
          side: upper(fill.side) || null,
          status: "FILLED",
          status_reason: "EXTERNAL_FILL_RECONCILED",
          reason: "EXTERNAL_FILL_SYNC",
          decision_reason: "EXTERNAL_FILL_RECONCILED",
          event_intent: "EXIT",
          execution_mode: upper(fill.execution_mode) || "LIVE",
          signal_id: syntheticSignalId,
          signal_doc_id: syntheticSignalDocId,
          signal_bar_close_time_utc_ms: Number(fill.signal_bar_close_time_utc_ms) || execMs,
          scheduled_exec_bar_close_time_utc_ms: execMs,
          filled_at: String(fill.exec_bar_close_time_utc || fill.updated_at || nowIso()),
          filled_via: "BINANCE_USER_TRADES",
          external_sync_synthetic_intent: true,
          created_at: String(fill.created_at || nowIso()),
          updated_at: nowIso(),
          features_json: {
            external_sync_synthetic_intent: true,
            signal_id: syntheticSignalId,
            signal_doc_id: syntheticSignalDocId,
            source: "BINANCE_USER_TRADES",
          },
        };
        if (apply) {
          await db.collection("order_intents_paper").doc(syntheticIntentId).set(syntheticDoc, { merge: true });
        }
        intentId = syntheticIntentId;
        intent = syntheticDoc;
        intentMap.set(syntheticIntentId, syntheticDoc);
        syntheticIntentsCreated += 1;
      }
    }

    const intentRefs = intent ? deriveIntentSignalRefs(intent) : { signalId: null, signalDocId: null };
    const fillSignalId = String(fill.signal_id || "").trim() || null;
    const fillSignalDocId = String(fill.signal_doc_id || "").trim() || null;
    const resolvedSignalDocId = fillSignalDocId
      || intentRefs.signalDocId
      || deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: Number(fill.signal_bar_close_time_utc_ms) || Number(fill.exec_bar_close_time_utc_ms),
        event: event === "EXIT_EXTERNAL_SYNC" ? "SHORT" : event,
        signalId: fillSignalId,
      })
      || null;
    const resolvedSignalId = fillSignalId || intentRefs.signalId || resolvedSignalDocId || null;

    const needFillPatch = (!String(fill.intent_id || "").trim() && intentId)
      || (!String(fill.signal_doc_id || "").trim() && resolvedSignalDocId)
      || (!String(fill.signal_id || "").trim() && resolvedSignalId);
    if (!needFillPatch) continue;

    if (apply) {
      await db.collection("fills_paper").doc(fill.id || fillId).set({
        intent_id: intentId || null,
        signal_doc_id: resolvedSignalDocId || null,
        signal_id: resolvedSignalId || null,
        updated_at: nowIso(),
      }, { merge: true });
    }
    fillsPatched += 1;
  }

  const report = {
    ok: true,
    apply,
    window_hours: windowHours,
    generated_at_kst: meta.kst,
    summary: {
      intents_scanned: intents.length,
      fills_scanned: fills.length,
      intents_patched: intentsPatched,
      synthetic_intents_created: syntheticIntentsCreated,
      fills_patched: fillsPatched,
    },
  };

  const base = `${meta.dateKey}_${meta.hhmm}_signal_lineage_backfill_24h`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "signal_lineage_backfill_24h_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "signal_lineage_backfill_24h_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  writeJson(latestJsonPath, report);
  writeText(latestMdPath, renderMarkdown(report));

  console.log(JSON.stringify({
    ok: true,
    apply,
    summary: report.summary,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SIGNAL_LINEAGE_BACKFILL_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
