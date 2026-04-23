#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-doge-tp1-placement-2026-04-20.js
//
// 2026-04-20 DOGEUSDT LONG 포지션에 TP1 reduce-only 주문을 수동 배치.
//
// 배경:
//   • 오늘 오전 DOGE 포지션이 external-entry 로 진입되어 native protection
//     MISSING 상태였음 (simplified_exit_v2_enabled=true, external_active=true).
//   • 같은 날 `manual-doge-initial-stop-2026-04-20.js` 로 SL @ 0.09335 배치됨
//     (algoId 4000001127442440).
//   • SL 은 복구됐지만 TP1 reduce-only 주문은 여전히 부재 →
//     authority-board 에서 TP1_PROTECTION_MISSING actionable 로 분류 →
//     exit-integrity deploy gate BLOCKED → PR #21 Cloud Build 실패.
//
//   이 스크립트는 TP1 을 수동 배치해서 authority-board 이슈를 해소하고
//   배포 게이트를 열어주는 역할.
//
// TP1 규칙 (meta.exit_rules_override 에서 확정):
//   TP_P1 = 0.0165 → entry × 1.0165 = 0.09414 × 1.0165 = 0.09569331
//   TP_P1_QTY = 0.5 → 21292 × 0.5 = 10646 DOGE
//   LONG 기준 round DOWN to tick (보수적 = entry 쪽 = TP1 더 빨리 체결).
//
// 파라미터:
//   type=TAKE_PROFIT_MARKET, side=SELL, reduceOnly=true, closePosition=false,
//   workingType=MARK_PRICE, priceProtect=true.
//
// 사용:
//   DRY-RUN: node scripts/legacy/incidents/2026-04-20/manual-doge-tp1-placement-2026-04-20.js
//   실행:    node scripts/legacy/incidents/2026-04-20/manual-doge-tp1-placement-2026-04-20.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

// SL 스크립트와 동일하게 egress proxy off — 로컬에서 직접 Binance 호출.
process.env.EGRESS_PROXY_MODE = "";
process.env.EGRESS_PROXY_URL = "";
process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL = "";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesExchangeInfo,
  placeFuturesTakeProfitMarketOrder,
} = require("../../../../src/exchanges/binanceFuturesPrivate");

const SYMBOL = "DOGEUSDT";
const CLOSE_SIDE = "SELL";       // LONG 포지션 → SELL 로 TP
const TP_P1_PCT = 0.0165;        // +1.65% (meta.exit_rules_override.TP_P1)
const TP_P1_QTY_RATIO = 0.5;     // 50% (meta.exit_rules_override.TP_P1_QTY)

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") out.execute = true;
  }
  return out;
}

async function loadKeys() {
  const envKey = process.env.BINANCEFUT_API_KEY;
  const envSecret = process.env.BINANCEFUT_API_SECRET;
  if (envKey && envSecret) return { apiKey: envKey, apiSecret: envSecret };
  const { execSync } = require("child_process");
  const secret = (name) =>
    execSync(`gcloud secrets versions access latest --secret=${name}`, { encoding: "utf8" }).trim();
  return {
    apiKey: secret("BINANCEFUT_API_KEY"),
    apiSecret: secret("BINANCEFUT_API_SECRET"),
  };
}

function roundDownToTick(price, tickSize) {
  if (!tickSize || !(tickSize > 0)) return price;
  const n = Math.floor(price / tickSize);
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)));
  return Number((n * tickSize).toFixed(decimals));
}

function roundDownToStep(qty, stepSize) {
  // Binance quantity precision — LOT_SIZE.stepSize. DOGE 는 1 이라 정수.
  if (!stepSize || !(stepSize > 0)) return qty;
  const n = Math.floor(qty / stepSize);
  const decimals = Math.max(0, -Math.floor(Math.log10(stepSize)));
  return Number((n * stepSize).toFixed(decimals));
}

async function main() {
  const { execute } = parseArgs(process.argv);
  console.log("─".repeat(72));
  console.log(`[DOGE LONG TP1 MANUAL] symbol=${SYMBOL} tp_p1=${TP_P1_PCT} qty_ratio=${TP_P1_QTY_RATIO} execute=${execute}`);
  console.log("─".repeat(72));

  const { apiKey, apiSecret } = await loadKeys();
  if (!apiKey || !apiSecret) {
    console.error("[ABORT] BINANCEFUT API keys missing");
    process.exit(1);
  }

  // ── Step 1: fetch position + open orders + exchangeInfo ──────────────
  console.log(`[STEP 1/3] fetch account/position + open orders + exchangeInfo ...`);
  const [account, regular, algoRaw, info] = await Promise.all([
    fetchBinanceFuturesAccount({ apiKey, apiSecret }),
    fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
    fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
    fetchFuturesExchangeInfo(SYMBOL),
  ]);

  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const pos = positions.find((p) => String(p.symbol).toUpperCase() === SYMBOL);
  if (!pos) {
    console.error(`[ABORT] ${SYMBOL} position not found`);
    process.exit(1);
  }
  const positionAmt = Number(pos.positionAmt);
  const entryPrice = Number(pos.entryPrice);
  if (!Number.isFinite(positionAmt) || positionAmt <= 0) {
    console.error(`[ABORT] ${SYMBOL} positionAmt=${pos.positionAmt} — LONG not open`);
    process.exit(1);
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    console.error(`[ABORT] ${SYMBOL} entryPrice invalid: ${pos.entryPrice}`);
    process.exit(1);
  }
  console.log(`  position: side=LONG positionAmt=${positionAmt} entryPrice=${entryPrice}`);
  console.log(`  tickSize=${info.tickSize} pricePrecision=${info.pricePrecision} stepSize=${info.stepSize || "N/A"}`);

  // compute TP1: LONG → entry * (1 + TP_P1_PCT), round DOWN to tick
  const rawTpPrice = entryPrice * (1 + TP_P1_PCT);
  const tpPrice = roundDownToTick(rawTpPrice, info.tickSize);
  const rawTpQty = positionAmt * TP_P1_QTY_RATIO;
  const stepSize = info.stepSize || 1;
  const tpQty = roundDownToStep(rawTpQty, stepSize);
  console.log(`  TP1 trigger: raw=${rawTpPrice.toFixed(8)} → rounded=${tpPrice}  (${((tpPrice/entryPrice - 1)*100).toFixed(3)}%)`);
  console.log(`  TP1 qty:     raw=${rawTpQty} → rounded=${tpQty}  (${((tpQty/positionAmt)*100).toFixed(3)}% of position)`);

  // sanity: qty must be strictly LESS than position (otherwise should use closePosition=true)
  if (!(tpQty > 0) || tpQty >= positionAmt) {
    console.error(`[ABORT] tpQty=${tpQty} invalid (must be >0 and <positionAmt=${positionAmt})`);
    process.exit(1);
  }

  // ── Step 2: check for existing SELL TP1 reduce-only orders ─────────────
  const algo = Array.isArray(algoRaw && algoRaw.orders) ? algoRaw.orders : (Array.isArray(algoRaw) ? algoRaw : []);
  const allOrders = [...(regular || []), ...algo];
  const tpOrders = allOrders.filter((o) => {
    const type = String(o.type || o.origType || "").toUpperCase();
    const side = String(o.side || "").toUpperCase();
    const reduceOnly = o.reduceOnly === true || String(o.reduceOnly).toLowerCase() === "true";
    const closePos = o.closePosition === true || String(o.closePosition).toLowerCase() === "true";
    return side === CLOSE_SIDE && type.includes("TAKE_PROFIT") && (reduceOnly || closePos);
  });
  console.log(`  open orders total=${allOrders.length} (regular=${regular ? regular.length : 0}, algo=${algo.length})`);
  console.log(`  SELL TAKE_PROFIT reduceOnly/closePosition orders: ${tpOrders.length}`);
  tpOrders.forEach((o, i) => {
    console.log(`    [${i}] id=${o.orderId} type=${o.type || o.origType} stopPrice=${o.stopPrice || o.triggerPrice} qty=${o.origQty || o.quantity} reduceOnly=${o.reduceOnly} closePosition=${o.closePosition}`);
  });
  if (tpOrders.length > 0) {
    console.error(`[ABORT] 기존 SELL TP 주문이 이미 있음 — 중복 배치 방지. 먼저 수동 확인 필요.`);
    process.exit(1);
  }

  if (!execute) {
    console.log("");
    console.log("[DRY-RUN] --execute 없음 — 아무것도 변경 안 함.");
    console.log(`[DRY-RUN] 배치 예정: TAKE_PROFIT_MARKET SELL @ ${tpPrice} qty=${tpQty} reduceOnly=true closePosition=false workingType=MARK_PRICE priceProtect=true`);
    return;
  }

  // ── Step 3: place TAKE_PROFIT_MARKET SELL reduceOnly ───────────────────
  console.log(`[STEP 2/3] place TAKE_PROFIT_MARKET SELL @ ${tpPrice} qty=${tpQty} reduceOnly=true ...`);
  const placed = await placeFuturesTakeProfitMarketOrder({
    apiKey, apiSecret,
    symbol: SYMBOL,
    side: CLOSE_SIDE,
    stopPrice: tpPrice,
    closePosition: false,
    quantity: tpQty,
    reduceOnly: true,
    workingType: "MARK_PRICE",
    priceProtect: true,
    clientOrderId: `MANUAL_DOGE_LONG_TP1_${Date.now()}`,
  });
  console.log(`  placed → ${JSON.stringify(placed).slice(0, 400)}`);

  // ── Summary for meta-patch ─────────────────────────────────────────────
  console.log("");
  console.log("[STEP 3/3] positions_paper meta sync 안내:");
  console.log(`  tp_order_id = ${placed && (placed.orderId || placed.algoId)}`);
  console.log(`  tp_price    = ${tpPrice}`);
  console.log(`  tp_qty_base = ${tpQty}`);
  console.log(`  tp_qty_ratio = ${tpQty / positionAmt}`);
  console.log(`  이 값을 manual-doge-tp1-meta-patch 스크립트에 넘겨 meta 동기화.`);
  console.log("");
  console.log("─".repeat(72));
  console.log("[DONE] DOGE LONG TP1 reduce-only 배치 완료.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
