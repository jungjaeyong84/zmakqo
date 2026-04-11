"use strict";

const fs = require("fs");
const path = require("path");
const { KST_OFFSET_MS, toKstString } = require("../utils/timeKst");
const { getMlServingBinding, recordMlServingBinding } = require("../storage/mlServingBindings");
const { recordMlServingState } = require("../storage/mlServingStates");
const { recordMlServingActionHistory, listRecentMlServingActions } = require("../storage/mlServingActionHistory");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function norm(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text || ""), "utf8");
}

function copyLatest(sourcePath, latestPath) {
  ensureDir(path.dirname(latestPath));
  fs.copyFileSync(sourcePath, latestPath);
}

function nowKstMeta(nowMs = Date.now()) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  const pad2 = (n) => String(n).padStart(2, "0");
  return {
    nowMs,
    iso: new Date(nowMs).toISOString(),
    kst: toKstString(nowMs),
    dateKey: `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`,
    hhmm: `${pad2(k.getUTCHours())}${pad2(k.getUTCMinutes())}`,
  };
}

function clone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildPromotionVerification({
  action = null,
  recentActions = [],
  nowMs = Date.now(),
} = {}) {
  const items = Array.isArray(recentActions) ? recentActions : [];
  const cooldownHours = Math.max(1, Number(process.env.ML_SERVING_ROLLBACK_COOLDOWN_HOURS || 24));
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const lastRollback = items.find((row) => upper(row && row.action) === "ROLLBACK_AND_BLOCK" && upper(row && row.payload && row.payload.status) === "APPLIED") || null;
  const lastRollbackMs = toTimeMs(lastRollback && lastRollback.generated_at);
  const rollbackCooldownActive = upper(action) === "PROMOTE_PREFERRED_ARTIFACT"
    && Number.isFinite(lastRollbackMs)
    && (nowMs - lastRollbackMs) < cooldownMs;
  return {
    recent_actions_n: items.length,
    rollback_cooldown_hours: cooldownHours,
    last_rollback_at: lastRollback && lastRollback.generated_at ? lastRollback.generated_at : null,
    rollback_cooldown_active: rollbackCooldownActive,
  };
}

function renderMlServingActionMarkdown(payload = {}) {
  const action = payload.action || {};
  const verification = action.verification || {};
  return [
    "# ML Serving Action",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "ALL"}`,
    `- action: ${action.action || "N/A"} / status: ${action.status || "N/A"} / reason: ${action.reason || "N/A"}`,
    `- apply: ${action.apply === true ? "YES" : "NO"} / live_allowed: ${action.live_serving_allowed === true ? "YES" : "NO"} / block_new_entries: ${action.block_new_entries === true ? "YES" : "NO"}`,
    `- active_model_artifact_id: ${action.active_model_artifact_id || "N/A"} / previous_live_artifact_id: ${action.previous_live_artifact_id || "N/A"} / rollback_target_artifact_id: ${action.rollback_target_artifact_id || "N/A"}`,
    `- verification: cooldown_active=${verification.rollback_cooldown_active === true ? "YES" : "NO"} / last_rollback_at=${verification.last_rollback_at || "N/A"} / recent_actions_n=${verification.recent_actions_n != null ? verification.recent_actions_n : "N/A"}`,
  ].join("\n") + "\n";
}

function buildMlServingActuation({
  exchange = null,
  servingState = null,
  exchangeBindingDoc = null,
  targetBindingDoc = null,
  rollbackBindingDoc = null,
  recentActions = [],
} = {}) {
  const state = servingState && typeof servingState === "object" ? servingState : {};
  const promotionAction = state.promotion_action && typeof state.promotion_action === "object"
    ? state.promotion_action
    : {};
  const currentActiveArtifactId = norm(
    state.active_model_artifact_id
    || (exchangeBindingDoc && (exchangeBindingDoc.active_artifact_id || exchangeBindingDoc.artifact_id))
    || null
  );
  const previousLiveArtifactId = norm(
    state.previous_live_artifact_id
    || (exchangeBindingDoc && exchangeBindingDoc.previous_artifact_id)
    || null
  );
  const targetArtifactId = norm(promotionAction.target_artifact_id || state.preferred_model_artifact_id || null);
  const rollbackTargetArtifactId = norm(state.rollback_model_artifact_id || previousLiveArtifactId || null);
  const action = upper(promotionAction.action) || "HOLD_SHADOW_ONLY";
  const verification = buildPromotionVerification({
    action,
    recentActions,
  });

  if (action === "PROMOTE_PREFERRED_ARTIFACT") {
    if (verification.rollback_cooldown_active === true) {
      return {
        exchange: upper(exchange),
        action,
        status: "BLOCKED",
        reason: "RECENT_ROLLBACK_COOLDOWN_ACTIVE",
        apply: false,
        live_serving_allowed: state.live_serving_allowed === true,
        block_new_entries: state.block_new_entries === true,
        active_model_artifact_id: currentActiveArtifactId,
        previous_live_artifact_id: previousLiveArtifactId,
        rollback_target_artifact_id: rollbackTargetArtifactId,
        verification,
      };
    }
    const targetBinding = targetBindingDoc && targetBindingDoc.binding && typeof targetBindingDoc.binding === "object"
      ? clone(targetBindingDoc.binding)
      : null;
    if (!targetArtifactId || !targetBinding) {
      return {
        exchange: upper(exchange),
        action,
        status: "BLOCKED",
        reason: "PROMOTION_TARGET_BINDING_MISSING",
        apply: false,
        live_serving_allowed: state.live_serving_allowed === true,
        block_new_entries: state.block_new_entries === true,
        active_model_artifact_id: currentActiveArtifactId,
        previous_live_artifact_id: previousLiveArtifactId,
        rollback_target_artifact_id: rollbackTargetArtifactId,
        verification,
      };
    }
    return {
      exchange: upper(exchange),
      action,
      status: "APPLIED",
      reason: "PROMOTED_PREFERRED_ARTIFACT",
      apply: true,
      live_serving_allowed: state.live_serving_allowed === true,
      block_new_entries: state.block_new_entries === true,
      binding: targetBinding,
      active_model_artifact_id: targetArtifactId,
      previous_live_artifact_id: currentActiveArtifactId || previousLiveArtifactId,
      rollback_target_artifact_id: currentActiveArtifactId || previousLiveArtifactId,
      verification,
    };
  }

  if (action === "ROLLBACK_AND_BLOCK") {
    const rollbackBinding = rollbackBindingDoc && rollbackBindingDoc.binding && typeof rollbackBindingDoc.binding === "object"
      ? clone(rollbackBindingDoc.binding)
      : null;
    if (!rollbackTargetArtifactId || !rollbackBinding) {
      return {
        exchange: upper(exchange),
        action,
        status: "BLOCKED",
        reason: "ROLLBACK_TARGET_BINDING_MISSING",
        apply: false,
        live_serving_allowed: false,
        block_new_entries: true,
        active_model_artifact_id: currentActiveArtifactId,
        previous_live_artifact_id: previousLiveArtifactId,
        rollback_target_artifact_id: rollbackTargetArtifactId,
        verification,
      };
    }
    return {
      exchange: upper(exchange),
      action,
      status: "APPLIED",
      reason: "ROLLED_BACK_TO_PREVIOUS_ARTIFACT",
      apply: true,
      live_serving_allowed: false,
      block_new_entries: true,
      binding: rollbackBinding,
      active_model_artifact_id: rollbackTargetArtifactId,
      previous_live_artifact_id: currentActiveArtifactId || previousLiveArtifactId,
      rollback_target_artifact_id: rollbackTargetArtifactId,
      verification,
    };
  }

  return {
    exchange: upper(exchange),
    action,
    status: "HOLD",
    reason: "SHADOW_ONLY_NO_SWAP",
    apply: false,
    live_serving_allowed: state.live_serving_allowed === true,
    block_new_entries: state.block_new_entries === true,
    active_model_artifact_id: currentActiveArtifactId,
    previous_live_artifact_id: previousLiveArtifactId,
    rollback_target_artifact_id: rollbackTargetArtifactId,
    verification,
  };
}

async function applyMlServingActuation({
  exchange = null,
  servingState = null,
  generatedAt = null,
} = {}) {
  const ex = upper(exchange);
  const state = servingState && typeof servingState === "object" ? clone(servingState) : {};
  const nowMeta = nowKstMeta();
  const exchangeBindingDoc = await getMlServingBinding({ exchange: ex }).catch(() => null);
  const recentActions = await listRecentMlServingActions({ exchange: ex, limit: 20 }).catch(() => []);
  const targetArtifactId = norm((state.promotion_action && state.promotion_action.target_artifact_id) || state.preferred_model_artifact_id || null);
  const previousArtifactId = norm(state.previous_live_artifact_id || (exchangeBindingDoc && exchangeBindingDoc.previous_artifact_id) || null);
  const targetBindingDoc = targetArtifactId
    ? await getMlServingBinding({ exchange: ex, artifactId: targetArtifactId }).catch(() => null)
    : null;
  const rollbackBindingDoc = previousArtifactId
    ? await getMlServingBinding({ exchange: ex, artifactId: previousArtifactId }).catch(() => null)
    : null;
  const action = buildMlServingActuation({
    exchange: ex,
    servingState: state,
    exchangeBindingDoc,
    targetBindingDoc,
    rollbackBindingDoc,
    recentActions,
  });
  const nextServingState = {
    ...state,
    active_model_artifact_id: action.active_model_artifact_id || state.active_model_artifact_id || null,
    previous_live_artifact_id: action.previous_live_artifact_id || state.previous_live_artifact_id || null,
    rollback_model_artifact_id: action.rollback_target_artifact_id || state.rollback_model_artifact_id || null,
    actuation: {
      action: action.action,
      status: action.status,
      reason: action.reason,
      applied_at: generatedAt || nowMeta.iso,
      apply: action.apply === true,
      active_model_artifact_id: action.active_model_artifact_id || null,
      previous_live_artifact_id: action.previous_live_artifact_id || null,
      rollback_target_artifact_id: action.rollback_target_artifact_id || null,
    },
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_ml_serving_action`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "ml_serving_action_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "ml_serving_action_latest.md");
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: ex,
    action,
    next_serving_state: nextServingState,
  };

  if (action.apply === true && action.binding) {
    await recordMlServingBinding({
      exchange: ex,
      binding: action.binding,
      source: "ML_SERVING_ACTUATOR",
      generatedAt: generatedAt || nowMeta.iso,
      meta: {
        active_artifact_id: action.active_model_artifact_id || null,
        previous_artifact_id: action.previous_live_artifact_id || null,
        rollback_target_artifact_id: action.rollback_target_artifact_id || null,
        action: action.action,
        status: action.status,
      },
    });
  }

  await recordMlServingState({
    exchange: ex,
    generatedAt: generatedAt || nowMeta.iso,
    state: nextServingState,
    source: "ML_SERVING_ACTUATOR",
    artifacts: {
      latest_json: latestJson,
      latest_md: latestMd,
    },
  }).catch(() => null);

  await recordMlServingActionHistory({
    exchange: ex,
    generatedAt: generatedAt || nowMeta.iso,
    action: action.action,
    payload: action,
  }).catch(() => null);

  writeJson(jsonPath, payload);
  writeText(mdPath, renderMlServingActionMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  return {
    ...action,
    latest_json: latestJson,
    latest_md: latestMd,
    next_serving_state: nextServingState,
  };
}

module.exports = {
  applyMlServingActuation,
  __test: {
    buildMlServingActuation,
    renderMlServingActionMarkdown,
  },
};
