#!/usr/bin/env node
"use strict";

// scripts/run-v3-live-reconcile.js — exchange↔ledger drift check (2026-07-16).
//
// Skips silently unless V3_LIVE_ENABLED=1 AND keys are present (nothing to
// reconcile before that). In DRY-RUN the invariant is stronger: the account
// must be FLAT — any position is a ghost. Alerts (deduped by drift
// signature) on findings; recovery notice when drift clears.

try { require("dotenv").config(); } catch (_) {}

const fs = require("fs");
const path = require("path");
const { compareLedgerVsExchange, findingsSignature } = require("../src/v3/liveReconcile");
const { openRealRows } = require("../src/v3/liveLedgerView");
const { alertOnce } = require("../src/v3/opsAlert");
const priv = require("../src/exchanges/binanceFuturesPrivate");

const ROOT = path.resolve(__dirname, "..");
const LIVE_ENTRY = path.join(ROOT, "ops/runtime/v3_live_entry_ledger.jsonl");
const LIVE_EXIT = path.join(ROOT, "ops/runtime/v3_live_exit_ledger.jsonl");
const OUT = path.join(ROOT, "ops/daily/v3_live_reconcile_latest.json");
const ALERT_STATE = path.join(ROOT, "ops/runtime/v3_ops_alert_state.json");

function readJsonl(p) {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
}

async function main() {
  const enabled = String(process.env.V3_LIVE_ENABLED || "0").trim() === "1";
  const apiKey = String(process.env.V3_LIVE_BINANCE_API_KEY || "").trim();
  const apiSecret = String(process.env.V3_LIVE_BINANCE_API_SECRET || "").trim();
  if (!enabled || !apiKey || !apiSecret) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: !enabled ? "LIVE_DISABLED" : "NO_KEYS" }));
    return;
  }

  const account = await priv.fetchBinanceFuturesAccount({ apiKey, apiSecret });
  const positions = ((account && account.positions) || [])
    .map((p) => ({ symbol: p.symbol, positionAmt: Number(p.positionAmt) }))
    .filter((p) => Number.isFinite(p.positionAmt) && p.positionAmt !== 0);

  const openRows = openRealRows(readJsonl(LIVE_ENTRY), readJsonl(LIVE_EXIT));
  const result = compareLedgerVsExchange({ openLedgerRows: openRows, positions });

  const payload = { generated_at: new Date().toISOString(), ...result };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  const sig = findingsSignature(result.findings);
  await alertOnce({
    stateFile: ALERT_STATE,
    key: `reconcile_${sig || "clean"}`,
    active: !result.ok,
    title: "🚨 v3 live: 거래소↔원장 불일치",
    severity: "error",
    recoveryTitle: "✅ v3 live: 원장 정합 회복",
    body: result.findings.map((f) => `${f.type} ${f.symbol}${f.signal_id ? ` (${f.signal_id})` : ""}`).join("\n") || "clean",
  });

  console.log(JSON.stringify({ ok: result.ok, findings_n: result.findings.length, latest_json: OUT }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error("RUN_V3_LIVE_RECONCILE_FAIL", e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}
