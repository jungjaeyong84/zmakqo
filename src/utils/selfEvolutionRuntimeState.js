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
const DEPLOYMENT_PLAN_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json");
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

function writeJsonSafe(filePath, payload) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    return true;
  } catch (_err) {
    return false;
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

function toKstString(iso = null) {
  const date = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`;
}

function readPreparedSelfEvolutionTarget() {
  const raw = readJsonSafe(DEPLOYMENT_PLAN_LATEST_PATH);
  const data = raw && raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
  if (!data || typeof data !== "object") return null;
  const preparedStrategyId = pickString(data.prepared_strategy_id);
  const preparedFilePath = pickString(data.prepared_file_path);
  const targetCandidateId = pickString(data.prepared_origin_candidate_id || data.applied_origin_candidate_id || data.target_candidate_id);
  const recommendedTargetCandidateId = pickString(data.recommended_target_candidate_id || data.target_candidate_id);
  const preparedStageReady = data.prepared_stage_ready === true;
  const readyForManualPaste = data.ready_for_manual_paste === true;
  if (!preparedStrategyId || !preparedFilePath || !preparedStageReady || !readyForManualPaste) return null;
  return {
    target_candidate_id: targetCandidateId,
    recommended_target_candidate_id: recommendedTargetCandidateId,
    prepared_file_path: preparedFilePath,
    latest_generated_file_path: pickString(data.latest_generated_file_path),
    prepared_strategy_id: preparedStrategyId,
    authority_required: data.authority_required === true,
    authority_approved: data.authority_approved === true,
    authority_state: pickString(data.authority_state),
    external_authority_pending: data.external_authority_pending === true,
    authority_bypass_active: data.authority_bypass_active === true,
  };
}

function assessSelfEvolutionRuntimeSignalConfirmation(current = null, { strategyId = null, createdAt = null, preparedRuntime = null } = {}) {
  const currentStrategyId = pickString(current && current.applied_strategy_id);
  const incomingStrategyId = pickString(strategyId);
  const prepared = preparedRuntime && typeof preparedRuntime === "object" ? preparedRuntime : null;
  const preparedStrategyId = pickString(prepared && prepared.prepared_strategy_id);
  if (preparedStrategyId && incomingStrategyId && incomingStrategyId === preparedStrategyId) {
    return { ok: true, reason: "MATCHED_PREPARED_STRATEGY", preparedRuntime: prepared };
  }
  if (!(current && current.acknowledged) || !currentStrategyId) {
    return { ok: false, reason: "NO_PENDING_RUNTIME_STATE" };
  }
  if (!incomingStrategyId || incomingStrategyId !== currentStrategyId) {
    return { ok: false, reason: "STRATEGY_ID_NOT_APPLIED" };
  }
  const incomingCreatedMs = parseIsoMs(createdAt);
  const acknowledgedMs = parseIsoMs(current && current.acknowledged_at_iso);
  const signalBeforeAck = incomingCreatedMs != null && acknowledgedMs != null && incomingCreatedMs < acknowledgedMs;
  return {
    ok: true,
    reason: signalBeforeAck ? "MATCHED_STRATEGY_PRE_ACK" : "MATCHED_STRATEGY",
  };
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
  const firstDecisionSeen = pickBoolean(src.first_decision_seen, liveSignalConfirmed);
  const preparedStageReady = pickBoolean(src.prepared_stage_ready, false);
  const readyForManualPaste = pickBoolean(src.ready_for_manual_paste, false);
  const authorityBypassActive = pickBoolean(src.authority_bypass_active, false);
  const externalAuthorityPending = pickBoolean(src.external_authority_pending, false) || authorityBypassActive;
  const authorityState = pickString(src.authority_state) || (externalAuthorityPending ? "PENDING" : null);
  const bundleActivationConfirmed = pickBoolean(src.bundle_activation_confirmed, false);
  const preparedStrategyId = pickString(src.prepared_strategy_id);
  const preparedFilePath = pickString(src.prepared_file_path);
  const normalizedPlanStatus = deriveRuntimePlanStatus({
    rawPlanStatus: pickString(src.plan_status),
    acknowledged,
    liveSignalConfirmed,
    bundleActivationConfirmed,
    preparedStageReady,
    readyForManualPaste,
    preparedStrategyId,
    preparedFilePath,
    externalAuthorityPending,
    authorityBypassActive,
  });
  return {
    acknowledged,
    acknowledged_at_kst: pickString(src.acknowledged_at_kst),
    acknowledged_at_iso: pickString(src.acknowledged_at_iso),
    cycle_id: pickString(src.cycle_id),
    target_candidate_id: pickString(src.target_candidate_id),
    recommended_target_candidate_id: pickString(src.recommended_target_candidate_id),
    candidate_signature: pickString(src.candidate_signature),
    prepared_file_path: pickString(src.prepared_file_path),
    latest_generated_file_path: pickString(src.latest_generated_file_path),
    applied_file_path: pickString(src.applied_file_path),
    applied_strategy_id: pickString(src.applied_strategy_id),
    prepared_stage_ready: preparedStageReady,
    ready_for_manual_paste: readyForManualPaste,
    plan_status: normalizedPlanStatus,
    prepared_strategy_id: preparedStrategyId,
    prepared_file_path: pickString(src.prepared_file_path),
    latest_generated_file_path: pickString(src.latest_generated_file_path),
    canonical_source_path: pickString(src.canonical_source_path),
    canonical_source_synced: pickBoolean(src.canonical_source_synced, false),
    authority_required: pickBoolean(src.authority_required, false),
    authority_approved: pickBoolean(src.authority_approved, false),
    authority_state: authorityState,
    external_authority_pending: externalAuthorityPending,
    authority_bypass_active: authorityBypassActive,
    live_signal_confirmed: liveSignalConfirmed,
    live_signal_confirmation_pending: acknowledged && !liveSignalConfirmed,
    engine_bundle_loaded: pickBoolean(src.engine_bundle_loaded, false),
    policy_bundle_loaded: pickBoolean(src.policy_bundle_loaded, false),
    market_data_flow_ok: pickBoolean(src.market_data_flow_ok, false),
    first_decision_seen: firstDecisionSeen,
    first_decision_kind: pickString(src.first_decision_kind),
    first_decision_id: pickString(src.first_decision_id),
    first_decision_created_at: pickString(src.first_decision_created_at),
    first_decision_event: pickString(src.first_decision_event),
    first_decision_reason: pickString(src.first_decision_reason),
    confirmation_timeout_minutes: Number.isFinite(Number(src.confirmation_timeout_minutes)) ? Math.max(5, Number(src.confirmation_timeout_minutes)) : null,
    confirmation_deadline_iso: pickString(src.confirmation_deadline_iso),
    confirmation_deadline_kst: pickString(src.confirmation_deadline_kst),
    bundle_activation_confirmed: bundleActivationConfirmed,
    bundle_activation_status: pickString(src.bundle_activation_status),
    bundle_activation_reason: pickString(src.bundle_activation_reason),
    confirmed_signal_id: pickString(src.confirmed_signal_id),
    confirmed_signal_created_at: pickString(src.confirmed_signal_created_at),
    confirmed_signal_event: pickString(src.confirmed_signal_event),
    confirmed_strategy_id: pickString(src.confirmed_strategy_id),
    updated_at_iso: pickString(src.updated_at_iso),
    updated_by: pickString(src.updated_by),
  };
}

function deriveRuntimePlanStatus({
  rawPlanStatus = null,
  acknowledged = false,
  liveSignalConfirmed = false,
  bundleActivationConfirmed = false,
  preparedStageReady = false,
  readyForManualPaste = false,
  preparedStrategyId = null,
  preparedFilePath = null,
  externalAuthorityPending = false,
  authorityBypassActive = false,
} = {}) {
  const pendingAuthority = externalAuthorityPending === true || authorityBypassActive === true;
  if (bundleActivationConfirmed) {
    return pendingAuthority ? "APPLIED_ACTIVE_PENDING_AUTHORITY" : "APPLIED_ACTIVE";
  }
  if (acknowledged) {
    return pendingAuthority ? "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY" : "APPLIED_PENDING_BUNDLE_ACTIVATION";
  }
  if (liveSignalConfirmed) {
    return pendingAuthority ? "APPLIED_CONFIRMED_PENDING_AUTHORITY" : "APPLIED_CONFIRMED";
  }
  if (preparedStageReady && readyForManualPaste && (preparedStrategyId || preparedFilePath)) {
    return "READY_FOR_MANUAL_PASTE";
  }
  return rawPlanStatus;
}

function buildPreparedRuntimePatch(summary = null, currentState = null) {
  const src = summary && typeof summary === "object" ? summary : {};
  const cycleId = pickString(src.cycle_id);
  const preparedStageReady = src.prepared_stage_ready === true;
  const readyForManualPaste = src.ready_for_manual_paste === true;
  const preparedStrategyId = pickString(src.prepared_strategy_id);
  const preparedFilePath = pickString(src.prepared_file_path);
  const latestGeneratedFilePath = pickString(src.latest_generated_file_path);
  const targetCandidateId = pickString(src.prepared_origin_candidate_id || src.applied_origin_candidate_id || src.target_candidate_id);
  const recommendedTargetCandidateId = pickString(src.recommended_target_candidate_id || src.target_candidate_id);
  const planStatus = pickString(src.plan_status);
  const current = currentState && typeof currentState === "object" ? currentState : {};
  const currentAppliedStrategyId = pickString(current.applied_strategy_id);
  const currentConfirmedStrategyId = pickString(current.confirmed_strategy_id);
  const shouldResetConfirmation = Boolean(
    preparedStrategyId
    && (
      (currentAppliedStrategyId && currentAppliedStrategyId !== preparedStrategyId)
      || (currentConfirmedStrategyId && currentConfirmedStrategyId !== preparedStrategyId)
    )
  );
  if (!(preparedStageReady && readyForManualPaste && preparedStrategyId && preparedFilePath)) {
    return {
      prepared_stage_ready: false,
      ready_for_manual_paste: false,
      cycle_id: cycleId,
      plan_status: planStatus,
      prepared_strategy_id: null,
      prepared_file_path: null,
      latest_generated_file_path: null,
      target_candidate_id: pickString(current.target_candidate_id),
      recommended_target_candidate_id: pickString(current.recommended_target_candidate_id),
      candidate_signature: pickString(current.candidate_signature),
      authority_required: src.authority_required === true || pickBoolean(current.authority_required, false),
      authority_approved: src.authority_approved === true || pickBoolean(current.authority_approved, false),
      authority_state: pickString(src.authority_state) || pickString(current.authority_state),
      external_authority_pending: src.external_authority_pending === true || pickBoolean(current.external_authority_pending, false),
      authority_bypass_active: src.authority_bypass_active === true || pickBoolean(current.authority_bypass_active, false),
    };
  }
  return {
    prepared_stage_ready: true,
    ready_for_manual_paste: true,
    cycle_id: cycleId,
    plan_status: planStatus || "READY_FOR_MANUAL_PASTE",
    prepared_strategy_id: preparedStrategyId,
    prepared_file_path: preparedFilePath,
    latest_generated_file_path: latestGeneratedFilePath,
    target_candidate_id: targetCandidateId,
    recommended_target_candidate_id: recommendedTargetCandidateId,
    candidate_signature: targetCandidateId,
    authority_required: src.authority_required === true,
    authority_approved: src.authority_approved === true,
    authority_state: pickString(src.authority_state),
    external_authority_pending: src.external_authority_pending === true,
    authority_bypass_active: src.authority_bypass_active === true,
    acknowledged: shouldResetConfirmation ? false : undefined,
    acknowledged_at_kst: shouldResetConfirmation ? null : undefined,
    acknowledged_at_iso: shouldResetConfirmation ? null : undefined,
    live_signal_confirmed: shouldResetConfirmation ? false : undefined,
    engine_bundle_loaded: shouldResetConfirmation ? false : undefined,
    policy_bundle_loaded: shouldResetConfirmation ? false : undefined,
    market_data_flow_ok: shouldResetConfirmation ? false : undefined,
    first_decision_seen: shouldResetConfirmation ? false : undefined,
    first_decision_kind: shouldResetConfirmation ? null : undefined,
    first_decision_id: shouldResetConfirmation ? null : undefined,
    first_decision_created_at: shouldResetConfirmation ? null : undefined,
    first_decision_event: shouldResetConfirmation ? null : undefined,
    first_decision_reason: shouldResetConfirmation ? null : undefined,
    bundle_activation_confirmed: shouldResetConfirmation ? false : undefined,
    bundle_activation_status: shouldResetConfirmation ? null : undefined,
    bundle_activation_reason: shouldResetConfirmation ? null : undefined,
    confirmed_signal_id: shouldResetConfirmation ? null : undefined,
    confirmed_signal_created_at: shouldResetConfirmation ? null : undefined,
    confirmed_signal_event: shouldResetConfirmation ? null : undefined,
    confirmed_strategy_id: shouldResetConfirmation ? null : undefined,
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
  writeJsonSafe(LOCAL_RUNTIME_PATH, next);
  writeJsonSafe(DAILY_RUNTIME_PATH, next);
  invalidateSettingsCache("system");
  sharedCache = {
    data: next,
    fetchedAtMs: Date.now(),
  };
  return next;
}

async function syncPreparedSelfEvolutionRuntime(summary = null, { updatedBy = "deployment_plan_sync" } = {}) {
  const current = await resolveSelfEvolutionRuntimeState({ ttlMs: 0 });
  const patch = buildPreparedRuntimePatch(summary, current && current.data ? current.data : null);
  return writeSelfEvolutionRuntimeState(patch, { updatedBy });
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
  const preparedRuntime = readPreparedSelfEvolutionTarget();
  const assessment = assessSelfEvolutionRuntimeSignalConfirmation(current, { strategyId, createdAt, preparedRuntime });
  if (!assessment.ok) {
    return { ok: true, updated: false, reason: assessment.reason, data: current };
  }
  const incomingStrategyId = pickString(strategyId);
  if (assessment.reason === "MATCHED_PREPARED_STRATEGY") {
    const prepared = assessment.preparedRuntime || preparedRuntime || {};
    const now = nowIso();
    const next = await writeSelfEvolutionRuntimeState({
      acknowledged: true,
      acknowledged_at_iso: now,
      acknowledged_at_kst: toKstString(now),
      target_candidate_id: pickString(prepared.target_candidate_id),
      recommended_target_candidate_id: pickString(prepared.recommended_target_candidate_id),
      candidate_signature: pickString(prepared.target_candidate_id),
      prepared_file_path: pickString(prepared.prepared_file_path),
      latest_generated_file_path: pickString(prepared.latest_generated_file_path),
      applied_file_path: pickString(prepared.prepared_file_path),
      applied_strategy_id: incomingStrategyId,
      authority_required: prepared.authority_required === true,
      authority_approved: prepared.authority_approved === true,
      authority_state: pickString(prepared.authority_state),
      external_authority_pending: prepared.external_authority_pending === true,
      authority_bypass_active: prepared.authority_bypass_active === true,
      engine_bundle_loaded: true,
      first_decision_seen: true,
      first_decision_kind: "SIGNAL",
      first_decision_id: pickString(signalId),
      first_decision_created_at: pickString(createdAt),
      first_decision_event: pickString(event ? String(event).trim().toUpperCase() : null),
      live_signal_confirmed: true,
      confirmed_signal_id: pickString(signalId),
      confirmed_signal_created_at: pickString(createdAt),
      confirmed_signal_event: pickString(event ? String(event).trim().toUpperCase() : null),
      confirmed_strategy_id: incomingStrategyId,
    }, { updatedBy });
    return { ok: true, updated: true, reason: "PREPARED_STRATEGY_CONFIRMED", data: next };
  }
  if (current.live_signal_confirmed === true && current.confirmed_signal_id === pickString(signalId)) {
    return { ok: true, updated: false, reason: "ALREADY_CONFIRMED", data: current };
  }
  const next = await writeSelfEvolutionRuntimeState({
    first_decision_seen: true,
    first_decision_kind: "SIGNAL",
    first_decision_id: pickString(signalId),
    first_decision_created_at: pickString(createdAt),
    first_decision_event: pickString(event ? String(event).trim().toUpperCase() : null),
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
  syncPreparedSelfEvolutionRuntime,
  confirmSelfEvolutionRuntimeSignal,
  __test: {
    mergeSelfEvolutionRuntimeStateRaw,
    normalizeSelfEvolutionRuntimeState,
    parseIsoMs,
    readPreparedSelfEvolutionTarget,
    toKstString,
    assessSelfEvolutionRuntimeSignalConfirmation,
    buildPreparedRuntimePatch,
    deriveRuntimePlanStatus,
  },
};
