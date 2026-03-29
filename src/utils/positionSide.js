"use strict";

function normalizePositionSide(raw, fallback = null) {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "BUY") return "LONG";
  if (s === "SELL") return "SHORT";
  if (s === "LONG" || s === "SHORT") return s;
  return fallback;
}

function sideToPositionDir(side) {
  return normalizePositionSide(side, null);
}

function resolvePositionSide(...candidates) {
  for (const candidate of candidates) {
    const resolved = normalizePositionSide(candidate, null);
    if (resolved) return resolved;
  }
  return null;
}

function resolvePositionSideFromPosition(position, meta = null, fallback = null) {
  return resolvePositionSide(
    position && position.position_side,
    position && position.positionSide,
    position && position.side,
    meta && meta.position_side,
    meta && meta.external_side,
    meta && meta.external_position_side,
    fallback
  );
}

function resolveCloseSide(positionSide) {
  return normalizePositionSide(positionSide, null) === "SHORT" ? "BUY" : "SELL";
}

module.exports = {
  normalizePositionSide,
  sideToPositionDir,
  resolvePositionSide,
  resolvePositionSideFromPosition,
  resolveCloseSide,
};
