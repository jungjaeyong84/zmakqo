"use strict";

// Real-time protective-order audit.
//
// For every ACTIVE BINANCEFUT position in positions_paper, this service
// cross-references what the DB meta records as the native SL + TP + trail
// state against what Binance actually has open RIGHT NOW. The purpose is
// to give the operator a one-click answer to the chronic anxiety question:
//
//   "진입할 때 SL / TP1 이 제대로 걸렸을까?"
//   "트레일링이 진짜 돌아가고 있을까?"
//
// Read-only. Never cancels, never places, never mutates Firestore. Safe
// to call from a dashboard route on every reload.
//
// Output shape per position:
//   {
//     symbol, position_side, qty_base, state,
//     age_minutes_since_entry,
//     meta: { sl_order_id, sl_price, tp_order_id, tp_price, ..., trail_active, tp_p1_done },
//     exchange: { sl_order, tp_order, all_orders_n, fetched_at },
//     match: {
//       sl_present_on_exchange: bool,
//       tp_present_on_exchange: bool,
//       sl_id_matches: bool,
//       tp_id_matches: bool,
//       sl_price_matches: bool,
//       tp_price_matches: bool,
//     },
//     issues: [{ severity: 'RED'|'AMBER', code, message }],
//     status: 'GREEN' | 'AMBER' | 'RED'
//   }

const { getFirestore } = require("../storage/firestore");
const {
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
} = require("../exchanges/binanceFuturesPrivate");

// Price-tolerance for "sl_price_matches": Binance rounds to tick size, so
// a raw float mismatch is expected. Accept up to 0.5% drift before flagging.
const PRICE_MATCH_TOLERANCE_PCT = 0.005;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v) {
  return v == null ? null : String(v);
}

function pricesMatch(a, b) {
  const na = num(a);
  const nb = num(b);
  if (na == null || nb == null) return false;
  if (na === 0 || nb === 0) return na === nb;
  return Math.abs(na - nb) / Math.max(Math.abs(na), Math.abs(nb)) <= PRICE_MATCH_TOLERANCE_PCT;
}

function classifyOrder(o) {
  const t = String((o && (o.type || o.orderType)) || "").toUpperCase();
  if (t.includes("STOP")) return "SL";
  if (t.includes("TAKE_PROFIT")) return "TP";
  return null;
}

function toIsoSafe(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try { return new Date(n).toISOString(); } catch (_) { return null; }
}

function extractMetaView(v) {
  const m = v && v.meta ? v.meta : {};
  return {
    sl_order_id: toStr(m.native_protection_stop_order_id || null),
    sl_price: num(m.native_protection_stop_price || m.final_effective_stop || m.initial_stop_price),
    entry_price: num(v && v.avg_price),
    tp_order_id: toStr(m.native_protection_tp_order_id || null),
    tp_price: num(m.native_protection_tp_price || m.tp_p1_target_price),
    tp_qty_base: num(m.native_protection_tp_qty_base),
    tp_status: toStr(m.native_protection_tp_status || null),
    sl_status: toStr(m.native_protection_stop_status || null),
    refresh_status: toStr(m.native_protection_refresh_status || null),
    refresh_at_iso: toIsoSafe(m.native_protection_refresh_at_ms || m.native_protection_refresh_at),
    trail_active: m.trail_active === true,
    trail_stop: num(m.trail_stop || m.r_based_trail_stop),
    tp_p1_done: m.tp_p1_done === true,
    entry_exec_bar_ms: num(m.entry_exec_bar_ms || m.last_entry_bar_ms),
  };
}

// Break-Even floor after TP1 (2026-04-18 fix): once TP1 is filled, the
// runner's native stop must sit at-or-above entry + RUNNER_MIN_PROFIT_PCT
// (default 0.003). Below that threshold the runner's 75% can still be
// dragged to the original SL in the trail-delay window. We check this
// invariant directly against the DB meta + position side.
function evaluateBreakEvenFloor({ meta, position }) {
  if (!meta.tp_p1_done) return { applicable: false, status: null };
  if (!Number.isFinite(meta.entry_price) || !Number.isFinite(meta.sl_price)) {
    return { applicable: true, status: "UNKNOWN", reason: "entry or sl price missing" };
  }
  const side = String(position && (position.position_side || position.side) || "").toUpperCase();
  // Minimum floor = entry × (1 ± 0.3%). We accept anything at-or-above
  // (LONG) or at-or-below (SHORT) this threshold.
  const FLOOR_PCT = 0.003;
  const floorPrice = side === "SHORT"
    ? meta.entry_price * (1 - FLOOR_PCT)
    : meta.entry_price * (1 + FLOOR_PCT);
  const stopMeetsFloor = side === "SHORT"
    ? meta.sl_price <= floorPrice + meta.sl_price * 1e-6
    : meta.sl_price >= floorPrice - meta.sl_price * 1e-6;
  return {
    applicable: true,
    status: stopMeetsFloor ? "OK" : "STOP_BELOW_FLOOR",
    floor_price: floorPrice,
    current_stop: meta.sl_price,
  };
}

async function fetchOpenOrdersSafe({ apiKey, apiSecret, symbol }) {
  const out = { regular: [], algo: [], errors: [] };
  try {
    const rows = await fetchFuturesOpenOrders({ apiKey, apiSecret, symbol });
    if (Array.isArray(rows)) out.regular = rows;
  } catch (e) {
    out.errors.push({ source: "regular", message: (e && e.message) || String(e) });
  }
  try {
    const rows = await fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol });
    if (Array.isArray(rows)) out.algo = rows;
  } catch (e) {
    out.errors.push({ source: "algo", message: (e && e.message) || String(e) });
  }
  return out;
}

function pickSlOrder(orders) {
  // Prefer STOP_MARKET with closePosition=true (the full-position stop we use).
  const stops = orders.filter((o) => classifyOrder(o) === "SL");
  if (!stops.length) return null;
  const closeStops = stops.filter((o) => o && o.closePosition === true);
  return closeStops[0] || stops[0];
}

function pickTpOrder(orders) {
  const tps = orders.filter((o) => classifyOrder(o) === "TP");
  if (!tps.length) return null;
  // Prefer reduceOnly TAKE_PROFIT_MARKET (the partial TP1).
  const reduce = tps.filter((o) => o && o.reduceOnly === true);
  return reduce[0] || tps[0];
}

function shouldRequireTpOrder(meta = {}) {
  // Before TP1, the partial take-profit order is mandatory. After TP1 is
  // filled, that native TP order is expected to disappear; runner protection
  // is then enforced by the stop/trailing invariants below.
  return meta.tp_p1_done !== true && meta.trail_active !== true;
}

function buildProtectionPhase({ meta = {}, exchange = {} } = {}) {
  const tpRequired = shouldRequireTpOrder(meta);
  const refreshOk = String(meta.refresh_status || "").trim().toUpperCase() === "OK";
  const runnerMode = meta.tp_p1_done === true;
  const runnerProtectionActive = runnerMode
    && meta.trail_active === true
    && refreshOk
    && !!exchange.sl_order;
  return {
    phase: runnerMode ? "POST_TP1_TRAILING_RUNNER" : "PRE_TP1_PARTIAL_TP",
    tp_required_on_exchange: tpRequired,
    runner_mode: runnerMode,
    runner_trailing_active: meta.trail_active === true,
    runner_native_refresh_ok: refreshOk,
    runner_sl_present_on_exchange: !!exchange.sl_order,
    runner_protection_active: runnerProtectionActive,
  };
}

function buildIssues({ meta, exchange, match, position }) {
  const issues = [];
  const push = (severity, code, message) => issues.push({ severity, code, message });

  // ── 주문 누락 / 불일치 ─────────────────────────────────────────────
  // 이게 진짜 "포지션 위험" 지표. 여기가 빨간불이면 즉시 대응.
  if (!exchange.sl_order) {
    push("RED", "SL_MISSING_ON_EXCHANGE",
      "Binance 에 STOP 주문이 없음 — 포지션이 무방비 상태입니다.");
  } else if (meta.sl_order_id && meta.sl_order_id !== exchange.sl_order.orderId) {
    push("RED", "SL_ORDER_ID_MISMATCH",
      `DB 는 SL id=${meta.sl_order_id} 를 기대하지만 거래소에는 id=${exchange.sl_order.orderId} 만 있음.`);
  } else if (!meta.sl_order_id && exchange.sl_order) {
    push("AMBER", "SL_DB_MISSING_ID",
      `거래소 SL 주문(id=${exchange.sl_order.orderId})은 존재하지만 DB 메타에 기록되지 않음 — reconciler 가 아직 동기화 안 됨.`);
  }

  const requireTpOrder = match && typeof match.tp_required_on_exchange === "boolean"
    ? match.tp_required_on_exchange
    : shouldRequireTpOrder(meta);
  if (requireTpOrder && !exchange.tp_order) {
    push("RED", "TP_MISSING_ON_EXCHANGE",
      "Binance 에 TAKE_PROFIT 주문이 없음 — 이익 실현 주문이 없음.");
  } else if (exchange.tp_order && meta.tp_order_id && meta.tp_order_id !== exchange.tp_order.orderId) {
    push("RED", "TP_ORDER_ID_MISMATCH",
      `DB 는 TP id=${meta.tp_order_id} 를 기대하지만 거래소에는 id=${exchange.tp_order.orderId} 만 있음.`);
  } else if (requireTpOrder && !meta.tp_order_id && exchange.tp_order) {
    push("AMBER", "TP_DB_MISSING_ID",
      `거래소 TP 주문(id=${exchange.tp_order.orderId})은 존재하지만 DB 메타에 기록되지 않음.`);
  }

  if (match.sl_present_on_exchange && match.sl_price_matches === false && meta.sl_price != null) {
    const diffPct = Math.abs((num(exchange.sl_order.stopPrice || exchange.sl_order.triggerPrice) - meta.sl_price) / meta.sl_price) * 100;
    push("AMBER", "SL_PRICE_DRIFT",
      `SL 가격이 DB(${meta.sl_price}) 와 거래소(${exchange.sl_order.stopPrice || exchange.sl_order.triggerPrice}) 사이에 ${diffPct.toFixed(2)}% 차이 — trailing 이 움직인 거면 정상.`);
  }

  // ── 트레일링 불변식 ───────────────────────────────────────────────
  // trail_active=true 는 반드시 tp_p1_done=true 와 짝 (reconciler invariant).
  if (meta.trail_active === true && meta.tp_p1_done !== true) {
    push("RED", "TRAIL_WITHOUT_TP1",
      "trail_active=true 인데 tp_p1_done=false — 트레일링은 TP1 부분체결 이후에만 켜져야 함.");
  }
  // tp_p1_done=true 인데 trail_active=false 면 러너 이익 보호가 꺼져 있을 수 있음.
  if (meta.tp_p1_done === true && meta.trail_active !== true) {
    push("AMBER", "TRAIL_DISARMED_AFTER_TP1",
      "TP1 부분체결 후 트레일링이 활성화되지 않음 — 러너 이익 보호가 꺼져 있을 수 있음.");
  }

  // ── Break-Even floor after TP1 ───────────────────────────────────
  // TP1 찍혔는데 stop 이 아직 진입가+BE 위로 올라오지 않았으면 AMBER.
  // (다음 tick 에 refresh 되면 올라갈 예정이지만, 지금 이 순간은 노출됨.)
  const beFloor = evaluateBreakEvenFloor({ meta, position });
  if (beFloor.applicable && beFloor.status === "STOP_BELOW_FLOOR") {
    push("AMBER", "BE_STOP_NOT_RAISED_AFTER_TP1",
      `TP1 완료됐지만 SL(${beFloor.current_stop && beFloor.current_stop.toFixed(2)})이 BE 하한(${beFloor.floor_price && beFloor.floor_price.toFixed(2)}) 아래. 다음 tick refresh 에 BE 위로 올라갈 예정.`);
  }

  // ── TP1 수량 sanity ───────────────────────────────────────────────
  // TP1 reduceOnly 주문의 수량이 포지션 크기보다 크면 구조 깨진 것.
  if (exchange.tp_order && exchange.tp_order.origQty != null
      && position && Number.isFinite(Number(position.qty_base))) {
    const posQty = Math.abs(Number(position.qty_base));
    const tpQty = Math.abs(Number(exchange.tp_order.origQty));
    if (posQty > 0 && tpQty > posQty * 1.02) {
      push("RED", "TP_QTY_EXCEEDS_POSITION",
        `TP 주문 수량(${tpQty})이 포지션 수량(${posQty})보다 큼 — 잔여 포지션 없이 과다 매도 가능.`);
    }
  }

  // Refresh 신선도 경고는 의도적으로 제거했음 (2026-04-18).
  // refreshBinanceNativeProtectionWithRetry 는 event-driven (entry/add/exit/
  // trail-trigger) 이지 주기적 heartbeat 가 아니어서, "5분 넘게 안 돌았음 = 문제"
  // 라는 발상이 잘못됐었음. 오히려 자주 돌면 그게 오류 상황. shouldEagerRefresh
  // NativeProtection 의 needed 플래그가 true 가 되는 조건이 곧 "SL/TP 가
  // 거래소에 없음" 인데 여기서 이미 SL_MISSING_ON_EXCHANGE / TP_MISSING_ON_
  // EXCHANGE 로 독립적으로 잡히므로 staleness 지표는 중복·혼란만 유발.

  return issues;
}

function classifyStatus(issues) {
  for (const iss of issues) if (iss.severity === "RED") return "RED";
  for (const iss of issues) if (iss.severity === "AMBER") return "AMBER";
  return "GREEN";
}

async function auditActivePositions({ liveCfg } = {}) {
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) {
    return {
      ok: false,
      error: "BINANCEFUT_KEYS_MISSING",
      positions: [],
      generated_at: new Date().toISOString(),
    };
  }

  const db = await getFirestore();
  const snap = await db.collection("positions_paper")
    .where("exchange", "==", "BINANCEFUT")
    .get();

  const positions = [];
  for (const doc of snap.docs) {
    const v = doc.data();
    if (!v || v.state !== "ACTIVE") continue;
    const symbol = String(v.symbol || (doc.id.split("__").pop() || "")).toUpperCase();
    if (!symbol) continue;

    const meta = extractMetaView(v);
    const fetched = await fetchOpenOrdersSafe({ apiKey: liveCfg.apiKey, apiSecret: liveCfg.apiSecret, symbol });
    const allOrders = [...fetched.regular, ...fetched.algo];
    const slOrder = pickSlOrder(allOrders);
    const tpOrder = pickTpOrder(allOrders);

    const phase = buildProtectionPhase({ meta, exchange: { sl_order: slOrder, tp_order: tpOrder } });
    const match = {
      ...phase,
      sl_present_on_exchange: !!slOrder,
      tp_present_on_exchange: !!tpOrder,
      sl_id_matches: !!(slOrder && meta.sl_order_id && String(slOrder.orderId) === meta.sl_order_id),
      tp_id_matches: !!(tpOrder && meta.tp_order_id && String(tpOrder.orderId) === meta.tp_order_id),
      sl_price_matches: !!(slOrder && meta.sl_price && pricesMatch(slOrder.stopPrice || slOrder.triggerPrice, meta.sl_price)),
      tp_price_matches: !!(tpOrder && meta.tp_price && pricesMatch(tpOrder.stopPrice || tpOrder.triggerPrice, meta.tp_price)),
    };

    const exchange = {
      all_orders_n: allOrders.length,
      sl_order: slOrder ? {
        orderId: String(slOrder.orderId || ""),
        type: slOrder.type || slOrder.orderType || null,
        stopPrice: num(slOrder.stopPrice || slOrder.triggerPrice),
        price: num(slOrder.price),
        closePosition: slOrder.closePosition === true,
        reduceOnly: slOrder.reduceOnly === true,
      } : null,
      tp_order: tpOrder ? {
        orderId: String(tpOrder.orderId || ""),
        type: tpOrder.type || tpOrder.orderType || null,
        stopPrice: num(tpOrder.stopPrice || tpOrder.triggerPrice),
        price: num(tpOrder.price),
        origQty: num(tpOrder.origQty || tpOrder.quantity),
        reduceOnly: tpOrder.reduceOnly === true,
      } : null,
      fetch_errors: fetched.errors,
      fetched_at: new Date().toISOString(),
    };

    const issues = buildIssues({ meta, exchange, match, position: v });
    const status = classifyStatus(issues);

    let age_minutes_since_entry = null;
    if (meta.entry_exec_bar_ms) {
      age_minutes_since_entry = Math.round((Date.now() - meta.entry_exec_bar_ms) / 60000);
    }

    positions.push({
      symbol,
      position_side: String(v.position_side || "").toUpperCase(),
      qty_base: num(v.qty_base),
      state: v.state,
      age_minutes_since_entry,
      meta,
      exchange,
      match,
      issues,
      status,
    });
  }

  // 전체 상태는 가장 나쁜 개별 상태를 올림.
  let overall = "GREEN";
  for (const p of positions) {
    if (p.status === "RED") { overall = "RED"; break; }
    if (p.status === "AMBER") overall = "AMBER";
  }

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    overall_status: overall,
    active_count: positions.length,
    positions,
  };
}

module.exports = {
  auditActivePositions,
  __test: {
    pricesMatch,
    classifyOrder,
    extractMetaView,
    buildIssues,
    classifyStatus,
    pickSlOrder,
    pickTpOrder,
    shouldRequireTpOrder,
    buildProtectionPhase,
    evaluateBreakEvenFloor,
  },
};
