"use strict";

const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const os = require("os");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { tfToMs } = require("../utils/marketConfig");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const {
  getPositionRuntimeObservation,
  upsertTrailObservation,
  resolveTrailObservationSnapshot,
} = require("../storage/positionRuntimeObservations");
const { getPosition } = require("../storage/positions");
const { clearTpP1PendingIfUnchanged } = require("../storage/positionsPaper");
const { upsertIntent, markIntentStatus } = require("../storage/orderIntentsPaper");
const { upsertExitOrderContract } = require("../storage/exitOrderContracts");
const { resolveExitRulesForPosition, computeRunnerExitStopPrice, resolveTrailDelayState, resolveTpP0Pct } = require("../engine/signalEngine");
const {
  runPaperMarket,
  resolveLiveFuturesConfig,
  refreshBinanceNativeProtectionWithRetry,
  syncFuturesPositionOnly,
} = require("../engine/paperBinanceRunner");
const { resolveCloseSide, resolvePositionSideFromPosition } = require("../utils/positionSide");
const {
  getFuturesBaseUrl,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesOrder,
  fetchFuturesAlgoOrder,
  placeFuturesMarketOrder,
  fetchFuturesExchangeInfo,
  fetchBinanceFuturesAccount,
  __test: binancePrivateTest,
} = require("../exchanges/binanceFuturesPrivate");
const { sendAlert } = require("../utils/alerts");
const { runActionPreHooks, runActionPostHooks, emitActionEvent } = require("../utils/actionExecutionHooks");
const { auditBinanceExitIntegrity } = require("./exitIntegrityAudit");
const { runBinanceLiveStateSelfHeal } = require("./binanceLiveStateSelfHeal");
const { BINANCE_NATIVE_STOP_WRITER_SOURCE } = require("../utils/binanceNativeProtectionWriter");
const {
  withTransientFirestoreRetry,
  isTransientFirestoreError,
} = require("../utils/firestoreRetry");
const { recordExitRepairRequest } = require("../storage/exitRepairRequests");
const { triggerExitWorkerRun } = require("./exitWorkerClient");
const { getPositionReadView, getPositionReadViewsBySymbols } = require("./positionReadModel");
const { resolveCanonicalPositionExitStage } = require("./positionStateMachine");
const { loadOperationalGuardRuntime } = require("./operationalGuardRuntime");
const { loadSystemSloRuntime } = require("./systemSloRuntime");
const { loadSystemAnomalyRuntime } = require("./systemAnomalyRuntime");
const {
  loadTrailAuthorityRuntime,
  publishTrailAuthorityState,
  recordTrailRuntimeEvent,
} = require("./trailAuthorityRuntime");
const {
  isSimplifiedExitV2Active,
  resolveSimplifiedExitV2FlagFromSnapshot,
} = require("./simplifiedExitV2");
const { writeOpenClawShadowTrailActivation } = require("../v2/openclawShadowExitWriter");
const { buildV2DirectExitDispatch } = require("./v2DirectExitDispatch");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BINANCE_TICK_EXIT_AUDIT_PATH = path.join(REPO_ROOT, "ops", "runtime", "binance_tick_exit_audit.jsonl");
const TICK_EXIT_AUDIT_EVENTS = new Set([
  "tick_exit_tp1_native_gap_fail_closed",
  "tick_exit_tp1_meta_sync_fail_closed",
  // 2026-04-18: BE-raise diagnostic events. We persist these to the audit
  // file so post-mortems on "why didn't the stop move after TP1?" can be
  // performed by grepping the audit jsonl directly, in addition to the
  // console.log copy that lands in Cloud Logging. Emitted on every tick
  // where a position has tp_p1_done=true — volume is bounded by the number
  // of active TP1-done positions × tick interval.
  "tick_exit_tp1_break_even_stop_decision",
  "tick_exit_tp1_break_even_stop_raised",
  "tick_exit_tp1_break_even_stop_error",
]);

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function normalizeIntervalMs(raw, fallback) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1000, Math.round(n));
}

function normalizeTargetSymbols(targetSymbols = null) {
  const list = Array.isArray(targetSymbols)
    ? targetSymbols
    : (targetSymbols == null ? [] : [targetSymbols]);
  return Array.from(new Set(
    list
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function resolveTickExitSymbolsToCheck({ exCfg, targetSymbols = null } = {}) {
  const configuredSymbols = Array.from(new Set(
    (Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [])
      .map((symbol) => String(symbol || "").trim().toUpperCase())
      .filter(Boolean)
  ));
  const requestedSymbols = normalizeTargetSymbols(targetSymbols);
  if (!requestedSymbols.length) return configuredSymbols;
  if (!configuredSymbols.length) return requestedSymbols;
  const configuredSet = new Set(configuredSymbols);
  return requestedSymbols.filter((symbol) => configuredSet.has(symbol));
}

function alignCurrentBarCloseLocal(ms, tfMs) {
  const now = Number(ms);
  const size = Number(tfMs);
  if (!Number.isFinite(now) || !Number.isFinite(size) || size <= 0) return null;
  return Math.floor(now / size) * size;
}

function ratioToPctTokenLocal(ratio) {
  const n = Math.abs(Number(ratio));
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round(n * 10000) / 100;
  return String(pct).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function isSimplifiedExitV2Position(position = null) {
  const pos = position && typeof position === "object" ? position : {};
  return isSimplifiedExitV2Active(pos);
}

function isExplicitLegacyTp0Position(position = null) {
  const pos = position && typeof position === "object" ? position : {};
  return resolveSimplifiedExitV2FlagFromSnapshot(pos) === false
    && isSimplifiedExitV2Active(pos) !== true;
}

function resolveCanonicalExitStageForPosition(position) {
  const pos = position && typeof position === "object" ? position : null;
  const simplifiedExitV2Enabled = isSimplifiedExitV2Position(pos);
  const canonical = resolveCanonicalPositionExitStage({
    positionSnapshot: pos,
    simplifiedExitV2Enabled,
  });
  return canonical && canonical.stage ? canonical.stage : null;
}

function hasCanonicalTpP1Reached(stage) {
  const normalized = String(stage || "").trim().toUpperCase();
  return normalized === "TP1" || normalized === "TRAIL";
}

function isCanonicalTrailStage(stage) {
  return String(stage || "").trim().toUpperCase() === "TRAIL";
}

function resolveRunnerStageState(position = null) {
  const canonicalStage = resolveCanonicalExitStageForPosition(position);
  return {
    canonicalStage,
    tpP1Done: hasCanonicalTpP1Reached(canonicalStage),
    trailStage: isCanonicalTrailStage(canonicalStage),
  };
}

// 2026-04-19 ROOT-CAUSE (trail bootstrap jam):
// SHORT 포지션의 `meta.trail_low` 가 `0` 으로 저장된 실사례(BTCUSDT)에서
// `Number(0) === 0` + `Number.isFinite(0) === true` 가 겹쳐, 과거의
// `!Number.isFinite(prevLow) || price < prevLow` 가드가 `price < 0` 로
// 축약되었다. 거래 가격은 항상 양수이므로 한 번 `0` 이 박히면 영영
// `_trailPatch` 가 만들어지지 않고, 아래 `refreshBinanceTickExitNativeProtection`
// 호출 경로에 진입조차 하지 못한다 (Cloud Logging 6h 창에서
// `tick_exit_trail_updated` 이벤트 0건이 smoking gun). LONG 쪽도
// `trail_high === 0` 이 저장되면 대칭적으로 잠길 위험이 있어 양쪽 모두
// "유효 watermark = finite AND > 0" 으로 정규화한다. 가격은 양수라는
// 도메인 가정과 정렬된다.
//
// Returns `null` 이면 이번 tick 에서 watermark 개선이 없거나 side 가
// 유효하지 않음 → 호출부는 refresh 경로를 건너뛴다. 반대로 patch 객체를
// 돌려주면 호출부는 Firestore patch + in-memory meta 갱신 + native stop
// refresh 를 순서대로 수행한다.
function computeTrailWatermarkPatch({ side, meta, price, tickNow } = {}) {
  const tickSide = String(side || "").trim().toUpperCase();
  const mm = (meta && typeof meta === "object") ? meta : {};
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(tickNow)) return null;
  if (tickSide === "LONG") {
    const prevHigh = Number(mm.trail_high);
    const hasValidPrev = Number.isFinite(prevHigh) && prevHigh > 0;
    if (!hasValidPrev || price > prevHigh) {
      return {
        patch: { "meta.trail_high": price, "meta.trail_high_at_ms": tickNow },
        field: "trail_high",
        next: price,
        prev: hasValidPrev ? prevHigh : null,
      };
    }
    return null;
  }
  if (tickSide === "SHORT") {
    const prevLow = Number(mm.trail_low);
    const hasValidPrev = Number.isFinite(prevLow) && prevLow > 0;
    if (!hasValidPrev || price < prevLow) {
      return {
        patch: { "meta.trail_low": price, "meta.trail_low_at_ms": tickNow },
        field: "trail_low",
        next: price,
        prev: hasValidPrev ? prevLow : null,
      };
    }
    return null;
  }
  return null;
}

// 2026-04-19 REFACTOR (progressive pure-helper extraction):
//
// BE-raise 결정의 "순수 계산" 부분을 호출부 (`runTickExitBurst` 내
// `if (_tpP1Done)` 블록)에서 분리한다. 이 함수는 I/O 를 하지 않으며
// Firestore / Binance / cooldown global state 를 건드리지 않는다.
// 책임 범위:
//   • side / avgPrice / leverage / floorPct / currentStop 입력의 유효성 판정
//   • BE 목표가 `bePrice` 계산 (RUNNER_MIN_PROFIT_PCT 기반)
//   • `shouldRaiseStop` 판정 (LONG: bePrice > currentStop, SHORT: 반대)
//
// 책임 외:
//   • cooldown (`shouldRunNativeProtectionRefreshCooldown`) — symbolCooldown 전역
//     state 에 의존하므로 호출부 유지
//   • `refreshBinanceTickExitNativeProtection` 호출 (Firestore + Binance)
//   • 로그 출력
//
// 단위 테스트 포인트:
//   • inputs_valid 불변식 (네 수치 입력 모두 finite && > 0, side ∈ LONG/SHORT)
//   • LONG/SHORT 대칭 bePrice 공식
//   • currentStop 이 NaN(=미보호 상태) 이면 무조건 raise
//   • `currentStop <= 0` (Number(null)===0 포함) 은 NaN 과 동치로 "미보호"
//     취급 — PR #9 pin 해소, PR #11
//   • `±1e-9` 허용오차 한계 (동일 가격 재-raise 금지)
//
// 2026-04-19 PR #11 ROOT-CAUSE FIX (null-stop unprotected-equivalence):
//
// 이전 구현은 `Number(null) === 0` 이 `Number.isFinite(0) === true` 로
// 평가되는 탓에 `meta.native_protection_stop_price === null` 이
// downstream 에서 `stop = 0` 으로 전락했다. 그러면 SHORT 에서
// `bePrice < 0 - 1e-9` 가 영영 false 라 raise 가 skip 된다.
//
// 의미론적으로 `stop <= 0` 은 "보호 stop 이 없다" 와 등가이므로
// `Number.isFinite(stop) && stop > 0` 이 아닌 값은 일괄 NaN 으로
// coerce 해 기존의 `!Number.isFinite(stop) → 무조건 raise` 가드로
// 자연스럽게 빠지게 한다. 한 줄 변경이지만 PR #9 가 pin 했던 경계값
// 버그를 root 에서 제거한다. PR #10 의 writer-side schema 는 `0` 이
// meta 에 쓰이는 경로를 warn-only 로 막고 있지만, 이 read-side 보정은
// (a) schema 가 dev/CI throw 로 cutover 되기 전까지의 과도기, (b) 과거
// Firestore 잔류값 (`meta.native_protection_stop_price: 0`) 에 대한
// 방어까지 함께 처리한다.
function computeBreakEvenRaiseDecision({
  side,
  avgPrice,
  leverage,
  floorPct,
  currentStop,
} = {}) {
  const s = String(side || "").trim().toUpperCase();
  const avg = Number(avgPrice);
  const lev = Number(leverage);
  const floor = Number(floorPct);
  const stopRaw = Number(currentStop);
  // "미보호" semantic: finite 하고 양수일 때만 실제 stop 으로 취급한다.
  // 그 외 (NaN / Infinity / 0 / 음수 / null→0 / undefined→NaN) 은 NaN
  // 으로 정규화해 downstream `!Number.isFinite` 가드가 무조건 raise 로
  // 결정하도록 만든다.
  const stop = Number.isFinite(stopRaw) && stopRaw > 0 ? stopRaw : NaN;
  const avgFinite = Number.isFinite(avg) && avg > 0;
  const levFinite = Number.isFinite(lev) && lev > 0;
  const floorFinite = Number.isFinite(floor) && floor > 0;
  const sideValid = (s === "LONG" || s === "SHORT");
  const inputsValid = avgFinite && levFinite && floorFinite && sideValid;
  const bePrice = inputsValid
    ? (s === "SHORT"
      ? avg * (1 - (floor / lev))
      : avg * (1 + (floor / lev)))
    : null;
  const shouldRaiseStop = inputsValid && (
    !Number.isFinite(stop)
    || (s === "LONG" && bePrice > stop + 1e-9)
    || (s === "SHORT" && bePrice < stop - 1e-9)
  );
  return {
    side: sideValid ? s : null,
    avg: avgFinite ? avg : null,
    leverage: levFinite ? lev : null,
    floorPct: floorFinite ? floor : null,
    currentStop: Number.isFinite(stop) ? stop : null,
    inputsValid,
    bePrice,
    shouldRaiseStop,
  };
}

// 2026-04-18 P0-1 (audit re-verified): build observability fields for
// `tick_exit_tp1_break_even_stop_{raised,decision}` from a refresh result.
// The historical `refresh_ok` flag flipped to true on Binance order
// placement alone, even when the subsequent
// `syncFuturesPositionOnly`/`syncNativeProtectionMetaAfterRefresh` steps
// failed — so a log line claiming `refresh_ok: true` could coexist with
// `refresh_status: MISSING` on the reconciler and actually-unprotected
// exchange state. `refresh_synced_ok` is the composite dashboards should
// read: it ANDs placement + post-refresh Firestore sync + meta sync. The
// individual `*_ok`/`*_error` fields let operators localize which step
// failed when the composite flips false.
function buildBreakEvenStopRefreshObservability(refreshResult = null) {
  const hasResult = refreshResult && typeof refreshResult === "object";
  const placementOk = !!(hasResult && refreshResult.ok === true);
  const syncOk = hasResult ? refreshResult.sync_after_refresh_ok === true : null;
  const metaOk = hasResult ? refreshResult.meta_after_refresh_ok === true : null;
  const syncedOk = hasResult ? (placementOk && syncOk === true && metaOk === true) : null;
  const asTrimmedStringOrNull = (v) => {
    if (v == null) return null;
    const s = String(v);
    return s ? s.slice(0, 200) : null;
  };
  return {
    refresh_ok: hasResult ? placementOk : null,
    refresh_reason: hasResult && refreshResult.reason ? String(refreshResult.reason) : null,
    refresh_synced_ok: syncedOk,
    sync_after_refresh_ok: syncOk,
    sync_after_refresh_error: asTrimmedStringOrNull(hasResult ? refreshResult.sync_after_refresh_error : null),
    meta_after_refresh_ok: metaOk,
    meta_after_refresh_error: asTrimmedStringOrNull(hasResult ? refreshResult.meta_after_refresh_error : null),
    observed_stop_order_id: hasResult && refreshResult.stop_order_id
      ? String(refreshResult.stop_order_id)
      : null,
  };
}

function shouldTriggerTrailHardExit({
  position,
  price,
  side,
  rules,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const runnerStage = resolveRunnerStageState(pos);
  if (runnerStage.tpP1Done !== true) {
    return { trigger: false, reason: "NOT_RUNNER_STAGE" };
  }
  const avg = Number(pos && pos.avg_price);
  const leverageEff = Number(meta.external_leverage || meta.leverage || pos.leverage || 1);
  const runnerExit = computeRunnerExitStopPrice({
      avg,
      leverageEff,
      side,
      rules,
      tpP1Done: runnerStage.tpP1Done,
      trailActive: runnerStage.trailStage,
      trailHigh: Number(meta.trail_high),
      trailLow: Number(meta.trail_low),
      entryRDistance: Number(meta.entry_r_distance),
    });
  const stopPrice = Number(runnerExit && runnerExit.stopPrice);
  if (!Number.isFinite(price) || !Number.isFinite(stopPrice) || stopPrice <= 0) {
    return { trigger: false, reason: "STOP_UNAVAILABLE", runnerExit };
  }
  const sideUpper = String(side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const crossed = sideUpper === "SHORT" ? (price >= stopPrice) : (price <= stopPrice);
  return {
    trigger: crossed,
    reason: crossed ? "TRAIL_STOP_BREACHED" : "SAFE",
    stopPrice,
    runnerExit,
  };
}

async function runTrailHardExit({
  exchange = "BINANCEFUT",
  symbol,
  position,
  price,
  signalTf,
  execTf,
  hardExit,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const qtyBase = Number(pos && pos.qty_base);
  if (!pos || !Number.isFinite(qtyBase) || qtyBase <= 0) {
    return { ok: false, skipped: true, reason: "NO_ACTIVE_POSITION" };
  }
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) {
    return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const side = resolveCloseSide(resolvePositionSideFromPosition(pos, meta, "LONG"));
  const tfMs = Math.max(60 * 1000, Number(tfToMs(signalTf) || 15 * 60 * 1000));
  const now = Date.now();
  const signalBarCloseMs = alignCurrentBarCloseLocal(now, tfMs) || now;
  const execBarCloseMs = signalBarCloseMs;
  const event = "FORCE_EXIT_ALL";
  const runId = `RUN__TICK_EXIT_HARD_EXIT__${exchange}__${symbol}__${now}`;
  const requestId = `tick_exit_hard_exit_${symbol}_${now}`;
  const pre = await runActionPreHooks({
    action: "TRAIL_HARD_EXIT",
    runId,
    exchange,
    symbol,
    tf: signalTf,
    signalEvent: event,
    decisionReason: "TRAIL_STOP_BREACHED",
    source: "BINANCE_TICK_EXIT",
    executionMode: "LIVE",
    intent: "EXIT",
    qtyPct: 1,
    persist: true,
  });
  const intent = await upsertIntent({
    exchange,
    symbol,
    tf: signalTf,
    signalBarCloseTimeUtc: new Date(signalBarCloseMs).toISOString(),
    signalBarCloseTimeUtcMs: signalBarCloseMs,
    scheduledExecBarCloseUtc: new Date(execBarCloseMs).toISOString(),
    scheduledExecBarCloseUtcMs: execBarCloseMs,
    event,
    side,
    qtyPct: 1,
    qtyFraction: 1,
    reason: "TRAIL_STOP_BREACHED",
    pendingReason: "TRAIL_STOP_BREACHED",
    pendingNote: `stop=${Number(hardExit && hardExit.stopPrice).toFixed(6)} price=${Number(price).toFixed(6)}`,
    executionMode: "LIVE",
    features: {
      _tick_exit_hard_exit: true,
      _trail_stop_price: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
      _trail_stop_source: hardExit && hardExit.runnerExit ? hardExit.runnerExit.stopSource || null : null,
      _observed_price: Number.isFinite(Number(price)) ? Number(price) : null,
      position_side: resolvePositionSideFromPosition(pos, meta, "LONG"),
    },
    runId,
    execTf: execTf || signalTf,
    requestId,
    decisionReason: "TRAIL_STOP_BREACHED",
  });
  const order = await placeFuturesMarketOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side,
    quantity: qtyBase,
    reduceOnly: true,
    idempotencyKey: `${runId}__FORCE_EXIT_ALL`,
  });
  await upsertExitOrderContract({
    exchange,
    symbol,
    orderId: order && order.orderId,
    clientOrderId: order && order.clientOrderId,
    event,
    stage: "FORCE_EXIT_ALL",
    intentId: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
    signalId: intent && intent.signal_id ? intent.signal_id : null,
    signalDocId: intent && intent.signal_doc_id ? intent.signal_doc_id : null,
    positionSide: resolvePositionSideFromPosition(pos, meta, "LONG"),
    closeSide: side,
    expectedQtyBase: qtyBase,
    expectedQtyRatio: 1,
    triggerPrice: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
    triggerSource: hardExit && hardExit.runnerExit ? hardExit.runnerExit.stopSource || null : null,
    reduceOnly: true,
    closePosition: false,
    status: "OPEN",
    source: "TICK_EXIT_HARD_EXIT",
  }).catch(() => null);
  runActionPostHooks({
    envelope: { ...((pre && pre.envelope) || {}), intent_id: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null },
    ok: true,
    reason: "TRAIL_HARD_EXIT_ORDER_PLACED",
    persist: true,
    result: {
      order_id: order && order.orderId ? String(order.orderId) : null,
      qty_base: qtyBase,
      stop_price: Number.isFinite(Number(hardExit && hardExit.stopPrice)) ? Number(hardExit.stopPrice) : null,
      observed_price: Number.isFinite(Number(price)) ? Number(price) : null,
    },
  });
  return {
    ok: true,
    intentId: intent && (intent.intent_id || intent.id) ? (intent.intent_id || intent.id) : null,
    orderId: order && order.orderId ? String(order.orderId) : null,
  };
}

const symbolCooldownState = new Map();
const symbolCooldownLogState = new Map();

// 2026-04-29 — V2 direct exit reduceOnly -2022 detection (diagnostics
// only). The 60 s post-rejection cooldown that was introduced as the
// initial "Issue 4" fix has been retired (R3) — it modelled the bug
// backwards: it reacted to the *symptom* (the rejection) instead of
// preventing the duplicate dispatch from happening. The real fixes:
//   R1 (cf2b8e3b): markExitInFlight on place success → next tick's
//     active filter excludes the symbol until fillSync catches up
//     (or the 30 s TTL safety net expires).
//   R2 (838c43a8): broker truth pre-filter → fetch the broker's
//     positions[] once per cycle (5 s cache) and exclude any symbol
//     whose positionAmt is already zero, so we never *attempt* a
//     reduceOnly close into a flat position in the first place.
// Together R1 + R2 prevent the retry-storm at the source. The only
// surviving role of `isReduceOnlyReject` is as a diagnostic tag on
// the rare race where the broker closes a position inside R2's 5 s
// snapshot cache window — that single -2022 still surfaces, but R2
// will absorb it on the very next cycle.
function isReduceOnlyReject(errMsg) {
  if (!errMsg) return false;
  const s = String(errMsg);
  return s.includes("-2022") || /ReduceOnly\s+Order\s+is\s+rejected/i.test(s);
}

// 2026-04-29 — ROOT-CAUSE FIX (R1) for the V2 direct exit reduceOnly
// retry-storm. The earlier 60 s reject-cooldown only masked the
// symptom; the underlying cause is that `binanceTickExit` derives the
// `active` filter from a Firestore-cached position read view
// (`getPositionReadViewsBySymbols`) which lags `fillSync` by up to
// 3 minutes. When we successfully place a V2 direct dispatch reduceOnly
// market order, the broker may close the position within milliseconds,
// but the next fast-lane tick still sees the stale "ACTIVE" view and
// re-fires the same TRAIL/SL/BE trigger, producing the duplicate
// dispatch that the broker then rejects with -2022.
//
// Optimistic close: as soon as a place succeeds, mark the symbol as
// "exit in flight" with a 30 s TTL safety net. The next tick's active
// filter excludes any in-flight symbol from trigger evaluation. The
// TTL bounds the inhibit so a stuck/lost ack cannot permanently silence
// the symbol — fillSync will catch up well within 30 s by reconciling
// the actual fill into the position document, and `clearExitInFlight`
// is also exported so the broker truth pre-filter (R2) and fillSync
// hooks can release the inhibit early when they observe broker-flat
// position state.
const exitInFlightState = new Map();
const EXIT_IN_FLIGHT_TTL_MS = (() => {
  const raw = Number(process.env.TICK_EXIT_IN_FLIGHT_TTL_MS);
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 30_000;
})();
function markExitInFlight(symbol, { runId = null, fraction = null, triggeredKinds = null, source = "V2_DIRECT_EXIT_DISPATCH" } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return;
  exitInFlightState.set(sym, {
    runId: runId ? String(runId) : null,
    placedAt: Date.now(),
    fraction: Number.isFinite(Number(fraction)) ? Number(fraction) : null,
    triggeredKinds: Array.isArray(triggeredKinds) ? triggeredKinds.slice() : null,
    source: String(source || "").toUpperCase(),
  });
}
function clearExitInFlight(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return false;
  return exitInFlightState.delete(sym);
}
function isExitInFlight(symbol, nowMs = Date.now()) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return false;
  const rec = exitInFlightState.get(sym);
  if (!rec || !Number.isFinite(rec.placedAt)) return false;
  if (nowMs - rec.placedAt >= EXIT_IN_FLIGHT_TTL_MS) {
    exitInFlightState.delete(sym);
    return false;
  }
  return true;
}
function getExitInFlightRecord(symbol) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return null;
  return exitInFlightState.get(sym) || null;
}

// 2026-04-29 — ROOT-CAUSE FIX (R2) for the V2 direct exit reduceOnly
// retry-storm. R1 covered the post-place stale-window scenario; R2
// covers the *pre-place* scenario where the broker's own native
// STOP_MARKET (closePosition) has already filled — the broker is flat
// for that symbol — but the Firestore read view we'd otherwise use to
// build the active filter still says ACTIVE, so a fast-lane tick would
// dispatch a reduceOnly close into a flat position and earn -2022.
//
// Fix: before iterating the active set, fetch the broker's own account
// snapshot (positions[]) once per cycle, cache it for 5 s in-process,
// and exclude any symbol whose `positionAmt === 0`. Cost is bounded:
// fetchBinanceFuturesAccount has Binance weight ≈ 5 and the 5 s TTL
// caps us at ~12 calls/min/instance even under sub-second tick rates.
// fillSync (3-min poll cadence) and binanceLiveStateSelfHeal also call
// the same endpoint independently; if we ever want to share their
// results to drive the rate to 0 we can fold this cache into a
// shared module — for now an isolated 5 s cache is the simpler
// surface.
let brokerPositionSnapshotCache = null;
const BROKER_POSITION_SNAPSHOT_TTL_MS = (() => {
  const raw = Number(process.env.TICK_EXIT_BROKER_SNAPSHOT_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 5_000;
})();
function buildBrokerPositionSnapshot(account = {}) {
  const byMap = new Map();
  const rows = Array.isArray(account && account.positions) ? account.positions : [];
  for (const row of rows) {
    const sym = String(row && row.symbol || "").trim().toUpperCase();
    if (!sym) continue;
    const positionAmt = Number(row && row.positionAmt);
    if (!Number.isFinite(positionAmt)) continue;
    const positionSide = String(row && row.positionSide || "").trim().toUpperCase();
    byMap.set(sym, {
      positionAmt,
      positionSide: positionSide || (positionAmt > 0 ? "LONG" : positionAmt < 0 ? "SHORT" : "FLAT"),
      isFlat: positionAmt === 0,
    });
  }
  return byMap;
}
async function getBrokerPositionSnapshot({ liveCfg, nowMs = Date.now() } = {}) {
  if (
    brokerPositionSnapshotCache
    && Number.isFinite(brokerPositionSnapshotCache.fetchedAt)
    && (nowMs - brokerPositionSnapshotCache.fetchedAt) < BROKER_POSITION_SNAPSHOT_TTL_MS
  ) {
    return brokerPositionSnapshotCache;
  }
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return null;
  const account = await fetchBinanceFuturesAccount({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
  });
  brokerPositionSnapshotCache = {
    fetchedAt: nowMs,
    byMap: buildBrokerPositionSnapshot(account || {}),
  };
  return brokerPositionSnapshotCache;
}
function invalidateBrokerPositionSnapshotCache() {
  brokerPositionSnapshotCache = null;
}

const pendingIntentState = new Map();
const pendingIntentLogState = new Map();
const tpP1PendingTerminalAlertState = new Map();
const tpP1AckTimeoutAlertState = new Map();
const tp1MetaSyncGapAlertState = new Map();
const tp1NativeProtectionGapState = new Map();
const tp1NativeProtectionGapAlertState = new Map();
const PENDING_INTENT_CHECK_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_PENDING_INTENT_TTL_MS, 3000);
const pendingIntentScopeScanLimitRaw = Number(process.env.TICK_EXIT_PENDING_INTENT_SCOPE_SCAN_LIMIT);
const PENDING_INTENT_SCOPE_SCAN_LIMIT = Number.isFinite(pendingIntentScopeScanLimitRaw)
  ? Math.max(20, Math.round(pendingIntentScopeScanLimitRaw))
  : 300;
const TICK_EXIT_LEASE_ENABLED = String(process.env.TICK_EXIT_LEASE_ENABLED || "1") !== "0";
const TICK_EXIT_LEASE_DOC = String(process.env.TICK_EXIT_LEASE_DOC || "runtime_locks/binance_tick_exit_loop");
const TICK_EXIT_LEASE_MIN_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_LEASE_MIN_TTL_MS, 30000);
const TICK_EXIT_LEASE_LOG_COOLDOWN_MS = 60 * 1000;
const TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS, 300000);
const TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS, 300000);
const TP_P1_ACK_WATCHDOG_GRACE_MS = normalizeIntervalMs(process.env.TP_P1_ACK_WATCHDOG_GRACE_MS, 45000);
const TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS, 300000);
const TP1_META_SYNC_GAP_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP1_META_SYNC_GAP_ALERT_COOLDOWN_MS, 300000);
const TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS = normalizeIntervalMs(process.env.TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS, 15000);
const TP1_NATIVE_PROTECTION_GAP_ALERT_COOLDOWN_MS = normalizeIntervalMs(process.env.TP1_NATIVE_PROTECTION_GAP_ALERT_COOLDOWN_MS, 300000);
const tickExitInstanceId = [
  String(process.env.K_REVISION || process.env.HOSTNAME || os.hostname() || "local"),
  String(process.pid || "0"),
].join("__");
let leaseSkippedLogAt = 0;
const tickExitFailureAlertState = new Map();
const nativeProtectionStateCache = new Map();
const nativeProtectionRefreshAttemptState = new Map();
const trailHardExitCooldownState = new Map();

// 2026-04-28 senior audit (Step 8 — defensive depth on top of Step 4 OOM
// fix). Step 4 capped only `tpP1PendingTerminalAlertState` because that
// was the empirically-observed leak (intent-id keyed). The other caches
// here are keyed by `symbol` or `symbol:reason` — bounded today, but
// silent if a future change adds higher-cardinality dimensions to the
// key (e.g. `intent_id`, `bar_close_ms`). This single-pass helper
// applies the same cap+sweep contract uniformly so no individual cache
// can re-introduce the SIGABRT-via-OOM pattern under future drift.
//
// Contract:
//   - When the cache exceeds `softCap` entries, drop entries older than
//     `cooldownMs` first (cooldown-aware sweep — they've already
//     expired their semantic purpose).
//   - If the cache is still over `softCap` after the sweep, drop the
//     oldest half deterministically (Map preserves insertion order, so
//     iterating from the head gives oldest-first).
//   - Returns nothing; mutates the cache in place.
//   - Safe to call after every `.set()` — early-exit when under cap.
function applyAlertCacheCap(cache, cooldownMs, softCap = 2048) {
  if (!cache || typeof cache.size !== "number" || cache.size <= softCap) return;
  const now = Date.now();
  const cutoff = now - (Number.isFinite(Number(cooldownMs)) ? Number(cooldownMs) : 300000);
  for (const [k, v] of cache.entries()) {
    if (!Number.isFinite(v) || v < cutoff) cache.delete(k);
  }
  if (cache.size > softCap) {
    let drop = Math.floor(cache.size / 2);
    for (const k of cache.keys()) {
      if (drop-- <= 0) break;
      cache.delete(k);
    }
  }
}
const TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS = normalizeIntervalMs(process.env.TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS, 10000);
const TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS, 3000);
const TICK_EXIT_HARD_EXIT_COOLDOWN_MS = normalizeIntervalMs(process.env.TICK_EXIT_HARD_EXIT_COOLDOWN_MS, 60000);
const BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS = normalizeIntervalMs(process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS, 5 * 60 * 1000);
// 2026-04-18 P1-1: single-source-of-truth for the native-stop writer
// identifier. See `src/utils/binanceNativeProtectionWriter.js`. The
// previous local const `BINANCE_TICK_EXIT_STOP_WRITER = "BINANCE_TICK_EXIT"`
// was a string literal duplicated with `paperBinanceRunner.js` — one
// rename on either side would silently break the authority gate.
const BINANCE_TICK_EXIT_STOP_WRITER = BINANCE_NATIVE_STOP_WRITER_SOURCE;
let lastTickExitSelfHealAt = 0;

function resolveTfFromMsLocal(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const map = new Map([
    [60 * 1000, "1m"],
    [3 * 60 * 1000, "3m"],
    [5 * 60 * 1000, "5m"],
    [15 * 60 * 1000, "15m"],
    [30 * 60 * 1000, "30m"],
    [60 * 60 * 1000, "60m"],
    [4 * 60 * 60 * 1000, "4h"],
    [24 * 60 * 60 * 1000, "1d"],
  ]);
  return map.get(Math.round(n)) || null;
}

function resolvePositionSignalTf({ pos, exCfg } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const fromMetaText = String(meta.entry_exec_tf || meta.signal_tf || "").trim();
  if (fromMetaText) return fromMetaText;
  const fromMetaMs = resolveTfFromMsLocal(meta.entry_exec_tf_ms);
  if (fromMetaMs) return fromMetaMs;
  if (Array.isArray(exCfg && exCfg.tf_allowlist) && exCfg.tf_allowlist.length) {
    return String(exCfg.tf_allowlist[0]);
  }
  return "60m";
}

function buildBinanceTickExitNativeProtectionRefreshArgs({
  liveCfg,
  exchange = "BINANCEFUT",
  symbol,
  position = null,
  fallbackSide = null,
} = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const resolvedPositionSide = resolvePositionSideFromPosition(pos, meta, "LONG");
  const closeSide = String(fallbackSide || "").trim().toUpperCase()
    || (resolvedPositionSide === "SHORT" ? "SELL" : "BUY");
  return {
    liveCfg,
    exchange,
    symbol,
    fallbackSide: closeSide,
    fallbackEntryPrice: Number(pos && pos.avg_price),
    fallbackLeverage: Number(meta.external_leverage || meta.leverage || pos.leverage || 1),
    exitRulesOverride: meta.exit_rules_override || null,
    posMeta: meta,
    writerSource: BINANCE_TICK_EXIT_STOP_WRITER,
  };
}

async function refreshBinanceTickExitNativeProtection({
  liveCfg,
  exchange = "BINANCEFUT",
  symbol,
  position = null,
  fallbackSide = null,
  refreshFn = refreshBinanceNativeProtectionWithRetry,
} = {}) {
  return refreshFn(buildBinanceTickExitNativeProtectionRefreshArgs({
    liveCfg,
    exchange,
    symbol,
    position,
    fallbackSide,
  }));
}

function shouldBypassNativeProtectionCache({ cached, refreshAtMs, now } = {}) {
  if (!cached) return true;
  if (!Number.isFinite(cached.expiresAt) || cached.expiresAt <= now) return true;
  if (Number.isFinite(Number(refreshAtMs)) && Number.isFinite(Number(cached.checkedAt)) && Number(refreshAtMs) > Number(cached.checkedAt)) {
    return true;
  }
  return false;
}

function clearNativeProtectionStateCache(symbol) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return;
  nativeProtectionStateCache.delete(key);
}

function shouldRunNativeProtectionRefreshCooldown({ symbol, now = nowMs(), cooldownMs = TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS } = {}) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return false;
  const current = Number(now);
  if (!Number.isFinite(current)) return false;
  const cooldown = Math.max(1000, Number(cooldownMs) || TICK_EXIT_NATIVE_PROTECTION_REFRESH_COOLDOWN_MS);
  const last = Number(nativeProtectionRefreshAttemptState.get(key));
  if (Number.isFinite(last) && (current - last) < cooldown) return false;
  nativeProtectionRefreshAttemptState.set(key, current);
  // 2026-04-28 Step 8 — symbol-only keying is bounded today, but cap
  // defensively in case future code adds higher-cardinality dimensions.
  applyAlertCacheCap(nativeProtectionRefreshAttemptState, cooldown);
  return true;
}

function structuredLog(event, payload = {}, level = "log") {
  const record = { event, ts: new Date().toISOString(), ...payload };
  appendTickExitAudit(record);
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(record));
  } catch (_) {
    console[fn](`[${event}] ${JSON.stringify(payload)}`);
  }
}

function structuredLogWriter(event, payload = {}, level = "log") {
  structuredLog(event, payload, level);
}

function appendTickExitAudit(entry = {}, overridePath = null) {
  const event = String(entry && entry.event || "").trim();
  if (!TICK_EXIT_AUDIT_EVENTS.has(event)) return false;
  const targetPath = String(overridePath || process.env.BINANCE_TICK_EXIT_AUDIT_PATH || BINANCE_TICK_EXIT_AUDIT_PATH).trim();
  if (!targetPath) return false;
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.appendFileSync(targetPath, `${JSON.stringify(entry)}\n`, "utf8");
    return true;
  } catch (err) {
    try {
      console.warn("[TICK_EXIT_AUDIT_APPEND_FAIL]", err && err.message ? err.message : String(err));
    } catch (_) {}
    return false;
  }
}

function applyTrailObservationToPosition({ pos, observation } = {}) {
  const position = (pos && typeof pos === "object") ? pos : null;
  if (!position) return position;
  const meta = (position.meta && typeof position.meta === "object") ? position.meta : {};
  const snapshot = resolveTrailObservationSnapshot({ meta, observation });
  const nextMeta = {
    ...meta,
    trail_high: snapshot.trail_high,
    trail_high_at_ms: snapshot.trail_high_at_ms,
    trail_low: snapshot.trail_low,
    trail_low_at_ms: snapshot.trail_low_at_ms,
    ...(snapshot.entry_r_distance != null || meta.entry_r_distance != null
      ? { entry_r_distance: snapshot.entry_r_distance ?? meta.entry_r_distance }
      : {}),
    ...(snapshot.trail_r_multiple != null || meta.trail_r_multiple != null
      ? { trail_r_multiple: snapshot.trail_r_multiple ?? meta.trail_r_multiple }
      : {}),
    ...(snapshot.runner_floor_stop != null || meta.runner_floor_stop != null
      ? { runner_floor_stop: snapshot.runner_floor_stop ?? meta.runner_floor_stop }
      : {}),
    ...(snapshot.trail_stop_by_r != null || snapshot.r_based_trail_stop != null || meta.trail_stop_by_r != null || meta.r_based_trail_stop != null
      ? {
        trail_stop_by_r: snapshot.trail_stop_by_r ?? snapshot.r_based_trail_stop ?? meta.trail_stop_by_r ?? meta.r_based_trail_stop,
        r_based_trail_stop: snapshot.r_based_trail_stop ?? snapshot.trail_stop_by_r ?? meta.r_based_trail_stop ?? meta.trail_stop_by_r,
      }
      : {}),
    ...(snapshot.trail_stop_by_pct != null || meta.trail_stop_by_pct != null
      ? { trail_stop_by_pct: snapshot.trail_stop_by_pct ?? meta.trail_stop_by_pct }
      : {}),
    ...(snapshot.chosen_stop_source || meta.chosen_stop_source
      ? { chosen_stop_source: snapshot.chosen_stop_source ?? meta.chosen_stop_source }
      : {}),
    ...(snapshot.chosen_stop_price != null || meta.chosen_stop_price != null
      ? { chosen_stop_price: snapshot.chosen_stop_price ?? meta.chosen_stop_price }
      : {}),
    ...(snapshot.final_effective_stop != null || meta.final_effective_stop != null
      ? { final_effective_stop: snapshot.final_effective_stop ?? meta.final_effective_stop }
      : {}),
    ...(snapshot.native_stop_price != null || meta.native_protection_stop_price != null
      ? { native_protection_stop_price: snapshot.native_stop_price ?? meta.native_protection_stop_price }
      : {}),
    ...((snapshot.native_stop_order_id || meta.native_protection_stop_order_id)
      ? { native_protection_stop_order_id: snapshot.native_stop_order_id ?? meta.native_protection_stop_order_id }
      : {}),
    ...((snapshot.native_refresh_status || meta.native_protection_refresh_status)
      ? { native_protection_refresh_status: snapshot.native_refresh_status ?? meta.native_protection_refresh_status }
      : {}),
  };
  return {
    ...position,
    meta: nextMeta,
  };
}

function buildTickTrailObservationDocUpdate(trailPatch, updatedAt = null) {
  const patch = (trailPatch && typeof trailPatch === "object") ? { ...trailPatch } : {};
  return {
    ...patch,
    updated_at: updatedAt || new Date().toISOString(),
  };
}

function buildTickTrailReconcileRunId(symbol, atMs = Date.now()) {
  return `RUN__TRAIL_RECONCILE__BINANCEFUT__${String(symbol || "").toUpperCase()}__${Number(atMs)}`;
}

async function maybeWriteV2ShadowTrailActivation({
  symbol,
  position = null,
  side = null,
  nativeRefresh = null,
  runnerExit = null,
  observedAtMs = null,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  if (!pos) return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_TRAIL_NO_POSITION" };
  if (meta.tp_p1_done !== true || meta.trail_active !== true) {
    return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_TRAIL_STAGE_NOT_READY" };
  }
  if (!nativeRefresh || nativeRefresh.ok !== true) {
    return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_TRAIL_NATIVE_REFRESH_NOT_OK" };
  }
  if (!runnerExit || String(runnerExit.stopSource || "").trim().toUpperCase() !== "TRAIL") {
    return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_TRAIL_STOP_SOURCE_NOT_TRAIL" };
  }
  const entryEventId = meta.entry_event_id ? String(meta.entry_event_id) : null;
  const sourceOrderId = nativeRefresh.stop_order_id ? String(nativeRefresh.stop_order_id) : null;
  const stopPrice = Number(nativeRefresh.stop_price);
  if (!entryEventId || !sourceOrderId || !(Number.isFinite(stopPrice) && stopPrice > 0)) {
    return { ok: false, written: false, skipped: false, reason: "V2_SHADOW_TRAIL_NATIVE_REFRESH_CONTEXT_INCOMPLETE" };
  }
  try {
    return await writeOpenClawShadowTrailActivation({
      symbol,
      entryEventId,
      positionSide: side,
      sourceOrderId,
      nextStopPrice: Number(runnerExit.stopPrice),
      nativeStopPrice: stopPrice,
      nativeRefreshStatus: "OK",
      observedAtMs,
    });
  } catch (error) {
    return {
      ok: false,
      written: false,
      skipped: false,
      reason: error && error.message ? error.message : String(error),
    };
  }
}

async function syncTickExitTrailObservation({
  exchange = "BINANCEFUT",
  symbol,
  position = null,
  rules = null,
  nativeProtection = null,
  runtimeEvalAtMs = null,
  source = "TICK_EXIT",
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  if (!pos) return null;
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const runnerStage = resolveRunnerStageState(pos);
  if (runnerStage.tpP1Done !== true) return null;
  const side = resolvePositionSideFromPosition(pos, meta, "LONG");
  const exitRules = rules || resolveExitRulesForPosition({ exchange, position: pos });
  const runnerExit = computeRunnerExitStopPrice({
    avg: Number(pos && pos.avg_price),
    leverageEff: Number(meta && (meta.external_leverage || meta.leverage || pos.leverage || 1)),
    side,
    rules: exitRules,
    tpP1Done: runnerStage.tpP1Done,
    trailActive: runnerStage.trailStage,
    trailHigh: meta && Number.isFinite(Number(meta.trail_high)) ? Number(meta.trail_high) : null,
    trailLow: meta && Number.isFinite(Number(meta.trail_low)) ? Number(meta.trail_low) : null,
    entryRDistance: Number(meta && meta.entry_r_distance),
  });
  const refresh = nativeProtection && typeof nativeProtection === "object" ? nativeProtection : null;
  const nativeStopPrice = refresh && refresh.ok === true
    ? Number(refresh.stop_price)
    : (meta && Number.isFinite(Number(meta.native_protection_stop_price))
      ? Number(meta.native_protection_stop_price)
      : null);
  const nativeStopOrderId = refresh && refresh.ok === true
    ? (refresh.stop_order_id || null)
    : (meta && meta.native_protection_stop_order_id ? meta.native_protection_stop_order_id : null);
  const nativeRefreshStatus = refresh
    ? (refresh.ok === true
      ? "OK"
      : String(refresh.reason || "FAILED").trim().toUpperCase())
    : (meta && meta.native_protection_refresh_status ? meta.native_protection_refresh_status : null);
  const observedAtMs = nowMs();
  return upsertTrailObservation({
    exchange,
    symbol,
    side,
    entryEventId: meta && meta.entry_event_id ? meta.entry_event_id : null,
    entryExecBarMs: meta && Number.isFinite(Number(meta.entry_exec_bar_ms))
      ? Number(meta.entry_exec_bar_ms)
      : null,
    entryPrice: Number(pos && pos.avg_price),
    entryRDistance: meta && Number.isFinite(Number(meta.entry_r_distance))
      ? Number(meta.entry_r_distance)
      : null,
    trailRMultiple: Number(exitRules && exitRules.TRAIL_R_MULTIPLE),
    trailHigh: meta && Number.isFinite(Number(meta.trail_high)) ? Number(meta.trail_high) : null,
    trailHighAtMs: meta && Number.isFinite(Number(meta.trail_high_at_ms)) ? Number(meta.trail_high_at_ms) : null,
    trailLow: meta && Number.isFinite(Number(meta.trail_low)) ? Number(meta.trail_low) : null,
    trailLowAtMs: meta && Number.isFinite(Number(meta.trail_low_at_ms)) ? Number(meta.trail_low_at_ms) : null,
    runnerFloorStop: Number(runnerExit && runnerExit.runnerFloorStop),
    computedTrailStop: Number(runnerExit && runnerExit.stopPrice),
    trailStopRaw: Number(runnerExit && runnerExit.trailStop),
    trailStopByR: Number(runnerExit && runnerExit.trailStopByR),
    trailStopByPct: Number(runnerExit && runnerExit.trailStopByPct),
    chosenStopSource: runnerExit && runnerExit.stopSource ? runnerExit.stopSource : null,
    chosenStopPrice: Number(runnerExit && runnerExit.stopPrice),
    finalEffectiveStop: Number(runnerExit && runnerExit.stopPrice),
    nativeStopPrice: Number.isFinite(nativeStopPrice) ? nativeStopPrice : null,
    nativeStopOrderId,
    nativeRefreshStatus,
    lastRepriceAtMs: observedAtMs,
    runtimeEvalAtMs: Number.isFinite(Number(runtimeEvalAtMs)) ? Number(runtimeEvalAtMs) : observedAtMs,
    source,
  });
}

async function resolveTickExitAlertChannel(exchange = "BINANCEFUT") {
  const sys = await getSystemSettingsForProvider(exchange, 5000);
  return String(sys && sys.data && sys.data.alert_channel || "").trim();
}

function shouldSendTickExitFailureAlert({ symbol, reason } = {}) {
  const key = `${String(symbol || "ALL").toUpperCase()}:${String(reason || "UNKNOWN").toUpperCase()}`;
  const now = nowMs();
  const last = Number(tickExitFailureAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS) return false;
  tickExitFailureAlertState.set(key, now);
  // 2026-04-28 Step 8 — symbol:reason keying is bounded today, but cap
  // defensively in case future code adds higher-cardinality dimensions.
  applyAlertCacheCap(tickExitFailureAlertState, TICK_EXIT_FAILURE_ALERT_COOLDOWN_MS);
  return true;
}

async function sendTickExitFailureAlert({
  symbol,
  error,
  phase = "RUN",
  position = null,
  price = null,
} = {}) {
  const reason = String(error || "UNKNOWN").trim() || "UNKNOWN";
  if (!shouldSendTickExitFailureAlert({ symbol, reason })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  try {
    const channel = await resolveTickExitAlertChannel("BINANCEFUT");
    if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
    const meta = (position && typeof position.meta === "object") ? position.meta : {};
    const lines = [
      `phase: ${String(phase || "RUN")}`,
      `error: ${reason.slice(0, 240)}`,
    ];
    if (symbol) lines.push(`symbol: ${String(symbol).toUpperCase()}`);
    if (position) {
      lines.push(`side: ${String(position.position_side || meta.position_side || "-").toUpperCase() || "-"}`);
      lines.push(`state: ${String(position.state || "-").toUpperCase()}`);
      lines.push(`tp1_done: ${meta.tp_p1_done === true ? "1" : "0"}`);
      lines.push(`trail_active: ${meta.trail_active === true ? "1" : "0"}`);
    }
    if (Number.isFinite(Number(price))) lines.push(`price: ${Number(price)}`);
    return sendAlert({
      channel,
      title: `[V2 Exit Worker] ${String(symbol || "BINANCEFUT").toUpperCase()} tick-exit 실패`,
      body: lines.join("\n"),
      severity: "WARN",
    });
  } catch (alertErr) {
    console.warn("[TICK_EXIT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

function shouldRunBySymbolCooldown({ symbol, now, cooldownMs }) {
  const sym = String(symbol || "").toUpperCase();
  if (!sym) return { ok: true, remainingMs: 0 };
  const cooldown = Number(cooldownMs);
  if (!Number.isFinite(cooldown) || cooldown <= 0) return { ok: true, remainingMs: 0 };

  const last = Number(symbolCooldownState.get(sym));
  if (Number.isFinite(last) && (now - last) < cooldown) {
    return { ok: false, remainingMs: Math.max(0, cooldown - (now - last)) };
  }
  symbolCooldownState.set(sym, now);
  if (symbolCooldownState.size > 1000) {
    for (const [k, v] of symbolCooldownState) {
      if (!Number.isFinite(v) || (now - v) > (cooldown * 4)) symbolCooldownState.delete(k);
    }
  }
  return { ok: true, remainingMs: 0 };
}

function intentScopeKey(exchange, symbol, tf) {
  return `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${String(tf || "")}`;
}

function isTpP1IntentEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}

function isTpP1PendingTerminalFailureIntent(intent = {}) {
  const status = String(intent && intent.status || "").trim().toUpperCase();
  if (status !== "CANCELED") return false;
  const terminalFailureStatus = String(intent && intent.terminal_failure_status || "").trim().toUpperCase();
  const statusFamily = String(intent && intent.status_family || "").trim().toUpperCase();
  const cancelReason = String(intent && intent.cancel_reason || "").trim().toUpperCase();
  const statusReason = String(intent && intent.status_reason || "").trim().toUpperCase();
  const decisionReason = String(intent && intent.decision_reason || intent.reason || "").trim().toUpperCase();
  const reasons = [terminalFailureStatus, statusFamily, cancelReason, statusReason, decisionReason].filter(Boolean);
  return reasons.some((reason) => reason === "FAILED_INTERNAL" || reason === "LIVE_FAILED" || reason === "LIVE_EXCEPTION" || reason.startsWith("LIVE_"));
}

function buildTpP1PendingTerminalAlertPayload({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  pendingUntilMs,
  intent = {},
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const lines = [
    "reason: TP1_PENDING_TERMINAL_LIVE_FAILURE",
    "phase: TP1_PENDING_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || "-")}`,
    `pending_event: ${String(pendingEvent || "EXIT_TP_P1")}`,
    `intent_id: ${String(intent.intent_id || intent.id || "N/A")}`,
    `status: ${String(intent.status || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `status_reason: ${String(intent.status_reason || intent.cancel_reason || intent.decision_reason || intent.reason || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
  ];
  if (Number.isFinite(Number(pendingAtMs))) lines.push(`pending_at_utc: ${new Date(Number(pendingAtMs)).toISOString()}`);
  if (Number.isFinite(Number(pendingUntilMs))) lines.push(`pending_until_utc: ${new Date(Number(pendingUntilMs)).toISOString()}`);
  if (intent.last_error) lines.push(`error: ${String(intent.last_error).slice(0, 240)}`);
  return {
    title: `[V2 긴급] ${normalizedSymbol} TP1 pending terminal failure`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

function shouldSendTpP1PendingTerminalAlert({ symbol, intentId, reason } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    String(intentId || "").trim() || "NA",
    String(reason || "").trim().toUpperCase() || "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tpP1PendingTerminalAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS) return false;
  tpP1PendingTerminalAlertState.set(key, now);
  // 2026-04-28 Step 4 — empirically observed unbounded growth (intent-id
  // keyed). Cap via the shared helper; semantics: if a key gets evicted
  // before its cooldown elapses, the next alert for that exact triplet may
  // fire one extra time, which is acceptable.
  applyAlertCacheCap(tpP1PendingTerminalAlertState, TP_P1_PENDING_TERMINAL_ALERT_COOLDOWN_MS);
  return true;
}

function resolveTpP1AckWatchdogDecision({ meta = null, intent = null, now = Date.now(), graceMs = TP_P1_ACK_WATCHDOG_GRACE_MS } = {}) {
  const positionMeta = (meta && typeof meta === "object") ? meta : {};
  if (positionMeta.tp_p1_pending !== true) {
    return { timedOut: false, reason: "TP1_PENDING_INACTIVE" };
  }
  if (!intent || typeof intent !== "object") {
    return { timedOut: false, reason: "TP1_INTENT_MISSING" };
  }
  const status = String(intent.status || "").trim().toUpperCase();
  if (status !== "PENDING") {
    return { timedOut: false, reason: "TP1_INTENT_NOT_PENDING", status };
  }
  const ackAtMsRaw = Number(intent.live_submit_ack_at_ms);
  const ackAtMs = Number.isFinite(ackAtMsRaw) && ackAtMsRaw > 0 ? ackAtMsRaw : null;
  const startedAtMsRaw = Number(intent.live_submit_started_at_ms);
  const startedAtMs = Number.isFinite(startedAtMsRaw) && startedAtMsRaw > 0 ? startedAtMsRaw : null;
  const orderId = intent.live_submit_order_id != null ? String(intent.live_submit_order_id).trim() : "";
  const clientOrderId = intent.live_submit_client_order_id != null ? String(intent.live_submit_client_order_id).trim() : "";
  if (Number.isFinite(ackAtMs) || orderId || clientOrderId) {
    return {
      timedOut: false,
      reason: "TP1_ALREADY_ACKED",
      status,
      startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : null,
      ackAtMs: Number.isFinite(ackAtMs) ? ackAtMs : null,
      liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
      orderId: orderId || null,
      clientOrderId: clientOrderId || null,
    };
  }
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return {
      timedOut: false,
      reason: "TP1_SUBMIT_NOT_STARTED",
      status,
      liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
    };
  }
  const refNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const grace = Math.max(1000, Number(graceMs) || TP_P1_ACK_WATCHDOG_GRACE_MS);
  const elapsedMs = Math.max(0, refNow - startedAtMs);
  return {
    timedOut: elapsedMs > grace,
    reason: elapsedMs > grace ? "TP1_ACK_TIMEOUT" : "TP1_ACK_PENDING",
    status,
    startedAtMs,
    ackAtMs: null,
    elapsedMs,
    graceMs: grace,
    liveSubmitState: String(intent.live_submit_state || "").trim().toUpperCase() || null,
    orderId: null,
    clientOrderId: null,
  };
}

function buildTpP1AckTimeoutAlertPayload({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  intent = {},
  decision = {},
} = {}) {
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const lines = [
    "reason: TP1_ACK_TIMEOUT",
    "phase: TP1_ACK_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || "-")}`,
    `pending_event: ${String(pendingEvent || "EXIT_TP_P1")}`,
    `intent_id: ${String(intent.intent_id || intent.id || "N/A")}`,
    `status: ${String(intent.status || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `live_submit_state: ${String(decision.liveSubmitState || intent.live_submit_state || "UNKNOWN").toUpperCase() || "UNKNOWN"}`,
    `grace_ms: ${Number.isFinite(Number(decision.graceMs)) ? Number(decision.graceMs) : TP_P1_ACK_WATCHDOG_GRACE_MS}`,
  ];
  if (Number.isFinite(Number(pendingAtMs))) lines.push(`pending_at_utc: ${new Date(Number(pendingAtMs)).toISOString()}`);
  if (Number.isFinite(Number(decision.startedAtMs))) lines.push(`submit_started_at_utc: ${new Date(Number(decision.startedAtMs)).toISOString()}`);
  if (Number.isFinite(Number(decision.elapsedMs))) lines.push(`elapsed_ms: ${Math.round(Number(decision.elapsedMs))}`);
  if (intent.live_submit_error) lines.push(`submit_error: ${String(intent.live_submit_error).slice(0, 240)}`);
  if (intent.last_error) lines.push(`last_error: ${String(intent.last_error).slice(0, 240)}`);
  return {
    title: `[V2 긴급] ${normalizedSymbol} TP1 submit ACK timeout`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

function shouldSendTpP1AckTimeoutAlert({ symbol, intentId, reason } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    String(intentId || "").trim() || "NA",
    String(reason || "").trim().toUpperCase() || "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tpP1AckTimeoutAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS) return false;
  tpP1AckTimeoutAlertState.set(key, now);
  // 2026-04-28 Step 8 — same intent-id key shape as the pending-terminal
  // cache (Step 4). Cap defensively to prevent the same OOM pattern.
  applyAlertCacheCap(tpP1AckTimeoutAlertState, TP_P1_ACK_TIMEOUT_ALERT_COOLDOWN_MS);
  return true;
}

async function loadLatestTpP1IntentForScope({ exchange, symbol, tf } = {}) {
  const scope = intentScopeKey(exchange, symbol, tf);
  if (!scope) return null;
  const db = getFirestore();
  const rows = [];
  const collectRows = (snap) => {
    if (!snap || snap.empty) return;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      if (String(data.intent_scope || "") !== scope) return;
      if (!isTpP1IntentEvent(data.event)) return;
      rows.push({
        id: doc.id,
        intent_id: data.intent_id || doc.id,
        event: data.event || null,
        status: data.status || null,
        status_family: data.status_family || null,
        terminal_failure_status: data.terminal_failure_status || null,
        status_reason: data.status_reason || null,
        cancel_reason: data.cancel_reason || null,
        decision_reason: data.decision_reason || data.reason || null,
        last_error: data.last_error || null,
        live_submit_state: data.live_submit_state || null,
        live_submit_started_at_ms: data.live_submit_started_at_ms ?? null,
        live_submit_finished_at_ms: data.live_submit_finished_at_ms ?? null,
        live_submit_ack_at_ms: data.live_submit_ack_at_ms ?? null,
        live_submit_order_id: data.live_submit_order_id || null,
        live_submit_client_order_id: data.live_submit_client_order_id || null,
        live_submit_exception_family: data.live_submit_exception_family || null,
        live_submit_error: data.live_submit_error || null,
        updated_at: data.updated_at || null,
        created_at: data.created_at || null,
      });
    });
  };

  try {
    const orderedSnap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scope)
      .orderBy("updated_at", "desc")
      .limit(20)
      .get();
    collectRows(orderedSnap);
  } catch (_) {}

  if (!rows.length) {
    try {
      const fallbackSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .limit(Math.max(20, PENDING_INTENT_SCOPE_SCAN_LIMIT))
        .get();
      collectRows(fallbackSnap);
    } catch (_) {}
  }

  if (!rows.length) return null;
  rows.sort((a, b) => {
    const ta = Date.parse(String(a.updated_at || a.created_at || 0)) || 0;
    const tb = Date.parse(String(b.updated_at || b.created_at || 0)) || 0;
    return tb - ta;
  });
  return rows[0];
}

async function sendTpP1PendingTerminalAlert({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  pendingUntilMs,
  intent,
} = {}) {
  const reason = String(intent && (intent.status_reason || intent.cancel_reason || intent.decision_reason || intent.reason) || "UNKNOWN")
    .trim()
    .toUpperCase() || "UNKNOWN";
  if (!shouldSendTpP1PendingTerminalAlert({
    symbol,
    intentId: intent && (intent.intent_id || intent.id),
    reason,
  })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTpP1PendingTerminalAlertPayload({
    symbol,
    tf,
    pendingEvent,
    pendingAtMs,
    pendingUntilMs,
    intent,
  });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_PENDING_TERMINAL_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

async function sendTpP1AckTimeoutAlert({
  symbol,
  tf,
  pendingEvent,
  pendingAtMs,
  intent,
  decision,
} = {}) {
  if (!shouldSendTpP1AckTimeoutAlert({
    symbol,
    intentId: intent && (intent.intent_id || intent.id),
    reason: "TP1_ACK_TIMEOUT",
  })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTpP1AckTimeoutAlertPayload({
    symbol,
    tf,
    pendingEvent,
    pendingAtMs,
    intent,
    decision,
  });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_ACK_TIMEOUT_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

async function hasPendingIntentsForScope({ exchange, symbol, tf, now } = {}) {
  const scope = intentScopeKey(exchange, symbol, tf);
  if (!scope) return false;
  const tsNow = Number.isFinite(now) ? now : Date.now();
  const cached = pendingIntentState.get(scope);
  if (cached && Number.isFinite(cached.checkedAt) && (tsNow - cached.checkedAt) < PENDING_INTENT_CHECK_TTL_MS) {
    return cached.hasPending === true;
  }

  let hasPending = false;
  const nowMsSafe = Date.now();
  const markHasPendingFromSnap = (snap) => {
    if (!snap || snap.empty) return false;
    let found = false;
    snap.forEach((d) => {
      if (found) return;
      const x = d.data() || {};
      if (String(x.status || "").toUpperCase() !== "PENDING") return;
      const expMs = Number(x.expires_at_ms);
      if (Number.isFinite(expMs) && expMs <= nowMsSafe) return;
      found = true;
    });
    return found;
  };

  try {
    const db = getFirestore();
    // Preferred path: scan only PENDING docs under this scope.
    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      hasPending = markHasPendingFromSnap(pendingSnap);
    } catch (_) {
      hasPending = false;
    }
    // Fallback path: legacy/unknown index case -> scope-limited scan.
    if (!hasPending) {
      const scanSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .limit(PENDING_INTENT_SCOPE_SCAN_LIMIT)
        .get();
      hasPending = markHasPendingFromSnap(scanSnap);
    }
  } catch (_) {
    hasPending = false;
  }

  pendingIntentState.set(scope, { checkedAt: tsNow, hasPending });
  if (pendingIntentState.size > 2000) {
    for (const [k, v] of pendingIntentState) {
      if (!v || !Number.isFinite(v.checkedAt) || (tsNow - v.checkedAt) > (PENDING_INTENT_CHECK_TTL_MS * 10)) {
        pendingIntentState.delete(k);
      }
    }
  }
  return hasPending;
}

async function clearExpiredTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const pendingUntilMs = Number(meta.tp_p1_pending_until_ms);
  const refNow = Number.isFinite(now) ? now : Date.now();
  if (!Number.isFinite(pendingUntilMs) || refNow <= pendingUntilMs) return false;

  const hasPending = await hasPendingIntentsForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
    now: refNow,
  });
  if (hasPending) return false;

  const clearedAt = new Date(refNow).toISOString();
  const cleared = await clearTpP1PendingIfUnchanged({
    exchange: "BINANCEFUT",
    symbol,
    pendingAtMs: Number.isFinite(pendingAtMs) ? pendingAtMs : null,
    pendingUntilMs,
    pendingEvent: meta.tp_p1_pending_event || null,
    clearedAt,
    clearedReason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  });
  if (!cleared || cleared.cleared !== true) return false;

  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
  };
  return true;
}

async function clearTerminalFailedTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;
  if (meta.tp_p1_done === true || meta.trail_active === true) return false;

  const latestIntent = await loadLatestTpP1IntentForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
  });
  if (!latestIntent || !isTpP1IntentEvent(latestIntent.event) || !isTpP1PendingTerminalFailureIntent(latestIntent)) {
    return false;
  }

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const pendingUntilMs = Number(meta.tp_p1_pending_until_ms);
  const refNow = Number.isFinite(now) ? now : Date.now();
  const clearedAt = new Date(refNow).toISOString();
  const clearedReason = "PENDING_TERMINAL_LIVE_FAILURE";
  const cleared = await clearTpP1PendingIfUnchanged({
    exchange: "BINANCEFUT",
    symbol,
    pendingAtMs: Number.isFinite(pendingAtMs) ? pendingAtMs : null,
    pendingUntilMs: Number.isFinite(pendingUntilMs) ? pendingUntilMs : null,
    pendingEvent: meta.tp_p1_pending_event || null,
    clearedAt,
    clearedReason,
  });
  if (!cleared || cleared.cleared !== true) return false;

  pendingIntentState.set(intentScopeKey("BINANCEFUT", symbol, tf), { checkedAt: refNow, hasPending: false });
  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: clearedReason,
  };

  structuredLog("tick_exit_tp1_pending_terminal_failure", {
    exchange: "BINANCEFUT",
    symbol: String(symbol || "").toUpperCase(),
    tf: String(tf || ""),
    intent_id: latestIntent.intent_id || null,
    status: String(latestIntent.status || "").toUpperCase() || null,
    status_reason: String(latestIntent.status_reason || latestIntent.cancel_reason || latestIntent.decision_reason || "").toUpperCase() || null,
  }, "warn");

  await sendTpP1PendingTerminalAlert({
    symbol,
    tf,
    pendingEvent: meta.tp_p1_pending_event || null,
    pendingAtMs,
    pendingUntilMs,
    intent: latestIntent,
  });
  return true;
}

async function clearUnackedTpP1Pending({ pos, symbol, tf, now } = {}) {
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  if (meta.tp_p1_pending !== true) return false;
  if (meta.tp_p1_done === true || meta.trail_active === true) return false;

  const latestIntent = await loadLatestTpP1IntentForScope({
    exchange: "BINANCEFUT",
    symbol,
    tf,
  });
  const decision = resolveTpP1AckWatchdogDecision({
    meta,
    intent: latestIntent,
    now,
  });
  if (!decision || decision.timedOut !== true || !latestIntent || !latestIntent.intent_id) return false;

  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const refNow = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const clearedAt = new Date(refNow).toISOString();
  const timeoutNote = `TP1 submit ACK timeout after ${Math.round(Number(decision.elapsedMs) || 0)}ms`;

  await markIntentStatus(latestIntent.intent_id, "CANCELED", {
    cancel_reason: "TP1_ACK_TIMEOUT",
    status_reason: "TP1_ACK_TIMEOUT",
    cancel_note: timeoutNote,
    last_error: latestIntent.last_error || latestIntent.live_submit_error || timeoutNote,
    live_submit_state: "ACK_TIMEOUT",
    live_submit_finished_at_ms: refNow,
    live_submit_exception_family: "ACK_TIMEOUT",
    live_submit_error: timeoutNote,
  });

  const clearedReason = "PENDING_SUBMIT_ACK_TIMEOUT";
  pendingIntentState.set(intentScopeKey("BINANCEFUT", symbol, tf), { checkedAt: refNow, hasPending: false });
  pos.meta = {
    ...meta,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_pending_cleared_at: clearedAt,
    tp_p1_pending_cleared_reason: clearedReason,
  };

  structuredLog("tick_exit_tp1_ack_timeout", {
    exchange: "BINANCEFUT",
    symbol: String(symbol || "").toUpperCase(),
    tf: String(tf || ""),
    intent_id: latestIntent.intent_id || null,
    live_submit_state: decision.liveSubmitState || latestIntent.live_submit_state || null,
    live_submit_started_at_ms: Number.isFinite(Number(decision.startedAtMs)) ? Number(decision.startedAtMs) : null,
    elapsed_ms: Number.isFinite(Number(decision.elapsedMs)) ? Number(decision.elapsedMs) : null,
    grace_ms: Number.isFinite(Number(decision.graceMs)) ? Number(decision.graceMs) : null,
  }, "warn");

  await sendTpP1AckTimeoutAlert({
    symbol,
    tf,
    pendingEvent: meta.tp_p1_pending_event || null,
    pendingAtMs,
    intent: latestIntent,
    decision,
  });
  return true;
}

async function fetchBinanceFuturesPrices(symbols) {
  const out = {};
  const list = Array.isArray(symbols) ? symbols.map((s) => String(s || "").toUpperCase()).filter(Boolean) : [];
  if (!list.length) return out;
  const baseUrl = getFuturesBaseUrl() || "https://fapi.binance.com";
  const url = `${baseUrl}/fapi/v1/ticker/price?symbols=` + encodeURIComponent(JSON.stringify(list));
  const res = await fetch(url, { method: "GET" });
  const text = await res.text();
  if (!res.ok) throw new Error(`BINANCE_TICKER_FAIL_${res.status}`);
  const rows = JSON.parse(text);
  if (Array.isArray(rows)) {
    rows.forEach((r) => {
      const sym = String(r && r.symbol || "").toUpperCase();
      const px = Number(r && r.price);
      if (sym && Number.isFinite(px)) out[sym] = px;
    });
  }
  return out;
}

function resolveLeverageEff(pos, exchange) {
  const ex = String(exchange || "").toUpperCase();
  const meta = pos && pos.meta ? pos.meta : {};
  const levRaw = Number(meta.external_leverage ?? meta.leverage ?? meta.futures_leverage ?? pos.leverage);
  if (ex.includes("BINANCE") && Number.isFinite(levRaw) && levRaw > 0) return levRaw;
  return 1;
}

function pnlToPrice({ avg, pnlPct, side }) {
  if (!Number.isFinite(avg) || !Number.isFinite(pnlPct)) return null;
  const s = String(side || "").toUpperCase();
  if (s === "SHORT") return avg * (1 - pnlPct);
  return avg * (1 + pnlPct);
}

function computeBePct(rules, leverageEff, exchange) {
  if (!rules || rules.BE_ENABLE === false) return null;
  if (Number.isFinite(rules.BE_PCT)) return rules.BE_PCT;
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE") || !Number.isFinite(leverageEff) || leverageEff <= 0) return null;
  const feeBps = Number(process.env.FEE_BPS || 4);
  const slippageBps = Number(process.env.SLIPPAGE_BPS || 5);
  const roundTripBps = (Number.isFinite(feeBps) ? feeBps : 0) + (Number.isFinite(slippageBps) ? slippageBps : 0);
  return -((roundTripBps * 2) / 10000) * leverageEff;
}

function hasNativeStopProtection(meta) {
  const status = String(meta && meta.native_protection_refresh_status || "").toUpperCase();
  const stale = meta && meta.native_protection_stale === true;
  const stopPrice = Number(meta && meta.native_protection_stop_price);
  const stopOrderId = String(meta && meta.native_protection_stop_order_id || "").trim();
  return status === "OK" && stale !== true && ((Number.isFinite(stopPrice) && stopPrice > 0) || !!stopOrderId);
}

function hasNativeTpProtection(meta) {
  const status = String(meta && meta.native_protection_refresh_status || "").toUpperCase();
  const tpStatus = String(meta && meta.native_protection_tp_status || "").toUpperCase();
  const stale = meta && meta.native_protection_stale === true;
  const tpPrice = Number(meta && meta.native_protection_tp_price);
  const tpOrderId = String(meta && meta.native_protection_tp_order_id || "").trim();
  return status === "OK"
    && tpStatus === "OK"
    && stale !== true
    && ((Number.isFinite(tpPrice) && tpPrice > 0) || !!tpOrderId);
}

function shouldEagerRefreshNativeProtection({ pos, nativeProtectionState } = {}) {
  const position = pos && typeof pos === "object" ? pos : null;
  if (!position) return { needed: false, reason: "NO_POSITION" };
  const meta = position && typeof position.meta === "object" ? position.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(position);
  const tpP1Done = hasCanonicalTpP1Reached(canonicalStage);
  const tpP1Pending = meta.tp_p1_pending === true;
  const stopActive = nativeProtectionState && typeof nativeProtectionState.stopActive === "boolean"
    ? nativeProtectionState.stopActive
    : hasNativeStopProtection(meta);
  const tpActive = nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
    ? nativeProtectionState.tpActive
    : hasNativeTpProtection(meta);
  const refreshStatus = String(meta.native_protection_refresh_status || "").trim().toUpperCase() || null;
  const needsStop = stopActive !== true;
  const needsTp = !tpP1Done && !tpP1Pending && tpActive !== true;
  return {
    needed: needsStop || needsTp,
    reason: refreshStatus || (needsStop ? "NATIVE_STOP_MISSING" : (needsTp ? "NATIVE_TP_MISSING" : "UP_TO_DATE")),
    needsStop,
    needsTp,
  };
}

function shouldTrackTp1NativeRefreshLifecycle({ position = null, refreshPlan = null, refreshResult = null } = {}) {
  const pos = position && typeof position === "object" ? position : null;
  if (!pos || isSimplifiedExitV2Position(pos) !== true) return false;
  const meta = pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  if (hasCanonicalTpP1Reached(canonicalStage) || meta.trail_active === true) return false;
  if (refreshPlan && refreshPlan.needsTp === true) return true;
  if (meta.tp_p1_pending === true) return true;
  if (refreshResult && (
    refreshResult.tp_order_id
    || refreshResult.tp_status
    || Number.isFinite(Number(refreshResult.tp_price))
  )) return true;
  return false;
}

function buildTp1NativeRefreshTelemetryPayload({
  symbol,
  tf = null,
  position = null,
  refreshPlan = null,
  refreshResult = null,
  nativeProtectionState = null,
  phase = "ATTEMPT",
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const canonicalStage = resolveCanonicalExitStageForPosition(pos);
  return {
    exchange: "BINANCEFUT",
    symbol: String(symbol || pos && (pos.symbol_or_pair_id || pos.symbol) || "").toUpperCase() || null,
    tf: String(tf || "").trim() || null,
    phase: String(phase || "ATTEMPT").trim().toUpperCase(),
    simplified_exit_v2_enabled: isSimplifiedExitV2Position(pos),
    canonical_exit_stage: canonicalStage ? String(canonicalStage).toUpperCase() : null,
    tp_p1_done: meta.tp_p1_done === true,
    tp_p1_pending: meta.tp_p1_pending === true,
    trail_active: meta.trail_active === true,
    native_tp_order_id_before: meta.native_protection_tp_order_id || null,
    native_tp_status_before: meta.native_protection_tp_status ? String(meta.native_protection_tp_status).toUpperCase() : null,
    native_tp_price_before: Number.isFinite(Number(meta.native_protection_tp_price)) ? Number(meta.native_protection_tp_price) : null,
    native_tp_qty_ratio_before: Number.isFinite(Number(meta.native_protection_tp_qty_ratio)) ? Number(meta.native_protection_tp_qty_ratio) : null,
    native_tp_active_before: nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
      ? nativeProtectionState.tpActive
      : hasNativeTpProtection(meta),
    refresh_needed: !!(refreshPlan && refreshPlan.needed === true),
    refresh_reason: refreshPlan && refreshPlan.reason ? String(refreshPlan.reason).toUpperCase() : null,
    refresh_needs_stop: !!(refreshPlan && refreshPlan.needsStop === true),
    refresh_needs_tp: !!(refreshPlan && refreshPlan.needsTp === true),
    refresh_ok: refreshResult ? refreshResult.ok === true : null,
    refresh_skipped: refreshResult ? refreshResult.skipped === true : null,
    refresh_result_reason: refreshResult && refreshResult.reason ? String(refreshResult.reason) : null,
    refresh_tp_order_id: refreshResult && refreshResult.tp_order_id ? String(refreshResult.tp_order_id) : null,
    refresh_tp_status: refreshResult && refreshResult.tp_status ? String(refreshResult.tp_status).toUpperCase() : null,
    refresh_tp_price: refreshResult && Number.isFinite(Number(refreshResult.tp_price)) ? Number(refreshResult.tp_price) : null,
    refresh_tp_qty_ratio: refreshResult && Number.isFinite(Number(refreshResult.tp_qty_ratio)) ? Number(refreshResult.tp_qty_ratio) : null,
    attempts: refreshResult && Number.isFinite(Number(refreshResult.attempts)) ? Number(refreshResult.attempts) : null,
    max_attempts: refreshResult && Number.isFinite(Number(refreshResult.max_attempts)) ? Number(refreshResult.max_attempts) : null,
  };
}

function buildTp1MetaSyncTelemetryPayload({
  symbol,
  tf = null,
  beforePosition = null,
  afterPosition = null,
  refreshPlan = null,
  refreshResult = null,
} = {}) {
  const beforePos = beforePosition && typeof beforePosition === "object" ? beforePosition : null;
  const afterPos = afterPosition && typeof afterPosition === "object" ? afterPosition : null;
  if (!shouldTrackTp1NativeRefreshLifecycle({
    position: beforePos || afterPos,
    refreshPlan,
    refreshResult,
  })) return null;

  const beforeMeta = beforePos && beforePos.meta && typeof beforePos.meta === "object" ? beforePos.meta : {};
  const afterMeta = afterPos && afterPos.meta && typeof afterPos.meta === "object" ? afterPos.meta : {};
  const expectedOrderId = refreshResult && refreshResult.tp_order_id ? String(refreshResult.tp_order_id) : null;
  const actualOrderId = afterMeta.native_protection_tp_order_id ? String(afterMeta.native_protection_tp_order_id) : null;
  const issues = [];

  if (refreshResult && refreshResult.ok === true) {
    if (!actualOrderId) {
      issues.push("TP1_META_SYNC_MISSING");
    } else if (expectedOrderId && actualOrderId !== expectedOrderId) {
      issues.push("TP1_META_SYNC_ORDER_ID_MISMATCH");
    }
    if (String(afterMeta.native_protection_tp_status || "").toUpperCase() !== "OK") {
      issues.push("TP1_META_SYNC_STATUS_NOT_OK");
    }
  }

  return {
    exchange: "BINANCEFUT",
    symbol: String(symbol || beforePos && (beforePos.symbol_or_pair_id || beforePos.symbol) || afterPos && (afterPos.symbol_or_pair_id || afterPos.symbol) || "").toUpperCase() || null,
    tf: String(tf || "").trim() || null,
    simplified_exit_v2_enabled: isSimplifiedExitV2Position(afterPos || beforePos),
    refresh_ok: refreshResult ? refreshResult.ok === true : null,
    refresh_reason: refreshResult && refreshResult.reason ? String(refreshResult.reason) : null,
    refresh_needs_tp: !!(refreshPlan && refreshPlan.needsTp === true),
    before_tp_order_id: beforeMeta.native_protection_tp_order_id || null,
    before_tp_status: beforeMeta.native_protection_tp_status ? String(beforeMeta.native_protection_tp_status).toUpperCase() : null,
    refresh_tp_order_id: expectedOrderId,
    refresh_tp_status: refreshResult && refreshResult.tp_status ? String(refreshResult.tp_status).toUpperCase() : null,
    after_tp_order_id: actualOrderId,
    after_tp_status: afterMeta.native_protection_tp_status ? String(afterMeta.native_protection_tp_status).toUpperCase() : null,
    after_tp_price: Number.isFinite(Number(afterMeta.native_protection_tp_price)) ? Number(afterMeta.native_protection_tp_price) : null,
    after_tp_qty_ratio: Number.isFinite(Number(afterMeta.native_protection_tp_qty_ratio)) ? Number(afterMeta.native_protection_tp_qty_ratio) : null,
    meta_sync_ok: issues.length === 0,
    issue_codes: issues,
  };
}

function shouldSendTp1MetaSyncGapAlert({ symbol, issueCodes = [] } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    Array.isArray(issueCodes) ? issueCodes.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean).sort().join(",") : "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tp1MetaSyncGapAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP1_META_SYNC_GAP_ALERT_COOLDOWN_MS) return false;
  tp1MetaSyncGapAlertState.set(key, now);
  // 2026-04-28 Step 8 — defensive cap; key combines symbol + sorted
  // issue-code CSV so cardinality could grow if issue-code enum widens.
  applyAlertCacheCap(tp1MetaSyncGapAlertState, TP1_META_SYNC_GAP_ALERT_COOLDOWN_MS);
  return true;
}

function resolveTp1NativeProtectionGap({
  symbol,
  tf = null,
  position = null,
  refreshPlan = null,
  nativeProtectionState = null,
  now = nowMs(),
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const normalizedSymbol = String(symbol || pos && (pos.symbol_or_pair_id || pos.symbol) || "").trim().toUpperCase() || null;
  if (!normalizedSymbol) return { active: false, reason: "NO_SYMBOL" };
  const meta = pos && pos.meta && typeof pos.meta === "object" ? pos.meta : {};
  const shouldTrack = shouldTrackTp1NativeRefreshLifecycle({
    position: pos,
    refreshPlan,
  });
  const tpActive = nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
    ? nativeProtectionState.tpActive
    : hasNativeTpProtection(meta);
  const needsTp = !!(refreshPlan && refreshPlan.needsTp === true);
  if (!shouldTrack || !needsTp || tpActive === true) {
    tp1NativeProtectionGapState.delete(normalizedSymbol);
    return {
      active: false,
      reason: tpActive === true ? "TP_ACTIVE" : (needsTp ? "TRACKING_DISABLED" : "TP_NOT_REQUIRED"),
      symbol: normalizedSymbol,
      tf: String(tf || "").trim() || null,
    };
  }

  const state = tp1NativeProtectionGapState.get(normalizedSymbol);
  const refreshAtMs = Number(meta.native_protection_refresh_at_ms);
  const pendingAtMs = Number(meta.tp_p1_pending_at_ms);
  const seedMs = Number.isFinite(Number(state && state.since_ms))
    ? Number(state.since_ms)
    : (Number.isFinite(refreshAtMs) && refreshAtMs > 0
      ? refreshAtMs
      : (Number.isFinite(pendingAtMs) && pendingAtMs > 0 ? pendingAtMs : now));
  const sinceMs = Math.min(seedMs, now);
  const ageMs = Math.max(0, now - sinceMs);
  const issueCodes = [];
  if (needsTp) {
    issueCodes.push("NATIVE_TP_MISSING");
  }
  if (refreshPlan && refreshPlan.reason) {
    issueCodes.push(String(refreshPlan.reason).trim().toUpperCase());
  }
  if (ageMs >= TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS) {
    issueCodes.push("TP1_NATIVE_GAP_STALE");
  }
  const payload = {
    active: true,
    escalated: ageMs >= TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS,
    exchange: "BINANCEFUT",
    symbol: normalizedSymbol,
    tf: String(tf || "").trim() || null,
    simplified_exit_v2_enabled: isSimplifiedExitV2Position(pos),
    canonical_exit_stage: resolveCanonicalExitStageForPosition(pos),
    gap_since_ms: sinceMs,
    gap_age_ms: ageMs,
    escalation_ms: TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS,
    issue_codes: Array.from(new Set(issueCodes.filter(Boolean))),
    refresh_reason: refreshPlan && refreshPlan.reason ? String(refreshPlan.reason).trim().toUpperCase() : null,
    native_refresh_status: meta.native_protection_refresh_status ? String(meta.native_protection_refresh_status).trim().toUpperCase() : null,
    native_refresh_at_ms: Number.isFinite(refreshAtMs) ? refreshAtMs : null,
    tp_p1_pending: meta.tp_p1_pending === true,
  };
  tp1NativeProtectionGapState.set(normalizedSymbol, {
    since_ms: sinceMs,
    updated_at_ms: now,
  });
  return payload;
}

function shouldSendTp1NativeProtectionGapAlert({ symbol, issueCodes = [] } = {}) {
  const key = [
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    Array.isArray(issueCodes) ? issueCodes.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean).sort().join(",") : "UNKNOWN",
  ].join(":");
  const now = nowMs();
  const last = Number(tp1NativeProtectionGapAlertState.get(key));
  if (Number.isFinite(last) && (now - last) < TP1_NATIVE_PROTECTION_GAP_ALERT_COOLDOWN_MS) return false;
  tp1NativeProtectionGapAlertState.set(key, now);
  return true;
}

function buildTp1NativeProtectionGapAlertPayload({
  symbol,
  tf = null,
  telemetry = null,
} = {}) {
  const row = telemetry && typeof telemetry === "object" ? telemetry : {};
  const normalizedSymbol = String(symbol || row.symbol || "").trim().toUpperCase() || "UNKNOWN";
  const issueCodes = Array.isArray(row.issue_codes) ? row.issue_codes : [];
  const lines = [
    "reason: TP1_NATIVE_PROTECTION_GAP",
    "phase: TP1_NATIVE_PROTECTION_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || row.tf || "-")}`,
    `canonical_stage: ${String(row.canonical_exit_stage || "N/A")}`,
    `gap_age_ms: ${Number.isFinite(Number(row.gap_age_ms)) ? Number(row.gap_age_ms) : 0}`,
    `escalation_ms: ${Number.isFinite(Number(row.escalation_ms)) ? Number(row.escalation_ms) : TP1_NATIVE_PROTECTION_GAP_ESCALATION_MS}`,
    `refresh_reason: ${String(row.refresh_reason || "N/A")}`,
    `native_refresh_status: ${String(row.native_refresh_status || "N/A")}`,
    `issue_codes: ${issueCodes.length ? issueCodes.join(",") : "NONE"}`,
  ];
  return {
    title: `[V2 긴급] ${normalizedSymbol} TP1 native protection gap`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

async function sendTp1NativeProtectionGapAlert({
  symbol,
  tf = null,
  telemetry = null,
} = {}) {
  const issueCodes = telemetry && Array.isArray(telemetry.issue_codes) ? telemetry.issue_codes : [];
  if (!shouldSendTp1NativeProtectionGapAlert({ symbol, issueCodes })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTp1NativeProtectionGapAlertPayload({ symbol, tf, telemetry });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_NATIVE_PROTECTION_GAP_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

async function requestTp1NativeProtectionGapRepair({
  symbol,
  tf = null,
  telemetry = null,
  recordRepairRequest = recordExitRepairRequest,
  triggerRepairRun = triggerExitWorkerRun,
} = {}) {
  const normalizedSymbol = String(symbol || telemetry && telemetry.symbol || "").trim().toUpperCase() || "UNKNOWN";
  const runId = `RUN__TP1_NATIVE_PROTECTION_GAP__BINANCEFUT__${normalizedSymbol}__${Date.now()}`;
  const issueCodes = telemetry && Array.isArray(telemetry.issue_codes) ? telemetry.issue_codes : [];
  const request = await recordRepairRequest({
    exchange: "BINANCEFUT",
    symbol: normalizedSymbol,
    source: "BINANCE_TICK_EXIT",
    requestKind: "TP1_NATIVE_PROTECTION_REPAIR",
    reason: "TP1_NATIVE_PROTECTION_GAP",
    runId,
    dedupeKey: `BINANCEFUT__${normalizedSymbol}__TICK_EXIT__TP1_NATIVE_PROTECTION_REPAIR`,
    payload: {
      tf: String(tf || telemetry && telemetry.tf || "").trim() || null,
      issue_codes: issueCodes,
      gap_since_ms: telemetry && Number.isFinite(Number(telemetry.gap_since_ms)) ? Number(telemetry.gap_since_ms) : null,
      gap_age_ms: telemetry && Number.isFinite(Number(telemetry.gap_age_ms)) ? Number(telemetry.gap_age_ms) : null,
      refresh_reason: telemetry && telemetry.refresh_reason ? String(telemetry.refresh_reason) : null,
    },
  });
  const triggerResult = await triggerRepairRun({
    reason: `TP1_NATIVE_PROTECTION_REPAIR_BINANCEFUT_${normalizedSymbol}`,
    dispatchOnly: true,
    timeoutMs: 5000,
    targetSymbols: [normalizedSymbol],
    targetExchange: "BINANCEFUT",
  }).catch((error) => ({
    ok: false,
    skipped: true,
    reason: "EXIT_WORKER_TRIGGER_FETCH_FAIL",
    error: error && error.message ? error.message : String(error),
  }));
  return {
    ok: false,
    skipped: true,
    reason: "TP1_NATIVE_PROTECTION_REPAIR_REQUESTED",
    request_id: request && request.exit_repair_request_id ? request.exit_repair_request_id : null,
    dispatch_ok: triggerResult && triggerResult.ok === true,
    dispatch_reason: triggerResult && triggerResult.reason ? String(triggerResult.reason) : null,
    dispatch_error: triggerResult && triggerResult.error ? String(triggerResult.error) : null,
  };
}

async function handleTp1NativeProtectionGap({
  symbol,
  tf = null,
  telemetry = null,
  sendAlertFn = sendTp1NativeProtectionGapAlert,
  requestRepairFn = requestTp1NativeProtectionGapRepair,
} = {}) {
  const row = telemetry && typeof telemetry === "object" ? telemetry : null;
  if (!row || row.active !== true || row.escalated !== true) {
    return { ok: true, skipped: true, reason: "NO_NATIVE_PROTECTION_GAP" };
  }
  const issueCodes = Array.isArray(row.issue_codes) ? row.issue_codes : [];
  const alertResult = await sendAlertFn({
    symbol,
    tf,
    telemetry: row,
  });
  const repairResult = await requestRepairFn({
    symbol,
    tf,
    telemetry: row,
  });
  return {
    ok: false,
    skipped: false,
    reason: "TP1_NATIVE_PROTECTION_GAP",
    issue_codes: issueCodes,
    alert_ok: alertResult && alertResult.ok === true,
    alert_reason: alertResult && alertResult.reason ? String(alertResult.reason) : null,
    repair_reason: repairResult && repairResult.reason ? String(repairResult.reason) : null,
    request_id: repairResult && repairResult.request_id ? String(repairResult.request_id) : null,
    dispatch_ok: repairResult && repairResult.dispatch_ok === true,
  };
}

function buildTp1MetaSyncGapAlertPayload({
  symbol,
  tf = null,
  telemetry = null,
} = {}) {
  const row = telemetry && typeof telemetry === "object" ? telemetry : {};
  const normalizedSymbol = String(symbol || row.symbol || "").trim().toUpperCase() || "UNKNOWN";
  const issueCodes = Array.isArray(row.issue_codes) ? row.issue_codes : [];
  const lines = [
    "reason: TP1_META_SYNC_GAP",
    "phase: TP1_META_SYNC_WATCHDOG",
    `symbol: ${normalizedSymbol}`,
    `tf: ${String(tf || row.tf || "-")}`,
    `refresh_ok: ${row.refresh_ok === true ? "1" : "0"}`,
    `refresh_needs_tp: ${row.refresh_needs_tp === true ? "1" : "0"}`,
    `refresh_tp_order_id: ${String(row.refresh_tp_order_id || "N/A")}`,
    `after_tp_order_id: ${String(row.after_tp_order_id || "N/A")}`,
    `after_tp_status: ${String(row.after_tp_status || "N/A")}`,
    `issue_codes: ${issueCodes.length ? issueCodes.join(",") : "NONE"}`,
  ];
  return {
    title: `[V2 긴급] ${normalizedSymbol} TP1 meta sync gap`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

async function sendTp1MetaSyncGapAlert({
  symbol,
  tf = null,
  telemetry = null,
} = {}) {
  const issueCodes = telemetry && Array.isArray(telemetry.issue_codes) ? telemetry.issue_codes : [];
  if (!shouldSendTp1MetaSyncGapAlert({ symbol, issueCodes })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  const payload = buildTp1MetaSyncGapAlertPayload({ symbol, tf, telemetry });
  try {
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (err) {
    console.warn("[TP1_META_SYNC_GAP_ALERT_FAIL]", err && err.message ? err.message : String(err));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

async function requestTp1MetaSyncGapRepair({
  symbol,
  tf = null,
  telemetry = null,
  recordRepairRequest = recordExitRepairRequest,
  triggerRepairRun = triggerExitWorkerRun,
} = {}) {
  const normalizedSymbol = String(symbol || telemetry && telemetry.symbol || "").trim().toUpperCase() || "UNKNOWN";
  const runId = `RUN__TP1_META_SYNC_GAP__BINANCEFUT__${normalizedSymbol}__${Date.now()}`;
  const issueCodes = telemetry && Array.isArray(telemetry.issue_codes) ? telemetry.issue_codes : [];
  const request = await recordRepairRequest({
    exchange: "BINANCEFUT",
    symbol: normalizedSymbol,
    source: "BINANCE_TICK_EXIT",
    requestKind: "TP1_META_SYNC_REPAIR",
    reason: "TP1_META_SYNC_GAP",
    runId,
    dedupeKey: `BINANCEFUT__${normalizedSymbol}__TICK_EXIT__TP1_META_SYNC_REPAIR`,
    payload: {
      tf: String(tf || telemetry && telemetry.tf || "").trim() || null,
      issue_codes: issueCodes,
      refresh_tp_order_id: telemetry && telemetry.refresh_tp_order_id ? String(telemetry.refresh_tp_order_id) : null,
      after_tp_order_id: telemetry && telemetry.after_tp_order_id ? String(telemetry.after_tp_order_id) : null,
      after_tp_status: telemetry && telemetry.after_tp_status ? String(telemetry.after_tp_status) : null,
    },
  });
  const triggerResult = await triggerRepairRun({
    reason: `TP1_META_SYNC_REPAIR_BINANCEFUT_${normalizedSymbol}`,
    dispatchOnly: true,
    timeoutMs: 5000,
    targetSymbols: [normalizedSymbol],
    targetExchange: "BINANCEFUT",
  }).catch((error) => ({
    ok: false,
    skipped: true,
    reason: "EXIT_WORKER_TRIGGER_FETCH_FAIL",
    error: error && error.message ? error.message : String(error),
  }));
  return {
    ok: false,
    skipped: true,
    reason: "TP1_META_SYNC_REPAIR_REQUESTED",
    request_id: request && request.exit_repair_request_id ? request.exit_repair_request_id : null,
    dispatch_ok: triggerResult && triggerResult.ok === true,
    dispatch_reason: triggerResult && triggerResult.reason ? String(triggerResult.reason) : null,
    dispatch_error: triggerResult && triggerResult.error ? String(triggerResult.error) : null,
  };
}

async function handleTp1MetaSyncGap({
  symbol,
  tf = null,
  telemetry = null,
  sendAlertFn = sendTp1MetaSyncGapAlert,
  requestRepairFn = requestTp1MetaSyncGapRepair,
} = {}) {
  const row = telemetry && typeof telemetry === "object" ? telemetry : null;
  if (!row || row.meta_sync_ok === true) {
    return { ok: true, skipped: true, reason: "NO_META_SYNC_GAP" };
  }
  const issueCodes = Array.isArray(row.issue_codes) ? row.issue_codes : [];
  const alertResult = await sendAlertFn({
    symbol,
    tf,
    telemetry: row,
  });
  const repairResult = await requestRepairFn({
    symbol,
    tf,
    telemetry: row,
  });
  return {
    ok: false,
    skipped: false,
    reason: "TP1_META_SYNC_GAP",
    issue_codes: issueCodes,
    alert_ok: alertResult && alertResult.ok === true,
    alert_reason: alertResult && alertResult.reason ? String(alertResult.reason) : null,
    repair_reason: repairResult && repairResult.reason ? String(repairResult.reason) : null,
    request_id: repairResult && repairResult.request_id ? String(repairResult.request_id) : null,
    dispatch_ok: repairResult && repairResult.dispatch_ok === true,
  };
}

function isNativeStopLessProtectiveThanTrigger({ meta, triggerPrice, side } = {}) {
  const trg = Number(triggerPrice);
  if (!Number.isFinite(trg) || trg <= 0) return false;
  const stopPrice = Number(meta && meta.native_protection_stop_price);
  if (!Number.isFinite(stopPrice) || stopPrice <= 0) return true;
  const sideUpper = String(side || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const tolerance = Math.max(trg * 0.0001, 1e-8);
  if (sideUpper === "SHORT") {
    return stopPrice > (trg + tolerance);
  }
  return stopPrice < (trg - tolerance);
}

function normalizeOrderType(order) {
  return String(order && (order.type || order.origType || order.orderType || order.algoType) || "").toUpperCase();
}

function normalizeOrderId(order) {
  const raw = order && (order.orderId ?? order.order_id ?? order.algoId ?? order.algo_id);
  return String(raw == null ? "" : raw).trim();
}

function toOrderBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "on";
}

function matchesProtectionOrder(order, { kind, closeSide, targetOrderId } = {}) {
  const type = normalizeOrderType(order);
  const side = String(order && order.side || "").toUpperCase();
  const orderId = normalizeOrderId(order);
  const reduceOnly = toOrderBool(order && order.reduceOnly);
  const closePosition = toOrderBool(order && order.closePosition);
  const typeOk = kind === "STOP"
    ? (type === "STOP_MARKET" || type === "STOP")
    : (type === "TAKE_PROFIT_MARKET" || type === "TAKE_PROFIT");
  if (!typeOk) return false;
  if (closeSide && side && side !== closeSide) return false;
  if (targetOrderId && orderId && orderId === String(targetOrderId).trim()) return true;
  return reduceOnly || closePosition || !targetOrderId;
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

async function fetchOrderByAnyId({ apiKey, apiSecret, symbol, orderId, skipAlgo = false } = {}) {
  const id = String(orderId || "").trim();
  if (!apiKey || !apiSecret || !symbol || !id) return null;
  try {
    return await fetchFuturesOrder({ apiKey, apiSecret, symbol, orderId: id });
  } catch (_) {}
  if (skipAlgo) return null;
  try {
    return await fetchFuturesAlgoOrder({ apiKey, apiSecret, symbol, algoId: id });
  } catch (_) {}
  return null;
}

async function resolveLiveNativeProtectionState({ exCfg, symbol, pos } = {}) {
  const sym = String(symbol || pos && (pos.symbol_or_pair_id || pos.symbol) || "").toUpperCase();
  if (!sym) return null;
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const metaStopActive = hasNativeStopProtection(meta);
  const metaTpActive = hasNativeTpProtection(meta);
  if (!metaStopActive && !metaTpActive) return null;

  const cacheKey = sym;
  const now = nowMs();
  const cached = nativeProtectionStateCache.get(cacheKey);
  if (!shouldBypassNativeProtectionCache({
    cached,
    refreshAtMs: meta.native_protection_refresh_at_ms,
    now,
  })) return cached.value;

  const apiKey = String(process.env.BINANCEFUT_API_KEY || exCfg && exCfg.api_key || "").trim();
  const apiSecret = String(process.env.BINANCEFUT_API_SECRET || exCfg && exCfg.api_secret || "").trim();
  if (!apiKey || !apiSecret) {
    const fallback = { stopActive: false, tpActive: false, verify_error: "BINANCE_KEYS_MISSING" };
    nativeProtectionStateCache.set(cacheKey, {
      checkedAt: now,
      expiresAt: now + TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS,
      value: fallback,
    });
    return fallback;
  }

  const positionSide = resolvePositionSideFromPosition(pos, meta, "LONG");
  const closeSide = resolveCloseSide(positionSide);
  let regularOrders = [];
  let algoOrders = [];
  let verifyError = null;
  let algoEndpointUnavailable = false;

  try {
    const fetched = await fetchFuturesOpenOrders({ apiKey, apiSecret, symbol: sym });
    regularOrders = Array.isArray(fetched) ? fetched : [];
  } catch (e) {
    verifyError = `OPEN_ORDERS_FETCH_FAIL:${String(e && e.message ? e.message : e).slice(0, 120)}`;
  }
  try {
    const fetched = await fetchFuturesAlgoOpenOrders({ apiKey, apiSecret, symbol: sym });
    const normalized = normalizeAlgoOrderFetchResult(fetched);
    algoOrders = normalized.orders;
    algoEndpointUnavailable = normalized.endpointUnavailable === true;
    if (algoEndpointUnavailable) {
      verifyError = verifyError || String(normalized.note || "ALGO_ENDPOINT_UNAVAILABLE");
    }
  } catch (e) {
    verifyError = verifyError || `ALGO_OPEN_ORDERS_FETCH_FAIL:${String(e && e.message ? e.message : e).slice(0, 120)}`;
  }

  const stopOrderId = String(meta.native_protection_stop_order_id || "").trim();
  const tpOrderId = String(meta.native_protection_tp_order_id || "").trim();
  let stopActive = false;
  let tpActive = false;

  const allOrders = [...regularOrders, ...algoOrders];
  stopActive = allOrders.some((order) => matchesProtectionOrder(order, {
    kind: "STOP",
    closeSide,
    targetOrderId: stopOrderId || null,
  }));
  tpActive = allOrders.some((order) => matchesProtectionOrder(order, {
    kind: "TP",
    closeSide,
    targetOrderId: tpOrderId || null,
  }));

  if (!stopActive && stopOrderId) {
    const ord = await fetchOrderByAnyId({ apiKey, apiSecret, symbol: sym, orderId: stopOrderId, skipAlgo: algoEndpointUnavailable });
    if (ord) stopActive = matchesProtectionOrder(ord, { kind: "STOP", closeSide, targetOrderId: stopOrderId });
  }
  if (!tpActive && tpOrderId) {
    const ord = await fetchOrderByAnyId({ apiKey, apiSecret, symbol: sym, orderId: tpOrderId, skipAlgo: algoEndpointUnavailable });
    if (ord) tpActive = matchesProtectionOrder(ord, { kind: "TP", closeSide, targetOrderId: tpOrderId });
  }

  const value = {
    stopActive,
    tpActive,
    verify_error: verifyError,
  };
  nativeProtectionStateCache.set(cacheKey, {
    checkedAt: now,
    expiresAt: now + TICK_EXIT_NATIVE_PROTECTION_VERIFY_TTL_MS,
    value,
  });
  return value;
}

function computeExitTriggers({ pos, rules, leverageEff, nativeProtectionState } = {}) {
  const out = [];
  const avg = Number(pos && pos.avg_price);
  if (!Number.isFinite(avg) || avg <= 0) return out;
  const meta = pos && pos.meta ? pos.meta : {};
  const side = resolvePositionSideFromPosition(pos, meta, "LONG");
  const runnerStage = resolveRunnerStageState(pos);
  const tpP1Done = runnerStage.tpP1Done;
  const tpP1Pending = meta.tp_p1_pending === true;
  const nativeStopActive = nativeProtectionState && typeof nativeProtectionState.stopActive === "boolean"
    ? nativeProtectionState.stopActive
    : hasNativeStopProtection(meta);
  const nativeTpActive = nativeProtectionState && typeof nativeProtectionState.tpActive === "boolean"
    ? nativeProtectionState.tpActive
    : hasNativeTpProtection(meta);

  if (!nativeStopActive) {
    const slPx = pnlToPrice({ avg, pnlPct: Number(rules.SL) / leverageEff, side });
    if (Number.isFinite(slPx)) out.push({ kind: "SL", price: slPx });
  }

  if (!tpP1Done && !tpP1Pending && !nativeTpActive) {
    const tp1Px = pnlToPrice({ avg, pnlPct: Number(rules.TP_P1) / leverageEff, side });
    if (Number.isFinite(tp1Px)) out.push({ kind: "TP_P1", price: tp1Px });
  }

  if (Number.isFinite(rules.TP_C)) {
    const tpCPx = pnlToPrice({ avg, pnlPct: Number(rules.TP_C) / leverageEff, side });
    if (Number.isFinite(tpCPx)) out.push({ kind: "TP_C", price: tpCPx });
  }

  // 2026-04-28 — BE trigger root-cause fix.
  //
  // The BE ("break-even") semantics defined by the strategy is: AFTER
  // TP1 has been reached, the stop is moved to break-even so the
  // remaining runner cannot turn into a loss. It is NOT a stand-alone
  // exit signal that fires on entry.
  //
  // Until this guard, computeExitTriggers always pushed { kind: "BE",
  // price: entry_avg ± bePct } regardless of whether TP1 had been
  // reached. With the default bePct (= -(feeBps + slippageBps)*2 *
  // leverage / 10000 ≈ -0.18% to -0.54% depending on leverage), the
  // BE price sits a few ticks on the loss side of entry. Any tick of
  // unfavorable noise immediately after entry crossed that price and
  // the fast-lane fired BE → V2 direct exit dispatch → reduceOnly
  // close → position auto-closed within seconds of entry.
  //
  // Production evidence (2026-04-28 12:31-12:33 UTC, BE auto-close
  // chain on BTCUSDT/ETHUSDT/LINKUSDT — and the same pattern at 10:17
  // UTC well before any V2 server-native generator existed, ruling
  // out the F2 path as the cause): every entry was being chopped.
  //
  // Fix: gate the BE trigger on tpP1Done === true. SL/TP_P1/TP_C/TRAIL
  // semantics already gate themselves correctly; BE was the outlier.
  if (tpP1Done) {
    const bePct = computeBePct(rules, leverageEff, pos.exchange);
    if (Number.isFinite(bePct)) {
      const bePx = pnlToPrice({ avg, pnlPct: Number(bePct) / leverageEff, side });
      if (Number.isFinite(bePx)) out.push({ kind: "BE", price: bePx });
    }
  }

  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs: Date.now(),
    closePx: null,
    side,
    leverageEff,
    rules,
  });
  const trailEnabled = runnerStage.trailStage || trailDelay.trailActive;
  if (tpP1Done && trailEnabled && (Number.isFinite(rules.TRAIL_R_MULTIPLE) || Number.isFinite(rules.TRAIL_PCT))) {
    const runnerExit = computeRunnerExitStopPrice({
      avg,
      leverageEff,
      side,
      rules,
      tpP1Done,
      trailActive: runnerStage.trailStage,
      trailHigh: Number(meta.trail_high),
      trailLow: Number(meta.trail_low),
      entryRDistance: Number(meta.entry_r_distance),
    });
    if (Number.isFinite(runnerExit.stopPrice)) {
      out.push({ kind: "TRAIL", price: runnerExit.stopPrice, source: runnerExit.stopSource });
    }
  }

  return out;
}

function shouldCheckNear({ price, triggers, nearPct, side }) {
  return collectTriggeredKinds({ price, triggers, nearPct, side }).length > 0;
}

function collectTriggeredKinds({ price, triggers, nearPct, side }) {
  if (!Number.isFinite(price) || !Array.isArray(triggers) || !triggers.length) return [];
  const pct = Number(nearPct);
  const sideUpper = String(side || "LONG").toUpperCase();
  const kinds = [];

  triggers.forEach((t) => {
    const trg = Number(t && t.price);
    const kind = String(t && t.kind || "").toUpperCase();
    if (!Number.isFinite(trg) || trg <= 0) return;

    // 가격이 이미 트리거를 통과한 경우(급등/급락)는 nearPct와 무관하게 즉시 검사
    const isTakeProfit = kind === "TP_P1" || kind === "TP_C";
    const crossed = sideUpper === "SHORT"
      ? (isTakeProfit ? (price <= trg) : (price >= trg))
      : (isTakeProfit ? (price >= trg) : (price <= trg));
    if (crossed) {
      kinds.push(kind);
      return;
    }

    if (!Number.isFinite(pct) || pct <= 0) return;
    const diff = Math.abs((price - trg) / trg);
    if (diff <= pct) kinds.push(kind);
  });

  return Array.from(new Set(kinds));
}

function shouldActivateFastLane({ pos, price, triggers, fastLanePct, side } = {}) {
  if (!pos || !Number.isFinite(price) || !Array.isArray(triggers) || !triggers.length) return false;
  const pct = Number(fastLanePct);
  if (!Number.isFinite(pct) || pct <= 0) return false;
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const runnerStage = resolveRunnerStageState(pos);
  const tpP1Done = runnerStage.tpP1Done;
  const rules = resolveExitRulesForPosition({ exchange: pos.exchange, position: pos });
  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs: Date.now(),
    closePx: price,
    side,
    leverageEff: Number(meta.external_leverage || pos.leverage || 1),
    rules,
  });
  const trailEnabled = runnerStage.trailStage || trailDelay.trailActive;
  const trailReady = tpP1Done;
  if (!trailReady || !trailEnabled) return false;

  const trailTrigger = triggers.find((t) => String(t && t.kind || "").toUpperCase() === "TRAIL");
  const trg = Number(trailTrigger && trailTrigger.price);
  if (!Number.isFinite(trg) || trg <= 0) return false;

  const sideUpper = resolvePositionSideFromPosition(
    { position_side: side || pos.position_side || pos.side },
    meta,
    "LONG"
  );
  const crossed = sideUpper === "SHORT" ? (price >= trg) : (price <= trg);
  if (crossed) return true;

  const diff = Math.abs((price - trg) / trg);
  return diff <= pct;
}

async function runBinanceTickExitOnce({ nearPct, symbolCooldownMs, targetSymbols = null } = {}) {
  const exCfg = await getExchangeSettingsForProvider("BINANCEFUT", 2000);
  if (!exCfg || exCfg.enabled === false) return { ok: false, skipped: true, reason: "BINANCE_DISABLED" };
  const normalizedTargetSymbols = normalizeTargetSymbols(targetSymbols);
  const symbolsToCheck = resolveTickExitSymbolsToCheck({
    exCfg,
    targetSymbols: normalizedTargetSymbols,
  });
  if (!symbolsToCheck.length) {
    return {
      ok: false,
      skipped: true,
      reason: normalizedTargetSymbols.length ? "NO_TARGET_MARKETS" : "NO_MARKETS",
      target_symbols: normalizedTargetSymbols,
    };
  }

  const positionMap = await getPositionReadViewsBySymbols({
    exchange: "BINANCEFUT",
    symbols: symbolsToCheck,
  }).catch(() => ({}));
  const positions = symbolsToCheck.map((symbol) => positionMap[symbol] || null);
  const activeRaw = positions.filter((p) => {
    const size = Number(p && p.size_pct);
    const state = String(p && p.state || "").toUpperCase();
    return Number.isFinite(size) && size > 0 && state !== "FLAT";
  });
  // 2026-04-29 ROOT-CAUSE (R1) — exclude symbols whose V2 direct exit
  // dispatch we just successfully placed. The Firestore read view lags
  // fillSync by up to 3 minutes; without this filter the next tick
  // would re-evaluate the same TRAIL/SL/BE trigger and dispatch a
  // duplicate reduceOnly order that Binance rejects with -2022. The
  // `exitInFlightState` Map carries a 30 s TTL safety net so a stuck
  // ack can't permanently inhibit the symbol.
  const active = [];
  for (const p of activeRaw) {
    const sym = String(p.symbol_or_pair_id || p.symbol || "").trim().toUpperCase();
    if (sym && isExitInFlight(sym)) {
      const rec = getExitInFlightRecord(sym);
      structuredLog("tick_exit_skip_exit_in_flight", {
        exchange: "BINANCEFUT",
        symbol: sym,
        in_flight_run_id: rec && rec.runId,
        in_flight_placed_at: rec && rec.placedAt,
        in_flight_age_ms: rec && Number.isFinite(rec.placedAt) ? (Date.now() - rec.placedAt) : null,
        in_flight_fraction: rec && rec.fraction,
        in_flight_triggered_kinds: rec && rec.triggeredKinds,
        in_flight_source: rec && rec.source,
        ttl_ms: EXIT_IN_FLIGHT_TTL_MS,
        note: "Skipping trigger evaluation — V2 direct exit dispatch already placed; Firestore read view is stale until fillSync catches up.",
      });
      continue;
    }
    active.push(p);
  }
  if (!active.length) return { ok: true, checked: 0, triggered: 0 };

  // 2026-04-29 ROOT-CAUSE (R2) — Broker truth pre-filter. Even if the
  // local read view shows ACTIVE and we have no in-flight inhibit, the
  // broker may already be flat (native STOP_MARKET filled, manual
  // close, or fillSync hasn't yet propagated a recent close). Without
  // this guard we'd dispatch a reduceOnly close into a flat position
  // and the broker would answer -2022. Skip such symbols up front,
  // clear any leftover in-flight inhibit, and let fillSync reconcile
  // the local view at its own cadence.
  try {
    const sampleSymbol = active[0] && String(active[0].symbol_or_pair_id || active[0].symbol || "").trim().toUpperCase();
    const liveCfg = sampleSymbol
      ? await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol: sampleSymbol }).catch(() => null)
      : null;
    if (liveCfg && liveCfg.apiKey && liveCfg.apiSecret && !liveCfg.liveDryRun) {
      const snapshot = await getBrokerPositionSnapshot({ liveCfg }).catch((e) => {
        structuredLog("tick_exit_broker_snapshot_fetch_fail", {
          exchange: "BINANCEFUT",
          error: e && e.message ? e.message : String(e),
          note: "Falling through without broker pre-filter; R1 in-flight inhibit and (legacy) reject cooldown remain in effect.",
        }, "warn");
        return null;
      });
      if (snapshot && snapshot.byMap && snapshot.byMap.size) {
        const filtered = [];
        for (const p of active) {
          const sym = String(p.symbol_or_pair_id || p.symbol || "").trim().toUpperCase();
          const rec = sym ? snapshot.byMap.get(sym) : null;
          // Only skip on a *positive* observation that the broker is
          // flat. If the symbol isn't in the snapshot at all (newly
          // listed, hedge-mode quirk, dual-side variant, etc.) we
          // fall through to the legacy path and let the dispatch /
          // R1 / cooldown layers handle it — no silent drops.
          if (rec && rec.isFlat === true) {
            structuredLog("tick_exit_skip_broker_flat", {
              exchange: "BINANCEFUT",
              symbol: sym,
              local_state: String(p.state || "").toUpperCase(),
              local_size_pct: Number(p.size_pct) || null,
              local_qty_base: Number(p.qty_base) || null,
              broker_position_amt: rec.positionAmt,
              broker_position_side: rec.positionSide,
              snapshot_age_ms: Date.now() - snapshot.fetchedAt,
              snapshot_ttl_ms: BROKER_POSITION_SNAPSHOT_TTL_MS,
              note: "Broker is flat for this symbol; local read view is stale. fillSync will reconcile on its next cycle.",
            });
            // Releasing any stale in-flight inhibit so that when
            // fillSync repopulates the view (e.g. after the user
            // re-opens the position), the next tick can act on it
            // without waiting out R1's 30 s TTL.
            clearExitInFlight(sym);
            continue;
          }
          filtered.push(p);
        }
        if (filtered.length !== active.length) {
          active.length = 0;
          for (const p of filtered) active.push(p);
        }
      }
    }
  } catch (preFilterErr) {
    structuredLog("tick_exit_broker_pre_filter_fail", {
      exchange: "BINANCEFUT",
      error: preFilterErr && preFilterErr.message ? preFilterErr.message : String(preFilterErr),
      note: "Pre-filter failed; falling through to legacy dispatch path with R1 in-flight inhibit.",
    }, "warn");
  }
  if (!active.length) return { ok: true, checked: 0, triggered: 0 };

  const [operationalGuard, systemSlo, systemAnomaly] = await Promise.all([
    loadOperationalGuardRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
    loadSystemSloRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
    loadSystemAnomalyRuntime({ exchange: "BINANCEFUT" }).catch(() => null),
  ]);

  const symbols = active.map((p) => String(p.symbol_or_pair_id || p.symbol || "")).filter(Boolean);
  const priceMap = await fetchBinanceFuturesPrices(symbols);

  const execTf = String(exCfg.exec_tf || "15m");
  const cooldownMs = normalizeIntervalMs(symbolCooldownMs, 20000);

  let checked = 0;
  let triggered = 0;
  let skippedCooldown = 0;
  let fastLaneActive = false;
  const fastLaneSymbols = new Set();
  for (const pos of active) {
    const symbol = String(pos.symbol_or_pair_id || pos.symbol || "");
    const price = priceMap[String(symbol).toUpperCase()];
    if (!Number.isFinite(price)) continue;

    try {
      const tickNow = nowMs();
      const signalTf = resolvePositionSignalTf({ pos, exCfg });
      try {
        await clearTerminalFailedTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_failed_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }
      try {
        await clearUnackedTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_unacked_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }
      try {
        await clearExpiredTpP1Pending({ pos, symbol, tf: signalTf, now: tickNow });
      } catch (e) {
        structuredLog("tick_exit_clear_stale_tp1_pending_error", {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          error: String(e && e.message || e).slice(0, 200),
        }, "warn");
      }

      const _tMeta = (pos && typeof pos.meta === "object") ? pos.meta : {};
      const _runnerStage = resolveRunnerStageState(pos);
      const _tpP1Done = _runnerStage.tpP1Done;
      const _trailStage = _runnerStage.trailStage;
      const _trailEnabled = _trailStage;

      // ── OpenClaw Position Conductor shadow hook ────────────────────
      // Runs the conductor's proposeAdjustment() in SHADOW-ONLY mode so
      // per-position SL/TP tighten proposals land in the evidence ledger
      // as POSITION_CONDUCTOR records. The tick loop's real stop logic
      // below is NOT affected — the conductor's proposals are recorded
      // for later review only, until OPENCLAW_CONDUCTOR_ENABLED=1
      // AND OPENCLAW_CONDUCTOR_SHADOW_ONLY=0 (Day 17 per the flip
      // sequence), at which point a separate PR can wire the proposal
      // into the actual tick-exit stop update path.
      //
      // Fire-and-forget with 3s inner timeout so conductor never blocks
      // a tick. Error logging is structured so ops/watchdog can sample.
      if (String(process.env.OPENCLAW_AGENT_SHADOW_ENABLED || "") === "1") {
        const _conductorTickNow = nowMs();
        const _conductorInput = {
          exchange: "BINANCEFUT",
          symbol: String(symbol).toUpperCase(),
          positionSnapshot: {
            side: resolvePositionSideFromPosition(pos, _tMeta, "LONG"),
            qty_base: Number(pos && pos.qty_base) || null,
            avg_price: Number(pos && pos.avg_price) || null,
            leverage: Number(_tMeta.external_leverage || _tMeta.leverage || pos.leverage || 1),
            tp_p1_done: _tpP1Done === true,
            trail_active: _trailEnabled === true,
            sl_price: Number(_tMeta.native_protection_stop_price) || null,
            tp_price: Number(_tMeta.native_protection_tp_price) || null,
            tp_p1_target_price: Number(_tMeta.tp_p1_target_price) || null,
            current_price: price,
          },
          ticks: [{ ts: _conductorTickNow, price }],
        };
        (async () => {
          const conductorTimer = setTimeout(() => {}, 3000);
          try {
            const conductor = require("./openclawPositionConductor");
            await Promise.race([
              conductor.proposeAdjustment(_conductorInput),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("CONDUCTOR_TIMEOUT")), 3000)),
            ]);
          } catch (condErr) {
            const emsg = String(condErr && condErr.message || condErr).slice(0, 200);
            if (emsg !== "CONDUCTOR_TIMEOUT") {
              structuredLog("tick_exit_conductor_shadow_error", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                error: emsg,
              }, "warn");
            }
          } finally {
            clearTimeout(conductorTimer);
          }
        })();
      }

      // ─ Break-Even floor after TP1 (trail-agnostic) ──────────────────
      // 2026-04-18 Fix #3: Previously gated on `!_trailEnabled`, but the
      // recovery path flips trail_active=true without updating the
      // native stop — which left the runner's SL sitting at the original
      // pre-TP1 level (e.g. -1.65%) even though logically trail was on.
      // The practical effect was that BE floor protection never fired on
      // recovered positions. Relaxed condition: the block runs whenever
      // TP1 is done AND the current native stop is below the BE floor,
      // regardless of trail state. If trail is armed and has already
      // pushed the stop above BE, `_shouldRaiseStop` short-circuits and
      // nothing happens. If trail is armed but stop is still at the
      // original SL (classic recovery case), we raise to BE here.
      //
      // Safety: this block never lowers a stop — it only moves stops up
      // (LONG) or down (SHORT) toward BE. The trail watermark update
      // path below handles later tightening above BE when the watermark
      // moves.
      if (_tpP1Done) {
        // Diagnostic: emit a single decision log line per tick so Cloud
        // Logging can answer "why didn't BE-raise fire on <symbol>?" at a
        // glance. 2026-04-18 root-cause dive — we saw DOGE/BTC stuck with
        // native_stop well below RUNNER_FLOOR even with tp_p1_done=true,
        // but no existing log revealed which guard short-circuited. The
        // `decision_stage` field locks this in: INPUT_INVALID →
        // RAISE_NOT_NEEDED → COOLDOWN_HELD → REFRESH_DISPATCHED → ERROR.
        //
        // 2026-04-18 follow-up (BTCUSDT 27-min blackout): the decision
        // log was emitted INSIDE the try, so any throw from the refresh
        // path (Firestore contention, egress timeout) ate the diagnostic
        // trail. Now the decision log always emits — refactored to store
        // state in outer-scope vars so the catch branch can still log a
        // meaningful `decision_stage: ERROR` line with whatever inputs
        // were captured before the throw.
        let _beSide = null;
        let _beAvg = null;
        let _beLev = null;
        let _beFloorPct = null;
        let _currentStop = null;
        let _inputsValid = false;
        let _bePrice = null;
        let _shouldRaiseStop = false;
        let _cooldownPassed = false;
        let _decisionStage = "INPUT_INVALID";
        let _beRefreshRes = null;
        let _beError = null;
        let _beErrorStack = null;
        // 2026-04-19: transient-Firestore retry context for the BE-raise path.
        // Production surfaced two consecutive BE-raise failures on the same
        // BTCUSDT SHORT position (19:20 `10 ABORTED` contention; 20:17
        // `14 UNAVAILABLE` TLS drop), both before `refreshBinanceNative
        // ProtectionWithRetry` could return a structured result — so the
        // P0-1 observability logged `refresh_ok: null`. Both failure classes
        // are standard transient Firestore infra errors that the client
        // SDK expects callers to retry. Context object below captures the
        // retry stats from `withTransientFirestoreRetry` so the decision
        // log can report `firestore_retry_attempts` / `firestore_retry_
        // terminal_code` — operators can now tell "retry worked" from
        // "retry exhausted" from "non-transient failure" at a glance.
        const _beRetryCtx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
        try {
          _beSide = resolvePositionSideFromPosition(pos, _tMeta, "LONG");
          const _beRules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: pos });
          // 2026-04-19 REFACTOR: pure 계산은 `computeBreakEvenRaiseDecision`
          // 으로 이관. 호출부는 decision 결과를 기존 outer-scope 로컬 변수에
          // 그대로 할당해 이후 cooldown/refresh dispatch 와 decision 로그
          // emit 경로의 이름 규약을 유지 (BE-raise 로직의 어떤 관측 필드도
          // 이름이 바뀌지 않음 — Cloud Logging 쿼리 호환).
          //
          // Raise 방향 불변식은 helper 내부에 박혀있다:
          //   - LONG  : bePrice > currentStop + 1e-9  (stop 을 위로)
          //   - SHORT : bePrice < currentStop - 1e-9  (stop 을 아래로)
          //   - currentStop 이 NaN(=미보호)이면 무조건 raise
          const _beDecision = computeBreakEvenRaiseDecision({
            side: _beSide,
            avgPrice: pos && pos.avg_price,
            leverage: _tMeta && (_tMeta.external_leverage || _tMeta.leverage || pos.leverage || 1),
            floorPct: _beRules && _beRules.RUNNER_MIN_PROFIT_PCT,
            currentStop: _tMeta && _tMeta.native_protection_stop_price,
          });
          _beAvg = _beDecision.avg;
          _beLev = _beDecision.leverage;
          _beFloorPct = _beDecision.floorPct;
          _currentStop = _beDecision.currentStop;
          _inputsValid = _beDecision.inputsValid;
          _bePrice = _beDecision.bePrice;
          _shouldRaiseStop = _beDecision.shouldRaiseStop;
          if (_inputsValid && !_shouldRaiseStop) {
            _decisionStage = "RAISE_NOT_NEEDED";
          } else if (_inputsValid && _shouldRaiseStop) {
            _cooldownPassed = shouldRunNativeProtectionRefreshCooldown({ symbol, now: tickNow, cooldownMs: 5000 });
            _decisionStage = _cooldownPassed ? "REFRESH_DISPATCHED" : "COOLDOWN_HELD";
          }
          if (_decisionStage === "REFRESH_DISPATCHED") {
            // `resolveLiveFuturesConfig` is a pure Firestore read — safe to
            // retry unconditionally.
            const _beLiveCfg = await withTransientFirestoreRetry(
              () => resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol }),
              { context: _beRetryCtx }
            );
            // `refreshBinanceTickExitNativeProtection` is safe to retry on
            // transient-Firestore throws because:
            //   (1) order placement only happens AFTER lease acquisition
            //       and BEFORE any return — if this function throws, no
            //       exchange side-effect has been committed;
            //   (2) exchange-level failures return a structured result
            //       (`{ ok: false, reason: ... }`) rather than throw, so
            //       they never enter the retry branch;
            //   (3) the lease itself is idempotent under the same holderId.
            // If any of those invariants change, revisit this wrapping
            // before trusting retries here.
            const _beRefreshRetryCtx = { attempts: 0, terminalCode: null, exhausted: false, transient: false };
            _beRefreshRes = await withTransientFirestoreRetry(
              () => refreshBinanceTickExitNativeProtection({
                liveCfg: _beLiveCfg,
                exchange: "BINANCEFUT",
                symbol,
                position: pos,
                fallbackSide: _beSide === "SHORT" ? "SELL" : "BUY",
              }),
              { context: _beRefreshRetryCtx }
            );
            // Roll up into a single retry context for the decision log —
            // pick the "worse" outcome (higher attempt count wins; exhausted
            // beats not-exhausted) so one log line captures the full cost.
            if (_beRefreshRetryCtx.attempts > _beRetryCtx.attempts) {
              _beRetryCtx.attempts = _beRefreshRetryCtx.attempts;
              _beRetryCtx.terminalCode = _beRefreshRetryCtx.terminalCode;
              _beRetryCtx.transient = _beRefreshRetryCtx.transient;
            }
            if (_beRefreshRetryCtx.exhausted) _beRetryCtx.exhausted = true;
            // 2026-04-18 P0-1 (audit re-verified): the original log emitted
            // only `refresh_ok` + `refresh_reason`, both of which flipped to
            // true as soon as Binance accepted the stop order — even when
            // `syncFuturesPositionOnly`/`syncNativeProtectionMetaAfterRefresh`
            // subsequently failed and the reconciler later re-marked the
            // position as MISSING. Dashboards should read `refresh_synced_ok`
            // (composite: placement + sync + meta) instead of `refresh_ok`
            // (placement only). See `buildBreakEvenStopRefreshObservability`.
            structuredLog("tick_exit_tp1_break_even_stop_raised", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              side: _beSide,
              entry: _beAvg,
              prev_stop: Number.isFinite(_currentStop) ? _currentStop : null,
              be_price: _bePrice,
              floor_pct: _beFloorPct,
              trail_enabled: _trailEnabled === true,
              ...buildBreakEvenStopRefreshObservability(_beRefreshRes),
            });
          }
        } catch (_beErr) {
          _beError = String(_beErr && _beErr.message || _beErr).slice(0, 200);
          _beErrorStack = String(_beErr && _beErr.stack || "").slice(0, 500);
          _decisionStage = "ERROR";
          // 2026-04-19: if the thrown error carries retry-augmented metadata,
          // roll it into `_beRetryCtx`. This covers the case where the throw
          // originated *inside* `withTransientFirestoreRetry` — the helper
          // stamps `firestore_retry_*` fields on the error. Be defensive:
          // take the max attempts across call sites so we report the worst
          // outcome seen during this BE-raise cycle.
          if (_beErr && typeof _beErr === "object") {
            const _rAttempts = Number(_beErr.firestore_retry_attempts);
            if (Number.isFinite(_rAttempts) && _rAttempts > _beRetryCtx.attempts) {
              _beRetryCtx.attempts = _rAttempts;
              _beRetryCtx.terminalCode = _beErr.firestore_retry_terminal_code != null
                ? _beErr.firestore_retry_terminal_code
                : _beRetryCtx.terminalCode;
              _beRetryCtx.transient = _beErr.firestore_retry_transient === true
                ? true
                : _beRetryCtx.transient;
            }
            if (_beErr.firestore_retry_exhausted === true) _beRetryCtx.exhausted = true;
          }
          structuredLog("tick_exit_tp1_break_even_stop_error", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            error: _beError,
            error_stack: _beErrorStack,
            firestore_retry_attempts: _beRetryCtx.attempts,
            firestore_retry_terminal_code: _beRetryCtx.terminalCode,
            firestore_retry_exhausted: _beRetryCtx.exhausted,
            firestore_retry_transient: _beRetryCtx.transient,
          }, "warn");
        }
        // Always-on decision trace — bounded to TP1-done positions, so
        // volume is O(active runners × tick interval). One line captures
        // every branch, letting a post-mortem answer "which guard?".
        // Runs on BOTH success and error paths (2026-04-18 fix): the
        // error branch records `decision_stage: ERROR` + `error` so the
        // diagnostic trail survives Firestore contention / egress timeouts
        // that previously swallowed the log entirely.
        try {
          // 2026-04-18 P0-1 (audit re-verified): mirror enriched observability
          // fields so the always-on decision trace answers "did protection
          // actually become consistent?" without needing to join across
          // streams. `refresh_synced_ok` is the composite; `refresh_ok`
          // remains the placement-only field for backwards compatibility.
          structuredLog("tick_exit_tp1_break_even_stop_decision", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: _beSide,
            tp_p1_done: _tpP1Done === true,
            trail_enabled: _trailEnabled === true,
            inputs_valid: _inputsValid,
            avg: Number.isFinite(_beAvg) ? _beAvg : null,
            leverage: Number.isFinite(_beLev) ? _beLev : null,
            floor_pct: Number.isFinite(_beFloorPct) ? _beFloorPct : null,
            current_stop: Number.isFinite(_currentStop) ? _currentStop : null,
            be_price: _bePrice,
            should_raise_stop: _shouldRaiseStop === true,
            cooldown_passed: _cooldownPassed,
            decision_stage: _decisionStage,
            ...buildBreakEvenStopRefreshObservability(_beRefreshRes),
            error: _beError,
            // 2026-04-19: surface transient-Firestore retry stats so a
            // single decision-trace line answers "did a retry save us?" /
            // "did we give up?" / "was this a non-transient business error?".
            // `attempts === 1` + `decision_stage: REFRESH_DISPATCHED` is the
            // healthy path. `attempts > 1` means we recovered a transient.
            // `exhausted: true` + `ERROR` means we burned the retry budget
            // and the position is still at the original SL.
            error_stack: _beErrorStack,
            firestore_retry_attempts: _beRetryCtx.attempts,
            firestore_retry_terminal_code: _beRetryCtx.terminalCode,
            firestore_retry_exhausted: _beRetryCtx.exhausted,
            firestore_retry_transient: _beRetryCtx.transient,
          });
        } catch (_decisionErr) { /* never let diagnostic kill the tick */ }
      }

      if (_tpP1Done && _trailEnabled) {
        const _tSide = resolvePositionSideFromPosition(pos, _tMeta, "LONG");
        // `computeTrailWatermarkPatch` — helper 상단 주석 참조 (2026-04-19
        // zero-bootstrap jam 루트 픽스). helper 가 patch 객체를 돌려주면 이번
        // tick 이 watermark 개선 tick 이라는 뜻, null 이면 skip.
        const _watermark = computeTrailWatermarkPatch({
          side: _tSide,
          meta: _tMeta,
          price,
          tickNow,
        });
        let _trailPatch = _watermark ? _watermark.patch : null;
        let _trailField = _watermark ? _watermark.field : null;
        let _trailNext = _watermark ? _watermark.next : null;
        let _trailPrev = _watermark ? _watermark.prev : null;
        if (_trailPatch) {
          const _trailEvalMs = nowMs();
          const _exitRules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: pos });
          let _nativeRefresh = null;
          let _runnerExit = null;
          try {
            if (pos.meta && _trailField === "trail_high" && Number.isFinite(_trailNext)) {
              pos.meta.trail_high = _trailNext;
              pos.meta.trail_high_at_ms = tickNow;
            } else if (pos.meta && _trailField === "trail_low" && Number.isFinite(_trailNext)) {
              pos.meta.trail_low = _trailNext;
              pos.meta.trail_low_at_ms = tickNow;
            }
            _runnerExit = computeRunnerExitStopPrice({
              avg: Number(pos && pos.avg_price),
              leverageEff: Number(_tMeta && (_tMeta.external_leverage || _tMeta.leverage || pos.leverage || 1)),
              side: _tSide,
              rules: _exitRules,
              tpP1Done: _tpP1Done,
              trailActive: _trailStage,
              trailHigh: pos.meta && Number.isFinite(Number(pos.meta.trail_high)) ? Number(pos.meta.trail_high) : null,
              trailLow: pos.meta && Number.isFinite(Number(pos.meta.trail_low)) ? Number(pos.meta.trail_low) : null,
              entryRDistance: Number(_tMeta && _tMeta.entry_r_distance),
            });
            const _tLogKey = `trail_upd_${String(symbol).toUpperCase()}`;
            const _tNow = nowMs();
            const _tLastLog = Number(symbolCooldownLogState.get(_tLogKey));
            if (!Number.isFinite(_tLastLog) || (_tNow - _tLastLog) >= 60000) {
              symbolCooldownLogState.set(_tLogKey, _tNow);
              structuredLog("tick_exit_trail_updated", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                side: _tSide,
                field: _trailField || (_tSide === "LONG" ? "trail_high" : "trail_low"),
                prev: _trailPrev,
                next: price,
              });
            }

            try {
              const _liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
              _nativeRefresh = await refreshBinanceTickExitNativeProtection({
                liveCfg: _liveCfg,
                exchange: "BINANCEFUT",
                symbol,
                position: pos,
                fallbackSide: _tSide === "SHORT" ? "SELL" : "BUY",
              });
            } catch (_nativeRefreshErr) {
              structuredLog("tick_exit_trail_native_refresh_error", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                error: String(_nativeRefreshErr && _nativeRefreshErr.message || _nativeRefreshErr).slice(0, 200),
              }, "warn");
              _nativeRefresh = {
                ok: false,
                reason: String(_nativeRefreshErr && _nativeRefreshErr.message || _nativeRefreshErr).slice(0, 200),
              };
            }

            try {
              const _obsWriteAtMs = nowMs();
              const _obsNativeStopPrice = _nativeRefresh && _nativeRefresh.ok === true
                ? Number(_nativeRefresh.stop_price)
                : (pos.meta && Number.isFinite(Number(pos.meta.native_protection_stop_price))
                  ? Number(pos.meta.native_protection_stop_price)
                  : null);
              const _obsNativeStopOrderId = _nativeRefresh && _nativeRefresh.ok === true
                ? (_nativeRefresh.stop_order_id || null)
                : (pos.meta && pos.meta.native_protection_stop_order_id ? pos.meta.native_protection_stop_order_id : null);
              const _obsNativeRefreshStatus = _nativeRefresh
                ? (_nativeRefresh.ok === true
                  ? "OK"
                  : String(_nativeRefresh.reason || "FAILED").trim().toUpperCase())
                : (pos.meta && pos.meta.native_protection_refresh_status ? pos.meta.native_protection_refresh_status : null);
              await upsertTrailObservation({
                exchange: "BINANCEFUT",
                symbol,
                side: _tSide,
                entryEventId: pos.meta && pos.meta.entry_event_id ? pos.meta.entry_event_id : null,
                entryExecBarMs: pos.meta && Number.isFinite(Number(pos.meta.entry_exec_bar_ms))
                  ? Number(pos.meta.entry_exec_bar_ms)
                  : null,
                entryPrice: Number(pos && pos.avg_price),
                entryRDistance: pos.meta && Number.isFinite(Number(pos.meta.entry_r_distance))
                  ? Number(pos.meta.entry_r_distance)
                  : null,
                trailRMultiple: Number(_exitRules && _exitRules.TRAIL_R_MULTIPLE),
                trailHigh: pos.meta && Number.isFinite(Number(pos.meta.trail_high)) ? Number(pos.meta.trail_high) : null,
                trailHighAtMs: pos.meta && Number.isFinite(Number(pos.meta.trail_high_at_ms)) ? Number(pos.meta.trail_high_at_ms) : null,
                trailLow: pos.meta && Number.isFinite(Number(pos.meta.trail_low)) ? Number(pos.meta.trail_low) : null,
                trailLowAtMs: pos.meta && Number.isFinite(Number(pos.meta.trail_low_at_ms)) ? Number(pos.meta.trail_low_at_ms) : null,
                runnerFloorStop: Number(_runnerExit && _runnerExit.runnerFloorStop),
                computedTrailStop: Number(_runnerExit && _runnerExit.stopPrice),
                trailStopRaw: Number(_runnerExit && _runnerExit.trailStop),
                trailStopByR: Number(_runnerExit && _runnerExit.trailStopByR),
                trailStopByPct: Number(_runnerExit && _runnerExit.trailStopByPct),
                chosenStopSource: _runnerExit && _runnerExit.stopSource ? _runnerExit.stopSource : null,
                chosenStopPrice: Number(_runnerExit && _runnerExit.stopPrice),
                finalEffectiveStop: Number(_runnerExit && _runnerExit.stopPrice),
                nativeStopPrice: Number.isFinite(_obsNativeStopPrice) ? _obsNativeStopPrice : null,
                nativeStopOrderId: _obsNativeStopOrderId,
                nativeRefreshStatus: _obsNativeRefreshStatus,
                lastRepriceAtMs: _obsWriteAtMs,
                runtimeEvalAtMs: _trailEvalMs,
                source: "TICK_EXIT",
              });
              await recordTrailRuntimeEvent({
                exchange: "BINANCEFUT",
                symbol,
                event: "TRAIL_WATERMARK_UPDATED",
                runId: buildTickTrailReconcileRunId(symbol, tickNow),
                tsMs: tickNow,
                payload: {
                  side: _tSide,
                  field: _trailField || (_tSide === "LONG" ? "TRAIL_HIGH" : "TRAIL_LOW"),
                  prev: Number.isFinite(_trailPrev) ? _trailPrev : null,
                  next: Number.isFinite(_trailNext) ? _trailNext : null,
                  computed_trail_stop: Number(_runnerExit && _runnerExit.stopPrice),
                  runner_floor_stop: Number(_runnerExit && _runnerExit.runnerFloorStop),
                  native_stop_price: Number.isFinite(_obsNativeStopPrice) ? _obsNativeStopPrice : null,
                },
              }).catch(() => null);
              const _shadowTrailWrite = await maybeWriteV2ShadowTrailActivation({
                symbol,
                position: pos,
                side: _tSide,
                nativeRefresh: _nativeRefresh,
                runnerExit: _runnerExit,
                observedAtMs: _obsWriteAtMs,
              });
              if (_shadowTrailWrite && _shadowTrailWrite.ok !== true) {
                structuredLog("tick_exit_v2_shadow_trail_activation_fail", {
                  exchange: "BINANCEFUT",
                  symbol: String(symbol).toUpperCase(),
                  reason: _shadowTrailWrite.reason || "UNKNOWN",
                }, "warn");
              }
            } catch (_trailObsErr) {
              structuredLog("tick_exit_trail_observation_write_error", {
                exchange: "BINANCEFUT",
                symbol: String(symbol).toUpperCase(),
                error: String(_trailObsErr && _trailObsErr.message || _trailObsErr).slice(0, 200),
              }, "warn");
              throw _trailObsErr;
            } finally {
              try {
                await syncFuturesPositionOnly({
                  runId: buildTickTrailReconcileRunId(symbol, Date.now()),
                  exchange: "BINANCEFUT",
                  symbol,
                });
              } catch (_syncErr) {
                structuredLog("tick_exit_trail_position_reconcile_error", {
                  exchange: "BINANCEFUT",
                  symbol: String(symbol).toUpperCase(),
                  error: String(_syncErr && _syncErr.message || _syncErr).slice(0, 200),
                }, "warn");
              }
            }
          } catch (_trailErr) {
            structuredLog("tick_exit_trail_update_error", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              error: String(_trailErr && _trailErr.message || _trailErr).slice(0, 200),
            }, "warn");
          }
        }
      }

      const scope = intentScopeKey("BINANCEFUT", symbol, signalTf);
      let trailObservation = null;
      try {
        trailObservation = await getPositionRuntimeObservation({
          exchange: "BINANCEFUT",
          symbol,
        });
      } catch (_) {}
      let effectivePos = applyTrailObservationToPosition({ pos, observation: trailObservation });
      let leverageEff = resolveLeverageEff(pos, "BINANCEFUT");
      let rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
      let nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
      if (nativeProtectionState && nativeProtectionState.verify_error) {
        const logKey = `native_verify_${String(symbol).toUpperCase()}`;
        const lastLogged = Number(symbolCooldownLogState.get(logKey));
        if (!Number.isFinite(lastLogged) || (tickNow - lastLogged) >= 60000) {
          symbolCooldownLogState.set(logKey, tickNow);
          structuredLog("tick_exit_native_verify_warn", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            error: nativeProtectionState.verify_error,
          }, "warn");
        }
      }
      const eagerProtectionRefresh = shouldEagerRefreshNativeProtection({
        pos: effectivePos,
        nativeProtectionState,
      });
      let resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
      const shouldTrackTp1Refresh = shouldTrackTp1NativeRefreshLifecycle({
        position: effectivePos,
        refreshPlan: eagerProtectionRefresh,
      });
      const canRunNativeRefresh = eagerProtectionRefresh.needed && shouldRunNativeProtectionRefreshCooldown({ symbol, now: tickNow });
      const tp1NativeProtectionGap = resolveTp1NativeProtectionGap({
        symbol,
        tf: signalTf,
        position: effectivePos,
        refreshPlan: eagerProtectionRefresh,
        nativeProtectionState,
        now: tickNow,
      });
      if (shouldTrackTp1Refresh && eagerProtectionRefresh.needsTp === true && !canRunNativeRefresh) {
        structuredLog("tick_exit_tp1_native_refresh_skipped_cooldown", buildTp1NativeRefreshTelemetryPayload({
          symbol,
          tf: signalTf,
          position: effectivePos,
          refreshPlan: eagerProtectionRefresh,
          nativeProtectionState,
          phase: "SKIPPED_COOLDOWN",
        }), "warn");
        if (tp1NativeProtectionGap && tp1NativeProtectionGap.escalated === true) {
          const tp1NativeGapResult = await handleTp1NativeProtectionGap({
            symbol,
            tf: signalTf,
            telemetry: tp1NativeProtectionGap,
          }).catch((error) => ({
            ok: false,
            skipped: false,
            reason: "TP1_NATIVE_PROTECTION_GAP_HANDLER_FAIL",
            error: error && error.message ? error.message : String(error),
          }));
          structuredLog("tick_exit_tp1_native_gap_fail_closed", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            tf: signalTf,
            gap_age_ms: tp1NativeProtectionGap.gap_age_ms,
            escalation_ms: tp1NativeProtectionGap.escalation_ms,
            issue_codes: tp1NativeProtectionGap.issue_codes,
            repair_reason: tp1NativeGapResult && tp1NativeGapResult.repair_reason ? tp1NativeGapResult.repair_reason : null,
            request_id: tp1NativeGapResult && tp1NativeGapResult.request_id ? tp1NativeGapResult.request_id : null,
            dispatch_ok: tp1NativeGapResult && tp1NativeGapResult.dispatch_ok === true,
            handler_reason: tp1NativeGapResult && tp1NativeGapResult.reason ? tp1NativeGapResult.reason : null,
            handler_error: tp1NativeGapResult && tp1NativeGapResult.error ? tp1NativeGapResult.error : null,
          }, "warn");
          checked += 1;
          continue;
        }
      }
      if (canRunNativeRefresh) {
        let refreshed = null;
        const beforeRefreshPos = effectivePos;
        try {
          if (shouldTrackTp1Refresh) {
            structuredLog("tick_exit_tp1_native_refresh_attempt", buildTp1NativeRefreshTelemetryPayload({
              symbol,
              tf: signalTf,
              position: effectivePos,
              refreshPlan: eagerProtectionRefresh,
              nativeProtectionState,
              phase: "ATTEMPT",
            }));
          }
          const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
          refreshed = await refreshBinanceTickExitNativeProtection({
            liveCfg,
            exchange: "BINANCEFUT",
            symbol,
            position: effectivePos,
            fallbackSide: resolvedPosSide === "SHORT" ? "SELL" : "BUY",
          });
          if (shouldTrackTp1Refresh) {
            structuredLog("tick_exit_tp1_native_refresh_result", buildTp1NativeRefreshTelemetryPayload({
              symbol,
              tf: signalTf,
              position: effectivePos,
              refreshPlan: eagerProtectionRefresh,
              refreshResult: refreshed,
              nativeProtectionState,
              phase: "RESULT",
            }), refreshed && refreshed.ok === true ? "log" : "warn");
          }
          structuredLog("tick_exit_native_protection_refresh", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG"),
            needs_stop: eagerProtectionRefresh.needsStop === true,
            needs_tp: eagerProtectionRefresh.needsTp === true,
            refresh_reason: eagerProtectionRefresh.reason,
            refreshed: refreshed && refreshed.ok === true,
            refresh_result_reason: refreshed && refreshed.reason ? String(refreshed.reason) : null,
          });
        } catch (nativeRefreshErr) {
          // ── 에러 원인 분류.
          //   2026-04-19 ETHUSDT 사고 이후: 이 catch 에 걸리는 예외가 실은
          //   Binance 가 아니라 Firestore gRPC transport 실패 (`14 UNAVAILABLE`)
          //   인 경우가 있었다.  `getSettingsDocCached` 는 이제 stale cache /
          //   fallback 으로 degrade 하므로 신규 blip 은 여기까지 안 오지만,
          //   캐시/폴백 둘 다 없는 cold-start 순간에는 여전히 throw 될 수 있다.
          //   그 경우 최소한 원인을 정확히 라벨링해서 대시보드 오진을 막는다.
          const errMsg = String((nativeRefreshErr && nativeRefreshErr.message) || nativeRefreshErr);
          const isFirestoreTransport = /\b14\s+UNAVAILABLE\b/i.test(errMsg)
            || /secure TLS connection was established/i.test(errMsg)
            || /gRPC.*UNAVAILABLE/i.test(errMsg);
          if (isFirestoreTransport) {
            structuredLog("tick_exit_native_protection_refresh_error_firestore_transport", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              refresh_reason: eagerProtectionRefresh.reason,
              upstream_cause: "FIRESTORE_GRPC_UNAVAILABLE",
              hint: "이 에러는 Binance 문제가 아니라 Firestore 커넥션 순단. "
                + "getSettingsDocCached 의 graceful-degrade 가 적용된 이후에는 "
                + "cold-start 초기에만 관측되어야 함.",
              error: errMsg.slice(0, 200),
            }, "warn");
          } else {
            structuredLog("tick_exit_native_protection_refresh_error", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              refresh_reason: eagerProtectionRefresh.reason,
              error: errMsg.slice(0, 200),
            }, "warn");
          }
        } finally {
          try {
            clearNativeProtectionStateCache(symbol);
            await syncFuturesPositionOnly({
              runId: buildTickTrailReconcileRunId(symbol, Date.now()),
              exchange: "BINANCEFUT",
              symbol,
              force: true,
            });
            trailObservation = await getPositionRuntimeObservation({
              exchange: "BINANCEFUT",
              symbol,
            }).catch(() => trailObservation);
            effectivePos = applyTrailObservationToPosition({
              pos: await getPositionReadView({
                exchange: "BINANCEFUT",
                symbol,
              }),
              observation: trailObservation,
            });
            leverageEff = resolveLeverageEff(effectivePos || pos, "BINANCEFUT");
            rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
            nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
            resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
            if (shouldTrackTp1Refresh) {
              const tp1MetaSyncPayload = buildTp1MetaSyncTelemetryPayload({
                symbol,
                tf: signalTf,
                beforePosition: beforeRefreshPos,
                afterPosition: effectivePos,
                refreshPlan: eagerProtectionRefresh,
                refreshResult: refreshed,
              });
              if (tp1MetaSyncPayload) {
                structuredLog("tick_exit_tp1_meta_sync_status", tp1MetaSyncPayload, tp1MetaSyncPayload.meta_sync_ok === true ? "log" : "warn");
                if (tp1MetaSyncPayload.meta_sync_ok !== true) {
                  const tp1MetaSyncGapResult = await handleTp1MetaSyncGap({
                    symbol,
                    tf: signalTf,
                    telemetry: tp1MetaSyncPayload,
                  }).catch((error) => ({
                    ok: false,
                    skipped: false,
                    reason: "TP1_META_SYNC_GAP_HANDLER_FAIL",
                    error: error && error.message ? error.message : String(error),
                  }));
                  structuredLog("tick_exit_tp1_meta_sync_fail_closed", {
                    exchange: "BINANCEFUT",
                    symbol: String(symbol).toUpperCase(),
                    tf: signalTf,
                    issue_codes: tp1MetaSyncPayload.issue_codes,
                    repair_reason: tp1MetaSyncGapResult && tp1MetaSyncGapResult.repair_reason ? tp1MetaSyncGapResult.repair_reason : null,
                    request_id: tp1MetaSyncGapResult && tp1MetaSyncGapResult.request_id ? tp1MetaSyncGapResult.request_id : null,
                    dispatch_ok: tp1MetaSyncGapResult && tp1MetaSyncGapResult.dispatch_ok === true,
                    handler_reason: tp1MetaSyncGapResult && tp1MetaSyncGapResult.reason ? tp1MetaSyncGapResult.reason : null,
                    handler_error: tp1MetaSyncGapResult && tp1MetaSyncGapResult.error ? tp1MetaSyncGapResult.error : null,
                  }, "warn");
                  checked += 1;
                  continue;
                }
              }
            }
            await syncTickExitTrailObservation({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              rules,
              nativeProtection: refreshed,
              runtimeEvalAtMs: tickNow,
              source: "TICK_EXIT_NATIVE_REFRESH",
            }).catch(() => null);
          } catch (_) {}
        }
      }
      const triggers = computeExitTriggers({ pos: effectivePos, rules, leverageEff, nativeProtectionState });
      const trailTrigger = triggers.find((t) => String(t && t.kind || "").toUpperCase() === "TRAIL");
      const trailAuthority = trailTrigger
        ? await loadTrailAuthorityRuntime({
          exchange: "BINANCEFUT",
          symbol,
          position: effectivePos,
          activePositions: active,
          operationalGuard,
          systemSlo,
          systemAnomaly,
        }).catch(() => null)
        : null;
      const effectiveNearPct = Number.isFinite(Number(nearPct))
        ? (Number(nearPct) * Math.max(1, Number(trailAuthority && trailAuthority.near_pct_multiplier) || 1))
        : nearPct;
      const triggeredKinds = collectTriggeredKinds({
        price,
        triggers,
        nearPct: effectiveNearPct,
        side: resolvedPosSide,
      });
      if (trailAuthority) {
        await publishTrailAuthorityState({
          state: trailAuthority,
          source: "BINANCE_TICK_EXIT",
          triggerKinds: triggeredKinds,
        }).catch(() => null);
      }
      const trailProtectionDeficit = trailTrigger && isNativeStopLessProtectiveThanTrigger({
        meta: effectivePos.meta,
        triggerPrice: trailTrigger.price,
        side: resolvedPosSide,
      });
      if (trailProtectionDeficit) {
        let refreshed = null;
        try {
          const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
          refreshed = await refreshBinanceTickExitNativeProtection({
            liveCfg,
            exchange: "BINANCEFUT",
            symbol,
            position: effectivePos,
            fallbackSide: resolvedPosSide === "SHORT" ? "SELL" : "BUY",
          });
          structuredLog("tick_exit_trail_native_floor_refresh", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvedPosSide,
            trigger_price: Number(trailTrigger.price),
            native_stop_price: Number(effectivePos && effectivePos.meta && effectivePos.meta.native_protection_stop_price),
            refreshed: refreshed && refreshed.ok === true,
            refresh_reason: refreshed && refreshed.reason ? String(refreshed.reason) : null,
          });
        } catch (nativeRefreshErr) {
          structuredLog("tick_exit_trail_native_floor_refresh_error", {
            exchange: "BINANCEFUT",
            symbol: String(symbol).toUpperCase(),
            side: resolvedPosSide,
            trigger_price: Number(trailTrigger.price),
            error: String(nativeRefreshErr && nativeRefreshErr.message || nativeRefreshErr).slice(0, 200),
          }, "warn");
        } finally {
          try {
            clearNativeProtectionStateCache(symbol);
            await syncFuturesPositionOnly({
              runId: buildTickTrailReconcileRunId(symbol, Date.now()),
              exchange: "BINANCEFUT",
              symbol,
            });
            effectivePos = applyTrailObservationToPosition({
              pos: await getPositionReadView({
                exchange: "BINANCEFUT",
                symbol,
              }),
              observation: await getPositionRuntimeObservation({
                exchange: "BINANCEFUT",
                symbol,
              }).catch(() => trailObservation),
            });
            rules = resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: effectivePos });
            nativeProtectionState = await resolveLiveNativeProtectionState({ exCfg, symbol, pos: effectivePos });
            resolvedPosSide = resolvePositionSideFromPosition(effectivePos, effectivePos.meta, "LONG");
            await syncTickExitTrailObservation({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              rules,
              nativeProtection: refreshed,
              runtimeEvalAtMs: tickNow,
              source: "TICK_EXIT_NATIVE_FLOOR_REFRESH",
            }).catch(() => null);
          } catch (_) {}
        }
      }
      const hardExit = shouldTriggerTrailHardExit({
        position: effectivePos,
        price,
        side: resolvedPosSide,
        rules,
      });
      if (hardExit.trigger === true) {
        const hardExitKey = `TRAIL_HARD_EXIT__${String(symbol).toUpperCase()}`;
        const lastHardExitAt = Number(trailHardExitCooldownState.get(hardExitKey));
        if (!Number.isFinite(lastHardExitAt) || (tickNow - lastHardExitAt) >= TICK_EXIT_HARD_EXIT_COOLDOWN_MS) {
          trailHardExitCooldownState.set(hardExitKey, tickNow);
          // 2026-04-28 Step 8 — defensive cap.
          applyAlertCacheCap(trailHardExitCooldownState, TICK_EXIT_HARD_EXIT_COOLDOWN_MS);
          try {
            const hardExitResult = await runTrailHardExit({
              exchange: "BINANCEFUT",
              symbol,
              position: effectivePos,
              price,
              signalTf,
              execTf,
              hardExit,
            });
            structuredLog("tick_exit_trail_hard_exit", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              side: resolvedPosSide,
              price,
              stop_price: hardExit.stopPrice,
              stop_source: hardExit.runnerExit && hardExit.runnerExit.stopSource ? hardExit.runnerExit.stopSource : null,
              order_id: hardExitResult && hardExitResult.orderId ? hardExitResult.orderId : null,
              ok: hardExitResult && hardExitResult.ok === true,
              reason: hardExitResult && hardExitResult.reason ? hardExitResult.reason : hardExit.reason,
            }, hardExitResult && hardExitResult.ok === true ? "log" : "warn");
            try {
              clearNativeProtectionStateCache(symbol);
              await syncFuturesPositionOnly({
                runId: buildTickTrailReconcileRunId(symbol, Date.now()),
                exchange: "BINANCEFUT",
                symbol,
              });
            } catch (_) {}
            checked += 1;
            triggered += 1;
            continue;
          } catch (hardExitErr) {
            structuredLog("tick_exit_trail_hard_exit_error", {
              exchange: "BINANCEFUT",
              symbol: String(symbol).toUpperCase(),
              side: resolvedPosSide,
              price,
              stop_price: hardExit.stopPrice,
              error: String(hardExitErr && hardExitErr.message || hardExitErr).slice(0, 200),
            }, "warn");
          }
        }
      }
      const nearHit = triggeredKinds.length > 0;
      const fastLaneHit = shouldActivateFastLane({
        pos: effectivePos,
        price,
        triggers,
        fastLanePct: Number(env.tickExit && env.tickExit.fastLanePct || 0) * Math.max(1, Number(trailAuthority && trailAuthority.near_pct_multiplier) || 1),
        side: resolvedPosSide,
      }) || !!(trailAuthority && trailAuthority.force_fast_lane === true);
      if (fastLaneHit) {
        fastLaneActive = true;
        fastLaneSymbols.add(String(symbol).toUpperCase());
      }
      const trailOnlyTriggered = triggeredKinds.length > 0 && triggeredKinds.every((kind) => kind === "TRAIL");
      if (trailAuthority && trailAuthority.block_synthetic_trail === true && trailOnlyTriggered) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_BLOCKED",
          tsMs: tickNow,
          payload: {
            status: trailAuthority.status,
            reason: trailAuthority.reason,
            issues: Array.isArray(trailAuthority.issues) ? trailAuthority.issues.slice() : [],
            remediation_action: trailAuthority.remediation_action || null,
            triggered_kinds: triggeredKinds,
          },
        }).catch(() => null);
        continue;
      }
      let pendingForced = false;
      if (!nearHit) {
        pendingForced = await hasPendingIntentsForScope({
          exchange: "BINANCEFUT",
          symbol,
          tf: signalTf,
          now: nowMs(),
        });
        if (!pendingForced) continue;
        const logKey = String(symbol || "").toUpperCase();
        const now = nowMs();
        const lastLogged = Number(pendingIntentLogState.get(logKey));
        if (!Number.isFinite(lastLogged) || (now - lastLogged) >= 60 * 1000) {
          pendingIntentLogState.set(logKey, now);
          structuredLog("tick_exit_forced_by_pending_intent", {
            exchange: "BINANCEFUT",
            symbol: logKey,
            tf: signalTf,
          });
        }
      }

      const now = nowMs();
      const permit = (pendingForced || nearHit)
        ? { ok: true, remainingMs: 0 }
        : shouldRunBySymbolCooldown({ symbol, now, cooldownMs });
      if (!permit.ok) {
        skippedCooldown += 1;
        const key = String(symbol || "").toUpperCase();
        const lastLogged = Number(symbolCooldownLogState.get(key));
        if (!Number.isFinite(lastLogged) || (now - lastLogged) >= 60 * 1000) {
          symbolCooldownLogState.set(key, now);
          structuredLog("tick_exit_skipped_by_cooldown", {
            exchange: "BINANCEFUT",
            symbol: key,
            cooldown_ms: cooldownMs,
            remaining_ms: permit.remainingMs,
          });
        }
        continue;
      }

      checked += 1;
      const bar = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        closeTimeUtc: new Date(now).toISOString(),
        closeTimeUtcMs: now,
        timestamp: now,
        t: new Date(now).toISOString(),
        o: price,
        h: price,
        l: price,
        c: price,
        v: 0,
      };
      const runId = `RUN__BINANCEFUT__${symbol}__TICK_EXIT__${now}`;
      if (triggeredKinds.includes("TRAIL")) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_ENQUEUED",
          runId,
          tsMs: now,
          payload: {
            status: trailAuthority && trailAuthority.status || "CLEAR",
            reason: trailAuthority && trailAuthority.reason || "TRAIL_AUTHORITY_OK",
            issues: trailAuthority && Array.isArray(trailAuthority.issues) ? trailAuthority.issues.slice() : [],
            near_pct: effectiveNearPct,
            force_fast_lane: !!(trailAuthority && trailAuthority.force_fast_lane === true),
            triggered_kinds: triggeredKinds,
          },
        }).catch(() => null);
      }
      // 2026-04-29 Stage U-1 — operator decision: "V1 자체가 작동하면 안 되고
      // V2 가 모든 처리를 인계받아야 한다." binanceTickExit's V1 fast-lane
      // (runPaperMarket EXIT_ONLY) is the last V1 emit-driven exit path.
      // Under DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 this call's V1
      // executor would in any case be rejected with
      // V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED — so the
      // call is wasted CPU + alert noise. The actual exit safety in
      // this configuration is provided by the broker-side native
      // protection (closePosition STOP_MARKET) which binanceTickExit
      // itself manages via refreshBinanceTickExitNativeProtection
      // (placeFuturesMarketOrder directly, no V1 paperBinanceRunner
      // dependency). Skip the V1 fast-lane outright.
      // Inline env parse to avoid pulling in a parseBoolEnv helper —
      // pattern matches the surrounding String(process.env.X || "1") usage.
      if ((function legacyRuntimeDisabledNow() {
        const raw = String(process.env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED || "0").trim().toLowerCase();
        return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
      })()) {
        // 2026-04-29 R3 — Retired the post-rejection cooldown that
        // used to live here. Retry-storm prevention now lives upstream
        // in the active-list build:
        //   R1 (cf2b8e3b): symbols with a freshly-placed dispatch are
        //     excluded via the in-flight inhibit (markExitInFlight on
        //     place success → next tick's filter skips them with
        //     `tick_exit_skip_exit_in_flight`).
        //   R2 (838c43a8): symbols whose broker positionAmt is already
        //     zero are excluded via the broker truth pre-filter
        //     (5 s cached fetchBinanceFuturesAccount snapshot →
        //     `tick_exit_skip_broker_flat`).
        // Together R1 + R2 prevent the duplicate dispatch from being
        // attempted in the first place. The only -2022 we now expect
        // is a single reject inside R2's 5 s cache window, which R2
        // absorbs on the next cycle. There is no longer any value in
        // a post-hoc cooldown — it would only delay legitimate exits
        // for a position that genuinely re-opened.
        // Stage U-followup-1 (option A) — V2 direct exit dispatch.
        // Stage U-followup-2 (this turn) — pre-round qty via symbol
        //   exchangeInfo, stamp the dispatch into exit_order_contracts
        //   (V2 evidence ledger), and harden idempotency key entropy
        //   (runId + per-call randomUUID suffix).
        let v2DirectDispatch = null;
        let v2DispatchPlaced = false;
        let v2DispatchPlaceError = null;
        let v2DispatchOrderId = null;
        let v2DispatchClientOrderId = null;
        let v2DispatchSymbolInfo = null;
        try {
          const positionQtyBase = Number(effectivePos && effectivePos.qty_base);

          // Stage U-followup-2 step A — fetch symbol info (cached 1d in
          // fetchFuturesExchangeInfo). Pass stepSize + minQty to the
          // helper so qty pre-rounding is exact and dust is caught
          // before the exchange call.
          try {
            v2DispatchSymbolInfo = await fetchFuturesExchangeInfo(symbol);
          } catch (infoErr) {
            structuredLog("v2_direct_exit_dispatch_symbol_info_fail", {
              exchange: "BINANCEFUT",
              symbol,
              error: infoErr && infoErr.message ? infoErr.message : String(infoErr),
              note: "Falling back to no-step-rounding dispatch; Binance will reject if invalid.",
            });
          }

          // Stage U-followup-2 step C — strengthen runId entropy. The
          // base runId is `RUN__BINANCEFUT__${symbol}__TICK_EXIT__${ms}`
          // which collides only if two cycles fire in the same ms.
          // Cloud Run never produces that today, but a per-dispatch
          // random suffix guarantees uniqueness at no cost.
          let dispatchRunId = runId;
          try {
            const { randomUUID } = require("crypto");
            dispatchRunId = `${runId}__${randomUUID().slice(0, 8)}`;
          } catch (_) { /* fall back to plain runId */ }

          v2DirectDispatch = buildV2DirectExitDispatch({
            triggeredKinds,
            positionSide: resolvedPosSide,
            positionQtyBase,
            symbol,
            runId: dispatchRunId,
            stepSize: v2DispatchSymbolInfo && Number.isFinite(Number(v2DispatchSymbolInfo.stepSize))
              ? Number(v2DispatchSymbolInfo.stepSize) : null,
            minQty: v2DispatchSymbolInfo && Number.isFinite(Number(v2DispatchSymbolInfo.minQty))
              ? Number(v2DispatchSymbolInfo.minQty) : null,
          });
          if (v2DirectDispatch && v2DirectDispatch.dispatch === true) {
            const liveCfg = await resolveLiveFuturesConfig({ exchange: "BINANCEFUT", symbol });
            if (liveCfg && liveCfg.apiKey && liveCfg.apiSecret && !liveCfg.liveDryRun) {
              try {
                const placeRes = await placeFuturesMarketOrder({
                  apiKey: liveCfg.apiKey,
                  apiSecret: liveCfg.apiSecret,
                  symbol: v2DirectDispatch.symbol,
                  side: v2DirectDispatch.closeSide,
                  quantity: v2DirectDispatch.qty,
                  reduceOnly: true,
                  idempotencyKey: v2DirectDispatch.idempotencyKey,
                });
                v2DispatchPlaced = true;
                v2DispatchOrderId = placeRes && (placeRes.orderId ?? placeRes.order_id) ? String(placeRes.orderId ?? placeRes.order_id) : null;
                v2DispatchClientOrderId = placeRes && (placeRes.clientOrderId ?? placeRes.client_order_id) ? String(placeRes.clientOrderId ?? placeRes.client_order_id) : null;
                // 2026-04-29 ROOT-CAUSE (R1) — mark this symbol as
                // exit-in-flight immediately on place success. The next
                // tick's active filter will skip it until fillSync
                // commits the close (or the 30 s TTL expires as a
                // safety net).
                markExitInFlight(symbol, {
                  runId: dispatchRunId,
                  fraction: v2DirectDispatch.fraction,
                  triggeredKinds: v2DirectDispatch.triggeredKinds,
                  source: "V2_DIRECT_EXIT_DISPATCH",
                });
                structuredLog("v2_direct_exit_dispatch_placed", {
                  exchange: "BINANCEFUT",
                  symbol,
                  run_id: dispatchRunId,
                  triggered_kinds: v2DirectDispatch.triggeredKinds,
                  close_side: v2DirectDispatch.closeSide,
                  fraction: v2DirectDispatch.fraction,
                  order_qty: v2DirectDispatch.qty,
                  trigger_reason: v2DirectDispatch.triggerReason,
                  idempotency_key: v2DirectDispatch.idempotencyKey,
                  step_size: v2DispatchSymbolInfo && v2DispatchSymbolInfo.stepSize,
                  min_qty: v2DispatchSymbolInfo && v2DispatchSymbolInfo.minQty,
                  order_id: v2DispatchOrderId,
                  client_order_id: v2DispatchClientOrderId,
                });

                // Stage U-followup-2 step B — V2 evidence chain:
                // stamp the dispatch into exit_order_contracts so the
                // canonical exit ledger / dashboards can correlate the
                // V2 dispatch with the eventual fill. Best-effort — a
                // ledger write failure must NOT undo the exchange
                // order.
                try {
                  await upsertExitOrderContract({
                    exchange: "BINANCEFUT",
                    symbol: v2DirectDispatch.symbol,
                    orderId: v2DispatchOrderId,
                    clientOrderId: v2DispatchClientOrderId || v2DirectDispatch.idempotencyKey,
                    event: v2DirectDispatch.fraction >= 1 ? "EXIT_TRAIL" : "EXIT_TP_P1_2.5P",
                    stage: v2DirectDispatch.fraction >= 1 ? "TRAIL" : "TP1",
                    intentId: null,
                    signalId: null,
                    signalDocId: null,
                    entryEventId: effectivePos && effectivePos.meta && effectivePos.meta.entry_event_id || null,
                    positionSide: resolvedPosSide,
                    closeSide: v2DirectDispatch.closeSide,
                    expectedQtyBase: v2DirectDispatch.qty,
                    expectedQtyRatio: v2DirectDispatch.fraction,
                    triggerPrice: Number(price) || null,
                    triggerSource: "V2_DIRECT_TICK_EXIT_DISPATCH",
                    reduceOnly: true,
                    closePosition: false,
                    status: "OPEN",
                    source: "V2_DIRECT_EXIT_DISPATCH",
                    extra: {
                      v2_direct_dispatch: true,
                      triggered_kinds: v2DirectDispatch.triggeredKinds,
                      run_id: dispatchRunId,
                      idempotency_key: v2DirectDispatch.idempotencyKey,
                    },
                  });
                } catch (ledgerErr) {
                  structuredLog("v2_direct_exit_dispatch_ledger_fail", {
                    exchange: "BINANCEFUT",
                    symbol,
                    run_id: dispatchRunId,
                    order_id: v2DispatchOrderId,
                    error: ledgerErr && ledgerErr.message ? ledgerErr.message : String(ledgerErr),
                    note: "Order placed successfully; ledger stamp failed. fillSync will pick up the fill via exchange poll.",
                  }, "warn");
                }
              } catch (placeErr) {
                v2DispatchPlaceError = placeErr && placeErr.message ? placeErr.message : String(placeErr);
                // 2026-04-29 R3 — `reduce_only_reject` is now a pure
                // diagnostic tag. With R1+R2 in place, a -2022 here
                // means we lost a sub-5 s race against the broker's
                // own close (e.g. native STOP fired during this tick
                // after the snapshot was cached). Force-invalidate
                // the broker snapshot so the *very next* cycle does a
                // fresh fetchBinanceFuturesAccount and R2 catches the
                // now-flat broker state — instead of waiting up to
                // 5 s for the existing snapshot to expire naturally.
                if (isReduceOnlyReject(v2DispatchPlaceError)) {
                  invalidateBrokerPositionSnapshotCache();
                }
                structuredLog("v2_direct_exit_dispatch_place_fail", {
                  exchange: "BINANCEFUT",
                  symbol,
                  run_id: dispatchRunId,
                  triggered_kinds: v2DirectDispatch.triggeredKinds,
                  close_side: v2DirectDispatch.closeSide,
                  order_qty: v2DirectDispatch.qty,
                  idempotency_key: v2DirectDispatch.idempotencyKey,
                  error: v2DispatchPlaceError,
                  reduce_only_reject: isReduceOnlyReject(v2DispatchPlaceError),
                  // R3 follow-up: if this fires repeatedly for the
                  // same symbol within a single 5 s R2 cache window,
                  // that's a real signal — open a follow-up to
                  // tighten R2 (e.g. invalidate snapshot on -2022).
                }, "warn");
              }
            } else {
              structuredLog("v2_direct_exit_dispatch_skipped_no_live_cfg", {
                exchange: "BINANCEFUT",
                symbol,
                run_id: dispatchRunId,
                live_dry_run: liveCfg && liveCfg.liveDryRun === true,
                has_api_key: !!(liveCfg && liveCfg.apiKey),
              });
            }
          }
        } catch (dispatchErr) {
          structuredLog("v2_direct_exit_dispatch_fail", {
            exchange: "BINANCEFUT",
            symbol,
            run_id: runId,
            triggered_kinds: triggeredKinds,
            error: dispatchErr && dispatchErr.message ? dispatchErr.message : String(dispatchErr),
          }, "warn");
        }
        try {
          structuredLog("v1_tick_exit_fast_lane_skipped_legacy_runtime_disabled", {
            exchange: "BINANCEFUT",
            symbol,
            tf: signalTf,
            run_id: runId,
            triggered_kinds: triggeredKinds,
            pending_forced: pendingForced === true,
            v2_direct_dispatch: !!(v2DirectDispatch && v2DirectDispatch.dispatch === true),
            v2_direct_dispatch_placed: v2DispatchPlaced,
            v2_direct_dispatch_place_error: v2DispatchPlaceError,
            note: "V1 EXIT_ONLY runPaperMarket bypassed; V2 direct dispatch handled reduceOnly close (Stage U-followup-1+2).",
          });
        } catch (_) { /* observability only */ }
        continue;
      }
      const pre = await runActionPreHooks({
        action: "BINANCE_TICK_EXIT_MARKET_RUN",
        runId,
        exchange: "BINANCEFUT",
        symbol,
        tf: signalTf,
        signalEvent: "TICK_EXIT",
        decisionReason: pendingForced ? "PENDING_INTENT_FORCED" : "NEAR_TRIGGER",
        source: "BINANCE_TICK_EXIT",
        executionMode: "LIVE",
        intent: "EXIT",
        writer: structuredLogWriter,
        persist: true,
      });
      const runResult = await runPaperMarket({
        exchange: "BINANCEFUT",
        symbol,
        tf: signalTf,
        execTf,
        barCloseUtc: new Date(now).toISOString(),
        barCloseMs: now,
        bar,
        gate: null,
        trading_mode: "EXIT_ONLY",
        backfillExitOnly: true,
        runId,
      });
      runActionPostHooks({
        envelope: pre.envelope,
        ok: true,
        reason: "TICK_EXIT_MARKET_RUN_COMPLETED",
        writer: structuredLogWriter,
        persist: true,
        result: {
          fills_executed: Number(runResult && runResult.fills_executed) || 0,
          intents_created: Number(runResult && runResult.intents_created) || 0,
          pending_forced: pendingForced === true,
        },
      });
      if (triggeredKinds.includes("TRAIL")) {
        await recordTrailRuntimeEvent({
          exchange: "BINANCEFUT",
          symbol,
          event: "TRAIL_TRIGGER_COMPLETED",
          runId,
          tsMs: nowMs(),
          payload: {
            status: trailAuthority && trailAuthority.status || "CLEAR",
            reason: trailAuthority && trailAuthority.reason || "TRAIL_AUTHORITY_OK",
            triggered_kinds: triggeredKinds,
            fills_executed: Number(runResult && runResult.fills_executed) || 0,
            intents_created: Number(runResult && runResult.intents_created) || 0,
            pending_forced: pendingForced === true,
          },
        }).catch(() => null);
      }
      if ((Number(runResult && runResult.fills_executed) || 0) > 0 || (Number(runResult && runResult.intents_created) || 0) > 0) {
        try {
          const integrity = await auditBinanceExitIntegrity({ symbols: [symbol], includeFlat: true });
          const issueCount = Number(integrity && integrity.issue_count) || 0;
          const topIssue = Array.isArray(integrity && integrity.issues) && integrity.issues.length
            ? integrity.issues[0]
            : null;
          emitActionEvent({
            event: "action_post_integrity",
            envelope: pre.envelope,
            writer: structuredLogWriter,
            persist: true,
            extra: {
              hook: "post",
              ok: integrity && integrity.ok === true,
              issue_count: issueCount,
              top_issue_code: topIssue && topIssue.code ? String(topIssue.code).toUpperCase() : null,
              top_issue_severity: topIssue && topIssue.severity ? String(topIssue.severity).toUpperCase() : null,
              audit_scope: "EXIT_INTEGRITY_SYMBOL",
            },
            level: issueCount > 0 ? "warn" : "log",
          });
        } catch (auditErr) {
          emitActionEvent({
            event: "action_post_integrity",
            envelope: pre.envelope,
            writer: structuredLogWriter,
            persist: true,
            extra: {
              hook: "post",
              ok: false,
              audit_scope: "EXIT_INTEGRITY_SYMBOL",
              error: String(auditErr && auditErr.message || auditErr).slice(0, 240),
            },
            level: "warn",
          });
        }
      }
      try {
        const fillsExecuted = Number(runResult && runResult.fills_executed);
        const intentsCreated = Number(runResult && runResult.intents_created);
        if (Number.isFinite(intentsCreated) && Number.isFinite(fillsExecuted)) {
          if (intentsCreated > fillsExecuted) {
            pendingIntentState.set(scope, { checkedAt: nowMs(), hasPending: true });
          } else if (fillsExecuted > 0 && intentsCreated === 0) {
            pendingIntentState.set(scope, { checkedAt: nowMs(), hasPending: false });
          }
        }
      } catch (_) {}
      triggered += 1;
    } catch (symbolErr) {
      const errText = String(symbolErr && (symbolErr.stack || symbolErr.message) || symbolErr).slice(0, 500);
      runActionPostHooks({
        envelope: {
          run_id: null,
          signal_id: null,
          intent_id: null,
          signal_event: "TICK_EXIT",
          ts: new Date().toISOString(),
          exchange: "BINANCEFUT",
          symbol: String(symbol || "").toUpperCase() || null,
          tf: signalTf || null,
          decision_reason: "SYMBOL_LOOP_ERROR",
          source: "BINANCE_TICK_EXIT",
          execution_mode: "LIVE",
          action: "BINANCE_TICK_EXIT_MARKET_RUN",
        },
        ok: false,
        reason: "TICK_EXIT_MARKET_RUN_FAILED",
        writer: structuredLogWriter,
        persist: true,
        result: null,
        extra: {
          error: errText,
        },
      });
      structuredLog("tick_exit_symbol_fail", {
        exchange: "BINANCEFUT",
        symbol: String(symbol).toUpperCase(),
        error: errText,
      }, "warn");
      await sendTickExitFailureAlert({
        symbol,
        error: errText,
        phase: "SYMBOL_LOOP",
        position: pos,
        price,
      });
      continue;
    }
  }

  return {
    ok: true,
    active_count: active.length,
    checked,
    triggered,
    skipped_cooldown: skippedCooldown,
    fast_lane_active: fastLaneActive,
    fast_lane_symbols: Array.from(fastLaneSymbols),
  };
}

async function runBinanceTickExitBurst({
  maxDurationMs,
  maxIterations,
  intervalMs,
  symbolCooldownMs,
  fastLaneEnabled,
  fastLaneIntervalMs,
  nearPct,
  targetSymbols = null,
} = {}) {
  if (!env.tickExit || env.tickExit.enabled !== true) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  const intervalMsResolved = normalizeIntervalMs(
    intervalMs != null ? intervalMs : (env.tickExit && env.tickExit.intervalMs),
    10000
  );
  const fastLaneIntervalResolved = normalizeIntervalMs(
    fastLaneIntervalMs != null ? fastLaneIntervalMs : (env.tickExit && env.tickExit.fastLaneIntervalMs),
    1000
  );
  const symbolCooldownResolved = normalizeIntervalMs(
    symbolCooldownMs != null ? symbolCooldownMs : (env.tickExit && env.tickExit.symbolCooldownMs),
    20000
  );
  const nearPctResolved = Number.isFinite(Number(nearPct))
    ? Number(nearPct)
    : Number(env.tickExit && env.tickExit.nearPct || 0.003);
  const fastLaneEnabledResolved = fastLaneEnabled != null
    ? fastLaneEnabled === true
    : (env.tickExit && env.tickExit.fastLaneEnabled !== false);
  const normalizedTargetSymbols = normalizeTargetSymbols(targetSymbols);
  const maxDurationResolved = Math.max(5000, Math.floor(Number(maxDurationMs || 55000)));
  const maxIterationsResolved = Math.max(1, Math.floor(Number(maxIterations || 20)));
  const startedAt = nowMs();
  const leaseTtlMs = Math.max(
    TICK_EXIT_LEASE_MIN_TTL_MS,
    maxDurationResolved + Math.max(intervalMsResolved, fastLaneIntervalResolved) * 2
  );
  const lease = await acquireTickExitLease({ ttlMs: leaseTtlMs });
  if (!lease.ok) {
    return { ok: false, skipped: true, reason: "LEASE_FAIL", error: lease.error || "UNKNOWN" };
  }
  if (lease.acquired !== true) {
    return { ok: true, skipped: true, reason: "LEASE_HELD", holder: lease.holder || null };
  }

  let iterations = 0;
  let nextDelayMs = intervalMsResolved;
  let lastResult = null;
  let selfHealResult = null;

  try {
    while (iterations < maxIterationsResolved) {
      lastResult = await runBinanceTickExitOnce({
        nearPct: nearPctResolved,
        symbolCooldownMs: symbolCooldownResolved,
        targetSymbols: normalizedTargetSymbols,
      });
      iterations += 1;

      const activeCount = Number(lastResult && lastResult.active_count) || 0;
      const fastLaneActive = fastLaneEnabledResolved && lastResult && lastResult.fast_lane_active === true;
      nextDelayMs = fastLaneActive
        ? Math.min(intervalMsResolved, fastLaneIntervalResolved)
        : intervalMsResolved;

      if (activeCount <= 0) break;
      if ((nowMs() - startedAt + nextDelayMs) >= maxDurationResolved) break;
      await sleep(nextDelayMs);
    }
  } finally {
    await releaseTickExitLease();
  }

  selfHealResult = await runTickExitSelfHealPhase({
    reason: "TICK_EXIT_BURST",
  });

  const activeCount = Number(lastResult && lastResult.active_count) || 0;
  return {
    ok: true,
    iterations,
    elapsed_ms: nowMs() - startedAt,
    next_delay_ms: nextDelayMs,
    reschedule_recommended: activeCount > 0,
    target_symbols: normalizedTargetSymbols,
    last_result: lastResult,
    self_heal: selfHealResult,
  };
}

async function runTickExitSelfHealPhase({
  enabled = String(process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED || "1") !== "0",
  reason = "TICK_EXIT_LOOP",
  leaseHeartbeatOk = true,
  maxPositions = Math.max(1, Number(process.env.BINANCE_LIVE_STATE_SELF_HEAL_MAX_POSITIONS || 12)),
  cooldownMs = BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS,
  runSelfHeal = runBinanceLiveStateSelfHeal,
} = {}) {
  if (enabled !== true) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  if (leaseHeartbeatOk !== true) {
    return { ok: false, skipped: true, reason: "LEASE_LOST" };
  }
  const now = nowMs();
  const resolvedCooldownMs = Math.max(0, Number(cooldownMs) || 0);
  if (resolvedCooldownMs > 0 && Number.isFinite(lastTickExitSelfHealAt) && (now - lastTickExitSelfHealAt) < resolvedCooldownMs) {
    return {
      ok: true,
      skipped: true,
      reason: "COOLDOWN",
      cooldown_ms: resolvedCooldownMs,
      cooldown_remaining_ms: Math.max(0, resolvedCooldownMs - (now - lastTickExitSelfHealAt)),
    };
  }
  try {
    const result = await runSelfHeal({
      exchange: "BINANCEFUT",
      maxPositions,
      reason,
    });
    lastTickExitSelfHealAt = now;
    return result;
  } catch (e) {
    return {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }
}

async function acquireTickExitLease({ ttlMs } = {}) {
  if (!TICK_EXIT_LEASE_ENABLED) return { ok: true, acquired: true, leaseDisabled: true };
  const ttl = Math.max(TICK_EXIT_LEASE_MIN_TTL_MS, normalizeIntervalMs(ttlMs, TICK_EXIT_LEASE_MIN_TTL_MS));
  const now = Date.now();
  const leaseUntil = now + ttl;
  const db = getFirestore();
  const ref = db.doc(TICK_EXIT_LEASE_DOC);

  try {
    let acquired = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? (snap.data() || {}) : {};
      const owner = String(data.owner || "");
      const leaseUntilMs = Number(data.lease_until_ms);
      const heartbeatMs = Number(data.heartbeat_ms);
      const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
      const heartbeatFreshMaxMs = Math.max(ttl * 2, 10000);
      const heartbeatFresh = Number.isFinite(heartbeatMs) && (now - heartbeatMs) <= heartbeatFreshMaxMs;
      const staleHolder = !!owner && owner !== tickExitInstanceId && !expired && !heartbeatFresh;
      if (!owner || owner === tickExitInstanceId || expired || staleHolder) {
        acquired = true;
        tx.set(ref, {
          owner: tickExitInstanceId,
          lease_until_ms: leaseUntil,
          heartbeat_at: new Date(now).toISOString(),
          heartbeat_ms: now,
        }, { merge: true });
      } else {
        acquired = false;
        holder = owner;
      }
    });
    return { ok: true, acquired, holder };
  } catch (e) {
    return { ok: false, acquired: false, error: e && e.message ? e.message : String(e) };
  }
}

async function releaseTickExitLease() {
  if (!TICK_EXIT_LEASE_ENABLED) return;
  try {
    const db = getFirestore();
    const ref = db.doc(TICK_EXIT_LEASE_DOC);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const owner = String(data.owner || "");
      if (owner !== tickExitInstanceId) return;
      tx.set(ref, {
        lease_until_ms: Date.now() - 1,
        released_at: new Date().toISOString(),
      }, { merge: true });
    });
  } catch (_) {}
}

async function heartbeatTickExitLease({ ttlMs = TICK_EXIT_LEASE_MIN_TTL_MS } = {}) {
  if (!TICK_EXIT_LEASE_ENABLED) return { ok: true, leaseDisabled: true };
  try {
    const db = getFirestore();
    const ref = db.doc(TICK_EXIT_LEASE_DOC);
    const now = Date.now();
    const leaseUntil = now + Math.max(ttlMs, TICK_EXIT_LEASE_MIN_TTL_MS);
    let ok = false;
    let holder = null;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const data = snap.data() || {};
      const owner = String(data.owner || "");
      if (owner !== tickExitInstanceId) {
        holder = owner || null;
        return;
      }
      ok = true;
      tx.set(ref, {
        lease_until_ms: leaseUntil,
        heartbeat_at: new Date(now).toISOString(),
        heartbeat_ms: now,
      }, { merge: true });
    });
    return { ok, holder, leaseUntil };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

let loopTimer = null;
let loopRunning = false;
let loopStarted = false;

function startBinanceTickExitLoop() {
  if (loopStarted) return { ok: true, running: true };
  if (!env.tickExit || env.tickExit.enabled !== true) return { ok: false, skipped: true, reason: "DISABLED" };
  loopStarted = true;
  const intervalMs = normalizeIntervalMs(env.tickExit.intervalMs, 10000);
  const fastLaneEnabled = env.tickExit.fastLaneEnabled !== false;
  const fastLaneIntervalMs = normalizeIntervalMs(env.tickExit.fastLaneIntervalMs, 1000);
  const symbolCooldownMs = normalizeIntervalMs(env.tickExit.symbolCooldownMs, 20000);
  const leaseTtlMs = Math.max(intervalMs * 3, TICK_EXIT_LEASE_MIN_TTL_MS);
  const nearPct = Number(env.tickExit.nearPct || 0.003);
  const fastLanePct = Number(env.tickExit.fastLanePct || 0.003);
  let nextDelayMs = intervalMs;
  let fastLaneArmed = false;

  const loop = async () => {
    if (!loopStarted) return;
    if (loopRunning) {
      loopTimer = setTimeout(loop, nextDelayMs);
      return;
    }
    loopRunning = true;
    try {
      const lease = await acquireTickExitLease({ ttlMs: leaseTtlMs });
      if (!lease.ok) {
        console.warn("[TICK_EXIT_LEASE_FAIL]", lease.error || "UNKNOWN");
      }
      if (lease.ok && lease.acquired !== true) {
        const now = Date.now();
        if ((now - leaseSkippedLogAt) >= TICK_EXIT_LEASE_LOG_COOLDOWN_MS) {
          leaseSkippedLogAt = now;
          structuredLog("tick_exit_skipped_by_lease", {
            owner: lease.holder || null,
            instance: tickExitInstanceId,
          });
        }
      } else {
        const heartbeatEveryMs = Math.max(1000, Math.floor(leaseTtlMs / 3));
        let heartbeatTimer = null;
        try {
          heartbeatTimer = setInterval(() => {
            heartbeatTickExitLease({ ttlMs: leaseTtlMs }).catch(() => {});
          }, heartbeatEveryMs);
          const result = await runBinanceTickExitOnce({ nearPct, symbolCooldownMs });
          const heartbeat = await heartbeatTickExitLease({ ttlMs: leaseTtlMs });
          if (!heartbeat.ok) {
            structuredLog("tick_exit_lease_lost", {
              owner: heartbeat.holder || null,
              instance: tickExitInstanceId,
            }, "warn");
            result.self_heal = await runTickExitSelfHealPhase({
              reason: "TICK_EXIT_LOOP",
              leaseHeartbeatOk: false,
            });
            nextDelayMs = intervalMs;
          } else {
            result.self_heal = await runTickExitSelfHealPhase({
              reason: "TICK_EXIT_LOOP",
              leaseHeartbeatOk: true,
            });
            const useFastLane = fastLaneEnabled && result && result.fast_lane_active === true;
            nextDelayMs = useFastLane ? Math.min(intervalMs, fastLaneIntervalMs) : intervalMs;
            if (useFastLane !== fastLaneArmed) {
              fastLaneArmed = useFastLane;
              structuredLog(useFastLane ? "tick_exit_fastlane_on" : "tick_exit_fastlane_off", {
                interval_ms: nextDelayMs,
                base_interval_ms: intervalMs,
                fastlane_interval_ms: fastLaneIntervalMs,
                fastlane_pct: fastLanePct,
                symbols: Array.isArray(result && result.fast_lane_symbols) ? result.fast_lane_symbols : [],
              });
            }
          }
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }
    } catch (e) {
      const errText = e && (e.stack || e.message) ? (e.stack || e.message) : String(e);
      console.warn("[TICK_EXIT_FAIL]", errText);
      sendTickExitFailureAlert({
        symbol: null,
        error: errText,
        phase: "LOOP",
        position: null,
        price: null,
      }).catch(() => {});
    } finally {
      loopRunning = false;
      if (loopStarted) loopTimer = setTimeout(loop, nextDelayMs);
    }
  };

  loopTimer = setTimeout(loop, intervalMs);
  return {
    ok: true,
    running: true,
    intervalMs,
    symbolCooldownMs,
    leaseEnabled: TICK_EXIT_LEASE_ENABLED,
    fastLaneEnabled,
    fastLaneIntervalMs,
    fastLanePct,
  };
}

function stopBinanceTickExitLoop() {
  loopStarted = false;
  loopRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  symbolCooldownState.clear();
  symbolCooldownLogState.clear();
  pendingIntentState.clear();
  pendingIntentLogState.clear();
  tpP1PendingTerminalAlertState.clear();
  tpP1AckTimeoutAlertState.clear();
  tp1MetaSyncGapAlertState.clear();
  tp1NativeProtectionGapState.clear();
  tp1NativeProtectionGapAlertState.clear();
  nativeProtectionStateCache.clear();
  nativeProtectionRefreshAttemptState.clear();
  trailHardExitCooldownState.clear();
  releaseTickExitLease().catch(() => {});
  return { ok: true, running: false };
}

module.exports = {
  startBinanceTickExitLoop,
  stopBinanceTickExitLoop,
  runBinanceTickExitOnce,
  runBinanceTickExitBurst,
  __test: {
    buildTickTrailObservationDocUpdate,
    buildTickTrailReconcileRunId,
    computeTrailWatermarkPatch,
    computeBreakEvenRaiseDecision,
    buildBinanceTickExitNativeProtectionRefreshArgs,
    buildBreakEvenStopRefreshObservability,
    refreshBinanceTickExitNativeProtection,
    syncTickExitTrailObservation,
    runTickExitSelfHealPhase,
    heartbeatTickExitLease,
    computeExitTriggers,
    shouldCheckNear,
    collectTriggeredKinds,
    shouldActivateFastLane,
    applyTrailObservationToPosition,
    isNativeStopLessProtectiveThanTrigger,
    resolvePositionSignalTf,
    shouldBypassNativeProtectionCache,
    hasNativeStopProtection,
    hasNativeTpProtection,
    shouldEagerRefreshNativeProtection,
    shouldTrackTp1NativeRefreshLifecycle,
    buildTp1NativeRefreshTelemetryPayload,
    buildTp1MetaSyncTelemetryPayload,
    resolveTp1NativeProtectionGap,
    shouldRunNativeProtectionRefreshCooldown,
    shouldTriggerTrailHardExit,
    shouldRunBySymbolCooldown,
    normalizeTargetSymbols,
    resolveTickExitSymbolsToCheck,
    isTpP1IntentEvent,
    isTpP1PendingTerminalFailureIntent,
    resolveTpP1AckWatchdogDecision,
    buildTpP1PendingTerminalAlertPayload,
    shouldSendTpP1PendingTerminalAlert,
    buildTpP1AckTimeoutAlertPayload,
    shouldSendTpP1AckTimeoutAlert,
    shouldSendTp1MetaSyncGapAlert,
    buildTp1MetaSyncGapAlertPayload,
    requestTp1MetaSyncGapRepair,
    handleTp1MetaSyncGap,
    appendTickExitAudit,
    shouldSendTp1NativeProtectionGapAlert,
    buildTp1NativeProtectionGapAlertPayload,
    requestTp1NativeProtectionGapRepair,
    handleTp1NativeProtectionGap,
    _symbolCooldownState: symbolCooldownState,
    _tp1MetaSyncGapAlertState: tp1MetaSyncGapAlertState,
    _tp1NativeProtectionGapState: tp1NativeProtectionGapState,
    _tp1NativeProtectionGapAlertState: tp1NativeProtectionGapAlertState,
    _tpP1PendingTerminalAlertState: tpP1PendingTerminalAlertState,
    _tpP1AckTimeoutAlertState: tpP1AckTimeoutAlertState,
    _tickExitFailureAlertState: tickExitFailureAlertState,
    _nativeProtectionRefreshAttemptState: nativeProtectionRefreshAttemptState,
    _trailHardExitCooldownState: trailHardExitCooldownState,
    // 2026-04-29 R3 — Retired the post-rejection cooldown (replaced by
    // R1 + R2). isReduceOnlyReject is kept as a diagnostic tag for the
    // place_fail log path (race detection).
    isReduceOnlyReject,
    // 2026-04-29 ROOT-CAUSE (R1) — Optimistic exit-in-flight inhibit
    markExitInFlight,
    clearExitInFlight,
    isExitInFlight,
    getExitInFlightRecord,
    _exitInFlightState: exitInFlightState,
    EXIT_IN_FLIGHT_TTL_MS,
    // 2026-04-29 ROOT-CAUSE (R2) — Broker truth pre-filter
    buildBrokerPositionSnapshot,
    getBrokerPositionSnapshot,
    invalidateBrokerPositionSnapshotCache,
    BROKER_POSITION_SNAPSHOT_TTL_MS,
    applyAlertCacheCap,
    clearSelfHealCooldown() {
      lastTickExitSelfHealAt = 0;
    },
    shouldSendTickExitFailureAlert,
  },
};
