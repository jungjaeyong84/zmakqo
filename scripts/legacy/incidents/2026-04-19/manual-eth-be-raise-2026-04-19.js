#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-be-raise-2026-04-19.js
//
// 2026-04-19 ETHUSDT LONG 복구 #2 — BE floor 수동 상향.
//
// 상황:
//   • ETHUSDT LONG qty_base=0.432 (50% TP1 실행 후 잔여 50%)
//   • entry=2326.65, native_protection_stop_price=2307.46  (-0.83% SL, 여전히 original)
//   • tp_p1_done=true, trail_active=true, trail_high=2334.3
//   • exit-worker의 BE-raise가 13:33Z부터 매 20~30초 REFRESH_DISPATCHED 찍지만
//     `refresh_reason: POSITION_CONTEXT_FETCH_FAIL` 로 실제 stop 이동 실패.
//
// 원인 (근본):
//   • `donbeolja-egress-private` 프록시가 `fetchBinanceFuturesAccount` 호출에서
//     exit-worker로부터의 요청을 20초 timeout 냄.
//   • 동일 프록시가 다른 API 서비스 (donbeolja) 의 동일 호출은 정상 처리.
//   • exit-worker ↔ egress-private 간 네트워킹/스케일링 이슈로 추정.
//
// 즉시 조치 (이 스크립트):
//   1. Binance 에서 현재 ETHUSDT open stop order 확인
//   2. 있으면 cancel
//   3. BE floor price (2345.84) 로 새 STOP_MARKET 배치 (closePosition=true)
//
// 이후 조치:
//   • exit-worker 의 BE-raise 는 계속 실패할 것이지만, 수동으로 올려놓은 stop 이
//     첫 방어선으로 작동.
//   • egress-private ↔ exit-worker 네트워킹 문제를 별도 태스크로 근본 해결.
//
// 사용:
//   DRY-RUN:   node scripts/manual-eth-be-raise-2026-04-19.js
//   실행:      node scripts/manual-eth-be-raise-2026-04-19.js --execute
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config();

// Egress proxy 를 강제 off 해서 로컬에서 직접 Binance API 호출.
process.env.EGRESS_PROXY_MODE = "";
process.env.EGRESS_PROXY_URL = "";

const {
  fetchFuturesOpenOrders,
  placeFuturesStopMarketOrder,
  cancelFuturesOrder,
  fetchFuturesAlgoOpenOrders,
} = require("../src/exchanges/binanceFuturesPrivate");

const SYMBOL = "ETHUSDT";
const NEW_STOP_PRICE = 2345.84;  // BE floor per exit-worker BE-raise log
const CLOSE_SIDE = "SELL";       // LONG position → SELL on stop trigger

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

async function main() {
  const { execute } = parseArgs(process.argv);
  console.log("─".repeat(72));
  console.log(`[ETH BE-RAISE MANUAL] symbol=${SYMBOL} new_stop=${NEW_STOP_PRICE} execute=${execute}`);
  console.log("─".repeat(72));

  const { apiKey, apiSecret } = await loadKeys();
  if (!apiKey || !apiSecret) {
    console.error("[ABORT] BINANCEFUT API keys missing");
    process.exit(1);
  }

  console.log(`[STEP 1/3] fetch current open orders for ${SYMBOL} ...`);
  const [regular, algoRaw] = await Promise.all([
    fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
    fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: SYMBOL }),
  ]);
  const algo = Array.isArray(algoRaw && algoRaw.orders) ? algoRaw.orders : (Array.isArray(algoRaw) ? algoRaw : []);
  const allOrders = [...(regular || []), ...algo];

  const stopOrders = allOrders.filter((o) => {
    const type = String(o.type || o.origType || "").toUpperCase();
    const side = String(o.side || "").toUpperCase();
    return side === CLOSE_SIDE && (type.includes("STOP") && !type.includes("TAKE_PROFIT"));
  });

  console.log(`  총 open order=${allOrders.length} (regular=${regular ? regular.length : 0}, algo=${algo.length})`);
  console.log(`  SELL STOP orders: ${stopOrders.length}`);
  stopOrders.forEach((o, i) => {
    console.log(`    [${i}] id=${o.orderId} type=${o.type || o.origType} stopPrice=${o.stopPrice || o.triggerPrice} closePosition=${o.closePosition} reduceOnly=${o.reduceOnly}`);
  });

  if (!execute) {
    console.log("[DRY-RUN] --execute 없음 — 아무것도 변경 안 함.");
    return;
  }

  // Step 2: cancel existing SELL STOP orders
  console.log(`[STEP 2/3] cancel ${stopOrders.length} existing SELL STOP orders ...`);
  for (const o of stopOrders) {
    const res = await cancelFuturesOrder({
      apiKey, apiSecret,
      symbol: SYMBOL,
      orderId: o.orderId,
    }).catch((e) => ({ error: e && e.message ? e.message : String(e) }));
    console.log(`  cancel orderId=${o.orderId} → ${JSON.stringify(res).slice(0, 160)}`);
  }

  // Step 3: place new STOP_MARKET at BE floor
  console.log(`[STEP 3/3] place new STOP_MARKET SELL @ ${NEW_STOP_PRICE} (closePosition=true) ...`);
  const placed = await placeFuturesStopMarketOrder({
    apiKey, apiSecret,
    symbol: SYMBOL,
    side: CLOSE_SIDE,
    stopPrice: NEW_STOP_PRICE,
    closePosition: true,
    workingType: "MARK_PRICE",
    priceProtect: true,
    clientOrderId: `MANUAL_BE_RAISE_${SYMBOL}_${Date.now()}`,
  });
  console.log(`  placed → ${JSON.stringify(placed).slice(0, 300)}`);

  console.log("─".repeat(72));
  console.log("[DONE] ETH native stop BE-raise 완료. 반드시 positions_paper meta도 sync 필요.");
  console.log("  다음: exit-worker 의 다음 tick이 새 stop_id 를 관측하고 projection 을 갱신할 것.");
  console.log("  만약 egress-private 이슈로 관측이 실패하면 positions_paper.meta.native_protection_stop_order_id 를 수동으로 patch 필요.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
