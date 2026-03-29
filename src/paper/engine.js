// src/paper/engine.js
const { getFirestore } = require("../storage/firestore");
const { getRiskBudgetCached } = require("../storage/settings");

const log = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
};

function nowIso() { return new Date().toISOString(); }

function safeId(s) {
  return String(s).replace(/[^a-zA-Z0-9_\-:.]/g, "_");
}

function parseRulesEnv() {
  const raw = process.env.PAPER_RULES || "R1_BASE";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function getPosition({ ruleId, symbol }) {
  const db = getFirestore();
  const docId = safeId(`${ruleId}_${symbol}`);
  const ref = db.collection("positions_paper").doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data();
}

async function setPosition({ ruleId, symbol, pos }) {
  const db = getFirestore();
  const docId = safeId(`${ruleId}_${symbol}`);
  const ref = db.collection("positions_paper").doc(docId);
  await ref.set(
    { ...pos, rule_id: ruleId, symbol, updated_at: nowIso() },
    { merge: true }
  );
}

async function writeSignal(signal) {
  const db = getFirestore();
  const ref = db.collection("signals_tv").doc();
  const doc = { signal_id: ref.id, ...signal, created_at: nowIso() };
  await ref.set(doc);
  return doc;
}

async function writeOrder(order) {
  const db = getFirestore();
  const ref = db.collection("orders_paper").doc();
  const doc = { order_id: ref.id, ...order, created_at: nowIso() };
  await ref.set(doc);
  return doc;
}

async function writeFill(fill) {
  const db = getFirestore();
  const ref = db.collection("fills_paper").doc();
  const doc = { fill_id: ref.id, ...fill, created_at: nowIso() };
  await ref.set(doc);
  return doc;
}

function calcFees({ notional, feeBps }) {
  const fee = (notional * feeBps) / 10000.0;
  return fee;
}

function toNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("INVALID_NUMBER");
  return n;
}

/**
 * PAPER 실행 규칙(기본)
 * - 현물 롱 only
 * - BUY: 포지션 없으면 진입
 * - SELL: 포지션 있으면 전량 청산
 * - 체결 가격: payload.price (signal bar close)
 */
async function processSignalOnce({ runId, ruleId, payload }) {
  const symbol = payload.symbol;
  const tf = payload.tf;
  const price = toNumber(payload.price);
  const signal = String(payload.signal || "").toUpperCase();

  const feeBps = Number(process.env.FEE_BPS || 5); // 0.05%
  const slippageBps = Number(process.env.SLIPPAGE_BPS || 10); // 0.10%

  let maxKrw = Number(process.env.PAPER_MAX_KRW || 100000);
  const paperMaxKrw = maxKrw;

  // Risk Budget (settings/risk_budget) 적용
  // - enabled=true일 때만 override
  // - cfg.on_exceed: CLAMP(default) | SKIP
  // - cfg는 BUY 블록에서 정책 판정에 사용
  let cfg = null;
  try {
    const rb = await getRiskBudgetCached();
    const rbSource = (rb && rb.source) ? rb.source : "unknown";
    cfg = (rb && rb.data) ? rb.data : null;

    if (cfg && cfg.enabled === true) {
      const v =
        (cfg.by_market && cfg.by_market[symbol]) ||
        cfg.default_max_krw ||
        null;

      if (Number.isFinite(Number(v)) && Number(v) > 0) {
        maxKrw = Number(v);
        log.info("[RISK_BUDGET_APPLY]", { symbol, maxKrw, source: rbSource });
      }
    }
  } catch (e) {
    log.warn("[RISK_BUDGET] load failed, fallback", (e && e.message) ? e.message : String(e));
  }

  // 슬리피지 반영 가격
  const pxBuy = price * (1 + slippageBps / 10000.0);
  const pxSell = price * (1 - slippageBps / 10000.0);

  // 기본 목표 수량(예산 기준)
  const qty = maxKrw / price;

  const pos = await getPosition({ ruleId, symbol });

  if (signal === "BUY") {
    // 이미 포지션 있으면 스킵
    if (pos && pos.side === "LONG" && pos.qty > 0) {
      return { ok: true, action: "SKIP", reason: "ALREADY_LONG" };
    }

    // Risk Budget Policy (FINAL)
    // - SKIP: BUY 자체 차단(예산이 PAPER_MAX_KRW 대비 축소를 요구할 때)
    // - CLAMP: 그 외엔 수량 축소로 맞춰서 집행
    const oe = String((cfg && cfg.on_exceed) ? cfg.on_exceed : "CLAMP").toUpperCase();

    if (
      oe === "SKIP" &&
      Number.isFinite(paperMaxKrw) &&
      Number.isFinite(maxKrw) &&
      maxKrw < paperMaxKrw
    ) {
      log.info("[RISK_EXCEED_POLICY_SKIP]", {
        symbol,
        paperMaxKrw,
        budgetMaxKrw: maxKrw
      });
      return { ok: true, action: "SKIP", reason: "RISK_EXCEED_POLICY_SKIP" };
    }

    let qty_eff = qty;

    if (
      oe === "CLAMP" &&
      Number.isFinite(maxKrw) &&
      maxKrw > 0 &&
      Number.isFinite(pxBuy) &&
      pxBuy > 0
    ) {
      const maxQty = maxKrw / pxBuy;
      if (qty_eff > maxQty) {
        log.info("[RISK_BUDGET_CLAMP]", {
          symbol,
          maxKrw,
          pxBuy,
          requestedQty: qty_eff,
          cappedQty: maxQty
        });
        qty_eff = maxQty;
      }
    }

    const notional = qty_eff * pxBuy;
    const fee = calcFees({ notional, feeBps });

    const order = await writeOrder({
      run_id: runId,
      rule_id: ruleId,
      symbol,
      tf,
      side: "BUY",
      type: "MARKET_PAPER",
      price_ref: price,
      price_exec: pxBuy,
      qty: qty_eff,
      notional,
      fee,
      source: payload.source,
      version: payload.version,
      reason_codes: payload.reason_codes || [],
      signal_ts: payload.ts || null,
    });

    const fill = await writeFill({
      run_id: runId,
      rule_id: ruleId,
      symbol,
      side: "BUY",
      price_exec: pxBuy,
      qty: qty_eff,
      notional,
      fee,
      order_id: order.order_id,
      signal_ts: payload.ts || null,
    });

    await setPosition({
      ruleId,
      symbol,
      pos: {
        side: "LONG",
        qty: qty_eff,
        avg_price: pxBuy,
        entry_ts: nowIso(),
        entry_signal_ts: payload.ts || null,
        entry_run_id: runId,
        entry_order_id: order.order_id,
        entry_fill_id: fill.fill_id,

        // 누적 손익 유지
        realized_pnl: (pos && typeof pos.realized_pnl === "number") ? pos.realized_pnl : 0,

        // BUY 시 exit 스냅샷 클리어(merge 찌꺼기 제거)
        exit_ts: null,
        exit_signal_ts: null,
        exit_run_id: null,
        exit_order_id: null,
        exit_fill_id: null,
      },
    });

    return { ok: true, action: "BUY", order_id: order.order_id, fill_id: fill.fill_id };
  }

  if (signal === "SELL") {
    // 포지션 없으면 스킵
    if (!pos || pos.side !== "LONG" || !pos.qty || pos.qty <= 0) {
      return { ok: true, action: "SKIP", reason: "NO_POSITION" };
    }

    const closeQty = pos.qty;
    const notional = closeQty * pxSell;
    const fee = calcFees({ notional, feeBps });

    const entryNotional = pos.qty * pos.avg_price;
    const entryFeeAssumed = calcFees({ notional: entryNotional, feeBps });
    const grossPnl = (pxSell - pos.avg_price) * closeQty;
    const netPnl = grossPnl - fee - entryFeeAssumed;

    const order = await writeOrder({
      run_id: runId,
      rule_id: ruleId,
      symbol,
      tf,
      side: "SELL",
      type: "MARKET_PAPER",
      price_ref: price,
      price_exec: pxSell,
      qty: closeQty,
      notional,
      fee,
      source: payload.source,
      version: payload.version,
      reason_codes: payload.reason_codes || [],
      signal_ts: payload.ts || null,
    });

    const fill = await writeFill({
      run_id: runId,
      rule_id: ruleId,
      symbol,
      side: "SELL",
      price_exec: pxSell,
      qty: closeQty,
      notional,
      fee,
      order_id: order.order_id,
      signal_ts: payload.ts || null,
      net_pnl: netPnl,
      gross_pnl: grossPnl,
    });

    await setPosition({
      ruleId,
      symbol,
      pos: {
        side: "FLAT",
        qty: 0,
        avg_price: 0,
        exit_ts: nowIso(),
        exit_signal_ts: payload.ts || null,
        exit_run_id: runId,
        exit_order_id: order.order_id,
        exit_fill_id: fill.fill_id,
        realized_pnl: (pos.realized_pnl || 0) + netPnl,
      },
    });

    return {
      ok: true,
      action: "SELL",
      order_id: order.order_id,
      fill_id: fill.fill_id,
      net_pnl: netPnl
    };
  }

  return { ok: false, action: "REJECT", reason: "UNKNOWN_SIGNAL" };
}

/**
 * 동일 신호를 여러 ruleId로 병렬 평가
 */
async function processSignalPaper({ runId, payload }) {
  const rules = parseRulesEnv();
  const signalDoc = await writeSignal(payload);

  const results = [];
  for (const ruleId of rules) {
    const r = await processSignalOnce({ runId, ruleId, payload });
    results.push({ rule_id: ruleId, ...r });
  }

  return { ok: true, signal_id: signalDoc.signal_id, results };
}

module.exports = { processSignalPaper, parseRulesEnv };
