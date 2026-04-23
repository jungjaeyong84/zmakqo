#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-doge-tp1-meta-patch.js
//
// 2026-04-20 DOGEUSDT LONG TP1 수동 배치 (algoId 4000001127535577) 후
// positions_paper.meta.native_protection_tp_* 동기화.
//
// Sibling script `manual-doge-tp1-placement-2026-04-20.js` 가 reduce-only
// TAKE_PROFIT_MARKET 을 Binance 에 배치했지만, 그 스크립트는 거래소만 만짐.
// authority-board 가 `native_protection_tp_order_id==null` 으로 계속
// TP1_PROTECTION_MISSING actionable 로 분류 → exit-integrity gate 계속
// BLOCKED.  이 meta 패치로 authority-board 이슈 해소.
//
// 사용:
//   DRY-RUN: node scripts/legacy/incidents/2026-04-20/manual-doge-tp1-meta-patch.js
//   실행:    node scripts/legacy/incidents/2026-04-20/manual-doge-tp1-meta-patch.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

const { getPosition, upsertPositionMetaOnly } = require("../../../../src/storage/positionsPaper");

const EXCHANGE = "BINANCEFUT";
const SYMBOL = "DOGEUSDT";
const TP_ORDER_ID = "4000001127535577";
const TP_PRICE = 0.09569;
const TP_QTY_BASE = 10646;
const TP_QTY_RATIO = 0.5;
const NOW_MS = Date.now();

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") out.execute = true;
  }
  return out;
}

async function main() {
  const { execute } = parseArgs(process.argv);
  console.log("─".repeat(72));
  console.log(`[DOGE TP1 META PATCH] ${EXCHANGE}/${SYMBOL} execute=${execute}`);
  console.log("─".repeat(72));

  const current = await getPosition({ exchange: EXCHANGE, symbol: SYMBOL });
  if (!current) {
    console.error(`[ABORT] ${EXCHANGE}/${SYMBOL} position not found in positions_paper`);
    process.exit(1);
  }
  const currentMeta = (current.meta && typeof current.meta === "object") ? current.meta : {};
  console.log("[CURRENT]");
  console.log("  native_protection_tp_order_id  =", currentMeta.native_protection_tp_order_id);
  console.log("  native_protection_tp_price     =", currentMeta.native_protection_tp_price);
  console.log("  native_protection_tp_qty_base  =", currentMeta.native_protection_tp_qty_base);
  console.log("  native_protection_tp_qty_ratio =", currentMeta.native_protection_tp_qty_ratio);
  console.log("  native_protection_tp_status    =", currentMeta.native_protection_tp_status);
  console.log("  native_protection_tp_reason    =", currentMeta.native_protection_tp_reason);

  const patch = {
    ...currentMeta,
    native_protection_tp_order_id: TP_ORDER_ID,
    native_protection_tp_price: TP_PRICE,
    native_protection_tp_qty_base: TP_QTY_BASE,
    native_protection_tp_qty_ratio: TP_QTY_RATIO,
    native_protection_tp_status: "OK",
    native_protection_tp_reason: "MANUAL_TP1_2026_04_20",
    // ack time: TP1 방금 배치됨 — unprotected window 계산 시 stop_ack 와 max 비교용.
    // (기존 stop_ack_ms 는 SL 수동 배치 시점 — 유지)
  };

  console.log("");
  console.log("[PATCH]");
  console.log("  native_protection_tp_order_id  →", patch.native_protection_tp_order_id);
  console.log("  native_protection_tp_price     →", patch.native_protection_tp_price);
  console.log("  native_protection_tp_qty_base  →", patch.native_protection_tp_qty_base);
  console.log("  native_protection_tp_qty_ratio →", patch.native_protection_tp_qty_ratio);
  console.log("  native_protection_tp_status    →", patch.native_protection_tp_status);
  console.log("  native_protection_tp_reason    →", patch.native_protection_tp_reason);

  if (!execute) {
    console.log("");
    console.log("[DRY-RUN] --execute 없음 — Firestore 에 아무것도 쓰지 않음.");
    return;
  }

  // CAS: expectedWriteToken must be passed (property presence required, even if null).
  // Matches the pattern used by upsertPositionMetaOnlyWithLatestRetry and
  // liveTrailingStageRepair.  Ensures no race with a concurrent writer.
  const result = await upsertPositionMetaOnly({
    exchange: EXCHANGE,
    symbol: SYMBOL,
    executionMode: current.execution_mode || "LIVE",
    meta: patch,
    source: "MANUAL_DOGE_TP1_META_PATCH_2026_04_20",
    reason: "MANUAL_TP1_PLACEMENT_POST_PATCH_META_SYNC",
    mutationKind: "POSITION_META_MANUAL_PATCH",
    expectedWriteToken: Object.prototype.hasOwnProperty.call(current || {}, "position_write_token")
      ? (current.position_write_token ?? null)
      : null,
  });
  console.log("");
  console.log("[UPSERT RESULT]", JSON.stringify(result, null, 2).slice(0, 400));
  console.log("");
  console.log("─".repeat(72));
  console.log("[DONE] positions_paper.meta.native_protection_tp_* 동기화 완료.");
  console.log("       다음 exit-integrity gate 실행 시 TP1_PROTECTION_MISSING 해소되어야 함.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
