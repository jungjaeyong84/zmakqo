#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-sol-tp1-recovery-telegram.js
//
// 2026-04-19 SOLUSDT:  TP1 filled at 07:23:09Z via the EXCHANGE_QTY_REDUCTION
// recovery path but the runner's recovery-alert guard (Fix #1, 2026-04-18)
// silenced the Telegram because yesterday's `tp_p1_recovery_alert_sent_at`
// marker from a prior lifecycle was still persisted on the Firestore meta
// doc.  Root cause fixed in PR #15 (fix/tp1-recovery-alert-timestamp-guard).
//
// This script is a ONE-OFF: fetch the current SOL position meta, build the
// same payload the runner would have built, and dispatch the late Telegram
// right now so the operator isn't stuck waiting for the PR to deploy.
//
// It sets `forceAlertReplay: true` so the outbox-dedup layer will not
// squash the alert even if a stale outbox row exists for this event.
//
// Usage:
//   DRY-RUN:
//     node scripts/manual-sol-tp1-recovery-telegram.js
//   실행:
//     node scripts/manual-sol-tp1-recovery-telegram.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

const { getPosition } = require("../src/storage/positionsPaper");
const { sendTradeExecutionAlert } = require("../src/services/tradeExecutionAlert");

function parseArgs(argv) {
  const out = { symbol: "SOLUSDT", execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
    if (arg.startsWith("--symbol=")) {
      out.symbol = String(arg.split("=")[1] || "").toUpperCase();
    }
  }
  return out;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const { symbol, execute } = args;

  console.log("─".repeat(72));
  console.log(`[SOL TP1 MANUAL TELEGRAM] symbol=${symbol} execute=${execute}`);
  console.log("─".repeat(72));

  const pos = await getPosition({ exchange: "BINANCEFUT", symbol });
  if (!pos) {
    console.error("[ABORT] positions_paper 문서가 없습니다.");
    process.exit(1);
  }
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};

  const tpP1Done = meta.tp_p1_done === true;
  const recoveryTrigger = meta.tp_p1_recovery_trigger || null;
  const observedAt = meta.tp_p1_recovery_observed_at || null;
  const alertedAt = meta.tp_p1_recovery_alert_sent_at || null;
  const seededPrice = num(meta.tp_p1_recovery_seeded_price);
  const entryPrice = num(pos.avg_price) || num(meta.entry_price);
  const entryQtyBase = num(meta.entry_qty_base) || num(meta.entry_qty_abs);
  const qtyBase = num(pos.qty_base);
  const positionSide = String(meta.position_side || pos.position_side || "").toUpperCase();
  const side = positionSide === "LONG" ? "LONG" : (positionSide === "SHORT" ? "SHORT" : null);

  const execQty = (entryQtyBase != null && qtyBase != null)
    ? Math.max(0, entryQtyBase - qtyBase)
    : null;
  const execPrice = seededPrice != null
    ? seededPrice
    : entryPrice;

  console.log(`[META]`);
  console.log(`  tp_p1_done                        = ${tpP1Done}`);
  console.log(`  tp_p1_recovery_trigger            = ${recoveryTrigger}`);
  console.log(`  tp_p1_recovery_observed_at        = ${observedAt}`);
  console.log(`  tp_p1_recovery_alert_sent_at      = ${alertedAt}  (stale → guard silenced alert)`);
  console.log(`  tp_p1_recovery_seeded_price       = ${seededPrice}`);
  console.log(`  position_side                     = ${side}`);
  console.log(`  entry_price                       = ${entryPrice}`);
  console.log(`  entry_qty_base                    = ${entryQtyBase}`);
  console.log(`  current qty_base                  = ${qtyBase}`);
  console.log(`  derived execQty (entry − current) = ${execQty}`);
  console.log(`  derived execPrice (seeded/entry)  = ${execPrice}`);

  if (!tpP1Done) {
    console.error("[ABORT] tp_p1_done=false — 복구할 TP1 이벤트가 없습니다.");
    process.exit(1);
  }
  if (!recoveryTrigger) {
    console.error("[ABORT] tp_p1_recovery_trigger 가 없습니다 — 이 스크립트는 recovery-path 복구 전용입니다.");
    process.exit(1);
  }

  const payload = {
    exchange: "BINANCEFUT",
    symbol,
    event: "EXIT_TP_P1_RECOVERY",
    intent: "EXIT",
    side,
    execPrice,
    execQty,
    executionMode: "LIVE",
    reason: recoveryTrigger,
    note: "TP1 fill detected via qty-reduction recovery (manual Telegram recovery — PR #15 guard fix).",
    rawEvidenceEvent: "EXIT_TP_P1_RECOVERY",
    canonicalExitEvent: "EXIT_TP_P1_RECOVERY",
    canonicalExitStage: "TP1",
    canonicalTransitionEvent: "TP1_REACHED",
    canonicalTransitionEvents: ["TP1_REACHED"],
    // Bypass the outbox-dedup layer.  Any stale outbox row from yesterday's
    // lifecycle would otherwise silence this one-off recovery send.
    forceAlertReplay: true,
    replayReason: "MANUAL_SOL_TP1_RECOVERY_2026_04_19",
  };

  console.log(`[PAYLOAD]`);
  console.log(JSON.stringify(payload, null, 2));

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음 — Telegram 전송 없음.");
    process.exit(0);
  }

  const result = await sendTradeExecutionAlert(payload);
  console.log(`[RESULT] ${JSON.stringify(result)}`);
  if (!result || result.ok !== true) {
    console.error("[SEND FAIL]");
    process.exit(2);
  }
  console.log("─".repeat(72));
  console.log("[DONE] 운영자 Telegram 전송 완료.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
