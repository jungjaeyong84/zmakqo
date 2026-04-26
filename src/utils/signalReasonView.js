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

  if (code === "MIN_ORDER_EXCEEDS_BUDGET") {
    return {
      step: null,
      key: "BUDGET",
      label: "예산/최소주문 가드",
      text: "예산/최소주문 가드",
      code,
    };
  }

  if (code.startsWith("TP1_FAIL_CLOSED_")) {
    return {
      step: null,
      key: "TP1_FAIL_CLOSED",
      label: "TP1 보호 격리",
      text: "TP1 보호 격리",
      code,
    };
  }

  if (code.startsWith("OPENCLAW_EXECUTOR_")) {
    return {
      step: null,
      key: "EXECUTOR",
      label: "OpenClaw 실행 가드",
      text: "OpenClaw 실행 가드",
      code,
    };
  }

  if (code.startsWith("LIVE_POLICY_")) {
    return {
      step: null,
      key: "LIVE_POLICY",
      label: "라이브 운영 정책",
      text: "라이브 운영 정책",
      code,
    };
  }

  if (
    code === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL" ||
    code === "V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL" ||
    code === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED" ||
    code === "V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED" ||
    code === "LIVE_DISABLED" ||
    code === "V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE" ||
    code === "V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE" ||
    code === "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE" ||
    code === "V2_DISCOVERY_CANARY_CONTRACT_BLOCKED" ||
    code.startsWith("DISCOVERY_CANARY:") ||
    code.startsWith("V2_DISCOVERY_BRIDGE_") ||
    code.startsWith("V2_DISCOVERY_CANARY_BRIDGE:")
  ) {
    return {
      step: null,
      key: "LIVE_CONFIG",
      label: "라이브 실행 설정",
      text: "라이브 실행 설정",
      code,
    };
  }

  if (code === "SIGNAL_CRITERIA_BLOCKED" || code === "SIGNAL_CRITERIA_REQUIRED") {
    return {
      step: 2,
      key: "SIGNAL_CRITERIA",
      label: "V2 신호 기준",
      text: "V2 신호 기준",
      code,
    };
  }

  if (
    code === "MARKET_DATA_QUALITY_BLOCKED" ||
    code === "MARKET_DATA_QUALITY_REQUIRED" ||
    code === "V2_MARKET_DATA_QUALITY_BLOCKED" ||
    code.startsWith("MARKET_DATA:")
  ) {
    return {
      step: 1,
      key: "MARKET_DATA",
      label: "시장 데이터 품질",
      text: "시장 데이터 품질",
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
      step: null,
      key: "LEGACY_RETIRED",
      label: "Retired legacy guard",
      text: "Retired legacy timing guard",
      code,
    };
  }

  if (code === "DROP_CHASE_ENTRY_QUALITY") {
    return {
      step: null,
      key: "LEGACY_RETIRED",
      label: "Retired legacy guard",
      text: "Retired legacy timing guard",
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

    DROP_EV_GATE_TP1_PROB: "TP0/TP1/시간청산을 함께 반영한 기대값 하한이 기준보다 낮아 진입을 보류했습니다.",
    DROP_EV_GATE_BARS_MISSING: "EV 판단에 필요한 최근 봉 데이터가 부족해 진입을 보류했습니다.",
    DROP_WAIT_ONE_BAR_TIMING: "은퇴된 wait-one-bar 타이밍 가드입니다. V2 discovery에서는 hard drop으로 쓰면 안 되며, 이 사유가 실행 알림에 나오면 retired guard leakage로 봐야 합니다.",
    DROP_CHASE_ENTRY_QUALITY: "은퇴된 chase-entry 품질 가드입니다. V2 discovery에서는 productionEntryRoute의 V2 기준만 주문 권한을 가져야 합니다.",

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
    DROP_ADD_GUARD: "추가 진입 보호 규칙에 걸려 ADD를 보류했습니다.",
    DROP_ADD_DAY_LOSS_CAP: "당일 손실 한도에 걸려 추가 진입을 보류했습니다.",
    DROP_ADD_DAY_STREAK: "당일 연속 손실 기준에 걸려 추가 진입을 보류했습니다.",
    DROP_ADD_DRAWDOWN_HARD: "현재 드로우다운이 커서 추가 진입을 보류했습니다.",
    DROP_ADD_QTY_INVALID: "추가 진입 수량 계산이 유효하지 않아 ADD를 보류했습니다.",
    DROP_ADD_QTY_TOO_SMALL: "추가 진입 수량이 너무 작아 ADD를 보류했습니다.",
    DROP_CANONICAL_ENGINE: "정본 엔진 기준을 통과하지 못해 진입을 보류했습니다.",
    DROP_COMMISSION_GATE_ERROR: "수수료 방어 계산 중 오류가 발생해 안전하게 진입을 보류했습니다.",
    DROP_COMMISSION_GATE_ZERO_QTY: "수수료를 반영하니 기대값이 부족해 최종 수량이 0이 되어 진입을 보류했습니다.",
    DROP_MARKET_PHYSICS_DISORDER: "현재 시장 질서도가 낮고 잡음이 커 진입을 보류했습니다.",
    DROP_LIVE_POLICY_BLOCK: "라이브 운영 정책에서 진입을 차단했습니다.",
    LIVE_DISABLED: "서버 신호는 생성됐지만 기존 Binance live 실행 허가가 꺼져 있어 실제 주문을 보류했습니다.",
    V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL: "진입 주문이 체결된 뒤 보호주문 확인 또는 복구가 실패했습니다. 이 상태는 신호 드롭이 아니라 실제 포지션 보호 복구가 필요한 CRITICAL 상태입니다.",
    V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL: "진입 주문이 체결된 뒤 보호주문 확인 또는 복구가 실패했습니다. 이 상태는 신호 드롭이 아니라 실제 포지션 보호 복구가 필요한 CRITICAL 상태입니다.",
    V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED: "진입 주문과 보호주문은 완료됐지만 route/audit 후처리가 실패했습니다. 이 상태는 신호 드롭이 아니라 실제 체결 이후 기록 확인이 필요한 상태입니다.",
    V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED: "V2 production entry route가 주문 전 단계에서 진입을 차단했습니다. 세부 사유는 route_result 또는 V2 discovery route blocker를 확인해야 합니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:SYMBOL_NOT_ALLOWED": "V2 discovery canary 허용 심볼 목록에 없는 심볼이라 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LIVE_ENDPOINT_REQUIRED": "V2 discovery live endpoint가 켜져 있지 않아 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:DISCOVERY_NOT_ENABLED": "V2 discovery canary가 켜져 있지 않아 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:CANARY_ONLY_REQUIRED": "정식 LIVE가 아니라 discovery canary-only 상태여야 하므로 현재 설정에서는 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:MAX_NOTIONAL_REQUIRED": "V2 discovery canary 최대 주문 금액 한도가 없어 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:MAX_TRADES_PER_DAY_REQUIRED": "V2 discovery canary 하루 최대 진입 횟수 한도가 없어 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:MAX_TRADES_PER_DAY_EXCEEDS_5": "V2 discovery canary 하루 최대 진입 횟수 한도가 5회를 초과해 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:MAX_POSITION_COUNT_REQUIRED": "V2 discovery canary 동시 포지션 한도가 없어 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:MAX_POSITION_COUNT_EXCEEDS_5": "V2 discovery canary 동시 포지션 한도가 5개를 초과해 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:ML_LIVE_ARMED": "ML live serving이 켜져 있어 discovery canary 안전 계약과 맞지 않아 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:AGENT_APPLY_ENABLED": "OpenClaw agent live apply가 켜져 있어 discovery canary 안전 계약과 맞지 않아 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:RISK_GOVERNOR_REQUIRED": "V2 risk governor 필수 플래그가 확인되지 않아 discovery canary 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WEBHOOK_NOT_BLOCKED": "legacy webhook 차단이 확인되지 않아 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WEBHOOK_ALLOWED": "legacy webhook 허용 플래그가 켜져 있어 실제 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_RUNTIME_NOT_RETIRED": "V2 discovery canary에서 legacy runtime retired 플래그가 확인되지 않아 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_ENTRY_FILTERS_NOT_RETIRED": "V2 discovery canary에서 legacy entry filter 비활성 계약이 확인되지 않아 주문을 보류했습니다.",
    "V2_DISCOVERY_CANARY_BRIDGE:LEGACY_WAIT_ONE_BAR_HARD_DROP_NOT_RETIRED": "V2 discovery canary에서 legacy wait-one-bar hard drop 비활성 계약이 확인되지 않아 주문을 보류했습니다.",
    V2_DISCOVERY_CANARY_ROUTED_TO_PRODUCTION_ENTRY_ROUTE: "서버 신호를 legacy live 주문 경로에서 실행하지 않고 V2 productionEntryLiveEndpoint/productionEntryRoute로 위임했습니다. 이는 드롭/취소가 아니라 V2 보호 진입 경로로 넘긴 상태입니다.",
    V2_DISCOVERY_BRIDGE_MARKET_DATA_QUALITY_BLOCKED: "V2 discovery handoff 전 market data quality가 통과하지 못해 주문을 보류했습니다.",
    V2_DISCOVERY_BRIDGE_ENDPOINT_BLOCKED: "V2 production entry live endpoint가 discovery handoff 요청을 차단했습니다.",
    V2_DISCOVERY_BRIDGE_THROWN: "V2 discovery handoff 처리 중 예외가 발생해 안전하게 주문을 보류했습니다.",
    V2_DISCOVERY_CANARY_CONTRACT_BLOCKED: "V2 discovery canary 안전 계약을 통과하지 못해 실제 주문을 보류했습니다.",
    "DISCOVERY_CANARY:MAX_POSITION_COUNT_REACHED": "V2 discovery canary 동시 포지션 한도에 도달해 신규 진입을 보류했습니다.",
    "DISCOVERY_CANARY:MAX_TRADES_PER_DAY_REACHED": "V2 discovery canary 하루 최대 진입 횟수에 도달해 신규 진입을 보류했습니다.",
    "DISCOVERY_CANARY:DAILY_LOSS_HALT_REACHED": "V2 discovery canary 일 손실 중단 한도에 도달해 신규 진입을 보류했습니다.",
    "DISCOVERY_CANARY:MAX_NOTIONAL_EXCEEDED": "V2 discovery canary 심볼별 주문 금액 한도를 초과해 신규 진입을 보류했습니다.",
    "DISCOVERY_CANARY:PARTIAL_TP1_MIN_NOTIONAL_REQUIRED": "TP1 50% 보호주문의 거래소 최소 주문금액을 만족하지 못해 신규 진입을 보류했습니다.",
    V2_DISCOVERY_CANARY_REQUIRES_PRODUCTION_ENTRY_ROUTE: "V2 discovery canary 진입은 productionEntryLiveEndpoint/productionEntryRoute 전용이라 legacy live 주문 경로에서 보류했습니다.",
    V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE: "V2 production entry router가 OpenClaw bundle을 실행 가능 신호로 승인하지 않아 주문을 보류했습니다.",
    SIGNAL_CRITERIA_BLOCKED: "V2 신호 기준(signal criteria)을 통과하지 못해 discovery 주문을 보류했습니다.",
    SIGNAL_CRITERIA_REQUIRED: "V2 신호 기준 증거가 없어 discovery 주문을 보류했습니다.",
    MARKET_DATA_QUALITY_BLOCKED: "시장 데이터 품질 기준을 통과하지 못해 discovery 주문을 보류했습니다.",
    MARKET_DATA_QUALITY_REQUIRED: "시장 데이터 품질 증거가 없어 discovery 주문을 보류했습니다.",
    V2_MARKET_DATA_QUALITY_BLOCKED: "V2 시장 데이터 품질 기준을 통과하지 못해 discovery 주문을 보류했습니다.",
    "MARKET_DATA:STALE_CANDLE": "시장 데이터 기준 봉이 오래되어 stale candle로 판단됐고 신규 진입을 보류했습니다.",
    "MARKET_DATA:SPREAD_TOO_WIDE": "현재 스프레드가 기준보다 넓어 신규 진입을 보류했습니다.",
    "MARKET_DATA:MARK_INDEX_DIVERGENCE_TOO_WIDE": "mark/index 가격 괴리가 기준보다 커 신규 진입을 보류했습니다.",
    "MARKET_DATA:VOLUME_TOO_LOW": "24시간 거래대금 또는 유동성이 기준보다 낮아 신규 진입을 보류했습니다.",
    "MARKET_DATA:GAP_BARS_PRESENT": "최근 데이터에 결측 봉이 있어 신규 진입을 보류했습니다.",
    LIVE_POLICY_BLOCK: "라이브 운영 정책에서 진입을 차단했습니다.",
    LIVE_RESCUE_ADD_DISABLED: "현재 구조에서는 구조보강 ADD가 비활성이라 추가 진입을 보류했습니다.",
    LIVE_RESCUE_ADD_TIER_BLOCKED: "이번 신호 티어는 구조보강 ADD 허용 구간이 아니라 추가 진입을 보류했습니다.",
    LIVE_RESCUE_ADD_SIDE_BLOCKED: "현재 포지션 방향과 맞지 않아 구조보강 ADD를 보류했습니다.",
    LIVE_RESCUE_ADD_POST_TP1_BLOCKED: "이미 TP1 이후 구간이라 구조보강 ADD를 허용하지 않았습니다.",
    LIVE_RESCUE_ADD_SAME_BAR_BLOCKED: "같은 봉에서 중복 구조보강 ADD는 허용하지 않아 보류했습니다.",
    LIVE_RESCUE_ADD_OPPOSITE_TRANSITION_BLOCKED: "직전 반대 방향 전환 영향 구간이라 구조보강 ADD를 보류했습니다.",
    LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: "현재 손실 폭이 구조보강 ADD 허용 구간 밖이라 추가 진입을 보류했습니다.",
    LIVE_RESCUE_ADD_STOP_GAP_BLOCKED: "손절 여유가 너무 좁아 구조보강 ADD를 보류했습니다.",
    LIVE_RESCUE_ADD_POSITION_FULL: "현재 포지션 여유가 없어 구조보강 ADD를 보류했습니다.",
    LIVE_RESCUE_ADD_LIMIT_BLOCKED: "당일 또는 연속 ADD 한도에 걸려 추가 진입을 보류했습니다.",
    LIVE_RESCUE_ADD_BLOCKED: "구조보강 ADD 조건이 충족되지 않아 추가 진입을 보류했습니다.",
    LIVE_POLICY_PORTFOLIO_CLUSTER_BLOCK: "같은 방향 포지션 군집이 과도해 신규 진입을 막았습니다.",
    LIVE_POLICY_PORTFOLIO_CLUSTER_CAP_BLOCK: "같은 방향 총노출 한도를 넘어 신규 진입을 막았습니다.",
    LIVE_POLICY_PORTFOLIO_CLUSTER_REDUCE: "같은 방향 포지션 군집이 커서 진입 수량을 줄였습니다.",
    LIVE_POLICY_PORTFOLIO_CLUSTER_CAP_REDUCE: "같은 방향 총노출이 높아 진입 수량을 줄였습니다.",
    LIVE_POLICY_OTHER_SERVER_POLICY_WATCH_ONLY_BLOCK: "현재 서버 정책상 관찰 전용 구간이라 진입을 보류했습니다.",
    LIVE_POLICY_PLAN_HOLD_BLOCK: "현재 운영 계획이 HOLD 상태라 진입을 보류했습니다.",
    LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK: "현재 운영 계획이 WATCH_ONLY 상태라 진입을 보류했습니다.",
    LIVE_POLICY_QUARANTINE_HARD_BLOCK: "현재 시장이 격리(quarantine) 상태라 진입을 보류했습니다.",
    TP1_FAIL_CLOSED_REPEAT_QUARANTINE: "TP1 보호주문 또는 메타 동기화 실패가 반복되어 해당 시장을 일시 격리하고 신규 진입을 보류했습니다.",
    LIVE_POLICY_EXECUTION_QUALITY_HARD_BLOCK: "최근 실행 품질이 나빠 진입을 보류했습니다.",
    LIVE_POLICY_EXECUTION_QUALITY_GLOBAL_HARD_BLOCK: "전체 실행 품질 경보가 걸려 진입을 보류했습니다.",
    LINEAGE_SLO_REPORT_STALE: "참조한 추적 리포트가 오래돼 안전하게 진입을 보류했습니다.",
    LINEAGE_SLO_REPORT_MISSING: "필수 추적 리포트를 찾지 못해 안전하게 진입을 보류했습니다.",
    LINEAGE_SLO_INTENT_SIGNAL_NULL_RATE: "주문 의도와 신호 연결 누락 비율이 높아 진입을 보류했습니다.",
    LINEAGE_SLO_FILL_SIGNAL_NULL_RATE: "체결과 신호 연결 누락 비율이 높아 진입을 보류했습니다.",
    LINEAGE_SLO_FILL_INTENT_NULL_RATE: "체결과 주문 의도 연결 누락 비율이 높아 진입을 보류했습니다.",
    LINEAGE_SLO_FAIL_CLOSED: "추적 무결성을 확신할 수 없어 fail-closed로 진입을 보류했습니다.",
    MIN_ORDER_EXCEEDS_BUDGET: "현재 예산과 배율로는 거래소 최소주문 수량을 만족할 수 없어 진입을 보류했습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE: "자본 배분기에서 해당 시장을 격리 상태로 판단해 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_REDUCE: "자본 배분기 격리 상태지만 학습 epoch 예외로 완전 차단 대신 감산만 적용했습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE_EPOCH_RELEASE: "자본 배분기 격리 상태지만 학습 epoch 예외로 차단을 일시 해제했습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_BLOCK: "자본 배분기에서 해당 시장을 차단 상태로 판단해 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_STALE_REDUCE: "자본 배분 스냅샷이 오래돼 신규 진입을 완전 차단하지 않고 보수적으로 감산했습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_REDUCE: "자본 배분 점수가 낮아 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_EXPLORE_SCALE: "탐색 모드 시장으로 분류되어 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_ALLOCATOR_INCREASE: "자본 배분 점수가 높아 신규 진입 수량을 확대했습니다.",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK: "알파 컨텍스트 패널티가 강하게 걸려 있어 현재 구간의 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_REDUCE: "알파 컨텍스트 패널티가 있어 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_STALE_REDUCE: "알파 컨텍스트 스냅샷이 오래돼 완전 차단 대신 보수적으로 감산했습니다.",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_REDUCE: "학습 epoch 예외로 완전 차단 대신 감산만 적용했습니다.",
    OPENCLAW_EXECUTOR_ALPHA_CONTEXT_EPOCH_RELEASE: "학습 epoch 예외로 알파 컨텍스트 차단을 일시 해제했습니다.",
    OPENCLAW_EXECUTOR_SAME_SIDE_CLUSTER_BLOCK: "같은 방향 포지션 군집 수가 기준을 넘어 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_SAME_SIDE_CLUSTER_REDUCE: "같은 방향 포지션 군집이 커서 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_CORRELATED_CLUSTER_BLOCK: "상관된 시장의 같은 방향 포지션 군집 수가 기준을 넘어 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_CORRELATED_CLUSTER_REDUCE: "상관된 시장 군집 노출이 커서 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_BLOCK: "같은 방향 총노출이 기준을 넘어 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_SAME_SIDE_EXPOSURE_REDUCE: "같은 방향 총노출이 높아 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK: "상관된 시장까지 포함한 총노출이 기준을 넘어 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_REDUCE: "상관된 시장까지 포함한 총노출이 높아 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_RECENT_REENTRY_BLOCK: "직전 청산 직후 재진입 금지 구간이라 신규 진입을 막았습니다.",
    OPENCLAW_EXECUTOR_RECENT_REENTRY_REDUCE: "직전 청산 직후 완화 구간이라 신규 진입 수량을 줄였습니다.",
    OPENCLAW_EXECUTOR_COHORT_REDUCE: "현재 cohort가 보수 운영 구간으로 분류되어 신규 진입 수량을 줄였습니다.",
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
  if (code.startsWith("LIVE_RESCUE_ADD_")) {
    return "구조보강 ADD 운영 가드에서 현재 조건상 추가 진입을 보류했습니다.";
  }
  if (code.startsWith("TP1_FAIL_CLOSED_")) {
    return "TP1 보호주문 또는 메타 동기화 실패가 반복되어 해당 시장을 일시 격리하고 신규 진입을 보류했습니다.";
  }
  if (code.startsWith("LIVE_POLICY_")) {
    return "라이브 운영 정책에서 현재 조건상 진입을 보류했습니다.";
  }
  if (code.startsWith("LINEAGE_SLO_")) {
    return "추적 무결성 기준을 만족하지 못해 안전하게 진입을 보류했습니다.";
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
