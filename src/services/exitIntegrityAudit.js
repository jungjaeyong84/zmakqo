const {
  fetchBinanceFuturesAccount,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesExchangeInfo,
  __test: binancePrivateTest,
} = require("../exchanges/binanceFuturesPrivate");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv, normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { getPositionRuntimeObservation, resolveTrailObservationSnapshot } = require("../storage/positionRuntimeObservations");
const { listExchangePositionReadViews } = require("./positionReadModel");
const { resolveExitRulesForPosition } = require("../engine/signalEngine");
const { normalizePositionSide, resolveCloseSide, resolvePositionSideFromPosition } = require("../utils/positionSide");
const { updateAlgoEndpointDegradationState } = require("../v2/algoEndpointDegradationState");
const {
  DEFAULT_TP1_TARGET_PCT: SIMPLIFIED_EXIT_V2_TP1_TARGET_PCT,
  isSimplifiedExitV2Active,
} = require("./simplifiedExitV2");

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

function computeExpectedNativeTpPx({ positionSide, entryPrice, leverage, rules, simplifiedExitV2Active = false } = {}) {
  const side = normalizePositionSide(positionSide);
  const entry = Number(entryPrice);
  const lev = Number(leverage);
  // simplifiedExitV2 places TP1 at the policy default (1.68%) regardless of the
  // resolved cohort's TP_P1 (which can be the RESCUE 1.65% safety floor). Using
  // rules.TP_P1 here would emit NATIVE_TP1_TRIGGER_MISMATCH on every active V2
  // position. The expected price must match the order the writer actually placed.
  const tpPolicy = simplifiedExitV2Active === true
    ? SIMPLIFIED_EXIT_V2_TP1_TARGET_PCT
    : Math.abs(Number(rules && rules.TP_P1));
  const tp = Math.abs(Number(tpPolicy));
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

function normalizeOrderId(order) {
  return String(order && (order.orderId || order.order_id || order.algoId || order.algo_id) || "").trim() || null;
}

function normalizeOrderQuantity(order) {
  return toNum(order && (
    order.origQty
    ?? order.orig_qty
    ?? order.quantity
    ?? order.qty
    ?? order.executedQty
    ?? order.executed_qty
  ));
}

function decimalPlacesFromStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const raw = String(step == null ? "" : step).trim();
  if (raw && !/[eE]/.test(raw)) {
    const idx = raw.indexOf(".");
    if (idx === -1) return 0;
    return raw.slice(idx + 1).replace(/0+$/, "").length;
  }
  for (let p = 0; p <= 12; p += 1) {
    const scaled = n * Math.pow(10, p);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-8) return p;
  }
  return 10;
}

function floorToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(s) || s <= 0) return null;
  const precision = decimalPlacesFromStep(s);
  const units = Math.floor((v + (s * 1e-12)) / s);
  const floored = units * s;
  return Number(floored.toFixed(Math.max(0, Math.min(12, precision))));
}

function normalizeExpectedTp1QuantityForExchangeInfo(expectedQty, info = null) {
  const qty = Number(expectedQty);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  const normalized = floorToStep(qty, info && info.stepSize);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : qty;
}

function isStrictTp1OrderCandidate(order, closeSide) {
  const type = normalizeOrderType(order);
  const side = String(order && order.side || "").toUpperCase();
  const reduceOnly = toBool(order && order.reduceOnly, false);
  const closePosition = toBool(order && order.closePosition, false);
  return (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT")
    && side === String(closeSide || "").toUpperCase()
    && reduceOnly === true
    && closePosition !== true;
}

function selectNativeTp1OrderCandidate(candidates, expectedOrderId = null) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const trackedId = String(expectedOrderId || "").trim();
  if (trackedId) {
    const matched = rows.find((order) => String(normalizeOrderId(order) || "").trim() === trackedId);
    if (matched) return matched;
  }
  return rows[0] || null;
}

function resolveExpectedNativeTrigger({ meta, fallbackExpected } = {}) {
  const tracked = Number(meta);
  if (Number.isFinite(tracked) && tracked > 0) return tracked;
  return Number.isFinite(Number(fallbackExpected)) ? Number(fallbackExpected) : null;
}

function isV2LiveWriteRuntime(env = process.env) {
  return toBool(env && env.DONBEOLJA_V2_ENABLED, false)
    && toBool(env && env.DONBEOLJA_V2_DRY_RUN, false) !== true
    && toBool(env && env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, false) === true;
}

// 2026-04-19 PR #12: same-class boundary-value guard.  trail watermark
// 은 양수 finite 일 때만 "유효 기준값" 으로 인정한다.  `Number(null)===0`
// 과 `Number.isFinite(0)===true` 조합이 trailRef=0 을 valid 로 오인해
// TP1_TRAIL_REF_MISSING 발화를 silently skip 하던 blind spot 을 이 이름
// 붙은 guard 로 잠근다.  PR #8/#10/#11 과 동일한 계약.
function isValidTrailReference(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function hasTrackedNativeProtectionMeta(meta) {
  const ctx = meta && typeof meta === "object" ? meta : {};
  const stopOrderId = String(ctx.native_protection_stop_order_id || "").trim();
  const tpOrderId = String(ctx.native_protection_tp_order_id || "").trim();
  const refreshStatus = String(ctx.native_protection_refresh_status || "").toUpperCase();
  const tpStatus = String(ctx.native_protection_tp_status || "").toUpperCase();
  return !!(stopOrderId || tpOrderId || refreshStatus === "OK" || tpStatus === "OK");
}

function resolveTp1PendingState(meta = {}, nowMs = Date.now()) {
  const ctx = meta && typeof meta === "object" ? meta : {};
  if (ctx.tp_p1_pending !== true) {
    return { pending: false, fresh: false, expired: false, unbounded: false, pending_until_ms: null };
  }
  const pendingUntil = Number(ctx.tp_p1_pending_until_ms);
  if (!Number.isFinite(pendingUntil) || pendingUntil <= 0) {
    return { pending: true, fresh: false, expired: false, unbounded: true, pending_until_ms: null };
  }
  const now = Number(nowMs);
  const expired = Number.isFinite(now) && pendingUntil < now;
  return {
    pending: true,
    fresh: !expired,
    expired,
    unbounded: false,
    pending_until_ms: pendingUntil,
  };
}

function shouldVerifyNativeTp1Protection(meta = {}, nowMs = Date.now()) {
  const ctx = meta && typeof meta === "object" ? meta : {};
  const pendingState = resolveTp1PendingState(ctx, nowMs);
  return !(ctx.tp_p1_done === true || ctx.trail_active === true || pendingState.fresh === true);
}

async function auditBinanceExitIntegrity({ symbols, includeFlat = false, db = null, env = process.env } = {}) {
  const runtimeEnv = env && typeof env === "object" ? env : process.env;
  const keys = await resolveBinanceKeys();
  if (!keys) return { ok: false, reason: "BINANCE_KEYS_MISSING", updated_at: nowIso(), issues: [], markets: [] };

  const baseMarkets = Array.isArray(symbols) && symbols.length
    ? symbols.map((s) => normalizeMarketSymbolForProvider(s, "BINANCEFUT")).filter(Boolean)
    : defaultMarketsFromEnv("BINANCEFUT");

  const [account, readPositions] = await Promise.all([
    fetchBinanceFuturesAccount({ ...keys }),
    listExchangePositionReadViews({ exchange: "BINANCEFUT" }).catch(() => []),
  ]);

  const externalPositions = new Map();
  for (const raw of Array.isArray(account && account.positions) ? account.positions : []) {
    const symbol = normalizeMarketSymbolForProvider(raw && raw.symbol, "BINANCEFUT");
    const amt = Number(raw && raw.positionAmt);
    if (!symbol || !Number.isFinite(amt) || amt === 0) continue;
    externalPositions.set(symbol, raw);
  }

  const internalPositions = new Map();
  for (const data of readPositions) {
    const symbol = normalizeMarketSymbolForProvider(data.symbol_or_pair_id || data.symbol, "BINANCEFUT");
    if (!symbol) continue;
    internalPositions.set(symbol, data);
  }

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
    let algoEndpointDegradation = null;
    let algoEndpointUnavailableObserved = false;
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
        // 2026-04-19 PR #12: `isValidTrailReference` 는 `Number(null)===0`
        // 과 `Number.isFinite(0)===true` 조합이 trailRef=0 을 valid 로
        // 오인해 TP1_TRAIL_REF_MISSING 발화를 silently skip 하던 blind
        // spot 을 막는다.  writer schema (PR #10) 가 0 을 차단하지만 (a)
        // warn-only 과도기, (b) 과거 Firestore 잔류값까지 여기서 다시
        // 방어.
        const trailRefRaw = internalSide === "SHORT"
          ? trailSnapshot.trail_low
          : trailSnapshot.trail_high;
        if (meta.trail_active !== true) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_TRAIL_INACTIVE",
            severity: "CRIT",
            detail: "TP1 완료인데 trail_active=false",
          }));
        }
        if (!isValidTrailReference(trailRefRaw)) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_TRAIL_REF_MISSING",
            severity: "CRIT",
            detail: "TP1 완료인데 trail 기준값이 없음 (null/0/비양수 포함)",
          }));
        }
      }

      const tp1PendingState = resolveTp1PendingState(meta);
      if (tp1PendingState.pending === true) {
        if (tp1PendingState.expired === true) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_PENDING_EXPIRED_STILL_PENDING",
            severity: "CRIT",
            detail: `TP1 pending 만료 후에도 pending — 보호주문 부재 가능 (${new Date(tp1PendingState.pending_until_ms).toISOString()})`,
          }));
        } else if (tp1PendingState.unbounded === true) {
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "TP1_PENDING_UNBOUNDED",
            severity: "CRIT",
            detail: "TP1 pending=true 이지만 pending_until_ms가 없어 TP1 누락을 숨길 수 있음",
          }));
        }
      }
    }

    if (externalActive && toBool(runtimeEnv.BINANCE_NATIVE_PROTECTION_ENABLED, true)) {
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
        algoEndpointUnavailableObserved = algoEndpointUnavailable;
        if (algoEndpointUnavailable) {
          try {
            algoEndpointDegradation = await updateAlgoEndpointDegradationState({
              db,
              env: runtimeEnv,
              exchange: "BINANCEFUT",
              symbol: sym,
              endpointUnavailable: true,
              note: normalized.note || "ALGO_ENDPOINT_UNAVAILABLE",
            });
          } catch (stateError) {
            algoEndpointDegradation = {
              ok: false,
              status: "STATE_UPDATE_FAILED",
              reason: stateError && stateError.message ? stateError.message : String(stateError),
              duration_ms: 0,
              escalated: false,
            };
          }
          const metaTracked = hasTrackedNativeProtectionMeta(meta);
          const stateSeverity = String(algoEndpointDegradation && algoEndpointDegradation.severity || "WARN").toUpperCase();
          const severity = isV2LiveWriteRuntime(runtimeEnv) || stateSeverity === "CRIT" ? "CRIT" : "WARN";
          marketIssues.push(makeIssue({
            symbol: sym,
            code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE",
            severity,
            detail: metaTracked
              ? "Binance algo 주문 조회를 사용할 수 없어 메타 기준 보호주문만 확인함"
              : "Binance algo 주문 조회를 사용할 수 없어 보호주문 실존을 완전 검증하지 못함",
            meta: {
              first_seen_at: algoEndpointDegradation && algoEndpointDegradation.first_seen_at || null,
              duration_ms: Number(algoEndpointDegradation && algoEndpointDegradation.duration_ms) || 0,
              crit_after_ms: Number(algoEndpointDegradation && algoEndpointDegradation.crit_after_ms) || null,
              escalated: algoEndpointDegradation && algoEndpointDegradation.escalated === true,
              state_status: algoEndpointDegradation && algoEndpointDegradation.status || null,
              state_reason: algoEndpointDegradation && algoEndpointDegradation.reason || null,
            },
          }));
        } else {
          try {
            algoEndpointDegradation = await updateAlgoEndpointDegradationState({
              db,
              env: runtimeEnv,
              exchange: "BINANCEFUT",
              symbol: sym,
              endpointUnavailable: false,
            });
          } catch (stateError) {
            algoEndpointDegradation = {
              ok: false,
              status: "STATE_RECOVERY_UPDATE_FAILED",
              reason: stateError && stateError.message ? stateError.message : String(stateError),
            };
          }
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
        if (shouldVerifyNativeTp1Protection(meta) && toBool(runtimeEnv.BINANCE_NATIVE_TP_ENABLED, false)) {
          const tpCandidates = allOrders.filter((o) => isStrictTp1OrderCandidate(o, closeSide));
          if (!tpCandidates.length) {
            marketIssues.push(makeIssue({
              symbol: sym,
              code: "NATIVE_TP1_MISSING",
              severity: "CRIT",
              detail: "실포지션은 있는데 Binance 보호주문 TP1이 없음",
            }));
          } else {
            const expectedTpOrderId = String(meta.native_protection_tp_order_id || "").trim() || null;
            const tpOrder = selectNativeTp1OrderCandidate(tpCandidates, expectedTpOrderId);
            const actualTpOrderId = normalizeOrderId(tpOrder);
            if (expectedTpOrderId && actualTpOrderId && String(expectedTpOrderId) !== String(actualTpOrderId)) {
              marketIssues.push(makeIssue({
                symbol: sym,
                code: "NATIVE_TP1_ORDER_ID_MISMATCH",
                severity: "CRIT",
                detail: `기대=${expectedTpOrderId}, 실제=${actualTpOrderId}`,
              }));
            }
            const expectedQty = toNum(meta.tp1_target_qty_abs)
              ?? toNum(meta.tp_p1_target_qty_abs)
              ?? toNum(meta.simplified_exit_v2_shadow && meta.simplified_exit_v2_shadow.tp1_target_qty_abs);
            const actualQty = normalizeOrderQuantity(tpOrder);
            if (Number.isFinite(expectedQty) && expectedQty > 0 && Number.isFinite(actualQty) && actualQty > 0) {
              const info = await fetchFuturesExchangeInfo(sym).catch(() => null);
              const normalizedExpectedQty = normalizeExpectedTp1QuantityForExchangeInfo(expectedQty, info);
              const compareQty = Number.isFinite(normalizedExpectedQty) && normalizedExpectedQty > 0
                ? normalizedExpectedQty
                : expectedQty;
              const tolerance = Math.max(1e-9, Math.abs(compareQty) * 0.005);
              if (Math.abs(actualQty - compareQty) > tolerance) {
                marketIssues.push(makeIssue({
                  symbol: sym,
                  code: "NATIVE_TP1_QTY_MISMATCH",
                  severity: "CRIT",
                  detail: `기대=${compareQty}, 실제=${actualQty}`,
                  meta: {
                    raw_expected_qty: expectedQty,
                    normalized_expected_qty: compareQty,
                    step_size: Number(info && info.stepSize) || null,
                  },
                }));
              }
            }
          }
          if (rules && entryPrice && leverage && tpCandidates.length) {
            const expectedTp = resolveExpectedNativeTrigger({
              meta: meta.native_protection_tp_price,
              fallbackExpected: computeExpectedNativeTpPx({
                positionSide: externalSide,
                entryPrice,
                leverage,
                rules,
                simplifiedExitV2Active: isSimplifiedExitV2Active(internal),
              }),
            });
            const info = await fetchFuturesExchangeInfo(sym).catch(() => null);
            const tickSize = Number(info && info.tickSize);
            const tpOrder = selectNativeTp1OrderCandidate(tpCandidates, meta.native_protection_tp_order_id);
            const tpPx = normalizeOrderTriggerPrice(tpOrder);
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
      algo_endpoint_unavailable: algoEndpointUnavailableObserved,
      algo_endpoint_degradation: algoEndpointDegradation ? {
        ok: algoEndpointDegradation.ok === true,
        status: algoEndpointDegradation.status || null,
        first_seen_at: algoEndpointDegradation.first_seen_at || null,
        duration_ms: Number(algoEndpointDegradation.duration_ms) || 0,
        escalated: algoEndpointDegradation.escalated === true,
        recovered: algoEndpointDegradation.recovered === true,
      } : null,
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
    normalizeOrderId,
    normalizeOrderQuantity,
    normalizeExpectedTp1QuantityForExchangeInfo,
    isStrictTp1OrderCandidate,
    selectNativeTp1OrderCandidate,
    isV2LiveWriteRuntime,
    resolveExpectedNativeTrigger,
    isValidTrailReference,
    resolveTp1PendingState,
    shouldVerifyNativeTp1Protection,
    computeExpectedNativeTpPx,
    computeExpectedNativeStopPx,
  },
};
