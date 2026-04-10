const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesExchangeInfo,
  __test: binancePrivateTest,
} = require("../exchanges/binanceFuturesPrivate");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv, normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { getPositionRuntimeObservation, __test: observationTest } = require("../storage/positionRuntimeObservations");
const { resolveExitRulesForPosition } = require("../engine/signalEngine");
const { normalizePositionSide, resolveCloseSide, resolvePositionSideFromPosition } = require("../utils/positionSide");
const { resolveTrailObservationSnapshot } = observationTest;

function toBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function nowIso() {
  return new Date().toISOString();
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isInternalActive(pos) {
  const state = String(pos && (pos.position_state || pos.state) || "").toUpperCase();
  const qtyBase = Number(pos && pos.qty_base);
  const sizePct = Number(pos && pos.size_pct);
  const stateOk = state === "ACTIVE" || state === "COMMIT" || state === "PROBE" || state === "SCALE_OUT";
  return stateOk || (Number.isFinite(qtyBase) && qtyBase > 0) || (Number.isFinite(sizePct) && sizePct > 0);
}

function resolveExternalSideFromPosition(ext) {
  const amt = Number(ext && (ext.positionAmt ?? ext.position_amt));
  if (!Number.isFinite(amt) || amt === 0) return null;
  return amt > 0 ? "LONG" : "SHORT";
}

function computeExpectedNativeStopPx({ positionSide, entryPrice, leverage, rules } = {}) {
  const side = normalizePositionSide(positionSide);
  const entry = Number(entryPrice);
  const lev = Number(leverage);
  const sl = Math.abs(Number(rules && rules.SL));
  if (!side || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(lev) || lev <= 0 || !Number.isFinite(sl) || sl <= 0) {
    return null;
  }
  const movePct = sl / lev;
  if (!Number.isFinite(movePct) || movePct <= 0) return null;
  return side === "SHORT" ? entry * (1 + movePct) : entry * (1 - movePct);
}

function computeExpectedNativeTpPx({ positionSide, entryPrice, leverage, rules } = {}) {
  const side = normalizePositionSide(positionSide);
  const entry = Number(entryPrice);
  const lev = Number(leverage);
  const tp = Math.abs(Number(rules && rules.TP_P1));
  if (!side || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(lev) || lev <= 0 || !Number.isFinite(tp) || tp <= 0) {
    return null;
  }
  const movePct = tp / lev;
  if (!Number.isFinite(movePct) || movePct <= 0) return null;
  return side === "SHORT" ? entry * (1 - movePct) : entry * (1 + movePct);
}

async function resolveBinanceKeys() {
  const ex = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "").trim();
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function makeIssue({ symbol, code, severity = "WARN", detail, meta } = {}) {
  return {
    symbol: String(symbol || "").toUpperCase(),
    code: String(code || "").toUpperCase(),
    severity: String(severity || "WARN").toUpperCase(),
    detail: String(detail || "").trim(),
    meta: meta && typeof meta === "object" ? meta : {},
  };
}

function normalizeAlgoOrderFetchResult(payload) {
  const helper = binancePrivateTest && typeof binancePrivateTest.normalizeAlgoOpenOrdersResponse === "function"
    ? binancePrivateTest.normalizeAlgoOpenOrdersResponse
    : null;
  if (helper) return helper(payload);
  if (Array.isArray(payload)) return { orders: payload, endpointUnavailable: false, note: null };
  if (payload && typeof payload === "object" && payload.endpointUnavailable === true) {
    return {
      orders: Array.isArray(payload.orders) ? payload.orders : [],
      endpointUnavailable: true,
      note: String(payload.note || "ALGO_ENDPOINT_UNAVAILABLE"),
    };
  }
  return { orders: [], endpointUnavailable: false, note: null };
}

function normalizeOrderType(order) {
  return String(order && (order.type || order.origType || order.orderType || order.algoType) || "").toUpperCase();
}

function normalizeOrderTriggerPrice(order) {
  return Number(order && (order.stopPrice || order.activatePrice || order.triggerPrice));
}

function resolveExpectedNativeTrigger({ meta, fallbackExpected } = {}) {
  const tracked = Number(meta);
  if (Number.isFinite(tracked) && tracked > 0) return tracked;
  return Number.isFinite(Number(fallbackExpected)) ? Number(fallbackExpected) : null;
}

function hasTrackedNativeProtectionMeta(meta) {
  const ctx = meta && typeof meta === "object" ? meta : {};
  const stopOrderId = String(ctx.native_protection_stop_order_id || "").trim();
  const tpOrderId = String(ctx.native_protection_tp_order_id || "").trim();
  const refreshStatus = String(ctx.native_protection_refresh_status || "").toUpperCase();
  const tpStatus = String(ctx.native_protection_tp_status || "").toUpperCase();
  return !!(stopOrderId || tpOrderId || refreshStatus === "OK" || tpStatus === "OK");
}

async function auditBinanceExitIntegrity({ symbols, includeFlat = false } = {}) {
  const keys = await resolveBinanceKeys();
  if (!keys) return { ok: false, reason: "BINANCE_KEYS_MISSING", updated_at: nowIso(), issues: [], markets: [] };

  const db = getFirestore();
  const baseMarkets = Array.isArray(symbols) && symbols.length
    ? symbols.map((s) => normalizeMarketSymbolForProvider(s, "BINANCEFUT")).filter(Boolean)
    : defaultMarketsFromEnv("BINANCEFUT");

  const [account, posSnap] = await Promise.all([
    fetchBinanceFuturesAccount({ ...keys }),
    db.collection("positions_paper").where("exchange", "==", "BINANCEFUT").get(),
  ]);

  const externalPositions = new Map();
  for (const raw of Array.isArray(account && account.positions) ? account.positions : []) {
    const symbol = normalizeMarketSymbolForProvider(raw && raw.symbol, "BINANCEFUT");
    const amt = Number(raw && raw.positionAmt);
    if (!symbol || !Number.isFinite(amt) || amt === 0) continue;
    externalPositions.set(symbol, raw);
  }

  const internalPositions = new Map();
  posSnap.forEach((doc) => {
    const data = doc.data() || {};
    const symbol = normalizeMarketSymbolForProvider(data.symbol_or_pair_id || data.symbol, "BINANCEFUT");
    if (!symbol) return;
    internalPositions.set(symbol, data);
  });

  const symbolSet = new Set(baseMarkets);
  for (const sym of externalPositions.keys()) symbolSet.add(sym);
  for (const [sym, pos] of internalPositions.entries()) {
    if (isInternalActive(pos)) symbolSet.add(sym);
  }

  const issues = [];
  const markets = [];

  for (const sym of Array.from(symbolSet)) {
    const internal = internalPositions.get(sym) || null;
    const meta = (internal && typeof internal.meta === "object") ? internal.meta : {};
    const external = externalPositions.get(sym) || null;
    const internalActive = isInternalActive(internal);
    const externalActive = !!external;

    if (!includeFlat && !internalActive && !externalActive) continue;

    const marketIssues = [];
    const internalSide = resolvePositionSideFromPosition(internal, meta);
    const externalSide = resolveExternalSideFromPosition(external);
    const runtimeObservation = internalActive
      ? await getPositionRuntimeObservation({ exchange: "BINANCEFUT", symbol: sym }).catch(() => null)
      : null;
    const trailSnapshot = resolveTrailObservationSnapshot({ meta, observation: runtimeObservation });
    const entryPrice = toNum((external && (external.entryPrice || external.entry_price)) || (internal && internal.avg_price));
    const leverage = toNum((external && external.leverage) || meta.leverage || meta.external_leverage);
    const rules = internal
      ? resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: internal })
      : null;

    if (internalActive && !externalActive) {
      marketIssues.push(makeIssue({
        symbol: sym,
        code: "INTERNAL_ACTIVE_EXTERNAL_FLAT",
        severity: "CRIT",
        detail: "내부 포지션은 ACTIVE인데 Binance 실포지션은 없음",
      }));
    }
    if (!internalActive && externalActive) {
      marketIssues.push(makeIssue({
        symbol: sym,
        code: "EXTERNAL_ACTIVE_INTERNAL_FLAT",
        severity: "CRIT",
        detail: "Binance 실포지션은 있는데 내부 포지션은 FLAT",
      }));
    }
    if (internalActive && externalActive && internalSide && externalSide && internalSide !== externalSide) {
      marketIssues.push(makeIssue({
        symbol: sym,
        code: "POSITION_SIDE_MISMATCH",
        severity: "CRIT",
        detail: `내부=${internalSide}, 외부=${externalSide}`,
      }));
    }

    if (internalActive) {
      if (
        !rules ||
        !Number.isFinite(Number(rules.SL)) ||
        !Number.isFinite(Number(rules.TP_P1)) ||
        (!Number.isFinite(Number(rules.TRAIL_R_MULTIPLE)) && !Number.isFinite(Number(rules.TRAIL_PCT)))
      ) {
        marketIssues.push(makeIssue({
          symbol: sym,
          code: "EXIT_RULES_INVALID",
          severity: "CRIT",
          detail: "활성 포지션의 exit rules가 비정상",
        }));
      }

      if (meta.tp_p1_done === true) {
        const trailRef = internalSide === "SHORT"
          ? Number(trailSnapshot.trail_low)
          : Number(trailSnapshot.trail_high);
        if (meta.trail_active !== true) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_TRAIL_INACTIVE",
            severity: "CRIT",
            detail: "TP1 완료인데 trail_active=false",
          }));
        }
        if (!Number.isFinite(trailRef)) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_TRAIL_REF_MISSING",
            severity: "CRIT",
            detail: "TP1 완료인데 trail 기준값이 없음",
          }));
        }
      }

      if (meta.tp_p1_pending === true) {
        const pendingUntil = Number(meta.tp_p1_pending_until_ms);
        if (Number.isFinite(pendingUntil) && pendingUntil > 0 && pendingUntil < Date.now()) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_PENDING_EXPIRED",
            severity: "WARN",
            detail: `TP1 pending 만료 후 잔류 (${new Date(pendingUntil).toISOString()})`,
          }));
        }
      }
    }

    if (externalActive && toBool(process.env.BINANCE_NATIVE_PROTECTION_ENABLED, true)) {
      let openOrders = [];
      let algoOrders = [];
      let algoEndpointUnavailable = false;
      try {
        const fetchedOpenOrders = await fetchFuturesOpenOrders({ ...keys, symbol: sym });
        openOrders = Array.isArray(fetchedOpenOrders) ? fetchedOpenOrders : [];
      } catch (e) {
        marketIssues.push(makeIssue({
          symbol: sym,
          code: "NATIVE_ORDER_FETCH_FAIL",
          severity: "WARN",
          detail: e && e.message ? e.message : String(e),
        }));
      }
      try {
        const fetchedAlgoOrders = await fetchFuturesAlgoOpenOrders({ ...keys, symbol: sym });
        const normalized = normalizeAlgoOrderFetchResult(fetchedAlgoOrders);
        algoOrders = normalized.orders;
        algoEndpointUnavailable = normalized.endpointUnavailable === true;
        if (algoEndpointUnavailable) {
          const metaTracked = hasTrackedNativeProtectionMeta(meta);
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE",
            severity: "WARN",
            detail: metaTracked
              ? "Binance algo 주문 조회를 사용할 수 없어 메타 기준 보호주문만 확인함"
              : "Binance algo 주문 조회를 사용할 수 없어 보호주문 실존을 완전 검증하지 못함",
          }));
        }
      } catch (e) {
        marketIssues.push(makeIssue({
          symbol: sym,
          code: "NATIVE_ALGO_ORDER_FETCH_FAIL",
          severity: "WARN",
          detail: e && e.message ? e.message : String(e),
        }));
      }
      const allOrders = [...openOrders, ...algoOrders];
      if (algoEndpointUnavailable) {
        // Algo 조회가 불가하면 네이티브 보호주문 누락/불일치를 엄격 판정하지 않는다.
      } else if (!allOrders.length) {
        marketIssues.push(makeIssue({
          symbol: sym,
          code: "NATIVE_ORDER_MISSING",
          severity: "CRIT",
          detail: "실포지션은 있는데 Binance 보호주문이 없음",
        }));
      } else {
        const closeSide = resolveCloseSide(externalSide);
        const stopCandidates = allOrders.filter((o) => {
          const type = normalizeOrderType(o);
          const side = String(o && o.side || "").toUpperCase();
          const reduceOnly = toBool(o && o.reduceOnly, false);
          const closePosition = toBool(o && o.closePosition, false);
          return (type === "STOP_MARKET" || type === "STOP") && side === closeSide && (reduceOnly || closePosition);
        });
        if (!stopCandidates.length) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "NATIVE_SL_MISSING",
            severity: "CRIT",
            detail: "실포지션은 있는데 Binance 보호주문 STOP이 없음",
          }));
        } else if (rules && entryPrice && leverage) {
          const meta = (internal && typeof internal.meta === "object") ? internal.meta : {};
          const expectedStop = resolveExpectedNativeTrigger({
            meta: meta.native_protection_stop_price,
            fallbackExpected: computeExpectedNativeStopPx({ positionSide: externalSide, entryPrice, leverage, rules }),
          });
          const info = await fetchFuturesExchangeInfo(sym).catch(() => null);
          const tickSize = Number(info && info.tickSize);
          const stopPx = normalizeOrderTriggerPrice(stopCandidates[0]);
          if (Number.isFinite(expectedStop) && Number.isFinite(stopPx)) {
            const tolerance = Number.isFinite(tickSize) && tickSize > 0 ? tickSize * 2 : Math.abs(expectedStop) * 0.0002;
            if (Math.abs(stopPx - expectedStop) > tolerance) {
              marketIssues.push(makeIssue({
                symbol: sym,
                code: "NATIVE_SL_TRIGGER_MISMATCH",
                severity: "CRIT",
                detail: `기대=${expectedStop.toFixed(6)}, 실제=${stopPx.toFixed(6)}`,
              }));
            }
          }
        }

        const meta = (internal && typeof internal.meta === "object") ? internal.meta : {};
        const tp1Done = meta.tp_p1_done === true || meta.trail_active === true || meta.tp_p1_pending === true;
        if (!tp1Done && toBool(process.env.BINANCE_NATIVE_TP_ENABLED, false)) {
          const tpCandidates = allOrders.filter((o) => {
            const type = normalizeOrderType(o);
            const side = String(o && o.side || "").toUpperCase();
            const reduceOnly = toBool(o && o.reduceOnly, false);
            const closePosition = toBool(o && o.closePosition, false);
            return (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT") && side === closeSide && (reduceOnly || closePosition);
          });
          if (!tpCandidates.length) {
            marketIssues.push(makeIssue({
              symbol: sym,
              code: "NATIVE_TP1_MISSING",
              severity: "CRIT",
              detail: "실포지션은 있는데 Binance 보호주문 TP1이 없음",
            }));
          } else if (rules && entryPrice && leverage) {
            const expectedTp = resolveExpectedNativeTrigger({
              meta: meta.native_protection_tp_price,
              fallbackExpected: computeExpectedNativeTpPx({ positionSide: externalSide, entryPrice, leverage, rules }),
            });
            const info = await fetchFuturesExchangeInfo(sym).catch(() => null);
            const tickSize = Number(info && info.tickSize);
            const tpPx = normalizeOrderTriggerPrice(tpCandidates[0]);
            if (Number.isFinite(expectedTp) && Number.isFinite(tpPx)) {
              const tolerance = Number.isFinite(tickSize) && tickSize > 0 ? tickSize * 2 : Math.abs(expectedTp) * 0.0002;
              if (Math.abs(tpPx - expectedTp) > tolerance) {
                marketIssues.push(makeIssue({
                  symbol: sym,
                  code: "NATIVE_TP1_TRIGGER_MISMATCH",
                  severity: "CRIT",
                  detail: `기대=${expectedTp.toFixed(6)}, 실제=${tpPx.toFixed(6)}`,
                }));
              }
            }
          }
        }
      }
    }

    issues.push(...marketIssues);
    markets.push({
      symbol: sym,
      internal_active: internalActive,
      external_active: externalActive,
      internal_side: internalSide || null,
      external_side: externalSide || null,
      issue_count: marketIssues.length,
      issues: marketIssues,
    });
  }

  return {
    ok: issues.length === 0,
    exchange: "BINANCEFUT",
    updated_at: nowIso(),
    issue_count: issues.length,
    active_market_count: markets.filter((m) => m.internal_active || m.external_active).length,
    market_count: markets.length,
    issues,
    markets,
  };
}

module.exports = {
  auditBinanceExitIntegrity,
  __test: {
    normalizeAlgoOrderFetchResult,
    hasTrackedNativeProtectionMeta,
    normalizeOrderType,
    normalizeOrderTriggerPrice,
    resolveExpectedNativeTrigger,
  },
};
