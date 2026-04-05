const { classifyStage1IntegrityReason, explainStage1IntegrityReason } = require("./stage1IntegrityReason");
const { resolveIntentStatusFamily } = require("./intentStatus");

function normalizeReason(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeReasonCode(value) {
  return String(value || "").trim().toUpperCase();
}

function classifySignalReasonStage(reason) {
  const code = normalizeReasonCode(reason);
  if (!code) {
    return {
      step: null,
      key: null,
      label: null,
      text: null,
      code: null,
    };
  }

  if (
    code === "DROP_PINE_STAGE1_QUALITY_REJECT"
  ) {
    return {
      step: null,
      key: "PINE",
      label: "Pine 품질",
      text: "Pine 품질 필터",
      code,
    };
  }

  if (code === "FILLED" || code === "EXTERNAL_FILL_RECONCILED") {
    return {
      step: null,
      key: "FILLED",
      label: "체결",
      text: "체결 완료",
      code,
    };
  }

  if (
    code.startsWith("DROP_ENTRY_QUALITY_") ||
    code === "DROP_LOW_SCORE" ||
    code.startsWith("DROP_LONG_GATE_") ||
    code.startsWith("DROP_SHORT_GATE_")
  ) {
    return {
      step: 1,
      key: "QUALITY",
      label: "상태/무결성",
      text: "1차 상태/무결성",
      code,
    };
  }

  if (
    (code.startsWith("DROP_AI_") && !code.startsWith("DROP_AI_BIAS_")) ||
    code === "AI_BLOCK"
  ) {
    return {
      step: 2,
      key: "AI",
      label: "진입 품질",
      text: "2차 진입 품질",
      code,
    };
  }

  if (code.startsWith("DROP_EV_GATE_")) {
    return {
      step: 4,
      key: "EV",
      label: "EV/시간가치층",
      text: "4차 EV/시간가치층",
      code,
    };
  }

  if (code.startsWith("DROP_WAIT_ONE_BAR_")) {
    return {
      step: 5,
      key: "TIMING",
      label: "WAIT 타이밍층",
      text: "5차 WAIT 타이밍층",
      code,
    };
  }

  if (code === "DROP_CHASE_ENTRY_QUALITY") {
    return {
      step: 5,
      key: "TIMING",
      label: "WAIT 타이밍층",
      text: "5차 WAIT 타이밍층",
      code,
    };
  }

  if (code.startsWith("DROP_AI_BIAS_")) {
    return {
      step: 3,
      key: "MARKET",
      label: "상태 기반 Soft Sizing",
      text: "3차 상태 기반 Soft Sizing",
      code,
    };
  }

  return {
    step: null,
    key: "OPS",
    label: "운영/쿨다운",
    text: "운영/쿨다운 필터",
    code,
  };
}

function explainSignalReason(reason) {
  const code = normalizeReasonCode(reason);
  if (!code) return null;

  const stage1Integrity = explainStage1IntegrityReason(code);
  if (stage1Integrity) return stage1Integrity;

  const direct = {
    FILLED: "진입 조건을 통과한 주문이 실제로 체결됐습니다.",
    EXTERNAL_FILL_RECONCILED: "외부 체결 내역과 동기화되어 주문 체결로 확정됐습니다.",
    DROP_PINE_STAGE1_QUALITY_REJECT: "Pine 품질 번들에서 이미 기준 미달로 판단된 신호라 서버가 ENTRY로 되살리지 않았습니다.",

    DROP_AI_MISSING: "AI 판단 데이터가 없어 진입을 보류했습니다.",
    DROP_AI_MISSING_ZERO_QTY: "AI 판단 부재로 최종 수량이 0이 되어 진입을 보류했습니다.",
    DROP_AI_BIAS_OPPOSITE_LONG: "AI가 롱 우위를 보고 있어 숏 진입을 보류했습니다.",
    DROP_AI_BIAS_OPPOSITE_SHORT: "AI가 숏 우위를 보고 있어 롱 진입을 보류했습니다.",
    DROP_AI_BIAS_NEUTRAL_BLOCK: "AI 판단이 중립이라 진입을 보류했습니다.",
    DROP_AI_BIAS_NEUTRAL_LONG_ONLY: "AI 중립 정책상 롱만 허용되어 숏 진입을 보류했습니다.",
    DROP_AI_BIAS_NEUTRAL_SHORT_ONLY: "AI 중립 정책상 숏만 허용되어 롱 진입을 보류했습니다.",
    AI_BLOCK: "AI 판단이 진입 비허용으로 나와 진입을 보류했습니다.",

    DROP_EV_GATE_TP1_PROB: "TP1 도달 확률 하한이 기준보다 낮아 진입을 보류했습니다.",
    DROP_EV_GATE_BARS_MISSING: "EV 판단에 필요한 최근 봉 데이터가 부족해 진입을 보류했습니다.",
    DROP_WAIT_ONE_BAR_TIMING: "현재 봉이 과열된 추격봉으로 보여 다음 봉까지 진입을 연기했습니다.",
    DROP_CHASE_ENTRY_QUALITY: "최근 봉이 과확장 추격 구간으로 판단되어 진입을 보류했습니다.",

    DROP_OPPOSITE_COOLDOWN: "직전 반대 방향 종료 후 쿨다운 구간이라 진입을 보류했습니다.",
    DROP_OPPOSITE_TIME_COOLDOWN: "반대 방향 시간 쿨다운이 남아 있어 진입을 보류했습니다.",
    DROP_SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN: "같은 방향 이익 실현 직후 쿨다운 구간이라 진입을 보류했습니다.",
    DROP_SPIKE_LOCK: "급격한 변동 직후 잠금 구간이라 진입을 보류했습니다.",
    DROP_STALE_SIGNAL: "신호가 늦게 도착해 유효 시간이 지나 진입을 보류했습니다.",
    DROP_OVERLAP: "같은 구간의 중복 신호로 판단되어 진입을 보류했습니다.",
    DROP_TP_P1_PENDING: "TP1 주문이 아직 처리 중이라 중복 실행을 보류했습니다.",
    DROP_TP_P1_ALREADY_DONE: "TP1이 이미 완료된 상태라 중복 실행을 보류했습니다.",
    DROP_ACTION_FILTER: "현재 액션 필터 정책상 허용되지 않아 진입을 보류했습니다.",
    DROP_TRADEABLE_SIGNAL_TYPES: "현재 허용된 신호 타입이 아니라 진입을 보류했습니다.",
    DROP_TRAIL_ACTIVE_NO_ADD: "트레일링 활성 구간에서는 추가진입을 허용하지 않아 보류했습니다.",
    DROP_IN_POSITION_NO_ADD: "이미 포지션이 있고 ADD 조건이 아니어서 진입을 보류했습니다.",
  };
  if (direct[code]) return direct[code];

  if (code.startsWith("DROP_AI_BIAS_")) {
    return "3차 상태 기반 Soft Sizing 필터에서 방향 우위가 맞지 않아 진입을 보류했습니다.";
  }
  if (classifyStage1IntegrityReason(code)) {
    return "1차 상태/무결성에서 Pine 품질 번들 fallback 검사 기준 미달로 진입을 보류했습니다.";
  }
  if (code.startsWith("DROP_AI_")) {
    return "2차 진입 품질 필터에서 기준 미달로 진입을 보류했습니다.";
  }
  if (code.startsWith("DROP_EV_GATE_")) {
    return "4차 EV/시간가치층 필터에서 기준 미달로 진입을 보류했습니다.";
  }
  if (code.startsWith("DROP_WAIT_ONE_BAR_")) {
    return "최근 봉 구조상 지금은 늦은 추격으로 판단되어 다음 봉까지 진입을 연기했습니다.";
  }
  if (code === "DROP_CHASE_ENTRY_QUALITY") {
    return "최근 봉 구조상 과확장 추격 진입으로 판단되어 진입을 보류했습니다.";
  }
  if (code.startsWith("DROP_")) {
    return "운영 필터에서 현재 조건상 진입을 보류했습니다.";
  }
  return null;
}

function buildSignalDisplayReason(signal, execPlan) {
  const rawReason = normalizeReason(signal && signal.reason);
  const status = normalizeReason(execPlan && execPlan.status);
  const statusFamily = resolveIntentStatusFamily(status);
  const cancelReason = normalizeReason(execPlan && execPlan.cancel_reason);
  const statusReason = normalizeReason(execPlan && execPlan.status_reason);
  const pendingReason = normalizeReason(execPlan && execPlan.pending_reason);
  const cancelNote = normalizeReason(execPlan && execPlan.cancel_note);
  const lastError = normalizeReason(execPlan && execPlan.last_error);
  const allReasons = [cancelReason, statusReason, pendingReason].filter(Boolean);
  const externalFill = allReasons.some((reason) => String(reason).toUpperCase() === "EXTERNAL_FILL_RECONCILED");

  let primary = rawReason;
  if (externalFill) primary = "EXTERNAL_FILL_RECONCILED";
  else if (statusFamily === "CANCELED" && cancelReason) primary = cancelReason;
  else if (statusReason) primary = statusReason;
  else if (pendingReason) primary = pendingReason;
  else if (cancelReason) primary = cancelReason;

  const detail = statusFamily === "CANCELED"
    ? (lastError || cancelNote || null)
    : (cancelNote || null);
  const stage = classifySignalReasonStage(primary || rawReason);
  const reasonKo = explainSignalReason(primary || rawReason);

  return {
    primary: primary || null,
    detail,
    raw_reason: rawReason,
    secondary: rawReason && primary && rawReason !== primary ? rawReason : null,
    is_external_fill: externalFill,
    stage_step: stage.step,
    stage_key: stage.key,
    stage_label: stage.label,
    stage_text: stage.text,
    reason_ko: reasonKo,
  };
}

module.exports = {
  normalizeReason,
  normalizeReasonCode,
  classifySignalReasonStage,
  explainSignalReason,
  buildSignalDisplayReason,
};
