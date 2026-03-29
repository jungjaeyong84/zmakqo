function normalizeStage1ReasonCode(value) {
  return String(value || "").trim().toUpperCase();
}

function extractGateSuffix(code) {
  if (!code) return null;
  if (code.startsWith("DROP_LONG_GATE_")) return code.slice("DROP_LONG_GATE_".length);
  if (code.startsWith("DROP_SHORT_GATE_")) return code.slice("DROP_SHORT_GATE_".length);
  if (code.startsWith("DROP_ENTRY_QUALITY_")) return code.slice("DROP_ENTRY_QUALITY_".length);
  if (code === "DROP_LOW_SCORE") return "LOW_SCORE";
  return null;
}

function classifyStage1IntegrityReason(reason) {
  const code = normalizeStage1ReasonCode(reason);
  if (!code) return null;

  const suffix = extractGateSuffix(code);
  if (!suffix) return null;

  const family = code.startsWith("DROP_ENTRY_QUALITY_") || code === "DROP_LOW_SCORE"
    ? "FALLBACK_QUALITY"
    : "FALLBACK_GATE";

  let key = suffix;
  if (suffix === "LOW_SCORE") key = "SCORE";
  if (suffix === "POSTERIOR_MISSING") key = "POSTERIOR";
  if (suffix === "CONF_MISSING") key = "CONF";
  if (suffix === "WAVE_MISSING") key = "WAVE";
  if (suffix === "SCORE_DIR") key = "SCORE_DIR";
  if (suffix === "TREND_ONLY") key = "TREND_ONLY";
  if (suffix === "RANGE") key = "RANGE";

  const labels = {
    CONFLICT: "충돌",
    RANGE: "횡보/레인지",
    TREND_ONLY: "추세 전용",
    SCORE: "점수",
    SCORE_DIR: "점수 방향",
    POSTERIOR: "posterior",
    CONF: "confidence",
    WAVE: "wave",
    REGIME: "regime",
  };

  return {
    code,
    family,
    key,
    label: labels[key] || key,
    suffix,
  };
}

function explainStage1IntegrityReason(reason) {
  const info = classifyStage1IntegrityReason(reason);
  if (!info) return null;

  const direct = {
    DROP_LONG_GATE_CONF: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향 confidence 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_SHORT_GATE_CONF: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 숏 방향 confidence 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_LONG_GATE_REGIME: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향 regime 값이 허용 기준과 맞지 않아 진입을 보류했습니다.",
    DROP_SHORT_GATE_REGIME: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 숏 방향 regime 값이 허용 기준과 맞지 않아 진입을 보류했습니다.",
    DROP_LONG_GATE_SCORE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향 score 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_SHORT_GATE_SCORE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 숏 방향 score 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_LONG_GATE_WAVE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향 wave 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_SHORT_GATE_WAVE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 숏 방향 wave 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_LONG_GATE_CONFLICT: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 롱 방향과 충돌하는 값이 감지되어 진입을 보류했습니다.",
    DROP_SHORT_GATE_CONFLICT: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 숏 방향과 충돌하는 값이 감지되어 진입을 보류했습니다.",

    DROP_ENTRY_QUALITY_CONFLICT: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 방향 충돌이 감지되어 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_RANGE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 레인지 구간으로 분류되어 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_TREND_ONLY: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 추세 전용 조건이 맞지 않아 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_SCORE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, score 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_SCORE_DIR: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, score 방향이 진입 방향과 맞지 않아 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_POSTERIOR_MISSING: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했지만, posterior 값이 없어 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_POSTERIOR: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, posterior 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_CONF_MISSING: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했지만, confidence 값이 없어 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_CONF: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, confidence 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_WAVE_MISSING: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했지만, wave 값이 없어 진입을 보류했습니다.",
    DROP_ENTRY_QUALITY_WAVE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, wave 값이 기준보다 낮아 진입을 보류했습니다.",
    DROP_LOW_SCORE: "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사를 진행했고, 기본 score 값이 너무 낮아 진입을 보류했습니다.",
  };

  return direct[info.code] || "Pine 품질 번들을 바로 신뢰하지 못해 서버 fallback 무결성 검사 기준 미달로 진입을 보류했습니다.";
}

function displayStage1IntegrityReason(reason) {
  const info = classifyStage1IntegrityReason(reason);
  if (!info) return normalizeStage1ReasonCode(reason) || "N/A";
  const code = info.code;
  const side = code.includes("_LONG_") ? "롱" : (code.includes("_SHORT_") ? "숏" : "공통");
  const label = info.label || info.key || "기준";
  return `${side} ${label} 무결성 미달`;
}

module.exports = {
  normalizeStage1ReasonCode,
  classifyStage1IntegrityReason,
  explainStage1IntegrityReason,
  displayStage1IntegrityReason,
};
