"use strict";

const fs = require("fs");
const path = require("path");

const { getFirestore } = require("../storage/firestore");
const { invalidateSettingsCache } = require("../storage/settings");

const ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(ROOT, "ops", "daily");
const OPS_RUNTIME_DIR = path.join(ROOT, "ops", "runtime");
const LOCAL_RUNTIME_PATH = path.join(OPS_RUNTIME_DIR, "self_evolution_manual_paste_ack.json");
const DAILY_RUNTIME_PATH = path.join(OPS_DAILY_DIR, "self_evolution_manual_paste_ack_latest.json");
const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC_ID = "system";
const SETTINGS_FIELD = "self_evolution_runtime";

let sharedCache = {
  data: null,
  fetchedAtMs: 0,
};

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function pickString(value) {
  const text = String(value || "").trim();
  return text || null;
}

function pickBoolean(value, fallback = false) {
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function mergeSelfEvolutionRuntimeStateRaw(...states) {
  const out = {};
  for (const state of states) {
    if (!state || typeof state !== "object" || Array.isArray(state)) continue;
    for (const [key, value] of Object.entries(state)) {
      if (value === undefined) continue;
      out[key] = value;
    }
  }
  return out;
}

function normalizeSelfEvolutionRuntimeState(raw = null) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const acknowledged = pickBoolean(src.acknowledged, false);
  const liveSignalConfirmed = pickBoolean(src.live_signal_confirmed, false);
  return {
    acknowledged,
    acknowledged_at_kst: pickString(src.acknowledged_at_kst),
    acknowledged_at_iso: pickString(src.acknowledged_at_iso),
    cycle_id: pickString(src.cycle_id),
    target_candidate_id: pickString(src.target_candidate_id),
    candidate_signature: pickString(src.candidate_signature),
    prepared_file_path: pickString(src.prepared_file_path),
    latest_generated_file_path: pickString(src.latest_generated_file_path),
    applied_file_path: pickString(src.applied_file_path),
    applied_strategy_id: pickString(src.applied_strategy_id),
    canonical_source_path: pickString(src.canonical_source_path),
    canonical_source_synced: pickBoolean(src.canonical_source_synced, false),
    live_signal_confirmed: liveSignalConfirmed,
    live_signal_confirmation_pending: acknowledged && !liveSignalConfirmed,
    confirmed_signal_id: pickString(src.confirmed_signal_id),
    confirmed_signal_created_at: pickString(src.confirmed_signal_created_at),
    confirmed_signal_event: pickString(src.confirmed_signal_event),
    confirmed_strategy_id: pickString(src.confirmed_strategy_id),
    updated_at_iso: pickString(src.updated_at_iso),
    updated_by: pickString(src.updated_by),
  };
}

function readLocalSelfEvolutionRuntimeState() {
  const runtimeRaw = readJsonSafe(LOCAL_RUNTIME_PATH);
  const dailyRaw = readJsonSafe(DAILY_RUNTIME_PATH);
  const merged = mergeSelfEvolutionRuntimeStateRaw(runtimeRaw, dailyRaw);
  if (!Object.keys(merged).length) return null;
  return normalizeSelfEvolutionRuntimeState(merged);
}

async function readSharedSelfEvolutionRuntimeState(ttlMs = 30_000) {
  const ttl = Number.isFinite(Number(ttlMs)) ? Math.max(0, Number(ttlMs)) : 30_000;
  if (sharedCache.data && (Date.now() - sharedCache.fetchedAtMs) <= ttl) {
    return { ok: true, source: "cache", data: sharedCache.data };
  }
  try {
    const db = getFirestore();
    const snap = await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();
    const systemData = snap.exists ? (snap.data() || {}) : {};
    const raw = systemData && typeof systemData === "object" ? systemData[SETTINGS_FIELD] : null;
    const data = normalizeSelfEvolutionRuntimeState(raw);
    sharedCache = {
      data,
      fetchedAtMs: Date.now(),
    };
    return { ok: true, source: "firestore", data };
  } catch (err) {
    return {
      ok: false,
      source: "firestore_error",
      data: null,
      error: err && err.message ? String(err.message) : "SELF_EVOLUTION_RUNTIME_READ_FAILED",
    };
  }
}

async function resolveSelfEvolutionRuntimeState({ ttlMs = 30_000 } = {}) {
  const local = readLocalSelfEvolutionRuntimeState();
  const shared = await readSharedSelfEvolutionRuntimeState(ttlMs);
  const merged = normalizeSelfEvolutionRuntimeState(
    mergeSelfEvolutionRuntimeStateRaw(local, shared && shared.data ? shared.data : null)
  );
  const source = shared && shared.ok
    ? (local ? "firestore+local" : "firestore")
    : (local ? "local" : "none");
  return {
    ok: Boolean(shared && shared.ok) || Boolean(local),
    source,
    local,
    shared: shared && shared.data ? shared.data : null,
    data: merged,
    error: shared && shared.ok ? null : (shared ? shared.error : null),
  };
}

async function writeSelfEvolutionRuntimeState(patch = {}, { updatedBy = "self_evolution_runtime" } = {}) {
  const current = await readSharedSelfEvolutionRuntimeState(0);
  const currentRaw = current && current.data ? current.data : null;
  const nextRaw = mergeSelfEvolutionRuntimeStateRaw(currentRaw, patch, {
    updated_at_iso: nowIso(),
    updated_by: updatedBy,
  });
  const next = normalizeSelfEvolutionRuntimeState(nextRaw);
  const db = getFirestore();
  await db.collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set({
    [SETTINGS_FIELD]: next,
    updated_at: next.updated_at_iso,
  }, { merge: true });
  invalidateSettingsCache("system");
  sharedCache = {
    data: next,
    fetchedAtMs: Date.now(),
  };
  return next;
}

async function confirmSelfEvolutionRuntimeSignal({
  signalId = null,
  createdAt = null,
  event = null,
  strategyId = null,
  updatedBy = "webhook_signal_confirm",
} = {}) {
  const runtime = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const current = runtime && runtime.data ? runtime.data : null;
  const currentStrategyId = pickString(current && current.applied_strategy_id);
  if (!(current && current.acknowledged) || !currentStrategyId) {
    return { ok: true, updated: false, reason: "NO_PENDING_RUNTIME_STATE", data: current };
  }
  const incomingStrategyId = pickString(strategyId);
  if (!incomingStrategyId || incomingStrategyId !== currentStrategyId) {
    return { ok: true, updated: false, reason: "STRATEGY_ID_NOT_APPLIED", data: current };
  }
  const incomingCreatedMs = parseIsoMs(createdAt);
  const acknowledgedMs = parseIsoMs(current.acknowledged_at_iso);
  if (incomingCreatedMs != null && acknowledgedMs != null && incomingCreatedMs < acknowledgedMs) {
    return { ok: true, updated: false, reason: "SIGNAL_BEFORE_ACK", data: current };
  }
  if (current.live_signal_confirmed === true && current.confirmed_signal_id === pickString(signalId)) {
    return { ok: true, updated: false, reason: "ALREADY_CONFIRMED", data: current };
  }
  const next = await writeSelfEvolutionRuntimeState({
    live_signal_confirmed: true,
    confirmed_signal_id: pickString(signalId),
    confirmed_signal_created_at: pickString(createdAt),
    confirmed_signal_event: pickString(event ? String(event).trim().toUpperCase() : null),
    confirmed_strategy_id: incomingStrategyId,
  }, { updatedBy });
  return { ok: true, updated: true, reason: "CONFIRMED", data: next };
}

module.exports = {
  readLocalSelfEvolutionRuntimeState,
  readSharedSelfEvolutionRuntimeState,
  resolveSelfEvolutionRuntimeState,
  writeSelfEvolutionRuntimeState,
  confirmSelfEvolutionRuntimeSignal,
  __test: {
    mergeSelfEvolutionRuntimeStateRaw,
    normalizeSelfEvolutionRuntimeState,
    parseIsoMs,
  },
};
