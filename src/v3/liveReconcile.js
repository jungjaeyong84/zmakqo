"use strict";

// src/v3/liveReconcile.js — exchange↔ledger consistency check (2026-07-16).
//
// Pure comparison between what the live ledger believes is open and what the
// exchange actually holds. Three finding classes:
//   GHOST_POSITION   — exchange holds a position our ledger doesn't know
//                      (manual trade, or an entry we failed to record).
//                      In DRY-RUN mode any position at all is a ghost: the
//                      invariant is "account is flat".
//   MISSING_POSITION — ledger says open but exchange is flat, and the row is
//                      older than the grace window (exit-sync normally closes
//                      these within one cycle; persistent = record drift).
//   QTY_MISMATCH     — both agree a position exists but sizes differ beyond
//                      tolerance (partial fill or external add/reduce).

function upper(v) { const s = String(v == null ? "" : v).trim(); return s ? s.toUpperCase() : null; }
function num(v) { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

// openLedgerRows — authoritative open real rows (liveLedgerView.openRealRows)
// positions      — [{symbol, positionAmt}] from the exchange (non-zero only
//                  is fine; zeros are ignored)
function compareLedgerVsExchange({
  openLedgerRows = [],
  positions = [],
  toleranceRatio = 0.05,
  graceMs = 10 * 60 * 1000,
  nowMs = Date.now(),
} = {}) {
  const findings = [];

  const exch = new Map(); // symbol -> signed amt
  for (const p of Array.isArray(positions) ? positions : []) {
    const sym = upper(p && p.symbol);
    const amt = num(p && p.positionAmt);
    if (!sym || amt === null || amt === 0) continue;
    exch.set(sym, (exch.get(sym) || 0) + amt);
  }

  const ledgerBySymbol = new Map();
  for (const r of Array.isArray(openLedgerRows) ? openLedgerRows : []) {
    const sym = upper(r && r.symbol);
    if (!sym) continue;
    if (!ledgerBySymbol.has(sym)) ledgerBySymbol.set(sym, []);
    ledgerBySymbol.get(sym).push(r);
  }

  // exchange side → ghosts / qty+direction checks
  for (const [sym, amt] of exch) {
    const rows = ledgerBySymbol.get(sym) || [];
    if (!rows.length) {
      findings.push({ type: "GHOST_POSITION", symbol: sym, exchange_amt: amt });
      continue;
    }
    const expectedSide = amt > 0 ? "LONG" : "SHORT";
    const sideRows = rows.filter((r) => upper(r.side) === expectedSide);
    if (!sideRows.length) {
      findings.push({ type: "GHOST_POSITION", symbol: sym, exchange_amt: amt, note: "DIRECTION_MISMATCH" });
      continue;
    }
    const ledgerQty = sideRows.reduce((s, r) => s + Math.abs(num(r.qty) || 0), 0);
    if (ledgerQty > 0) {
      const diff = Math.abs(Math.abs(amt) - ledgerQty);
      if (diff / ledgerQty > toleranceRatio) {
        findings.push({ type: "QTY_MISMATCH", symbol: sym, exchange_amt: amt, ledger_qty: ledgerQty });
      }
    }
  }

  // ledger side → missing (past grace)
  for (const [sym, rows] of ledgerBySymbol) {
    if (exch.has(sym)) continue;
    for (const r of rows) {
      const created = Date.parse(r.created_at);
      const age = Number.isFinite(created) ? nowMs - created : Infinity;
      if (age > graceMs) {
        findings.push({ type: "MISSING_POSITION", symbol: sym, signal_id: r.signal_id, age_ms: Math.round(age) });
      }
    }
  }

  return Object.freeze({
    findings: Object.freeze(findings),
    ok: findings.length === 0,
    exchange_position_n: exch.size,
    ledger_open_n: (openLedgerRows || []).length,
  });
}

// Stable signature so the alert dedup can tell "same drift still present"
// from "new drift appeared".
function findingsSignature(findings = []) {
  return (findings || [])
    .map((f) => `${f.type}:${f.symbol}:${f.signal_id || ""}`)
    .sort()
    .join("|");
}

module.exports = Object.freeze({ compareLedgerVsExchange, findingsSignature });
