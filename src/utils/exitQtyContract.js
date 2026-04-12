"use strict";

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(value, fallback) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function resolveTp0ContractQtyRatio(input = null, fallback = 0.25) {
  if (input && typeof input === "object") {
    return clamp01(input.TP_P0_QTY, fallback);
  }
  return clamp01(input, fallback);
}

function resolveTp1RemainingContractQtyRatio(input = null, fallback = 0.5) {
  if (input && typeof input === "object") {
    return clamp01(input.TP_P1_QTY, fallback);
  }
  return clamp01(input, fallback);
}

function resolveTp1AbsoluteContractQtyRatio({
  tp0QtyRatio = 0.25,
  tp1RemainingQtyRatio = 0.5,
} = {}) {
  const tp0 = resolveTp0ContractQtyRatio(tp0QtyRatio, 0.25);
  const tp1Remaining = resolveTp1RemainingContractQtyRatio(tp1RemainingQtyRatio, 0.5);
  return Math.max(0, Math.min(1, (1 - tp0) * tp1Remaining));
}

function resolveExitStageAbsoluteContractQtyRatio(stage, rules = null) {
  const normalizedStage = String(stage || "").trim().toUpperCase();
  const tp0 = resolveTp0ContractQtyRatio(rules, 0.25);
  const tp1Abs = resolveTp1AbsoluteContractQtyRatio({
    tp0QtyRatio: tp0,
    tp1RemainingQtyRatio: resolveTp1RemainingContractQtyRatio(rules, 0.5),
  });
  if (normalizedStage === "TP0") return tp0;
  if (normalizedStage === "TP1") return tp1Abs;
  if (normalizedStage === "TRAIL") return Math.max(0, Math.min(1, 1 - tp0 - tp1Abs));
  return null;
}

module.exports = {
  resolveTp0ContractQtyRatio,
  resolveTp1RemainingContractQtyRatio,
  resolveTp1AbsoluteContractQtyRatio,
  resolveExitStageAbsoluteContractQtyRatio,
};
