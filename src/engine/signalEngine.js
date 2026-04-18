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

function resolveTpP1State(meta = {}) {
  const rawTpP1Done = meta.tp_p1_done === true;
  const rawTrailActive = meta.trail_active === true;
  if (!rawTpP1Done) {
    return { tpP1Done: false, trailActive: false, linkedToEntry: false };
  }

  const entryEventId = String(meta.entry_event_id || "").trim();
  const tpP1EntryEventId = String(meta.tp_p1_entry_event_id || "").trim();
  const entryExecMs = toNum(meta.entry_exec_bar_ms);
  const tpP1EntryExecMs = toNum(meta.tp_p1_entry_exec_bar_ms);
  const tpP1AtMs = parseIsoMs(meta.tp_p1_at);

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

const DEFAULT_RULES = (CHARTER_EXPECTATIONS && CHARTER_EXPECTATIONS.signal_engine)
  ? (CHARTER_EXPECTATIONS.signal_engine.default || CHARTER_EXPECTATIONS.signal_engine)
  : {
    SL: -0.04,
    TP_P1: 0.06,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: null,
    TRAIL_R_MULTIPLE: 1.0,
    TRAIL_PCT: 0.025,
    RUNNER_MIN_PROFIT_PCT: null,
  };

const SIGNAL_ENGINE_RULES = {
  SL: parseNumEnv("ENGINE_SL", DEFAULT_RULES.SL),
  TP_P1: parseNumEnv("ENGINE_TP_P1", DEFAULT_RULES.TP_P1),
  TP_P1_QTY: parseNumEnv("ENGINE_TP_P1_QTY", DEFAULT_RULES.TP_P1_QTY),
  TP_C: parseNumEnv("ENGINE_TP_C", DEFAULT_RULES.TP_C),
  BE_ENABLE: parseBoolEnv("ENGINE_BE_ENABLE", DEFAULT_RULES.BE_ENABLE),
  BE_PCT: parseNumEnv("ENGINE_BE_PCT", DEFAULT_RULES.BE_PCT),
  TRAIL_R_MULTIPLE: parseNumEnv("ENGINE_TRAIL_R_MULTIPLE", DEFAULT_RULES.TRAIL_R_MULTIPLE),
  TRAIL_PCT: parseNumEnv("ENGINE_TRAIL_PCT", DEFAULT_RULES.TRAIL_PCT),
  RUNNER_MIN_PROFIT_PCT: parseNumEnv("ENGINE_RUNNER_MIN_PROFIT_PCT", DEFAULT_RULES.RUNNER_MIN_PROFIT_PCT),
};

const TP_P1_DEBUG = parseBoolEnv("TP_P1_DEBUG", false);

const EXCHANGE_RULES = {
  UPBIT: {
    SL: -0.015,
    TP_P1: 0.03,
    TP_P1_QTY: 0.3,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: null,
    TRAIL_R_MULTIPLE: 1.0,
    TRAIL_PCT: 0.015,
  },
  BINANCEFUT: {
    SL: -0.0165,
    TP_P1: 0.0325,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    // Keep small realized edge after TP1; prevents many short winners from reverting to losses.
    BE_PCT: 0.0025,
    TRAIL_R_MULTIPLE: 0.9,
    // Legacy fallback for positions without entry R metadata.
    TRAIL_PCT: 0.01,
    RUNNER_MIN_PROFIT_PCT: 0.02,
  },
  KIWOOM: {
    SL: -0.03,
    TP_P1: 0.05,
    TP_P1_QTY: 0.5,
    TP_C: null,
    BE_ENABLE: true,
    BE_PCT: null,
    TRAIL_R_MULTIPLE: 1.0,
    TRAIL_PCT: 0.03,
  },
};

const BINANCE_FUTURES_AGGRESSIVE_RULES = {
  SL: -0.02,
  TP_P1: 0.03,
  TP_P1_QTY: 0.5,
  TP_C: null,
  BE_ENABLE: true,
  BE_PCT: 0.0025,
  TRAIL_R_MULTIPLE: 1.0,
  TRAIL_PCT: 0.015,
  RUNNER_MIN_PROFIT_PCT: 0.02,
};

function normalizeExchangeKey(exchange) {
  const ex = String(exchange || "").toUpperCase();
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  if (ex.includes("KIWOOM")) return "KIWOOM";
  if (ex.includes("UPBIT")) return "UPBIT";
  return ex || "BINANCEFUT";
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
    TP_P1: pickNum("TP_P1"),
    TP_P1_QTY: pickNum("TP_P1_QTY"),
    TP_C: pickNum("TP_C"),
    BE_PCT: pickNum("BE_PCT"),
    TRAIL_R_MULTIPLE: pickNum("TRAIL_R_MULTIPLE"),
    TRAIL_PCT: pickNum("TRAIL_PCT"),
    RUNNER_MIN_PROFIT_PCT: pickNum("RUNNER_MIN_PROFIT_PCT"),
    BE_ENABLE: src.BE_ENABLE == null ? (fb.BE_ENABLE !== false) : !!src.BE_ENABLE,
  };
  if (!Number.isFinite(out.SL)) out.SL = fb.SL;
  if (!Number.isFinite(out.TP_P1)) out.TP_P1 = fb.TP_P1;
  if (!Number.isFinite(out.TP_P1_QTY)) out.TP_P1_QTY = fb.TP_P1_QTY;
  if (!Number.isFinite(out.TRAIL_R_MULTIPLE) || out.TRAIL_R_MULTIPLE <= 0) out.TRAIL_R_MULTIPLE = null;
  if (!Number.isFinite(out.TRAIL_PCT)) out.TRAIL_PCT = fb.TRAIL_PCT;
  if (!Number.isFinite(out.RUNNER_MIN_PROFIT_PCT) || out.RUNNER_MIN_PROFIT_PCT <= 0) out.RUNNER_MIN_PROFIT_PCT = null;
  if (!Number.isFinite(out.TP_C)) out.TP_C = null;
  if (out.BE_ENABLE !== false && !Number.isFinite(out.BE_PCT)) out.BE_PCT = null;
  return out;
}

function resolveExitRulesForPosition({ exchange, position, exitProfileMode } = {}) {
  const forcedProfileMode = normalizeExitProfileMode(exitProfileMode, "");
  if (forcedProfileMode) {
    const forcedBase = getExitRulesForProfile(exchange, forcedProfileMode);
    const forcedResolved = normalizeExitRules(null, forcedBase);
    forcedResolved.exit_profile = forcedProfileMode;
    return forcedResolved;
  }
  const profileMode = normalizeExitProfileMode(exitProfileMode, "BASE");
  const base = getExitRulesForProfile(exchange, profileMode);
  const pos = position || {};
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const override = (meta.exit_rules_override && typeof meta.exit_rules_override === "object")
    ? meta.exit_rules_override
    : null;
  const metaProfile = normalizeExitProfileMode(meta.exit_profile, "");
  const fallbackBase = override
    ? base
    : (metaProfile === "AGGRESSIVE" ? getExitRulesForProfile(exchange, "AGGRESSIVE") : base);
  const resolved = normalizeExitRules(override, fallbackBase);
  if (metaProfile) {
    resolved.exit_profile = metaProfile;
  } else {
    resolved.exit_profile = profileMode;
  }
  return resolved;
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
  // Historical behavior required BOTH tpP1Done AND trailActive. That left
  // a dangerous window between TP1 fill and trail arming (TRAIL_DELAY_BARS
  // + TRAIL_DELAY_MFE_PCT must elapse before trail engages) during which
  // the runner's leftover 75% had no floor and could be dragged back to
  // the original SL. Data audit on codex/google-grade-ml-cutover-20260411
  // (2026-04-18) showed TP1 @ 1.65% hits averaging only +0.70% realized
  // versus the 1.65% target because of this exact gap. Relaxed to fire
  // the floor the moment TP1 is done — trail stays respected downstream
  // because computeRunnerExitStopPrice still picks max/min between the
  // trail stop and this floor.
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
 * generateSignals input (paperUpbitRunner에서 호출)
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
  const meta = (pos.meta && typeof pos.meta === "object") ? pos.meta : {};
  const entryExecMs = toNum(meta.entry_exec_bar_ms);
  const currentBarMs = toNum(currentBarCloseMs);
  if (Number.isFinite(entryExecMs) && Number.isFinite(currentBarMs) && currentBarMs <= entryExecMs) {
    return [];
  }
  const positionSide = resolvePositionSideFromPosition(pos, meta, "LONG");
  const tpP1State = resolveTpP1State(meta);
  const tpP1Done = tpP1State.tpP1Done;
  const trailHigh = toNum(meta.trail_high);
  const trailLow = toNum(meta.trail_low);
  const trailActive = tpP1State.trailActive;

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
  const exitSide = positionSide === "SHORT" ? "BUY" : "SELL";
  if (!BE_ENABLE) BE_PCT = null;
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
  const tpP1Event = tpP1Label ? `EXIT_TP_P1_${tpP1Label}P` : "EXIT_TP_P1";
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

  // Zone B: 기준 수익 도달 시 부분 익절
  if (!tpP1Done && pnlPctEffective >= TP_P1) {
    const rawQty = Number.isFinite(TP_P1_QTY) ? (size * TP_P1_QTY) : size;
    const qty = Math.min(size, Math.max(0, Number(rawQty) || 0));
    if (TP_P1_DEBUG) {
      const pnlTxt = Number.isFinite(pnlPctEffective) ? pnlPctEffective.toFixed(6) : "na";
      const pnlRawTxt = Number.isFinite(pnlPct) ? pnlPct.toFixed(6) : "na";
      console.log(`[TP_P1] exchange=${ex} symbol=${sym || "UNKNOWN"} size=${size} tp_p1_qty=${TP_P1_QTY} qty=${qty} pnl=${pnlTxt} pnl_raw=${pnlRawTxt} leverage=${leverageEff}`);
    }
    return [{
      event: tpP1Event,
      side: exitSide,
      qty_pct: qty,
      reason: "EXIT_TAKE_PROFIT_P1",
      features: { pnl_pct: pnlPctEffective, pnl_pct_raw: pnlPct, leverage: leverageEff, ref_px: closePx, avg_px: avg, position_side: positionSide, exit_profile: exitProfile, tp_p1_pct: TP_P1 }
    }];
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
  computeRunnerExitStopPrice,
  computeTrailingStopPrice,
  resolveEntryRDistance,
};
