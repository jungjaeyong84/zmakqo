"use strict";

const { canonicalExternalEntryEvent } = require("./liveEntryTaxonomy");

function normalizeEvent(value) {
  return String(value || "").trim().toUpperCase();
}

function classifyFillExecution(event) {
  const code = normalizeEvent(event);
  if (!code) {
    return {
      key: null,
      label: null,
      text: null,
      code: null,
    };
  }

  if (code.startsWith("EXIT_TP_P1_") || code.startsWith("EXIT_TP_C_") || code === "EXIT_TP_P1" || code === "EXIT_TP_C") {
    return { key: "TP1", label: "1차 익절", text: "1차 익절 체결", code };
  }
  if (code.startsWith("EXIT_TRAIL_") || code === "EXIT_TRAIL") {
    return { key: "TRAIL", label: "트레일링", text: "트레일링 청산 체결", code };
  }
  if (code.startsWith("EXIT_SL_") || code === "EXIT_SL") {
    return { key: "SL", label: "손절", text: "손절 체결", code };
  }
  if (code.startsWith("EXIT_BE_") || code === "EXIT_BE") {
    return { key: "BE", label: "본전청산", text: "본전 청산 체결", code };
  }
  if (code.startsWith("EXIT_")) {
    return { key: "EXIT", label: "청산", text: "청산 체결", code };
  }
  if (code.includes("ADD")) {
    return { key: "ADD", label: "추가진입", text: "추가 진입 체결", code };
  }
  if (code === "LONG" || code === "SHORT") {
    return { key: "ENTRY", label: "진입", text: "신규 진입 체결", code };
  }
  if (code.endsWith("_LONG") || code.endsWith("_SHORT")) {
    return { key: "ENTRY", label: "진입", text: "신규 진입 체결", code };
  }

  return {
    key: "FILL",
    label: "체결",
    text: "실행 체결",
    code,
  };
}

function explainFillExecution(event) {
  const code = normalizeEvent(event);
  if (!code) return null;

  const canonicalEntry = canonicalExternalEntryEvent(code, null);
  if (canonicalEntry === "LONG") return "롱 진입이 실제 주문으로 체결됐습니다.";
  if (canonicalEntry === "SHORT") return "숏 진입이 실제 주문으로 체결됐습니다.";

  const direct = {
    LONG: "롱 진입이 실제 주문으로 체결됐습니다.",
    SHORT: "숏 진입이 실제 주문으로 체결됐습니다.",
  };
  if (direct[code]) return direct[code];

  if (code.startsWith("EXIT_TP_P1_") || code.startsWith("EXIT_TP_C_") || code === "EXIT_TP_P1" || code === "EXIT_TP_C") {
    return "1차 익절 조건이 충족되어 부분 또는 전량 청산이 체결됐습니다.";
  }
  if (code.startsWith("EXIT_TRAIL_") || code === "EXIT_TRAIL") {
    return "트레일링 조건이 충족되어 잔여 물량 청산이 체결됐습니다.";
  }
  if (code.startsWith("EXIT_SL_") || code === "EXIT_SL") {
    return "손절 조건이 충족되어 청산이 체결됐습니다.";
  }
  if (code.startsWith("EXIT_BE_") || code === "EXIT_BE") {
    return "본전 보호 조건이 충족되어 청산이 체결됐습니다.";
  }
  if (code.startsWith("EXIT_")) {
    return "청산 조건이 충족되어 주문이 체결됐습니다.";
  }
  if (code.includes("ADD")) {
    return "추가 진입 조건이 충족되어 보유 포지션에 물량이 더해졌습니다.";
  }
  if (code === "LONG" || code === "SHORT") {
    return "진입 조건이 충족되어 신규 포지션이 체결됐습니다.";
  }
  if (code.endsWith("_LONG") || code.endsWith("_SHORT")) {
    return "진입 조건이 충족되어 신규 포지션이 체결됐습니다.";
  }
  return "실행 조건이 충족되어 주문이 체결됐습니다.";
}

function buildFillDisplayReason(fill) {
  const event = fill && fill.event;
  const stage = classifyFillExecution(event);
  return {
    exec_key: stage.key,
    exec_label: stage.label,
    exec_text: stage.text,
    exec_ko: explainFillExecution(event),
  };
}

module.exports = {
  normalizeEvent,
  classifyFillExecution,
  explainFillExecution,
  buildFillDisplayReason,
};
