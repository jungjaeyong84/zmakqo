"use strict";

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toUpper(value, fallback = null) {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function normalizeSnapshot(snapshot = {}) {
  const meta = (snapshot && typeof snapshot.meta === "object") ? snapshot.meta : {};
  const state = toUpper(snapshot.state || snapshot.position_state, "FLAT");
  const positionState = toUpper(snapshot.position_state, state);
  const sizePct = toNum(snapshot.size_pct);
  const qtyBase = toNum(snapshot.qty_base);
  return {
    state,
    position_state: positionState,
    size_pct: sizePct,
    qty_base: qtyBase,
    position_side: toUpper(snapshot.position_side || meta.position_side, null),
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
  };
}

const ALLOWED_POSITION_STATE_TRANSITIONS = Object.freeze({
  UNKNOWN: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  FLAT: new Set(["FLAT", "PROBE", "COMMIT"]),
  PROBE: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  COMMIT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  SCALE_OUT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
});

function validatePositionSnapshotTransition({ prev = null, next = null } = {}) {
  const previous = normalizeSnapshot(prev || {});
  const current = normalizeSnapshot(next || {});
  const issues = [];

  const hasExposure = (Number.isFinite(current.size_pct) && current.size_pct > 0)
    || (Number.isFinite(current.qty_base) && current.qty_base > 0);

  if (current.state === "FLAT" && hasExposure) {
    issues.push({
      code: "FLAT_WITH_EXPOSURE",
      severity: "critical",
      message: "FLAT state cannot retain positive size or qty.",
    });
  }
  if (current.state !== "FLAT" && !hasExposure) {
    issues.push({
      code: "ACTIVE_WITHOUT_EXPOSURE",
      severity: "critical",
      message: "Active state requires positive size or qty.",
    });
  }
  if (current.position_state === "SCALE_OUT" && current.tp_p1_done !== true) {
    issues.push({
      code: "SCALE_OUT_WITHOUT_TP1",
      severity: "critical",
      message: "SCALE_OUT requires tp_p1_done=true.",
    });
  }
  if (current.trail_active === true && current.tp_p1_done !== true) {
    issues.push({
      code: "TRAIL_WITHOUT_TP1",
      severity: "critical",
      message: "trail_active requires tp_p1_done=true.",
    });
  }

  const fromState = previous.position_state || "UNKNOWN";
  const toState = current.position_state || "UNKNOWN";
  const allowed = ALLOWED_POSITION_STATE_TRANSITIONS[fromState] || ALLOWED_POSITION_STATE_TRANSITIONS.UNKNOWN;
  if (!allowed.has(toState)) {
    issues.push({
      code: "POSITION_STATE_TRANSITION_UNDECLARED",
      severity: "warn",
      message: `${fromState} -> ${toState} is outside the declared transition table.`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    prev: previous,
    next: current,
  };
}

module.exports = {
  validatePositionSnapshotTransition,
  __test: {
    normalizeSnapshot,
    ALLOWED_POSITION_STATE_TRANSITIONS,
  },
};
