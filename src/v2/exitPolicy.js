"use strict";

const {
  DEFAULT_TP1_TARGET_PCT,
  DEFAULT_TP1_QTY_RATIO,
  DEFAULT_TRAIL_PCT,
  DEFAULT_FLOOR_LOCK_PCT,
} = require("../services/simplifiedExitV2");

const V2_SIMPLE_EXIT_CONTRACT = Object.freeze({
  exit_contract_mode: "TP_FULL_ONLY",
  TP_P1: DEFAULT_TP1_TARGET_PCT,
  TP_P1_QTY: DEFAULT_TP1_QTY_RATIO,
  TRAIL_PCT: DEFAULT_TRAIL_PCT,
  FLOOR_LOCK_PCT: DEFAULT_FLOOR_LOCK_PCT,
  BE_ENABLE: false,
});

function isFullTpExitRatio(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0.999999;
}

function buildV2SimpleExitRulesPatch() {
  return { ...V2_SIMPLE_EXIT_CONTRACT };
}

module.exports = Object.freeze({
  V2_SIMPLE_EXIT_CONTRACT,
  buildV2SimpleExitRulesPatch,
  isFullTpExitRatio,
});
