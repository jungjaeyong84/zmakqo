#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-doge-native-stop-meta-patch.js
//
// 2026-04-20 DOGEUSDT LONG 초기 SL 수동 배치 후 positions_paper.meta 동기화.
//
// Sibling script `manual-doge-initial-stop-2026-04-20.js` 가 STOP_MARKET SELL
// closePosition=true 를 배치했지만, 그 스크립트는 Binance 측에만 주문을 걸고
// Firestore meta 는 건드리지 않음 (exit-worker refresh 경로 밖이라).
//
// watchdog 이 다음 사이클에서 NATIVE_REFRESH_UNHEALTHY 로 다시 플래그하지
// 않게 하려면 positions_paper.meta.native_protection_* 필드를 직접 채워줘야
// 함. 같은 패턴으로 어제 ETH/SOL 수동 패치에서 썼던 필드 세트.
//
// 사용:
//   DRY-RUN: node scripts/legacy/incidents/2026-04-20/manual-doge-native-stop-meta-patch.js
//   실행:    node scripts/legacy/incidents/2026-04-20/manual-doge-native-stop-meta-patch.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

const { getPosition, upsertPositionMetaOnly } = require("../../../../src/storage/positionsPaper");

const EXCHANGE = "BINANCEFUT";
const SYMBOL = "DOGEUSDT";
const STOP_ORDER_ID = "4000001127442440";
const STOP_PRICE = 0.09335;
// The manual script placed the stop NOW, so ack_ms = now at placement time.
// cancel_ms / cancel_succeeded left null — no cancel happened, this was a
// from-scratch initial-stop placement, not a cancel-first refresh.
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
  console.log(`[DOGE META PATCH] ${EXCHANGE}/${SYMBOL} execute=${execute}`);
  console.log("─".repeat(72));

  const current = await getPosition({ exchange: EXCHANGE, symbol: SYMBOL });
  if (!current) {
    console.error(`[ABORT] ${EXCHANGE}/${SYMBOL} position not found in positions_paper`);
    process.exit(1);
  }
  const currentMeta = (current.meta && typeof current.meta === "object") ? current.meta : {};
  console.log("[CURRENT] native_protection_refresh_status =", currentMeta.native_protection_refresh_status);
  console.log("[CURRENT] native_protection_stop_order_id  =", currentMeta.native_protection_stop_order_id);
  console.log("[CURRENT] native_protection_stop_price     =", currentMeta.native_protection_stop_price);
  console.log("[CURRENT] execution_mode                   =", current.execution_mode);

  const patch = {
    ...currentMeta,
    native_protection_refresh_status: "OK",
    native_protection_refresh_reason: null,
    native_protection_refresh_context: "MANUAL_INITIAL_STOP_2026_04_20",
    native_protection_refresh_at_ms: NOW_MS,
    native_protection_stop_order_id: STOP_ORDER_ID,
    native_protection_stop_price: STOP_PRICE,
    // cancel-first refresh가 아닌 from-scratch 배치 — cancel fields null.
    native_protection_cancel_ms: null,
    native_protection_cancel_succeeded: null,
    native_protection_stop_ack_ms: NOW_MS,
    native_protection_tp_ack_ms: null,
    native_protection_unprotected_window_ms: null,
  };

  console.log("");
  console.log("[PATCH]");
  console.log("  native_protection_refresh_status  →", patch.native_protection_refresh_status);
  console.log("  native_protection_refresh_context →", patch.native_protection_refresh_context);
  console.log("  native_protection_refresh_at_ms   →", patch.native_protection_refresh_at_ms);
  console.log("  native_protection_stop_order_id   →", patch.native_protection_stop_order_id);
  console.log("  native_protection_stop_price      →", patch.native_protection_stop_price);
  console.log("  native_protection_stop_ack_ms     →", patch.native_protection_stop_ack_ms);

  if (!execute) {
    console.log("");
    console.log("[DRY-RUN] --execute 없음 — Firestore 에 아무것도 쓰지 않음.");
    return;
  }

  const result = await upsertPositionMetaOnly({
    exchange: EXCHANGE,
    symbol: SYMBOL,
    executionMode: current.execution_mode || "LIVE",
    meta: patch,
    source: "MANUAL_DOGE_INITIAL_STOP_META_PATCH_2026_04_20",
    reason: "MANUAL_INITIAL_STOP_POST_PLACEMENT_META_SYNC",
    mutationKind: "POSITION_META_MANUAL_PATCH",
  });
  console.log("");
  console.log("[UPSERT RESULT]", JSON.stringify(result, null, 2).slice(0, 400));
  console.log("");
  console.log("─".repeat(72));
  console.log("[DONE] positions_paper.meta 동기화 완료. 다음 watchdog cycle 에서 DOGE 이슈가 해소되어야 함.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
