#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-protective-stop.js
//
// PR #13 (settings Firestore graceful-degrade) 배포 전까지 ETHUSDT 잔여 러너
// 가 거래소 native stop 없이 방치되는 것을 막기 위한 임시 보호망.  SHORT
// 포지션용 STOP_MARKET BUY 를 stopPrice 에 건다.
//
// 사용법:
//   DRY-RUN:
//     node scripts/manual-eth-protective-stop.js --symbol=ETHUSDT --stopPrice=2360
//   실행:
//     node scripts/manual-eth-protective-stop.js --symbol=ETHUSDT --stopPrice=2360 --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  placeFuturesStopMarketOrder,
  fetchFuturesOpenOrders,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");

function parseArgs(argv) {
  const out = { symbol: "ETHUSDT", stopPrice: null, execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
    if (arg.startsWith("--symbol=")) { out.symbol = String(arg.split("=")[1] || "").toUpperCase(); continue; }
    if (arg.startsWith("--stopPrice=")) {
      const p = Number(arg.split("=")[1]);
      if (Number.isFinite(p) && p > 0) out.stopPrice = p;
      continue;
    }
  }
  return out;
}

function sanitizeId(str, maxLen = 32) {
  return String(str || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxLen);
}

async function main() {
  const { symbol, stopPrice, execute } = parseArgs(process.argv);
  if (!stopPrice) {
    throw new Error("--stopPrice=<number> 필요");
  }

  console.log("─".repeat(72));
  console.log(`[PROTECTIVE STOP] symbol=${symbol} stopPrice=${stopPrice} execute=${execute}`);
  console.log("─".repeat(72));

  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) throw new Error("BINANCE_KEYS_MISSING");

  // (1) 포지션 재확인
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const ex = (account.positions || []).find((p) => String(p.symbol || "").toUpperCase() === symbol
    && Number(p.positionAmt || 0) !== 0);
  if (!ex) {
    console.log("[ABORT] 거래소에 열린 포지션 없음.");
    process.exit(0);
  }
  const positionAmt = Number(ex.positionAmt);
  const absQty = Math.abs(positionAmt);
  const entryPrice = Number(ex.entryPrice);
  const side = positionAmt > 0 ? "LONG" : "SHORT";
  console.log(`[EXCHANGE] side=${side} qty=${absQty} entry=${entryPrice} uPnL=${ex.unrealizedProfit}`);

  // (2) 기존 open orders 에 protective stop 이 이미 있는지 확인 — 중복 방지
  const open = await fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol });
  const existingStop = (Array.isArray(open) ? open : []).find((o) =>
    String(o.type || "").toUpperCase() === "STOP_MARKET"
    && o.reduceOnly === true);
  if (existingStop) {
    console.log(`[ALREADY PROTECTED] 기존 STOP_MARKET 존재: orderId=${existingStop.orderId} stopPrice=${existingStop.stopPrice}`);
    console.log("                   중복 방지로 종료.");
    process.exit(0);
  }

  const exitSide = side === "LONG" ? "SELL" : "BUY";
  const nowSec = Math.floor(Date.now() / 1000);
  const clientOrderId = sanitizeId(`dbj_manual_protect_${symbol}_${nowSec}`);

  // 손실 시뮬레이션
  const lossPerUnit = side === "SHORT" ? (stopPrice - entryPrice) : (entryPrice - stopPrice);
  const lossTotal = lossPerUnit * absQty;
  console.log(`[PLAN] ${exitSide} STOP_MARKET stopPrice=${stopPrice} reduceOnly qty=${absQty}`);
  console.log(`       entry=${entryPrice} → stop=${stopPrice} → 예상 최대손실=${lossTotal.toFixed(2)} USDT`);

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음.");
    process.exit(0);
  }

  // (3) 실행
  //   placeFuturesStopMarketOrder 의 시그니처에는 `quantity` 가 없고,
  //   Binance 는 STOP_MARKET 에서 closePosition=true 를 쓸 때 잔여 포지션
  //   전부를 자동으로 커버한다.  부분 protective stop 을 원한다면 별도의
  //   ALGO TRAILING 또는 일반 reduceOnly 주문을 써야 하지만, 지금은 잔여
  //   0.426 전체에 대한 보호망이 목적이므로 closePosition=true 가 옳다.
  const result = await placeFuturesStopMarketOrder({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    symbol,
    side: exitSide,
    stopPrice: String(stopPrice),
    closePosition: true,
    workingType: "MARK_PRICE",
    priceProtect: true,
    clientOrderId,
  });
  console.log(`[ORDER OK]`);
  console.log(JSON.stringify(result, null, 2));
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
