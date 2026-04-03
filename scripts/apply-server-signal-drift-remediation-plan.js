#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");
const { getSystemSettingsForProvider, invalidateSettingsCache } = require("../src/storage/settings");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
} = require("./lib/automation-utils");

loadLocalEnv();

const PROVIDER = String(process.env.SERVER_SIGNAL_DRIFT_PLAN_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
const APPLY = String(process.env.APPLY || "0").trim() === "1";
const PLAN_PATH = path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_plan_latest.json");
const RESULT_LATEST = path.join(OPS_DAILY_DIR, "server_signal_drift_remediation_apply_latest.json");
const QUARANTINE_LATEST = path.join(OPS_DAILY_DIR, "best_self_evolution_server_market_quarantine_latest.json");
const LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED = String(process.env.SERVER_SIGNAL_LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED || "1").trim() !== "0";

function parseDateMs(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
  }
  const s = String(value || "").trim();
  if (!s) return null;
  const kstMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*KST$/i);
  if (kstMatch) {
    const [, y, mo, d, h, mi, sec] = kstMatch;
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(sec));
    return Number.isFinite(utcMs) ? utcMs : null;
  }
  const isoMs = Date.parse(s);
  return Number.isFinite(isoMs) ? isoMs : null;
}

function toKstString(ms) {
  if (!Number.isFinite(ms)) return null;
  const kst = new Date(ms + (9 * 60 * 60 * 1000));
  const pad = (x) => String(x).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`;
}

function deriveLastAppliedMeta(previous = null) {
  if (!previous || typeof previous !== "object") return {};
  const rawLastAppliedMs = previous.last_applied_at_ms;
  const rawLastEvPatchN = previous.last_applied_ev_patch_n;
  const rawLastCooldownPatchN = previous.last_applied_cooldown_patch_n;
  const fromLast = {
    at_kst: String(previous.last_applied_at_kst || "").trim() || null,
    at: String(previous.last_applied_at || "").trim() || null,
    at_ms: (rawLastAppliedMs == null || rawLastAppliedMs === "" || !Number.isFinite(Number(rawLastAppliedMs)) || Number(rawLastAppliedMs) <= 0)
      ? null
      : Number(rawLastAppliedMs),
    source_cycle_id: String(previous.last_applied_source_cycle_id || "").trim() || null,
    target_cycle_id: String(previous.last_applied_target_cycle_id || "").trim() || null,
    ev_patch_n: (rawLastEvPatchN == null || rawLastEvPatchN === "" || !Number.isFinite(Number(rawLastEvPatchN)))
      ? null
      : Number(rawLastEvPatchN),
    cooldown_patch_n: (rawLastCooldownPatchN == null || rawLastCooldownPatchN === "" || !Number.isFinite(Number(rawLastCooldownPatchN)))
      ? null
      : Number(rawLastCooldownPatchN),
  };
  const fromCurrentApplied = previous.applied === true
    ? {
      at_kst: String(previous.generated_at_kst || "").trim() || null,
      at: String(previous.generated_at || "").trim() || null,
      at_ms: parseDateMs(previous.generated_at_ms || previous.generated_at_kst || previous.generated_at),
      source_cycle_id: String(
        (previous.inputs && (previous.inputs.plan_cycle_id || previous.inputs.source_cycle_id))
        || previous.source_cycle_id
        || ""
      ).trim() || null,
      target_cycle_id: String(previous.target_cycle_id || "").trim() || null,
      ev_patch_n: Number.isFinite(Number(previous.changes && previous.changes.ev_gate_tp1_prob_min_by_market && previous.changes.ev_gate_tp1_prob_min_by_market.patch_n))
        ? Number(previous.changes.ev_gate_tp1_prob_min_by_market.patch_n)
        : null,
      cooldown_patch_n: Number.isFinite(Number(previous.changes && previous.changes.opposite_signal_cooldown_bars_by_market && previous.changes.opposite_signal_cooldown_bars_by_market.patch_n))
        ? Number(previous.changes.opposite_signal_cooldown_bars_by_market.patch_n)
        : null,
    }
    : {};
  const meta = {};
  meta.at_kst = fromLast.at_kst || fromCurrentApplied.at_kst || null;
  meta.at = fromLast.at || fromCurrentApplied.at || null;
  meta.at_ms = Number.isFinite(fromLast.at_ms) ? fromLast.at_ms : (Number.isFinite(fromCurrentApplied.at_ms) ? fromCurrentApplied.at_ms : parseDateMs(meta.at_kst || meta.at));
  meta.source_cycle_id = fromLast.source_cycle_id || fromCurrentApplied.source_cycle_id || null;
  meta.target_cycle_id = fromLast.target_cycle_id || fromCurrentApplied.target_cycle_id || null;
  meta.ev_patch_n = Number.isFinite(fromLast.ev_patch_n) ? fromLast.ev_patch_n : (Number.isFinite(fromCurrentApplied.ev_patch_n) ? fromCurrentApplied.ev_patch_n : null);
  meta.cooldown_patch_n = Number.isFinite(fromLast.cooldown_patch_n) ? fromLast.cooldown_patch_n : (Number.isFinite(fromCurrentApplied.cooldown_patch_n) ? fromCurrentApplied.cooldown_patch_n : null);
  if (!Number.isFinite(meta.at_ms)) return {};
  return meta;
}

function deriveAppliedDocMeta(doc = null) {
  if (!doc || typeof doc !== "object" || doc.applied !== true) return {};
  const atMs = parseDateMs(doc.generated_at_ms || doc.generated_at_kst || doc.generated_at);
  if (!Number.isFinite(atMs)) return {};
  const sourceCycleId = String(
    (doc.inputs && (doc.inputs.plan_cycle_id || doc.inputs.source_cycle_id))
    || doc.source_cycle_id
    || ""
  ).trim() || null;
  const evPatchN = Number.isFinite(Number(doc.changes && doc.changes.ev_gate_tp1_prob_min_by_market && doc.changes.ev_gate_tp1_prob_min_by_market.patch_n))
    ? Number(doc.changes.ev_gate_tp1_prob_min_by_market.patch_n)
    : null;
  const cooldownPatchN = Number.isFinite(Number(doc.changes && doc.changes.opposite_signal_cooldown_bars_by_market && doc.changes.opposite_signal_cooldown_bars_by_market.patch_n))
    ? Number(doc.changes.opposite_signal_cooldown_bars_by_market.patch_n)
    : null;
  return {
    at_kst: String(doc.generated_at_kst || "").trim() || null,
    at: String(doc.generated_at || "").trim() || null,
    at_ms: atMs,
    source_cycle_id: sourceCycleId,
    target_cycle_id: String(doc.target_cycle_id || "").trim() || sourceCycleId,
    ev_patch_n: evPatchN,
    cooldown_patch_n: cooldownPatchN,
  };
}

function findLatestAppliedHistoryMeta() {
  let files = [];
  try {
    files = fs.readdirSync(OPS_DAILY_DIR);
  } catch (_err) {
    return {};
  }
  let best = null;
  for (const name of files) {
    if (!/_server_signal_drift_remediation_apply\.json$/i.test(name)) continue;
    if (/latest\.json$/i.test(name)) continue;
    const filePath = path.join(OPS_DAILY_DIR, name);
    const doc = readJsonRawSafe(filePath, null);
    const meta = deriveAppliedDocMeta(doc);
    if (!Number.isFinite(meta.at_ms)) continue;
    if (!best || meta.at_ms > best.at_ms) {
      best = meta;
    }
  }
  return best || {};
}

function normalizeMap(raw = null, { asInt = false } = {}) {
  let src = raw;
  if (typeof src === "string") {
    const s = String(src || "").trim();
    if (!s) return {};
    try {
      src = JSON.parse(s);
    } catch (_err) {
      return {};
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) return {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(k || "").trim().toUpperCase();
    const n = Number(v);
    if (!key || !Number.isFinite(n)) continue;
    out[key] = asInt ? Math.max(0, Math.round(n)) : n;
  }
  return out;
}

function normalizeUpperList(raw = null) {
  let src = raw;
  if (typeof src === "string") {
    const s = String(src || "").trim();
    if (!s) return [];
    try {
      src = JSON.parse(s);
    } catch (_err) {
      src = s.split(",");
    }
  }
  if (!Array.isArray(src)) return [];
  return Array.from(new Set(
    src
      .map((value) => String(value || "").trim().toUpperCase())
      .filter(Boolean)
  ));
}

function normalizeUpperMapOfLists(raw = null) {
  let src = raw;
  if (typeof src === "string") {
    const s = String(src || "").trim();
    if (!s) return {};
    try {
      src = JSON.parse(s);
    } catch (_err) {
      return {};
    }
  }
  if (!src || typeof src !== "object" || Array.isArray(src)) return {};
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    const key = String(k || "").trim().toUpperCase();
    const rows = normalizeUpperList(v);
    if (!key || rows.length <= 0) continue;
    out[key] = rows;
  }
  return out;
}

function derivePatchState({
  evCurrent = {},
  evPatch = {},
  cooldownCurrent = {},
  cooldownPatch = {},
  otherPolicyWatchCurrent = [],
  otherPolicyWatchPatch = [],
  otherPolicyWatchByReasonCurrent = {},
  otherPolicyWatchByReasonPatch = {},
  releaseExceptions = false,
} = {}) {
  const evNext = releaseExceptions ? {} : { ...evCurrent, ...evPatch };
  const evReportOnlyNext = releaseExceptions ? { ...evPatch } : {};
  const cooldownNext = releaseExceptions ? {} : { ...cooldownCurrent, ...cooldownPatch };
  const otherPolicyWatchByReasonNext = releaseExceptions ? {} : { ...otherPolicyWatchByReasonCurrent };
  if (!releaseExceptions) {
    for (const [reason, markets] of Object.entries(otherPolicyWatchByReasonPatch)) {
      otherPolicyWatchByReasonNext[reason] = Array.from(new Set([
        ...(Array.isArray(otherPolicyWatchByReasonCurrent[reason]) ? otherPolicyWatchByReasonCurrent[reason] : []),
        ...markets,
      ]));
    }
  }
  const otherPolicyWatchNext = releaseExceptions
    ? []
    : Array.from(new Set([
      ...otherPolicyWatchCurrent,
      ...otherPolicyWatchPatch,
      ...Object.values(otherPolicyWatchByReasonNext).flat(),
    ]));

  return {
    evNext,
    evReportOnlyNext,
    cooldownNext,
    otherPolicyWatchNext,
    otherPolicyWatchByReasonNext,
    exception_release_applied: releaseExceptions === true,
    ev_policy_patch_requested_n: Object.keys(evPatch).length,
    ev_policy_patch_applied_n: Object.keys(evNext).length,
    ev_policy_patch_applied: Object.keys(evNext).length > 0,
    ev_policy_patch_report_only_applied_n: Object.keys(evReportOnlyNext).length,
    ev_policy_patch_report_only_applied: Object.keys(evReportOnlyNext).length > 0,
    cooldown_policy_patch_requested_n: Object.keys(cooldownPatch).length,
    cooldown_policy_patch_applied_n: Object.keys(cooldownNext).length,
    cooldown_policy_patch_applied: Object.keys(cooldownNext).length > 0,
    other_server_policy_watch_only_requested_n: otherPolicyWatchPatch.length + Object.keys(otherPolicyWatchByReasonPatch).length,
    other_server_policy_watch_only_applied_n: otherPolicyWatchNext.length,
    other_server_policy_watch_only_applied: otherPolicyWatchNext.length > 0,
  };
}

function readLearningEpochActive(doc = null) {
  if (!doc || typeof doc !== "object") return false;
  const summary = doc.summary && typeof doc.summary === "object" ? doc.summary : doc;
  return summary.learning_epoch_active === true;
}

async function getRawProviderSettings(provider) {
  const db = getFirestore();
  const snap = await db.collection("settings").doc("system").get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const providers = data.providers && typeof data.providers === "object" ? data.providers : {};
  return (providers && typeof providers[provider] === "object") ? providers[provider] : {};
}

async function main() {
  const meta = nowKstMeta();
  const previousApplyDoc = readJsonRawSafe(RESULT_LATEST, null);
  const lastAppliedMeta = (() => {
    const fromLatest = deriveLastAppliedMeta(previousApplyDoc);
    if (Number.isFinite(fromLatest.at_ms)) return fromLatest;
    return findLatestAppliedHistoryMeta();
  })();
  const planDoc = readJsonRawSafe(PLAN_PATH, null);
  const quarantineDoc = readJsonRawSafe(QUARANTINE_LATEST, null);
  const planCycleId = String(
    (planDoc && (planDoc.cycle_id || planDoc.source_cycle_id))
    || (planDoc && planDoc.summary && (planDoc.summary.cycle_id || planDoc.summary.source_cycle_id))
    || ""
  ).trim() || null;
  const patch = planDoc
    && planDoc.recommendations
    && planDoc.recommendations.settings_patch
    && typeof planDoc.recommendations.settings_patch === "object"
    ? planDoc.recommendations.settings_patch
    : {};

  const evPatch = normalizeMap(patch.ev_gate_tp1_prob_min_by_market, { asInt: false });
  const cooldownPatch = normalizeMap(patch.opposite_signal_cooldown_bars_by_market, { asInt: true });
  const watchByFamily = patch.watch_only_review_markets_by_family && typeof patch.watch_only_review_markets_by_family === "object"
    ? patch.watch_only_review_markets_by_family
    : {};
  const watchBySubreason = patch.watch_only_review_markets_by_subreason && typeof patch.watch_only_review_markets_by_subreason === "object"
    ? patch.watch_only_review_markets_by_subreason
    : {};
  const otherPolicyWatchPatch = normalizeUpperList(watchByFamily.OTHER_SERVER_POLICY);
  const otherPolicyWatchByReasonPatch = normalizeUpperMapOfLists(watchBySubreason.OTHER_SERVER_POLICY);
  const learningEpochActive = readLearningEpochActive(quarantineDoc);
  const releaseExceptions = LEARNING_EPOCH_EXCEPTION_RELEASE_ENABLED && learningEpochActive;

  const [sysRes, rawProvider] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getRawProviderSettings(PROVIDER),
  ]);
  const current = sysRes && sysRes.data ? sysRes.data : {};

  const evCurrent = normalizeMap(rawProvider.ev_gate_tp1_prob_min_by_market || current.ev_gate_tp1_prob_min_by_market, { asInt: false });
  const cooldownCurrent = normalizeMap(rawProvider.opposite_signal_cooldown_bars_by_market || current.opposite_signal_cooldown_bars_by_market, { asInt: true });
  const otherPolicyWatchCurrent = normalizeUpperList(
    rawProvider.other_server_policy_watch_only_markets
      || (rawProvider.watch_only_review_markets_by_family && rawProvider.watch_only_review_markets_by_family.OTHER_SERVER_POLICY)
      || current.other_server_policy_watch_only_markets
      || (current.watch_only_review_markets_by_family && current.watch_only_review_markets_by_family.OTHER_SERVER_POLICY)
  );
  const otherPolicyWatchByReasonCurrent = normalizeUpperMapOfLists(
    rawProvider.other_server_policy_watch_only_markets_by_reason
      || (rawProvider.watch_only_review_markets_by_subreason && rawProvider.watch_only_review_markets_by_subreason.OTHER_SERVER_POLICY)
      || current.other_server_policy_watch_only_markets_by_reason
      || (current.watch_only_review_markets_by_subreason && current.watch_only_review_markets_by_subreason.OTHER_SERVER_POLICY)
  );
  const patchState = derivePatchState({
    evCurrent,
    evPatch,
    cooldownCurrent,
    cooldownPatch,
    otherPolicyWatchCurrent,
    otherPolicyWatchPatch,
    otherPolicyWatchByReasonCurrent,
    otherPolicyWatchByReasonPatch,
    releaseExceptions,
  });
  const {
    evNext,
    evReportOnlyNext,
    cooldownNext,
    otherPolicyWatchNext,
    otherPolicyWatchByReasonNext,
    exception_release_applied,
    ev_policy_patch_requested_n,
    ev_policy_patch_applied_n,
    ev_policy_patch_applied,
    ev_policy_patch_report_only_applied_n,
    ev_policy_patch_report_only_applied,
    cooldown_policy_patch_requested_n,
    cooldown_policy_patch_applied_n,
    cooldown_policy_patch_applied,
    other_server_policy_watch_only_requested_n,
    other_server_policy_watch_only_applied_n,
    other_server_policy_watch_only_applied,
  } = patchState;

  const result = {
    ok: true,
    generated_at_kst: meta.kst,
    provider: PROVIDER,
    apply: APPLY,
    inputs: {
      plan_path: PLAN_PATH,
      plan_status: planDoc && planDoc.summary ? planDoc.summary.status : null,
      plan_cycle_id: planCycleId,
      learning_epoch_active: learningEpochActive,
      learning_epoch_exception_release: releaseExceptions,
    },
    exception_release_applied,
    ev_policy_patch_requested_n,
    ev_policy_patch_applied_n,
    ev_policy_patch_applied,
    ev_policy_patch_report_only_applied_n,
    ev_policy_patch_report_only_applied,
    cooldown_policy_patch_requested_n,
    cooldown_policy_patch_applied_n,
    cooldown_policy_patch_applied,
    other_server_policy_watch_only_requested_n,
    other_server_policy_watch_only_applied_n,
    other_server_policy_watch_only_applied,
    changes: {
      ev_gate_tp1_prob_min_by_market: {
        current_n: Object.keys(evCurrent).length,
        patch_n: Object.keys(evPatch).length,
        next_n: Object.keys(evNext).length,
        patch: releaseExceptions ? {} : evPatch,
      },
      ev_gate_tp1_prob_min_by_market_report_only: {
        current_n: Object.keys(normalizeMap(rawProvider.ev_gate_tp1_prob_min_by_market_report_only || current.ev_gate_tp1_prob_min_by_market_report_only, { asInt: false })).length,
        patch_n: Object.keys(evPatch).length,
        next_n: Object.keys(evReportOnlyNext).length,
        patch: releaseExceptions ? evPatch : {},
      },
      opposite_signal_cooldown_bars_by_market: {
        current_n: Object.keys(cooldownCurrent).length,
        patch_n: Object.keys(cooldownPatch).length,
        next_n: Object.keys(cooldownNext).length,
        patch: releaseExceptions ? {} : cooldownPatch,
      },
      other_server_policy_watch_only_markets: {
        current_n: otherPolicyWatchCurrent.length,
        patch_n: otherPolicyWatchPatch.length,
        next_n: otherPolicyWatchNext.length,
        current: otherPolicyWatchCurrent,
        patch: releaseExceptions ? [] : otherPolicyWatchPatch,
        next: otherPolicyWatchNext,
      },
      other_server_policy_watch_only_markets_by_reason: {
        current_n: Object.keys(otherPolicyWatchByReasonCurrent).length,
        patch_n: Object.keys(otherPolicyWatchByReasonPatch).length,
        next_n: Object.keys(otherPolicyWatchByReasonNext).length,
        current: otherPolicyWatchByReasonCurrent,
        patch: releaseExceptions ? {} : otherPolicyWatchByReasonPatch,
        next: otherPolicyWatchByReasonNext,
      },
    },
    effective: {
      other_server_policy_watch_only_markets: otherPolicyWatchCurrent,
      other_server_policy_watch_only_markets_by_reason: otherPolicyWatchByReasonCurrent,
    },
    applied: false,
    last_applied_at_kst: lastAppliedMeta.at_kst || null,
    last_applied_at: lastAppliedMeta.at || null,
    last_applied_at_ms: Number.isFinite(lastAppliedMeta.at_ms) ? lastAppliedMeta.at_ms : null,
    last_applied_source_cycle_id: lastAppliedMeta.source_cycle_id || null,
    last_applied_target_cycle_id: lastAppliedMeta.target_cycle_id || null,
    last_applied_ev_patch_n: Number.isFinite(lastAppliedMeta.ev_patch_n) ? lastAppliedMeta.ev_patch_n : null,
    last_applied_cooldown_patch_n: Number.isFinite(lastAppliedMeta.cooldown_patch_n) ? lastAppliedMeta.cooldown_patch_n : null,
  };

  // Recover last-applied timestamp from provider metadata if latest apply report was overwritten by a NO_CHANGE run.
  if (!Number.isFinite(result.last_applied_at_ms)) {
    const updatedBy = String(rawProvider && rawProvider.updated_by || "").trim();
    const settingsAppliedMs = /apply-server-signal-drift-remediation-plan/i.test(updatedBy)
      ? parseDateMs(rawProvider && rawProvider.updated_at)
      : null;
    if (Number.isFinite(settingsAppliedMs)) {
      result.last_applied_at_ms = settingsAppliedMs;
      result.last_applied_at_kst = toKstString(settingsAppliedMs);
      result.last_applied_at = new Date(settingsAppliedMs).toISOString();
    }
  }

  const hasPatchInput = Object.keys(evPatch).length > 0
    || Object.keys(cooldownPatch).length > 0
    || otherPolicyWatchPatch.length > 0
    || Object.keys(otherPolicyWatchByReasonPatch).length > 0;
  const hasCurrentException = Object.keys(evCurrent).length > 0
    || Object.keys(cooldownCurrent).length > 0
    || otherPolicyWatchCurrent.length > 0
    || Object.keys(otherPolicyWatchByReasonCurrent).length > 0;

  if (APPLY && (hasPatchInput || (releaseExceptions && hasCurrentException))) {
    const db = getFirestore();
    const ref = db.collection("settings").doc("system");
    const prefix = `providers.${PROVIDER}`;
    const updatedAt = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        tx.set(ref, { providers: { [PROVIDER]: { provider: PROVIDER } } }, { merge: true });
      }
      tx.update(ref, {
        [`${prefix}.provider`]: PROVIDER,
        [`${prefix}.updated_at`]: updatedAt,
        [`${prefix}.updated_by`]: "apply-server-signal-drift-remediation-plan",
        [`${prefix}.ev_gate_tp1_prob_min_by_market`]: evNext,
        [`${prefix}.ev_gate_tp1_prob_min_by_market_report_only`]: evReportOnlyNext,
        [`${prefix}.ev_gate_tp1_prob_min_by_market_report_only_enabled`]: Object.keys(evReportOnlyNext).length > 0,
        [`${prefix}.opposite_signal_cooldown_bars_by_market`]: cooldownNext,
        [`${prefix}.other_server_policy_watch_only_markets`]: otherPolicyWatchNext,
        [`${prefix}.other_server_policy_watch_only_markets_by_reason`]: otherPolicyWatchByReasonNext,
        [`${prefix}.watch_only_review_markets_by_family.OTHER_SERVER_POLICY`]: otherPolicyWatchNext,
        [`${prefix}.watch_only_review_markets_by_subreason.OTHER_SERVER_POLICY`]: otherPolicyWatchByReasonNext,
        updated_at: updatedAt,
      });
    });
    invalidateSettingsCache("system");
    result.applied = true;
    result.effective.other_server_policy_watch_only_markets = otherPolicyWatchNext;
    result.effective.other_server_policy_watch_only_markets_by_reason = otherPolicyWatchByReasonNext;
    result.last_applied_at_kst = meta.kst;
    result.last_applied_at = new Date(meta.nowMs).toISOString();
    result.last_applied_at_ms = meta.nowMs;
    result.last_applied_source_cycle_id = planCycleId;
    result.last_applied_target_cycle_id = planCycleId;
    result.last_applied_ev_patch_n = releaseExceptions ? Object.keys(evCurrent).length : Object.keys(evPatch).length;
    result.last_applied_cooldown_patch_n = releaseExceptions ? Object.keys(cooldownCurrent).length : Object.keys(cooldownPatch).length;
  }

  writeJson(RESULT_LATEST, result);
    console.log(JSON.stringify({
      ok: true,
      apply: APPLY,
      applied: result.applied,
      result_path: RESULT_LATEST,
      learning_epoch_exception_release: releaseExceptions,
      ev_patch_n: releaseExceptions ? Object.keys(evCurrent).length : Object.keys(evPatch).length,
      ev_patch_report_only_n: Object.keys(evReportOnlyNext).length,
      cooldown_patch_n: releaseExceptions ? Object.keys(cooldownCurrent).length : Object.keys(cooldownPatch).length,
      other_server_policy_watch_only_patch_n: releaseExceptions ? otherPolicyWatchCurrent.length : otherPolicyWatchPatch.length,
      other_server_policy_watch_only_reason_patch_n: releaseExceptions ? Object.keys(otherPolicyWatchByReasonCurrent).length : Object.keys(otherPolicyWatchByReasonPatch).length,
    }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("APPLY_SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    derivePatchState,
  },
};
