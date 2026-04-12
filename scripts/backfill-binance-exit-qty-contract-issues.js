#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const { __test: exitQtyAuditTest } = require("./report-binance-exit-qty-contract-audit");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.EXIT_QTY_CONTRACT_BACKFILL_LOOKBACK_DAYS || 7));
const PAGE_SIZE = Math.max(100, Number(process.env.EXIT_QTY_CONTRACT_BACKFILL_PAGE_SIZE || 1000));
const DRY_RUN = ["1", "true", "yes", "y", "on"].includes(String(process.env.DRY_RUN || "").trim().toLowerCase());

function nowIso() {
  return new Date().toISOString();
}

async function fetchRecentBinanceExitFills(db) {
  const out = [];
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  for (;;) {
    let q = db.collection("fills_paper").orderBy("created_at", "desc").limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const fill = doc.data() || {};
      if (String(fill.exchange || "").trim().toUpperCase() !== "BINANCEFUT") continue;
      if (String(fill.created_at || "") < sinceIso) continue;
      const stage = exitQtyAuditTest.classifyExitEvent(fill.event);
      if (stage === "OTHER") continue;
      out.push({ id: doc.id, ...fill });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return out;
}

async function main() {
  const db = getFirestore();
  const rows = await fetchRecentBinanceExitFills(db);
  const issueRows = exitQtyAuditTest.buildIssueRows(rows).filter((row) => row.backfilled !== true);
  const backfilledAt = nowIso();
  const touchedSymbols = new Set();
  let updated = 0;

  for (const row of issueRows) {
    const batch = db.batch();
    const fills = Array.isArray(row.fills_all) ? row.fills_all : (Array.isArray(row.fills) ? row.fills : []);
    for (const fill of fills) {
      const docId = String(fill.fill_id || "").trim();
      if (!docId) continue;
      batch.set(db.collection("fills_paper").doc(docId), {
        extra: {
          exit_qty_contract_issue_chain_key: row.chain_key,
          exit_qty_contract_issue_codes: (row.issues || []).map((issue) => issue.code),
          exit_qty_contract_issue_fill_count: Number(row.authoritative_fill_count || 0),
          exit_qty_contract_issue_backfilled_at: backfilledAt,
          exit_qty_contract_issue_primary_fill_id: row.fills && row.fills[0] ? String(row.fills[0].fill_id || "") : null,
        },
      }, { merge: true });
      updated += 1;
      if (row.symbol) touchedSymbols.add(String(row.symbol).trim().toUpperCase());
    }
    if (!DRY_RUN) await batch.commit();
  }

  console.log(JSON.stringify({
    ok: true,
    dry_run: DRY_RUN,
    lookback_days: LOOKBACK_DAYS,
    scanned_fill_n: rows.length,
    issue_chain_n: issueRows.length,
    updated_fill_n: updated,
    touched_symbol_n: touchedSymbols.size,
    touched_symbols: Array.from(touchedSymbols.values()).sort(),
    backfilled_at: backfilledAt,
    sample_issue_chains: issueRows.slice(0, 20).map((row) => ({
      chain_key: row.chain_key,
      symbol: row.symbol,
      issue_codes: (row.issues || []).map((issue) => issue.code),
      fill_ids: (Array.isArray(row.fills_all) ? row.fills_all : row.fills || []).map((fill) => fill.fill_id),
    })),
  }, null, 2));
}

main().catch((err) => {
  console.error("BACKFILL_BINANCE_EXIT_QTY_CONTRACT_ISSUES_FAILED:", err && err.stack ? err.stack : String(err));
  process.exit(1);
});
