#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-doge-initial-stop-2026-04-19.js
//
// 2026-04-19 22:00Z DOGEUSDT SHORT 신규 진입 직후 native STOP 배치 실패 복구.
//
// 상황:
//   • 22:00:47Z DOGEUSDT SHORT qty=1 lev=2 EARLY tier 진입
//   • 22:01~ exit-worker가 fetchFuturesOpenOrders / Account 호출 시
//     egress-private 에서 20s timeout → PR#18 retry (__retry2) 도 동일 timeout
//   • native_verify_warn: OPEN_ORDERS_FETCH_FAIL:EGRESS_PROXY_TIMEOUT
//   • 결과: 진입 후 수 분째 native STOP 없이 노출
//
// 원인 (잠정):
//   • PR#18 undici keep-alive pool 리셋은 배포됨 (rev 00773-9zd).
//   • RETRY_RECOVERED 는 다른 콜에서 간헐적으로 발생 중.
//   • 하지만 DOGE 스톱 배치 경로의 호출은 재시도까지 20s 양쪽 timeout →
//     egress-private 자체의 latency/capacity 문제로 추정.
//
// 즉시 조치 (이 스크립트):
//   1. Egress proxy 우회하여 로컬에서 직접 Binance API 호출.
//   2. Account 에서 DOGEUSDT positionAmt / entryPrice 확인 (SHORT 확인).
//   3. 기존 BUY STOP open orders 있으면 cancel.
//   4. entry * (1 + SL_BPS/10000) 로 STOP_MARKET BUY (closePosition=true).
//      tickSize 는 exchangeInfo 에서 조회 후 올림.
//
// 이후 조치:
//   • positions_paper meta 를 동기화하는 manual-doge-native-stop-meta-patch.js
//     (ETH SHORT 때 쓴 동일 패턴) 실행.
//   • egress-private ↔ exit-worker 간 근본 latency 문제 별도 조사.
//
// 사용:
//   DRY-RUN:   node scripts/manual-doge-initial-stop-2026-04-19.js
//   실행:      node scripts/manual-doge-initial-stop-2026-04-19.js --execute
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
} = require("../src/exchanges/binanceFuturesPrivate");

const SYMBOL = "DOGEUSDT";
const CLOSE_SIDE = "BUY";        // SHORT 포지션 → BUY 로 stop-close
const SL_BPS = 83;               // -0.83% SL (SHORT 이므로 entry * 1.0083)

function parseArgs(argv) {
  const out = { execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") out.execute = true;
  }
  return out;
}

async function loadKeys() {
  const { execSync } = require("child_process");
  function secret(name) {
    return execSync(
      `gcloud secrets versions access latest --secret=${name}`,
      { encoding: "utf8" }
    ).trim();
  }
  return {
    apiKey: process.env.BINANCEFUT_API_KEY || secret("BINANCEFUT_API_KEY"),
    apiSecret: process.env.BINANCEFUT_API_SECRET || secret("BINANCEFUT_API_SECRET"),
  };
}

function roundUpToTick(price, tickSize) {
  if (!tickSize || !(tickSize > 0)) return price;
  const n = Math.ceil(price / tickSize);
  // avoid float drift: use decimals from tickSize
  const decimals = Math.max(0, -Math.floor(Math.log10(tickSize)));
  return Number((n * tickSize).toFixed(decimals));
}

async function main() {
  const { execute } = parseArgs(process.argv);
  console.log("─".repeat(72));
  console.log(`[DOGE INITIAL STOP MANUAL] symbol=${SYMBOL} sl_bps=${SL_BPS} execute=${execute}`);
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
  const isShort = positionAmt < 0;
  console.log(`  position: side=${isShort ? "SHORT" : "LONG"} positionAmt=${positionAmt} entryPrice=${entryPrice}`);
  console.log(`  tickSize=${info.tickSize} pricePrecision=${info.pricePrecision}`);

  if (!isShort) {
    console.error(`[ABORT] 이 스크립트는 SHORT 전용 (close_side=BUY). 현재 포지션은 LONG 입니다.`);
    process.exit(1);
  }

  // compute SL: SHORT → entry * (1 + SL_BPS/10000), round UP to tick (보수적)
  const rawStopPrice = entryPrice * (1 + SL_BPS / 10000);
  const stopPrice = roundUpToTick(rawStopPrice, info.tickSize);
  console.log(`  computed SL: raw=${rawStopPrice.toFixed(8)} → rounded=${stopPrice}  (+${((stopPrice/entryPrice - 1)*100).toFixed(3)}%)`);

  const algo = Array.isArray(algoRaw && algoRaw.orders) ? algoRaw.orders : (Array.isArray(algoRaw) ? algoRaw : []);
  const allOrders = [...(regular || []), ...algo];
  const stopOrders = allOrders.filter((o) => {
    const type = String(o.type || o.origType || "").toUpperCase();
    const side = String(o.side || "").toUpperCase();
    return side === CLOSE_SIDE && (type.includes("STOP") && !type.includes("TAKE_PROFIT"));
  });
  console.log(`  open orders total=${allOrders.length} (regular=${regular ? regular.length : 0}, algo=${algo.length})`);
  console.log(`  BUY STOP orders: ${stopOrders.length}`);
  stopOrders.forEach((o, i) => {
    console.log(`    [${i}] id=${o.orderId} type=${o.type || o.origType} stopPrice=${o.stopPrice || o.triggerPrice} closePosition=${o.closePosition} reduceOnly=${o.reduceOnly}`);
  });

  if (!execute) {
    console.log("");
    console.log("[DRY-RUN] --execute 없음 — 아무것도 변경 안 함.");
    console.log("[DRY-RUN] 배치 예정: STOP_MARKET BUY @", stopPrice, "closePosition=true workingType=MARK_PRICE priceProtect=true");
    return;
  }

  // ── Step 2: cancel existing BUY STOPs (방어) ──────────────────────────
  if (stopOrders.length > 0) {
    console.log(`[STEP 2/4] cancel ${stopOrders.length} existing BUY STOP orders ...`);
    for (const o of stopOrders) {
      const res = await cancelFuturesOrder({
        apiKey, apiSecret,
        symbol: SYMBOL,
        orderId: o.orderId,
      }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
      console.log(`  cancel orderId=${o.orderId} → ${JSON.stringify(res).slice(0, 160)}`);
    }
  } else {
    console.log("[STEP 2/4] no existing BUY STOP orders — skip cancel.");
  }

  // ── Step 3: place new STOP_MARKET BUY @ entry*(1+SL) ──────────────────
  console.log(`[STEP 3/4] place new STOP_MARKET BUY @ ${stopPrice} (closePosition=true) ...`);
  const placed = await placeFuturesStopMarketOrder({
    apiKey, apiSecret,
    symbol: SYMBOL,
    side: CLOSE_SIDE,
    stopPrice,
    closePosition: true,
    workingType: "MARK_PRICE",
    priceProtect: true,
    clientOrderId: `MANUAL_DOGE_INITIAL_STOP_${Date.now()}`,
  });
  console.log(`  placed → ${JSON.stringify(placed).slice(0, 400)}`);

  // ── Step 4: instructions for meta sync ───────────────────────────────
  console.log("");
  console.log("[STEP 4/4] positions_paper meta sync 안내:");
  console.log(`  scripts/manual-doge-native-stop-meta-patch.js 를 만들어서`);
  console.log(`  orderId=${placed && placed.orderId}, stopPrice=${stopPrice} 로 patch 필요.`);
  console.log("");
  console.log("─".repeat(72));
  console.log("[DONE] DOGE native initial stop 배치 완료.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
