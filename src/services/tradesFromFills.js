const { getFirestore } = require("../storage/firestore");
const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { buildFundingIndexForFills, sumFunding } = require("./fundingFees");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function safeMs(x) {
  const n = toNum(x);
  return n === null ? null : n;
}
function readExternalRealizedPnl(fill) {
  if (!fill || typeof fill !== "object") return null;
  const direct = toNum(fill.external_realized_pnl ?? fill.realized_pnl ?? fill.realizedPnl);
  if (direct !== null) return direct;
  if (fill.extra && typeof fill.extra === "object") {
    const v = toNum(fill.extra.external_realized_pnl ?? fill.extra.realized_pnl ?? fill.extra.realizedPnl);
    if (v !== null) return v;
  }
  if (fill.meta && typeof fill.meta === "object") {
    const v = toNum(fill.meta.external_realized_pnl ?? fill.meta.realized_pnl ?? fill.meta.realizedPnl);
    if (v !== null) return v;
  }
  return null;
}

function pickFeaturesJson(fill) {
  const featuresJson = fill && fill.features_json && typeof fill.features_json === "object" && !Array.isArray(fill.features_json)
    ? fill.features_json
    : null;
  if (!featuresJson) return null;
  try {
    return JSON.parse(JSON.stringify(featuresJson));
  } catch (_err) {
    return null;
  }
}

function resolveQtyFromFill(f) {
  const qtyBase = toNum(f.exec_qty_base);
  if (qtyBase !== null && qtyBase > 0) return { qty: qtyBase, unit: "BASE" };
  const qtyPct = toNum(f.qty_pct);
  if (qtyPct !== null && qtyPct > 0) return { qty: qtyPct, unit: "BUDGET" };
  const qtyFraction = toNum(f.qty_fraction);
  if (qtyFraction !== null && qtyFraction > 0) return { qty: qtyFraction, unit: "BUDGET" };
  return { qty: null, unit: null };
}

function resolveNotionalKrw({ fill, price, qty, unit }) {
  const notionalRaw = toNum(fill.notional_krw ?? fill.notional);
  if (notionalRaw != null) return notionalRaw;
  if (unit === "BUDGET") {
    const budgetMax = toNum(fill.budget_max_krw);
    if (budgetMax != null && qty != null) return budgetMax * qty;
  }
  if (price != null && qty != null) return price * qty;
  return null;
}

function pickEntryEventId(fill) {
  const v = String(fill && (fill.entry_event_id || fill.entryEventId) || "").trim();
  return v || null;
}

function pickEntrySignalType(fill) {
  const v = String(fill && (fill.entry_signal_type || fill.entrySignalType || fill.event) || "").trim().toUpperCase();
  return v || null;
}

function pickSourceTradeId(fill) {
  const v = String(fill && (fill.trade_id || fill.tradeId) || "").trim();
  return v || null;
}

function pickSourceIntentId(fill) {
  const v = String(fill && (fill.intent_id || fill.intentId) || "").trim();
  return v || null;
}

function isFuturesFill(f) {
  const ex = String(f.exchange || "").toUpperCase();
  if (ex.includes("BINANCE")) return true;
  const sym = String(f.symbol || f.market || f.symbol_or_pair_id || "").toUpperCase();
  return sym.includes("USDT");
}

function fundingPaidForTrade({ fill, notionalKrw, openMs, closeMs }) {
  const bps = Number(process.env.FUNDING_BPS_PER_8H || 0);
  if (!Number.isFinite(bps) || bps === 0) return 0;
  if (!Number.isFinite(notionalKrw) || notionalKrw <= 0) return 0;
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) return 0;
  const heldMs = closeMs - openMs;
  const periods = heldMs / (8 * 60 * 60 * 1000);
  return notionalKrw * (bps / 10000) * periods;
}

function isExternalFill(f) {
  if (f && f.external === true) return true;
  const src = String(f.exec_price_source || "").toUpperCase();
  if (src === "BINANCE_USER_TRADES") return true;
  const ext = String(f.external_source || "").toUpperCase();
  return ext.includes("BINANCE");
}

/*
  fetchRecentNewFills
  - 기존: exec_price_source 없는 fill은 전부 버림(신형만)
  - 변경: legacy(fill.exec_price_source 없음)도 포함 가능
    - exec_price_source 없으면 "LEGACY"로 채움
    - exec_bar_close_time_utc_ms 없으면 created_at(ms)로 보정
  제어:
  - ALLOW_LEGACY_FILLS=1 이면 legacy 포함
  - ALLOW_LEGACY_FILLS=0 이면 기존처럼 신형만
  - 기본값: local(no oauth)면 legacy 포함, 그 외는 0
*/
async function fetchRecentNewFills({ exchange, symbol, tf, limitN = 1000, fromMs = null, fromIso = null, hardMaxDocs = null } = {}) {
  const db = getFirestore();

  const allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
  const allowLegacy = String(process.env.ALLOW_LEGACY_FILLS || (allowLocal ? "1" : "0")) === "1";
  const limitSafe = Math.max(1, Math.floor(Number(limitN) || 1000));
  const fromMsNum = fromMs == null ? null : Number(fromMs);
  const fromIsoMs = Date.parse(String(fromIso || ""));
  const fromMsParsed = Number.isFinite(fromMsNum) ? fromMsNum : (Number.isFinite(fromIsoMs) ? fromIsoMs : null);
  const hasFromBound = Number.isFinite(fromMsParsed);
  const hardMaxEnv = Math.floor(Number(process.env.DASHBOARD_FILLS_HARD_MAX || 0));
  const hardMaxSafe = Math.max(
    limitSafe,
    Math.floor(Number(hardMaxDocs) || 0) > 0
      ? Math.floor(Number(hardMaxDocs))
      : (hardMaxEnv > 0 ? hardMaxEnv : Math.max(limitSafe, 12000))
  );

  const out = [];

  const pushIfEligible = (d) => {
    const x0 = d.data() || {};

    // 심볼 키가 프로젝트 내에서 흔들려서(symbol/market/symbol_or_pair_id) 모두 허용
    const xSymbol = x0.symbol || x0.market || x0.symbol_or_pair_id || null;
    const xTf = x0.tf || null;

    if (x0.exchange !== exchange) return false;
    if (!isLiveDocForExchange(exchange, x0)) return false;
    if (xSymbol !== symbol) return false;

    // legacy 허용 시에는 tf 누락 허용(있으면 비교)
    if (xTf && xTf !== tf) return false;
    if (!xTf && !allowLegacy) return false;

    // exec_price는 필수
    const execPx = toNum(x0.exec_price);
    if (execPx === null) return false;

    // exec_bar_close_time_utc_ms: 없으면 created_at으로 보정(legacy)
    let barMs = safeMs(x0.exec_bar_close_time_utc_ms);
    if (barMs === null) {
      const cMs = Date.parse(String(x0.created_at || ""));
      if (Number.isFinite(cMs) && allowLegacy) barMs = cMs;
    }
    if (barMs === null) return false;

    const execSrc = x0.exec_price_source;

    // 신형만 모드면 exec_price_source 필수
    if (!allowLegacy && !execSrc) return false;

    const x = {
      id: d.id,
      ...x0,
      symbol: x0.symbol || x0.market || x0.symbol_or_pair_id || symbol,
      tf: x0.tf || tf,
      exec_price: execPx,
      exec_bar_close_time_utc_ms: barMs,
      exec_price_source: execSrc || "LEGACY",
    };

    out.push(x);
    return true;
  };

  // 기존 호출 호환: fromMs 미지정이면 단일 쿼리(limitN)만 수행
  if (!hasFromBound) {
    let snap = null;
    try {
      snap = await db.collection("fills_paper")
        .where("exchange", "==", exchange)
        .where("symbol", "==", symbol)
        .where("tf", "==", tf)
        .orderBy("created_at", "desc")
        .limit(limitSafe)
        .get();
    } catch (e) {
      snap = await db.collection("fills_paper")
        .orderBy("created_at", "desc")
        .limit(limitSafe)
        .get();
    }
    snap.forEach((d) => {
      pushIfEligible(d);
    });
    out.sort((a, b) => safeMs(a.exec_bar_close_time_utc_ms) - safeMs(b.exec_bar_close_time_utc_ms));
    return out;
  }

  // 정확도 우선: created_at desc 페이지네이션으로 fromMs 경계까지 확장 조회
  let cursorDoc = null;
  let scannedDocs = 0;
  const pageSize = Math.min(1000, Math.max(100, limitSafe));
  while (scannedDocs < hardMaxSafe) {
    const remaining = hardMaxSafe - scannedDocs;
    const thisLimit = Math.min(pageSize, remaining);
    let snap = null;
    try {
      let q = db.collection("fills_paper")
        .where("exchange", "==", exchange)
        .where("symbol", "==", symbol)
        .where("tf", "==", tf)
        .orderBy("created_at", "desc");
      if (cursorDoc) q = q.startAfter(cursorDoc);
      snap = await q.limit(thisLimit).get();
    } catch (e) {
      let q = db.collection("fills_paper").orderBy("created_at", "desc");
      if (cursorDoc) q = q.startAfter(cursorDoc);
      snap = await q.limit(thisLimit).get();
    }
    if (!snap || snap.empty) break;

    scannedDocs += snap.size;
    snap.forEach((d) => {
      pushIfEligible(d);
    });

    const lastDoc = snap.docs[snap.docs.length - 1];
    const lastData = lastDoc ? (lastDoc.data() || {}) : null;
    const oldestCreatedMs = Date.parse(String(lastData && lastData.created_at || ""));
    cursorDoc = lastDoc;

    if (snap.size < thisLimit) break;
    if (Number.isFinite(oldestCreatedMs) && oldestCreatedMs < fromMsParsed) break;
  }

  out.sort((a, b) => safeMs(a.exec_bar_close_time_utc_ms) - safeMs(b.exec_bar_close_time_utc_ms));
  return out;
}

async function fetchRecentImmutableFills({
  exchange,
  symbol,
  tf = null,
  limitN = 1000,
  fromMs = null,
  toMs = null,
} = {}) {
  const rows = await fetchUnifiedEventTimeline({
    exchange,
    symbol,
    fromMs,
    toMs,
    limit: Math.max(20, Math.trunc(Number(limitN) || 1000) * 8),
  }).catch(() => []);
  const out = [];
  for (const row of rows) {
    const kind = String(row && (row.event_kind || row.kind) || "").trim().toUpperCase();
    if (kind !== "FILL") continue;
    const raw = row && row.raw && typeof row.raw === "object" ? row.raw : null;
    if (!raw) continue;
    const fill = {
      ...raw,
      symbol: raw.symbol || raw.market || raw.symbol_or_pair_id || symbol,
      tf: raw.tf || tf || null,
      exec_price_source: raw.exec_price_source || raw.external_source || "UNIFIED_EVENT_TIMELINE",
    };
    if (fill.exchange !== exchange) continue;
    if (!isLiveDocForExchange(exchange, fill)) continue;
    if ((fill.symbol || fill.market || fill.symbol_or_pair_id) !== symbol) continue;
    if (tf && fill.tf && fill.tf !== tf) continue;
    const execMs = safeMs(fill.exec_bar_close_time_utc_ms) || safeMs(row.ts_ms) || safeMs(fill.created_at);
    if (execMs == null) continue;
    fill.exec_bar_close_time_utc_ms = execMs;
    if (fromMs != null && Number.isFinite(Number(fromMs)) && execMs < Number(fromMs)) continue;
    if (toMs != null && Number.isFinite(Number(toMs)) && execMs > Number(toMs)) continue;
    out.push(fill);
  }
  out.sort((a, b) => safeMs(a.exec_bar_close_time_utc_ms) - safeMs(b.exec_bar_close_time_utc_ms));
  if (out.length <= limitN) return out;
  return out.slice(out.length - Math.max(1, Math.trunc(Number(limitN) || 1000)));
}

/*
mode:
- FULL_CLOSE (v0): 포지션 0 될 때만 trade 1개 종료로 카운트
- EACH_SELL  (v1): SELL 발생할 때마다 pnl 1개 카운트 (표본 축적 가속)
*/
function buildTradesFromFills(fills, opts = {}) {
  const mode = String(opts.mode || process.env.TRADE_PNL_MODE || "FULL_CLOSE").toUpperCase();
  const fundingIndex = opts.fundingIndex || null;

  const trades = [];
  const closedTradePnls = [];

  let posSize = 0;
  let posAvg = null;
  let posSide = null;
  let tradeOpenMs = null;
  let tradeId = 0;
  let currentEntryEventId = null;
  let currentEntrySignalType = null;
  let currentEntryFeaturesJson = null;

  for (const f of fills) {
    const side = String(f.side || "").toUpperCase();
    const px = toNum(f.exec_price);
    const ms = safeMs(f.exec_bar_close_time_utc_ms);
    const feeValue = toNum(f.fee_value) ?? 0;
    const qtyPct = toNum(f.qty_pct);
    const qtyFraction = toNum(f.qty_fraction);
    const execQtyBase = toNum(f.exec_qty_base);
    const hasBudgetQty = (qtyPct !== null && qtyPct > 0) || (qtyFraction !== null && qtyFraction > 0);
    const extRealized = readExternalRealizedPnl(f);
    const externalFill = isExternalFill(f);

    if (px === null || ms === null) continue;

    if (!hasBudgetQty && extRealized != null && extRealized !== 0) {
      tradeId += 1;
      const notionalKrw = resolveNotionalKrw({ fill: f, price: px, qty: execQtyBase, unit: "BASE" });
      const pnlAdj = extRealized - (Number.isFinite(feeValue) ? feeValue : 0);
      const pnlPct = (notionalKrw != null && notionalKrw !== 0) ? (pnlAdj / notionalKrw) : null;
      trades.push({
        trade_id: tradeId,
        source_trade_id: pickSourceTradeId(f),
        source_intent_id: pickSourceIntentId(f),
        open_ms: ms,
        close_ms: ms,
        entry_avg: px,
        exit_px: px,
        qty_closed: execQtyBase,
        qty_remaining: 0,
        pnl_pct: pnlPct,
        notional_krw: notionalKrw,
        pnl_krw: pnlAdj,
        pnl_pct_gross: pnlPct,
        pnl_krw_gross: pnlAdj,
        fee_value: feeValue,
        funding_paid: 0,
        fill_id: f.fill_id || f.id,
        close_type: "EXTERNAL_REALIZED",
        pnl_mode: mode,
        position_side: side === "SELL" ? "SHORT" : "LONG",
        features_json: pickFeaturesJson(f),
      });
      if (Number.isFinite(pnlPct)) closedTradePnls.push(pnlPct);
      continue;
    }

    const { qty, unit } = resolveQtyFromFill(f);

    if (!Number.isFinite(qty) || qty <= 0) continue;

    if (side === "BUY") {
      if (posSize === 0) {
        tradeId += 1;
        tradeOpenMs = ms;
        posAvg = px;
        posSize = qty;
        posSide = "LONG";
        currentEntryEventId = pickEntryEventId(f);
        currentEntrySignalType = pickEntrySignalType(f);
        currentEntryFeaturesJson = pickFeaturesJson(f);
      } else if (posSide === "LONG") {
        const prevNotional = posSize;
        const nextNotional = posSize + qty;
        posAvg = (posAvg * prevNotional + px * qty) / nextNotional;
        posSize = nextNotional;
        if (!currentEntryEventId) currentEntryEventId = pickEntryEventId(f);
        if (!currentEntrySignalType) currentEntrySignalType = pickEntrySignalType(f);
        if (!currentEntryFeaturesJson) currentEntryFeaturesJson = pickFeaturesJson(f);
      } else if (posSide === "SHORT") {
        const closeQty = Math.min(qty, posSize);
        const pnlPct = (posAvg - px) / posAvg;
        const remainingAfter = posSize - closeQty;

        const notionalKrw = resolveNotionalKrw({ fill: f, price: px, qty: closeQty, unit });
        let pnlKrw = (notionalKrw != null) ? (pnlPct * notionalKrw) : null;
        const isFut = isFuturesFill(f);
        let fundingPaid = 0;
        if (isFut) {
          if (fundingIndex) {
            fundingPaid = sumFunding(fundingIndex, tradeOpenMs, ms);
          } else {
            fundingPaid = fundingPaidForTrade({ fill: f, notionalKrw, openMs: tradeOpenMs, closeMs: ms });
          }
        }
        let fundingPct = (notionalKrw != null && Number.isFinite(fundingPaid)) ? (fundingPaid / notionalKrw) : 0;
        let pnlPctNet = (isFut && Number.isFinite(fundingPct)) ? (pnlPct - fundingPct) : pnlPct;
        let pnlKrwNet = (isFut && pnlKrw != null && Number.isFinite(fundingPaid)) ? (pnlKrw - fundingPaid) : pnlKrw;

        if (externalFill && Number.isFinite(extRealized) && extRealized !== 0) {
          const pnlAdj = extRealized - (Number.isFinite(feeValue) ? feeValue : 0);
          pnlKrw = pnlAdj;
          pnlKrwNet = pnlAdj;
          fundingPaid = 0;
          fundingPct = 0;
          if (notionalKrw != null && notionalKrw !== 0) {
            pnlPctNet = pnlAdj / notionalKrw;
          }
        }

        const realized = {
          trade_id: tradeId,
          source_trade_id: pickSourceTradeId(f),
          source_intent_id: pickSourceIntentId(f),
          open_ms: tradeOpenMs,
          close_ms: ms,
          entry_avg: posAvg,
          exit_px: px,
          qty_closed: closeQty,
          qty_remaining: Math.max(0, remainingAfter),
          pnl_pct: pnlPctNet,
          notional_krw: notionalKrw,
          pnl_krw: pnlKrwNet,
          pnl_pct_gross: pnlPct,
          pnl_krw_gross: pnlKrw,
          fee_value: feeValue,
          funding_paid: fundingPaid,
          fill_id: f.fill_id || f.id,
          entry_event_id: currentEntryEventId,
          entry_signal_type: currentEntrySignalType,
          exit_event: String(f.event || "").toUpperCase() || null,
          close_type: (remainingAfter <= 0) ? "FULL_CLOSE" : "PARTIAL_CLOSE",
          pnl_mode: mode,
          position_side: "SHORT",
          features_json: currentEntryFeaturesJson || pickFeaturesJson(f),
        };

        posSize = remainingAfter;
        trades.push(realized);

        const pnlStat = (isFut && Number.isFinite(pnlPctNet)) ? pnlPctNet : pnlPct;
        if (mode === "EACH_SELL") {
          closedTradePnls.push(pnlStat);
        } else {
          if (posSize <= 0) closedTradePnls.push(pnlStat);
        }

        if (posSize <= 0) {
          posSize = 0;
          posAvg = null;
          posSide = null;
          tradeOpenMs = null;
          currentEntryEventId = null;
          currentEntrySignalType = null;
          currentEntryFeaturesJson = null;
        }
      }
      continue;
    }

    if (side === "SELL") {
      if (posSize === 0) {
        tradeId += 1;
        tradeOpenMs = ms;
        posAvg = px;
        posSize = qty;
        posSide = "SHORT";
        currentEntryEventId = pickEntryEventId(f);
        currentEntrySignalType = pickEntrySignalType(f);
        currentEntryFeaturesJson = pickFeaturesJson(f);
        continue;
      }

      if (posSide === "SHORT") {
        const prevNotional = posSize;
        const nextNotional = posSize + qty;
        posAvg = (posAvg * prevNotional + px * qty) / nextNotional;
        posSize = nextNotional;
        if (!currentEntryEventId) currentEntryEventId = pickEntryEventId(f);
        if (!currentEntrySignalType) currentEntrySignalType = pickEntrySignalType(f);
        if (!currentEntryFeaturesJson) currentEntryFeaturesJson = pickFeaturesJson(f);
        continue;
      }

      if (posSide !== "LONG" || posAvg === null) continue;

      const sellQty = Math.min(qty, posSize);
      const pnlPct = (px - posAvg) / posAvg;
      const remainingAfter = posSize - sellQty;

      const notionalKrw = resolveNotionalKrw({ fill: f, price: px, qty: sellQty, unit });
      let pnlKrw = (notionalKrw != null) ? (pnlPct * notionalKrw) : null;
      const isFut = isFuturesFill(f);
      let fundingPaid = 0;
      if (isFut) {
        if (fundingIndex) {
          fundingPaid = sumFunding(fundingIndex, tradeOpenMs, ms);
        } else {
          fundingPaid = fundingPaidForTrade({ fill: f, notionalKrw, openMs: tradeOpenMs, closeMs: ms });
        }
      }
      let fundingPct = (notionalKrw != null && Number.isFinite(fundingPaid)) ? (fundingPaid / notionalKrw) : 0;
      let pnlPctNet = (isFut && Number.isFinite(fundingPct)) ? (pnlPct - fundingPct) : pnlPct;
      let pnlKrwNet = (isFut && pnlKrw != null && Number.isFinite(fundingPaid)) ? (pnlKrw - fundingPaid) : pnlKrw;

      if (externalFill && Number.isFinite(extRealized) && extRealized !== 0) {
        const pnlAdj = extRealized - (Number.isFinite(feeValue) ? feeValue : 0);
        pnlKrw = pnlAdj;
        pnlKrwNet = pnlAdj;
        fundingPaid = 0;
        fundingPct = 0;
        if (notionalKrw != null && notionalKrw !== 0) {
          pnlPctNet = pnlAdj / notionalKrw;
        }
      }

      const realized = {
        trade_id: tradeId,
        source_trade_id: pickSourceTradeId(f),
        source_intent_id: pickSourceIntentId(f),
        open_ms: tradeOpenMs,
        close_ms: ms,
        entry_avg: posAvg,
        exit_px: px,
        qty_closed: sellQty,
        qty_remaining: Math.max(0, remainingAfter),
        pnl_pct: pnlPctNet,
        notional_krw: notionalKrw,
        pnl_krw: pnlKrwNet,
        pnl_pct_gross: pnlPct,
        pnl_krw_gross: pnlKrw,
        fee_value: feeValue,
        funding_paid: fundingPaid,
        fill_id: f.fill_id || f.id,
        entry_event_id: currentEntryEventId,
        entry_signal_type: currentEntrySignalType,
        exit_event: String(f.event || "").toUpperCase() || null,
        close_type: (remainingAfter <= 0) ? "FULL_CLOSE" : "PARTIAL_CLOSE",
        pnl_mode: mode,
        position_side: "LONG",
        features_json: currentEntryFeaturesJson || pickFeaturesJson(f),
      };

      posSize = remainingAfter;

      trades.push(realized);

      const pnlStat = (isFut && Number.isFinite(pnlPctNet)) ? pnlPctNet : pnlPct;
      if (mode === "EACH_SELL") {
        closedTradePnls.push(pnlStat);
      } else {
        if (posSize <= 0) closedTradePnls.push(pnlStat);
      }

      if (posSize <= 0) {
        posSize = 0;
        posAvg = null;
        posSide = null;
        tradeOpenMs = null;
        currentEntryEventId = null;
        currentEntrySignalType = null;
        currentEntryFeaturesJson = null;
      }
    }
  }

  return { trades, closedTradePnls };
}

async function buildTradesFromFillsWithFunding(fills, opts = {}) {
  const list = Array.isArray(fills) ? fills : [];
  const first = list.length ? list[0] : null;
  const exchange = opts.exchange || (first && first.exchange) || null;
  const symbolOverride = opts.symbol || null;
  if (!list.length) return buildTradesFromFills(list, opts);

  if (symbolOverride) {
    const fundingIndex = await buildFundingIndexForFills({ exchange, symbol: symbolOverride, fills: list });
    return buildTradesFromFills(list, { ...opts, fundingIndex });
  }

  const bySymbol = {};
  for (const f of list) {
    const sym = f && (f.symbol || f.symbol_or_pair_id || f.market);
    if (!sym) continue;
    if (!bySymbol[sym]) bySymbol[sym] = [];
    bySymbol[sym].push(f);
  }

  const trades = [];
  const closedTradePnls = [];
  for (const [sym, symFills] of Object.entries(bySymbol)) {
    const fundingIndex = await buildFundingIndexForFills({ exchange, symbol: sym, fills: symFills });
    const res = buildTradesFromFills(symFills, { ...opts, fundingIndex });
    trades.push(...(res.trades || []));
    closedTradePnls.push(...(res.closedTradePnls || []));
  }

  trades.sort((a, b) => Number(a.close_ms || 0) - Number(b.close_ms || 0));
  return { trades, closedTradePnls };
}

function buildExternalPnlRowsFromFills(fills, opts = {}) {
  if (!Array.isArray(fills) || !fills.length) return [];
  const source = String(opts.source || "BINANCE_USER_TRADES").toUpperCase();
  const fromMs = Number(opts.fromMs);
  const hasFromMs = Number.isFinite(fromMs);
  const rows = [];
  for (const f of fills) {
    const src = String(f && f.exec_price_source || "").toUpperCase();
    const extSrc = String(f && f.external_source || "").toUpperCase();
    const sourceMatched = src === source || extSrc === source;
    const externalMatched = source === "BINANCE_USER_TRADES" && isExternalFill(f);
    if (!sourceMatched && !externalMatched) continue;
    const ms = Number(f && f.exec_bar_close_time_utc_ms);
    if (!Number.isFinite(ms)) continue;
    if (hasFromMs && ms < fromMs) continue;
    const ext = readExternalRealizedPnl(f);
    if (ext == null) continue;
    const fee = toNum(f.fee_value) || 0;
    rows.push({
      close_ms: ms,
      pnl_krw: ext - fee,
      notional_krw: toNum(f.notional_krw ?? f.notional),
    });
  }
  return rows;
}

module.exports = {
  fetchRecentNewFills,
  fetchRecentImmutableFills,
  buildTradesFromFills,
  buildTradesFromFillsWithFunding,
  buildExternalPnlRowsFromFills,
};
