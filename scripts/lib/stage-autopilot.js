"use strict";

const fs = require("fs");
const path = require("path");
const { FieldPath, FieldValue } = require("firebase-admin/firestore");
const { getFirestore } = require("../../src/storage/firestore");
const { invalidateSettingsCache } = require("../../src/storage/settings");
const {
  OPS_DAILY_DIR,
  readJsonSafe,
  readJsonRawSafe,
  writeJson,
} = require("./automation-utils");

const WEEKLY_PINE_HISTORY_PATH = path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json");

const STATE_MACHINE = Object.freeze({
  WATCH: "WATCH",
  READY: "READY",
  AUTO_APPLY: "AUTO_APPLY",
  MONITOR: "MONITOR",
  AUTO_ROLLBACK: "AUTO_ROLLBACK",
  HOLD: "HOLD",
});

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readLatestJsonArtifact(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) {
      return { filePath, data: readJsonRawSafe(filePath, null) };
    }
  }
  const filePath = path.join(OPS_DAILY_DIR, names[0]);
  return { filePath, data: readJsonRawSafe(filePath, null) };
}

function readAutopilotState(fileName = "stage_autopilot_state.json") {
  const filePath = path.join(OPS_DAILY_DIR, fileName);
  const data = readJsonSafe(filePath, null);
  return {
    filePath,
    data: data && typeof data === "object" ? data : { stages: {}, history: [] },
  };
}

function writeAutopilotState(filePath, data) {
  writeJson(filePath, data);
}

function stageSnapshotPath(stage, provider) {
  const safeStage = String(stage || "unknown").trim().toLowerCase();
  const safeProvider = String(provider || "unknown").trim().toUpperCase();
  return path.join(OPS_DAILY_DIR, `${safeStage}_${safeProvider}_autopilot_snapshot_latest.json`);
}

function writeStageSnapshot({ stage, provider, snapshot = {}, meta = {} } = {}) {
  const filePath = stageSnapshotPath(stage, provider);
  const payload = {
    ok: true,
    stage,
    provider,
    generated_at: new Date().toISOString(),
    snapshot,
    meta,
  };
  writeJson(filePath, payload);
  return { filePath, data: payload };
}

function readStageSnapshot({ stage, provider } = {}) {
  const filePath = stageSnapshotPath(stage, provider);
  return {
    filePath,
    data: readJsonSafe(filePath, null),
  };
}

function readWeeklyPineLatestHistoryRow() {
  const data = readJsonSafe(WEEKLY_PINE_HISTORY_PATH, null);
  const rows = Array.isArray(data && data.weeks) ? data.weeks : [];
  return rows.length ? rows[rows.length - 1] : null;
}

function getStageState(state, stage) {
  const stages = state && state.stages && typeof state.stages === "object" ? state.stages : {};
  const current = stages[stage];
  if (current && typeof current === "object") return current;
  return {
    stage,
    machine_state: STATE_MACHINE.WATCH,
    last_signature: null,
    last_action: null,
    last_reason: "INIT",
    streak_current: 0,
    applied_at_kst: null,
    applied_signature: null,
    pre_apply_snapshot: null,
    adverse_streak_n: 0,
    monitor_window_runs: 0,
    notes: [],
  };
}

function normalizeSignature(v) {
  return String(v || "").trim() || null;
}

function appendStageHistory(state, row) {
  const prev = Array.isArray(state)
    ? state
    : (Array.isArray(state && state.history) ? state.history : []);
  const dedupKey = `${row.stage || "N/A"}__${row.run_key || "N/A"}__${row.signature || "NONE"}`;
  const next = prev.filter((item) => `${item.stage || "N/A"}__${item.run_key || "N/A"}__${item.signature || "NONE"}` !== dedupKey);
  next.push(row);
  next.sort((a, b) => String(a.run_key || "").localeCompare(String(b.run_key || "")));
  return next;
}

function computeSignatureStreak(history = [], stage, signature) {
  const sig = normalizeSignature(signature);
  if (!sig) return 0;
  const rows = (Array.isArray(history) ? history : []).filter((row) => String(row && row.stage || "") === String(stage || ""));
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const rowSig = normalizeSignature(rows[i] && rows[i].signature);
    if (rowSig !== sig) break;
    streak += 1;
  }
  return streak;
}

async function getRawProviderSettings(provider) {
  const db = getFirestore();
  const snap = await db.collection("settings").doc("system").get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const providers = data.providers && typeof data.providers === "object" ? data.providers : {};
  return providers && typeof providers[provider] === "object" ? providers[provider] : {};
}

async function updateProviderSettings({ provider, kv = {}, updatedBy = "stage-autopilot", deleteKeys = [] } = {}) {
  const db = getFirestore();
  const ref = db.collection("settings").doc("system");
  const prefix = `providers.${provider}`;
  const updatedAt = new Date().toISOString();
  const patch = {
    [`${prefix}.provider`]: provider,
    [`${prefix}.updated_at`]: updatedAt,
    [`${prefix}.updated_by`]: updatedBy,
    updated_at: updatedAt,
  };
  for (const [key, value] of Object.entries(kv || {})) {
    patch[`${prefix}.${key}`] = value;
  }
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) tx.set(ref, { providers: { [provider]: { provider } } }, { merge: true });
    tx.update(ref, patch);
    const deleteArgs = [];
    for (const key of Array.isArray(deleteKeys) ? deleteKeys : []) {
      deleteArgs.push(new FieldPath(`providers.${provider}.${key}`), FieldValue.delete());
    }
    if (deleteArgs.length) tx.update(ref, ...deleteArgs);
  });
  invalidateSettingsCache("system");
  return patch;
}

function pickSettingsSnapshot(currentSys = {}, keys = []) {
  const out = {};
  for (const key of Array.isArray(keys) ? keys : []) {
    if (Object.prototype.hasOwnProperty.call(currentSys || {}, key)) out[key] = currentSys[key];
  }
  return out;
}

function hasSnapshot(snapshot) {
  return snapshot && typeof snapshot === "object" && Object.keys(snapshot).length > 0;
}

function buildRollbackPrepared(snapshot) {
  return hasSnapshot(snapshot);
}

function evaluateCommonAutoApply({
  stageKey = "UNKNOWN",
  objectiveEnoughSample = false,
  objectiveDirectionOk = false,
  sampleSufficient = false,
  coverageSufficient = false,
  canaryPass = false,
  streakCurrent = 0,
  streakRequired = 2,
  changeBudgetOk = false,
  challengerBeatsCurrent = false,
  rollbackPrepared = false,
} = {}) {
  const blockers = [];
  if (objectiveEnoughSample !== true) blockers.push("OBJECTIVE_SAMPLE_NOT_READY");
  if (objectiveDirectionOk !== true) blockers.push("OBJECTIVE_DIRECTION_BLOCK");
  if (sampleSufficient !== true) blockers.push(`${stageKey}_SAMPLE_NOT_READY`);
  if (coverageSufficient !== true) blockers.push(`${stageKey}_COVERAGE_BLOCK`);
  if (canaryPass !== true) blockers.push("CANARY_DRIFT");
  if (streakCurrent < streakRequired) blockers.push(`${stageKey}_STREAK_SHORT`);
  if (changeBudgetOk !== true) blockers.push(`${stageKey}_CHANGE_BUDGET_BLOCK`);
  if (challengerBeatsCurrent !== true) blockers.push(`${stageKey}_CHALLENGER_NOT_BETTER`);
  if (rollbackPrepared !== true) blockers.push(`${stageKey}_ROLLBACK_NOT_PREPARED`);
  return {
    ready: blockers.length === 0,
    blockers,
  };
}

function shouldAutoRollback({ stageState = {}, objectiveSupervisor = {}, canaryPass = true, selfEvolutionRollbackReady = false } = {}) {
  if (!stageState || !stageState.applied_signature || !hasSnapshot(stageState.pre_apply_snapshot)) return { rollback: false, adverse: false };
  const objective = objectiveSupervisor && objectiveSupervisor.objective ? objectiveSupervisor.objective : {};
  const adverse = canaryPass !== true || selfEvolutionRollbackReady === true || (
    objective.enough_sample === true &&
    (objective.pass === false || objective.monthly_pass === false)
  );
  const nextAdverseStreak = adverse ? (Number(stageState.adverse_streak_n || 0) + 1) : 0;
  return {
    rollback: adverse && nextAdverseStreak >= 2,
    adverse,
    nextAdverseStreak,
  };
}

module.exports = {
  STATE_MACHINE,
  readLatestJsonArtifact,
  readAutopilotState,
  writeAutopilotState,
  stageSnapshotPath,
  writeStageSnapshot,
  readStageSnapshot,
  readWeeklyPineLatestHistoryRow,
  getStageState,
  normalizeSignature,
  appendStageHistory,
  computeSignatureStreak,
  getRawProviderSettings,
  updateProviderSettings,
  pickSettingsSnapshot,
  buildRollbackPrepared,
  evaluateCommonAutoApply,
  shouldAutoRollback,
  hasSnapshot,
  __test: {
    appendStageHistory,
    computeSignatureStreak,
    evaluateCommonAutoApply,
    shouldAutoRollback,
    readWeeklyPineLatestHistoryRow,
  },
};
