"use strict";

// src/v3/liveLedgerView.js — shared read semantics for the append-only live
// ledgers (2026-07-16, survival hardening).
//
// The live entry ledger is append-only, and bracket REPAIR appends a new row
// for the SAME signal_id (fresh order ids, status OPEN). Every reader must
// therefore treat "the latest row per signal_id" as authoritative — reading
// raw rows double-counts repaired positions (concurrency caps) and resolves
// exits against stale order ids. This module is the single home for that
// rule so executor / exit-sync / reconcile cannot drift apart.

function parseTs(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

// Map(signal_id -> authoritative row). Later created_at wins; if timestamps
// are missing or equal, later APPEND ORDER wins (append-only ledgers are
// chronological by construction).
function latestRowsBySignalId(rows = []) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sid = row && row.signal_id;
    if (!sid) continue;
    const prev = out.get(sid);
    if (!prev) { out.set(sid, row); continue; }
    const prevTs = parseTs(prev.created_at);
    const curTs = parseTs(row.created_at);
    if (prevTs !== null && curTs !== null && curTs < prevTs) continue; // strictly older
    out.set(sid, row); // newer-or-equal ts, or missing ts → append order wins
  }
  return out;
}

// Authoritative open REAL rows (post repair, minus closed signal_ids).
function openRealRows(liveEntryRows = [], liveExitRows = []) {
  const closed = new Set();
  for (const r of Array.isArray(liveExitRows) ? liveExitRows : []) {
    if (r && r.signal_id && String(r.status).toUpperCase() === "CLOSED") closed.add(r.signal_id);
  }
  const out = [];
  for (const row of latestRowsBySignalId(liveEntryRows).values()) {
    if (closed.has(row.signal_id)) continue;
    if (row.dry_run === true) continue;
    const st = String(row.status || "").toUpperCase();
    if (st === "OPEN" || st === "OPEN_BRACKET_INCOMPLETE") out.push(row);
  }
  return Object.freeze(out);
}

module.exports = Object.freeze({ latestRowsBySignalId, openRealRows });
