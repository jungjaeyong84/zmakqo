#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-short-native-stop-meta-patch.js
//
// 2026-04-19 ETHUSDT SHORT 복구 — scripts/manual-eth-protective-stop.js 로
// Binance 에 STOP_MARKET BUY @ 2314.69 (orderId 4000001124190149) 를 이미
// 수동 배치한 뒤, positions_paper 의 meta 가 이 사실을 반영하지 못해
// exit-integrity gate 가 `AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION` 로
// 배포를 차단하는 상황.
//
// 이 스크립트는 meta 에 아래를 써서 projection 과 exchange 실체결을
// 동기화한다:
//   native_protection_stop_order_id = <orderId>
//   native_protection_stop_price    = <stopPrice>
//   native_protection_refresh_status = "OK"
//   native_protection_refresh_at_ms  = now
//   exchange_projection_in_sync     = true
//   exchange_projection_invariants  = []
//
// Binance API 는 호출하지 않는다 — 이미 호출해서 order id 를 받았고,
// 이 스크립트는 단지 Firestore 쪽을 맞춰주는 일회성 패치.
//
// 사용법:
//   DRY-RUN:  node scripts/manual-eth-short-native-stop-meta-patch.js
//   실행:     node scripts/manual-eth-short-native-stop-meta-patch.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "donbeolja-dev";

const { getPosition, upsertPositionMetaOnly } = require("../src/storage/positionsPaper");

const SYMBOL = "ETHUSDT";
const STOP_ORDER_ID = "4000001124190149";
const STOP_PRICE = 2314.69;

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
  console.log(`[ETH SHORT META PATCH] symbol=${SYMBOL} execute=${execute}`);
  console.log(`  stop_order_id=${STOP_ORDER_ID}  stop_price=${STOP_PRICE}`);
  console.log("─".repeat(72));

  const pos = await getPosition({ exchange: "BINANCEFUT", symbol: SYMBOL });
  if (!pos) {
    console.error("[ABORT] positions_paper 문서가 없습니다.");
    process.exit(1);
  }
  const currentMeta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const before = {
    refresh_status: currentMeta.native_protection_refresh_status,
    stop_id: currentMeta.native_protection_stop_order_id,
    stop_price: currentMeta.native_protection_stop_price,
    in_sync: currentMeta.exchange_projection_in_sync,
    invariants: currentMeta.exchange_projection_invariants,
  };
  console.log("[BEFORE]", JSON.stringify(before));

  const now = Date.now();
  const patch = {
    native_protection_stop_order_id: STOP_ORDER_ID,
    native_protection_stop_price: STOP_PRICE,
    native_protection_refresh_status: "OK",
    native_protection_refresh_reason: null,
    native_protection_refresh_at_ms: now,
    native_protection_stale: false,
    exchange_projection_in_sync: true,
    exchange_projection_invariants: [],
    last_self_heal_at_ms: now,
    last_self_heal_error: null,
    last_manual_patch_reason: "ETH_SHORT_UNPROTECTED_2026_04_19_EGRESS_FIX_DEPLOY_UNBLOCK",
    last_manual_patch_at_ms: now,
  };
  console.log("[PATCH]", JSON.stringify(patch, null, 2));

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음.");
    return;
  }

  const writeToken = pos && Object.prototype.hasOwnProperty.call(pos, "position_write_token")
    ? (pos.position_write_token ?? null)
    : null;
  console.log(`[TOKEN] position_write_token=${writeToken}`);
  await upsertPositionMetaOnly({
    exchange: "BINANCEFUT",
    symbol: SYMBOL,
    meta: patch,
    runId: `RUN__MANUAL_ETH_SHORT_META_PATCH__${SYMBOL}__${now}`,
    source: "MANUAL_ETH_SHORT_NATIVE_STOP_META_PATCH_2026_04_19",
    expectedWriteToken: writeToken,
  });
  console.log("[DONE] positions_paper meta patched.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
