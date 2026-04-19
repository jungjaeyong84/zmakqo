#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// manual-eth-tp1-reduce.js
//
// 사용처: 2026-04-19 ETHUSDT 처럼 자동 TP1 이 발동하지 않은 러너를 수동으로
//         50% (또는 100%) reduceOnly 시키고, Firestore meta 를 TP1 완료 상태
//         로 맞춘다.  BTCUSDT (2026-04-19) 때의 수동 처리와 같은 패턴.
//
// 사용법:
//   DRY-RUN (기본):
//     node scripts/manual-eth-tp1-reduce.js --symbol=ETHUSDT --fraction=0.5
//   실제 실행 (주문 전송):
//     node scripts/manual-eth-tp1-reduce.js --symbol=ETHUSDT --fraction=0.5 --execute
//
// 안전장치:
//   - `--execute` 를 명시적으로 넘겨야만 실제 주문이 나간다
//   - `clientOrderId` 는 symbol + 시각 + 프랙션 기반 deterministic 값이라 동일
//     호출이 중복 주문 되지 않는다
//   - 실행 전/후로 position 상태를 stdout 에 JSON 으로 찍어서 대시보드 점검
//     없이도 근거를 남긴다
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

const {
  fetchBinanceFuturesAccount,
  placeFuturesMarketOrder,
  fetchFuturesBookTicker,
  fetchFuturesOrder,
  fetchFuturesExchangeInfo,
} = require("../src/exchanges/binanceFuturesPrivate");
const { resolveBinanceKeys } = require("../src/services/binanceApiKeys");
const { getPosition, upsertPositionMetaOnly } = require("../src/storage/positionsPaper");

function parseArgs(argv) {
  const out = { symbol: "ETHUSDT", fraction: 0.5, execute: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--execute") { out.execute = true; continue; }
    if (arg.startsWith("--symbol=")) { out.symbol = String(arg.split("=")[1] || "").toUpperCase(); continue; }
    if (arg.startsWith("--fraction=")) {
      const f = Number(arg.split("=")[1]);
      if (Number.isFinite(f) && f > 0 && f <= 1) out.fraction = f;
      continue;
    }
  }
  return out;
}

function roundQtyToStepSize(qty, stepSize) {
  const step = Number(stepSize);
  if (!Number.isFinite(step) || step <= 0) return qty;
  // floor 해서 거래소가 reject 하지 않게
  return Math.floor(qty / step) * step;
}

function sanitizeId(str, maxLen = 32) {
  return String(str || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, maxLen);
}

async function resolveStepSize({ keys, symbol }) {
  try {
    const info = await fetchFuturesExchangeInfo({ apiKey: keys.apiKey });
    const symbolInfo = (info && Array.isArray(info.symbols) ? info.symbols : [])
      .find((s) => String(s.symbol || "").toUpperCase() === symbol);
    if (!symbolInfo) return null;
    const lotSize = (symbolInfo.filters || []).find((f) => f.filterType === "LOT_SIZE");
    return lotSize && Number(lotSize.stepSize) ? Number(lotSize.stepSize) : null;
  } catch (err) {
    console.warn(`[WARN] stepSize 조회 실패 (${err && err.message || err}) — 기본 step 없이 진행`);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const { symbol, fraction, execute } = args;

  console.log("─".repeat(72));
  console.log(`[MANUAL TP1 REDUCE] symbol=${symbol} fraction=${fraction} execute=${execute}`);
  console.log("─".repeat(72));

  // (1) 키 확보
  const keys = await resolveBinanceKeys().catch(() => null);
  if (!keys || !keys.apiKey || !keys.apiSecret) {
    throw new Error("BINANCE_KEYS_MISSING — Firestore 또는 env 에서 Binance 키를 찾을 수 없음");
  }
  console.log(`[KEYS] source=${keys.source || "unknown"}  apiKey=${keys.apiKey.slice(0, 8)}...`);

  // (2) 거래소 position 상태
  const account = await fetchBinanceFuturesAccount({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
  const positions = Array.isArray(account.positions) ? account.positions : [];
  const ex = positions.find((p) => String(p.symbol || "").toUpperCase() === symbol
    && Number(p.positionAmt || 0) !== 0);
  if (!ex) {
    console.log("[EXCHANGE] 거래소에 열린 ETHUSDT 포지션이 없음.  종료.");
    process.exit(0);
  }
  const positionAmt = Number(ex.positionAmt);
  const side = positionAmt > 0 ? "LONG" : "SHORT";
  const absQty = Math.abs(positionAmt);
  const entryPrice = Number(ex.entryPrice);
  const leverage = Number(ex.leverage);
  const unrealizedPnl = Number(ex.unrealizedProfit);
  console.log(`[EXCHANGE] side=${side} qty=${absQty} entryPrice=${entryPrice} leverage=${leverage}x uPnL=${unrealizedPnl.toFixed(4)}`);

  // (3) 현재 호가 (reduceOnly 체결 가격 참고용)
  const book = await fetchFuturesBookTicker({ symbol }).catch(() => null);
  const bestBid = Number(book && book.bidPrice);
  const bestAsk = Number(book && book.askPrice);
  console.log(`[MARKET]   bestBid=${bestBid} bestAsk=${bestAsk} spread=${(bestAsk - bestBid).toFixed(4)}`);

  // (4) Firestore 포지션 meta (TP1 타겟 / 기 TP1 완료 여부)
  const pos = await getPosition({ exchange: "BINANCEFUT", symbol });
  const meta = (pos && pos.meta) || {};
  console.log(`[FIRESTORE POS] state=${pos && pos.state} size_pct=${pos && pos.size_pct}`);
  console.log(`[FIRESTORE META]`);
  console.log(`  tp_p1_done        : ${meta.tp_p1_done}`);
  console.log(`  trail_active      : ${meta.trail_active}`);
  console.log(`  canonical_exit_stage: ${meta.canonical_exit_stage}`);
  console.log(`  tp_p1_target_price: ${meta.tp_p1_target_price ?? meta.tp1_price ?? meta.tp_p1_price ?? "(absent)"}`);
  console.log(`  native_protection_tp_price : ${meta.native_protection_tp_price}`);
  console.log(`  native_protection_stop_price: ${meta.native_protection_stop_price}`);
  console.log(`  simplified_exit_v2_enabled : ${meta.simplified_exit_v2_enabled}`);

  if (meta.tp_p1_done === true) {
    console.log("[ABORT] meta.tp_p1_done 가 이미 true.  재실행 방지 — 종료.");
    process.exit(0);
  }

  // (5) 주문 계획
  const reduceQtyRaw = absQty * fraction;
  const stepSize = await resolveStepSize({ keys, symbol });
  const reduceQty = stepSize ? roundQtyToStepSize(reduceQtyRaw, stepSize) : reduceQtyRaw;
  if (reduceQty <= 0) {
    console.log(`[ABORT] 계산된 reduceQty=${reduceQty} 가 0 이하 (stepSize=${stepSize}).  종료.`);
    process.exit(0);
  }
  // LONG 이면 SELL 로 reduceOnly, SHORT 면 BUY
  const exitSide = side === "LONG" ? "SELL" : "BUY";

  const nowSec = Math.floor(Date.now() / 1000);
  const clientOrderId = sanitizeId(`dbj_manual_tp1_${symbol}_${Math.round(fraction * 100)}p_${nowSec}`);

  console.log("─".repeat(72));
  console.log("[PLAN]");
  console.log(`  symbol       : ${symbol}`);
  console.log(`  side         : ${exitSide} (reduceOnly)`);
  console.log(`  qty          : ${reduceQty}  (= abs(${positionAmt}) × ${fraction}${stepSize ? ` → step ${stepSize}` : ""})`);
  console.log(`  expected fill: near ${exitSide === "SELL" ? bestBid : bestAsk} (market)`);
  console.log(`  clientOrderId: ${clientOrderId}`);
  console.log(`  tp1_target   : ${meta.tp_p1_target_price ?? meta.tp1_price ?? meta.tp_p1_price ?? "(meta 에 없음 — 자동 러너가 타겟을 못 적은 상태)"}`);
  console.log("─".repeat(72));

  if (!execute) {
    console.log("[DRY-RUN] --execute 플래그 없음.  주문 나가지 않음.");
    console.log("         실제 실행:  node scripts/manual-eth-tp1-reduce.js --symbol=" + symbol + " --fraction=" + fraction + " --execute");
    process.exit(0);
  }

  // (6) 실행
  console.log("[EXECUTE] reduceOnly MARKET 주문 전송 중...");
  let order = null;
  try {
    order = await placeFuturesMarketOrder({
      apiKey: keys.apiKey,
      apiSecret: keys.apiSecret,
      symbol,
      side: exitSide,
      quantity: String(reduceQty),
      reduceOnly: true,
      clientOrderId,
      recvWindow: 5000,
    });
    console.log(`[ORDER OK]`);
    console.log(JSON.stringify(order, null, 2));
  } catch (err) {
    console.error(`[ORDER FAIL] ${err && err.message || err}`);
    throw err;
  }

  const orderId = order && (order.orderId || order.orderID);
  // (7) 체결 확인
  let filledOrder = null;
  for (let i = 0; i < 8; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      filledOrder = await fetchFuturesOrder({
        apiKey: keys.apiKey,
        apiSecret: keys.apiSecret,
        symbol,
        orderId,
      });
      if (filledOrder && String(filledOrder.status || "").toUpperCase() === "FILLED") break;
    } catch (_) { /* retry */ }
  }
  if (filledOrder) {
    const avgPrice = Number(filledOrder.avgPrice);
    const executedQty = Number(filledOrder.executedQty);
    console.log(`[FILL] status=${filledOrder.status} avgPrice=${avgPrice} executedQty=${executedQty}`);
  } else {
    console.warn(`[FILL CHECK] 체결 상태 확인 실패 — 수동 점검 필요 (orderId=${orderId})`);
  }

  // (8) Firestore meta 업데이트 — TP1 완료로 마킹
  //     주의: 자동 러너의 canonical state machine 과 충돌하지 않도록 최소 필드만 건드린다.
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const nextMeta = {
    ...meta,
    tp_p1_done: true,
    tp_p1_done_at_ms: nowMs,
    tp_p1_done_source: "MANUAL_RECOVERY_2026_04_19",
    tp_p1_done_client_order_id: clientOrderId,
    tp_p1_done_order_id: orderId ? String(orderId) : null,
    tp_p1_done_fill_qty: filledOrder ? Number(filledOrder.executedQty) : reduceQty,
    tp_p1_done_fill_avg_price: filledOrder ? Number(filledOrder.avgPrice) : null,
    manual_tp1_recovery_note: "TP1 이 자동으로 발동되지 않은 상태에서 수동 reduceOnly MARKET 으로 처리. Firestore settings graceful-degrade (PR #13) 이전 상태에서 발생한 TLS blip 관련 native protection refresh 실패가 원인.",
  };

  try {
    await upsertPositionMetaOnly({
      exchange: "BINANCEFUT",
      symbol,
      runId: `RUN__MANUAL_TP1_RECOVERY__${symbol}__${nowMs}`,
      executionMode: "LIVE",
      meta: nextMeta,
      source: "MANUAL_TP1_RECOVERY",
      mutationKind: "POSITION_META_UPSERT",
      reason: "MANUAL_TP1_RECOVERY_2026_04_19",
    });
    console.log(`[META OK] positions_paper/${symbol} tp_p1_done=true @ ${nowIso}`);
  } catch (err) {
    console.error(`[META FAIL] ${err && err.message || err}`);
    console.error("주문은 체결됐지만 Firestore meta 업데이트 실패 — 수동 개입 필요");
    throw err;
  }

  console.log("─".repeat(72));
  console.log("[DONE] 수동 TP1 처리 완료.");
  console.log("─".repeat(72));
}

main().catch((err) => {
  console.error("[FATAL]", err && err.stack || err);
  process.exit(1);
});
