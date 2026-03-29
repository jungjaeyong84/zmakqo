// DONBEOLJA Ω - State Machine (v1.0 skeleton)

const STATES = {
  BOOT: "BOOT",
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  EXIT_ONLY: "EXIT_ONLY",
  HALTED: "HALTED"
};

function createStateMachine() {
  let state = STATES.BOOT;
  let reason = "init";

  function getState() {
    return { state, reason, time: new Date().toISOString() };
  }

  function setState(nextState, nextReason) {
    state = nextState;
    reason = nextReason || "manual";
    return getState();
  }

  // 지금은 규칙만 “자리”로 둔다 (나중에 Gate/Risk/Replay 붙임)
  function onEvent(event) {
    // event 예: { type: "API_OK" } 같은 형태로 확장 예정
    return getState();
  }

  // 부팅 직후 기본 상태로 전환
  setState(STATES.IDLE, "boot_complete");

  return { STATES, getState, setState, onEvent };
}

module.exports = { createStateMachine, STATES };
