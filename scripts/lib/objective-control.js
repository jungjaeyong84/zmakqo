"use strict";

const path = require("path");
const { OPS_DAILY_DIR, readJsonRawSafe } = require("./automation-utils");

const PERIOD_KEYS = Object.freeze(["DAILY", "WEEKLY", "MONTHLY"]);
const PERIOD_WEIGHTS = Object.freeze({
  DAILY: 3,
  WEEKLY: 2,
  MONTHLY: 1,
});
const STAGE_LABELS = Object.freeze({
  PINE: "Pine 품질",
  OPS: "0차 운영/보호",
  QUALITY: "1차 상태/무결성",
  AI: "2차 진입 품질",
  MARKET: "3차 상태 기반 Soft Sizing",
  EV: "4차 EV/시간가치층",
  TIMING: "5차 WAIT 타이밍층",
  EXIT: "청산 엔진",
});

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function signedNum(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function signedKrw(v, digits = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} KRW`;
}

function loadLatestJson(fileName, fallback = null) {
  const filePath = path.join(OPS_DAILY_DIR, fileName);
  const data = readJsonRawSafe(filePath, fallback);
  return { filePath, data };
}

function resolveRetrospectivePeriods(retrospective = null) {
  const src = retrospective && retrospective.periods && typeof retrospective.periods === "object"
    ? retrospective.periods
    : {};
  const out = {};
  for (const key of PERIOD_KEYS) out[key] = src[key] || null;
  return out;
}

function stageLabel(stage) {
  return STAGE_LABELS[String(stage || "").trim().toUpperCase()] || String(stage || "기타");
}

function sumStageCounts(counts = {}) {
  return Object.values(counts || {}).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

function safeTopReasons(rows = [], limit = 5) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      reason: String(row && row.reason || "").trim().toUpperCase(),
      n: Number(row && row.n || 0),
      stage: String(row && row.stage || "").trim().toUpperCase() || null,
    }))
    .filter((row) => row.reason && row.n > 0)
    .sort((a, b) => b.n - a.n || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}

function weightedAverage(rows = [], weightKey, valueKey) {
  let sum = 0;
  let weightSum = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const w = Number(row && row[weightKey]);
    const v = Number(row && row[valueKey]);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(v)) continue;
    sum += w * v;
    weightSum += w;
  }
  return weightSum > 0 ? (sum / weightSum) : null;
}

function maxBy(rows = [], selector) {
  let picked = null;
  let best = -Infinity;
  for (const row of Array.isArray(rows) ? rows : []) {
    const score = Number(selector(row));
    if (!Number.isFinite(score)) continue;
    if (picked == null || score > best) {
      picked = row;
      best = score;
    }
  }
  return picked;
}

module.exports = {
  PERIOD_KEYS,
  PERIOD_WEIGHTS,
  STAGE_LABELS,
  loadLatestJson,
  maxBy,
  pct,
  resolveRetrospectivePeriods,
  safeTopReasons,
  signedKrw,
  signedNum,
  signedPct,
  stageLabel,
  sumStageCounts,
  toNum,
  weightedAverage,
};
