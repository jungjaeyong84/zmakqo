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

function buildIssues({ meta, exchange, match, position }) {
  const issues = [];
  const push = (severity, code, message) => issues.push({ severity, code, message });

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

  if (!exchange.tp_order) {
    push("RED", "TP_MISSING_ON_EXCHANGE",
      "Binance 에 TAKE_PROFIT 주문이 없음 — 이익 실현 주문이 없음.");
  } else if (meta.tp_order_id && meta.tp_order_id !== exchange.tp_order.orderId) {
    push("RED", "TP_ORDER_ID_MISMATCH",
      `DB 는 TP id=${meta.tp_order_id} 를 기대하지만 거래소에는 id=${exchange.tp_order.orderId} 만 있음.`);
  } else if (!meta.tp_order_id && exchange.tp_order) {
    push("AMBER", "TP_DB_MISSING_ID",
      `거래소 TP 주문(id=${exchange.tp_order.orderId})은 존재하지만 DB 메타에 기록되지 않음.`);
  }

  if (match.sl_present_on_exchange && match.sl_price_matches === false && meta.sl_price != null) {
    const diffPct = Math.abs((num(exchange.sl_order.stopPrice || exchange.sl_order.triggerPrice) - meta.sl_price) / meta.sl_price) * 100;
    push("AMBER", "SL_PRICE_DRIFT",
      `SL 가격이 DB(${meta.sl_price}) 와 거래소(${exchange.sl_order.stopPrice || exchange.sl_order.triggerPrice}) 사이에 ${diffPct.toFixed(2)}% 차이 — trailing 이 움직인 거면 정상.`);
  }

  // Trailing invariant: trail_active=true 는 반드시 tp_p1_done=true 와 짝.
  if (meta.trail_active === true && meta.tp_p1_done !== true) {
    push("RED", "TRAIL_WITHOUT_TP1",
      "trail_active=true 인데 tp_p1_done=false — 트레일링은 TP1 부분체결 이후에만 켜져야 함.");
  }
  // tp_p1_done=true 인데 trail_active=false 면 트레일링이 비활성화 된 것
  // (정상일 수도 있지만 operator 가 인지하도록 info).
  if (meta.tp_p1_done === true && meta.trail_active !== true) {
    push("AMBER", "TRAIL_DISARMED_AFTER_TP1",
      "TP1 부분체결 후 트레일링이 활성화되지 않음 — 러너 이익 보호가 꺼져 있을 수 있음.");
  }

  // Refresh 신선도: 5분 이상 refresh 가 없으면 AMBER.
  if (meta.refresh_at_iso) {
    const ageMs = Date.now() - Date.parse(meta.refresh_at_iso);
    if (Number.isFinite(ageMs) && ageMs > 5 * 60 * 1000) {
      push("AMBER", "PROTECTION_REFRESH_STALE",
        `protection refresh 가 ${Math.round(ageMs / 60000)}분째 안 돌고 있음.`);
    }
  } else if (meta.sl_order_id || meta.tp_order_id) {
    push("AMBER", "PROTECTION_REFRESH_NEVER_RAN",
      "protection refresh 기록이 없음 (진입 시 refresh 누락 가능).");
  }

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

    const match = {
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
  },
};
