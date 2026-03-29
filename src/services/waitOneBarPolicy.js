"use strict";

const { resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");
const { buildEntryMicroDetail, buildEntryMicroSnapshotFromFeatures } = require("../utils/entryMicroSnapshot");
const { resolveMarketStateSummary } = require("../utils/marketStateSummary");
const { buildFebtLegacyWaitComparison } = require("../utils/febtShadow");

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return !!fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return !!fallback;
  return ["1", "true", "yes", "y", "on"].includes(raw);
}

function shouldApplyWaitOneBarByEvent(eventOrRow, cfg) {
  const ev = String(eventOrRow && eventOrRow.event ? eventOrRow.event : eventOrRow || "").toUpperCase();
  const tier = resolveEntryTimingTier(eventOrRow);
  if (tier === "CORE") return cfg.applyCore;
  if (tier === "PRE_REAL" || tier === "REAL") return false;
  if (tier === "EARLY") return cfg.applyEarly;
  if (ev.startsWith("EMO_")) return cfg.applyEarly;
  return false;
}

function resolveWaitOneBarConfig(sysCfg = {}, exchange = "") {
  const ex = String(exchange || "").toUpperCase();
  const defaultEnabled = ex.includes("BINANCE");
  return {
    enabled: normalizeBool(sysCfg.wait_one_bar_enabled, defaultEnabled),
    applyCore: normalizeBool(sysCfg.wait_one_bar_core_enabled, true),
    applyPreReal: normalizeBool(sysCfg.wait_one_bar_pre_real_enabled, false),
    applyReal: normalizeBool(sysCfg.wait_one_bar_real_enabled, false),
    applyEarly: normalizeBool(sysCfg.wait_one_bar_early_enabled, true),
    sameDirStreakMin: clampNumber(sysCfg.wait_one_bar_same_dir_streak_min, 2, 5, 3),
    chaseRatioMin: clampNumber(sysCfg.wait_one_bar_chase_ratio_min, 0.5, 5, 1.75),
    lastCloseControlMin: clampNumber(sysCfg.wait_one_bar_last_close_control_min, 0.5, 1, 0.80),
    lastDirBodyMin: clampNumber(sysCfg.wait_one_bar_last_dir_body_min, 0.05, 1, 0.45),
    lastOppWickMax: clampNumber(sysCfg.wait_one_bar_last_opposite_wick_max, 0, 0.5, 0.18),
    recentMove1PctMin: clampNumber(sysCfg.wait_one_bar_recent_move1_pct_min, 0.05, 10, 0.45),
    counterDirBarsMax: clampNumber(sysCfg.wait_one_bar_counter_dir_bars_max, 0, 3, 0),
  };
}

function evaluateWaitOneBarTiming({
  intent,
  intentDir,
  eventUpper,
  cfg,
  features,
} = {}) {
  if (!cfg || cfg.enabled !== true) return { ok: true, action: "ALLOW" };
  if (String(intent || "").toUpperCase() !== "ENTRY") return { ok: true, action: "ALLOW" };
  const dir = String(intentDir || "").toUpperCase();
  if (dir !== "LONG" && dir !== "SHORT") return { ok: true, action: "ALLOW" };
  if (!shouldApplyWaitOneBarByEvent({ event: eventUpper, features_json: features }, cfg)) return { ok: true, action: "ALLOW" };

  const f = (features && typeof features === "object") ? features : {};
  const micro = buildEntryMicroSnapshotFromFeatures(f);
  const sameDirStreak = micro.sameDirStreak;
  const chaseRatio = micro.chaseRatio;
  const lastCloseControl = micro.lastCloseControl;
  const lastDirBody = micro.lastDirBody;
  const lastOppWick = micro.lastOppWick;
  const recentMove1Pct = micro.recentMove1Pct;
  const counterDirBars = micro.counterDirBars;
  const marketState = resolveMarketStateSummary(f);
  const entropy = marketState.entropy;
  const coherence = marketState.coherence;
  const transitionRisk = marketState.transitionRisk;
  const fieldAlignment = marketState.fieldAlignment;
  const domainWallDensity = marketState.domainWallDensity;
  const susceptibility = marketState.susceptibility;
  const freeEnergy = marketState.freeEnergy;

  const detail = {
    wait_one_bar_enabled: true,
    wait_one_bar_action: "ALLOW",
    wait_one_bar_same_dir_streak_min: cfg.sameDirStreakMin,
    wait_one_bar_chase_ratio_min: cfg.chaseRatioMin,
    wait_one_bar_last_close_control_min: cfg.lastCloseControlMin,
    wait_one_bar_last_dir_body_min: cfg.lastDirBodyMin,
    wait_one_bar_last_opposite_wick_max: cfg.lastOppWickMax,
    wait_one_bar_recent_move1_pct_min: cfg.recentMove1PctMin,
    wait_one_bar_counter_dir_bars_max: cfg.counterDirBarsMax,
    ...buildEntryMicroDetail("wait_one_bar", micro),
    wait_one_bar_sp_entropy_score: Number.isFinite(entropy) ? entropy : null,
    wait_one_bar_sp_coherence_score: Number.isFinite(coherence) ? coherence : null,
    wait_one_bar_sp_transition_risk: Number.isFinite(transitionRisk) ? transitionRisk : null,
    wait_one_bar_sp_field_alignment: Number.isFinite(fieldAlignment) ? fieldAlignment : null,
    wait_one_bar_sp_domain_wall_density: Number.isFinite(domainWallDensity) ? domainWallDensity : null,
    wait_one_bar_sp_susceptibility: Number.isFinite(susceptibility) ? susceptibility : null,
    wait_one_bar_sp_free_energy: Number.isFinite(freeEnergy) ? freeEnergy : null,
    wait_one_bar_sp_state: marketState.state || null,
    wait_one_bar_market_state_regime: marketState.regime,
    wait_one_bar_market_state_action: marketState.physicsAction,
    wait_one_bar_market_state_qty_scale: marketState.physicsQtyScale,
    wait_one_bar_market_state_wait_assist: marketState.waitAssist,
    wait_one_bar_market_state_wait_hard: marketState.waitHard,
  };

  function withFebtShadow(baseDetail, legacyAction, legacyTriggerPath = "UNKNOWN") {
    return {
      ...baseDetail,
      ...buildFebtLegacyWaitComparison({
        input: f,
        legacyWaitAction: legacyAction,
        legacyWaitTriggerPath: legacyTriggerPath,
      }),
    };
  }

  if (
    !Number.isFinite(sameDirStreak) ||
    !Number.isFinite(chaseRatio) ||
    !Number.isFinite(lastCloseControl) ||
    !Number.isFinite(lastDirBody) ||
    !Number.isFinite(lastOppWick) ||
    !Number.isFinite(recentMove1Pct)
  ) {
    return {
      ok: true,
      action: "SKIP",
      detail: withFebtShadow({
        ...detail,
        wait_one_bar_action: "SKIP",
        wait_one_bar_skip_reason: "FEATURES_MISSING",
      }, "SKIP", "UNKNOWN"),
    };
  }

  const shouldWaitBase = sameDirStreak >= Number(cfg.sameDirStreakMin)
    && chaseRatio >= Number(cfg.chaseRatioMin)
    && lastCloseControl >= Number(cfg.lastCloseControlMin)
    && lastDirBody >= Number(cfg.lastDirBodyMin)
    && lastOppWick <= Number(cfg.lastOppWickMax)
    && recentMove1Pct >= Number(cfg.recentMove1PctMin)
    && (!Number.isFinite(counterDirBars) || counterDirBars <= Number(cfg.counterDirBarsMax));

  const physicsAssist = marketState.waitAssist === true;

  const assistSameDirStreakMin = Math.max(2, Number(cfg.sameDirStreakMin) - 1);
  const assistChaseRatioMin = Math.max(0.5, Number(cfg.chaseRatioMin) * 0.85);
  const assistLastCloseControlMin = Math.max(0.5, Number(cfg.lastCloseControlMin) - 0.05);
  const assistLastDirBodyMin = Math.max(0.05, Number(cfg.lastDirBodyMin) - 0.05);
  const assistLastOppWickMax = Math.min(0.5, Number(cfg.lastOppWickMax) + 0.04);
  const assistRecentMove1PctMin = Math.max(0.05, Number(cfg.recentMove1PctMin) * 0.8);
  const assistCounterDirBarsMax = Number(cfg.counterDirBarsMax) + 1;

  const shouldWaitPhysicsAssist = physicsAssist
    && sameDirStreak >= assistSameDirStreakMin
    && chaseRatio >= assistChaseRatioMin
    && lastCloseControl >= assistLastCloseControlMin
    && lastDirBody >= assistLastDirBodyMin
    && lastOppWick <= assistLastOppWickMax
    && recentMove1Pct >= assistRecentMove1PctMin
    && (!Number.isFinite(counterDirBars) || counterDirBars <= assistCounterDirBarsMax);

  const shouldWaitPhysicsHard = marketState.waitHard === true
    && sameDirStreak >= assistSameDirStreakMin
    && chaseRatio >= Math.max(0.5, Number(cfg.chaseRatioMin) * 0.75)
    && lastCloseControl >= Math.max(0.5, Number(cfg.lastCloseControlMin) - 0.08)
    && lastDirBody >= Math.max(0.05, Number(cfg.lastDirBodyMin) - 0.08);

  if (!shouldWaitBase && !shouldWaitPhysicsAssist && !shouldWaitPhysicsHard) {
    return { ok: true, action: "ALLOW", detail: withFebtShadow(detail, "ALLOW", "UNKNOWN") };
  }

  const waitTriggerPath = shouldWaitBase ? "BASE" : shouldWaitPhysicsHard ? "PHYSICS_HARD" : "PHYSICS_ASSIST";

  return {
    ok: false,
    action: "WAIT_ONE_BAR",
    reason: "DROP_WAIT_ONE_BAR_TIMING",
    detail: withFebtShadow({
      ...detail,
      wait_one_bar_action: "WAIT_ONE_BAR",
      wait_one_bar_triggered: true,
      wait_one_bar_trigger_path: waitTriggerPath,
      wait_one_bar_physics_assist: physicsAssist,
    }, "WAIT_ONE_BAR", waitTriggerPath),
  };
}

module.exports = {
  resolveWaitOneBarConfig,
  evaluateWaitOneBarTiming,
};
