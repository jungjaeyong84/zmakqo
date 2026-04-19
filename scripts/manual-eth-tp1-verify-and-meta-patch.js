#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-tp1-verify-and-meta-patch.js
//
// `manual-eth-tp1-reduce.js` 실행 직후,
//   1) 거래소 실제 포지션을 다시 읽어서 체결 결과를 확인하고
//   2) Firestore meta 에 TP1 완료 마킹을 안전하게 적용
// 하는 follow-up 스크립트.  원본 스크립트에서 체결 확인/meta 업데이트가
// 실패한 케이스 (`POSITION_WRITE_TOKEN_REQUIRED`) 를 정밀 수리한다.
//
// 사용법:
//   node scripts/manual-eth-tp1-verify-and-meta-patch.js --symbol=ETHUSDT \
//        --orderId=<orderIdFromPreviousRun> --clientOrderId=<clientOrderId> \
//        --execute-meta
//   (--execute-meta 없으면 DRY-RUN)
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesUserTrades,
  fetchFuturesOrder,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");
const { getPosition, upsertPositionMetaOnly } = require("../src/storage/positionsPaper");

function parseArgs(argv) {
  const out = { symbol: "ETHUSDT", orderId: null, clientOrderId: null, executeMeta: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute-meta") { out.executeMeta = true; continue; }
    if (arg.startsWith("--symbol=")) { out.symbol = String(arg.split("=")[1] || "").toUpperCase(); continue; }
    if (arg.startsWith("--orderId=")) { out.orderId = String(arg.split("=")[1] || "").trim(); continue; }
    if (arg.startsWith("--clientOrderId=")) { out.clientOrderId = String(arg.split("=")[1] || "").trim(); continue; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const { symbol, orderId, clientOrderId, executeMeta } = args;

  console.log("─".repeat(72));
  console.log(`[VERIFY & META PATCH] symbol=${symbol} executeMeta=${executeMeta}`);
  console.log(`                     orderId=${orderId}  clientOrderId=${clientOrderId}`);
  console.log("─".repeat(72));

  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) {
    throw new Error("BINANCE_KEYS_MISSING");
  }

  // (1) 거래소 현재 포지션
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const positions = Array.isArray(account.positions) ? account.positions : [];
  const ex = positions.find((p) => String(p.symbol || "").toUpperCase() === symbol);
  if (!ex) {
    console.log("[EXCHANGE] ETHUSDT entry 없음 — 이미 플랫일 가능성");
  } else {
    const amt = Number(ex.positionAmt);
    const entry = Number(ex.entryPrice);
    console.log(`[EXCHANGE] positionAmt=${amt} (abs=${Math.abs(amt)}) entry=${entry} uPnL=${ex.unrealizedProfit}`);
  }

  // (2) 주문 조회 — orderId 기반
  if (orderId) {
    try {
      const order = await fetchFuturesOrder({
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        symbol,
        orderId,
      });
      console.log(`[ORDER CHECK] status=${order.status} executedQty=${order.executedQty} avgPrice=${order.avgPrice} updateTime=${order.updateTime}`);
    } catch (err) {
      console.warn(`[ORDER CHECK FAIL] ${err && err.message || err}`);
    }
  }

  // (3) userTrades 에서 해당 clientOrderId 체결 내역 찾기
  let fillTrade = null;
  if (clientOrderId) {
    try {
      const trades = await fetchFuturesUserTrades({
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        symbol,
        limit: 20,
      });
      fillTrade = (Array.isArray(trades) ? trades : [])
        .find((t) => String(t.clientOrderId || "") === clientOrderId
          || String(t.orderId || "") === String(orderId));
      if (fillTrade) {
        console.log(`[TRADE FOUND] price=${fillTrade.price} qty=${fillTrade.qty} realizedPnl=${fillTrade.realizedPnl} time=${new Date(Number(fillTrade.time)).toISOString()}`);
      } else {
        console.warn(`[TRADE NOT FOUND] clientOrderId=${clientOrderId} / orderId=${orderId} 해당 체결 없음 — 좀 더 넓은 범위로 재조회 권장`);
      }
    } catch (err) {
      console.warn(`[USER TRADES FAIL] ${err && err.message || err}`);
    }
  }

  // (4) Firestore meta 업데이트 계획
  const pos = await getPosition({ exchange: "BINANCEFUT", symbol });
  const meta = (pos && pos.meta) || {};
  const writeToken = pos && Object.prototype.hasOwnProperty.call(pos, "position_write_token")
    ? (pos.position_write_token ?? null)
    : null;
  console.log(`[FIRESTORE] position_write_token=${writeToken}`);
  console.log(`            meta.tp_p1_done (before)=${meta.tp_p1_done}`);

  if (meta.tp_p1_done === true) {
    console.log("[ABORT] meta.tp_p1_done 이미 true — 재적용 생략");
    process.exit(0);
  }

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const nextMeta = {
    ...meta,
    tp_p1_done: true,
    tp_p1_done_at_ms: nowMs,
    tp_p1_done_source: "MANUAL_RECOVERY_2026_04_19",
    tp_p1_done_client_order_id: clientOrderId || null,
    tp_p1_done_order_id: orderId ? String(orderId) : null,
    tp_p1_done_fill_qty: fillTrade ? Number(fillTrade.qty) : null,
    tp_p1_done_fill_avg_price: fillTrade ? Number(fillTrade.price) : null,
    tp_p1_done_realized_pnl: fillTrade ? Number(fillTrade.realizedPnl) : null,
    manual_tp1_recovery_note: "ETHUSDT 자동 TP1 미발동 — Firestore gRPC 순단으로 native protection refresh 반복 실패 (settings graceful-degrade PR #13 이전). 수동 reduceOnly MARKET 으로 50% 청산 후 meta 강제 마킹.",
  };

  if (!executeMeta) {
    console.log("[DRY-RUN META] --execute-meta 없음 — 아래 patch 는 실제 적용되지 않음:");
    console.log(JSON.stringify({
      tp_p1_done: nextMeta.tp_p1_done,
      tp_p1_done_at_ms: nextMeta.tp_p1_done_at_ms,
      tp_p1_done_source: nextMeta.tp_p1_done_source,
      tp_p1_done_client_order_id: nextMeta.tp_p1_done_client_order_id,
      tp_p1_done_order_id: nextMeta.tp_p1_done_order_id,
      tp_p1_done_fill_qty: nextMeta.tp_p1_done_fill_qty,
      tp_p1_done_fill_avg_price: nextMeta.tp_p1_done_fill_avg_price,
      tp_p1_done_realized_pnl: nextMeta.tp_p1_done_realized_pnl,
    }, null, 2));
    process.exit(0);
  }

  try {
    await upsertPositionMetaOnly({
      exchange: "BINANCEFUT",
      symbol,
      runId: `RUN__MANUAL_TP1_RECOVERY_META_PATCH__${symbol}__${nowMs}`,
      executionMode: "LIVE",
      meta: nextMeta,
      source: "MANUAL_TP1_RECOVERY",
      mutationKind: "POSITION_META_UPSERT",
      reason: "MANUAL_TP1_RECOVERY_META_PATCH_2026_04_19",
      expectedWriteToken: writeToken,  // ← 이게 빠져서 원본 스크립트가 실패했음
    });
    console.log(`[META OK] positions_paper/${symbol} tp_p1_done=true @ ${nowIso}`);
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
