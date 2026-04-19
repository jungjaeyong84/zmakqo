#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-final-close.js
//
// ETHUSDT 의 TP1 이 네이티브 레벨에서 이미 실패했고 (PR #13 미배포 시점의
// Firestore gRPC 순단 후유증), 수동 50% reduceOnly MARKET 으로 절반을
// 청산했지만 meta 로 tp_p1_done 을 세우는 것이 BINANCE_FUTURES_POSITION_SYNC
// 의 linkage 체크 (paperBinanceRunner.js:8230-8281) 에 의해 계속 리셋되고
// 있다.  exit-integrity gate 의 TP1_PROTECTION_MISSING 을 해소할 수 있는
// 유일한 정직한 경로는 ETH 잔여 0.426 전체를 완전히 청산하고 포지션을
// 플랫으로 만드는 것이다 (플랫이 되면 active=false → actionable_live_issue
// 행에서 빠진다).
//
// 동작:
//   1) 포지션 재확인.
//   2) MARKET <exit-side> reduceOnly <absQty>  으로 잔여 수량 전체 청산.
//   3) 이후 cancelFuturesOpenOrders 로 regular + algo 전부 취소 (STOP_MARKET
//      4000001118137173 @ 2360 이 orphan 으로 남지 않게).
//
// 사용법:
//   DRY-RUN (기본):
//     node scripts/manual-eth-final-close.js
//   실행:
//     node scripts/manual-eth-final-close.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  placeFuturesMarketOrder,
  cancelFuturesOpenOrders,
  fetchFuturesExchangeInfo,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");

const SYMBOL = "ETHUSDT";

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
  }
  return out;
}

function sanitizeId(str, maxLen = 36) {
  return String(str || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxLen);
}

function floorToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.floor(value / step) * step;
}

async function main() {
  const { execute } = parseArgs(process.argv);

  console.log("─".repeat(72));
  console.log(`[MANUAL ETH FINAL CLOSE] symbol=${SYMBOL} execute=${execute}`);
  console.log("─".repeat(72));

  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) throw new Error("BINANCE_KEYS_MISSING");

  // (1) 포지션 확인
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const ex = (account.positions || []).find((p) => String(p.symbol || "").toUpperCase() === SYMBOL
    && Number(p.positionAmt || 0) !== 0);
  if (!ex) {
    console.log("[ABORT] 거래소에 열린 ETHUSDT 포지션 없음 — 이미 플랫.");
    // 그래도 남은 open order 가 있는지는 확인해서 취소해주자.
    const leftoverOpen = await fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol: SYMBOL });
    if (Array.isArray(leftoverOpen) && leftoverOpen.length > 0) {
      console.log(`[WARN] 플랫인데 아직 open order 가 ${leftoverOpen.length} 건 남아 있음:`);
      for (const o of leftoverOpen) {
        console.log(`  - id=${o.orderId} type=${o.type} side=${o.side} reduceOnly=${o.reduceOnly} stopPrice=${o.stopPrice}`);
      }
      if (execute) {
        const cleared = await cancelFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol: SYMBOL });
        console.log("[CLEARED]", JSON.stringify(cleared));
      } else {
        console.log("[DRY-RUN] --execute 시 cancelFuturesOpenOrders 로 전부 취소.");
      }
    }
    process.exit(0);
  }

  const positionAmt = Number(ex.positionAmt);
  const absQty = Math.abs(positionAmt);
  const entryPrice = Number(ex.entryPrice);
  const side = positionAmt > 0 ? "LONG" : "SHORT";
  console.log(`[EXCHANGE] side=${side} qty=${absQty} entry=${entryPrice} uPnL=${ex.unrealizedProfit}`);

  // (2) stepSize 로 수량 floor (혹시라도 부동소수 잔재 방지)
  const info = await fetchFuturesExchangeInfo(SYMBOL);
  console.log(`[EXCHANGE_INFO] stepSize=${info.stepSize} minQty=${info.minQty} tickSize=${info.tickSize}`);
  const closeQty = floorToStep(absQty, info.stepSize);
  if (!Number.isFinite(closeQty) || closeQty <= 0) {
    throw new Error(`CLOSE_QTY_INVALID abs=${absQty} stepSize=${info.stepSize}`);
  }
  if (closeQty < absQty) {
    console.warn(`[WARN] floor 이후 closeQty=${closeQty} < absQty=${absQty} — 잔재 ${(absQty - closeQty).toFixed(8)} 남을 수 있음.`);
  }

  // (3) 기존 open order 요약
  const open = await fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol: SYMBOL });
  console.log(`[OPEN ORDERS] ${Array.isArray(open) ? open.length : 0} 건`);
  for (const o of (Array.isArray(open) ? open : [])) {
    console.log(`  - id=${o.orderId} type=${o.type} side=${o.side} reduceOnly=${o.reduceOnly} stopPrice=${o.stopPrice} origQty=${o.origQty}`);
  }

  const exitSide = side === "SHORT" ? "BUY" : "SELL";
  const nowSec = Math.floor(Date.now() / 1000);
  const clientOrderId = sanitizeId(`dbj_manual_final_${SYMBOL}_${nowSec}`);

  console.log(`[PLAN] MARKET ${exitSide} reduceOnly qty=${closeQty}`);
  console.log(`       entry=${entryPrice} ${side} → 예상 실현 PnL ≈ uPnL(${ex.unrealizedProfit}) 근방`);
  console.log(`       clientOrderId=${clientOrderId}`);
  console.log(`       이후 cancelFuturesOpenOrders 로 regular + algo 전부 취소.`);

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음.");
    process.exit(0);
  }

  // (4) MARKET 청산
  const closeResult = await placeFuturesMarketOrder({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    symbol: SYMBOL,
    side: exitSide,
    quantity: String(closeQty),
    reduceOnly: true,
    clientOrderId,
  });
  console.log(`[CLOSE ORDER OK]`);
  console.log(JSON.stringify(closeResult, null, 2));

  // (5) 모든 open order 취소 (regular + algo). 포지션이 방금 플랫이 되었으므로
  //     STOP_MARKET 4000001118137173 @ 2360 같은 orphan 은 어차피 트리거돼도
  //     reduceOnly 라서 안전하긴 하지만 깨끗하게 치워둔다.
  const cancelResult = await cancelFuturesOpenOrders({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    symbol: SYMBOL,
  });
  console.log(`[CANCEL ALL OPEN ORDERS OK]`);
  console.log(JSON.stringify(cancelResult, null, 2));

  console.log("─".repeat(72));
  console.log("[DONE]");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
