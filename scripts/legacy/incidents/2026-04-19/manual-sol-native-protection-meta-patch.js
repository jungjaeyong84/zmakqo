#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-sol-native-protection-meta-patch.js
//
// 2026-04-19 SOLUSDT 재발 케이스:  manual-sol-tp1-place.js 로 TP1 ALGO 를
// 거래소에 걸었지만, 현재 배포 중인 revision 은 PR #13 이전이라
// native_protection_refresh 가 Firestore UNAVAILABLE 전이적 실패로 영원히
// MISSING 상태에 머물며 exit-integrity gate 를 차단한다.  배포 (PR #13/#14)
// 가 가능하려면 gate 를 통과해야 하므로, 방금 건 TP1 ALGO 정보를 Firestore
// meta 에 직접 반영하여 NATIVE_REFRESH_UNHEALTHY 를 해제한다.
//
// 사용법:
//   DRY-RUN:
//     node scripts/manual-sol-native-protection-meta-patch.js \
//       --tpOrderId=<id> --tpPrice=<price> --tpQty=<qty>
//   실행:
//     ... --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesAlgoOpenOrders,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");
const { getPosition, upsertPositionMetaOnly } = require("../src/storage/positionsPaper");

function parseArgs(argv) {
  const out = {
    symbol: "SOLUSDT",
    tpOrderId: null,
    tpPrice: null,
    tpQty: null,
    execute: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
    if (arg.startsWith("--symbol=")) { out.symbol = String(arg.split("=")[1] || "").toUpperCase(); continue; }
    if (arg.startsWith("--tpOrderId=")) { out.tpOrderId = String(arg.split("=")[1] || "").trim(); continue; }
    if (arg.startsWith("--tpPrice=")) { out.tpPrice = Number(arg.split("=")[1]); continue; }
    if (arg.startsWith("--tpQty=")) { out.tpQty = Number(arg.split("=")[1]); continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const { symbol, execute } = args;

  console.log("─".repeat(72));
  console.log(`[SOL META PATCH] symbol=${symbol} execute=${execute}`);
  console.log("─".repeat(72));

  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) throw new Error("BINANCE_KEYS_MISSING");

  // (1) 거래소 현재 포지션/알고주문 재확인
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const ex = (account.positions || []).find((p) => String(p.symbol || "").toUpperCase() === symbol
    && Number(p.positionAmt || 0) !== 0);
  if (!ex) {
    console.log("[ABORT] 거래소에 열린 포지션 없음.");
    process.exit(0);
  }
  console.log(`[EXCHANGE] positionAmt=${ex.positionAmt} entry=${ex.entryPrice} uPnL=${ex.unrealizedProfit}`);

  const algo = await fetchFuturesAlgoOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol });
  const tpAlgo = (Array.isArray(algo) ? algo : []).find((o) =>
    String(o.type || o.origType || "").toUpperCase() === "TAKE_PROFIT_MARKET"
    && o.reduceOnly === true);
  if (!tpAlgo) {
    console.log("[ABORT] 거래소 TP1 ALGO 주문이 보이지 않음 — 먼저 manual-sol-tp1-place.js 실행 필요.");
    process.exit(1);
  }
  console.log(`[ALGO FOUND] orderId=${tpAlgo.orderId} stopPrice=${tpAlgo.stopPrice} qty=${tpAlgo.quantity}`);

  const tpOrderId = args.tpOrderId || String(tpAlgo.orderId);
  const tpPrice = Number.isFinite(args.tpPrice) ? args.tpPrice : Number(tpAlgo.stopPrice);
  const tpQty = Number.isFinite(args.tpQty) ? args.tpQty : Number(tpAlgo.quantity);

  // (2) Firestore meta 읽기
  const pos = await getPosition({ exchange: "BINANCEFUT", symbol });
  if (!pos) {
    console.log("[ABORT] Firestore positions_paper 에 SOL 문서 없음.");
    process.exit(1);
  }
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const writeToken = Object.prototype.hasOwnProperty.call(pos, "position_write_token")
    ? (pos.position_write_token ?? null)
    : null;

  console.log(`[FIRESTORE BEFORE]`);
  console.log(`  position_write_token                 = ${writeToken}`);
  console.log(`  native_protection_tp_order_id        = ${meta.native_protection_tp_order_id}`);
  console.log(`  native_protection_tp_status          = ${meta.native_protection_tp_status}`);
  console.log(`  native_protection_tp_price           = ${meta.native_protection_tp_price}`);
  console.log(`  native_protection_tp_qty             = ${meta.native_protection_tp_qty}`);
  console.log(`  native_protection_refresh_status     = ${meta.native_protection_refresh_status}`);
  console.log(`  native_protection_refresh_at_ms      = ${meta.native_protection_refresh_at_ms}`);

  const nowMs = Date.now();
  const nextMeta = {
    ...meta,
    native_protection_tp_order_id: tpOrderId,
    native_protection_tp_status: "OK",
    native_protection_tp_price: tpPrice,
    native_protection_tp_qty: tpQty,
    native_protection_refresh_status: "OK",
    native_protection_refresh_at_ms: nowMs,
    native_protection_refresh_source: "MANUAL_RECOVERY_2026_04_19",
    native_protection_refresh_note:
      "SOLUSDT TP1 manual 재배치 후 gate unblock 용 meta patch. PR #13 (settings graceful-degrade) / PR #14 (BE-raise unprotected fix) 배포 직후 runtime 이 재평가해서 덮어쓸 예정.",
    manual_sol_tp1_recovery_at_ms: nowMs,
  };

  console.log(`[PLAN]`);
  console.log(`  native_protection_tp_order_id     -> ${tpOrderId}`);
  console.log(`  native_protection_tp_status       -> OK`);
  console.log(`  native_protection_tp_price        -> ${tpPrice}`);
  console.log(`  native_protection_tp_qty          -> ${tpQty}`);
  console.log(`  native_protection_refresh_status  -> OK`);
  console.log(`  native_protection_refresh_at_ms   -> ${nowMs}`);

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음 — Firestore 변경 없음.");
    process.exit(0);
  }

  try {
    await upsertPositionMetaOnly({
      exchange: "BINANCEFUT",
      symbol,
      runId: `RUN__MANUAL_SOL_NATIVE_PROTECTION_META_PATCH__${symbol}__${nowMs}`,
      executionMode: "LIVE",
      meta: nextMeta,
      source: "MANUAL_SOL_NATIVE_PROTECTION_META_PATCH",
      mutationKind: "POSITION_META_UPSERT",
      reason: "MANUAL_SOL_TP1_META_PATCH_2026_04_19",
      expectedWriteToken: writeToken,
    });
    console.log(`[META OK] positions_paper/${symbol} native_protection_refresh_status=OK @ ${new Date(nowMs).toISOString()}`);
  } catch (err) {
    console.error(`[META FAIL] ${err && err.message || err}`);
    throw err;
  }

  console.log("─".repeat(72));
  console.log("[DONE]");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
