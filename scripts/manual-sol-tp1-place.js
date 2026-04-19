#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-sol-tp1-place.js
//
// PR #13 (settings Firestore graceful-degrade) 배포 전까지 SOLUSDT 의 native
// TP1 주문이 placement 되지 못한 상태를 수동으로 수리하기 위한 스크립트.
//
// ─ 배경 ──────────────────────────────────────────────────────────────────────
// SOLUSDT SHORT 11.55 @ 85.88 은 현재 native stop 은 있지만 (86.59, orderId
// 4000001115476590) native TP1 주문이 아예 없다.  tick-exit 의 protection
// refresh 루프가 Firestore gRPC 14 UNAVAILABLE 로 연속 실패해 TP1 주문이
// 최초 placement 시점에도 성공적으로 등록되지 않았다.  이 상태에서
// exit-integrity deploy gate 가 TP1_PROTECTION_MISSING 으로 배포를 막고,
// 공교롭게도 그 배포가 바로 이 버그를 고치는 PR #13 이다.
//
// 본 스크립트는 exchange 에 TP1 TAKE_PROFIT_MARKET reduceOnly 주문을 정식
// 으로 배치해 gate 의 root 요구사항을 충족시킨다.  규칙(TP_P1=0.0165,
// TP_P1_QTY=0.5)은 실제 positions_paper meta 의 exit_rules_override 에서
// 이미 확인된 값을 사용한다.
//
// 사용법:
//   DRY-RUN (기본):
//     node scripts/manual-sol-tp1-place.js
//   실행:
//     node scripts/manual-sol-tp1-place.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  placeFuturesTakeProfitMarketOrder,
  fetchFuturesExchangeInfo,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");

const SYMBOL = "SOLUSDT";
const TP_P1_PCT = 0.0165;   // exit_rules_override.TP_P1 확인됨
const TP_P1_QTY = 0.5;      // exit_rules_override.TP_P1_QTY 확인됨

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
  }
  return out;
}

function sanitizeId(str, maxLen = 32) {
  return String(str || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxLen);
}

function floorToStep(value, step) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.floor(value / step) * step;
}

function roundToTick(value, tick) {
  if (!Number.isFinite(value) || !Number.isFinite(tick) || tick <= 0) return value;
  return Math.round(value / tick) * tick;
}

// step/tick 의 소수 자리수를 세서 부동소수 노이즈 (5.7700000000000005,
// 84.46000000000001 같은) 를 없애준다. Binance 는 precision 이 stepSize 를
// 초과하면 -1111 로 리젝한다.
function decimalsOf(step) {
  if (!Number.isFinite(step) || step <= 0) return 0;
  const s = step.toString();
  if (s.indexOf("e") >= 0) {
    const m = s.match(/e-(\d+)/);
    if (m) return Number(m[1]);
    return 0;
  }
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : (s.length - dot - 1);
}

function formatWithStep(value, step) {
  const d = decimalsOf(step);
  return Number(value).toFixed(d);
}

async function main() {
  const { execute } = parseArgs(process.argv);

  console.log("─".repeat(72));
  console.log(`[MANUAL SOL TP1] symbol=${SYMBOL} TP_P1=${TP_P1_PCT} TP_P1_QTY=${TP_P1_QTY} execute=${execute}`);
  console.log("─".repeat(72));

  const keys = await resolveBinanceKeys();
  if (!keys || !keys.apiKey || !keys.apiSecret) throw new Error("BINANCE_KEYS_MISSING");

  // (1) 포지션 확인
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const ex = (account.positions || []).find((p) => String(p.symbol || "").toUpperCase() === SYMBOL
    && Number(p.positionAmt || 0) !== 0);
  if (!ex) {
    console.log("[ABORT] 거래소에 열린 SOLUSDT 포지션 없음.");
    process.exit(0);
  }
  const positionAmt = Number(ex.positionAmt);
  const absQty = Math.abs(positionAmt);
  const entryPrice = Number(ex.entryPrice);
  const side = positionAmt > 0 ? "LONG" : "SHORT";
  console.log(`[EXCHANGE] side=${side} qty=${absQty} entry=${entryPrice} uPnL=${ex.unrealizedProfit}`);

  // (2) 기존 open orders 검사 — TP1 이 이미 있으면 중복 방지
  const open = await fetchFuturesOpenOrders({ apiKey: keys.apiKey, apiSecret: keys.apiSecret, symbol: SYMBOL });
  const existingTp = (Array.isArray(open) ? open : []).find((o) =>
    String(o.type || "").toUpperCase() === "TAKE_PROFIT_MARKET"
    && (o.reduceOnly === true || o.closePosition === true));
  if (existingTp) {
    console.log(`[ALREADY PROTECTED] 기존 TAKE_PROFIT_MARKET 존재: orderId=${existingTp.orderId} stopPrice=${existingTp.stopPrice}`);
    console.log("                   중복 방지로 종료.");
    process.exit(0);
  }

  // (3) exchangeInfo 로 stepSize / tickSize 획득
  const info = await fetchFuturesExchangeInfo(SYMBOL);
  console.log(`[EXCHANGE_INFO] stepSize=${info.stepSize} minQty=${info.minQty} tickSize=${info.tickSize} minNotional=${info.minNotional}`);

  // (4) TP1 qty / price 산출
  const rawTpQty = absQty * TP_P1_QTY;
  const tpQtyNum = floorToStep(rawTpQty, info.stepSize);
  if (!Number.isFinite(tpQtyNum) || tpQtyNum <= 0) {
    throw new Error(`TP1_QTY_INVALID raw=${rawTpQty} stepSize=${info.stepSize}`);
  }
  if (Number.isFinite(info.minQty) && tpQtyNum < info.minQty) {
    throw new Error(`TP1_QTY_BELOW_MIN qty=${tpQtyNum} min=${info.minQty}`);
  }
  const tpQtyStr = formatWithStep(tpQtyNum, info.stepSize); // "5.77"

  // SHORT: TP1 target price = entry × (1 - TP_P1)
  const rawTpPrice = side === "SHORT"
    ? entryPrice * (1 - TP_P1_PCT)
    : entryPrice * (1 + TP_P1_PCT);
  const tpPriceNum = roundToTick(rawTpPrice, info.tickSize);
  const tpPriceStr = formatWithStep(tpPriceNum, info.tickSize); // "84.46"

  const exitSide = side === "SHORT" ? "BUY" : "SELL";
  const nowSec = Math.floor(Date.now() / 1000);
  const clientOrderId = sanitizeId(`dbj_manual_tp1_${SYMBOL}_50p_${nowSec}`);

  const notional = Number(tpQtyStr) * Number(tpPriceStr);
  console.log(`[PLAN] TAKE_PROFIT_MARKET ${exitSide} reduceOnly`);
  console.log(`       qty=${tpQtyStr} (raw=${rawTpQty}, floored by step=${info.stepSize})`);
  console.log(`       stopPrice=${tpPriceStr} (raw=${rawTpPrice.toFixed(6)}, rounded by tick=${info.tickSize})`);
  console.log(`       entry=${entryPrice} → tp=${tpPriceStr} → pnl per unit=${(entryPrice - Number(tpPriceStr)).toFixed(6)} (SHORT)`);
  console.log(`       estimated gross profit = ${(Number(tpQtyStr) * (entryPrice - Number(tpPriceStr))).toFixed(4)} USDT`);
  console.log(`       notional ≈ ${notional.toFixed(2)} USDT (min=${info.minNotional})`);
  console.log(`       clientOrderId=${clientOrderId}`);
  console.log(`       workingType=MARK_PRICE priceProtect=true`);

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음.");
    process.exit(0);
  }

  // (5) 실행
  const result = await placeFuturesTakeProfitMarketOrder({
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    symbol: SYMBOL,
    side: exitSide,
    stopPrice: tpPriceStr,
    quantity: tpQtyStr,
    closePosition: false,     // partial 50%
    reduceOnly: true,
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
