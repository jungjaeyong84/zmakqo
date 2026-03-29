// src/utils/tradingMode.js

// trading_mode: RUNNING | EXIT_ONLY | HALTED
function computeTradingMode(gate) {
  if (!gate || gate.status === "PASS") return { trading_mode: "RUNNING", reason: "GATE_PASS" };

  // FAIL
  if (gate.severity === "HARD") return { trading_mode: "HALTED", reason: "GATE_FAIL_HARD" };
  if (gate.severity === "SOFT") return { trading_mode: "EXIT_ONLY", reason: "GATE_FAIL_SOFT" };

  // 정의 밖은 보수적으로 HALTED
  return { trading_mode: "HALTED", reason: "GATE_FAIL_UNKNOWN" };
}

module.exports = { computeTradingMode };
