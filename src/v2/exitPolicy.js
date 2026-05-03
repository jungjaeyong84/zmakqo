"use strict";

// V2 Discovery Canary simplified exit contract.
// This is the single source of truth for new V2 entries:
// - SL at -1.65% leveraged PnL
// - TP at +2.5% leveraged PnL
// - TP closes 100% of the position
// - no runner, no trailing, no BE stop
const V2_SIMPLE_EXIT_CONTRACT = Object.freeze({
  contract_id: "V2_TP_FULL_PNL_2_5_SL_1_65_NO_TRAIL_NO_BE",
  stop_loss_pct: 0.0165,
  tp1_target_pct: 0.025,
  tp1_qty_ratio: 1,
  tp1_exit_mode: "FULL_EXIT",
  tp0_supported: false,
  runner_enabled: false,
  trail_enabled: false,
  be_enabled: false,
});

function isFullTpExitRatio(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0.999999;
}

function buildV2SimpleExitRulesPatch() {
  return Object.freeze({
    SL: -V2_SIMPLE_EXIT_CONTRACT.stop_loss_pct,
    TP_P1: V2_SIMPLE_EXIT_CONTRACT.tp1_target_pct,
    TP_P1_QTY: V2_SIMPLE_EXIT_CONTRACT.tp1_qty_ratio,
    TP_C: null,
    BE_ENABLE: false,
    BE_PCT: null,
    TRAIL_R_MULTIPLE: null,
    TRAIL_PCT: null,
    RUNNER_MIN_PROFIT_PCT: null,
    exit_contract_id: V2_SIMPLE_EXIT_CONTRACT.contract_id,
    exit_contract_mode: "TP_FULL_ONLY",
  });
}

module.exports = {
  V2_SIMPLE_EXIT_CONTRACT,
  isFullTpExitRatio,
  buildV2SimpleExitRulesPatch,
};
