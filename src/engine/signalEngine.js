// src/engine/signalEngine.js
// Binance Futures primary runtime exit engine
//
// 목적:
// - 외부 BUY 신호로 포지션이 열렸을 때
// - 내부 규칙(손절/익절)에 따라 SELL 신호를 생성해 trade를 닫는다
//
// 주의:
// - 손절/익절 값은 charterExpectations를 기본값으로 사용
// - 환경변수(ENGINE_*)로 override 가능

const { CHARTER_EXPECTATIONS } = require("../config/charterExpectations");
const { resolvePositionSideFromPosition } = require("../utils/positionSide");
const {
  isSimplifiedExitV2Active,
  resolveSimplifiedExitV2FlagFromSnapshot,
  resolveExecutionMode,
} = require("../services/simplifiedExitV2");
const { buildV2SimpleExitRulesPatch, isFullTpExitRatio } = require("../v2/exitPolicy");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function pct(a, b) {
  // (a-b)/b
  const aa = toNum(a);
  const bb = toNum(b);
  if (aa === null || bb === null || bb === 0) return null;
  return (aa - bb) / bb;
}

function pnlToPrice({ avg, pnlPct, side }) {
  const avgNum = toNum(avg);
  const pnlNum = toNum(pnlPct);
  if (avgNum === null || avgNum <= 0 || pnlNum === null) return null;
  const s = String(side || "").toUpperCase();
  if (s === "SHORT") return avgNum * (1 - pnlNum);
  return avgNum * (1 + pnlNum);
}

function parseNumEnv(key, fallback) {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolEnv(key, fallback = false) {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function isSimplifiedExitV2Enabled(snapshot = {}) {
  return isSimplifiedExitV2Active(snapshot);
}

function isTp0RetiredRuntime(snapshot = {}) {
  void snapshot;
  return true;
}

function isExplicitLegacyTp0Enabled(snapshot = {}) {
  void snapshot;
  return false;
}

function stripTp0RulesForSimplifiedExitV2(rules = {}, snapshot = null) {
  const source = rules && typeof rules === "object" ? rules : {};
  if (!isTp0RetiredRuntime(snapshot)) return source;
  const tp0Retired = {
    ...source,
    TP_P0: 0,
    TP_P0_QTY: 0,
    TP_P0_ATR_MULTIPLE: 0,
  };
  if (!isSimplifiedExitV2Enabled(snapshot)) return tp0Retired;
  return {
    ...tp0Retired,
    ...buildV2SimpleExitRulesPatch(),
  };
}

function pctLabel(pct, { maxDecimals = 2 } = {}) {
  const n = toNum(pct);
  if (n === null) return null;
  let v = Math.abs(n) * 100;
  if (!Number.isFinite(v)) return null;
  const pow = Math.pow(10, maxDecimals);
  v = Math.round(v * pow) / pow;
  let s = v.toFixed(maxDecimals);
  s = s.replace(/\.?0+$/, "");
  return s || null;
}

function parseIsoMs(v) {
  if (!v) return null;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function resolveTrailSnapshotMeta(meta = {}) {
  const metaSafe = (meta && typeof meta === "object") ? meta : {};
  const snapshot = (metaSafe.trail_observation_snapshot && typeof metaSafe.trail_observation_snapshot === "object")
    ? metaSafe.trail_observation_snapshot
    : null;
  if (!snapshot) return metaSafe;
  return {
    ...metaSafe,
    trail_high: snapshot.trail_high ?? metaSafe.trail_high ?? null,
    trail_high_at_ms: snapshot.trail_high_at_ms ?? metaSafe.trail_high_at_ms ?? null,
    trail_low: snapshot.trail_low ?? metaSafe.trail_low ?? null,
    trail_low_at_ms: snapshot.trail_low_at_ms ?? metaSafe.trail_low_at_ms ?? null,
    trail_active: snapshot.trail_active ?? metaSafe.trail_active ?? false,
  };
}

function resolveContractExitQtyPct(size, targetQtyPct) {
  const currentSize = Number(size);
  if (!Number.isFinite(currentSize) || currentSize <= 0) return 0;
  const target = Number(targetQtyPct);
  if (!Number.isFinite(target) || target <= 0) return currentSize;
  return Math.min(currentSize, Math.max(0, target));
}

function resolveTpP1State(meta = {}) {
  const metaSafe = resolveTrailSnapshotMeta(meta);
  const rawTpP1Done = metaSafe.tp_p1_done === true;
  const rawTrailActive = metaSafe.trail_active === true;
  if (!rawTpP1Done) {
    return { tpP1Done: false, trailActive: false, linkedToEntry: false };
  }

  const entryEventId = String(metaSafe.entry_event_id || "").trim();
  const tpP1EntryEventId = String(metaSafe.tp_p1_entry_event_id || "").trim();
  const entryExecMs = toNum(metaSafe.entry_exec_bar_ms);
  const tpP1EntryExecMs = toNum(metaSafe.tp_p1_entry_exec_bar_ms);
  const tpP1AtMs = parseIsoMs(metaSafe.tp_p1_at);

  let linkedToEntry = true;
  if (entryEventId && tpP1EntryEventId && entryEventId !== tpP1EntryEventId) {
    linkedToEntry = false;
  }

  if (linkedToEntry && Number.isFinite(entryExecMs)) {
    if (Number.isFinite(tpP1EntryExecMs)) {
      if (Math.abs(tpP1EntryExecMs - entryExecMs) > 1000) linkedToEntry = false;
    } else if (Number.isFinite(tpP1AtMs) && (tpP1AtMs + 30000) < entryExecMs) {
      linkedToEntry = false;
    }
  }

  return {
    tpP1Done: rawTpP1Done && linkedToEntry,
    trailActive: rawTrailActive && rawTpP1Done && linkedToEntry,
    linkedToEntry,
  };
}

function resolveTpP0State(meta = {}) {
  const rawTpP0Done = meta.tp_p0_done === true;
  if (!rawTpP0Done) {
    return { tpP0Done: false, linkedToEntry: false };
  }

  const entryEventId = String(meta.entry_event_id || "").trim();
  const tpP0EntryEventId = String(meta.tp_p0_entry_event_id || "").trim();
  const entryExecMs = toNum(meta.entry_exec_bar_ms);
  const tpP0EntryExecMs = toNum(meta.tp_p0_entry_exec_bar_ms);
  const tpP0AtMs = parseIsoMs(meta.tp_p0_at);

  let linkedToEntry = true;
  if (entryEventId && tpP0EntryEventId && entryEventId !== tpP0EntryEventId) {
    linkedToEntry = false;
  }

  if (linkedToEntry && Number.isFinite(entryExecMs)) {
    if (Number.isFinite(tpP0EntryExecMs)) {
      if (Math.abs(tpP0EntryExecMs - entryExecMs) > 1000) linkedToEntry = false;
    } else if (Number.isFinite(tpP0AtMs) && (tpP0AtMs + 30000) < entryExecMs) {
      linkedToEntry = false;
    }
  }

  return {
    tpP0Done: rawTpP0Done && linkedToEntry,
    linkedToEntry,
  };
}

function resolveTpP0Pct({ rules = null, meta = null } = {}) {
  const ruleSafe = rules && typeof rules === "object" ? rules : {};
  const metaSafe = meta && typeof meta === "object" ? meta : {};
  const basePct = toNum(ruleSafe.TP_P0);
  let atrPct = Math.abs(toNum(metaSafe.ev_gate_atr_pct));
  const atrMultiple = toNum(ruleSafe.TP_P0_ATR_MULTIPLE);
  // ev_gate_atr_pct has historically appeared in two units:
  // - fraction form: 0.012 => 1.2%
  // - percentage-point form: 0.509 => 0.509%
  // TP0 runtime must tolerate both, otherwise TP0 can become absurdly large
  // and never trigger before TP1.
  if (Number.isFinite(atrPct) && atrPct > 0) {
    const looksLikePctPoint = atrPct > 1 || (Number.isFinite(basePct) && basePct > 0 && atrPct > (basePct * 4));
    if (looksLikePctPoint) atrPct /= 100;
  }
  if (Number.isFinite(atrPct) && atrPct > 0 && Number.isFinite(atrMultiple) && atrMultiple > 0) {
    if (Number.isFinite(basePct) && basePct > 0) return Math.max(basePct, atrPct * atrMultiple);
    return atrPct * atrMultiple;
  }
  return Number.isFinite(basePct) && basePct > 0 ? basePct : null;
}

function normalizeOpenClawCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function normalizeTp1LadderStage(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function resolveTp1LadderMaxStage(cohort) {
  return 2;
}

function resolveTp1LadderProfile({ cohort, stage } = {}) {
  const maxStage = resolveTp1LadderMaxStage(cohort);
  const safeStage = Math.max(0, Math.min(maxStage, normalizeTp1LadderStage(stage) ?? 0));
  if (safeStage >= 2) return "BASE";
  if (safeStage >= 1) return "MIXED";
  return "RESCUE";
}

function evaluateTp1LadderStage({ cohort, kpi = null, config = null, explicitStage = null } = {}) {
  const maxStage = resolveTp1LadderMaxStage(cohort);
  const normalized = normalizeOpenClawCohort(cohort) || "BASE";
  const explicit = normalizeTp1LadderStage(explicitStage);
  const cfg = (config && typeof config === "object") ? config : {};
  const enabled = cfg.enabled !== false;
  if (explicit !== null) {
    const stage = Math.max(0, Math.min(maxStage, explicit));
    return {
      enabled,
      stage,
      maxStage,
      profile: resolveTp1LadderProfile({ cohort: normalized, stage }),
      reason: "EXPLICIT_STAGE_OVERRIDE",
    };
  }
  if (!enabled) {
    return {
      enabled: false,
      stage: maxStage,
      maxStage,
      profile: resolveTp1LadderProfile({ cohort: normalized, stage: maxStage }),
      reason: "LADDER_DISABLED",
    };
  }
  if (cfg.freeze === true) {
    return {
      enabled,
      stage: 0,
      maxStage,
      profile: resolveTp1LadderProfile({ cohort: normalized, stage: 0 }),
      reason: "LADDER_FROZEN_STAGE_0",
    };
  }

  const snapshot = (kpi && typeof kpi === "object") ? kpi : {};
  const realizedN = Number(snapshot.realized_n ?? snapshot.realizedTradeN);
  const tp0HitRate = Number(snapshot.tp0_hit_rate ?? snapshot.tp0HitRate);
  const tp1HitRate = Number(snapshot.tp1_hit_rate ?? snapshot.tp1HitRate);
  const conversion = Number(snapshot.tp0_to_tp1_conversion ?? snapshot.tp0ToTp1Conversion ?? snapshot.conversion);
  const expectancy = Number(snapshot.fee_adjusted_expectancy ?? snapshot.feeAdjustedExpectancy);
  const hasUsableSnapshot = [
    realizedN,
    tp0HitRate,
    conversion,
    expectancy,
  ].every(Number.isFinite);
  if (!hasUsableSnapshot) {
    return {
      enabled,
      stage: 0,
      maxStage,
      profile: resolveTp1LadderProfile({ cohort: normalized, stage: 0 }),
      reason: "KPI_SNAPSHOT_MISSING",
    };
  }

  const stage1RealizedNMin = Number.isFinite(Number(cfg.stage1RealizedNMin)) ? Number(cfg.stage1RealizedNMin) : 8;
  const stage1Tp0HitRateMin = Number.isFinite(Number(cfg.stage1Tp0HitRateMin)) ? Number(cfg.stage1Tp0HitRateMin) : 0.55;
  const stage1ConversionMin = Number.isFinite(Number(cfg.stage1Tp0ToTp1ConversionMin)) ? Number(cfg.stage1Tp0ToTp1ConversionMin) : 0.20;
  const stage1ExpectancyMin = Number.isFinite(Number(cfg.stage1FeeAdjustedExpectancyMin)) ? Number(cfg.stage1FeeAdjustedExpectancyMin) : -0.0005;
  const stage2RealizedNMin = Number.isFinite(Number(cfg.stage2RealizedNMin)) ? Number(cfg.stage2RealizedNMin) : 16;
  const stage2Tp0HitRateMin = Number.isFinite(Number(cfg.stage2Tp0HitRateMin)) ? Number(cfg.stage2Tp0HitRateMin) : 0.60;
  const stage2Tp1HitRateMin = Number.isFinite(Number(cfg.stage2Tp1HitRateMin)) ? Number(cfg.stage2Tp1HitRateMin) : 0.30;
  const stage2ConversionMin = Number.isFinite(Number(cfg.stage2Tp0ToTp1ConversionMin)) ? Number(cfg.stage2Tp0ToTp1ConversionMin) : 0.35;
  const stage2ExpectancyMin = Number.isFinite(Number(cfg.stage2FeeAdjustedExpectancyMin)) ? Number(cfg.stage2FeeAdjustedExpectancyMin) : 0;

  const stage1Ready = realizedN >= stage1RealizedNMin
    && tp0HitRate >= stage1Tp0HitRateMin
    && conversion >= stage1ConversionMin
    && expectancy >= stage1ExpectancyMin;
  const stage2Ready = maxStage >= 2
    && Number.isFinite(tp1HitRate)
    && realizedN >= stage2RealizedNMin
    && tp0HitRate >= stage2Tp0HitRateMin
    && tp1HitRate >= stage2Tp1HitRateMin
    && conversion >= stage2ConversionMin
    && expectancy >= stage2ExpectancyMin;
  const stage = stage2Ready ? 2 : (stage1Ready ? Math.min(1, maxStage) : 0);
  return {
    enabled,
    stage,
    maxStage,
    profile: resolveTp1LadderProfile({ cohort: normalized, stage }),
    reason: stage2Ready ? "STAGE_2_KPI_READY" : (stage1Ready ? "STAGE_1_KPI_READY" : "STAGE_0_SAMPLING"),
  };
}

function applyTp1LadderPolicy({ rules = null, cohort = null, ladderState = null } = {}) {
  if (!rules || typeof rules !== "object") return rules;
  if (isFullTpExitRatio(rules.TP_P1_QTY)) return rules;
  const state = (ladderState && typeof ladderState === "object") ? ladderState : {};
  const profile = String(state.profile || "").trim().toUpperCase();
  if (!profile) return rules;
  const currentTp1 = toNum(rules.TP_P1);
  const rescueTp1 = toNum(rules.TP_P1_RESCUE_COHORT);
  const mixedTp1 = toNum(rules.TP_P1_MIXED_COHORT);
  const targetTp1 = profile === "RESCUE"
    ? rescueTp1
    : profile === "MIXED"
      ? mixedTp1
      : currentTp1;
  if (!Number.isFinite(targetTp1) || targetTp1 <= 0) return rules;
  const targetBe = profile === "RESCUE"
    ? toNum(rules.BE_PCT_RESCUE_COHORT)
    : profile === "MIXED"
      ? toNum(rules.BE_PCT_MIXED_COHORT)
      : toNum(rules.BE_PCT);
  const targetRunner = profile === "RESCUE"
    ? toNum(rules.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT)
    : profile === "MIXED"
      ? toNum(rules.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT)
      : toNum(rules.RUNNER_MIN_PROFIT_PCT);
  const targetTrailR = profile === "RESCUE"
    ? toNum(rules.TRAIL_R_MULTIPLE_RESCUE_COHORT)
    : profile === "MIXED"
      ? toNum(rules.TRAIL_R_MULTIPLE_MIXED_COHORT)
      : toNum(rules.TRAIL_R_MULTIPLE);
  return {
    ...rules,
    TP_P1: Math.min(Number.isFinite(currentTp1) && currentTp1 > 0 ? currentTp1 : targetTp1, targetTp1),
    BE_PCT: Number.isFinite(targetBe) && targetBe > 0 ? targetBe : rules.BE_PCT,
    RUNNER_MIN_PROFIT_PCT: Number.isFinite(targetRunner) && targetRunner > 0 ? targetRunner : rules.RUNNER_MIN_PROFIT_PCT,
    TRAIL_R_MULTIPLE: Number.isFinite(targetTrailR) && targetTrailR > 0 ? targetTrailR : rules.TRAIL_R_MULTIPLE,
    tp1_ladder_stage: normalizeTp1LadderStage(state.stage),
    tp1_ladder_profile: profile,
    tp1_ladder_reason: state.reason || null,
    tp1_ladder_enabled: state.enabled !== false,
    tp1_ladder_cohort: normalizeOpenClawCohort(cohort) || "BASE",
  };
}

function applyCohortTp1Adjustment({ rules = null, meta = null, exchange = "" } = {}) {
  const ex = normalizeExchangeKey(exchange);
  if (ex !== "BINANCEFUT" || !rules || typeof rules !== "object") return rules;
  const metaSafe = meta && typeof meta === "object" ? meta : {};
  const exitPolicySource = String(metaSafe.exit_policy_source || "").trim().toUpperCase();
  if (exitPolicySource && exitPolicySource !== "BINANCE_DEFAULT") return rules;
  const cohort = normalizeOpenClawCohort(
    metaSafe.openclaw_market_regime_cohort
    || metaSafe.market_regime_cohort
  );
  const ladderProfile = String(metaSafe.tp1_ladder_profile || "").trim().toUpperCase();
  const ladderStage = normalizeTp1LadderStage(metaSafe.tp1_ladder_stage);
  if (ladderProfile || ladderStage !== null) {
    const ladderState = evaluateTp1LadderStage({
      cohort: cohort || "BASE",
      explicitStage: ladderStage,
      config: { enabled: metaSafe.tp1_ladder_enabled !== false },
    });
    if (ladderProfile) ladderState.profile = ladderProfile;
    return applyTp1LadderPolicy({ rules, cohort: cohort || "BASE", ladderState });
  }
  return applyTp1LadderPolicy({
    rules,
    cohort: cohort || "BASE",
    ladderState: {
      enabled: true,
      stage: 0,
      maxStage: resolveTp1LadderMaxStage(cohort || "BASE"),
      profile: "RESCUE",
      reason: "DEFAULT_RESCUE_START",
    },
  });
}

function resolveTrailDelayState({
  meta = null,
  tpP1Done = false,
  currentBarMs = null,
  closePx = null,
  side = null,
  leverageEff = null,
  rules = null,
} = {}) {
  const metaSafe = resolveTrailSnapshotMeta(meta && typeof meta === "object" ? meta : {});
  const rawTrailActive = metaSafe.trail_active === true;
  const barsRequired = Math.max(0, Math.round(toNum(metaSafe.trail_delay_bars_required) ?? toNum(rules && rules.TRAIL_DELAY_BARS) ?? 0));
  const mfePctRequired = toNum(metaSafe.trail_delay_mfe_pct_required) ?? toNum(rules && rules.TRAIL_DELAY_MFE_PCT);
  const tp1BarMs = toNum(metaSafe.tp_p1_bar_ms) ?? parseIsoMs(metaSafe.tp_p1_at);
  const tfMs = Math.max(0, Math.round(toNum(metaSafe.entry_exec_tf_ms) || 0));
  const tp1Price = toNum(metaSafe.tp_p1_target_price) ?? toNum(metaSafe.tp_p1_price);
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const lev = toNum(leverageEff);
  const currentMs = toNum(currentBarMs);
  const barsReady = rawTrailActive || (
    tpP1Done === true
    && barsRequired > 0
    && Number.isFinite(currentMs)
    && Number.isFinite(tp1BarMs)
    && Number.isFinite(tfMs)
    && tfMs > 0
    && currentMs >= (tp1BarMs + (barsRequired * tfMs))
  );
  // 2026-04-29 — Trail-after-TP1 inhibit fix.
  //
  // Previous formula: mfeMove = mfePctRequired / leverageEff. With the
  // default mfePctRequired=0.005 (i.e. "0.5% leveraged PnL after TP1
  // before trail engages") and leverage=3, mfeMove was 0.00167 (price
  // moves 0.167% past TP1) → the trail flipped active on the same bar
  // TP1 was hit because intra-bar noise alone covers 0.167%. The
  // observed DOGEUSDT 00:46-00:50 chop was exactly this: TP1 reached →
  // mfeReady=true within seconds → trail floor near entry → reduceOnly
  // close on next downtick → force-exit cascade.
  //
  // Fix: treat mfePctRequired as an ABSOLUTE PRICE move from TP1
  // (no leverage division). 0.5% absolute past TP1 is a meaningful
  // move that won't be eaten by tick noise. This matches how the
  // pine v6.1.1.0 trail policy is documented (price-based MFE).
  // Operators can still tighten via ENGINE_TRAIL_DELAY_MFE_PCT for a
  // specific cohort. The leverage-divided shape is preserved as a
  // legacy fallback when the new env flag is set so we don't break
  // any cohort already tuned around the old behaviour.
  const mfeAbsoluteMode = (function() {
    const raw = String(process.env.ENGINE_TRAIL_DELAY_MFE_PCT_LEVERAGE_DIVIDED || "0").trim().toLowerCase();
    return raw !== "1" && raw !== "true" && raw !== "yes" && raw !== "on";
  })();
  const mfeMove = Number.isFinite(mfePctRequired) && mfePctRequired > 0
    ? (mfeAbsoluteMode
        ? mfePctRequired
        : (Number.isFinite(lev) && lev > 0 ? (mfePctRequired / lev) : null))
    : null;
  let mfeReady = rawTrailActive;
  if (!mfeReady && tpP1Done === true && Number.isFinite(mfeMove) && Number.isFinite(tp1Price) && tp1Price > 0 && Number.isFinite(closePx) && closePx > 0) {
    const targetPx = sideUpper === "SHORT"
      ? (tp1Price * (1 - mfeMove))
      : (tp1Price * (1 + mfeMove));
    mfeReady = sideUpper === "SHORT" ? (closePx <= targetPx) : (closePx >= targetPx);
  }
  const delayActive = tpP1Done === true && !rawTrailActive;
  const trailActive = rawTrailActive || (delayActive && (barsReady || mfeReady));
  let releaseReason = null;
  if (rawTrailActive) releaseReason = "TRAIL_ALREADY_ACTIVE";
  else if (barsReady && mfeReady) releaseReason = "BAR_OR_MFE_BOTH";
  else if (barsReady) releaseReason = "BAR_DELAY_RELEASE";
  else if (mfeReady) releaseReason = "MFE_DELAY_RELEASE";
  return {
    rawTrailActive,
    delayActive,
    barsRequired,
    mfePctRequired,
    barsReady,
    mfeReady,
    trailActive,
    releaseReason,
  };
}

const DEFAULT_RULES = (CHARTER_EXPECTATIONS && CHARTER_EXPECTATIONS.signal_engine)
  ? (CHARTER_EXPECTATIONS.signal_engine.default || CHARTER_EXPECTATIONS.signal_engine)
  : {
    SL: -0.04,
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P0_ATR_MULTIPLE: 0.8,
    TP_P1: 0.06,
    TP_P1_RESCUE_COHORT: 0.025,
    TP_P1_MIXED_COHORT: 0.025,
    TP_P1_QTY: 1,
    TP_C: null,
    BE_PCT_RESCUE_COHORT: null,
    BE_PCT_MIXED_COHORT: 0.002,
    TRAIL_R_MULTIPLE_RESCUE_COHORT: null,
    TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
    RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: null,
    RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: null,
    BE_ENABLE: false,
    BE_PCT: null,
    PRE_TP1_TIME_STOP_BARS_EARLY: 4,
    PRE_TP1_TIME_STOP_BARS_CORE: 6,
    PRE_TP1_TIME_STOP_PROGRESS_FRACTION: 0.5,
    TRAIL_DELAY_BARS: 1,
    TRAIL_DELAY_MFE_PCT: 0.005,
    TRAIL_R_MULTIPLE: null,
    TRAIL_PCT: null,
    RUNNER_MIN_PROFIT_PCT: null,
  };

const SIGNAL_ENGINE_RULES = {
  SL: parseNumEnv("ENGINE_SL", DEFAULT_RULES.SL),
  TP_P0: parseNumEnv("ENGINE_TP_P0", DEFAULT_RULES.TP_P0),
  TP_P0_QTY: parseNumEnv("ENGINE_TP_P0_QTY", DEFAULT_RULES.TP_P0_QTY),
  TP_P0_ATR_MULTIPLE: parseNumEnv("ENGINE_TP_P0_ATR_MULTIPLE", DEFAULT_RULES.TP_P0_ATR_MULTIPLE),
  TP_P1: parseNumEnv("ENGINE_TP_P1", DEFAULT_RULES.TP_P1),
  TP_P1_RESCUE_COHORT: parseNumEnv("ENGINE_TP_P1_RESCUE_COHORT", DEFAULT_RULES.TP_P1_RESCUE_COHORT),
  TP_P1_MIXED_COHORT: parseNumEnv("ENGINE_TP_P1_MIXED_COHORT", DEFAULT_RULES.TP_P1_MIXED_COHORT),
  TP_P1_QTY: parseNumEnv("ENGINE_TP_P1_QTY", DEFAULT_RULES.TP_P1_QTY),
  TP_C: parseNumEnv("ENGINE_TP_C", DEFAULT_RULES.TP_C),
  BE_PCT_RESCUE_COHORT: parseNumEnv("ENGINE_BE_PCT_RESCUE_COHORT", DEFAULT_RULES.BE_PCT_RESCUE_COHORT),
  BE_PCT_MIXED_COHORT: parseNumEnv("ENGINE_BE_PCT_MIXED_COHORT", DEFAULT_RULES.BE_PCT_MIXED_COHORT),
  TRAIL_R_MULTIPLE_RESCUE_COHORT: parseNumEnv("ENGINE_TRAIL_R_MULTIPLE_RESCUE_COHORT", DEFAULT_RULES.TRAIL_R_MULTIPLE_RESCUE_COHORT),
  TRAIL_R_MULTIPLE_MIXED_COHORT: parseNumEnv("ENGINE_TRAIL_R_MULTIPLE_MIXED_COHORT", DEFAULT_RULES.TRAIL_R_MULTIPLE_MIXED_COHORT),
  RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: parseNumEnv("ENGINE_RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT", DEFAULT_RULES.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT),
  RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: parseNumEnv("ENGINE_RUNNER_MIN_PROFIT_PCT_MIXED_COHORT", DEFAULT_RULES.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT),
  BE_ENABLE: parseBoolEnv("ENGINE_BE_ENABLE", DEFAULT_RULES.BE_ENABLE),
  BE_PCT: parseNumEnv("ENGINE_BE_PCT", DEFAULT_RULES.BE_PCT),
  PRE_TP1_TIME_STOP_BARS_EARLY: parseNumEnv("ENGINE_PRE_TP1_TIME_STOP_BARS_EARLY", DEFAULT_RULES.PRE_TP1_TIME_STOP_BARS_EARLY),
  PRE_TP1_TIME_STOP_BARS_CORE: parseNumEnv("ENGINE_PRE_TP1_TIME_STOP_BARS_CORE", DEFAULT_RULES.PRE_TP1_TIME_STOP_BARS_CORE),
  PRE_TP1_TIME_STOP_PROGRESS_FRACTION: parseNumEnv("ENGINE_PRE_TP1_TIME_STOP_PROGRESS_FRACTION", DEFAULT_RULES.PRE_TP1_TIME_STOP_PROGRESS_FRACTION),
  TRAIL_DELAY_BARS: parseNumEnv("ENGINE_TRAIL_DELAY_BARS", DEFAULT_RULES.TRAIL_DELAY_BARS),
  TRAIL_DELAY_MFE_PCT: parseNumEnv("ENGINE_TRAIL_DELAY_MFE_PCT", DEFAULT_RULES.TRAIL_DELAY_MFE_PCT),
  TRAIL_R_MULTIPLE: parseNumEnv("ENGINE_TRAIL_R_MULTIPLE", DEFAULT_RULES.TRAIL_R_MULTIPLE),
  TRAIL_PCT: parseNumEnv("ENGINE_TRAIL_PCT", DEFAULT_RULES.TRAIL_PCT),
  RUNNER_MIN_PROFIT_PCT: parseNumEnv("ENGINE_RUNNER_MIN_PROFIT_PCT", DEFAULT_RULES.RUNNER_MIN_PROFIT_PCT),
};

const BINANCE_MIN_TRAIL_GUARANTEE_PCT = 0.0165;

const TP_P1_DEBUG = parseBoolEnv("TP_P1_DEBUG", false);

const EXCHANGE_RULES = {
  BINANCEFUT: {
    SL: -0.0165,
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P0_ATR_MULTIPLE: 0.8,
    TP_P1: 0.025,
    TP_P1_RESCUE_COHORT: 0.025,
    TP_P1_MIXED_COHORT: 0.025,
    TP_P1_QTY: 1,
    TP_C: null,
    BE_PCT_RESCUE_COHORT: null,
    BE_PCT_MIXED_COHORT: 0.002,
    TRAIL_R_MULTIPLE_RESCUE_COHORT: null,
    TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
    RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: null,
    RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: null,
    BE_ENABLE: false,
    BE_PCT: null,
    PRE_TP1_TIME_STOP_BARS_EARLY: 4,
    PRE_TP1_TIME_STOP_BARS_CORE: 6,
    PRE_TP1_TIME_STOP_PROGRESS_FRACTION: 0.5,
    TRAIL_DELAY_BARS: 1,
    TRAIL_DELAY_MFE_PCT: 0.005,
    TRAIL_R_MULTIPLE: null,
    TRAIL_PCT: null,
    RUNNER_MIN_PROFIT_PCT: null,
    ...buildV2SimpleExitRulesPatch(),
  },
};

const BINANCE_FUTURES_AGGRESSIVE_RULES = {
  SL: -0.02,
  TP_P0: 0.008,
  TP_P0_QTY: 0.25,
  TP_P0_ATR_MULTIPLE: 0.8,
  TP_P1: 0.03,
  TP_P1_RESCUE_COHORT: 0.025,
  TP_P1_MIXED_COHORT: 0.025,
  TP_P1_QTY: 1,
  TP_C: null,
  BE_PCT_RESCUE_COHORT: null,
  BE_PCT_MIXED_COHORT: 0.002,
  TRAIL_R_MULTIPLE_RESCUE_COHORT: null,
  TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
  RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: null,
  RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: null,
  BE_ENABLE: false,
  BE_PCT: null,
  PRE_TP1_TIME_STOP_BARS_EARLY: 4,
  PRE_TP1_TIME_STOP_BARS_CORE: 6,
  PRE_TP1_TIME_STOP_PROGRESS_FRACTION: 0.5,
  TRAIL_DELAY_BARS: 1,
  TRAIL_DELAY_MFE_PCT: 0.005,
  TRAIL_R_MULTIPLE: null,
  TRAIL_PCT: null,
  RUNNER_MIN_PROFIT_PCT: null,
  ...buildV2SimpleExitRulesPatch(),
};

function normalizeExchangeKey(exchange) {
  return "BINANCEFUT";
}

function getExitRulesForExchange(exchange) {
  const key = normalizeExchangeKey(exchange);
  const base = { ...SIGNAL_ENGINE_RULES };
  const override = EXCHANGE_RULES[key] || {};
  return { ...base, ...override };
}

function normalizeExitProfileMode(raw, fallback = "BASE") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "BASE" || v === "AGGRESSIVE") return v;
  const fb = String(fallback == null ? "" : fallback).trim().toUpperCase();
  if (fb === "BASE" || fb === "AGGRESSIVE") return fb;
  return "";
}

function getExitRulesForProfile(exchange, profileMode = "BASE") {
  const key = normalizeExchangeKey(exchange);
  if (key === "BINANCEFUT" && normalizeExitProfileMode(profileMode, "BASE") === "AGGRESSIVE") {
    return { ...getExitRulesForExchange(exchange), ...BINANCE_FUTURES_AGGRESSIVE_RULES };
  }
  return getExitRulesForExchange(exchange);
}

function normalizeExitRules(rules, fallbackRules) {
  const fb = (fallbackRules && typeof fallbackRules === "object") ? fallbackRules : SIGNAL_ENGINE_RULES;
  const src = (rules && typeof rules === "object") ? rules : {};
  const toRuleNum = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const pickNum = (key) => {
    const n = toRuleNum(src[key]);
    return n === null ? fb[key] : n;
  };
  const out = {
    SL: pickNum("SL"),
    TP_P0: pickNum("TP_P0"),
    TP_P0_QTY: pickNum("TP_P0_QTY"),
    TP_P0_ATR_MULTIPLE: pickNum("TP_P0_ATR_MULTIPLE"),
    TP_P1: pickNum("TP_P1"),
    TP_P1_RESCUE_COHORT: pickNum("TP_P1_RESCUE_COHORT"),
    TP_P1_MIXED_COHORT: pickNum("TP_P1_MIXED_COHORT"),
    TP_P1_QTY: pickNum("TP_P1_QTY"),
    TP_C: pickNum("TP_C"),
    BE_PCT_RESCUE_COHORT: pickNum("BE_PCT_RESCUE_COHORT"),
    BE_PCT_MIXED_COHORT: pickNum("BE_PCT_MIXED_COHORT"),
    TRAIL_R_MULTIPLE_RESCUE_COHORT: pickNum("TRAIL_R_MULTIPLE_RESCUE_COHORT"),
    TRAIL_R_MULTIPLE_MIXED_COHORT: pickNum("TRAIL_R_MULTIPLE_MIXED_COHORT"),
    BE_PCT: pickNum("BE_PCT"),
    PRE_TP1_TIME_STOP_BARS_EARLY: pickNum("PRE_TP1_TIME_STOP_BARS_EARLY"),
    PRE_TP1_TIME_STOP_BARS_CORE: pickNum("PRE_TP1_TIME_STOP_BARS_CORE"),
    PRE_TP1_TIME_STOP_PROGRESS_FRACTION: pickNum("PRE_TP1_TIME_STOP_PROGRESS_FRACTION"),
    TRAIL_DELAY_BARS: pickNum("TRAIL_DELAY_BARS"),
    TRAIL_DELAY_MFE_PCT: pickNum("TRAIL_DELAY_MFE_PCT"),
    TRAIL_R_MULTIPLE: pickNum("TRAIL_R_MULTIPLE"),
    TRAIL_PCT: pickNum("TRAIL_PCT"),
    RUNNER_MIN_PROFIT_PCT: pickNum("RUNNER_MIN_PROFIT_PCT"),
    RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: pickNum("RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT"),
    RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: pickNum("RUNNER_MIN_PROFIT_PCT_MIXED_COHORT"),
    BE_ENABLE: src.BE_ENABLE == null ? (fb.BE_ENABLE !== false) : !!src.BE_ENABLE,
  };
  if (!Number.isFinite(out.SL)) out.SL = fb.SL;
  if (!Number.isFinite(out.TP_P0) || out.TP_P0 <= 0) out.TP_P0 = fb.TP_P0;
  if (!Number.isFinite(out.TP_P0_QTY) || out.TP_P0_QTY <= 0) out.TP_P0_QTY = fb.TP_P0_QTY;
  if (!Number.isFinite(out.TP_P0_ATR_MULTIPLE) || out.TP_P0_ATR_MULTIPLE <= 0) out.TP_P0_ATR_MULTIPLE = fb.TP_P0_ATR_MULTIPLE;
  if (!Number.isFinite(out.TP_P1)) out.TP_P1 = fb.TP_P1;
  if (!Number.isFinite(out.TP_P1_RESCUE_COHORT) || out.TP_P1_RESCUE_COHORT <= 0) out.TP_P1_RESCUE_COHORT = fb.TP_P1_RESCUE_COHORT;
  if (!Number.isFinite(out.TP_P1_MIXED_COHORT) || out.TP_P1_MIXED_COHORT <= 0) out.TP_P1_MIXED_COHORT = fb.TP_P1_MIXED_COHORT;
  if (!Number.isFinite(out.TP_P1_QTY)) out.TP_P1_QTY = fb.TP_P1_QTY;
  if (!Number.isFinite(out.BE_PCT_RESCUE_COHORT) || out.BE_PCT_RESCUE_COHORT <= 0) out.BE_PCT_RESCUE_COHORT = fb.BE_PCT_RESCUE_COHORT;
  if (!Number.isFinite(out.BE_PCT_MIXED_COHORT) || out.BE_PCT_MIXED_COHORT <= 0) out.BE_PCT_MIXED_COHORT = fb.BE_PCT_MIXED_COHORT;
  if (!Number.isFinite(out.TRAIL_R_MULTIPLE_RESCUE_COHORT) || out.TRAIL_R_MULTIPLE_RESCUE_COHORT <= 0) out.TRAIL_R_MULTIPLE_RESCUE_COHORT = fb.TRAIL_R_MULTIPLE_RESCUE_COHORT;
  if (!Number.isFinite(out.TRAIL_R_MULTIPLE_MIXED_COHORT) || out.TRAIL_R_MULTIPLE_MIXED_COHORT <= 0) out.TRAIL_R_MULTIPLE_MIXED_COHORT = fb.TRAIL_R_MULTIPLE_MIXED_COHORT;
  if (!Number.isFinite(out.PRE_TP1_TIME_STOP_BARS_EARLY) || out.PRE_TP1_TIME_STOP_BARS_EARLY < 0) out.PRE_TP1_TIME_STOP_BARS_EARLY = fb.PRE_TP1_TIME_STOP_BARS_EARLY;
  if (!Number.isFinite(out.PRE_TP1_TIME_STOP_BARS_CORE) || out.PRE_TP1_TIME_STOP_BARS_CORE < 0) out.PRE_TP1_TIME_STOP_BARS_CORE = fb.PRE_TP1_TIME_STOP_BARS_CORE;
  if (!Number.isFinite(out.PRE_TP1_TIME_STOP_PROGRESS_FRACTION) || out.PRE_TP1_TIME_STOP_PROGRESS_FRACTION <= 0) out.PRE_TP1_TIME_STOP_PROGRESS_FRACTION = fb.PRE_TP1_TIME_STOP_PROGRESS_FRACTION;
  if (!Number.isFinite(out.TRAIL_DELAY_BARS) || out.TRAIL_DELAY_BARS < 0) out.TRAIL_DELAY_BARS = fb.TRAIL_DELAY_BARS;
  if (!Number.isFinite(out.TRAIL_DELAY_MFE_PCT) || out.TRAIL_DELAY_MFE_PCT < 0) out.TRAIL_DELAY_MFE_PCT = fb.TRAIL_DELAY_MFE_PCT;
  if (!Number.isFinite(out.TRAIL_R_MULTIPLE) || out.TRAIL_R_MULTIPLE <= 0) out.TRAIL_R_MULTIPLE = null;
  if (!Number.isFinite(out.TRAIL_PCT)) out.TRAIL_PCT = fb.TRAIL_PCT;
  if (!Number.isFinite(out.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT) || out.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT <= 0) out.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT = fb.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT;
  if (!Number.isFinite(out.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT) || out.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT <= 0) out.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT = fb.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT;
  if (!Number.isFinite(out.RUNNER_MIN_PROFIT_PCT) || out.RUNNER_MIN_PROFIT_PCT <= 0) out.RUNNER_MIN_PROFIT_PCT = null;
  if (!Number.isFinite(out.TP_C)) out.TP_C = null;
  if (out.BE_ENABLE !== false && !Number.isFinite(out.BE_PCT)) out.BE_PCT = null;
  return out;
}

function enforceMinimumRunnerProfitFloor({ rules = null, exchange = "" } = {}) {
  const ex = normalizeExchangeKey(exchange);
  if (ex !== "BINANCEFUT" || !rules || typeof rules !== "object") return rules;
  if (isFullTpExitRatio(rules.TP_P1_QTY)) {
    return {
      ...rules,
      BE_ENABLE: false,
      BE_PCT: null,
      TRAIL_R_MULTIPLE: null,
      TRAIL_PCT: null,
      RUNNER_MIN_PROFIT_PCT: null,
      RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: null,
      RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: null,
    };
  }
  const clampFloor = (value) => {
    const num = toNum(value);
    return Number.isFinite(num) && num >= BINANCE_MIN_TRAIL_GUARANTEE_PCT
      ? num
      : BINANCE_MIN_TRAIL_GUARANTEE_PCT;
  };
  const current = toNum(rules.RUNNER_MIN_PROFIT_PCT);
  const rescue = toNum(rules.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT);
  const mixed = toNum(rules.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT);
  if (
    Number.isFinite(current) && current >= BINANCE_MIN_TRAIL_GUARANTEE_PCT
    && Number.isFinite(rescue) && rescue >= BINANCE_MIN_TRAIL_GUARANTEE_PCT
    && Number.isFinite(mixed) && mixed >= BINANCE_MIN_TRAIL_GUARANTEE_PCT
  ) {
    return rules;
  }
  return {
    ...rules,
    RUNNER_MIN_PROFIT_PCT: clampFloor(rules.RUNNER_MIN_PROFIT_PCT),
    RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: clampFloor(rules.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT),
    RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: clampFloor(rules.RUNNER_MIN_PROFIT_PCT_MIXED_COHORT),
  };
}

function resolveExitRulesForPosition({ exchange, position, exitProfileMode } = {}) {
  const forcedProfileMode = normalizeExitProfileMode(exitProfileMode, "");
  if (forcedProfileMode) {
    const forcedBase = getExitRulesForProfile(exchange, forcedProfileMode);
    const forcedResolved = enforceMinimumRunnerProfitFloor({
      rules: normalizeExitRules(null, forcedBase),
      exchange,
    });
    forcedResolved.exit_profile = forcedProfileMode;
    return stripTp0RulesForSimplifiedExitV2(forcedResolved, {
      execution_mode: "LIVE",
      executionMode: "LIVE",
    });
  }
  const profileMode = normalizeExitProfileMode(exitProfileMode, "BASE");
  const base = getExitRulesForProfile(exchange, profileMode);
  const pos = position || {};
  const meta = resolveTrailSnapshotMeta((pos.meta && typeof pos.meta === "object") ? pos.meta : {});
  const override = (meta.exit_rules_override && typeof meta.exit_rules_override === "object")
    ? meta.exit_rules_override
    : null;
  const metaProfile = normalizeExitProfileMode(meta.exit_profile, "");
  const fallbackBase = override
    ? base
    : (metaProfile === "AGGRESSIVE" ? getExitRulesForProfile(exchange, "AGGRESSIVE") : base);
  const resolved = normalizeExitRules(override, fallbackBase);
  const adjusted = enforceMinimumRunnerProfitFloor({
    rules: applyCohortTp1Adjustment({ rules: resolved, meta, exchange }),
    exchange,
  });
  if (metaProfile) {
    adjusted.exit_profile = metaProfile;
  } else {
    adjusted.exit_profile = profileMode;
  }
  return stripTp0RulesForSimplifiedExitV2(adjusted, {
    ...pos,
    execution_mode: pos.execution_mode,
    executionMode: pos.executionMode,
    meta,
  });
}

function tpP1ForExchange(exchange) {
  return getExitRulesForExchange(exchange).TP_P1;
}

function computeTrailingStopPrice({ side, trailHigh, trailLow, trailPct } = {}) {
  const pctNum = toNum(trailPct);
  if (pctNum === null || pctNum <= 0) return null;
  const sideUpper = String(side || "").toUpperCase();
  if (sideUpper === "SHORT") {
    const low = toNum(trailLow);
    return low === null ? null : (low * (1 + pctNum));
  }
  const high = toNum(trailHigh);
  return high === null ? null : (high * (1 - pctNum));
}

function computeTrailingStopPriceFromR({ side, trailHigh, trailLow, entryRDistance, trailRMultiple } = {}) {
  const r = toNum(entryRDistance);
  const multiple = toNum(trailRMultiple);
  if (r === null || r <= 0 || multiple === null || multiple <= 0) return null;
  const sideUpper = String(side || "").toUpperCase();
  if (sideUpper === "SHORT") {
    const low = toNum(trailLow);
    return low === null ? null : (low + (r * multiple));
  }
  const high = toNum(trailHigh);
  return high === null ? null : (high - (r * multiple));
}

function resolveEntryRDistance({ avg, leverageEff, side, meta, rules } = {}) {
  const metaSafe = meta && typeof meta === "object" ? meta : {};
  const storedR = toNum(metaSafe.entry_r_distance);
  if (storedR !== null && storedR > 0) return storedR;
  const initialStop = toNum(metaSafe.initial_stop_price);
  const avgNum = toNum(avg);
  if (initialStop !== null && avgNum !== null && avgNum > 0) {
    const dist = Math.abs(initialStop - avgNum);
    if (dist > 0) return dist;
  }
  const sl = toNum(rules && rules.SL);
  const lev = toNum(leverageEff);
  if (avgNum === null || avgNum <= 0 || sl === null || lev === null || lev <= 0) return null;
  const fallbackStop = pnlToPrice({ avg: avgNum, pnlPct: sl / lev, side });
  if (!Number.isFinite(fallbackStop)) return null;
  const dist = Math.abs(fallbackStop - avgNum);
  return dist > 0 ? dist : null;
}

function computeRunnerMinProfitStopPrice({ avg, leverageEff, side, runnerMinProfitPct, tpP1Done, trailActive } = {}) {
  // Historical behavior required BOTH tpP1Done AND trailActive, which meant
  // the runner had no floor during the ~1-bar window between TP1 fill and
  // trailing arming (TRAIL_DELAY_BARS / TRAIL_DELAY_MFE_PCT). The data
  // audit on 2026-04-18 showed TP1 hits capped at +0.70% average despite
  // the 1.65% target — the leftover 75% runner kept getting swept to SL
  // in that gap. Relaxed to fire the floor the moment TP1 is filled so
  // the worst case becomes "scratch at BE" instead of "SL at -1.65%".
  // trailActive remains relevant downstream (trail stop is picked in
  // computeRunnerExitStopPrice with max/min against this floor).
  if (tpP1Done !== true) return null;
  void trailActive;
  const floorPct = toNum(runnerMinProfitPct);
  const lev = toNum(leverageEff);
  if (floorPct === null || floorPct <= 0 || lev === null || lev <= 0) return null;
  return pnlToPrice({ avg, pnlPct: floorPct / lev, side });
}

function computeRunnerExitStopPrice({
  avg,
  leverageEff,
  side,
  rules,
  tpP1Done,
  trailActive,
  trailHigh,
  trailLow,
  entryRDistance,
} = {}) {
  const sideUpper = String(side || "").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const trailStopByR = computeTrailingStopPriceFromR({
    side: sideUpper,
    trailHigh,
    trailLow,
    entryRDistance,
    trailRMultiple: rules && rules.TRAIL_R_MULTIPLE,
  });
  const trailStopByPct = computeTrailingStopPrice({
    side: sideUpper,
    trailHigh,
    trailLow,
    trailPct: rules && rules.TRAIL_PCT,
  });
  const trailStop = Number.isFinite(trailStopByR) ? trailStopByR : trailStopByPct;
  const runnerFloorStop = computeRunnerMinProfitStopPrice({
    avg,
    leverageEff,
    side: sideUpper,
    runnerMinProfitPct: rules && rules.RUNNER_MIN_PROFIT_PCT,
    tpP1Done,
    trailActive,
  });

  let stopPrice = null;
  let stopSource = null;
  if (Number.isFinite(trailStop)) {
    stopPrice = trailStop;
    stopSource = "TRAIL";
  }
  if (Number.isFinite(runnerFloorStop)) {
    if (!Number.isFinite(stopPrice)) {
      stopPrice = runnerFloorStop;
      stopSource = "RUNNER_FLOOR";
    } else if (sideUpper === "SHORT") {
      if (runnerFloorStop < stopPrice) {
        stopPrice = runnerFloorStop;
        stopSource = "RUNNER_FLOOR";
      }
    } else if (runnerFloorStop > stopPrice) {
      stopPrice = runnerFloorStop;
      stopSource = "RUNNER_FLOOR";
    }
  }

  return {
    stopPrice: Number.isFinite(stopPrice) ? stopPrice : null,
    stopSource,
    trailStop: Number.isFinite(trailStop) ? trailStop : null,
    trailStopByR: Number.isFinite(trailStopByR) ? trailStopByR : null,
    trailStopByPct: Number.isFinite(trailStopByPct) ? trailStopByPct : null,
    runnerFloorStop: Number.isFinite(runnerFloorStop) ? runnerFloorStop : null,
  };
}

/**
 * generateSignals input (paperBinanceRunner에서 호출)
 * {
 *   exchange, symbol, tf,
 *   bar, gate,
 *   position, trading_mode, leverage
 * }
 *
 * return: [{ event, side, qty_pct, reason, features }]
 */
function generateSignals({ exchange, symbol, bar, position, trading_mode, leverage, exitProfileMode, currentBarCloseMs } = {}) {
  // EXIT_ONLY에서는 BUY 신호를 만들지 않는다.
  // (여기선 어차피 SELL만 생성)
  const mode = String(trading_mode || "RUNNING").toUpperCase();
  if (mode === "PAUSED") return [];

  const ex = String(exchange || "").toUpperCase();
  const pos = position || {};
  const state = String(pos.state || "").toUpperCase();
  const size = toNum(pos.size_pct);
  const sym = String(
    pos.symbol_or_pair_id ||
    pos.symbol ||
    symbol ||
    ""
  );
  const meta = resolveTrailSnapshotMeta((pos.meta && typeof pos.meta === "object") ? pos.meta : {});
  const entryExecMs = toNum(meta.entry_exec_bar_ms);
  const currentBarMs = toNum(currentBarCloseMs);
  if (Number.isFinite(entryExecMs) && Number.isFinite(currentBarMs) && currentBarMs <= entryExecMs) {
    return [];
  }
  const positionSide = resolvePositionSideFromPosition(pos, meta, "LONG");
  const tpP1State = resolveTpP1State(meta);
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled(pos);
  const tpP0State = resolveTpP0State(meta);
  const tpP1Done = tpP1State.tpP1Done;
  const tpP0Done = tpP0State.tpP0Done || tpP1Done;
  const trailHigh = toNum(meta.trail_high);
  const trailLow = toNum(meta.trail_low);

  // 포지션 없으면 내부 신호 없음
  if (state !== "ACTIVE" || !size || size <= 0) return [];

  const avg = toNum(pos.avg_price);
  const closePx = toNum(bar && (bar.close ?? bar.closePrice ?? bar.c));
  if (avg === null || closePx === null) return [];

  const pnlPct = (positionSide === "SHORT") ? pct(avg, closePx) : pct(closePx, avg);
  if (pnlPct === null) return [];
  const levRaw = toNum(meta.external_leverage ?? meta.leverage ?? meta.futures_leverage ?? pos.leverage ?? leverage);
  const leverageEff = (ex.includes("BINANCE") && Number.isFinite(levRaw) && levRaw > 0) ? levRaw : 1;
  const pnlPctEffective = pnlPct * leverageEff;

  // 손절/익절 규칙
  const rules = resolveExitRulesForPosition({ exchange: ex, position: pos, exitProfileMode });
  const SL = rules.SL;
  const TP_P1 = rules.TP_P1;
  const TP_C = rules.TP_C;
  const BE_ENABLE = rules.BE_ENABLE !== false;
  let BE_PCT = rules.BE_PCT;
  const TP_P1_QTY = rules.TP_P1_QTY;
  const TRAIL_R_MULTIPLE = rules.TRAIL_R_MULTIPLE;
  const TRAIL_PCT = rules.TRAIL_PCT;
  const RUNNER_MIN_PROFIT_PCT = rules.RUNNER_MIN_PROFIT_PCT;
  const entryRDistance = resolveEntryRDistance({
    avg,
    leverageEff,
    side: positionSide,
    meta,
    rules,
  });
  const trailDelay = resolveTrailDelayState({
    meta,
    tpP1Done,
    currentBarMs,
    closePx,
    side: positionSide,
    leverageEff,
    rules,
  });
  const trailActive = trailDelay.trailActive;
  const exitSide = positionSide === "SHORT" ? "BUY" : "SELL";
  if (!BE_ENABLE) BE_PCT = null;

  // 2026-04-28 Stage X — XRPUSDT 잔량 dust 가 매 15분 bar 마다 EXIT_TP_P1
  // signal 을 trigger 해 telegram alert 폭탄을 일으킨 사례 (TP1 후 trail/
  // runner 단계로 들어갔는데 잔량이 minNotional 미만 dust 라 trail close
  // 도달 전엔 stale active 로 남음). 두 갈래 처리:
  //   1) trail_active=true 이고 잔량이 dust 면 → 즉시 EXIT_TRAIL force-close
  //      signal 1건 emit (closePosition 의도 명시). trail stop 도달 기다리지
  //      않고 강제 cleanup.
  //   2) trail_active=false (PRE_TP1 단계) 이고 dust 면 → silent skip. 이
  //      단계의 dust 는 entry sizing 결함이라 alert 폭탄 만들 가치 없음.
  // env: SIGNAL_DUST_SKIP_ENABLED (default ON), SIGNAL_DUST_NOTIONAL_
  // THRESHOLD_USDT (default 20).
  if (parseBoolEnv("SIGNAL_DUST_SKIP_ENABLED", true)) {
    const qtyBase = toNum(pos.qty_base);
    const dustThreshold = parseNumEnv("SIGNAL_DUST_NOTIONAL_THRESHOLD_USDT", 20);
    if (Number.isFinite(qtyBase) && qtyBase > 0 && Number.isFinite(dustThreshold) && dustThreshold > 0) {
      const notional = Math.abs(qtyBase * closePx);
      if (notional < dustThreshold) {
        if (trailActive === true) {
          return [{
            event: Number.isFinite(rules.TRAIL_R_MULTIPLE) && rules.TRAIL_R_MULTIPLE > 0
              ? "EXIT_TRAIL"
              : "EXIT_TRAIL",
            side: exitSide,
            qty_pct: 1,
            reason: "EXIT_TRAIL_DUST_FORCE_CLOSE",
            features: {
              dust_notional: notional,
              dust_threshold: dustThreshold,
              qty_base: qtyBase,
              ref_px: closePx,
              avg_px: avg,
              position_side: positionSide,
              force_full_close: true,
              trail_active: true,
            },
          }];
        }
        return [];
      }
    }
  }
  if (BE_ENABLE && !Number.isFinite(BE_PCT) && ex.includes("BINANCE") && Number.isFinite(leverageEff) && leverageEff > 0) {
    const feeBps = Number(process.env.FEE_BPS || 4);
    const slippageBps = Number(process.env.SLIPPAGE_BPS || 5);
    const roundTripBps = (Number.isFinite(feeBps) ? feeBps : 0) + (Number.isFinite(slippageBps) ? slippageBps : 0);
    BE_PCT = -((roundTripBps * 2) / 10000) * leverageEff;
  }
  const slPctLabel = pctLabel(SL);
  const tpP1Label = pctLabel(TP_P1);
  const tpCLabel = pctLabel(TP_C);
  const trailLabel = pctLabel(TRAIL_PCT);
  const beLabel = pctLabel(BE_PCT);
  const slEvent = slPctLabel ? `EXIT_SL_${slPctLabel}P` : "EXIT_SL";
  const tpP1Event = isFullTpExitRatio(TP_P1_QTY)
    ? (tpP1Label ? `EXIT_TP_FULL_${tpP1Label}P` : "EXIT_TP_FULL")
    : (tpP1Label ? `EXIT_TP_P1_${tpP1Label}P` : "EXIT_TP_P1");
  const tpCEvent = tpCLabel ? `EXIT_TP_C_${tpCLabel}P` : "EXIT_TP_C";
  const trailEvent = Number.isFinite(TRAIL_R_MULTIPLE) && TRAIL_R_MULTIPLE > 0
    ? "EXIT_TRAIL"
    : (trailLabel ? `EXIT_TRAIL_${trailLabel}P` : "EXIT_TRAIL");
  const beEvent = beLabel ? `EXIT_BE_${beLabel}P` : "EXIT_BE";
  const exitProfile = String(rules.exit_profile || "BASE").toUpperCase() === "AGGRESSIVE" ? "AGGRESSIVE" : "BASE";

  // 손절: 전량 청산
  if (pnlPctEffective <= SL) {
    return [{
      event: slEvent,
      side: exitSide,
      qty_pct: size,
      reason: "EXIT_STOP_LOSS",
      features: {
        pnl_pct: pnlPctEffective,
        pnl_pct_raw: pnlPct,
        leverage: leverageEff,
        ref_px: closePx,
        avg_px: avg,
        position_side: positionSide,
        exit_profile: exitProfile,
        trigger_px: closePx,
        trigger_pnl_pct: pnlPctEffective,
        trigger_pnl_pct_raw: pnlPct,
        trigger_sl_pct: SL,
      }
    }];
  }

  // Zone C: 전량 익절 (옵션, 기본 비활성)
  if (Number.isFinite(TP_C) && pnlPctEffective >= TP_C) {
    return [{
      event: tpCEvent,
      side: exitSide,
      qty_pct: size,
      reason: "EXIT_TAKE_PROFIT_C",
      features: { pnl_pct: pnlPctEffective, pnl_pct_raw: pnlPct, leverage: leverageEff, ref_px: closePx, avg_px: avg, position_side: positionSide, exit_profile: exitProfile, tp_c_pct: TP_C }
    }];
  }

  const takeProfitSignals = [];
  // Zone B: 기준 수익 도달 시 부분 익절
  if (!tpP1Done && Number.isFinite(TP_P1) && pnlPctEffective >= TP_P1) {
    const qty = resolveContractExitQtyPct(size, TP_P1_QTY);
    if (TP_P1_DEBUG) {
      const pnlTxt = Number.isFinite(pnlPctEffective) ? pnlPctEffective.toFixed(6) : "na";
      const pnlRawTxt = Number.isFinite(pnlPct) ? pnlPct.toFixed(6) : "na";
      console.log(`[TP_P1] exchange=${ex} symbol=${sym || "UNKNOWN"} size=${size} tp_p1_qty=${TP_P1_QTY} qty=${qty} pnl=${pnlTxt} pnl_raw=${pnlRawTxt} leverage=${leverageEff}`);
    }
    takeProfitSignals.push({
      event: tpP1Event,
      side: exitSide,
      qty_pct: qty,
      reason: isFullTpExitRatio(TP_P1_QTY) ? "EXIT_TAKE_PROFIT_FULL" : "EXIT_TAKE_PROFIT_P1",
      features: {
        pnl_pct: pnlPctEffective,
        pnl_pct_raw: pnlPct,
        leverage: leverageEff,
        ref_px: closePx,
        avg_px: avg,
        position_side: positionSide,
        exit_profile: exitProfile,
        tp_p1_pct: TP_P1,
      }
    });
  }
  if (takeProfitSignals.length) {
    return takeProfitSignals;
  }

  // Zone B 이후: 트레일링 스탑
  if (tpP1Done && trailActive && (Number.isFinite(TRAIL_R_MULTIPLE) || Number.isFinite(TRAIL_PCT))) {
    const runnerExit = computeRunnerExitStopPrice({
      avg,
      leverageEff,
      side: positionSide,
      rules,
      tpP1Done,
      trailActive,
      trailHigh,
      trailLow,
      entryRDistance,
    });
    const triggerPx = runnerExit.stopPrice;
    const crossed = positionSide === "SHORT"
      ? (Number.isFinite(triggerPx) && closePx >= triggerPx)
      : (Number.isFinite(triggerPx) && closePx <= triggerPx);
    if (crossed) {
      const trailRef = positionSide === "SHORT" ? trailLow : trailHigh;
      return [{
        event: trailEvent,
        side: exitSide,
        qty_pct: size,
        reason: runnerExit.stopSource === "RUNNER_FLOOR" ? "EXIT_TRAIL_STOP_RUNNER_FLOOR" : "EXIT_TRAIL_STOP",
        features: {
          pnl_pct: pnlPctEffective,
          pnl_pct_raw: pnlPct,
          leverage: leverageEff,
          ref_px: closePx,
          avg_px: avg,
          position_side: positionSide,
          exit_profile: exitProfile,
          trail_r_multiple: Number.isFinite(TRAIL_R_MULTIPLE) ? TRAIL_R_MULTIPLE : null,
          trail_pct: TRAIL_PCT,
          entry_r_distance: entryRDistance,
          trail_ref: trailRef,
          trail_stop_px: runnerExit.trailStop,
          trail_stop_r_px: runnerExit.trailStopByR,
          trail_stop_pct_px: runnerExit.trailStopByPct,
          runner_floor_pct: Number.isFinite(RUNNER_MIN_PROFIT_PCT) ? RUNNER_MIN_PROFIT_PCT : null,
          runner_floor_px: runnerExit.runnerFloorStop,
          runner_stop_px: runnerExit.stopPrice,
          runner_stop_source: runnerExit.stopSource,
          trail_delay_bars_ready: trailDelay.barsReady,
          trail_delay_mfe_ready: trailDelay.mfeReady,
          trail_delay_bars_required: trailDelay.barsRequired,
          trail_delay_mfe_pct_required: trailDelay.mfePctRequired,
          trail_delay_release_reason: trailDelay.releaseReason,
        }
      }];
    }
  }

  // Zone B 이후: 재손절 = 진입가(0%)
  if (tpP1Done && Number.isFinite(BE_PCT) && pnlPctEffective <= BE_PCT) {
    return [{
      event: beEvent,
      side: exitSide,
      qty_pct: size,
      reason: "EXIT_BREAK_EVEN_0P",
      features: { pnl_pct: pnlPctEffective, pnl_pct_raw: pnlPct, leverage: leverageEff, ref_px: closePx, avg_px: avg, position_side: positionSide, exit_profile: exitProfile }
    }];
  }

  // 그 외는 내부 청산 신호 없음
  return [];
}

module.exports = {
  generateSignals,
  SIGNAL_ENGINE_RULES,
  tpP1ForExchange,
  getExitRulesForExchange,
  resolveExitRulesForPosition,
  normalizeExchangeKey,
  evaluateTp1LadderStage,
  applyTp1LadderPolicy,
  computeRunnerExitStopPrice,
  computeTrailingStopPrice,
  resolveEntryRDistance,
  resolveTrailDelayState,
  resolveTpP0Pct,
  resolveTrailSnapshotMeta,
  resolveContractExitQtyPct,
};
