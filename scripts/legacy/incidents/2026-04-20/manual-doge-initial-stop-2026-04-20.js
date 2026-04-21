#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-doge-initial-stop-2026-04-20.js
//
// 2026-04-20 DOGEUSDT LONG 포지션 native protection MISSING 복구.
//
// 상황:
//   • 현재 외부 경로로 진입된 DOGEUSDT LONG 포지션
//     (external_active=true, simplified_exit_v2_enabled=true)
//   • positions_paper.meta.native_protection_refresh_status = MISSING
//   • 거래소에 stop_order_id / tp_order_id 둘 다 없음 (actual_stop_price=null)
//   • watchdog 이 NATIVE_REFRESH_UNHEALTHY + TP1_ORDER_MISSING 으로 플래그
//   • repair-live-trailing-stage.js 는 canonical_stage=null 이라 SKIP
//     → pre-TP1 never-protected 상태는 trail-rebuild 경로로는 복구 안 됨
//
// 즉시 조치 (이 스크립트):
//   1. Egress proxy 우회하여 로컬에서 직접 Binance API 호출 (정책: 어제
//      동일 조치 때 egress latency 이슈 있었음. 메타 패치는 정상 경로로).
//   2. Account 에서 DOGEUSDT positionAmt / entryPrice 확인 (LONG 확인).
//   3. 기존 SELL STOP open orders 있으면 cancel (중복 방지).
//   4. entry * (1 - SL_BPS/10000) 로 STOP_MARKET SELL (closePosition=true).
//      tickSize 는 exchangeInfo 에서 조회 후 내림 (보수적 = entry 에서 멀어짐).
//
// SL_BPS 선택:
//   어제 SHORT 케이스에서 썼던 83bps 와 동일. DOGE R 기준 한 번 통과한
//   값이라 재사용. 포지션 qty=21292, entry=0.09414 기준 83bps SL 은 약
//   0.09336 에서 트리거 → 최대 손실 -0.83% (≈ -$16.6 무레버리지 기준).
//   * 레버리지가 별도로 잡혀 있다면 계정 레벨에서 레버리지만큼 × 적용.
//
// 이후 조치:
//   • positions_paper meta 를 동기화하는 meta-patch 스크립트 실행
//     (어제 ETH/SOL 에 썼던 동일 패턴 — 이번 세션에서 별도 처리).
//   • 또는 exit-worker 가 알아서 다음 refresh 사이클에 메타를 채움.
//
// 사용:
//   DRY-RUN:   node scripts/legacy/incidents/2026-04-20/manual-doge-initial-stop-2026-04-20.js
//   실행:      node scripts/legacy/incidents/2026-04-20/manual-doge-initial-stop-2026-04-20.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

// Egress proxy 를 강제 off 해서 로컬에서 직접 Binance API 호출.
process.env.EGRESS_PROXY_MODE = "";
process.env.EGRESS_PROXY_URL = "";
process.env.EGRESS_PROXY_BINANCE_PRIVATE_URL = "";

const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesExchangeInfo,
  placeFuturesStopMarketOrder,
  cancelFuturesOrder,
} = require("../../../../src/exchanges/binanceFuturesPrivate");

const SYMBOL = "DOGEUSDT";
const CLOSE_SIDE = "SELL";       // LONG 포지션 → SELL 로 stop-close
const SL_BPS = 83;               // -0.83% SL (LONG 이므로 entry * 0.9917)

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") out.execute = true;
  }
  return out;
}

async function loadKeys() {
  // .env 먼저, 실패하면 Secret Manager 폴백.
  const envKey = process.env.BINANCEFUT_API_KEY;
  const envSecret = process.env.BINANCEFUT_API_SECRET;
  if (envKey && envSecret) return { apiKey: envKey, apiSecret: envSecret };
  const { execSync } = require("child_process");
  function secret(name) {
    return execSync(
      `gcloud secrets versions access latest --secret=${name}`,
      { encoding: "utf8" }
    ).trim();
  }
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

async function main() {
  const { execute } = parseArgs(process.argv);
  console.log("─".repeat(72));
  console.log(`[DOGE LONG INITIAL STOP MANUAL] symbol=${SYMBOL} sl_bps=${SL_BPS} execute=${execute}`);
  console.log("─".repeat(72));

  const { apiKey, apiSecret } = await loadKeys();
  if (!apiKey || !apiSecret) {
    console.error("[ABORT] BINANCEFUT API keys missing");
    process.exit(1);
  }

  // ── Step 1: fetch position + open orders + exchangeInfo ──────────────
  console.log(`[STEP 1/4] fetch account/position + open orders + exchangeInfo ...`);
  const [account, regular, algoRaw, info] = await Promise.all([
    fetchBinanceFuturesAccount({ apiKey, apiSecret }),
    fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
    fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
    fetchFuturesExchangeInfo(SYMBOL),
  ]);

  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const pos = positions.find((p) => String(p.symbol).toUpperCase() === SYMBOL);
  if (!pos) {
    console.error(`[ABORT] ${SYMBOL} position not found in account.positions`);
    process.exit(1);
  }
  const positionAmt = Number(pos.positionAmt);
  const entryPrice = Number(pos.entryPrice);
  if (!Number.isFinite(positionAmt) || positionAmt === 0) {
    console.error(`[ABORT] ${SYMBOL} positionAmt=${pos.positionAmt} — 포지션이 이미 flat 입니다.`);
    process.exit(1);
  }
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    console.error(`[ABORT] ${SYMBOL} entryPrice invalid: ${pos.entryPrice}`);
    process.exit(1);
  }
  const isLong = positionAmt > 0;
  console.log(`  position: side=${isLong ? "LONG" : "SHORT"} positionAmt=${positionAmt} entryPrice=${entryPrice}`);
  console.log(`  tickSize=${info.tickSize} pricePrecision=${info.pricePrecision}`);

  if (!isLong) {
    console.error(`[ABORT] 이 스크립트는 LONG 전용 (close_side=SELL). 현재 포지션은 SHORT 입니다.`);
    process.exit(1);
  }

  // compute SL: LONG → entry * (1 - SL_BPS/10000), round DOWN to tick (보수적, entry 에서 더 멀어짐)
  const rawStopPrice = entryPrice * (1 - SL_BPS / 10000);
  const stopPrice = roundDownToTick(rawStopPrice, info.tickSize);
  console.log(`  computed SL: raw=${rawStopPrice.toFixed(8)} → rounded=${stopPrice}  (${((stopPrice/entryPrice - 1)*100).toFixed(3)}%)`);

  const algo = Array.isArray(algoRaw && algoRaw.orders) ? algoRaw.orders : (Array.isArray(algoRaw) ? algoRaw : []);
  const allOrders = [...(regular || []), ...algo];
  const stopOrders = allOrders.filter((o) => {
    const type = String(o.type || o.origType || "").toUpperCase();
    const side = String(o.side || "").toUpperCase();
    return side === CLOSE_SIDE && (type.includes("STOP") && !type.includes("TAKE_PROFIT"));
  });
  console.log(`  open orders total=${allOrders.length} (regular=${regular ? regular.length : 0}, algo=${algo.length})`);
  console.log(`  SELL STOP orders: ${stopOrders.length}`);
  stopOrders.forEach((o, i) => {
    console.log(`    [${i}] id=${o.orderId} type=${o.type || o.origType} stopPrice=${o.stopPrice || o.triggerPrice} closePosition=${o.closePosition} reduceOnly=${o.reduceOnly}`);
  });

  if (!execute) {
    console.log("");
    console.log("[DRY-RUN] --execute 없음 — 아무것도 변경 안 함.");
    console.log("[DRY-RUN] 배치 예정: STOP_MARKET SELL @", stopPrice, "closePosition=true workingType=MARK_PRICE priceProtect=true");
    return;
  }

  // ── Step 2: cancel existing SELL STOPs (방어) ──────────────────────────
  if (stopOrders.length > 0) {
    console.log(`[STEP 2/4] cancel ${stopOrders.length} existing SELL STOP orders ...`);
    for (const o of stopOrders) {
      const res = await cancelFuturesOrder({
        apiKey, apiSecret,
        symbol: SYMBOL,
        orderId: o.orderId,
      }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
      console.log(`  cancel orderId=${o.orderId} → ${JSON.stringify(res).slice(0, 160)}`);
    }
  } else {
    console.log("[STEP 2/4] no existing SELL STOP orders — skip cancel.");
  }

  // ── Step 3: place new STOP_MARKET SELL @ entry*(1-SL) ──────────────────
  console.log(`[STEP 3/4] place new STOP_MARKET SELL @ ${stopPrice} (closePosition=true) ...`);
  const placed = await placeFuturesStopMarketOrder({
    apiKey, apiSecret,
    symbol: SYMBOL,
    side: CLOSE_SIDE,
    stopPrice,
    closePosition: true,
    workingType: "MARK_PRICE",
    priceProtect: true,
    clientOrderId: `MANUAL_DOGE_LONG_INITIAL_STOP_${Date.now()}`,
  });
  console.log(`  placed → ${JSON.stringify(placed).slice(0, 400)}`);

  // ── Step 4: instructions for meta sync ───────────────────────────────
  console.log("");
  console.log("[STEP 4/4] positions_paper meta sync 안내:");
  console.log(`  orderId=${placed && placed.orderId}, stopPrice=${stopPrice}`);
  console.log(`  meta-patch 스크립트로 positions_paper.meta.native_protection_* 업데이트 필요.`);
  console.log("");
  console.log("─".repeat(72));
  console.log("[DONE] DOGE LONG native initial stop 배치 완료.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
