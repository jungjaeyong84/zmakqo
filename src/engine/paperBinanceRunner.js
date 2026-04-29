// src/engine/paperBinanceRunner.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  generateSignals,
  resolveExitRulesForPosition,
  computeRunnerExitStopPrice,
  evaluateTp1LadderStage,
  applyTp1LadderPolicy,
} = require("./signalEngine");
const { computeFillPrice, computeFeeValue } = require("./paperExecution");

const {
  listPendingIntentsForExec,
  listPendingIntentsOverdue,
  claimPendingIntentForExecution,
  cancelExpiredPendingIntents,
  markIntentStatus,
  upsertIntent,
  patchIntent,
} = require("../storage/orderIntentsPaper");
const { upsertFill } = require("../storage/fillsPaper");
const { upsertPosition, upsertPositionMetaOnly, getPosition } = require("../storage/positionsPaper");
const { upsertExitOrderContract } = require("../storage/exitOrderContracts");
const {
  getPositionRuntimeObservation,
  upsertSameDirectionTrailProfitObservation,
  resolveTrailObservationSnapshot,
} = require("../storage/positionRuntimeObservations");
const { buildTradeId, upsertTradeEvent } = require("../storage/tradesPaper");
const { recordCanonicalExitTransitions } = require("../storage/canonicalExitTransitions");
const { upsertSignal } = require("../storage/signals");
const { markSignalConsumed, tryLockSignal } = require("../storage/signalsConsume");
const { recordOpenClawPolicyDecision } = require("../storage/openclawPolicyDecisions");
const { recordExitRepairRequest } = require("../storage/exitRepairRequests");
const { getSignalsForBar } = require("../storage/signalsQuery");
const { queryBars } = require("../storage/barsSnapshots");
const { recordSignalDrops } = require("../storage/signalDrops");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { getExchangeSettingsForProvider, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const {
  evaluateEntryBudgetGuard,
  resolveEntryBudgetGuardFeasibleBand,
} = require("../utils/entryBudgetGuard");
const { getFirestore } = require("../storage/firestore");
const { tfToMs, normalizeTf, defaultExecTfFromEnv } = require("../utils/marketConfig");
const {
  toPositiveMs: nativeProtectionWindowToPositiveMs,
  computeWindowMs: computeNativeProtectionWindowMs,
} = require("../utils/nativeProtectionWindowMath");
const { normalizeEvalExchange, evalLatestId, matchesEvalTf } = require("../utils/evalDoc");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { buildExitStageView } = require("../utils/exitStageView");
const {
  isSimplifiedExitV2Active,
  resolveSimplifiedExitV2FlagFromSnapshot,
} = require("../services/simplifiedExitV2");
const { getPositionReadView, listExchangePositionReadViews } = require("../services/positionReadModel");
const { resolveBinanceFuturesKeys } = require("../utils/binanceKeyResolver");
const {
  BINANCE_NATIVE_STOP_WRITER_SOURCE,
  isBinanceNativeStopWriterSource,
} = require("../utils/binanceNativeProtectionWriter");
const { normalizePositionSide } = require("../utils/positionSide");
const {
  resolveEntryTimingTier,
  resolveEntryQtyProfile,
} = require("../utils/liveEntryTaxonomy");
const {
  normalizeSignalStateToken: normalizeSignalStateTokenShared,
  resolveRegimeRecord,
} = require("../utils/regime");
const { resolveMarketStateSummary } = require("../utils/marketStateSummary");
const { evaluateOpenClawExecutionAuthority } = require("../services/openclawExecutionAuthority");
const { resolveEventMapping } = require("../services/signalMapping");
const { normalizeEvent, deriveGroupSubtype } = require("../services/signalStandard");
const {
  evaluateCanonicalDecision,
  resolveCanonicalEngineConfig: resolveCanonicalEngineConfigShared,
} = require("../services/canonicalEngine");
const {
  buildExitQuantityContractLedger,
  resolveCanonicalExitWritePayload,
} = require("../services/positionStateMachine");
const { sendTradeExecutionAlert, sendTradeExecutionFailureAlert } = require("../services/tradeExecutionAlert");
const { sendSignalReceivedAlert, sendSignalProgressAlert } = require("../services/signalLifecycleAlert");
const { sendAlert } = require("../utils/alerts");
const { runV2DiscoveryCanaryServerSignalHandoff } = require("../v2/discoveryCanaryServerSignalBridge");
const { generateV2EntrySignals } = require("../v2/serverEntrySignalGenerator");
const {
  getV2ServerEntryCooldownState,
  setV2ServerEntryCooldownState,
} = require("../storage/v2ServerEntryCooldown");
const { normalizeRiskGovernorSurface } = require("../v2/riskGovernorSurface");
const {
  resolveDiscoverySymbolNotionalQuote,
  resolveDiscoverySymbolNotionalQuoteMap,
} = require("../v2/discoveryCanaryNotionalPolicy");
const { estimateTp1ReachProbability } = require("../services/evTp1Probability");
const { resolveWaitOneBarConfig, evaluateWaitOneBarTiming } = require("../services/waitOneBarPolicy");
const {
  buildServerNativeInitialSignals,
  HTF_TF: SERVER_NATIVE_HTF_TF,
  minBaseBarsForDerivedHtf,
} = require("../services/serverNativeInitialSignal");
const { getBinanceFuturesAccountSummary } = require("../services/binanceFuturesAccountSummary");
const { fetchRecentNewFills, buildTradesFromFills } = require("../services/tradesFromFills");
const {
  fetchFuturesExchangeInfo,
  fetchFuturesOpenOrders,
  fetchFuturesAlgoOpenOrders,
  fetchFuturesOrder,
  fetchBinanceFuturesAccount,
  setFuturesLeverage,
  setFuturesMarginType,
  fetchFuturesPositionMode,
  calcAveragePrice: calcBinanceAveragePrice
} = require("../exchanges/binanceFuturesPrivate");
const { triggerExitWorkerRun } = require("../services/exitWorkerClient");
const { reconcileBinancePositionMetaWithExchange } = require("../services/binancePositionReconciler");
const {
  placeFuturesMarketOrder,
  placeFuturesStopMarketOrder,
  placeFuturesTakeProfitMarketOrder,
  cancelFuturesOpenOrders,
  placeFuturesEntryMakerFirst,
} = require("./legacy/v1ExchangeWriters");
const {
  isMakerFirstEnabled: isEntryMakerFirstEnabled,
} = require("../services/binanceMakerFirstEntry");
const { writeOpenClawShadowEntryBootstrap } = require("../v2/openclawShadowPositionWriter");
const {
  writeOpenClawShadowTp1Transition,
  writeOpenClawShadowTrailActivation,
  writeOpenClawShadowStopExit,
  writeOpenClawShadowExternalClose,
} = require("../v2/openclawShadowExitWriter");

const POS_SIZE_EPSILON = (() => {
  const raw = Number(process.env.POS_SIZE_EPSILON);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 0.0001;
})();

const TP_P1_FILL_CACHE_TTL_MS = 10 * 1000;
const TP_P1_FILL_CACHE_LIMIT = 200;
const recentFillsCache = {
  ts: 0,
  rows: [],
};
const futuresPositionSyncQueue = new Map();
const futuresPositionSyncRecentState = new Map();
const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const OPENCLAW_MARKET_REGIME_BOARD_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_openclaw_market_regime_board_latest.json");
const PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_performance_kpi_upgrade_contract_latest.json");
const OPENCLAW_MARKET_REGIME_CACHE_TTL_MS = 15 * 1000;
const openclawMarketRegimeCache = {
  ts: 0,
  mtimeMs: null,
  byMarket: new Map(),
};
const TP1_LADDER_KPI_CACHE_TTL_MS = 15 * 1000;
const tp1LadderKpiCache = {
  ts: 0,
  mtimeMs: null,
  value: null,
};

function ratioToPctTokenLocal(ratio) {
  const n = Math.abs(Number(ratio));
  if (!Number.isFinite(n) || n <= 0) return null;
  const pct = Math.round(n * 10000) / 100;
  return String(pct).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function buildExitContractAlertPayload({ pos = null, posMeta = null, exitRules = null, observedQtyAbs = null } = {}) {
  const position = pos && typeof pos === "object" ? pos : {};
  const meta = posMeta && typeof posMeta === "object" ? posMeta : {};
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: Number(position.qty_base),
      entry_qty_base: position.entry_qty_base ?? meta.entry_qty_base ?? null,
      meta,
    },
    rules: exitRules || null,
  });
  return {
    contractEntryQtyAbs: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    contractTp0AllowedAbs: Number.isFinite(Number(ledger.tp0_allowed_abs)) ? Number(ledger.tp0_allowed_abs) : null,
    contractTp0ConsumedAbs: Number.isFinite(Number(ledger.tp0_consumed_abs)) ? Number(ledger.tp0_consumed_abs) : null,
    contractTp1AllowedAbs: Number.isFinite(Number(ledger.tp1_allowed_abs)) ? Number(ledger.tp1_allowed_abs) : null,
    contractTp1ConsumedAbs: Number.isFinite(Number(ledger.tp1_consumed_abs)) ? Number(ledger.tp1_consumed_abs) : null,
    contractRunnerAllowedAbs: Number.isFinite(Number(ledger.runner_allowed_abs)) ? Number(ledger.runner_allowed_abs) : null,
    contractRunnerRemainingAbs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    contractTrailConsumedAbs: Number.isFinite(Number(ledger.trail_consumed_abs)) ? Number(ledger.trail_consumed_abs) : null,
    contractObservedQtyAbs: Number.isFinite(Number(observedQtyAbs)) ? Number(observedQtyAbs) : null,
  };
}

function buildStoredExitLedgerMetaPatch({
  position = null,
  posMeta = null,
  exitRules = null,
  qtyBaseOverride = null,
  entryQtyBaseOverride = null,
} = {}) {
  const meta = posMeta && typeof posMeta === "object" ? posMeta : {};
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: Number.isFinite(Number(qtyBaseOverride))
        ? Number(qtyBaseOverride)
        : Number(position && position.qty_base),
      entry_qty_base: Number.isFinite(Number(entryQtyBaseOverride))
        ? Number(entryQtyBaseOverride)
        : (position && position.entry_qty_base != null ? position.entry_qty_base : (meta.entry_qty_base ?? meta.entry_qty_abs ?? null)),
      meta,
    },
    rules: exitRules || null,
  });
  return {
    entry_qty_base: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    entry_qty_abs: Number.isFinite(Number(ledger.entry_qty_abs)) ? Number(ledger.entry_qty_abs) : null,
    tp_p0_allowed_qty_abs: Number.isFinite(Number(ledger.tp0_allowed_abs)) ? Number(ledger.tp0_allowed_abs) : null,
    tp_p0_consumed_qty_abs: Number.isFinite(Number(ledger.tp0_consumed_abs)) ? Number(ledger.tp0_consumed_abs) : null,
    tp_p1_allowed_qty_abs: Number.isFinite(Number(ledger.tp1_allowed_abs)) ? Number(ledger.tp1_allowed_abs) : null,
    tp_p1_consumed_qty_abs: Number.isFinite(Number(ledger.tp1_consumed_abs)) ? Number(ledger.tp1_consumed_abs) : null,
    runner_allowed_qty_abs: Number.isFinite(Number(ledger.runner_allowed_abs)) ? Number(ledger.runner_allowed_abs) : null,
    runner_remaining_qty_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    canonical_runner_remaining_abs: Number.isFinite(Number(ledger.runner_remaining_abs)) ? Number(ledger.runner_remaining_abs) : null,
    trail_consumed_qty_abs: Number.isFinite(Number(ledger.trail_consumed_abs)) ? Number(ledger.trail_consumed_abs) : null,
    total_consumed_qty_abs: (
      Number.isFinite(Number(ledger.entry_qty_abs)) && Number.isFinite(Number(ledger.total_consumed_ratio))
    ) ? (Number(ledger.entry_qty_abs) * Number(ledger.total_consumed_ratio)) : null,
    tp_p0_allowed_qty_ratio: Number.isFinite(Number(ledger.tp0_allowed_ratio)) ? Number(ledger.tp0_allowed_ratio) : null,
    tp_p0_consumed_qty_ratio: Number.isFinite(Number(ledger.tp0_consumed_ratio)) ? Number(ledger.tp0_consumed_ratio) : null,
    tp_p1_allowed_qty_ratio: Number.isFinite(Number(ledger.tp1_allowed_ratio)) ? Number(ledger.tp1_allowed_ratio) : null,
    tp_p1_consumed_qty_ratio: Number.isFinite(Number(ledger.tp1_consumed_ratio)) ? Number(ledger.tp1_consumed_ratio) : null,
    runner_allowed_qty_ratio: Number.isFinite(Number(ledger.runner_allowed_ratio)) ? Number(ledger.runner_allowed_ratio) : null,
    runner_remaining_qty_ratio: Number.isFinite(Number(ledger.runner_remaining_ratio)) ? Number(ledger.runner_remaining_ratio) : null,
    trail_consumed_qty_ratio: Number.isFinite(Number(ledger.trail_consumed_ratio)) ? Number(ledger.trail_consumed_ratio) : null,
    total_consumed_qty_ratio: Number.isFinite(Number(ledger.total_consumed_ratio)) ? Number(ledger.total_consumed_ratio) : null,
  };
}

function buildCanonicalExitAlertPayload({
  event = null,
  position = null,
  posMeta = null,
  exitRules = null,
  observedQtyRatio = null,
  fullExit = false,
} = {}) {
  const pos = position && typeof position === "object" ? position : {};
  const meta = posMeta && typeof posMeta === "object" ? posMeta : {};
  const decision = resolveCanonicalExitWritePayload({
    event,
    positionSnapshot: {
      ...pos,
      meta,
    },
    rules: exitRules || null,
    observedQtyRatio,
    fullExit,
  });
  if (!decision || !decision.stage || decision.stage === "OTHER" || decision.stage === "OTHER_EXIT") return {};
  const ledger = decision.ledger || buildExitQuantityContractLedger({
    positionSnapshot: {
      qty_base: Number(pos.qty_base),
      entry_qty_base: pos.entry_qty_base ?? meta.entry_qty_base ?? meta.entry_qty_abs ?? null,
      meta,
    },
    rules: exitRules || null,
  });
  return {
    canonicalExitEvent: decision.event || null,
    canonicalExitStage: decision.stage,
    canonicalTransitionEvent: decision.primaryTransitionEvent || null,
    canonicalTransitionEvents: Array.isArray(decision.transitionEvents) ? decision.transitionEvents : [],
    canonicalExitReason: decision.reason || null,
    canonicalExitChainKey: decision.chainKey || null,
    canonicalExitStageRelocked: decision.stageRelocked === true,
    canonicalExitBlockedInvariant: decision.blockedInvariant === true,
    canonicalExitLedgerBlockedInvariant: decision.ledgerBlockedInvariant === true,
    canonicalExitLedgerIssueCodes: Array.isArray(decision.ledgerValidation && decision.ledgerValidation.issues)
      ? decision.ledgerValidation.issues.map((issue) => String(issue && issue.code || "").trim().toUpperCase()).filter(Boolean)
      : [],
    canonicalExitLedger: ledger,
  };
}

function buildInternalFillCanonicalExtra({
  canonicalExitAlertPayload = null,
  exitContractAlertPayload = null,
} = {}) {
  const canonical = canonicalExitAlertPayload && typeof canonicalExitAlertPayload === "object"
    ? canonicalExitAlertPayload
    : {};
  const contract = exitContractAlertPayload && typeof exitContractAlertPayload === "object"
    ? exitContractAlertPayload
    : {};
  return {
    canonical_exit_event: canonical.canonicalExitEvent || null,
    canonical_exit_stage: canonical.canonicalExitStage || null,
    canonical_primary_transition_event: canonical.canonicalTransitionEvent || null,
    canonical_transition_events: Array.isArray(canonical.canonicalTransitionEvents)
      ? canonical.canonicalTransitionEvents
      : [],
    canonical_exit_stage_relocked: canonical.canonicalExitStageRelocked === true,
    canonical_exit_blocked_invariant: canonical.canonicalExitBlockedInvariant === true,
    canonical_exit_ledger_blocked_invariant: canonical.canonicalExitLedgerBlockedInvariant === true,
    canonical_exit_ledger_issue_codes: Array.isArray(canonical.canonicalExitLedgerIssueCodes)
      ? canonical.canonicalExitLedgerIssueCodes
      : [],
    contract_entry_qty_abs: Number.isFinite(Number(contract.contractEntryQtyAbs)) ? Number(contract.contractEntryQtyAbs) : null,
    contract_tp0_allowed_abs: Number.isFinite(Number(contract.contractTp0AllowedAbs)) ? Number(contract.contractTp0AllowedAbs) : null,
    contract_tp0_consumed_abs: Number.isFinite(Number(contract.contractTp0ConsumedAbs)) ? Number(contract.contractTp0ConsumedAbs) : null,
    contract_tp1_allowed_abs: Number.isFinite(Number(contract.contractTp1AllowedAbs)) ? Number(contract.contractTp1AllowedAbs) : null,
    contract_tp1_consumed_abs: Number.isFinite(Number(contract.contractTp1ConsumedAbs)) ? Number(contract.contractTp1ConsumedAbs) : null,
    contract_runner_allowed_abs: Number.isFinite(Number(contract.contractRunnerAllowedAbs)) ? Number(contract.contractRunnerAllowedAbs) : null,
    contract_runner_remaining_abs: Number.isFinite(Number(contract.contractRunnerRemainingAbs)) ? Number(contract.contractRunnerRemainingAbs) : null,
    contract_trail_consumed_abs: Number.isFinite(Number(contract.contractTrailConsumedAbs)) ? Number(contract.contractTrailConsumedAbs) : null,
    contract_observed_qty_abs: Number.isFinite(Number(contract.contractObservedQtyAbs)) ? Number(contract.contractObservedQtyAbs) : null,
  };
}

function resolveCanonicalExitAlertBlock(canonicalExitAlertPayload = null) {
  const canonical = canonicalExitAlertPayload && typeof canonicalExitAlertPayload === "object"
    ? canonicalExitAlertPayload
    : {};
  const stage = String(canonical.canonicalExitStage || "").trim().toUpperCase();
  const transitions = Array.isArray(canonical.canonicalTransitionEvents)
    ? canonical.canonicalTransitionEvents.filter(Boolean)
    : [];
  if (canonical.canonicalExitLedgerBlockedInvariant === true) {
    return {
      blocked: true,
      reason: "CANONICAL_EXIT_LEDGER_BLOCKED",
      issueCodes: Array.isArray(canonical.canonicalExitLedgerIssueCodes)
        ? canonical.canonicalExitLedgerIssueCodes.filter(Boolean)
        : [],
    };
  }
  if ((stage === "TP0" || stage === "TP1" || stage === "TRAIL") && !transitions.length) {
    return {
      blocked: true,
      reason: "CANONICAL_EXIT_TRANSITION_MISSING",
      issueCodes: [],
    };
  }
  return {
    blocked: false,
    reason: null,
    issueCodes: [],
  };
}

function shouldEmitCanonicalExitAlert(canonicalExitAlertPayload = null) {
  return resolveCanonicalExitAlertBlock(canonicalExitAlertPayload).blocked !== true;
}

async function recordInternalCanonicalExitTransitions({
  exchange,
  symbol,
  fillId,
  tradeId = null,
  tradeMs = null,
  event = null,
  canonicalExitAlertPayload = null,
  exitContractAlertPayload = null,
  entryEventId = null,
  signalDocId = null,
} = {}) {
  const canonical = canonicalExitAlertPayload && typeof canonicalExitAlertPayload === "object"
    ? canonicalExitAlertPayload
    : {};
  const alertBlock = resolveCanonicalExitAlertBlock(canonical);
  if (alertBlock.blocked === true) return [];
  const transitions = Array.isArray(canonical.canonicalTransitionEvents)
    ? canonical.canonicalTransitionEvents.filter(Boolean)
    : [];
  if (!transitions.length) return [];
  return recordCanonicalExitTransitions({
    exchange,
    symbol,
    fillId,
    tradeId,
    tradeMs,
    canonicalEvent: canonical.canonicalExitEvent || event,
    transitionEvents: transitions,
    chainKey: signalDocId || entryEventId || null,
    reason: "INTERNAL_INTENT_FILL",
    entryEventId,
    signalDocId,
    ledger: {
      entry_qty_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractEntryQtyAbs))
        ? Number(exitContractAlertPayload.contractEntryQtyAbs)
        : null,
      tp0_allowed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractTp0AllowedAbs))
        ? Number(exitContractAlertPayload.contractTp0AllowedAbs)
        : null,
      tp0_consumed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractTp0ConsumedAbs))
        ? Number(exitContractAlertPayload.contractTp0ConsumedAbs)
        : null,
      tp1_allowed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractTp1AllowedAbs))
        ? Number(exitContractAlertPayload.contractTp1AllowedAbs)
        : null,
      tp1_consumed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractTp1ConsumedAbs))
        ? Number(exitContractAlertPayload.contractTp1ConsumedAbs)
        : null,
      runner_allowed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractRunnerAllowedAbs))
        ? Number(exitContractAlertPayload.contractRunnerAllowedAbs)
        : null,
      runner_remaining_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractRunnerRemainingAbs))
        ? Number(exitContractAlertPayload.contractRunnerRemainingAbs)
        : null,
      trail_consumed_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractTrailConsumedAbs))
        ? Number(exitContractAlertPayload.contractTrailConsumedAbs)
        : null,
      observed_qty_abs: exitContractAlertPayload && Number.isFinite(Number(exitContractAlertPayload.contractObservedQtyAbs))
        ? Number(exitContractAlertPayload.contractObservedQtyAbs)
        : null,
    },
    source: "PAPER_BINANCE_RUNNER",
  });
}

function buildExitOrderContractEvent(kind, rules) {
  const stage = String(kind || "").trim().toUpperCase();
  if (stage === "TP0") return null;
  if (stage === "TP1") {
    const token = ratioToPctTokenLocal(rules && rules.TP_P1);
    return token ? `EXIT_TP_P1_${token}P` : "EXIT_TP_P1";
  }
  if (stage === "SL") {
    const token = ratioToPctTokenLocal(rules && rules.SL);
    return token ? `EXIT_SL_${token}P` : "EXIT_SL";
  }
  if (stage === "TRAIL") return "EXIT_TRAIL";
  if (stage === "FORCE_EXIT_ALL") return "FORCE_EXIT_ALL";
  if (stage === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  return stage || null;
}

function buildExitOrderContractRecordPayload({
  kind,
  rules,
  posMeta = null,
  ...payload
} = {}) {
  const stage = String(kind || "").trim().toUpperCase();
  if (stage === "TP0") return null;
  const event = buildExitOrderContractEvent(stage, rules);
  if (!event) return null;
  return {
    ...payload,
    event,
    stage,
  };
}

async function recordExitOrderContractSafe(payload = {}) {
  try {
    return await upsertExitOrderContract(payload);
  } catch (err) {
    console.warn("[EXIT_ORDER_CONTRACT_UPSERT_FAIL]", err && err.message ? err.message : String(err));
    return null;
  }
}

const TP_P1_SKIP_REASONS = new Set([
  "ORDER_TOO_SMALL",
  "POSITION_TOO_SMALL",
  "MIN_ORDER_EXCEEDS_BUDGET",
  "TP_P1_PARTIAL_BELOW_MIN_NOTIONAL",
  "TP_P1_REMAINDER_BELOW_MIN_NOTIONAL",
  "TP_P1_PARTIAL_BELOW_MIN_QTY",
  "TP_P1_REMAINDER_BELOW_MIN_QTY",
  "MARGIN_TYPE_SET_FAILED",
]);

function normalizeOpenClawCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function normalizeTp1LadderProfile(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "BASE") return upper;
  return null;
}

function resolveCooldownProfileFromMeta(posMeta = null) {
  const metaSafe = posMeta && typeof posMeta === "object" ? posMeta : {};
  const cohort = normalizeOpenClawCohort(
    metaSafe.openclaw_market_regime_cohort || metaSafe.market_regime_cohort
  );
  if (cohort === "RESCUE") return "RESCUE";
  if (cohort === "MIXED") return "MIXED";
  return "BASE";
}

function resolveOppositeCooldownWindow({ sysCfg = {}, posMeta = null } = {}) {
  const cohort = normalizeOpenClawCohort(
    posMeta && (posMeta.openclaw_market_regime_cohort || posMeta.market_regime_cohort)
  );
  const profile = resolveCooldownProfileFromMeta(posMeta);
  const defaultBars = Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars, 3));
  const defaultMs = Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms, 300000));
  if (profile === "RESCUE") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars_rescue, 0)),
      timeMs: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms_rescue, 0)),
    };
  }
  if (profile === "MIXED") {
    return {
      cohort: cohort || "BASE",
      profile,
      bars: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_signal_cooldown_bars_mixed, 1)),
      timeMs: Math.max(0, normalizeInt(sysCfg && sysCfg.opposite_time_cooldown_ms_mixed, 60000)),
    };
  }
  return {
    cohort: cohort || "BASE",
    profile: "BASE",
    bars: defaultBars,
    timeMs: defaultMs,
  };
}

function resolveOppositeCooldownWindowFromPosition({ sysCfg = {}, position = null } = {}) {
  const posMeta = (position && typeof position.meta === "object") ? position.meta : null;
  return resolveOppositeCooldownWindow({ sysCfg, posMeta });
}

function resolveLiveMarketRegimeCohort({ symbol = "", posMeta = null } = {}) {
  const marketRegimeRow = readOpenClawMarketRegimeRow(symbol);
  return normalizeOpenClawCohort(
    (marketRegimeRow && marketRegimeRow.cohort)
    || (posMeta && posMeta.openclaw_market_regime_cohort)
    || (posMeta && posMeta.market_regime_cohort)
  );
}

async function applyOpenClawExecutorDecision({
  exchange,
  symbol,
  intent,
  event,
  side,
  qtyPct,
  requestedQtyPct = null,
  features = null,
  stage = "RUNNER_SIGNAL",
  applyScale = true,
  nowMs = Date.now(),
  signalTf = null,
  cohort = null,
  requestId = null,
  runId = null,
  signalId = null,
  intentId = null,
} = {}) {
  const baseQty = Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : 0;
  const authorityRequestedQty = Number.isFinite(Number(requestedQtyPct)) && Number(requestedQtyPct) > 0
    ? Number(requestedQtyPct)
    : baseQty;
  const baseFeatures = (features && typeof features === "object") ? { ...features } : {};
  try {
    const result = await evaluateOpenClawExecutionAuthority({
      exchange,
      symbol,
      intent,
      event,
      side,
      qtyPct: baseQty,
      requestedQtyPct: authorityRequestedQty,
      features: baseFeatures,
      stage,
      applyScale,
      nowMs,
      signalTf,
      cohort,
    });
    const normalizedResult = {
      ok: result ? result.ok !== false : true,
      reason: String(result && result.reason || "OPENCLAW_EXECUTOR_OK"),
      qtyPctFinal: Number.isFinite(Number(result && result.qtyPctFinal)) ? Number(result.qtyPctFinal) : baseQty,
      exitProfileMode: result && result.exitProfileMode ? String(result.exitProfileMode).toUpperCase() : null,
      featuresPatch: (result && result.featuresPatch && typeof result.featuresPatch === "object")
        ? result.featuresPatch
        : {
          ...baseFeatures,
          _openclaw_executor_reason: String(result && result.reason || "OPENCLAW_EXECUTOR_NO_PATCH"),
        },
      decision: result && result.decision ? result.decision : null,
      policy: result && result.policy ? result.policy : null,
      authority: result && result.authority ? result.authority : null,
    };
    await recordOpenClawPolicyDecision({
      exchange,
      symbol,
      event,
      intent,
      side,
      stage,
      signalTf,
      traceId: normalizedResult.featuresPatch && (normalizedResult.featuresPatch.trace_id || normalizedResult.featuresPatch.idempotency_key),
      requestId,
      runId,
      signalId,
      intentId,
      source: "PAPER_BINANCE_RUNNER",
      requestedQtyPct: authorityRequestedQty,
      finalQtyPct: normalizedResult.qtyPctFinal,
      scaleApplied: baseQty > 0 ? (normalizedResult.qtyPctFinal / baseQty) : null,
      reason: normalizedResult.reason,
      blocked: normalizedResult.ok !== true || Number(normalizedResult.qtyPctFinal) <= 0,
      exitProfileMode: normalizedResult.exitProfileMode,
      cohort,
      decision: {
        openclaw: normalizedResult.decision,
        live_policy: normalizedResult.policy,
        authority: normalizedResult.authority,
      },
      featuresPatch: normalizedResult.featuresPatch,
      createdAt: new Date(Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()).toISOString(),
    }).catch((err) => {
      console.warn("[OPENCLAW_POLICY_DECISION_RECORD_FAIL]", err && err.message ? err.message : String(err));
    });
    return normalizedResult;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    console.warn(
      `[OPENCLAW_EXECUTOR_FAIL_OPEN] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ${msg}`
    );
    const failOpenResult = {
      ok: true,
      reason: "OPENCLAW_EXECUTOR_FAIL_OPEN",
      qtyPctFinal: baseQty,
      exitProfileMode: null,
      featuresPatch: {
        ...baseFeatures,
        _openclaw_executor_reason: "OPENCLAW_EXECUTOR_FAIL_OPEN",
        _openclaw_executor_error: msg,
      },
      decision: null,
    };
    await recordOpenClawPolicyDecision({
      exchange,
      symbol,
      event,
      intent,
      side,
      stage,
      signalTf,
      requestId,
      runId,
      signalId,
      intentId,
      source: "PAPER_BINANCE_RUNNER",
      requestedQtyPct: authorityRequestedQty,
      finalQtyPct: baseQty,
      scaleApplied: 1,
      reason: failOpenResult.reason,
      blocked: false,
      exitProfileMode: null,
      cohort,
      decision: null,
      featuresPatch: failOpenResult.featuresPatch,
      createdAt: new Date(Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()).toISOString(),
    }).catch((recordErr) => {
      console.warn("[OPENCLAW_POLICY_DECISION_RECORD_FAIL]", recordErr && recordErr.message ? recordErr.message : String(recordErr));
    });
    return failOpenResult;
  }
}

function loadOpenClawMarketRegimeBoard(force = false) {
  const now = Date.now();
  if (!force && openclawMarketRegimeCache.ts && (now - openclawMarketRegimeCache.ts) < OPENCLAW_MARKET_REGIME_CACHE_TTL_MS) {
    return openclawMarketRegimeCache.byMarket;
  }
  try {
    const stat = fs.statSync(OPENCLAW_MARKET_REGIME_BOARD_PATH);
    const mtimeMs = Number(stat.mtimeMs || 0);
    if (!force && openclawMarketRegimeCache.mtimeMs && openclawMarketRegimeCache.mtimeMs === mtimeMs) {
      openclawMarketRegimeCache.ts = now;
      return openclawMarketRegimeCache.byMarket;
    }
    const parsed = JSON.parse(fs.readFileSync(OPENCLAW_MARKET_REGIME_BOARD_PATH, "utf8"));
    const rows = Array.isArray(parsed && parsed.by_market) ? parsed.by_market : [];
    const map = new Map();
    for (const row of rows) {
      const market = String(row && row.market || "").trim().toUpperCase();
      if (!market) continue;
      map.set(market, row);
    }
    openclawMarketRegimeCache.ts = now;
    openclawMarketRegimeCache.mtimeMs = mtimeMs;
    openclawMarketRegimeCache.byMarket = map;
    return map;
  } catch (_) {
    openclawMarketRegimeCache.ts = now;
    if (!openclawMarketRegimeCache.byMarket) openclawMarketRegimeCache.byMarket = new Map();
    return openclawMarketRegimeCache.byMarket;
  }
}

function unwrapSummaryRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.summary && typeof raw.summary === "object") return raw.summary;
  return raw;
}

function normalizeTp1LadderKpiRecord(raw = null) {
  const safe = unwrapSummaryRecord(raw) || raw;
  if (!safe || typeof safe !== "object") return null;
  const snapshot = {
    status: String(safe.status || "").trim().toUpperCase() || null,
    realized_n: Number(safe.realized_trade_n ?? safe.realized_n),
    tp0_hit_rate: Number(safe.tp0_hit_rate),
    tp1_hit_rate: Number(safe.tp1_hit_rate),
    tp0_to_tp1_conversion: Number(safe.tp0_to_tp1_conversion_rate ?? safe.tp0_to_tp1_conversion),
    fee_adjusted_expectancy: Number(safe.fee_adjusted_expectancy),
  };
  return snapshot;
}

function buildTp1LadderKpiScopeMap(raw = null, scope = "MARKET") {
  const result = new Map();
  const addEntry = (scopeKey, record) => {
    const normalizedKey = scope === "MARKET"
      ? String(scopeKey || "").trim().toUpperCase()
      : normalizeOpenClawCohort(scopeKey);
    if (!normalizedKey) return;
    const normalizedRecord = normalizeTp1LadderKpiRecord(record);
    if (!normalizedRecord) return;
    result.set(normalizedKey, normalizedRecord);
  };
  if (!raw || typeof raw !== "object") return result;
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      addEntry(scope === "MARKET" ? row.market : row.cohort, row);
    }
    return result;
  }
  for (const [key, value] of Object.entries(raw)) {
    addEntry(key, value);
  }
  return result;
}

function resolveTp1LadderKpiForContext(snapshot = null, { market = null, cohort = null } = {}) {
  const safe = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!safe) return { scope: "GLOBAL", kpi: null };
  const marketKey = String(market || "").trim().toUpperCase();
  if (marketKey && safe.byMarket instanceof Map) {
    const marketSnapshot = safe.byMarket.get(marketKey);
    if (marketSnapshot) return { scope: "MARKET", kpi: marketSnapshot };
  }
  const cohortKey = normalizeOpenClawCohort(cohort);
  if (cohortKey && safe.byCohort instanceof Map) {
    const cohortSnapshot = safe.byCohort.get(cohortKey);
    if (cohortSnapshot) return { scope: "COHORT", kpi: cohortSnapshot };
  }
  return { scope: "GLOBAL", kpi: safe.global || null };
}

function loadTp1LadderKpiSnapshot(force = false) {
  const now = Date.now();
  if (!force && tp1LadderKpiCache.ts && (now - tp1LadderKpiCache.ts) < TP1_LADDER_KPI_CACHE_TTL_MS) {
    return tp1LadderKpiCache.value;
  }
  try {
    const stat = fs.statSync(PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH);
    const mtimeMs = Number(stat.mtimeMs || 0);
    if (!force && tp1LadderKpiCache.mtimeMs && tp1LadderKpiCache.mtimeMs === mtimeMs) {
      tp1LadderKpiCache.ts = now;
      return tp1LadderKpiCache.value;
    }
    const raw = JSON.parse(fs.readFileSync(PERFORMANCE_KPI_UPGRADE_CONTRACT_PATH, "utf8"));
    const summary = unwrapSummaryRecord(raw) || {};
    const snapshot = {
      status: String(summary.status || raw.status || "").trim().toUpperCase() || null,
      global: normalizeTp1LadderKpiRecord(summary || raw),
      byMarket: buildTp1LadderKpiScopeMap(
        summary.by_market || summary.byMarket || raw.by_market || raw.byMarket,
        "MARKET"
      ),
      byCohort: buildTp1LadderKpiScopeMap(
        summary.by_cohort || summary.byCohort || raw.by_cohort || raw.byCohort,
        "COHORT"
      ),
    };
    tp1LadderKpiCache.ts = now;
    tp1LadderKpiCache.mtimeMs = mtimeMs;
    tp1LadderKpiCache.value = snapshot;
    return snapshot;
  } catch (_) {
    tp1LadderKpiCache.ts = now;
    tp1LadderKpiCache.value = null;
    return null;
  }
}

function resolveTp1LadderConfig(sysCfg) {
  return {
    enabled: normalizeBool(sysCfg && sysCfg.tp1_ladder_enabled, true),
    freeze: normalizeBool(sysCfg && sysCfg.tp1_ladder_freeze, false),
    stage1RealizedNMin: Math.max(1, normalizeInt(sysCfg && sysCfg.tp1_ladder_stage1_realized_n_min, 8)),
    stage1Tp0HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_tp0_hit_rate_min, 0.55), 0, 1),
    stage1Tp0ToTp1ConversionMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_tp0_to_tp1_conversion_min, 0.20), 0, 1),
    stage1FeeAdjustedExpectancyMin: normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage1_fee_adjusted_expectancy_min, -0.0005),
    stage2RealizedNMin: Math.max(1, normalizeInt(sysCfg && sysCfg.tp1_ladder_stage2_realized_n_min, 16)),
    stage2Tp0HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp0_hit_rate_min, 0.60), 0, 1),
    stage2Tp1HitRateMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp1_hit_rate_min, 0.30), 0, 1),
    stage2Tp0ToTp1ConversionMin: clamp(normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_tp0_to_tp1_conversion_min, 0.35), 0, 1),
    stage2FeeAdjustedExpectancyMin: normalizeNumber(sysCfg && sysCfg.tp1_ladder_stage2_fee_adjusted_expectancy_min, 0),
  };
}

function resolveTp1LadderRuntimeState({ sysCfg, cohort, market } = {}) {
  const config = resolveTp1LadderConfig(sysCfg || {});
  const snapshot = loadTp1LadderKpiSnapshot();
  const selected = resolveTp1LadderKpiForContext(snapshot, { market, cohort });
  return {
    ...evaluateTp1LadderStage({
      cohort: cohort || "BASE",
      kpi: selected.kpi,
      config,
    }),
    kpi: selected.kpi,
    kpi_scope: selected.scope,
  };
}

function readOpenClawMarketRegimeRow(market) {
  const key = String(market || "").trim().toUpperCase();
  if (!key) return null;
  const map = loadOpenClawMarketRegimeBoard(false);
  return map.get(key) || null;
}

// --- Commission Gate v2 (ENFORCE) + MDD reduction gate ---
const PERF_GATE_TTL_MS = 60_000;
const PERF_GATE_LOOKBACK_MS = 48 * 3600 * 1000;
const COMMISSION_RATIO_THRESHOLD = Number(process.env.COMMISSION_RATIO_THRESHOLD || 0.15);
const COMMISSION_RATIO_MULTIPLIER = Number(process.env.COMMISSION_RATIO_MULTIPLIER || 3);
const MDD_THRESHOLD = Number(process.env.MDD_THRESHOLD || -0.05);
const MDD_REDUCE_FACTOR = Number(process.env.MDD_REDUCE_FACTOR || 0.5);
const COMMISSION_GATE_ENABLED = String(process.env.COMMISSION_GATE_ENABLED || "1") !== "0";
// ENFORCE: 에러 시 차단 (fail-closed). false면 에러 시 통과 (fail-open)
const COMMISSION_GATE_ENFORCE = COMMISSION_GATE_ENABLED
  && String(process.env.COMMISSION_GATE_ENFORCE || "1") !== "0";
const AI_FAIL_MODE = String(process.env.SIGNAL_AI_FAIL_MODE || "ALLOW").trim().toUpperCase();
const AI_MISSING_REDUCE_PCT = (() => {
  const raw = Number(process.env.SIGNAL_AI_MISSING_REDUCE_PCT);
  if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
  return 0.5;
})();
const perfGateCache = new Map();

async function loadPerformanceGate(exchange) {
  if (!COMMISSION_GATE_ENABLED) {
    return {
      commissionRatio: 0,
      commissionBlocked: false,
      mdd: 0,
      mddBlocked: false,
      mddReduceFactor: 1.0,
      totalFee: 0,
      totalPnl: 0,
      tradeCount: 0,
      fillCount: 0,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: false,
      disabled: true,
      dataSource: "DISABLED",
      lookbackMs: PERF_GATE_LOOKBACK_MS,
    };
  }
  const now = Date.now();
  const cacheKey = String(exchange || "").toUpperCase().trim();
  const cached = perfGateCache.get(cacheKey);
  if (cached && cached.data && (now - cached.ts) < PERF_GATE_TTL_MS) {
    return cached.data;
  }
  try {
    const db = getFirestore();
    const since = new Date(now - PERF_GATE_LOOKBACK_MS).toISOString();
    const exKey = String(exchange || "").toUpperCase();
    let snap;
    if (exKey) {
      snap = await db.collection("fills_paper")
        .where("exchange", "==", exKey)
        .where("created_at", ">=", since)
        .orderBy("created_at", "asc")
        .limit(500)
        .get();
    } else {
      snap = await db.collection("fills_paper")
        .where("created_at", ">=", since)
        .orderBy("created_at", "asc")
        .limit(500)
        .get();
    }
    const fills = snap.docs.map(d => d.data());

    let totalFee = 0;
    let totalPnl = 0;
    const pnls = [];
    const entryMap = new Map();

    for (const f of fills) {
      const ev = String(f.event || "").toUpperCase();
      const sym = String(f.symbol_or_pair_id || f.symbol || "");
      const fee = Number(f.fee_value) || 0;
      totalFee += Math.abs(fee);
      const isEntry = isPrimaryLongShortEventName(ev) || ev.startsWith("CORE_") || ev.startsWith("PRE_REAL_") || ev.startsWith("REAL_") || ev.startsWith("EARLY_") || ev.startsWith("EMO_");
      const isExit = ev.startsWith("EXIT_");
      if (isEntry && sym) {
        entryMap.set(sym, {
          price: Number(f.exec_price) || 0,
          side: ev.includes("SHORT") ? "SHORT" : "LONG",
          notional: Number(f.notional) || 0,
        });
      }
      if (isExit && sym && entryMap.has(sym)) {
        const entry = entryMap.get(sym);
        const exitPx = Number(f.exec_price) || 0;
        if (entry.price > 0 && exitPx > 0 && entry.notional > 0) {
          const dir = entry.side === "SHORT" ? -1 : 1;
          const pnlPct = dir * (exitPx - entry.price) / entry.price;
          const pnlAmt = pnlPct * entry.notional;
          totalPnl += pnlAmt;
          pnls.push(pnlPct);
        }
        entryMap.delete(sym);
      }
    }

    const commissionRatio = (totalPnl !== 0) ? (totalFee / Math.abs(totalPnl)) : (totalFee > 0 ? 1 : 0);

    let mdd = 0;
    if (pnls.length > 0) {
      let equity = 1.0;
      let peak = 1.0;
      for (const r of pnls) {
        equity *= (1 + r);
        if (equity > peak) peak = equity;
        const dd = (equity - peak) / peak;
        if (dd < mdd) mdd = dd;
      }
    }

    const result = {
      commissionRatio,
      commissionBlocked: commissionRatio > COMMISSION_RATIO_THRESHOLD,
      mdd,
      mddBlocked: mdd < MDD_THRESHOLD,
      mddReduceFactor: mdd < MDD_THRESHOLD ? MDD_REDUCE_FACTOR : 1.0,
      totalFee,
      totalPnl,
      tradeCount: pnls.length,
      fillCount: fills.length,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: COMMISSION_GATE_ENFORCE,
      dataSource: "fills_paper",
      lookbackMs: PERF_GATE_LOOKBACK_MS,
    };
    perfGateCache.set(cacheKey, { ts: now, data: result });
    return result;
  } catch (e) {
    // ENFORCE 모드: 에러 시 차단 (fail-closed) — 데이터 없이 주문 허용 금지
    console.error("[COMMISSION_GATE][ERROR] 게이트 데이터 로드 실패 — ENFORCE 모드에서 차단", {
      exchange, error: e.message, enforce: COMMISSION_GATE_ENFORCE,
    });
    return {
      commissionRatio: -1, commissionBlocked: COMMISSION_GATE_ENFORCE,
      mdd: 0, mddBlocked: false, mddReduceFactor: 1.0,
      totalFee: 0, totalPnl: 0, tradeCount: 0, fillCount: 0,
      threshold: COMMISSION_RATIO_THRESHOLD,
      enforce: COMMISSION_GATE_ENFORCE,
      error: e.message,
      errorBlocked: COMMISSION_GATE_ENFORCE,
    };
  }
}
// ── Commission Gate v2 증빙 로그 (3줄 세트: JUDGE → BLOCK/ALLOW → ORDER_SKIPPED/PROCEED) ──
function _gateId() {
  return `CGV2__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
}
function _kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " KST");
}
function logCommissionGateEvidence({ phase, exchange, symbol, event, perfGate, intentId }) {
  if (!COMMISSION_GATE_ENABLED) {
    return { gateId: null, blocked: false, disabled: true };
  }
  const gateId = _gateId();
  const tsKst = _kstNow();
  const ratioPct = perfGate.commissionRatio >= 0 ? (perfGate.commissionRatio * 100).toFixed(1) : "ERR";
  const thresholdPct = ((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0);
  const blocked = perfGate.commissionBlocked;
  const gateMode = COMMISSION_GATE_ENFORCE ? "ENFORCE" : "MONITOR";
  const oid = intentId || null;
  // ① 게이트 판정 로그
  console.log(JSON.stringify({
    tag: "[COMMISSION_GATE][JUDGE]", gate_id: gateId, phase, exchange, symbol, event, ts_kst: tsKst,
    gate_mode: gateMode, order_intent_id: oid,
    commission_ratio_pct: ratioPct, threshold_pct: thresholdPct, enforce: !!perfGate.enforce,
    total_fee: perfGate.totalFee, total_pnl: perfGate.totalPnl,
    trade_count: perfGate.tradeCount, fill_count: perfGate.fillCount,
    data_source: perfGate.dataSource || "fills_paper", error: perfGate.error || null,
  }));
  if (blocked) {
    // ② 차단 로그 — 필수 8필드: ts_kst, exchange, symbol, gate_mode, decision, reason, fee_ratio_24h, order_intent_id
    const blockReason = perfGate.error ? "GATE_ERROR_ENFORCE" : "RATIO_EXCEEDED";
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][BLOCK]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "BLOCKED",
      reason: blockReason, fee_ratio_24h: ratioPct, order_intent_id: oid,
      event, commission_ratio_pct: ratioPct, threshold_pct: thresholdPct,
    }));
    // ③ 주문 스킵 로그
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ORDER_SKIPPED]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "BLOCKED",
      order_intent_id: oid, event, order_skipped: true, reason: "BLOCKED_BY_COMMISSION_GATE",
    }));
  } else {
    // ② 허용 로그 — 필수 8필드 포함
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ALLOW]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "ALLOWED",
      fee_ratio_24h: ratioPct, order_intent_id: oid, event,
      commission_ratio_pct: ratioPct, threshold_pct: thresholdPct,
    }));
    // ③ 주문 진행 로그
    console.log(JSON.stringify({
      tag: "[COMMISSION_GATE][ORDER_PROCEED]", gate_id: gateId,
      ts_kst: tsKst, exchange, symbol,
      gate: "commission_gate_v2", gate_mode: gateMode, decision: "ALLOWED",
      order_intent_id: oid, event, order_skipped: false,
    }));
  }
  return { gateId, blocked };
}

function resolveCommissionSoftScale(perfGate) {
  if (!COMMISSION_GATE_ENABLED) {
    return { blocked: false, scale: 1, rawScale: 1, minScale: 1 };
  }
  const ratio = Number(perfGate && perfGate.commissionRatio);
  const threshold = Number((perfGate && perfGate.threshold) || COMMISSION_RATIO_THRESHOLD);
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(threshold) || threshold <= 0) {
    return { blocked: false, scale: 1, rawScale: 1, minScale: 1 };
  }
  const blocked = ratio > threshold;
  const rawScale = blocked ? (threshold / ratio) : 1;
  const minScale = 1 / Math.max(1, Number.isFinite(COMMISSION_RATIO_MULTIPLIER) ? COMMISSION_RATIO_MULTIPLIER : 3);
  const scale = blocked ? Math.max(minScale, Math.min(1, rawScale)) : 1;
  return { blocked, scale, rawScale, minScale };
}
// --- End Commission Gate v2 (ENFORCE) + MDD reduction gate ---

const KEY_CACHE = {
  BINANCEFUT: { apiKey: null, apiSecret: null, at: 0 },
};

function resolveTpP1PendingHoldMs() {
  const envRaw = Number(process.env.TP_P1_PENDING_HOLD_MS);
  if (Number.isFinite(envRaw) && envRaw > 0) return Math.round(envRaw);
  return 5 * 60 * 1000;
}

function buildIntentScopeKey(exchange, symbol, tf) {
  return `${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${String(tf || "")}`;
}

async function hasActiveTpP1PendingIntent({ exchange, symbol, tf, nowMs, scanLimit = 120 } = {}) {
  try {
    const scope = buildIntentScopeKey(exchange, symbol, tf);
    if (!scope) return false;
    const db = getFirestore();
    const checkPendingInSnap = (snap) => {
      if (!snap || snap.empty) return false;
      let found = false;
      snap.forEach((d) => {
        if (found) return;
        const x = d.data() || {};
        if (String(x.intent_scope || "") !== scope) return;
        if (String(x.status || "").toUpperCase() !== "PENDING") return;
        const ev = String(x.event || "").toUpperCase();
        if (!(ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_"))) return;
        const expMs = Number(x.expires_at_ms);
        if (Number.isFinite(expMs) && expMs <= Number(nowMs || Date.now())) return;
        found = true;
      });
      return found;
    };

    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      if (checkPendingInSnap(pendingSnap)) return true;
    } catch (_) {}

    try {
      const scopeScan = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .orderBy("updated_at", "desc")
        .limit(Math.max(40, Number(scanLimit) || 120))
        .get();
      if (checkPendingInSnap(scopeScan)) return true;
    } catch (_) {}

    const fullScan = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, (Number(scanLimit) || 120) * 4))
      .get();
    return checkPendingInSnap(fullScan);
  } catch (_) {
    return false;
  }
}

function collectActivePendingAddIntentState(rows, {
  scope,
  nowMs,
  positionSide = null,
} = {}) {
  const refMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const normalizedSide = normalizePositionSide(positionSide);
  const docs = Array.isArray(rows) ? rows : [];
  let count = 0;
  let lastSignalBarMs = null;
  for (const row of docs) {
    const x = row && typeof row === "object" ? row : {};
    if (scope && String(x.intent_scope || "") !== scope) continue;
    if (String(x.status || "").toUpperCase() !== "PENDING") continue;
    const expMs = Number(x.expires_at_ms);
    if (Number.isFinite(expMs) && expMs <= refMs) continue;
    const intent = intentFromSignal({
      event: x.event,
      side: x.side,
      features: x.features_json,
    });
    if (intent !== "ADD") continue;
    const intentDir = directionFromSignal({ event: x.event, side: x.side });
    if (normalizedSide && intentDir && normalizedSide !== intentDir) continue;
    count += 1;
    const signalBarMs = Number(x.signal_bar_close_time_utc_ms);
    if (Number.isFinite(signalBarMs)) {
      lastSignalBarMs = Number.isFinite(lastSignalBarMs)
        ? Math.max(lastSignalBarMs, signalBarMs)
        : signalBarMs;
    }
  }
  return { count, lastSignalBarMs };
}

async function getActivePendingAddIntentState({
  exchange,
  symbol,
  tf,
  positionSide = null,
  nowMs,
  scanLimit = 120,
} = {}) {
  try {
    const scope = buildIntentScopeKey(exchange, symbol, tf);
    if (!scope) return { count: 0, lastSignalBarMs: null };
    const db = getFirestore();
    const collectState = (snap) => {
      if (!snap || snap.empty) return { count: 0, lastSignalBarMs: null };
      return collectActivePendingAddIntentState(
        snap.docs.map((d) => d.data() || {}),
        { scope, nowMs, positionSide }
      );
    };

    try {
      const pendingSnap = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .where("status", "==", "PENDING")
        .limit(40)
        .get();
      const state = collectState(pendingSnap);
      if (state.count > 0) return state;
    } catch (_) {}

    try {
      const scopeScan = await db.collection("order_intents_paper")
        .where("intent_scope", "==", scope)
        .orderBy("updated_at", "desc")
        .limit(Math.max(40, Number(scanLimit) || 120))
        .get();
      const state = collectState(scopeScan);
      if (state.count > 0) return state;
    } catch (_) {}

    const fullScan = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, (Number(scanLimit) || 120) * 4))
      .get();
    return collectState(fullScan);
  } catch (_) {
    return { count: 0, lastSignalBarMs: null };
  }
}

async function getTpP1PendingState({
  exchange,
  symbol,
  tf,
  posMeta,
  tpP1PendingHoldMs,
  nowMs,
} = {}) {
  const refMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const pendingAtMsRaw = Number(posMeta && posMeta.tp_p1_pending_at_ms);
  const pendingUntilMsRaw = Number(posMeta && posMeta.tp_p1_pending_until_ms);
  const fallbackPendingUntilMs = Number.isFinite(pendingAtMsRaw)
    ? (pendingAtMsRaw + Number(tpP1PendingHoldMs || 0))
    : NaN;
  const pendingUntilMsEff = Number.isFinite(pendingUntilMsRaw) ? pendingUntilMsRaw : fallbackPendingUntilMs;
  const activeByTime = Number.isFinite(pendingUntilMsEff) ? (refMs <= pendingUntilMsEff) : false;
  let activeByIntent = false;
  if (!activeByTime) {
    activeByIntent = await hasActiveTpP1PendingIntent({ exchange, symbol, tf, nowMs: refMs });
  }
  return {
    active: activeByTime || activeByIntent,
    activeByIntent,
    pendingAtMs: Number.isFinite(pendingAtMsRaw) ? pendingAtMsRaw : null,
    pendingUntilMs: Number.isFinite(pendingUntilMsEff) ? pendingUntilMsEff : null,
  };
}

function addMs(ms, deltaMs) {
  return Number(ms) + Number(deltaMs);
}

function msToUtcZ(ms) {
  return new Date(Number(ms)).toISOString();
}

async function consumeDroppedSignals({ drops, runId, execBarCloseMs, execBarCloseUtc } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return;
  const consumedAtIso = new Date().toISOString();
  for (const d of drops) {
    const signalId = resolveSignalIdFromSignalLike(d);
    if (!d || !signalId) continue;
    try {
      const lock = await tryLockSignal({ signalId, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId,
          runId,
          consumedAtIso,
          execBarCloseMs,
          execBarCloseUtc,
          reason: d.drop_reason_code || d.reason || "DROP",
        });
      }
    } catch (_) {}
  }
}

function resolveSignalIdFromSignalLike(row = null) {
  return String(
    (row && row.signal_id) ||
    (row && row.signal_doc_id) ||
    (row && row.features_json && row.features_json.signal_id) ||
    (row && row.features_json && row.features_json.signal_doc_id) ||
    (row && row.features && row.features.signal_id) ||
    (row && row.features && row.features.signal_doc_id) ||
    ""
  ).trim() || null;
}

async function markSignalConsumedIfClaimed({
  signalId = null,
  runId = null,
  consumedAtIso = null,
  execBarCloseMs = null,
  execBarCloseUtc = null,
  reason = null,
  meta = null,
} = {}) {
  const id = String(signalId || "").trim();
  if (!id) return { ok: false, reason: "SIGNAL_ID_MISSING" };
  const lock = await tryLockSignal({ signalId: id, runId });
  if (!lock || lock.ok !== true) return lock || { ok: false, reason: "LOCK_FAILED" };
  await markSignalConsumed({
    signalId: id,
    runId,
    consumedAtIso: consumedAtIso || new Date().toISOString(),
    execBarCloseMs,
    execBarCloseUtc,
    reason,
    meta,
  });
  return { ok: true };
}

function isSignalClaimAlreadyHandled(result = null) {
  const reason = String(result && result.reason || "").trim().toUpperCase();
  return reason === "ALREADY_CONSUMED" || reason === "LOCKED";
}

async function claimSignalForProgressAlert({
  signalId = null,
  runId = null,
  consumedAtIso = null,
  execBarCloseMs = null,
  execBarCloseUtc = null,
  reason = null,
  meta = null,
  critical = false,
} = {}) {
  const id = String(signalId || "").trim();
  if (!id) return { ok: true, signal_id: null, reason: "SIGNAL_ID_MISSING" };
  const claim = await markSignalConsumedIfClaimed({
    signalId: id,
    runId,
    consumedAtIso,
    execBarCloseMs,
    execBarCloseUtc,
    reason,
    meta,
  }).catch((err) => ({
    ok: false,
    reason: "SIGNAL_CLAIM_ERROR",
    error_message: err && err.message ? String(err.message) : String(err),
  }));
  if (claim && claim.ok === true) return { ok: true, signal_id: id, reason: "CLAIMED" };
  if (critical === true) {
    console.warn(`[SIGNAL_PROGRESS_CLAIM_FAILED_CRITICAL_ALERT_ALLOWED] signal_id=${id} reason=${claim && claim.reason ? claim.reason : "UNKNOWN"}`);
    return { ok: true, signal_id: id, reason: claim && claim.reason ? claim.reason : "CLAIM_FAILED" };
  }
  if (isSignalClaimAlreadyHandled(claim)) {
    console.warn(`[SIGNAL_PROGRESS_SUPPRESSED_ALREADY_CONSUMED] signal_id=${id} reason=${String(claim && claim.reason || "").toUpperCase()}`);
    return { ok: false, signal_id: id, reason: claim && claim.reason ? claim.reason : "ALREADY_HANDLED" };
  }
  return { ok: true, signal_id: id, reason: claim && claim.reason ? claim.reason : "CLAIM_NOT_REQUIRED" };
}

async function filterSignalDropsForRecording({ drops = [], runId = null } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return [];
  const kept = [];
  for (const d of drops) {
    const signalId = resolveSignalIdFromSignalLike(d);
    if (!signalId) {
      kept.push(d);
      continue;
    }
    try {
      const lock = await tryLockSignal({ signalId, runId });
      if (lock && lock.ok === true) {
        kept.push({ ...d, signal_id: signalId });
        continue;
      }
      const reason = String(lock && lock.reason || "LOCK_FAILED").toUpperCase();
      if (reason === "ALREADY_CONSUMED" || reason === "LOCKED") {
        console.warn(`[SIGNAL_DROP_SUPPRESSED_ALREADY_CONSUMED] signal_id=${signalId} reason=${reason}`);
        continue;
      }
      kept.push({ ...d, signal_id: signalId });
    } catch (err) {
      console.warn(`[SIGNAL_DROP_CONSUME_CHECK_FAIL] signal_id=${signalId} err=${err && err.message ? err.message : String(err)}`);
      kept.push({ ...d, signal_id: signalId });
    }
  }
  return kept;
}

function buildEntryEventId({ exchange, symbol, tf, signalBarCloseMs, event }) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim();
  const tf0 = String(tf || "").trim();
  const ms = Number(signalBarCloseMs);
  const ev = normalizeEvent(event);
  if (!ex || !sym || !tf0 || !Number.isFinite(ms) || !ev) return null;
  return `${ex}|${sym}|${tf0}|${ms}|${ev}|${ev}`;
}

function resolveSignalDocIdForIntent({ exchange, symbol, tf, barCloseMs, event, signalId, features }) {
  const docId = deriveSignalDocId({
    exchange,
    symbol,
    tf,
    barCloseMs,
    event,
    signalId,
  });
  if (docId && features && !features.signal_doc_id) {
    features.signal_doc_id = docId;
  }
  return docId;
}

function computeTrailingMetaUpdate({ exchange, bar, position, posMeta, positionSideFallback }) {
  if (!position || String(position.state || "").toUpperCase() !== "ACTIVE") return null;
  if (!posMeta || posMeta.tp_p1_done !== true) return null;
  const posWithMeta = { ...(position || {}), meta: posMeta };
  const rules = resolveExitRulesForPosition({ exchange, position: posWithMeta });
  if (
    !Number.isFinite(Number(rules && rules.TRAIL_R_MULTIPLE))
    && !Number.isFinite(Number(rules && rules.TRAIL_PCT))
  ) return null;
  const closePx = Number(bar && (bar.close ?? bar.closePrice ?? bar.c));
  if (!Number.isFinite(closePx)) return null;
  const side = String(
    position.position_side ||
    position.positionSide ||
    position.side ||
    positionSideFallback ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side)) ||
    "LONG"
  ).toUpperCase();
  const updates = {};
  const trailObservedAtMs = resolveEventRefMs(
    bar && (bar.bar_close_time_utc_ms ?? bar.close_time_utc_ms ?? bar.closeTime ?? bar.t),
    Date.now()
  );
  if (side === "SHORT") {
    const prevLow = Number(posMeta.trail_low);
    const nextLow = Number.isFinite(prevLow) ? Math.min(prevLow, closePx) : closePx;
    if (!Number.isFinite(prevLow) || nextLow !== prevLow) {
      updates.trail_low = nextLow;
      updates.trail_low_at_ms = trailObservedAtMs;
    }
  } else {
    const prevHigh = Number(posMeta.trail_high);
    const nextHigh = Number.isFinite(prevHigh) ? Math.max(prevHigh, closePx) : closePx;
    if (!Number.isFinite(prevHigh) || nextHigh !== prevHigh) {
      updates.trail_high = nextHigh;
      updates.trail_high_at_ms = trailObservedAtMs;
    }
  }
  if (!Object.keys(updates).length) return null;
  return updates;
}

function pickMarketOverride(map, symbol, fallback) {
  if (!map || typeof map !== "object") return fallback;
  if (symbol && map[symbol] != null) return Number(map[symbol]);
  return fallback;
}

function clamp(num, min, max) {
  const n = Number(num);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeFuturesLeverage(raw, maxLev = 3) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  const rounded = Math.round(n);
  return clamp(rounded, 1, Number.isFinite(maxLev) && maxLev > 0 ? maxLev : 2) || 1;
}

function parseUpperList(raw, fallback = []) {
  const src = raw == null ? fallback : raw;
  const list = Array.isArray(src) ? src : String(src || "").split(/[,\s]+/);
  const out = [];
  for (const v of list) {
    const s = String(v || "").trim().toUpperCase();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function filterTelegramChannels(raw) {
  return parseChannelList(raw)
    .filter((v) => /^telegram:|^tg:|^telegram:\/\//i.test(String(v || "").trim()))
    .join(",");
}

function formatAlertNumber(value, digits = 6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "NA";
  const abs = Math.abs(n);
  const precision = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : digits;
  return n.toFixed(precision).replace(/\.?0+$/, "");
}

function formatRatioPctToken(value, { abs = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const pct = (abs ? Math.abs(n) : n) * 100;
  const fixed = pct >= 10 ? pct.toFixed(2) : pct.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

function formatExitRulesCompactLocal(exitRules) {
  if (!exitRules || typeof exitRules !== "object") return null;
  const parts = [];
  const sl = formatRatioPctToken(exitRules.SL, { abs: true });
  const tp1 = formatRatioPctToken(exitRules.TP_P1);
  const trailR = Number(exitRules.TRAIL_R_MULTIPLE);
  const trail = Number.isFinite(trailR) && trailR > 0
    ? `${String(trailR).replace(/\.?0+$/, "")}R`
    : formatRatioPctToken(exitRules.TRAIL_PCT);
  const runnerMin = formatRatioPctToken(exitRules.RUNNER_MIN_PROFIT_PCT);
  const be = formatRatioPctToken(exitRules.BE_PCT);
  if (sl) parts.push(`SL_${sl}`);
  if (tp1) parts.push(`TP1_${tp1}`);
  if (trail) parts.push(`TRAIL_${trail}`);
  if (runnerMin) parts.push(`RUNNER_MIN_${runnerMin}`);
  if (be) parts.push(`BE_${be}`);
  return parts.length ? parts.join(" / ") : null;
}

function sleepMs(ms) {
  const waitMs = Number(ms);
  if (!Number.isFinite(waitMs) || waitMs <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function sleep(ms) {
  return sleepMs(ms);
}

function isRetryableLiveInfraError(err) {
  const code = String(err && err.code || "").trim().toUpperCase();
  const msg = String(err && err.message || err || "").trim().toUpperCase();
  if (code === "EGRESS_PROXY_TIMEOUT" || code === "EGRESS_PROXY_FETCH_FAIL") return true;
  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED" || code === "EAI_AGAIN") return true;
  if (msg.includes("EGRESS_PROXY_TIMEOUT")) return true;
  if (msg.includes("EGRESS_PROXY_FETCH_FAIL")) return true;
  if (msg.includes("FETCH FAILED")) return true;
  if (msg.includes("TIMEOUT")) return true;
  if (msg.includes("ECONNRESET")) return true;
  if (msg.includes("ECONNREFUSED")) return true;
  if (msg.includes("SERVICE UNAVAILABLE")) return true;
  if (msg.includes("INTERNAL ERROR")) return true;
  if (msg.includes("TRY AGAIN")) return true;
  return false;
}

async function fetchFuturesExchangeInfoWithCache(symbol, {
  fetchFn = fetchFuturesExchangeInfo,
  cache = futuresExchangeInfoCache,
  ttlMs = FUTURES_EXCHANGE_INFO_TTL_MS,
  staleMaxAgeMs = FUTURES_EXCHANGE_INFO_STALE_MAX_AGE_MS,
  retryCount = FUTURES_EXCHANGE_INFO_RETRY_COUNT,
  retryDelayMs = FUTURES_EXCHANGE_INFO_RETRY_DELAY_MS,
  allowStaleOnError = true,
  nowMs = Date.now(),
  sleep = sleepMs,
} = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const cached = cache && cache.get(sym);
  if (cached && cached.value && Number.isFinite(cached.at) && (nowMs - cached.at) < Math.max(60 * 1000, Number(ttlMs) || FUTURES_EXCHANGE_INFO_TTL_MS)) {
    return cached.value;
  }
  const totalAttempts = Math.max(1, Math.floor(Number(retryCount) || 0) + 1);
  let lastErr = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      const value = await fetchFn(sym);
      if (cache && value && typeof value === "object") cache.set(sym, { value, at: Date.now() });
      return value;
    } catch (err) {
      lastErr = err;
      if (attempt >= totalAttempts || !isRetryableLiveInfraError(err)) break;
      if (Number(retryDelayMs) > 0) await sleep(Number(retryDelayMs));
    }
  }
  if (
    allowStaleOnError === true &&
    cached &&
    cached.value &&
    Number.isFinite(cached.at) &&
    (nowMs - cached.at) <= Math.max(Math.max(60 * 1000, Number(ttlMs) || FUTURES_EXCHANGE_INFO_TTL_MS), Number(staleMaxAgeMs) || FUTURES_EXCHANGE_INFO_STALE_MAX_AGE_MS)
  ) {
    return cached.value;
  }
  throw lastErr || new Error(`FUTURES_EXCHANGE_INFO_FETCH_FAILED ${sym || "UNKNOWN"}`);
}

async function ensureLiveFuturesLeverage({
  liveCfg,
  symbol,
  leverageMult,
  isExit = false,
  setFn = setFuturesLeverage,
  cache = futuresLeverageCache,
  ttlMs = FUTURES_LEVERAGE_TTL_MS,
  retryCount = FUTURES_LEVERAGE_RETRY_COUNT,
  retryDelayMs = FUTURES_LEVERAGE_RETRY_DELAY_MS,
  sleep = sleepMs,
  nowMs = Date.now(),
} = {}) {
  if (isExit) {
    return { ok: true, skipped: true, reason: "EXIT_REDUCE_ONLY_SKIP" };
  }
  if (!Number.isFinite(Number(leverageMult)) || Number(leverageMult) <= 0) {
    return { ok: true, skipped: true, reason: "LEVERAGE_NOT_REQUIRED" };
  }
  const sym = String(symbol || "").trim().toUpperCase();
  const apiLev = Math.round(Number(leverageMult));
  const cached = cache && cache.get(sym);
  if (cached && cached.value === apiLev && Number.isFinite(cached.at) && (nowMs - cached.at) <= Math.max(60 * 1000, Number(ttlMs) || FUTURES_LEVERAGE_TTL_MS)) {
    return { ok: true, skipped: true, reason: "LEVERAGE_CACHE_HIT", appliedLeverage: apiLev };
  }
  const totalAttempts = Math.max(1, Math.floor(Number(retryCount) || 0) + 1);
  let lastErr = null;
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      await setFn({
        apiKey: liveCfg && liveCfg.apiKey,
        apiSecret: liveCfg && liveCfg.apiSecret,
        symbol: sym,
        leverage: apiLev,
      });
      if (cache) cache.set(sym, { value: apiLev, at: Date.now() });
      return { ok: true, skipped: false, reason: "LEVERAGE_SET_OK", appliedLeverage: apiLev, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (attempt >= totalAttempts || !isRetryableLiveInfraError(err)) break;
      if (Number(retryDelayMs) > 0) await sleep(Number(retryDelayMs));
    }
  }
  if (cached && cached.value === apiLev && Number.isFinite(cached.at) && (nowMs - cached.at) <= Math.max(60 * 1000, Number(ttlMs) || FUTURES_LEVERAGE_TTL_MS)) {
    return { ok: true, skipped: true, reason: "LEVERAGE_CACHE_FALLBACK", appliedLeverage: apiLev };
  }
  return {
    ok: false,
    reason: "LEVERAGE_SET_FAILED",
    error: lastErr && lastErr.message ? lastErr.message : String(lastErr),
  };
}

function buildBinanceNativeRefreshLeaseDocPath(exchange, symbol) {
  const ex = String(exchange || "").trim().toUpperCase() || "BINANCEFUT";
  const sym = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  return `runtime_locks/binance_native_refresh__${ex}__${sym}`;
}

function buildFuturesPositionSyncLeaseDocPath(exchange, symbol) {
  const ex = String(exchange || "").trim().toUpperCase() || "BINANCEFUT";
  const sym = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  return `runtime_locks/futures_position_sync__${ex}__${sym}`;
}

async function acquireBinanceNativeRefreshLease({
  exchange,
  symbol,
  ttlMs = BINANCE_NATIVE_REFRESH_LEASE_TTL_MS,
  holderId = binanceNativeRefreshLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(2000, Math.floor(Number(ttlMs) || BINANCE_NATIVE_REFRESH_LEASE_TTL_MS));
  const ref = db.doc(buildBinanceNativeRefreshLeaseDocPath(exchange, symbol));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
      return;
    }
    acquired = false;
    holder = owner;
  });
  return { acquired, holder, leaseUntil, holderId };
}

// 2026-04-19 ROOT-CAUSE FIX: heartbeat was a `db.runTransaction` on the
// SAME lease doc that the enclosing `refreshBinanceNativeProtectionWithRetry`
// was also transacting against (acquire at start, release at end) AND
// firing additional heartbeats against via `setInterval`. Two concurrent
// transactions on one doc → the SDK's built-in 5-attempt ABORTED retry
// exhausts under any network pressure, surfacing `10 ABORTED:
// cross-transaction contention` to the caller — which is exactly what
// production saw on the BTCUSDT BE-raise path.
//
// The transaction was semantically unnecessary: heartbeat only needs to
// extend TTL iff we still own the lease. Atomic snapshot read+write is
// overkill — a read-then-conditional-update is sufficient. The tiny race
// window (owner changes between read and update) is self-healing:
//   * if owner was stolen because OUR TTL expired, we've already lost
//     anyway — our next heartbeat check reports ok:false and the caller
//     aborts;
//   * the new owner's next heartbeat overwrites the TTL within ~2s;
//   * the fields we update (lease_until_ms, heartbeat_ms) only move
//     forward in time, never cause corruption.
// Non-transactional writes cannot abort, so concurrent heartbeats on
// the SAME doc are serialized cleanly by Firestore (last write wins per
// field, all values are monotonic).
async function heartbeatBinanceNativeRefreshLease({
  exchange,
  symbol,
  ttlMs = BINANCE_NATIVE_REFRESH_LEASE_TTL_MS,
  holderId = binanceNativeRefreshLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(2000, Math.floor(Number(ttlMs) || BINANCE_NATIVE_REFRESH_LEASE_TTL_MS));
  const ref = db.doc(buildBinanceNativeRefreshLeaseDocPath(exchange, symbol));
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, holder: null, leaseUntil, holderId };
  }
  const data = snap.data() || {};
  const owner = String(data.owner || "");
  if (owner !== String(holderId || "")) {
    return { ok: false, holder: owner || null, leaseUntil, holderId };
  }
  await ref.update({
    lease_until_ms: leaseUntil,
    heartbeat_ms: now,
    heartbeat_at: new Date(now).toISOString(),
  });
  return { ok: true, holder: null, leaseUntil, holderId };
}

async function releaseBinanceNativeRefreshLease({
  exchange,
  symbol,
  holderId = binanceNativeRefreshLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildBinanceNativeRefreshLeaseDocPath(exchange, symbol));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

function normalizeFuturesSymbolKey(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (!s) return "";
  return s.replace(/\.P$/, "");
}

function isPrimaryLongShortEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev === "LONG" || ev === "SHORT";
}

function buildEntryTierContext(event, features) {
  return {
    event,
    features: (features && typeof features === "object") ? features : {},
  };
}

function isPreRealEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("PRE_REAL_");
}

function resolveSignalQtyProfile(event, features) {
  const qtyProfile = resolveEntryQtyProfile(buildEntryTierContext(event, features));
  return qtyProfile || null;
}

function isFixedQtyProfileSignal(event, features) {
  return resolveSignalQtyProfile(event, features) === "FIXED";
}

function applyEvQtyScale({
  qtyFraction,
  evScale,
  intent,
  event,
  features,
} = {}) {
  const baseQtyFraction = Number(qtyFraction);
  const suggestedScale = Number(evScale);
  const entryIntent = String(intent || "").toUpperCase();
  const qtyProfile = resolveSignalQtyProfile(event, features);
  const scaleReducing = Number.isFinite(suggestedScale) && suggestedScale > 0 && suggestedScale < 0.9999;
  if (!scaleReducing || !Number.isFinite(baseQtyFraction) || baseQtyFraction <= 0) {
    return {
      qtyFraction: baseQtyFraction,
      appliedScale: 1,
      suggestedScale,
      suggestedQtyFraction: baseQtyFraction,
      suppressedForFixed: false,
      qtyProfile,
    };
  }
  const suggestedQtyFraction = baseQtyFraction * suggestedScale;
  const suppressForFixed = (entryIntent === "ENTRY" || entryIntent === "ADD")
    && qtyProfile === "FIXED";
  return {
    qtyFraction: suppressForFixed ? baseQtyFraction : suggestedQtyFraction,
    appliedScale: suppressForFixed ? 1 : suggestedScale,
    suggestedScale,
    suggestedQtyFraction,
    suppressedForFixed: suppressForFixed,
    qtyProfile,
  };
}

function restoreFixedEntryQtyFraction({
  qtyFraction,
  intent,
  event,
  features,
} = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  const currentQtyFraction = Number(qtyFraction);
  const qtyProfile = resolveSignalQtyProfile(event, features);
  if ((entryIntent !== "ENTRY" && entryIntent !== "ADD") || qtyProfile !== "FIXED") {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  const evBaseQtyFraction = Number(
    (features && (features.ev_gate_qty_before ?? features.market_ev_base_qty))
  );
  if (!Number.isFinite(evBaseQtyFraction) || evBaseQtyFraction <= 0) {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  if (Number.isFinite(currentQtyFraction) && evBaseQtyFraction <= currentQtyFraction) {
    return {
      qtyFraction: currentQtyFraction,
      restored: false,
      originalQtyFraction: currentQtyFraction,
      qtyProfile,
    };
  }
  return {
    qtyFraction: normalizeQtyFraction(evBaseQtyFraction),
    restored: true,
    originalQtyFraction: currentQtyFraction,
    qtyProfile,
  };
}

function isPreRealQtyProfileEvent(event, features) {
  return false;
}

function isEarlyEventName(event, features) {
  const ev = String(event || "").toUpperCase();
  if (isPrimaryLongShortEventName(ev)) {
    return resolveEntryTimingTier(buildEntryTierContext(ev, features)) === "EARLY";
  }
  return ev.startsWith("EARLY_");
}

function isEmoEventName(event) {
  const ev = String(event || "").toUpperCase();
  return ev.startsWith("EMO_");
}

function isPreRealOrEarlyEventName(event, features) {
  return isEarlyEventName(event, features);
}

function resolveSignalTier(event, features) {
  const tier = resolveEntryTimingTier(buildEntryTierContext(event, features));
  if (tier) return tier;
  if (isEmoEventName(event)) return "EMO";
  return null;
}

function resolvePositionLeverage({ position, fallback = 1 } = {}) {
  const pos = position || {};
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const lev = Number(
    meta.leverage ??
    meta.external_leverage ??
    pos.leverage ??
    (pos.meta && pos.meta.futures_leverage) ??
    fallback
  );
  return normalizeFuturesLeverage(lev, 3);
}

function resolveBudgetUsedFromNotional({ notional, leverage } = {}) {
  const notionalNum = Number(notional);
  if (!Number.isFinite(notionalNum) || notionalNum <= 0) return 0;
  const lev = normalizeFuturesLeverage(Number(leverage), 3);
  return notionalNum / (Number.isFinite(lev) && lev > 0 ? lev : 1);
}

function resolveBinanceBudgetUsedKrw({ position, riskBudget, notionalFallback = null, priceFallback = null, qtyBaseFallback = null } = {}) {
  const pos = position || {};
  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const qtyBase = Number.isFinite(Number(qtyBaseFallback)) && Number(qtyBaseFallback) > 0
    ? Number(qtyBaseFallback)
    : Number(pos.qty_base ?? meta.qty_base ?? meta.external_qty_base);
  const priceRef = Number.isFinite(Number(priceFallback)) && Number(priceFallback) > 0
    ? Number(priceFallback)
    : Number(pos.avg_price ?? meta.external_entry_price ?? meta.external_mark_price);
  const leverage = resolvePositionLeverage({ position: pos, fallback: 1 });
  const notional = Number.isFinite(Number(notionalFallback)) && Number(notionalFallback) > 0
    ? Number(notionalFallback)
    : ((Number.isFinite(qtyBase) && qtyBase > 0 && Number.isFinite(priceRef) && priceRef > 0) ? (qtyBase * priceRef) : null);
  if (Number.isFinite(notional) && notional > 0) {
    return resolveBudgetUsedFromNotional({ notional, leverage });
  }

  const symbol = String(pos.symbol_or_pair_id || pos.symbol || "").toUpperCase();
  const perMarketMax = Number(
    pos.budget_max_krw ??
    (riskBudget && riskBudget.byMarket && riskBudget.byMarket[symbol]) ??
    (riskBudget && riskBudget.maxKrw) ??
    0
  );
  const stored = Number(pos.budget_used_krw);
  if (Number.isFinite(stored) && stored > 0) {
    if (!Number.isFinite(perMarketMax) || perMarketMax <= 0 || stored <= (perMarketMax * 1.05)) {
      return stored;
    }
  }
  const sizePct = Number(pos.size_pct);
  if (Number.isFinite(sizePct) && sizePct > 0 && Number.isFinite(perMarketMax) && perMarketMax > 0) {
    return Math.min(perMarketMax, Math.max(0, sizePct) * perMarketMax);
  }
  return 0;
}

function resolveTfFromMs(ms) {
  const tfNum = Number(ms);
  if (!Number.isFinite(tfNum) || tfNum <= 0) return null;
  const known = ["15m", "30m", "60m"];
  for (const tf of known) {
    if (tfToMs(tf) === tfNum) return tf;
  }
  return null;
}

function pickSignalPosterior(features, dir) {
  if (!features || typeof features !== "object") return null;
  const side = String(dir || "").toUpperCase();
  const longKeys = ["zz_post_prob_long", "post_prob_long", "posterior_long", "posterior_long_prob"];
  const shortKeys = ["zz_post_prob_short", "post_prob_short", "posterior_short", "posterior_short_prob"];
  const genericKeys = ["posterior", "post_prob", "posterior_prob"];
  const keys = side === "SHORT" ? shortKeys : longKeys;

  const parse01 = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n >= 0 && n <= 1) return n;
    if (n >= 0 && n <= 100) return n / 100;
    return null;
  };

  for (const k of [...keys, ...genericKeys]) {
    const n = parse01(features[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function computePnlStats(trades, sinceMs) {
  const rows = Array.isArray(trades) ? trades : [];
  let pnl = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;
  let tradesN = 0;
  for (const t of rows) {
    const closeMs = Number(t && t.close_ms);
    if (!Number.isFinite(closeMs) || closeMs < sinceMs) continue;
    const v = Number(t && t.pnl_krw);
    if (!Number.isFinite(v)) continue;
    tradesN += 1;
    pnl += v;
    if (v > 0) grossProfit += v;
    else if (v < 0) grossLossAbs += Math.abs(v);
  }
  let pf = 0;
  if (grossLossAbs > 0) pf = grossProfit / grossLossAbs;
  else if (grossProfit > 0) pf = 99;
  return { trades: tradesN, pnl, pf, grossProfit, grossLossAbs };
}

const FUTURES_DYNAMIC_3X_ENABLED = String(process.env.FUTURES_DYNAMIC_3X_ENABLED || "1") !== "0";
const FUTURES_BASE_LEVERAGE = normalizeFuturesLeverage(Number(process.env.FUTURES_BASE_LEVERAGE || 2), 3);
// Active runtime is LONG/SHORT + FIXED qty. Legacy tier budget auto-scaling stays disabled.
const FUTURES_ENTRY_TIER_BUDGET_AUTO_SCALE = false;
const FUTURES_ENTRY_TIER_TARGET_MODE = "FIXED";
const FUTURES_ACTIVE_FIXED_MARGIN_TARGET = Number.isFinite(Number(process.env.FUTURES_ACTIVE_FIXED_MARGIN_TARGET))
  ? Number(process.env.FUTURES_ACTIVE_FIXED_MARGIN_TARGET)
  : 1000;
const FUTURES_3X_BASE_WHITELIST = new Set(parseUpperList(
  process.env.FUTURES_3X_BASE_WHITELIST,
  ["BNBUSDT", "SOLUSDT"]
).map(normalizeFuturesSymbolKey));
const FUTURES_3X_REAL_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_3X_REAL_CONF_MIN))
  ? Number(process.env.FUTURES_3X_REAL_CONF_MIN)
  : 0.70;
const FUTURES_3X_REAL_POST_MIN = Number.isFinite(Number(process.env.FUTURES_3X_REAL_POST_MIN))
  ? Number(process.env.FUTURES_3X_REAL_POST_MIN)
  : 0.62;
const FUTURES_3X_CORE_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_3X_CORE_CONF_MIN))
  ? Number(process.env.FUTURES_3X_CORE_CONF_MIN)
  : 0.78;
const FUTURES_3X_CORE_POST_MIN = Number.isFinite(Number(process.env.FUTURES_3X_CORE_POST_MIN))
  ? Number(process.env.FUTURES_3X_CORE_POST_MIN)
  : 0.66;
const FUTURES_3X_KILL_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_KILL_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_KILL_PF_MIN_7D)
  : 1.0;
const FUTURES_3X_RECOVER_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_RECOVER_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_RECOVER_PF_MIN_7D)
  : 1.0;
const FUTURES_3X_PROMOTE_TRADES_MIN_14D = Math.max(1, Math.floor(Number(process.env.FUTURES_3X_PROMOTE_TRADES_MIN_14D || 10)));
const FUTURES_3X_PROMOTE_PF_MIN_14D = Number.isFinite(Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_14D))
  ? Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_14D)
  : 1.2;
const FUTURES_3X_PROMOTE_PF_MIN_7D = Number.isFinite(Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_7D))
  ? Number(process.env.FUTURES_3X_PROMOTE_PF_MIN_7D)
  : 1.05;
const FUTURES_3X_STREAK_REQUIRED = Math.max(1, Math.floor(Number(process.env.FUTURES_3X_STREAK_REQUIRED || 2)));
const FUTURES_3X_STREAK_MIN_INTERVAL_MS = Math.max(60 * 1000, Math.floor(Number(process.env.FUTURES_3X_STREAK_MIN_INTERVAL_MS || (2 * 60 * 60 * 1000))));
const FUTURES_3X_COOLDOWN_MS = Math.max(60 * 1000, Math.floor(Number(process.env.FUTURES_3X_COOLDOWN_MS || (72 * 60 * 60 * 1000))));
const FUTURES_3X_STATS_LOOKBACK_DAYS = Math.max(7, Math.floor(Number(process.env.FUTURES_3X_STATS_LOOKBACK_DAYS || 14)));
const FUTURES_3X_STATS_LIMIT = Math.max(500, Math.floor(Number(process.env.FUTURES_3X_STATS_LIMIT || 5000)));
const FUTURES_3X_STATS_HARD_MAX = Math.max(FUTURES_3X_STATS_LIMIT, Math.floor(Number(process.env.FUTURES_3X_STATS_HARD_MAX || 12000)));
const FUTURES_3X_STATS_CACHE_TTL_MS = Math.max(30 * 1000, Math.floor(Number(process.env.FUTURES_3X_STATS_CACHE_TTL_MS || (10 * 60 * 1000))));
const FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED = String(process.env.FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED || "1") !== "0";
const FUTURES_EXIT_PROFILE_BASE = Object.freeze({
  key: "BASE",
  rules: {
    SL: -0.0165,
    TP_P1: 0.025,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: 0.0025,
    TRAIL_PCT: 0.01,
    RUNNER_MIN_PROFIT_PCT: 0.02,
  },
});
const FUTURES_EXIT_PROFILE_AGGRESSIVE = Object.freeze({
  key: "AGGRESSIVE",
  rules: {
    SL: -0.02,
    TP_P1: 0.03,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: 0.0025,
    TRAIL_PCT: 0.015,
    RUNNER_MIN_PROFIT_PCT: 0.02,
  },
});
const FUTURES_EXIT_PROFILE_REAL_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_REAL_CONF_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_REAL_CONF_MIN)
  : FUTURES_3X_REAL_CONF_MIN;
const FUTURES_EXIT_PROFILE_REAL_POST_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_REAL_POST_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_REAL_POST_MIN)
  : FUTURES_3X_REAL_POST_MIN;
const FUTURES_EXIT_PROFILE_CORE_CONF_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_CORE_CONF_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_CORE_CONF_MIN)
  : FUTURES_3X_CORE_CONF_MIN;
const FUTURES_EXIT_PROFILE_CORE_POST_MIN = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_CORE_POST_MIN))
  ? Number(process.env.FUTURES_EXIT_PROFILE_CORE_POST_MIN)
  : FUTURES_3X_CORE_POST_MIN;
const FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED = String(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED || "1") !== "0";
const FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D = Math.max(1, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D || 3)));
const FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D)
  : 0;
const FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D)
  : 0.95;
const FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D = Math.max(1, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D || 3)));
const FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D)
  : 0;
const FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D = Number.isFinite(Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D))
  ? Number(process.env.FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D)
  : 1.02;
const FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS = Math.max(10 * 60 * 1000, Math.floor(Number(process.env.FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS || (72 * 60 * 60 * 1000))));
const BINANCE_NATIVE_PROTECTION_ENABLED = String(process.env.BINANCE_NATIVE_PROTECTION_ENABLED || "1") !== "0";
const BINANCE_NATIVE_TP_ENABLED = String(process.env.BINANCE_NATIVE_TP_ENABLED || "1") !== "0";
const BINANCE_NATIVE_WORKING_TYPE = String(process.env.BINANCE_NATIVE_WORKING_TYPE || "MARK_PRICE").trim() || "MARK_PRICE";
const BINANCE_NATIVE_PRICE_PROTECT = String(process.env.BINANCE_NATIVE_PRICE_PROTECT || "1") !== "0";
const BINANCE_NATIVE_PROTECTION_RETRY_COUNT = Math.max(0, Math.min(5, Math.floor(Number(process.env.BINANCE_NATIVE_PROTECTION_RETRY_COUNT || 1))));
const BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS = Math.max(0, Math.floor(Number(process.env.BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS || 1200)));
const BINANCE_NATIVE_REFRESH_LEASE_TTL_MS = Math.max(2000, Math.floor(Number(process.env.BINANCE_NATIVE_REFRESH_LEASE_TTL_MS || 8000)));
const FUTURES_POSITION_SYNC_LEASE_ENABLED = String(process.env.FUTURES_POSITION_SYNC_LEASE_ENABLED || "1") !== "0";
const FUTURES_POSITION_SYNC_LEASE_TTL_MS = Math.max(3000, Math.floor(Number(process.env.FUTURES_POSITION_SYNC_LEASE_TTL_MS || 12000)));
const FUTURES_POSITION_SYNC_LEASE_WAIT_MS = Math.max(0, Math.floor(Number(process.env.FUTURES_POSITION_SYNC_LEASE_WAIT_MS || 5000)));
const BINANCE_NATIVE_ALERT_ENABLED = String(process.env.BINANCE_NATIVE_ALERT_ENABLED || "1") !== "0";
const BINANCE_NATIVE_ALERT_TELEGRAM_ONLY = String(process.env.BINANCE_NATIVE_ALERT_TELEGRAM_ONLY || "1") !== "0";
const BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS = Math.max(5000, Math.floor(Number(process.env.BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS || 30000)));
const BINANCE_NATIVE_ALERT_COOLDOWN_MS = Math.max(10000, Math.floor(Number(process.env.BINANCE_NATIVE_ALERT_COOLDOWN_MS || 60000)));
const LIVE_EXIT_EXCEPTION_ALERT_COOLDOWN_MS = Math.max(10000, Math.floor(Number(process.env.LIVE_EXIT_EXCEPTION_ALERT_COOLDOWN_MS || 300000)));
const binanceNativeRefreshLeaseHolderId = [
  process.env.K_SERVICE || "local",
  process.env.K_REVISION || "dev",
  process.pid,
].join(":");
const futuresPositionSyncLeaseHolderId = [
  process.env.K_SERVICE || "local",
  process.env.K_REVISION || "dev",
  process.pid,
].join(":");
const futures3xStatsCache = new Map();
const futures3xState = new Map();
const futuresExitProfileState = new Map();
const nativeProtectionAlertChannelCache = new Map();
const nativeProtectionAlertCooldownMap = new Map();
const liveExitExceptionAlertCooldownMap = new Map();

function cloneExitRules(rules) {
  return { ...(rules && typeof rules === "object" ? rules : {}) };
}

function resolveStructureInitialStopPrice({ avgPrice, side, features, nativeProtectionStopPrice } = {}) {
  const avg = Number(avgPrice);
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const f = (features && typeof features === "object") ? features : {};
  const featureStop = Number(
    f.stop_price
    ?? f.stopPrice
    ?? f.entry_stop_price
    ?? f.entryStopPrice
  );
  const nativeStop = Number(nativeProtectionStopPrice);
  const candidates = [featureStop, nativeStop];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate) || !Number.isFinite(avg) || avg <= 0) continue;
    if (sideUpper === "SHORT" && candidate > avg) return candidate;
    if (sideUpper === "LONG" && candidate < avg) return candidate;
  }
  return null;
}

function resolveInitialStopSource({ avgPrice, side, features, nativeProtectionStopPrice } = {}) {
  const structureStop = resolveStructureInitialStopPrice({ avgPrice, side, features, nativeProtectionStopPrice });
  if (!Number.isFinite(structureStop)) return "LEVERAGED_SL_FALLBACK";
  const featureStop = Number(
    features && (
      features.stop_price
      ?? features.stopPrice
      ?? features.entry_stop_price
      ?? features.entryStopPrice
    )
  );
  if (Number.isFinite(featureStop) && Math.abs(featureStop - structureStop) <= 1e-9) return "STRUCTURE_STOP_FEATURE";
  const nativeStop = Number(nativeProtectionStopPrice);
  if (Number.isFinite(nativeStop) && Math.abs(nativeStop - structureStop) <= 1e-9) return "STRUCTURE_STOP_NATIVE";
  return "LEVERAGED_SL_FALLBACK";
}

function isExitMetaLinkedToEntry({
  entryEventId = null,
  exitEntryEventId = null,
  entryExecMs = null,
  exitEntryExecMs = null,
  exitAtMs = null,
} = {}) {
  const entryId = String(entryEventId || "").trim();
  const exitEntryId = String(exitEntryEventId || "").trim();
  const entryMs = Number(entryExecMs);
  const linkedEntryMs = Number(exitEntryExecMs);
  const exitMs = Number(exitAtMs);
  let linkedToEntry = true;
  if (entryId && exitEntryId && entryId !== exitEntryId) linkedToEntry = false;
  if (linkedToEntry && Number.isFinite(entryMs)) {
    if (Number.isFinite(linkedEntryMs)) {
      if (Math.abs(linkedEntryMs - entryMs) > 1000) linkedToEntry = false;
    } else if (Number.isFinite(exitMs) && (exitMs + 30000) < entryMs) {
      linkedToEntry = false;
    }
  }
  // Lineage-less exit ledger flags cannot be proven to belong to the current
  // cycle. Earlier writers omitted tp_p1_entry_event_id / tp_p1_entry_exec_bar_ms
  // / tp_p1_at, so a leaked tp_p1_done from a prior cycle silently passed the
  // checks above (no fields → no mismatch). When the entry side has any lineage
  // proof but the exit side carries none, treat the exit as unlinked so the
  // sync auto-heal path clears the stale flag instead of letting it block TP1.
  if (
    linkedToEntry
    && (entryId || Number.isFinite(entryMs))
    && !exitEntryId
    && !Number.isFinite(linkedEntryMs)
    && !Number.isFinite(exitMs)
  ) {
    linkedToEntry = false;
  }
  return linkedToEntry;
}

function computeExitTriggerPrice({ avgPrice, leverage, side, pnlPct } = {}) {
  const px = Number(avgPrice);
  const levRaw = Number(leverage);
  const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : 1;
  const pct = Number(pnlPct);
  const sideUpper = String(side || "").toUpperCase();
  if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(pct)) return null;
  const move = pct / lev;
  if (sideUpper === "SHORT") {
    const den = 1 + move;
    return den > 0 ? (px / den) : null;
  }
  return px * (1 + move);
}

function computeTpP1TargetPrice({ exchange, position, posMeta, fillPrice } = {}) {
  const rules = resolveExitRulesForPosition({
    exchange,
    position: position || { meta: posMeta || {} },
  });
  const side = normalizePositionSide(
    (position && (position.position_side || position.side))
    || (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const entryPrice = Number(
    (position && position.avg_price)
    ?? (posMeta && (posMeta.external_entry_price ?? posMeta.entry_price))
  );
  const leverage = resolvePositionLeverage({ position, fallback: posMeta && posMeta.external_leverage });
  const targetPrice = computeExitTriggerPrice({
    avgPrice: entryPrice,
    leverage,
    side,
    pnlPct: Number(rules && rules.TP_P1),
  });
  return Number.isFinite(targetPrice) ? targetPrice : (Number.isFinite(Number(fillPrice)) ? Number(fillPrice) : null);
}

function computeInitialStopPriceForEntry({ avgPrice, leverage, side, slRatio, features, nativeProtectionStopPrice } = {}) {
  const structureStop = resolveStructureInitialStopPrice({
    avgPrice,
    side,
    features,
    nativeProtectionStopPrice,
  });
  if (Number.isFinite(structureStop)) return structureStop;
  const avg = Number(avgPrice);
  const lev = Number(leverage);
  const sl = Number(slRatio);
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  if (!Number.isFinite(avg) || avg <= 0 || !Number.isFinite(lev) || lev <= 0 || !Number.isFinite(sl)) return null;
  const pnlPct = sl / lev;
  if (sideUpper === "SHORT") return avg * (1 - pnlPct);
  return avg * (1 + pnlPct);
}

function buildExitProfileDecision(profile, reason, extra = {}) {
  const base = profile && profile.rules ? profile : FUTURES_EXIT_PROFILE_BASE;
  return {
    profile: base.key,
    reason,
    rules: cloneExitRules(base.rules),
    ...extra,
  };
}

function applySignalExitPolicyOverrides(exitRules, features) {
  const nextRules = cloneExitRules(exitRules);
  const f = (features && typeof features === "object") ? features : {};
  const exitPolicySrc = String(f.exit_policy_source || "").trim().toUpperCase();
  if (!exitPolicySrc || exitPolicySrc === "BINANCE_DEFAULT") return nextRules;
  const dynSl = Number(f.exit_policy_sl_pct);
  const dynTp1 = Number(f.exit_policy_tp1_pct);
  const dynBe = Number(f.exit_policy_be_pct);
  const dynTrail = Number(f.exit_policy_trail_pct);
  const dynTrailR = Number(f.exit_policy_trail_r_multiple);
  const dynRunnerMin = Number(
    f.exit_policy_runner_min_profit_pct ??
    f.exit_policy_runner_floor_pct ??
    f.exit_policy_runner_min_pct
  );
  if (Number.isFinite(dynSl) && dynSl > 0) {
    nextRules.SL = -(dynSl / 100);
  }
  if (Number.isFinite(dynTp1) && dynTp1 > 0) {
    nextRules.TP_P1 = dynTp1 / 100;
  }
  if (Number.isFinite(dynBe) && dynBe >= 0) {
    nextRules.BE_ENABLE = true;
    nextRules.BE_PCT = dynBe / 100;
  }
  if (Number.isFinite(dynTrail) && dynTrail > 0) {
    nextRules.TRAIL_PCT = dynTrail / 100;
  }
  if (Number.isFinite(dynTrailR) && dynTrailR > 0) {
    nextRules.TRAIL_R_MULTIPLE = dynTrailR;
  }
  if (Number.isFinite(dynRunnerMin) && dynRunnerMin > 0) {
    nextRules.RUNNER_MIN_PROFIT_PCT = dynRunnerMin / 100;
  }
  return nextRules;
}

function applyEntryExitRuleRuntimeAdjustments({
  exchange = null,
  rules = null,
  features = null,
  positionMeta = null,
  sysCfg = null,
  cohort = null,
  market = null,
} = {}) {
  let appliedExitRules = cloneExitRules(rules || FUTURES_EXIT_PROFILE_BASE.rules);
  const f = (features && typeof features === "object") ? features : {};
  const metaSafe = (positionMeta && typeof positionMeta === "object") ? positionMeta : {};
  const exitPolicySrc = String(f.exit_policy_source || metaSafe.exit_policy_source || "").trim().toUpperCase();
  const hasExplicitExitPolicy = !!(exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT");
  let tp1LadderState = null;

  if (hasExplicitExitPolicy) {
    const dynSl = Number(f.exit_policy_sl_pct);
    const dynTp1 = Number(f.exit_policy_tp1_pct);
    const dynBe = Number(f.exit_policy_be_pct);
    const dynTrail = Number(f.exit_policy_trail_pct);
    const dynTrailR = Number(f.exit_policy_trail_r_multiple);
    const dynRunnerMin = Number(
      f.exit_policy_runner_min_profit_pct
      ?? f.exit_policy_runner_floor_pct
      ?? f.exit_policy_runner_min_pct
    );
    if (Number.isFinite(dynSl) && dynSl > 0) {
      appliedExitRules.SL = -(dynSl / 100);
    }
    if (Number.isFinite(dynTp1) && dynTp1 > 0) {
      appliedExitRules.TP_P1 = dynTp1 / 100;
    }
    if (Number.isFinite(dynBe) && dynBe >= 0) {
      appliedExitRules.BE_ENABLE = true;
      appliedExitRules.BE_PCT = dynBe / 100;
    }
    if (Number.isFinite(dynTrail) && dynTrail > 0) {
      appliedExitRules.TRAIL_PCT = dynTrail / 100;
    }
    if (Number.isFinite(dynTrailR) && dynTrailR > 0) {
      appliedExitRules.TRAIL_R_MULTIPLE = dynTrailR;
    }
    if (Number.isFinite(dynRunnerMin) && dynRunnerMin > 0) {
      appliedExitRules.RUNNER_MIN_PROFIT_PCT = dynRunnerMin / 100;
    }
  } else {
    const resolvedCohort = normalizeOpenClawCohort(
      cohort
      || f.openclaw_market_regime_cohort
      || f.market_regime_cohort
      || metaSafe.openclaw_market_regime_cohort
      || metaSafe.market_regime_cohort
    ) || "BASE";
    tp1LadderState = resolveTp1LadderRuntimeState({
      sysCfg,
      cohort: resolvedCohort,
      market: market || f.symbol || f.market || metaSafe.symbol || metaSafe.market || null,
    });
    if (tp1LadderState) {
      appliedExitRules = applyTp1LadderPolicy({
        rules: appliedExitRules,
        cohort: resolvedCohort,
        ladderState: tp1LadderState,
      });
    }
  }

  if (String(exchange || "").toUpperCase().includes("BINANCE")) {
    const floor = 0.0165;
    const clampFloor = (value) => {
      const num = Number(value);
      return Number.isFinite(num) && num >= floor ? num : floor;
    };
    appliedExitRules = {
      ...appliedExitRules,
      RUNNER_MIN_PROFIT_PCT: clampFloor(appliedExitRules.RUNNER_MIN_PROFIT_PCT),
      RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: clampFloor(appliedExitRules.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT),
      RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: clampFloor(appliedExitRules.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT),
    };
  }

  return {
    exitPolicySrc: exitPolicySrc || null,
    hasExplicitExitPolicy,
    tp1LadderState,
    appliedExitRules,
  };
}

function shouldRepairActiveExitRuntimeState({
  positionSide = null,
  entryPrice = null,
  posMeta = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const side = normalizePositionSide(positionSide || metaSafe.position_side || metaSafe.external_side || metaSafe.native_protection_side);
  if (!side) return false;
  const nativeSide = normalizePositionSide(metaSafe.native_protection_side);
  if (nativeSide && nativeSide !== side) return true;

  const avgPrice = Number(entryPrice);
  const nativeEntryPrice = Number(metaSafe.native_protection_entry_price);
  if (Number.isFinite(avgPrice) && avgPrice > 0 && Number.isFinite(nativeEntryPrice) && nativeEntryPrice > 0) {
    const relDiff = Math.abs(nativeEntryPrice - avgPrice) / avgPrice;
    if (relDiff > 0.0005) return true;
  }

  const rules = (metaSafe.exit_rules_override && typeof metaSafe.exit_rules_override === "object")
    ? metaSafe.exit_rules_override
    : null;
  if (collectCriticalExitRuleViolations({ rules, posMeta: metaSafe }).length > 0) return true;

  return false;
}

function collectCriticalExitRuleViolations({
  rules = null,
  posMeta = null,
  simplifiedExitV2Enabled = null,
} = {}) {
  const ruleSafe = (rules && typeof rules === "object") ? rules : {};
  const violations = [];
  const tp1 = Number(ruleSafe.TP_P1);
  const tp1Qty = Number(ruleSafe.TP_P1_QTY);
  const sl = Number(ruleSafe.SL);
  const beEnabled = ruleSafe.BE_ENABLE !== false;
  const bePct = Number(ruleSafe.BE_PCT);
  const trailPct = Number(ruleSafe.TRAIL_PCT);
  const trailR = Number(ruleSafe.TRAIL_R_MULTIPLE);
  void posMeta;
  void simplifiedExitV2Enabled;
  if (!(Number.isFinite(tp1) && tp1 > 0)) violations.push("TP1_MISSING");
  if (!(Number.isFinite(tp1Qty) && tp1Qty > 0 && tp1Qty <= 1)) violations.push("TP1_QTY_INVALID");
  if (!(Number.isFinite(sl) && sl < 0)) violations.push("SL_INVALID");
  if (beEnabled && !(Number.isFinite(bePct) && bePct >= 0)) violations.push("BE_INVALID");
  if (!((Number.isFinite(trailPct) && trailPct > 0) || (Number.isFinite(trailR) && trailR > 0))) {
    violations.push("TRAIL_INVALID");
  }
  return violations;
}

function shouldRepairEntryRuntimeExitState({
  appliedExitRules = null,
  posMeta = null,
  features = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const feat = (features && typeof features === "object") ? features : {};
  const exitPolicySrc = String(feat.exit_policy_source || metaSafe.exit_policy_source || "").trim().toUpperCase();
  if (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT") return false;

  const rules = (appliedExitRules && typeof appliedExitRules === "object")
    ? appliedExitRules
    : ((metaSafe.exit_rules_override && typeof metaSafe.exit_rules_override === "object") ? metaSafe.exit_rules_override : null);
  return collectCriticalExitRuleViolations({ rules, posMeta: metaSafe }).length > 0;
}

function sanitizeExitRulesForSimplifiedExitV2({
  rules = null,
  posMeta = null,
} = {}) {
  const ruleSafe = cloneExitRules(rules || {}) || {};
  void posMeta;
  return {
    ...ruleSafe,
    TP_P0: 0,
    TP_P0_QTY: 0,
  };
}

async function repairActivePositionExitRuntimeState({
  exchange,
  symbol,
  positionSide,
  entryPrice,
  leverage,
  liveCfg,
  posMeta = null,
  cohort = null,
  sysCfg = null,
  execBarCloseMs = null,
  allowNativeProtectionWrite = false,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const explicitExitPolicySrc = String(metaSafe.exit_policy_source || "").trim().toUpperCase();
  const preserveExplicitExitPolicy = !!(explicitExitPolicySrc && explicitExitPolicySrc !== "BINANCE_DEFAULT");
  const repairSeedMeta = preserveExplicitExitPolicy
    ? metaSafe
    : mergeMeta(metaSafe, {
        exit_rules_override: null,
        exit_policy_source: null,
        openclaw_market_regime_cohort: cohort || metaSafe.openclaw_market_regime_cohort || metaSafe.market_regime_cohort || null,
      });
  const canonicalRuntimeRules = resolveExitRulesForPosition({
    exchange,
    position: { meta: repairSeedMeta },
  });
  const adjustment = applyEntryExitRuleRuntimeAdjustments({
    exchange,
    rules: canonicalRuntimeRules,
    positionMeta: repairSeedMeta,
    sysCfg: sysCfg || {},
    cohort,
    market: symbol,
  });
  const repairedExitRules = sanitizeExitRulesForSimplifiedExitV2({
    rules: adjustment.appliedExitRules,
    posMeta: metaSafe,
  });
  let nextMeta = mergeMeta(metaSafe, {
    exit_rules_override: cloneExitRules(repairedExitRules),
    exit_profile: canonicalRuntimeRules && canonicalRuntimeRules.exit_profile
      ? String(canonicalRuntimeRules.exit_profile).toUpperCase()
      : (metaSafe.exit_profile || null),
    exit_profile_reason: preserveExplicitExitPolicy
      ? (metaSafe.exit_profile_reason || null)
      : "ACTIVE_POSITION_RUNTIME_REPAIR",
    tp1_ladder_enabled: adjustment.tp1LadderState ? adjustment.tp1LadderState.enabled !== false : null,
    tp1_ladder_stage: adjustment.tp1LadderState ? adjustment.tp1LadderState.stage : null,
    tp1_ladder_profile: adjustment.tp1LadderState ? adjustment.tp1LadderState.profile : null,
    tp1_ladder_reason: adjustment.tp1LadderState ? adjustment.tp1LadderState.reason : null,
    tp1_ladder_realized_n: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.realized_n : null,
    tp1_ladder_tp0_hit_rate: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp0_hit_rate : null,
    tp1_ladder_tp1_hit_rate: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp1_hit_rate : null,
    tp1_ladder_tp0_to_tp1_conversion: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.tp0_to_tp1_conversion : null,
    tp1_ladder_fee_adjusted_expectancy: adjustment.tp1LadderState && adjustment.tp1LadderState.kpi ? adjustment.tp1LadderState.kpi.fee_adjusted_expectancy : null,
    exit_policy_source: preserveExplicitExitPolicy ? (adjustment.exitPolicySrc || explicitExitPolicySrc) : null,
    runtime_exit_repair_applied: true,
    runtime_exit_repair_reason: "ACTIVE_POSITION_EXIT_META_MISMATCH",
    runtime_exit_repair_at_ms: Date.now(),
  });

  const fallbackSide = String(positionSide || "").toUpperCase() === "SHORT" ? "SELL" : "BUY";
  if (liveCfg && liveCfg.apiKey && liveCfg.apiSecret && Number.isFinite(Number(entryPrice)) && Number(entryPrice) > 0) {
    // 2026-04-19 ETHUSDT 20-minute blackout fix: when the current meta
    // already indicates the native stop is MISSING (either by
    // `native_protection_refresh_status === "MISSING"` or by the
    // projection invariant list containing "NATIVE_STOP_MISSING"),
    // escalate the dispatch to `executeImmediately: true` so the exit
    // worker hits `/run-execute` (synchronous; worker holds the HTTP
    // connection, so Cloud Run keeps the container's CPU allocated for
    // the full burst) instead of `/run` (fire-and-forget; the outer
    // response returns immediately and the inner self-fetch can be
    // starved of CPU under Cloud Run's throttling once the outer
    // response closes).
    //
    // Observed failure: ETHUSDT entered LONG at 11:15:23Z with only a
    // partial fill (qty=0.864 of 1.0 requested) because the
    // market-fallback leg hit `code=-2019 "Margin is insufficient"`.
    // The resulting position had no native STOP on the exchange. The
    // 2-minute periodic repair triggers all dispatched via `/run`, but
    // the refresh step never appeared in logs — 20 minutes elapsed
    // before a manual `/run-execute` synchronously placed the stop
    // (stop_id=4000001120399692, refresh_status=OK). Escalating the
    // repair path to `executeImmediately: true` closes that gap:
    // whenever we know the stop is already missing, we cannot afford
    // the fire-and-forget path.
    //
    // Non-missing refreshes (e.g. routine BE-raise during TP1) still
    // use the cheaper `/run` path — they're re-triggered every tick,
    // so occasional fire-and-forget loss is benign.
    const refreshStatusRaw = String(metaSafe.native_protection_refresh_status || "")
      .trim()
      .toUpperCase();
    const invariants = Array.isArray(metaSafe.exchange_projection_invariants)
      ? metaSafe.exchange_projection_invariants
      : [];
    const stopMissing =
      refreshStatusRaw === "MISSING"
      || refreshStatusRaw === "FAILED"
      || invariants.includes("NATIVE_STOP_MISSING");
    try {
      await requestBinanceNativeProtectionRefresh({
        exchange,
        symbol,
        fallbackSide,
        fallbackEntryPrice: Number(entryPrice),
        fallbackLeverage: Number.isFinite(Number(leverage)) && Number(leverage) > 0 ? Number(leverage) : FUTURES_BASE_LEVERAGE,
        exitRulesOverride: repairedExitRules || null,
        posMeta: nextMeta,
        source: "ACTIVE_POSITION_EXIT_RUNTIME_REPAIR",
        reason: allowNativeProtectionWrite === true
          ? "NON_AUTHORITY_LAYER_WRITE_DOWNGRADED_TO_REPAIR_REQUEST"
          : "NON_AUTHORITY_LAYER_REQUEST",
        dispatchReason: `ACTIVE_POSITION_EXIT_RUNTIME_REPAIR_NATIVE_STOP_REFRESH_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
        executeImmediately: stopMissing,
      });
      nextMeta = mergeMeta(nextMeta, {
        native_protection_refresh_status: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER",
        native_protection_refresh_reason: allowNativeProtectionWrite === true
          ? "NON_AUTHORITY_LAYER_WRITE_DOWNGRADED_TO_REPAIR_REQUEST"
          : "NON_AUTHORITY_LAYER_REQUEST",
        native_protection_refresh_at_ms: Date.now(),
        native_protection_refresh_requested_at_ms: Date.now(),
      });
      try {
        console.log(JSON.stringify({
          event: "active_position_exit_runtime_repair_dispatched",
          ts: new Date().toISOString(),
          exchange: String(exchange || "").toUpperCase(),
          symbol: String(symbol || "").toUpperCase(),
          execute_immediately: stopMissing === true,
          stop_missing: stopMissing === true,
          prior_refresh_status: refreshStatusRaw || null,
          prior_invariants: invariants,
        }));
      } catch (_) {}
    } catch (_) {}
  }
  return nextMeta;
}

async function enforceEntryRuntimeExitState({
  exchange,
  symbol,
  appliedExitRules = null,
  posMeta = null,
  features = null,
  cohort = null,
  sysCfg = null,
  entryPrice = null,
  leverage = null,
  execBarCloseMs = null,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  if (!shouldRepairEntryRuntimeExitState({ appliedExitRules, posMeta: metaSafe, features })) {
    return {
      repaired: false,
      meta: metaSafe,
      appliedExitRules: cloneExitRules(appliedExitRules || metaSafe.exit_rules_override || FUTURES_EXIT_PROFILE_BASE.rules),
    };
  }

  const repairedMeta = await repairActivePositionExitRuntimeState({
    exchange,
    symbol,
    positionSide: metaSafe.position_side || metaSafe.external_side || null,
    entryPrice,
    leverage,
    liveCfg: null,
    posMeta: mergeMeta(metaSafe, {
      exit_rules_override: cloneExitRules(appliedExitRules || metaSafe.exit_rules_override || FUTURES_EXIT_PROFILE_BASE.rules),
    }),
    cohort,
    sysCfg,
    execBarCloseMs,
  });

  return {
    repaired: true,
    meta: mergeMeta(repairedMeta, {
      runtime_exit_invariant_repaired: true,
      runtime_exit_invariant_reason: "ENTRY_RUNTIME_EXIT_RULES_INVALID",
      runtime_exit_invariant_at_ms: Date.now(),
    }),
    appliedExitRules: cloneExitRules(repairedMeta.exit_rules_override || appliedExitRules || FUTURES_EXIT_PROFILE_BASE.rules),
  };
}

async function loadFutures3xStats({ exchange, symbol, tf, nowMs }) {
  const ex = String(exchange || "").toUpperCase();
  const symbolRaw = String(symbol || "").trim().toUpperCase();
  const symNorm = normalizeFuturesSymbolKey(symbolRaw);
  const sym = symbolRaw || symNorm;
  const tfKey = String(tf || defaultExecTfFromEnv() || "15m");
  const cacheKey = `${ex}:${symNorm}:${tfKey}`;
  const cached = futures3xStatsCache.get(cacheKey);
  if (cached && (nowMs - cached.at) <= FUTURES_3X_STATS_CACHE_TTL_MS) return cached.data;

  const lookbackMs = FUTURES_3X_STATS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const fromMs = nowMs - lookbackMs;
  let fills = await fetchRecentNewFills({
    exchange: ex,
    symbol: sym,
    tf: tfKey,
    limitN: FUTURES_3X_STATS_LIMIT,
    fromMs,
    hardMaxDocs: FUTURES_3X_STATS_HARD_MAX,
  });
  if ((!Array.isArray(fills) || fills.length === 0) && symNorm && symNorm !== sym) {
    fills = await fetchRecentNewFills({
      exchange: ex,
      symbol: symNorm,
      tf: tfKey,
      limitN: FUTURES_3X_STATS_LIMIT,
      fromMs,
      hardMaxDocs: FUTURES_3X_STATS_HARD_MAX,
    });
  }
  const realFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("REAL_"));
  const coreFills = fills.filter((f) => String(f && f.event || "").toUpperCase().startsWith("CORE_"));
  const mode = String(process.env.FUTURES_3X_PNL_MODE || "EACH_SELL").toUpperCase();
  const realTrades = buildTradesFromFills(realFills, { mode });
  const coreTrades = buildTradesFromFills(coreFills, { mode });
  const since3d = nowMs - (3 * 24 * 60 * 60 * 1000);
  const since7d = nowMs - (7 * 24 * 60 * 60 * 1000);
  const since14d = nowMs - (14 * 24 * 60 * 60 * 1000);
  const data = {
    real: {
      d3: computePnlStats(realTrades, since3d),
      d7: computePnlStats(realTrades, since7d),
      d14: computePnlStats(realTrades, since14d),
    },
    core: {
      d3: computePnlStats(coreTrades, since3d),
      d7: computePnlStats(coreTrades, since7d),
      d14: computePnlStats(coreTrades, since14d),
    },
  };
  futures3xStatsCache.set(cacheKey, { at: nowMs, data });
  return data;
}

function shouldPromote3x(real7, real14) {
  return Number(real14 && real14.trades) >= FUTURES_3X_PROMOTE_TRADES_MIN_14D
    && Number(real14 && real14.pnl) > 0
    && Number(real14 && real14.pf) >= FUTURES_3X_PROMOTE_PF_MIN_14D
    && Number(real7 && real7.pnl) > 0
    && Number(real7 && real7.pf) >= FUTURES_3X_PROMOTE_PF_MIN_7D;
}

function eval3xSymbolState({ symbol, stats, nowMs }) {
  const sym = normalizeFuturesSymbolKey(symbol);
  const baseWhitelisted = FUTURES_3X_BASE_WHITELIST.has(sym);
  const key = sym;
  const prev = futures3xState.get(key) || {
    streak: 0,
    promoted: false,
    lastStreakUpdateMs: 0,
    cooldownUntilMs: 0,
  };

  const real7 = stats && stats.real && stats.real.d7 ? stats.real.d7 : { trades: 0, pnl: 0, pf: 0 };
  const real14 = stats && stats.real && stats.real.d14 ? stats.real.d14 : { trades: 0, pnl: 0, pf: 0 };
  const killNow = Number(real7.pnl) <= 0 || Number(real7.pf) < FUTURES_3X_KILL_PF_MIN_7D;
  let streak = prev.streak || 0;
  let promoted = !!prev.promoted;
  let lastStreakUpdateMs = Number(prev.lastStreakUpdateMs || 0);
  let cooldownUntilMs = Number(prev.cooldownUntilMs || 0);

  if (killNow) {
    promoted = false;
    streak = 0;
    cooldownUntilMs = nowMs + FUTURES_3X_COOLDOWN_MS;
  } else {
    const passPromote = shouldPromote3x(real7, real14);
    if (passPromote) {
      if ((nowMs - lastStreakUpdateMs) >= FUTURES_3X_STREAK_MIN_INTERVAL_MS) {
        streak += 1;
        lastStreakUpdateMs = nowMs;
      }
      if (streak >= FUTURES_3X_STREAK_REQUIRED) promoted = true;
    } else {
      streak = 0;
    }
  }

  const cooldownActive = nowMs < cooldownUntilMs;
  const recovered = Number(real7.pnl) > 0 && Number(real7.pf) >= FUTURES_3X_RECOVER_PF_MIN_7D;
  const whitelistAuto = promoted || baseWhitelisted;
  const canUse3x = whitelistAuto && !cooldownActive && recovered && !killNow;

  const next = {
    streak,
    promoted,
    lastStreakUpdateMs,
    cooldownUntilMs,
    baseWhitelisted,
  };
  futures3xState.set(key, next);

  return {
    ...next,
    killNow,
    recovered,
    cooldownActive,
    whitelistAuto,
    canUse3x,
  };
}

async function resolveAdaptiveFuturesLeverage({
  liveCfg,
  exchange,
  symbol,
  tf,
  intent,
  event,
  side,
  features,
  nowMs,
} = {}) {
  const baseLeverage = FUTURES_BASE_LEVERAGE;
  if (!FUTURES_DYNAMIC_3X_ENABLED) return { leverage: baseLeverage, reason: "DYNAMIC_3X_DISABLED" };
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { leverage: baseLeverage, reason: "NOT_BINANCE" };
  const intentUpper = String(intent || "").toUpperCase();
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") return { leverage: baseLeverage, reason: "NON_ENTRY_INTENT" };

  const tier = resolveSignalTier(event, features);
  if (tier !== "CORE" && tier !== "REAL") return { leverage: baseLeverage, reason: "NON_CORE_TIER_EVENT", tier };

  const regime = pickSignalRegime(features);
  if (regime !== "trend") return { leverage: baseLeverage, reason: "REGIME_NOT_TREND" };

  const intentDir = directionFromSignal({ event, side });
  const confidenceRaw = pickSignalConfidence(features);
  const waveConfRaw = pickSignalWaveConf(features);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : waveConfRaw;
  const posterior = pickSignalPosterior(features, intentDir);
  const confMin = tier === "CORE" ? FUTURES_3X_CORE_CONF_MIN : FUTURES_3X_REAL_CONF_MIN;
  const postMin = tier === "CORE" ? FUTURES_3X_CORE_POST_MIN : FUTURES_3X_REAL_POST_MIN;
  if (!Number.isFinite(confidence) || confidence < confMin) {
    return { leverage: baseLeverage, reason: "CONFIDENCE_BELOW_THRESHOLD", confidence, confMin };
  }
  if (!Number.isFinite(posterior) || posterior < postMin) {
    return { leverage: baseLeverage, reason: "POSTERIOR_BELOW_THRESHOLD", posterior, postMin };
  }

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let stats = null;
  try {
    stats = await loadFutures3xStats({ exchange: ex, symbol, tf, nowMs: now });
  } catch (e) {
    return { leverage: baseLeverage, reason: "STATS_LOAD_FAILED", error: e && e.message ? e.message : String(e) };
  }
  const state = eval3xSymbolState({ symbol, stats, nowMs: now });
  if (!state.whitelistAuto) return { leverage: baseLeverage, reason: "NOT_IN_DYNAMIC_WHITELIST", state, stats };
  if (state.cooldownActive) return { leverage: baseLeverage, reason: "KILL_SWITCH_COOLDOWN", state, stats };
  if (!state.recovered) return { leverage: baseLeverage, reason: "RECOVERY_NOT_MET", state, stats };
  if (tier === "CORE") {
    const core7 = stats && stats.core && stats.core.d7 ? stats.core.d7 : null;
    const core14 = stats && stats.core && stats.core.d14 ? stats.core.d14 : null;
    const coreOk = core7
      && core14
      && Number(core7.trades) >= 3
      && Number(core7.pnl) > 0
      && Number(core7.pf) >= 1.0
      && Number(core14.pnl) > 0;
    if (!coreOk) {
      return { leverage: baseLeverage, reason: "CORE_STATS_NOT_READY", state, stats };
    }
  }

  return {
    leverage: 3,
    reason: `${tier}_3X_ENABLED`,
    tier,
    confidence,
    posterior,
    state,
    stats,
  };
}

function getExitProfileSymbolState(symbol) {
  const key = normalizeFuturesSymbolKey(symbol);
  const raw = futuresExitProfileState.get(key);
  const prevObj = (raw && typeof raw === "object") ? raw : {};
  const prev = {
    rollbackUntilMs: Number.isFinite(Number(prevObj.rollbackUntilMs)) ? Number(prevObj.rollbackUntilMs) : 0,
    lastRollbackAtMs: Number.isFinite(Number(prevObj.lastRollbackAtMs)) ? Number(prevObj.lastRollbackAtMs) : 0,
    rollbackReason: prevObj.rollbackReason ? String(prevObj.rollbackReason) : null,
  };
  return { key, prev };
}

function evaluateExitProfileRollback({ symbol, stats, nowMs }) {
  const { key, prev } = getExitProfileSymbolState(symbol);
  const real3 = stats && stats.real && stats.real.d3 ? stats.real.d3 : { trades: 0, pnl: 0, pf: 0 };
  const trades3 = Number(real3.trades || 0);
  const pnl3 = Number(real3.pnl || 0);
  const pf3 = Number(real3.pf || 0);

  let rollbackUntilMs = Number(prev.rollbackUntilMs || 0);
  let rollbackReason = prev.rollbackReason || null;
  const rollbackActive = nowMs < rollbackUntilMs;
  const killEligible = trades3 >= FUTURES_EXIT_PROFILE_ROLLBACK_MIN_TRADES_3D;
  const recoverEligible = trades3 >= FUTURES_EXIT_PROFILE_RECOVER_MIN_TRADES_3D;
  const killNow = killEligible && (pnl3 <= FUTURES_EXIT_PROFILE_ROLLBACK_PNL_MIN_3D || pf3 < FUTURES_EXIT_PROFILE_ROLLBACK_PF_MIN_3D);
  const recoverNow = recoverEligible && (pnl3 > FUTURES_EXIT_PROFILE_RECOVER_PNL_MIN_3D && pf3 >= FUTURES_EXIT_PROFILE_RECOVER_PF_MIN_3D);

  if (killNow) {
    rollbackUntilMs = nowMs + FUTURES_EXIT_PROFILE_ROLLBACK_COOLDOWN_MS;
    rollbackReason = "ROLLBACK_3D_TRIGGER";
  } else if (rollbackActive && recoverNow) {
    rollbackUntilMs = 0;
    rollbackReason = "ROLLBACK_RECOVERED";
  }

  const next = {
    rollbackUntilMs,
    lastRollbackAtMs: killNow ? nowMs : Number(prev.lastRollbackAtMs || 0),
    rollbackReason,
  };
  futuresExitProfileState.set(key, next);

  return {
    rollbackActive: nowMs < rollbackUntilMs,
    rollbackUntilMs,
    rollbackReason,
    killNow,
    recoverNow,
    real3,
  };
}

async function resolveAdaptiveFuturesExitProfile({
  exchange,
  symbol,
  tf,
  intent,
  event,
  side,
  features,
  nowMs,
  leverageDecision,
  manualProfileMode,
} = {}) {
  const base = buildExitProfileDecision(FUTURES_EXIT_PROFILE_BASE, "BASE_PROFILE");
  const forcedMode = resolveConfiguredFuturesExitProfileMode(manualProfileMode, null);
  if (forcedMode === "BASE") {
    return { ...base, reason: "MANUAL_BASE_PROFILE" };
  }
  if (forcedMode === "AGGRESSIVE") {
    return buildExitProfileDecision(FUTURES_EXIT_PROFILE_AGGRESSIVE, "MANUAL_AGGRESSIVE_PROFILE");
  }
  const featureProfileMode = resolveConfiguredFuturesExitProfileMode(
    features && (
      features.openclaw_executor_exit_profile_mode
      || features._openclaw_executor_exit_profile_mode
    ),
    null
  );
  const featureProfileReason = String(
    features && (
      features.openclaw_executor_exit_profile_reason
      || features._openclaw_executor_reason
    ) || ""
  ).trim() || null;
  if (featureProfileMode === "BASE") {
    return { ...base, reason: featureProfileReason || "OPENCLAW_EXECUTOR_BASE_PROFILE" };
  }
  if (featureProfileMode === "AGGRESSIVE") {
    return buildExitProfileDecision(
      FUTURES_EXIT_PROFILE_AGGRESSIVE,
      featureProfileReason || "OPENCLAW_EXECUTOR_AGGRESSIVE_PROFILE"
    );
  }
  if (!FUTURES_DYNAMIC_EXIT_PROFILE_ENABLED) {
    return { ...base, reason: "DYNAMIC_EXIT_PROFILE_DISABLED" };
  }
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ...base, reason: "NOT_BINANCE" };
  const intentUpper = String(intent || "").toUpperCase();
  if (intentUpper !== "ENTRY" && intentUpper !== "ADD") return { ...base, reason: "NON_ENTRY_INTENT" };

  const tier = resolveSignalTier(event, features);
  if (tier !== "CORE" && tier !== "REAL") return { ...base, reason: "NON_CORE_TIER_EVENT", tier };

  const regime = pickSignalRegime(features);
  if (regime !== "trend") return { ...base, reason: "REGIME_NOT_TREND", tier };

  const intentDir = directionFromSignal({ event, side });
  const confidenceRaw = pickSignalConfidence(features);
  const waveConfRaw = pickSignalWaveConf(features);
  const confidence = Number.isFinite(confidenceRaw) ? confidenceRaw : waveConfRaw;
  const posterior = pickSignalPosterior(features, intentDir);
  const confMin = tier === "CORE" ? FUTURES_EXIT_PROFILE_CORE_CONF_MIN : FUTURES_EXIT_PROFILE_REAL_CONF_MIN;
  const postMin = tier === "CORE" ? FUTURES_EXIT_PROFILE_CORE_POST_MIN : FUTURES_EXIT_PROFILE_REAL_POST_MIN;
  if (!Number.isFinite(confidence) || confidence < confMin) {
    return { ...base, reason: "CONFIDENCE_BELOW_THRESHOLD", tier, confidence, confMin };
  }
  if (!Number.isFinite(posterior) || posterior < postMin) {
    return { ...base, reason: "POSTERIOR_BELOW_THRESHOLD", tier, posterior, postMin };
  }

  const wantsAggressiveBy3x = !!(
    leverageDecision
    && Number(leverageDecision.leverage) >= 3
    && /_3X_ENABLED$/.test(String(leverageDecision.reason || ""))
  );

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let stats = leverageDecision && leverageDecision.stats ? leverageDecision.stats : null;
  let state = leverageDecision && leverageDecision.state ? leverageDecision.state : null;
  if (!stats || !state) {
    try {
      stats = await loadFutures3xStats({ exchange: ex, symbol, tf, nowMs: now });
      state = eval3xSymbolState({ symbol, stats, nowMs: now });
    } catch (e) {
      return { ...base, reason: "STATS_LOAD_FAILED", tier, error: e && e.message ? e.message : String(e) };
    }
  }
  if (!state || !state.canUse3x) {
    return { ...base, reason: "DYNAMIC_STATE_BLOCKED", tier, state };
  }
  if (tier === "CORE") {
    const core7 = stats && stats.core && stats.core.d7 ? stats.core.d7 : null;
    const core14 = stats && stats.core && stats.core.d14 ? stats.core.d14 : null;
    const coreOk = core7
      && core14
      && Number(core7.trades) >= 3
      && Number(core7.pnl) > 0
      && Number(core7.pf) >= 1.0
      && Number(core14.pnl) > 0;
    if (!coreOk) return { ...base, reason: "CORE_STATS_NOT_READY", tier, state, stats };
  }

  if (FUTURES_EXIT_PROFILE_ROLLBACK_ENABLED) {
    const rollback = evaluateExitProfileRollback({ symbol, stats, nowMs: now });
    if (rollback.killNow || rollback.rollbackActive) {
      const reason = rollback.killNow ? "EXIT_PROFILE_ROLLBACK_3D" : "EXIT_PROFILE_ROLLBACK_COOLDOWN";
      return { ...base, reason, tier, state, stats, rollback };
    }
  }

  const finalReason = wantsAggressiveBy3x ? "SYNC_WITH_3X" : `${tier}_EXIT_PROFILE_AGGRESSIVE`;
  return buildExitProfileDecision(FUTURES_EXIT_PROFILE_AGGRESSIVE, finalReason, {
    tier,
    confidence,
    posterior,
    state,
    stats,
  });
}

function normalizeFuturesMarginType(raw, fallback = "ISOLATED") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "CROSSED" || v === "ISOLATED") return v;
  return fallback;
}

function isBinanceMultiAssetsIsolatedMarginBlocked(err, marginType) {
  const type = normalizeFuturesMarginType(marginType, "");
  if (type !== "ISOLATED") return false;
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4168) return true;
  if (combined.includes("-4168")) return true;
  return /Unable to adjust to isolated-margin mode under the Multi-Assets mode/i.test(combined);
}

function isBinanceMarginTypeOpenOrdersConflict(err) {
  const code = Number(err && err.code);
  const body = String(err && err.body || "");
  const msg = String(err && err.message || err || "");
  const combined = `${msg} ${body}`;
  if (Number.isFinite(code) && code === -4067) return true;
  if (combined.includes("-4067")) return true;
  return /cannot be changed if there exists open orders/i.test(combined)
    || /open orders/i.test(combined);
}

function normalizeFuturesExitProfileMode(raw, fallback = "BASE") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "BASE" || v === "AGGRESSIVE") return v;
  return String(fallback || "BASE").trim().toUpperCase() || "BASE";
}

function resolveConfiguredFuturesExitProfileMode(raw, fallback = null) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback == null ? null : normalizeFuturesExitProfileMode(fallback, "BASE");
  return normalizeFuturesExitProfileMode(text, fallback == null ? "BASE" : fallback);
}

function resolvePositionExitProfile({ posMeta, fallbackMode } = {}) {
  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const rawFallbackProfile = String(fallbackMode || "").trim().toUpperCase();
  const forcedProfile = (rawFallbackProfile === "BASE" || rawFallbackProfile === "AGGRESSIVE")
    ? rawFallbackProfile
    : "";
  if (forcedProfile) {
    const presetForced = forcedProfile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE;
    return {
      profile: forcedProfile,
      reason: forcedProfile === "AGGRESSIVE" ? "MANUAL_AGGRESSIVE_PROFILE" : "MANUAL_BASE_PROFILE",
      rules: cloneExitRules(presetForced.rules),
      hasOverride: false,
    };
  }
  const hasOverride = !!(meta.exit_rules_override && typeof meta.exit_rules_override === "object");
  const rawMetaProfile = String(meta.exit_profile || "").trim().toUpperCase();
  const metaProfile = (rawMetaProfile === "BASE" || rawMetaProfile === "AGGRESSIVE") ? rawMetaProfile : "";
  const fallbackProfile = normalizeFuturesExitProfileMode(fallbackMode, "BASE");
  const profile = metaProfile || fallbackProfile || "BASE";
  const preset = profile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE;
  const reason = String(meta.exit_profile_reason || "").trim()
    || (profile === "AGGRESSIVE" ? "MANUAL_AGGRESSIVE_PROFILE" : "BASE_PROFILE");
  const rules = cloneExitRules(hasOverride ? meta.exit_rules_override : preset.rules);
  return {
    profile,
    reason,
    rules,
    hasOverride,
  };
}

function resolveSignalTierFromEvent(event, features) {
  const tier = resolveSignalTier(event, features);
  if (tier === "EMO") return 0;
  if (tier === "EARLY") return 1;
  if (tier === "CORE") return 2;
  if (tier === "PRE_REAL") return 3;
  if (tier === "REAL") return 4;
  return null;
}

const futuresLeverageCache = new Map();
const futuresMarginCache = new Map();
const futuresExchangeInfoCache = new Map();
const FUTURES_LEVERAGE_TTL_MS = 60 * 60 * 1000;
const FUTURES_MARGIN_TTL_MS = 60 * 60 * 1000;
const FUTURES_EXCHANGE_INFO_TTL_MS = Math.max(60 * 1000, Number(process.env.FUTURES_EXCHANGE_INFO_TTL_MS || (6 * 60 * 60 * 1000)));
const FUTURES_EXCHANGE_INFO_STALE_MAX_AGE_MS = Math.max(FUTURES_EXCHANGE_INFO_TTL_MS, Number(process.env.FUTURES_EXCHANGE_INFO_STALE_MAX_AGE_MS || (24 * 60 * 60 * 1000)));
const FUTURES_EXCHANGE_INFO_RETRY_COUNT = Math.max(0, Math.min(5, Math.floor(Number(process.env.FUTURES_EXCHANGE_INFO_RETRY_COUNT || 1))));
const FUTURES_EXCHANGE_INFO_RETRY_DELAY_MS = Math.max(0, Math.floor(Number(process.env.FUTURES_EXCHANGE_INFO_RETRY_DELAY_MS || 500)));
const FUTURES_LEVERAGE_RETRY_COUNT = Math.max(0, Math.min(5, Math.floor(Number(process.env.FUTURES_LEVERAGE_RETRY_COUNT || 2))));
const FUTURES_LEVERAGE_RETRY_DELAY_MS = Math.max(0, Math.floor(Number(process.env.FUTURES_LEVERAGE_RETRY_DELAY_MS || 400)));
const FUTURES_POSITION_TTL_MS = 10 * 1000;
const FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS = Number(process.env.FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS || 30 * 1000);
const futuresPositionCache = { at: 0, positions: null };
const FUTURES_POSITION_MODE_TTL_MS = 10 * 1000;
const futuresPositionModeCache = { at: 0, value: null, keyHint: null };
const FUTURES_FORCE_REFRESH_MS = Number(process.env.FUTURES_FORCE_REFRESH_MS || 5 * 60 * 1000);
const futuresForceRefresh = new Map();

async function resolveExecutionProfile({ symbol, bar, exchange } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = (sys && sys.data) ? sys.data : {};

  const baseFee = Number(cfg.fee_bps ?? process.env.FEE_BPS ?? 0);
  const baseSlip = Number(cfg.slippage_bps ?? process.env.SLIPPAGE_BPS ?? 0);

  let feeBps = pickMarketOverride(cfg.fee_bps_by_market, symbol, baseFee);
  let slippageBps = pickMarketOverride(cfg.slippage_bps_by_market, symbol, baseSlip);

  const model = String(cfg.slippage_model || "FIXED").toUpperCase();
  if (model === "VOLATILITY" && bar) {
    const high = Number(bar.high ?? bar.h);
    const low = Number(bar.low ?? bar.l);
    const close = Number(bar.close ?? bar.c);
    if (Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && close > 0) {
      const rangePct = Math.abs(high - low) / close;
      const rangeBps = rangePct * 10000;
      const factor = Number(cfg.slippage_volatility_factor ?? 0.1);
      if (Number.isFinite(rangeBps) && Number.isFinite(factor)) {
        slippageBps = Number(slippageBps || 0) + rangeBps * factor;
      }
    }
  }

  const minSlip = clamp(cfg.slippage_bps_min, 0, 10_000);
  const maxSlip = clamp(cfg.slippage_bps_max, 0, 10_000);
  if (Number.isFinite(minSlip)) slippageBps = Math.max(Number(slippageBps || 0), minSlip);
  if (Number.isFinite(maxSlip)) slippageBps = Math.min(Number(slippageBps || 0), maxSlip);

  return {
    feeBps: Number.isFinite(Number(feeBps)) ? Number(feeBps) : 0,
    slippageBps: Number.isFinite(Number(slippageBps)) ? Number(slippageBps) : 0,
    intentTtlMs: Number.isFinite(Number(cfg.intent_ttl_ms)) ? Number(cfg.intent_ttl_ms) : null,
    intentTtlBars: Number.isFinite(Number(cfg.intent_ttl_bars)) ? Number(cfg.intent_ttl_bars) : null,
  };
}

function shouldForceFuturesRefresh(symbol) {
  const key = String(symbol || "").toUpperCase();
  if (!key) return false;
  const exp = futuresForceRefresh.get(key);
  if (!Number.isFinite(exp)) return false;
  if (Date.now() >= exp) {
    futuresForceRefresh.delete(key);
    return false;
  }
  return true;
}

function allowByTradingMode(tradingMode, side) {
  if (tradingMode === "RUNNING") return true;
  if (tradingMode === "EXIT_ONLY") return side === "SELL";
  return false;
}

function normalizeSideValue(side) {
  const s = String(side || "").toUpperCase();
  if (s === "LONG") return "BUY";
  if (s === "SHORT") return "SELL";
  if (s === "BUY" || s === "SELL") return s;
  return "HOLD";
}

function normalizeActionValue(action) {
  const s = String(action || "").toUpperCase();
  if (!s) return null;
  if (s === "ENTRY" || s === "ADD" || s === "EXIT" || s === "DROP") return s;
  return s;
}

function actionAllowsEntry(action) {
  return action === "ENTRY" || action === "ADD";
}

function isManualRetryFeatures(features) {
  const f = (features && typeof features === "object") ? features : {};
  return normalizeBool(f._manual_retry_by_user, false) || normalizeBool(f.manual_retry_by_user, false);
}

function resolveManualRetryQtyBase(features) {
  const f = (features && typeof features === "object") ? features : {};
  const n = Number(f._manual_retry_qty_base ?? f.manual_retry_qty_base);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveLogicalAddCapState({
  posSizePct,
  position,
  posMeta,
  stagedAddCount = 0,
} = {}) {
  const baseQtyPctMeta = Number(posMeta && posMeta.add_chain_base_qty_pct);
  const currentQtyPctRaw = Number.isFinite(Number(posSizePct))
    ? Number(posSizePct)
    : Number(position && position.size_pct);
  const persistedAddCountRaw = Number(posMeta && posMeta.add_chain_count);
  const persistedAddCount = Number.isFinite(persistedAddCountRaw) ? Math.max(0, Math.trunc(persistedAddCountRaw)) : 0;
  const effectiveAddCount = persistedAddCount + (
    Number.isFinite(Number(stagedAddCount)) ? Math.max(0, Math.trunc(Number(stagedAddCount))) : 0
  );
  const currentQtyPct = (
    Number.isFinite(currentQtyPctRaw)
    && currentQtyPctRaw >= (1 - POS_SIZE_EPSILON)
    && Number.isFinite(baseQtyPctMeta)
    && baseQtyPctMeta > POS_SIZE_EPSILON
    && baseQtyPctMeta < (1 - POS_SIZE_EPSILON)
  )
    ? Math.min(1, baseQtyPctMeta * (1 + effectiveAddCount))
    : currentQtyPctRaw;
  const baseQtyPct = Number.isFinite(baseQtyPctMeta) && baseQtyPctMeta > POS_SIZE_EPSILON
    ? baseQtyPctMeta
    : (
      Number.isFinite(currentQtyPct)
        ? currentQtyPct
        : Number(position && position.size_pct)
    );
  return {
    baseQtyPct,
    currentQtyPct,
    currentQtyPctRaw,
    persistedAddCount,
    effectiveAddCount,
  };
}

function ensureLogicalAddCapState(state, {
  posSizePct,
  position,
} = {}) {
  if (state && typeof state === "object") return state;
  const fallbackQtyPctRaw = Number.isFinite(Number(posSizePct))
    ? Number(posSizePct)
    : Number(position && position.size_pct);
  const fallbackQtyPct = Number.isFinite(fallbackQtyPctRaw) ? fallbackQtyPctRaw : 0;
  return {
    baseQtyPct: fallbackQtyPct,
    currentQtyPct: fallbackQtyPct,
    currentQtyPctRaw: fallbackQtyPct,
    persistedAddCount: 0,
    effectiveAddCount: 0,
  };
}

function resolveCurrentQtyPctForCap(state, fallbackQtyPct = 0) {
  if (state && typeof state === "object") {
    const qtyPct = Number(state.currentQtyPct);
    if (Number.isFinite(qtyPct)) return qtyPct;
  }
  const fallback = Number(fallbackQtyPct);
  return Number.isFinite(fallback) ? fallback : 0;
}

function resolveLogicalCurrentQtyPctForBudget({
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  const max = Number(budgetMaxKrw);
  const used = Number(budgetUsedKrw);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(used) || used <= 0) return null;
  return clamp(used / max, 0, 1);
}

function resolveLiveExitCurrentQtyPct({
  exchange,
  position,
  fallbackQtyPct,
} = {}) {
  const ex = String(exchange || "").toUpperCase();
  const pos = position && typeof position === "object" ? position : {};
  if (ex.includes("BINANCE")) {
    const logicalQtyPct = resolveLogicalCurrentQtyPctForBudget({
      budgetMaxKrw: pos.budget_max_krw,
      budgetUsedKrw: pos.budget_used_krw,
    });
    if (Number.isFinite(logicalQtyPct) && logicalQtyPct > POS_SIZE_EPSILON) {
      return clamp(logicalQtyPct, POS_SIZE_EPSILON, 1);
    }
  }
  const fallback = Number(fallbackQtyPct);
  if (Number.isFinite(fallback) && fallback > POS_SIZE_EPSILON) {
    return clamp(fallback, POS_SIZE_EPSILON, 1);
  }
  return null;
}

function resolveIntentFillCloseRatio({
  qtyFraction,
  prevSize,
  useBudget,
} = {}) {
  const qty = Number(qtyFraction);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (useBudget === true) return Math.max(0, Math.min(1, qty));
  const current = Number(prevSize);
  if (Number.isFinite(current) && current > 0) {
    return Math.max(0, Math.min(1, qty / current));
  }
  return Math.max(0, Math.min(1, qty));
}

function resolveSyncedAddChainBaseQtyPct({
  active,
  posMeta,
  budgetMaxKrw,
  budgetUsedKrw,
} = {}) {
  if (!active) return null;
  const currentQtyPct = resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw, budgetUsedKrw });
  if (!Number.isFinite(currentQtyPct) || currentQtyPct <= POS_SIZE_EPSILON) return null;
  const addCountRaw = Number(posMeta && posMeta.add_chain_count);
  const addCount = Number.isFinite(addCountRaw) ? Math.max(0, Math.trunc(addCountRaw)) : 0;
  const baseQtyPct = currentQtyPct / (1 + addCount);
  if (!Number.isFinite(baseQtyPct) || baseQtyPct <= POS_SIZE_EPSILON) return null;
  return Math.min(1, baseQtyPct);
}

function normalizeSignalTypeList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((x) => String(x || "").toUpperCase()).filter(Boolean);
  if (typeof raw === "string") {
    return raw.split(/[,\s]+/).map((x) => String(x || "").toUpperCase()).filter(Boolean);
  }
  return [];
}

function normalizeTpP1EventForExchange(eventRaw, exchange) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("BINANCE") && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
  return ev;
}

function filterOutRealSignalTypes(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => {
    const v = String(x || "").toUpperCase();
    if (!v) return false;
    return v !== "REAL" && v !== "REAL_LONG" && v !== "REAL_SHORT";
  });
}

function resolveBinanceRealTradingEnabled(sysCfg) {
  const envRaw = process.env.BINANCE_REAL_TRADING_ENABLED;
  if (envRaw !== undefined) return normalizeBool(envRaw, false);
  return normalizeBool(sysCfg && sysCfg.binance_real_trading_enabled, false);
}

function resolveTradeableSignalTypes(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  const isBinanceFut = ex.includes("BINANCEFUT");
  const allowRealOnBinance = isBinanceFut ? resolveBinanceRealTradingEnabled(sysCfg) : true;
  const defaultBinanceListWithReal = [
    "LONG",
    "SHORT",
    "EMO_LONG",
    "EMO_SHORT",
    "TD9P_BUY",
    "TD9P_SELL",
  ];
  const defaultBinanceListWithoutReal = filterOutRealSignalTypes(defaultBinanceListWithReal);
  const raw = sysCfg && sysCfg.tradeable_signal_types;
  const list = normalizeSignalTypeList(raw);
  if (list.length) {
    if (isBinanceFut && !allowRealOnBinance) {
      const filtered = filterOutRealSignalTypes(list);
      return filtered.length ? filtered : defaultBinanceListWithoutReal;
    }
    return list;
  }
  if (isBinanceFut) {
    return allowRealOnBinance ? defaultBinanceListWithReal : defaultBinanceListWithoutReal;
  }
  return null;
}

function isCoreOrRealEvent(event) {
  const ev = String(event || "").toUpperCase();
  return isPrimaryLongShortEventName(ev) || ev.startsWith("CORE_") || isPreRealEventName(ev) || ev.startsWith("REAL_");
}

function resolveOppositeTransitionConfig(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCEFUT")) {
    return { enabled: false, reduceFraction: 1, confirmBars: 0, coreRealOnly: true };
  }
  const enabled = normalizeBool(
    sysCfg && sysCfg.opposite_transition_enabled,
    true
  );
  const reduceRaw = Number(sysCfg && sysCfg.opposite_transition_reduce_fraction);
  const reduceFraction = Number.isFinite(reduceRaw)
    ? Math.max(0.1, Math.min(1, reduceRaw))
    : 0.5;
  const confirmBarsRaw = normalizeInt(sysCfg && sysCfg.opposite_transition_confirm_bars, 2);
  const confirmBars = Math.max(1, Number.isFinite(confirmBarsRaw) ? confirmBarsRaw : 2);
  const coreRealOnly = normalizeBool(sysCfg && sysCfg.opposite_transition_core_real_only, true);
  return { enabled, reduceFraction, confirmBars, coreRealOnly };
}

function canonicalTradeableEvent(eventUpper, intentDir) {
  const ev = String(eventUpper || "").toUpperCase();
  const dir = String(intentDir || "").toUpperCase();
  if (!ev) return null;
  if (isPrimaryLongShortEventName(ev)) return ev;
  if (ev.startsWith("REAL_") || isPreRealEventName(ev) || ev.startsWith("CORE_") || ev.startsWith("EARLY_")) {
    return dir === "SHORT" ? "SHORT" : "LONG";
  }
  if (isEmoEventName(ev)) return dir === "SHORT" ? "EMO_SHORT" : "EMO_LONG";
  if (ev.startsWith("TD9P_")) return dir === "SHORT" ? "TD9P_SELL" : "TD9P_BUY";
  return ev;
}

function isTradeableEventAllowed({ eventUpper, intentDir, allowlist } = {}) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true;
  const ev = String(eventUpper || "").toUpperCase();
  const dir = String(intentDir || "").toUpperCase();
  if (!ev) return false;
  if (allowlist.includes(ev)) return true;
  const canonical = canonicalTradeableEvent(ev, intentDir);
  if (canonical && allowlist.includes(canonical)) return true;
  if (isPrimaryLongShortEventName(ev)) return allowlist.includes(ev);
  if (ev.startsWith("REAL_")) return allowlist.includes("REAL") || allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG");
  if (ev.startsWith("CORE_")) return allowlist.includes("CORE") || allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG");
  if (isPreRealEventName(ev)) {
    if (allowlist.includes("PRE_REAL")) return true;
    if (allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG")) return true;
    if (allowlist.includes(dir === "SHORT" ? "EARLY_SHORT" : "EARLY_LONG")) return true;
    return allowlist.includes("EARLY");
  }
  if (isEarlyEventName(ev)) {
    if (allowlist.includes(dir === "SHORT" ? "SHORT" : "LONG")) return true;
    return allowlist.includes("EARLY");
  }
  if (isEmoEventName(ev)) return allowlist.includes("EMO");
  if (ev.startsWith("TD9P_")) return allowlist.includes("TD9P");
  return false;
}

function resolveImmediateDefaultsForExchange(sysCfg, exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCEFUT")) return sysCfg;
  const out = { ...sysCfg };
  const coreMin = Number.isFinite(out.entry_immediate_core_conf_min) ? out.entry_immediate_core_conf_min : 0.65;
  const realMin = Number.isFinite(out.entry_immediate_real_conf_min) ? out.entry_immediate_real_conf_min : 0.7;
  const waveMin = Number.isFinite(out.entry_immediate_wave_conf_min) ? out.entry_immediate_wave_conf_min : 0.7;
  out.entry_immediate_core_conf_min = Math.max(0.65, coreMin);
  out.entry_immediate_real_conf_min = Math.max(0.7, realMin);
  out.entry_immediate_wave_conf_min = Math.max(0.7, waveMin);
  return out;
}

function computeUnrealizedPnlPct({ position, bar, positionSide }) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || avg === 0) return null;
  const side = normalizePositionSide(positionSide) || "LONG";
  return side === "SHORT" ? (avg - closePx) / avg : (closePx - avg) / avg;
}

function parseReplayRescueSet(raw, fallback = []) {
  const list = Array.isArray(raw)
    ? raw
    : String(raw || "").split(",");
  const normalized = list
    .map((x) => String(x || "").trim().toUpperCase())
    .filter(Boolean);
  if (normalized.length) return new Set(normalized);
  return new Set((fallback || []).map((x) => String(x || "").trim().toUpperCase()).filter(Boolean));
}

function resolveLiveRescueAddConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const enabledSource = process.env.RESCUE_ADD_ENABLED !== undefined
    ? process.env.RESCUE_ADD_ENABLED
    : sysCfg.rescue_add_enabled;
  const enabled = ex.includes("BINANCEFUT") && normalizeBool(enabledSource, false);
  if (!enabled) return { enabled: false };

  const addFractionRaw = normalizeNumber(
    process.env.RESCUE_ADD_SIZE !== undefined ? process.env.RESCUE_ADD_SIZE : sysCfg.rescue_add_size,
    1.0
  );
  const addFraction = Number.isFinite(addFractionRaw)
    ? clamp(addFractionRaw, 0, 2)
    : 1.0;
  const minLossPctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MIN_LOSS_PCT !== undefined ? process.env.RESCUE_ADD_MIN_LOSS_PCT : sysCfg.rescue_add_min_loss_pct,
    0.1
  );
  const maxLossPctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MAX_LOSS_PCT !== undefined ? process.env.RESCUE_ADD_MAX_LOSS_PCT : sysCfg.rescue_add_max_loss_pct,
    1.4
  );
  const minLossPct = Number.isFinite(minLossPctRaw) ? Math.max(0, minLossPctRaw) : 0.1;
  const maxLossPct = Number.isFinite(maxLossPctRaw) ? Math.max(minLossPct, maxLossPctRaw) : Math.max(minLossPct, 1.4);
  const minStopDistancePctRaw = normalizeNumber(
    process.env.RESCUE_ADD_MIN_STOP_DISTANCE_PCT !== undefined ? process.env.RESCUE_ADD_MIN_STOP_DISTANCE_PCT : sysCfg.rescue_add_min_stop_distance_pct,
    null
  );
  const minStopDistancePct = Number.isFinite(minStopDistancePctRaw) ? Math.max(0, minStopDistancePctRaw) : null;
  const maxAddsRaw = normalizeInt(
    process.env.RESCUE_ADD_MAX_ADDS !== undefined ? process.env.RESCUE_ADD_MAX_ADDS : sysCfg.rescue_add_max_adds,
    1
  );
  const maxAdds = Number.isFinite(maxAddsRaw) ? Math.max(0, maxAddsRaw) : 1;
  const allowedTiers = parseReplayRescueSet(
    process.env.RESCUE_ADD_TIERS !== undefined ? process.env.RESCUE_ADD_TIERS : sysCfg.rescue_add_tiers,
    ["EARLY", "CORE"]
  );
  const allowedSides = parseReplayRescueSet(
    process.env.RESCUE_ADD_SIDES !== undefined ? process.env.RESCUE_ADD_SIDES : sysCfg.rescue_add_sides,
    ["LONG", "SHORT"]
  );
  const preTp1Only = normalizeBool(
    process.env.RESCUE_ADD_PRE_TP1_ONLY !== undefined ? process.env.RESCUE_ADD_PRE_TP1_ONLY : sysCfg.rescue_add_pre_tp1_only,
    true
  );
  const sameBarBlock = normalizeBool(
    process.env.RESCUE_ADD_SAME_BAR_BLOCK !== undefined ? process.env.RESCUE_ADD_SAME_BAR_BLOCK : sysCfg.rescue_add_same_bar_block,
    true
  );
  const blockOppositeTransition = normalizeBool(
    process.env.RESCUE_ADD_BLOCK_OPPOSITE_TRANSITION !== undefined ? process.env.RESCUE_ADD_BLOCK_OPPOSITE_TRANSITION : sysCfg.rescue_add_block_opposite_transition,
    true
  );
  const scenarioKey = String(sysCfg.rescue_add_scenario || "").trim() || "LIVE_RESCUE_ADD";
  return {
    enabled: true,
    addFraction,
    minLossPct,
    maxLossPct,
    minStopDistancePct,
    maxAdds,
    allowedTiers,
    allowedSides,
    preTp1Only,
    sameBarBlock,
    blockOppositeTransition,
    scenarioKey,
  };
}

function resolveReplayRescueAddConfig(features) {
  const f = (features && typeof features === "object") ? features : {};
  const enabled = normalizeBool(f._replay_rescue_add_enabled, false);
  if (!enabled) return { enabled: false };

  const addFractionRaw = normalizeNumber(f._replay_rescue_add_size, null);
  const addFraction = Number.isFinite(addFractionRaw)
    ? clamp(addFractionRaw, 0, 2)
    : null;
  const minLossPctRaw = normalizeNumber(f._replay_rescue_add_min_loss_pct, 1.0);
  const maxLossPctRaw = normalizeNumber(f._replay_rescue_add_max_loss_pct, 1.2);
  const minLossPct = Number.isFinite(minLossPctRaw) ? Math.max(0, minLossPctRaw) : 1.0;
  const maxLossPct = Number.isFinite(maxLossPctRaw) ? Math.max(minLossPct, maxLossPctRaw) : Math.max(minLossPct, 1.2);
  const minStopDistancePctRaw = normalizeNumber(f._replay_rescue_add_min_stop_distance_pct, null);
  const minStopDistancePct = Number.isFinite(minStopDistancePctRaw) ? Math.max(0, minStopDistancePctRaw) : null;
  const maxAddsRaw = normalizeInt(f._replay_rescue_add_max_adds, 1);
  const maxAdds = Number.isFinite(maxAddsRaw) ? Math.max(0, maxAddsRaw) : 1;
  const allowRange = normalizeBool(f._replay_rescue_add_allow_range, false);
  const allowedTiers = parseReplayRescueSet(f._replay_rescue_add_tiers, ["EARLY", "CORE"]);
  const allowedSides = parseReplayRescueSet(f._replay_rescue_add_sides, ["LONG", "SHORT"]);
  const preTp1Only = normalizeBool(f._replay_rescue_add_pre_tp1_only, true);
  const sameBarBlock = normalizeBool(f._replay_rescue_add_same_bar_block, true);
  const blockOppositeTransition = normalizeBool(f._replay_rescue_add_block_opposite_transition, true);
  const scenarioKey = String(f._replay_rescue_add_scenario || "").trim() || null;

  return {
    enabled: true,
    addFraction,
    minLossPct,
    maxLossPct,
    minStopDistancePct,
    maxAdds,
    allowRange,
    allowedTiers,
    allowedSides,
    preTp1Only,
    sameBarBlock,
    blockOppositeTransition,
    scenarioKey,
  };
}

function resolveSameDirectionTrailProfitCooldownConfig(sysCfg = {}) {
  const enabled = normalizeBool(sysCfg.same_direction_trail_profit_cooldown_enabled, false);
  const cooldownMsRaw = normalizeInt(sysCfg.same_direction_trail_profit_cooldown_ms, 4 * 60 * 60 * 1000);
  const cooldownMs = Number.isFinite(cooldownMsRaw) ? Math.max(0, cooldownMsRaw) : (4 * 60 * 60 * 1000);
  return {
    enabled,
    cooldownMs,
  };
}

function buildSameDirectionTrailProfitCooldownMetaPatch({
  event,
  realizedPnlQuote,
  positionSide,
  exitWallMs,
  source = "INTENT_FILL",
} = {}) {
  const ev = String(event || "").trim().toUpperCase();
  const pnl = Number(realizedPnlQuote);
  const dir = normalizePositionSide(positionSide);
  const refMs = Number(exitWallMs);
  if (!ev.startsWith("EXIT_TRAIL")) return null;
  if (!Number.isFinite(pnl) || pnl <= 0) return null;
  if (!dir || !Number.isFinite(refMs) || refMs <= 0) return null;
  return {
    same_direction_trail_profit_exit_dir: dir,
    same_direction_trail_profit_exit_wall_ms: refMs,
    same_direction_trail_profit_exit_event: ev,
    same_direction_trail_profit_exit_realized_pnl: pnl,
    same_direction_trail_profit_exit_source: String(source || "INTENT_FILL").trim().slice(0, 80) || "INTENT_FILL",
  };
}

function buildSameDirectionTrailProfitObservationPayload(metaPatch = null) {
  const patch = (metaPatch && typeof metaPatch === "object") ? metaPatch : {};
  const exitDir = normalizePositionSide(patch.same_direction_trail_profit_exit_dir);
  const exitWallMs = Number(patch.same_direction_trail_profit_exit_wall_ms);
  const exitEvent = String(patch.same_direction_trail_profit_exit_event || "").trim().toUpperCase() || null;
  const realizedPnl = Number(patch.same_direction_trail_profit_exit_realized_pnl);
  const source = String(patch.same_direction_trail_profit_exit_source || "").trim().toUpperCase() || null;
  if (!exitDir || !Number.isFinite(exitWallMs) || exitWallMs <= 0 || !exitEvent) return null;
  return {
    exit_dir: exitDir,
    exit_wall_ms: exitWallMs,
    exit_event: exitEvent,
    realized_pnl: Number.isFinite(realizedPnl) ? realizedPnl : null,
    source,
  };
}

function buildSameDirectionTrailProfitLegacyResetMetaPatch() {
  return {
    same_direction_trail_profit_exit_dir: null,
    same_direction_trail_profit_exit_wall_ms: null,
    same_direction_trail_profit_exit_event: null,
    same_direction_trail_profit_exit_realized_pnl: null,
    same_direction_trail_profit_exit_source: null,
  };
}

function resolveSameDirectionTrailProfitCooldownBlock({
  cfg,
  posMeta,
  intentDir,
  eventRefMs,
} = {}) {
  const cooldownCfg = (cfg && typeof cfg === "object") ? cfg : {};
  if (cooldownCfg.enabled !== true) return null;
  const cooldownMs = Number(cooldownCfg.cooldownMs);
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) return null;
  const nextDir = normalizePositionSide(intentDir);
  const exitDir = normalizePositionSide(posMeta && posMeta.same_direction_trail_profit_exit_dir);
  const exitWallMs = Number(posMeta && posMeta.same_direction_trail_profit_exit_wall_ms);
  const refMs = Number(eventRefMs);
  if (!nextDir || !exitDir || nextDir !== exitDir) return null;
  if (!Number.isFinite(exitWallMs) || !Number.isFinite(refMs) || refMs < exitWallMs) return null;
  const elapsedMs = refMs - exitWallMs;
  if (elapsedMs < 0 || elapsedMs >= cooldownMs) return null;
  return {
    exit_dir: exitDir,
    exit_wall_ms: exitWallMs,
    exit_event: String(posMeta && posMeta.same_direction_trail_profit_exit_event || "").trim().toUpperCase() || null,
    realized_pnl: Number.isFinite(Number(posMeta && posMeta.same_direction_trail_profit_exit_realized_pnl))
      ? Number(posMeta.same_direction_trail_profit_exit_realized_pnl)
      : null,
    elapsed_ms: elapsedMs,
    cooldown_ms: cooldownMs,
    source: String(posMeta && posMeta.same_direction_trail_profit_exit_source || "").trim().toUpperCase() || null,
  };
}

function resolveSameDirectionTrailProfitCooldownSnapshot({
  posMeta = null,
  observation = null,
  observationOnly = false,
} = {}) {
  const metaSafe = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const observed = (observation && typeof observation === "object" && observation.same_direction_trail_profit && typeof observation.same_direction_trail_profit === "object")
    ? observation.same_direction_trail_profit
    : {};
  if (observationOnly === true) {
    if (!Number.isFinite(Number(observed.exit_wall_ms))) return {};
    return {
      same_direction_trail_profit_exit_dir: observed.exit_dir || null,
      same_direction_trail_profit_exit_wall_ms: Number(observed.exit_wall_ms),
      same_direction_trail_profit_exit_event: observed.exit_event || null,
      same_direction_trail_profit_exit_realized_pnl: Number.isFinite(Number(observed.realized_pnl))
        ? Number(observed.realized_pnl)
        : null,
      same_direction_trail_profit_exit_source: observed.source || null,
    };
  }
  const metaExitWallMs = Number(metaSafe.same_direction_trail_profit_exit_wall_ms);
  const obsExitWallMs = Number(observed.exit_wall_ms);
  const useObserved = Number.isFinite(obsExitWallMs)
    && (!Number.isFinite(metaExitWallMs) || obsExitWallMs > metaExitWallMs);
  if (!useObserved) return metaSafe;
  return {
    ...metaSafe,
    same_direction_trail_profit_exit_dir: observed.exit_dir || null,
    same_direction_trail_profit_exit_wall_ms: obsExitWallMs,
    same_direction_trail_profit_exit_event: observed.exit_event || null,
    same_direction_trail_profit_exit_realized_pnl: Number.isFinite(Number(observed.realized_pnl))
      ? Number(observed.realized_pnl)
      : null,
    same_direction_trail_profit_exit_source: observed.source || null,
  };
}

async function loadSameDirectionTrailProfitObservationSafe({
  enabled = false,
  exchange,
  symbol,
} = {}) {
  if (enabled !== true) return null;
  try {
    return await getPositionRuntimeObservation({ exchange, symbol });
  } catch (e) {
    console.warn("[SAME_DIRECTION_TRAIL_PROFIT_OBSERVATION_LOAD_FAIL]", {
      exchange,
      symbol,
      error: e && e.message ? e.message : String(e),
    });
    return null;
  }
}

function resolveFuturesPositionSyncRequest({
  source = null,
  runId,
  exchange,
  symbol,
  force = false,
} = {}) {
  const src = String(source || "").trim().toUpperCase();
  let dedupeWindowMs = 0;
  if (src === "MARKET_RUNNER") dedupeWindowMs = 15000;
  else if (src === "SELF_HEAL_PRECHECK") dedupeWindowMs = 5000;
  else if (src === "FILL_SYNC_RECONCILE") dedupeWindowMs = 5000;
  return {
    runId,
    exchange,
    symbol,
    force: force === true,
    dedupeWindowMs,
  };
}

async function loadPositionRuntimeObservationSafe({
  enabled = false,
  exchange,
  symbol,
} = {}) {
  if (enabled !== true) return null;
  try {
    return await getPositionRuntimeObservation({ exchange, symbol });
  } catch (e) {
    console.warn("[POSITION_RUNTIME_OBSERVATION_LOAD_FAIL]", {
      exchange,
      symbol,
      error: e && e.message ? e.message : String(e),
    });
    return null;
  }
}

function applyTrailObservationSnapshotToMeta({
  meta = null,
  observation = null,
  positionSide = null,
  entryLineage = null,
  allowDuringEntryTransition = false,
} = {}) {
  const baseMeta = (meta && typeof meta === "object") ? meta : {};
  if (allowDuringEntryTransition !== true) return baseMeta;
  const observed = (observation && typeof observation === "object" && observation.trail_observation && typeof observation.trail_observation === "object")
    ? observation.trail_observation
    : null;
  if (!observed) return baseMeta;
  const observedSide = normalizePositionSide(observed.side);
  const currentSide = normalizePositionSide(positionSide);
  if (observedSide && currentSide && observedSide !== currentSide) return baseMeta;
  const lineage = normalizeEntryLineage(entryLineage || baseMeta);
  const observedEntryId = String(observed.entry_event_id || "").trim() || null;
  const currentEntryId = String(lineage.entry_event_id || "").trim() || null;
  const observedEntryExecMs = Number(observed.entry_exec_bar_ms);
  const currentEntryExecMs = Number(lineage.entry_exec_bar_ms);
  if (observedEntryId && currentEntryId && observedEntryId !== currentEntryId) return baseMeta;
  if (Number.isFinite(observedEntryExecMs) && Number.isFinite(currentEntryExecMs) && observedEntryExecMs !== currentEntryExecMs) return baseMeta;
  const snapshot = resolveTrailObservationSnapshot({ meta: baseMeta, observation });
  return mergeMeta(baseMeta, {
    trail_high: snapshot.trail_high,
    trail_high_at_ms: snapshot.trail_high_at_ms,
    trail_low: snapshot.trail_low,
    trail_low_at_ms: snapshot.trail_low_at_ms,
  });
}

function computeReplayStopDistancePct({ position, bar, positionSide, rules } = {}) {
  const pos = position || {};
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  const side = normalizePositionSide(positionSide);
  const slPct = Number(rules && rules.SL);
  if (!Number.isFinite(avg) || !Number.isFinite(closePx) || closePx <= 0) return null;
  if (!side || !Number.isFinite(slPct)) return null;
  const stopPx = side === "SHORT"
    ? (avg * (1 - slPct))
    : (avg * (1 + slPct));
  if (!Number.isFinite(stopPx)) return null;
  return side === "SHORT"
    ? (((stopPx - closePx) / closePx) * 100)
    : (((closePx - stopPx) / closePx) * 100);
}

function resolveEventRefMs(...candidates) {
  for (const candidate of candidates) {
    const ms = Number(candidate);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return Date.now();
}

function shouldBypassOppositeEntryCooldown({ features, intentDir, posMeta } = {}) {
  const featureMap = (features && typeof features === "object") ? features : {};
  const allowOppositeAfterExit = normalizeBool(featureMap._allow_opposite_after_exit, false);
  const flipConfirmed = normalizeBool(featureMap._flip_confirmed, false)
    || Number(featureMap._flip_stage) >= 2
    || String(featureMap.opposite_transition || "").toUpperCase() === "CONFIRM_EXIT";
  const lastExitDir = String(posMeta && posMeta.last_exit_dir || "").toUpperCase();
  const nextDir = String(intentDir || "").toUpperCase();
  return allowOppositeAfterExit === true
    && flipConfirmed === true
    && !!lastExitDir
    && !!nextDir
    && lastExitDir !== nextDir;
}

function shouldBlockSignalOverlap({
  pos = null,
  lastBarMs = NaN,
  effectiveBarMs = NaN,
  signalTfMs = NaN,
  signalOverlapBars = 0,
  allowOverlapUpgrade = false,
} = {}) {
  const positionState = String(pos && (pos.position_state || pos.state) || "").toUpperCase();
  if (positionState === "FLAT") return false;
  if (!Number.isFinite(lastBarMs)) return false;
  const barsSince = Math.round((effectiveBarMs - lastBarMs) / signalTfMs);
  return Number.isFinite(barsSince)
    && barsSince >= 0
    && barsSince <= signalOverlapBars
    && !allowOverlapUpgrade;
}

function evaluateLiveRescueAdd({
  cfg,
  event,
  features,
  position,
  posMeta,
  posSide,
  posSizePct,
  bar,
  signalBarCloseMs,
  useBudget,
  pendingAddCount = 0,
  pendingAddSignalBarMs = null,
} = {}) {
  const resolvedCfg = (cfg && typeof cfg === "object" && cfg.enabled === true) ? cfg : { enabled: false };
  if (resolvedCfg.enabled !== true) return { enabled: false, ok: true };

  const tier = resolveEntryQualityTier(event, features);
  if (!tier || !resolvedCfg.allowedTiers.has(tier)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_TIER_BLOCKED",
      detail: { tier: tier || null, allowed_tiers: Array.from(resolvedCfg.allowedTiers) },
    };
  }

  const side = normalizePositionSide(
    posSide ||
    (position && (position.position_side || position.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  if (!side || !resolvedCfg.allowedSides.has(side)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_SIDE_BLOCKED",
      detail: { side: side || null, allowed_sides: Array.from(resolvedCfg.allowedSides) },
    };
  }

  if (resolvedCfg.preTp1Only && posMeta && (posMeta.tp_p1_done === true || posMeta.trail_active === true || posMeta.tp_p1_pending === true)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_POST_TP1_BLOCKED",
      detail: {
        tp_p1_done: posMeta.tp_p1_done === true,
        trail_active: posMeta.trail_active === true,
        tp_p1_pending: posMeta.tp_p1_pending === true,
      },
    };
  }

  const stagedAddCount = Number.isFinite(Number(pendingAddCount)) ? Math.max(0, Math.trunc(Number(pendingAddCount))) : 0;
  const addCapState = ensureLogicalAddCapState(resolveLogicalAddCapState({
    posSizePct,
    position,
    posMeta,
    stagedAddCount,
  }), { posSizePct, position });
  const safeAddCapState = (addCapState && typeof addCapState === "object")
    ? addCapState
    : ensureLogicalAddCapState(null, { posSizePct, position });
  const baseQtyPct = Number.isFinite(Number(safeAddCapState.baseQtyPct))
    ? Number(safeAddCapState.baseQtyPct)
    : null;
  const currentQtyPct = Number.isFinite(Number(safeAddCapState.currentQtyPct))
    ? Number(safeAddCapState.currentQtyPct)
    : 0;
  const addCount = addCapState.persistedAddCount;
  const effectiveAddCount = addCapState.effectiveAddCount;
  if (effectiveAddCount >= resolvedCfg.maxAdds) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_LIMIT_BLOCKED",
      detail: { add_count: effectiveAddCount, persisted_add_count: addCount, max_adds: resolvedCfg.maxAdds },
    };
  }

  const signalMs = Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : null;
  if (resolvedCfg.sameBarBlock && Number.isFinite(signalMs)) {
    const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
    const lastAddSignalMs = Number(posMeta && (posMeta.add_chain_last_signal_bar_ms ?? posMeta.add_chain_last_ms));
    const stagedSignalMs = Number.isFinite(Number(pendingAddSignalBarMs)) ? Number(pendingAddSignalBarMs) : null;
    const sameBarEntry = Number.isFinite(entryExecMs) && signalMs === entryExecMs;
    const sameBarPersistedAdd = Number.isFinite(lastAddSignalMs) && signalMs === lastAddSignalMs;
    const sameBarPendingAdd = Number.isFinite(stagedSignalMs) && signalMs === stagedSignalMs;
    if (sameBarEntry || sameBarPersistedAdd || sameBarPendingAdd) {
      return {
        enabled: true,
        ok: false,
        reason: "LIVE_RESCUE_ADD_SAME_BAR_BLOCKED",
        detail: {
          signal_bar_ms: signalMs,
          entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
          last_add_signal_bar_ms: Number.isFinite(lastAddSignalMs) ? lastAddSignalMs : null,
          pending_add_signal_bar_ms: Number.isFinite(stagedSignalMs) ? stagedSignalMs : null,
        },
      };
    }
  }

  if (resolvedCfg.blockOppositeTransition) {
    const transitionDir = String(posMeta && posMeta.opposite_transition_dir || "").toUpperCase();
    const transitionUntilMs = Number(posMeta && posMeta.opposite_transition_until_ms);
    const transitionActive = !!transitionDir
      && (!Number.isFinite(signalMs) || !Number.isFinite(transitionUntilMs) || signalMs <= transitionUntilMs);
    if (transitionActive) {
      return {
        enabled: true,
        ok: false,
        reason: "LIVE_RESCUE_ADD_OPPOSITE_TRANSITION_BLOCKED",
        detail: {
          opposite_transition_dir: transitionDir,
          opposite_transition_until_ms: Number.isFinite(transitionUntilMs) ? transitionUntilMs : null,
        },
      };
    }
  }

  if (!Number.isFinite(resolvedCfg.addFraction) || resolvedCfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_DISABLED",
      detail: {
        scenario: resolvedCfg.scenarioKey,
        add_fraction: Number.isFinite(resolvedCfg.addFraction) ? resolvedCfg.addFraction : null,
      },
    };
  }

  const leverageEff = resolvePositionLeverage({ position, fallback: 1 });
  const rawUpnlFrac = computeUnrealizedPnlPct({ position, bar, positionSide: side });
  const upnlFrac = Number.isFinite(rawUpnlFrac)
    ? (rawUpnlFrac * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  const lossPct = Number.isFinite(upnlFrac) ? Math.max(0, -upnlFrac * 100) : null;
  if (!Number.isFinite(lossPct) || lossPct < resolvedCfg.minLossPct || lossPct > resolvedCfg.maxLossPct) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
      detail: {
        upnl_pct: Number.isFinite(upnlFrac) ? Number((upnlFrac * 100).toFixed(4)) : null,
        loss_pct: Number.isFinite(lossPct) ? Number(lossPct.toFixed(4)) : null,
        min_loss_pct: resolvedCfg.minLossPct,
        max_loss_pct: resolvedCfg.maxLossPct,
      },
    };
  }

  const exitProfile = resolvePositionExitProfile({ posMeta, fallbackMode: null });
  const stopDistancePct = computeReplayStopDistancePct({
    position,
    bar,
    positionSide: side,
    rules: exitProfile && exitProfile.rules,
  });
  if (Number.isFinite(resolvedCfg.minStopDistancePct) && (!Number.isFinite(stopDistancePct) || stopDistancePct < resolvedCfg.minStopDistancePct)) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_STOP_GAP_BLOCKED",
      detail: {
        stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
        min_stop_distance_pct: resolvedCfg.minStopDistancePct,
      },
    };
  }

  const requestedAddQtyPct = Number.isFinite(baseQtyPct) ? (baseQtyPct * resolvedCfg.addFraction) : null;
  const remainingCapQtyPct = useBudget ? Math.max(0, 1 - (Number.isFinite(currentQtyPct) ? currentQtyPct : 0)) : null;
  let addQtyPct = requestedAddQtyPct;
  if (useBudget && Number.isFinite(remainingCapQtyPct)) {
    addQtyPct = Math.min(requestedAddQtyPct, remainingCapQtyPct);
  }
  const autoShrunk = Number.isFinite(requestedAddQtyPct)
    && Number.isFinite(addQtyPct)
    && addQtyPct + POS_SIZE_EPSILON < requestedAddQtyPct;
  if (!Number.isFinite(addQtyPct) || addQtyPct <= POS_SIZE_EPSILON) {
    return {
      enabled: true,
      ok: false,
      reason: "LIVE_RESCUE_ADD_POSITION_FULL",
      detail: {
        base_qty_pct: Number.isFinite(baseQtyPct) ? Number(baseQtyPct.toFixed(6)) : null,
        requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? Number(requestedAddQtyPct.toFixed(6)) : null,
        remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? Number(remainingCapQtyPct.toFixed(6)) : null,
      },
    };
  }

  return {
    enabled: true,
    ok: true,
    addQtyPct,
    detail: {
      scenario: resolvedCfg.scenarioKey,
      tier,
      side,
      add_fraction: resolvedCfg.addFraction,
      base_qty_pct: Number.isFinite(baseQtyPct) ? Number(baseQtyPct.toFixed(6)) : null,
      current_qty_pct_effective: Number.isFinite(currentQtyPct) ? Number(currentQtyPct.toFixed(6)) : null,
      requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? Number(requestedAddQtyPct.toFixed(6)) : null,
      add_qty_pct: Number(addQtyPct.toFixed(6)),
      remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? Number(remainingCapQtyPct.toFixed(6)) : null,
      auto_shrunk: autoShrunk,
      loss_pct: Number(lossPct.toFixed(4)),
      upnl_pct: Number((upnlFrac * 100).toFixed(4)),
      stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
      add_count: effectiveAddCount,
      max_adds: resolvedCfg.maxAdds,
      signal_bar_ms: signalMs,
    },
  };
}

function evaluateReplayRescueAdd({
  event,
  features,
  position,
  posMeta,
  posSide,
  posSizePct,
  bar,
  signalBarCloseMs,
  pendingAddCount = 0,
  pendingAddSignalBarMs = null,
} = {}) {
  const cfg = resolveReplayRescueAddConfig(features);
  if (cfg.enabled !== true) return { enabled: false, ok: true };

  const tier = resolveEntryQualityTier(event, features);
  if (!tier || !cfg.allowedTiers.has(tier)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_TIER_BLOCKED",
      detail: { tier: tier || null, allowed_tiers: Array.from(cfg.allowedTiers) },
    };
  }

  const side = normalizePositionSide(
    posSide ||
    (position && (position.position_side || position.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  if (!side || !cfg.allowedSides.has(side)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_SIDE_BLOCKED",
      detail: { side: side || null, allowed_sides: Array.from(cfg.allowedSides) },
    };
  }

  if (cfg.preTp1Only && posMeta && (posMeta.tp_p1_done === true || posMeta.trail_active === true || posMeta.tp_p1_pending === true)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_POST_TP1_BLOCKED",
      detail: {
        tp_p1_done: posMeta.tp_p1_done === true,
        trail_active: posMeta.trail_active === true,
        tp_p1_pending: posMeta.tp_p1_pending === true,
      },
    };
  }

  const stagedAddCount = Number.isFinite(Number(pendingAddCount)) ? Math.max(0, Math.trunc(Number(pendingAddCount))) : 0;
  const addCapState = ensureLogicalAddCapState(resolveLogicalAddCapState({
    posSizePct,
    position,
    posMeta,
    stagedAddCount,
  }), { posSizePct, position });
  const safeAddCapState = (addCapState && typeof addCapState === "object")
    ? addCapState
    : ensureLogicalAddCapState(null, { posSizePct, position });
  const currentQtyPct = Number.isFinite(Number(safeAddCapState.currentQtyPct))
    ? Number(safeAddCapState.currentQtyPct)
    : 0;
  const baseQtyPct = Number.isFinite(Number(safeAddCapState.baseQtyPct))
    ? Number(safeAddCapState.baseQtyPct)
    : null;
  const addCount = addCapState.persistedAddCount;
  const effectiveAddCount = addCapState.effectiveAddCount;
  if (effectiveAddCount >= cfg.maxAdds) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_LIMIT_BLOCKED",
      detail: { add_count: effectiveAddCount, persisted_add_count: addCount, max_adds: cfg.maxAdds },
    };
  }

  if (!Number.isFinite(cfg.addFraction) || cfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_DISABLED",
      detail: {
        scenario: cfg.scenarioKey,
        add_fraction: Number.isFinite(cfg.addFraction) ? cfg.addFraction : null,
      },
    };
  }

  const regime = pickSignalRegime(features);
  if (!cfg.allowRange && regime === "range") {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_RANGE_BLOCKED",
      detail: { regime },
    };
  }

  const signalMs = Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : null;
  if (cfg.sameBarBlock && Number.isFinite(signalMs)) {
    const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
    const lastAddSignalMs = Number(posMeta && (posMeta.add_chain_last_signal_bar_ms ?? posMeta.add_chain_last_ms));
    const stagedSignalMs = Number.isFinite(Number(pendingAddSignalBarMs)) ? Number(pendingAddSignalBarMs) : null;
    const sameBarEntry = Number.isFinite(entryExecMs) && signalMs === entryExecMs;
    const sameBarPersistedAdd = Number.isFinite(lastAddSignalMs) && signalMs === lastAddSignalMs;
    const sameBarPendingAdd = Number.isFinite(stagedSignalMs) && signalMs === stagedSignalMs;
    if (sameBarEntry || sameBarPersistedAdd || sameBarPendingAdd) {
      return {
        enabled: true,
        ok: false,
        reason: "REPLAY_RESCUE_ADD_SAME_BAR_BLOCKED",
        detail: {
          signal_bar_ms: signalMs,
          entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
          last_add_signal_bar_ms: Number.isFinite(lastAddSignalMs) ? lastAddSignalMs : null,
          pending_add_signal_bar_ms: Number.isFinite(stagedSignalMs) ? stagedSignalMs : null,
        },
      };
    }
  }

  if (cfg.blockOppositeTransition) {
    const transitionDir = String(posMeta && posMeta.opposite_transition_dir || "").toUpperCase();
    const transitionUntilMs = Number(posMeta && posMeta.opposite_transition_until_ms);
    const transitionActive = !!transitionDir
      && (!Number.isFinite(signalMs) || !Number.isFinite(transitionUntilMs) || signalMs <= transitionUntilMs);
    if (transitionActive) {
      return {
        enabled: true,
        ok: false,
        reason: "REPLAY_RESCUE_ADD_OPPOSITE_TRANSITION_BLOCKED",
        detail: {
          opposite_transition_dir: transitionDir,
          opposite_transition_until_ms: Number.isFinite(transitionUntilMs) ? transitionUntilMs : null,
        },
      };
    }
  }

  const leverageEff = resolvePositionLeverage({ position, fallback: 1 });
  const rawUpnlFrac = computeUnrealizedPnlPct({ position, bar, positionSide: side });
  const upnlFrac = Number.isFinite(rawUpnlFrac)
    ? (rawUpnlFrac * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  const lossPct = Number.isFinite(upnlFrac) ? Math.max(0, -upnlFrac * 100) : null;
  if (!Number.isFinite(lossPct) || lossPct < cfg.minLossPct || lossPct > cfg.maxLossPct) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_LOSS_WINDOW_BLOCKED",
      detail: {
        upnl_pct: Number.isFinite(upnlFrac) ? Number((upnlFrac * 100).toFixed(4)) : null,
        loss_pct: Number.isFinite(lossPct) ? Number(lossPct.toFixed(4)) : null,
        min_loss_pct: cfg.minLossPct,
        max_loss_pct: cfg.maxLossPct,
      },
    };
  }

  const exitProfile = resolvePositionExitProfile({ posMeta, fallbackMode: null });
  const stopDistancePct = computeReplayStopDistancePct({
    position,
    bar,
    positionSide: side,
    rules: exitProfile && exitProfile.rules,
  });
  if (Number.isFinite(cfg.minStopDistancePct) && (!Number.isFinite(stopDistancePct) || stopDistancePct < cfg.minStopDistancePct)) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_STOP_GAP_BLOCKED",
      detail: {
        stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
        min_stop_distance_pct: cfg.minStopDistancePct,
      },
    };
  }

  const requestedAddQtyPct = Number.isFinite(baseQtyPct) ? (baseQtyPct * cfg.addFraction) : null;
  const remainingCapQtyPct = Math.max(0, 1 - (Number.isFinite(currentQtyPct) ? currentQtyPct : 0));
  const addQtyPct = Number.isFinite(requestedAddQtyPct)
    ? Math.min(requestedAddQtyPct, remainingCapQtyPct)
    : null;
  if (!Number.isFinite(addQtyPct) || addQtyPct <= POS_SIZE_EPSILON || !Number.isFinite(cfg.addFraction) || cfg.addFraction <= 0) {
    return {
      enabled: true,
      ok: false,
      reason: "REPLAY_RESCUE_ADD_QTY_INVALID",
      detail: {
        base_qty_pct: Number.isFinite(baseQtyPct) ? baseQtyPct : null,
        requested_add_qty_pct: Number.isFinite(requestedAddQtyPct) ? requestedAddQtyPct : null,
        remaining_cap_qty_pct: Number.isFinite(remainingCapQtyPct) ? remainingCapQtyPct : null,
        add_fraction: Number.isFinite(cfg.addFraction) ? cfg.addFraction : null,
      },
    };
  }

  return {
    enabled: true,
    ok: true,
    addQtyPct,
    detail: {
      scenario: cfg.scenarioKey,
      tier,
      side,
      add_fraction: cfg.addFraction,
      base_qty_pct: Number(baseQtyPct.toFixed(6)),
      requested_add_qty_pct: Number(requestedAddQtyPct.toFixed(6)),
      add_qty_pct: Number(addQtyPct.toFixed(6)),
      remaining_cap_qty_pct: Number(remainingCapQtyPct.toFixed(6)),
      auto_shrunk: requestedAddQtyPct > addQtyPct + POS_SIZE_EPSILON,
      loss_pct: Number(lossPct.toFixed(4)),
      upnl_pct: Number((upnlFrac * 100).toFixed(4)),
      stop_distance_pct: Number.isFinite(stopDistancePct) ? Number(stopDistancePct.toFixed(4)) : null,
      regime: regime || null,
      add_count: effectiveAddCount,
      persisted_add_count: addCount,
      max_adds: cfg.maxAdds,
      signal_bar_ms: signalMs,
    },
  };
}

function inferEntryMetaDirection(posMeta) {
  const signalType = String(posMeta && posMeta.entry_signal_type || "").toUpperCase();
  if (signalType.includes("SHORT") || signalType.includes("SELL")) return "SHORT";
  if (signalType.includes("LONG") || signalType.includes("BUY")) return "LONG";

  const entryEventId = String(posMeta && posMeta.entry_event_id || "").toUpperCase();
  if (entryEventId.includes("SHORT") || entryEventId.includes("SELL")) return "SHORT";
  if (entryEventId.includes("LONG") || entryEventId.includes("BUY")) return "LONG";
  return null;
}

function buildTimeStopExitSignal({ position, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars }) {
  if (!Number.isFinite(signalTfMs) || signalTfMs <= 0) return null;
  if (!Number.isFinite(maxHoldBars) || maxHoldBars <= 0) return null;
  const pos = position || {};
  const state = String(pos.state || "").toUpperCase();
  const size = Number(pos.size_pct || 0);
  if (state !== "ACTIVE" || !Number.isFinite(size) || size <= 0) return null;
  const entryMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  if (!Number.isFinite(entryMs) || entryMs <= 0) return null;
  const positionSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const entryMetaDir = inferEntryMetaDirection(posMeta);
  if (entryMetaDir && entryMetaDir !== positionSide) return null;
  const rules = resolveExitRulesForPosition({
    exchange: pos.exchange || "BINANCEFUT",
    position: { ...pos, meta: posMeta || {} },
  });
  const preTp1Done = posMeta && posMeta.tp_p1_done === true;
  const rawEntryGrade = String(posMeta && (posMeta.entry_grade || posMeta.entry_timing_tier || posMeta.entry_tier) || "").trim().toUpperCase();
  const entryGrade = rawEntryGrade === "CORE" ? "CORE" : "EARLY";
  const preTp1MaxHoldBars = Number(
    entryGrade === "CORE"
      ? rules && rules.PRE_TP1_TIME_STOP_BARS_CORE
      : rules && rules.PRE_TP1_TIME_STOP_BARS_EARLY
  );
  const progressFraction = Number(rules && rules.PRE_TP1_TIME_STOP_PROGRESS_FRACTION);
  const leverageEff = resolvePositionLeverage({ position: pos, fallback: 1 });
  const requiredHoldBars = (preTp1Done !== true && Number.isFinite(preTp1MaxHoldBars) && preTp1MaxHoldBars > 0)
    ? preTp1MaxHoldBars
    : maxHoldBars;
  const barsHeld = Math.floor((Number(barCloseMs) - entryMs) / signalTfMs);
  if (!Number.isFinite(barsHeld) || barsHeld < requiredHoldBars) return null;
  const pnlPctRaw = computeUnrealizedPnlPct({ position: pos, bar, positionSide });
  if (!Number.isFinite(pnlPctRaw)) return null;
  const pnlPct = pnlPctRaw * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1);
  const preTp1TimeStopActive = preTp1Done !== true
    && Number.isFinite(preTp1MaxHoldBars)
    && preTp1MaxHoldBars > 0
    && barsHeld >= preTp1MaxHoldBars;
  if (!preTp1TimeStopActive && pnlPct > 0) return null;
  let preTp1ProgressRequired = null;
  if (preTp1TimeStopActive) {
    const tp1Pct = Number(rules && rules.TP_P1);
    preTp1ProgressRequired = Number.isFinite(tp1Pct) && tp1Pct > 0 && Number.isFinite(progressFraction) && progressFraction > 0
      ? tp1Pct * progressFraction
      : null;
    if (Number.isFinite(preTp1ProgressRequired) && pnlPct >= preTp1ProgressRequired) return null;
  } else if (pnlPct > 0) {
    return null;
  }
  const exitSide = positionSide === "SHORT" ? "BUY" : "SELL";
  return {
    event: `EXIT_TIME_STOP_${requiredHoldBars}B`,
    side: exitSide,
    qty_pct: size,
    reason: preTp1TimeStopActive ? "EXIT_TIME_STOP_PRE_TP1" : "EXIT_TIME_STOP",
    features: {
      bars_held: barsHeld,
      max_hold_bars: requiredHoldBars,
      pnl_pct: pnlPct,
      pnl_pct_raw: pnlPctRaw,
      avg_px: Number(pos.avg_price),
      ref_px: Number(bar && (bar.close ?? bar.c ?? bar.closePrice)),
      position_side: positionSide,
      time_stop_scope: preTp1TimeStopActive ? "PRE_TP1" : "STANDARD",
      pre_tp1_time_stop: preTp1TimeStopActive,
      pre_tp1_time_stop_entry_grade: preTp1TimeStopActive ? entryGrade : null,
      pre_tp1_time_stop_max_hold_bars: preTp1TimeStopActive ? preTp1MaxHoldBars : null,
      pre_tp1_progress_fraction_required: preTp1TimeStopActive && Number.isFinite(progressFraction) ? progressFraction : null,
      pre_tp1_progress_pct_required: preTp1TimeStopActive && Number.isFinite(preTp1ProgressRequired) ? preTp1ProgressRequired : null,
      pre_tp1_progress_pct_actual: preTp1TimeStopActive ? pnlPct : null,
      openclaw_market_regime_cohort: normalizeOpenClawCohort(posMeta && posMeta.openclaw_market_regime_cohort),
    },
  };
}

function canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs }) {
  const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  const currentBarMs = Number(barCloseMs);
  if (!Number.isFinite(entryExecMs) || entryExecMs <= 0) return true;
  if (!Number.isFinite(currentBarMs)) return true;
  return currentBarMs > entryExecMs;
}

function finalizeInternalSignals({ signals, posMeta, barCloseMs, fallbackUtc, exchange, symbol }) {
  const list = Array.isArray(signals) ? signals : [];
  const currentBarMs = Number(barCloseMs);
  const currentBarUtc = Number.isFinite(currentBarMs) ? msToUtcZ(currentBarMs) : (fallbackUtc || null);
  return list.reduce((acc, s) => {
    const intent = intentFromSignal({ event: s && s.event, side: s && s.side, features: s && s.features });
    if (intent === "EXIT" && !canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs: currentBarMs })) {
      console.warn("[INTERNAL_EXIT_STALE_BAR_SKIP]", {
        exchange,
        symbol,
        event: s && s.event,
        bar_close_ms: Number.isFinite(currentBarMs) ? currentBarMs : null,
        entry_exec_bar_ms: Number(posMeta && posMeta.entry_exec_bar_ms) || null,
      });
      return acc;
    }
    acc.push({
      ...s,
      signal_bar_close_time_utc_ms: Number.isFinite(currentBarMs) ? currentBarMs : null,
      signal_bar_close_time_utc: currentBarUtc,
    });
    return acc;
  }, []);
}

async function loadServerNativeInitialSignals({ exchange, symbol, signalTf, barCloseMs } = {}) {
  if (!symbol || !signalTf || !Number.isFinite(Number(barCloseMs))) return [];
  try {
    let [bars, htfBars] = await Promise.all([
      queryBars({ exchange, symbol, tf: signalTf, limit: 220 }),
      queryBars({ exchange, symbol, tf: SERVER_NATIVE_HTF_TF, limit: 120 }),
    ]);
    if (!Array.isArray(htfBars) || !htfBars.length) {
      const requiredBaseBars = minBaseBarsForDerivedHtf({ sourceTf: signalTf });
      if (requiredBaseBars > 220) {
        const expandedBars = await queryBars({ exchange, symbol, tf: signalTf, limit: requiredBaseBars });
        if (Array.isArray(expandedBars) && expandedBars.length > bars.length) bars = expandedBars;
      }
    }
    return buildServerNativeInitialSignals({
      exchange,
      symbol,
      tf: signalTf,
      bars,
      htfBars,
      barCloseMs: Number(barCloseMs),
    });
  } catch (e) {
    console.warn("[SERVER_NATIVE_INITIAL_SIGNAL_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      bar_close_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      error: e && e.message ? e.message : String(e),
    });
    return [];
  }
}

function isExternalEntrySignalCandidate(signal = {}) {
  if (!signal || typeof signal !== "object") return false;
  if (String(signal.signal_id || "").trim()) return true;
  if (String(signal.signal_doc_id || "").trim()) return true;
  const features = signal.features && typeof signal.features === "object" ? signal.features : {};
  if (String(features.signal_id || "").trim()) return true;
  if (String(features.signal_doc_id || "").trim()) return true;
  const source = String(signal.source || features.source || signal.reason || "").trim().toUpperCase();
  return source === "TV_WEBHOOK" || source === "PINE_SHADOW";
}

function compareEntrySignalPriority(a = {}, b = {}) {
  const aExternal = isExternalEntrySignalCandidate(a);
  const bExternal = isExternalEntrySignalCandidate(b);
  if (aExternal !== bExternal) return aExternal ? 1 : -1;
  const aQty = Number(a && a.qty_pct);
  const bQty = Number(b && b.qty_pct);
  const aHasQty = Number.isFinite(aQty) && aQty > 0;
  const bHasQty = Number.isFinite(bQty) && bQty > 0;
  if (aHasQty !== bHasQty) return aHasQty ? 1 : -1;
  return 0;
}

function buildEntrySignalResolutionDetail({
  family,
  selected,
  suppressed,
} = {}) {
  const selectedFeatures = selected && typeof selected.features === "object" ? selected.features : {};
  const suppressedFeatures = suppressed && typeof suppressed.features === "object" ? suppressed.features : {};
  return {
    family: String(family || ""),
    selected_signal_id: String(selected && (selected.signal_id || selected.signal_doc_id || selectedFeatures.signal_id || selectedFeatures.signal_doc_id) || "").trim() || null,
    suppressed_signal_id: String(suppressed && (suppressed.signal_id || suppressed.signal_doc_id || suppressedFeatures.signal_id || suppressedFeatures.signal_doc_id) || "").trim() || null,
    selected_event: selected && selected.event ? String(selected.event) : null,
    suppressed_event: suppressed && suppressed.event ? String(suppressed.event) : null,
    selected_side: selected && selected.side ? String(selected.side) : null,
    suppressed_side: suppressed && suppressed.side ? String(suppressed.side) : null,
    selected_qty_pct: Number.isFinite(Number(selected && selected.qty_pct)) ? Number(selected.qty_pct) : null,
    suppressed_qty_pct: Number.isFinite(Number(suppressed && suppressed.qty_pct)) ? Number(suppressed.qty_pct) : null,
    selected_reason: String(
      selectedFeatures._openclaw_executor_reason
      || selected && selected.reason
      || selectedFeatures.reason
      || ""
    ).trim() || null,
    suppressed_reason: String(
      suppressedFeatures._openclaw_executor_reason
      || suppressed && suppressed.reason
      || suppressedFeatures.reason
      || ""
    ).trim() || null,
    selected_external: isExternalEntrySignalCandidate(selected),
    suppressed_external: isExternalEntrySignalCandidate(suppressed),
  };
}

function resolveEntrySignalsByFamily(signals = []) {
  const rows = Array.isArray(signals) ? signals : [];
  const familySlots = new Map();
  const passthrough = [];
  const resolutions = [];

  rows.forEach((s, index) => {
    const intent = intentFromSignal({ event: s && s.event, side: s && s.side, features: s && s.features });
    if (intent !== "ENTRY" && intent !== "ADD") {
      passthrough.push({ index, signal: s });
      return;
    }

    const dir = directionFromSignal({ event: s && s.event, side: s && s.side });
    const tier = resolveEntryQualityTier(String(s && s.event || "").toUpperCase(), s && s.features);
    const family = `${intent}__${dir || "NA"}__${tier || "NA"}`;
    const existing = familySlots.get(family);
    if (!existing) {
      familySlots.set(family, { index, orderIndex: index, signal: s });
      return;
    }

    if (compareEntrySignalPriority(s, existing.signal) > 0) {
      resolutions.push(buildEntrySignalResolutionDetail({
        family,
        selected: s,
        suppressed: existing.signal,
      }));
      familySlots.set(family, {
        index,
        orderIndex: existing.orderIndex,
        signal: s,
      });
      return;
    }

    resolutions.push(buildEntrySignalResolutionDetail({
      family,
      selected: existing.signal,
      suppressed: s,
    }));
  });

  const signalsOut = [
    ...passthrough,
    ...Array.from(familySlots.values()).map((row) => ({
      index: row.orderIndex,
      signal: row.signal,
    })),
  ]
    .sort((a, b) => a.index - b.index)
    .map((row) => row.signal);

  return {
    signals: signalsOut,
    resolutions,
  };
}

function logEntrySignalFamilyResolutions(resolutions = [], context = {}) {
  const rows = Array.isArray(resolutions) ? resolutions : [];
  rows.forEach((row) => {
    console.log(JSON.stringify({
      event: "entry_signal_family_resolution",
      exchange: context.exchange || null,
      symbol: context.symbol || null,
      tf: context.tf || null,
      run_id: context.runId || null,
      stage: context.stage || null,
      ...row,
    }));
  });
}

function dedupeEntrySignalsByFamily(signals = [], context = null) {
  const resolved = resolveEntrySignalsByFamily(signals);
  if (context && resolved.resolutions.length) {
    logEntrySignalFamilyResolutions(resolved.resolutions, context);
  }
  return resolved.signals;
}

// 2026-04-28 Stage Y (root-cause fix) — historically this function dropped
// every internal EXIT_TRAIL signal under BINANCEFUT LIVE on the assumption
// that the exchange-side native protection (cancel→place STOP_MARKET with
// closePosition=true) was the canonical trail-close path. That assumption
// silently broke today: TP1 hit on BNBUSDT/BTCUSDT/ETHUSDT/XRPUSDT at
// ~16:00 UTC, the runner-floor trail signal fired, and this guard
// suppressed all four. Native trail-stop refresh meanwhile hit
// EGRESS_PROXY_TIMEOUT and never updated the stop trigger to the new trail
// price — so the trail close never executed and four positions sat
// runner-stale until external SL or manual cleanup eventually closed them.
//
// Root cause: internal trail signal was the only path that could have
// closed the runner correctly, but it was unconditionally suppressed.
//
// Fix: stop suppressing internal trail signals. Both paths (internal
// reduce-only market via paper engine + native closePosition STOP) can
// race safely:
//   - Whichever fires first reduces the position to zero.
//   - Binance dedups the loser: closePosition=true with empty position
//     becomes EXPIRED; reduce-only with qty>position becomes a no-op.
// Idempotency on our side is provided by the existing client_order_id /
// idempotencyKey conventions in placeFuturesStopMarketOrder /
// placeFuturesTakeProfitMarketOrder etc.
//
// Kill switch retained for emergency rollback to the legacy suppress
// behaviour: LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS=1 (default 0 = let
// internal trail signals through).
function shouldSuppressLiveFuturesInternalExitSignal({
  exchange,
  liveCfg,
  signal,
} = {}) {
  // Inline kill-switch parse — paperBinanceRunner doesn't expose
  // parseBoolEnv at this scope.
  const suppressFlag = String(process.env.LIVE_TRAIL_INTERNAL_SIGNAL_SUPPRESS || "0").trim().toLowerCase();
  const suppressEnabled = suppressFlag === "1" || suppressFlag === "true" || suppressFlag === "yes" || suppressFlag === "on";
  if (!suppressEnabled) return false;
  const exUpper = String(exchange || "").toUpperCase();
  if (!exUpper.includes("BINANCEFUT")) return false;
  const mode = String(liveCfg && liveCfg.executionMode || "").toUpperCase();
  if (mode !== "LIVE" && mode !== "LIVE_DRY_RUN") return false;
  if (!signal || typeof signal !== "object") return false;
  if (signal.signal_id) return false;
  const eventUpper = String(signal.event || "").toUpperCase();
  if (eventUpper !== "EXIT_TRAIL") return false;
  const reasonUpper = String(signal.reason || "").toUpperCase();
  if (reasonUpper !== "EXIT_TRAIL_STOP" && reasonUpper !== "EXIT_TRAIL_STOP_RUNNER_FLOOR") return false;
  return true;
}

function shouldSuppressInternalLiveExitFillAlert({
  exchange,
  executionMode,
  intent,
} = {}) {
  const exUpper = String(exchange || "").toUpperCase();
  if (!exUpper.includes("BINANCEFUT")) return false;
  const mode = String(executionMode || "").toUpperCase();
  if (mode !== "LIVE" && mode !== "LIVE_DRY_RUN") return false;
  return String(intent || "").toUpperCase() === "EXIT";
}

function filterLiveFuturesInternalSignals({
  exchange,
  liveCfg,
  signals,
  runId,
  symbol,
  tf,
} = {}) {
  if (!Array.isArray(signals) || !signals.length) return [];
  return signals.filter((signal) => {
    const suppress = shouldSuppressLiveFuturesInternalExitSignal({ exchange, liveCfg, signal });
    if (suppress) {
      console.log(
        `[live_trail_authority_skip] ex=${exchange} sym=${symbol} tf=${tf} ev=${signal && signal.event} reason=${signal && signal.reason} run=${runId || "-"}`
      );
    }
    return !suppress;
  });
}

function hasPositionSize(sizePct) {
  const n = Number(sizePct);
  if (!Number.isFinite(n)) return false;
  return n > POS_SIZE_EPSILON;
}

function mergeMeta(base, patch) {
  const out = (base && typeof base === "object") ? { ...base } : {};
  if (patch && typeof patch === "object") {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      out[k] = v;
    }
  }
  return out;
}

function trimTextOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildSyntheticV2ExitEvidenceId({ kind, exchange, symbol, entryEventId, observedAtMs }) {
  const resolvedKind = String(kind || "EXIT").trim().toUpperCase() || "EXIT";
  const resolvedExchange = String(exchange || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const resolvedSymbol = String(symbol || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const resolvedEntry = String(entryEventId || "NO_ENTRY_EVENT").trim() || "NO_ENTRY_EVENT";
  const resolvedAt = Number.isFinite(Number(observedAtMs)) ? Number(observedAtMs) : Date.now();
  return `${resolvedKind}__${resolvedExchange}__${resolvedSymbol}__${resolvedEntry}__${resolvedAt}`;
}

const FLAT_SYNC_PRESERVE_FOR_RECONCILE_FIELDS = Object.freeze([
  "canonical_exit_stage",
  "canonical_exit_chain_key",
  "canonical_primary_transition_event",
  "trail_active",
  "trail_high",
  "trail_high_at_ms",
  "trail_low",
  "trail_low_at_ms",
  "trail_stop_by_r",
  "trail_stop_by_pct",
  "runner_remaining_qty_abs",
  "tp_p1_done",
  "tp_p1_at",
  "tp_p1_bar_ms",
  "tp_p1_price",
  "tp_p1_source",
  "tp_p1_entry_event_id",
  "tp_p1_entry_exec_bar_ms",
  "tp_p1_recovery_trigger",
  "tp_p1_recovery_observed_at",
  "tp_p1_recovery_seeded_price",
  "entry_event_id",
  "entry_exec_bar_ms",
  "entry_qty_abs",
  "entry_qty_base",
  "position_side",
  "native_protection_stop_order_id",
  "native_protection_stop_price",
  "native_protection_tp_order_id",
  "native_protection_tp_price",
  "native_protection_tp_qty_base",
]);

function buildFlatSyncReconcileInputMeta({ prevMeta, clearedMeta } = {}) {
  const previous = prevMeta && typeof prevMeta === "object" ? prevMeta : {};
  const next = clearedMeta && typeof clearedMeta === "object" ? { ...clearedMeta } : {};
  for (const field of FLAT_SYNC_PRESERVE_FOR_RECONCILE_FIELDS) {
    if (previous[field] !== undefined && previous[field] !== null && previous[field] !== "") {
      next[field] = previous[field];
    }
  }
  return next;
}

function resolveV2FlatSyncExitReplayPlan({
  exchange,
  symbol,
  prevMeta,
  meta,
  prevSide,
  prevQtyBase,
  qtyBase,
  fillPrice,
  observedAtMs,
} = {}) {
  const previous = prevMeta && typeof prevMeta === "object" ? prevMeta : {};
  const current = meta && typeof meta === "object" ? meta : {};
  const entryEventId = trimTextOrNull(previous.entry_event_id || current.entry_event_id || previous.origin_entry_event_id);
  const positionSide = normalizePositionSide(
    previous.position_side || current.position_side || previous.external_side || current.external_side || prevSide,
  );
  if (!entryEventId || !positionSide) {
    return { ok: false, reason: "V2_FLAT_SYNC_ENTRY_CONTEXT_MISSING" };
  }

  const observedMs = Number.isFinite(Number(observedAtMs)) ? Number(observedAtMs) : Date.now();
  const priorQty = numOrNull(prevQtyBase);
  const afterQty = numOrNull(qtyBase);
  const tpQty = numOrNull(previous.native_protection_tp_qty_base)
    || numOrNull(current.native_protection_tp_qty_base);
  const tpOrderId = trimTextOrNull(previous.native_protection_tp_order_id || current.native_protection_tp_order_id);
  const stopOrderId = trimTextOrNull(previous.native_protection_stop_order_id || current.native_protection_stop_order_id);
  const stopPrice = numOrNull(previous.native_protection_stop_price)
    || numOrNull(current.native_protection_stop_price)
    || numOrNull(previous.trail_stop_by_r)
    || numOrNull(previous.trail_stop_by_pct)
    || numOrNull(fillPrice);
  const resolvedFillPrice = numOrNull(fillPrice)
    || numOrNull(previous.native_protection_stop_price)
    || numOrNull(previous.tp_p1_recovery_seeded_price);
  const tp1Recovered = previous.tp_p1_done === true
    || current.tp_p1_done === true
    || !!trimTextOrNull(previous.tp_p1_recovery_trigger || current.tp_p1_recovery_trigger);
  const trailWasActive = previous.trail_active === true
    || current.frozen_trail_active === true
    || current.trail_active === true
    || String(previous.canonical_exit_stage || current.frozen_canonical_exit_stage || "").toUpperCase() === "TRAIL";
  const stopWasArmed = !!stopOrderId;
  const tp1FillQtyAbs = Number.isFinite(tpQty) && tpQty > 0
    ? tpQty
    : (Number.isFinite(priorQty) && Number.isFinite(afterQty)
      ? Math.max(0, Number((priorQty - afterQty).toFixed(8)))
      : null);

  return {
    ok: true,
    reason: "V2_FLAT_SYNC_REPLAY_READY",
    exchange: String(exchange || "BINANCEFUT").toUpperCase(),
    symbol: String(symbol || "").toUpperCase(),
    entryEventId,
    positionSide,
    observedAtMs: observedMs,
    tp1: tp1Recovered && tpOrderId && Number.isFinite(tp1FillQtyAbs) && tp1FillQtyAbs > 0
      ? {
        sourceFillId: buildSyntheticV2ExitEvidenceId({ kind: "TP1RECOVERY", exchange, symbol, entryEventId, observedAtMs: observedMs }),
        sourceOrderId: tpOrderId,
        fillQtyAbs: tp1FillQtyAbs,
        fillPrice: numOrNull(previous.tp_p1_recovery_seeded_price) || numOrNull(previous.native_protection_tp_price) || resolvedFillPrice,
      }
      : null,
    trailActivation: trailWasActive && stopOrderId && Number.isFinite(stopPrice) && stopPrice > 0
      ? {
        sourceOrderId: stopOrderId,
        nextStopPrice: stopPrice,
        nativeStopPrice: stopPrice,
      }
      : null,
    terminal: trailWasActive && stopOrderId && Number.isFinite(resolvedFillPrice) && resolvedFillPrice > 0
      ? {
        type: "TRAIL",
        sourceFillId: buildSyntheticV2ExitEvidenceId({ kind: "TRAILFLATSYNC", exchange, symbol, entryEventId, observedAtMs: observedMs }),
        sourceOrderId: stopOrderId,
        fillPrice: resolvedFillPrice,
      }
      : (stopWasArmed && Number.isFinite(resolvedFillPrice) && resolvedFillPrice > 0
        ? {
          type: "STOP",
          sourceFillId: buildSyntheticV2ExitEvidenceId({ kind: "SLFLATSYNC", exchange, symbol, entryEventId, observedAtMs: observedMs }),
          sourceOrderId: stopOrderId,
          fillPrice: resolvedFillPrice,
        }
        : null)
      || {
        type: "EXTERNAL",
        sourceFillId: buildSyntheticV2ExitEvidenceId({ kind: "EXTERNALFLATSYNC", exchange, symbol, entryEventId, observedAtMs: observedMs }),
        sourceOrderId: stopOrderId || buildSyntheticV2ExitEvidenceId({ kind: "EXTERNALORDER", exchange, symbol, entryEventId, observedAtMs: observedMs }),
      },
  };
}

async function replayV2FlatSyncExitArtifacts({
  exchange,
  symbol,
  plan,
  fillPrice,
  observedAtMs,
} = {}) {
  if (!plan || plan.ok !== true) return { ok: true, skipped: true, reason: plan && plan.reason || "V2_FLAT_SYNC_REPLAY_NOT_READY" };
  const results = [];
  const common = {
    exchange: plan.exchange || exchange,
    symbol: plan.symbol || symbol,
    entryEventId: plan.entryEventId,
    positionSide: plan.positionSide,
    observedAtMs: plan.observedAtMs || observedAtMs,
    exchangeEvidence: {
      event: "BINANCE_POSITION_FLAT_SYNC",
      execution_type: "TRADE",
      full_exit: true,
      position_qty_after: 0,
      position_closed: true,
    },
  };
  if (plan.tp1) {
    results.push(await writeOpenClawShadowTp1Transition({
      ...common,
      sourceFillId: plan.tp1.sourceFillId,
      sourceOrderId: plan.tp1.sourceOrderId,
      fillQtyAbs: plan.tp1.fillQtyAbs,
      fillPrice: plan.tp1.fillPrice,
    }));
  }
  if (plan.trailActivation) {
    results.push(await writeOpenClawShadowTrailActivation({
      ...common,
      sourceOrderId: plan.trailActivation.sourceOrderId,
      nextStopPrice: plan.trailActivation.nextStopPrice,
      nativeStopPrice: plan.trailActivation.nativeStopPrice,
      nativeRefreshStatus: "OK",
      exchangeEvidence: {
        ...common.exchangeEvidence,
        event: "TRAIL_ACTIVATION_RECOVERED_FROM_FLAT_SYNC",
        stop_price: plan.trailActivation.nativeStopPrice,
      },
    }));
  }
  if (plan.terminal && plan.terminal.type === "TRAIL") {
    results.push(await writeOpenClawShadowStopExit({
      ...common,
      sourceFillId: plan.terminal.sourceFillId,
      sourceOrderId: plan.terminal.sourceOrderId,
      fillPrice: plan.terminal.fillPrice || fillPrice,
      event: "EXIT_TRAIL",
      fullExit: true,
      exchangeEvidence: {
        ...common.exchangeEvidence,
        event: "EXIT_TRAIL",
        event_type: "EXIT_TRAIL",
        order_type: "STOP_MARKET",
        stop_price: plan.trailActivation && plan.trailActivation.nativeStopPrice || plan.terminal.fillPrice,
      },
    }));
  } else if (plan.terminal && plan.terminal.type === "STOP") {
    results.push(await writeOpenClawShadowStopExit({
      ...common,
      sourceFillId: plan.terminal.sourceFillId,
      sourceOrderId: plan.terminal.sourceOrderId,
      fillPrice: plan.terminal.fillPrice || fillPrice,
      event: "EXIT_SL",
      fullExit: true,
      exchangeEvidence: {
        ...common.exchangeEvidence,
        event: "EXIT_SL",
        event_type: "EXIT_SL",
        order_type: "STOP_MARKET",
        stop_price: plan.terminal.fillPrice || fillPrice,
      },
    }));
  } else if (plan.terminal) {
    results.push(await writeOpenClawShadowExternalClose({
      ...common,
      sourceFillId: plan.terminal.sourceFillId,
      sourceOrderId: plan.terminal.sourceOrderId,
      event: "EXIT_EXTERNAL_SYNC",
      closeKind: "EXTERNAL",
      fullExit: true,
      exchangeEvidence: common.exchangeEvidence,
    }));
  }
  return {
    ok: results.every((row) => row && row.ok !== false),
    reason: "V2_FLAT_SYNC_REPLAY_ATTEMPTED",
    results,
  };
}

function metaValueEquals(a, b) {
  if (Object.is(a, b)) return true;
  const aObj = !!a && typeof a === "object";
  const bObj = !!b && typeof b === "object";
  if (!aObj && !bObj) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (_) {
    return false;
  }
}

function buildMetaPatch(base, next) {
  const prev = (base && typeof base === "object") ? base : {};
  const target = (next && typeof next === "object") ? next : {};
  const patch = {};
  for (const [key, value] of Object.entries(target)) {
    if (value === undefined) continue;
    if (metaValueEquals(value, prev[key])) continue;
    patch[key] = value;
  }
  return patch;
}

const EXCHANGE_OWNED_PROJECTION_META_KEYS = new Set([
  "tp_p0_done",
  "tp_p0_price",
  "tp_p0_at",
  "tp_p0_source",
  "tp_p0_qty_ratio",
  "tp_p0_entry_event_id",
  "tp_p0_entry_exec_bar_ms",
  "tp_p1_done",
  "tp_p1_price",
  "tp_p1_target_price",
  "tp_p1_at",
  "tp_p1_source",
  "tp_p1_entry_event_id",
  "tp_p1_entry_exec_bar_ms",
  "trail_active",
  "trail_high",
  "trail_low",
  "native_protection_refresh_status",
  "native_protection_refresh_reason",
  "native_protection_refresh_context",
  "native_protection_refresh_at_ms",
  "native_protection_refresh_bar_ms",
  "native_protection_stale",
  "native_protection_attempts",
  "native_protection_max_attempts",
  "native_protection_stop_order_id",
  "native_protection_tp0_order_id",
  "native_protection_tp_order_id",
  "native_protection_stop_price",
  "native_protection_tp0_price",
  "native_protection_tp_price",
  "native_protection_tp0_qty_base",
  "native_protection_tp_qty_base",
  "native_protection_tp0_qty_ratio",
  "native_protection_tp_qty_ratio",
  "native_protection_tp0_status",
  "native_protection_tp_status",
  "native_protection_tp0_reason",
  "native_protection_tp_reason",
  "native_protection_entry_price",
  "native_protection_side",
  "exchange_projection_source",
  "exchange_projection_in_sync",
  "exchange_projection_invariants",
  "exchange_projection_checked_at",
]);

function stripExchangeOwnedProjectionMeta(meta = null) {
  const next = (meta && typeof meta === "object") ? { ...meta } : {};
  for (const key of EXCHANGE_OWNED_PROJECTION_META_KEYS) delete next[key];
  return next;
}

function sanitizeBarLoopMetaUpdates(meta = null) {
  const src = (meta && typeof meta === "object") ? meta : {};
  const next = {};
  const allowedKeys = new Set([
    "tp_p1_pending",
    "tp_p1_pending_at_ms",
    "tp_p1_pending_until_ms",
    "tp_p1_pending_event",
    "opposite_transition_dir",
    "opposite_transition_event",
    "opposite_transition_until_ms",
    "opposite_transition_stage",
    "opposite_transition_seen_ms",
  ]);
  const allowedPrefixes = [
    "core_probe_",
    "last_entry_bar_ms_",
    "last_entry_tier_",
  ];
  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) continue;
    if (allowedKeys.has(key) || allowedPrefixes.some((prefix) => key.startsWith(prefix))) {
      next[key] = value;
    }
  }
  return next;
}

async function upsertPositionMetaOnlyWithLatestRetry({
  exchange,
  symbol,
  runId = null,
  executionMode = null,
  position = null,
  metaPatch = null,
  source = null,
  mutationKind = "POSITION_META_UPSERT",
  reason = null,
  maxAttempts = 8,
  retryDelayMs = 250,
  readPosition = getPosition,
  writePositionMeta = upsertPositionMetaOnly,
} = {}) {
  if (!metaPatch || typeof metaPatch !== "object" || !Object.keys(metaPatch).length) {
    return position;
  }
  let currentPos = (position && typeof position === "object")
    ? position
    : await readPosition({ exchange, symbol });
  const totalAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 0));
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const currentMeta = (currentPos && currentPos.meta && typeof currentPos.meta === "object")
      ? currentPos.meta
      : {};
    const mergedMeta = stripExchangeOwnedProjectionMeta(mergeMeta(currentMeta, metaPatch));
    try {
      return await writePositionMeta({
        exchange,
        symbol,
        runId,
        executionMode,
        meta: mergedMeta,
        source,
        mutationKind,
        reason: attempt > 1 ? (reason || "RETRY_AFTER_POSITION_REFRESH") : reason,
        expectedWriteToken: Object.prototype.hasOwnProperty.call(currentPos || {}, "position_write_token")
          ? (currentPos.position_write_token ?? null)
          : null,
        suppressAuthorityAlert: attempt < totalAttempts,
        suppressAuthorityRuntimeFamily: attempt < totalAttempts,
        suppressAuthorityRuntimeFamilyReason: "WRITER_RETRY_IN_PROGRESS",
      });
    } catch (err) {
      const code = String(err && err.code || "").trim().toUpperCase();
      if (!["POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
        throw err;
      }
      if (attempt >= totalAttempts) throw err;
      const baseDelayMs = Math.max(0, Number(retryDelayMs) || 0);
      const retryDelayResolvedMs = code === "POSITION_WRITE_TOKEN_MISMATCH"
        ? baseDelayMs
        : Math.min(1500, baseDelayMs * attempt);
      if (retryDelayResolvedMs > 0) await sleep(retryDelayResolvedMs);
      currentPos = await readPosition({ exchange, symbol });
    }
  }
  return currentPos;
}

async function upsertPositionWithLatestRetry({
  exchange,
  symbol,
  runId = null,
  executionMode = null,
  position = null,
  state,
  positionSide,
  sizePct,
  avgPrice,
  qtyBase = null,
  budgetMaxKrw = null,
  budgetUsedKrw = null,
  budgetSource = null,
  meta = {},
  source = null,
  mutationKind = "POSITION_UPSERT",
  reason = null,
  maxAttempts = 8,
  retryDelayMs = 250,
  readPosition = getPosition,
  writePosition = upsertPosition,
} = {}) {
  let currentPos = (position && typeof position === "object")
    ? position
    : await readPosition({ exchange, symbol });
  const totalAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 0));
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    try {
      return await writePosition({
        exchange,
        symbol,
        state,
        positionSide,
        sizePct,
        avgPrice,
        qtyBase,
        runId,
        executionMode,
        budgetMaxKrw,
        budgetUsedKrw,
        budgetSource,
        meta,
        source,
        mutationKind,
        reason: attempt > 1 ? (reason || "RETRY_AFTER_POSITION_REFRESH") : reason,
        expectedWriteToken: Object.prototype.hasOwnProperty.call(currentPos || {}, "position_write_token")
          ? (currentPos.position_write_token ?? null)
          : null,
        suppressAuthorityAlert: attempt < totalAttempts,
        suppressAuthorityRuntimeFamily: attempt < totalAttempts,
        suppressAuthorityRuntimeFamilyReason: "WRITER_RETRY_IN_PROGRESS",
      });
    } catch (err) {
      const code = String(err && err.code || "").trim().toUpperCase();
      if (!["POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
        throw err;
      }
      if (attempt >= totalAttempts) throw err;
      const baseDelayMs = Math.max(0, Number(retryDelayMs) || 0);
      const retryDelayResolvedMs = code === "POSITION_WRITE_TOKEN_MISMATCH"
        ? baseDelayMs
        : Math.min(1500, baseDelayMs * attempt);
      if (retryDelayResolvedMs > 0) await sleep(retryDelayResolvedMs);
      currentPos = await readPosition({ exchange, symbol });
    }
  }
  return currentPos;
}

async function applyBarLoopObservationMetaUpdate({
  exchange,
  symbol,
  position,
  posMeta,
  positionSide = null,
  runId = null,
  executionMode = "PAPER",
  metaPatch = null,
} = {}) {
  if (!metaPatch || typeof metaPatch !== "object" || !Object.keys(metaPatch).length) {
    return (posMeta && typeof posMeta === "object") ? posMeta : {};
  }
  const pos = (position && typeof position === "object") ? position : {};
  const merged = mergeMeta(posMeta, metaPatch);
  await upsertPositionWithLatestRetry({
    exchange,
    symbol,
    position: pos,
    state: pos.state,
    positionSide: pos.position_side || positionSide || null,
    sizePct: pos.size_pct,
    avgPrice: pos.avg_price,
    qtyBase: pos.qty_base ?? null,
    runId,
    executionMode,
    budgetMaxKrw: pos.budget_max_krw ?? null,
    budgetUsedKrw: pos.budget_used_krw ?? null,
    budgetSource: pos.budget_source ?? null,
    meta: merged,
    source: "BAR_LOOP_OBSERVATION",
    reason: "BAR_LOOP_META_UPDATE",
  });
  return merged;
}

function resolveOptimisticNativeProtectionMetaPatch({ forceLiveReconcile = false, nativeProtectionMetaPatch = null } = {}) {
  if (forceLiveReconcile) return null;
  return (nativeProtectionMetaPatch && typeof nativeProtectionMetaPatch === "object")
    ? nativeProtectionMetaPatch
    : null;
}

function isTpP1EventLocal(ev) {
  const e = String(ev || "").toUpperCase();
  return e === "EXIT_TP_P1" || e.startsWith("EXIT_TP_P1_");
}

function isTpP0EventLocal(ev) {
  const e = String(ev || "").toUpperCase();
  return e === "EXIT_TP_P0" || e.startsWith("EXIT_TP_P0_");
}

function resolveTrailDelayConfigForMeta({ exchange = null, pos = null, posMeta = null } = {}) {
  const mergedMeta = posMeta && typeof posMeta === "object"
    ? posMeta
    : ((pos && typeof pos.meta === "object") ? pos.meta : {});
  const rules = resolveExitRulesForPosition({
    exchange,
    position: pos && typeof pos === "object"
      ? { ...pos, meta: mergedMeta }
      : { meta: mergedMeta },
  });
  return {
    barsRequired: Number.isFinite(Number(rules && rules.TRAIL_DELAY_BARS))
      ? Math.max(0, Math.round(Number(rules.TRAIL_DELAY_BARS)))
      : null,
    mfePctRequired: Number.isFinite(Number(rules && rules.TRAIL_DELAY_MFE_PCT))
      ? Math.max(0, Number(rules.TRAIL_DELAY_MFE_PCT))
      : null,
  };
}

function applyTpP1IntentFillMetaUpdate({
  exchange = null,
  pos = null,
  nextMeta = null,
  metaSide = null,
  fillPrice = null,
  execBarCloseMs = null,
  entryEventIdForFill = null,
  applyOptimisticFillProjection = false,
} = {}) {
  const currentMeta = (nextMeta && typeof nextMeta === "object") ? nextMeta : {};
  const trailDelayCfg = resolveTrailDelayConfigForMeta({
    exchange,
    pos: { ...(pos || {}), meta: currentMeta },
    posMeta: currentMeta,
  });
  const nextTrailHigh = metaSide === "SHORT"
    ? null
    : (Number.isFinite(fillPrice) ? fillPrice : null);
  const nextTrailLow = metaSide === "SHORT"
    ? (Number.isFinite(fillPrice) ? fillPrice : null)
    : null;
  if (!applyOptimisticFillProjection) {
    return {
      meta: currentMeta,
      nextTrailHigh,
      nextTrailLow,
    };
  }
  return {
    meta: mergeMeta(currentMeta, {
      tp_p0_done: currentMeta.tp_p0_done === true,
      tp_p1_done: true,
      tp_p1_price: fillPrice,
      tp_p1_target_price: computeTpP1TargetPrice({
        exchange,
        position: pos,
        posMeta: currentMeta,
        fillPrice,
      }),
      trail_high: nextTrailHigh,
      trail_high_at_ms: nextTrailHigh != null ? (Number(execBarCloseMs) || Date.now()) : null,
      trail_low: nextTrailLow,
      trail_low_at_ms: nextTrailLow != null ? (Number(execBarCloseMs) || Date.now()) : null,
      trail_active: false,
      tp_p1_pending: false,
      tp_p1_pending_at_ms: null,
      tp_p1_pending_until_ms: null,
      tp_p1_pending_event: null,
      tp_p1_bar_ms: Number(execBarCloseMs) || null,
      tp_p1_at: new Date().toISOString(),
      tp_p1_source: "INTENT_FILL",
      tp_p1_entry_event_id: (entryEventIdForFill || currentMeta.entry_event_id || null),
      tp_p1_entry_exec_bar_ms: Number(currentMeta.entry_exec_bar_ms || execBarCloseMs) || null,
      trail_delay_bars_required: trailDelayCfg.barsRequired,
      trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
      trail_delay_release_reason: null,
      trail_delay_release_at: null,
      trail_delay_mode: "ONE_BAR_OR_MFE",
      tp_p1_skip_reason: null,
      tp_p1_skip_note: null,
      tp_p1_skip_at: null,
      opposite_transition_dir: null,
      opposite_transition_event: null,
      opposite_transition_until_ms: null,
      opposite_transition_stage: null,
      opposite_transition_seen_ms: null,
      native_protection_tp0_order_id: null,
      native_protection_tp_order_id: null,
      native_protection_tp0_status: null,
      native_protection_tp_status: null,
      native_protection_tp0_reason: null,
      native_protection_tp_reason: null,
      native_protection_tp0_qty_base: null,
      native_protection_tp_qty_base: null,
      native_protection_tp0_qty_ratio: null,
      native_protection_tp_qty_ratio: null,
    }),
    nextTrailHigh,
    nextTrailLow,
  };
}

function applyTpP0IntentFillMetaUpdate({
  nextMeta = null,
  fillPrice = null,
  qtyFraction = null,
  execBarCloseMs = null,
  entryEventIdForFill = null,
  applyOptimisticFillProjection = false,
} = {}) {
  const currentMeta = (nextMeta && typeof nextMeta === "object") ? nextMeta : {};
  void fillPrice;
  void qtyFraction;
  void execBarCloseMs;
  void entryEventIdForFill;
  void applyOptimisticFillProjection;
  return currentMeta;
}

function buildOpenCloseProjectionResetMetaPatch({ closing = false } = {}) {
  return {
    tp_p0_done: false,
    tp_p0_price: null,
    tp_p0_at: null,
    tp_p0_source: null,
    tp_p0_qty_ratio: null,
    tp_p0_entry_event_id: null,
    tp_p0_entry_exec_bar_ms: null,
    tp_p1_done: false,
    tp_p1_price: null,
    tp_p1_target_price: null,
    trail_high: null,
    trail_high_at_ms: null,
    trail_low: null,
    trail_low_at_ms: null,
    trail_active: false,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_bar_ms: null,
    tp_p1_at: null,
    tp_p1_source: null,
    tp_p1_entry_event_id: null,
    tp_p1_entry_exec_bar_ms: null,
    trail_delay_bars_required: null,
    trail_delay_mfe_pct_required: null,
    trail_delay_release_reason: null,
    trail_delay_release_at: null,
    trail_delay_mode: null,
    tp_p1_skip_reason: null,
    tp_p1_skip_note: null,
    tp_p1_skip_at: null,
    native_protection_refresh_status: closing ? null : undefined,
    native_protection_refresh_reason: closing ? null : undefined,
    native_protection_refresh_context: closing ? null : undefined,
    native_protection_refresh_at_ms: closing ? null : undefined,
    native_protection_refresh_bar_ms: closing ? null : undefined,
    native_protection_stale: closing ? false : undefined,
    native_protection_attempts: closing ? null : undefined,
    native_protection_max_attempts: closing ? null : undefined,
    native_protection_stop_order_id: closing ? null : undefined,
    native_protection_tp0_order_id: closing ? null : undefined,
    native_protection_tp_order_id: closing ? null : undefined,
    native_protection_stop_price: closing ? null : undefined,
    native_protection_tp0_price: closing ? null : undefined,
    native_protection_tp_price: closing ? null : undefined,
    native_protection_tp0_qty_base: closing ? null : undefined,
    native_protection_tp_qty_base: closing ? null : undefined,
    native_protection_tp0_qty_ratio: closing ? null : undefined,
    native_protection_tp_qty_ratio: closing ? null : undefined,
    native_protection_tp0_status: closing ? null : undefined,
    native_protection_tp_status: closing ? null : undefined,
    native_protection_tp0_reason: closing ? null : undefined,
    native_protection_tp_reason: closing ? null : undefined,
    native_protection_entry_price: closing ? null : undefined,
    native_protection_side: closing ? null : undefined,
  };
}

function buildOpenCloseTransitionMetaPatch({ closing = false, includeEntryRiskReset = true } = {}) {
  return {
    initial_stop_price: includeEntryRiskReset ? null : undefined,
    entry_r_distance: includeEntryRiskReset ? null : undefined,
    trail_r_multiple: includeEntryRiskReset ? null : undefined,
    opposite_transition_dir: null,
    opposite_transition_event: null,
    opposite_transition_until_ms: null,
    opposite_transition_stage: null,
    opposite_transition_seen_ms: null,
    add_chain_last_signal_bar_ms: null,
    add_chain_last_intent_id: null,
    add_chain_last_signal_id: null,
    add_chain_last_avg_before: null,
    add_chain_last_avg_after: null,
    add_chain_last_size_before: null,
    add_chain_last_size_after: null,
    add_chain_last_qty_pct: null,
    add_chain_last_qty_base: null,
    add_chain_last_loss_pct: null,
    add_chain_base_qty_pct: closing ? null : undefined,
    ...buildSameDirectionTrailProfitLegacyResetMetaPatch(),
    ...buildOpenCloseProjectionResetMetaPatch({ closing }),
  };
}

function buildClosingFillMetaPatch({
  execBarCloseMs = null,
  metaSide = null,
  includeExitProfileRollback = false,
} = {}) {
  return {
    last_exit_bar_ms: Number(execBarCloseMs) || null,
    last_exit_dir: metaSide || null,
    last_exit_wall_ms: resolveEventRefMs(execBarCloseMs),
    entry_exec_bar_ms: null,
    entry_exec_tf_ms: null,
    entry_event_id: null,
    entry_signal_type: null,
    entry_grade: null,
    entry_qty_profile: null,
    entry_signal_bar_ms: null,
    origin_entry_event_id: null,
    origin_entry_signal_type: null,
    origin_entry_grade: null,
    origin_entry_qty_profile: null,
    origin_entry_signal_bar_ms: null,
    origin_entry_exec_bar_ms: null,
    openclaw_market_regime_cohort: null,
    openclaw_market_regime_objective_score: null,
    openclaw_market_regime_drop_verdict: null,
    exit_profile: null,
    exit_profile_reason: null,
    exit_rules_override: null,
    exit_profile_rollback_active: includeExitProfileRollback ? false : undefined,
    exit_profile_rollback_until_ms: includeExitProfileRollback ? null : undefined,
    exit_profile_rollback_reason: includeExitProfileRollback ? null : undefined,
    exit_policy_source: null,
    // Runtime exit-rule repair flags must be reset between cycles. They are
    // diagnostic markers attached to the *current* position's entry, not
    // ledger history. Without this reset they leak across close→reopen and
    // make every fresh entry look like it triggered ENTRY_RUNTIME_EXIT_RULES_INVALID,
    // hiding real repair events behind days-old timestamps.
    runtime_exit_invariant_repaired: null,
    runtime_exit_invariant_reason: null,
    runtime_exit_invariant_at_ms: null,
    runtime_exit_repair_applied: null,
    runtime_exit_repair_reason: null,
    runtime_exit_repair_at_ms: null,
    ...buildSameDirectionTrailProfitLegacyResetMetaPatch(),
  };
}

// 2026-04-20 senior audit fix (P0 BLOCKER) — synthetic opening entry_event_id.
// Background: positions_paper.meta.entry_event_id was nullable at opening-fill
// write because buildEntryEventId() returns null when any of
// (exchange, symbol, tf, signalBarCloseMs, event) is missing. Downstream,
// requiresCanonicalExitEntryLineage() gates TP0/TP1/TRAIL alerts on a
// non-empty lineage id. A missing id causes resolveCanonicalExitWritePayload()
// to emit an empty transitionEvents array, which silently trips
// MISSING_CANONICAL_EXIT_TRANSITION in tradeExecutionAlert and the Telegram
// message never goes out. The EXIT_TP_P1_RECOVERY band-aid hardcodes
// transitionEvents to patch over this post-hoc; the real fix is to guarantee
// a non-null, deterministic id at the entry write boundary.
// The synthetic id is derived from observable facts available at opening
// (exchange, symbol, tfMs, side, execBarMs). It is deterministic (same
// inputs → same id so resyncs are idempotent), obviously distinguishable
// (SYN| prefix never collides with real ids produced by buildEntryEventId
// which start with the exchange name), and preserves the 7-field pipe
// layout expected by any parser that looks for structure.
//
// NOTE on field count: the layout is `SYN|EX|SYM|TF|EXEC|EV|EV` — fields
// 6 and 7 are *intentionally* duplicated. `buildEntryEventId` emits the
// same `{event}|{event}` suffix (signal event + dedupe-resistant trailing
// event), so we mirror that shape exactly. Any parser that splits on `|`
// and indexes by position continues to work without special-casing SYN
// ids. If you are tempted to collapse the two, first audit every consumer
// of entry_event_id (canonical_exit_transition, intent_fill_events, the
// ML feature-label dataset) — several of them index by field position.
const SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX = "SYN";
const SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE = "SYN_OPENING";

function buildSyntheticOpeningEntryEventId({
  exchange = null,
  symbol = null,
  signalTfMs = null,
  side = null,
  execBarCloseMs = null,
} = {}) {
  const ex = String(exchange || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const execMs = Number(execBarCloseMs);
  // Minimum required material. Without exchange+symbol+execMs we cannot
  // produce a deterministic id — fall through to null and let the caller
  // mark origin=MISSING. Note: Number(null)/Number("")/Number(undefined)
  // all coerce to 0 which IS finite, so guard explicitly on positivity —
  // a zero bar-close epoch is never a real trading timestamp.
  if (!ex || !sym || !Number.isFinite(execMs) || execMs <= 0) return null;
  const tfMs = Number(signalTfMs);
  const tfToken = Number.isFinite(tfMs) && tfMs > 0 ? `${tfMs}ms` : "NA";
  const sideToken = String(side || "").trim().toUpperCase() || "NA";
  const evToken = `OPENING_${sideToken}`;
  return `${SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX}|${ex}|${sym}|${tfToken}|${execMs}|${evToken}|${evToken}`;
}

function buildOpeningFillMetaPatch({
  leverageValue = null,
  leverageReason = null,
  signalTfMs = null,
  newSize = null,
  features = null,
  marketRegimeCohort = null,
  marketRegimeRow = null,
  entryEventIdFromIntent = null,
  entrySignalTypeFromIntent = null,
  entryGradeFromIntent = null,
  entryQtyProfileFromIntent = null,
  signalBarCloseTimeUtcMs = null,
  execBarCloseMs = null,
  initialStopPrice = undefined,
  initialStopSource = undefined,
  entryRDistance = undefined,
  trailRMultiple = undefined,
  includeLeverageReason = false,
  includeEntryRiskFields = false,
  // Raw material for synthetic fallback (see comment above).
  exchange = null,
  symbol = null,
  metaSide = null,
} = {}) {
  const rawEntryEventId = String(entryEventIdFromIntent || "").trim() || null;
  let resolvedEntryEventId = rawEntryEventId;
  let entryLineageOrigin = rawEntryEventId ? "INTENT" : "MISSING";
  if (!resolvedEntryEventId) {
    const synthetic = buildSyntheticOpeningEntryEventId({
      exchange,
      symbol,
      signalTfMs,
      side: metaSide,
      execBarCloseMs,
    });
    if (synthetic) {
      resolvedEntryEventId = synthetic;
      entryLineageOrigin = "SYNTHETIC";
    }
  }
  const resolvedEntrySignalType = String(entrySignalTypeFromIntent || "").trim().toUpperCase()
    || (entryLineageOrigin === "SYNTHETIC" ? SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE : null);
  return {
    leverage: Number.isFinite(Number(leverageValue)) ? Number(leverageValue) : null,
    leverage_reason: includeLeverageReason ? (leverageReason || null) : undefined,
    entry_exec_tf_ms: Number.isFinite(signalTfMs) ? signalTfMs : null,
    initial_stop_price: includeEntryRiskFields
      ? (Number.isFinite(Number(initialStopPrice)) ? Number(initialStopPrice) : null)
      : undefined,
    initial_stop_source: includeEntryRiskFields ? (initialStopSource || null) : undefined,
    entry_r_distance: includeEntryRiskFields
      ? (Number.isFinite(Number(entryRDistance)) ? Number(entryRDistance) : null)
      : undefined,
    ev_gate_atr_pct: Number.isFinite(Number(features && features.ev_gate_atr_pct))
      ? Number(features.ev_gate_atr_pct)
      : null,
    trail_r_multiple: includeEntryRiskFields
      ? (Number.isFinite(Number(trailRMultiple)) ? Number(trailRMultiple) : null)
      : undefined,
    add_chain_base_qty_pct: Number.isFinite(newSize) ? Number(newSize) : null,
    last_exit_bar_ms: null,
    last_exit_dir: null,
    last_exit_wall_ms: null,
    openclaw_market_regime_cohort: marketRegimeCohort || null,
    openclaw_market_regime_objective_score: marketRegimeRow && Number.isFinite(Number(marketRegimeRow.objective_score))
      ? Number(marketRegimeRow.objective_score)
      : null,
    openclaw_market_regime_drop_verdict: marketRegimeRow ? String(marketRegimeRow.drop_verdict || "").trim().toUpperCase() || null : null,
    entry_lineage_origin: entryLineageOrigin,
    ...buildSameDirectionTrailProfitLegacyResetMetaPatch(),
    ...buildEntryLineageMetaPatch({
      entry_event_id: resolvedEntryEventId,
      entry_signal_type: resolvedEntrySignalType,
      entry_grade: entryGradeFromIntent || null,
      entry_qty_profile: entryQtyProfileFromIntent || null,
      entry_signal_bar_ms: Number(signalBarCloseTimeUtcMs) || null,
      entry_exec_bar_ms: Number(execBarCloseMs) || null,
    }),
  };
}

async function loadRecentFillsCache(db) {
  const now = Date.now();
  if (recentFillsCache.ts && (now - recentFillsCache.ts) < TP_P1_FILL_CACHE_TTL_MS) {
    return recentFillsCache.rows || [];
  }
  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(TP_P1_FILL_CACHE_LIMIT).get();
  const rows = [];
  snap.forEach((d) => rows.push(d.data() || {}));
  recentFillsCache.ts = now;
  recentFillsCache.rows = rows;
  return rows;
}

function pickLatestTpP1Fill(rows, exchange, symbol) {
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "");
  let best = null;
  let bestMs = null;
  for (const r of rows || []) {
    if (!r) continue;
    if (String(r.exchange || "").toUpperCase() !== ex) continue;
    const rSym = String(r.symbol || r.symbol_or_pair_id || r.market || "");
    if (rSym !== sym) continue;
    if (!isTpP1EventLocal(r.event)) continue;
    const ms = Number(r.exec_bar_close_time_utc_ms) || Date.parse(String(r.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    if (!best || ms > bestMs) {
      best = r;
      bestMs = ms;
    }
  }
  return best;
}

function pickLatestTpP0Fill(rows, exchange, symbol) {
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "");
  let best = null;
  let bestMs = null;
  for (const r of rows || []) {
    if (!r) continue;
    if (String(r.exchange || "").toUpperCase() !== ex) continue;
    const rSym = String(r.symbol || r.symbol_or_pair_id || r.market || "");
    if (rSym !== sym) continue;
    if (!isTpP0EventLocal(r.event)) continue;
    const ms = Number(r.exec_bar_close_time_utc_ms) || Date.parse(String(r.created_at || ""));
    if (!Number.isFinite(ms)) continue;
    if (!best || ms > bestMs) {
      best = r;
      bestMs = ms;
    }
  }
  return best;
}

function reconcileTpP0MetaFromFill({ posMeta, pos, fill } = {}) {
  if (!fill || !posMeta || posMeta.tp_p0_done === true) return posMeta;
  if (resolveSimplifiedExitV2PositionFlag({ currentMeta: posMeta }) === true) return posMeta;
  const fillEntry = fill.entry_event_id || fill.entryEventId || null;
  const metaEntry = posMeta.entry_event_id || null;
  if (fillEntry && metaEntry && fillEntry !== metaEntry) return posMeta;
  const entryExecMs = Number(posMeta.entry_exec_bar_ms);
  const fillMs = Number(fill.exec_bar_close_time_utc_ms) || Date.parse(String(fill.created_at || ""));
  if (Number.isFinite(entryExecMs) && Number.isFinite(fillMs) && (fillMs + 30000) < entryExecMs) {
    return posMeta;
  }
  const execPrice = Number(fill.exec_price);
  const closeRatio = Number(fill.close_ratio);
  return mergeMeta(posMeta, {
    tp_p0_done: true,
    tp_p0_price: Number.isFinite(execPrice) ? execPrice : (posMeta.tp_p0_price ?? null),
    tp_p0_at: fill.created_at || new Date().toISOString(),
    tp_p0_source: "FILL_RECONCILE",
    tp_p0_qty_ratio: Number.isFinite(closeRatio) && closeRatio > 0 ? closeRatio : (posMeta.tp_p0_qty_ratio ?? null),
    tp_p0_entry_event_id: metaEntry || fillEntry || null,
    tp_p0_entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
  });
}

function reconcileTpP1MetaFromFill({ posMeta, pos, fill } = {}) {
  if (!fill || !posMeta || posMeta.tp_p1_done === true) return posMeta;
  const fillEntry = fill.entry_event_id || fill.entryEventId || null;
  const metaEntry = posMeta.entry_event_id || null;
  if (fillEntry && metaEntry && fillEntry !== metaEntry) return posMeta;
  const entryExecMs = Number(posMeta.entry_exec_bar_ms);
  const fillMs = Number(fill.exec_bar_close_time_utc_ms) || Date.parse(String(fill.created_at || ""));
  if (Number.isFinite(entryExecMs) && Number.isFinite(fillMs) && (fillMs + 30000) < entryExecMs) {
    return posMeta;
  }
  const execPrice = Number(fill.exec_price);
  const trailDelayCfg = resolveTrailDelayConfigForMeta({
    exchange: pos && pos.exchange ? pos.exchange : (posMeta && posMeta.exchange ? posMeta.exchange : null),
    pos,
    posMeta,
  });
  const side = String(
    (pos && (pos.position_side || pos.side)) ||
    posMeta.position_side ||
    posMeta.external_side ||
    posMeta.external_position_side ||
    "LONG"
  ).toUpperCase();
  const patch = {
    tp_p1_done: true,
    tp_p1_price: Number.isFinite(execPrice) ? execPrice : (posMeta.tp_p1_price ?? null),
    tp_p1_target_price: Number.isFinite(Number(posMeta.tp_p1_target_price))
      ? Number(posMeta.tp_p1_target_price)
      : computeTpP1TargetPrice({
          exchange: pos && pos.exchange,
          position: pos,
          posMeta,
          fillPrice: execPrice,
        }),
    trail_active: false,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_bar_ms: Number.isFinite(fillMs) ? fillMs : null,
    tp_p1_at: fill.created_at || new Date().toISOString(),
    tp_p1_source: "FILL_RECONCILE",
    tp_p1_entry_event_id: metaEntry || fillEntry || null,
    tp_p1_entry_exec_bar_ms: Number.isFinite(entryExecMs) ? entryExecMs : null,
    trail_delay_bars_required: trailDelayCfg.barsRequired,
    trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
    trail_delay_release_reason: null,
    trail_delay_release_at: null,
    trail_delay_mode: "ONE_BAR_OR_MFE",
  };
  if (side === "SHORT") {
    if (Number.isFinite(execPrice)) {
      patch.trail_low = execPrice;
      patch.trail_low_at_ms = Number.isFinite(fillMs) ? fillMs : Date.now();
    }
  } else if (Number.isFinite(execPrice)) {
    patch.trail_high = execPrice;
    patch.trail_high_at_ms = Number.isFinite(fillMs) ? fillMs : Date.now();
  }
  return mergeMeta(posMeta, patch);
}

async function applyTpP1SkipOnCancel({
  exchange,
  symbol,
  pos,
  posMeta,
  event,
  reason,
  note,
  bar,
  runId,
  executionMode,
} = {}) {
  const ev = String(event || "").toUpperCase();
  if (!(ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_"))) return posMeta;
  const reasonKey = String(reason || "").toUpperCase();
  if (!TP_P1_SKIP_REASONS.has(reasonKey)) return posMeta;
  const state = String(pos && pos.state || "").toUpperCase();
  if (state !== "ACTIVE") return posMeta;
  if (posMeta && posMeta.tp_p1_done === true) return posMeta;
  const keepFullAndTrail = reasonKey.startsWith("TP_P1_");
  const entryEventId = String((posMeta && posMeta.entry_event_id) || "").trim() || null;
  const entryExecMs = Number(posMeta && posMeta.entry_exec_bar_ms);
  const nowIso = new Date().toISOString();
  const side = normalizePositionSide(
    (pos && (pos.position_side || pos.side)) ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  ) || "LONG";
  const refPx = Number(
    (bar && (bar.close ?? bar.c ?? bar.open ?? bar.o)) ??
    (pos && pos.avg_price) ??
    NaN
  );
  const prevTrailHigh = Number(posMeta && posMeta.trail_high);
  const prevTrailLow = Number(posMeta && posMeta.trail_low);
  const trailHigh = side === "SHORT"
    ? null
    : (Number.isFinite(refPx) ? refPx : (Number.isFinite(prevTrailHigh) ? prevTrailHigh : null));
  const trailLow = side === "SHORT"
    ? (Number.isFinite(refPx) ? refPx : (Number.isFinite(prevTrailLow) ? prevTrailLow : null))
    : null;
  const trailDelayCfg = keepFullAndTrail
    ? resolveTrailDelayConfigForMeta({ exchange, pos, posMeta })
    : { barsRequired: null, mfePctRequired: null };

  const merged = mergeMeta(posMeta, {
    tp_p1_done: true,
    tp_p1_price: keepFullAndTrail && Number.isFinite(refPx) ? refPx : null,
    tp_p1_target_price: keepFullAndTrail
      ? computeTpP1TargetPrice({
          exchange,
          position: pos,
          posMeta,
          fillPrice: refPx,
        })
      : null,
    trail_high: keepFullAndTrail ? trailHigh : null,
    trail_high_at_ms: keepFullAndTrail && trailHigh != null ? (Number(bar && (bar.bar_close_time_utc_ms || bar.t)) || Date.now()) : null,
    trail_low: keepFullAndTrail ? trailLow : null,
    trail_low_at_ms: keepFullAndTrail && trailLow != null ? (Number(bar && (bar.bar_close_time_utc_ms || bar.t)) || Date.now()) : null,
    trail_active: false,
    tp_p1_pending: false,
    tp_p1_pending_at_ms: null,
    tp_p1_pending_until_ms: null,
    tp_p1_pending_event: null,
    tp_p1_bar_ms: Number(bar && (bar.bar_close_time_utc_ms || bar.bar_close_time_utc || bar.t)) || null,
    tp_p1_at: keepFullAndTrail ? nowIso : null,
    tp_p1_source: keepFullAndTrail ? "TP1_SKIP_PROTECT" : null,
    tp_p1_entry_event_id: keepFullAndTrail ? entryEventId : null,
    tp_p1_entry_exec_bar_ms: keepFullAndTrail && Number.isFinite(entryExecMs) ? entryExecMs : null,
    trail_delay_bars_required: trailDelayCfg.barsRequired,
    trail_delay_mfe_pct_required: trailDelayCfg.mfePctRequired,
    trail_delay_release_reason: null,
    trail_delay_release_at: null,
    trail_delay_mode: keepFullAndTrail ? "ONE_BAR_OR_MFE" : null,
    tp_p1_skip_reason: reasonKey,
    tp_p1_skip_note: note || null,
    tp_p1_skip_at: nowIso,
  });

  await upsertPositionWithLatestRetry({
    exchange,
    symbol,
    position: pos,
    state: pos.state,
    positionSide: pos.position_side || null,
    sizePct: pos.size_pct,
    avgPrice: pos.avg_price,
    qtyBase: pos.qty_base ?? null,
    runId,
    executionMode: executionMode || null,
    budgetMaxKrw: pos.budget_max_krw ?? null,
    budgetUsedKrw: pos.budget_used_krw ?? null,
    budgetSource: pos.budget_source ?? null,
    meta: merged,
    source: "TP1_SKIP_PROTECT",
    reason: reasonKey || "TP1_SKIP_PROTECT",
  });

  return merged;
}

function normalizeBool(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

function splitRuntimeList(raw) {
  return String(raw || "")
    .split(/[,\|\s]+/)
    .map((item) => String(item || "").trim().toUpperCase())
    .filter(Boolean);
}

function positiveNumberOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function isUnlimitedRuntimeLimit(value) {
  const raw = String(value == null ? "" : value).trim().toUpperCase();
  return raw === "UNLIMITED" || raw === "INF" || raw === "INFINITY" || raw === "*";
}

function positiveNumberOrUnlimited(value) {
  if (isUnlimitedRuntimeLimit(value)) return "UNLIMITED";
  return positiveNumberOrNull(value);
}

function evaluateV2DiscoveryCanaryLiveBridge({ env = process.env, symbol = null, executionMode = null } = {}) {
  const mode = String(executionMode || "").trim().toUpperCase();
  const sym = String(symbol || "").trim().toUpperCase();
  const policy = Object.freeze({
    v2_enabled: normalizeBool(env.DONBEOLJA_V2_ENABLED, false),
    dry_run: normalizeBool(env.DONBEOLJA_V2_DRY_RUN, true),
    canary_only: normalizeBool(env.DONBEOLJA_V2_CANARY_ONLY, false),
    live_endpoint_enabled: normalizeBool(env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, false),
    discovery_enabled: normalizeBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, false),
    ml_live_serving_armed: normalizeBool(env.ML_LIVE_SERVING_ARMED, false),
    agent_apply_enabled: normalizeBool(env.OPENCLAW_AGENT_APPLY_ENABLED, false),
    risk_governor_required: normalizeBool(env.DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, true),
    legacy_webhook_blocked: normalizeBool(env.DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, false),
    legacy_webhook_allowed: normalizeBool(env.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, false),
    legacy_runtime_disabled: normalizeBool(env.DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, false),
    legacy_entry_filters_disabled: normalizeBool(env.DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, false),
    legacy_wait_one_bar_hard_drop_disabled: normalizeBool(env.DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, false),
    allowed_symbols: Object.freeze(splitRuntimeList(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS)),
    max_notional_quote: positiveNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE),
    symbol_notional_quote_map: resolveDiscoverySymbolNotionalQuoteMap(env),
    max_position_count: positiveNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT),
    max_trades_per_day: positiveNumberOrUnlimited(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY),
    max_trades_per_day_unlimited: isUnlimitedRuntimeLimit(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY),
    daily_loss_halt_quote: positiveNumberOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE),
  });

  const blockers = [];
  if (mode !== "LIVE") blockers.push("V2_DISCOVERY_CANARY_BRIDGE:EXECUTION_MODE_NOT_LIVE");
  if (!sym) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_REQUIRED");
  if (policy.v2_enabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:V2_NOT_ENABLED");
  if (policy.dry_run === true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:DRY_RUN_BLOCKED");
  if (policy.canary_only !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:CANARY_ONLY_REQUIRED");
  if (policy.live_endpoint_enabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LIVE_ENDPOINT_REQUIRED");
  if (policy.discovery_enabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:DISCOVERY_NOT_ENABLED");
  if (policy.allowed_symbols.length < 1) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_ALLOWLIST_REQUIRED");
  if (sym && policy.allowed_symbols.length > 0 && !policy.allowed_symbols.includes(sym)) {
    blockers.push("V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_NOT_ALLOWED");
  }
  if (policy.max_notional_quote == null) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:MAX_NOTIONAL_REQUIRED");
  if (policy.max_position_count == null) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:MAX_POSITION_COUNT_REQUIRED");
  if (policy.max_position_count != null && policy.max_position_count > 5) {
    blockers.push("V2_DISCOVERY_CANARY_BRIDGE:MAX_POSITION_COUNT_EXCEEDS_5");
  }
  if (policy.max_trades_per_day == null) {
    blockers.push("V2_DISCOVERY_CANARY_BRIDGE:MAX_TRADES_PER_DAY_REQUIRED");
  }
  if (policy.daily_loss_halt_quote == null) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:DAILY_LOSS_HALT_REQUIRED");
  if (policy.ml_live_serving_armed === true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:ML_LIVE_ARMED");
  if (policy.agent_apply_enabled === true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:AGENT_APPLY_ENABLED");
  if (policy.risk_governor_required !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:RISK_GOVERNOR_REQUIRED");
  if (policy.legacy_webhook_blocked !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WEBHOOK_NOT_BLOCKED");
  if (policy.legacy_webhook_allowed === true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WEBHOOK_ALLOWED");
  if (policy.legacy_runtime_disabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_RUNTIME_NOT_RETIRED");
  if (policy.legacy_entry_filters_disabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_ENTRY_FILTERS_NOT_RETIRED");
  if (policy.legacy_wait_one_bar_hard_drop_disabled !== true) blockers.push("V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WAIT_ONE_BAR_HARD_DROP_NOT_RETIRED");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_DISCOVERY_CANARY_LIVE_BRIDGE_ENABLED"
      : "V2_DISCOVERY_CANARY_LIVE_BRIDGE_BLOCKED",
    blockers: Object.freeze(blockers),
    symbol: sym || null,
    max_notional_quote: resolveDiscoverySymbolNotionalQuote({
      env,
      symbol: sym,
      fallback: policy.max_notional_quote,
    }),
    policy,
  });
}

function clampDiscoveryCanaryMaxOrderQuote(currentMaxOrderQuote, bridge) {
  const discoveryMax = positiveNumberOrNull(bridge && bridge.max_notional_quote);
  const currentMax = positiveNumberOrNull(currentMaxOrderQuote);
  if (discoveryMax == null) return currentMaxOrderQuote;
  if (currentMax == null) return discoveryMax;
  return Math.min(currentMax, discoveryMax);
}

function isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg = null } = {}) {
  if (!normalizeBool(process.env.DONBEOLJA_V2_LEGACY_V1_WRITER_DENY_ENABLED, true)) return false;
  if (!liveCfg) return false;
  if (liveCfg.legacy_runtime_disabled === true) return true;
  if (liveCfg.v2DiscoveryCanaryBridge === true) return true;
  if (liveCfg.v2DiscoveryCanaryConfigured === true && liveCfg.legacyV1ExchangeWriterEnabled !== true) return true;
  return false;
}

function isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg = null, intent = null } = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  return !!(
    liveCfg &&
    liveCfg.v2DiscoveryCanaryBridge === true &&
    (entryIntent === "ENTRY" || entryIntent === "ADD")
  );
}

function shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg = null, intent = null } = {}) {
  return isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent });
}

function shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg = null, intent = null } = {}) {
  return isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent });
}

function collectReasonBlockers(...sources) {
  const out = [];
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const token = String(item || "").trim().toUpperCase();
      if (token && !out.includes(token)) out.push(token);
    }
  }
  return out;
}

function resolveV2DiscoveryHandoffDetail(handoff = null) {
  const endpointResult = handoff && handoff.endpoint_result && typeof handoff.endpoint_result === "object"
    ? handoff.endpoint_result
    : null;
  const routeResult = endpointResult && endpointResult.route_result && typeof endpointResult.route_result === "object"
    ? endpointResult.route_result
    : null;
  const routedDecision = handoff && (handoff.routedDecision || (handoff.request && handoff.request.routedDecision));
  const routeRoutedDecision = routeResult && (routeResult.routedDecision || routeResult.routed_decision);
  const discoveryContract = endpointResult && endpointResult.discovery_canary_contract
    ? endpointResult.discovery_canary_contract
    : null;
  const riskGovernor = endpointResult && endpointResult.risk_governor && typeof endpointResult.risk_governor === "object"
    ? endpointResult.risk_governor
    : (routeResult && routeResult.risk_governor && typeof routeResult.risk_governor === "object"
      ? routeResult.risk_governor
      : null);
  const marketDataQuality = handoff && handoff.marketDataQuality && typeof handoff.marketDataQuality === "object"
    ? handoff.marketDataQuality
    : (endpointResult && endpointResult.market_data_quality && typeof endpointResult.market_data_quality === "object"
      ? endpointResult.market_data_quality
      : null);
  const routeBlockers = collectReasonBlockers(
    routeResult && routeResult.blockers,
    routeResult && routeResult.detail && routeResult.detail.blockers,
    routeRoutedDecision && routeRoutedDecision.blockers,
    routeRoutedDecision && routeRoutedDecision.detail && routeRoutedDecision.detail.blockers,
  );
  const routerBlockers = collectReasonBlockers(
    routedDecision && routedDecision.blockers,
    routedDecision && routedDecision.detail && routedDecision.detail.blockers,
    routeRoutedDecision && routeRoutedDecision.blockers,
    routeRoutedDecision && routeRoutedDecision.detail && routeRoutedDecision.detail.blockers,
  );
  const discoveryContractBlockers = collectReasonBlockers(discoveryContract && discoveryContract.blockers);
  const marketDataQualityBlockers = collectReasonBlockers(marketDataQuality && marketDataQuality.blockers);
  const riskGovernorBlockers = collectReasonBlockers(riskGovernor && riskGovernor.blockers);
  const riskGovernorSurface = riskGovernor && riskGovernor.surface
    ? normalizeRiskGovernorSurface(riskGovernor.surface)
    : normalizeRiskGovernorSurface(riskGovernor);
  return {
    bridge_reason: handoff && handoff.reason ? String(handoff.reason).trim().toUpperCase() : null,
    bridge_error: handoff && handoff.error_message ? String(handoff.error_message) : null,
    endpoint_reason: endpointResult && endpointResult.reason ? String(endpointResult.reason).trim().toUpperCase() : null,
    route_reason: routeResult && routeResult.reason ? String(routeResult.reason).trim().toUpperCase() : null,
    route_blockers: routeBlockers,
    router_reason: routedDecision && routedDecision.reason
      ? String(routedDecision.reason).trim().toUpperCase()
      : (routeRoutedDecision && routeRoutedDecision.reason ? String(routeRoutedDecision.reason).trim().toUpperCase() : null),
    router_blockers: routerBlockers,
    discovery_contract_reason: discoveryContract && discoveryContract.reason
      ? String(discoveryContract.reason).trim().toUpperCase()
      : null,
    discovery_contract_blockers: discoveryContractBlockers,
    market_data_quality_reason: marketDataQuality && marketDataQuality.reason
      ? String(marketDataQuality.reason).trim().toUpperCase()
      : null,
    market_data_quality_blockers: marketDataQualityBlockers,
    risk_governor_reason: riskGovernor && riskGovernor.reason
      ? String(riskGovernor.reason).trim().toUpperCase()
      : null,
    risk_governor_blockers: riskGovernorBlockers,
    risk_governor_surface: riskGovernorSurface.present === true ? riskGovernorSurface : null,
    risk_governor_primary_code: riskGovernorSurface.primary_code,
    risk_governor_primary_blocker: riskGovernorSurface.primary_blocker,
    risk_governor_blocker_codes: riskGovernorSurface.blocker_codes,
  };
}

function buildV2DiscoveryHandoffFeaturePatch(handoff = null) {
  const detail = resolveV2DiscoveryHandoffDetail(handoff);
  const sideEffect = resolveV2DiscoveryPostFillSideEffect(handoff);
  return {
    v2_discovery_bridge_reason: detail.bridge_reason,
    v2_discovery_bridge_error: detail.bridge_error,
    v2_discovery_endpoint_reason: detail.endpoint_reason,
    v2_discovery_route_reason: detail.route_reason,
    v2_discovery_route_blockers: detail.route_blockers,
    v2_discovery_router_reason: detail.router_reason,
    v2_discovery_router_blockers: detail.router_blockers,
    v2_discovery_canary_contract_reason: detail.discovery_contract_reason,
    v2_discovery_canary_contract_blockers: detail.discovery_contract_blockers,
    v2_discovery_market_data_quality_reason: detail.market_data_quality_reason,
    v2_discovery_market_data_quality_blockers: detail.market_data_quality_blockers,
    v2_discovery_risk_governor_reason: detail.risk_governor_reason,
    v2_discovery_risk_governor_blockers: detail.risk_governor_blockers,
    v2_discovery_risk_governor_surface: detail.risk_governor_surface,
    v2_discovery_risk_governor_primary_code: detail.risk_governor_primary_code,
    v2_discovery_risk_governor_primary_blocker: detail.risk_governor_primary_blocker,
    v2_discovery_risk_governor_blocker_codes: detail.risk_governor_blocker_codes,
    v2_discovery_post_fill_exchange_write: sideEffect ? sideEffect.exchange_write_performed === true : false,
    v2_discovery_post_fill_unprotected_possible: sideEffect ? sideEffect.unprotected_position_possible === true : false,
    v2_discovery_post_fill_entry_order_id: sideEffect ? (sideEffect.entry_order_id || null) : null,
    v2_discovery_post_fill_position_cycle_id: sideEffect ? (sideEffect.position_cycle_id || null) : null,
  };
}

function resolveV2DiscoveryPostFillSideEffect(handoff = null) {
  const endpointResult = handoff && handoff.endpoint_result && typeof handoff.endpoint_result === "object"
    ? handoff.endpoint_result
    : null;
  const routeResult = endpointResult && endpointResult.route_result && typeof endpointResult.route_result === "object"
    ? endpointResult.route_result
    : null;
  const sideEffect = routeResult && routeResult.post_fill_side_effect && typeof routeResult.post_fill_side_effect === "object"
    ? routeResult.post_fill_side_effect
    : null;
  return sideEffect || null;
}

function classifyV2DiscoveryPostFillHandoff(handoff = null) {
  const sideEffect = resolveV2DiscoveryPostFillSideEffect(handoff);
  if (!sideEffect || sideEffect.exchange_write_performed !== true) {
    return {
      exchange_write_performed: false,
      unprotected_position_possible: false,
      reason: null,
      status: null,
      note: null,
      side_effect: sideEffect,
    };
  }
  const unprotected = sideEffect.unprotected_position_possible === true;
  return {
    exchange_write_performed: true,
    unprotected_position_possible: unprotected,
    reason: unprotected
      ? "V2_DISCOVERY_CANARY_ENTRY_EXECUTED_PROTECTION_CRITICAL"
      : "V2_DISCOVERY_CANARY_ENTRY_EXECUTED_PROTECTED_RECONCILE_REQUIRED",
    status: unprotected
      ? "FAILED_INTERNAL"
      : "SUPERSEDED_BY_V2_PROTECTED_ENTRY",
    note: unprotected
      ? "V2 route submitted an exchange entry but protection was not confirmed. This is not a signal drop; repair protection immediately."
      : "V2 route submitted an exchange entry and protection was confirmed, but route/kernel audit did not fully pass. This is not a signal drop; reconcile internal evidence.",
    side_effect: sideEffect,
  };
}

function deriveV2DiscoveryHandoffBlockReason(handoff = null, fallback = "V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE") {
  const postFill = classifyV2DiscoveryPostFillHandoff(handoff);
  if (postFill.exchange_write_performed === true && postFill.reason) return postFill.reason;
  const detail = resolveV2DiscoveryHandoffDetail(handoff);
  if (detail.router_reason) return detail.router_reason;
  if (detail.router_blockers.length) return detail.router_blockers[0];
  if (detail.route_reason) return detail.route_reason;
  if (detail.route_blockers.length) return detail.route_blockers[0];
  if (
    detail.endpoint_reason === "V2_DISCOVERY_CANARY_CONTRACT_BLOCKED"
    && detail.discovery_contract_blockers.length
  ) {
    return detail.discovery_contract_blockers[0];
  }
  if (detail.market_data_quality_blockers.length) return detail.market_data_quality_blockers[0];
  if (detail.market_data_quality_reason) return detail.market_data_quality_reason;
  if (detail.endpoint_reason === "V2_RISK_GOVERNOR_BLOCKED" && detail.risk_governor_blockers.length) {
    return detail.risk_governor_blockers[0];
  }
  if (detail.risk_governor_blockers.length) return detail.risk_governor_blockers[0];
  if (detail.risk_governor_reason) return detail.risk_governor_reason;
  if (detail.endpoint_reason) return detail.endpoint_reason;
  if (detail.discovery_contract_reason) return detail.discovery_contract_reason;
  if (detail.bridge_reason) return detail.bridge_reason;
  return fallback;
}

function sendV2DiscoveryPostFillHandoffProgressAlert({
  exchange = null,
  symbol = null,
  event = null,
  side = null,
  tf = null,
  qtyPct = null,
  executionMode = null,
  signalId = null,
  scheduledExecBarCloseUtc = null,
  blockReason = null,
  handoff = null,
  postFillHandoff = null,
} = {}) {
  const classified = postFillHandoff || classifyV2DiscoveryPostFillHandoff(handoff);
  if (classified.exchange_write_performed !== true) return;
  sendSignalProgressAlert({
    exchange,
    symbol,
    event,
    side,
    tf,
    qtyPct,
    executionMode,
    source: "SERVER",
    authoritative: true,
    progressReason: blockReason || classified.reason || "V2_DISCOVERY_CANARY_ENTRY_EXECUTED_PROTECTED_RECONCILE_REQUIRED",
    pendingReason: classified.unprotected_position_possible === true
      ? "PROTECTION_REPAIR_REQUIRED"
      : "POST_FILL_RECONCILE",
    signalId,
    scheduledExecBarCloseUtc,
    meta: {
      ...buildV2DiscoveryHandoffFeaturePatch(handoff),
      post_fill_note: classified.note || null,
    },
  }).catch((err) => {
    console.warn("[V2_DISCOVERY_POST_FILL_HANDOFF_ALERT_FAIL]", err && err.message ? err.message : String(err));
  });
}

function buildV2DiscoverySignalFanInIntentRow({
  exchange = null,
  symbol = null,
  tf = null,
  signal = null,
  features = null,
  qtyFraction = null,
  intentExecutionMode = null,
  signalBarCloseUtcForIntent = null,
  signalBarCloseMsForIntent = null,
  intentSignalBarCloseUtc = null,
  intentSignalBarCloseMs = null,
  execBarCloseUtcForIntent = null,
  execBarCloseMsForIntent = null,
  signalDocId = null,
  signalPrice = null,
  runId = null,
} = {}) {
  const rowFeatures = features && typeof features === "object" && !Array.isArray(features)
    ? { ...features }
    : {};
  const sig = signal && typeof signal === "object" ? signal : {};
  const resolvedSignalId = sig.signal_id || rowFeatures.signal_id || null;
  const resolvedSignalDocId = sig.signal_doc_id || signalDocId || rowFeatures.signal_doc_id || resolvedSignalId || null;
  const requestId = resolvedSignalId || resolvedSignalDocId || [
    "V2_DISCOVERY_SIGNAL_FAN_IN",
    String(exchange || "EX").toUpperCase(),
    String(symbol || "SYMBOL").toUpperCase(),
    String(tf || "TF"),
    String(signalBarCloseMsForIntent || intentSignalBarCloseMs || Date.now()),
    String(sig.event || "EVENT").toUpperCase(),
  ].join("__");
  if (resolvedSignalId && !rowFeatures.signal_id) rowFeatures.signal_id = resolvedSignalId;
  if (resolvedSignalDocId && !rowFeatures.signal_doc_id) rowFeatures.signal_doc_id = resolvedSignalDocId;
  return {
    intent_id: requestId,
    request_id: requestId,
    exchange,
    symbol,
    symbol_or_pair_id: symbol,
    tf,
    event: sig.event,
    side: sig.side,
    qty_pct: qtyFraction,
    reason: sig.reason || "SIGNAL",
    features_json: rowFeatures,
    signal_id: resolvedSignalId,
    signal_doc_id: resolvedSignalDocId,
    signal_price: Number.isFinite(Number(signalPrice)) ? Number(signalPrice) : null,
    signal_bar_close_time_utc: intentSignalBarCloseUtc || signalBarCloseUtcForIntent || null,
    signal_bar_close_time_utc_ms: Number.isFinite(Number(intentSignalBarCloseMs))
      ? Number(intentSignalBarCloseMs)
      : (Number.isFinite(Number(signalBarCloseMsForIntent)) ? Number(signalBarCloseMsForIntent) : null),
    scheduled_exec_bar_close_time_utc: execBarCloseUtcForIntent || null,
    scheduled_exec_bar_close_time_utc_ms: Number.isFinite(Number(execBarCloseMsForIntent)) ? Number(execBarCloseMsForIntent) : null,
    execution_mode: intentExecutionMode,
    run_id: runId || null,
  };
}

function resolveForceAllSignalsAdd(sysCfg = {}, exchange = "") {
  if (resolveLiveRescueAddConfig(sysCfg, exchange).enabled === true) return false;
  const envRaw = process.env.FORCE_ALL_SIGNALS_ADD;
  if (envRaw !== undefined) return normalizeBool(envRaw, false);
  if (Object.prototype.hasOwnProperty.call(sysCfg || {}, "force_all_signals_add")) {
    return normalizeBool(sysCfg.force_all_signals_add, false);
  }
  const ex = String(exchange || "").toUpperCase();
  // LONG/SHORT 단일 진입 구조에서는 동일방향 재신호를 자동 ADD로 승격하지 않는다.
  // ADD는 rescue add 조건을 충족한 경우에만 명시적으로 허용한다.
  if (ex.includes("BINANCEFUT")) return false;
  return normalizeBool((sysCfg || {}).force_all_signals_add, false);
}

function hasAiSignal(features) {
  if (!features || typeof features !== "object") return false;
  const ai = features.ai_signal;
  if (!ai || typeof ai !== "object") return false;
  return Object.keys(ai).length > 0;
}

function isAiRequired(exchange) {
  if (!normalizeBool(process.env.SIGNAL_AI_ENABLED, false)) return false;
  const ex = String(exchange || "").toUpperCase();
  return ex.includes("BINANCE");
}

function resolveAiMissingPolicy({ qtyFraction, features, sysCfg } = {}) {
  const rawPolicy = String(
    (sysCfg && sysCfg.ai_missing_policy) ||
    AI_FAIL_MODE ||
    "ALLOW"
  ).trim().toUpperCase();
  const policy = rawPolicy === "ALLOW" || rawPolicy === "REDUCE" || rawPolicy === "BLOCK"
    ? rawPolicy
    : "ALLOW";
  const configuredReducePct = Number(sysCfg && sysCfg.ai_missing_reduce_pct);
  const reducePct = Number.isFinite(configuredReducePct)
    ? Math.min(1, Math.max(0, configuredReducePct))
    : AI_MISSING_REDUCE_PCT;
  const featureBase = {
    ...(features || {}),
    ai_required: true,
    ai_missing_policy: policy,
    ai_missing_reduce_pct: reducePct,
  };

  if (policy === "REDUCE") {
    const reducedQty = Number(qtyFraction) * reducePct;
    if (!Number.isFinite(reducedQty) || reducedQty <= 0) {
      return {
        drop: true,
        reason: "DROP_AI_MISSING_ZERO_QTY",
        features: {
          ...featureBase,
          ai_missing_fallback: "REDUCE",
          ai_missing_reduce_pct: reducePct,
        },
      };
    }
    return {
      drop: false,
      qtyFraction: reducedQty,
      features: {
        ...featureBase,
        ai_missing_fallback: "REDUCE",
        ai_missing_reduce_pct: reducePct,
      },
    };
  }

  if (policy === "ALLOW") {
    return {
      drop: false,
      qtyFraction,
      features: {
        ...featureBase,
        ai_missing_fallback: "ALLOW",
      },
    };
  }

  return {
    drop: true,
    reason: "DROP_AI_MISSING",
    features: featureBase,
  };
}

function normalizeInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function scaleBaseBarCountByTf(baseBars, signalTfMs) {
  const base = normalizeInt(baseBars, 0);
  if (!Number.isFinite(base) || base <= 0) return 0;
  if (!Number.isFinite(signalTfMs) || signalTfMs <= 0) return base;
  const tf60mMs = 60 * 60 * 1000;
  const scaled = Math.round(base * (tf60mMs / signalTfMs));
  return Math.max(1, scaled);
}

function resolveBinanceMaxHoldBars(sysCfg, signalTfMs) {
  const envDefault = normalizeInt(process.env.BINANCE_MAX_HOLD_BARS, 12);
  const fallback = Number.isFinite(envDefault) && envDefault > 0 ? envDefault : 12;
  const configured = Math.max(0, normalizeInt(sysCfg && sysCfg.max_hold_bars, fallback));
  return scaleBaseBarCountByTf(configured, signalTfMs);
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveSignalScaledFlags(features) {
  const f = (features && typeof features === "object") ? features : {};
  const commissionScale = normalizeNumber(f.commission_scale, 1);
  const mddReduceFactor = normalizeNumber(f.mdd_reduce_factor, 1);
  const commissionScaledInSignal = normalizeBool(f.commission_scaled_in_signal, false) === true
    || (Number.isFinite(commissionScale) && commissionScale > 0 && commissionScale < 0.9999);
  const mddScaledInSignal = normalizeBool(f.mdd_scaled_in_signal, false) === true
    || (Number.isFinite(mddReduceFactor) && mddReduceFactor > 0 && mddReduceFactor < 0.9999);
  return {
    commissionScaledInSignal,
    mddScaledInSignal,
    commissionScale: Number.isFinite(commissionScale) ? commissionScale : 1,
    mddReduceFactor: Number.isFinite(mddReduceFactor) ? mddReduceFactor : 1,
  };
}

function pickSignalScore(features) {
  if (!features || typeof features !== "object") return null;
  const keys = ["score", "score_norm", "signal_strength", "strength"];
  for (const key of keys) {
    const v = Number(features[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function pickSignalScoreExtended(features) {
  const base = pickSignalScore(features);
  if (Number.isFinite(base)) return base;
  if (!features || typeof features !== "object") return null;
  const line = features.pro_score_line || features.score_line || features.score_text || null;
  if (!line) return null;
  const m = String(line).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function pickSignalConfidence(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.confidence ?? features.signal_confidence ?? features.conf);
  return Number.isFinite(n) ? n : null;
}

function pickSignalWaveConf(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.zz_wave_conf ?? features.wave_conf ?? features.wave_confidence);
  return Number.isFinite(n) ? n : null;
}

function pickSignalConflict(features) {
  if (!features || typeof features !== "object") return null;
  if (features.pro_conflict != null) return normalizeBool(features.pro_conflict, null);
  if (features.conflict != null) return normalizeBool(features.conflict, null);
  return null;
}

function normalizeSignalStateToken(raw) {
  return normalizeSignalStateTokenShared(raw);
}

function pickSignalRegime(features) {
  if (!features || typeof features !== "object") return null;
  return resolveRegimeRecord({ features_json: features });
}

function resolveEntryStructureSnapshot({ features, intentDir, eventUpper } = {}) {
  const featureObj = (features && typeof features === "object") ? features : {};
  const dir = String(intentDir || "").toUpperCase();
  const tier = resolveEntryQualityTier(eventUpper, featureObj);
  const pineBundle = resolvePineStage1BundleMeta(featureObj);
  const regime = pickSignalRegime(featureObj);
  const score = pickSignalScoreExtended(featureObj);
  const confidence = pickSignalConfidence(featureObj);
  const waveConf = pickSignalWaveConf(featureObj);
  const posterior = pickSignalPosterior(featureObj, dir);
  const conflictLong = normalizeBool(featureObj.pro_conflict_long ?? featureObj.conflict_long, false);
  const conflictShort = normalizeBool(featureObj.pro_conflict_short ?? featureObj.conflict_short, false);
  const conflictAny = normalizeBool(featureObj.pro_conflict ?? featureObj.conflict, false);
  const conflictDir = dir === "LONG" ? conflictLong : dir === "SHORT" ? conflictShort : false;
  const scoreDirOk = dir === "LONG"
    ? Number.isFinite(score) ? score >= 0 : true
    : dir === "SHORT"
      ? Number.isFinite(score) ? score <= 0 : true
      : true;
  return {
    featureObj,
    dir,
    tier,
    pineBundle,
    regime,
    score,
    confidence,
    waveConf,
    posterior,
    conflictLong,
    conflictShort,
    conflictAny,
    conflictDir,
    scoreDirOk,
  };
}

function resolvePineStage1BundleMeta(features) {
  const f = (features && typeof features === "object") ? features : {};
  const owner = String(f.pine_stage1_bundle_owner || "").trim().toUpperCase();
  const version = String(f.pine_stage1_bundle_version || "").trim();
  const enabled = normalizeBool(f.pine_stage1_bundle_enabled, false);
  const owned = normalizeBool(f.pine_stage1_bundle_owned, false);
  const stagePass = normalizeBool(f.pine_stage1_bundle_stage_pass, false);
  const qualityRuntime = normalizeBool(f.pine_stage1_bundle_quality_filter_runtime, false);
  const trustedVersion = version === "REGIME_SCORE_CONF_POSTERIOR_WAVE_EV_V2";
  const declaredOwned = enabled === true && owner === "PINE" && owned === true;
  return {
    owner,
    version,
    enabled,
    owned,
    stagePass,
    qualityRuntime,
    declaredOwned,
    trustedVersion,
    trusted: declaredOwned && stagePass === true && qualityRuntime === true && trustedVersion === true,
  };
}

function pickSignalVolRank(features) {
  if (!features || typeof features !== "object") return null;
  const txt = String(features.pro_vol_td_txt_full || features.pro_vol_td_txt || features.vol_td_txt || "").trim();
  if (!txt) return null;
  const lower = txt.toLowerCase();
  if (lower.includes("ultra") || txt.includes("🔥")) return "ultra";
  if (lower.includes("strong") || txt.includes("💚")) return "strong";
  if (lower.includes("weak") || txt.includes("❤️")) return "weak";
  return null;
}

function resolveSignalAssetType({ exchange, features } = {}) {
  const txt = String(features && (features.pro_asset_txt || features.asset_type_txt || features.pro_market_txt) || "");
  if (txt.includes("코인") || txt.includes("Crypto") || txt.includes("Binance")) return "coin";
  if (txt.includes("주식") || txt.includes("ETF") || txt.includes("지수") || txt.includes("FX")) return "stock";
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("BINANCE")) return "coin";
  if (ex.includes("KRX") || ex.includes("KOSPI") || ex.includes("KOSDAQ")) return "stock";
  return "coin";
}

function resolveScoreLevels({ exchange, features } = {}) {
  const asset = resolveSignalAssetType({ exchange, features });
  const coreBuy = asset === "coin" ? 60 : 55;
  const realBuy = asset === "coin" ? 80 : 75;
  return {
    coreBuy,
    realBuy,
    coreSell: -coreBuy,
    realSell: -realBuy,
  };
}

function resolveImmediateEntryConfig(sysCfg = {}) {
  const lookaheadBarsRaw = Math.floor(normalizeNumber(sysCfg.entry_immediate_lookahead_bars, 1));
  const lookaheadBars = Math.max(0, Math.min(1, Number.isFinite(lookaheadBarsRaw) ? lookaheadBarsRaw : 1));
  const coreFraction = clamp(normalizeNumber(sysCfg.entry_immediate_core_fraction, 0.3), 0.05, 0.95);
  return {
    enabled: normalizeBool(sysCfg.entry_immediate_enabled, true),
    lookaheadBars,
    realEnabled: normalizeBool(sysCfg.entry_immediate_real_enabled, true),
    preRealEnabled: normalizeBool(sysCfg.entry_immediate_pre_real_enabled, true),
    coreEnabled: normalizeBool(sysCfg.entry_immediate_core_enabled, true),
    earlyEnabled: normalizeBool(sysCfg.entry_immediate_early_enabled, true),
    coreFraction: Number.isFinite(coreFraction) ? coreFraction : 0.3,
    realScoreMargin: normalizeNumber(sysCfg.entry_immediate_real_score_margin, 5),
    preRealScoreMargin: normalizeNumber(sysCfg.entry_immediate_pre_real_score_margin, 2),
    coreScoreMargin: normalizeNumber(sysCfg.entry_immediate_core_score_margin, 5),
    earlyScoreAbs: Math.max(0, normalizeNumber(sysCfg.entry_immediate_early_score_abs, 20)),
    minRealConf: normalizeNumber(sysCfg.entry_immediate_real_conf_min, 0.65),
    minPreRealConf: normalizeNumber(sysCfg.entry_immediate_pre_real_conf_min, 0.58),
    minCoreConf: normalizeNumber(sysCfg.entry_immediate_core_conf_min, 0.55),
    minEarlyConf: normalizeNumber(sysCfg.entry_immediate_early_conf_min, 0.45),
    minWaveConf: normalizeNumber(sysCfg.entry_immediate_wave_conf_min, 0.65),
    minPreRealWaveConf: normalizeNumber(sysCfg.entry_immediate_pre_real_wave_conf_min, 0.60),
    minEarlyWaveConf: normalizeNumber(sysCfg.entry_immediate_early_wave_conf_min, 0.55),
  };
}

function pickGateSetting(sysCfg, key, legacyKey, fallback = undefined) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const vNew = cfg[key];
  if (vNew !== undefined && vNew !== null && vNew !== "") return vNew;
  if (legacyKey) {
    const vLegacy = cfg[legacyKey];
    if (vLegacy !== undefined && vLegacy !== null && vLegacy !== "") return vLegacy;
  }
  return fallback;
}

const ENTRY_TIMING_TIERS = Object.freeze(["EARLY", "CORE", "PRE_REAL", "REAL"]);

function buildTierNumberMap(values = {}, fallback = null) {
  const out = {};
  for (const tier of ENTRY_TIMING_TIERS) {
    const n = Number(values[tier]);
    out[tier] = Number.isFinite(n) ? n : fallback;
  }
  return out;
}

function pickTierNumber(map, tier, fallback = null) {
  const key = String(tier || "").toUpperCase();
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    const n = Number(map[key]);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function resolveShortEntryGateConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const confMin = clamp(normalizeNumber(pickGateSetting(sysCfg, "gate_conf_min", "short_gate_conf_min", 0.55), 0.55), 0, 1);
  const waveConfMin = clamp(normalizeNumber(pickGateSetting(sysCfg, "gate_wave_conf_min", "short_gate_wave_conf_min", 0.6), 0.6), 0, 1);
  const scoreAbsByTier = buildTierNumberMap({
    EARLY: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_early_score_abs", "short_gate_early_score_abs", 25), 25)),
    CORE: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_core_score_abs", "short_gate_core_score_abs", 35), 35)),
    PRE_REAL: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_pre_real_score_abs", "short_gate_pre_real_score_abs", 40), 40)),
    REAL: Math.max(0, normalizeNumber(pickGateSetting(sysCfg, "gate_real_score_abs", "short_gate_real_score_abs", 45), 45)),
  }, 0);
  return {
    enabled: normalizeBool(pickGateSetting(sysCfg, "gate_enabled", "short_gate_enabled", defaultEnabled), defaultEnabled),
    trendOnly: normalizeBool(pickGateSetting(sysCfg, "gate_trend_only", "short_gate_trend_only", true), true),
    applyCore: normalizeBool(pickGateSetting(sysCfg, "gate_core_enabled", "short_gate_core_enabled", true), true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(pickGateSetting(sysCfg, "gate_early_enabled", "short_gate_early_enabled", false), false),
    scoreAbsByTier,
    minCoreScoreAbs: scoreAbsByTier.CORE,
    minPreRealScoreAbs: scoreAbsByTier.PRE_REAL,
    minRealScoreAbs: scoreAbsByTier.REAL,
    minEarlyScoreAbs: scoreAbsByTier.EARLY,
    minConfidence: Number.isFinite(confMin) ? confMin : 0.55,
    minWaveConf: Number.isFinite(waveConfMin) ? waveConfMin : 0.6,
    blockConflict: normalizeBool(pickGateSetting(sysCfg, "gate_block_conflict", "short_gate_block_conflict", true), true),
    transitionExceptionEnabled: normalizeBool(sysCfg.gate_transition_exception_enabled, true),
    transitionExceptionCoreEnabled: normalizeBool(sysCfg.gate_transition_exception_core_enabled, true),
    transitionExceptionPreRealEnabled: false,
    transitionExceptionRealEnabled: false,
    transitionExceptionEarlyEnabled: normalizeBool(sysCfg.gate_transition_exception_early_enabled, false),
    transitionExceptionScoreAbs: Math.max(0, normalizeNumber(sysCfg.gate_transition_exception_score_abs, 40)),
    transitionExceptionWaveConfMin: Number.isFinite(clamp(normalizeNumber(sysCfg.gate_transition_exception_wave_conf_min, 0.6), 0, 1))
      ? clamp(normalizeNumber(sysCfg.gate_transition_exception_wave_conf_min, 0.6), 0, 1)
      : 0.6,
  };
}

function shouldApplyGateTransitionExceptionByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.transitionExceptionCoreEnabled;
  if (tier === "EARLY") return cfg.transitionExceptionEarlyEnabled;
  return false;
}

function normalizeAiNeutralPolicy(raw, fallback = "allow") {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "allow" || v === "block" || v === "long_only" || v === "short_only") return v;
  return fallback;
}

function resolveAiBiasEntryGateConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const scoreThreshold = Math.max(0, normalizeNumber(sysCfg.ai_bias_gate_score_threshold, 0.01));
  const confMin = clamp(normalizeNumber(sysCfg.ai_bias_gate_conf_min, 0), 0, 1);
  const neutralMult = clamp(normalizeNumber(sysCfg.ai_bias_gate_neutral_mult, 0.5), 0, 1);
  const oppositeMult = clamp(normalizeNumber(sysCfg.ai_bias_gate_opposite_mult, 0.35), 0, 1);
  const strongOppositeScore = clamp(normalizeNumber(sysCfg.ai_bias_gate_strong_opposite_score, 0.2), 0, 1);
  const strongOppositeConf = clamp(normalizeNumber(sysCfg.ai_bias_gate_strong_opposite_conf, 0.55), 0, 1);
  return {
    enabled: normalizeBool(sysCfg.ai_bias_gate_enabled, defaultEnabled),
    neutralPolicy: normalizeAiNeutralPolicy(sysCfg.ai_bias_gate_neutral_policy, "allow"),
    applyCore: normalizeBool(sysCfg.ai_bias_gate_core_enabled, true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(sysCfg.ai_bias_gate_early_enabled, false),
    applyEmo: normalizeBool(sysCfg.ai_bias_gate_emo_enabled, false),
    scoreThreshold: Number.isFinite(scoreThreshold) ? scoreThreshold : 0.01,
    confMin: Number.isFinite(confMin) ? confMin : 0,
    neutralMult: Number.isFinite(neutralMult) ? neutralMult : 0.5,
    oppositeMult: Number.isFinite(oppositeMult) ? oppositeMult : 0.35,
    strongOppositeScore: Number.isFinite(strongOppositeScore) ? strongOppositeScore : 0.2,
    strongOppositeConf: Number.isFinite(strongOppositeConf) ? strongOppositeConf : 0.55,
  };
}

function shouldApplyAiBiasEntryGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY") return cfg.applyEarly;
  if (isEmoEventName(eventUpper)) return cfg.applyEmo;
  return false;
}

function deriveAiBiasDirection(sideAllocation, cfg) {
  const side = (sideAllocation && typeof sideAllocation === "object") ? sideAllocation : null;
  const score = Number(side && side.biasScore);
  const confidence = Number(side && side.biasConfidence);
  const rawDir = String(side && side.biasDirection || "").toUpperCase();
  const threshold = Number.isFinite(cfg && cfg.scoreThreshold) ? Math.max(0, cfg.scoreThreshold) : 0;
  const confMin = Number.isFinite(cfg && cfg.confMin) ? Math.max(0, cfg.confMin) : 0;

  if (confMin > 0 && Number.isFinite(confidence) && confidence < confMin) {
    return { dir: "NEUTRAL", score: Number.isFinite(score) ? score : null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (rawDir === "LONG" || rawDir === "SHORT") {
    return { dir: rawDir, score: Number.isFinite(score) ? score : null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (!Number.isFinite(score)) {
    return { dir: "NEUTRAL", score: null, confidence: Number.isFinite(confidence) ? confidence : null };
  }
  if (threshold > 0 && score >= threshold) return { dir: "LONG", score, confidence: Number.isFinite(confidence) ? confidence : null };
  if (threshold > 0 && score <= -threshold) return { dir: "SHORT", score, confidence: Number.isFinite(confidence) ? confidence : null };
  return { dir: "NEUTRAL", score, confidence: Number.isFinite(confidence) ? confidence : null };
}

function evaluateAiBiasEntryGate({ intent, intentDir, eventUpper, features, cfg, riskBudget } = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true, action: "ALLOW", qtyScale: 1 };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (!shouldApplyAiBiasEntryGateByEvent(eventUpper, cfg, features)) return { ok: true, action: "ALLOW", qtyScale: 1 };

  const ai = deriveAiBiasDirection(riskBudget && riskBudget.sideAllocation, cfg);
  const marketState = resolveMarketStateSummary(features);
  const entropy = marketState.entropy;
  const coherence = marketState.coherence;
  const transitionRisk = marketState.transitionRisk;
  const fieldAlignment = marketState.fieldAlignment;
  const domainWallDensity = marketState.domainWallDensity;
  const susceptibility = marketState.susceptibility;
  const freeEnergy = marketState.freeEnergy;
  let reason = null;
  let qtyScale = 1;
  let action = "ALLOW";
  const absScore = Math.abs(Number(ai.score));
  const conf = Number(ai.confidence);
  const strongOpposite = Number.isFinite(absScore)
    && absScore >= Number(cfg.strongOppositeScore)
    && Number.isFinite(conf)
    && conf >= Number(cfg.strongOppositeConf);

  if (ai.dir === "LONG" && dir === "SHORT") {
    reason = strongOpposite ? "DROP_AI_BIAS_OPPOSITE_LONG" : null;
    qtyScale = strongOpposite ? 0 : Number(cfg.oppositeMult);
    action = strongOpposite ? "DROP" : "REDUCE";
  } else if (ai.dir === "SHORT" && dir === "LONG") {
    reason = strongOpposite ? "DROP_AI_BIAS_OPPOSITE_SHORT" : null;
    qtyScale = strongOpposite ? 0 : Number(cfg.oppositeMult);
    action = strongOpposite ? "DROP" : "REDUCE";
  }
  else if (ai.dir === "NEUTRAL") {
    if (cfg.neutralPolicy === "block") reason = "DROP_AI_BIAS_NEUTRAL_BLOCK";
    else if (cfg.neutralPolicy === "long_only" && dir === "SHORT") reason = "DROP_AI_BIAS_NEUTRAL_LONG_ONLY";
    else if (cfg.neutralPolicy === "short_only" && dir === "LONG") reason = "DROP_AI_BIAS_NEUTRAL_SHORT_ONLY";
    else {
      qtyScale = Number(cfg.neutralMult);
      action = qtyScale < 0.9999 ? "REDUCE" : "ALLOW";
    }
  }

  let physicsScale = 1;
  let physicsAction = "ALLOW";
  if (!reason) {
    physicsScale = Number.isFinite(Number(marketState.physicsQtyScale))
      ? Math.max(0, Math.min(1, Number(marketState.physicsQtyScale)))
      : 1;
    physicsAction = marketState.physicsAction || "ALLOW";
    if (marketState.physicsDrop === true || physicsAction === "DROP" || physicsScale <= 0) {
      reason = "DROP_MARKET_PHYSICS_DISORDER";
      physicsAction = "DROP";
    }
  }

  qtyScale = Math.max(0, Math.min(Number.isFinite(qtyScale) ? qtyScale : 1, physicsScale));
  if (!reason) {
    if (qtyScale <= 0) action = "DROP";
    else if (qtyScale < 0.9999 || physicsAction === "REDUCE") action = "REDUCE";
  }

  if (!reason) {
    return {
      ok: true,
      action,
      qtyScale: Number.isFinite(qtyScale) ? Math.max(0, qtyScale) : 1,
      detail: {
        ai_bias_dir: ai.dir,
        ai_bias_score: ai.score,
        ai_bias_confidence: ai.confidence,
        ai_bias_gate_action: action,
        ai_bias_gate_qty_scale: Number.isFinite(qtyScale) ? Math.max(0, qtyScale) : 1,
        ai_bias_gate_neutral_mult: cfg.neutralMult,
        ai_bias_gate_opposite_mult: cfg.oppositeMult,
        ai_bias_gate_strong_opposite_score: cfg.strongOppositeScore,
        ai_bias_gate_strong_opposite_conf: cfg.strongOppositeConf,
        sp_entropy_score: Number.isFinite(entropy) ? entropy : null,
        sp_coherence_score: Number.isFinite(coherence) ? coherence : null,
        sp_transition_risk: Number.isFinite(transitionRisk) ? transitionRisk : null,
        sp_field_alignment: Number.isFinite(fieldAlignment) ? fieldAlignment : null,
        sp_domain_wall_density: Number.isFinite(domainWallDensity) ? domainWallDensity : null,
        sp_susceptibility: Number.isFinite(susceptibility) ? susceptibility : null,
        sp_free_energy: Number.isFinite(freeEnergy) ? freeEnergy : null,
        sp_state: marketState.state || null,
        market_state_regime: marketState.regime,
        market_state_summary_state: marketState.state || null,
        market_state_summary_action: marketState.physicsAction,
        market_state_summary_qty_scale: marketState.physicsQtyScale,
        market_state_structural_critical: marketState.structuralCritical === true,
        market_physics_qty_scale: physicsScale,
        market_physics_action: physicsAction,
      },
    };
  }

  return {
    ok: false,
    action: "DROP",
    qtyScale: 0,
    reason,
    detail: {
      ai_bias_dir: ai.dir,
      ai_bias_score: ai.score,
      ai_bias_confidence: ai.confidence,
      ai_bias_policy: cfg.neutralPolicy,
      ai_bias_conf_min: cfg.confMin,
      ai_bias_score_threshold: cfg.scoreThreshold,
      ai_bias_gate_action: "DROP",
      ai_bias_gate_qty_scale: 0,
      ai_bias_gate_neutral_mult: cfg.neutralMult,
      ai_bias_gate_opposite_mult: cfg.oppositeMult,
      ai_bias_gate_strong_opposite_score: cfg.strongOppositeScore,
      ai_bias_gate_strong_opposite_conf: cfg.strongOppositeConf,
      sp_entropy_score: Number.isFinite(entropy) ? entropy : null,
      sp_coherence_score: Number.isFinite(coherence) ? coherence : null,
      sp_transition_risk: Number.isFinite(transitionRisk) ? transitionRisk : null,
      sp_field_alignment: Number.isFinite(fieldAlignment) ? fieldAlignment : null,
      sp_domain_wall_density: Number.isFinite(domainWallDensity) ? domainWallDensity : null,
      sp_susceptibility: Number.isFinite(susceptibility) ? susceptibility : null,
      sp_free_energy: Number.isFinite(freeEnergy) ? freeEnergy : null,
      sp_state: marketState.state || null,
      market_state_regime: marketState.regime,
      market_state_summary_state: marketState.state || null,
      market_state_summary_action: marketState.physicsAction,
      market_state_summary_qty_scale: marketState.physicsQtyScale,
      market_state_structural_critical: marketState.structuralCritical === true,
      market_physics_qty_scale: physicsScale,
      market_physics_action: physicsAction,
    },
  };
}

function resolveAddRiskConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCEFUT");
  const enabled = normalizeBool(sysCfg.add_guard_enabled, defaultEnabled);
  const softDrawdownRaw = normalizeNumber(sysCfg.add_guard_soft_drawdown_pct, -0.004);
  const hardDrawdownRaw = normalizeNumber(sysCfg.add_guard_hard_drawdown_pct, -0.01);
  const softDrawdownPct = softDrawdownRaw > 0 ? -softDrawdownRaw : softDrawdownRaw;
  const hardDrawdownPct = hardDrawdownRaw > 0 ? -hardDrawdownRaw : hardDrawdownRaw;
  const softScaleRaw = clamp(normalizeNumber(sysCfg.add_guard_soft_scale, 0.75), 0.05, 1.0);
  const hardScaleRaw = clamp(normalizeNumber(sysCfg.add_guard_hard_scale, 0.50), 0.05, 1.0);
  const softScale = Number.isFinite(softScaleRaw) ? softScaleRaw : 0.75;
  const hardScale = Number.isFinite(hardScaleRaw) ? hardScaleRaw : 0.50;
  const minQtyRaw = clamp(normalizeNumber(sysCfg.add_guard_min_qty_fraction, 0.003), 0.0001, 1.0);
  const minQtyFraction = Number.isFinite(minQtyRaw) ? minQtyRaw : 0.003;
  const maxLossStreakRaw = normalizeInt(sysCfg.add_guard_max_loss_streak, null);
  const maxLossStreak = Number.isFinite(maxLossStreakRaw) && maxLossStreakRaw > 0
    ? Math.max(1, maxLossStreakRaw)
    : null;
  const dayLossCapRaw = normalizeNumber(sysCfg.add_guard_day_loss_cap_krw, null);
  const dayLossCapKrw = Number.isFinite(dayLossCapRaw) && dayLossCapRaw > 0 ? dayLossCapRaw : null;
  const blockHardDrawdown = normalizeBool(sysCfg.add_guard_block_hard_drawdown, false);
  return {
    enabled,
    softDrawdownPct,
    hardDrawdownPct,
    softScale,
    hardScale,
    minQtyFraction,
    maxLossStreak,
    dayLossCapKrw,
    blockHardDrawdown,
  };
}

function toUtcDayKey(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function resolveAddGuardState(posMeta, barCloseMs) {
  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const dayKey = toUtcDayKey(barCloseMs) || String(meta.add_guard_day_key || "") || null;
  const storedDayKey = String(meta.add_guard_day_key || "");
  const dayChanged = !!dayKey && storedDayKey !== dayKey;
  const basePnl = Number(meta.add_guard_day_pnl_krw);
  const baseLossStreak = Number(meta.add_guard_day_loss_streak);
  const baseRealizedN = Number(meta.add_guard_day_realized_n);
  const addChainCountRaw = Number(meta.add_chain_count);
  return {
    dayKey,
    dayChanged,
    dayPnl: dayChanged ? 0 : (Number.isFinite(basePnl) ? basePnl : 0),
    lossStreak: dayChanged ? 0 : (Number.isFinite(baseLossStreak) ? Math.max(0, Math.trunc(baseLossStreak)) : 0),
    realizedN: dayChanged ? 0 : (Number.isFinite(baseRealizedN) ? Math.max(0, Math.trunc(baseRealizedN)) : 0),
    addChainCount: Number.isFinite(addChainCountRaw) ? Math.max(0, Math.trunc(addChainCountRaw)) : 0,
  };
}

function evaluateAddIntentRiskGuard({
  cfg,
  intent,
  position,
  posMeta,
  bar,
  barCloseMs,
  qtyFraction,
} = {}) {
  if (!cfg || cfg.enabled !== true || intent !== "ADD") return { ok: true, qtyScale: 1 };
  const pos = position || {};
  const size = Number(pos.size_pct || 0);
  if (!Number.isFinite(size) || size <= POS_SIZE_EPSILON) return { ok: true, qtyScale: 1 };
  const state = resolveAddGuardState(posMeta, barCloseMs);
  if (Number.isFinite(cfg.dayLossCapKrw) && state.dayPnl <= -cfg.dayLossCapKrw) {
    return {
      ok: false,
      reason: "DROP_ADD_DAY_LOSS_CAP",
      detail: { day_pnl_krw: state.dayPnl, day_loss_cap_krw: cfg.dayLossCapKrw },
    };
  }
  if (Number.isFinite(cfg.maxLossStreak) && state.lossStreak >= cfg.maxLossStreak) {
    return {
      ok: false,
      reason: "DROP_ADD_DAY_STREAK",
      detail: { day_loss_streak: state.lossStreak, max_loss_streak: cfg.maxLossStreak },
    };
  }
  const side = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || "LONG";
  const leverageEff = resolvePositionLeverage({ position: pos, fallback: 1 });
  const rawUpnlPct = computeUnrealizedPnlPct({ position: pos, bar, positionSide: side });
  const upnlPct = Number.isFinite(rawUpnlPct)
    ? (rawUpnlPct * (Number.isFinite(leverageEff) && leverageEff > 0 ? leverageEff : 1))
    : null;
  let qtyScale = 1;
  if (Number.isFinite(upnlPct)) {
    if (upnlPct <= cfg.hardDrawdownPct) {
      if (cfg.blockHardDrawdown) {
        return {
          ok: false,
          reason: "DROP_ADD_DRAWDOWN_HARD",
          detail: { upnl_pct: upnlPct, hard_drawdown_pct: cfg.hardDrawdownPct },
        };
      }
      qtyScale = Math.min(qtyScale, cfg.hardScale);
    } else if (upnlPct <= cfg.softDrawdownPct) {
      qtyScale = Math.min(qtyScale, cfg.softScale);
    }
  }
  const scaledQty = Number(qtyFraction) * qtyScale;
  if (!Number.isFinite(scaledQty) || scaledQty <= 0) {
    return {
      ok: false,
      reason: "DROP_ADD_QTY_INVALID",
      detail: { qty_fraction: qtyFraction, qty_scale: qtyScale },
    };
  }
  if (scaledQty < cfg.minQtyFraction) {
    return {
      ok: false,
      reason: "DROP_ADD_QTY_TOO_SMALL",
      detail: { scaled_qty: scaledQty, min_qty_fraction: cfg.minQtyFraction, upnl_pct: upnlPct },
    };
  }
  return {
    ok: true,
    qtyScale,
    upnlPct: Number.isFinite(upnlPct) ? upnlPct : null,
    rawUpnlPct: Number.isFinite(rawUpnlPct) ? rawUpnlPct : null,
    leverageEff: Number.isFinite(leverageEff) ? leverageEff : null,
    dayPnl: state.dayPnl,
    lossStreak: state.lossStreak,
  };
}

function applyAddRiskMetaOnFill({
  posMeta,
  intent,
  event,
  barCloseMs,
  realizedPnlQuote,
  opening,
  closing,
} = {}) {
  let next = (posMeta && typeof posMeta === "object") ? { ...posMeta } : {};
  const state = resolveAddGuardState(next, barCloseMs);
  if (state.dayKey) {
    next = mergeMeta(next, {
      add_guard_day_key: state.dayKey,
      add_guard_day_pnl_krw: state.dayPnl,
      add_guard_day_loss_streak: state.lossStreak,
      add_guard_day_realized_n: state.realizedN,
    });
  }

  if (intent === "ENTRY" && opening) {
    next = mergeMeta(next, {
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      add_chain_last_event: null,
    });
  } else if (intent === "ADD") {
    const addCount = Number(next.add_chain_count);
    next = mergeMeta(next, {
      add_chain_count: (Number.isFinite(addCount) ? Math.max(0, Math.trunc(addCount)) : 0) + 1,
      add_chain_active: true,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      add_chain_last_event: String(event || "").toUpperCase() || null,
    });
  }

  if (intent === "EXIT" && Number.isFinite(realizedPnlQuote)) {
    const chainCount = Number(next.add_chain_count);
    const fromAddChain = Number.isFinite(chainCount) && chainCount > 0;
    if (fromAddChain) {
      const s = resolveAddGuardState(next, barCloseMs);
      const dayPnl = s.dayPnl + Number(realizedPnlQuote);
      const realizedN = s.realizedN + 1;
      const lossStreak = Number(realizedPnlQuote) < 0 ? (s.lossStreak + 1) : 0;
      next = mergeMeta(next, {
        add_guard_day_key: s.dayKey,
        add_guard_day_pnl_krw: dayPnl,
        add_guard_day_loss_streak: lossStreak,
        add_guard_day_realized_n: realizedN,
        add_guard_last_realized_krw: Number(realizedPnlQuote),
        add_guard_last_realized_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
      });
    }
  }

  if (closing) {
    next = mergeMeta(next, {
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : null,
    });
  }
  return next;
}

function applyAddAndProtectionMetaOnFill({
  posMeta,
  intent,
  event,
  barCloseMs,
  realizedPnlQuote,
  opening,
  closing,
  signalBarCloseMs,
  intentId,
  signalId,
  avgBefore,
  avgAfter,
  sizeBefore,
  sizeAfter,
  qtyPct,
  qtyBase,
  lossPct,
  nativeProtectionMetaPatch,
} = {}) {
  let nextMeta = applyAddRiskMetaOnFill({
    posMeta,
    intent,
    event,
    barCloseMs,
    realizedPnlQuote,
    opening,
    closing,
  });
  if (intent === "ADD") {
    nextMeta = mergeMeta(nextMeta, {
      add_chain_last_signal_bar_ms: Number.isFinite(Number(signalBarCloseMs)) ? Number(signalBarCloseMs) : Number(barCloseMs),
      add_chain_last_intent_id: intentId || null,
      add_chain_last_signal_id: signalId || null,
      add_chain_last_avg_before: Number.isFinite(Number(avgBefore)) ? Number(avgBefore) : null,
      add_chain_last_avg_after: Number.isFinite(Number(avgAfter)) ? Number(avgAfter) : null,
      add_chain_last_size_before: Number.isFinite(Number(sizeBefore)) ? Number(sizeBefore) : null,
      add_chain_last_size_after: Number.isFinite(Number(sizeAfter)) ? Number(sizeAfter) : null,
      add_chain_last_qty_pct: Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : null,
      add_chain_last_qty_base: Number.isFinite(Number(qtyBase)) ? Number(qtyBase) : null,
      add_chain_last_loss_pct: Number.isFinite(Number(lossPct)) ? Number(lossPct) : null,
    });
  }
  if (nativeProtectionMetaPatch) {
    nextMeta = mergeMeta(nextMeta, nativeProtectionMetaPatch);
  }
  return nextMeta;
}

async function maybeWriteV2ShadowEntryBootstrap({
  exchange,
  symbol,
  tf,
  intent,
  opening,
  newState,
  nextPosSide,
  fillPrice,
  newQtyBase,
  execQtyBase,
  intentRow,
  fillWrite,
  linkedTradeId,
  liveOrderId,
  entryEventIdForFill,
  execBarCloseMs,
  projectedMetaForWrite,
} = {}) {
  if (String(intent || "").toUpperCase() !== "ENTRY") {
    return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_BOOTSTRAP_NON_ENTRY" };
  }
  if (opening !== true || String(newState || "").toUpperCase() !== "ACTIVE") {
    return { ok: true, written: false, skipped: true, reason: "V2_SHADOW_BOOTSTRAP_NOT_OPENING" };
  }
  try {
    const it = intentRow && typeof intentRow === "object" ? intentRow : {};
    const features = it.features_json && typeof it.features_json === "object" ? it.features_json : {};
    const signalId = it.signal_id || features.signal_id || null;
    const signalDocId = it.signal_doc_id || features.signal_doc_id || null;
    const positionSide = normalizePositionSide(nextPosSide || it.side || features._position_side || null);
    const entryQtyAbs = Number.isFinite(Number(newQtyBase)) && Number(newQtyBase) > 0
      ? Number(newQtyBase)
      : (Number.isFinite(Number(execQtyBase)) && Number(execQtyBase) > 0 ? Number(execQtyBase) : null);
    return await writeOpenClawShadowEntryBootstrap({
      input: {
        exchange,
        symbol,
        side: positionSide,
        signalTf: tf,
        signalId,
        signalDocId,
        sourceOrigin: features.source_origin || features.canonical_engine_candidate_source || null,
        barCloseMs: Number.isFinite(Number(it.signal_bar_close_time_utc_ms))
          ? Number(it.signal_bar_close_time_utc_ms)
          : Number(execBarCloseMs),
        nowMs: Date.now(),
        features,
      },
      fillContext: {
        symbol,
        positionSide,
        entryPrice: fillPrice,
        entryQtyAbs,
        entryEventId: entryEventIdForFill,
        entryOrderId: liveOrderId || it.live_order_id || it.intent_id || linkedTradeId,
        entryFillGroupId: (fillWrite && fillWrite.fill_id) || linkedTradeId || it.intent_id || entryEventIdForFill,
        entryIntentId: it.intent_id || null,
        protectionMeta: projectedMetaForWrite || {},
      },
    });
  } catch (error) {
    console.warn("[V2_SHADOW_ENTRY_BOOTSTRAP_FAIL]", {
      exchange: upper(exchange),
      symbol: upper(symbol),
      reason: error && error.message ? error.message : String(error),
    });
    return { ok: false, written: false, skipped: false, reason: error && error.message ? error.message : String(error) };
  }
}

function evaluateCommittedRescueAddGate({
  applied,
  pendingAddCount,
  pendingAddSignalBarMs,
  signalBarCloseMs,
  maxAdds,
  sameBarBlock,
  replay = false,
} = {}) {
  if (applied !== true) return { ok: true };
  const prefix = replay ? "REPLAY_RESCUE_ADD" : "LIVE_RESCUE_ADD";
  const effectiveAddCount = Number.isFinite(Number(pendingAddCount))
    ? Math.max(0, Math.trunc(Number(pendingAddCount)))
    : 0;
  const resolvedMaxAdds = Number.isFinite(Number(maxAdds))
    ? Math.max(0, Math.trunc(Number(maxAdds)))
    : 1;
  if (effectiveAddCount >= resolvedMaxAdds) {
    return {
      ok: false,
      reason: `${prefix}_LIMIT_BLOCKED`,
      detail: {
        add_count: effectiveAddCount,
        max_adds: resolvedMaxAdds,
      },
    };
  }
  const signalMs = Number(signalBarCloseMs);
  const pendingMs = Number(pendingAddSignalBarMs);
  if (sameBarBlock === true && Number.isFinite(signalMs) && Number.isFinite(pendingMs) && signalMs === pendingMs) {
    return {
      ok: false,
      reason: `${prefix}_SAME_BAR_BLOCKED`,
      detail: {
        add_count: effectiveAddCount,
        max_adds: resolvedMaxAdds,
        pending_signal_bar_ms: pendingMs,
      },
    };
  }
  return { ok: true };
}

function shouldApplyShortEntryGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY") return cfg.applyEarly;
  return false;
}

function evaluateShortEntryGate({ intent, intentDir, eventUpper, features, cfg } = {}) {
  if (!cfg || !cfg.enabled) return { ok: true };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "SHORT" && dir !== "LONG") return { ok: true };
  if (!shouldApplyShortEntryGateByEvent(eventUpper, cfg, features)) return { ok: true };

  const structure = resolveEntryStructureSnapshot({ features, intentDir: dir, eventUpper });
  if (structure.pineBundle.trusted) {
    return {
      ok: true,
      detail: {
        pine_stage1_bundle_trusted: true,
        pine_stage1_bundle_owner: structure.pineBundle.owner,
        pine_stage1_bundle_version: structure.pineBundle.version,
      },
    };
  }
  const reasonPrefix = dir === "LONG" ? "DROP_LONG_GATE" : "DROP_SHORT_GATE";

  if (cfg.trendOnly && structure.regime && structure.regime !== "trend") {
    const transitionAllowed =
      cfg.transitionExceptionEnabled === true &&
      structure.regime === "transition" &&
      shouldApplyGateTransitionExceptionByEvent(eventUpper, cfg, features) &&
      structure.scoreDirOk &&
      Number.isFinite(structure.score) &&
      Math.abs(structure.score) >= cfg.transitionExceptionScoreAbs &&
      Number.isFinite(structure.waveConf) &&
      structure.waveConf >= cfg.transitionExceptionWaveConfMin;
    if (transitionAllowed) {
      return {
        ok: true,
        detail: {
          gate_transition_exception: true,
          gate_transition_exception_dir: dir,
          gate_transition_exception_regime: structure.regime,
          gate_transition_exception_reason: `${reasonPrefix}_TRANSITION_EXCEPTION`,
        },
      };
    }
    return {
      ok: false,
      reason: `${reasonPrefix}_REGIME`,
      detail: { regime: structure.regime, required: "trend" },
    };
  }

  if (cfg.blockConflict && (structure.conflictDir === true || structure.conflictAny === true)) {
    return {
      ok: false,
      reason: `${reasonPrefix}_CONFLICT`,
      detail: {
        conflict_long: structure.conflictLong,
        conflict_short: structure.conflictShort,
        conflict_any: structure.conflictAny,
      },
    };
  }

  const scoreAbsMin = pickTierNumber(cfg.scoreAbsByTier, structure.tier, 0);

  if ((Number.isFinite(structure.score) && Math.abs(structure.score) < scoreAbsMin) || !structure.scoreDirOk) {
    return {
      ok: false,
      reason: `${reasonPrefix}_SCORE`,
      detail: { score: structure.score, min_score_abs: scoreAbsMin, dir },
    };
  }

  if (Number.isFinite(structure.confidence) && structure.confidence < cfg.minConfidence) {
    return {
      ok: false,
      reason: `${reasonPrefix}_CONF`,
      detail: { confidence: structure.confidence, min_confidence: cfg.minConfidence },
    };
  }

  if (Number.isFinite(structure.waveConf) && structure.waveConf < cfg.minWaveConf) {
    return {
      ok: false,
      reason: `${reasonPrefix}_WAVE`,
      detail: { wave_conf: structure.waveConf, min_wave_conf: cfg.minWaveConf },
    };
  }

  return { ok: true };
}

function resolveEntryQualityGateConfig(sysCfg = {}, exchange = "") {
  const defaultEnabled = false;
  const enabled = normalizeBool(sysCfg.entry_quality_gate_enabled, defaultEnabled);
  const requireTrend = normalizeBool(sysCfg.entry_quality_gate_require_trend, false);
  const disallowRange = normalizeBool(sysCfg.entry_quality_gate_disallow_range, true);
  const blockConflict = normalizeBool(sysCfg.entry_quality_gate_block_conflict, true);
  const requirePosterior = normalizeBool(sysCfg.entry_quality_gate_require_posterior, false);
  const requireConfidence = normalizeBool(sysCfg.entry_quality_gate_require_confidence, false);
  const requireWaveConf = normalizeBool(sysCfg.entry_quality_gate_require_wave_conf, false);
  const scoreAbsByTier = buildTierNumberMap({
    EARLY: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_early, 16)),
    CORE: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_core, 24)),
    PRE_REAL: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_pre_real, 30)),
    REAL: Math.max(0, normalizeNumber(sysCfg.entry_quality_min_score_real, 36)),
  }, 0);
  const posteriorByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_early, 0.52), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_core, 0.55), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_pre_real, 0.58), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_posterior_real, 0.60), 0, 1),
  }, null);
  const confidenceByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_early, 0.50), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_core, 0.55), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_pre_real, 0.58), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_confidence_real, 0.62), 0, 1),
  }, null);
  const waveConfByTier = buildTierNumberMap({
    EARLY: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_early, 0.52), 0, 1),
    CORE: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_core, 0.56), 0, 1),
    PRE_REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_pre_real, 0.60), 0, 1),
    REAL: clamp(normalizeNumber(sysCfg.entry_quality_min_wave_conf_real, 0.64), 0, 1),
  }, null);
  return {
    enabled,
    requireTrend,
    disallowRange,
    blockConflict,
    requirePosterior,
    requireConfidence,
    requireWaveConf,
    scoreAbsByTier,
    posteriorByTier,
    confidenceByTier,
    waveConfByTier,
    minScoreAbsEarly: scoreAbsByTier.EARLY,
    minScoreAbsCore: scoreAbsByTier.CORE,
    minScoreAbsPreReal: scoreAbsByTier.PRE_REAL,
    minScoreAbsReal: scoreAbsByTier.REAL,
    minPosteriorEarly: posteriorByTier.EARLY,
    minPosteriorCore: posteriorByTier.CORE,
    minPosteriorPreReal: posteriorByTier.PRE_REAL,
    minPosteriorReal: posteriorByTier.REAL,
    minConfidenceEarly: confidenceByTier.EARLY,
    minConfidenceCore: confidenceByTier.CORE,
    minConfidencePreReal: confidenceByTier.PRE_REAL,
    minConfidenceReal: confidenceByTier.REAL,
    minWaveConfEarly: waveConfByTier.EARLY,
    minWaveConfCore: waveConfByTier.CORE,
    minWaveConfPreReal: waveConfByTier.PRE_REAL,
    minWaveConfReal: waveConfByTier.REAL,
  };
}

function resolveEntryQualityTier(eventUpper, features) {
  // Tier semantics SSOT:
  // /Users/jeongjaeyong/Projects/donbeolja/docs/SIGNAL_TIER_DEFINITION.md
  // Keep Pine and server tier meaning aligned before changing this mapping.
  const tier = resolveSignalTier(eventUpper, features);
  if (tier) return tier;
  // EMO also uses score/posterior/wave quality gates (EARLY tier threshold).
  if (isEmoEventName(eventUpper)) return "EARLY";
  return null;
}

function normalizeMarketProbMap(raw = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out = {};
  for (const [market, value] of Object.entries(raw)) {
    const key = String(market || "").trim().toUpperCase();
    const n = clamp(normalizeNumber(value, null), 0, 1);
    if (!key || !Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
}

function parseTimeMs(raw) {
  if (raw == null || raw === "") return null;
  if (Number.isFinite(Number(raw))) return Number(raw);
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function readJsonSafe(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function resolveEvGateUnknownGenRelaxMode(sysCfg = {}) {
  const enabled = normalizeBool(sysCfg.ev_gate_unknown_gen_relax_enabled, false);
  const startMs = parseTimeMs(sysCfg.ev_gate_unknown_gen_relax_started_at_ms || sysCfg.ev_gate_unknown_gen_relax_started_at);
  const windowHours = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_window_hours, 6), 1, 24);
  const reviewAfterHours = clamp(
    normalizeNumber(
      sysCfg.ev_gate_unknown_gen_relax_review_after_hours,
      normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_rollback_after_hours, 4)
    ),
    1,
    windowHours
  );
  const minDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_min_delta, 0.04), 0, 0.20);
  const fullDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_full_delta, 0.03), 0, 0.20);
  const killDelta = clamp(normalizeNumber(sysCfg.ev_gate_unknown_gen_relax_tp1_prob_kill_delta, 0.02), 0, 0.20);
  const nowMs = Date.now();
  const ageHours = Number.isFinite(startMs) ? ((nowMs - startMs) / 3600000) : null;
  const windowActive = enabled && Number.isFinite(startMs) && ageHours < windowHours;
  const reviewDue = enabled && Number.isFinite(ageHours) && ageHours >= reviewAfterHours;
  let status = "DISABLED";
  if (enabled && !Number.isFinite(startMs)) status = "PENDING_START";
  else if (enabled && reviewDue) status = "MANUAL_REVIEW_DUE";
  else if (enabled && windowActive) status = "ACTIVE";
  else if (enabled && Number.isFinite(startMs) && ageHours >= windowHours) status = "MONITOR_WINDOW_ELAPSED";
  else if (enabled) status = "IDLE";
  return {
    enabled,
    status,
    active: enabled,
    enforcementMode: enabled ? "REPORT_ONLY" : "DISABLED",
    startMs,
    ageHours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(4)) : null,
    windowHours,
    reviewAfterHours,
    minDelta,
    fullDelta,
    killDelta,
    reviewDue,
    autoRollbackEnabled: false,
  };
}

function pickFirstUpper(source = {}, keys = []) {
  for (const key of keys) {
    const value = String(source && source[key] || "").trim().toUpperCase();
    if (value) return value;
  }
  return null;
}

function resolveEvGateConfig(sysCfg = {}, exchange = "", market = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  const marketKey = String(market || "").trim().toUpperCase();
  const globalReportOnlyEnabled = normalizeBool(sysCfg.ev_gate_global_report_only_enabled, true);
  const tp1ProbMinGlobal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min, 0.55), 0, 1);
  const tp1ProbMinByMarket = normalizeMarketProbMap(sysCfg.ev_gate_tp1_prob_min_by_market);
  const tp1ProbMinByMarketReportOnly = normalizeMarketProbMap(sysCfg.ev_gate_tp1_prob_min_by_market_report_only);
  const reportOnlyEnabled = normalizeBool(sysCfg.ev_gate_tp1_prob_min_by_market_report_only_enabled, false);
  const cohortReportOnlyEnabled = normalizeBool(sysCfg.ev_gate_tp1_prob_min_report_only_cohort_enabled, false);
  const cohortReportOnlyThreshold = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_report_only_cohort, null), 0, 1);
  const marketOverrideActive = marketKey && Number.isFinite(tp1ProbMinByMarket[marketKey]);
  const marketReportOnlyOverrideActive = !marketOverrideActive && reportOnlyEnabled && marketKey && Number.isFinite(tp1ProbMinByMarketReportOnly[marketKey]);
  const cohortReportOnlyActive = !marketOverrideActive
    && !marketReportOnlyOverrideActive
    && cohortReportOnlyEnabled
    && Number.isFinite(cohortReportOnlyThreshold);
  const tp1ProbMin = marketOverrideActive
    ? tp1ProbMinByMarket[marketKey]
    : (
      marketReportOnlyOverrideActive
        ? tp1ProbMinByMarketReportOnly[marketKey]
        : (
          cohortReportOnlyActive
            ? Math.min(tp1ProbMinGlobal, cohortReportOnlyThreshold)
            : tp1ProbMinGlobal
        )
    );
  const tierEarly = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_early, tp1ProbMin), 0, 1);
  const tierCore = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_core, tp1ProbMin), 0, 1);
  const tierPreReal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_pre_real, tp1ProbMin), 0, 1);
  const tierReal = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_min_real, tp1ProbMin), 0, 1);
  const effectiveThresholdOverrideActive = marketOverrideActive || marketReportOnlyOverrideActive || cohortReportOnlyActive;
  const tp1ProbMinEarly = effectiveThresholdOverrideActive ? Math.min(tierEarly, tp1ProbMin) : tierEarly;
  const tp1ProbMinCore = effectiveThresholdOverrideActive ? Math.min(tierCore, tp1ProbMin) : tierCore;
  const tp1ProbMinPreReal = effectiveThresholdOverrideActive ? Math.min(tierPreReal, tp1ProbMin) : tierPreReal;
  const tp1ProbMinReal = effectiveThresholdOverrideActive ? Math.min(tierReal, tp1ProbMin) : tierReal;
  const tp1ProbFull = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_full, Math.max(0.60, tp1ProbMin)), 0, 1);
  const tp1ProbKill = clamp(normalizeNumber(sysCfg.ev_gate_tp1_prob_kill, 0.50), 0, 1);
  const qtyScaleMid = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_mid, 0.70), 0, 1);
  const qtyScaleLow = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_low, 0.40), 0, 1);
  const pointPassKillRescueEnabled = normalizeBool(sysCfg.ev_gate_point_pass_kill_rescue_enabled, true);
  const pointPassKillRescueMargin = clamp(normalizeNumber(sysCfg.ev_gate_point_pass_kill_rescue_margin, 0.06), 0, 0.25);
  const qtyScaleKillRescueRaw = clamp(normalizeNumber(sysCfg.ev_gate_qty_scale_kill_rescue, Math.min(qtyScaleLow, 0.25)), 0, 1);
  const qtyScaleKillRescue = Math.min(qtyScaleLow, qtyScaleKillRescueRaw);
  const lookbackBars = Math.max(8, Math.min(24, normalizeInt(sysCfg.ev_gate_lookback_bars, 12)));
  const atrBars = Math.max(4, Math.min(lookbackBars - 1, normalizeInt(sysCfg.ev_gate_atr_bars, 8)));
  const defaultTp0Pct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_tp0_pct, 0.8));
  const defaultTp0QtyRatio = clamp(normalizeNumber(sysCfg.ev_gate_default_tp0_qty_ratio, 0.25), 0, 1);
  const defaultTp1Pct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_tp1_pct, 3.25));
  const defaultSlPct = Math.max(0.1, normalizeNumber(sysCfg.ev_gate_default_sl_pct, 1.65));
  const unknownGenRelaxMode = resolveEvGateUnknownGenRelaxMode(sysCfg);
  return {
    enabled: normalizeBool(sysCfg.ev_gate_enabled, defaultEnabled),
    globalReportOnlyEnabled,
    applyCore: normalizeBool(sysCfg.ev_gate_core_enabled, true),
    applyPreReal: false,
    applyReal: false,
    applyEarly: normalizeBool(sysCfg.ev_gate_early_enabled, true),
    tp1ProbMin: Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55,
    tp1ProbMinGlobal: Number.isFinite(tp1ProbMinGlobal) ? tp1ProbMinGlobal : 0.55,
    tp1ProbMinMarketOverride: marketOverrideActive ? tp1ProbMinByMarket[marketKey] : null,
    tp1ProbMinMarketReportOnlyOverride: marketReportOnlyOverrideActive ? tp1ProbMinByMarketReportOnly[marketKey] : null,
    tp1ProbMinCohortReportOnlyOverride: cohortReportOnlyActive ? Math.min(tp1ProbMinGlobal, cohortReportOnlyThreshold) : null,
    tp1ProbMinByMarket,
    tp1ProbMinByMarketReportOnly,
    tp1ProbMinReportOnlyEnabled: reportOnlyEnabled,
    tp1ProbMinReportOnlyCohortEnabled: cohortReportOnlyEnabled,
    tp1ProbMinEarly: Number.isFinite(tp1ProbMinEarly) ? tp1ProbMinEarly : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinCore: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinPreReal: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbMinReal: Number.isFinite(tp1ProbMinCore) ? tp1ProbMinCore : (Number.isFinite(tp1ProbMin) ? tp1ProbMin : 0.55),
    tp1ProbFull: Number.isFinite(tp1ProbFull) ? Math.max(tp1ProbMin, tp1ProbFull) : Math.max(tp1ProbMin, 0.60),
    tp1ProbKill: Number.isFinite(tp1ProbKill) ? Math.min(tp1ProbMin, tp1ProbKill) : Math.min(tp1ProbMin, 0.50),
    qtyScaleMid: Number.isFinite(qtyScaleMid) ? qtyScaleMid : 0.70,
    qtyScaleLow: Number.isFinite(qtyScaleLow) ? qtyScaleLow : 0.40,
    pointPassKillRescueEnabled,
    pointPassKillRescueMargin,
    qtyScaleKillRescue: Number.isFinite(qtyScaleKillRescue) ? qtyScaleKillRescue : Math.min(Number.isFinite(qtyScaleLow) ? qtyScaleLow : 0.40, 0.25),
    lookbackBars,
    atrBars,
    defaultTp0Pct,
    defaultTp0QtyRatio,
    defaultTp1Pct,
    defaultSlPct,
    unknownGenRelaxEnabled: unknownGenRelaxMode.enabled,
    unknownGenRelaxStatus: unknownGenRelaxMode.status,
    unknownGenRelaxActive: unknownGenRelaxMode.active,
    unknownGenRelaxEnforcementMode: unknownGenRelaxMode.enforcementMode,
    unknownGenRelaxStartMs: unknownGenRelaxMode.startMs,
    unknownGenRelaxAgeHours: unknownGenRelaxMode.ageHours,
    unknownGenRelaxWindowHours: unknownGenRelaxMode.windowHours,
    unknownGenRelaxReviewAfterHours: unknownGenRelaxMode.reviewAfterHours,
    unknownGenRelaxMinDelta: unknownGenRelaxMode.minDelta,
    unknownGenRelaxFullDelta: unknownGenRelaxMode.fullDelta,
    unknownGenRelaxKillDelta: unknownGenRelaxMode.killDelta,
    unknownGenRelaxReviewDue: unknownGenRelaxMode.reviewDue,
    unknownGenRelaxAutoRollbackEnabled: unknownGenRelaxMode.autoRollbackEnabled,
    skipMissingBars: normalizeBool(
      sysCfg.ev_gate_skip_missing_bars === undefined ? true : sysCfg.ev_gate_skip_missing_bars,
      true
    ),
  };
}

function resolveEvGateTp1ProbMinForTier(cfg = {}, tier = null) {
  const t = String(tier || "").toUpperCase();
  if (t === "EARLY") return Number(cfg.tp1ProbMinEarly);
  if (t === "CORE") return Number(cfg.tp1ProbMinCore);
  if (t === "PRE_REAL" || t === "REAL") return Number(cfg.tp1ProbMinCore);
  return Number(cfg.tp1ProbMin);
}

function shouldApplyEvGateByEvent(eventUpper, cfg, features) {
  const tier = resolveEntryQualityTier(eventUpper, features);
  if (tier === "REAL" || tier === "PRE_REAL") return false;
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "EARLY" || isEmoEventName(eventUpper)) return cfg.applyEarly;
  return false;
}

function shouldBypassEvEntryGate({ intent, features } = {}) {
  return String(intent || "").toUpperCase() === "ENTRY" && isManualRetryFeatures(features);
}

function buildSignalStageFeatures(signal = {}, intent = null) {
  const base = (signal && signal.features && typeof signal.features === "object") ? { ...signal.features } : {};
  const eventGroup = String(signal && signal.event_group || "").trim().toUpperCase() || null;
  const eventSubtype = String(signal && signal.event_subtype || "").trim().toUpperCase() || null;
  const eventIntent = String(
    signal && (signal.event_intent || signal.intent || intent) || ""
  ).trim().toUpperCase() || null;
  if (eventGroup && !base.event_group && !base.signal_group && !base._event_group) base.event_group = eventGroup;
  if (eventSubtype && !base.event_subtype && !base.signal_subtype && !base._event_subtype) base.event_subtype = eventSubtype;
  if (eventIntent && !base.event_intent && !base._event_intent) base.event_intent = eventIntent;
  return base;
}

function resolveEvGateUnknownGenRelaxContext({ eventUpper, intent, features, cfg, tier } = {}) {
  const f = (features && typeof features === "object") ? features : {};
  const derived = deriveGroupSubtype(eventUpper);
  const explicitSignalGroup = pickFirstUpper(f, ["event_group", "signal_group", "_event_group"]);
  const explicitSignalSubtype = pickFirstUpper(f, ["event_subtype", "signal_subtype", "_event_subtype"]);
  const signalGroup = explicitSignalGroup || derived.group || null;
  const signalSubtype = explicitSignalSubtype || derived.subtype || null;
  const eventIntent = pickFirstUpper(f, ["event_intent", "_event_intent"]) || String(intent || "").trim().toUpperCase() || null;
  const marketState = pickFirstUpper(f, [
    "market_state_summary_state",
    "market_state_state",
    "market_state",
    "sp_state",
    "market_physics_state",
  ]);
  const baseTp1ProbMin = resolveEvGateTp1ProbMinForTier(cfg, tier);
  const isEntryLikeSignal = eventIntent === "ENTRY" || signalGroup === "ENTRY";
  const hasExplicitStageMetadata = !!(explicitSignalGroup || explicitSignalSubtype);
  const isExplicitGenSignal = signalSubtype === "GEN";
  const isUnknownGenLikeSignal = isExplicitGenSignal || !hasExplicitStageMetadata;
  const applies = cfg
    && cfg.unknownGenRelaxActive === true
    && isEntryLikeSignal
    && isUnknownGenLikeSignal
    && (
      isExplicitGenSignal
      || !marketState
      || marketState === "UNKNOWN"
    );
  const tp1ProbMin = applies
    ? Number(Math.max(0.30, Number(baseTp1ProbMin || 0) - Number(cfg.unknownGenRelaxMinDelta || 0)).toFixed(4))
    : baseTp1ProbMin;
  const tp1ProbFull = applies
    ? Number(Math.max(0.35, Number(cfg.tp1ProbFull || 0) - Number(cfg.unknownGenRelaxFullDelta || 0)).toFixed(4))
    : Number(cfg && cfg.tp1ProbFull);
  const tp1ProbKill = applies
    ? Number(Math.max(0.25, Number(cfg.tp1ProbKill || 0) - Number(cfg.unknownGenRelaxKillDelta || 0)).toFixed(4))
    : Number(cfg && cfg.tp1ProbKill);
  return {
    eventIntent,
    explicitSignalGroup: explicitSignalGroup || null,
    explicitSignalSubtype: explicitSignalSubtype || null,
    hasExplicitStageMetadata,
    signalGroup,
    signalSubtype,
    marketState: marketState || "UNKNOWN",
    applies,
    baseTp1ProbMin,
    tp1ProbMin,
    tp1ProbFull,
    tp1ProbKill,
  };
}

function resolveEvGateDecision({ estimate, cfg, tp1ProbMin } = {}) {
  const killThreshold = Number(cfg && cfg.tp1ProbKill);
  const fullThreshold = Number(cfg && cfg.tp1ProbFull);
  const probMin = Number(tp1ProbMin);
  const pointProbability = Number(estimate && (estimate.exit_value_probability != null ? estimate.exit_value_probability : estimate.probability));
  const lowerBound = Number(estimate && (estimate.exit_value_lower_bound != null ? estimate.exit_value_lower_bound : estimate.lowerBound));
  const pointPass = Number.isFinite(pointProbability) && Number.isFinite(probMin) && pointProbability >= probMin;
  const rescueMargin = Math.max(0, Number(cfg && cfg.pointPassKillRescueMargin) || 0);
  const rescueFloor = Number.isFinite(killThreshold) ? Math.max(0, killThreshold - rescueMargin) : null;
  const rescueScale = Number(cfg && cfg.qtyScaleKillRescue);
  const lowScale = Number(cfg && cfg.qtyScaleLow);
  const midScale = Number(cfg && cfg.qtyScaleMid);

  if (Number.isFinite(killThreshold) && Number.isFinite(lowerBound) && lowerBound < killThreshold) {
    const rescueEligible = cfg && cfg.pointPassKillRescueEnabled === true
      && pointPass
      && Number.isFinite(rescueFloor)
      && lowerBound >= rescueFloor
      && Number.isFinite(rescueScale)
      && rescueScale > 0;
    if (rescueEligible) {
      return {
        ok: true,
        action: "REDUCE_RESCUE",
        qtyScale: rescueScale,
        reason: null,
        pointPass,
        rescueFloor,
        pointPassKillRescueApplied: true,
      };
    }
    return {
      ok: false,
      action: "DROP",
      qtyScale: 0,
      reason: "DROP_EV_GATE_TP1_PROB",
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }

  if (Number.isFinite(lowerBound) && Number.isFinite(probMin) && lowerBound < probMin) {
    return {
      ok: true,
      action: "REDUCE_LOW",
      qtyScale: Number.isFinite(lowScale) ? lowScale : 0.40,
      reason: null,
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }
  if (Number.isFinite(lowerBound) && Number.isFinite(fullThreshold) && lowerBound < fullThreshold) {
    return {
      ok: true,
      action: "REDUCE_MID",
      qtyScale: Number.isFinite(midScale) ? midScale : 0.70,
      reason: null,
      pointPass,
      rescueFloor,
      pointPassKillRescueApplied: false,
    };
  }
  return {
    ok: true,
    action: "ALLOW",
    qtyScale: 1,
    reason: null,
    pointPass,
    rescueFloor,
    pointPassKillRescueApplied: false,
  };
}

function resolveEvGateTradePlan({ cfg, exitRules, features } = {}) {
  const fallback = {
    tp0Pct: Math.max(0, Number(cfg && cfg.defaultTp0Pct)),
    tp1Pct: Math.max(0, Number(cfg && cfg.defaultTp1Pct)),
    slPct: Math.max(0, Number(cfg && cfg.defaultSlPct)),
    source: "config",
    tp0QtyRatio: Number.isFinite(Number(cfg && cfg.defaultTp0QtyRatio)) ? clamp(Number(cfg.defaultTp0QtyRatio), 0, 1) : 0.25,
    tp1QtyRatio: null,
    bePct: null,
    trailPct: null,
    trailRMultiple: null,
    runnerMinProfitPct: null,
  };
  if (!exitRules || typeof exitRules !== "object") return fallback;
  const rules = applySignalExitPolicyOverrides(exitRules, features);
  const tp0Abs = Math.abs(Number(rules.TP_P0));
  const slAbs = Math.abs(Number(rules.SL));
  const tp1Abs = Math.abs(Number(rules.TP_P1));
  const tp0QtyRatio = clamp(normalizeNumber(rules.TP_P0_QTY, 0.25), 0, 1);
  const tp1QtyRatio = clamp(normalizeNumber(rules.TP_P1_QTY, 1), 0, 1);
  const beEnabled = normalizeBool(rules.BE_ENABLE, false);
  const beAbs = Math.abs(Number(rules.BE_PCT));
  const trailAbs = Math.abs(Number(rules.TRAIL_PCT));
  const trailRMultiple = normalizeNumber(rules.TRAIL_R_MULTIPLE, null);
  const runnerMinAbs = Math.abs(Number(rules.RUNNER_MIN_PROFIT_PCT));
  if (!Number.isFinite(slAbs) || slAbs <= 0 || !Number.isFinite(tp1Abs) || tp1Abs <= 0) {
    return fallback;
  }
  return {
    tp0Pct: Number.isFinite(tp0Abs) && tp0Abs > 0 ? (tp0Abs * 100) : null,
    tp1Pct: tp1Abs * 100,
    slPct: slAbs * 100,
    source: "exit_rules",
    tp0QtyRatio,
    tp1QtyRatio,
    bePct: beEnabled && Number.isFinite(beAbs) ? (beAbs * 100) : null,
    trailPct: Number.isFinite(trailAbs) && trailAbs > 0 ? (trailAbs * 100) : null,
    trailRMultiple: Number.isFinite(trailRMultiple) && trailRMultiple > 0 ? trailRMultiple : null,
    runnerMinProfitPct: Number.isFinite(runnerMinAbs) && runnerMinAbs > 0 ? (runnerMinAbs * 100) : null,
  };
}

async function evaluateEvEntryGate({
  exchange,
  symbol,
  tf,
  barCloseMs,
  intent,
  intentDir,
  eventUpper,
  features,
  cfg,
  exitRules,
  exitProfile,
  exitProfileReason,
  bars,
} = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (String(intent || "").toUpperCase() !== "ENTRY") return { ok: true, action: "ALLOW", qtyScale: 1 };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return { ok: true, action: "ALLOW", qtyScale: 1 };
  if (!shouldApplyEvGateByEvent(eventUpper, cfg, features)) return { ok: true, action: "ALLOW", qtyScale: 1 };

  const tier = resolveEntryQualityTier(eventUpper, features);
  const f = (features && typeof features === "object") ? features : {};
  const plan = resolveEvGateTradePlan({ cfg, exitRules, features: f });
  const tp0Pct = Number(plan.tp0Pct);
  const tp1Pct = Number(plan.tp1Pct);
  const slPct = Number(plan.slPct);
  const relaxContext = resolveEvGateUnknownGenRelaxContext({ eventUpper, intent, features: f, cfg, tier });
  const tp1ProbMin = relaxContext.tp1ProbMin;

  const baseDetail = {
    ev_gate_enabled: true,
    ev_gate_global_report_only_enabled: cfg.globalReportOnlyEnabled === true,
    ev_gate_source: "TP_COMPOSITE_EXIT_VALUE_V1",
    ev_gate_plan_source: plan.source,
    ev_gate_tier: tier,
    ev_gate_dir: dir,
    ev_gate_tp1_prob_min_global: Number(cfg.tp1ProbMin),
    ev_gate_tp1_prob_min_base: relaxContext.baseTp1ProbMin,
    ev_gate_tp1_prob_min: tp1ProbMin,
    ev_gate_tp1_prob_full_base: Number(cfg.tp1ProbFull),
    ev_gate_tp1_prob_kill_base: Number(cfg.tp1ProbKill),
    ev_gate_tp1_prob_full: relaxContext.tp1ProbFull,
    ev_gate_tp1_prob_kill: relaxContext.tp1ProbKill,
    ev_gate_qty_scale_mid: Number(cfg.qtyScaleMid),
    ev_gate_qty_scale_low: Number(cfg.qtyScaleLow),
    ev_gate_qty_scale_kill_rescue: Number(cfg.qtyScaleKillRescue),
    ev_gate_point_pass_kill_rescue_enabled: cfg.pointPassKillRescueEnabled === true,
    ev_gate_point_pass_kill_rescue_margin: Number(cfg.pointPassKillRescueMargin),
    ev_gate_tp0_pct: Number.isFinite(tp0Pct) ? tp0Pct : null,
    ev_gate_tp1_pct: Number.isFinite(tp1Pct) ? tp1Pct : null,
    ev_gate_sl_pct: Number.isFinite(slPct) ? slPct : null,
    ev_gate_tp0_qty_ratio: Number.isFinite(Number(plan.tp0QtyRatio)) ? Number(plan.tp0QtyRatio) : null,
    ev_gate_tp1_qty_ratio: Number.isFinite(Number(plan.tp1QtyRatio)) ? Number(plan.tp1QtyRatio) : null,
    ev_gate_be_pct: Number.isFinite(Number(plan.bePct)) ? Number(plan.bePct) : null,
    ev_gate_trail_pct: Number.isFinite(Number(plan.trailPct)) ? Number(plan.trailPct) : null,
    ev_gate_trail_r_multiple: Number.isFinite(Number(plan.trailRMultiple)) ? Number(plan.trailRMultiple) : null,
    ev_gate_runner_min_profit_pct: Number.isFinite(Number(plan.runnerMinProfitPct)) ? Number(plan.runnerMinProfitPct) : null,
    ev_gate_exit_profile: exitProfile ? String(exitProfile).toUpperCase() : null,
    ev_gate_exit_profile_reason: exitProfileReason ? String(exitProfileReason) : null,
    ev_gate_lookback_bars: Number(cfg.lookbackBars) || null,
    ev_gate_atr_bars: Number(cfg.atrBars) || null,
    ev_gate_signal_group: relaxContext.signalGroup,
    ev_gate_event_intent: relaxContext.eventIntent,
    ev_gate_signal_group_explicit: relaxContext.explicitSignalGroup,
    ev_gate_signal_subtype_explicit: relaxContext.explicitSignalSubtype,
    ev_gate_signal_stage_metadata_present: relaxContext.hasExplicitStageMetadata,
    ev_gate_signal_subtype: relaxContext.signalSubtype,
    ev_gate_market_state: relaxContext.marketState,
    ev_gate_unknown_gen_relax_enabled: cfg.unknownGenRelaxEnabled === true,
    ev_gate_unknown_gen_relax_status: cfg.unknownGenRelaxStatus || "DISABLED",
    ev_gate_unknown_gen_relax_active: cfg.unknownGenRelaxActive === true,
    ev_gate_unknown_gen_relax_enforcement_mode: cfg.unknownGenRelaxEnforcementMode || "DISABLED",
    ev_gate_unknown_gen_relax_applied: relaxContext.applies === true,
    ev_gate_unknown_gen_relax_window_hours: Number(cfg.unknownGenRelaxWindowHours) || null,
    ev_gate_unknown_gen_relax_review_after_hours: Number(cfg.unknownGenRelaxReviewAfterHours) || null,
    ev_gate_unknown_gen_relax_age_hours: Number.isFinite(Number(cfg.unknownGenRelaxAgeHours)) ? Number(cfg.unknownGenRelaxAgeHours) : null,
    ev_gate_unknown_gen_relax_min_delta: Number(cfg.unknownGenRelaxMinDelta) || 0,
    ev_gate_unknown_gen_relax_full_delta: Number(cfg.unknownGenRelaxFullDelta) || 0,
    ev_gate_unknown_gen_relax_kill_delta: Number(cfg.unknownGenRelaxKillDelta) || 0,
    ev_gate_unknown_gen_relax_review_due: cfg.unknownGenRelaxReviewDue === true,
    ev_gate_unknown_gen_relax_auto_rollback_enabled: cfg.unknownGenRelaxAutoRollbackEnabled === true,
  };

  if (!Number.isFinite(tp1Pct) || tp1Pct <= 0 || !Number.isFinite(slPct) || slPct <= 0) {
    const detail = {
      ...baseDetail,
      ev_gate_skipped: true,
      ev_gate_skip_reason: "INVALID_TARGET_PLAN",
      ev_gate_action: "SKIP",
      ev_gate_qty_scale: 1,
    };
    return { ok: true, action: "SKIP", qtyScale: 1, detail };
  }

  const loadedBars = Array.isArray(bars)
    ? bars
    : await queryBars({
      exchange,
      symbol,
      tf,
      limit: Math.max(14, Number(cfg.lookbackBars || 12) + 2),
    });
  const estimate = estimateTp1ReachProbability({
    bars: loadedBars,
    dir,
    tp0Pct,
    tp1Pct,
    slPct,
    tp0QtyRatio: plan.tp0QtyRatio,
    tp1QtyRatio: plan.tp1QtyRatio,
    runnerMinProfitPct: plan.runnerMinProfitPct,
    barCloseMs,
    lookbackBars: cfg.lookbackBars,
    atrBars: cfg.atrBars,
  });
  if (!estimate || estimate.ok !== true) {
    const detail = {
      ...baseDetail,
      ev_gate_skipped: true,
      ev_gate_skip_reason: estimate && estimate.skipReason ? String(estimate.skipReason) : "MODEL_UNAVAILABLE",
      ev_gate_bars_seen: estimate && estimate.barsSeen != null ? estimate.barsSeen : null,
      ev_gate_action: "SKIP",
      ev_gate_qty_scale: 1,
    };
    if (cfg.skipMissingBars) return { ok: true, action: "SKIP", qtyScale: 1, detail };
    return { ok: false, action: "DROP", qtyScale: 0, reason: "DROP_EV_GATE_BARS_MISSING", detail };
  }

  const decisionCfg = relaxContext.applies
    ? {
      ...cfg,
      tp1ProbFull: relaxContext.tp1ProbFull,
      tp1ProbKill: relaxContext.tp1ProbKill,
    }
    : cfg;
  const decision = resolveEvGateDecision({ estimate, cfg: decisionCfg, tp1ProbMin });
  const action = decision.action;
  const qtyScale = decision.qtyScale;
  const dropReason = decision.reason;
  const reportOnlyApplied = cfg.globalReportOnlyEnabled === true
    || (relaxContext.applies === true && cfg.unknownGenRelaxEnforcementMode === "REPORT_ONLY");
  const effectiveAction = reportOnlyApplied ? "REPORT_ONLY" : action;
  const effectiveQtyScale = reportOnlyApplied ? 1 : qtyScale;
  const effectiveDropReason = reportOnlyApplied ? null : dropReason;
  const reportOnlyScope = cfg.globalReportOnlyEnabled === true
    ? "GLOBAL"
    : (reportOnlyApplied ? "UNKNOWN_GEN" : null);

  const detail = {
    ...baseDetail,
    ev_gate_action: effectiveAction,
    ev_gate_qty_scale: effectiveQtyScale,
    ev_gate_raw_action: action,
    ev_gate_raw_qty_scale: qtyScale,
    ev_gate_raw_reason: dropReason || null,
    ev_gate_report_only_applied: reportOnlyApplied,
    ev_gate_report_only_scope: reportOnlyScope,
    ev_gate_report_only_would_drop: reportOnlyApplied && action === "DROP",
    ev_gate_report_only_would_reduce: reportOnlyApplied && action !== "DROP" && Number.isFinite(qtyScale) && qtyScale > 0 && qtyScale < 0.9999,
    ev_gate_tp0_reach_prob: estimate.tp0_probability,
    ev_gate_tp0_reach_prob_lower_bound: estimate.tp0_lower_bound,
    ev_gate_tp1_reach_prob: estimate.probability,
    ev_gate_tp1_reach_prob_lower_bound: estimate.lowerBound,
    ev_gate_exit_value_prob: estimate.exit_value_probability,
    ev_gate_exit_value_prob_lower_bound: estimate.exit_value_lower_bound,
    ev_gate_tp0_to_tp1_conversion_prob: estimate.tp0_to_tp1_conversion_probability,
    ev_gate_pre_tp1_time_stop_risk: estimate.pre_tp1_time_stop_risk,
    ev_gate_expected_exit_value_pct: estimate.expected_exit_value_pct,
    ev_gate_expected_exit_value_r: estimate.expected_exit_value_r,
    ev_gate_probability_stderr: estimate.stderr,
    ev_gate_effective_n: estimate.effectiveN,
    ev_gate_exit_value_stderr: estimate.exit_value_stderr,
    ev_gate_exit_value_effective_n: estimate.exit_value_effective_n,
    ev_gate_confidence_z: estimate.confidenceZ,
    ev_gate_bars_seen: estimate.barsSeen,
    ev_gate_atr_pct: estimate.atrPct,
    ev_gate_target_atr: estimate.targetAtr,
    ev_gate_stop_atr: estimate.stopAtr,
    ev_gate_recent_move_3_pct: estimate.recentMove3Pct,
    ev_gate_recent_move_1_pct: estimate.recentMove1Pct,
    ev_gate_chase_ratio: estimate.chaseRatio,
    ev_gate_same_dir_streak: estimate.sameDirStreak,
    ev_gate_counter_dir_bars: estimate.counterDirBars,
    ev_gate_point_pass: decision.pointPass,
    ev_gate_point_pass_kill_rescue_applied: decision.pointPassKillRescueApplied,
    ev_gate_point_pass_kill_rescue_floor: decision.rescueFloor,
    ev_gate_avg_close_control: estimate.avgCloseControl,
    ev_gate_avg_opposite_wick: estimate.avgOppWick,
    ev_gate_avg_dir_body: estimate.avgDirBody,
    ev_gate_last_close_control: estimate.lastCloseControl,
    ev_gate_last_opposite_wick: estimate.lastOppWick,
    ev_gate_last_dir_body: estimate.lastDirBody,
    ev_gate_prev_close_control: estimate.prevCloseControl,
    ev_gate_prev_opposite_wick: estimate.prevOppWick,
    ev_gate_prev_dir_body: estimate.prevDirBody,
    ev_gate_policy_version: estimate.policy_version || null,
    ev_gate_policy_basis: estimate.policy_basis || null,
    ev_gate_policy_source: estimate.policy_source || null,
    ev_gate_component_weights: estimate.componentWeights || null,
    ev_gate_components: estimate.components,
    ev_gate_exit_value_components: estimate.exit_value_components || null,
  };

  if (effectiveDropReason) return { ok: false, action: effectiveAction, qtyScale: effectiveQtyScale, reason: effectiveDropReason, detail };

  return { ok: true, action: effectiveAction, qtyScale: effectiveQtyScale, detail };
}

function evaluateEntryQualityGate({ intent, intentDir, eventUpper, features, cfg } = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true };
  if (intent !== "ENTRY" && intent !== "ADD") return { ok: true };
  const dir = String(intentDir || "").toUpperCase();
  const structure = resolveEntryStructureSnapshot({ features, intentDir: dir, eventUpper });
  if (!structure.tier) return { ok: true };
  if (structure.pineBundle.trusted) {
    return {
      ok: true,
      detail: {
        pine_stage1_bundle_trusted: true,
        pine_stage1_bundle_owner: structure.pineBundle.owner,
        pine_stage1_bundle_version: structure.pineBundle.version,
      },
    };
  }
  const minScoreAbs = pickTierNumber(cfg.scoreAbsByTier, structure.tier, 0);
  const minPosterior = pickTierNumber(cfg.posteriorByTier, structure.tier, null);
  const minConfidence = pickTierNumber(cfg.confidenceByTier, structure.tier, null);
  const minWaveConf = pickTierNumber(cfg.waveConfByTier, structure.tier, null);

  if (cfg.blockConflict && (structure.conflictAny === true || structure.conflictDir === true)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONFLICT", detail: { conflict_any: structure.conflictAny, conflict_dir: structure.conflictDir } };
  }
  if (cfg.disallowRange && structure.regime === "range") {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_RANGE", detail: { regime: structure.regime } };
  }
  if (cfg.requireTrend && structure.regime && structure.regime !== "trend") {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_TREND_ONLY", detail: { regime: structure.regime } };
  }
  if (Number.isFinite(structure.score)) {
    if (Math.abs(structure.score) < minScoreAbs) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE", detail: { score: structure.score, min_score_abs: minScoreAbs, tier: structure.tier } };
    }
    if (dir === "LONG" && structure.score < 0) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE_DIR", detail: { score: structure.score, dir } };
    }
    if (dir === "SHORT" && structure.score > 0) {
      return { ok: false, reason: "DROP_ENTRY_QUALITY_SCORE_DIR", detail: { score: structure.score, dir } };
    }
  }
  if (cfg.requirePosterior && !Number.isFinite(structure.posterior)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_POSTERIOR_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.posterior) && structure.posterior < minPosterior) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_POSTERIOR", detail: { posterior: structure.posterior, min_posterior: minPosterior, tier: structure.tier } };
  }
  if (cfg.requireConfidence && !Number.isFinite(structure.confidence)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONF_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.confidence) && structure.confidence < minConfidence) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_CONF", detail: { confidence: structure.confidence, min_confidence: minConfidence, tier: structure.tier } };
  }
  if (cfg.requireWaveConf && !Number.isFinite(structure.waveConf)) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_WAVE_MISSING", detail: { tier: structure.tier } };
  }
  if (Number.isFinite(structure.waveConf) && structure.waveConf < minWaveConf) {
    return { ok: false, reason: "DROP_ENTRY_QUALITY_WAVE", detail: { wave_conf: structure.waveConf, min_wave_conf: minWaveConf, tier: structure.tier } };
  }
  return { ok: true };
}

function resolveCanonicalEntryConfig(sysCfg = {}, market = "") {
  return resolveCanonicalEngineConfigShared(sysCfg, { market });
}

function applyCanonicalSourceProvenanceDefaults({ intent, features, sysCfg, market, eventUpper, intentDir, tf } = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  if (entryIntent !== "ENTRY" && entryIntent !== "ADD") return features;
  const featureObj = (features && typeof features === "object") ? features : {};
  if (featureObj.canonical_engine_actual_source_decision != null && featureObj.canonical_engine_decision_id != null) return featureObj;
  const resolvedCfg = resolveCanonicalEntryConfig(sysCfg, market);
  if (!resolvedCfg || resolvedCfg.enabled !== true) return featureObj;
  const decision = evaluateCanonicalDecision({
    features: featureObj,
    event: eventUpper,
    side: intentDir,
    market,
    tf,
    config: resolvedCfg,
    pineShadowDecision: "PASS",
  });
  return {
    ...featureObj,
    ...(decision && decision.detail ? decision.detail : {}),
  };
}

function evaluateCanonicalEntryGate({ intent, intentDir, eventUpper, features, sysCfg, cfg, market, tf } = {}) {
  const entryIntent = String(intent || "").toUpperCase();
  if (entryIntent !== "ENTRY" && entryIntent !== "ADD") return { ok: true };
  const resolvedCfg = cfg || resolveCanonicalEntryConfig(sysCfg, market);
  if (!resolvedCfg || resolvedCfg.enabled !== true) return { ok: true };
  const decision = evaluateCanonicalDecision({
    features,
    event: eventUpper,
    side: intentDir,
    market,
    tf,
    config: resolvedCfg,
  });
  if (!decision.ok) {
    return {
      ok: false,
      reason: decision.reason || "DROP_CANONICAL_ENGINE",
      detail: decision.detail || {},
    };
  }
  return {
    ok: true,
    detail: decision.detail || {},
  };
}

function mergeCanonicalDecisionDetail(features = {}, detail = {}) {
  return {
    ...((features && typeof features === "object") ? features : {}),
    ...((detail && typeof detail === "object") ? detail : {}),
  };
}

function getCoreProbeMeta(posMeta, intentDir) {
  if (!posMeta || !intentDir) return null;
  const dir = String(intentDir).toLowerCase();
  const base = `core_probe_${dir}`;
  const remaining = Number(posMeta[`${base}_remaining_pct`]);
  const barMs = Number(posMeta[`${base}_bar_ms`]);
  const expiresMs = Number(posMeta[`${base}_expires_ms`]);
  return { base, remaining, barMs, expiresMs };
}

function computeWeightedWinRate(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let nTotal = 0;
  let acc = 0;
  for (const row of rows) {
    const n = Number(row && row.n);
    const wr = Number(row && row.win_rate);
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(wr)) continue;
    nTotal += n;
    acc += wr * n;
  }
  if (nTotal <= 0) return null;
  return acc / nTotal;
}

const autoScoreCache = new Map();
const AUTO_SCORE_CACHE_TTL_MS = 3 * 60 * 1000;

async function loadEvalLatestWinRate(exchange) {
  const exchangeKey = normalizeEvalExchange(exchange);
  const exCfg = await getExchangeSettingsForProvider(exchangeKey, 2000);
  const expectedTf = normalizeTf((exCfg && exCfg.exec_tf) || "15m") || "15m";
  const cacheKey = `${exchangeKey}__${expectedTf}`;
  const cached = autoScoreCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.at) <= AUTO_SCORE_CACHE_TTL_MS) return cached.winRate;
  try {
    const db = getFirestore();
    const snap = await db.collection("eval_latest").doc(evalLatestId(exchangeKey)).get();
    if (!snap.exists) {
      autoScoreCache.set(cacheKey, { at: now, winRate: null });
      return null;
    }
    const data = snap.data() || {};
    if (!matchesEvalTf(data, expectedTf)) {
      autoScoreCache.set(cacheKey, { at: now, winRate: null });
      return null;
    }
    const rows = Array.isArray(data.signal_kpi_A) ? data.signal_kpi_A : [];
    const winRate = computeWeightedWinRate(rows);
    autoScoreCache.set(cacheKey, { at: now, winRate });
    return winRate;
  } catch (_) {
    autoScoreCache.set(cacheKey, { at: now, winRate: null });
    return null;
  }
}

async function resolveAutoScoreMin({ exchange, sysCfg } = {}) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const enabled = normalizeBool(cfg.auto_score_enabled, false);
  if (!enabled) return { enabled: false };
  if (normalizeBool(cfg.auto_score_freeze, false)) return { enabled: false, frozen: true };

  const base = normalizeNumber(cfg.auto_score_base, null);
  if (!Number.isFinite(base)) return { enabled: false };

  const target = normalizeNumber(cfg.auto_score_target_win_rate, 0.55);
  const deltaMax = Math.abs(normalizeNumber(cfg.auto_score_delta_max, 0.05));
  const gain = normalizeNumber(cfg.auto_score_gain, 0.5);
  const minClamp = normalizeNumber(cfg.auto_score_min, null);
  const maxClamp = normalizeNumber(cfg.auto_score_max, null);

  const winRate = await loadEvalLatestWinRate(exchange);
  if (!Number.isFinite(winRate)) {
    const scoreMinFallback = Number.isFinite(minClamp) ? Math.max(base, minClamp) : base;
    return { enabled: true, scoreMin: scoreMinFallback, base, winRate: null, target };
  }

  let delta = (target - winRate) * gain;
  if (Number.isFinite(deltaMax)) delta = clamp(delta, -deltaMax, deltaMax) || 0;
  let scoreMin = base + delta;
  if (Number.isFinite(minClamp)) scoreMin = Math.max(scoreMin, minClamp);
  if (Number.isFinite(maxClamp)) scoreMin = Math.min(scoreMin, maxClamp);
  return { enabled: true, scoreMin, base, winRate, target, delta };
}

async function resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg } = {}) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const enabled = normalizeBool(cfg.signal_spike_lock_enabled, true);
  if (!enabled) return { active: false };
  const tf = String(cfg.signal_spike_tf || "15m");
  const tfMs = tfToMs(tf);
  const spikePct = normalizeNumber(cfg.signal_spike_pct, 0.02);
  const lockBars = Math.max(1, normalizeInt(cfg.signal_spike_lock_bars, 2));
  if (!Number.isFinite(tfMs) || !Number.isFinite(spikePct) || spikePct <= 0) return { active: false };

  const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
  const lockUntil = Number(meta.spike_lock_until_ms);
  if (Number.isFinite(lockUntil) && Number(barCloseMs) < lockUntil) {
    return { active: true, tf, untilMs: lockUntil, reason: "SPIKE_LOCK_ACTIVE" };
  }

  const bars = await queryBars({ exchange, symbol, tf, limit: 3 });
  const filtered = bars
    .map((b) => ({ ...b, _t: Number(b && (b.closeTimeUtcMs ?? b.timestamp ?? b.t)) }))
    .filter((b) => Number.isFinite(b._t) && b._t <= Number(barCloseMs))
    .sort((a, b) => a._t - b._t);
  if (filtered.length < 2) return { active: false, reason: "SPIKE_INSUFFICIENT_BARS" };
  const last = filtered[filtered.length - 1];
  const prev = filtered[filtered.length - 2];
  const lastClose = Number(last && (last.close ?? last.c));
  const prevClose = Number(prev && (prev.close ?? prev.c));
  if (!Number.isFinite(lastClose) || !Number.isFinite(prevClose) || prevClose <= 0) return { active: false, reason: "SPIKE_BAD_CLOSE" };

  const movePct = Math.abs(lastClose - prevClose) / prevClose;
  if (!Number.isFinite(movePct) || movePct < spikePct) return { active: false, reason: "SPIKE_BELOW_THRESHOLD", movePct };

  const untilMs = addMs(Number(barCloseMs), tfMs * lockBars);
  return { active: true, tf, untilMs, reason: "SPIKE_DETECTED", movePct };
}

async function resolveFuturesRiskConfig(exchange) {
  const maxLev = Number(process.env.FUTURES_LEVERAGE_MAX || 3);
  const ex = String(exchange || "").toUpperCase();
  let levRaw = FUTURES_BASE_LEVERAGE;
  if (ex.includes("BINANCE")) {
    levRaw = Number(process.env.FUTURES_LEVERAGE || FUTURES_BASE_LEVERAGE);
    const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
    const cfg = (sys && sys.data) ? sys.data : {};
    if (cfg.futures_leverage != null) levRaw = Number(cfg.futures_leverage);
  }
  const leverage = normalizeFuturesLeverage(levRaw, maxLev);
  const bufferRaw = Number(process.env.FUTURES_LIQUIDATION_BUFFER_PCT || 0.02);
  const bufferPct = clamp(bufferRaw, 0.001, 0.2) || 0.02;
  return { leverage, bufferPct };
}

function normalizeExecutionMode(raw) {
  const mode = String(raw || "PAPER").toUpperCase();
  if (mode === "LIVE" || mode === "LIVE_DRY_RUN") return mode;
  return "PAPER";
}

async function resolveUpbitKeys() {
  return { accessKey: "", secretKey: "", source: "removed" };
}

async function resolveBinanceKeys() {
  const keys = await resolveBinanceFuturesKeys({ ttlMs: 5000 });
  const apiKey = String(keys && keys.apiKey || "");
  const apiSecret = String(keys && keys.apiSecret || "");
  if (apiKey && apiSecret) {
    KEY_CACHE.BINANCEFUT = { apiKey, apiSecret, at: Date.now() };
    return { apiKey, apiSecret, source: (keys && keys.source) || "shared" };
  }
  if (KEY_CACHE.BINANCEFUT.apiKey && KEY_CACHE.BINANCEFUT.apiSecret) {
    return { apiKey: KEY_CACHE.BINANCEFUT.apiKey, apiSecret: KEY_CACHE.BINANCEFUT.apiSecret, source: "cache" };
  }
  return { apiKey: "", apiSecret: "", source: "missing" };
}

async function resolveUnsupportedLiveConfig({ exchange, symbol, provider } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = sys && sys.data ? sys.data : {};
  const execMode = normalizeExecutionMode(cfg.execution_mode);
  const allowList = Array.isArray(cfg.live_allowed_markets) ? cfg.live_allowed_markets : [];
  const minOrderKrw = Number(cfg.live_min_order_krw ?? 1000);
  const maxOrderKrw = Number(cfg.live_max_order_krw ?? 0);
  const executionMode = execMode;
  const liveDryRun = Boolean(cfg.live_dry_run) || execMode === "LIVE_DRY_RUN";
  const liveEnabled = false;
  const reason = allowList.length && !allowList.includes(String(symbol || ""))
    ? "MARKET_NOT_ALLOWED"
    : "PROVIDER_RUNTIME_REMOVED";

  return {
    executionMode,
    liveEnabled,
    liveDryRun,
    minOrderKrw: Number.isFinite(minOrderKrw) ? minOrderKrw : 1000,
    maxOrderKrw: Number.isFinite(maxOrderKrw) ? maxOrderKrw : 0,
    reason,
    provider: String(provider || "").toUpperCase() || "REMOVED",
  };
}

async function resolveLiveConfig({ exchange, symbol } = {}) {
  return resolveUnsupportedLiveConfig({ exchange, symbol, provider: "REMOVED_SPOT" });
}

async function resolveLiveKiwoomConfig({ exchange, symbol } = {}) {
  return resolveUnsupportedLiveConfig({ exchange, symbol, provider: "REMOVED_STOCK" });
}

async function resolveLiveFuturesConfig({ exchange, symbol, env = process.env } = {}) {
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const cfg = (sys && sys.data) ? sys.data : {};
  const execMode = normalizeExecutionMode(cfg.execution_mode);
  const allowList = Array.isArray(cfg.live_allowed_markets) ? cfg.live_allowed_markets : [];
  const minOrderQuote = Number(cfg.live_min_order_krw ?? 5);
  const maxOrderQuote = Number(cfg.live_max_order_krw ?? 0);
  const executionMode = execMode;
  const liveDryRun = Boolean(cfg.live_dry_run) || execMode === "LIVE_DRY_RUN";
  const discoveryBridge = evaluateV2DiscoveryCanaryLiveBridge({ env, symbol, executionMode });
  const discoveryCanaryConfigured = discoveryBridge.policy.discovery_enabled === true;
  const legacyRuntimeDisabled = discoveryBridge.policy.legacy_runtime_disabled === true;
  let liveEnabled = executionMode === "LIVE" && (
    discoveryCanaryConfigured
      ? discoveryBridge.ok === true
      : cfg.live_enabled === true
  );
  let reason = null;

  const ex = String(exchange || "").toUpperCase();
  if (!ex || !ex.includes("BINANCE")) {
    liveEnabled = false;
    reason = "EXCHANGE_NOT_BINANCE";
  }

  if (allowList.length && !allowList.includes(String(symbol || "")) && discoveryBridge.ok !== true) {
    liveEnabled = false;
    reason = "MARKET_NOT_ALLOWED";
  }

  if (executionMode === "LIVE" && discoveryBridge.ok !== true && discoveryCanaryConfigured && !reason) {
    reason = discoveryBridge.blockers[0] || "V2_DISCOVERY_CANARY_LIVE_BRIDGE_BLOCKED";
  }

  const keys = await resolveBinanceKeys();
  if (!keys.apiKey || !keys.apiSecret) {
    liveEnabled = false;
    if (!reason) reason = "BINANCEFUT_KEYS_MISSING";
  }

  const levRaw = Number(cfg.futures_leverage ?? process.env.FUTURES_LEVERAGE ?? FUTURES_BASE_LEVERAGE);
  const leverage = normalizeFuturesLeverage(levRaw, 3);
  const marginType = normalizeFuturesMarginType(cfg.futures_margin_type ?? process.env.FUTURES_MARGIN_TYPE ?? "CROSSED");
  const exitProfileMode = resolveConfiguredFuturesExitProfileMode(
    cfg.futures_exit_profile_mode ?? process.env.FUTURES_EXIT_PROFILE_MODE ?? "",
    null
  );
  const legacyV1ExchangeWriterEnabled = liveEnabled === true
    && legacyRuntimeDisabled !== true
    && discoveryBridge.ok !== true;

  return {
    executionMode,
    liveEnabled,
    legacyV1ExchangeWriterEnabled,
    legacy_runtime_disabled: legacyRuntimeDisabled,
    liveDryRun,
    minOrderQuote: Number.isFinite(minOrderQuote) ? minOrderQuote : 5,
    maxOrderQuote: discoveryBridge.ok === true
      ? clampDiscoveryCanaryMaxOrderQuote(Number.isFinite(maxOrderQuote) ? maxOrderQuote : 0, discoveryBridge)
      : (Number.isFinite(maxOrderQuote) ? maxOrderQuote : 0),
    apiKey: keys.apiKey,
    apiSecret: keys.apiSecret,
    leverage,
    marginType,
    exitProfileMode,
    reason,
    v2DiscoveryCanaryBridge: discoveryBridge.ok === true,
    v2DiscoveryCanaryBridgeReason: discoveryBridge.reason,
    v2DiscoveryCanaryBridgeBlockers: discoveryBridge.blockers,
    v2DiscoveryCanaryConfigured: discoveryCanaryConfigured,
    v2DiscoveryCanaryLegacyEntryWriteBlocked: legacyV1ExchangeWriterEnabled !== true,
  };
}

async function getBinanceFuturesPositionMode({ apiKey, apiSecret } = {}) {
  const now = Date.now();
  const keyHint = String(apiKey || "").slice(-4);
  if (
    futuresPositionModeCache.value &&
    (now - futuresPositionModeCache.at) < FUTURES_POSITION_MODE_TTL_MS &&
    futuresPositionModeCache.keyHint === keyHint
  ) {
    return futuresPositionModeCache.value;
  }
  const res = await fetchFuturesPositionMode({ apiKey, apiSecret });
  futuresPositionModeCache.value = res;
  futuresPositionModeCache.at = now;
  futuresPositionModeCache.keyHint = keyHint;
  return res;
}

async function ensureFuturesMarginType({ liveCfg, symbol } = {}) {
  const type = normalizeFuturesMarginType(liveCfg && liveCfg.marginType);
  if (!type) return { ok: true, skipped: true };
  const sym = String(symbol || "").trim().toUpperCase();
  const cached = futuresMarginCache.get(sym);
  const now = Date.now();
  if (cached && cached.type === type && (now - cached.at) < FUTURES_MARGIN_TTL_MS) {
    return { ok: true, skipped: true, note: "CACHED" };
  }
  try {
    await setFuturesMarginType({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol: sym,
      marginType: type,
    });
    futuresMarginCache.set(sym, { type, at: now });
    return { ok: true };
  } catch (e) {
    const body = e && e.body ? String(e.body) : "";
    const msg = e && e.message ? String(e.message) : String(e);
    if (body.includes("No need to change margin type") || msg.includes("No need to change margin type") || body.includes("-4046")) {
      return { ok: true, skipped: true };
    }
    if (isBinanceMultiAssetsIsolatedMarginBlocked(e, type)) {
      futuresMarginCache.set(sym, { type, at: now, effectiveType: "CROSSED", note: "MULTI_ASSETS_ISOLATED_BLOCKED" });
      console.warn(
        `[margin_type_skip_multi_assets] ex=BINANCEFUT sym=${sym} requested=${type} effective=CROSSED reason=MULTI_ASSETS_ISOLATED_BLOCKED`
      );
      return {
        ok: true,
        skipped: true,
        note: "MULTI_ASSETS_ISOLATED_BLOCKED",
        effective_margin_type: "CROSSED",
      };
    }
    if (isBinanceMarginTypeOpenOrdersConflict(e)) {
      console.warn(
        `[margin_type_skip_open_orders] ex=BINANCEFUT sym=${sym} requested=${type} reason=OPEN_ORDERS_CONFLICT`
      );
      return {
        ok: true,
        skipped: true,
        note: "OPEN_ORDERS_CONFLICT",
      };
    }
    try {
      const positions = await getBinancePositionsSnapshot({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
      });
      const pos = positions && positions.get(String(symbol || "").toUpperCase());
      const current = String(pos && pos.marginType || "").toUpperCase();
      if (current && current === type) {
        futuresMarginCache.set(sym, { type, at: now });
        return { ok: true, skipped: true, note: "ALREADY_MATCHED" };
      }
      return { ok: false, error: msg, current_margin_type: current || null };
    } catch (_) {
      return { ok: false, error: msg };
    }
  }
}

async function getBinancePositionsSnapshot({ apiKey, apiSecret, forceRefresh } = {}) {
  const now = Date.now();
  if (!forceRefresh && futuresPositionCache.positions && (now - futuresPositionCache.at) < FUTURES_POSITION_TTL_MS) {
    return futuresPositionCache.positions;
  }
  const account = await fetchBinanceFuturesAccount({ apiKey, apiSecret });
  const positions = Array.isArray(account && account.positions) ? account.positions : [];
  const toAmt = (row) => {
    const n = Number(row && row.positionAmt);
    return Number.isFinite(n) ? n : 0;
  };
  const sideRank = (row) => {
    const s = String(row && row.positionSide || "").toUpperCase();
    if (s === "LONG" || s === "SHORT") return 2;
    if (s === "BOTH") return 1;
    return 0;
  };
  const pickPreferredRow = (cur, next) => {
    if (!cur) return next;
    const a = toAmt(cur);
    const b = toAmt(next);
    const aActive = a !== 0;
    const bActive = b !== 0;
    if (aActive !== bActive) return bActive ? next : cur;
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    if (absA !== absB) return absB > absA ? next : cur;
    const rankA = sideRank(cur);
    const rankB = sideRank(next);
    if (rankA !== rankB) return rankB > rankA ? next : cur;
    const updA = Number(cur && cur.updateTime);
    const updB = Number(next && next.updateTime);
    if (Number.isFinite(updA) && Number.isFinite(updB) && updA !== updB) {
      return updB > updA ? next : cur;
    }
    return next;
  };
  const map = new Map();
  for (const p of positions) {
    const sym = String(p && p.symbol || "").toUpperCase();
    if (!sym) continue;
    map.set(sym, pickPreferredRow(map.get(sym), p));
  }
  futuresPositionCache.positions = map;
  futuresPositionCache.at = now;
  return map;
}

function resolveRecentExternalFlatSyncGuard({
  active = false,
  prevActive = false,
  prevPos = null,
  prevMeta = null,
  syncEventMs = null,
  graceMs = FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS,
  nowMs = Date.now(),
} = {}) {
  if (active || !prevActive) return { defer: false, reason: "NOT_EXTERNAL_FLAT" };
  const graceWindowMs = Number.isFinite(Number(graceMs)) && Number(graceMs) > 0
    ? Number(graceMs)
    : FUTURES_EXTERNAL_FLAT_ENTRY_GRACE_MS;
  const meta = (prevMeta && typeof prevMeta === "object") ? prevMeta : {};
  const updatedAtMs = Date.parse(String(prevPos && prevPos.updated_at || ""));
  const refreshAtMs = Number(meta.native_protection_refresh_at_ms);
  const entryRefMs = Number.isFinite(refreshAtMs) && refreshAtMs > 0 ? refreshAtMs : updatedAtMs;
  if (!Number.isFinite(entryRefMs) || entryRefMs <= 0) {
    return { defer: false, reason: "NO_RECENT_ENTRY_REF" };
  }
  const ageMs = Math.max(0, nowMs - entryRefMs);
  if (ageMs > graceWindowMs) {
    return { defer: false, reason: "ENTRY_GRACE_EXPIRED", ageMs, graceWindowMs };
  }
  const recentEntryLike = (
    String(meta.intent || "").toUpperCase() === "ENTRY"
    || String(meta.native_protection_refresh_context || "").toUpperCase() === "ENTRY"
    || String(meta.native_protection_refresh_status || "").toUpperCase() === "OK"
    || !!String(meta.last_fill_intent || "").trim()
  );
  if (!recentEntryLike) {
    return { defer: false, reason: "NO_RECENT_ENTRY_SIGNAL", ageMs, graceWindowMs };
  }
  return {
    defer: true,
    reason: "RECENT_ENTRY_GRACE",
    ageMs,
    graceWindowMs,
    entryRefMs,
    syncEventMs: Number.isFinite(Number(syncEventMs)) ? Number(syncEventMs) : nowMs,
  };
}

function normalizeEntryLineage(meta = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  const entryEventId = String(
    state.entry_event_id
    || state.origin_entry_event_id
    || state.tp_p1_entry_event_id
    || ""
  ).trim() || null;
  const entrySignalType = String(
    state.entry_signal_type
    || state.origin_entry_signal_type
    || ""
  ).trim().toUpperCase() || null;
  const entryGrade = String(
    state.entry_grade
    || state.origin_entry_grade
    || ""
  ).trim().toUpperCase() || null;
  const entryQtyProfile = String(
    state.entry_qty_profile
    || state.origin_entry_qty_profile
    || ""
  ).trim().toUpperCase() || null;
  const entrySignalBarMs = Number(state.entry_signal_bar_ms ?? state.origin_entry_signal_bar_ms);
  const entryExecBarMs = Number(state.entry_exec_bar_ms ?? state.origin_entry_exec_bar_ms);
  return {
    entry_event_id: entryEventId,
    entry_signal_type: entrySignalType,
    entry_grade: entryGrade,
    entry_qty_profile: entryQtyProfile,
    entry_signal_bar_ms: Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null,
    entry_exec_bar_ms: Number.isFinite(entryExecBarMs) ? entryExecBarMs : null,
  };
}

function buildEntryLineageMetaPatch(lineage = {}, {
  includeCurrent = true,
  includeOrigin = true,
} = {}) {
  const patch = {};
  const entryEventId = String(lineage.entry_event_id || "").trim() || null;
  const entrySignalType = String(lineage.entry_signal_type || "").trim().toUpperCase() || null;
  const entryGrade = String(lineage.entry_grade || "").trim().toUpperCase() || null;
  const entryQtyProfile = String(lineage.entry_qty_profile || "").trim().toUpperCase() || null;
  const entrySignalBarMs = Number(lineage.entry_signal_bar_ms);
  const entryExecBarMs = Number(lineage.entry_exec_bar_ms);
  if (includeCurrent) {
    patch.entry_event_id = entryEventId;
    patch.entry_signal_type = entrySignalType;
    patch.entry_grade = entryGrade;
    patch.entry_qty_profile = entryQtyProfile;
    patch.entry_signal_bar_ms = Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null;
    patch.entry_exec_bar_ms = Number.isFinite(entryExecBarMs) ? entryExecBarMs : null;
  }
  if (includeOrigin) {
    patch.origin_entry_event_id = entryEventId;
    patch.origin_entry_signal_type = entrySignalType;
    patch.origin_entry_grade = entryGrade;
    patch.origin_entry_qty_profile = entryQtyProfile;
    patch.origin_entry_signal_bar_ms = Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null;
    patch.origin_entry_exec_bar_ms = Number.isFinite(entryExecBarMs) ? entryExecBarMs : null;
  }
  return patch;
}

function shouldProbeRecoveredEntryTransition({
  prevActive = false,
  prevSide = null,
  side = null,
  prevMeta = null,
} = {}) {
  if (!prevActive) return false;
  const prevNorm = normalizePositionSide(prevSide);
  const currNorm = normalizePositionSide(side);
  if (!prevNorm || !currNorm || prevNorm !== currNorm) return false;
  const meta = (prevMeta && typeof prevMeta === "object") ? prevMeta : {};
  return meta.tp_p0_done === true
    || meta.tp_p1_done === true
    || meta.trail_active === true
    || Number.isFinite(Number(meta.trail_high_at_ms))
    || Number.isFinite(Number(meta.trail_low_at_ms))
    || !!String(meta.entry_event_id || meta.origin_entry_event_id || "").trim();
}

function shouldTreatRecoveredLineageAsEntryTransition({
  persistedEntryLineage = null,
  recoveredEntryLineage = null,
} = {}) {
  const persisted = normalizeEntryLineage(persistedEntryLineage);
  const recovered = normalizeEntryLineage(recoveredEntryLineage);
  const persistedId = String(persisted.entry_event_id || "").trim() || null;
  const recoveredId = String(recovered.entry_event_id || "").trim() || null;
  const persistedExecMs = Number(persisted.entry_exec_bar_ms);
  const recoveredExecMs = Number(recovered.entry_exec_bar_ms);
  if (recoveredId && recoveredId !== persistedId) return true;
  if (!recoveredId && persistedId && Number.isFinite(recoveredExecMs)) return true;
  if (Number.isFinite(recoveredExecMs) && Number.isFinite(persistedExecMs) && recoveredExecMs > persistedExecMs) return true;
  if (Number.isFinite(recoveredExecMs) && !Number.isFinite(persistedExecMs)) return true;
  return false;
}

function resolveActiveEntryLineageForSync({
  externalEntryTransition = false,
  persistedEntryLineage = null,
  recoveredEntryLineage = null,
  // Raw material for the synthetic fallback. The external-sync entry
  // transition path historically left entry_event_id=null when no recent
  // fill/trade/intent could be recovered. That suppressed the canonical
  // exit lineage gate and the Telegram TP1-protection-armed alert, which
  // surfaced as user-visible "TP1 not set" even when TP1 was placed on
  // the exchange. Mirror buildOpeningFillMetaPatch by stamping a
  // deterministic SYN| id when these inputs are sufficient.
  exchange = null,
  symbol = null,
  side = null,
  syncEventMs = null,
  signalTfMs = null,
} = {}) {
  const persisted = normalizeEntryLineage(persistedEntryLineage);
  const recovered = normalizeEntryLineage(recoveredEntryLineage);
  const persistedId = String(persisted.entry_event_id || "").trim() || null;
  const recoveredId = String(recovered.entry_event_id || "").trim() || null;
  if (externalEntryTransition) {
    if (recoveredId) return recovered;
    // Number(null) coerces to 0 which is finite, so we cannot use Number()
    // directly to distinguish "field absent" from "field=0". Read the value
    // first, reject null/undefined, then coerce. A zero epoch is never a
    // real bar-close timestamp, so guarding on >0 is a defensible second
    // line of defence (mirrors buildSyntheticOpeningEntryEventId).
    const toFiniteMs = (raw) => {
      if (raw === null || raw === undefined) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const recoveredSignalBarMs = toFiniteMs(recovered.entry_signal_bar_ms);
    const recoveredExecBarMs = toFiniteMs(recovered.entry_exec_bar_ms);
    const syncEventMsNum = toFiniteMs(syncEventMs);
    const lineageExecMs = recoveredExecBarMs != null
      ? recoveredExecBarMs
      : syncEventMsNum;
    const synthetic = buildSyntheticOpeningEntryEventId({
      exchange,
      symbol,
      signalTfMs,
      side,
      execBarCloseMs: lineageExecMs,
    });
    return {
      entry_event_id: synthetic || null,
      entry_signal_type: recovered.entry_signal_type
        || (synthetic ? SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE : null),
      entry_grade: recovered.entry_grade || null,
      entry_qty_profile: recovered.entry_qty_profile || null,
      entry_signal_bar_ms: recoveredSignalBarMs,
      entry_exec_bar_ms: recoveredExecBarMs != null ? recoveredExecBarMs : lineageExecMs,
      entry_lineage_origin: synthetic ? "SYNTHETIC_SYNC" : "MISSING",
    };
  }
  if (persistedId) return persisted;
  if (recoveredId) return recovered;
  return persisted;
}

function resolveEntryLineageForFill({
  opening = false,
  entryEventIdFromIntent = null,
  entrySignalTypeFromIntent = null,
  intentEntryEventId = null,
  intentEntrySignalType = null,
  posMeta = null,
} = {}) {
  if (opening) {
    return {
      entryEventId: String(entryEventIdFromIntent || "").trim() || null,
      entrySignalType: String(entrySignalTypeFromIntent || "").trim().toUpperCase() || null,
    };
  }
  const persisted = normalizeEntryLineage(posMeta);
  return {
    entryEventId: String(intentEntryEventId || persisted.entry_event_id || "").trim() || null,
    entrySignalType: String(intentEntrySignalType || persisted.entry_signal_type || "").trim().toUpperCase() || null,
  };
}

function resolveLiveOrderSignalRefs({
  signalId = null,
  signalDocId = null,
  entryEventId = null,
  features = null,
  exchange = null,
  symbol = null,
  tf = null,
  barCloseMs = null,
  event = null,
} = {}) {
  const featureBag = (features && typeof features === "object") ? features : {};
  const resolvedSignalId = String(
    signalId || featureBag.signal_id || featureBag.signalId || ""
  ).trim() || null;
  let resolvedSignalDocId = String(
    signalDocId || featureBag.signal_doc_id || featureBag.signalDocId || ""
  ).trim() || null;
  if (!resolvedSignalDocId && exchange && symbol && tf && Number.isFinite(Number(barCloseMs))) {
    resolvedSignalDocId = deriveSignalDocId({
      exchange,
      symbol,
      tf,
      barCloseMs: Number(barCloseMs),
      event,
      signalId: resolvedSignalId,
    });
  }
  const resolvedEntryEventId = String(
    entryEventId || featureBag.entry_event_id || featureBag.entryEventId || ""
  ).trim() || null;
  return {
    signalId: resolvedSignalId,
    signalDocId: resolvedSignalDocId,
    entryEventId: resolvedEntryEventId,
  };
}

function extractEntryLineageCandidate(row = {}, {
  exchange = null,
  symbol = null,
  side = null,
} = {}) {
  const raw = (row && typeof row === "object") ? row : {};
  const ex = String(exchange || "").toUpperCase();
  const sym = String(symbol || "").toUpperCase();
  const rowExchange = String(raw.exchange || "").toUpperCase();
  const rowSymbol = String(raw.symbol || raw.symbol_or_pair_id || raw.market || "").toUpperCase();
  if (ex && rowExchange && rowExchange !== ex) return null;
  if (sym && rowSymbol && rowSymbol !== sym) return null;
  const ev = String(raw.event || "").toUpperCase();
  if (!ev || ev.startsWith("EXIT_")) return null;
  const rowDir = directionFromSignal({ event: raw.event, side: raw.side });
  if (side && rowDir && String(side).toUpperCase() !== rowDir) return null;
  const entryEventId = String(
    raw.entry_event_id
    || raw.entryEventId
    || (raw.features_json && raw.features_json.entry_event_id)
    || ""
  ).trim() || null;
  const entrySignalType = String(
    raw.entry_signal_type
    || raw.entrySignalType
    || (raw.features_json && raw.features_json.entry_signal_type)
    || normalizeEvent(raw.event)
    || ""
  ).trim().toUpperCase() || null;
  if (!entryEventId && !entrySignalType) return null;
  const entryGrade = String(
    raw.entry_grade
    || (raw.features_json && (raw.features_json.entry_grade || raw.features_json.entry_timing_tier || raw.features_json.entry_tier))
    || ""
  ).trim().toUpperCase() || null;
  const entryQtyProfile = String(
    raw.entry_qty_profile
    || (raw.features_json && (raw.features_json.entry_qty_profile || raw.features_json.entry_qty_tier || raw.features_json.qty_profile))
    || ""
  ).trim().toUpperCase() || null;
  const entrySignalBarMs = Number(raw.signal_bar_close_time_utc_ms || raw.bar_close_time_utc_ms);
  const entryExecBarMs = Number(raw.exec_bar_close_time_utc_ms);
  const createdAtMs = Date.parse(String(raw.created_at || raw.updated_at || ""));
  return {
    entry_event_id: entryEventId,
    entry_signal_type: entrySignalType,
    entry_grade: entryGrade,
    entry_qty_profile: entryQtyProfile,
    entry_signal_bar_ms: Number.isFinite(entrySignalBarMs) ? entrySignalBarMs : null,
    entry_exec_bar_ms: Number.isFinite(entryExecBarMs) ? entryExecBarMs : null,
    created_at_ms: Number.isFinite(createdAtMs) ? createdAtMs : null,
    source_event: ev || null,
  };
}

async function recoverRecentEntryLineage({
  exchange,
  symbol,
  side,
  lookbackMs = 48 * 3600 * 1000,
  scanLimit = 240,
  nowMs = Date.now(),
} = {}) {
  try {
    const db = getFirestore();
    const refMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    const cutoffMs = refMs - (Number.isFinite(Number(lookbackMs)) ? Number(lookbackMs) : (48 * 3600 * 1000));
    const maxRows = Math.max(40, Number(scanLimit) || 240);
    const collectBest = (rows) => {
      let best = null;
      let bestMs = -Infinity;
      for (const row of rows || []) {
        const candidate = extractEntryLineageCandidate(row, { exchange, symbol, side });
        if (!candidate) continue;
        const candidateMs = Number(candidate.entry_exec_bar_ms ?? candidate.entry_signal_bar_ms ?? candidate.created_at_ms);
        if (!Number.isFinite(candidateMs) || candidateMs < cutoffMs) continue;
        if (!best || candidateMs > bestMs) {
          best = candidate;
          bestMs = candidateMs;
        }
      }
      return best;
    };

    const fillsSnap = await db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    const bestFill = collectBest(fillsSnap.docs.map((d) => d.data() || {}));
    if (bestFill) return bestFill;

    const tradesSnap = await db.collection("trades_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    const bestTrade = collectBest(tradesSnap.docs.map((d) => d.data() || {}));
    if (bestTrade) return bestTrade;

    const intentsSnap = await db.collection("order_intents_paper")
      .orderBy("created_at", "desc")
      .limit(maxRows)
      .get();
    return collectBest(intentsSnap.docs.map((d) => d.data() || {}));
  } catch (_) {
    return null;
  }
}

async function syncBinanceFuturesPosition({ runId, exchange, symbol, riskBudget, liveCfg, forceRefresh } = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true };
  if (!liveCfg || (!liveCfg.apiKey || !liveCfg.apiSecret)) {
    return { ok: false, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const prevPos = await getPositionReadView({ exchange, symbol });
  const prevMeta = (prevPos && typeof prevPos.meta === "object") ? prevPos.meta : null;
  const prevState = String(prevPos && (prevPos.position_state || prevPos.state) || "").toUpperCase();
  const prevSizePct = Number(prevPos && prevPos.size_pct);
  const prevQtyBase = Number(prevPos && prevPos.qty_base);
  const prevSide = normalizePositionSide(
    prevPos && (
      prevPos.position_side ||
      prevPos.side ||
      (prevMeta && (prevMeta.position_side || prevMeta.external_side || prevMeta.external_position_side))
    )
  );
  const prevActive = (prevState === "ACTIVE" || prevState === "COMMIT" || prevState === "PROBE" || prevState === "SCALE_OUT")
    && (hasPositionSize(prevSizePct) || (Number.isFinite(prevQtyBase) && prevQtyBase > 0));

  const positions = await getBinancePositionsSnapshot({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    forceRefresh: !!forceRefresh,
  });
  const posRaw = positions.get(String(symbol || "").toUpperCase());
  const amt = Number(posRaw && posRaw.positionAmt);
  const qtyBase = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const entryPrice = Number(posRaw && posRaw.entryPrice);
  const markPrice = Number(posRaw && posRaw.markPrice);
  const priceRef = Number.isFinite(entryPrice) && entryPrice > 0
    ? entryPrice
    : (Number.isFinite(markPrice) && markPrice > 0 ? markPrice : null);
  const leverageRaw = Number(posRaw && posRaw.leverage);
  const maxLev = Number(process.env.FUTURES_LEVERAGE_MAX || 3);
  const leverage = normalizeFuturesLeverage(
    Number.isFinite(leverageRaw) ? leverageRaw : liveCfg.leverage,
    Number.isFinite(maxLev) ? maxLev : 3
  );
  const posSideRaw = String(posRaw && posRaw.positionSide || "").toUpperCase();
  const side = posSideRaw === "SHORT"
    ? "SHORT"
    : posSideRaw === "LONG"
      ? "LONG"
      : ((Number.isFinite(amt) && amt < 0) ? "SHORT" : "LONG");
  const active = Number.isFinite(amt) && amt !== 0;
  const notional = (active && Number.isFinite(priceRef)) ? (qtyBase * priceRef) : 0;

  // BINANCEFUT 라이브 포지션은 qty_base(실제 코인 수량)로 수량을 관리하므로
  // size_pct는 항상 1.0(= qty_base 전량 활성)으로 고정한다.
  // 기존 방식(notional / maxKrw * leverage)은 예산 비율로 계산해 BINANCEFUT 청산 수량
  // posQtyBase * size_pct가 극소값(~0.005)이 되는 구조적 버그를 일으킨다.
  const sizePct = active ? 1 : 0;

  const state = active ? "ACTIVE" : "FLAT";
  const syncUpdateMsRaw = Number(posRaw && posRaw.updateTime);
  const syncEventMs = Number.isFinite(syncUpdateMsRaw) && syncUpdateMsRaw > 0 ? syncUpdateMsRaw : Date.now();
  const externalFlatSyncGuard = resolveRecentExternalFlatSyncGuard({
    active,
    prevActive,
    prevPos,
    prevMeta,
    syncEventMs,
  });
  const budgetMaxKrw = (riskBudget && riskBudget.enabled) ? riskBudget.maxKrw : null;
  const budgetUsedKrw = (riskBudget && riskBudget.enabled)
    ? (active
      ? resolveBinanceBudgetUsedKrw({
        position: prevPos,
        riskBudget,
        notionalFallback: notional,
        priceFallback: priceRef,
        qtyBaseFallback: qtyBase,
      })
      : 0)
    : null;
  let externalFlatOrderCleanup = { attempted: false, ok: false, reason: "NOT_REQUIRED" };
  if (externalFlatSyncGuard.defer) {
    const deferMeta = mergeMeta(prevMeta, {
      external_flat_sync_deferred: true,
      external_flat_sync_deferred_reason: externalFlatSyncGuard.reason,
      external_flat_sync_deferred_at_ms: syncEventMs,
      external_flat_sync_deferred_age_ms: externalFlatSyncGuard.ageMs,
      external_flat_sync_deferred_grace_ms: externalFlatSyncGuard.graceWindowMs,
      external_flat_sync_snapshot_qty_base: qtyBase,
      external_flat_sync_snapshot_entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
      external_flat_sync_snapshot_mark_price: Number.isFinite(markPrice) ? markPrice : null,
    });
    const payload = await upsertPositionWithLatestRetry({
      exchange,
      symbol,
      position: prevPos,
      state: prevPos && prevPos.state ? prevPos.state : (prevState || "ACTIVE"),
      positionSide: prevSide || (prevPos && prevPos.position_side) || null,
      sizePct: Number.isFinite(prevSizePct) ? prevSizePct : 1,
      avgPrice: prevPos && prevPos.avg_price != null ? prevPos.avg_price : null,
      qtyBase: Number.isFinite(prevQtyBase) ? prevQtyBase : null,
      runId,
      executionMode: liveCfg.executionMode || "LIVE",
      budgetMaxKrw: prevPos && prevPos.budget_max_krw != null ? prevPos.budget_max_krw : budgetMaxKrw,
      budgetUsedKrw: prevPos && prevPos.budget_used_krw != null ? prevPos.budget_used_krw : budgetUsedKrw,
      budgetSource: prevPos && prevPos.budget_source != null ? prevPos.budget_source : ((riskBudget && riskBudget.enabled) ? riskBudget.source : null),
      meta: deferMeta,
      source: "BINANCE_FUTURES_POSITION_SYNC",
      reason: externalFlatSyncGuard.reason || "EXTERNAL_FLAT_SYNC_DEFERRED",
    });
    return { ok: true, position: payload, active: true, deferredFlatSync: true };
  }
  const syncedAddChainBaseQtyPct = resolveSyncedAddChainBaseQtyPct({
    active,
    posMeta: prevMeta,
    budgetMaxKrw,
    budgetUsedKrw,
  });
  const metaPatch = {
    external_sync: true,
    external_source: "BINANCEFUT",
    external_synced_at: new Date().toISOString(),
    external_qty_base: qtyBase,
    external_side: active ? side : null,
    external_entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
    external_mark_price: Number.isFinite(markPrice) ? markPrice : null,
    external_leverage: Number.isFinite(leverageRaw) ? leverageRaw : null,
  };
  if (!active) {
    if (shouldCleanupExternalFlatOrders({ active, prevActive, liveCfg })) {
      try {
        await cancelFuturesOpenOrders({
          apiKey: liveCfg.apiKey,
          apiSecret: liveCfg.apiSecret,
          symbol,
        });
        externalFlatOrderCleanup = { attempted: true, ok: true, reason: null };
      } catch (cleanupErr) {
        externalFlatOrderCleanup = {
          attempted: true,
          ok: false,
          reason: String(cleanupErr && cleanupErr.message || cleanupErr).slice(0, 160),
        };
      }
    }
    metaPatch.tp_p0_done = false;
    metaPatch.tp_p0_price = null;
    metaPatch.tp_p0_at = null;
    metaPatch.tp_p0_source = null;
    metaPatch.tp_p0_qty_ratio = null;
    metaPatch.tp_p0_entry_event_id = null;
    metaPatch.tp_p0_entry_exec_bar_ms = null;
    metaPatch.tp_p1_done = false;
    metaPatch.tp_p1_price = null;
    metaPatch.tp_p1_target_price = null;
    metaPatch.trail_high = null;
    metaPatch.trail_high_at_ms = null;
    metaPatch.trail_low = null;
    metaPatch.trail_low_at_ms = null;
    metaPatch.trail_active = false;
    metaPatch.tp_p1_pending = false;
    metaPatch.tp_p1_pending_at_ms = null;
    metaPatch.tp_p1_pending_until_ms = null;
    metaPatch.tp_p1_pending_event = null;
    metaPatch.tp_p1_bar_ms = null;
    metaPatch.tp_p1_at = null;
    metaPatch.tp_p1_source = null;
    metaPatch.tp_p1_entry_event_id = null;
    metaPatch.tp_p1_entry_exec_bar_ms = null;
    metaPatch.tp_p1_skip_reason = null;
    metaPatch.tp_p1_skip_note = null;
    metaPatch.tp_p1_skip_at = null;
    metaPatch.trail_delay_bars_required = null;
    metaPatch.trail_delay_mfe_pct_required = null;
    metaPatch.trail_delay_release_reason = null;
    metaPatch.trail_delay_release_at = null;
    metaPatch.trail_delay_mode = null;
    metaPatch.opposite_transition_dir = null;
    metaPatch.opposite_transition_event = null;
    metaPatch.opposite_transition_until_ms = null;
    metaPatch.opposite_transition_stage = null;
    metaPatch.opposite_transition_seen_ms = null;
    metaPatch.position_side = null;
    metaPatch.intent = "EXIT";
    metaPatch.entry_exec_bar_ms = null;
    metaPatch.entry_exec_tf_ms = null;
    metaPatch.entry_event_id = null;
    metaPatch.entry_signal_type = null;
    metaPatch.entry_grade = null;
    metaPatch.entry_qty_profile = null;
    metaPatch.entry_signal_bar_ms = null;
    metaPatch.exit_profile = null;
    metaPatch.exit_profile_reason = null;
    metaPatch.exit_rules_override = null;
    metaPatch.exit_profile_rollback_active = false;
    metaPatch.exit_profile_rollback_until_ms = null;
    metaPatch.exit_profile_rollback_reason = null;
    metaPatch.exit_policy_source = null;
    metaPatch.add_chain_count = 0;
    metaPatch.add_chain_active = false;
    metaPatch.add_chain_last_ms = null;
    metaPatch.add_chain_last_event = null;
    metaPatch.add_chain_last_signal_bar_ms = null;
    metaPatch.add_chain_last_intent_id = null;
    metaPatch.add_chain_last_signal_id = null;
    metaPatch.add_chain_last_avg_before = null;
    metaPatch.add_chain_last_avg_after = null;
    metaPatch.add_chain_last_size_before = null;
    metaPatch.add_chain_last_size_after = null;
    metaPatch.add_chain_last_qty_pct = null;
    metaPatch.add_chain_last_qty_base = null;
    metaPatch.add_chain_last_loss_pct = null;
    metaPatch.add_chain_base_qty_pct = null;
    metaPatch.external_flat_sync_order_cleanup_attempted = externalFlatOrderCleanup.attempted === true;
    metaPatch.external_flat_sync_order_cleanup_ok = externalFlatOrderCleanup.ok === true;
    metaPatch.external_flat_sync_order_cleanup_reason = externalFlatOrderCleanup.reason || null;
    if (prevActive) {
      metaPatch.last_exit_bar_ms = syncEventMs;
      metaPatch.last_exit_dir = prevSide || null;
      metaPatch.last_exit_wall_ms = syncEventMs;
    }
  }
  let meta = mergeMeta(prevMeta, metaPatch);
  const runtimeObservation = active
    ? await loadPositionRuntimeObservationSafe({ enabled: true, exchange, symbol })
    : null;
  const syncMarketRegimeRow = active ? readOpenClawMarketRegimeRow(symbol) : null;
  const syncMarketRegimeCohort = normalizeOpenClawCohort(
    (syncMarketRegimeRow && syncMarketRegimeRow.cohort)
    || (prevMeta && prevMeta.openclaw_market_regime_cohort)
  );
  if (active && (syncMarketRegimeCohort || syncMarketRegimeRow || (prevMeta && prevMeta.openclaw_market_regime_cohort))) {
    meta = mergeMeta(meta, {
      openclaw_market_regime_cohort: syncMarketRegimeCohort || null,
      openclaw_market_regime_objective_score: syncMarketRegimeRow && Number.isFinite(Number(syncMarketRegimeRow.objective_score))
        ? Number(syncMarketRegimeRow.objective_score)
        : (Number.isFinite(Number(prevMeta && prevMeta.openclaw_market_regime_objective_score))
          ? Number(prevMeta.openclaw_market_regime_objective_score)
          : null),
      openclaw_market_regime_drop_verdict: syncMarketRegimeRow
        ? (String(syncMarketRegimeRow.drop_verdict || "").trim().toUpperCase() || null)
        : (prevMeta && prevMeta.openclaw_market_regime_drop_verdict
          ? String(prevMeta.openclaw_market_regime_drop_verdict).trim().toUpperCase() || null
          : null),
    });
  }
  const persistedEntryLineage = normalizeEntryLineage(prevMeta);
  const baseExternalEntryTransition = active && (!prevActive || (prevSide && side && prevSide !== side));
  const shouldProbeSameSideEntryTransition = active && !baseExternalEntryTransition && shouldProbeRecoveredEntryTransition({
    prevActive,
    prevSide,
    side,
    prevMeta,
  });
  const recoveredEntryLineage = (baseExternalEntryTransition || shouldProbeSameSideEntryTransition)
    ? await recoverRecentEntryLineage({ exchange, symbol, side, nowMs: syncEventMs })
    : null;
  const sameSideRecoveredEntryTransition = shouldProbeSameSideEntryTransition && shouldTreatRecoveredLineageAsEntryTransition({
    persistedEntryLineage,
    recoveredEntryLineage,
  });
  const externalEntryTransition = baseExternalEntryTransition || sameSideRecoveredEntryTransition;
  const activeEntryLineage = resolveActiveEntryLineageForSync({
    externalEntryTransition,
    persistedEntryLineage,
    recoveredEntryLineage,
    exchange: ex,
    symbol,
    side,
    syncEventMs,
    // 2026-04-29 — prevMeta is null on cold (positionless) symbols.
    // Number(null) === 0, and 0 is finite, so the original short-circuit
    // `prevMeta && prevMeta.entry_exec_tf_ms` produced 0 → the ternary
    // selected the true branch → `prevMeta.entry_exec_tf_ms` was a
    // null-deref TypeError. Rewrite the guard to test prevMeta itself,
    // then the field, before we use the value.
    signalTfMs: prevMeta && Number.isFinite(Number(prevMeta.entry_exec_tf_ms))
      ? Number(prevMeta.entry_exec_tf_ms)
      : null,
  });
  if (externalEntryTransition) {
    meta = mergeMeta(meta, {
      tp_p0_done: false,
      tp_p0_price: null,
      tp_p0_at: null,
      tp_p0_source: null,
      tp_p0_qty_ratio: null,
      tp_p0_entry_event_id: null,
      tp_p0_entry_exec_bar_ms: null,
      tp_p1_done: false,
      tp_p1_price: null,
      tp_p1_target_price: null,
      trail_high: null,
      trail_high_at_ms: null,
      trail_low: null,
      trail_low_at_ms: null,
      trail_active: false,
      tp_p1_pending: false,
      tp_p1_pending_at_ms: null,
      tp_p1_pending_until_ms: null,
      tp_p1_pending_event: null,
      tp_p1_bar_ms: null,
      tp_p1_at: null,
      tp_p1_source: null,
      tp_p1_entry_event_id: null,
      tp_p1_entry_exec_bar_ms: null,
      trail_delay_bars_required: null,
      trail_delay_mfe_pct_required: null,
      trail_delay_release_reason: null,
      trail_delay_release_at: null,
      trail_delay_mode: null,
      tp_p1_skip_reason: null,
      tp_p1_skip_note: null,
      tp_p1_skip_at: null,
      opposite_transition_dir: null,
      opposite_transition_event: null,
      opposite_transition_until_ms: null,
      opposite_transition_stage: null,
      opposite_transition_seen_ms: null,
      position_side: side,
      intent: "ENTRY",
      entry_exec_tf_ms: null,
      last_exit_bar_ms: null,
      last_exit_dir: null,
      last_exit_wall_ms: null,
      add_chain_count: 0,
      add_chain_active: false,
      add_chain_last_ms: null,
      add_chain_last_event: null,
      add_chain_last_signal_bar_ms: null,
      add_chain_last_intent_id: null,
      add_chain_last_signal_id: null,
      add_chain_last_avg_before: null,
      add_chain_last_avg_after: null,
      add_chain_last_size_before: null,
      add_chain_last_size_after: null,
      add_chain_last_qty_pct: null,
      add_chain_last_qty_base: null,
      add_chain_last_loss_pct: null,
      add_chain_base_qty_pct: Number.isFinite(syncedAddChainBaseQtyPct) ? syncedAddChainBaseQtyPct : null,
      ...buildEntryLineageMetaPatch({
        ...activeEntryLineage,
        entry_exec_bar_ms: Number.isFinite(Number(activeEntryLineage && activeEntryLineage.entry_exec_bar_ms))
          ? Number(activeEntryLineage.entry_exec_bar_ms)
          : syncEventMs,
      }),
    });
  } else if (active) {
    meta = applyTrailObservationSnapshotToMeta({
      meta,
      observation: runtimeObservation,
      positionSide: side,
      entryLineage: activeEntryLineage,
      allowDuringEntryTransition: true,
    });
  }
  if (active && !externalEntryTransition && activeEntryLineage && activeEntryLineage.entry_event_id && !String(meta.entry_event_id || "").trim()) {
    meta = mergeMeta(meta, buildEntryLineageMetaPatch(activeEntryLineage, { includeOrigin: true }));
  }
  if (
    active
    && !externalEntryTransition
    && Number.isFinite(syncedAddChainBaseQtyPct)
    && (
      !Number.isFinite(Number(meta && meta.add_chain_base_qty_pct))
      || Number(meta && meta.add_chain_base_qty_pct) <= POS_SIZE_EPSILON
    )
  ) {
    meta = mergeMeta(meta, {
      add_chain_base_qty_pct: syncedAddChainBaseQtyPct,
    });
  }
  if (active && meta.tp_p0_done === true) {
    const linkedTp0 = isExitMetaLinkedToEntry({
      entryEventId: meta.entry_event_id,
      exitEntryEventId: meta.tp_p0_entry_event_id,
      entryExecMs: meta.entry_exec_bar_ms,
      exitEntryExecMs: meta.tp_p0_entry_exec_bar_ms,
      exitAtMs: Date.parse(String(meta.tp_p0_at || "")),
    });
    if (!linkedTp0) {
      meta = mergeMeta(meta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
      });
    }
  }
  if (active && meta.tp_p1_done === true) {
    const linkedToEntry = isExitMetaLinkedToEntry({
      entryEventId: meta.entry_event_id,
      exitEntryEventId: meta.tp_p1_entry_event_id,
      entryExecMs: meta.entry_exec_bar_ms,
      exitEntryExecMs: meta.tp_p1_entry_exec_bar_ms,
      exitAtMs: Date.parse(String(meta.tp_p1_at || "")),
    });
    if (!linkedToEntry) {
      meta = mergeMeta(meta, {
        tp_p0_done: false,
        tp_p0_price: null,
        tp_p0_at: null,
        tp_p0_source: null,
        tp_p0_qty_ratio: null,
        tp_p0_entry_event_id: null,
        tp_p0_entry_exec_bar_ms: null,
        tp_p1_done: false,
        tp_p1_price: null,
        tp_p1_target_price: null,
        trail_high: null,
        trail_high_at_ms: null,
        trail_low: null,
        trail_low_at_ms: null,
        trail_active: false,
        tp_p1_pending: false,
        tp_p1_pending_at_ms: null,
        tp_p1_pending_until_ms: null,
        tp_p1_pending_event: null,
        tp_p1_bar_ms: null,
        tp_p1_at: null,
        tp_p1_source: null,
        tp_p1_entry_event_id: null,
        tp_p1_entry_exec_bar_ms: null,
        trail_delay_bars_required: null,
        trail_delay_mfe_pct_required: null,
        trail_delay_release_reason: null,
        trail_delay_release_at: null,
        trail_delay_mode: null,
        opposite_transition_dir: null,
        opposite_transition_event: null,
        opposite_transition_until_ms: null,
        opposite_transition_stage: null,
        opposite_transition_seen_ms: null,
        origin_entry_event_id: null,
        origin_entry_signal_type: null,
        origin_entry_grade: null,
        origin_entry_qty_profile: null,
        origin_entry_signal_bar_ms: null,
        origin_entry_exec_bar_ms: null,
      });
    }
  }
  if (active && meta.tp_p1_done !== true && meta.tp_p1_pending === true) {
    try {
      const exCfg = await getExchangeSettingsForProvider(exchange, 0);
      const pendingTf = resolveTfFromMs(meta.entry_exec_tf_ms)
        || String((exCfg && exCfg.exec_tf) || (exCfg && Array.isArray(exCfg.tf_allowlist) && exCfg.tf_allowlist[0]) || defaultExecTfFromEnv() || "15m");
      const db = getFirestore();
      const recentFills = await loadRecentFillsCache(db);
      const lastTpP1Fill = pickLatestTpP1Fill(recentFills, exchange, symbol);
      if (lastTpP1Fill) {
        meta = reconcileTpP1MetaFromFill({ posMeta: meta, pos: prevPos, fill: lastTpP1Fill });
      } else {
        const pendingState = await getTpP1PendingState({
          exchange,
          symbol,
          tf: pendingTf,
          posMeta: meta,
          tpP1PendingHoldMs: resolveTpP1PendingHoldMs(),
          nowMs: Date.now(),
        });
        if (!pendingState.active) {
          meta = mergeMeta(meta, {
            tp_p1_pending: false,
            tp_p1_pending_at_ms: null,
            tp_p1_pending_until_ms: null,
            tp_p1_pending_event: null,
            tp_p1_pending_cleared_at: new Date().toISOString(),
            tp_p1_pending_cleared_reason: "PENDING_EXPIRED_NO_ACTIVE_INTENT",
          });
        }
      }
    } catch (_) {}
  }
  if (active && shouldRepairActiveExitRuntimeState({ positionSide: side, entryPrice: priceRef, posMeta: meta })) {
    meta = await repairActivePositionExitRuntimeState({
      exchange,
      symbol,
      positionSide: side,
      entryPrice: priceRef,
      leverage,
      liveCfg,
      posMeta: meta,
      cohort: syncMarketRegimeCohort,
      sysCfg: {},
      execBarCloseMs: syncEventMs,
    });
  }

  let exchangeOpenOrders = [];
  let exchangeAlgoOrders = [];
  let recentFills = null;
  if (active) {
    try {
      const db = getFirestore();
      recentFills = await loadRecentFillsCache(db);
      const lastTpP0Fill = pickLatestTpP0Fill(recentFills, exchange, symbol);
      if (lastTpP0Fill) {
        meta = reconcileTpP0MetaFromFill({
          posMeta: meta,
          pos: prevPos,
          fill: lastTpP0Fill,
        });
      }
      const lastTpP1Fill = pickLatestTpP1Fill(recentFills, exchange, symbol);
      if (lastTpP1Fill) {
        meta = reconcileTpP1MetaFromFill({
          posMeta: meta,
          pos: prevPos,
          fill: lastTpP1Fill,
        });
      }
    } catch (_) {}
  }
  if (active) {
    try {
      exchangeOpenOrders = await fetchFuturesOpenOrders({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
      });
    } catch (e) {
      console.warn("[BINANCE_SYNC_OPEN_ORDERS_FAIL]", symbol, e && e.message ? e.message : String(e));
    }
    try {
      exchangeAlgoOrders = await fetchFuturesAlgoOpenOrders({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
      });
    } catch (e) {
      exchangeAlgoOrders = { endpointUnavailable: true, note: e && e.message ? e.message : String(e), orders: [] };
      console.warn("[BINANCE_SYNC_ALGO_ORDERS_FAIL]", symbol, e && e.message ? e.message : String(e));
    }
  }
  const reconcileInputMeta = (!active && prevActive)
    ? buildFlatSyncReconcileInputMeta({ prevMeta, clearedMeta: meta })
    : meta;
  const reconciledProjection = reconcileBinancePositionMetaWithExchange({
    active,
    meta: reconcileInputMeta,
    positionSide: active ? side : null,
    qtyBase,
    previousQtyBase: prevActive ? prevQtyBase : null,
    entryPrice: priceRef,
    leverage,
    openOrders: exchangeOpenOrders,
    algoOrders: exchangeAlgoOrders,
    // Supply mark price so the qty-reduction-recovery path can seed the
    // trail watermark from a real waterline instead of leaving it null.
    markPrice: Number.isFinite(markPrice) ? markPrice : (Number.isFinite(priceRef) ? priceRef : null),
  });
  meta = reconciledProjection.meta;
  let v2FlatSyncExitReplay = null;

  // ── Recovery-path trade alert (Fix #1, 2026-04-18) ────────────────
  // When the reconciler flips tp_p1_done=false → true via the qty-reduction
  // recovery path (Binance filled the TP but our fill-sync missed the
  // event), the operator used to receive NO Telegram alert because the
  // normal sendTradeExecutionAlert path only fires on verified fills.
  // Detect the transition here and dispatch a late alert so the operator
  // always hears about TP1 hits.
  try {
    const prevTpP1Done = prevMeta && prevMeta.tp_p1_done === true;
    const newTpP1Done = meta && meta.tp_p1_done === true;
    const recoveryTrigger = meta && meta.tp_p1_recovery_trigger;
    const alreadyAlerted = meta && meta.tp_p1_recovery_alert_sent_at;
    if (newTpP1Done && !prevTpP1Done && recoveryTrigger && !alreadyAlerted) {
      const alertQty = Number.isFinite(prevQtyBase) && Number.isFinite(qtyBase)
        ? Math.max(0, prevQtyBase - qtyBase)
        : null;
      const alertPrice = Number.isFinite(meta.tp_p1_recovery_seeded_price)
        ? meta.tp_p1_recovery_seeded_price
        : (Number.isFinite(markPrice) ? markPrice : priceRef);
      dispatchTradeExecutionAlert({
        exchange,
        symbol,
        event: "EXIT_TP_P1_RECOVERY",
        intent: "EXIT",
        side: active ? side : null,
        execPrice: alertPrice,
        execQty: alertQty,
        executionMode: liveCfg.executionMode || "LIVE",
        reason: recoveryTrigger,
        note: "TP1 fill detected via qty-reduction recovery (fill_sync missed the primary event).",
        // The recovery path fires *because* TP1 actually filled on Binance but
        // our fill-sync missed the bookkeeping event. Supplying the canonical
        // transition here lets the alert pass the canonical-exit gate instead
        // of being silenced as MISSING_CANONICAL_EXIT_TRANSITION — the exact
        // failure mode captured by the 2026-04-17 audit (BTCUSDT / DOGEUSDT).
        rawEvidenceEvent: "EXIT_TP_P1_RECOVERY",
        canonicalExitEvent: "EXIT_TP_P1_RECOVERY",
        canonicalExitStage: "TP1",
        canonicalTransitionEvent: "TP1_REACHED",
        canonicalTransitionEvents: ["TP1_REACHED"],
      }).catch((e) => {
        console.warn("[TP1_RECOVERY_ALERT_FAIL]", e && e.message ? e.message : String(e));
      });
      // Idempotency marker so the alert is not re-sent on every subsequent sync.
      meta = mergeMeta(meta, {
        tp_p1_recovery_alert_sent_at: new Date().toISOString(),
      });
    }
  } catch (recoveryAlertErr) {
    console.warn("[TP1_RECOVERY_ALERT_GUARD]",
      recoveryAlertErr && recoveryAlertErr.message ? recoveryAlertErr.message : recoveryAlertErr);
  }
  if (!active && prevActive) {
    try {
      const replayPlan = resolveV2FlatSyncExitReplayPlan({
        exchange,
        symbol,
        prevMeta,
        meta,
        prevSide,
        prevQtyBase,
        qtyBase,
        fillPrice: Number.isFinite(markPrice) ? markPrice : priceRef,
        observedAtMs: syncEventMs,
      });
      v2FlatSyncExitReplay = await replayV2FlatSyncExitArtifacts({
        exchange,
        symbol,
        plan: replayPlan,
        fillPrice: Number.isFinite(markPrice) ? markPrice : priceRef,
        observedAtMs: syncEventMs,
      });
      meta = mergeMeta(meta, {
        v2_flat_sync_exit_replay_attempted_at: new Date().toISOString(),
        v2_flat_sync_exit_replay_ok: v2FlatSyncExitReplay && v2FlatSyncExitReplay.ok === true,
        v2_flat_sync_exit_replay_reason: v2FlatSyncExitReplay && v2FlatSyncExitReplay.reason || null,
        v2_flat_sync_exit_replay_result_n: Array.isArray(v2FlatSyncExitReplay && v2FlatSyncExitReplay.results)
          ? v2FlatSyncExitReplay.results.length
          : 0,
      });
    } catch (replayErr) {
      console.warn("[V2_FLAT_SYNC_EXIT_REPLAY_FAIL]", symbol, replayErr && replayErr.message ? replayErr.message : String(replayErr));
      meta = mergeMeta(meta, {
        v2_flat_sync_exit_replay_attempted_at: new Date().toISOString(),
        v2_flat_sync_exit_replay_ok: false,
        v2_flat_sync_exit_replay_reason: String(replayErr && replayErr.message || replayErr).slice(0, 160),
      });
    }
  }
  if (Array.isArray(reconciledProjection.invariants) && reconciledProjection.invariants.length) {
    meta = mergeMeta(meta, {
      exchange_projection_invariants: reconciledProjection.invariants,
      exchange_projection_checked_at: new Date().toISOString(),
    });
  } else {
    meta = mergeMeta(meta, {
      exchange_projection_invariants: [],
      exchange_projection_checked_at: new Date().toISOString(),
    });
  }

  const payload = await upsertPositionWithLatestRetry({
    exchange,
    symbol,
    position: prevPos,
    state,
    positionSide: active ? side : null,
    sizePct,
    avgPrice: Number.isFinite(priceRef) ? priceRef : null,
    qtyBase: qtyBase || 0,
    runId,
    executionMode: liveCfg.executionMode || "LIVE",
    budgetMaxKrw,
    budgetUsedKrw,
    budgetSource: (riskBudget && riskBudget.enabled) ? riskBudget.source : null,
    meta,
    source: "BINANCE_FUTURES_POSITION_SYNC",
    reason: "BINANCE_FUTURES_POSITION_SYNC",
  });

  return { ok: true, position: payload, active };
}

function buildFuturesPositionSyncKey(exchange, symbol) {
  return `${String(exchange || "").toUpperCase()}::${String(symbol || "").toUpperCase()}`;
}

function shouldSkipRecentFuturesPositionSync({
  exchange,
  symbol,
  dedupeWindowMs = 0,
  nowMs = Date.now(),
} = {}) {
  const windowMs = Math.max(0, Math.floor(Number(dedupeWindowMs) || 0));
  if (windowMs <= 0) return { skip: false, reason: "DEDUPE_DISABLED" };
  const key = buildFuturesPositionSyncKey(exchange, symbol);
  const lastAtMs = Number(futuresPositionSyncRecentState.get(key));
  if (!Number.isFinite(lastAtMs) || lastAtMs <= 0) {
    return { skip: false, reason: "NO_RECENT_SYNC" };
  }
  const ageMs = Math.max(0, Number(nowMs) - lastAtMs);
  if (ageMs >= windowMs) {
    return { skip: false, reason: "DEDupe_EXPIRED", ageMs, dedupeWindowMs: windowMs };
  }
  return {
    skip: true,
    reason: "RECENT_SYNC_DEDUPE",
    ageMs,
    dedupeWindowMs: windowMs,
  };
}

function markRecentFuturesPositionSync({
  exchange,
  symbol,
  atMs = Date.now(),
} = {}) {
  const key = buildFuturesPositionSyncKey(exchange, symbol);
  const markAtMs = Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now();
  futuresPositionSyncRecentState.set(key, markAtMs);
  return markAtMs;
}

async function serializeFuturesPositionSync({ exchange, symbol, runner } = {}) {
  const key = buildFuturesPositionSyncKey(exchange, symbol);
  const prev = futuresPositionSyncQueue.get(key) || Promise.resolve();
  const current = prev
    .catch(() => {})
    .then(async () => runner());
  futuresPositionSyncQueue.set(key, current);
  try {
    return await current;
  } finally {
    if (futuresPositionSyncQueue.get(key) === current) {
      futuresPositionSyncQueue.delete(key);
    }
  }
}

async function acquireFuturesPositionSyncLease({
  exchange,
  symbol,
  ttlMs = FUTURES_POSITION_SYNC_LEASE_TTL_MS,
  holderId = futuresPositionSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || FUTURES_POSITION_SYNC_LEASE_TTL_MS));
  const ref = db.doc(buildFuturesPositionSyncLeaseDocPath(exchange, symbol));
  let acquired = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() || {}) : {};
    const owner = String(data.owner || "");
    const leaseUntilMs = Number(data.lease_until_ms);
    const expired = !Number.isFinite(leaseUntilMs) || leaseUntilMs <= now;
    if (!owner || owner === holderId || expired) {
      acquired = true;
      tx.set(ref, {
        owner: holderId,
        lease_until_ms: leaseUntil,
        heartbeat_ms: now,
        heartbeat_at: new Date(now).toISOString(),
      }, { merge: true });
      return;
    }
    acquired = false;
    holder = owner || null;
  });
  return { acquired, holder, leaseUntil, holderId };
}

async function heartbeatFuturesPositionSyncLease({
  exchange,
  symbol,
  ttlMs = FUTURES_POSITION_SYNC_LEASE_TTL_MS,
  holderId = futuresPositionSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const now = Date.now();
  const leaseUntil = now + Math.max(3000, Math.floor(Number(ttlMs) || FUTURES_POSITION_SYNC_LEASE_TTL_MS));
  const ref = db.doc(buildFuturesPositionSyncLeaseDocPath(exchange, symbol));
  let ok = false;
  let holder = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    const owner = String(data.owner || "");
    if (owner !== String(holderId || "")) {
      holder = owner || null;
      return;
    }
    ok = true;
    tx.set(ref, {
      lease_until_ms: leaseUntil,
      heartbeat_ms: now,
      heartbeat_at: new Date(now).toISOString(),
    }, { merge: true });
  });
  return { ok, holder, leaseUntil, holderId };
}

async function releaseFuturesPositionSyncLease({
  exchange,
  symbol,
  holderId = futuresPositionSyncLeaseHolderId,
} = {}) {
  const db = getFirestore();
  const ref = db.doc(buildFuturesPositionSyncLeaseDocPath(exchange, symbol));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() || {};
    if (String(data.owner || "") !== String(holderId || "")) return;
    tx.set(ref, {
      lease_until_ms: Date.now() - 1,
      released_at: new Date().toISOString(),
    }, { merge: true });
  });
}

async function runDistributedFuturesPositionSync({
  exchange,
  symbol,
  runner,
  leaseEnabled = FUTURES_POSITION_SYNC_LEASE_ENABLED,
  ttlMs = FUTURES_POSITION_SYNC_LEASE_TTL_MS,
  waitMs = FUTURES_POSITION_SYNC_LEASE_WAIT_MS,
  acquireLease = acquireFuturesPositionSyncLease,
  heartbeatLease = heartbeatFuturesPositionSyncLease,
  releaseLease = releaseFuturesPositionSyncLease,
  sleep = sleepMs,
} = {}) {
  if (typeof runner !== "function") throw new Error("runDistributedFuturesPositionSync: runner required");
  if (leaseEnabled !== true) return runner();

  const maxWaitMs = Math.max(0, Math.floor(Number(waitMs) || 0));
  const deadline = Date.now() + maxWaitMs;
  let lease = null;
  for (;;) {
    lease = await acquireLease({ exchange, symbol, ttlMs });
    if (lease && lease.acquired === true) break;
    if (Date.now() >= deadline) {
      return { ok: false, skipped: true, reason: "LEASE_HELD", holder: lease && lease.holder ? lease.holder : null };
    }
    await sleep(Math.min(250, Math.max(50, deadline - Date.now())));
  }

  let heartbeatLost = false;
  const heartbeatEveryMs = Math.max(1000, Math.floor(Math.max(3000, ttlMs) / 3));
  const heartbeatTimer = setInterval(() => {
    heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId })
      .then((res) => {
        if (!res || res.ok !== true) heartbeatLost = true;
      })
      .catch(() => {
        heartbeatLost = true;
      });
  }, heartbeatEveryMs);

  try {
    const heartbeat = await heartbeatLease({ exchange, symbol, ttlMs, holderId: lease.holderId });
    if (!heartbeat || heartbeat.ok !== true) {
      return { ok: false, skipped: true, reason: "LEASE_LOST", holder: heartbeat && heartbeat.holder ? heartbeat.holder : null };
    }
    const result = await runner();
    if (heartbeatLost && result && typeof result === "object") {
      return {
        ...result,
        lease_lost_after_run: true,
      };
    }
    return result;
  } finally {
    clearInterval(heartbeatTimer);
    await releaseLease({ exchange, symbol, holderId: lease && lease.holderId }).catch(() => {});
  }
}

async function syncFuturesPositionOnly({
  runId,
  exchange,
  symbol,
  force = false,
  dedupeWindowMs = 0,
} = {}) {
  const ex = String(exchange || "").toUpperCase();
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true, reason: "EXCHANGE_NOT_BINANCE" };
  if (force !== true) {
    const dedupe = shouldSkipRecentFuturesPositionSync({
      exchange,
      symbol,
      dedupeWindowMs,
    });
    if (dedupe.skip === true) {
      return {
        ok: true,
        skipped: true,
        reason: dedupe.reason,
        ageMs: dedupe.ageMs,
        dedupeWindowMs: dedupe.dedupeWindowMs,
      };
    }
  }
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  if (!liveCfg || (!liveCfg.apiKey || !liveCfg.apiSecret)) {
    return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };
  }
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  const result = await serializeFuturesPositionSync({
    exchange,
    symbol,
    runner: () => runDistributedFuturesPositionSync({
      exchange,
      symbol,
      runner: () => syncBinanceFuturesPosition({
        runId,
        exchange,
        symbol,
        riskBudget,
        liveCfg,
        // Avoid unconditional refresh on every market/tick; only force when explicitly marked.
        forceRefresh: shouldForceFuturesRefresh(symbol),
      }),
    }),
  });
  if (result && result.ok === true && result.skipped !== true) {
    markRecentFuturesPositionSync({ exchange, symbol });
  }
  return result;
}

function shouldForceImmediateLiveFuturesReconcile({ exchange, executionMode } = {}) {
  const ex = String(exchange || "").toUpperCase();
  const mode = String(executionMode || "").toUpperCase();
  return ex.includes("BINANCE") && mode === "LIVE";
}

function qtyPrecision(step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const str = String(s);
  const idx = str.indexOf(".");
  return idx === -1 ? 0 : (str.length - idx - 1);
}

function roundQtyToStep(qty, step) {
  const q = Number(qty);
  const s = Number(step);
  if (!Number.isFinite(q) || !Number.isFinite(s) || s <= 0) return null;
  const floored = Math.floor(q / s) * s;
  const precision = qtyPrecision(s);
  return Number(floored.toFixed(precision));
}

function ceilQtyToStep(qty, step) {
  const q = Number(qty);
  const s = Number(step);
  if (!Number.isFinite(q) || !Number.isFinite(s) || s <= 0) return null;
  const ceiled = Math.ceil((q / s) - 1e-12) * s;
  const precision = qtyPrecision(s);
  return Number(ceiled.toFixed(precision));
}

async function computeFuturesOrderQty({ symbol, priceRef, notionalQuote, reduceOnly, info, skipMinNotional, qtyBase } = {}) {
  if (!Number.isFinite(priceRef) || priceRef <= 0) return { ok: false, reason: "BAD_PRICE" };
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) return { ok: false, reason: "BAD_NOTIONAL" };

  const data = info || await fetchFuturesExchangeInfoWithCache(symbol);
  const step = data.stepSize || 0;
  const qtyRaw = (Number.isFinite(Number(qtyBase)) && Number(qtyBase) > 0)
    ? Number(qtyBase)
    : (notionalQuote / priceRef);
  let qty = roundQtyToStep(qtyRaw, step);
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, reason: "ORDER_TOO_SMALL" };

  const minQty = Number(data.minQty);
  const minNotional = Number(data.minNotional);
  if (!reduceOnly) {
    if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) {
      const bumpedByMinQty = ceilQtyToStep(minQty, step);
      if (Number.isFinite(bumpedByMinQty) && bumpedByMinQty > 0) qty = bumpedByMinQty;
    }
    if (!skipMinNotional && Number.isFinite(minNotional) && minNotional > 0 && (priceRef * qty) < minNotional) {
      const minQtyByNotional = ceilQtyToStep(minNotional / priceRef, step);
      if (Number.isFinite(minQtyByNotional) && minQtyByNotional > 0 && minQtyByNotional > qty) {
        qty = minQtyByNotional;
      }
    }
  }
  if (Number.isFinite(minQty) && minQty > 0 && qty < minQty) return { ok: false, reason: "ORDER_TOO_SMALL" };

  const maxQty = Number(data.maxQty);
  if (Number.isFinite(maxQty) && maxQty > 0 && qty > maxQty) {
    qty = roundQtyToStep(maxQty, step);
  }

  if (!skipMinNotional && Number.isFinite(minNotional) && priceRef * qty < minNotional) {
    return { ok: false, reason: "ORDER_TOO_SMALL", minNotional };
  }

  return { ok: true, qty, minNotional };
}

function resolveEntryMinOrderBudgetAdjustment({
  minRequiredQuote,
  notionalQuote,
  budgetMax,
  leverageMult,
  maxFractionAllowed,
  qtyFraction,
  maxEntryNotional,
  marketCapBudget,
  currentPosBudgetUsed,
} = {}) {
  const minQuote = Number(minRequiredQuote);
  const currentNotional = Number(notionalQuote);
  const maxAllowed = Number.isFinite(Number(maxFractionAllowed))
    ? Number(maxFractionAllowed)
    : Number(qtyFraction || 0);
  const baseBudget = Number(budgetMax) * Number(leverageMult);
  const requiredFraction = (Number.isFinite(baseBudget) && baseBudget > 0)
    ? (minQuote / baseBudget)
    : null;
  const availableEntryNotional = Number.isFinite(Number(maxEntryNotional))
    ? Number(maxEntryNotional)
    : ((Number.isFinite(baseBudget) && baseBudget > 0) ? baseBudget : null);

  if (!Number.isFinite(minQuote) || minQuote <= 0 || (Number.isFinite(currentNotional) && currentNotional >= minQuote)) {
    return {
      ok: true,
      adjusted: false,
      notionalQuote: currentNotional,
      maxAllowed,
      requiredFraction,
      availableEntryNotional,
    };
  }

  if (Number.isFinite(availableEntryNotional) && availableEntryNotional >= minQuote) {
    return {
      ok: true,
      adjusted: true,
      notionalQuote: minQuote,
      maxAllowed,
      requiredFraction,
      availableEntryNotional,
      adjustmentSource: (
        Number.isFinite(requiredFraction) &&
        requiredFraction > 0 &&
        Number.isFinite(maxAllowed) &&
        requiredFraction <= maxAllowed
      )
        ? "FRACTIONAL_MIN_BUMP"
        : "AVAILABLE_NOTIONAL_MIN_BUMP",
    };
  }

  return {
    ok: false,
    adjusted: false,
    reason: "MIN_ORDER_EXCEEDS_BUDGET",
    maxAllowed,
    requiredFraction,
    availableEntryNotional,
    note: [
      `min_required=${minQuote}`,
      `notional=${currentNotional}`,
      `max_allowed=${maxAllowed}`,
      `required_fraction=${Number.isFinite(requiredFraction) ? requiredFraction : "NA"}`,
      `max_entry_notional=${Number.isFinite(availableEntryNotional) ? availableEntryNotional : "NA"}`,
      `market_cap_budget=${Number.isFinite(Number(marketCapBudget)) ? Number(marketCapBudget) : "NA"}`,
      `pos_budget_used=${Number.isFinite(Number(currentPosBudgetUsed)) ? Number(currentPosBudgetUsed) : "NA"}`,
    ].join(", "),
  };
}

function resolvePosQtyBase(pos) {
  const base = Number(pos && (pos.qty_base ?? (pos.meta && (pos.meta.qty_base ?? pos.meta.external_qty_base))));
  if (Number.isFinite(base) && base > 0) return base;
  const used = Number(pos && pos.budget_used_krw);
  const avg = Number(pos && pos.avg_price);
  if (Number.isFinite(used) && Number.isFinite(avg) && avg > 0) return used / avg;
  return 0;
}

async function executeLiveOrder({
  liveCfg,
  symbol,
  side,
  qtyFraction,
  riskBudget,
  pos,
  bar,
  slippageBps,
} = {}) {
  if (!liveCfg || (!liveCfg.liveEnabled && !liveCfg.liveDryRun)) {
    return {
      ok: false,
      mode: "PAPER",
      reason: liveCfg && liveCfg.reason ? liveCfg.reason : "PROVIDER_RUNTIME_REMOVED",
    };
  }
  return {
    ok: false,
    mode: "LIVE",
    reason: liveCfg.reason || "PROVIDER_RUNTIME_REMOVED",
    note: `unsupported_provider=${String(liveCfg.provider || "REMOVED").toUpperCase()} symbol=${String(symbol || "").toUpperCase()}`,
  };
}

async function resolveBinancePositionContext({ liveCfg, symbol } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret || !sym) return null;
  const positions = await getBinancePositionsSnapshot({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    forceRefresh: true,
  });
  const row = positions && positions.get(sym);
  if (!row) return null;
  const amt = Number(row && row.positionAmt);
  const qtyBase = Number.isFinite(amt) ? Math.abs(amt) : 0;
  const active = Number.isFinite(amt) && amt !== 0 && qtyBase > 0;
  const entryPriceRaw = Number(row && row.entryPrice);
  const markPriceRaw = Number(row && row.markPrice);
  const leverageRaw = Number(row && row.leverage);
  const posSideRaw = String(row && row.positionSide || "").toUpperCase();
  const positionSide = posSideRaw === "SHORT"
    ? "SHORT"
    : posSideRaw === "LONG"
      ? "LONG"
      : (Number.isFinite(amt) && amt < 0 ? "SHORT" : "LONG");
  return {
    active,
    qtyBase,
    positionSide,
    entryPrice: (Number.isFinite(entryPriceRaw) && entryPriceRaw > 0) ? entryPriceRaw : null,
    markPrice: (Number.isFinite(markPriceRaw) && markPriceRaw > 0) ? markPriceRaw : null,
    leverage: (Number.isFinite(leverageRaw) && leverageRaw > 0) ? leverageRaw : null,
  };
}

function computeBinanceNativeProtectionPrices({ positionSide, entryPrice, leverage, rules, posMeta } = {}) {
  const side = String(positionSide || "").toUpperCase();
  const px = Number(entryPrice);
  const levRaw = Number(leverage);
  const lev = Number.isFinite(levRaw) && levRaw > 0 ? levRaw : 1;
  const slPct = Number(rules && rules.SL);
  const tpPct = Number(rules && rules.TP_P1);
  const tpQtyRatioRaw = Number(rules && rules.TP_P1_QTY);
  const tpQtyRatio = Number.isFinite(tpQtyRatioRaw) && tpQtyRatioRaw > 0
    ? Math.min(1, Math.max(POS_SIZE_EPSILON, tpQtyRatioRaw))
    : 0.5;
  const tp0QtyRatio = 0;
  const tp0OrderQtyRatio = 0;
  let tpOrderQtyRatio = Math.min(1, Math.max(POS_SIZE_EPSILON, tpQtyRatio));
  if (!Number.isFinite(px) || px <= 0 || (side !== "LONG" && side !== "SHORT")) return null;
  if (!Number.isFinite(slPct) || !Number.isFinite(tpPct)) return null;
  const slMove = slPct / lev;
  const tpMove = tpPct / lev;
  let stopTriggerPx = null;
  const tp0TriggerPx = null;
  let tpTriggerPx = null;
  if (side === "LONG") {
    stopTriggerPx = px * (1 + slMove);
    tpTriggerPx = px * (1 + tpMove);
  } else {
    const slDen = 1 + slMove;
    const tpDen = 1 + tpMove;
    if (slDen > 0) stopTriggerPx = px / slDen;
    if (tpDen > 0) tpTriggerPx = px / tpDen;
  }
  if (!Number.isFinite(stopTriggerPx) || stopTriggerPx <= 0) return null;
  if (!Number.isFinite(tpTriggerPx) || tpTriggerPx <= 0) tpTriggerPx = null;

  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const tpP1Done = meta.tp_p1_done === true;
  const trailActive = meta.trail_active === true;
  // 2026-04-18 (BTC incident): we need to surface whether the runner-floor
  // override actually executed and what it returned. The prior log captured
  // only the final stopTriggerPx, which was indistinguishable between
  // "RUNNER_FLOOR override ran and picked initial-SL" (impossible) and
  // "runnerExit returned stopPrice=null so override was skipped" (actual).
  // Stash the decision so the caller can log it without re-running the math.
  let runnerExitDebug = null;
  if (tpP1Done || trailActive) {
    const runnerExit = computeRunnerExitStopPrice({
      avg: px,
      leverageEff: lev,
      side,
      rules,
      tpP1Done,
      trailActive,
      trailHigh: Number(meta.trail_high),
      trailLow: Number(meta.trail_low),
      entryRDistance: Number(meta.entry_r_distance),
    });
    runnerExitDebug = {
      called: true,
      stopPrice: runnerExit && Number.isFinite(Number(runnerExit.stopPrice)) ? Number(runnerExit.stopPrice) : null,
      stopSource: runnerExit && runnerExit.stopSource ? String(runnerExit.stopSource) : null,
      trailStop: runnerExit && Number.isFinite(Number(runnerExit.trailStop)) ? Number(runnerExit.trailStop) : null,
      trailStopByR: runnerExit && Number.isFinite(Number(runnerExit.trailStopByR)) ? Number(runnerExit.trailStopByR) : null,
      trailStopByPct: runnerExit && Number.isFinite(Number(runnerExit.trailStopByPct)) ? Number(runnerExit.trailStopByPct) : null,
      runnerFloorStop: runnerExit && Number.isFinite(Number(runnerExit.runnerFloorStop)) ? Number(runnerExit.runnerFloorStop) : null,
      inputs: {
        avg: Number.isFinite(px) ? px : null,
        leverageEff: Number.isFinite(lev) ? lev : null,
        side,
        runner_min_profit_pct: Number.isFinite(Number(rules && rules.RUNNER_MIN_PROFIT_PCT))
          ? Number(rules.RUNNER_MIN_PROFIT_PCT)
          : null,
        trail_r_multiple: Number.isFinite(Number(rules && rules.TRAIL_R_MULTIPLE))
          ? Number(rules.TRAIL_R_MULTIPLE)
          : null,
        trail_pct: Number.isFinite(Number(rules && rules.TRAIL_PCT))
          ? Number(rules.TRAIL_PCT)
          : null,
        trail_high: Number.isFinite(Number(meta.trail_high)) ? Number(meta.trail_high) : null,
        trail_low: Number.isFinite(Number(meta.trail_low)) ? Number(meta.trail_low) : null,
        entry_r_distance: Number.isFinite(Number(meta.entry_r_distance)) ? Number(meta.entry_r_distance) : null,
        tp_p1_done: tpP1Done,
        trail_active: trailActive,
      },
    };
    if (runnerExit && Number.isFinite(Number(runnerExit.stopPrice)) && Number(runnerExit.stopPrice) > 0) {
      stopTriggerPx = Number(runnerExit.stopPrice);
    }
  }

  return {
    closeSide: side === "SHORT" ? "BUY" : "SELL",
    stopTriggerPx,
    tp0TriggerPx,
    tpTriggerPx,
    tp0QtyRatio,
    tpQtyRatio,
    tp0OrderQtyRatio,
    tpOrderQtyRatio,
    runnerExitDebug,
  };
}

function resolveNativeProtectionAlertReason(result) {
  const reason = String(result && result.reason ? result.reason : "").trim();
  if (reason) return reason;
  if (result && result.skipped === true) return "SKIPPED";
  return "UNKNOWN";
}

function isRetryableNativeProtectionReason(reason) {
  const code = String(reason || "").toUpperCase();
  return code === "POSITION_CONTEXT_FETCH_FAIL"
    || code === "NATIVE_CANCEL_FAIL"
    || code === "NATIVE_PLACE_FAIL"
    // 2026-04-18 P1-2: UNPROTECTED_ACTIVE_POSITION is the cancel-succeeded
    // + place-failed case — position is naked right now and retry is the
    // most time-critical repair available. Must be retryable.
    || code === "UNPROTECTED_ACTIVE_POSITION"
    || code === "NATIVE_PRICE_COMPUTE_FAIL"
    || code === "TP1_NATIVE_PROTECTION_INCOMPLETE";
}

async function resolveNativeProtectionAlertChannel(exchange = "BINANCEFUT") {
  const envChannel = String(process.env.BINANCE_NATIVE_ALERT_CHANNEL || "").trim();
  if (envChannel) {
    return BINANCE_NATIVE_ALERT_TELEGRAM_ONLY ? filterTelegramChannels(envChannel) : envChannel;
  }
  const ex = String(exchange || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
  const now = Date.now();
  const cached = nativeProtectionAlertChannelCache.get(ex);
  if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < BINANCE_NATIVE_ALERT_CHANNEL_CACHE_MS) {
    return cached.channel || "";
  }
  const sys = await getSystemSettingsForProvider(ex, 5000);
  const sysChannel = String(sys && sys.data && sys.data.alert_channel || "").trim();
  const resolved = BINANCE_NATIVE_ALERT_TELEGRAM_ONLY ? filterTelegramChannels(sysChannel) : sysChannel;
  nativeProtectionAlertChannelCache.set(ex, { ts: now, channel: resolved });
  return resolved;
}

async function sendRescueAddRepriceAlert({
  exchange = "BINANCEFUT",
  symbol,
  event,
  executionMode = "LIVE",
  position,
  avgBefore,
  avgAfter,
  addQtyPct,
  addQtyBase,
  fillPrice,
  exitRules,
  nativeProtectionMeta,
  alertFn,
  channelResolver,
} = {}) {
  const mode = String(executionMode || "").trim().toUpperCase();
  if (mode !== "LIVE") return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
  const rawChannel = String(process.env.RESCUE_ADD_AUDIT_ALERT_CHANNEL || "").trim();
  let channel = rawChannel ? filterTelegramChannels(rawChannel) : "";
  if (!channel) {
    const resolveChannel = typeof channelResolver === "function"
      ? channelResolver
      : resolveNativeProtectionAlertChannel;
    channel = await resolveChannel(exchange);
  }
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const pos = position && typeof position === "object" ? position : null;
  const stage = pos ? buildExitStageView({
    exchange,
    position: pos,
    closePrice: Number.isFinite(Number(fillPrice)) ? Number(fillPrice) : Number(pos.avg_price),
    leverageFallback: resolvePositionLeverage({ position: pos, fallback: 1 }),
  }) : null;
  const nativeMeta = nativeProtectionMeta && typeof nativeProtectionMeta === "object" ? nativeProtectionMeta : {};
  const nativeStatus = String(nativeMeta.native_protection_refresh_status || "NA").toUpperCase() || "NA";
  const nativeReason = String(nativeMeta.native_protection_refresh_reason || "").trim();
  const nativeTpStatus = String(nativeMeta.native_protection_tp_status || "").trim().toUpperCase();
  const nativeTpReason = String(nativeMeta.native_protection_tp_reason || "").trim();
  const nativeTpQtyRatio = Number(nativeMeta.native_protection_tp_qty_ratio);
  const rulesTxt = formatExitRulesCompactLocal(exitRules || (pos && pos.meta && pos.meta.exit_rules_override) || null);
  const title = `${String(symbol || "").toUpperCase() || "UNKNOWN"} ADD 평단/보호주문 재설정`;
  const lines = [
    `이벤트: ${String(event || "ADD").toUpperCase()}`,
    `평단: ${formatAlertNumber(avgBefore)} -> ${formatAlertNumber(avgAfter)}`,
    `ADD 수량: ${formatAlertNumber(addQtyPct, 4)} / ${formatAlertNumber(addQtyBase, 6)}`,
    `체결가: ${formatAlertNumber(fillPrice)}`,
  ];
  if (rulesTxt) lines.push(`청산규칙: ${rulesTxt}`);
  if (stage) {
    lines.push(`내부 SL: ${formatAlertNumber(stage.sl_price)} / TP1: ${formatAlertNumber(stage.tp1_price)}`);
    lines.push(`내부 BE: ${formatAlertNumber(stage.be_price)} / Trail: ${formatAlertNumber(stage.trail_stop)}`);
  }
  lines.push(
    `네이티브 보호주문: ${nativeStatus}` +
    (nativeReason ? ` (${nativeReason})` : "") +
    ` / SL: ${formatAlertNumber(nativeMeta.native_protection_stop_price)}`
  );
  if (Number.isFinite(Number(nativeMeta.native_protection_tp_price))) {
    lines[lines.length - 1] += ` / TP: ${formatAlertNumber(nativeMeta.native_protection_tp_price)}`;
  }
  if (nativeTpStatus) {
    lines[lines.length - 1] += ` / TP1상태: ${nativeTpStatus}`;
    if (Number.isFinite(nativeTpQtyRatio)) {
      lines[lines.length - 1] += ` ${Math.round(nativeTpQtyRatio * 100)}%`;
    }
    if (nativeTpReason) {
      lines[lines.length - 1] += ` (${nativeTpReason})`;
    }
  }
  const notify = typeof alertFn === "function" ? alertFn : sendAlert;
  return notify({
    channel,
    title,
    body: lines.join("\n"),
    severity: "INFO",
  });
}

function buildRescueAddRepriceAlertContext({
  position,
  fallbackMeta,
  fallbackAvgBefore,
  fallbackAvgAfter,
  fallbackAddQtyPct,
  fallbackAddQtyBase,
} = {}) {
  const pos = position && typeof position === "object" ? position : null;
  const positionMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : null;
  const meta = positionMeta || (fallbackMeta && typeof fallbackMeta === "object" ? fallbackMeta : {});
  const avgBefore = Number.isFinite(Number(meta.add_chain_last_avg_before))
    ? Number(meta.add_chain_last_avg_before)
    : Number.isFinite(Number(fallbackAvgBefore))
      ? Number(fallbackAvgBefore)
      : Number(pos && pos.avg_price);
  const avgAfter = Number.isFinite(Number(meta.add_chain_last_avg_after))
    ? Number(meta.add_chain_last_avg_after)
    : Number.isFinite(Number(fallbackAvgAfter))
      ? Number(fallbackAvgAfter)
      : Number(pos && pos.avg_price);
  const addQtyPct = Number.isFinite(Number(meta.add_chain_last_qty_pct))
    ? Number(meta.add_chain_last_qty_pct)
    : Number.isFinite(Number(fallbackAddQtyPct))
      ? Number(fallbackAddQtyPct)
      : null;
  const addQtyBase = Number.isFinite(Number(meta.add_chain_last_qty_base))
    ? Number(meta.add_chain_last_qty_base)
    : Number.isFinite(Number(fallbackAddQtyBase))
      ? Number(fallbackAddQtyBase)
      : null;
  const nativeProtectionMeta = positionMeta || (fallbackMeta && typeof fallbackMeta === "object" ? fallbackMeta : {});
  return {
    avgBefore,
    avgAfter,
    addQtyPct,
    addQtyBase,
    nativeProtectionMeta,
  };
}

function shouldSendNativeProtectionAlert({ symbol, reason } = {}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const why = String(reason || "").trim().toUpperCase() || "UNKNOWN";
  const key = `${sym || "UNKNOWN"}:${why}`;
  const now = Date.now();
  const last = Number(nativeProtectionAlertCooldownMap.get(key));
  if (Number.isFinite(last) && (now - last) < BINANCE_NATIVE_ALERT_COOLDOWN_MS) {
    return false;
  }
  nativeProtectionAlertCooldownMap.set(key, now);
  return true;
}

async function sendNativeProtectionWarningAlert({
  symbol,
  reason,
  error,
  attempts,
  exchange = "BINANCEFUT",
  liveMode = "LIVE",
} = {}) {
  if (!BINANCE_NATIVE_ALERT_ENABLED) return { ok: false, skipped: true, reason: "ALERT_DISABLED" };
  if (!shouldSendNativeProtectionAlert({ symbol, reason })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  try {
    const channel = await resolveNativeProtectionAlertChannel(exchange);
    if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
    const title = `[V2 Native Protection] ${String(symbol || "").toUpperCase() || "UNKNOWN"} native protection 경고`;
    const lines = [
      `reason: ${String(reason || "UNKNOWN")}`,
      `attempts: ${Number.isFinite(Number(attempts)) ? Number(attempts) : 1}`,
      `mode: ${String(liveMode || "LIVE")}`,
    ];
    if (error) lines.push(`error: ${String(error).slice(0, 240)}`);
    return sendAlert({
      channel,
      title,
      body: lines.join("\n"),
      severity: "WARN",
    });
  } catch (e) {
    console.warn("[BINANCE_NATIVE_ALERT_FAIL]", e && e.message ? e.message : String(e));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

function isExitFailureAlertEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  return ev.startsWith("EXIT_SL")
    || ev.startsWith("EXIT_TP_P1")
    || ev.startsWith("EXIT_TP_C")
    || ev.startsWith("EXIT_TRAIL");
}

function isCriticalLiveExitExceptionEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  return ev.startsWith("EXIT_SL")
    || ev.startsWith("EXIT_TP_P0")
    || ev.startsWith("EXIT_TP_P1")
    || ev.startsWith("EXIT_TP_C")
    || ev.startsWith("EXIT_TRAIL");
}

function shouldTrackLiveSubmitEvidence({ intent = null, event = null, executionMode = null } = {}) {
  const intentUpper = String(intent || "").trim().toUpperCase();
  const modeUpper = String(executionMode || "").trim().toUpperCase();
  if (modeUpper !== "LIVE") return false;
  if (intentUpper !== "EXIT") return false;
  return isCriticalLiveExitExceptionEvent(event);
}

function resolveLiveSubmitExceptionFamily(reason = null) {
  const token = String(reason || "").trim().toUpperCase();
  if (!token) return null;
  if (token === "LIVE_EXCEPTION") return "LIVE_EXCEPTION";
  if (token === "ACK_TIMEOUT" || token === "TP1_ACK_TIMEOUT") return "ACK_TIMEOUT";
  if (token.startsWith("LIVE_")) return "LIVE_FAILED";
  if (token.startsWith("TP_P1_")) return "TP_P1_GUARD";
  return token;
}

function buildLiveSubmitIntentPatch({
  state = null,
  nowMs = Date.now(),
  orderId = null,
  clientOrderId = null,
  exceptionFamily = null,
  error = null,
  executionMode = null,
  execPrice = null,
  execQtyBase = null,
} = {}) {
  const ts = Number.isFinite(Number(nowMs)) ? Math.round(Number(nowMs)) : Date.now();
  const patch = {
    live_submit_state: String(state || "").trim().toUpperCase() || null,
    live_submit_mode: String(executionMode || "").trim().toUpperCase() || null,
    live_submit_order_id: orderId != null ? String(orderId) : null,
    live_submit_client_order_id: clientOrderId != null ? String(clientOrderId) : null,
    live_submit_exception_family: exceptionFamily != null ? String(exceptionFamily) : null,
    live_submit_error: error != null ? String(error).slice(0, 240) : null,
  };
  if (patch.live_submit_state === "SUBMITTING") {
    patch.live_submit_started_at_ms = ts;
    patch.live_submit_finished_at_ms = null;
    patch.live_submit_ack_at_ms = null;
  } else if (patch.live_submit_state === "ACKED") {
    patch.live_submit_finished_at_ms = ts;
    patch.live_submit_ack_at_ms = ts;
  } else if (patch.live_submit_state) {
    patch.live_submit_finished_at_ms = ts;
  }
  if (Number.isFinite(Number(execPrice))) patch.live_submit_exec_price = Number(execPrice);
  if (Number.isFinite(Number(execQtyBase))) patch.live_submit_exec_qty_base = Number(execQtyBase);
  return patch;
}

async function patchLiveSubmitIntentEvidence(intentId, patch = null) {
  if (!intentId || !patch || typeof patch !== "object") return;
  try {
    await patchIntent(intentId, patch);
  } catch (err) {
    console.warn("[LIVE_SUBMIT_INTENT_PATCH_FAIL]", err && err.message ? err.message : String(err));
  }
}

function shouldSendLiveExitExceptionAlert({ exchange, symbol, event, intentId } = {}) {
  const key = [
    String(exchange || "").trim().toUpperCase() || "UNKNOWN",
    String(symbol || "").trim().toUpperCase() || "UNKNOWN",
    String(event || "").trim().toUpperCase() || "UNKNOWN",
    String(intentId || "").trim() || "NA",
  ].join(":");
  const now = Date.now();
  const last = liveExitExceptionAlertCooldownMap.get(key);
  if (Number.isFinite(last) && (now - last) < LIVE_EXIT_EXCEPTION_ALERT_COOLDOWN_MS) {
    return false;
  }
  liveExitExceptionAlertCooldownMap.set(key, now);
  return true;
}

function buildLiveExitExceptionIntegrityAlertPayload({
  exchange = null,
  symbol = null,
  event = null,
  intentId = null,
  signalId = null,
  error = null,
  executionMode = null,
} = {}) {
  const normalizedExchange = String(exchange || "").trim().toUpperCase() || "UNKNOWN";
  const normalizedSymbol = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const normalizedEvent = String(event || "").trim().toUpperCase() || "UNKNOWN";
  const normalizedMode = String(executionMode || "LIVE").trim().toUpperCase() || "LIVE";
  const lines = [
    "reason: LIVE_EXCEPTION",
    "phase: LIVE_EXIT_EXECUTION",
    `exchange: ${normalizedExchange}`,
    `symbol: ${normalizedSymbol}`,
    `event: ${normalizedEvent}`,
    `intent_id: ${String(intentId || "N/A")}`,
    `signal_id: ${String(signalId || "N/A")}`,
    `mode: ${normalizedMode}`,
  ];
  if (error) lines.push(`error: ${String(error).slice(0, 240)}`);
  return {
    title: `[V2 긴급] ${normalizedSymbol} live exit exception`,
    body: lines.join("\n"),
    severity: "ERROR",
  };
}

async function sendLiveExitExceptionIntegrityAlert({
  exchange,
  symbol,
  event,
  intentId,
  signalId,
  error,
  executionMode,
} = {}) {
  if (!isCriticalLiveExitExceptionEvent(event)) {
    return { ok: false, skipped: true, reason: "NON_CRITICAL_EXIT_EVENT" };
  }
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_ALERT_CHANNEL" };
  if (!shouldSendLiveExitExceptionAlert({ exchange, symbol, event, intentId })) {
    return { ok: false, skipped: true, reason: "ALERT_COOLDOWN" };
  }
  try {
    const payload = buildLiveExitExceptionIntegrityAlertPayload({
      exchange,
      symbol,
      event,
      intentId,
      signalId,
      error,
      executionMode,
    });
    return await sendAlert({
      channel,
      title: payload.title,
      body: payload.body,
      severity: payload.severity,
    });
  } catch (e) {
    console.warn("[LIVE_EXIT_EXCEPTION_ALERT_FAIL]", e && e.message ? e.message : String(e));
    return { ok: false, skipped: true, reason: "ALERT_FAIL" };
  }
}

function resolveFailureAlertPositionSide(pos) {
  return normalizePositionSide(
    pos && (
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    )
  );
}

function resolveFailureAlertCloseRatio({ pos, qtyFraction } = {}) {
  const prevSize = Number(pos && pos.size_pct);
  const qty = Number(qtyFraction);
  if (!Number.isFinite(prevSize) || prevSize <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return Math.max(0, Math.min(1, qty / prevSize));
}

function buildFailureExitAlertPayload({
  event = null,
  pos = null,
  posMeta = null,
  exitRules = null,
  qtyFraction = null,
  prevSize = null,
  useBudget = false,
} = {}) {
  const closeRatio = resolveIntentFillCloseRatio({ qtyFraction, prevSize, useBudget });
  const currentQtyBase = Number(pos && pos.qty_base);
  const observedQtyAbs = (
    Number.isFinite(currentQtyBase) && currentQtyBase > 0 &&
    Number.isFinite(closeRatio) && closeRatio > 0
  ) ? (currentQtyBase * closeRatio) : null;
  const fullExit = Number.isFinite(closeRatio)
    ? closeRatio >= 0.999
    : Number(qtyFraction) >= 0.999;
  return {
    closeRatio,
    ...buildCanonicalExitAlertPayload({
      event,
      position: pos,
      posMeta,
      exitRules: exitRules || null,
      observedQtyRatio: closeRatio ?? qtyFraction,
      fullExit,
    }),
    ...buildExitContractAlertPayload({
      pos,
      posMeta,
      exitRules: exitRules || null,
      observedQtyAbs,
    }),
  };
}

function notifyTradeExitFailureAlert(payload = {}) {
  if (String(payload.intent || "").toUpperCase() !== "EXIT") return;
  if (!isExitFailureAlertEvent(payload.event)) return;
  sendTradeExecutionFailureAlert(payload).catch((e) => {
    console.warn("[TRADE_EXEC_FAIL_ALERT_FAIL]", e && e.message ? e.message : String(e));
  });
}

async function dispatchTradeExecutionAlert(payload = {}) {
  try {
    const result = await sendTradeExecutionAlert(payload);
    if (result && result.skipped === true) {
      console.warn(
        `[TRADE_EXEC_ALERT_SKIP] sym=${payload.symbol || "-"} ev=${payload.event || "-"} reason=${result.reason || "UNKNOWN"}`
      );
    } else if (result && result.ok !== true) {
      console.warn(
        `[TRADE_EXEC_ALERT_UNCONFIRMED] sym=${payload.symbol || "-"} ev=${payload.event || "-"} reason=${result.reason || "UNKNOWN"}`
      );
    }
    return result;
  } catch (e) {
    console.warn("[TRADE_EXEC_ALERT_FAIL]", e && e.message ? e.message : String(e));
    return { ok: false, skipped: false, reason: e && e.message ? e.message : String(e) };
  }
}

async function refreshBinanceNativeProtectionWithRetry({
  liveCfg,
  exchange,
  symbol,
  fallbackSide,
  fallbackEntryPrice,
  fallbackLeverage,
  exitRulesOverride,
  posMeta,
  writerSource = null,
  signal = null,
  abortSignal = null,
} = {}) {
  const protectionSignal = signal || abortSignal || null;
  if (protectionSignal && protectionSignal.aborted) {
    return { ok: false, skipped: true, reason: "NATIVE_REFRESH_ABORTED", attempts: 0, max_attempts: 0 };
  }
  if (!isAuthorizedBinanceNativeStopWriter(writerSource)) {
    return {
      ok: false,
      skipped: true,
      reason: "NATIVE_STOP_WRITE_NON_AUTHORITY_LAYER",
      writer_source: String(writerSource || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
      attempts: 0,
      max_attempts: 0,
    };
  }
  const lease = await acquireBinanceNativeRefreshLease({ exchange, symbol });
  if (!lease.acquired) {
    return {
      ok: false,
      skipped: true,
      reason: "NATIVE_REFRESH_LEASE_HELD",
      holder: lease.holder || null,
      attempts: 0,
      max_attempts: BINANCE_NATIVE_PROTECTION_RETRY_COUNT + 1,
    };
  }
  const totalAttempts = BINANCE_NATIVE_PROTECTION_RETRY_COUNT + 1;
  let lastResult = null;
  const heartbeatEveryMs = Math.max(1000, Math.floor(BINANCE_NATIVE_REFRESH_LEASE_TTL_MS / 3));
  let heartbeatTimer = null;
  try {
    heartbeatTimer = setInterval(() => {
      heartbeatBinanceNativeRefreshLease({ exchange, symbol, holderId: lease.holderId }).catch(() => {});
    }, heartbeatEveryMs);
    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      if (protectionSignal && protectionSignal.aborted) {
        return {
          ok: false,
          skipped: true,
          reason: "NATIVE_REFRESH_ABORTED",
          attempts: Math.max(0, attempt - 1),
          max_attempts: totalAttempts,
        };
      }
      const heartbeat = await heartbeatBinanceNativeRefreshLease({ exchange, symbol, holderId: lease.holderId });
      if (!heartbeat.ok) {
        return {
          ok: false,
          skipped: true,
          reason: "NATIVE_REFRESH_LEASE_LOST",
          holder: heartbeat.holder || null,
          attempts: Math.max(0, attempt - 1),
          max_attempts: totalAttempts,
        };
      }
      const result = await refreshBinanceNativeProtection({
        liveCfg,
        exchange,
        symbol,
        fallbackSide,
        fallbackEntryPrice,
        fallbackLeverage,
        exitRulesOverride,
        posMeta,
        signal: protectionSignal,
      });
      const enriched = {
        ...(result && typeof result === "object" ? result : {}),
        attempts: attempt,
        max_attempts: totalAttempts,
      };
      if (enriched.ok === true) {
        try {
          await syncFuturesPositionOnly({
            runId: `RUN__NATIVE_PROTECTION_SYNC__${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${Date.now()}`,
            exchange,
            symbol,
            liveCfg: liveCfg || null,
            force: true,
          });
          enriched.sync_after_refresh_ok = true;
        } catch (syncErr) {
          enriched.sync_after_refresh_ok = false;
          enriched.sync_after_refresh_error = syncErr && syncErr.message ? syncErr.message : String(syncErr);
        }
        try {
          await syncNativeProtectionMetaAfterRefresh({
            exchange,
            symbol,
            runId: `RUN__NATIVE_PROTECTION_META_SYNC__${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${Date.now()}`,
            executionMode: "LIVE",
            posMeta,
            nativeProtection: enriched,
          });
          enriched.meta_after_refresh_ok = true;
        } catch (metaErr) {
          enriched.meta_after_refresh_ok = false;
          enriched.meta_after_refresh_error = metaErr && metaErr.message ? metaErr.message : String(metaErr);
        }
        return enriched;
      }
      lastResult = enriched;
      const reason = resolveNativeProtectionAlertReason(enriched);
      if (attempt >= totalAttempts || !isRetryableNativeProtectionReason(reason)) break;
      if (BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS > 0) {
        await sleepMs(BINANCE_NATIVE_PROTECTION_RETRY_DELAY_MS);
      }
    }
    return lastResult || { ok: false, reason: "UNKNOWN", attempts: totalAttempts, max_attempts: totalAttempts };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    try {
      await releaseBinanceNativeRefreshLease({ exchange, symbol });
    } catch (_) {}
  }
}

async function syncNativeProtectionMetaAfterRefresh({
  exchange,
  symbol,
  runId = null,
  executionMode = "LIVE",
  posMeta = null,
  nativeProtection = null,
  position = null,
  maxAttempts = 8,
  retryDelayMs = 250,
  readPosition = getPosition,
  writePositionMeta = upsertPositionMetaOnly,
} = {}) {
  if (!nativeProtection || typeof nativeProtection !== "object") return null;
  const metaPatch = buildNativeProtectionMetaPatch({
    nativeProtection,
    intent: "ENTRY",
    execBarCloseMs: Number(posMeta && (posMeta.entry_exec_bar_ms || posMeta.last_entry_bar_ms)) || null,
    posMeta,
  });
  if (!metaPatch || typeof metaPatch !== "object" || !Object.keys(metaPatch).length) return null;
  let currentPos = (position && typeof position === "object")
    ? position
    : await readPosition({ exchange, symbol });
  const totalAttempts = Math.max(1, Math.floor(Number(maxAttempts) || 0));
  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const currentMeta = (currentPos && currentPos.meta && typeof currentPos.meta === "object")
      ? currentPos.meta
      : {};
    const mergedMeta = mergeMeta(currentMeta, metaPatch);
    try {
      return await writePositionMeta({
        exchange,
        symbol,
        runId,
        executionMode,
        meta: mergedMeta,
        source: "BINANCE_NATIVE_PROTECTION_REFRESH",
        mutationKind: "POSITION_META_UPSERT",
        reason: attempt > 1 ? "NATIVE_PROTECTION_REFRESH_META_SYNC_RETRY" : "NATIVE_PROTECTION_REFRESH_META_SYNC",
        expectedWriteToken: Object.prototype.hasOwnProperty.call(currentPos || {}, "position_write_token")
          ? (currentPos.position_write_token ?? null)
          : null,
        suppressAuthorityAlert: attempt < totalAttempts,
        suppressAuthorityRuntimeFamily: attempt < totalAttempts,
        suppressAuthorityRuntimeFamilyReason: "WRITER_RETRY_IN_PROGRESS",
      });
    } catch (err) {
      const code = String(err && err.code || "").trim().toUpperCase();
      if (!["POSITION_WRITE_TOKEN_MISMATCH", "POSITION_WRITE_LEASE_HELD", "POSITION_WRITE_LEASE_LOST"].includes(code)) {
        throw err;
      }
      if (attempt >= totalAttempts) throw err;
      const baseDelayMs = Math.max(0, Number(retryDelayMs) || 0);
      const retryDelayResolvedMs = code === "POSITION_WRITE_TOKEN_MISMATCH"
        ? baseDelayMs
        : Math.min(1500, baseDelayMs * attempt);
      if (retryDelayResolvedMs > 0) await sleep(retryDelayResolvedMs);
      currentPos = await readPosition({ exchange, symbol });
    }
  }
  return currentPos;
}

function isAuthorizedBinanceNativeStopWriter(writerSource = null) {
  return isBinanceNativeStopWriterSource(writerSource);
}

function resolveNativeProtectionStageState(posMeta = null) {
  const meta = (posMeta && typeof posMeta === "object") ? posMeta : {};
  const simplifiedExitV2Enabled = resolveSimplifiedExitV2PositionFlag({ currentMeta: meta });
  const tp1Done = meta.tp_p1_done === true;
  const trailActive = meta.trail_active === true;
  return {
    simplifiedExitV2Enabled,
    tp0Eligible: false,
    tp1Eligible: tp1Done !== true && trailActive !== true,
  };
}

function resolveSimplifiedExitV2PositionFlag({ currentMeta = null } = {}) {
  const meta = (currentMeta && typeof currentMeta === "object") ? currentMeta : {};
  return isSimplifiedExitV2Active(meta);
}

function isForbiddenTp0ExitIntent({ currentMeta = null, event = null } = {}) {
  const eventUpper = String(event || "").trim().toUpperCase();
  if (!eventUpper.startsWith("EXIT_TP_P0")) return false;
  return true;
}

function isExplicitLegacyTp0Position({ currentMeta = null } = {}) {
  void currentMeta;
  return false;
}

function resolveNativeProtectionPositionMeta(positionMeta = null) {
  const meta = (positionMeta && typeof positionMeta === "object") ? positionMeta : {};
  if (resolveSimplifiedExitV2PositionFlag({ currentMeta: meta }) === true) {
    if (meta.simplified_exit_v2_enabled === true || meta.simplifiedExitV2Enabled === true) return meta;
  }
  if (resolveSimplifiedExitV2PositionFlag({ currentMeta: meta }) !== true) return meta;
  return {
    ...meta,
    simplified_exit_v2_enabled: true,
  };
}

function shouldExecuteImmediateNativeProtectionRefresh({
  liveDryRun = false,
  opening = false,
  closing = false,
  remainingQtyBase = null,
} = {}) {
  if (liveDryRun === true) return false;
  if (opening === true) return true;
  if (closing !== true) return false;
  if (!Number.isFinite(Number(remainingQtyBase))) return true;
  return Number(remainingQtyBase) > POS_SIZE_EPSILON;
}

function resolveLiveNativeProtectionLifecycleFlags(intent = null) {
  const token = String(intent || "").trim().toUpperCase();
  return {
    opening: token === "ENTRY" || token === "ADD",
    closing: token === "EXIT",
  };
}

async function ensureLiveImmediateNativeProtection({
  liveCfg,
  exchange,
  symbol,
  requestArgs,
  opening = false,
  closing = false,
  remainingQtyBase = null,
  intent = null,
  requestRepair = requestBinanceNativeProtectionRefresh,
  refreshDirect = refreshBinanceNativeProtectionWithRetry,
} = {}) {
  const executeImmediately = shouldExecuteImmediateNativeProtectionRefresh({
    liveDryRun: liveCfg && liveCfg.liveDryRun === true,
    opening,
    closing,
    remainingQtyBase,
  });
  const repairResult = await requestRepair({
    exchange,
    symbol,
    fallbackSide: requestArgs && requestArgs.fallbackSide,
    fallbackEntryPrice: requestArgs && requestArgs.fallbackEntryPrice,
    fallbackLeverage: requestArgs && requestArgs.fallbackLeverage,
    exitRulesOverride: requestArgs && requestArgs.exitRulesOverride,
    posMeta: requestArgs && requestArgs.posMeta,
    source: "LIVE_EXECUTOR",
    reason: closing ? "LIVE_EXECUTOR_POST_EXIT_FILL" : "LIVE_EXECUTOR_POST_ENTRY_FILL",
    dispatchReason: `LIVE_EXECUTOR_NATIVE_STOP_REFRESH_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}_${String(intent || "").toUpperCase() || "UNKNOWN"}`,
    executeImmediately: false,
    dispatchExitWorker: executeImmediately !== true,
  });
  if (executeImmediately !== true) return repairResult;
  const directResult = await refreshDirect({
    liveCfg,
    exchange,
    symbol,
    fallbackSide: requestArgs && requestArgs.fallbackSide,
    fallbackEntryPrice: requestArgs && requestArgs.fallbackEntryPrice,
    fallbackLeverage: requestArgs && requestArgs.fallbackLeverage,
    exitRulesOverride: requestArgs && requestArgs.exitRulesOverride,
    posMeta: requestArgs && requestArgs.posMeta,
    writerSource: BINANCE_NATIVE_STOP_WRITER_SOURCE,
  });
  if (directResult && typeof directResult === "object") {
    return {
      ...directResult,
      queued_request_id: repairResult && repairResult.request_id ? repairResult.request_id : null,
      queued_request_reason: repairResult && repairResult.reason ? String(repairResult.reason) : null,
      queued_dispatch_ok: repairResult && repairResult.dispatch_ok === true,
      immediate_authority_refresh: true,
    };
  }
  return directResult;
}

function buildLiveNativeProtectionRefreshArgs({
  liveCfg,
  exchange,
  symbol,
  side,
  execPrice,
  priceRef,
  leverageMult,
  exitRulesOverride,
  positionMeta,
} = {}) {
  return {
    liveCfg,
    exchange,
    symbol,
    fallbackSide: side,
    fallbackEntryPrice: Number.isFinite(execPrice) ? execPrice : priceRef,
    fallbackLeverage: leverageMult,
    exitRulesOverride,
    posMeta: resolveNativeProtectionPositionMeta(positionMeta),
  };
}

async function requestBinanceNativeProtectionRefresh({
  exchange,
  symbol,
  fallbackSide,
  fallbackEntryPrice,
  fallbackLeverage,
  exitRulesOverride,
  posMeta,
  source = "UNKNOWN_SOURCE",
  reason = "NON_AUTHORITY_LAYER_REQUEST",
  dispatchReason = null,
  dispatchExitWorker = true,
  executeImmediately = false,
} = {}) {
  const exchangeUpper = String(exchange || "").trim().toUpperCase() || "UNKNOWN";
  const symbolUpper = String(symbol || "").trim().toUpperCase() || "UNKNOWN";
  const sourceUpper = String(source || "UNKNOWN_SOURCE").trim().toUpperCase() || "UNKNOWN_SOURCE";
  const fallbackSideUpper = String(fallbackSide || "").trim().toUpperCase();
  const fallbackPosSide = (fallbackSideUpper === "SELL" || fallbackSideUpper === "SHORT") ? "SHORT" : "LONG";
  const request = await recordExitRepairRequest({
    exchange: exchangeUpper,
    symbol: symbolUpper,
    source: sourceUpper,
    requestKind: "NATIVE_STOP_REFRESH",
    reason,
    // C11 invariant: dedupe by (exchange, symbol, requestKind) so that
    // simultaneous repair requests from watchdog, reconciler, repair service,
    // and tick-exit internal paths coalesce into a single queued job.  The
    // original source is retained in the payload for observability but no
    // longer fans out the queue.
    dedupeKey: `${exchangeUpper}__${symbolUpper}__NATIVE_STOP_REFRESH`,
    payload: {
      fallback_side: fallbackSideUpper || null,
      fallback_entry_price: Number.isFinite(Number(fallbackEntryPrice)) ? Number(fallbackEntryPrice) : null,
      fallback_leverage: Number.isFinite(Number(fallbackLeverage)) ? Number(fallbackLeverage) : null,
      exit_rules_override: exitRulesOverride || null,
      pos_meta_entry_event_id: posMeta && posMeta.entry_event_id ? posMeta.entry_event_id : null,
    },
  });
  let triggerResult = {
    ok: false,
    skipped: true,
    reason: "EXIT_WORKER_TRIGGER_DISABLED",
  };
  if (dispatchExitWorker === true) {
    triggerResult = await triggerExitWorkerRun({
      reason: String(
        dispatchReason ||
        `${sourceUpper}_NATIVE_STOP_REFRESH_${exchangeUpper}_${symbolUpper}`
      ).trim(),
      dispatchOnly: executeImmediately !== true,
      timeoutMs: executeImmediately === true ? 15000 : 5000,
      targetSymbols: [symbolUpper],
      targetExchange: exchangeUpper,
    }).catch((error) => ({
      ok: false,
      skipped: true,
      reason: "EXIT_WORKER_TRIGGER_FETCH_FAIL",
      error: error && error.message ? error.message : String(error),
    }));
  }
  return {
    ok: false,
    skipped: true,
    reason: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER",
    request_id: request && request.exit_repair_request_id ? request.exit_repair_request_id : null,
    entry_price: Number.isFinite(Number(fallbackEntryPrice)) ? Number(fallbackEntryPrice) : null,
    position_side: fallbackPosSide,
    attempts: 0,
    max_attempts: 0,
    dispatch_ok: triggerResult && triggerResult.ok === true,
    dispatch_reason: triggerResult && triggerResult.reason ? String(triggerResult.reason) : null,
    dispatch_error: triggerResult && triggerResult.error ? String(triggerResult.error) : null,
  };
}

function shouldCleanupExternalFlatOrders({
  active = false,
  prevActive = false,
  liveCfg = null,
} = {}) {
  if (active === true) return false;
  if (prevActive !== true) return false;
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return false;
  return true;
}

function isBinanceImmediateTriggerError(error) {
  const text = String(error && error.message ? error.message : error || "").toUpperCase();
  return text.includes("CODE\":-2021") || text.includes("ORDER WOULD IMMEDIATELY TRIGGER");
}

async function placeNativeTpMarketFallback({
  liveCfg,
  exchange,
  symbol,
  positionSide,
  closeSide,
  entryPrice,
  leverage,
  triggerPrice,
  quantity,
} = {}) {
  const tpIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
    exchange,
    symbol,
    positionSide,
    closeSide,
    entryPrice,
    leverage,
    triggerPrice,
    kind: "TP1_MARKET",
  });
  const marketOrder = await placeFuturesMarketOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side: closeSide,
    quantity,
    reduceOnly: true,
    idempotencyKey: tpIdempotencyKey,
  });
  return {
    order: marketOrder,
    client_order_mode: "MARKET_FALLBACK",
  };
}

async function placeNativeStopImmediateTriggerFailClosed({
  liveCfg,
  exchange,
  symbol,
  positionSide,
  closeSide,
  entryPrice,
  leverage,
  triggerPrice,
  quantity,
  placeOrder = placeFuturesMarketOrder,
} = {}) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new Error("FAIL_CLOSED_QTY_INVALID");
  }
  const idempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
    exchange,
    symbol,
    positionSide,
    closeSide,
    entryPrice,
    leverage,
    triggerPrice,
    kind: "STOP_FAIL_CLOSED_MARKET",
  });
  const marketOrder = await placeOrder({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
    symbol,
    side: closeSide,
    quantity: qty,
    reduceOnly: true,
    idempotencyKey,
  });
  return {
    order: marketOrder,
    client_order_mode: "MARKET_FAIL_CLOSED",
  };
}

// 2026-04-20 senior-audit P2: pure helper that extracts unprotected-window
// timing fields from a refresh result. Exported via __test block for direct
// unit coverage. Contract:
//   - cancel_ms / stop_ack_ms / tp_ack_ms are each null unless the refresh
//     returned a positive finite millisecond timestamp.
//   - native_protection_unprotected_window_ms is the max of (stop_ack_ms,
//     tp_ack_ms) minus cancel_ms — i.e. when BOTH legs needed to ack, we
//     wait for the later ack; when only the SL leg acked (TP disabled or
//     TP1 not eligible), the SL ack closes the window.
//   - native_protection_unprotected_window_ms is null when cancel_ms OR
//     every ack timestamp is null — the gate treats null-with-cancel as a
//     distinct "cancel-emitted but no ack recorded" breach (stronger than
//     a numeric-window breach).
//   - native_protection_cancel_succeeded is carried through so the gate
//     can tell "cancel itself failed (old orders intact, no window opened)"
//     from "cancel acked (window opened)".
function resolveNativeProtectionUnprotectedWindowFields(nativeProtection) {
  const result = nativeProtection && typeof nativeProtection === "object" ? nativeProtection : {};
  // 2026-04-20 senior-audit L1: arithmetic lives in
  // `src/utils/nativeProtectionWindowMath.js` so the read side
  // (`nativeProtectionUnprotectedWindowRuntime.classifyUnprotectedWindowRecord`)
  // computes window_ms identically. Any future refinement to the
  // cancel→ack contract — clamp policy, min-of-acks, clock-skew
  // handling — is made in one place and both sides inherit it.
  const cancelMs = nativeProtectionWindowToPositiveMs(result.cancel_ms);
  const stopAckMs = nativeProtectionWindowToPositiveMs(result.stop_ack_ms);
  const tpAckMs = nativeProtectionWindowToPositiveMs(result.tp_ack_ms);
  const windowMs = computeNativeProtectionWindowMs({ cancelMs, stopAckMs, tpAckMs });
  const cancelSucceeded = result.cancel_succeeded === true
    ? true
    : (result.cancel_succeeded === false ? false : null);
  return {
    native_protection_cancel_ms: cancelMs,
    native_protection_cancel_succeeded: cancelSucceeded,
    native_protection_stop_ack_ms: stopAckMs,
    native_protection_tp_ack_ms: tpAckMs,
    native_protection_unprotected_window_ms: windowMs,
  };
}

function buildNativeProtectionMetaPatch({
  nativeProtection,
  intent,
  execBarCloseMs,
  posMeta = null,
} = {}) {
  const intentUpper = String(intent || "").toUpperCase();
  if (!nativeProtection || (intentUpper !== "ENTRY" && intentUpper !== "ADD")) return null;
  const simplifiedExitV2Enabled = resolveSimplifiedExitV2PositionFlag({ currentMeta: posMeta });
  const refreshAtMs = Date.now();
  const resolvedReason = resolveNativeProtectionAlertReason(nativeProtection);
  const status = nativeProtection.ok === true
    ? "OK"
    : (resolvedReason === "REPAIR_REQUESTED_NON_AUTHORITY_LAYER"
      ? "REPAIR_REQUESTED_NON_AUTHORITY_LAYER"
      : (nativeProtection.skipped === true ? "SKIPPED" : "FAILED"));
  const reason = nativeProtection.ok === true
    ? null
    : resolvedReason;
  const windowFields = resolveNativeProtectionUnprotectedWindowFields(nativeProtection);
  // 2026-04-28 senior audit (Step 5 — observability gap fix). The window
  // timings are stamped onto positions_paper.meta but were *only* visible
  // via Firestore queries; Cloud Logging had no event for analytics
  // dashboards or alerting on regressions. Emit a single structured line
  // here so the Cloud Run aggregate distribution (p50/p95/p99) of the
  // cancel→ack window is observable without a Firestore round-trip.
  // Sampled-out only when *all* timing fields are null (refresh path
  // never reached the cancel call).
  try {
    if (
      windowFields.native_protection_cancel_ms !== null
      || windowFields.native_protection_stop_ack_ms !== null
      || windowFields.native_protection_tp_ack_ms !== null
    ) {
      console.log(JSON.stringify({
        event: "native_protection_unprotected_window_observed",
        ts: new Date().toISOString(),
        intent: intentUpper,
        status,
        cancel_succeeded: windowFields.native_protection_cancel_succeeded,
        cancel_ms: windowFields.native_protection_cancel_ms,
        stop_ack_ms: windowFields.native_protection_stop_ack_ms,
        tp_ack_ms: windowFields.native_protection_tp_ack_ms,
        unprotected_window_ms: windowFields.native_protection_unprotected_window_ms,
        attempts: Number.isFinite(Number(nativeProtection.attempts)) ? Number(nativeProtection.attempts) : null,
        position_side: nativeProtection.position_side || null,
      }));
    }
  } catch (_) { /* observability only — never block meta patch on log fail */ }
  const basePatch = {
    native_protection_refresh_status: status,
    native_protection_refresh_reason: reason,
    native_protection_refresh_context: intentUpper,
    native_protection_refresh_at_ms: refreshAtMs,
    native_protection_refresh_bar_ms: Number.isFinite(Number(execBarCloseMs)) ? Number(execBarCloseMs) : null,
    native_protection_stale: nativeProtection.ok === true ? false : true,
    native_protection_attempts: Number.isFinite(Number(nativeProtection.attempts)) ? Number(nativeProtection.attempts) : null,
    native_protection_max_attempts: Number.isFinite(Number(nativeProtection.max_attempts)) ? Number(nativeProtection.max_attempts) : null,
    ...windowFields,
  };
  if (nativeProtection.ok === true) {
    return {
      ...basePatch,
      native_protection_stop_order_id: nativeProtection.stop_order_id || null,
      native_protection_tp0_order_id: simplifiedExitV2Enabled ? null : (nativeProtection.tp0_order_id || null),
      native_protection_tp_order_id: nativeProtection.tp_order_id || null,
      native_protection_stop_price: Number.isFinite(Number(nativeProtection.stop_price)) ? Number(nativeProtection.stop_price) : null,
      native_protection_tp0_price: simplifiedExitV2Enabled
        ? null
        : (Number.isFinite(Number(nativeProtection.tp0_price)) ? Number(nativeProtection.tp0_price) : null),
      native_protection_tp_price: Number.isFinite(Number(nativeProtection.tp_price)) ? Number(nativeProtection.tp_price) : null,
      native_protection_tp0_qty_base: simplifiedExitV2Enabled
        ? null
        : (Number.isFinite(Number(nativeProtection.tp0_qty_base)) ? Number(nativeProtection.tp0_qty_base) : null),
      native_protection_tp_qty_base: Number.isFinite(Number(nativeProtection.tp_qty_base)) ? Number(nativeProtection.tp_qty_base) : null,
      native_protection_tp0_qty_ratio: simplifiedExitV2Enabled
        ? null
        : (Number.isFinite(Number(nativeProtection.tp0_qty_ratio)) ? Number(nativeProtection.tp0_qty_ratio) : null),
      native_protection_tp_qty_ratio: Number.isFinite(Number(nativeProtection.tp_qty_ratio)) ? Number(nativeProtection.tp_qty_ratio) : null,
      native_protection_tp0_status: simplifiedExitV2Enabled ? null : (nativeProtection.tp0_status || null),
      native_protection_tp_status: nativeProtection.tp_status || null,
      native_protection_tp0_reason: simplifiedExitV2Enabled ? null : (nativeProtection.tp0_reason || null),
      native_protection_tp_reason: nativeProtection.tp_reason || null,
      native_protection_entry_price: Number.isFinite(Number(nativeProtection.entry_price)) ? Number(nativeProtection.entry_price) : null,
      native_protection_side: nativeProtection.position_side || null,
    };
  }
  return {
    ...basePatch,
    native_protection_stop_order_id: nativeProtection && nativeProtection.partial_protection === true && nativeProtection.stop_order_id
      ? String(nativeProtection.stop_order_id)
      : null,
    native_protection_tp0_order_id: simplifiedExitV2Enabled
      ? null
      : (nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp0_order_id ? String(nativeProtection.tp0_order_id) : null),
    native_protection_tp_order_id: nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp_order_id
      ? String(nativeProtection.tp_order_id)
      : null,
    native_protection_stop_price: nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.stop_price))
      ? Number(nativeProtection.stop_price)
      : null,
    native_protection_tp0_price: simplifiedExitV2Enabled
      ? null
      : (nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp0_price)) ? Number(nativeProtection.tp0_price) : null),
    native_protection_tp_price: nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp_price))
      ? Number(nativeProtection.tp_price)
      : null,
    native_protection_tp0_qty_base: simplifiedExitV2Enabled
      ? null
      : (nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp0_qty_base)) ? Number(nativeProtection.tp0_qty_base) : null),
    native_protection_tp_qty_base: nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp_qty_base))
      ? Number(nativeProtection.tp_qty_base)
      : null,
    native_protection_tp0_qty_ratio: simplifiedExitV2Enabled
      ? null
      : (nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp0_qty_ratio)) ? Number(nativeProtection.tp0_qty_ratio) : null),
    native_protection_tp_qty_ratio: nativeProtection && nativeProtection.partial_protection === true && Number.isFinite(Number(nativeProtection.tp_qty_ratio))
      ? Number(nativeProtection.tp_qty_ratio)
      : null,
    native_protection_tp0_status: simplifiedExitV2Enabled ? null : (nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp0_status ? String(nativeProtection.tp0_status) : null),
    native_protection_tp_status: nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp_status ? String(nativeProtection.tp_status) : null,
    native_protection_tp0_reason: simplifiedExitV2Enabled ? null : (nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp0_reason ? String(nativeProtection.tp0_reason) : null),
    native_protection_tp_reason: nativeProtection && nativeProtection.partial_protection === true && nativeProtection.tp_reason ? String(nativeProtection.tp_reason) : null,
    native_protection_entry_price: Number.isFinite(Number(nativeProtection.entry_price)) ? Number(nativeProtection.entry_price) : null,
    native_protection_side: nativeProtection.position_side ? String(nativeProtection.position_side) : null,
  };
}

function shouldFailClosedForIncompleteTp1Protection({
  tpEnabled = false,
  stageState = null,
  tpStatus = null,
  tpOrder = null,
} = {}) {
  if (tpEnabled !== true) return false;
  if (!stageState || stageState.tp1Eligible !== true) return false;
  const status = String(tpStatus || "").trim().toUpperCase();
  const orderId = tpOrder && tpOrder.orderId ? String(tpOrder.orderId).trim() : "";
  return status !== "OK" || !orderId;
}

async function refreshBinanceNativeProtection({
  liveCfg,
  exchange,
  symbol,
  fallbackSide,
  fallbackEntryPrice,
  fallbackLeverage,
  exitRulesOverride,
  posMeta,
  signal = null,
} = {}) {
  // 2026-04-18 P1-2 (audit re-verified): native protection refresh is
  // cancel-first — we cancel existing open orders BEFORE placing the new
  // stop. Between `cancelFuturesOpenOrders` and a successful
  // `placeFuturesStopMarketOrder`, the position is literally unprotected
  // on the exchange. The outer catch previously collapsed that window
  // into `{ ok: false, reason: "NATIVE_PLACE_FAIL" }`, which looked
  // identical to "cancel failed, protection still intact" from the
  // caller's perspective. This flag lets the outer catch emit an
  // explicit UNPROTECTED_ACTIVE_POSITION diagnostic + return payload so
  // operators and downstream alerting can distinguish the naked window
  // (needs immediate repair or flatten) from a no-op failure (original
  // orders still on exchange).
  //
  // 2026-04-20 senior-audit P2: timing is captured at each step so the
  // duration of the naked window is measurable. These get bubbled up into
  // `positions_paper.meta.native_protection_{cancel,stop_ack,tp_ack}_ms`
  // via buildNativeProtectionMetaPatch, and the exit-integrity deploy gate
  // fails the build when any active position's cancel→ack delta breaches
  // a threshold. The previous behaviour was blind: the unprotected window
  // was architecturally unavoidable (Binance has no atomic "replace order"
  // primitive for closePosition STOP_MARKET), but with no timestamps ops
  // had no way to detect regressions that blew the window out from a few
  // hundred ms (typical healthy refresh) to tens of seconds (the kind of
  // window that makes the "unprotected" in UNPROTECTED_ACTIVE_POSITION an
  // actual liquidation risk).
  let cancelSucceeded = false;
  let cancelMs = null;
  let stopAckMs = null;
  let tpAckMs = null;
  const ex = String(exchange || "").toUpperCase();
  if (signal && signal.aborted) return { ok: false, skipped: true, reason: "NATIVE_REFRESH_ABORTED" };
  if (!ex.includes("BINANCE")) return { ok: false, skipped: true, reason: "NOT_BINANCE" };
  if (!BINANCE_NATIVE_PROTECTION_ENABLED) return { ok: false, skipped: true, reason: "NATIVE_PROTECTION_DISABLED" };
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return { ok: false, skipped: true, reason: "BINANCEFUT_KEYS_MISSING" };

  let context = null;
  try {
    context = await resolveBinancePositionContext({ liveCfg, symbol });
  } catch (e) {
    return { ok: false, skipped: true, reason: "POSITION_CONTEXT_FETCH_FAIL", error: e && e.message ? e.message : String(e) };
  }

  if (!context || !context.active) {
    try {
      await cancelFuturesOpenOrders({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
        signal,
      });
      return { ok: true, state: "FLAT", canceled: true };
    } catch (e) {
      return { ok: false, state: "FLAT", canceled: false, reason: "CANCEL_OPEN_ORDERS_FAIL", error: e && e.message ? e.message : String(e) };
    }
  }

  const fallbackPosSide = String(fallbackSide || "").toUpperCase() === "SELL" ? "SHORT" : "LONG";
  const entryPrice = Number.isFinite(Number(context.entryPrice)) && Number(context.entryPrice) > 0
    ? Number(context.entryPrice)
    : Number(fallbackEntryPrice);
  const leverage = Number.isFinite(Number(context.leverage)) && Number(context.leverage) > 0
    ? Number(context.leverage)
    : Number(fallbackLeverage);
  const positionSide = String(context.positionSide || fallbackPosSide).toUpperCase();
  const rules = resolveExitRulesForPosition({
    exchange,
    position: { meta: { exit_rules_override: exitRulesOverride || null } },
  });
  const prices = computeBinanceNativeProtectionPrices({
    positionSide,
    entryPrice,
    leverage,
    rules,
    posMeta,
  });
  const stageState = resolveNativeProtectionStageState(posMeta);
  // 2026-04-18 diagnostic: when the BE-raise block in binanceTickExit.js
  // dispatches a refresh but the native stop does not move toward RUNNER_FLOOR,
  // we need to see what inputs reached computeBinanceNativeProtectionPrices
  // and what it produced. The previous log layout showed only refresh_ok/
  // refresh_reason at the call site, which was blind to the actual computed
  // trigger. Emit a structured line here so Cloud Logging can reconcile
  // (tp_p1_done=true, RUNNER_MIN_PROFIT_PCT set) vs (stopTriggerPx still at
  // the pre-TP1 SL level).
  try {
    const posMetaObj = (posMeta && typeof posMeta === "object") ? posMeta : {};
    console.log(JSON.stringify({
      event: "native_protection_refresh_price_decision",
      ts: new Date().toISOString(),
      exchange: String(exchange || "").toUpperCase(),
      symbol: String(symbol || "").toUpperCase(),
      position_side: positionSide,
      entry_price: Number.isFinite(entryPrice) ? entryPrice : null,
      leverage: Number.isFinite(leverage) ? leverage : null,
      pos_meta_tp_p1_done: posMetaObj.tp_p1_done === true,
      pos_meta_trail_active: posMetaObj.trail_active === true,
      pos_meta_current_stop: Number.isFinite(Number(posMetaObj.native_protection_stop_price))
        ? Number(posMetaObj.native_protection_stop_price)
        : null,
      rules_runner_min_profit_pct: Number.isFinite(Number(rules && rules.RUNNER_MIN_PROFIT_PCT))
        ? Number(rules.RUNNER_MIN_PROFIT_PCT)
        : null,
      rules_sl: Number.isFinite(Number(rules && rules.SL)) ? Number(rules.SL) : null,
      rules_tp_p1: Number.isFinite(Number(rules && rules.TP_P1)) ? Number(rules.TP_P1) : null,
      computed_stop_trigger_px: prices && Number.isFinite(Number(prices.stopTriggerPx))
        ? Number(prices.stopTriggerPx)
        : null,
      computed_tp_trigger_px: prices && Number.isFinite(Number(prices.tpTriggerPx))
        ? Number(prices.tpTriggerPx)
        : null,
      prices_null: prices == null,
      stage_tp1_eligible: stageState && stageState.tp1Eligible === true,
      runner_exit_debug: prices && prices.runnerExitDebug ? prices.runnerExitDebug : null,
    }));
  } catch (_) { /* non-critical diagnostic */ }
  if (!prices) {
    return { ok: false, skipped: true, reason: "NATIVE_PRICE_COMPUTE_FAIL", positionSide, entryPrice, leverage };
  }

  try {
    // 2026-04-20 senior-audit P2: stamp cancel initiation timestamp BEFORE
    // awaiting cancelFuturesOpenOrders. Using Date.now() (not the cancel
    // response echo) because the window's start is when the existing orders
    // logically stop protecting — that's when we sent the DELETE, not when
    // the exchange acknowledged it. Under a retry/timeout scenario the
    // exchange may or may not have processed the cancel, but either way we
    // treat the period from this instant forward as potentially unprotected.
    cancelMs = Date.now();
    await cancelFuturesOpenOrders({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol,
      signal,
    });
    cancelSucceeded = true;
  } catch (e) {
    return {
      ok: false,
      reason: "NATIVE_CANCEL_FAIL",
      error: e && e.message ? e.message : String(e),
      // Even though cancel failed, stamp the attempt time so downstream
      // observability still has a lower-bound window start. `cancel_succeeded`
      // remains false → gate will NOT count this as a protected refresh.
      cancel_ms: cancelMs,
      cancel_succeeded: false,
      stop_ack_ms: null,
      tp_ack_ms: null,
    };
  }

  try {
    const stopIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
      exchange,
      symbol,
      positionSide,
      closeSide: prices.closeSide,
      entryPrice,
      leverage,
      triggerPrice: prices.stopTriggerPx,
      kind: "STOP",
    });
    let stopOrder = null;
    try {
      stopOrder = await placeFuturesStopMarketOrder({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
        side: prices.closeSide,
        stopPrice: prices.stopTriggerPx,
        closePosition: true,
        workingType: BINANCE_NATIVE_WORKING_TYPE,
        priceProtect: BINANCE_NATIVE_PRICE_PROTECT,
        idempotencyKey: stopIdempotencyKey,
        signal,
      });
      // Stop order acknowledged — the SL half of native protection is now
      // live again. This closes the SL-only unprotected window. TP gap (if
      // any) is tracked separately via tpAckMs below.
      stopAckMs = Date.now();
    } catch (stopErr) {
      if (isBinanceImmediateTriggerError(stopErr) && Number.isFinite(Number(context.qtyBase)) && Number(context.qtyBase) > 0) {
        const failClosed = await placeNativeStopImmediateTriggerFailClosed({
          liveCfg,
          exchange,
          symbol,
          positionSide,
          closeSide: prices.closeSide,
          entryPrice,
          leverage,
          triggerPrice: prices.stopTriggerPx,
          quantity: Number(context.qtyBase),
        });
        // 2026-04-20 senior-audit P2: fail-closed path places a reduceOnly
        // MARKET order to flatten immediately — position is no longer
        // exposed once that order acks, so stamp stopAckMs here too. The
        // downstream gate uses the SL-ack timestamp as the window end when
        // no TP leg was placed (which is the case on the fail-closed path).
        stopAckMs = Date.now();
        return {
          ok: true,
          state: "EXITED_FAIL_CLOSED",
          fail_closed: true,
          fail_closed_reason: "STOP_ALREADY_BREACHED",
          fail_closed_trigger_price: prices.stopTriggerPx,
          fail_closed_order_id: failClosed && failClosed.order && failClosed.order.orderId ? String(failClosed.order.orderId) : null,
          fail_closed_client_order_mode: failClosed && failClosed.client_order_mode ? String(failClosed.client_order_mode) : null,
          position_side: positionSide,
          entry_price: entryPrice,
          leverage,
          close_side: prices.closeSide,
          stop_price: prices.stopTriggerPx,
          tp0_price: null,
          tp_price: prices.tpTriggerPx,
          stop_order_id: null,
          tp0_order_id: null,
          tp_order_id: null,
          tp0_status: null,
          tp_status: null,
          tp0_reason: null,
          tp_reason: null,
          cancel_ms: cancelMs,
          cancel_succeeded: cancelSucceeded,
          stop_ack_ms: stopAckMs,
          tp_ack_ms: null,
        };
      }
      throw stopErr;
    }
    let tpOrder = null;
    let tpQtyBase = null;
    let tpQtyRatio = null;
    let desiredTpQtyPlaced = null;
    const tp0Status = null;
    const tp0Reason = null;
    let tpStatus = BINANCE_NATIVE_TP_ENABLED ? "SKIPPED" : "DISABLED";
    let tpReason = BINANCE_NATIVE_TP_ENABLED ? "TP_TRIGGER_INVALID" : "NATIVE_TP_DISABLED";
    if (BINANCE_NATIVE_TP_ENABLED && stageState.tp1Eligible && Number.isFinite(prices.tpTriggerPx) && prices.tpTriggerPx > 0) {
      try {
        const exchangeInfo = await fetchFuturesExchangeInfoWithCache(symbol);
        const desiredTpQtyBase = Number(context.qtyBase) * Number(prices.tpOrderQtyRatio || prices.tpQtyRatio || 0.5);
        const tpQtyInfo = await computeFuturesOrderQty({
          symbol,
          priceRef: prices.tpTriggerPx,
          notionalQuote: desiredTpQtyBase * prices.tpTriggerPx,
          reduceOnly: true,
          info: exchangeInfo,
          qtyBase: desiredTpQtyBase,
        });
        if (!tpQtyInfo.ok || !Number.isFinite(tpQtyInfo.qty) || tpQtyInfo.qty <= 0) {
          tpStatus = "SKIPPED";
          tpReason = tpQtyInfo.reason || "TP_QTY_INVALID";
        } else if (tpQtyInfo.qty + POS_SIZE_EPSILON >= Number(context.qtyBase)) {
          tpStatus = "SKIPPED";
          tpReason = "TP_QTY_FULL_POSITION";
        } else {
          desiredTpQtyPlaced = tpQtyInfo.qty;
          const tpIdempotencyKey = buildBinanceNativeProtectionIdempotencyKey({
            exchange,
            symbol,
            positionSide,
            closeSide: prices.closeSide,
            entryPrice,
            leverage,
            triggerPrice: prices.tpTriggerPx,
            kind: "TP1",
          });
          tpOrder = await placeFuturesTakeProfitMarketOrder({
            apiKey: liveCfg.apiKey,
            apiSecret: liveCfg.apiSecret,
            symbol,
            side: prices.closeSide,
            stopPrice: prices.tpTriggerPx,
            closePosition: false,
            quantity: tpQtyInfo.qty,
            reduceOnly: true,
            workingType: BINANCE_NATIVE_WORKING_TYPE,
            priceProtect: BINANCE_NATIVE_PRICE_PROTECT,
            idempotencyKey: tpIdempotencyKey,
            signal,
          });
          // 2026-04-20 senior-audit P2: TP1 native order acked. When both
          // legs are required (stageState.tp1Eligible === true), the
          // unprotected window does not fully close until BOTH SL and TP
          // are live — we record tpAckMs here so the gate can compute
          // `max(stop_ack_ms, tp_ack_ms) - cancel_ms`.
          tpAckMs = Date.now();
          tpQtyBase = tpQtyInfo.qty;
          tpQtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, tpQtyInfo.qty / Number(context.qtyBase)) : null;
          tpStatus = "OK";
          tpReason = null;
        }
      } catch (tpErr) {
        if (isBinanceImmediateTriggerError(tpErr) && Number.isFinite(desiredTpQtyPlaced) && desiredTpQtyPlaced > 0) {
          try {
            const fallback = await placeNativeTpMarketFallback({
              liveCfg,
              exchange,
              symbol,
              positionSide,
              closeSide: prices.closeSide,
              entryPrice,
              leverage,
              triggerPrice: prices.tpTriggerPx,
              quantity: desiredTpQtyPlaced,
            });
            tpOrder = fallback.order;
            // Market-fallback path: the reduceOnly MARKET order acked, so
            // the TP leg is settled (qty is realized instead of parked as
            // a resting TAKE_PROFIT_MARKET). Treat this as TP ack for the
            // purpose of closing the unprotected window — the TP1 qty is
            // no longer dependent on a future trigger.
            tpAckMs = Date.now();
            tpQtyBase = desiredTpQtyPlaced;
            tpQtyRatio = Number(context.qtyBase) > 0 ? Math.min(1, desiredTpQtyPlaced / Number(context.qtyBase)) : null;
            tpStatus = "OK";
            tpReason = "MARKET_FALLBACK";
          } catch (fallbackErr) {
            tpStatus = "FAILED";
            tpReason = fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr);
          }
        } else {
          tpStatus = "FAILED";
          tpReason = tpErr && tpErr.message ? tpErr.message : String(tpErr);
        }
      }
    }
    const stopContractKind = (posMeta && (posMeta.tp_p1_done === true || posMeta.trail_active === true || posMeta.tp_p1_pending === true))
      ? "TRAIL"
      : "SL";
    const stopContractPayload = buildExitOrderContractRecordPayload({
      kind: stopContractKind,
      rules,
      posMeta,
      exchange,
      symbol,
      orderId: stopOrder && stopOrder.orderId,
      clientOrderId: stopOrder && stopOrder.clientOrderId,
      positionSide,
      closeSide: prices.closeSide,
      expectedQtyBase: Number(context.qtyBase),
      expectedQtyRatio: 1,
      triggerPrice: prices.stopTriggerPx,
      triggerSource: stopContractKind === "TRAIL" ? "RUNNER_EXIT_STOP" : "SL_STOP",
      reduceOnly: true,
      closePosition: true,
      status: "OPEN",
      source: "BINANCE_NATIVE_PROTECTION",
    });
    if (stopContractPayload) {
      await recordExitOrderContractSafe(stopContractPayload);
    }
    if (tpOrder && tpStatus === "OK") {
      const tp1ContractPayload = buildExitOrderContractRecordPayload({
        kind: "TP1",
        rules,
        posMeta,
        exchange,
        symbol,
        orderId: tpOrder.orderId,
        clientOrderId: tpOrder.clientOrderId,
        positionSide,
        closeSide: prices.closeSide,
        expectedQtyBase: tpQtyBase,
        expectedQtyRatio: tpQtyRatio,
        triggerPrice: prices.tpTriggerPx,
        triggerSource: "TP1_NATIVE",
        reduceOnly: true,
        closePosition: false,
        status: "OPEN",
        source: "BINANCE_NATIVE_PROTECTION",
      });
      if (tp1ContractPayload) {
        await recordExitOrderContractSafe(tp1ContractPayload);
      }
    }
    if (shouldFailClosedForIncompleteTp1Protection({
      tpEnabled: BINANCE_NATIVE_TP_ENABLED,
      stageState,
      tpStatus,
      tpOrder,
    })) {
      return {
        ok: false,
        reason: "TP1_NATIVE_PROTECTION_INCOMPLETE",
        partial_protection: true,
        position_side: positionSide,
        entry_price: entryPrice,
        leverage,
        close_side: prices.closeSide,
        stop_price: prices.stopTriggerPx,
        tp0_price: null,
        tp_price: prices.tpTriggerPx,
        tp0_qty_base: null,
        tp_qty_base: Number.isFinite(tpQtyBase) ? tpQtyBase : null,
        tp0_qty_ratio: null,
        tp_qty_ratio: Number.isFinite(tpQtyRatio) ? tpQtyRatio : null,
        tp0_status: tp0Status,
        tp_status: tpStatus,
        tp0_reason: tp0Reason,
        tp_reason: tpReason || "TP1_ORDER_MISSING",
        stop_order_id: stopOrder && stopOrder.orderId ? String(stopOrder.orderId) : null,
        tp0_order_id: null,
        tp_order_id: tpOrder && tpOrder.orderId ? String(tpOrder.orderId) : null,
        // 2026-04-20 senior-audit P2: even on the partial-protection fail
        // path, the SL leg was acked — stamp timings so the gate sees this
        // as a half-closed window (stop acked, TP missing). Meta persistence
        // preserves the SL-only ack time to keep the breach-detection math
        // honest. `tp_ack_ms` stays null because the TP leg never acked.
        cancel_ms: cancelMs,
        cancel_succeeded: cancelSucceeded,
        stop_ack_ms: stopAckMs,
        tp_ack_ms: null,
      };
    }
    return {
      ok: true,
      state: "ACTIVE",
      position_side: positionSide,
      entry_price: entryPrice,
      leverage,
      close_side: prices.closeSide,
      stop_price: prices.stopTriggerPx,
      tp0_price: null,
      tp_price: prices.tpTriggerPx,
      tp0_qty_base: null,
      tp_qty_base: Number.isFinite(tpQtyBase) ? tpQtyBase : null,
      tp0_qty_ratio: null,
      tp_qty_ratio: Number.isFinite(tpQtyRatio) ? tpQtyRatio : null,
      tp0_status: tp0Status,
      tp_status: tpStatus,
      tp0_reason: tp0Reason,
      tp_reason: tpReason,
      stop_order_id: stopOrder && stopOrder.orderId ? String(stopOrder.orderId) : null,
      tp0_order_id: null,
      tp_order_id: tpOrder && tpOrder.orderId ? String(tpOrder.orderId) : null,
      // 2026-04-20 senior-audit P2: healthy-path timings. Exit-integrity
      // gate subtracts max(stop_ack_ms, tp_ack_ms) − cancel_ms per position
      // and fails the deploy if the worst window exceeds threshold.
      cancel_ms: cancelMs,
      cancel_succeeded: cancelSucceeded,
      stop_ack_ms: stopAckMs,
      tp_ack_ms: tpAckMs,
    };
  } catch (e) {
    const errorMessage = e && e.message ? e.message : String(e);
    // 2026-04-18 P1-2 (audit re-verified): if we reach this catch AFTER
    // the cancel phase succeeded, the position on Binance is actually
    // unprotected right now — the existing stop/TP orders were cancelled
    // and the replacement orders never landed. Promote that specific
    // state to an explicit UNPROTECTED_ACTIVE_POSITION return so callers
    // and downstream alerting can trigger the protection-gap path
    // (immediate repair dispatch, force-flatten decision, operator page)
    // instead of treating it as an equivalent of "cancel failed, old
    // orders still intact". The structured log gives Cloud Logging /
    // alert rules a canonical event name to match on.
    if (cancelSucceeded) {
      try {
        console.warn(JSON.stringify({
          event: "native_protection_unprotected_position_detected",
          ts: new Date().toISOString(),
          exchange: String(exchange || "").toUpperCase(),
          symbol: String(symbol || "").toUpperCase(),
          reason: "NATIVE_PLACE_FAIL_AFTER_CANCEL",
          error: errorMessage.slice(0, 200),
        }));
      } catch (_) { /* never let diagnostic kill the refresh */ }
      return {
        ok: false,
        reason: "UNPROTECTED_ACTIVE_POSITION",
        inner_reason: "NATIVE_PLACE_FAIL",
        cancel_succeeded: true,
        stop_place_failed: true,
        unprotected_active_position: true,
        repair_required: true,
        error: errorMessage,
        // 2026-04-20 senior-audit P2: this is the "position genuinely naked
        // right now" path. cancel_ms is set (we got past the cancel); ack
        // timestamps are whatever partial progress we made — stopAckMs can
        // be non-null if SL acked but TP threw, or null if SL itself threw
        // after cancel. The gate treats an active position with cancel_ms
        // set but NO successful ack ms as an unbounded-window breach (no
        // matter how short the elapsed time, the window never closed from
        // the exchange's POV until either a repair or a flatten completes).
        cancel_ms: cancelMs,
        stop_ack_ms: stopAckMs,
        tp_ack_ms: tpAckMs,
      };
    }
    return {
      ok: false,
      reason: "NATIVE_PLACE_FAIL",
      error: errorMessage,
      // cancel_ms null ⇒ cancel itself failed BEFORE we stamped (unlikely —
      // cancelMs is stamped pre-await). cancelSucceeded false ⇒ old orders
      // still on exchange, no unprotected window opened.
      cancel_ms: cancelMs,
      cancel_succeeded: cancelSucceeded,
      stop_ack_ms: stopAckMs,
      tp_ack_ms: tpAckMs,
    };
  }
}

function sanitizeBinanceKeyPart(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/[^A-Za-z0-9_.:-]/g, "")
    .slice(0, 60);
}

async function notifyNativeProtectionResult({
  nativeProtection,
  symbol,
  exchange,
  liveMode = "LIVE",
  alertFn,
  } = {}) {
  if (!nativeProtection) return { ok: true, skipped: true };
  const npReason = resolveNativeProtectionAlertReason(nativeProtection);
  if (nativeProtection.skipped === true && npReason === "REPAIR_REQUESTED_NON_AUTHORITY_LAYER") {
    return { ok: true, skipped: true, reason: npReason };
  }
  if (nativeProtection.ok === true) {
    if (String(nativeProtection.tp_status || "").toUpperCase() === "FAILED") {
      const reason = String(nativeProtection.tp_reason || "").trim() || "TP_PARTIAL_PLACE_FAIL";
      console.warn(
        `[BINANCE_NATIVE_PROTECT_WARN] ${String(symbol || "").toUpperCase()} TP_PARTIAL_PLACE_FAIL ` +
        `${reason}`.trim()
      );
      try {
        const notify = typeof alertFn === "function" ? alertFn : sendNativeProtectionWarningAlert;
        await notify({
          symbol,
          reason: "TP_PARTIAL_PLACE_FAIL",
          error: reason,
          attempts: nativeProtection.attempts,
          exchange,
          liveMode,
        });
      } catch (alertErr) {
        console.warn("[BINANCE_NATIVE_PROTECT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
      }
      return { ok: false, reason: "TP_PARTIAL_PLACE_FAIL" };
    }
    return { ok: true, skipped: true };
  }
  console.warn(
    `[BINANCE_NATIVE_PROTECT_WARN] ${String(symbol || "").toUpperCase()} ${npReason} ` +
    `${nativeProtection.error || ""}`.trim()
  );
  try {
    const notify = typeof alertFn === "function" ? alertFn : sendNativeProtectionWarningAlert;
    await notify({
      symbol,
      reason: npReason,
      error: nativeProtection.error || null,
      attempts: nativeProtection.attempts,
      exchange,
      liveMode,
    });
  } catch (alertErr) {
    console.warn("[BINANCE_NATIVE_PROTECT_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
  }
  return { ok: false, reason: npReason };
}

function buildBinanceOrderIdempotencyKey({
  intentId,
  exchange,
  symbol,
  side,
  intent,
  event,
  barCloseMs,
  qty,
  reduceOnly,
  tag = "main",
} = {}) {
  const keyBase = [
    sanitizeBinanceKeyPart(intentId || ""),
    sanitizeBinanceKeyPart(exchange || ""),
    sanitizeBinanceKeyPart(symbol || ""),
    sanitizeBinanceKeyPart(side || ""),
    sanitizeBinanceKeyPart(intent || ""),
    sanitizeBinanceKeyPart(event || ""),
    String(Number.isFinite(Number(barCloseMs)) ? Number(barCloseMs) : ""),
    String(Number.isFinite(Number(qty)) ? Number(qty).toFixed(8) : ""),
    reduceOnly ? "1" : "0",
    sanitizeBinanceKeyPart(tag || "main"),
  ].join("|");
  const digest = crypto.createHash("sha256").update(keyBase).digest("hex").slice(0, 24);
  return `fut_${digest}`;
}

function buildBinanceNativeProtectionIdempotencyKey({
  exchange,
  symbol,
  positionSide,
  closeSide,
  entryPrice,
  leverage,
  triggerPrice,
  kind,
} = {}) {
  const keyBase = [
    sanitizeBinanceKeyPart(exchange || "BINANCEFUT"),
    sanitizeBinanceKeyPart(symbol || ""),
    sanitizeBinanceKeyPart(positionSide || ""),
    sanitizeBinanceKeyPart(closeSide || ""),
    sanitizeBinanceKeyPart(kind || "NATIVE"),
    String(Number.isFinite(Number(entryPrice)) ? Number(entryPrice).toFixed(8) : ""),
    String(Number.isFinite(Number(leverage)) ? Number(leverage).toFixed(4) : ""),
    String(Number.isFinite(Number(triggerPrice)) ? Number(triggerPrice).toFixed(8) : ""),
  ].join("|");
  const digest = crypto.createHash("sha256").update(keyBase).digest("hex").slice(0, 24);
  return `native_${digest}`;
}

async function executeLiveFuturesOrder({
  liveCfg,
  exchange,
  symbol,
  tf,
  side,
  qtyFraction,
  maxFractionAllowed,
  riskBudget,
  budgetMaxOverride,
  leverageResolvedOverride,
  manualRetry,
  manualQtyBaseOverride,
  posQtyBase,
  intentId,
  intent,
  event,
  signalId = null,
  signalDocId = null,
  entryEventId = null,
  features,
  positionMeta,
  marketRegimeCohort,
  sysCfg,
  bar,
  barCloseMs,
  slippageBps,
} = {}) {
  if (!liveCfg || (!liveCfg.liveEnabled && !liveCfg.liveDryRun)) {
    return { ok: false, mode: "PAPER" };
  }
  if (!liveCfg.apiKey || !liveCfg.apiSecret) {
    if (!liveCfg.liveDryRun) {
      return { ok: false, mode: "LIVE", reason: "BINANCEFUT_KEYS_MISSING" };
    }
  }

  if (!liveCfg.liveDryRun) {
    const mode = await getBinanceFuturesPositionMode({ apiKey: liveCfg.apiKey, apiSecret: liveCfg.apiSecret });
    if (mode && mode.dualSidePosition === true) {
      return { ok: false, mode: "LIVE", reason: "HEDGE_MODE_ON" };
    }
  }

  const priceRef = Number(bar && (bar.open ?? bar.close ?? bar.c));
  if (!Number.isFinite(priceRef) || priceRef <= 0) {
    return { ok: false, mode: "LIVE", reason: "BAD_PRICE" };
  }

  const normalizedIntent = String(intent || "").toUpperCase();
  const isExit = normalizedIntent === "EXIT";
  const isTpP1Exit = isExit && isTpP1EventLocal(event);
  if (isV2DiscoveryCanaryLegacyExchangeWriteBlocked({ liveCfg, intent })) {
    const reason = liveCfg.legacy_runtime_disabled === true
      ? "V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED"
      : (isExit
        ? "V2_DISCOVERY_CANARY_LEGACY_EXIT_WRITE_DENIED"
        : "V2_DISCOVERY_CANARY_LEGACY_ENTRY_WRITE_DENIED");
    return {
      ok: false,
      mode: "LIVE",
      reason,
      note: isExit
        ? "V2 live-write exits must be handled by the V2 exit worker/canonical reducer path, not the legacy futures order path."
        : "Discovery canary entries must be executed only by productionEntryLiveEndpoint/productionEntryRoute.",
      intent_observed: normalizedIntent || null,
    };
  }
  const manualRetryEntry = !isExit && (manualRetry === true || isManualRetryFeatures(features));
  const orderIntentId = String(intentId || "").trim() || null;
  const manualQtyBase = manualRetryEntry
    ? resolveManualRetryQtyBase({ ...(features || {}), _manual_retry_qty_base: manualQtyBaseOverride })
    : null;
  const budgetBaseRaw = Number.isFinite(Number(budgetMaxOverride)) && Number(budgetMaxOverride) > 0
    ? Number(budgetMaxOverride)
    : Number(riskBudget && riskBudget.maxKrw);
  if (!isExit && !manualRetryEntry && (!riskBudget || !riskBudget.enabled || !Number.isFinite(budgetBaseRaw) || budgetBaseRaw <= 0)) {
    return { ok: false, mode: "LIVE", reason: "RISK_BUDGET_DISABLED" };
  }
  if (isExit && (!Number.isFinite(posQtyBase) || posQtyBase <= 0)) {
    return { ok: false, mode: "LIVE", reason: "NO_POSITION" };
  }
  if (!isExit && !liveCfg.liveDryRun) {
    triggerExitWorkerRun({
      reason: `ENTRY_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
      targetSymbols: [String(symbol || "").toUpperCase()],
      targetExchange: String(exchange || "").toUpperCase(),
    }).catch((e) => {
      const errText = e && e.message ? e.message : String(e);
      console.warn("[EXIT_WORKER_SCALE_ON_FAIL]", errText);
      sendNativeProtectionWarningAlert({
        symbol,
        reason: "EXIT_WORKER_SCALE_ON_FAIL",
        error: errText,
        attempts: 1,
        exchange,
        liveMode: "LIVE",
      }).catch((alertErr) => {
        console.warn("[EXIT_WORKER_SCALE_ALERT_FAIL]", alertErr && alertErr.message ? alertErr.message : String(alertErr));
      });
    });
  }
  const leverageResolved = (
    leverageResolvedOverride &&
    Number.isFinite(Number(leverageResolvedOverride.leverage)) &&
    Number(leverageResolvedOverride.leverage) > 0
  )
    ? leverageResolvedOverride
    : await resolveAdaptiveFuturesLeverage({
      liveCfg,
      exchange,
      symbol,
      tf,
      intent,
      event,
      side,
      features,
      nowMs: Number(barCloseMs),
    });
  const leverageMult = Number.isFinite(Number(leverageResolved && leverageResolved.leverage))
    ? Number(leverageResolved.leverage)
    : FUTURES_BASE_LEVERAGE;
  const intentUpper = String(intent || "").toUpperCase();
  const nativeProtectionLifecycle = resolveLiveNativeProtectionLifecycleFlags(intentUpper);
  const metaForProfile = (positionMeta && typeof positionMeta === "object") ? positionMeta : {};
  let exitProfileResolved = null;
  if (intentUpper === "ENTRY" || intentUpper === "ADD") {
    exitProfileResolved = await resolveAdaptiveFuturesExitProfile({
      exchange,
      symbol,
      tf,
      intent,
      event,
      side,
      features,
      nowMs: Number(barCloseMs),
      leverageDecision: leverageResolved,
      manualProfileMode: liveCfg && liveCfg.exitProfileMode,
    });
  } else if (metaForProfile.exit_rules_override && typeof metaForProfile.exit_rules_override === "object") {
    const profileFromMeta = String(metaForProfile.exit_profile || "BASE").toUpperCase();
    exitProfileResolved = buildExitProfileDecision(
      profileFromMeta === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE,
      "FOLLOW_POSITION_META",
      { profile: profileFromMeta, rules: cloneExitRules(metaForProfile.exit_rules_override) }
    );
  } else {
    const positionProfile = resolvePositionExitProfile({
      posMeta: metaForProfile,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    exitProfileResolved = buildExitProfileDecision(
      positionProfile.profile === "AGGRESSIVE" ? FUTURES_EXIT_PROFILE_AGGRESSIVE : FUTURES_EXIT_PROFILE_BASE,
      positionProfile.reason,
      { profile: positionProfile.profile, rules: cloneExitRules(positionProfile.rules) }
    );
  }
  let exitRulesOverride = cloneExitRules(
    exitProfileResolved && exitProfileResolved.rules
      ? exitProfileResolved.rules
      : FUTURES_EXIT_PROFILE_BASE.rules
  );
  if (intentUpper === "ENTRY" || intentUpper === "ADD") {
    const runtimeExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
      exchange,
      rules: exitRulesOverride,
      features,
      positionMeta: metaForProfile,
      sysCfg,
      cohort: marketRegimeCohort,
      market: symbol,
    });
    exitRulesOverride = cloneExitRules(runtimeExitAdjustment.appliedExitRules);
  }
  const exitProfileRollbackRaw = (exitProfileResolved && exitProfileResolved.rollback && typeof exitProfileResolved.rollback === "object")
    ? exitProfileResolved.rollback
    : null;
  const exitProfileRollback = exitProfileRollbackRaw
    ? {
        rollbackActive: exitProfileRollbackRaw.rollbackActive === true,
        rollbackUntilMs: Number.isFinite(Number(exitProfileRollbackRaw.rollbackUntilMs))
          ? Number(exitProfileRollbackRaw.rollbackUntilMs)
          : null,
        rollbackReason: exitProfileRollbackRaw.rollbackReason ? String(exitProfileRollbackRaw.rollbackReason) : null,
      }
    : {
        rollbackActive: false,
        rollbackUntilMs: null,
        rollbackReason: null,
      };
  if (Number(leverageMult) >= 3 && leverageResolved && /_3X_ENABLED$/.test(String(leverageResolved.reason || ""))) {
    console.log(
      `[adaptive_3x] ex=${String(exchange || "").toUpperCase()} sym=${symbol} ev=${event} intent=${intent} lev=${leverageMult} reason=${leverageResolved.reason}`
    );
  }
  if (exitProfileResolved && exitProfileResolved.profile === "AGGRESSIVE") {
    console.log(
      `[adaptive_exit_profile] ex=${String(exchange || "").toUpperCase()} sym=${symbol} ev=${event} intent=${intent} profile=${exitProfileResolved.profile} reason=${exitProfileResolved.reason}`
    );
  }
  const info = await fetchFuturesExchangeInfoWithCache(symbol);
  const minNotional = Number(info && info.minNotional);
  const minQty = Number(info && info.minQty);
  const minOrderQuote = Number(liveCfg.minOrderQuote || 0);
  const minRequiredQuote = Math.max(
    Number.isFinite(minNotional) ? minNotional : 0,
    Number.isFinite(minOrderQuote) ? minOrderQuote : 0
  );

  const budgetMax = Number.isFinite(budgetBaseRaw) && budgetBaseRaw > 0 ? budgetBaseRaw : null;
  const posNotional = Number.isFinite(posQtyBase) ? (posQtyBase * priceRef) : null;
  let marketCapBudget = null;
  let currentPosBudgetUsed = null;
  let maxEntryNotional = null;
  if (isExit && Number.isFinite(minQty) && minQty > 0 && Number.isFinite(posQtyBase) && posQtyBase > 0 && posQtyBase < minQty) {
    return { ok: false, mode: "LIVE", reason: "POSITION_TOO_SMALL", note: `pos_qty=${posQtyBase}, min_qty=${minQty}` };
  }
  let notionalQuote = isExit
    ? ((Number.isFinite(posNotional) ? posNotional : 0) * Number(qtyFraction || 0))
    : (manualRetryEntry && Number.isFinite(manualQtyBase) && manualQtyBase > 0
      ? (manualQtyBase * priceRef)
      : (budgetMax * Number(qtyFraction || 0) * leverageMult));
  if (!Number.isFinite(notionalQuote) || notionalQuote <= 0) {
    return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL", note: "notional<=0" };
  }

  if (!isExit && !manualRetryEntry) {
    // Entry/ADD budget cap is managed on capital(margin) basis, while order size is notional.
    marketCapBudget = Number.isFinite(budgetMax) && budgetMax > 0 ? budgetMax : null;
    const currentPosNotional = Number.isFinite(posNotional) && posNotional > 0 ? posNotional : 0;
    const currentPosLeverageRaw = Number(
      positionMeta && (
        positionMeta.leverage ??
        positionMeta.external_leverage ??
        positionMeta.futures_leverage
      )
    );
    const currentPosLeverage = normalizeFuturesLeverage(
      Number.isFinite(currentPosLeverageRaw) && currentPosLeverageRaw > 0
        ? currentPosLeverageRaw
        : leverageMult,
      3
    );
    currentPosBudgetUsed = (
      currentPosNotional > 0 &&
      Number.isFinite(currentPosLeverage) &&
      currentPosLeverage > 0
    )
      ? (currentPosNotional / currentPosLeverage)
      : 0;
    maxEntryNotional = Number.POSITIVE_INFINITY;
    if (Number.isFinite(liveCfg.maxOrderQuote) && liveCfg.maxOrderQuote > 0) {
      maxEntryNotional = Math.min(maxEntryNotional, liveCfg.maxOrderQuote);
    }
    if (Number.isFinite(marketCapBudget) && marketCapBudget > 0) {
      const remainingByMarketBudget = Math.max(0, marketCapBudget - currentPosBudgetUsed);
      maxEntryNotional = Math.min(maxEntryNotional, remainingByMarketBudget * leverageMult);
    }
    if (Number.isFinite(maxEntryNotional)) {
      if (maxEntryNotional <= 0) {
        return {
          ok: false,
          mode: "LIVE",
          reason: "POSITION_FULL",
          note: `market_cap_budget=${marketCapBudget}, pos_budget_used=${currentPosBudgetUsed}, pos_notional=${currentPosNotional}`,
        };
      }
      if (notionalQuote > maxEntryNotional) {
        notionalQuote = maxEntryNotional;
      }
    }
  }

  if (isTpP1Exit && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    let forceFullExitReason = null;
    const plannedFraction = Math.max(0, Math.min(1, Number(qtyFraction || 0)));
    const plannedQty = posQtyBase * plannedFraction;
    const remainingQty = posQtyBase * Math.max(0, 1 - plannedFraction);
    const plannedNotional = Number.isFinite(posNotional) ? (posNotional * plannedFraction) : null;
    const remainingNotional = Number.isFinite(posNotional) ? (posNotional * Math.max(0, 1 - plannedFraction)) : null;

    if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0) {
      if (Number.isFinite(plannedNotional) && plannedNotional > 0 && plannedNotional < minRequiredQuote) {
        forceFullExitReason = `PARTIAL_BELOW_MIN_NOTIONAL planned=${plannedNotional}, min_required=${minRequiredQuote}`;
      }
      if (!forceFullExitReason && Number.isFinite(remainingNotional) && remainingNotional > 0 && remainingNotional < minRequiredQuote) {
        forceFullExitReason = `REMAINDER_BELOW_MIN_NOTIONAL remaining=${remainingNotional}, min_required=${minRequiredQuote}`;
      }
    }
    if (Number.isFinite(minQty) && minQty > 0) {
      if (!forceFullExitReason && plannedQty > 0 && plannedQty < minQty) {
        forceFullExitReason = `PARTIAL_BELOW_MIN_QTY planned_qty=${plannedQty}, min_qty=${minQty}`;
      }
      if (!forceFullExitReason && remainingQty > 0 && remainingQty < minQty) {
        forceFullExitReason = `REMAINDER_BELOW_MIN_QTY remaining_qty=${remainingQty}, min_qty=${minQty}`;
      }
    }
    if (forceFullExitReason) {
      qtyFraction = 1;
      if (Number.isFinite(posNotional) && posNotional > 0) {
        notionalQuote = posNotional;
      }
      console.warn(`[TP_P1_FORCE_FULL_EXIT] ex=${String(exchange || "").toUpperCase()} sym=${symbol} reason=${forceFullExitReason}`);
    }
  }

  // 최소 주문 금액 보정
  let allowBelowMinNotional = false;
  if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0 && notionalQuote < minRequiredQuote) {
    if (isExit && Number.isFinite(posNotional) && posNotional > 0 && posNotional < minRequiredQuote) {
      // 포지션 자체가 최소 주문 금액보다 작으면 전량 청산 우선(감소 전용)
      qtyFraction = 1;
      notionalQuote = posNotional;
      allowBelowMinNotional = true;
    }
    if (!isExit) {
      // 진입/추가: 예산 내에서 최소 금액까지 자동 보정
      const minOrderAdjustment = resolveEntryMinOrderBudgetAdjustment({
        minRequiredQuote,
        notionalQuote,
        budgetMax,
        leverageMult,
        maxFractionAllowed,
        qtyFraction,
        maxEntryNotional,
        marketCapBudget,
        currentPosBudgetUsed,
      });
      if (minOrderAdjustment.ok) {
        notionalQuote = minOrderAdjustment.notionalQuote;
      } else {
        return {
          ok: false,
          mode: "LIVE",
          reason: minOrderAdjustment.reason || "MIN_ORDER_EXCEEDS_BUDGET",
          note: minOrderAdjustment.note,
        };
      }
    } else {
      // 청산(부분익절/손절): 포지션 내에서 최소 금액 충족하도록 자동 증액
      if (Number.isFinite(posQtyBase) && posQtyBase > 0) {
        const targetFraction = minRequiredQuote / (posQtyBase * priceRef);
        const adjustedFraction = Math.min(1, targetFraction);
        if (adjustedFraction > Number(qtyFraction || 0)) {
          qtyFraction = adjustedFraction;
          notionalQuote = posQtyBase * priceRef * qtyFraction;
        }
      }
      // 그래도 부족하면 실패
      if (!allowBelowMinNotional && notionalQuote < minRequiredQuote) {
        return { ok: false, mode: "LIVE", reason: "ORDER_TOO_SMALL", note: `min_required=${minRequiredQuote}, notional=${notionalQuote}` };
      }
    }
  }
  if (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0 && Number.isFinite(minRequiredQuote) && minRequiredQuote > 0) {
    const posNotional = posQtyBase * priceRef;
    const remainingNotional = posNotional * Math.max(0, 1 - Number(qtyFraction || 0));
    if (remainingNotional > 0 && remainingNotional < minRequiredQuote) {
      qtyFraction = 1;
      notionalQuote = posNotional;
    }
  }
  if (isExit && Number.isFinite(minQty) && minQty > 0 && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    const minFracByQty = minQty / posQtyBase;
    if (minFracByQty > Number(qtyFraction || 0)) {
      qtyFraction = Math.min(1, minFracByQty);
      const posNotionalByQty = posQtyBase * priceRef;
      if (Number.isFinite(posNotionalByQty) && posNotionalByQty > 0) {
        notionalQuote = posNotionalByQty * qtyFraction;
        if (Number.isFinite(minRequiredQuote) && minRequiredQuote > 0 && notionalQuote < minRequiredQuote) {
          qtyFraction = 1;
          notionalQuote = posNotionalByQty;
        }
      }
    }
  }
  const qtyOverride = (!isExit && manualRetryEntry && Number.isFinite(manualQtyBase) && manualQtyBase > 0)
    ? manualQtyBase
    : ((isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
      ? (posQtyBase * Number(qtyFraction || 0))
      : null);
  const qtyInfo = await computeFuturesOrderQty({
    symbol,
    priceRef,
    notionalQuote,
    reduceOnly: isExit,
    info,
    skipMinNotional: allowBelowMinNotional && isExit,
    qtyBase: qtyOverride,
  });
  if (!qtyInfo.ok || !Number.isFinite(qtyInfo.qty)) {
    return { ok: false, mode: "LIVE", reason: qtyInfo.reason || "ORDER_TOO_SMALL" };
  }

  const reduceOnly = isExit;
  if (!liveCfg.liveDryRun && !isExit) {
    const margin = await ensureFuturesMarginType({ liveCfg, symbol });
    if (!margin.ok) {
      return { ok: false, mode: "LIVE", reason: "MARGIN_TYPE_SET_FAILED", error: margin.error };
    }
  }
  if (liveCfg.liveDryRun) {
    const execPrice = computeFillPrice({ side, nextOpen: priceRef, slippageBps });
    const execQtyBase = qtyInfo.qty;
    const filledNotional = execQtyBase * execPrice;
    const qtyFractionUsed = (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
      ? (execQtyBase / posQtyBase)
      : (manualRetryEntry
        ? ((Number.isFinite(Number(qtyFraction)) && Number(qtyFraction) > 0) ? Number(qtyFraction) : 1)
        : (filledNotional / (budgetMax * leverageMult)));
    return {
      ok: true,
      mode: "LIVE_DRY_RUN",
      execPrice,
      execPriceSource: "BINANCE_DRY_RUN",
      execQtyBase,
      notionalKrw: filledNotional,
      qtyFractionUsed,
      budgetMaxUsed: budgetMax,
      liveOrderId: null,
      appliedLeverage: leverageMult,
      leverageReason: leverageResolved && leverageResolved.reason,
      appliedExitProfile: exitProfileResolved && exitProfileResolved.profile ? String(exitProfileResolved.profile).toUpperCase() : "BASE",
      exitProfileReason: exitProfileResolved && exitProfileResolved.reason ? String(exitProfileResolved.reason) : "BASE_PROFILE",
      appliedExitRules: exitRulesOverride,
      exitProfileRollbackActive: exitProfileRollback.rollbackActive === true,
      exitProfileRollbackUntilMs: Number.isFinite(Number(exitProfileRollback.rollbackUntilMs))
        ? Number(exitProfileRollback.rollbackUntilMs)
        : null,
      exitProfileRollbackReason: exitProfileRollback.rollbackReason || null,
      nativeProtection: null,
    };
  }

  if (Number.isFinite(leverageMult) && leverageMult > 0) {
    const leverageResult = await ensureLiveFuturesLeverage({
      liveCfg,
      symbol,
      leverageMult,
      isExit,
    });
    if (!leverageResult.ok) {
      return { ok: false, mode: "LIVE", reason: leverageResult.reason || "LEVERAGE_SET_FAILED", error: leverageResult.error || null };
    }
    if (
      leverageResult.skipped !== true &&
      Number.isFinite(Number(leverageResult.appliedLeverage)) &&
      Math.abs(Number(leverageResult.appliedLeverage) - Number(leverageMult)) > 0.0001
    ) {
      console.warn(`[BINANCEFUT] leverage rounded: ${leverageMult} -> ${leverageResult.appliedLeverage} (${String(symbol || "").trim().toUpperCase()})`);
    }
  }

  const mainOrderIdempotencyKey = buildBinanceOrderIdempotencyKey({
    intentId: orderIntentId,
    exchange,
    symbol,
    side,
    intent,
    event,
    barCloseMs,
    qty: qtyInfo.qty,
    reduceOnly,
    tag: reduceOnly ? "exit" : "entry",
  });
  // Entry orders (reduceOnly=false) go through the maker-first helper when
  // ENTRY_MAKER_FIRST_ENABLED=1: it tries a GTX limit at best-bid/ask with
  // a short timeout, and falls back to a market order if the limit doesn't
  // fill in time. Exit orders stay market-only — speed of exit matters more
  // than shaving a few bps of fees, and the BE floor / SL logic assumes
  // near-immediate fills.
  let order = null;
  if (!reduceOnly && isEntryMakerFirstEnabled()) {
    const limitIdempotencyKey = `${mainOrderIdempotencyKey}_mk`;
    order = await placeFuturesEntryMakerFirst({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol,
      side,
      quantity: qtyInfo.qty,
      refPrice: priceRef,
      idempotencyKey: mainOrderIdempotencyKey,
      limitIdempotencyKey,
    });
  } else {
    order = await placeFuturesMarketOrder({
      apiKey: liveCfg.apiKey,
      apiSecret: liveCfg.apiSecret,
      symbol,
      side,
      quantity: qtyInfo.qty,
      reduceOnly,
      idempotencyKey: mainOrderIdempotencyKey,
    });
  }

  let detail = order;
  let execPrice = calcBinanceAveragePrice(detail);
  if (!Number.isFinite(execPrice)) {
    try {
      const fetched = await fetchFuturesOrder({
        apiKey: liveCfg.apiKey,
        apiSecret: liveCfg.apiSecret,
        symbol,
        orderId: order && order.orderId,
      });
      detail = fetched || detail;
      execPrice = calcBinanceAveragePrice(detail);
    } catch (_) {}
  }

  const execQtyBase = Number(detail && (detail.executedQty ?? detail.executed_qty ?? detail.origQty ?? detail.orig_qty)) || qtyInfo.qty;
  const filledNotional = (Number.isFinite(execPrice) ? execPrice : priceRef) * execQtyBase;
  const qtyFractionUsed = (isExit && Number.isFinite(posQtyBase) && posQtyBase > 0)
    ? (execQtyBase / posQtyBase)
    : (manualRetryEntry
      ? ((Number.isFinite(Number(qtyFraction)) && Number(qtyFraction) > 0) ? Number(qtyFraction) : 1)
      : (filledNotional / (budgetMax * leverageMult)));
  let nativeProtection = null;
  const nativeProtectionMeta = resolveNativeProtectionPositionMeta(positionMeta);
  const liveOrderSignalRefs = resolveLiveOrderSignalRefs({
    signalId,
    signalDocId,
    entryEventId,
    features,
    exchange,
    symbol,
    tf,
    barCloseMs,
    event,
  });

  if (isExit) {
    await recordExitOrderContractSafe({
      exchange,
      symbol,
      orderId: detail && detail.orderId,
      clientOrderId: detail && detail.clientOrderId,
      event,
      stage: null,
      intentId: orderIntentId || null,
      signalId: liveOrderSignalRefs.signalId,
      signalDocId: liveOrderSignalRefs.signalDocId,
      entryEventId: liveOrderSignalRefs.entryEventId,
      positionSide: side === "BUY" ? "SHORT" : "LONG",
      closeSide: side,
      expectedQtyBase: execQtyBase,
      expectedQtyRatio: qtyFractionUsed,
      triggerPrice: Number.isFinite(execPrice) ? execPrice : priceRef,
      triggerSource: "LIVE_EXIT_MARKET_ORDER",
      reduceOnly,
      closePosition: false,
      status: "OPEN",
      source: "LIVE_EXECUTOR",
      extra: {
        execution_mode: "LIVE",
      },
    });
  }

  if (isExit && !liveCfg.liveDryRun && Number.isFinite(posQtyBase) && posQtyBase > 0) {
    const step = Number(info && info.stepSize);
    const minQty = Number(info && info.minQty);
    const remainingRaw = Math.max(0, posQtyBase - execQtyBase);
    const remaining = roundQtyToStep(remainingRaw, step);
    const px = Number.isFinite(execPrice) ? execPrice : priceRef;
    const remainingNotional = (Number.isFinite(px) && Number.isFinite(remaining)) ? remaining * px : null;
    const dustByQty = Number.isFinite(minQty) && Number.isFinite(remaining) && remaining > 0 && remaining <= minQty;
    const dustByNotional = Number.isFinite(minRequiredQuote) && Number.isFinite(remainingNotional) && remainingNotional > 0 && remainingNotional < minRequiredQuote;
    if (Number.isFinite(remaining) && remaining > 0 && (dustByQty || dustByNotional)) {
      if (!Number.isFinite(minQty) || remaining >= minQty) {
        try {
          console.warn(`[BINANCEFUT_DUST_CLOSE] ${symbol} qty=${remaining} notional=${remainingNotional ?? "NA"}`);
          await placeFuturesMarketOrder({
            apiKey: liveCfg.apiKey,
            apiSecret: liveCfg.apiSecret,
            symbol,
            side,
            quantity: remaining,
            reduceOnly: true,
            idempotencyKey: buildBinanceOrderIdempotencyKey({
              intentId: orderIntentId,
              exchange,
              symbol,
              side,
              intent,
              event,
              barCloseMs,
              qty: remaining,
              reduceOnly: true,
              tag: "dust",
            }),
          });
        } catch (e) {
          console.warn("[BINANCEFUT_DUST_CLOSE_FAIL]", e && e.message ? e.message : String(e));
        }
      }
    }
  }

  if (!liveCfg.liveDryRun) {
    const projectedRemainingQtyBase = isExit && Number.isFinite(posQtyBase) && Number.isFinite(execQtyBase)
      ? Math.max(0, posQtyBase - execQtyBase)
      : null;
    try {
      const requestArgs = buildLiveNativeProtectionRefreshArgs({
        liveCfg,
        exchange,
        symbol,
        side,
        execPrice,
        priceRef,
        leverageMult,
        exitRulesOverride,
        positionMeta: nativeProtectionMeta,
      });
      nativeProtection = await ensureLiveImmediateNativeProtection({
        liveCfg,
        exchange,
        symbol,
        requestArgs,
        opening: nativeProtectionLifecycle.opening,
        closing: nativeProtectionLifecycle.closing,
        remainingQtyBase: projectedRemainingQtyBase,
        intent,
      });
    } catch (nativeErr) {
      nativeProtection = {
        ok: false,
        reason: "NATIVE_PROTECTION_RUNTIME_FAIL",
        error: nativeErr && nativeErr.message ? nativeErr.message : String(nativeErr),
        attempts: 1,
      };
    }
    await notifyNativeProtectionResult({
      nativeProtection,
      symbol,
      exchange,
      liveMode: "LIVE",
    });
  }

  const exitProfileRollbackUntilMsRaw = Number(exitProfileRollback.rollbackUntilMs);

  // If the maker-first helper ran, the returned order carries a `makerFirst`
  // block with per-order telemetry (mode, limit/market fill breakdown,
  // savingsBps). We emit a structured log line — easy to grep in the Cloud
  // Run logs to answer "did maker-first actually earn its keep this week?"
  // and forward it through the return shape so the caller can persist it
  // on the position doc.
  const makerFirstTelemetry = (order && order.makerFirst && typeof order.makerFirst === "object")
    ? order.makerFirst
    : null;
  if (makerFirstTelemetry) {
    try {
      console.log("[MAKER_FIRST]", JSON.stringify({
        symbol,
        side,
        mode: makerFirstTelemetry.mode,
        ref_price: makerFirstTelemetry.refPrice,
        book_bid: makerFirstTelemetry.bookBid,
        book_ask: makerFirstTelemetry.bookAsk,
        limit_price: makerFirstTelemetry.limitPrice,
        limit_exec_qty: makerFirstTelemetry.limitExecutedQty,
        market_exec_qty: makerFirstTelemetry.marketExecutedQty,
        exec_price: Number.isFinite(execPrice) ? execPrice : null,
        savings_bps: makerFirstTelemetry.savingsBps,
        elapsed_ms: makerFirstTelemetry.elapsedMs,
        error: makerFirstTelemetry.error,
      }));
    } catch (_) { /* log only */ }
  }

  return {
    ok: true,
    mode: "LIVE",
    execPrice: Number.isFinite(execPrice) ? execPrice : priceRef,
    execPriceSource: "BINANCE_ORDER",
    execQtyBase,
    notionalKrw: filledNotional,
    qtyFractionUsed,
    budgetMaxUsed: budgetMax,
    liveOrderId: order && order.orderId ? String(order.orderId) : null,
    liveClientOrderId: detail && detail.clientOrderId ? String(detail.clientOrderId) : (order && order.clientOrderId ? String(order.clientOrderId) : null),
    appliedLeverage: leverageMult,
    leverageReason: leverageResolved && leverageResolved.reason,
    appliedExitProfile: exitProfileResolved && exitProfileResolved.profile ? String(exitProfileResolved.profile).toUpperCase() : "BASE",
    exitProfileReason: exitProfileResolved && exitProfileResolved.reason ? String(exitProfileResolved.reason) : "BASE_PROFILE",
    appliedExitRules: exitRulesOverride,
    exitProfileRollbackActive: exitProfileRollback.rollbackActive === true,
    exitProfileRollbackUntilMs: Number.isFinite(exitProfileRollbackUntilMsRaw)
      ? exitProfileRollbackUntilMsRaw
      : null,
    exitProfileRollbackReason: exitProfileRollback.rollbackReason,
    nativeProtection,
    makerFirst: makerFirstTelemetry,
  };
}

function buildLiquidationExitSignal({ position, bar, leverage, bufferPct }) {
  const pos = position || {};
  const state = String(pos.state || "").toUpperCase();
  const size = Number(pos.size_pct || 0);
  const side = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || "LONG";
  const avg = Number(pos.avg_price);
  const closePx = Number(bar && (bar.close ?? bar.c ?? bar.closePrice));
  if (state !== "ACTIVE" || size <= 0) return null;
  if (!Number.isFinite(avg) || !Number.isFinite(closePx)) return null;
  if (!Number.isFinite(leverage) || leverage <= 1) return null;

  const liqPx = (side === "SHORT")
    ? avg * (1 + 1 / leverage)
    : avg * (1 - 1 / leverage);
  if (!Number.isFinite(liqPx) || liqPx <= 0) return null;

  const dist = (side === "SHORT")
    ? (liqPx - closePx) / liqPx
    : (closePx - liqPx) / liqPx;
  if (!Number.isFinite(dist) || dist > bufferPct) return null;

  const exitSide = side === "SHORT" ? "BUY" : "SELL";
  return {
    event: "EXIT_LIQUIDATION_RISK",
    side: exitSide,
    qty_pct: size,
    reason: "LIQUIDATION_RISK",
    features: { position_side: side, liq_px: liqPx, ref_px: closePx, buffer_pct: bufferPct },
  };
}

function intentFromSignal({ event, side, features } = {}) {
  const hinted = String(features && features._event_intent || "").toUpperCase();
  if (hinted === "ENTRY" || hinted === "ADD" || hinted === "EXIT") return hinted;
  const mapping = resolveEventMapping({ event, side });
  return mapping.intent || null;
}

function directionFromSignal({ event, side } = {}) {
  const e = String(event || "").toUpperCase();
  if (e.includes("SHORT")) return "SHORT";
  if (e.includes("LONG")) return "LONG";
  if (e.includes("_SELL") || e.endsWith("_SELL")) return "SHORT";
  if (e.includes("_BUY") || e.endsWith("_BUY")) return "LONG";
  const s = normalizeSideValue(side);
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  return null;
}

function intentExecutionPriority(intentDoc) {
  const intent = intentFromSignal({
    event: intentDoc && intentDoc.event,
    side: intentDoc && intentDoc.side,
    features: intentDoc && intentDoc.features_json,
  });
  if (intent === "EXIT") return 0;
  const ev = String(intentDoc && intentDoc.event || "").toUpperCase();
  const features = intentDoc && intentDoc.features_json;
  const tier = resolveSignalTier(ev, features);
  if (tier === "REAL") return 1;
  if (tier === "PRE_REAL") return 2;
  if (tier === "CORE") return 3;
  if (tier === "EARLY") return 4;
  if (ev.startsWith("TD9P_")) return 5;
  return 6;
}

function sortIntentsForExecution(list) {
  const rows = Array.isArray(list) ? list.slice() : [];
  rows.sort((a, b) => {
    const pa = intentExecutionPriority(a);
    const pb = intentExecutionPriority(b);
    if (pa !== pb) return pa - pb;
    const sa = Number(a && a.scheduled_exec_bar_close_time_utc_ms);
    const sb = Number(b && b.scheduled_exec_bar_close_time_utc_ms);
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
    const ca = Date.parse(String(a && a.created_at || ""));
    const cb = Date.parse(String(b && b.created_at || ""));
    if (Number.isFinite(ca) && Number.isFinite(cb) && ca !== cb) return ca - cb;
    return String(a && (a.intent_id || a.id || "")).localeCompare(String(b && (b.intent_id || b.id || "")));
  });
  return rows;
}

function normalizeSideAllocation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const longScaleRaw = clamp(Number(raw.long_scale), 0.1, 3.0);
  const shortScaleRaw = clamp(Number(raw.short_scale), 0.1, 3.0);
  const longScale = Number.isFinite(longScaleRaw) ? longScaleRaw : 1;
  const shortScale = Number.isFinite(shortScaleRaw) ? shortScaleRaw : 1;
  const enabled = raw.enabled !== false;
  const biasDirectionRaw = String(raw.bias_direction || "").toUpperCase();
  const biasDirection = (biasDirectionRaw === "LONG" || biasDirectionRaw === "SHORT")
    ? biasDirectionRaw
    : "NEUTRAL";
  const biasScore = Number(raw.bias_score);
  const biasConfidence = Number(raw.bias_confidence);
  return {
    enabled,
    longScale,
    shortScale,
    biasDirection,
    biasScore: Number.isFinite(biasScore) ? biasScore : 0,
    biasConfidence: Number.isFinite(biasConfidence) ? biasConfidence : null,
    source: raw.source ? String(raw.source) : null,
    updatedAt: raw.updated_at || null,
  };
}

function applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget }) {
  const qty = Number(qtyFraction);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  if (!riskBudget || riskBudget.enabled !== true) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const intentTag = String(intent || "").toUpperCase();
  if (intentTag !== "ENTRY" && intentTag !== "ADD") {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const sideAlloc = riskBudget && riskBudget.sideAllocation;
  if (!sideAlloc || sideAlloc.enabled !== true) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  const dir = String(intentDir || "").toUpperCase();
  const scale = dir === "SHORT"
    ? Number(sideAlloc.shortScale)
    : dir === "LONG"
      ? Number(sideAlloc.longScale)
      : 1;
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 1e-6) {
    return { qtyFraction: qtyFraction, applied: false, scale: 1 };
  }
  return {
    qtyFraction: qty * scale,
    applied: true,
    scale,
    biasDirection: sideAlloc.biasDirection,
    biasScore: sideAlloc.biasScore,
  };
}

function extractEntrySignalTypeFromMeta(posMeta) {
  if (!posMeta || typeof posMeta !== "object") return null;
  const direct = posMeta.entry_signal_type || posMeta.entry_event || posMeta.entry_signal;
  if (direct) return String(direct).toUpperCase();
  const entryId = posMeta.entry_event_id;
  if (!entryId) return null;
  const parts = String(entryId).split("|").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const last = parts[parts.length - 1];
  return last ? String(last).toUpperCase() : null;
}

function allowEntryDuringTrail({ event, features, posMeta } = {}) {
  const ev = String(event || "").toUpperCase();
  const timingTier = resolveSignalTier(ev, features);
  const qtyProfile = resolveSignalQtyProfile(ev, features);
  if (!(timingTier === "EARLY" || timingTier === "CORE" || qtyProfile === "FIXED")) return false;
  const entryType = extractEntrySignalTypeFromMeta(posMeta);
  const entryTier = resolveSignalTier(entryType, {
    entry_grade: posMeta && (posMeta.entry_grade || posMeta.entry_timing_tier || posMeta.entry_tier),
  });
  const entryQtyProfile = resolveSignalQtyProfile(entryType, {
    entry_qty_profile: posMeta && (posMeta.entry_qty_profile || posMeta.entry_qty_tier || posMeta.qty_profile),
  });
  if (!entryType && !entryTier && !entryQtyProfile) return false;
  if (qtyProfile === "FIXED") return true;
  if (entryQtyProfile === "FIXED") return true;
  return false;
}

function allowByTradingModeIntent(tradingMode, intent) {
  if (tradingMode === "RUNNING") return true;
  if (tradingMode === "EXIT_ONLY") return intent === "EXIT";
  return false;
}

function normalizeQtyFraction(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return n; // treated as "exceed" when budget is enabled
}

async function applyEntryBudgetSignalFloor({
  exchange = null,
  symbol = null,
  intent = null,
  qtyFraction = null,
  maxQtyPct = null,
  features = null,
  nowMs = Date.now(),
  stage = "UNKNOWN",
  entryBudgetGuardOverride = null,
} = {}) {
  const baseQtyPct = normalizeQtyFraction(qtyFraction);
  const maxAllowedQtyPct = Number.isFinite(Number(maxQtyPct)) && Number(maxQtyPct) > 0
    ? Math.min(1, Number(maxQtyPct))
    : 1;
  const enabled = String(process.env.ENTRY_BUDGET_SIGNAL_FLOOR_ENABLED || "1").trim() !== "0";
  const baseFeatures = (features && typeof features === "object") ? { ...features } : {};
  const intentUpper = String(intent || "").trim().toUpperCase();
  const stageUpper = String(stage || "").trim().toUpperCase() || "UNKNOWN";

  if (!enabled || !(intentUpper === "ENTRY" || intentUpper === "ADD") || !Number.isFinite(baseQtyPct) || baseQtyPct <= 0) {
    return {
      qtyPct: baseQtyPct,
      requestedQtyPct: baseQtyPct,
      applied: false,
      entryBudgetGuard: null,
      featuresPatch: baseFeatures,
    };
  }

  const entryBudgetGuard = entryBudgetGuardOverride || await evaluateEntryBudgetGuard({
    exchange,
    symbol,
    intent,
    qtyPct: baseQtyPct,
    nowMs,
  }).catch(() => null);
  const feasibleBand = resolveEntryBudgetGuardFeasibleBand(entryBudgetGuard);
  const requiredQtyPct = normalizeQtyFraction(feasibleBand && feasibleBand.minTradableQtyPct);
  const canApply = (
    entryBudgetGuard &&
    entryBudgetGuard.applicable === true &&
    entryBudgetGuard.ok !== true &&
    String(entryBudgetGuard.reason || "").trim().toUpperCase() === "MIN_ORDER_EXCEEDS_BUDGET" &&
    Number.isFinite(requiredQtyPct) &&
    requiredQtyPct > baseQtyPct + 1e-9 &&
    requiredQtyPct <= maxAllowedQtyPct + 1e-9
  );
  const nextQtyPct = canApply ? requiredQtyPct : baseQtyPct;
  const featuresPatch = {
    ...baseFeatures,
    _entry_budget_signal_floor_enabled: true,
    _entry_budget_signal_floor_stage: stageUpper,
    _entry_budget_signal_floor_prev_qty_pct: baseQtyPct,
    _entry_budget_signal_floor_qty_pct: nextQtyPct,
    _entry_budget_signal_floor_max_qty_pct: maxAllowedQtyPct,
    _entry_budget_signal_floor_required_qty_pct: Number.isFinite(requiredQtyPct) ? requiredQtyPct : null,
    _entry_budget_signal_floor_applied: canApply,
    _entry_budget_signal_floor_feasible_band: feasibleBand && feasibleBand.band ? feasibleBand.band : null,
    _entry_budget_signal_floor_full_only: feasibleBand && feasibleBand.fullOnly === true,
    _entry_budget_signal_floor_guard_ok: entryBudgetGuard ? entryBudgetGuard.ok === true : null,
    _entry_budget_signal_floor_blocked_by_max_qty: (
      Number.isFinite(requiredQtyPct) &&
      requiredQtyPct > maxAllowedQtyPct + 1e-9
    ),
    _entry_budget_signal_floor_reason: canApply
      ? "ENTRY_BUDGET_GUARD_SIGNAL_FLOOR_APPLIED"
      : (entryBudgetGuard && entryBudgetGuard.reason
        ? String(entryBudgetGuard.reason).trim().toUpperCase()
        : null),
  };

  return {
    qtyPct: nextQtyPct,
    requestedQtyPct: nextQtyPct,
    applied: canApply,
    entryBudgetGuard,
    featuresPatch,
  };
}

function resolveEntryTierBudgetMax({
  intent,
  event,
  features,
  side,
  qtyFraction,
  budgetMax,
  baseLeverage = FUTURES_BASE_LEVERAGE,
} = {}) {
  const ev = String(event || "").toUpperCase();
  const base = Number(budgetMax);
  const lev = normalizeFuturesLeverage(Number(baseLeverage), FUTURES_BASE_LEVERAGE);
  let tier = null;
  const qtyProfile = resolveSignalQtyProfile(ev, features);
  if (qtyProfile === "FIXED") {
    const fixedTier = resolveSignalTier(ev, features) || "FIXED";
    const targetMargin = Number.isFinite(FUTURES_ACTIVE_FIXED_MARGIN_TARGET) && FUTURES_ACTIVE_FIXED_MARGIN_TARGET > 0
      ? FUTURES_ACTIVE_FIXED_MARGIN_TARGET
      : null;
    const applied = Number.isFinite(base) && base > 0 && Number.isFinite(targetMargin) && targetMargin > base;
    return {
      applied,
      tier: fixedTier,
      budgetMax: applied ? targetMargin : Number(budgetMax),
      targetMode: FUTURES_ENTRY_TIER_TARGET_MODE,
      targetNotional: (Number.isFinite(targetMargin) && targetMargin > 0 && Number.isFinite(lev) && lev > 0)
        ? (targetMargin * lev)
        : null,
      dynamicPreRealTarget: null,
      requiredBudget: Number.isFinite(targetMargin) && targetMargin > 0 ? targetMargin : null,
      qtyFraction: Number(qtyFraction),
      fixedQty: true,
      targetMargin,
      reason: applied ? "FIXED_MARGIN_TARGET_OVERRIDE" : "FIXED_MARGIN_TARGET_OK",
    };
  }
  if (isEarlyEventName(ev, features)) tier = "EARLY";
  else if (ev.startsWith("CORE_")) tier = "CORE";
  else if (qtyProfile === "PRE_REAL" || isPreRealEventName(ev)) tier = "PRE_REAL";
  const out = {
    applied: false,
    tier,
    budgetMax: Number(budgetMax),
    targetMode: FUTURES_ENTRY_TIER_TARGET_MODE,
    dynamicPreRealTarget: null,
    targetNotional: null,
    requiredBudget: null,
    reason: "SKIP",
  };
  if (!FUTURES_ENTRY_TIER_BUDGET_AUTO_SCALE) {
    out.reason = "DISABLED";
    return out;
  }
  if (!tier) {
    out.reason = "NON_TARGET_TIER";
    return out;
  }
  if (!Number.isFinite(out.targetNotional) || out.targetNotional <= 0) {
    out.reason = "TARGET_DISABLED";
    return out;
  }
  const intentUpper = String(intent || "").toUpperCase();
  if (!(intentUpper === "ENTRY" || intentUpper === "ADD")) {
    out.reason = "NON_ENTRY";
    return out;
  }
  if (!Number.isFinite(base) || base <= 0) {
    out.reason = "NO_BASE_BUDGET";
    return out;
  }
  const q = Number(qtyFraction);
  if (!Number.isFinite(q) || q <= 0) {
    out.reason = "BAD_QTY";
    return out;
  }
  if (!Number.isFinite(lev) || lev <= 0) {
    out.reason = "BAD_BASE_LEVERAGE";
    return out;
  }
  const required = out.targetNotional / (q * lev);
  out.requiredBudget = required;
  if (!Number.isFinite(required) || required <= 0) {
    out.reason = "BAD_REQUIRED_BUDGET";
    return out;
  }
  if (required <= base) {
    out.reason = "BASE_BUDGET_OK";
    return out;
  }
  out.applied = true;
  out.budgetMax = required;
  out.reason = "AUTO_BUMP_TO_TARGET_NOTIONAL";
  return out;
}

function formatLiveExceptionNote(err) {
  const msg = String(err && err.message ? err.message : err || "").trim();
  const parts = [];
  if (msg) parts.push(`msg=${msg}`);
  const requestId = String(err && (err.requestId || err.request_id) || "").trim();
  if (requestId) parts.push(`request_id=${requestId}`);
  const provider = String(err && err.provider || "").trim();
  if (provider) parts.push(`provider=${provider}`);
  const action = String(err && err.action || "").trim();
  if (action) parts.push(`action=${action}`);
  const code = String(err && err.code || "").trim();
  if (code) parts.push(`code=${code}`);
  const timeoutMs = Number(err && err.timeoutMs);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) parts.push(`timeout_ms=${timeoutMs}`);
  const note = parts.join(" | ");
  if (!note) return "LIVE_EXCEPTION";
  return note.slice(0, 900);
}

async function resolveRiskBudget(symbol, exchange) {
  try {
    const rb = await getRiskBudgetForProvider(exchange || "BINANCEFUT", 5000);
    const cfg = rb && rb.data ? rb.data : null;
    const sideAllocation = normalizeSideAllocation(cfg && cfg.side_allocation);
    if (!cfg) return { enabled: false, sideAllocation };
    const configuredEnabled = cfg.enabled === true;
    let maxKrw = Number((cfg.by_market && cfg.by_market[symbol]) || cfg.default_max_krw || 0);
    const onExceed = String(cfg.on_exceed || "CLAMP").toUpperCase();
    let totalMaxKrw = Number(cfg.total_max_krw ?? cfg.total_budget_krw ?? cfg.total_krw ?? 0) || 0;
    const ex = String(exchange || "").toUpperCase();
    const totalMaxSource = String(cfg.total_max_source || "").toLowerCase();
    const configuredAccountTotal = Number(
      cfg.account_total_value ??
      cfg.account_total_krw ??
      cfg.total_account_value ??
      0
    ) || 0;
    const replayForcedTotalRaw = Number(
      process.env.REPLAY_FORCE_TOTAL_MAX_USDT ||
      process.env.REPLAY_FORCE_TOTAL_MAX_KRW ||
      0
    );
    const replayForcedTotal = Number.isFinite(replayForcedTotalRaw) && replayForcedTotalRaw > 0
      ? replayForcedTotalRaw
      : null;
    if (ex.includes("_REPLAY_") && Number.isFinite(replayForcedTotal) && replayForcedTotal > 0) {
      totalMaxKrw = replayForcedTotal;
    } else if (
      ex.includes("BINANCE") &&
      totalMaxSource === "account_total" &&
      Number.isFinite(configuredAccountTotal) &&
      configuredAccountTotal > 0
    ) {
      totalMaxKrw = configuredAccountTotal;
    } else if (ex.includes("BINANCE")) {
      try {
        const keys = await resolveBinanceKeys();
        if (keys.apiKey && keys.apiSecret) {
          const summary = await getBinanceFuturesAccountSummary({ apiKey: keys.apiKey, apiSecret: keys.apiSecret });
          const totalValue = Number(summary && summary.total_value);
          if (Number.isFinite(totalValue) && totalValue > 0) {
            totalMaxKrw = totalValue;
          }
        }
      } catch (acctErr) {
        console.warn(
          `[RISK_BUDGET_ACCOUNT_FETCH_FAIL] BINANCE ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${acctErr && acctErr.message ? acctErr.message : String(acctErr)}`
        );
      }
    }
    const hasMarketOrDefaultBudget = Number.isFinite(maxKrw) && maxKrw > 0;
    const hasTotalBudget = Number.isFinite(totalMaxKrw) && totalMaxKrw > 0;
    const effectiveEnabled = configuredEnabled || hasMarketOrDefaultBudget || hasTotalBudget;
    if (!effectiveEnabled || !hasMarketOrDefaultBudget) {
      return {
        enabled: false,
        configuredEnabled,
        sideAllocation,
        totalMaxKrw: hasTotalBudget ? totalMaxKrw : null,
        source: rb.source || "unknown",
      };
    }
    return {
      enabled: true,
      configuredEnabled,
      maxKrw,
      totalMaxKrw: hasTotalBudget ? totalMaxKrw : null,
      defaultMaxKrw: Number(cfg.default_max_krw || 0) || 0,
      byMarket: (cfg.by_market && typeof cfg.by_market === "object") ? cfg.by_market : {},
      onExceed: (onExceed === "SKIP") ? "SKIP" : "CLAMP",
      source: rb.source || "unknown",
      unit: String(cfg.unit || (String(exchange || "").toUpperCase().includes("BINANCE") ? "USDT" : "KRW")).toUpperCase(),
      sideAllocation,
    };
  } catch (e) {
    return { enabled: false, error: (e && e.message) ? e.message : String(e) };
  }
}

async function computeTotalBudgetUsage(riskBudget, exchange) {
  if (!riskBudget || !riskBudget.enabled || !riskBudget.totalMaxKrw) {
    return { totalMaxKrw: null, totalUsedKrw: null };
  }
  const rows = await listExchangePositionReadViews({ exchange }).catch(() => []);
  let totalUsed = 0;
  for (const x of (Array.isArray(rows) ? rows : [])) {
    const ex = String(x.exchange || "").toUpperCase();
    const target = String(exchange || "").toUpperCase();
    if (target && ex && ex !== target) continue;
    const posId = String(x.pos_id || x.id || "");
    if (!posId.startsWith("POS__")) continue;
    const mk = x.symbol_or_pair_id || x.symbol;
    if (!mk) continue;
    const state = String(x.state || "").toUpperCase();
    const size = Number(x.size_pct);
    if (state === "FLAT") continue;
    if (Number.isFinite(size) && size <= POS_SIZE_EPSILON) continue;

    let used;
    if (target.includes("BINANCE")) {
      used = resolveBinanceBudgetUsedKrw({ position: x, riskBudget });
    } else {
      used = Number(x.budget_used_krw);
      if (!Number.isFinite(used)) {
        const size = Number(x.size_pct);
        const maxKrw = Number((riskBudget.byMarket && riskBudget.byMarket[mk]) || riskBudget.defaultMaxKrw || 0);
        if (Number.isFinite(size) && size > 0 && Number.isFinite(maxKrw) && maxKrw > 0) {
          used = size * maxKrw;
        } else {
          used = 0;
        }
      }
    }
    totalUsed += used;
  }
  return { totalMaxKrw: riskBudget.totalMaxKrw, totalUsedKrw: totalUsed };
}

async function runPaperBinanceForBar({
  runId,
  exchange,
  symbol,
  tf,
  execTf,
  barCloseUtc,
  barCloseMs,
  bar,
  gate,
  trading_mode,
  backfillExitOnly,
  backfillAllowEntry,
} = {}) {
  const signalTf = String(tf || defaultExecTfFromEnv() || "15m");
  const execTfFinal = String(execTf || signalTf);
  const signalTfMs = tfToMs(signalTf);
  const execTfMs = tfToMs(execTfFinal);
  const tpP1PendingHoldMs = resolveTpP1PendingHoldMs();
  const execProfile = await resolveExecutionProfile({ symbol, bar, exchange });
  const { feeBps, slippageBps } = execProfile;
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  const useBudget = riskBudget && riskBudget.enabled === true;
  const { leverage, bufferPct } = await resolveFuturesRiskConfig(exchange);
  const exUpper = String(exchange || "").toUpperCase();
  const liveCfg = await resolveLiveConfig({ exchange, symbol });
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const sysCfg = (sys && sys.data) ? sys.data : {};
  const sysCfgEffective = resolveImmediateDefaultsForExchange(sysCfg, exchange);
  const forceAllSignalsAdd = resolveForceAllSignalsAdd(sysCfgEffective, exchange);
  const autoScore = await resolveAutoScoreMin({ exchange, sysCfg: sysCfgEffective });
  const signalOverlapEnabled = forceAllSignalsAdd ? false : normalizeBool(sysCfg.signal_overlap_enabled, true);
  const signalOverlapBars = forceAllSignalsAdd ? 0 : Math.max(0, normalizeInt(sysCfg.signal_overlap_bars, 2));
  const signalQueueEnabled = normalizeBool(sysCfg.signal_queue_enabled, true);
  const defaultLateBars = exUpper.includes("BINANCEFUT") ? 6 : 1;
  const configuredLateBars = normalizeInt(sysCfg.signal_queue_max_late_bars, defaultLateBars);
  const signalQueueMaxLateBars = Math.max(defaultLateBars, Math.max(0, configuredLateBars));
  const exitImmediateEnabled = normalizeBool(
    process.env.EXIT_IMMEDIATE_ENABLED,
    normalizeBool(sysCfg.exit_immediate_enabled, true)
  );
  const immediateCfg = resolveImmediateEntryConfig(sysCfgEffective);
  const shortGateCfg = resolveShortEntryGateConfig(sysCfgEffective, exchange);
  const aiBiasGateCfg = resolveAiBiasEntryGateConfig(sysCfgEffective, exchange);
  const evGateCfg = resolveEvGateConfig(sysCfgEffective, exchange, symbol);
  const waitOneBarCfg = resolveWaitOneBarConfig(sysCfgEffective, exchange);
  const entryQualityCfg = resolveEntryQualityGateConfig(sysCfgEffective, exchange);
  const addRiskCfgRaw = resolveAddRiskConfig(sysCfgEffective, exchange);
  const addRiskCfg = forceAllSignalsAdd ? { ...addRiskCfgRaw, enabled: false } : addRiskCfgRaw;
  const tradeableSignalTypes = resolveTradeableSignalTypes(sysCfgEffective, exchange);
  const binanceFutOnly = exUpper.includes("BINANCEFUT");
  const maxHoldBars = binanceFutOnly ? resolveBinanceMaxHoldBars(sysCfgEffective, signalTfMs) : 0;
  const sameDirectionTrailProfitCooldownCfg = resolveSameDirectionTrailProfitCooldownConfig(sysCfgEffective);

  // 1) 포지션 로드
  let pos = await getPositionReadView({ exchange, symbol });
  let posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
  let sameDirectionTrailProfitObservation = await loadSameDirectionTrailProfitObservationSafe({
    enabled: sameDirectionTrailProfitCooldownCfg.enabled,
    exchange,
    symbol,
  });
  const oppositeCooldownWindow = binanceFutOnly
    ? resolveOppositeCooldownWindowFromPosition({ sysCfg: sysCfgEffective, position: pos })
    : { bars: 0, timeMs: 0, cohort: null };
  const oppositeCooldownBars = binanceFutOnly ? oppositeCooldownWindow.bars : 0;
  const oppositeTimeCooldownMs = binanceFutOnly ? oppositeCooldownWindow.timeMs : 0;
  let posQtyBase = resolvePosQtyBase(pos);
  const spikeLock = await resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg });
  let pendingMetaPatch = null;
  if (spikeLock && spikeLock.active && Number.isFinite(spikeLock.untilMs)) {
    const prevUntil = Number(posMeta.spike_lock_until_ms);
    if (!Number.isFinite(prevUntil) || spikeLock.untilMs > prevUntil) {
      pendingMetaPatch = mergeMeta(pendingMetaPatch, {
        spike_lock_until_ms: spikeLock.untilMs,
        spike_lock_set_ms: Number(barCloseMs),
        spike_lock_reason: spikeLock.reason || "SPIKE_DETECTED",
        spike_lock_move_pct: spikeLock.movePct ?? null,
        spike_lock_tf: spikeLock.tf || null,
      });
    }
  }
  if (pendingMetaPatch) posMeta = mergeMeta(posMeta, pendingMetaPatch);

  // 2) (A) exec: 이번 봉 open으로 이전 봉 intent 실행
  const execBarCloseMs = Number(barCloseMs);
  const execBarCloseUtc = barCloseUtc;

  try {
    const { cancelExpiredPendingIntents } = require("../storage/orderIntentsPaper");
    await cancelExpiredPendingIntents({ exchange, symbol, tf: signalTf, lookbackLimit: 600 });
  } catch (e) {
    console.warn("[INTENT_EXPIRE_CANCEL_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  let intents = await listPendingIntentsForExec({
    exchange,
    symbol,
    tf: signalTf,
    execBarCloseMs,
    limitN: 50,
  });
  try {
    const { listPendingIntentsOverdue } = require("../storage/orderIntentsPaper");
    const overdue = await listPendingIntentsOverdue({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 20,
      lookbackLimit: 600,
    });
    if (Array.isArray(overdue) && overdue.length) {
      const seen = new Set(intents.map((x) => x.intent_id || x.id));
      overdue.forEach((x) => {
        const id = x.intent_id || x.id;
        if (id && !seen.has(id)) intents.push(x);
      });
    }
  } catch (e) {
    console.warn("[INTENT_OVERDUE_FETCH_FAIL]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  const budgetTotals = useBudget ? await computeTotalBudgetUsage(riskBudget, exchange) : { totalMaxKrw: null, totalUsedKrw: null };
  const totalMaxKrw = budgetTotals.totalMaxKrw;
  let totalUsedKrw = budgetTotals.totalUsedKrw;

  let fillsExecuted = 0;

  const attemptAt = new Date().toISOString();
  const executeIntentList = async (intentsList) => {
    for (const it of intentsList) {
      const schedMs = Number(it.scheduled_exec_bar_close_time_utc_ms);
      const isOverdue = Number.isFinite(schedMs) && Number.isFinite(execBarCloseMs) && schedMs < execBarCloseMs;
      await patchIntent(it.intent_id, {
        last_attempt_at: attemptAt,
        last_attempt_bar_close_time_utc: execBarCloseUtc,
        last_attempt_bar_close_time_utc_ms: execBarCloseMs,
        ...(isOverdue ? {
          pending_reason: "LATE_EXEC",
          pending_note: `late_exec_from=${msToUtcZ(schedMs)}`,
        } : {}),
      });

    const intent = intentFromSignal({ event: it.event, side: it.side, features: it.features_json });
    it.features_json = buildSignalStageFeatures({ ...(it || {}), features: it.features_json }, intent);
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);
    const v2DiscoveryLegacyEntryFilterBypass = shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent });
    if (v2DiscoveryLegacyEntryFilterBypass) {
      it.features_json = {
        ...(it.features_json || {}),
        v2_discovery_legacy_entry_filters_bypassed: true,
        v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
      };
      await patchIntent(it.intent_id, { features_json: it.features_json }).catch(() => {});
      const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
        env: process.env,
        intentRow: it,
        liveCfg,
        referencePrice: Number(bar && (bar.open ?? bar.o)) || Number(it.signal_price) || Number(bar && (bar.close ?? bar.c)),
        requestId: it.request_id || it.intent_id || it.signal_id || (it.features_json && it.features_json.signal_id),
      }).catch((error) => ({
        ok: false,
        reason: "V2_DISCOVERY_BRIDGE_THROWN",
        error_message: error && error.message ? String(error.message) : String(error),
      }));
      if (handoff && handoff.ok === true) {
        const requestBody = handoff.request && handoff.request.body ? handoff.request.body : {};
        const requestBundle = requestBody.bundle || {};
        const requestPermit = requestBody.executionPermit || {};
        const routeReason = "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE";
        const handoffSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
        await markIntentStatus(it.intent_id, "SUPERSEDED_BY_V2_PROTECTED_ENTRY", {
          cancel_reason: routeReason,
          status_reason: routeReason,
          cancel_note: "Legacy order intent was superseded by V2 productionEntryLiveEndpoint/productionEntryRoute before legacy entry filters; not a drop/cancel.",
          v2_discovery_bridge_reason: handoff.reason || null,
          v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
          v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
        });
        const handoffSignalClaim = await claimSignalForProgressAlert({
          signalId: handoffSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs,
          execBarCloseUtc,
          reason: routeReason,
          meta: {
            intent,
            order_intent_id: it.intent_id || null,
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        });
        if (handoffSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          event: it.event,
          side: normalizeSideValue(it.side),
          tf: signalTf,
          qtyPct: Number(it.qty_pct),
          executionMode: liveCfg.executionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: routeReason,
          pendingReason: "IMMEDIATE_EXEC",
          signalId: handoffSignalId,
        }).catch((e) => {
          console.warn("[V2_DISCOVERY_EARLY_HANDOFF_ALERT_FAIL]", e && e.message ? e.message : String(e));
        });
        continue;
      }
      const routedDecision = handoff && (handoff.routedDecision || (handoff.request && handoff.request.routedDecision));
      const endpointReason = handoff && handoff.endpoint_result ? handoff.endpoint_result.reason || null : null;
      const postFillHandoff = classifyV2DiscoveryPostFillHandoff(handoff);
      const endpointPostFillCritical = postFillHandoff.unprotected_position_possible === true
        || String(endpointReason || "").trim().toUpperCase() === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL";
      let blockReason = "V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE";
      if (routedDecision && routedDecision.reason) {
        blockReason = String(routedDecision.reason).trim().toUpperCase();
      } else if (endpointReason) {
        blockReason = String(endpointReason).trim().toUpperCase();
      } else if (handoff && handoff.reason) {
        blockReason = String(handoff.reason).trim().toUpperCase();
      }
      if (postFillHandoff.exchange_write_performed === true && postFillHandoff.reason) {
        blockReason = postFillHandoff.reason;
      }
      await markIntentStatus(it.intent_id, postFillHandoff.status || (endpointPostFillCritical ? "FAILED_INTERNAL" : "CANCELED"), {
        cancel_reason: blockReason,
        status_reason: blockReason,
        cancel_note: JSON.stringify({
          note: postFillHandoff.note || (endpointPostFillCritical
            ? "V2 productionEntryLiveEndpoint reported post-fill protection critical state. Actual exchange entry may exist and requires protection repair verification."
            : "V2 discovery entry was handed to productionEntryLiveEndpoint/productionEntryRoute before legacy entry filters."),
          bridge_reason: handoff && handoff.reason ? handoff.reason : null,
          bridge_error: handoff && handoff.error_message ? handoff.error_message : null,
          endpoint_reason: endpointReason,
          router_reason: routedDecision && routedDecision.reason ? routedDecision.reason : null,
          post_fill_exchange_write_performed: postFillHandoff.exchange_write_performed === true,
          post_fill_unprotected_position_possible: postFillHandoff.unprotected_position_possible === true,
          post_fill_side_effect: postFillHandoff.side_effect || null,
        }),
      });
      if (postFillHandoff.exchange_write_performed === true) {
        const postFillSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
        const postFillSignalClaim = await claimSignalForProgressAlert({
          signalId: postFillSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs,
          execBarCloseUtc,
          reason: blockReason,
          critical: postFillHandoff.unprotected_position_possible === true,
          meta: {
            intent,
            order_intent_id: it.intent_id || null,
            v2_discovery_post_fill_exchange_write: true,
            v2_discovery_post_fill_unprotected_possible: postFillHandoff.unprotected_position_possible === true,
          },
        });
        if (postFillSignalClaim.ok !== true) {
          continue;
        }
        sendV2DiscoveryPostFillHandoffProgressAlert({
          exchange,
          symbol,
          event: it.event,
          side: normalizeSideValue(it.side),
          tf: signalTf,
          qtyPct: Number(it.qty_pct),
          executionMode: liveCfg.executionMode,
          signalId: postFillSignalId,
          blockReason,
          handoff,
          postFillHandoff,
        });
        continue;
      }
      notifyTradeExitFailureAlert({
        exchange,
        symbol,
        event: it.event,
        side: normalizeSideValue(it.side),
        intent,
        executionMode: liveCfg.executionMode,
        reason: blockReason,
        qtyPct: Number(it.qty_pct),
        positionSideBefore: resolveFailureAlertPositionSide(pos),
      });
      continue;
    }
    const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;
    let preQtyScale = 1;
    if (backfillExitOnly && intentIsEntry) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // Tick-exit loop must not consume/cancel entry intents; leave them for normal RUN cycle.
        continue;
      }
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BACKFILL_SKIP_ENTRY", status_reason: "BACKFILL_SKIP_ENTRY" });
      continue;
    }
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: it.event, features: it.features_json, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRAIL_ACTIVE_NO_ADD", status_reason: "DROP_TRAIL_ACTIVE_NO_ADD" });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: `MODE_${trading_mode}`, status_reason: "TRADING_MODE" });
      continue;
    }
    const eventUpper = String(it.event || "").toUpperCase();
    const actionTag = normalizeActionValue(it.features_json && it.features_json.action);
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: it.event })
      : directionFromSignal({ event: it.event, side: it.side });
    if (
      intent === "EXIT"
      && isForbiddenTp0ExitIntent({
        currentMeta: posMeta,
        event: eventUpper,
      })
    ) {
      await markIntentStatus(it.intent_id, "CANCELED", {
        cancel_reason: "DROP_SIMPLIFIED_EXIT_V2_FORBIDDEN_TP0",
        status_reason: "DROP_SIMPLIFIED_EXIT_V2_FORBIDDEN_TP0",
        cancel_note: JSON.stringify({
          event: eventUpper,
          simplified_exit_v2_enabled: true,
          tp_p0_done: posMeta && posMeta.tp_p0_done === true,
          tp_p1_done: posMeta && posMeta.tp_p1_done === true,
          trail_active: posMeta && posMeta.trail_active === true,
        }),
      });
      continue;
    }
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ACTION_FILTER", status_reason: "DROP_ACTION_FILTER" });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRADEABLE_SIGNAL_TYPES", status_reason: "DROP_TRADEABLE_SIGNAL_TYPES" });
      continue;
    }
    if (intentIsEntry) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        sysCfg: sysCfgEffective,
        market: it.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          status_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          cancel_note: canonical.detail ? JSON.stringify(canonical.detail) : undefined,
        });
        continue;
      }
      if (canonical.detail) {
        it.features_json = { ...(it.features_json || {}), ...(canonical.detail || {}) };
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: quality.reason || "DROP_ENTRY_QUALITY",
          status_reason: quality.reason || "DROP_ENTRY_QUALITY",
          cancel_note: quality.detail ? JSON.stringify(quality.detail) : undefined,
        });
        continue;
      }
    }
    // Commission Gate v2 soft mode + MDD gate — intent execution
    if (intentIsEntry && !manualRetryIntent) {
      try {
        const signalScaleFlags = resolveSignalScaledFlags(it.features_json);
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "intent_exec", exchange, symbol, event: it.event, perfGate, intentId: it.intent_id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          if (signalScaleFlags.commissionScaledInSignal) {
            console.log(`[COMMISSION_GATE][DEDUPE] intent ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_scale=${signalScaleFlags.commissionScale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          } else {
            preQtyScale = preQtyScale * commScale.scale;
            console.warn(`[COMMISSION_GATE][SOFT_REDUCE] intent ${exchange} ${symbol} ${it.event} | ratio=${(perfGate.commissionRatio * 100).toFixed(1)}% threshold=${((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0)}% | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          }
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          if (signalScaleFlags.mddScaledInSignal) {
            console.log(`[MDD_REDUCE][DEDUPE] intent ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_factor=${signalScaleFlags.mddReduceFactor.toFixed(4)}`);
          } else {
            preQtyScale = preQtyScale * perfGate.mddReduceFactor;
            console.log(`[MDD_REDUCE] intent ${exchange} ${symbol} ${it.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% | factor=${perfGate.mddReduceFactor}`);
          }
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "intent_exec", exchange, symbol, event: it.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ERROR", status_reason: "DROP_COMMISSION_GATE_ERROR" });
          continue;
        }
      }
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: it.features_json, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        const intentBarMs = Number(it.signal_bar_close_time_utc_ms) || Number(execBarCloseMs);
        if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
          const barsSinceExit = Math.floor((intentBarMs - lastExitMs) / signalTfMs);
          if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
            if (intentDir && lastExitDir && intentDir !== lastExitDir) {
              await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_COOLDOWN", status_reason: "DROP_OPPOSITE_COOLDOWN" });
              continue;
            }
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
          const elapsedMs = resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs) - lastExitWallMs;
          if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
            console.log(`[OPPOSITE_TIME_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_TIME_COOLDOWN", status_reason: "DROP_OPPOSITE_TIME_COOLDOWN" });
            continue;
          }
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
          cfg: sameDirectionTrailProfitCooldownCfg,
          posMeta: resolveSameDirectionTrailProfitCooldownSnapshot({
            posMeta,
            observation: sameDirectionTrailProfitObservation,
            observationOnly: true,
          }),
          intentDir,
          eventRefMs: resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs),
        });
        if (sameDirectionCooldown) {
          console.log(
            `[SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} ` +
            `| dir=${intentDir} | elapsed=${Math.floor(sameDirectionCooldown.elapsed_ms / 1000)}s ` +
            `< cooldown=${Math.floor(sameDirectionCooldown.cooldown_ms / 1000)}s`
          );
          await markIntentStatus(it.intent_id, "CANCELED", {
            cancel_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
            status_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          });
          continue;
        }
      }
    }
    if (intent === "EXIT") {
      const hasPosition = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPosition) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(it.qty_pct) : Number(it.qty_pct);
    const fixedQtyRestore = restoreFixedEntryQtyFraction({
      qtyFraction,
      intent,
      event: it.event,
      features: it.features_json,
    });
    if (fixedQtyRestore.restored) {
      qtyFraction = fixedQtyRestore.qtyFraction;
      it.features_json = {
        ...(it.features_json || {}),
        fixed_qty_ev_scale_restored: true,
        fixed_qty_original_qty_fraction: fixedQtyRestore.originalQtyFraction,
        fixed_qty_restored_qty_fraction: fixedQtyRestore.qtyFraction,
      };
    }
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    if (intentIsEntry && Number.isFinite(preQtyScale) && preQtyScale > 0 && preQtyScale < 0.9999) {
      qtyFraction = qtyFraction * preQtyScale;
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ZERO_QTY", status_reason: "DROP_COMMISSION_GATE_ZERO_QTY" });
        continue;
      }
    }
    if (intent === "ADD") {
      const addGuard = evaluateAddIntentRiskGuard({
        cfg: addRiskCfg,
        intent,
        position: pos,
        posMeta,
        bar,
        barCloseMs: execBarCloseMs,
        qtyFraction,
      });
      if (!addGuard.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: addGuard.reason || "DROP_ADD_GUARD",
          status_reason: addGuard.reason || "DROP_ADD_GUARD",
          cancel_note: addGuard.detail ? JSON.stringify(addGuard.detail) : undefined,
        });
        continue;
      }
      if (Number.isFinite(addGuard.qtyScale) && addGuard.qtyScale > 0 && addGuard.qtyScale < 0.9999) {
        qtyFraction *= addGuard.qtyScale;
      }
      if (useBudget) qtyFraction = normalizeQtyFraction(qtyFraction);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ADD_QTY_INVALID", status_reason: "DROP_ADD_QTY_INVALID" });
        continue;
      }
    }
    let maxFractionAllowed = qtyFraction;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_EXCEED_POLICY_SKIP", status_reason: "BUDGET_POLICY_SKIP" });
        continue;
      }
      qtyFraction = 1;
    }

    if (it.side === "SELL") {
      const available = Number(pos.size_pct || 0);
      const sellQty = Math.min(qtyFraction, available);
      if (sellQty <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sellQty;
    }

    if (it.side === "BUY" && useBudget) {
      const curSize = Number(pos.size_pct || 0);
      const remaining = Math.max(0, 1 - curSize);
      if (remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      if (qtyFraction > remaining) qtyFraction = remaining;

      let maxByTotal = null;
      if (Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        maxByTotal = remainingTotal / riskBudget.maxKrw;
        if (qtyFraction > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          qtyFraction = maxByTotal;
        }
      }

      // 최소 주문 금액 미만이면 자동 보정(가능한 범위 내)
      const minOrderKrw = Number(liveCfg.minOrderKrw || 0);
      const liveMode = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
      if (liveMode && minOrderKrw > 0 && Number.isFinite(riskBudget.maxKrw) && riskBudget.maxKrw > 0) {
        const minQtyFraction = minOrderKrw / riskBudget.maxKrw;
        const maxAllowed = Number.isFinite(maxByTotal)
          ? Math.min(remaining, maxByTotal)
          : remaining;
        if (minQtyFraction <= maxAllowed) {
          if (qtyFraction < minQtyFraction) {
            qtyFraction = minQtyFraction;
            await patchIntent(it.intent_id, {
              pending_reason: "ORDER_TOO_SMALL_AUTO_BUMP",
              pending_note: `min_order_krw=${Math.trunc(minOrderKrw)}`,
            });
          }
        } else if (qtyFraction < minQtyFraction) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "ORDER_TOO_SMALL", status_reason: "ORDER_TOO_SMALL" });
          continue;
        }
      }

      if (qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
    }

    if (intentIsEntry) {
      const signalFloor = await applyEntryBudgetSignalFloor({
        exchange,
        symbol,
        intent,
        qtyFraction,
        maxQtyPct: Math.max(0, 1 - Number(pos && pos.size_pct || 0)),
        features: it.features_json,
        nowMs: Number(execBarCloseMs),
        stage: "RUNNER_INTENT_EXEC",
      });
      if (signalFloor.featuresPatch && typeof signalFloor.featuresPatch === "object") {
        it.features_json = signalFloor.featuresPatch;
      }
      if (Number.isFinite(Number(signalFloor.qtyPct)) && Number(signalFloor.qtyPct) > 0) {
        qtyFraction = Number(signalFloor.qtyPct);
      }
      const openclawEval = await applyOpenClawExecutorDecision({
        exchange,
        symbol,
        intent,
        event: it.event,
        side: it.side,
        qtyPct: qtyFraction,
        requestedQtyPct: signalFloor.requestedQtyPct,
        features: it.features_json,
        stage: "RUNNER_INTENT_EXEC",
        applyScale: false,
        nowMs: Number(execBarCloseMs),
        signalTf,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        requestId: it.request_id || null,
        runId,
        signalId: it.signal_id || (it.features_json && it.features_json.signal_id) || null,
        intentId: it.intent_id || null,
      });
      if (openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object") {
        it.features_json = openclawEval.featuresPatch;
      }
      if (!openclawEval.ok || !Number.isFinite(Number(openclawEval.qtyPctFinal)) || Number(openclawEval.qtyPctFinal) <= 0) {
        const reason = String(openclawEval.reason || "OPENCLAW_EXECUTOR_BLOCK").trim().toUpperCase() || "OPENCLAW_EXECUTOR_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }
      qtyFraction = Number(openclawEval.qtyPctFinal);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        const reason = String(openclawEval.reason || "OPENCLAW_EXECUTION_AUTHORITY_BLOCK").trim().toUpperCase() || "OPENCLAW_EXECUTION_AUTHORITY_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }
    }

    const nextOpen = Number(bar.open);
    let fillPrice = null;
    let execPriceSource = "BAR_OPEN";
    let executionMode = "PAPER";
    let liveOrderId = null;
    let execQtyBase = null;
    let liveNotionalKrw = null;
    let avgPrevNotional = null;
    let avgNeedsUpdate = false;
    let liveAdjusted = false;
    let notionalKrw = useBudget ? (riskBudget.maxKrw * qtyFraction) : null;

    const isLiveExecution = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
    if (!isLiveExecution && (intent === "ENTRY" || intent === "ADD") && String(exchange || "").toUpperCase().includes("BINANCE")) {
      try {
        const paperExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: it.event,
          side: actionSide,
          features: it.features_json,
          nowMs: Number(execBarCloseMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
        if (paperExitProfile && paperExitProfile.profile) {
          appliedExitProfile = String(paperExitProfile.profile).toUpperCase() === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
        }
        if (paperExitProfile && paperExitProfile.reason) appliedExitProfileReason = String(paperExitProfile.reason);
        if (paperExitProfile && paperExitProfile.rules && typeof paperExitProfile.rules === "object") {
          appliedExitRules = cloneExitRules(paperExitProfile.rules);
        }
      } catch (paperExitErr) {
        console.warn(
          `[PAPER_EXIT_PROFILE_RESOLVE_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${paperExitErr && paperExitErr.message ? paperExitErr.message : String(paperExitErr)}`
        );
      }
    }
    let nativeProtectionMetaPatch = null;
    const liveMarketRegimeCohort = resolveLiveMarketRegimeCohort({ symbol, posMeta });
    if (isLiveExecution) {
      if (liveCfg.executionMode === "LIVE" && !liveCfg.liveEnabled) {
        const liveReason = liveCfg.reason || "LIVE_DISABLED";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: liveReason, status_reason: "LIVE_DISABLED" });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: it.side,
          intent,
          executionMode: "LIVE",
          reason: liveReason,
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta: pos && pos.meta,
            exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        continue;
      }
      const claim = await claimPendingIntentForExecution(it.intent_id, {
        runId,
        attemptAt,
        execBarCloseUtc,
        execBarCloseMs,
      });
      if (!claim || claim.ok !== true) continue;
      Object.assign(it, claim.doc || {});
      const liveResult = await executeLiveOrder({
        liveCfg,
        symbol,
        side: it.side,
        qtyFraction,
        riskBudget,
        pos,
        bar,
        slippageBps,
      });
      if (!liveResult.ok) {
        const liveReason = liveResult.reason || "LIVE_FAILED";
        const cancelPatch = {
          cancel_reason: liveReason,
          status_reason: liveReason,
        };
        if (liveResult.note || liveResult.error) cancelPatch.cancel_note = liveResult.note || liveResult.error;
        if (liveResult.error) cancelPatch.last_error = liveResult.error;
        await markIntentStatus(it.intent_id, "CANCELED", cancelPatch);
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: it.side,
          intent,
          executionMode: liveCfg.executionMode,
          reason: liveReason,
          note: liveResult.note || null,
          error: liveResult.error || null,
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta: pos && pos.meta,
            exitRules: (pos && pos.meta && pos.meta.exit_rules_override) || pos.exit_rules_override || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        continue;
      }
      fillPrice = liveResult.execPrice;
      execPriceSource = liveResult.execPriceSource || "UPBIT_ORDER";
      executionMode = liveResult.mode || "LIVE";
      liveOrderId = liveResult.liveOrderId || null;
      execQtyBase = liveResult.execQtyBase;
      if (Number.isFinite(liveResult.qtyFractionUsed)) qtyFraction = liveResult.qtyFractionUsed;
      if (Number.isFinite(liveResult.notionalKrw)) notionalKrw = liveResult.notionalKrw;
    } else {
      fillPrice = computeFillPrice({ side: it.side, nextOpen, slippageBps });
      executionMode = "PAPER";
    }

    if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_FILL_PRICE", status_reason: "BAD_FILL_PRICE" });
      continue;
    }

    // 포지션 갱신
    let newSize = Number(pos.size_pct || 0);
    let newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
    let newQtyBase = Number.isFinite(posQtyBase) ? posQtyBase : 0;
    const prevSize = Number(pos.size_pct || 0);

    if (it.side === "BUY") {
      const addCapState = (intent === "ADD")
        ? ensureLogicalAddCapState(resolveLogicalAddCapState({
          posSizePct: newSize,
          position: pos,
          posMeta,
          stagedAddCount: 0,
        }), { posSizePct: newSize, position: pos })
        : null;
      const currentSizeForCap = resolveCurrentQtyPctForCap(addCapState, newSize);
      const remaining = Math.max(0, 1 - currentSizeForCap);
      if (useBudget && remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }

      let add = qtyFraction;
      if (useBudget && add > remaining) add = remaining;
      if (useBudget && Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        const maxByTotal = remainingTotal / riskBudget.maxKrw;
        if (add > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          add = maxByTotal;
        }
      }
      if (add <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      qtyFraction = add;
      const prevNotional = newSize;
      const nextNotional = newSize + add;

      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        newQtyBase = 0;
      } else {
        if (newAvg === null) newAvg = fillPrice;
        else newAvg = (newAvg * prevNotional + fillPrice * add) / nextNotional;
        newSize = nextNotional;
        const addQtyBase = Number.isFinite(execQtyBase) && execQtyBase > 0
          ? execQtyBase
          : ((notionalKrw != null && Number.isFinite(fillPrice) && fillPrice > 0) ? (notionalKrw / fillPrice) : 0);
        newQtyBase = Math.max(0, newQtyBase + addQtyBase);
      }
    } else {
      const sub = Math.min(qtyFraction, newSize);
      if (sub <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sub;
      const nextNotional = newSize - sub;
      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        newQtyBase = 0;
      } else {
        newSize = nextNotional;
        const ratio = prevSize > 0 ? (sub / prevSize) : 1;
        const subQtyBase = Number.isFinite(execQtyBase) && execQtyBase > 0
          ? execQtyBase
          : (newQtyBase * ratio);
        newQtyBase = Math.max(0, newQtyBase - subQtyBase);
      }
    }

    const newState = newSize <= 0 ? "FLAT" : "ACTIVE";

    notionalKrw = useBudget ? (riskBudget.maxKrw * qtyFraction) : notionalKrw;
    if (!Number.isFinite(notionalKrw) || notionalKrw <= 0) {
      const baseQty = Number.isFinite(execQtyBase) && execQtyBase > 0
        ? execQtyBase
        : (!useBudget && Number.isFinite(qtyFraction) && qtyFraction > 0 ? qtyFraction : null);
      if (Number.isFinite(baseQty) && Number.isFinite(fillPrice) && fillPrice > 0) {
        notionalKrw = baseQty * fillPrice;
      }
    }
    const notional = Number.isFinite(notionalKrw) ? notionalKrw : 1.0;
    const feeValue = computeFeeValue({ notional, feeBps });

    const signalPrice = Number(it.signal_price);
    const signalPriceDiff = Number.isFinite(signalPrice) ? (fillPrice - signalPrice) : null;
    const signalPriceDiffPct = (Number.isFinite(signalPrice) && signalPrice !== 0) ? (signalPriceDiff / signalPrice) : null;
    const opening = prevSize <= 0 && newSize > 0;
    const positionSideBefore = normalizePositionSide(
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    );
    const execQtyBaseForPnl = Number.isFinite(execQtyBase) && execQtyBase > 0
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let realizedPnlQuote = null;
    if (intent === "EXIT") {
      const avgBefore = Number(pos.avg_price);
      const sideBefore = positionSideBefore || (String(it.side || "").toUpperCase() === "SELL" ? "LONG" : "SHORT");
      if (Number.isFinite(avgBefore) && Number.isFinite(execQtyBaseForPnl) && execQtyBaseForPnl > 0) {
        const gross = (sideBefore === "SHORT")
          ? ((avgBefore - fillPrice) * execQtyBaseForPnl)
          : ((fillPrice - avgBefore) * execQtyBaseForPnl);
        realizedPnlQuote = gross - (Number.isFinite(feeValue) ? feeValue : 0);
      }
    }
    const closeRatio = intent === "EXIT"
      ? resolveIntentFillCloseRatio({ qtyFraction, prevSize, useBudget })
      : null;
    const appliedLeverage = resolvePositionLeverage({ position: pos, fallback: leverage });
    const appliedLeverageReason = String(
      (posMeta && posMeta.leverage_reason) ||
      (posMeta && posMeta.leverage_source) ||
      ""
    ).trim() || null;
    const exitProfileSnapshot = resolvePositionExitProfile({
      posMeta,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    const appliedExitProfile = exitProfileSnapshot.profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
    const appliedExitProfileReason = exitProfileSnapshot.reason;
    const appliedExitRules = cloneExitRules(exitProfileSnapshot.rules);
    const canonicalExitAlertPayload = intent === "EXIT"
      ? buildCanonicalExitAlertPayload({
        event: it.event,
        position: pos,
        posMeta,
        exitRules: appliedExitRules || null,
        observedQtyRatio: closeRatio ?? qtyFraction,
        fullExit: newState === "FLAT",
      })
      : null;
    const exitContractAlertPayload = intent === "EXIT"
      ? buildExitContractAlertPayload({
        pos,
        posMeta,
        exitRules: appliedExitRules || null,
        observedQtyAbs: execQtyBase,
      })
      : null;
    const intentSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
    const intentSignalDocId = it.signal_doc_id ||
      (it.features_json && it.features_json.signal_doc_id) ||
      deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: it.signal_bar_close_time_utc_ms || it.exec_bar_close_time_utc_ms,
        event: it.event,
        signalId: intentSignalId,
      });
    const entryEventIdFromIntent = buildEntryEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    const entrySignalTypeFromIntent = normalizeEvent(it.event) || null;
    const entryGradeFromIntent = String(
      (it.features_json && (it.features_json.entry_grade || it.features_json.entry_timing_tier || it.features_json.entry_tier)) || ""
    ).toUpperCase() || null;
    const entryQtyProfileFromIntent = String(
      (it.features_json && (it.features_json.entry_qty_profile || it.features_json.entry_qty_tier || it.features_json.qty_profile)) || ""
    ).toUpperCase() || null;
    const intentEntryEventId = String(
      (it.entry_event_id || (it.features_json && it.features_json.entry_event_id) || "")
    ).trim() || null;
    const intentEntrySignalType = String(
      (it.entry_signal_type || (it.features_json && it.features_json.entry_signal_type) || "")
    ).toUpperCase() || null;
    const fillEntryLineage = resolveEntryLineageForFill({
      opening,
      entryEventIdFromIntent,
      entrySignalTypeFromIntent,
      intentEntryEventId,
      intentEntrySignalType,
      posMeta,
    });
    const entryEventIdForFill = fillEntryLineage.entryEventId;
    const entrySignalTypeForFill = fillEntryLineage.entrySignalType;
    const tradeExecMs = (() => {
      const n = Date.parse(String(it.created_at || ""));
      return Number.isFinite(n) ? n : null;
    })();
    const linkedTradeId = buildTradeId({
      exchange,
      symbol,
      event: it.event,
      execBarCloseMs: execBarCloseMs,
      execMs: tradeExecMs,
    });

    const fillWrite = await upsertFill({
      intentId: it.intent_id,
      tradeId: linkedTradeId,
      runId,
      exchange,
      symbol,
      tf,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      side: it.side,
      event: it.event,
      qtyPct: qtyFraction,
      execPrice: fillPrice,
      feeBps,
      slippageBps,
      feeValue,
      notional,
      notionalKrw,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      execPriceSource,
      executionMode,
      liveOrderId,
      execQtyBase,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
      signalPriceDiff,
      signalPriceDiffPct,
      signalPriceSource: it.signal_price_source || null,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      leverageApplied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      decisionReason: it.reason || it.event || null,
      extra: buildInternalFillCanonicalExtra({
        canonicalExitAlertPayload,
        exitContractAlertPayload,
      }),
    });
    if (intent === "EXIT" && fillWrite && fillWrite.fill_id) {
      try {
        await recordInternalCanonicalExitTransitions({
          exchange,
          symbol,
          fillId: fillWrite.fill_id,
          tradeId: linkedTradeId,
          tradeMs: tradeExecMs || execBarCloseMs,
          event: it.event,
          canonicalExitAlertPayload,
          exitContractAlertPayload,
          entryEventId: entryEventIdForFill,
          signalDocId: intentSignalDocId,
        });
      } catch (e) {
        console.warn("[INTERNAL_CANONICAL_EXIT_TRANSITION_FAIL]", e && e.message ? e.message : String(e));
      }
    }
    const canonicalExitAlertBlock = intent === "EXIT"
      ? resolveCanonicalExitAlertBlock(canonicalExitAlertPayload)
      : { blocked: false, reason: null, issueCodes: [] };
    if (
      !shouldSuppressInternalLiveExitFillAlert({ exchange, executionMode, intent }) &&
      canonicalExitAlertBlock.blocked !== true
    ) {
      await dispatchTradeExecutionAlert({
        exchange,
        symbol,
        event: it.event,
        side: it.side,
        intent,
        executionMode,
        notional,
        execQtyBase,
        execPrice: fillPrice,
        closeRatio,
        fullExit: intent === "EXIT" && newState === "FLAT",
        realizedPnl: realizedPnlQuote,
        ...(canonicalExitAlertPayload || {}),
        positionSideBefore,
        positionSideAfter: newState === "FLAT" ? null : positionSideBefore,
        appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
        leverageReason: appliedLeverageReason,
        exitProfile: appliedExitProfile || null,
        exitProfileReason: appliedExitProfileReason || null,
        exitRules: appliedExitRules || null,
        ...(exitContractAlertPayload || {}),
        features: it.features_json || {},
        runId,
        sourceFillId: fillWrite && fillWrite.fill_id ? fillWrite.fill_id : null,
      });
    } else if (intent === "EXIT" && canonicalExitAlertBlock.blocked === true) {
      console.warn(
        `[INTERNAL_CANONICAL_EXIT_ALERT_SUPPRESSED] exchange=${exchange} symbol=${symbol} reason=${canonicalExitAlertBlock.reason || "UNKNOWN"} issue_codes=${(canonicalExitAlertBlock.issueCodes || []).join(",") || "-"}`,
      );
    }

    await markIntentStatus(it.intent_id, "FILLED", {
      filled_at: new Date().toISOString(),
      exec_price: fillPrice,
      status_reason: "FILLED",
    });

    if (useBudget && Number.isFinite(totalUsedKrw) && Number.isFinite(totalMaxKrw)) {
      if (it.side === "BUY") totalUsedKrw += Number(notionalKrw || 0);
      else if (it.side === "SELL") totalUsedKrw = Math.max(0, totalUsedKrw - Number(notionalKrw || 0));
    }

    const ev = String(it.event || "").toUpperCase();
    const closing = newState === "FLAT";
    const openingOrAdd = (intent === "ENTRY" || intent === "ADD") && newState === "ACTIVE";
    const forceLiveReconcile = shouldForceImmediateLiveFuturesReconcile({ exchange, executionMode });
    const applyOptimisticFillProjection = !forceLiveReconcile;
    const metaSide = String(pos.position_side || "LONG").toUpperCase();
    const marketRegimeRow = opening ? readOpenClawMarketRegimeRow(symbol) : null;
    const marketRegimeCohort = normalizeOpenClawCohort(marketRegimeRow && marketRegimeRow.cohort);
    let nextMeta = mergeMeta(posMeta, {
      last_fill_intent: it.intent_id,
      last_fill_side: it.side,
    });

    if (opening || closing) {
      nextMeta = mergeMeta(nextMeta, buildOpenCloseTransitionMetaPatch({
        closing,
        includeEntryRiskReset: true,
      }));
    }
    if (openingOrAdd) {
      const entryExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
        exchange,
        rules: appliedExitRules,
        features: it.features_json,
        sysCfg,
        cohort: marketRegimeCohort,
        market: symbol,
      });
      const exitPolicySrc = entryExitAdjustment.exitPolicySrc;
      const tp1LadderState = entryExitAdjustment.tp1LadderState;
      appliedExitRules = cloneExitRules(entryExitAdjustment.appliedExitRules);
      nextMeta = mergeMeta(nextMeta, {
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT")
          ? `${appliedExitProfileReason || "BASE_PROFILE"}+${exitPolicySrc}`
          : (appliedExitProfileReason || null),
        exit_rules_override: cloneExitRules(appliedExitRules),
        tp1_ladder_enabled: tp1LadderState ? tp1LadderState.enabled !== false : null,
        tp1_ladder_stage: tp1LadderState ? tp1LadderState.stage : null,
        tp1_ladder_profile: tp1LadderState ? tp1LadderState.profile : null,
        tp1_ladder_reason: tp1LadderState ? tp1LadderState.reason : null,
        tp1_ladder_realized_n: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.realized_n : null,
        tp1_ladder_tp0_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_hit_rate : null,
        tp1_ladder_tp1_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp1_hit_rate : null,
        tp1_ladder_tp0_to_tp1_conversion: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_to_tp1_conversion : null,
        tp1_ladder_fee_adjusted_expectancy: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.fee_adjusted_expectancy : null,
        exit_policy_source: exitPolicySrc || null,
        simplified_exit_v2_enabled: resolveSimplifiedExitV2PositionFlag({ currentMeta: nextMeta }),
      });
      const runtimeExitInvariant = await enforceEntryRuntimeExitState({
        exchange,
        symbol,
        appliedExitRules,
        posMeta: nextMeta,
        features: it.features_json,
        cohort: marketRegimeCohort,
        sysCfg,
        entryPrice: fillPrice,
        leverage,
        execBarCloseMs,
      });
      if (runtimeExitInvariant.repaired) {
        appliedExitRules = cloneExitRules(runtimeExitInvariant.appliedExitRules);
        nextMeta = runtimeExitInvariant.meta;
      }
    }
    if (opening) {
      nextMeta = mergeMeta(nextMeta, buildOpeningFillMetaPatch({
        leverageValue: leverage,
        signalTfMs,
        newSize,
        features: it.features_json,
        marketRegimeCohort,
        marketRegimeRow,
        entryEventIdFromIntent,
        entrySignalTypeFromIntent,
        entryGradeFromIntent,
        entryQtyProfileFromIntent,
        signalBarCloseTimeUtcMs: it.signal_bar_close_time_utc_ms,
        execBarCloseMs,
        // Raw material for P0 synthetic entry_event_id fallback — see
        // buildOpeningFillMetaPatch comment.
        exchange,
        symbol,
        metaSide,
        includeLeverageReason: false,
        includeEntryRiskFields: false,
      }));
      nextMeta = mergeMeta(nextMeta, buildStoredExitLedgerMetaPatch({
        position: pos,
        posMeta: nextMeta,
        exitRules: appliedExitRules || null,
        qtyBaseOverride: newQtyBase,
        entryQtyBaseOverride: newQtyBase,
      }));
    }
    let profitableTrailCooldownMeta = null;
    if (closing) {
      nextMeta = mergeMeta(nextMeta, buildClosingFillMetaPatch({
        execBarCloseMs,
        metaSide,
        includeExitProfileRollback: false,
      }));
      profitableTrailCooldownMeta = buildSameDirectionTrailProfitCooldownMetaPatch({
        event: ev,
        realizedPnlQuote,
        positionSide: metaSide,
        exitWallMs: resolveEventRefMs(execBarCloseMs),
        source: "INTENT_FILL",
      });
    }
    if (isTpP0EventLocal(ev) && newState === "ACTIVE") {
      nextMeta = applyTpP0IntentFillMetaUpdate({
        nextMeta,
        fillPrice,
        qtyFraction,
        execBarCloseMs,
        entryEventIdForFill,
        applyOptimisticFillProjection,
      });
    }
    if ((ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_")) && newState === "ACTIVE") {
      const tpP1Update = applyTpP1IntentFillMetaUpdate({
        exchange,
        pos,
        nextMeta,
        metaSide,
        fillPrice,
        execBarCloseMs,
        entryEventIdForFill,
        applyOptimisticFillProjection,
      });
      nextMeta = tpP1Update.meta;
      const { nextTrailHigh, nextTrailLow } = tpP1Update;
      console.warn(
        `[TP1_TRAIL_ARMED] ${symbol} side=${metaSide || "UNKNOWN"} source=INTENT_FILL ` +
        `event=${ev} fill_price=${fillPrice ?? "NA"} trail_high=${nextTrailHigh ?? "NA"} ` +
        `trail_low=${nextTrailLow ?? "NA"} intent_id=${it.intent_id || "NA"}`
      );
      triggerExitWorkerRun({
        reason: `TP1_TRAIL_ARMED_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
        targetSymbols: [String(symbol || "").toUpperCase()],
        targetExchange: String(exchange || "").toUpperCase(),
      }).catch((e) => {
        console.warn("[EXIT_WORKER_SCALE_ON_FAIL][TP1_INTENT_FILL]", e && e.message ? e.message : String(e));
      });
    }

    nextMeta = applyAddAndProtectionMetaOnFill({
      posMeta: nextMeta,
      intent,
      event: it.event,
      barCloseMs: execBarCloseMs,
      realizedPnlQuote,
      opening,
      closing,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      intentId: it.intent_id,
      signalId: intentSignalId,
      avgBefore: pos.avg_price,
      avgAfter: newAvg,
      sizeBefore: prevSize,
      sizeAfter: newSize,
      qtyPct: qtyFraction,
      qtyBase: qtyBaseDelta,
      lossPct: it.features_json && it.features_json._rescue_add_loss_pct,
    });
    nextMeta = mergeMeta(nextMeta, { qty_base: newQtyBase });
    if (newState === "ACTIVE") {
      nextMeta = mergeMeta(nextMeta, buildStoredExitLedgerMetaPatch({
        position: pos,
        posMeta: nextMeta,
        exitRules: appliedExitRules || null,
        qtyBaseOverride: newQtyBase,
      }));
    }

    const projectedMetaForWrite = forceLiveReconcile ? stripExchangeOwnedProjectionMeta(nextMeta) : nextMeta;
    const projectedMetaPatch = forceLiveReconcile
      ? buildMetaPatch(stripExchangeOwnedProjectionMeta(posMeta), projectedMetaForWrite)
      : null;
    if (forceLiveReconcile) {
      await upsertPositionMetaOnlyWithLatestRetry({
        exchange,
        symbol,
        runId,
        executionMode,
        position: pos,
        metaPatch: projectedMetaPatch,
        source: "INTENT_FILL",
        mutationKind: "POSITION_META_UPSERT",
        reason: "INTENT_FILL_FORCE_LIVE_RECONCILE",
      });
    } else {
      await upsertPositionWithLatestRetry({
        exchange,
        symbol,
        position: pos,
        state: newState,
        positionSide: newState === "ACTIVE" ? "LONG" : null,
        sizePct: newSize,
        avgPrice: newAvg,
        qtyBase: newQtyBase,
        runId,
        executionMode,
        budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
        budgetUsedKrw: useBudget ? (riskBudget.maxKrw * newSize) : null,
        budgetSource: useBudget ? riskBudget.source : null,
        meta: projectedMetaForWrite,
        source: "INTENT_FILL",
        reason: "INTENT_FILL_PROJECTED_POSITION_WRITE",
      });
    }
    await maybeWriteV2ShadowEntryBootstrap({
      exchange,
      symbol,
      tf,
      intent,
      opening,
      newState,
      nextPosSide,
      fillPrice,
      newQtyBase,
      execQtyBase,
      intentRow: it,
      fillWrite,
      linkedTradeId,
      liveOrderId,
      entryEventIdForFill,
      execBarCloseMs,
      projectedMetaForWrite,
    });

    if (profitableTrailCooldownMeta) {
      const cooldownObservation = buildSameDirectionTrailProfitObservationPayload(profitableTrailCooldownMeta);
      if (cooldownObservation) {
        try {
          await upsertSameDirectionTrailProfitObservation({
            exchange,
            symbol,
            exitDir: cooldownObservation.exit_dir,
            exitWallMs: cooldownObservation.exit_wall_ms,
            exitEvent: cooldownObservation.exit_event,
            realizedPnl: cooldownObservation.realized_pnl,
            source: cooldownObservation.source || "INTENT_FILL",
          });
          sameDirectionTrailProfitObservation = {
            ...(sameDirectionTrailProfitObservation && typeof sameDirectionTrailProfitObservation === "object" ? sameDirectionTrailProfitObservation : {}),
            same_direction_trail_profit: cooldownObservation,
          };
        } catch (e) {
          console.warn("[SAME_DIRECTION_TRAIL_COOLDOWN_OBS_FAIL]", e && e.message ? e.message : String(e));
        }
      }
    }

    if (forceLiveReconcile) {
      try {
        const sync = await syncFuturesPositionOnly({
          runId: `RUN__INTENT_FILL_RECONCILE__${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${Date.now()}`,
          exchange,
          symbol,
        });
        if (sync && sync.ok && sync.position) {
          pos = sync.position;
          posMeta = (sync.position.meta && typeof sync.position.meta === "object") ? { ...sync.position.meta } : posMeta;
          posQtyBase = resolvePosQtyBase(sync.position);
        }
      } catch (e) {
        console.warn("[INTENT_FILL_RECONCILE_FAIL]", e && e.message ? e.message : String(e));
      }
    }

    if (!forceLiveReconcile) {
      pos = { ...pos, state: newState, size_pct: newSize, avg_price: newAvg, position_side: newState === "ACTIVE" ? "LONG" : null, meta: nextMeta, qty_base: newQtyBase };
      posMeta = nextMeta;
      posQtyBase = newQtyBase;
    }

    await upsertTradeEvent({
      runId,
      exchange,
      symbol,
      tf,
      event: it.event,
      side: it.side,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      execMs: tradeExecMs,
      intentId: it.intent_id,
      fillId: fillWrite && fillWrite.fill_id,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      execPrice: fillPrice,
      qtyPct: qtyFraction,
      feeValue,
      note: `FILLED_INTENT:${it.intent_id}`,
      pnl: null,
      notionalKrw,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      meta: { trading_mode, execution_mode: executionMode },
      executionMode,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      requestId: it.request_id || null,
      decisionReason: it.decision_reason || it.reason || it.event || null,
    });

      fillsExecuted += 1;
    }
  };

  await executeIntentList(sortIntentsForExecution(intents));

  // ✅ fill 이후 포지션 재조회
  pos = await getPositionReadView({ exchange, symbol });
  posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
  posSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  ) || posSide;
  posQtyBase = resolvePosQtyBase(pos) || posQtyBase;
  posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
  posQtyBase = resolvePosQtyBase(pos);

  // 3) (B) signals 생성/수집 → 다음 봉 intent 예약
  const nextExecMs = Number.isFinite(execTfMs) ? addMs(barCloseMs, execTfMs) : addMs(barCloseMs, 60 * 60 * 1000);
  const nextExecUtc = msToUtcZ(nextExecMs);
  const alignedSignalBar = Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs) && (Number(barCloseMs) % signalTfMs === 0);
  const fallbackSignalBarMs = (Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs))
    ? Math.floor(Number(barCloseMs) / signalTfMs) * signalTfMs
    : null;
  const signalBarCloseMs = alignedSignalBar
    ? Number(barCloseMs)
    : (Number.isFinite(fallbackSignalBarMs) ? fallbackSignalBarMs : null);
  const signalBarCloseUtc = Number.isFinite(signalBarCloseMs) ? msToUtcZ(signalBarCloseMs) : null;
  const nativeInitialSignals = Number.isFinite(signalBarCloseMs)
    ? await loadServerNativeInitialSignals({
      exchange,
      symbol,
      signalTf,
      barCloseMs: signalBarCloseMs,
    })
    : [];

  // 내부 신호(현재 NO_SIGNAL)
  const allowInternalExitSignals = canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs });
  const liqSignal = allowInternalExitSignals
    ? buildLiquidationExitSignal({ position: pos, bar, leverage, bufferPct })
    : null;
  const timeStopSignal = (allowInternalExitSignals && exUpper.includes("BINANCE"))
    ? buildTimeStopExitSignal({ position: pos, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars })
    : null;

  // 2026-04-28 F2 Phase 5 hotfix #5 — V2 server-native ENTRY signal
  // generator + direct-batch handoff. Mirror of the runPaperFuturesForBar
  // inject below. This sibling function is dead under BinanceFut today
  // (runPaperMarket dispatches BINANCE* to runPaperFuturesForBar) but
  // we keep the inject in case a non-BinanceFut caller reaches this
  // function in the future.
  try {
    const v2EntryGeneratorEnabled = (function() {
      const raw = String(process.env.DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED || "0").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    })();
    if (v2EntryGeneratorEnabled) {
      const sameTfBars = await queryBars({ exchange, symbol, tf: signalTf, limit: 200 });
      const htfBars = await queryBars({ exchange, symbol, tf: "4h", limit: 70 });
      const cooldownState = await getV2ServerEntryCooldownState({ exchange, symbol, tf: signalTf });
      const v2GenResult = generateV2EntrySignals({
        exchange,
        symbol,
        tf: signalTf,
        bars: Array.isArray(sameTfBars) ? sameTfBars : [],
        htfBars: Array.isArray(htfBars) ? htfBars : [],
        position: pos,
        cooldownState,
        runId,
        barCloseMs: Number(barCloseMs),
      });
      if (v2GenResult && Array.isArray(v2GenResult.signals) && v2GenResult.signals.length > 0) {
        try {
          await setV2ServerEntryCooldownState({
            exchange,
            symbol,
            tf: signalTf,
            state: v2GenResult.cooldownStateNext,
          });
        } catch (cdErr) {
          console.warn("[V2_SERVER_ENTRY_COOLDOWN_PERSIST_FAIL]", cdErr?.message || cdErr);
        }
      }
      try {
        console.log(JSON.stringify({
          event: "v2_server_entry_signal_generator_run",
          ts: new Date().toISOString(),
          exchange,
          symbol,
          tf: signalTf,
          run_id: runId,
          skipped: v2GenResult ? v2GenResult.skipped === true : true,
          skip_reason: v2GenResult ? v2GenResult.skipReason : "GENERATOR_NULL",
          signals_n: v2GenResult && Array.isArray(v2GenResult.signals) ? v2GenResult.signals.length : 0,
          diagnostics: v2GenResult && v2GenResult.diagnostics
            ? {
              market_state: v2GenResult.diagnostics.market_state,
              htf_bias: v2GenResult.diagnostics.htf_bias,
              long_opportunity: v2GenResult.diagnostics.long_opportunity,
              short_opportunity: v2GenResult.diagnostics.short_opportunity,
              trigger_type_long: v2GenResult.diagnostics.trigger_type_long,
              trigger_type_short: v2GenResult.diagnostics.trigger_type_short,
              long_can_fire: v2GenResult.diagnostics.long_can_fire,
              short_can_fire: v2GenResult.diagnostics.short_can_fire,
            }
            : null,
        }));
      } catch (_) { /* observability only */ }

      const v2GenSignals = v2GenResult && Array.isArray(v2GenResult.signals) ? v2GenResult.signals : [];
      for (const sig of v2GenSignals) {
        try {
          const sigBarMs = Number(sig.bar_close_time_utc_ms);
          const sigBarUtc = Number.isFinite(sigBarMs) ? msToUtcZ(sigBarMs) : null;
          const features = { ...(sig.features || {}) };
          if (sig.bar_close_time_utc_ms != null) features.bar_close_time_utc_ms = sig.bar_close_time_utc_ms;
          if (sig.price != null) features.signal_price = sig.price;
          features.v2_server_native_signal_bypass = true;
          features.v2_discovery_signal_fan_in_handoff = true;
          features.v2_discovery_entry_filter_authority = "PRODUCTION_ENTRY_ROUTE";

          const v2SignalId = `SIG__V2_SERVER__${exchange}__${symbol}__${signalTf}__${sigBarMs || Date.now()}__${sig.event}__${sig.entry_grade}`;
          const handoffSignal = {
            signal_id: v2SignalId,
            signal_doc_id: null,
            event: sig.event,
            side: sig.side,
            qty_pct: Number(sig.qtyPct ?? sig.qty_pct ?? 1.0),
            reason: "V2_SERVER_NATIVE_GENERATOR",
            signal_bar_close_time_utc_ms: Number.isFinite(sigBarMs) ? sigBarMs : null,
            signal_bar_close_time_utc: sigBarUtc,
            signal_price: Number.isFinite(Number(sig.price)) ? Number(sig.price) : null,
            features,
          };

          const handoffIntentRow = buildV2DiscoverySignalFanInIntentRow({
            exchange,
            symbol,
            tf: signalTf,
            signal: handoffSignal,
            features,
            qtyFraction: Number(sig.qtyPct ?? sig.qty_pct ?? 1.0),
            intentExecutionMode: "PAPER",
            signalBarCloseUtcForIntent: sigBarUtc,
            signalBarCloseMsForIntent: Number.isFinite(sigBarMs) ? sigBarMs : null,
            intentSignalBarCloseUtc: sigBarUtc,
            intentSignalBarCloseMs: Number.isFinite(sigBarMs) ? sigBarMs : null,
            execBarCloseUtcForIntent: sigBarUtc,
            execBarCloseMsForIntent: Number.isFinite(sigBarMs) ? sigBarMs : null,
            signalDocId: null,
            signalPrice: Number.isFinite(Number(sig.price)) ? Number(sig.price) : null,
            runId,
          });

          const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
            env: process.env,
            intentRow: handoffIntentRow,
            liveCfg,
            referencePrice: Number.isFinite(Number(sig.price)) ? Number(sig.price)
              : Number(bar && (bar.close ?? bar.c)),
            requestId: handoffIntentRow.request_id,
          }).catch((error) => ({
            ok: false,
            reason: "V2_DISCOVERY_BRIDGE_THROWN",
            error_message: error && error.message ? String(error.message) : String(error),
          }));

          try {
            // Drill into nested block reasons so we can pinpoint where
            // the handoff was blocked when handoff.ok=false. Common
            // chain when the Server-Native ML/AI verdict is missing or
            // budget gate fails:
            //   handoff.reason = V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED
            //   handoff.endpoint_result.reason = ...
            //   built.reason / routedDecision.reason / sizingDecision
            const routedDecisionReason = handoff && handoff.routedDecision && handoff.routedDecision.reason
              ? String(handoff.routedDecision.reason) : null;
            const builtReason = handoff && handoff.request && handoff.request.routedDecision
              && handoff.request.routedDecision.reason
              ? String(handoff.request.routedDecision.reason) : null;
            const endpointResultReason = handoff && handoff.endpoint_result && handoff.endpoint_result.reason
              ? String(handoff.endpoint_result.reason) : null;
            const sizingNotApprovedReason = handoff && handoff.entrySizingDecision
              && handoff.entrySizingDecision.reason
              ? String(handoff.entrySizingDecision.reason) : null;
            const ledgerPersistenceReason = handoff && handoff.ledger_persistence
              && handoff.ledger_persistence.reason
              ? String(handoff.ledger_persistence.reason) : null;
            console.log(JSON.stringify({
              event: "v2_server_entry_signal_handoff_dispatched",
              ts: new Date().toISOString(),
              exchange,
              symbol,
              tf: signalTf,
              run_id: runId,
              signal_id: v2SignalId,
              direction: sig.event,
              entry_grade: sig.entry_grade,
              handoff_ok: handoff && handoff.ok === true,
              handoff_reason: handoff && handoff.reason ? String(handoff.reason) : null,
              handoff_error: handoff && handoff.error_message ? String(handoff.error_message) : null,
              routed_decision_reason: routedDecisionReason || builtReason,
              endpoint_result_reason: endpointResultReason,
              sizing_not_approved_reason: sizingNotApprovedReason,
              ledger_persistence_reason: ledgerPersistenceReason,
              handoff_keys: handoff ? Object.keys(handoff) : null,
            }));
          } catch (_) { /* observability only */ }
        } catch (handoffErr) {
          console.warn("[V2_SERVER_ENTRY_SIGNAL_HANDOFF_FAIL]", handoffErr?.message || handoffErr);
        }
      }
    }
  } catch (v2GenErr) {
    console.warn("[V2_SERVER_ENTRY_SIGNAL_GENERATOR_FAIL]", v2GenErr?.message || v2GenErr);
  }

  const internalSignalsRaw = [
    ...nativeInitialSignals,
    ...generateSignals({
      exchange,
      symbol,
      tf,
      bar,
      gate,
      position: pos,
      trading_mode,
      leverage,
      exitProfileMode: liveCfg && liveCfg.exitProfileMode,
      currentBarCloseMs: Number(barCloseMs),
    }),
    ...(liqSignal ? [liqSignal] : []),
    ...(timeStopSignal ? [timeStopSignal] : []),
  ];
  const internalSignals = filterLiveFuturesInternalSignals({
    exchange,
    liveCfg,
    signals: finalizeInternalSignals({
      signals: internalSignalsRaw,
      posMeta,
      barCloseMs,
      fallbackUtc: signalBarCloseUtc,
      exchange,
      symbol,
    }),
    runId,
    symbol,
    tf,
  });

  // 외부 신호(signals 컬렉션)
  const externalSignalsRaw = Number.isFinite(signalBarCloseMs)
    ? await getSignalsForBar({
      exchange,
      symbol,
      tf: signalTf,
      barCloseMs: signalBarCloseMs,
      limitN: 200,
      maxLookbackBars: signalQueueEnabled ? signalQueueMaxLateBars : undefined,
      caller: "paperBinanceRunner:runPaperBinanceForBar",
    })
    : [];

  const ttlMs = Number.isFinite(execProfile.intentTtlMs) ? execProfile.intentTtlMs
    : (Number.isFinite(execProfile.intentTtlBars) && Number.isFinite(execTfMs) ? (execTfMs * execProfile.intentTtlBars) : null);
  let lateSignals = 0;

  const externalSignals = externalSignalsRaw.map((s) => {
    const signalBarMs = Number(s.bar_close_time_utc_ms);
    const signalDocId = String(s.signal_doc_id || (String(s.signal_id || "").startsWith("SIG__") ? s.signal_id : "") || "").trim() || null;
    let lateByBars = 0;
    if (Number.isFinite(signalTfMs) && Number.isFinite(signalBarMs)) {
      const delta = barCloseMs - signalBarMs;
      if (delta >= signalTfMs / 2) lateByBars = Math.max(0, Math.round(delta / signalTfMs));
    }
    const features = { ...(s.features_json || {}) };
    if (signalDocId && !features.signal_doc_id) features.signal_doc_id = signalDocId;
    if (s.signal_id && !features.signal_id) features.signal_id = s.signal_id;
    if (Number.isFinite(Number(s.price)) && !Number.isFinite(Number(features.signal_price))) features.signal_price = Number(s.price);
    if (lateByBars > 0) {
      lateSignals += 1;
      features._late_by_bars = lateByBars;
      features._late_by_ms = Number(barCloseMs) - Number(signalBarMs);
      features._late_origin_bar_close_time_utc_ms = Number(signalBarMs);
    }

    return {
      signal_id: s.signal_id,
      signal_doc_id: signalDocId,
      event: s.event,
      side: s.side,
      qty_pct: s.qty_pct,
      reason: s.reason || "TV_WEBHOOK",
      signal_bar_close_time_utc_ms: Number.isFinite(signalBarMs) ? signalBarMs : null,
      signal_bar_close_time_utc: s.bar_close_time_utc || null,
      signal_price: Number.isFinite(Number(s.price)) ? Number(s.price) : null,
      features,
    };
  });

  const signals = dedupeEntrySignalsByFamily([...internalSignals, ...externalSignals], {
    exchange,
    symbol,
    tf: signalTf,
    runId,
    stage: "BAR_SIGNAL_FANIN",
  });
  const signalDrops = [];
  let recordedSignalDrops = [];
  const metaUpdates = pendingMetaPatch ? { ...pendingMetaPatch } : {};
  const posSideNow = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (posMeta && (posMeta.position_side || posMeta.external_side || posMeta.external_position_side))
  );
  const intentExecutionMode = (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")
    ? liveCfg.executionMode
    : "PAPER";

  let intentsCreated = 0;
  let immediateIntentsCreated = 0;
  for (const s of signals) {
    s.features = buildSignalStageFeatures(s, null);
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    if (intentIsEntry) {
      s.features = applyCanonicalSourceProvenanceDefaults({
        intent,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        eventUpper: String(s.event || "").trim().toUpperCase(),
        intentDir: directionFromSignal({ event: s.event, side: s.side }),
        tf: signalTf,
      });
    }
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(s.features);
    let preQtyScale = 1;
    const effectiveBarMs = Number(s && s.features && s.features._late_origin_bar_close_time_utc_ms) || Number(barCloseMs);
    const signalBarMsRaw = s && s.signal_bar_close_time_utc_ms;
    const signalBarMsParsed = (signalBarMsRaw === null || signalBarMsRaw === undefined) ? null : Number(signalBarMsRaw);
    const signalBarCloseMsForIntent = Number.isFinite(signalBarMsParsed) ? signalBarMsParsed : effectiveBarMs;
    const signalBarCloseUtcForIntent = Number.isFinite(signalBarCloseMsForIntent)
      ? msToUtcZ(signalBarCloseMsForIntent)
      : (s.signal_bar_close_time_utc || barCloseUtc);
    const v2DiscoveryLegacyEntryFilterBypass = shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent });
    if (v2DiscoveryLegacyEntryFilterBypass) {
      s.features = {
        ...(s.features || {}),
        v2_discovery_legacy_entry_filters_bypassed: true,
        v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
      };
    }
    if (backfillExitOnly && intentIsEntry && backfillAllowEntry !== true) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // EXIT_ONLY pass should not consume live entry signals.
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "BACKFILL_SKIP_ENTRY",
        drop_reason_code: "BACKFILL_SKIP_ENTRY",
        features_json: { ...(s.features || {}), backfill_exit_only: true },
        event_intent: intent,
      });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) continue;

    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });
    let qtyFraction = useBudget ? normalizeQtyFraction(s.qty_pct) : Number(s.qty_pct);
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") continue;
      qtyFraction = 1;
    }
    const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
    if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
    const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
    const actionTag = normalizeActionValue(s.features && s.features.action);
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: s.event, features: s.features, posMeta });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_TRAIL_ACTIVE_NO_ADD",
        drop_reason_code: "DROP_TRAIL_ACTIVE_NO_ADD",
        features_json: { ...(s.features || {}), trail_active: posMeta.trail_active ?? null, tp_p1_done: posMeta.tp_p1_done ?? null },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !actionAllowsEntry(actionTag)) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_ACTION_FILTER",
        drop_reason_code: "DROP_ACTION_FILTER",
        features_json: { ...(s.features || {}), action: actionTag },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: Number(barCloseMs),
        qty_pct: qtyFraction,
        reason: "DROP_TRADEABLE_SIGNAL_TYPES",
        drop_reason_code: "DROP_TRADEABLE_SIGNAL_TYPES",
        features_json: { ...(s.features || {}), allowlist: tradeableSignalTypes },
        event_intent: intent,
      });
      continue;
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: s.features, intentDir, posMeta });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && oppositeCooldownBars > 0 && !hasPositionSize(pos.size_pct) && !bypassOppositeEntryCooldown) {
      const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
        const barsSinceExit = Math.floor((effectiveBarMs - lastExitMs) / signalTfMs);
        if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
          if (intentDir && lastExitDir && intentDir !== lastExitDir) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: qtyFraction,
              reason: "DROP_OPPOSITE_COOLDOWN",
              drop_reason_code: "DROP_OPPOSITE_COOLDOWN",
              features_json: {
                ...(s.features || {}),
                last_exit_bar_ms: lastExitMs,
                last_exit_dir: lastExitDir,
                bars_since_exit: barsSinceExit,
                cooldown_bars: oppositeCooldownBars,
              },
              event_intent: intent,
            });
            continue;
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && oppositeTimeCooldownMs > 0 && !hasPositionSize(pos.size_pct) && !bypassOppositeEntryCooldown) {
      const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
        const elapsedMs = resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms) - lastExitWallMs;
        if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
          console.log(`[OPPOSITE_TIME_COOLDOWN] DROP signal ${exchange} ${symbol} ${s.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: qtyFraction,
            reason: "DROP_OPPOSITE_TIME_COOLDOWN",
            drop_reason_code: "DROP_OPPOSITE_TIME_COOLDOWN",
            features_json: {
              ...(s.features || {}),
              last_exit_wall_ms: lastExitWallMs,
              last_exit_dir: lastExitDir,
              elapsed_sec: Math.floor(elapsedMs / 1000),
              cooldown_sec: Math.floor(oppositeTimeCooldownMs / 1000),
            },
            event_intent: intent,
          });
          continue;
        }
      }
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && sameDirectionTrailProfitCooldownCfg.enabled && !hasPositionSize(pos.size_pct)) {
      const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
        cfg: sameDirectionTrailProfitCooldownCfg,
        posMeta: resolveSameDirectionTrailProfitCooldownSnapshot({
          posMeta,
          observation: sameDirectionTrailProfitObservation,
          observationOnly: true,
        }),
        intentDir,
        eventRefMs: resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms),
      });
      if (sameDirectionCooldown) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          drop_reason_code: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          features_json: {
            ...(s.features || {}),
            same_direction_trail_profit_exit_dir: sameDirectionCooldown.exit_dir,
            same_direction_trail_profit_exit_wall_ms: sameDirectionCooldown.exit_wall_ms,
            same_direction_trail_profit_exit_event: sameDirectionCooldown.exit_event,
            same_direction_trail_profit_exit_realized_pnl: sameDirectionCooldown.realized_pnl,
            elapsed_sec: Math.floor(sameDirectionCooldown.elapsed_ms / 1000),
            cooldown_sec: Math.floor(sameDirectionCooldown.cooldown_ms / 1000),
          },
          event_intent: intent,
        });
        continue;
      }
    }
    const lateByBars = Number(s && s.features && s.features._late_by_bars);
    const signalDocId = resolveSignalDocIdForIntent({
      exchange,
      symbol,
      tf,
      barCloseMs: signalBarCloseMsForIntent,
      event: s.event,
      signalId: s.signal_id || (s.features && s.features.signal_id),
      features: s.features,
    });
    if (signalDocId) s.signal_doc_id = signalDocId;
    if (signalQueueEnabled && Number.isFinite(lateByBars) && lateByBars > signalQueueMaxLateBars) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_STALE_SIGNAL",
        drop_reason_code: "DROP_STALE_SIGNAL",
        features_json: { ...(s.features || {}), late_by_bars: lateByBars, max_late_bars: signalQueueMaxLateBars },
        event_intent: intent,
      });
      continue;
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && spikeLock && spikeLock.active && (intent === "ENTRY" || intent === "ADD")) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_SPIKE_LOCK",
        drop_reason_code: "DROP_SPIKE_LOCK",
        features_json: { ...(s.features || {}), spike_lock_until_ms: spikeLock.untilMs ?? null, spike_lock_tf: spikeLock.tf || null, spike_lock_move_pct: spikeLock.movePct ?? null },
        event_intent: intent,
      });
      continue;
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && signalOverlapEnabled && (intent === "ENTRY" || intent === "ADD") && intentDir && Number.isFinite(signalTfMs) && signalOverlapBars > 0) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      const lastBarMs = Number(posMeta && posMeta[lastKey]);
      const currentTier = resolveSignalTierFromEvent(s.event, s.features);
      const lastTierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
      const lastTier = Number(posMeta && posMeta[lastTierKey]);
      const isCoreRealOrEarlyEvent = String(s.event || "").toUpperCase().startsWith("CORE_")
        || String(s.event || "").toUpperCase().startsWith("REAL_")
        || isPreRealOrEarlyEventName(s.event, s.features);
      const allowOverlapUpgrade = (Number.isFinite(currentTier) && Number.isFinite(lastTier) && currentTier > lastTier)
        || isCoreRealOrEarlyEvent;
      if (shouldBlockSignalOverlap({ pos, lastBarMs, effectiveBarMs, signalTfMs, signalOverlapBars, allowOverlapUpgrade })) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_OVERLAP",
          drop_reason_code: "DROP_OVERLAP",
          features_json: { ...(s.features || {}), overlap_bars: signalOverlapBars, last_entry_bar_ms: lastBarMs },
          event_intent: intent,
        });
        continue;
      }
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && autoScore && autoScore.enabled && Number.isFinite(autoScore.scoreMin) && (intent === "ENTRY" || intent === "ADD")) {
      const score = pickSignalScore(s.features);
      if (Number.isFinite(score) && score < autoScore.scoreMin) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_LOW_SCORE",
          drop_reason_code: "DROP_LOW_SCORE",
          features_json: { ...(s.features || {}), score, score_min: autoScore.scoreMin, score_base: autoScore.base ?? null, score_target_wr: autoScore.target ?? null, score_win_rate: autoScore.winRate ?? null },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && shortGateCfg && shortGateCfg.enabled) {
      const shortGate = evaluateShortEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: shortGateCfg,
      });
      if (!shortGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: shortGate.reason || "DROP_SHORT_GATE",
          drop_reason_code: shortGate.reason || "DROP_SHORT_GATE",
          features_json: { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      if (shortGate.detail && shortGate.detail.gate_transition_exception) {
        s.features = { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true };
      }
    }

    const features = (s.features && typeof s.features === "object") ? { ...s.features } : {};
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !manualRetryIntent) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          drop_reason_code: canonical.reason || "DROP_CANONICAL_ENGINE",
          features_json: { ...(s.features || {}), ...(canonical.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
      if (canonical.detail) {
        s.features = mergeCanonicalDecisionDetail(s.features, canonical.detail);
        Object.assign(features, canonical.detail || {});
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: quality.reason || "DROP_ENTRY_QUALITY",
          drop_reason_code: quality.reason || "DROP_ENTRY_QUALITY",
          features_json: { ...(s.features || {}), ...(quality.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
    }

    // Commission Gate v2 soft mode + MDD reduction gate — signal processing
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      try {
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "signal_proc", exchange, symbol, event: s.event, perfGate, intentId: s.signal_id || s.id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          const before = qtyFraction;
          qtyFraction = qtyFraction * commScale.scale;
          if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: before,
              reason: "DROP_COMMISSION_GATE_ZERO_QTY",
              drop_reason_code: "DROP_COMMISSION_GATE_ZERO_QTY",
              features_json: { ...(s.features || {}), gate_id: gateEvidence.gateId, commission_ratio: perfGate.commissionRatio, commission_threshold: COMMISSION_RATIO_THRESHOLD, commission_scale: commScale.scale, total_fee: perfGate.totalFee, total_pnl: perfGate.totalPnl },
              event_intent: intent,
            });
            continue;
          }
          s.features = {
            ...(s.features || {}),
            gate_id: gateEvidence.gateId,
            commission_ratio: perfGate.commissionRatio,
            commission_threshold: COMMISSION_RATIO_THRESHOLD,
            commission_scale: commScale.scale,
            commission_scaled_in_signal: true,
            total_fee: perfGate.totalFee,
            total_pnl: perfGate.totalPnl,
          };
          console.warn(`[COMMISSION_GATE][SOFT_REDUCE] signal ${exchange} ${symbol} ${s.event} | qty ${before.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          const before = qtyFraction;
          qtyFraction = qtyFraction * perfGate.mddReduceFactor;
          s.features = {
            ...(s.features || {}),
            mdd: perfGate.mdd,
            mdd_threshold: MDD_THRESHOLD,
            mdd_reduce_factor: perfGate.mddReduceFactor,
            mdd_scaled_in_signal: true,
          };
          console.log(`[MDD_REDUCE] ${exchange} ${symbol} ${s.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% < ${(MDD_THRESHOLD * 100).toFixed(0)}% | qty ${before.toFixed(4)} → ${qtyFraction.toFixed(4)} (x${perfGate.mddReduceFactor})`);
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "signal_proc", exchange, symbol, event: s.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          signalDrops.push({
            ...s, bar_close_time_utc_ms: effectiveBarMs, qty_pct: qtyFraction,
            reason: "DROP_COMMISSION_GATE_ERROR", drop_reason_code: "DROP_COMMISSION_GATE_ERROR",
            features_json: { ...(s.features || {}), gate_error: gateErr.message },
            event_intent: intent,
          });
          continue;
        }
      }
    }

    let immediateEntry = false;
    let immediateReason = null;
    let coreProbePatch = null;
    let coreProbeClear = null;
    if (signalDocId && !features.signal_doc_id) {
      features.signal_doc_id = signalDocId;
    }
    const isTpP1Event = eventUpper === "EXIT_TP_P1" || eventUpper.startsWith("EXIT_TP_P1_");
    if (isTpP1Event && posMeta && posMeta.tp_p1_done === true) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TP_P1_ALREADY_DONE",
        drop_reason_code: "DROP_TP_P1_ALREADY_DONE",
        features_json: { ...(s.features || {}), tp_p1_done: true },
        event_intent: intent,
      });
      continue;
    }
    if (isTpP1Event && posMeta && posMeta.tp_p1_pending === true) {
      const pendingRefMs = Date.now();
      const pendingState = await getTpP1PendingState({
        exchange,
        symbol,
        tf: signalTf,
        posMeta,
        tpP1PendingHoldMs,
        nowMs: pendingRefMs,
      });
      if (pendingState.active) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_TP_P1_PENDING",
          drop_reason_code: "DROP_TP_P1_PENDING",
          features_json: {
            ...(s.features || {}),
            tp_p1_pending: true,
            tp_p1_pending_at_ms: pendingState.pendingAtMs,
            tp_p1_pending_until_ms: pendingState.pendingUntilMs,
            tp_p1_pending_active_by_intent: pendingState.activeByIntent,
          },
          event_intent: intent,
        });
        continue;
      }
      metaUpdates.tp_p1_pending = false;
      metaUpdates.tp_p1_pending_at_ms = null;
      metaUpdates.tp_p1_pending_until_ms = null;
      metaUpdates.tp_p1_pending_event = null;
    }
    const signalTimingTier = resolveSignalTier(eventUpper, s.features);
    const isRealEvent = signalTimingTier === "REAL";
    const isPreRealEvent = signalTimingTier === "PRE_REAL";
    const isCoreEvent = signalTimingTier === "CORE";
    const isEarlyEvent = signalTimingTier === "EARLY";
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && isAiRequired(exchange) && !hasAiSignal(s.features)) {
      const aiMissing = resolveAiMissingPolicy({ qtyFraction, features: s.features, sysCfg });
      if (aiMissing.drop) {
        const reason = aiMissing.reason || "DROP_AI_MISSING";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: aiMissing.features,
          event_intent: intent,
        });
        continue;
      }
      const prevQty = qtyFraction;
      qtyFraction = Number(aiMissing.qtyFraction);
      s.features = aiMissing.features;
      if (Number.isFinite(prevQty) && Number.isFinite(qtyFraction) && qtyFraction < prevQty) {
        console.warn(
          `[AI_MISSING][REDUCE] ${exchange} ${symbol} ${s.event} | qty ${prevQty.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${Number(aiMissing.features && aiMissing.features.ai_missing_reduce_pct || AI_MISSING_REDUCE_PCT).toFixed(4)}`
        );
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && aiBiasGateCfg && aiBiasGateCfg.enabled) {
      const aiBiasGate = evaluateAiBiasEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: aiBiasGateCfg,
        riskBudget,
      });
      if (aiBiasGate.detail) {
        s.features = { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true };
        Object.assign(features, aiBiasGate.detail || {});
      }
      if (!aiBiasGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          drop_reason_code: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          features_json: { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const aiBiasScale = Number(aiBiasGate.qtyScale);
      if (Number.isFinite(aiBiasScale) && aiBiasScale > 0 && aiBiasScale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * aiBiasScale;
        s.features = {
          ...(s.features || {}),
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        };
        Object.assign(features, {
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        });
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      const signalFloor = await applyEntryBudgetSignalFloor({
        exchange,
        symbol,
        intent,
        qtyFraction,
        maxQtyPct: Math.max(0, 1 - Number(pos && pos.size_pct || 0)),
        features: s.features,
        nowMs: Number(effectiveBarMs),
        stage: "RUNNER_SIGNAL",
      });
      if (signalFloor.featuresPatch && typeof signalFloor.featuresPatch === "object") {
        s.features = signalFloor.featuresPatch;
        Object.assign(features, signalFloor.featuresPatch);
      }
      if (Number.isFinite(Number(signalFloor.qtyPct)) && Number(signalFloor.qtyPct) > 0) {
        qtyFraction = Number(signalFloor.qtyPct);
      }
      const openclawEval = await applyOpenClawExecutorDecision({
        exchange,
        symbol,
        intent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        requestedQtyPct: signalFloor.requestedQtyPct,
        features: s.features,
        stage: "RUNNER_SIGNAL",
        applyScale: true,
        nowMs: Number(effectiveBarMs),
        signalTf,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        requestId: s.request_id || null,
        runId,
        signalId: s.signal_id || (s.features && s.features.signal_id) || null,
      });
      if (openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object") {
        s.features = openclawEval.featuresPatch;
        Object.assign(features, openclawEval.featuresPatch);
      }
      if (!openclawEval.ok || !Number.isFinite(Number(openclawEval.qtyPctFinal)) || Number(openclawEval.qtyPctFinal) <= 0) {
        const reason = String(openclawEval.reason || "DROP_OPENCLAW_EXECUTOR").trim().toUpperCase() || "DROP_OPENCLAW_EXECUTOR";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: { ...(s.features || {}) },
          event_intent: intent,
        });
        continue;
      }
      qtyFraction = Number(openclawEval.qtyPctFinal);
    }

    const evGateBypass = shouldBypassEvEntryGate({ intent, features: s.features });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && evGateCfg && evGateCfg.enabled && evGateBypass) {
      const evGateDetail = {
        ev_gate_enabled: true,
        ev_gate_skipped: true,
        ev_gate_skip_reason: "MANUAL_RETRY_OVERRIDE",
        ev_gate_action: "SKIP",
        ev_gate_qty_scale: 1,
      };
      s.features = { ...(s.features || {}), ...evGateDetail };
      Object.assign(features, evGateDetail);
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && evGateCfg && evGateCfg.enabled && !evGateBypass) {
      let evExitProfile = null;
      try {
        evExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: s.event,
          side: s.side,
          features: s.features,
          nowMs: Number(effectiveBarMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
      } catch (evExitProfileErr) {
        const evGateDetail = {
          ev_gate_enabled: true,
          ev_gate_exit_profile_resolve_failed: true,
          ev_gate_exit_profile_error: evExitProfileErr && evExitProfileErr.message
            ? String(evExitProfileErr.message)
            : String(evExitProfileErr),
        };
        s.features = { ...(s.features || {}), ...evGateDetail };
        Object.assign(features, evGateDetail);
      }
      const evGateBaseQty = qtyFraction;
      const evExitRulesAdjustment = applyEntryExitRuleRuntimeAdjustments({
        exchange,
        rules: evExitProfile && evExitProfile.rules,
        features: s.features,
        sysCfg,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        market: symbol,
      });
      const evGate = await evaluateEvEntryGate({
        exchange,
        symbol,
        tf: signalTf,
        barCloseMs: effectiveBarMs,
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: evGateCfg,
        exitRules: evExitRulesAdjustment.appliedExitRules,
        exitProfile: evExitProfile && evExitProfile.profile,
        exitProfileReason: evExitProfile && evExitProfile.reason,
      });
      if (evGate.detail) {
        s.features = { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true };
        Object.assign(features, evGate.detail || {});
      }
      if (!evGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: evGate.reason || "DROP_EV_GATE",
          drop_reason_code: evGate.reason || "DROP_EV_GATE",
          features_json: { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const evScale = Number(evGate.qtyScale);
      if (Number.isFinite(evScale) && evScale > 0 && evScale < 0.9999) {
        const evQtyScaleResult = applyEvQtyScale({
          qtyFraction,
          evScale,
          intent,
          event: s.event,
          features: s.features,
        });
        qtyFraction = evQtyScaleResult.qtyFraction;
        s.features = {
          ...(s.features || {}),
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        };
        Object.assign(features, {
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        });
      }
      s.features = {
        ...(s.features || {}),
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      };
      Object.assign(features, {
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      });
    }

    if (intentIsEntry && waitOneBarCfg && waitOneBarCfg.enabled) {
      const waitOneBar = evaluateWaitOneBarTiming({
        intent,
        intentDir,
        eventUpper,
        cfg: waitOneBarCfg,
        features: s.features,
      });
      if (waitOneBar.detail) {
        s.features = { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true };
        Object.assign(features, waitOneBar.detail || {});
      }
      const waitOneBarV2DiscoveryAdvisoryOnly = shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent });
      if (!waitOneBar.ok && waitOneBarV2DiscoveryAdvisoryOnly) {
        const advisoryDetail = {
          wait_one_bar_v2_discovery_advisory_only: true,
          wait_one_bar_legacy_hard_drop_bypassed: true,
          wait_one_bar_legacy_reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          wait_one_bar_legacy_action: waitOneBar.action || null,
        };
        s.features = { ...(s.features || {}), ...advisoryDetail };
        Object.assign(features, advisoryDetail);
      } else if (!waitOneBar.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          drop_reason_code: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          features_json: { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && immediateCfg.enabled && (isRealEvent || isPreRealEvent || isCoreEvent || isEarlyEvent)) {
      const { coreBuy, realBuy, coreSell, realSell } = resolveScoreLevels({ exchange, features });
      const score = pickSignalScoreExtended(features);
      const confidence = pickSignalConfidence(features);
      const waveConf = pickSignalWaveConf(features);
      const conflict = pickSignalConflict(features);
      const regime = pickSignalRegime(features);
      const volRank = pickSignalVolRank(features);
      const volStrong = volRank === "ultra" || volRank === "strong";
      const dir = intentDir;

      if (isCoreEvent && dir) {
        const probe = getCoreProbeMeta(posMeta, dir);
        if (probe && Number.isFinite(probe.remaining) && probe.remaining > 0) {
          const expired = Number.isFinite(probe.expiresMs) && Number.isFinite(effectiveBarMs) && effectiveBarMs > probe.expiresMs;
          if (expired) {
            coreProbeClear = probe;
          } else if (Number.isFinite(signalTfMs) && Number.isFinite(probe.barMs) && Number.isFinite(effectiveBarMs)) {
            const barsSince = Math.round((effectiveBarMs - probe.barMs) / signalTfMs);
            if (barsSince >= 0 && barsSince <= 1) {
              qtyFraction = Math.min(qtyFraction, probe.remaining);
              coreProbeClear = probe;
              features._core_probe_confirm = true;
              immediateReason = "CORE_CONFIRM_NEXT_BAR";
            }
          }
        }
      }

      if (!immediateReason && isRealEvent && immediateCfg.realEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (realBuy + immediateCfg.realScoreMargin) : score <= (realSell - immediateCfg.realScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minWaveConf : false;
        const regimeOk = regime ? regime === "trend" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && volStrong && conflictOk) {
          immediateEntry = true;
          immediateReason = "REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateReason && isPreRealEvent && immediateCfg.preRealEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY"
            ? score >= (coreBuy + immediateCfg.preRealScoreMargin)
            : score <= (coreSell - immediateCfg.preRealScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minPreRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minPreRealWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "PRE_REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateEntry && !immediateReason && isCoreEvent && immediateCfg.coreEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (coreBuy + immediateCfg.coreScoreMargin) : score <= (coreSell - immediateCfg.coreScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minCoreConf : false;
        const regimeOk = regime ? regime !== "range" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && regimeOk && volStrong && conflictOk) {
          const fraction = immediateCfg.coreFraction;
          const immediateQty = qtyFraction * fraction;
          const remainingQty = qtyFraction - immediateQty;
          if (Number.isFinite(immediateQty) && immediateQty > 0 && Number.isFinite(remainingQty) && remainingQty > 0) {
            qtyFraction = immediateQty;
            immediateEntry = true;
            immediateReason = "CORE_IMMEDIATE_PROBE";
            coreProbePatch = {
              remaining: remainingQty,
              barMs: Number.isFinite(effectiveBarMs) ? effectiveBarMs : null,
              expiresMs: Number.isFinite(signalTfMs) && Number.isFinite(effectiveBarMs)
                ? (effectiveBarMs + signalTfMs)
                : null,
            };
            features._core_probe_fraction = fraction;
            features._entry_exec_timing = "IMMEDIATE";
          }
        }
      }

      if (!immediateEntry && !immediateReason && isEarlyEvent && immediateCfg.earlyEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= immediateCfg.earlyScoreAbs : score <= -immediateCfg.earlyScoreAbs)
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minEarlyConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minEarlyWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "EARLY_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }
    }

    if (coreProbeClear && coreProbeClear.base) {
      metaUpdates[`${coreProbeClear.base}_remaining_pct`] = 0;
      metaUpdates[`${coreProbeClear.base}_bar_ms`] = null;
      metaUpdates[`${coreProbeClear.base}_expires_ms`] = null;
    }

    if (coreProbePatch && intentDir) {
      const base = `core_probe_${String(intentDir).toLowerCase()}`;
      metaUpdates[`${base}_remaining_pct`] = coreProbePatch.remaining;
      metaUpdates[`${base}_bar_ms`] = coreProbePatch.barMs;
      metaUpdates[`${base}_expires_ms`] = coreProbePatch.expiresMs;
    }

    if (intentDir && (intent === "ENTRY" || intent === "ADD") && Number.isFinite(effectiveBarMs)) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      metaUpdates[lastKey] = effectiveBarMs;
      const tier = resolveSignalTierFromEvent(s.event, s.features);
      if (Number.isFinite(tier)) {
        const tierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
        const prevTier = Number(posMeta && posMeta[tierKey]);
        metaUpdates[tierKey] = Number.isFinite(prevTier) ? Math.max(prevTier, tier) : tier;
      }
    }

    // 서버 내부 최초 신호는 같은 바의 외부 webhook이 있어도 authoritative로 승격한다.
    if (!s.signal_id) {
      const savedSignal = await upsertSignal({
        exchange,
        symbol,
        tf,
        barCloseTimeUtc: signalBarCloseUtcForIntent,
        barCloseTimeUtcMs: signalBarCloseMsForIntent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        reason: s.reason || "INTERNAL_SIGNAL",
        features,
        executionMode: intentExecutionMode,
        source: "SERVER",
        authoritative: true,
        runId,
        decisionReason: s.reason || "INTERNAL_SIGNAL",
      });
      if (savedSignal && savedSignal.signal_id) {
        s.signal_id = savedSignal.signal_id;
        if (!s.signal_doc_id) s.signal_doc_id = savedSignal.signal_id;
        if (!features.signal_id) features.signal_id = savedSignal.signal_id;
        if (!features.signal_doc_id) features.signal_doc_id = s.signal_doc_id;
      }
      if (savedSignal && savedSignal.signal_id && (savedSignal.decision === "CREATED" || savedSignal.decision === "UPDATED_CHANGED")) {
        sendSignalReceivedAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          reason: s.reason || "INTERNAL_SIGNAL",
          signalId: savedSignal.signal_id,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
        }).catch((err) => {
          console.warn("[SIGNAL_RECEIVED_ALERT_FAIL]", err?.message || err);
        });
      }
    }

    const isImmediateExit = exitImmediateEnabled && intent === "EXIT";
    const isExternalSignal = !!s.signal_id;
    const execOnCurrentBar = intentIsEntry && isExternalSignal && Number.isFinite(effectiveBarMs) && Number.isFinite(execBarCloseMs)
      && effectiveBarMs <= execBarCloseMs;
    const isImmediateEntry = immediateEntry === true || execOnCurrentBar;
    if (execOnCurrentBar && features._entry_exec_timing == null) {
      features._entry_exec_timing = "EXEC_CURRENT_BAR";
    }
    const nextExecMsFromSignal = (Number.isFinite(execTfMs) && Number.isFinite(signalBarCloseMsForIntent))
      ? addMs(signalBarCloseMsForIntent, execTfMs)
      : nextExecMs;
    const execBarCloseMsForIntent = (isImmediateExit || isImmediateEntry)
      ? execBarCloseMs
      : (Number.isFinite(nextExecMsFromSignal) ? Math.max(nextExecMsFromSignal, execBarCloseMs) : nextExecMs);
    const execBarCloseUtcForIntent = Number.isFinite(execBarCloseMsForIntent)
      ? msToUtcZ(execBarCloseMsForIntent)
      : execBarCloseUtc;
    // EXIT_ONLY tick loop retries must not reuse a canceled hourly intent id.
    const intentSignalBarCloseMs = (isImmediateExit && backfillExitOnly === true && Number.isFinite(execBarCloseMsForIntent))
      ? Number(execBarCloseMsForIntent)
      : signalBarCloseMsForIntent;
    const intentSignalBarCloseUtc = Number.isFinite(intentSignalBarCloseMs)
      ? msToUtcZ(intentSignalBarCloseMs)
      : signalBarCloseUtcForIntent;
    const pendingReason = isImmediateExit
      ? "IMMEDIATE_EXEC"
      : (isImmediateEntry ? (execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")) : "WAIT_NEXT_BAR");
    const pendingNote = (isImmediateExit || isImmediateEntry)
      ? `immediate_exec=${execBarCloseUtcForIntent}`
      : `next_exec=${execBarCloseUtcForIntent}`;
    if (intent === "EXIT") {
      const linkedEntryEventId = String(
        (features.entry_event_id || posMeta.entry_event_id || "")
      ).trim();
      const linkedEntrySignalType = String(
        (features.entry_signal_type || posMeta.entry_signal_type || "")
      ).toUpperCase();
      const linkedEntryGrade = String(
        (features.entry_grade || posMeta.entry_grade || posMeta.entry_timing_tier || "")
      ).toUpperCase();
      const linkedEntryQtyProfile = String(
        (features.entry_qty_profile || posMeta.entry_qty_profile || posMeta.entry_qty_tier || "")
      ).toUpperCase();
      if (linkedEntryEventId && !features.entry_event_id) features.entry_event_id = linkedEntryEventId;
      if (linkedEntrySignalType && !features.entry_signal_type) features.entry_signal_type = linkedEntrySignalType;
      if (linkedEntryGrade && !features.entry_grade) features.entry_grade = linkedEntryGrade;
      if (linkedEntryQtyProfile && !features.entry_qty_profile) features.entry_qty_profile = linkedEntryQtyProfile;
    }

    if (isTpP1Event && intent === "EXIT") {
      const pendingAtMs = Date.now();
      metaUpdates.tp_p1_pending = true;
      metaUpdates.tp_p1_pending_at_ms = Number.isFinite(pendingAtMs) ? pendingAtMs : null;
      metaUpdates.tp_p1_pending_until_ms = Number.isFinite(pendingAtMs) ? (pendingAtMs + tpP1PendingHoldMs) : null;
      metaUpdates.tp_p1_pending_event = s.event;
    }

    // 2026-04-28 F2 Phase 5 hotfix #4 — V2 server-native ENTRY signal
    // bypass (mirror of the runPaperFuturesForBar inject below). Keeps
    // both sibling functions consistent so neither path can silently
    // drop V2 generator output.
    const isV2ServerNativeEntry = !!(s && s.features && s.features.v2_server_native === true)
      && (intent === "ENTRY" || intent === "ADD");
    if (isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent }) || isV2ServerNativeEntry) {
      features.v2_discovery_signal_fan_in_handoff = true;
      features.v2_discovery_entry_filter_authority = "PRODUCTION_ENTRY_ROUTE";
      if (isV2ServerNativeEntry) {
        features.v2_server_native_signal_bypass = true;
      }
      const handoffIntentRow = buildV2DiscoverySignalFanInIntentRow({
        exchange,
        symbol,
        tf,
        signal: s,
        features,
        qtyFraction,
        intentExecutionMode,
        signalBarCloseUtcForIntent,
        signalBarCloseMsForIntent,
        intentSignalBarCloseUtc,
        intentSignalBarCloseMs,
        execBarCloseUtcForIntent,
        execBarCloseMsForIntent,
        signalDocId,
        signalPrice: Number(bar && (bar.close ?? bar.c)),
        runId,
      });
      const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
        env: process.env,
        intentRow: handoffIntentRow,
        liveCfg,
        referencePrice: Number(bar && (bar.open ?? bar.o)) || handoffIntentRow.signal_price || Number(bar && (bar.close ?? bar.c)),
        requestId: handoffIntentRow.request_id,
      }).catch((error) => ({
        ok: false,
        reason: "V2_DISCOVERY_BRIDGE_THROWN",
        error_message: error && error.message ? String(error.message) : String(error),
      }));
      if (handoff && handoff.ok === true) {
        const requestBody = handoff.request && handoff.request.body ? handoff.request.body : {};
        const requestBundle = requestBody.bundle || {};
        const requestPermit = requestBody.executionPermit || {};
        const routeReason = "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE";
        const handoffSignalId = s.signal_id || (features && features.signal_id) || null;
        const handoffSignalClaim = await claimSignalForProgressAlert({
          signalId: handoffSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: routeReason,
          meta: {
            intent: intent || null,
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        });
        if (handoffSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          signalId: handoffSignalId,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: routeReason,
          pendingReason: "IMMEDIATE_EXEC",
          scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
          meta: {
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        }).catch((err) => {
          console.warn("[V2_DISCOVERY_SIGNAL_FAN_IN_HANDOFF_ALERT_FAIL]", err?.message || err);
        });
        continue;
      }
      const blockReason = deriveV2DiscoveryHandoffBlockReason(handoff);
      const postFillHandoff = classifyV2DiscoveryPostFillHandoff(handoff);
      if (postFillHandoff.exchange_write_performed === true) {
        const postFillSignalId = s.signal_id || (features && features.signal_id) || null;
        const postFillSignalClaim = await claimSignalForProgressAlert({
          signalId: postFillSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: blockReason,
          critical: postFillHandoff.unprotected_position_possible === true,
          meta: {
            intent: intent || null,
            v2_discovery_post_fill_exchange_write: true,
            v2_discovery_post_fill_unprotected_possible: postFillHandoff.unprotected_position_possible === true,
          },
        });
        if (postFillSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          signalId: postFillSignalId,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: blockReason,
          pendingReason: "POST_FILL_RECONCILE",
          scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
          meta: {
            ...buildV2DiscoveryHandoffFeaturePatch(handoff),
            post_fill_note: postFillHandoff.note || null,
          },
        }).catch((err) => {
          console.warn("[V2_DISCOVERY_SIGNAL_FAN_IN_POST_FILL_ALERT_FAIL]", err?.message || err);
        });
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: blockReason,
        drop_reason_code: blockReason,
        features_json: {
          ...(features || {}),
          v2_discovery_signal_fan_in_blocked: true,
          ...buildV2DiscoveryHandoffFeaturePatch(handoff),
        },
        event_intent: intent,
      });
      continue;
    }

    if (isImmediateEntry || immediateReason === "CORE_CONFIRM_NEXT_BAR") {
      console.log(
        `[immediate_entry] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")} sched=${execBarCloseUtcForIntent}`
      );
    }
    if (!isImmediateExit && !isImmediateEntry && isExternalSignal && intentIsEntry) {
      console.log(
        `[intent_scheduled] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${pendingReason} sched=${execBarCloseUtcForIntent}`
      );
    }

    await upsertIntent({
      exchange,
      symbol,
      tf,
      signalBarCloseTimeUtc: intentSignalBarCloseUtc,
      signalBarCloseTimeUtcMs: intentSignalBarCloseMs,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
      scheduledExecBarCloseUtcMs: execBarCloseMsForIntent,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      reason: s.reason || "SIGNAL",
      features,
      signalId: s.signal_id || (features && features.signal_id) || null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: useBudget ? (riskBudget.maxKrw * qtyFraction) : null,
      qtyFraction: useBudget ? qtyFraction : null,
      signalPrice: Number(bar && (bar.close ?? bar.c)),
      signalDocId,
      pendingReason,
      pendingNote,
      ttlMs,
      execTf: execTfFinal,
      decisionReason: s.reason || "INTENT_CREATED",
    });

    sendSignalProgressAlert({
      exchange,
      symbol,
      tf,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      signalId: s.signal_id || (features && features.signal_id) || null,
      executionMode: intentExecutionMode,
      source: "SERVER",
      authoritative: true,
      progressReason: "INTENT_CREATED",
      pendingReason,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
    }).catch((err) => {
      console.warn("[SIGNAL_PROGRESS_ALERT_FAIL]", err?.message || err);
    });

    // external signal consumed mark (operational-B)
    if (s.signal_id) {
      const lock = await tryLockSignal({ signalId: s.signal_id, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId: s.signal_id,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: "INTENT_CREATED",
          meta: { intent: intent || null },
        });
      }
    }


    intentsCreated += 1;
    if (isImmediateEntry) immediateIntentsCreated += 1;
  }
  if (signalDrops.length) {
    recordedSignalDrops = await filterSignalDropsForRecording({ drops: signalDrops, runId });
  }
  if (recordedSignalDrops.length) {
    await recordSignalDrops({
      exchange,
      symbol,
      tf: signalTf,
      runId,
      drops: recordedSignalDrops.map((d) => ({
        ...d,
        execution_mode: intentExecutionMode,
        signal_id: d.signal_id || (d.features_json && d.features_json.signal_id) || (d.features && d.features.signal_id) || null,
        signal_doc_id: d.signal_doc_id || (d.features_json && d.features_json.signal_doc_id) || (d.features && d.features.signal_doc_id) || null,
      })),
    });
    await consumeDroppedSignals({
      drops: recordedSignalDrops,
      runId,
      execBarCloseMs,
      execBarCloseUtc,
    });
  }

  const sanitizedMetaUpdates = sanitizeBarLoopMetaUpdates(metaUpdates);
  if (Object.keys(sanitizedMetaUpdates).length) {
    posMeta = await applyBarLoopObservationMetaUpdate({
      exchange,
      symbol,
      position: pos,
      posMeta,
      positionSide: posSideNow || null,
      runId,
      executionMode: intentExecutionMode,
      metaPatch: sanitizedMetaUpdates,
    });
  }

  if (exitImmediateEnabled || immediateIntentsCreated > 0) {
    const immediateIntents = await listPendingIntentsForExec({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 50,
    });
    if (Array.isArray(immediateIntents) && immediateIntents.length) {
      await executeIntentList(sortIntentsForExecution(immediateIntents));
      pos = await getPositionReadView({ exchange, symbol });
      posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
      posQtyBase = resolvePosQtyBase(pos);
    }
  }

  const trailUpdates = computeTrailingMetaUpdate({ exchange, bar, position: pos, posMeta, positionSideFallback: posSideNow });
  if (trailUpdates) {
    posMeta = await applyBarLoopObservationMetaUpdate({
      exchange,
      symbol,
      position: pos,
      posMeta,
      positionSide: posSideNow || null,
      runId,
      executionMode: intentExecutionMode,
      metaPatch: trailUpdates,
    });
  }

  return {
    fills_executed: fillsExecuted,
    intents_created: intentsCreated,
    signals_seen: signals.length,
    signals_external: externalSignals.length,
    signals_internal: internalSignals.length,
    signals_external_late: lateSignals,
    signal_drop_n: recordedSignalDrops.length,
    signal_drop_suppressed_n: Math.max(0, signalDrops.length - recordedSignalDrops.length),
    signal_drop_reason_counts: recordedSignalDrops.reduce((acc, row) => {
      const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    top_signal_drop_reason: recordedSignalDrops.length
      ? Object.entries(recordedSignalDrops.reduce((acc, row) => {
        const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1])[0][0]
      : null,
  };
}

async function runPaperFuturesForBar({
  runId,
  exchange,
  symbol,
  tf,
  execTf,
  barCloseUtc,
  barCloseMs,
  bar,
  gate,
  trading_mode,
  backfillExitOnly,
  backfillAllowEntry,
} = {}) {
  const signalTf = String(tf || defaultExecTfFromEnv() || "15m");
  const execTfFinal = String(execTf || signalTf);
  const signalTfMs = tfToMs(signalTf);
  const execTfMs = tfToMs(execTfFinal);
  const tpP1PendingHoldMs = resolveTpP1PendingHoldMs();
  const execProfile = await resolveExecutionProfile({ symbol, bar, exchange });
  const { feeBps, slippageBps } = execProfile;
  const riskBudget = await resolveRiskBudget(symbol, exchange);
  const useBudget = riskBudget && riskBudget.enabled === true;
  const exUpper = String(exchange || "").toUpperCase();
  const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol });
  const leverage = FUTURES_BASE_LEVERAGE;
  const sys = await getSystemSettingsForProvider(exchange || "BINANCEFUT", 5000);
  const sysCfg = (sys && sys.data) ? sys.data : {};
  const sysCfgEffective = resolveImmediateDefaultsForExchange(sysCfg, exchange);
  const rescueAddCfg = resolveLiveRescueAddConfig(sysCfgEffective, exchange);
  const forceAllSignalsAdd = resolveForceAllSignalsAdd(sysCfgEffective, exchange);
  const autoScore = await resolveAutoScoreMin({ exchange, sysCfg: sysCfgEffective });
  const signalOverlapEnabled = forceAllSignalsAdd ? false : normalizeBool(sysCfg.signal_overlap_enabled, true);
  const signalOverlapBars = forceAllSignalsAdd ? 0 : Math.max(0, normalizeInt(sysCfg.signal_overlap_bars, 2));
  const signalQueueEnabled = normalizeBool(sysCfg.signal_queue_enabled, true);
  const defaultLateBars = exUpper.includes("BINANCEFUT") ? 6 : 1;
  const configuredLateBars = normalizeInt(sysCfg.signal_queue_max_late_bars, defaultLateBars);
  const signalQueueMaxLateBars = Math.max(defaultLateBars, Math.max(0, configuredLateBars));
  const exitImmediateEnabled = normalizeBool(
    process.env.EXIT_IMMEDIATE_ENABLED,
    normalizeBool(sysCfg.exit_immediate_enabled, true)
  );
  const immediateCfg = resolveImmediateEntryConfig(sysCfgEffective);
  const shortGateCfg = resolveShortEntryGateConfig(sysCfgEffective, exchange);
  const aiBiasGateCfg = resolveAiBiasEntryGateConfig(sysCfgEffective, exchange);
  const evGateCfg = resolveEvGateConfig(sysCfgEffective, exchange, symbol);
  const waitOneBarCfg = resolveWaitOneBarConfig(sysCfgEffective, exchange);
  const entryQualityCfg = resolveEntryQualityGateConfig(sysCfgEffective, exchange);
  const addRiskCfgRaw = resolveAddRiskConfig(sysCfgEffective, exchange);
  const addRiskCfg = forceAllSignalsAdd ? { ...addRiskCfgRaw, enabled: false } : addRiskCfgRaw;
  const tradeableSignalTypes = resolveTradeableSignalTypes(sysCfgEffective, exchange);
  const binanceFutOnly = exUpper.includes("BINANCEFUT");
  const hasImmediateStage =
    immediateCfg.realEnabled || immediateCfg.preRealEnabled || immediateCfg.coreEnabled || immediateCfg.earlyEnabled;
  const signalQueueLookaheadBars = (binanceFutOnly && immediateCfg.enabled && hasImmediateStage)
    ? Math.max(0, Math.min(1, Number(immediateCfg.lookaheadBars) || 0))
    : 0;
  const maxHoldBars = binanceFutOnly ? resolveBinanceMaxHoldBars(sysCfgEffective, signalTfMs) : 0;
  const sameDirectionTrailProfitCooldownCfg = resolveSameDirectionTrailProfitCooldownConfig(sysCfgEffective);

  let pos = await getPositionReadView({ exchange, symbol });
  if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
    try {
      const forceRefresh = shouldForceFuturesRefresh(symbol);
      const sync = await syncBinanceFuturesPosition({
        runId,
        exchange,
        symbol,
        riskBudget,
        liveCfg,
        forceRefresh,
      });
      if (sync && sync.ok && sync.position) {
        pos = sync.position;
      }
    } catch (e) {
      const errMsg = e && e.message ? e.message : String(e);
      const payload = {
        exchange,
        symbol,
        mode: liveCfg.executionMode,
        error: errMsg,
      };
      // 2026-04-29 — production saw "Cannot read properties of null
      // (reading 'entry_exec_tf_ms')" wave on every newly-added symbol
      // (WLD/TAO/ARB/INJ/AAVE/SAND/TIA) the moment the universe
      // expanded; stack was suppressed because the matcher only
      // emitted on ReferenceError. Always attach the stack so the
      // NEXT occurrence points at the offending lexical site for any
      // exception class.
      payload.error_name = e && e.name ? e.name : "Error";
      payload.stack = e && e.stack ? String(e.stack).slice(0, 2000) : null;
      console.warn("[FUT_POS_SYNC_FAIL]", payload);
    }
  }
  let posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
  let sameDirectionTrailProfitObservation = await loadSameDirectionTrailProfitObservationSafe({
    enabled: sameDirectionTrailProfitCooldownCfg.enabled,
    exchange,
    symbol,
  });
  const oppositeCooldownWindow = binanceFutOnly
    ? resolveOppositeCooldownWindowFromPosition({ sysCfg: sysCfgEffective, position: pos })
    : { bars: 0, timeMs: 0, cohort: null };
  const oppositeCooldownBars = binanceFutOnly ? oppositeCooldownWindow.bars : 0;
  const oppositeTimeCooldownMs = binanceFutOnly ? oppositeCooldownWindow.timeMs : 0;
  let posSide = normalizePositionSide(
    pos.position_side ||
    pos.side ||
    (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
  );
  if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
  let posQtyBase = resolvePosQtyBase(pos);
  const spikeLock = await resolveSignalSpikeLock({ exchange, symbol, barCloseMs, pos, sysCfg });
  let pendingMetaPatch = null;
  if (spikeLock && spikeLock.active && Number.isFinite(spikeLock.untilMs)) {
    const prevUntil = Number(posMeta.spike_lock_until_ms);
    if (!Number.isFinite(prevUntil) || spikeLock.untilMs > prevUntil) {
      pendingMetaPatch = mergeMeta(pendingMetaPatch, {
        spike_lock_until_ms: spikeLock.untilMs,
        spike_lock_set_ms: Number(barCloseMs),
        spike_lock_reason: spikeLock.reason || "SPIKE_DETECTED",
        spike_lock_move_pct: spikeLock.movePct ?? null,
        spike_lock_tf: spikeLock.tf || null,
      });
    }
  }
  if (pendingMetaPatch) posMeta = mergeMeta(posMeta, pendingMetaPatch);

  const execBarCloseMs = Number(barCloseMs);
  const execBarCloseUtc = barCloseUtc;

  try {
    await cancelExpiredPendingIntents({ exchange, symbol, tf: signalTf, lookbackLimit: 600 });
  } catch (e) {
    console.warn("[INTENT_EXPIRE_CANCEL_FAIL_FUT]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  let intents = await listPendingIntentsForExec({
    exchange,
    symbol,
    tf: signalTf,
    execBarCloseMs,
    limitN: 50,
  });
  try {
    const overdue = await listPendingIntentsOverdue({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 20,
      lookbackLimit: 600,
    });
    if (Array.isArray(overdue) && overdue.length) {
      const seen = new Set(intents.map((x) => x.intent_id || x.id));
      overdue.forEach((x) => {
        const id = x.intent_id || x.id;
        if (id && !seen.has(id)) intents.push(x);
      });
    }
  } catch (e) {
    console.warn("[INTENT_OVERDUE_FETCH_FAIL_FUT]", {
      exchange,
      symbol,
      tf: signalTf,
      error: e && e.message ? e.message : String(e),
    });
  }

  const budgetTotals = useBudget ? await computeTotalBudgetUsage(riskBudget, exchange) : { totalMaxKrw: null, totalUsedKrw: null };
  const totalMaxKrw = budgetTotals.totalMaxKrw;
  let totalUsedKrw = budgetTotals.totalUsedKrw;

  let fillsExecuted = 0;
  const attemptAt = new Date().toISOString();

  const executeIntentList = async (intentsList) => {
    for (const it of intentsList) {
      const schedMs = Number(it.scheduled_exec_bar_close_time_utc_ms);
      const isOverdue = Number.isFinite(schedMs) && Number.isFinite(execBarCloseMs) && schedMs < execBarCloseMs;
      await patchIntent(it.intent_id, {
        last_attempt_at: attemptAt,
        last_attempt_bar_close_time_utc: execBarCloseUtc,
        last_attempt_bar_close_time_utc_ms: execBarCloseMs,
        ...(isOverdue ? {
          pending_reason: "LATE_EXEC",
          pending_note: `late_exec_from=${msToUtcZ(schedMs)}`,
        } : {}),
      });

    const intent = intentFromSignal({ event: it.event, side: it.side, features: it.features_json });
    if (!intent) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_INTENT", status_reason: "UNKNOWN_INTENT" });
      continue;
    }

    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);
    const v2DiscoveryLegacyEntryFilterBypass = shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent });
    if (v2DiscoveryLegacyEntryFilterBypass) {
      it.features_json = {
        ...(it.features_json || {}),
        v2_discovery_legacy_entry_filters_bypassed: true,
        v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
      };
      await patchIntent(it.intent_id, { features_json: it.features_json }).catch(() => {});
      const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
        env: process.env,
        intentRow: it,
        liveCfg,
        referencePrice: Number(bar && (bar.open ?? bar.o)) || Number(it.signal_price) || Number(bar && (bar.close ?? bar.c)),
        requestId: it.request_id || it.intent_id || it.signal_id || (it.features_json && it.features_json.signal_id),
      }).catch((error) => ({
        ok: false,
        reason: "V2_DISCOVERY_BRIDGE_THROWN",
        error_message: error && error.message ? String(error.message) : String(error),
      }));
      if (handoff && handoff.ok === true) {
        const requestBody = handoff.request && handoff.request.body ? handoff.request.body : {};
        const requestBundle = requestBody.bundle || {};
        const requestPermit = requestBody.executionPermit || {};
        const routeReason = "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE";
        const handoffSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
        await markIntentStatus(it.intent_id, "SUPERSEDED_BY_V2_PROTECTED_ENTRY", {
          cancel_reason: routeReason,
          status_reason: routeReason,
          cancel_note: "Legacy order intent was superseded by V2 productionEntryLiveEndpoint/productionEntryRoute before legacy entry filters; not a drop/cancel.",
          v2_discovery_bridge_reason: handoff.reason || null,
          v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
          v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
        });
        const handoffSignalClaim = await claimSignalForProgressAlert({
          signalId: handoffSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs,
          execBarCloseUtc,
          reason: routeReason,
          meta: {
            intent,
            order_intent_id: it.intent_id || null,
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        });
        if (handoffSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          event: it.event,
          side: normalizeSideValue(it.side),
          tf: signalTf,
          qtyPct: Number(it.qty_pct),
          executionMode: liveCfg.executionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: routeReason,
          pendingReason: "IMMEDIATE_EXEC",
          signalId: handoffSignalId,
        }).catch((e) => {
          console.warn("[V2_DISCOVERY_EARLY_HANDOFF_ALERT_FAIL]", e && e.message ? e.message : String(e));
        });
        continue;
      }
      const routedDecision = handoff && (handoff.routedDecision || (handoff.request && handoff.request.routedDecision));
      const endpointReason = handoff && handoff.endpoint_result ? handoff.endpoint_result.reason || null : null;
      const postFillHandoff = classifyV2DiscoveryPostFillHandoff(handoff);
      const endpointPostFillCritical = postFillHandoff.unprotected_position_possible === true
        || String(endpointReason || "").trim().toUpperCase() === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL";
      let blockReason = "V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE";
      if (routedDecision && routedDecision.reason) {
        blockReason = String(routedDecision.reason).trim().toUpperCase();
      } else if (endpointReason) {
        blockReason = String(endpointReason).trim().toUpperCase();
      } else if (handoff && handoff.reason) {
        blockReason = String(handoff.reason).trim().toUpperCase();
      }
      if (postFillHandoff.exchange_write_performed === true && postFillHandoff.reason) {
        blockReason = postFillHandoff.reason;
      }
      await markIntentStatus(it.intent_id, postFillHandoff.status || (endpointPostFillCritical ? "FAILED_INTERNAL" : "CANCELED"), {
        cancel_reason: blockReason,
        status_reason: blockReason,
        cancel_note: JSON.stringify({
          note: postFillHandoff.note || (endpointPostFillCritical
            ? "V2 productionEntryLiveEndpoint reported post-fill protection critical state. Actual exchange entry may exist and requires protection repair verification."
            : "V2 discovery entry was handed to productionEntryLiveEndpoint/productionEntryRoute before legacy entry filters."),
          bridge_reason: handoff && handoff.reason ? handoff.reason : null,
          bridge_error: handoff && handoff.error_message ? handoff.error_message : null,
          endpoint_reason: endpointReason,
          router_reason: routedDecision && routedDecision.reason ? routedDecision.reason : null,
          post_fill_exchange_write_performed: postFillHandoff.exchange_write_performed === true,
          post_fill_unprotected_position_possible: postFillHandoff.unprotected_position_possible === true,
          post_fill_side_effect: postFillHandoff.side_effect || null,
        }),
      });
        if (postFillHandoff.exchange_write_performed === true) {
          const postFillSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
          const postFillSignalClaim = await claimSignalForProgressAlert({
            signalId: postFillSignalId,
            runId,
            consumedAtIso: new Date().toISOString(),
            execBarCloseMs,
            execBarCloseUtc,
            reason: blockReason,
            critical: postFillHandoff.unprotected_position_possible === true,
            meta: {
              intent,
              order_intent_id: it.intent_id || null,
              v2_discovery_post_fill_exchange_write: true,
              v2_discovery_post_fill_unprotected_possible: postFillHandoff.unprotected_position_possible === true,
            },
          });
          if (postFillSignalClaim.ok !== true) {
            continue;
          }
          sendV2DiscoveryPostFillHandoffProgressAlert({
            exchange,
            symbol,
            event: it.event,
            side: normalizeSideValue(it.side),
            tf: signalTf,
            qtyPct: Number(it.qty_pct),
            executionMode: liveCfg.executionMode,
            signalId: postFillSignalId,
            blockReason,
            handoff,
            postFillHandoff,
          });
        continue;
      }
      notifyTradeExitFailureAlert({
        exchange,
        symbol,
        event: it.event,
        side: normalizeSideValue(it.side),
        intent,
        executionMode: liveCfg.executionMode,
        reason: blockReason,
        qtyPct: Number(it.qty_pct),
        positionSideBefore: resolveFailureAlertPositionSide(pos),
      });
      continue;
    }
    const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;
    let preQtyScale = 1;
    if (backfillExitOnly && intentIsEntry) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // Tick-exit loop must not consume/cancel entry intents; leave them for normal RUN cycle.
        continue;
      }
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BACKFILL_SKIP_ENTRY", status_reason: "BACKFILL_SKIP_ENTRY" });
      continue;
    }
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: it.event, features: it.features_json, posMeta });
    if (intentIsEntry && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRAIL_ACTIVE_NO_ADD", status_reason: "DROP_TRAIL_ACTIVE_NO_ADD" });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: `MODE_${trading_mode}`, status_reason: "TRADING_MODE" });
      continue;
    }
    // Commission Gate v2 soft mode — 시그널 품질 필터 이전에 평가 (intent execution)
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      try {
        const signalScaleFlags = resolveSignalScaledFlags(it.features_json);
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "intent_exec_fut", exchange, symbol, event: it.event, perfGate, intentId: it.intent_id });
        const commScale = resolveCommissionSoftScale(perfGate);
        if (commScale.blocked && commScale.scale < 0.9999) {
          if (signalScaleFlags.commissionScaledInSignal) {
            console.log(`[COMMISSION_GATE][DEDUPE] intent_fut ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_scale=${signalScaleFlags.commissionScale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          } else {
            preQtyScale = preQtyScale * commScale.scale;
            console.warn(`[COMMISSION_GATE][SOFT_REDUCE] intent_fut ${exchange} ${symbol} ${it.event} | ratio=${(perfGate.commissionRatio * 100).toFixed(1)}% threshold=${((perfGate.threshold || COMMISSION_RATIO_THRESHOLD) * 100).toFixed(0)}% | scale=${commScale.scale.toFixed(4)} gate_id=${gateEvidence.gateId}`);
          }
        }
        if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
          if (signalScaleFlags.mddScaledInSignal) {
            console.log(`[MDD_REDUCE][DEDUPE] intent_fut ${exchange} ${symbol} ${it.event} | skip_signal_applied=true signal_factor=${signalScaleFlags.mddReduceFactor.toFixed(4)}`);
          } else {
            preQtyScale = preQtyScale * perfGate.mddReduceFactor;
            console.log(`[MDD_REDUCE] intent_fut ${exchange} ${symbol} ${it.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% | factor=${perfGate.mddReduceFactor}`);
          }
        }
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "intent_exec_fut", exchange, symbol, event: it.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ERROR", status_reason: "DROP_COMMISSION_GATE_ERROR" });
          continue;
        }
      }
    }
    const eventUpper = String(it.event || "").toUpperCase();
    const actionTag = normalizeActionValue(it.features_json && it.features_json.action);
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: it.event })
      : directionFromSignal({ event: it.event, side: it.side });
    if (
      intent === "EXIT"
      && isForbiddenTp0ExitIntent({
        currentMeta: posMeta,
        event: eventUpper,
      })
    ) {
      await markIntentStatus(it.intent_id, "CANCELED", {
        cancel_reason: "DROP_SIMPLIFIED_EXIT_V2_FORBIDDEN_TP0",
        status_reason: "DROP_SIMPLIFIED_EXIT_V2_FORBIDDEN_TP0",
        cancel_note: JSON.stringify({
          event: eventUpper,
          simplified_exit_v2_enabled: true,
          tp_p0_done: posMeta && posMeta.tp_p0_done === true,
          tp_p1_done: posMeta && posMeta.tp_p1_done === true,
          trail_active: posMeta && posMeta.trail_active === true,
        }),
      });
      continue;
    }
    if (intentIsEntry && !actionAllowsEntry(actionTag)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ACTION_FILTER", status_reason: "DROP_ACTION_FILTER" });
      continue;
    }
    if (intentIsEntry && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_TRADEABLE_SIGNAL_TYPES", status_reason: "DROP_TRADEABLE_SIGNAL_TYPES" });
      continue;
    }
    const features = (it.features_json && typeof it.features_json === "object") ? { ...it.features_json } : {};
    if (intentIsEntry) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        sysCfg: sysCfgEffective,
        market: it.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          status_reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          cancel_note: canonical.detail ? JSON.stringify(canonical.detail) : undefined,
        });
        continue;
      }
      if (canonical.detail) {
        it.features_json = { ...(it.features_json || {}), ...(canonical.detail || {}) };
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: it.features_json,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: quality.reason || "DROP_ENTRY_QUALITY",
          status_reason: quality.reason || "DROP_ENTRY_QUALITY",
          cancel_note: quality.detail ? JSON.stringify(quality.detail) : undefined,
        });
        continue;
      }
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: it.features_json, intentDir, posMeta });
    if (intentIsEntry && oppositeCooldownBars > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        const intentBarMs = Number(it.signal_bar_close_time_utc_ms) || Number(execBarCloseMs);
        if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
          const barsSinceExit = Math.floor((intentBarMs - lastExitMs) / signalTfMs);
          if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
            if (intentDir && lastExitDir && intentDir !== lastExitDir) {
              await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_COOLDOWN", status_reason: "DROP_OPPOSITE_COOLDOWN" });
              continue;
            }
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && oppositeTimeCooldownMs > 0 && !bypassOppositeEntryCooldown) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
        const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
        if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
          const elapsedMs = resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs) - lastExitWallMs;
          if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
            console.log(`[OPPOSITE_TIME_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_OPPOSITE_TIME_COOLDOWN", status_reason: "DROP_OPPOSITE_TIME_COOLDOWN" });
            continue;
          }
        }
      }
    }
    if (intentIsEntry && sameDirectionTrailProfitCooldownCfg.enabled) {
      const hasPositionNow = hasPositionSize(pos.size_pct) || (Number.isFinite(posQtyBase) && posQtyBase > 0);
      if (!hasPositionNow) {
        const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
          cfg: sameDirectionTrailProfitCooldownCfg,
          posMeta: resolveSameDirectionTrailProfitCooldownSnapshot({
            posMeta,
            observation: sameDirectionTrailProfitObservation,
            observationOnly: true,
          }),
          intentDir,
          eventRefMs: resolveEventRefMs(it.signal_bar_close_time_utc_ms, execBarCloseMs),
        });
        if (sameDirectionCooldown) {
          console.log(
            `[SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN] BLOCKED ${exchange} ${symbol} ${it.event} ` +
            `| dir=${intentDir} | elapsed=${Math.floor(sameDirectionCooldown.elapsed_ms / 1000)}s ` +
            `< cooldown=${Math.floor(sameDirectionCooldown.cooldown_ms / 1000)}s`
          );
          await markIntentStatus(it.intent_id, "CANCELED", {
            cancel_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
            status_reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          });
          continue;
        }
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(it.qty_pct) : Number(it.qty_pct);
    const fixedQtyRestore = restoreFixedEntryQtyFraction({
      qtyFraction,
      intent,
      event: it.event,
      features: it.features_json,
    });
    if (fixedQtyRestore.restored) {
      qtyFraction = fixedQtyRestore.qtyFraction;
      it.features_json = {
        ...(it.features_json || {}),
        fixed_qty_ev_scale_restored: true,
        fixed_qty_original_qty_fraction: fixedQtyRestore.originalQtyFraction,
        fixed_qty_restored_qty_fraction: fixedQtyRestore.qtyFraction,
      };
    }
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_QTY", status_reason: "BAD_QTY" });
      continue;
    }
    if (intentIsEntry && Number.isFinite(preQtyScale) && preQtyScale > 0 && preQtyScale < 0.9999) {
      qtyFraction = qtyFraction * preQtyScale;
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_COMMISSION_GATE_ZERO_QTY", status_reason: "DROP_COMMISSION_GATE_ZERO_QTY" });
        continue;
      }
    }
    if (intent === "ADD") {
      const addGuard = evaluateAddIntentRiskGuard({
        cfg: addRiskCfg,
        intent,
        position: pos,
        posMeta,
        bar,
        barCloseMs: execBarCloseMs,
        qtyFraction,
      });
      if (!addGuard.ok) {
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: addGuard.reason || "DROP_ADD_GUARD",
          status_reason: addGuard.reason || "DROP_ADD_GUARD",
          cancel_note: addGuard.detail ? JSON.stringify(addGuard.detail) : undefined,
        });
        continue;
      }
      if (Number.isFinite(addGuard.qtyScale) && addGuard.qtyScale > 0 && addGuard.qtyScale < 0.9999) {
        qtyFraction *= addGuard.qtyScale;
      }
      if (useBudget) qtyFraction = normalizeQtyFraction(qtyFraction);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "DROP_ADD_QTY_INVALID", status_reason: "DROP_ADD_QTY_INVALID" });
        continue;
      }
    }
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_EXCEED_POLICY_SKIP", status_reason: "BUDGET_POLICY_SKIP" });
        continue;
      }
      qtyFraction = 1;
    }

    if (intentIsEntry) {
      const signalFloor = await applyEntryBudgetSignalFloor({
        exchange,
        symbol,
        intent,
        qtyFraction,
        maxQtyPct: Math.max(0, 1 - Number(pos && pos.size_pct || 0)),
        features: it.features_json,
        nowMs: Number(execBarCloseMs),
        stage: "RUNNER_INTENT_EXEC",
      });
      if (signalFloor.featuresPatch && typeof signalFloor.featuresPatch === "object") {
        it.features_json = signalFloor.featuresPatch;
      }
      if (Number.isFinite(Number(signalFloor.qtyPct)) && Number(signalFloor.qtyPct) > 0) {
        qtyFraction = Number(signalFloor.qtyPct);
      }
      const openclawEval = await applyOpenClawExecutorDecision({
        exchange,
        symbol,
        intent,
        event: it.event,
        side: it.side,
        qtyPct: qtyFraction,
        requestedQtyPct: signalFloor.requestedQtyPct,
        features: it.features_json,
        stage: "RUNNER_INTENT_EXEC",
        applyScale: false,
        nowMs: Number(execBarCloseMs),
        signalTf,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        requestId: it.request_id || null,
        runId,
        signalId: it.signal_id || (it.features_json && it.features_json.signal_id) || null,
        intentId: it.intent_id || null,
      });
      if (openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object") {
        it.features_json = openclawEval.featuresPatch;
      }
      if (!openclawEval.ok || !Number.isFinite(Number(openclawEval.qtyPctFinal)) || Number(openclawEval.qtyPctFinal) <= 0) {
        const reason = String(openclawEval.reason || "OPENCLAW_EXECUTOR_BLOCK").trim().toUpperCase() || "OPENCLAW_EXECUTOR_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }

      qtyFraction = Number(openclawEval.qtyPctFinal);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        const reason = String(openclawEval.reason || "OPENCLAW_EXECUTION_AUTHORITY_BLOCK").trim().toUpperCase() || "OPENCLAW_EXECUTION_AUTHORITY_BLOCK";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: reason, status_reason: reason });
        continue;
      }
    }

    let actionSide = null;
    let nextPosSide = posSide;
    let newSize = Number(pos.size_pct || 0);
    let newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
    let prevSize = newSize;
    const nextOpen = Number(bar.open);
    let fillPrice = null;
    let execPriceSource = "BAR_OPEN";
    let executionMode = "PAPER";
    let liveOrderId = null;
    let execQtyBase = null;
    let liveNotionalKrw = null;
    let avgPrevNotional = null;
    let avgNeedsUpdate = false;
    let liveAdjusted = false;
    let appliedLeverage = FUTURES_BASE_LEVERAGE;
    let appliedLeverageReason = null;
    const exitProfileSnapshot = resolvePositionExitProfile({
      posMeta,
      fallbackMode: liveCfg && liveCfg.exitProfileMode,
    });
    let appliedExitProfile = exitProfileSnapshot.profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
    let appliedExitProfileReason = exitProfileSnapshot.reason;
    let appliedExitRollbackActive = !!(posMeta && posMeta.exit_profile_rollback_active === true);
    let appliedExitRollbackUntilMs = Number.isFinite(Number(posMeta && posMeta.exit_profile_rollback_until_ms))
      ? Number(posMeta.exit_profile_rollback_until_ms)
      : null;
    let appliedExitRollbackReason = String((posMeta && posMeta.exit_profile_rollback_reason) || "").trim() || null;
    let appliedExitRules = cloneExitRules(exitProfileSnapshot.rules);
    let maxFractionAllowed = qtyFraction;
    let budgetMaxForIntent = Number(riskBudget && riskBudget.maxKrw);
    let leverageDecisionForIntent = null;
    let tierLeverageForBudget = FUTURES_BASE_LEVERAGE;

    if (intent === "ENTRY" || intent === "ADD") {
      const targetSide = intentDir || posSide;
      if (!targetSide) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_DIRECTION", status_reason: "UNKNOWN_DIRECTION" });
        continue;
      }
      if (posSide && posSide !== targetSide && newSize > 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_SIDE_CONFLICT", status_reason: "POSITION_SIDE_CONFLICT" });
        continue;
      }
      nextPosSide = targetSide;
      actionSide = targetSide === "SHORT" ? "SELL" : "BUY";
      fillPrice = computeFillPrice({ side: actionSide, nextOpen, slippageBps });
      if (String(exchange || "").toUpperCase().includes("BINANCE")) {
        try {
          leverageDecisionForIntent = await resolveAdaptiveFuturesLeverage({
            liveCfg,
            exchange,
            symbol,
            tf: signalTf,
            intent,
            event: it.event,
            side: actionSide,
            features: it.features_json,
            nowMs: Number(execBarCloseMs),
          });
          const lev = Number(leverageDecisionForIntent && leverageDecisionForIntent.leverage);
          if (Number.isFinite(lev) && lev > 0) tierLeverageForBudget = lev;
        } catch (levErr) {
          console.warn(
            `[ADAPTIVE_LEVERAGE_PRECHECK_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
            `${levErr && levErr.message ? levErr.message : String(levErr)}`
          );
        }
      }
      if (!manualRetryIntent) {
        const tierBudget = resolveEntryTierBudgetMax({
          intent,
          event: it.event,
          features: it.features_json,
          side: actionSide,
          qtyFraction,
          budgetMax: budgetMaxForIntent,
          baseLeverage: tierLeverageForBudget,
        });
        if (tierBudget.applied && Number.isFinite(tierBudget.budgetMax) && tierBudget.budgetMax > 0) {
          budgetMaxForIntent = tierBudget.budgetMax;
          console.log(
            `[ENTRY_TIER_BUDGET_AUTO_SCALE] ex=${String(exchange || "").toUpperCase()} sym=${String(symbol || "").toUpperCase()} ` +
            `event=${String(it.event || "").toUpperCase()} qty=${Number(qtyFraction || 0).toFixed(4)} ` +
            `tier=${String(tierBudget.tier || "-")} mode=${String(tierBudget.targetMode || "-")} lev=${Number(tierLeverageForBudget || 0).toFixed(2)} ` +
            `target=${Number(tierBudget.targetNotional || 0).toFixed(2)} dynamic_prl=${Number(tierBudget.dynamicPreRealTarget || 0).toFixed(2)} ` +
            `base=${Number(riskBudget && riskBudget.maxKrw || 0).toFixed(2)} next=${Number(budgetMaxForIntent).toFixed(2)} ` +
            `required=${Number(tierBudget.requiredBudget || 0).toFixed(2)}`
          );
        }
      }
      if (!manualRetryIntent && (!Number.isFinite(budgetMaxForIntent) || budgetMaxForIntent <= 0)) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "RISK_BUDGET_DISABLED", status_reason: "RISK_BUDGET_DISABLED" });
        continue;
      }

      const addCapState = (intent === "ADD")
        ? ensureLogicalAddCapState(resolveLogicalAddCapState({
          posSizePct: newSize,
          position: pos,
          posMeta,
          stagedAddCount: 0,
        }), { posSizePct: newSize, position: pos })
        : null;
      const currentSizeForCap = resolveCurrentQtyPctForCap(addCapState, newSize);
      const remaining = Math.max(0, 1 - currentSizeForCap);
      if (useBudget && remaining <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }

      let add = qtyFraction;
      if (useBudget) {
        maxFractionAllowed = remaining;
      }
      if (useBudget && add > remaining) add = remaining;
      if (useBudget && !manualRetryIntent && Number.isFinite(totalMaxKrw) && totalMaxKrw > 0 && Number.isFinite(totalUsedKrw)) {
        const remainingTotal = Math.max(0, totalMaxKrw - totalUsedKrw);
        if (remainingTotal <= 0) {
          await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
          continue;
        }
        const maxByTotal = remainingTotal / budgetMaxForIntent;
        if (useBudget) {
          maxFractionAllowed = Math.min(maxFractionAllowed, maxByTotal);
        }
        if (add > maxByTotal) {
          if (riskBudget.onExceed === "SKIP") {
            await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "TOTAL_BUDGET_EXCEEDED", status_reason: "TOTAL_BUDGET_EXCEEDED" });
            continue;
          }
          add = maxByTotal;
        }
      }
      if (add <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_FULL", status_reason: "POSITION_FULL" });
        continue;
      }
      qtyFraction = add;

      const prevNotional = newSize;
      const nextNotional = newSize + add;
      avgPrevNotional = prevNotional;
      avgNeedsUpdate = true;

      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        nextPosSide = null;
        avgNeedsUpdate = false;
      } else {
        newSize = nextNotional;
      }
    } else if (intent === "EXIT") {
      if (!posSide && it.side) {
        const exitSide = normalizeSideValue(it.side);
        if (exitSide === "BUY") posSide = "SHORT";
        if (exitSide === "SELL") posSide = "LONG";
      }
      const isBinanceLiveExit = String(exchange || "").toUpperCase().includes("BINANCE")
        && liveCfg
        && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN");
      if (isBinanceLiveExit) {
        try {
          const sync = await syncBinanceFuturesPosition({
            runId,
            exchange,
            symbol,
            riskBudget,
            liveCfg,
            forceRefresh: true,
          });
          if (sync && sync.ok && sync.position) {
            pos = sync.position;
            posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
            posSide = normalizePositionSide(
              pos.position_side ||
              pos.side ||
              (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
            );
            if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
            posQtyBase = resolvePosQtyBase(pos);
            newSize = Number(pos.size_pct || 0);
            newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
            prevSize = newSize;
          }
        } catch (_) {}
      }
      if ((!posSide || newSize <= 0) && String(exchange || "").toUpperCase().includes("BINANCE")) {
        if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
          try {
            const sync = await syncBinanceFuturesPosition({
              runId,
              exchange,
              symbol,
              riskBudget,
              liveCfg,
              forceRefresh: true,
            });
            if (sync && sync.ok && sync.position) {
              pos = sync.position;
              posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
              posSide = normalizePositionSide(
                pos.position_side ||
                pos.side ||
                (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
              );
              if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
              posQtyBase = resolvePosQtyBase(pos);
              newSize = Number(pos.size_pct || 0);
              newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
              prevSize = newSize;
            }
          } catch (_) {}
        }
      }
      if ((!posQtyBase || posQtyBase <= 0) && String(exchange || "").toUpperCase().includes("BINANCE")) {
        if (liveCfg && (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")) {
          try {
            const sync = await syncBinanceFuturesPosition({
              runId,
              exchange,
              symbol,
              riskBudget,
              liveCfg,
              forceRefresh: true,
            });
            if (sync && sync.ok && sync.position) {
              pos = sync.position;
              posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : {};
              posSide = normalizePositionSide(
                pos.position_side ||
                pos.side ||
                (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
              );
              if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
              posQtyBase = resolvePosQtyBase(pos);
              newSize = Number(pos.size_pct || 0);
              newAvg = pos.avg_price === null || pos.avg_price === undefined ? null : Number(pos.avg_price);
              prevSize = newSize;
            }
          } catch (_) {}
        }
      }
      if (!posSide || newSize <= 0) {
        futuresForceRefresh.set(String(symbol || "").toUpperCase(), Date.now() + FUTURES_FORCE_REFRESH_MS);
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      if (intentDir && intentDir !== posSide) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "POSITION_SIDE_MISMATCH", status_reason: "POSITION_SIDE_MISMATCH" });
        continue;
      }
      actionSide = posSide === "SHORT" ? "BUY" : "SELL";
      fillPrice = computeFillPrice({ side: actionSide, nextOpen, slippageBps });

      const sub = Math.min(qtyFraction, newSize);
      if (sub <= 0) {
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "NO_POSITION", status_reason: "NO_POSITION" });
        continue;
      }
      qtyFraction = sub;
      const nextNotional = newSize - sub;
      if (nextNotional <= 0) {
        newSize = 0;
        newAvg = null;
        nextPosSide = null;
      } else {
        newSize = nextNotional;
      }
    } else {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "UNKNOWN_INTENT", status_reason: "UNKNOWN_INTENT" });
      continue;
    }

    if (intentIsEntry && useBudget) {
      const nextBudgetUsedKrw = Number.isFinite(budgetMaxForIntent) && Number.isFinite(qtyFraction)
        ? (budgetMaxForIntent * qtyFraction)
        : null;
      const qtyChanged = Math.abs(Number(it.qty_pct || 0) - Number(qtyFraction || 0)) > 1e-9;
      const budgetChanged = Math.abs(Number(it.budget_max_krw || 0) - Number(budgetMaxForIntent || 0)) > 1e-9;
      const budgetUsedChanged = Math.abs(Number(it.budget_used_krw || 0) - Number(nextBudgetUsedKrw || 0)) > 1e-9;
      if (qtyChanged || budgetChanged || budgetUsedChanged || fixedQtyRestore.restored) {
        await patchIntent(it.intent_id, {
          qty_pct: qtyFraction,
          qty_fraction: qtyFraction,
          budget_max_krw: budgetMaxForIntent,
          budget_used_krw: nextBudgetUsedKrw,
          features_json: it.features_json,
        });
        it.qty_pct = qtyFraction;
        it.qty_fraction = qtyFraction;
        it.budget_max_krw = budgetMaxForIntent;
        it.budget_used_krw = nextBudgetUsedKrw;
      }
    }

    const isLiveExecution = liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN";
    if (!isLiveExecution && intentIsEntry) {
      try {
        const paperExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: it.event,
          side: actionSide,
          features: it.features_json,
          nowMs: Number(execBarCloseMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
        if (paperExitProfile && paperExitProfile.profile) {
          const profile = String(paperExitProfile.profile).toUpperCase();
          appliedExitProfile = profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
        }
        if (paperExitProfile && paperExitProfile.reason) {
          appliedExitProfileReason = String(paperExitProfile.reason);
        }
        if (paperExitProfile && paperExitProfile.rules && typeof paperExitProfile.rules === "object") {
          appliedExitRules = cloneExitRules(paperExitProfile.rules);
        }
        const rollback = (paperExitProfile && paperExitProfile.rollback && typeof paperExitProfile.rollback === "object")
          ? paperExitProfile.rollback
          : null;
        const rollbackUntilMsRaw = Number(rollback ? rollback.rollbackUntilMs : NaN);
        appliedExitRollbackActive = !!(rollback && rollback.rollbackActive);
        appliedExitRollbackUntilMs = Number.isFinite(rollbackUntilMsRaw)
          ? rollbackUntilMsRaw
          : null;
        appliedExitRollbackReason = rollback && rollback.rollbackReason
          ? String(rollback.rollbackReason)
          : null;
      } catch (paperExitErr) {
        console.warn(
          `[PAPER_EXIT_PROFILE_RESOLVE_FAIL] ${String(exchange || "").toUpperCase()} ${String(symbol || "").toUpperCase()} ` +
          `${paperExitErr && paperExitErr.message ? paperExitErr.message : String(paperExitErr)}`
        );
      }
    }

    const liveMarketRegimeCohort = resolveLiveMarketRegimeCohort({ symbol, posMeta });
    if (isLiveExecution) {
      if (liveCfg.executionMode === "LIVE" && !liveCfg.liveEnabled) {
        const liveReason = liveCfg.reason || "LIVE_DISABLED";
        await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: liveReason, status_reason: "LIVE_DISABLED" });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: "LIVE",
          reason: liveReason,
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta,
            exitRules: appliedExitRules || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        continue;
      }
      var nativeProtectionMetaPatch = null;
      var makerFirstMetaPatch = null;
      let liveQtyFraction = qtyFraction;
      let liveMaxFractionAllowed = maxFractionAllowed;
      const liveExitCurrentQtyPct = resolveLiveExitCurrentQtyPct({
        exchange,
        position: pos,
        fallbackQtyPct: prevSize,
      });
      const liveSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
      const liveSignalDocId = it.signal_doc_id || (it.features_json && it.features_json.signal_doc_id) || null;
      const liveEntryEventId = it.entry_event_id || (it.features_json && it.features_json.entry_event_id) || null;
      if (intent === "EXIT" && useBudget && Number.isFinite(liveExitCurrentQtyPct) && liveExitCurrentQtyPct > 0) {
        liveQtyFraction = Math.min(1, qtyFraction / liveExitCurrentQtyPct);
        liveMaxFractionAllowed = Number.isFinite(maxFractionAllowed)
          ? Math.min(1, maxFractionAllowed / liveExitCurrentQtyPct)
          : liveQtyFraction;
      }
      if (isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent })) {
        const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
          env: process.env,
          intentRow: it,
          liveCfg,
          referencePrice: fillPrice || nextOpen || (it.features_json && it.features_json.signal_price) || it.signal_price,
          requestId: it.request_id || it.intent_id || liveSignalId,
        }).catch((error) => ({
          ok: false,
          reason: "V2_DISCOVERY_BRIDGE_THROWN",
          error_message: error && error.message ? error.message : String(error),
        }));
        if (handoff && handoff.ok === true) {
          const requestBody = handoff.request && handoff.request.body ? handoff.request.body : {};
          const requestBundle = requestBody.bundle || {};
          const requestPermit = requestBody.executionPermit || {};
          const routeReason = "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE";
          const handoffSignalId = liveSignalId;
          await markIntentStatus(it.intent_id, "SUPERSEDED_BY_V2_PROTECTED_ENTRY", {
            cancel_reason: routeReason,
            status_reason: routeReason,
            cancel_note: "Legacy order intent was superseded by V2 productionEntryLiveEndpoint/productionEntryRoute; not a drop/cancel.",
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          });
          const handoffSignalClaim = await claimSignalForProgressAlert({
            signalId: handoffSignalId,
            runId,
            consumedAtIso: new Date().toISOString(),
            execBarCloseMs,
            execBarCloseUtc,
            reason: routeReason,
            meta: {
              intent,
              order_intent_id: it.intent_id || null,
              v2_discovery_bridge_reason: handoff.reason || null,
              v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
              v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
            },
          });
          if (handoffSignalClaim.ok !== true) {
            continue;
          }
          sendSignalProgressAlert({
            exchange,
            symbol,
            event: it.event,
            side: actionSide,
            tf: signalTf,
            qtyPct: qtyFraction,
            executionMode: liveCfg.executionMode,
            source: "SERVER",
            authoritative: true,
            progressReason: routeReason,
            pendingReason: "IMMEDIATE_EXEC",
            signalId: handoffSignalId,
          }).catch((e) => {
            console.warn("[V2_DISCOVERY_HANDOFF_ALERT_FAIL]", e && e.message ? e.message : String(e));
          });
          continue;
        }
        const routedDecision = handoff && (handoff.routedDecision || (handoff.request && handoff.request.routedDecision));
        const signalCriteriaGate = routedDecision && routedDecision.signal_criteria_gate;
        const marketDataQualityGate = routedDecision && routedDecision.market_data_quality_gate;
        const endpointReason = handoff && handoff.endpoint_result ? handoff.endpoint_result.reason || null : null;
        const postFillHandoff = classifyV2DiscoveryPostFillHandoff(handoff);
        const endpointPostFillCritical = postFillHandoff.unprotected_position_possible === true
          || String(endpointReason || "").trim().toUpperCase() === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL";
        let blockReason = "V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE";
        if (routedDecision && routedDecision.reason) {
          blockReason = String(routedDecision.reason).trim().toUpperCase();
        } else if (endpointReason) {
          blockReason = String(endpointReason).trim().toUpperCase();
        } else if (handoff && handoff.reason) {
          blockReason = String(handoff.reason).trim().toUpperCase();
        }
        if (postFillHandoff.exchange_write_performed === true && postFillHandoff.reason) {
          blockReason = postFillHandoff.reason;
        }
        await markIntentStatus(it.intent_id, postFillHandoff.status || (endpointPostFillCritical ? "FAILED_INTERNAL" : "CANCELED"), {
          cancel_reason: blockReason,
          status_reason: blockReason,
          cancel_note: JSON.stringify({
            note: postFillHandoff.note || (endpointPostFillCritical
              ? "V2 productionEntryLiveEndpoint reported post-fill protection critical state. Actual exchange entry may exist and requires protection repair verification."
              : "Discovery canary entry writes must execute through V2 productionEntryLiveEndpoint/productionEntryRoute, not paperBinanceRunner live order path."),
            bridge_reason: handoff && handoff.reason ? handoff.reason : null,
            bridge_error: handoff && handoff.error_message ? handoff.error_message : null,
            endpoint_reason: endpointReason,
            endpoint_post_fill_critical: endpointPostFillCritical,
            post_fill_exchange_write_performed: postFillHandoff.exchange_write_performed === true,
            post_fill_unprotected_position_possible: postFillHandoff.unprotected_position_possible === true,
            post_fill_side_effect: postFillHandoff.side_effect || null,
            router_reason: routedDecision && routedDecision.reason ? routedDecision.reason : null,
            router_detail: routedDecision && routedDecision.detail ? routedDecision.detail : null,
            signal_criteria_blockers: signalCriteriaGate && Array.isArray(signalCriteriaGate.blockers) ? signalCriteriaGate.blockers : [],
            market_data_quality_blockers: marketDataQualityGate && Array.isArray(marketDataQualityGate.blockers) ? marketDataQualityGate.blockers : [],
          }),
        });
        if (postFillHandoff.exchange_write_performed === true) {
          const postFillSignalId = liveSignalId;
          const postFillSignalClaim = await claimSignalForProgressAlert({
            signalId: postFillSignalId,
            runId,
            consumedAtIso: new Date().toISOString(),
            execBarCloseMs,
            execBarCloseUtc,
            reason: blockReason,
            critical: postFillHandoff.unprotected_position_possible === true,
            meta: {
              intent,
              order_intent_id: it.intent_id || null,
              v2_discovery_post_fill_exchange_write: true,
              v2_discovery_post_fill_unprotected_possible: postFillHandoff.unprotected_position_possible === true,
            },
          });
          if (postFillSignalClaim.ok !== true) {
            continue;
          }
          sendV2DiscoveryPostFillHandoffProgressAlert({
            exchange,
            symbol,
            event: it.event,
            side: actionSide,
            tf: signalTf,
            qtyPct: qtyFraction,
            executionMode: liveCfg.executionMode,
            signalId: postFillSignalId,
            blockReason,
            handoff,
            postFillHandoff,
          });
          continue;
        }
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: liveCfg.executionMode,
          reason: blockReason,
          note: endpointPostFillCritical
            ? "V2 production entry filled but protection was not confirmed; repair protection before any new entry."
            : "V2 discovery entry blocked before legacy live order submit",
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta,
            exitRules: appliedExitRules || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        continue;
      }
      let liveResult = null;
      const claim = await claimPendingIntentForExecution(it.intent_id, {
        runId,
        attemptAt,
        execBarCloseUtc,
        execBarCloseMs,
      });
      if (!claim || claim.ok !== true) continue;
      Object.assign(it, claim.doc || {});
      const trackLiveSubmit = shouldTrackLiveSubmitEvidence({
        intent,
        event: it.event,
        executionMode: liveCfg.executionMode,
      });
      if (trackLiveSubmit) {
        await patchLiveSubmitIntentEvidence(it.intent_id, buildLiveSubmitIntentPatch({
          state: "SUBMITTING",
          nowMs: Date.now(),
          executionMode: liveCfg.executionMode,
        }));
      }
      try {
        liveResult = await executeLiveFuturesOrder({
          liveCfg,
          exchange,
          symbol,
          tf: signalTf,
          side: actionSide,
          qtyFraction: liveQtyFraction,
          maxFractionAllowed: liveMaxFractionAllowed,
          riskBudget,
          budgetMaxOverride: budgetMaxForIntent,
          leverageResolvedOverride: leverageDecisionForIntent,
          manualRetry: manualRetryIntent,
          manualQtyBaseOverride: manualRetryQtyBase,
          posQtyBase,
          intentId: it.intent_id,
          intent,
          event: it.event,
          signalId: liveSignalId,
          signalDocId: liveSignalDocId,
          entryEventId: liveEntryEventId,
          features: it.features_json,
          positionMeta: posMeta,
          marketRegimeCohort: liveMarketRegimeCohort,
          sysCfg,
          bar,
          barCloseMs: execBarCloseMs,
          slippageBps,
        });
      } catch (err) {
        const errMsg = err && err.message ? err.message : String(err);
        const cancelNote = formatLiveExceptionNote(err);
        console.warn(
          `[LIVE_EXCEPTION] ex=${String(exchange || "").toUpperCase()} sym=${String(symbol || "").toUpperCase()} ` +
          `intent=${String(intent || "")} event=${String(it.event || "")} intent_id=${String(it.intent_id || "")} ` +
          `${cancelNote}`
        );
        await markIntentStatus(it.intent_id, "CANCELED", {
          cancel_reason: "LIVE_EXCEPTION",
          status_reason: "LIVE_EXCEPTION",
          cancel_note: cancelNote || errMsg,
          last_error: errMsg,
        });
        if (trackLiveSubmit) {
          await patchLiveSubmitIntentEvidence(it.intent_id, buildLiveSubmitIntentPatch({
            state: "EXCEPTION",
            nowMs: Date.now(),
            exceptionFamily: "LIVE_EXCEPTION",
            error: cancelNote || errMsg,
            executionMode: liveCfg.executionMode,
          }));
        }
        await sendLiveExitExceptionIntegrityAlert({
          exchange,
          symbol,
          event: it.event,
          intentId: it.intent_id,
          signalId: liveSignalId,
          error: cancelNote || errMsg,
          executionMode: liveCfg.executionMode,
        });
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: liveCfg.executionMode,
          reason: "LIVE_EXCEPTION",
          note: cancelNote || errMsg,
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta,
            exitRules: appliedExitRules || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        continue;
      }
      if (!liveResult.ok) {
        if (liveResult.reason === "NO_POSITION") {
          futuresForceRefresh.set(String(symbol || "").toUpperCase(), Date.now() + FUTURES_FORCE_REFRESH_MS);
        }
        if (String(liveResult.reason || "").toUpperCase().startsWith("TP_P1_")) {
          console.warn(`[TP_P1_SKIP] ex=${exchange} sym=${symbol} reason=${liveResult.reason} note=${liveResult.note || "NA"}`);
        }
        const cancelPatch = { cancel_reason: liveResult.reason || "LIVE_FAILED", status_reason: "LIVE_FAILED" };
        if (liveResult.note || liveResult.error) cancelPatch.cancel_note = liveResult.note || liveResult.error;
        if (liveResult.error) cancelPatch.last_error = liveResult.error;
        await markIntentStatus(it.intent_id, "CANCELED", cancelPatch);
        if (trackLiveSubmit) {
          await patchLiveSubmitIntentEvidence(it.intent_id, buildLiveSubmitIntentPatch({
            state: "REJECTED",
            nowMs: Date.now(),
            exceptionFamily: resolveLiveSubmitExceptionFamily(liveResult.reason || "LIVE_FAILED"),
            error: liveResult.error || liveResult.note || liveResult.reason || "LIVE_FAILED",
            executionMode: liveCfg.executionMode,
          }));
        }
        notifyTradeExitFailureAlert({
          exchange,
          symbol,
          event: it.event,
          side: actionSide,
          intent,
          executionMode: liveCfg.executionMode,
          reason: liveResult.reason || "LIVE_FAILED",
          note: liveResult.note || null,
          error: liveResult.error || null,
          qtyPct: qtyFraction,
          positionSideBefore: resolveFailureAlertPositionSide(pos),
          appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
          leverageReason: appliedLeverageReason,
          exitRules: appliedExitRules || null,
          ...buildFailureExitAlertPayload({
            event: it.event,
            pos,
            posMeta,
            exitRules: appliedExitRules || null,
            qtyFraction,
            prevSize,
            useBudget,
          }),
        });
        if (intent === "EXIT") {
          posMeta = await applyTpP1SkipOnCancel({
            exchange,
            symbol,
            pos,
            posMeta,
            event: it.event,
            reason: liveResult.reason,
            note: liveResult.note,
            bar,
            runId,
            executionMode: liveCfg.executionMode,
          });
        }
        continue;
      }
      if (trackLiveSubmit) {
        await patchLiveSubmitIntentEvidence(it.intent_id, buildLiveSubmitIntentPatch({
          state: "ACKED",
          nowMs: Date.now(),
          orderId: liveResult.liveOrderId || null,
          clientOrderId: liveResult.liveClientOrderId || null,
          exceptionFamily: null,
          error: null,
          executionMode: liveCfg.executionMode,
          execPrice: liveResult.execPrice,
          execQtyBase: liveResult.execQtyBase,
        }));
      }
      fillPrice = liveResult.execPrice;
      execPriceSource = liveResult.execPriceSource || "BINANCE_ORDER";
      executionMode = liveResult.mode || "LIVE";
      liveOrderId = liveResult.liveOrderId || null;
      execQtyBase = liveResult.execQtyBase;
      liveNotionalKrw = Number.isFinite(liveResult.notionalKrw) ? liveResult.notionalKrw : null;
      if (Number.isFinite(Number(liveResult.appliedLeverage)) && Number(liveResult.appliedLeverage) > 0) {
        appliedLeverage = Number(liveResult.appliedLeverage);
      }
      if (liveResult.leverageReason) appliedLeverageReason = String(liveResult.leverageReason);
      if (liveResult.appliedExitProfile) {
        const profile = String(liveResult.appliedExitProfile).toUpperCase();
        appliedExitProfile = profile === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";
      }
      if (liveResult.exitProfileReason) appliedExitProfileReason = String(liveResult.exitProfileReason);
      if (liveResult.appliedExitRules && typeof liveResult.appliedExitRules === "object") {
        appliedExitRules = cloneExitRules(liveResult.appliedExitRules);
      }
      if (liveResult.exitProfileRollbackActive != null) {
        appliedExitRollbackActive = liveResult.exitProfileRollbackActive === true;
      }
      if (liveResult.exitProfileRollbackUntilMs != null) {
        appliedExitRollbackUntilMs = Number.isFinite(Number(liveResult.exitProfileRollbackUntilMs))
          ? Number(liveResult.exitProfileRollbackUntilMs)
          : null;
      }
      if (liveResult.exitProfileRollbackReason != null) {
        appliedExitRollbackReason = String(liveResult.exitProfileRollbackReason || "").trim() || null;
      }
      if (Number.isFinite(liveResult.qtyFractionUsed)) {
        if (intent === "EXIT" && useBudget && Number.isFinite(prevSize) && prevSize > 0) {
          qtyFraction = Math.min(prevSize, liveResult.qtyFractionUsed * prevSize);
        } else {
          qtyFraction = liveResult.qtyFractionUsed;
        }
        liveAdjusted = true;
      }
      if (Number.isFinite(Number(liveResult.budgetMaxUsed)) && Number(liveResult.budgetMaxUsed) > 0) {
        budgetMaxForIntent = Number(liveResult.budgetMaxUsed);
      }
      // NOTE: `posMeta` is the function-parameter meta that is in scope here.
      // Do NOT write `posMeta: nextMeta` — `nextMeta` is declared ~300 lines
      // below in the same for-iteration block (inside the "live fills apply"
      // section) with `let`, so referencing it here throws
      // "Cannot access 'nextMeta' before initialization" (TDZ) and drops the
      // signal entirely. See 2026-04-20 ETHUSDT incident. The helper only
      // reads `posMeta` via resolveSimplifiedExitV2PositionFlag, which wants
      // the meta AS IT STANDS BEFORE this intent's fill-derived patch, i.e.
      // exactly the outer `posMeta`.
      nativeProtectionMetaPatch = buildNativeProtectionMetaPatch({
        nativeProtection: liveResult && liveResult.nativeProtection,
        intent,
        execBarCloseMs,
        posMeta,
      });
      // Maker-first telemetry from the entry helper (null if the flag is
      // off or this was an EXIT — exits still use a plain market order).
      // Persisted on the position meta below so the dashboards + audit
      // scripts can answer "how much did maker-first save us this month"
      // without re-parsing logs.
      if (liveResult && liveResult.makerFirst && typeof liveResult.makerFirst === "object") {
        makerFirstMetaPatch = {
          entry_maker_first_mode: liveResult.makerFirst.mode || null,
          entry_maker_first_ref_price: Number.isFinite(Number(liveResult.makerFirst.refPrice))
            ? Number(liveResult.makerFirst.refPrice) : null,
          entry_maker_first_limit_price: Number.isFinite(Number(liveResult.makerFirst.limitPrice))
            ? Number(liveResult.makerFirst.limitPrice) : null,
          entry_maker_first_limit_exec_qty: Number.isFinite(Number(liveResult.makerFirst.limitExecutedQty))
            ? Number(liveResult.makerFirst.limitExecutedQty) : null,
          entry_maker_first_market_exec_qty: Number.isFinite(Number(liveResult.makerFirst.marketExecutedQty))
            ? Number(liveResult.makerFirst.marketExecutedQty) : null,
          entry_maker_first_savings_bps: Number.isFinite(Number(liveResult.makerFirst.savingsBps))
            ? Number(liveResult.makerFirst.savingsBps) : null,
          entry_maker_first_elapsed_ms: Number.isFinite(Number(liveResult.makerFirst.elapsedMs))
            ? Number(liveResult.makerFirst.elapsedMs) : null,
          entry_maker_first_error: liveResult.makerFirst.error || null,
          entry_maker_first_at_ms: Date.now(),
        };
      }
    }

    if (!Number.isFinite(fillPrice)) {
      await markIntentStatus(it.intent_id, "CANCELED", { cancel_reason: "BAD_FILL_PRICE", status_reason: "BAD_FILL_PRICE" });
      continue;
    }
    if (liveAdjusted) {
      if (intent === "ENTRY" || intent === "ADD") {
        const nextNotional = Number(avgPrevNotional || 0) + qtyFraction;
        if (nextNotional <= 0) {
          newSize = 0;
          newAvg = null;
          nextPosSide = null;
          avgNeedsUpdate = false;
        } else {
          newSize = nextNotional;
        }
      } else if (intent === "EXIT") {
        const nextNotional = Math.max(0, prevSize - qtyFraction);
        if (nextNotional <= 0) {
          newSize = 0;
          newAvg = null;
          nextPosSide = null;
        } else {
          newSize = nextNotional;
        }
      }
    }
    if (avgNeedsUpdate && Number.isFinite(avgPrevNotional)) {
      const nextNotional = Number(avgPrevNotional || 0) + qtyFraction;
      if (nextNotional > 0) {
        if (newAvg === null) newAvg = fillPrice;
        else newAvg = (newAvg * avgPrevNotional + fillPrice * qtyFraction) / nextNotional;
      }
    }
    const newState = newSize <= 0 ? "FLAT" : "ACTIVE";
    const sizeDelta = newSize - prevSize;

    let notionalKrw = useBudget
      ? (liveNotionalKrw != null ? liveNotionalKrw : (budgetMaxForIntent * qtyFraction))
      : null;
    if (!Number.isFinite(notionalKrw) || notionalKrw <= 0) {
      const baseQty = Number.isFinite(execQtyBase) && execQtyBase > 0
        ? execQtyBase
        : (!useBudget && Number.isFinite(qtyFraction) && qtyFraction > 0 ? qtyFraction : null);
      if (Number.isFinite(baseQty) && Number.isFinite(fillPrice) && fillPrice > 0) {
        notionalKrw = baseQty * fillPrice;
      }
    }
    const notional = Number.isFinite(notionalKrw) ? notionalKrw : 1.0;
    const feeValue = computeFeeValue({ notional, feeBps });

    const qtyBaseDelta = Number.isFinite(execQtyBase)
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let newQtyBase = Number.isFinite(posQtyBase) ? posQtyBase : 0;
    if (Number.isFinite(qtyBaseDelta)) {
      if (intent === "ENTRY" || intent === "ADD") newQtyBase += qtyBaseDelta;
      else if (intent === "EXIT") newQtyBase = Math.max(0, newQtyBase - qtyBaseDelta);
    }

    const signalPrice = Number(it.signal_price);
    const signalPriceDiff = Number.isFinite(signalPrice) ? (fillPrice - signalPrice) : null;
    const signalPriceDiffPct = (Number.isFinite(signalPrice) && signalPrice !== 0) ? (signalPriceDiff / signalPrice) : null;
    const opening = prevSize <= 0 && newSize > 0;
    const positionSideBefore = normalizePositionSide(
      posSide ||
      pos.position_side ||
      pos.side ||
      (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
    );
    const execQtyBaseForPnl = Number.isFinite(execQtyBase) && execQtyBase > 0
      ? Number(execQtyBase)
      : (Number.isFinite(notionalKrw) && Number.isFinite(fillPrice) && fillPrice > 0 ? (notionalKrw / fillPrice) : null);
    let realizedPnlQuote = null;
    if (intent === "EXIT") {
      const avgBefore = Number(pos.avg_price);
      const sideBefore = positionSideBefore || (String(actionSide || "").toUpperCase() === "BUY" ? "SHORT" : "LONG");
      if (Number.isFinite(avgBefore) && Number.isFinite(execQtyBaseForPnl) && execQtyBaseForPnl > 0) {
        const gross = (sideBefore === "SHORT")
          ? ((avgBefore - fillPrice) * execQtyBaseForPnl)
          : ((fillPrice - avgBefore) * execQtyBaseForPnl);
        realizedPnlQuote = gross - (Number.isFinite(feeValue) ? feeValue : 0);
      }
    }
    const closeRatio = intent === "EXIT"
      ? resolveIntentFillCloseRatio({ qtyFraction, prevSize, useBudget })
      : null;
    const canonicalExitAlertPayload = intent === "EXIT"
      ? buildCanonicalExitAlertPayload({
        event: it.event,
        position: pos,
        posMeta,
        exitRules: appliedExitRules || null,
        observedQtyRatio: closeRatio ?? qtyFraction,
        fullExit: newState === "FLAT",
      })
      : null;
    const exitContractAlertPayload = intent === "EXIT"
      ? buildExitContractAlertPayload({
        pos,
        posMeta,
        exitRules: appliedExitRules || null,
        observedQtyAbs: execQtyBase,
      })
      : null;
    const intentSignalId = it.signal_id || (it.features_json && it.features_json.signal_id) || null;
    const intentSignalDocId = it.signal_doc_id ||
      (it.features_json && it.features_json.signal_doc_id) ||
      deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: it.signal_bar_close_time_utc_ms || it.exec_bar_close_time_utc_ms,
        event: it.event,
        signalId: intentSignalId,
      });
    const entryEventIdFromIntent = buildEntryEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      event: it.event,
    });
    const entrySignalTypeFromIntent = normalizeEvent(it.event) || null;
    const entryGradeFromIntent = String(
      (it.features_json && (it.features_json.entry_grade || it.features_json.entry_timing_tier || it.features_json.entry_tier)) || ""
    ).toUpperCase() || null;
    const entryQtyProfileFromIntent = String(
      (it.features_json && (it.features_json.entry_qty_profile || it.features_json.entry_qty_tier || it.features_json.qty_profile)) || ""
    ).toUpperCase() || null;
    const intentEntryEventId = String(
      (it.entry_event_id || (it.features_json && it.features_json.entry_event_id) || "")
    ).trim() || null;
    const intentEntrySignalType = String(
      (it.entry_signal_type || (it.features_json && it.features_json.entry_signal_type) || "")
    ).toUpperCase() || null;
    const fillEntryLineage = resolveEntryLineageForFill({
      opening,
      entryEventIdFromIntent,
      entrySignalTypeFromIntent,
      intentEntryEventId,
      intentEntrySignalType,
      posMeta,
    });
    const entryEventIdForFill = fillEntryLineage.entryEventId;
    const entrySignalTypeForFill = fillEntryLineage.entrySignalType;
    const tradeExecMs = (() => {
      const n = Date.parse(String(it.created_at || ""));
      return Number.isFinite(n) ? n : null;
    })();
    const linkedTradeId = buildTradeId({
      exchange,
      symbol,
      event: it.event,
      execBarCloseMs: execBarCloseMs,
      execMs: tradeExecMs,
    });

    const fillWrite = await upsertFill({
      intentId: it.intent_id,
      tradeId: linkedTradeId,
      runId,
      exchange,
      symbol,
      tf,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      side: actionSide,
      event: it.event,
      qtyPct: qtyFraction,
      execPrice: fillPrice,
      feeBps,
      slippageBps,
      feeValue,
      notional,
      notionalKrw,
      budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      execPriceSource: execPriceSource || "BAR_OPEN",
      executionMode,
      liveOrderId,
      execQtyBase,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      signalPrice: Number.isFinite(signalPrice) ? signalPrice : null,
      signalPriceDiff,
      signalPriceDiffPct,
      signalPriceSource: it.signal_price_source || null,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      leverageApplied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
      leverageReason: appliedLeverageReason,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      exitProfile: appliedExitProfile || null,
      exitProfileReason: appliedExitProfileReason || null,
      decisionReason: it.reason || it.event || null,
      extra: buildInternalFillCanonicalExtra({
        canonicalExitAlertPayload,
        exitContractAlertPayload,
      }),
    });
    if (intent === "EXIT" && fillWrite && fillWrite.fill_id) {
      try {
        await recordInternalCanonicalExitTransitions({
          exchange,
          symbol,
          fillId: fillWrite.fill_id,
          tradeId: linkedTradeId,
          tradeMs: tradeExecMs || execBarCloseMs,
          event: it.event,
          canonicalExitAlertPayload,
          exitContractAlertPayload,
          entryEventId: entryEventIdForFill,
          signalDocId: intentSignalDocId,
        });
      } catch (e) {
        console.warn("[INTERNAL_CANONICAL_EXIT_TRANSITION_FAIL]", e && e.message ? e.message : String(e));
      }
    }
    const canonicalExitAlertBlock = intent === "EXIT"
      ? resolveCanonicalExitAlertBlock(canonicalExitAlertPayload)
      : { blocked: false, reason: null, issueCodes: [] };
    if (
      !shouldSuppressInternalLiveExitFillAlert({ exchange, executionMode, intent }) &&
      canonicalExitAlertBlock.blocked !== true
    ) {
      await dispatchTradeExecutionAlert({
        exchange,
        symbol,
        event: it.event,
        side: actionSide,
        intent,
        executionMode,
        notional,
        execQtyBase,
        execPrice: fillPrice,
        closeRatio,
        fullExit: intent === "EXIT" && newState === "FLAT",
        realizedPnl: realizedPnlQuote,
        ...(canonicalExitAlertPayload || {}),
        positionSideBefore,
        positionSideAfter: newState === "FLAT" ? null : nextPosSide || positionSideBefore,
        appliedLeverage: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
        leverageReason: appliedLeverageReason,
        exitProfile: appliedExitProfile || null,
        exitProfileReason: appliedExitProfileReason || null,
        exitRules: appliedExitRules || null,
        ...(exitContractAlertPayload || {}),
        features: it.features_json || {},
        runId,
        sourceFillId: fillWrite && fillWrite.fill_id ? fillWrite.fill_id : null,
      });
    } else if (intent === "EXIT" && canonicalExitAlertBlock.blocked === true) {
      console.warn(
        `[INTERNAL_CANONICAL_EXIT_ALERT_SUPPRESSED] exchange=${exchange} symbol=${symbol} reason=${canonicalExitAlertBlock.reason || "UNKNOWN"} issue_codes=${(canonicalExitAlertBlock.issueCodes || []).join(",") || "-"}`,
      );
    }

    await markIntentStatus(it.intent_id, "FILLED", {
      filled_at: new Date().toISOString(),
      exec_price: fillPrice,
      status_reason: "FILLED",
      exec_side: actionSide,
    });

    if (useBudget && Number.isFinite(totalUsedKrw) && Number.isFinite(totalMaxKrw)) {
      totalUsedKrw = Math.max(0, Number(totalUsedKrw) + (sizeDelta * budgetMaxForIntent));
    }

    const ev = String(it.event || "").toUpperCase();
    const closing = newState === "FLAT";
    const openingOrAdd = (intent === "ENTRY" || intent === "ADD") && newState === "ACTIVE";
    const forceLiveReconcile = shouldForceImmediateLiveFuturesReconcile({ exchange, executionMode });
    const applyOptimisticFillProjection = !forceLiveReconcile;
    const metaSide = String(posSide || nextPosSide || "LONG").toUpperCase();
    const marketRegimeRow = opening ? readOpenClawMarketRegimeRow(symbol) : null;
    const marketRegimeCohort = normalizeOpenClawCohort(marketRegimeRow && marketRegimeRow.cohort);
    let nextMeta = mergeMeta(posMeta, {
      last_fill_intent: it.intent_id,
      last_fill_side: actionSide,
      position_side: nextPosSide,
      intent,
    });
    if (opening || closing) {
      nextMeta = mergeMeta(nextMeta, buildOpenCloseTransitionMetaPatch({
        closing,
        includeEntryRiskReset: false,
      }));
    }
    if (openingOrAdd) {
      const entryExitAdjustment = applyEntryExitRuleRuntimeAdjustments({
        exchange,
        rules: appliedExitRules,
        features: it.features_json,
        sysCfg,
        cohort: marketRegimeCohort,
        market: symbol,
      });
      const exitPolicySrc = entryExitAdjustment.exitPolicySrc;
      const tp1LadderState = entryExitAdjustment.tp1LadderState;
      appliedExitRules = cloneExitRules(entryExitAdjustment.appliedExitRules);
      nextMeta = mergeMeta(nextMeta, {
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: (exitPolicySrc && exitPolicySrc !== "BINANCE_DEFAULT")
          ? `${appliedExitProfileReason || "BASE_PROFILE"}+${exitPolicySrc}`
          : (appliedExitProfileReason || null),
        exit_rules_override: cloneExitRules(appliedExitRules),
        tp1_ladder_enabled: tp1LadderState ? tp1LadderState.enabled !== false : null,
        tp1_ladder_stage: tp1LadderState ? tp1LadderState.stage : null,
        tp1_ladder_profile: tp1LadderState ? tp1LadderState.profile : null,
        tp1_ladder_reason: tp1LadderState ? tp1LadderState.reason : null,
        tp1_ladder_realized_n: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.realized_n : null,
        tp1_ladder_tp0_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_hit_rate : null,
        tp1_ladder_tp1_hit_rate: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp1_hit_rate : null,
        tp1_ladder_tp0_to_tp1_conversion: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.tp0_to_tp1_conversion : null,
        tp1_ladder_fee_adjusted_expectancy: tp1LadderState && tp1LadderState.kpi ? tp1LadderState.kpi.fee_adjusted_expectancy : null,
        exit_profile_rollback_active: appliedExitRollbackActive === true,
        exit_profile_rollback_until_ms: Number.isFinite(appliedExitRollbackUntilMs) ? appliedExitRollbackUntilMs : null,
        exit_profile_rollback_reason: appliedExitRollbackReason || null,
        exit_policy_source: exitPolicySrc || null,
        simplified_exit_v2_enabled: resolveSimplifiedExitV2PositionFlag({ currentMeta: nextMeta }),
      });
      const runtimeExitInvariant = await enforceEntryRuntimeExitState({
        exchange,
        symbol,
        appliedExitRules,
        posMeta: nextMeta,
        features: it.features_json,
        cohort: marketRegimeCohort,
        sysCfg,
        entryPrice: fillPrice,
        leverage: appliedLeverage,
        execBarCloseMs,
      });
      if (runtimeExitInvariant.repaired) {
        appliedExitRules = cloneExitRules(runtimeExitInvariant.appliedExitRules);
        nextMeta = runtimeExitInvariant.meta;
      }
    }
    if (opening) {
      const initialStopPrice = computeInitialStopPriceForEntry({
        avgPrice: fillPrice,
        leverage: appliedLeverage,
        side: nextPosSide,
        slRatio: appliedExitRules && appliedExitRules.SL,
        features: it.features_json,
        nativeProtectionStopPrice: it && it.features_json && it.features_json.stop_price,
      });
      const initialStopSource = resolveInitialStopSource({
        avgPrice: fillPrice,
        side: nextPosSide,
        features: it.features_json,
        nativeProtectionStopPrice: it && it.features_json && it.features_json.stop_price,
      });
      const entryRDistance = (Number.isFinite(initialStopPrice) && Number.isFinite(fillPrice))
        ? Math.abs(Number(initialStopPrice) - Number(fillPrice))
        : null;
      nextMeta = mergeMeta(nextMeta, buildOpeningFillMetaPatch({
        leverageValue: appliedLeverage,
        leverageReason: appliedLeverageReason,
        signalTfMs,
        newSize,
        features: it.features_json,
        marketRegimeCohort,
        marketRegimeRow,
        entryEventIdFromIntent,
        entrySignalTypeFromIntent,
        entryGradeFromIntent,
        entryQtyProfileFromIntent,
        signalBarCloseTimeUtcMs: it.signal_bar_close_time_utc_ms,
        execBarCloseMs,
        initialStopPrice,
        initialStopSource,
        entryRDistance,
        trailRMultiple: appliedExitRules && appliedExitRules.TRAIL_R_MULTIPLE,
        // Raw material for P0 synthetic entry_event_id fallback.
        exchange,
        symbol,
        metaSide: nextPosSide,
        includeLeverageReason: true,
        includeEntryRiskFields: true,
      }));
      nextMeta = mergeMeta(nextMeta, buildStoredExitLedgerMetaPatch({
        position: pos,
        posMeta: nextMeta,
        exitRules: appliedExitRules || null,
        qtyBaseOverride: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
        entryQtyBaseOverride: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
      }));
      if (makerFirstMetaPatch) {
        nextMeta = mergeMeta(nextMeta, makerFirstMetaPatch);
      }
    }
    let profitableTrailCooldownMeta = null;
    if (closing) {
      nextMeta = mergeMeta(nextMeta, buildClosingFillMetaPatch({
        execBarCloseMs,
        metaSide,
        includeExitProfileRollback: true,
      }));
      profitableTrailCooldownMeta = buildSameDirectionTrailProfitCooldownMetaPatch({
        event: ev,
        realizedPnlQuote,
        positionSide: metaSide,
        exitWallMs: resolveEventRefMs(execBarCloseMs),
        source: "INTENT_FILL",
      });
    }
    if (isTpP0EventLocal(ev) && newState === "ACTIVE") {
      nextMeta = applyTpP0IntentFillMetaUpdate({
        nextMeta,
        fillPrice,
        qtyFraction,
        execBarCloseMs,
        entryEventIdForFill,
        applyOptimisticFillProjection,
      });
    }
    if ((ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_")) && newState === "ACTIVE") {
      const tpP1Update = applyTpP1IntentFillMetaUpdate({
        exchange,
        pos,
        nextMeta,
        metaSide,
        fillPrice,
        execBarCloseMs,
        entryEventIdForFill,
        applyOptimisticFillProjection,
      });
      nextMeta = tpP1Update.meta;
      const { nextTrailHigh, nextTrailLow } = tpP1Update;
      console.warn(
        `[TP1_TRAIL_ARMED] ${symbol} side=${metaSide || "UNKNOWN"} source=INTENT_FILL ` +
        `event=${ev} fill_price=${fillPrice ?? "NA"} trail_high=${nextTrailHigh ?? "NA"} ` +
        `trail_low=${nextTrailLow ?? "NA"} intent_id=${it.intent_id || "NA"}`
      );
      triggerExitWorkerRun({
        reason: `TP1_TRAIL_ARMED_${String(exchange || "").toUpperCase()}_${String(symbol || "").toUpperCase()}`,
        targetSymbols: [String(symbol || "").toUpperCase()],
        targetExchange: String(exchange || "").toUpperCase(),
      }).catch((e) => {
        console.warn("[EXIT_WORKER_SCALE_ON_FAIL][TP1_INTENT_FILL]", e && e.message ? e.message : String(e));
      });
    }

    nextMeta = applyAddAndProtectionMetaOnFill({
      posMeta: nextMeta,
      intent,
      event: it.event,
      barCloseMs: execBarCloseMs,
      realizedPnlQuote,
      opening,
      closing,
      signalBarCloseMs: it.signal_bar_close_time_utc_ms,
      intentId: it.intent_id,
      signalId: intentSignalId,
      avgBefore: pos.avg_price,
      avgAfter: newAvg,
      sizeBefore: prevSize,
      sizeAfter: newSize,
      qtyPct: qtyFraction,
      qtyBase: qtyBaseDelta,
      lossPct: it.features_json && it.features_json._rescue_add_loss_pct,
      nativeProtectionMetaPatch: resolveOptimisticNativeProtectionMetaPatch({
        forceLiveReconcile,
        nativeProtectionMetaPatch,
      }),
    });
    if (newState === "ACTIVE") {
      nextMeta = mergeMeta(nextMeta, buildStoredExitLedgerMetaPatch({
        position: pos,
        posMeta: nextMeta,
        exitRules: appliedExitRules || null,
        qtyBaseOverride: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
      }));
    }

    let budgetUsedForPosition = useBudget ? (budgetMaxForIntent * newSize) : null;
    if (useBudget && String(exchange || "").toUpperCase().includes("BINANCE")) {
      const marketKey = String(symbol || "").toUpperCase();
      const riskBudgetForPosition = {
        ...(riskBudget || {}),
        maxKrw: budgetMaxForIntent,
        byMarket: {
          ...((riskBudget && riskBudget.byMarket) || {}),
          [marketKey]: budgetMaxForIntent,
        },
      };
      budgetUsedForPosition = resolveBinanceBudgetUsedKrw({
        position: {
          ...pos,
          symbol_or_pair_id: marketKey,
          symbol: marketKey,
          state: newState,
          size_pct: newSize,
          avg_price: newAvg,
          qty_base: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
          budget_max_krw: budgetMaxForIntent,
          budget_used_krw: null,
          meta: nextMeta,
        },
        riskBudget: riskBudgetForPosition,
        priceFallback: newAvg,
        qtyBaseFallback: Number.isFinite(newQtyBase) ? newQtyBase : null,
      });
    }

    const projectedMetaForWrite = forceLiveReconcile ? stripExchangeOwnedProjectionMeta(nextMeta) : nextMeta;
    const projectedMetaPatch = forceLiveReconcile
      ? buildMetaPatch(stripExchangeOwnedProjectionMeta(posMeta), projectedMetaForWrite)
      : null;
    if (forceLiveReconcile) {
      await upsertPositionMetaOnlyWithLatestRetry({
        exchange,
        symbol,
        runId,
        executionMode,
        position: pos,
        metaPatch: projectedMetaPatch,
        source: "INTENT_FILL",
        mutationKind: "POSITION_META_UPSERT",
        reason: "INTENT_FILL_FORCE_LIVE_RECONCILE",
      });
    } else {
      await upsertPositionWithLatestRetry({
        exchange,
        symbol,
        position: pos,
        state: newState,
        positionSide: nextPosSide,
        sizePct: newSize,
        avgPrice: newAvg,
        qtyBase: Number.isFinite(newQtyBase) ? newQtyBase : (pos.qty_base ?? null),
        runId,
        executionMode,
        budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
        budgetUsedKrw: useBudget ? budgetUsedForPosition : null,
        budgetSource: useBudget ? riskBudget.source : null,
        meta: projectedMetaForWrite,
        source: "INTENT_FILL",
        reason: "INTENT_FILL_PROJECTED_POSITION_WRITE",
      });
    }
    await maybeWriteV2ShadowEntryBootstrap({
      exchange,
      symbol,
      tf,
      intent,
      opening,
      newState,
      nextPosSide,
      fillPrice,
      newQtyBase,
      execQtyBase,
      intentRow: it,
      fillWrite,
      linkedTradeId,
      liveOrderId,
      entryEventIdForFill,
      execBarCloseMs,
      projectedMetaForWrite,
    });

    if (profitableTrailCooldownMeta) {
      const cooldownObservation = buildSameDirectionTrailProfitObservationPayload(profitableTrailCooldownMeta);
      if (cooldownObservation) {
        try {
          await upsertSameDirectionTrailProfitObservation({
            exchange,
            symbol,
            exitDir: cooldownObservation.exit_dir,
            exitWallMs: cooldownObservation.exit_wall_ms,
            exitEvent: cooldownObservation.exit_event,
            realizedPnl: cooldownObservation.realized_pnl,
            source: cooldownObservation.source || "INTENT_FILL",
          });
          sameDirectionTrailProfitObservation = {
            ...(sameDirectionTrailProfitObservation && typeof sameDirectionTrailProfitObservation === "object" ? sameDirectionTrailProfitObservation : {}),
            same_direction_trail_profit: cooldownObservation,
          };
        } catch (e) {
          console.warn("[SAME_DIRECTION_TRAIL_COOLDOWN_OBS_FAIL]", e && e.message ? e.message : String(e));
        }
      }
    }

    if (forceLiveReconcile) {
      try {
        const sync = await syncFuturesPositionOnly({
          runId: `RUN__INTENT_FILL_RECONCILE__${String(exchange || "").toUpperCase()}__${String(symbol || "").toUpperCase()}__${Date.now()}`,
          exchange,
          symbol,
        });
        if (sync && sync.ok && sync.position) {
          pos = sync.position;
          posMeta = (sync.position.meta && typeof sync.position.meta === "object") ? { ...sync.position.meta } : posMeta;
          posSide = sync.position.position_side || posSide;
          posQtyBase = resolvePosQtyBase(sync.position);
        }
      } catch (e) {
        console.warn("[INTENT_FILL_RECONCILE_FAIL]", e && e.message ? e.message : String(e));
      }
    }

    if (!forceLiveReconcile) {
      pos = { ...pos, state: newState, size_pct: newSize, avg_price: newAvg, position_side: nextPosSide, meta: nextMeta, qty_base: Number.isFinite(newQtyBase) ? newQtyBase : pos.qty_base };
      posMeta = nextMeta;
      posSide = nextPosSide;
      posQtyBase = Number.isFinite(newQtyBase) ? newQtyBase : posQtyBase;
    }
    if (intent === "ADD" && executionMode === "LIVE") {
      const rescueAddAlert = buildRescueAddRepriceAlertContext({
        position: pos,
        fallbackMeta: nextMeta,
        fallbackAvgBefore: pos.avg_price,
        fallbackAvgAfter: newAvg,
        fallbackAddQtyPct: qtyFraction,
        fallbackAddQtyBase: qtyBaseDelta,
      });
      sendRescueAddRepriceAlert({
        exchange,
        symbol,
        event: it.event,
        executionMode,
        position: pos,
        avgBefore: rescueAddAlert.avgBefore,
        avgAfter: rescueAddAlert.avgAfter,
        addQtyPct: rescueAddAlert.addQtyPct,
        addQtyBase: rescueAddAlert.addQtyBase,
        fillPrice,
        exitRules: appliedExitRules || null,
        nativeProtectionMeta: rescueAddAlert.nativeProtectionMeta,
      }).catch((e) => {
        console.warn("[RESCUE_ADD_REPRICE_ALERT_FAIL]", e && e.message ? e.message : String(e));
      });
    }

    await upsertTradeEvent({
      runId,
      exchange,
      symbol,
      tf,
      event: it.event,
      side: actionSide,
      execBarCloseTimeUtc: execBarCloseUtc,
      execBarCloseTimeUtcMs: execBarCloseMs,
      execMs: tradeExecMs,
      intentId: it.intent_id,
      fillId: fillWrite && fillWrite.fill_id,
      signalId: intentSignalId,
      signalDocId: intentSignalDocId,
      entryEventId: entryEventIdForFill,
      entrySignalType: entrySignalTypeForFill,
      execPrice: fillPrice,
      qtyPct: qtyFraction,
      feeValue,
      note: `FILLED_INTENT:${it.intent_id}`,
      pnl: null,
      notionalKrw,
      budgetMaxKrw: useBudget ? budgetMaxForIntent : null,
      budgetUsedKrw: notionalKrw,
      qtyFraction: useBudget ? qtyFraction : null,
      meta: {
        trading_mode,
        position_side: nextPosSide,
        intent,
        execution_mode: executionMode,
        leverage_applied: Number.isFinite(appliedLeverage) ? appliedLeverage : null,
        leverage_reason: appliedLeverageReason || null,
        exit_profile: appliedExitProfile || "BASE",
        exit_profile_reason: appliedExitProfileReason || null,
      },
      executionMode,
      featuresJson: it.features_json && typeof it.features_json === "object" ? it.features_json : null,
      requestId: it.request_id || null,
      decisionReason: it.decision_reason || it.reason || it.event || null,
    });

      fillsExecuted += 1;
    }
  };

  await executeIntentList(sortIntentsForExecution(intents));

  pos = await getPositionReadView({ exchange, symbol });

  const nextExecMs = Number.isFinite(execTfMs) ? addMs(barCloseMs, execTfMs) : addMs(barCloseMs, 60 * 60 * 1000);
  const nextExecUtc = msToUtcZ(nextExecMs);
  const alignedSignalBar = Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs) && (Number(barCloseMs) % signalTfMs === 0);
  const fallbackSignalBarMs = (Number.isFinite(signalTfMs) && Number.isFinite(barCloseMs))
    ? Math.floor(Number(barCloseMs) / signalTfMs) * signalTfMs
    : null;
  const signalBarCloseMs = alignedSignalBar
    ? Number(barCloseMs)
    : (Number.isFinite(fallbackSignalBarMs) ? fallbackSignalBarMs : null);
  const signalBarCloseUtc = Number.isFinite(signalBarCloseMs) ? msToUtcZ(signalBarCloseMs) : null;
  const nativeInitialSignals = Number.isFinite(signalBarCloseMs)
    ? await loadServerNativeInitialSignals({
      exchange,
      symbol,
      signalTf,
      barCloseMs: signalBarCloseMs,
    })
    : [];

  const allowInternalExitSignals = canEvaluateInternalExitSignalsForBar({ posMeta, barCloseMs });
  const timeStopSignal = (allowInternalExitSignals && exUpper.includes("BINANCE"))
    ? buildTimeStopExitSignal({ position: pos, bar, posMeta, barCloseMs, signalTfMs, maxHoldBars })
    : null;
  const signalLeverage = resolvePositionLeverage({ position: pos, fallback: leverage });

  // 2026-04-28 F2 Phase 5 hotfix #5 — V2 server-native ENTRY signal
  // generator (Pine v6.1.1.0 parity port). The earlier hotfix #1-#4
  // tried to inject the generator output into `internalSignalsRaw`
  // and let dedupe/handoff carry it through, but the legacy paper
  // signal pipeline silently drops V2-server-native signals at
  // multiple downstream points (firestore signal_doc_id lookup, paper
  // intent persistence, isExternalEntrySignalCandidate→external path
  // mismatch, etc.) regardless of the bypass we added at the handoff
  // gate.
  //
  // Direct-batch handoff: the generator output is dispatched
  // immediately into runV2DiscoveryCanaryServerSignalHandoff (the same
  // bridge the legacy fan-in calls). It does NOT join
  // internalSignalsRaw, so the legacy paper pipeline never sees these
  // signals. Failures are logged + swallowed; nothing falls back to
  // V1.
  //
  // Disabled by default; enable via
  // DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED=1.
  try {
    const v2EntryGeneratorEnabled = (function() {
      const raw = String(process.env.DONBEOLJA_V2_SERVER_ENTRY_SIGNAL_GENERATOR_ENABLED || "0").trim().toLowerCase();
      return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
    })();
    if (v2EntryGeneratorEnabled) {
      const sameTfBars = await queryBars({ exchange, symbol, tf: signalTf, limit: 200 });
      const htfBars = await queryBars({ exchange, symbol, tf: "4h", limit: 70 });
      const cooldownState = await getV2ServerEntryCooldownState({ exchange, symbol, tf: signalTf });
      const v2GenResult = generateV2EntrySignals({
        exchange,
        symbol,
        tf: signalTf,
        bars: Array.isArray(sameTfBars) ? sameTfBars : [],
        htfBars: Array.isArray(htfBars) ? htfBars : [],
        position: pos,
        cooldownState,
        runId,
        barCloseMs: Number(barCloseMs),
      });
      if (v2GenResult && Array.isArray(v2GenResult.signals) && v2GenResult.signals.length > 0) {
        try {
          await setV2ServerEntryCooldownState({
            exchange,
            symbol,
            tf: signalTf,
            state: v2GenResult.cooldownStateNext,
          });
        } catch (cdErr) {
          console.warn("[V2_SERVER_ENTRY_COOLDOWN_PERSIST_FAIL]", cdErr?.message || cdErr);
        }
      }
      try {
        console.log(JSON.stringify({
          event: "v2_server_entry_signal_generator_run",
          ts: new Date().toISOString(),
          exchange,
          symbol,
          tf: signalTf,
          run_id: runId,
          skipped: v2GenResult ? v2GenResult.skipped === true : true,
          skip_reason: v2GenResult ? v2GenResult.skipReason : "GENERATOR_NULL",
          signals_n: v2GenResult && Array.isArray(v2GenResult.signals) ? v2GenResult.signals.length : 0,
          diagnostics: v2GenResult && v2GenResult.diagnostics
            ? {
              market_state: v2GenResult.diagnostics.market_state,
              htf_bias: v2GenResult.diagnostics.htf_bias,
              long_opportunity: v2GenResult.diagnostics.long_opportunity,
              short_opportunity: v2GenResult.diagnostics.short_opportunity,
              trigger_type_long: v2GenResult.diagnostics.trigger_type_long,
              trigger_type_short: v2GenResult.diagnostics.trigger_type_short,
              long_can_fire: v2GenResult.diagnostics.long_can_fire,
              short_can_fire: v2GenResult.diagnostics.short_can_fire,
            }
            : null,
        }));
      } catch (_) { /* observability only */ }

      // Direct-batch handoff per generated signal.
      const v2GenSignals = v2GenResult && Array.isArray(v2GenResult.signals) ? v2GenResult.signals : [];
      for (const sig of v2GenSignals) {
        try {
          const sigBarMs = Number(sig.bar_close_time_utc_ms);
          const sigBarUtc = Number.isFinite(sigBarMs) ? msToUtcZ(sigBarMs) : null;
          const features = { ...(sig.features || {}) };
          if (sig.bar_close_time_utc_ms != null) features.bar_close_time_utc_ms = sig.bar_close_time_utc_ms;
          if (sig.price != null) features.signal_price = sig.price;
          features.v2_server_native_signal_bypass = true;
          features.v2_discovery_signal_fan_in_handoff = true;
          features.v2_discovery_entry_filter_authority = "PRODUCTION_ENTRY_ROUTE";

          const v2SignalId = `SIG__V2_SERVER__${exchange}__${symbol}__${signalTf}__${sigBarMs || Date.now()}__${sig.event}__${sig.entry_grade}`;
          const handoffSignal = {
            signal_id: v2SignalId,
            signal_doc_id: null,
            event: sig.event,
            side: sig.side,
            qty_pct: Number(sig.qtyPct ?? sig.qty_pct ?? 1.0),
            reason: "V2_SERVER_NATIVE_GENERATOR",
            signal_bar_close_time_utc_ms: Number.isFinite(sigBarMs) ? sigBarMs : null,
            signal_bar_close_time_utc: sigBarUtc,
            signal_price: Number.isFinite(Number(sig.price)) ? Number(sig.price) : null,
            features,
          };

          const handoffIntentRow = buildV2DiscoverySignalFanInIntentRow({
            exchange,
            symbol,
            tf: signalTf,
            signal: handoffSignal,
            features,
            qtyFraction: Number(sig.qtyPct ?? sig.qty_pct ?? 1.0),
            intentExecutionMode: "PAPER",
            signalBarCloseUtcForIntent: sigBarUtc,
            signalBarCloseMsForIntent: Number.isFinite(sigBarMs) ? sigBarMs : null,
            intentSignalBarCloseUtc: sigBarUtc,
            intentSignalBarCloseMs: Number.isFinite(sigBarMs) ? sigBarMs : null,
            execBarCloseUtcForIntent: sigBarUtc,
            execBarCloseMsForIntent: Number.isFinite(sigBarMs) ? sigBarMs : null,
            signalDocId: null,
            signalPrice: Number.isFinite(Number(sig.price)) ? Number(sig.price) : null,
            runId,
          });

          const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
            env: process.env,
            intentRow: handoffIntentRow,
            liveCfg,
            referencePrice: Number.isFinite(Number(sig.price)) ? Number(sig.price)
              : Number(bar && (bar.close ?? bar.c)),
            requestId: handoffIntentRow.request_id,
          }).catch((error) => ({
            ok: false,
            reason: "V2_DISCOVERY_BRIDGE_THROWN",
            error_message: error && error.message ? String(error.message) : String(error),
          }));

          try {
            // Drill into nested block reasons so we can pinpoint where
            // the handoff was blocked when handoff.ok=false. Common
            // chain when the Server-Native ML/AI verdict is missing or
            // budget gate fails:
            //   handoff.reason = V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED
            //   handoff.endpoint_result.reason = ...
            //   built.reason / routedDecision.reason / sizingDecision
            const routedDecisionReason = handoff && handoff.routedDecision && handoff.routedDecision.reason
              ? String(handoff.routedDecision.reason) : null;
            const builtReason = handoff && handoff.request && handoff.request.routedDecision
              && handoff.request.routedDecision.reason
              ? String(handoff.request.routedDecision.reason) : null;
            const endpointResultReason = handoff && handoff.endpoint_result && handoff.endpoint_result.reason
              ? String(handoff.endpoint_result.reason) : null;
            const sizingNotApprovedReason = handoff && handoff.entrySizingDecision
              && handoff.entrySizingDecision.reason
              ? String(handoff.entrySizingDecision.reason) : null;
            const ledgerPersistenceReason = handoff && handoff.ledger_persistence
              && handoff.ledger_persistence.reason
              ? String(handoff.ledger_persistence.reason) : null;
            console.log(JSON.stringify({
              event: "v2_server_entry_signal_handoff_dispatched",
              ts: new Date().toISOString(),
              exchange,
              symbol,
              tf: signalTf,
              run_id: runId,
              signal_id: v2SignalId,
              direction: sig.event,
              entry_grade: sig.entry_grade,
              handoff_ok: handoff && handoff.ok === true,
              handoff_reason: handoff && handoff.reason ? String(handoff.reason) : null,
              handoff_error: handoff && handoff.error_message ? String(handoff.error_message) : null,
              routed_decision_reason: routedDecisionReason || builtReason,
              endpoint_result_reason: endpointResultReason,
              sizing_not_approved_reason: sizingNotApprovedReason,
              ledger_persistence_reason: ledgerPersistenceReason,
              handoff_keys: handoff ? Object.keys(handoff) : null,
            }));
          } catch (_) { /* observability only */ }
        } catch (handoffErr) {
          console.warn("[V2_SERVER_ENTRY_SIGNAL_HANDOFF_FAIL]", handoffErr?.message || handoffErr);
        }
      }
    }
  } catch (v2GenErr) {
    console.warn("[V2_SERVER_ENTRY_SIGNAL_GENERATOR_FAIL]", v2GenErr?.message || v2GenErr);
  }

  const internalSignalsRaw = [
    ...nativeInitialSignals,
    ...generateSignals({
      exchange,
      symbol,
      tf,
      bar,
      gate,
      position: pos,
      trading_mode,
      leverage: signalLeverage,
      exitProfileMode: liveCfg && liveCfg.exitProfileMode,
      currentBarCloseMs: Number(barCloseMs),
    }),
    ...(timeStopSignal ? [timeStopSignal] : []),
  ];
  const internalSignals = filterLiveFuturesInternalSignals({
    exchange,
    liveCfg,
    signals: finalizeInternalSignals({
      signals: internalSignalsRaw,
      posMeta,
      barCloseMs,
      fallbackUtc: signalBarCloseUtc,
      exchange,
      symbol,
    }),
    runId,
    symbol,
    tf,
  });

  const externalSignalsRaw = Number.isFinite(signalBarCloseMs)
    ? await getSignalsForBar({
      exchange,
      symbol,
      tf: signalTf,
      barCloseMs: signalBarCloseMs,
      limitN: 200,
      maxLookbackBars: signalQueueEnabled ? signalQueueMaxLateBars : undefined,
      maxLookaheadBars: signalQueueLookaheadBars,
      caller: "paperBinanceRunner:runPaperFuturesForBar",
    })
    : [];

  const ttlMs = Number.isFinite(execProfile.intentTtlMs) ? execProfile.intentTtlMs
    : (Number.isFinite(execProfile.intentTtlBars) && Number.isFinite(execTfMs) ? (execTfMs * execProfile.intentTtlBars) : null);
  let lateSignals = 0;

  const externalSignals = externalSignalsRaw.map((s) => {
    const signalBarMs = Number(s.bar_close_time_utc_ms);
    const signalDocId = String(s.signal_doc_id || (String(s.signal_id || "").startsWith("SIG__") ? s.signal_id : "") || "").trim() || null;
    let lateByBars = 0;
    if (Number.isFinite(signalTfMs) && Number.isFinite(signalBarMs)) {
      const delta = barCloseMs - signalBarMs;
      if (delta >= signalTfMs / 2) lateByBars = Math.max(0, Math.round(delta / signalTfMs));
    }
    const features = { ...(s.features_json || {}) };
    if (signalDocId && !features.signal_doc_id) features.signal_doc_id = signalDocId;
    if (s.signal_id && !features.signal_id) features.signal_id = s.signal_id;
    if (Number.isFinite(Number(s.price)) && !Number.isFinite(Number(features.signal_price))) features.signal_price = Number(s.price);
    if (lateByBars > 0) {
      lateSignals += 1;
      features._late_by_bars = lateByBars;
      features._late_by_ms = Number(barCloseMs) - Number(signalBarMs);
      features._late_origin_bar_close_time_utc_ms = Number(signalBarMs);
    }

    return {
      signal_id: s.signal_id,
      signal_doc_id: signalDocId,
      event: s.event,
      side: s.side,
      qty_pct: s.qty_pct,
      reason: s.reason || "TV_WEBHOOK",
      signal_bar_close_time_utc_ms: Number.isFinite(signalBarMs) ? signalBarMs : null,
      signal_bar_close_time_utc: s.bar_close_time_utc || null,
      signal_price: Number.isFinite(Number(s.price)) ? Number(s.price) : null,
      features,
    };
  });

  const rawSignals = dedupeEntrySignalsByFamily([...internalSignals, ...externalSignals], {
    exchange,
    symbol,
    tf: signalTf,
    runId,
    stage: "BAR_SIGNAL_FANIN_FUTURES",
  });
  const signals = [];
  const signalDrops = [];
  let recordedSignalDrops = [];
  const metaUpdates = pendingMetaPatch ? { ...pendingMetaPatch } : {};
  let injectedOppExit = false;
  const posSizeNowRaw = Number(pos.size_pct || 0);
  const posSizeNow = Number.isFinite(posSizeNowRaw) ? posSizeNowRaw : 0;
  const posSizeNowActive = hasPositionSize(pos.size_pct);
  const hasPositionNow = !!posSide && (posSizeNowActive || (Number.isFinite(posQtyBase) && posQtyBase > 0));
  const pendingAddState = hasPositionNow
    ? await getActivePendingAddIntentState({
      exchange,
      symbol,
      tf,
      positionSide: posSide,
      nowMs: resolveEventRefMs(signalBarCloseMs, barCloseMs),
    })
    : { count: 0, lastSignalBarMs: null };
  let pendingRescueAddCount = Number.isFinite(Number(pendingAddState.count))
    ? Math.max(0, Math.trunc(Number(pendingAddState.count)))
    : 0;
  let pendingRescueAddSignalBarMs = Number.isFinite(Number(pendingAddState.lastSignalBarMs))
    ? Number(pendingAddState.lastSignalBarMs)
    : null;
  let committedRescueAddCount = pendingRescueAddCount;
  let committedRescueAddSignalBarMs = pendingRescueAddSignalBarMs;
  const oppositeTransitionCfg = resolveOppositeTransitionConfig(sysCfgEffective, exchange);
  const transitionDirCurrent = String(posMeta.opposite_transition_dir || "").toUpperCase();
  const transitionUntilCurrent = Number(posMeta.opposite_transition_until_ms);
  if (transitionDirCurrent && Number.isFinite(transitionUntilCurrent) && Number.isFinite(signalBarCloseMs) && signalBarCloseMs > transitionUntilCurrent) {
    metaUpdates.opposite_transition_dir = null;
    metaUpdates.opposite_transition_event = null;
    metaUpdates.opposite_transition_until_ms = null;
    metaUpdates.opposite_transition_stage = null;
    metaUpdates.opposite_transition_seen_ms = null;
  }

  for (const s0 of rawSignals) {
    const s = { ...s0, features: { ...(s0.features || {}) } };
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });

    if ((intent === "ENTRY" || intent === "ADD") && hasPositionNow) {
      if (intentDir && intentDir !== posSide) {
        const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
        if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
        const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
        const transitionApplicable = oppositeTransitionCfg.enabled && (!oppositeTransitionCfg.coreRealOnly || isCoreOrRealEvent(eventUpper));
        const signalMsForStage = Number(s.signal_bar_close_time_utc_ms);
        const stageBarMs = Number.isFinite(signalMsForStage) ? signalMsForStage : (Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs));
        // 2026-04-29 — when DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1 the V1
        // executor refuses every order (`V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED`).
        // Injecting EXIT_OPPOSITE_SIGNAL in that mode generates a drop on
        // every bar that carries an opposite-direction core signal, with
        // no actual exit happening on the exchange. Skip the V1 inject
        // entirely; the position is left in place and the operator-level
        // alert spam stops. Transition meta is still cleared below so a
        // future V2 path that takes over opposite handling can pick up
        // a clean state.
        const v1OppositeInjectionDisabled = !!(liveCfg && liveCfg.legacy_runtime_disabled === true);
        if (v1OppositeInjectionDisabled) {
          // Clear any in-flight transition meta so V1 doesn't carry
          // stage-1 state forward into a V2-handled future.
          metaUpdates.opposite_transition_dir = null;
          metaUpdates.opposite_transition_event = null;
          metaUpdates.opposite_transition_until_ms = null;
          metaUpdates.opposite_transition_stage = null;
          metaUpdates.opposite_transition_seen_ms = null;
          try {
            console.log(JSON.stringify({
              event: "v1_exit_opposite_inject_skipped_v2_legacy_disabled",
              ts: new Date().toISOString(),
              exchange,
              symbol,
              tf: signalTf,
              pos_side: posSide,
              pos_size_pct: posSizeNow,
              incoming_event: s.event,
              incoming_intent_dir: intentDir,
              signal_id: s.signal_id || (s.features && s.features.signal_id) || null,
              note: "V1 EXIT_OPPOSITE_SIGNAL injection bypassed; V2 path owns opposite-flip handling post cutover.",
            }));
          } catch (_) { /* observability only */ }
          continue;
        }
        if (transitionApplicable) {
          const pendingDir = String((metaUpdates.opposite_transition_dir ?? posMeta.opposite_transition_dir) || "").toUpperCase();
          const pendingUntil = Number(metaUpdates.opposite_transition_until_ms ?? posMeta.opposite_transition_until_ms);
          const pendingActive = pendingDir && pendingDir === intentDir && Number.isFinite(pendingUntil)
            && (!Number.isFinite(stageBarMs) || stageBarMs <= pendingUntil);
          const exitSide = posSide === "SHORT" ? "BUY" : "SELL";

          if (!pendingActive) {
            if (!injectedOppExit) {
              const reduceQty = Math.max(POS_SIZE_EPSILON, Math.min(posSizeNow, posSizeNow * oppositeTransitionCfg.reduceFraction));
              console.log(
                `[inject_exit_opposite_reduce] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} reduceQty=${reduceQty} incoming=${s.event}:${s.side} intentDir=${intentDir}`
              );
              signals.push({
                event: "EXIT_OPPOSITE_SIGNAL",
                side: exitSide,
                qty_pct: reduceQty,
                reason: "EXIT_OPPOSITE_REDUCE",
                signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
                signal_bar_close_time_utc: signalBarCloseUtc,
                features: {
                  position_side: posSide,
                  ref_px: Number(bar && (bar.close ?? bar.c)),
                  opposite_transition: "REDUCE",
                  opposite_transition_dir: intentDir,
                },
              });
              injectedOppExit = true;
            }
            const stageUntilMs = Number.isFinite(signalTfMs) && Number.isFinite(stageBarMs)
              ? (stageBarMs + signalTfMs * oppositeTransitionCfg.confirmBars)
              : null;
            metaUpdates.opposite_transition_dir = intentDir;
            metaUpdates.opposite_transition_event = eventUpper || null;
            metaUpdates.opposite_transition_until_ms = stageUntilMs;
            metaUpdates.opposite_transition_stage = 1;
            metaUpdates.opposite_transition_seen_ms = Number.isFinite(stageBarMs) ? stageBarMs : null;
            continue;
          }

          if (!injectedOppExit) {
            console.log(
              `[inject_exit_opposite_confirm] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} incoming=${s.event}:${s.side} intentDir=${intentDir}`
            );
            signals.push({
              event: "EXIT_OPPOSITE_SIGNAL",
              side: exitSide,
              qty_pct: posSizeNow,
              reason: "EXIT_OPPOSITE_CONFIRM",
              signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
              signal_bar_close_time_utc: signalBarCloseUtc,
              features: {
                position_side: posSide,
                ref_px: Number(bar && (bar.close ?? bar.c)),
                opposite_transition: "CONFIRM_EXIT",
                opposite_transition_dir: intentDir,
              },
            });
            injectedOppExit = true;
          }
          s.features._flip_confirmed = true;
          s.features._flip_stage = 2;
          s.features._allow_opposite_after_exit = true;
          s.reason = s.reason ? `${s.reason}|FLIP_CONFIRM` : "FLIP_CONFIRM";
          metaUpdates.opposite_transition_dir = null;
          metaUpdates.opposite_transition_event = null;
          metaUpdates.opposite_transition_until_ms = null;
          metaUpdates.opposite_transition_stage = null;
          metaUpdates.opposite_transition_seen_ms = null;
          signals.push(s);
          continue;
        }
        if (!injectedOppExit) {
          const exitSide = posSide === "SHORT" ? "BUY" : "SELL";
          console.log(
            `[inject_exit_opposite] ex=${exchange} sym=${symbol} tf=${signalTf} posSide=${posSide} posSizePct=${posSizeNow} posQtyBase=${posQtyBase ?? "NA"} eps=${POS_SIZE_EPSILON} incoming=${s.event}:${s.side} intentDir=${intentDir}`
          );
          signals.push({
            event: "EXIT_OPPOSITE_SIGNAL",
            side: exitSide,
            qty_pct: posSizeNow,
            reason: "EXIT_OPPOSITE_SIGNAL",
            signal_bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : null,
            signal_bar_close_time_utc: signalBarCloseUtc,
            features: { position_side: posSide, ref_px: Number(bar && (bar.close ?? bar.c)) },
          });
          injectedOppExit = true;
        }
        continue;
      }
      if (intentDir && intentDir === posSide && String((metaUpdates.opposite_transition_dir ?? posMeta.opposite_transition_dir) || "")) {
        metaUpdates.opposite_transition_dir = null;
        metaUpdates.opposite_transition_event = null;
        metaUpdates.opposite_transition_until_ms = null;
        metaUpdates.opposite_transition_stage = null;
        metaUpdates.opposite_transition_seen_ms = null;
      }
      if (intent === "ENTRY" || intent === "ADD") {
        const signalBarMsForAdd = Number.isFinite(Number(s.signal_bar_close_time_utc_ms))
          ? Number(s.signal_bar_close_time_utc_ms)
          : (Number.isFinite(signalBarCloseMs) ? Number(signalBarCloseMs) : Number(barCloseMs));
        const replayRescueAdd = evaluateReplayRescueAdd({
          event: s.event,
          features: s.features,
          position: pos,
          posMeta,
          posSide,
          posSizePct: posSizeNow,
          bar,
          signalBarCloseMs: signalBarMsForAdd,
          pendingAddCount: pendingRescueAddCount,
          pendingAddSignalBarMs: pendingRescueAddSignalBarMs,
        });
        if (replayRescueAdd.enabled === true) {
          if (!replayRescueAdd.ok) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
              qty_pct: s.qty_pct,
              reason: replayRescueAdd.reason || "REPLAY_RESCUE_ADD_BLOCKED",
              drop_reason_code: replayRescueAdd.reason || "REPLAY_RESCUE_ADD_BLOCKED",
              features_json: {
                ...(s.features || {}),
                replay_rescue_add: replayRescueAdd.detail || null,
              },
              event_intent: "ADD",
            });
            continue;
          }
          s.qty_pct = replayRescueAdd.addQtyPct;
          s.features._event_intent = "ADD";
          s.features._in_position_add = true;
          s.features._replay_rescue_add_applied = true;
          s.features._replay_rescue_add_base_qty_pct = replayRescueAdd.detail && replayRescueAdd.detail.base_qty_pct;
          s.features._replay_rescue_add_qty_pct = replayRescueAdd.detail && replayRescueAdd.detail.add_qty_pct;
          s.features._replay_rescue_add_loss_pct = replayRescueAdd.detail && replayRescueAdd.detail.loss_pct;
          s.features._replay_rescue_add_stop_distance_pct = replayRescueAdd.detail && replayRescueAdd.detail.stop_distance_pct;
          s.features._replay_rescue_add_max_adds = replayRescueAdd.detail && replayRescueAdd.detail.max_adds;
          s.features._replay_rescue_add_same_bar_block = replayRescueAdd.detail && replayRescueAdd.detail.same_bar_block === true;
          s.reason = s.reason ? `${s.reason}|REPLAY_RESCUE_ADD` : "REPLAY_RESCUE_ADD";
          signals.push(s);
          continue;
        }
        if (rescueAddCfg.enabled === true) {
          const liveRescueAdd = evaluateLiveRescueAdd({
            cfg: rescueAddCfg,
            event: s.event,
            features: s.features,
            position: pos,
            posMeta,
            posSide,
            posSizePct: posSizeNow,
            bar,
            signalBarCloseMs: signalBarMsForAdd,
            useBudget,
            pendingAddCount: pendingRescueAddCount,
            pendingAddSignalBarMs: pendingRescueAddSignalBarMs,
          });
          if (!liveRescueAdd.ok) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
              qty_pct: s.qty_pct,
              reason: liveRescueAdd.reason || "LIVE_RESCUE_ADD_BLOCKED",
              drop_reason_code: liveRescueAdd.reason || "LIVE_RESCUE_ADD_BLOCKED",
              features_json: {
                ...(s.features || {}),
                live_rescue_add: liveRescueAdd.detail || null,
              },
              event_intent: "ADD",
            });
            continue;
          }
          s.qty_pct = liveRescueAdd.addQtyPct;
          s.features._event_intent = "ADD";
          s.features._in_position_add = true;
          s.features._rescue_add_applied = true;
          s.features._rescue_add_base_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.base_qty_pct;
          s.features._rescue_add_requested_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.requested_add_qty_pct;
          s.features._rescue_add_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.add_qty_pct;
          s.features._rescue_add_loss_pct = liveRescueAdd.detail && liveRescueAdd.detail.loss_pct;
          s.features._rescue_add_stop_distance_pct = liveRescueAdd.detail && liveRescueAdd.detail.stop_distance_pct;
          s.features._rescue_add_remaining_cap_qty_pct = liveRescueAdd.detail && liveRescueAdd.detail.remaining_cap_qty_pct;
          s.features._rescue_add_auto_shrunk = liveRescueAdd.detail && liveRescueAdd.detail.auto_shrunk === true;
          s.features._rescue_add_max_adds = liveRescueAdd.detail && liveRescueAdd.detail.max_adds;
          s.features._rescue_add_same_bar_block = liveRescueAdd.detail && liveRescueAdd.detail.same_bar_block === true;
          s.reason = s.reason ? `${s.reason}|LIVE_RESCUE_ADD` : "LIVE_RESCUE_ADD";
          signals.push(s);
          continue;
        }
        if (!forceAllSignalsAdd) {
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: Number.isFinite(signalBarCloseMs) ? signalBarCloseMs : Number(barCloseMs),
            qty_pct: s.qty_pct,
            reason: "DROP_IN_POSITION_NO_ADD",
            drop_reason_code: "DROP_IN_POSITION_NO_ADD",
            features_json: { ...(s.features || {}), in_position_side: posSide || null },
            event_intent: intent,
          });
          continue;
        }
        s.features._event_intent = "ADD";
        s.features._in_position_add = true;
        s.reason = s.reason ? `${s.reason}|IN_POSITION_ADD` : "IN_POSITION_ADD";
      }
    }

    signals.push(s);
  }
  let intentsCreated = 0;
  let immediateIntentsCreated = 0;
  const intentExecutionMode = (liveCfg.executionMode === "LIVE" || liveCfg.executionMode === "LIVE_DRY_RUN")
    ? liveCfg.executionMode
    : "PAPER";
  for (const s of signals) {
    s.features = buildSignalStageFeatures(s, null);
    const intent = intentFromSignal({ event: s.event, side: s.side, features: s.features });
    const intentIsEntry = intent === "ENTRY" || intent === "ADD";
    if (intentIsEntry) {
      s.features = applyCanonicalSourceProvenanceDefaults({
        intent,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        eventUpper: String(s.event || "").trim().toUpperCase(),
        intentDir: directionFromSignal({ event: s.event, side: s.side }),
        tf: signalTf,
      });
    }
    const effectiveBarMs = Number(s && s.features && s.features._late_origin_bar_close_time_utc_ms) || Number(barCloseMs);
    const signalBarMsRaw = s && s.signal_bar_close_time_utc_ms;
    const signalBarMsParsed = (signalBarMsRaw === null || signalBarMsRaw === undefined) ? null : Number(signalBarMsRaw);
    const signalBarCloseMsForIntent = Number.isFinite(signalBarMsParsed) ? signalBarMsParsed : effectiveBarMs;
    const signalBarCloseUtcForIntent = Number.isFinite(signalBarCloseMsForIntent)
      ? msToUtcZ(signalBarCloseMsForIntent)
      : (s.signal_bar_close_time_utc || barCloseUtc);
    const v2DiscoveryLegacyEntryFilterBypass = shouldBypassLegacyEntryFiltersForV2Discovery({ liveCfg, intent });
    if (v2DiscoveryLegacyEntryFilterBypass) {
      s.features = {
        ...(s.features || {}),
        v2_discovery_legacy_entry_filters_bypassed: true,
        v2_discovery_entry_filter_authority: "PRODUCTION_ENTRY_ROUTE",
      };
    }
    if (backfillExitOnly && intentIsEntry && backfillAllowEntry !== true) {
      if (String(trading_mode || "").toUpperCase() === "EXIT_ONLY") {
        // EXIT_ONLY pass should not consume live entry signals.
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "BACKFILL_SKIP_ENTRY",
        drop_reason_code: "BACKFILL_SKIP_ENTRY",
        features_json: { ...(s.features || {}), backfill_exit_only: true },
        event_intent: intent,
      });
      continue;
    }
    if (!allowByTradingModeIntent(trading_mode, intent)) continue;

    // Commission Gate v2 soft mode — 시그널 품질 필터 이전에 평가하여 모든 진입 시그널에 대해 증빙 생성
    let _commGateResult = null;
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      try {
        const perfGate = await loadPerformanceGate(exchange);
        const gateEvidence = logCommissionGateEvidence({ phase: "signal_proc_fut", exchange, symbol, event: s.event, perfGate, intentId: s.signal_id || s.id });
        const commScale = resolveCommissionSoftScale(perfGate);
        _commGateResult = { perfGate, commScale, gateId: gateEvidence.gateId };
      } catch (gateErr) {
        console.error("[COMMISSION_GATE][EXCEPTION]", { phase: "signal_proc_fut", exchange, symbol, event: s.event, error: gateErr.message, enforce: COMMISSION_GATE_ENFORCE });
        if (COMMISSION_GATE_ENFORCE) {
          signalDrops.push({
            ...s, bar_close_time_utc_ms: effectiveBarMs, qty_pct: s.qty_pct,
            reason: "DROP_COMMISSION_GATE_ERROR", drop_reason_code: "DROP_COMMISSION_GATE_ERROR",
            features_json: { ...(s.features || {}), gate_error: gateErr.message },
            event_intent: intent,
          });
          continue;
        }
      }
    }

    const intentDir = (intent === "EXIT")
      ? directionFromSignal({ event: s.event })
      : directionFromSignal({ event: s.event, side: s.side });
    const lateByBars = Number(s && s.features && s.features._late_by_bars);
    if (signalQueueEnabled && Number.isFinite(lateByBars) && lateByBars > signalQueueMaxLateBars) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "DROP_STALE_SIGNAL",
        drop_reason_code: "DROP_STALE_SIGNAL",
        features_json: { ...(s.features || {}), late_by_bars: lateByBars, max_late_bars: signalQueueMaxLateBars },
        event_intent: intent,
      });
      continue;
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && spikeLock && spikeLock.active && (intent === "ENTRY" || intent === "ADD")) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: s.qty_pct,
        reason: "DROP_SPIKE_LOCK",
        drop_reason_code: "DROP_SPIKE_LOCK",
        features_json: { ...(s.features || {}), spike_lock_until_ms: spikeLock.untilMs ?? null, spike_lock_tf: spikeLock.tf || null, spike_lock_move_pct: spikeLock.movePct ?? null },
        event_intent: intent,
      });
      continue;
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && signalOverlapEnabled && (intent === "ENTRY" || intent === "ADD") && intentDir && Number.isFinite(signalTfMs) && signalOverlapBars > 0) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      const lastBarMs = Number(posMeta && posMeta[lastKey]);
      const currentTier = resolveSignalTierFromEvent(s.event, s.features);
      const lastTierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
      const lastTier = Number(posMeta && posMeta[lastTierKey]);
      const isCoreRealOrEarlyEvent = String(s.event || "").toUpperCase().startsWith("CORE_")
        || String(s.event || "").toUpperCase().startsWith("REAL_")
        || isPreRealOrEarlyEventName(s.event, s.features);
      const allowOverlapUpgrade = (Number.isFinite(currentTier) && Number.isFinite(lastTier) && currentTier > lastTier)
        || isCoreRealOrEarlyEvent;
      if (shouldBlockSignalOverlap({ pos, lastBarMs, effectiveBarMs, signalTfMs, signalOverlapBars, allowOverlapUpgrade })) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: s.qty_pct,
          reason: "DROP_OVERLAP",
          drop_reason_code: "DROP_OVERLAP",
          features_json: { ...(s.features || {}), overlap_bars: signalOverlapBars, last_entry_bar_ms: lastBarMs },
          event_intent: intent,
        });
        continue;
      }
    }

    let qtyFraction = useBudget ? normalizeQtyFraction(s.qty_pct) : Number(s.qty_pct);
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    const sideScaled = applyDirectionalQtyScale({ qtyFraction, intent, intentDir, riskBudget });
    qtyFraction = sideScaled.qtyFraction;
    if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) continue;
    if (useBudget && qtyFraction > 1) {
      if (riskBudget.onExceed === "SKIP") continue;
      qtyFraction = 1;
    }
    const normalizedEvent = normalizeTpP1EventForExchange(s.event, exchange);
    if (normalizedEvent && normalizedEvent !== s.event) s.event = normalizedEvent;
    const eventUpper = String(normalizedEvent || s.event || "").toUpperCase();
    const actionTag = normalizeActionValue(s.features && s.features.action);
    const allowTrailEntry = forceAllSignalsAdd || allowEntryDuringTrail({ event: s.event, features: s.features, posMeta });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && (posMeta && (posMeta.trail_active === true || posMeta.tp_p1_done === true)) && !allowTrailEntry) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TRAIL_ACTIVE_NO_ADD",
        drop_reason_code: "DROP_TRAIL_ACTIVE_NO_ADD",
        features_json: { ...(s.features || {}), trail_active: posMeta.trail_active ?? null, tp_p1_done: posMeta.tp_p1_done ?? null },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !actionAllowsEntry(actionTag)) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_ACTION_FILTER",
        drop_reason_code: "DROP_ACTION_FILTER",
        features_json: { ...(s.features || {}), action: actionTag },
        event_intent: intent,
      });
      continue;
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && !isTradeableEventAllowed({ eventUpper, intentDir, allowlist: tradeableSignalTypes })) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TRADEABLE_SIGNAL_TYPES",
        drop_reason_code: "DROP_TRADEABLE_SIGNAL_TYPES",
        features_json: { ...(s.features || {}), allowlist: tradeableSignalTypes },
        event_intent: intent,
      });
      continue;
    }
    const bypassOppositeEntryCooldown = intentIsEntry
      && shouldBypassOppositeEntryCooldown({ features: s.features, intentDir, posMeta });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && oppositeCooldownBars > 0 && !hasPositionNow && !bypassOppositeEntryCooldown) {
      const lastExitMs = Number(posMeta && posMeta.last_exit_bar_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitMs) && lastExitDir && Number.isFinite(signalTfMs)) {
        const barsSinceExit = Math.floor((effectiveBarMs - lastExitMs) / signalTfMs);
        if (Number.isFinite(barsSinceExit) && barsSinceExit >= 0 && barsSinceExit <= oppositeCooldownBars) {
          if (intentDir && lastExitDir && intentDir !== lastExitDir) {
            signalDrops.push({
              ...s,
              bar_close_time_utc_ms: effectiveBarMs,
              qty_pct: qtyFraction,
              reason: "DROP_OPPOSITE_COOLDOWN",
              drop_reason_code: "DROP_OPPOSITE_COOLDOWN",
              features_json: {
                ...(s.features || {}),
                last_exit_bar_ms: lastExitMs,
                last_exit_dir: lastExitDir,
                bars_since_exit: barsSinceExit,
                cooldown_bars: oppositeCooldownBars,
              },
              event_intent: intent,
            });
            continue;
          }
        }
      }
    }
    // ── 시간 기반 절대 쿨다운: 방향 반전 시 최소 대기 시간 (타임프레임 무관) ──
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && oppositeTimeCooldownMs > 0 && !hasPositionNow && !bypassOppositeEntryCooldown) {
      const lastExitWallMs = Number(posMeta && posMeta.last_exit_wall_ms);
      const lastExitDir = String(posMeta && posMeta.last_exit_dir || "");
      if (Number.isFinite(lastExitWallMs) && lastExitDir && intentDir && lastExitDir !== intentDir) {
        const elapsedMs = resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms) - lastExitWallMs;
        if (elapsedMs >= 0 && elapsedMs < oppositeTimeCooldownMs) {
          console.log(`[OPPOSITE_TIME_COOLDOWN] DROP signal ${exchange} ${symbol} ${s.event} | dir=${intentDir} vs lastExit=${lastExitDir} | elapsed=${Math.floor(elapsedMs / 1000)}s < cooldown=${Math.floor(oppositeTimeCooldownMs / 1000)}s`);
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: qtyFraction,
            reason: "DROP_OPPOSITE_TIME_COOLDOWN",
            drop_reason_code: "DROP_OPPOSITE_TIME_COOLDOWN",
            features_json: {
              ...(s.features || {}),
              last_exit_wall_ms: lastExitWallMs,
              last_exit_dir: lastExitDir,
              elapsed_sec: Math.floor(elapsedMs / 1000),
              cooldown_sec: Math.floor(oppositeTimeCooldownMs / 1000),
            },
            event_intent: intent,
          });
          continue;
        }
      }
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && sameDirectionTrailProfitCooldownCfg.enabled && !hasPositionNow) {
      const sameDirectionCooldown = resolveSameDirectionTrailProfitCooldownBlock({
        cfg: sameDirectionTrailProfitCooldownCfg,
        posMeta: resolveSameDirectionTrailProfitCooldownSnapshot({
          posMeta,
          observation: sameDirectionTrailProfitObservation,
          observationOnly: true,
        }),
        intentDir,
        eventRefMs: resolveEventRefMs(effectiveBarMs, s.bar_close_time_utc_ms),
      });
      if (sameDirectionCooldown) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          drop_reason_code: "DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN",
          features_json: {
            ...(s.features || {}),
            same_direction_trail_profit_exit_dir: sameDirectionCooldown.exit_dir,
            same_direction_trail_profit_exit_wall_ms: sameDirectionCooldown.exit_wall_ms,
            same_direction_trail_profit_exit_event: sameDirectionCooldown.exit_event,
            same_direction_trail_profit_exit_realized_pnl: sameDirectionCooldown.realized_pnl,
            elapsed_sec: Math.floor(sameDirectionCooldown.elapsed_ms / 1000),
            cooldown_sec: Math.floor(sameDirectionCooldown.cooldown_ms / 1000),
          },
          event_intent: intent,
        });
        continue;
      }
    }
    const isTpP1Event = eventUpper === "EXIT_TP_P1" || eventUpper.startsWith("EXIT_TP_P1_");
    if (isTpP1Event && posMeta && posMeta.tp_p1_done === true) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: "DROP_TP_P1_ALREADY_DONE",
        drop_reason_code: "DROP_TP_P1_ALREADY_DONE",
        features_json: { ...(s.features || {}), tp_p1_done: true },
        event_intent: intent,
      });
      continue;
    }
    if (isTpP1Event && posMeta && posMeta.tp_p1_pending === true) {
      const pendingRefMs = Date.now();
      const pendingState = await getTpP1PendingState({
        exchange,
        symbol,
        tf: signalTf,
        posMeta,
        tpP1PendingHoldMs,
        nowMs: pendingRefMs,
      });
      if (pendingState.active) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_TP_P1_PENDING",
          drop_reason_code: "DROP_TP_P1_PENDING",
          features_json: {
            ...(s.features || {}),
            tp_p1_pending: true,
            tp_p1_pending_at_ms: pendingState.pendingAtMs,
            tp_p1_pending_until_ms: pendingState.pendingUntilMs,
            tp_p1_pending_active_by_intent: pendingState.activeByIntent,
          },
          event_intent: intent,
        });
        continue;
      }
      metaUpdates.tp_p1_pending = false;
      metaUpdates.tp_p1_pending_at_ms = null;
      metaUpdates.tp_p1_pending_until_ms = null;
      metaUpdates.tp_p1_pending_event = null;
    }

    if (!v2DiscoveryLegacyEntryFilterBypass && autoScore && autoScore.enabled && Number.isFinite(autoScore.scoreMin) && (intent === "ENTRY" || intent === "ADD")) {
      const score = pickSignalScore(s.features);
      if (Number.isFinite(score) && score < autoScore.scoreMin) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: "DROP_LOW_SCORE",
          drop_reason_code: "DROP_LOW_SCORE",
          features_json: { ...(s.features || {}), score, score_min: autoScore.scoreMin, score_base: autoScore.base ?? null, score_target_wr: autoScore.target ?? null, score_win_rate: autoScore.winRate ?? null },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && shortGateCfg && shortGateCfg.enabled) {
      const shortGate = evaluateShortEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: shortGateCfg,
      });
      if (!shortGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: shortGate.reason || "DROP_SHORT_GATE",
          drop_reason_code: shortGate.reason || "DROP_SHORT_GATE",
          features_json: { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      if (shortGate.detail && shortGate.detail.gate_transition_exception) {
        s.features = { ...(s.features || {}), ...(shortGate.detail || {}), gate_enabled: true, short_gate_enabled: true };
      }
    }

    const features = (s.features && typeof s.features === "object") ? { ...s.features } : {};
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      const canonical = evaluateCanonicalEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        sysCfg: sysCfgEffective,
        market: s.symbol_or_pair_id || symbol,
        tf: signalTf,
      });
      if (!canonical.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: canonical.reason || "DROP_CANONICAL_ENGINE",
          drop_reason_code: canonical.reason || "DROP_CANONICAL_ENGINE",
          features_json: { ...(s.features || {}), ...(canonical.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
      if (canonical.detail) {
        s.features = mergeCanonicalDecisionDetail(s.features, canonical.detail);
        Object.assign(features, canonical.detail || {});
      }
      const quality = evaluateEntryQualityGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: entryQualityCfg,
      });
      if (!quality.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: quality.reason || "DROP_ENTRY_QUALITY",
          drop_reason_code: quality.reason || "DROP_ENTRY_QUALITY",
          features_json: { ...(s.features || {}), ...(quality.detail || {}) },
          event_intent: intent,
        });
        continue;
      }
    }

    // Commission/MDD soft reduction gate — 커미션 게이트 캐시 결과 사용
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && _commGateResult) {
      const { perfGate, commScale, gateId } = _commGateResult;
      if (commScale && commScale.blocked && commScale.scale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * commScale.scale;
        if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
          signalDrops.push({
            ...s,
            bar_close_time_utc_ms: effectiveBarMs,
            qty_pct: before,
            reason: "DROP_COMMISSION_GATE_ZERO_QTY",
            drop_reason_code: "DROP_COMMISSION_GATE_ZERO_QTY",
            features_json: {
              ...(s.features || {}),
              gate_id: gateId || null,
              commission_ratio: perfGate && perfGate.commissionRatio,
              commission_threshold: COMMISSION_RATIO_THRESHOLD,
              commission_scale: commScale.scale,
              total_fee: perfGate && perfGate.totalFee,
              total_pnl: perfGate && perfGate.totalPnl,
            },
            event_intent: intent,
          });
          continue;
        }
        s.features = {
          ...(s.features || {}),
          gate_id: gateId || null,
          commission_ratio: perfGate && perfGate.commissionRatio,
          commission_threshold: COMMISSION_RATIO_THRESHOLD,
          commission_scale: commScale.scale,
          commission_scaled_in_signal: true,
          total_fee: perfGate && perfGate.totalFee,
          total_pnl: perfGate && perfGate.totalPnl,
        };
        console.warn(`[COMMISSION_GATE][SOFT_REDUCE] signal_fut ${exchange} ${symbol} ${s.event} | qty ${before.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${commScale.scale.toFixed(4)} gate_id=${gateId || "-"}`);
      }
      if (perfGate.mddBlocked && perfGate.mddReduceFactor < 1) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * perfGate.mddReduceFactor;
        s.features = {
          ...(s.features || {}),
          mdd: perfGate.mdd,
          mdd_threshold: MDD_THRESHOLD,
          mdd_reduce_factor: perfGate.mddReduceFactor,
          mdd_scaled_in_signal: true,
        };
        console.log(`[MDD_REDUCE] ${exchange} ${symbol} ${s.event} | mdd=${(perfGate.mdd * 100).toFixed(2)}% < ${(MDD_THRESHOLD * 100).toFixed(0)}% | qty ${before.toFixed(4)} → ${qtyFraction.toFixed(4)} (x${perfGate.mddReduceFactor})`);
      }
    }

    let immediateEntry = false;
    let immediateReason = null;
    let coreProbePatch = null;
    let coreProbeClear = null;
    const signalTimingTier = resolveSignalTier(eventUpper, s.features);
    const isRealEvent = signalTimingTier === "REAL";
    const isPreRealEvent = signalTimingTier === "PRE_REAL";
    const isCoreEvent = signalTimingTier === "CORE";
    const isEarlyEvent = signalTimingTier === "EARLY";
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && isAiRequired(exchange) && !hasAiSignal(s.features)) {
      const aiMissing = resolveAiMissingPolicy({ qtyFraction, features: s.features, sysCfg });
      if (aiMissing.drop) {
        const reason = aiMissing.reason || "DROP_AI_MISSING";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: aiMissing.features,
          event_intent: intent,
        });
        continue;
      }
      const prevQty = qtyFraction;
      qtyFraction = Number(aiMissing.qtyFraction);
      s.features = aiMissing.features;
      if (Number.isFinite(prevQty) && Number.isFinite(qtyFraction) && qtyFraction < prevQty) {
        console.warn(
          `[AI_MISSING][REDUCE] ${exchange} ${symbol} ${s.event} | qty ${prevQty.toFixed(4)} -> ${qtyFraction.toFixed(4)} | scale=${Number(aiMissing.features && aiMissing.features.ai_missing_reduce_pct || AI_MISSING_REDUCE_PCT).toFixed(4)}`
        );
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && aiBiasGateCfg && aiBiasGateCfg.enabled) {
      const aiBiasGate = evaluateAiBiasEntryGate({
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: aiBiasGateCfg,
        riskBudget,
      });
      if (aiBiasGate.detail) {
        s.features = { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true };
        Object.assign(features, aiBiasGate.detail || {});
      }
      if (!aiBiasGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          drop_reason_code: aiBiasGate.reason || "DROP_AI_BIAS_GATE",
          features_json: { ...(s.features || {}), ...(aiBiasGate.detail || {}), ai_bias_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const aiBiasScale = Number(aiBiasGate.qtyScale);
      if (Number.isFinite(aiBiasScale) && aiBiasScale > 0 && aiBiasScale < 0.9999) {
        const before = qtyFraction;
        qtyFraction = qtyFraction * aiBiasScale;
        s.features = {
          ...(s.features || {}),
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        };
        Object.assign(features, {
          ai_bias_gate_qty_before: before,
          ai_bias_gate_qty_after: qtyFraction,
          market_bias_mult: aiBiasScale,
        });
      }
    }

    const evGateBypass = shouldBypassEvEntryGate({ intent, features: s.features });
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && evGateCfg && evGateCfg.enabled && evGateBypass) {
      const evGateDetail = {
        ev_gate_enabled: true,
        ev_gate_skipped: true,
        ev_gate_skip_reason: "MANUAL_RETRY_OVERRIDE",
        ev_gate_action: "SKIP",
        ev_gate_qty_scale: 1,
      };
      s.features = { ...(s.features || {}), ...evGateDetail };
      Object.assign(features, evGateDetail);
    }
    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass && evGateCfg && evGateCfg.enabled && !evGateBypass) {
      let evExitProfile = null;
      try {
        evExitProfile = await resolveAdaptiveFuturesExitProfile({
          exchange,
          symbol,
          tf: signalTf,
          intent,
          event: s.event,
          side: s.side,
          features: s.features,
          nowMs: Number(effectiveBarMs),
          manualProfileMode: liveCfg && liveCfg.exitProfileMode,
        });
      } catch (evExitProfileErr) {
        const evGateDetail = {
          ev_gate_enabled: true,
          ev_gate_exit_profile_resolve_failed: true,
          ev_gate_exit_profile_error: evExitProfileErr && evExitProfileErr.message
            ? String(evExitProfileErr.message)
            : String(evExitProfileErr),
        };
        s.features = { ...(s.features || {}), ...evGateDetail };
        Object.assign(features, evGateDetail);
      }
      const evGateBaseQty = qtyFraction;
      const evExitRulesAdjustment = applyEntryExitRuleRuntimeAdjustments({
        exchange,
        rules: evExitProfile && evExitProfile.rules,
        features: s.features,
        sysCfg,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        market: symbol,
      });
      const evGate = await evaluateEvEntryGate({
        exchange,
        symbol,
        tf: signalTf,
        barCloseMs: effectiveBarMs,
        intent,
        intentDir,
        eventUpper,
        features: s.features,
        cfg: evGateCfg,
        exitRules: evExitRulesAdjustment.appliedExitRules,
        exitProfile: evExitProfile && evExitProfile.profile,
        exitProfileReason: evExitProfile && evExitProfile.reason,
      });
      if (evGate.detail) {
        s.features = { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true };
        Object.assign(features, evGate.detail || {});
      }
      if (!evGate.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: evGate.reason || "DROP_EV_GATE",
          drop_reason_code: evGate.reason || "DROP_EV_GATE",
          features_json: { ...(s.features || {}), ...(evGate.detail || {}), ev_gate_enabled: true },
          event_intent: intent,
        });
        continue;
      }
      const evScale = Number(evGate.qtyScale);
      if (Number.isFinite(evScale) && evScale > 0 && evScale < 0.9999) {
        const evQtyScaleResult = applyEvQtyScale({
          qtyFraction,
          evScale,
          intent,
          event: s.event,
          features: s.features,
        });
        qtyFraction = evQtyScaleResult.qtyFraction;
        s.features = {
          ...(s.features || {}),
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        };
        Object.assign(features, {
          ev_gate_qty_before: evGateBaseQty,
          ev_gate_qty_after: qtyFraction,
          ev_gate_qty_after_suggested: evQtyScaleResult.suggestedQtyFraction,
          ev_gate_qty_scale_applied: evQtyScaleResult.appliedScale,
          ev_gate_qty_scale_suggested: evQtyScaleResult.suggestedScale,
          ev_gate_qty_scale_suppressed_for_fixed: evQtyScaleResult.suppressedForFixed,
          ev_gate_qty_profile: evQtyScaleResult.qtyProfile,
          ev_mult: evQtyScaleResult.appliedScale,
        });
      }
      s.features = {
        ...(s.features || {}),
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      };
      Object.assign(features, {
        market_ev_base_qty: evGateBaseQty,
        market_ev_final_qty: qtyFraction,
        market_ev_final_mult: Number.isFinite(evGateBaseQty) && evGateBaseQty > 0 ? (qtyFraction / evGateBaseQty) : null,
      });
    }

    if (intentIsEntry && waitOneBarCfg && waitOneBarCfg.enabled) {
      const waitOneBar = evaluateWaitOneBarTiming({
        intent,
        intentDir,
        eventUpper,
        cfg: waitOneBarCfg,
        features: s.features,
      });
      if (waitOneBar.detail) {
        s.features = { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true };
        Object.assign(features, waitOneBar.detail || {});
      }
      const waitOneBarV2DiscoveryAdvisoryOnly = shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery({ liveCfg, intent });
      if (!waitOneBar.ok && waitOneBarV2DiscoveryAdvisoryOnly) {
        const advisoryDetail = {
          wait_one_bar_v2_discovery_advisory_only: true,
          wait_one_bar_legacy_hard_drop_bypassed: true,
          wait_one_bar_legacy_reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          wait_one_bar_legacy_action: waitOneBar.action || null,
        };
        s.features = { ...(s.features || {}), ...advisoryDetail };
        Object.assign(features, advisoryDetail);
      } else if (!waitOneBar.ok) {
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          drop_reason_code: waitOneBar.reason || "DROP_WAIT_ONE_BAR_TIMING",
          features_json: { ...(s.features || {}), ...(waitOneBar.detail || {}), wait_one_bar_enabled: true },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && !v2DiscoveryLegacyEntryFilterBypass) {
      const signalFloor = await applyEntryBudgetSignalFloor({
        exchange,
        symbol,
        intent,
        qtyFraction,
        maxQtyPct: Math.max(0, 1 - Number(pos && pos.size_pct || 0)),
        features: s.features,
        nowMs: Number(effectiveBarMs),
        stage: "RUNNER_SIGNAL",
      });
      if (signalFloor.featuresPatch && typeof signalFloor.featuresPatch === "object") {
        s.features = signalFloor.featuresPatch;
        Object.assign(features, signalFloor.featuresPatch);
      }
      if (Number.isFinite(Number(signalFloor.qtyPct)) && Number(signalFloor.qtyPct) > 0) {
        qtyFraction = Number(signalFloor.qtyPct);
      }
      const openclawEval = await applyOpenClawExecutorDecision({
        exchange,
        symbol,
        intent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        requestedQtyPct: signalFloor.requestedQtyPct,
        features: s.features,
        stage: "RUNNER_SIGNAL",
        applyScale: true,
        nowMs: Number(effectiveBarMs),
        signalTf,
        cohort: resolveLiveMarketRegimeCohort({ symbol, posMeta }),
        requestId: s.request_id || null,
        runId,
        signalId: s.signal_id || (s.features && s.features.signal_id) || null,
      });
      if (openclawEval.featuresPatch && typeof openclawEval.featuresPatch === "object") {
        s.features = openclawEval.featuresPatch;
        Object.assign(features, openclawEval.featuresPatch);
      }
      if (!openclawEval.ok || !Number.isFinite(Number(openclawEval.qtyPctFinal)) || Number(openclawEval.qtyPctFinal) <= 0) {
        const reason = String(openclawEval.reason || "DROP_OPENCLAW_EXECUTOR").trim().toUpperCase() || "DROP_OPENCLAW_EXECUTOR";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: { ...(s.features || {}) },
          event_intent: intent,
        });
        continue;
      }
      qtyFraction = Number(openclawEval.qtyPctFinal);
      if (!Number.isFinite(qtyFraction) || qtyFraction <= 0) {
        const reason = String(openclawEval.reason || "DROP_OPENCLAW_EXECUTION_AUTHORITY").trim().toUpperCase() || "DROP_OPENCLAW_EXECUTION_AUTHORITY";
        signalDrops.push({
          ...s,
          bar_close_time_utc_ms: effectiveBarMs,
          qty_pct: qtyFraction,
          reason,
          drop_reason_code: reason,
          features_json: { ...(s.features || {}) },
          event_intent: intent,
        });
        continue;
      }
    }

    if (intentIsEntry && immediateCfg.enabled && (isRealEvent || isPreRealEvent || isCoreEvent || isEarlyEvent)) {
      const { coreBuy, realBuy, coreSell, realSell } = resolveScoreLevels({ exchange, features });
      const score = pickSignalScoreExtended(features);
      const confidence = pickSignalConfidence(features);
      const waveConf = pickSignalWaveConf(features);
      const conflict = pickSignalConflict(features);
      const regime = pickSignalRegime(features);
      const volRank = pickSignalVolRank(features);
      const volStrong = volRank === "ultra" || volRank === "strong";
      const dir = intentDir;

      if (isCoreEvent && dir) {
        const probe = getCoreProbeMeta(posMeta, dir);
        if (probe && Number.isFinite(probe.remaining) && probe.remaining > 0) {
          const expired = Number.isFinite(probe.expiresMs) && Number.isFinite(effectiveBarMs) && effectiveBarMs > probe.expiresMs;
          if (expired) {
            coreProbeClear = probe;
          } else if (Number.isFinite(signalTfMs) && Number.isFinite(probe.barMs) && Number.isFinite(effectiveBarMs)) {
            const barsSince = Math.round((effectiveBarMs - probe.barMs) / signalTfMs);
            if (barsSince >= 0 && barsSince <= 1) {
              qtyFraction = Math.min(qtyFraction, probe.remaining);
              coreProbeClear = probe;
              features._core_probe_confirm = true;
              immediateReason = "CORE_CONFIRM_NEXT_BAR";
            }
          }
        }
      }

      if (!immediateReason && isRealEvent && immediateCfg.realEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (realBuy + immediateCfg.realScoreMargin) : score <= (realSell - immediateCfg.realScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minWaveConf : false;
        const regimeOk = regime ? regime === "trend" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && volStrong && conflictOk) {
          immediateEntry = true;
          immediateReason = "REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateReason && isPreRealEvent && immediateCfg.preRealEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY"
            ? score >= (coreBuy + immediateCfg.preRealScoreMargin)
            : score <= (coreSell - immediateCfg.preRealScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minPreRealConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minPreRealWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "PRE_REAL_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }

      if (!immediateEntry && !immediateReason && isCoreEvent && immediateCfg.coreEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= (coreBuy + immediateCfg.coreScoreMargin) : score <= (coreSell - immediateCfg.coreScoreMargin))
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minCoreConf : false;
        const regimeOk = regime ? regime !== "range" : false;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && regimeOk && volStrong && conflictOk) {
          const fraction = immediateCfg.coreFraction;
          const immediateQty = qtyFraction * fraction;
          const remainingQty = qtyFraction - immediateQty;
          if (Number.isFinite(immediateQty) && immediateQty > 0 && Number.isFinite(remainingQty) && remainingQty > 0) {
            qtyFraction = immediateQty;
            immediateEntry = true;
            immediateReason = "CORE_IMMEDIATE_PROBE";
            coreProbePatch = {
              remaining: remainingQty,
              barMs: Number.isFinite(effectiveBarMs) ? effectiveBarMs : null,
              expiresMs: Number.isFinite(signalTfMs) && Number.isFinite(effectiveBarMs)
                ? (effectiveBarMs + signalTfMs)
                : null,
            };
            features._core_probe_fraction = fraction;
            features._entry_exec_timing = "IMMEDIATE";
          }
        }
      }

      if (!immediateEntry && !immediateReason && isEarlyEvent && immediateCfg.earlyEnabled) {
        const scoreOk = Number.isFinite(score)
          ? (s.side === "BUY" ? score >= immediateCfg.earlyScoreAbs : score <= -immediateCfg.earlyScoreAbs)
          : false;
        const confOk = Number.isFinite(confidence) ? confidence >= immediateCfg.minEarlyConf : false;
        const waveOk = Number.isFinite(waveConf) ? waveConf >= immediateCfg.minEarlyWaveConf : false;
        const regimeOk = regime ? regime !== "range" : true;
        const conflictOk = conflict !== true;
        if (scoreOk && confOk && waveOk && regimeOk && conflictOk) {
          immediateEntry = true;
          immediateReason = "EARLY_IMMEDIATE_ENTRY";
          features._entry_exec_timing = "IMMEDIATE";
        }
      }
    }

    if (coreProbeClear && coreProbeClear.base) {
      metaUpdates[`${coreProbeClear.base}_remaining_pct`] = 0;
      metaUpdates[`${coreProbeClear.base}_bar_ms`] = null;
      metaUpdates[`${coreProbeClear.base}_expires_ms`] = null;
    }

    if (coreProbePatch && intentDir) {
      const base = `core_probe_${String(intentDir).toLowerCase()}`;
      metaUpdates[`${base}_remaining_pct`] = coreProbePatch.remaining;
      metaUpdates[`${base}_bar_ms`] = coreProbePatch.barMs;
      metaUpdates[`${base}_expires_ms`] = coreProbePatch.expiresMs;
    }

    if (intentDir && (intent === "ENTRY" || intent === "ADD") && Number.isFinite(effectiveBarMs)) {
      const lastKey = `last_entry_bar_ms_${String(intentDir).toLowerCase()}`;
      metaUpdates[lastKey] = effectiveBarMs;
      const tier = resolveSignalTierFromEvent(s.event, s.features);
      if (Number.isFinite(tier)) {
        const tierKey = `last_entry_tier_${String(intentDir).toLowerCase()}`;
        const prevTier = Number(posMeta && posMeta[tierKey]);
        metaUpdates[tierKey] = Number.isFinite(prevTier) ? Math.max(prevTier, tier) : tier;
      }
    }

    if (!s.signal_id) {
      const savedSignal = await upsertSignal({
        exchange,
        symbol,
        tf,
        barCloseTimeUtc: signalBarCloseUtcForIntent,
        barCloseTimeUtcMs: signalBarCloseMsForIntent,
        event: s.event,
        side: s.side,
        qtyPct: qtyFraction,
        reason: s.reason || "INTERNAL_SIGNAL",
        features,
        executionMode: intentExecutionMode,
        source: "SERVER",
        authoritative: true,
        runId,
        decisionReason: s.reason || "INTERNAL_SIGNAL",
      });
      if (savedSignal && savedSignal.signal_id) {
        s.signal_id = savedSignal.signal_id;
        if (!s.signal_doc_id) s.signal_doc_id = savedSignal.signal_id;
        if (!features.signal_id) features.signal_id = savedSignal.signal_id;
        if (!features.signal_doc_id) features.signal_doc_id = s.signal_doc_id;
      }
      if (savedSignal && savedSignal.signal_id && (savedSignal.decision === "CREATED" || savedSignal.decision === "UPDATED_CHANGED")) {
        sendSignalReceivedAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          reason: s.reason || "INTERNAL_SIGNAL",
          signalId: savedSignal.signal_id,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
        }).catch((err) => {
          console.warn("[SIGNAL_RECEIVED_ALERT_FAIL]", err?.message || err);
        });
      }
    }

    const isImmediateExit = exitImmediateEnabled && intent === "EXIT";
    const isExternalSignal = !!s.signal_id;
    const execOnCurrentBar = intentIsEntry && isExternalSignal && Number.isFinite(effectiveBarMs) && Number.isFinite(execBarCloseMs)
      && effectiveBarMs <= execBarCloseMs;
    const isImmediateEntry = immediateEntry === true || execOnCurrentBar;
    if (execOnCurrentBar && features._entry_exec_timing == null) {
      features._entry_exec_timing = "EXEC_CURRENT_BAR";
    }
    const nextExecMsFromSignal = (Number.isFinite(execTfMs) && Number.isFinite(signalBarCloseMsForIntent))
      ? addMs(signalBarCloseMsForIntent, execTfMs)
      : nextExecMs;
    const execBarCloseMsForIntent = (isImmediateExit || isImmediateEntry)
      ? execBarCloseMs
      : (Number.isFinite(nextExecMsFromSignal) ? Math.max(nextExecMsFromSignal, execBarCloseMs) : nextExecMs);
    const execBarCloseUtcForIntent = Number.isFinite(execBarCloseMsForIntent)
      ? msToUtcZ(execBarCloseMsForIntent)
      : execBarCloseUtc;
    // EXIT_ONLY tick loop retries must not reuse a canceled hourly intent id.
    const intentSignalBarCloseMs = (isImmediateExit && backfillExitOnly === true && Number.isFinite(execBarCloseMsForIntent))
      ? Number(execBarCloseMsForIntent)
      : signalBarCloseMsForIntent;
    const intentSignalBarCloseUtc = Number.isFinite(intentSignalBarCloseMs)
      ? msToUtcZ(intentSignalBarCloseMs)
      : signalBarCloseUtcForIntent;
    const pendingReason = isImmediateExit
      ? "IMMEDIATE_EXEC"
      : (isImmediateEntry ? (execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")) : "WAIT_NEXT_BAR");
    const pendingNote = (isImmediateExit || isImmediateEntry)
      ? `immediate_exec=${execBarCloseUtcForIntent}`
      : `next_exec=${execBarCloseUtcForIntent}`;
    if (intent === "EXIT") {
      const linkedEntryEventId = String(
        (features.entry_event_id || posMeta.entry_event_id || "")
      ).trim();
      const linkedEntrySignalType = String(
        (features.entry_signal_type || posMeta.entry_signal_type || "")
      ).toUpperCase();
      const linkedEntryGrade = String(
        (features.entry_grade || posMeta.entry_grade || posMeta.entry_timing_tier || "")
      ).toUpperCase();
      const linkedEntryQtyProfile = String(
        (features.entry_qty_profile || posMeta.entry_qty_profile || posMeta.entry_qty_tier || "")
      ).toUpperCase();
      if (linkedEntryEventId && !features.entry_event_id) features.entry_event_id = linkedEntryEventId;
      if (linkedEntrySignalType && !features.entry_signal_type) features.entry_signal_type = linkedEntrySignalType;
      if (linkedEntryGrade && !features.entry_grade) features.entry_grade = linkedEntryGrade;
      if (linkedEntryQtyProfile && !features.entry_qty_profile) features.entry_qty_profile = linkedEntryQtyProfile;
    }

    if (isTpP1Event && intent === "EXIT") {
      const pendingAtMs = Date.now();
      metaUpdates.tp_p1_pending = true;
      metaUpdates.tp_p1_pending_at_ms = Number.isFinite(pendingAtMs) ? pendingAtMs : null;
      metaUpdates.tp_p1_pending_until_ms = Number.isFinite(pendingAtMs) ? (pendingAtMs + tpP1PendingHoldMs) : null;
      metaUpdates.tp_p1_pending_event = s.event;
    }

    // 2026-04-28 F2 Phase 5 hotfix #4 — V2 server-native ENTRY signal
    // bypass. The legacy bridge gate (isV2DiscoveryCanaryLegacyEntryWriteBlocked)
    // requires liveCfg.v2DiscoveryCanaryBridge === true, which itself
    // requires Firestore system_settings_BINANCEFUT.execution_mode = "LIVE".
    // We deliberately keep system_settings = PAPER so V1 LIVE-only branches
    // never trigger; the trade-off is that V2 server-native ENTRY signals
    // (features.v2_server_native === true, source = V2_SERVER_ENTRY_SIGNAL_GENERATOR)
    // would be silently dropped at this gate. Bypass: any signal explicitly
    // tagged as V2 server-native enters the discovery handoff regardless
    // of liveCfg.executionMode. The handoff bridge / productionEntryRoute
    // still apply discovery_canary blockers (DISCOVERY_CANARY_ENABLED,
    // RISK_GOVERNOR_REQUIRED, MAX_NOTIONAL_QUOTE, etc.) so this does not
    // re-enable any unsafe path.
    const isV2ServerNativeEntry = !!(s && s.features && s.features.v2_server_native === true)
      && (intent === "ENTRY" || intent === "ADD");
    if (isV2DiscoveryCanaryLegacyEntryWriteBlocked({ liveCfg, intent }) || isV2ServerNativeEntry) {
      features.v2_discovery_signal_fan_in_handoff = true;
      features.v2_discovery_entry_filter_authority = "PRODUCTION_ENTRY_ROUTE";
      if (isV2ServerNativeEntry) {
        features.v2_server_native_signal_bypass = true;
      }
      const handoffIntentRow = buildV2DiscoverySignalFanInIntentRow({
        exchange,
        symbol,
        tf,
        signal: s,
        features,
        qtyFraction,
        intentExecutionMode,
        signalBarCloseUtcForIntent,
        signalBarCloseMsForIntent,
        intentSignalBarCloseUtc,
        intentSignalBarCloseMs,
        execBarCloseUtcForIntent,
        execBarCloseMsForIntent,
        signalDocId: s.signal_doc_id || null,
        signalPrice: Number(bar && (bar.close ?? bar.c)),
        runId,
      });
      const handoff = await runV2DiscoveryCanaryServerSignalHandoff({
        env: process.env,
        intentRow: handoffIntentRow,
        liveCfg,
        referencePrice: Number(bar && (bar.open ?? bar.o)) || handoffIntentRow.signal_price || Number(bar && (bar.close ?? bar.c)),
        requestId: handoffIntentRow.request_id,
      }).catch((error) => ({
        ok: false,
        reason: "V2_DISCOVERY_BRIDGE_THROWN",
        error_message: error && error.message ? String(error.message) : String(error),
      }));
      if (handoff && handoff.ok === true) {
        const requestBody = handoff.request && handoff.request.body ? handoff.request.body : {};
        const requestBundle = requestBody.bundle || {};
        const requestPermit = requestBody.executionPermit || {};
        const routeReason = "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE";
        const handoffSignalId = s.signal_id || (features && features.signal_id) || null;
        const handoffSignalClaim = await claimSignalForProgressAlert({
          signalId: handoffSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: routeReason,
          meta: {
            intent: intent || null,
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        });
        if (handoffSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          signalId: handoffSignalId,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: routeReason,
          pendingReason: "IMMEDIATE_EXEC",
          scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
          meta: {
            v2_discovery_bridge_reason: handoff.reason || null,
            v2_openclaw_decision_bundle_hash: requestBundle.openclawDecisionBundleHash || null,
            v2_openclaw_execution_permit_id: requestPermit.openclaw_execution_permit_id || null,
          },
        }).catch((err) => {
          console.warn("[V2_DISCOVERY_SIGNAL_FAN_IN_HANDOFF_ALERT_FAIL]", err?.message || err);
        });
        continue;
      }
      const blockReason = deriveV2DiscoveryHandoffBlockReason(handoff);
      const postFillHandoff = classifyV2DiscoveryPostFillHandoff(handoff);
      if (postFillHandoff.exchange_write_performed === true) {
        const postFillSignalId = s.signal_id || (features && features.signal_id) || null;
        const postFillSignalClaim = await claimSignalForProgressAlert({
          signalId: postFillSignalId,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: blockReason,
          critical: postFillHandoff.unprotected_position_possible === true,
          meta: {
            intent: intent || null,
            v2_discovery_post_fill_exchange_write: true,
            v2_discovery_post_fill_unprotected_possible: postFillHandoff.unprotected_position_possible === true,
          },
        });
        if (postFillSignalClaim.ok !== true) {
          continue;
        }
        sendSignalProgressAlert({
          exchange,
          symbol,
          tf,
          event: s.event,
          side: s.side,
          qtyPct: qtyFraction,
          signalId: postFillSignalId,
          executionMode: intentExecutionMode,
          source: "SERVER",
          authoritative: true,
          progressReason: blockReason,
          pendingReason: "POST_FILL_RECONCILE",
          scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
          meta: {
            ...buildV2DiscoveryHandoffFeaturePatch(handoff),
            post_fill_note: postFillHandoff.note || null,
          },
        }).catch((err) => {
          console.warn("[V2_DISCOVERY_SIGNAL_FAN_IN_POST_FILL_ALERT_FAIL]", err?.message || err);
        });
        continue;
      }
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: blockReason,
        drop_reason_code: blockReason,
        features_json: {
          ...(features || {}),
          v2_discovery_signal_fan_in_blocked: true,
          ...buildV2DiscoveryHandoffFeaturePatch(handoff),
        },
        event_intent: intent,
      });
      continue;
    }

    if (isImmediateEntry || immediateReason === "CORE_CONFIRM_NEXT_BAR") {
      console.log(
        `[immediate_entry] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${execOnCurrentBar ? "EXEC_CURRENT_BAR" : (immediateReason || "IMMEDIATE_ENTRY")} sched=${execBarCloseUtcForIntent}`
      );
    }
    if (!isImmediateExit && !isImmediateEntry && isExternalSignal && intentIsEntry) {
      console.log(
        `[intent_scheduled] ex=${exchange} sym=${symbol} tf=${tf} ev=${s.event} side=${s.side} qty=${qtyFraction} reason=${pendingReason} sched=${execBarCloseUtcForIntent}`
      );
    }

    const rescueAddCommitGuard = evaluateCommittedRescueAddGate({
      applied: intent === "ADD" && (s.features._rescue_add_applied === true || s.features._replay_rescue_add_applied === true),
      replay: s.features._replay_rescue_add_applied === true,
      pendingAddCount: committedRescueAddCount,
      pendingAddSignalBarMs: committedRescueAddSignalBarMs,
      signalBarCloseMs: intentSignalBarCloseMs,
      maxAdds: s.features._rescue_add_applied === true
        ? s.features._rescue_add_max_adds
        : s.features._replay_rescue_add_max_adds,
      sameBarBlock: s.features._rescue_add_applied === true
        ? s.features._rescue_add_same_bar_block
        : s.features._replay_rescue_add_same_bar_block,
    });
    if (!rescueAddCommitGuard.ok) {
      signalDrops.push({
        ...s,
        bar_close_time_utc_ms: effectiveBarMs,
        qty_pct: qtyFraction,
        reason: rescueAddCommitGuard.reason || "RESCUE_ADD_BLOCKED",
        drop_reason_code: rescueAddCommitGuard.reason || "RESCUE_ADD_BLOCKED",
        features_json: {
          ...(s.features || {}),
          rescue_add_commit_guard: rescueAddCommitGuard.detail || null,
        },
        event_intent: intent,
      });
      continue;
    }

    await upsertIntent({
      exchange,
      symbol,
      tf,
      signalBarCloseTimeUtc: intentSignalBarCloseUtc,
      signalBarCloseTimeUtcMs: intentSignalBarCloseMs,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
      scheduledExecBarCloseUtcMs: execBarCloseMsForIntent,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      reason: s.reason || "SIGNAL",
      features,
      signalId: s.signal_id || (features && features.signal_id) || null,
      runId,
      executionMode: intentExecutionMode,
      budgetMaxKrw: useBudget ? riskBudget.maxKrw : null,
      budgetUsedKrw: useBudget ? (riskBudget.maxKrw * qtyFraction) : null,
      qtyFraction: useBudget ? qtyFraction : null,
      signalPrice: Number(bar && (bar.close ?? bar.c)),
      signalDocId: s.signal_doc_id || null,
      pendingReason,
      pendingNote,
      ttlMs,
      execTf: execTfFinal,
      decisionReason: s.reason || "INTENT_CREATED",
    });

    sendSignalProgressAlert({
      exchange,
      symbol,
      tf,
      event: s.event,
      side: s.side,
      qtyPct: qtyFraction,
      signalId: s.signal_id || (features && features.signal_id) || null,
      executionMode: intentExecutionMode,
      source: "SERVER",
      authoritative: true,
      progressReason: "INTENT_CREATED",
      pendingReason,
      scheduledExecBarCloseUtc: execBarCloseUtcForIntent,
    }).catch((err) => {
      console.warn("[SIGNAL_PROGRESS_ALERT_FAIL]", err?.message || err);
    });

    if (intent === "ADD" && (s.features._rescue_add_applied === true || s.features._replay_rescue_add_applied === true)) {
      committedRescueAddCount += 1;
      committedRescueAddSignalBarMs = Number.isFinite(Number(intentSignalBarCloseMs))
        ? Number(intentSignalBarCloseMs)
        : committedRescueAddSignalBarMs;
    }

    if (s.signal_id) {
      const lock = await tryLockSignal({ signalId: s.signal_id, runId });
      if (lock && lock.ok) {
        await markSignalConsumed({
          signalId: s.signal_id,
          runId,
          consumedAtIso: new Date().toISOString(),
          execBarCloseMs: execBarCloseMsForIntent,
          execBarCloseUtc: execBarCloseUtcForIntent,
          reason: "INTENT_CREATED",
          meta: { intent: intent || null },
        });
      }
    }

    intentsCreated += 1;
    if (isImmediateEntry) immediateIntentsCreated += 1;
  }
  if (signalDrops.length) {
    recordedSignalDrops = await filterSignalDropsForRecording({ drops: signalDrops, runId });
  }
  if (recordedSignalDrops.length) {
    await recordSignalDrops({
      exchange,
      symbol,
      tf: signalTf,
      runId,
      drops: recordedSignalDrops.map((d) => ({ ...d, execution_mode: intentExecutionMode })),
    });
    await consumeDroppedSignals({
      drops: recordedSignalDrops,
      runId,
      execBarCloseMs,
      execBarCloseUtc,
    });
  }

  const sanitizedMetaUpdates = sanitizeBarLoopMetaUpdates(metaUpdates);
  if (Object.keys(sanitizedMetaUpdates).length) {
    posMeta = await applyBarLoopObservationMetaUpdate({
      exchange,
      symbol,
      position: pos,
      posMeta,
      positionSide: posSide || null,
      runId,
      executionMode: intentExecutionMode,
      metaPatch: sanitizedMetaUpdates,
    });
  }

  if (exitImmediateEnabled || immediateIntentsCreated > 0) {
    const immediateIntents = await listPendingIntentsForExec({
      exchange,
      symbol,
      tf: signalTf,
      execBarCloseMs,
      limitN: 50,
    });
    if (Array.isArray(immediateIntents) && immediateIntents.length) {
      await executeIntentList(sortIntentsForExecution(immediateIntents));
      pos = await getPositionReadView({ exchange, symbol });
      posMeta = (pos && typeof pos.meta === "object") ? { ...pos.meta } : posMeta;
      posSide = normalizePositionSide(
        pos.position_side ||
        pos.side ||
        (pos.meta && (pos.meta.position_side || pos.meta.external_side || pos.meta.external_position_side))
      );
      if (!posSide && hasPositionSize(pos.size_pct)) posSide = "LONG";
      posQtyBase = resolvePosQtyBase(pos);
    }
  }

  const trailUpdates = computeTrailingMetaUpdate({ exchange, bar, position: pos, posMeta, positionSideFallback: posSide });
  if (trailUpdates) {
    posMeta = await applyBarLoopObservationMetaUpdate({
      exchange,
      symbol,
      position: pos,
      posMeta,
      positionSide: posSide || null,
      runId,
      executionMode: intentExecutionMode,
      metaPatch: trailUpdates,
    });
  }

  return {
    fills_executed: fillsExecuted,
    intents_created: intentsCreated,
    signals_seen: signals.length,
    signals_external: externalSignals.length,
    signals_internal: internalSignals.length,
    signals_external_late: lateSignals,
    signal_drop_n: recordedSignalDrops.length,
    signal_drop_suppressed_n: Math.max(0, signalDrops.length - recordedSignalDrops.length),
    signal_drop_reason_counts: recordedSignalDrops.reduce((acc, row) => {
      const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {}),
    top_signal_drop_reason: recordedSignalDrops.length
      ? Object.entries(recordedSignalDrops.reduce((acc, row) => {
        const reason = String(row && (row.drop_reason_code || row.reason) || "UNKNOWN");
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {})).sort((a, b) => b[1] - a[1])[0][0]
      : null,
  };
}

module.exports = {
  runPaperBinanceForBar,
  runPaperFuturesForBar,
  syncFuturesPositionOnly,
  runDistributedFuturesPositionSync,
  resolveFuturesPositionSyncRequest,
  refreshBinanceNativeProtectionWithRetry,
  requestBinanceNativeProtectionRefresh,
  buildNativeProtectionMetaPatch,
  notifyNativeProtectionResult,
  resolveLiveFuturesConfig,
  repairActivePositionExitRuntimeState,
  __test: {
    applyAddRiskMetaOnFill,
    buildTimeStopExitSignal,
    buildNativeProtectionMetaPatch,
    // 2026-04-20 senior-audit P2
    resolveNativeProtectionUnprotectedWindowFields,
    shouldFailClosedForIncompleteTp1Protection,
    inferEntryMetaDirection,
    canEvaluateInternalExitSignalsForBar,
    finalizeInternalSignals,
    shouldSuppressLiveFuturesInternalExitSignal,
    shouldSuppressInternalLiveExitFillAlert,
    filterLiveFuturesInternalSignals,
    scaleBaseBarCountByTf,
    resolveTfFromMs,
    resolveBinanceMaxHoldBars,
    resolveForceAllSignalsAdd,
    hasAiSignal,
    isAiRequired,
    resolveAiMissingPolicy,
    isManualRetryFeatures,
    resolveAddRiskConfig,
    ensureLogicalAddCapState,
    resolveCurrentQtyPctForCap,
    resolveLogicalCurrentQtyPctForBudget,
    resolveLiveExitCurrentQtyPct,
    resolveIntentFillCloseRatio,
    isCriticalLiveExitExceptionEvent,
    buildLiveExitExceptionIntegrityAlertPayload,
    resolveCanonicalExitAlertBlock,
    shouldEmitCanonicalExitAlert,
    buildExitOrderContractRecordPayload,
    resolveSyncedAddChainBaseQtyPct,
    resolveBudgetUsedFromNotional,
    resolveBinanceBudgetUsedKrw,
    evaluateAddIntentRiskGuard,
    resolveLiveRescueAddConfig,
    resolveReplayRescueAddConfig,
    isCoreOrRealEvent,
    resolveSameDirectionTrailProfitCooldownConfig,
    buildSameDirectionTrailProfitCooldownMetaPatch,
    buildSameDirectionTrailProfitObservationPayload,
    buildSameDirectionTrailProfitLegacyResetMetaPatch,
    resolveSameDirectionTrailProfitCooldownBlock,
    resolveSameDirectionTrailProfitCooldownSnapshot,
    loadSameDirectionTrailProfitObservationSafe,
    resolveFuturesPositionSyncRequest,
    evaluateLiveRescueAdd,
    evaluateReplayRescueAdd,
    resolveEvGateConfig,
    resolveEvGateDecision,
    resolveEvGateTradePlan,
    applyEvQtyScale,
    restoreFixedEntryQtyFraction,
    shouldBypassEvEntryGate,
    buildSignalStageFeatures,
    evaluateEvEntryGate,
    resolveWaitOneBarConfig,
    evaluateWaitOneBarTiming,
    resolveAiBiasEntryGateConfig,
    evaluateAiBiasEntryGate,
    resolveShortEntryGateConfig,
    evaluateShortEntryGate,
    resolveEntryQualityGateConfig,
    evaluateEntryQualityGate,
    resolveCanonicalEntryConfig,
    evaluateCanonicalEntryGate,
    mergeCanonicalDecisionDetail,
    stripExchangeOwnedProjectionMeta,
    resolveOptimisticNativeProtectionMetaPatch,
    buildFuturesPositionSyncKey,
    shouldSkipRecentFuturesPositionSync,
    markRecentFuturesPositionSync,
    serializeFuturesPositionSync,
    buildFuturesPositionSyncLeaseDocPath,
    runDistributedFuturesPositionSync,
    shouldForceImmediateLiveFuturesReconcile,
    buildMetaPatch,
    upsertPositionWithLatestRetry,
    upsertPositionMetaOnlyWithLatestRetry,
    sanitizeBarLoopMetaUpdates,
    applyBarLoopObservationMetaUpdate,
    applyTpP1IntentFillMetaUpdate,
    buildOpenCloseProjectionResetMetaPatch,
    buildOpenCloseTransitionMetaPatch,
    buildClosingFillMetaPatch,
    buildOpeningFillMetaPatch,
    buildSyntheticOpeningEntryEventId,
    SYNTHETIC_OPENING_ENTRY_EVENT_ID_PREFIX,
    SYNTHETIC_OPENING_ENTRY_SIGNAL_TYPE,
    resolvePineStage1BundleMeta,
    resolveSignalTier,
    computeTrailingMetaUpdate,
    resolveEntryQualityTier,
    isExitMetaLinkedToEntry,
    isExternalEntrySignalCandidate,
    compareEntrySignalPriority,
    buildEntrySignalResolutionDetail,
    resolveEntrySignalsByFamily,
    logEntrySignalFamilyResolutions,
    dedupeEntrySignalsByFamily,
    applyEntryBudgetSignalFloor,
    resolveEntryMinOrderBudgetAdjustment,
    resolveEntryTierBudgetMax,
    evaluateCommittedRescueAddGate,
    collectActivePendingAddIntentState,
    applyAddAndProtectionMetaOnFill,
    applyTpP0IntentFillMetaUpdate,
    isBinanceImmediateTriggerError,
    resolveManualRetryQtyBase,
    resolveEventRefMs,
    shouldBypassOppositeEntryCooldown,
    shouldBlockSignalOverlap,
    resolveOppositeCooldownWindow,
    resolveOppositeCooldownWindowFromPosition,
    resolveLiveMarketRegimeCohort,
    resolveTp1LadderConfig,
    resolveTp1LadderRuntimeState,
    resolveTp1LadderKpiForContext,
    buildBinanceNativeRefreshLeaseDocPath,
    shouldCleanupExternalFlatOrders,
    collectCriticalExitRuleViolations,
    isAuthorizedBinanceNativeStopWriter,
    resolveNativeProtectionStageState,
    resolveSimplifiedExitV2PositionFlag,
    isForbiddenTp0ExitIntent,
    isExplicitLegacyTp0Position,
    resolveNativeProtectionPositionMeta,
    shouldExecuteImmediateNativeProtectionRefresh,
    ensureLiveImmediateNativeProtection,
    resolveLiveOrderSignalRefs,
    buildLiveNativeProtectionRefreshArgs,
    requestBinanceNativeProtectionRefresh,
    buildRescueAddRepriceAlertContext,
    computeBinanceNativeProtectionPrices,
    shouldRepairActiveExitRuntimeState,
    repairActivePositionExitRuntimeState,
    isRetryableNativeProtectionReason,
    syncNativeProtectionMetaAfterRefresh,
    resolveLiveNativeProtectionLifecycleFlags,
    applyEntryExitRuleRuntimeAdjustments,
    loadTp1LadderKpiSnapshot,
    resolveStructureInitialStopPrice,
    resolveInitialStopSource,
    sendRescueAddRepriceAlert,
    notifyNativeProtectionResult,
    normalizeSignalStateToken,
    splitRuntimeList,
    evaluateV2DiscoveryCanaryLiveBridge,
    clampDiscoveryCanaryMaxOrderQuote,
    isV2DiscoveryCanaryLegacyExchangeWriteBlocked,
    isV2DiscoveryCanaryLegacyEntryWriteBlocked,
    shouldTreatLegacyWaitOneBarAsAdvisoryForV2Discovery,
    shouldBypassLegacyEntryFiltersForV2Discovery,
    resolveV2DiscoveryHandoffDetail,
    buildV2DiscoveryHandoffFeaturePatch,
    resolveV2DiscoveryPostFillSideEffect,
    classifyV2DiscoveryPostFillHandoff,
    deriveV2DiscoveryHandoffBlockReason,
    resolveSignalIdFromSignalLike,
    filterSignalDropsForRecording,
    pickSignalRegime,
    isBinanceMultiAssetsIsolatedMarginBlocked,
    isBinanceMarginTypeOpenOrdersConflict,
    applyOpenClawExecutorDecision,
    resolveAdaptiveFuturesExitProfile,
    resolveConfiguredFuturesExitProfileMode,
    resolveRecentExternalFlatSyncGuard,
    normalizeEntryLineage,
    buildFlatSyncReconcileInputMeta,
    resolveV2FlatSyncExitReplayPlan,
    buildEntryLineageMetaPatch,
    shouldProbeRecoveredEntryTransition,
    shouldTreatRecoveredLineageAsEntryTransition,
    resolveActiveEntryLineageForSync,
    resolveEntryLineageForFill,
    extractEntryLineageCandidate,
    loadPositionRuntimeObservationSafe,
    applyTrailObservationSnapshotToMeta,
    resolveRiskBudget,
    pickLatestTpP0Fill,
    reconcileTpP0MetaFromFill,
    reconcileTpP0MetaFromFill,
    pickLatestTpP1Fill,
    reconcileTpP1MetaFromFill,
    isRetryableLiveInfraError,
    placeNativeStopImmediateTriggerFailClosed,
    fetchFuturesExchangeInfoWithCache,
    ensureLiveFuturesLeverage,
    heartbeatBinanceNativeRefreshLease,
  },
};

// Backward-compatible alias
// - scheduler.js 는 runPaperMarket 이름으로 import/call 하고 있다.
// - 내부 구현은 runPaperBinanceForBar 를 그대로 사용한다.
async function runPaperMarket(opts) {
  const ex = String(opts && opts.exchange || "BINANCEFUT").toUpperCase();
  if (ex.includes("BINANCE")) return runPaperFuturesForBar(opts);
  return {
    ok: false,
    skipped: true,
    reason: "UNSUPPORTED_EXCHANGE_REMOVED",
    exchange: ex || "UNKNOWN",
  };
}

module.exports.runPaperMarket = runPaperMarket;
