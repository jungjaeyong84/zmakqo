#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
  sendKoreanTelegramSummary,
} = require("./lib/automation-utils");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { getExchangeSettingsForProvider } = require("../src/utils/exchangeSettings");
const { getFirestore } = require("../src/storage/firestore");
const { deriveServerSignalRuntime } = require("../src/utils/serverSignalRuntime");
const { getLiveExecutionPolicyRuntimeConfig } = require("../src/utils/liveExecutionPolicy");
const { __test: liveStateSelfHealTest } = require("../src/services/binanceLiveStateSelfHeal");
const { buildBinanceFillProjectionAudit } = require("../src/services/binanceFillProjectionAudit");

loadLocalEnv();

const PROVIDER = String(process.env.SERVER_SIGNAL_RUNTIME_PROVIDER || "BINANCEFUT").trim().toUpperCase() || "BINANCEFUT";
const WATCHDOG_PATH = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json");
const OBJECTIVE_SUPERVISOR_PATH = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const PARITY_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");

function readCycleId(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  const candidates = [
    doc.cycle_id,
    doc.source_cycle_id,
    doc.generation_id,
    doc.raw && doc.raw.cycle_id,
    doc.raw && doc.raw.source_cycle_id,
    doc.raw && doc.raw.generation_id,
    doc.summary && doc.summary.cycle_id,
  ];
  for (const value of candidates) {
    const s = String(value || "").trim();
    if (s) return s;
  }
  return null;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const status = report.current_status || {};
  const lines = [
    "# Server Signal Runtime",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    `- runtime_status: ${summary.runtime_status || "N/A"}`,
    `- source_mode: ${summary.canonical_engine_source_mode || "N/A"}`,
    `- exec_tf: ${summary.exec_tf || "N/A"}`,
    `- market_count: ${summary.market_count != null ? summary.market_count : "N/A"}`,
    `- scheduler: ${summary.scheduler_status || "N/A"} / watchdog=${summary.watchdog_verdict || "N/A"}`,
    `- cycle_id: ${summary.cycle_id || "N/A"}`,
    `- watchdog_generated_at_kst: ${summary.watchdog_generated_at_kst || "N/A"}`,
    `- live_exec_policy: mode=${summary.live_execution_policy_mode || "N/A"} / enabled=${summary.live_execution_policy_enabled ? "YES" : "NO"} / plan_apply=${summary.live_execution_policy_policy_plan_apply ? "YES" : "NO"} / quarantine_hard_block=${summary.live_execution_policy_quarantine_hard_block ? "YES" : "NO"} / quality_hard_block=${summary.live_execution_policy_quality_hard_block ? "YES" : "NO"}`,
    `- live_state_health: active=${summary.binance_live_state_active_position_n ?? "N/A"} / out_of_sync=${summary.binance_live_state_projection_out_of_sync_n ?? "N/A"} / self_heal_required=${summary.binance_live_state_self_heal_required_n ?? "N/A"} / stop_missing=${summary.binance_live_state_native_stop_missing_n ?? "N/A"}`,
    `- fill_projection_audit: issue=${summary.binance_fill_projection_audit_issue_n ?? "N/A"} / legacy_partial_tp_missing=${summary.binance_fill_projection_legacy_partial_tp_missing_n ?? summary.binance_fill_projection_tp0_missing_n ?? "N/A"} / tp1_missing=${summary.binance_fill_projection_tp1_missing_n ?? "N/A"} / tp1_trail_inactive=${summary.binance_fill_projection_tp1_trail_inactive_n ?? "N/A"} / native_not_ok=${summary.binance_fill_projection_native_protection_not_ok_n ?? "N/A"}`,
    `- ev_report_only_patch: enabled=${summary.ev_gate_tp1_prob_min_by_market_report_only_enabled ? "YES" : "NO"} / report_only_n=${summary.ev_gate_tp1_prob_min_by_market_report_only_n ?? "N/A"} / direct_n=${summary.ev_gate_tp1_prob_min_by_market_n ?? "N/A"}`,
    `- pine_shadow_transition: ${summary.pine_shadow_transition_status || "N/A"} / ${summary.pine_shadow_transition_progress_pct != null ? `${summary.pine_shadow_transition_progress_pct}%` : "N/A"}`,
    "",
    "## Current Status",
    `- scheduler_enabled: ${status.scheduler_enabled ? "YES" : "NO"} / interval=${status.scheduler_interval_sec != null ? status.scheduler_interval_sec : "N/A"}s`,
    `- canonical_engine_shadow_enabled: ${status.canonical_engine_shadow_enabled ? "YES" : "NO"}`,
    `- execution_shadow_policy: ${status.execution_shadow_policy || "N/A"}`,
    `- pine_ingress_shadow_only: ${status.pine_ingress_shadow_only ? "YES" : "NO"}`,
    `- live_execution_policy.profile: ${status.live_execution_policy && status.live_execution_policy.policy_profile ? status.live_execution_policy.policy_profile : "N/A"}`,
    `- live_execution_policy.flags: ${status.live_execution_policy ? `enabled=${status.live_execution_policy.enabled ? "YES" : "NO"}, plan_enabled=${status.live_execution_policy.policy_plan_enabled ? "YES" : "NO"}, plan_apply=${status.live_execution_policy.policy_plan_apply ? "YES" : "NO"}, watch_only_block=${status.live_execution_policy.policy_plan_watch_only_block ? "YES" : "NO"}, hold_block=${status.live_execution_policy.policy_plan_hold_block ? "YES" : "NO"}, mode=${status.live_execution_policy.effective_mode || "N/A"}` : "N/A"}`,
    `- tf_allowlist: ${Array.isArray(status.tf_allowlist) && status.tf_allowlist.length ? status.tf_allowlist.join(", ") : "N/A"}`,
    `- markets_preview: ${Array.isArray(status.markets_preview) && status.markets_preview.length ? status.markets_preview.join(", ") : "N/A"}`,
  ];
  return `${lines.join("\n")}\n`;
}

function buildRuntimeIntegrityAlertSections(report = {}) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const issueN = Number(summary.binance_fill_projection_audit_issue_n || 0);
  const outOfSyncN = Number(summary.binance_live_state_projection_out_of_sync_n || 0);
  const selfHealRequiredN = Number(summary.binance_live_state_self_heal_required_n || 0);
  const stopMissingN = Number(summary.binance_live_state_native_stop_missing_n || 0);
  if (!(issueN > 0 || outOfSyncN > 0 || selfHealRequiredN > 0 || stopMissingN > 0)) return [];
  return [
    {
      header: "Binance Live State",
      lines: [
        `active=${summary.binance_live_state_active_position_n ?? 0}`,
        `out_of_sync=${outOfSyncN}`,
        `self_heal_required=${selfHealRequiredN}`,
        `stop_missing=${stopMissingN}`,
      ],
    },
    {
      header: "Fill Projection Audit",
      lines: [
        `issue=${issueN}`,
        `legacy_partial_tp_missing=${summary.binance_fill_projection_legacy_partial_tp_missing_n ?? summary.binance_fill_projection_tp0_missing_n ?? 0}`,
        `tp1_missing=${summary.binance_fill_projection_tp1_missing_n ?? 0}`,
        `tp1_trail_inactive=${summary.binance_fill_projection_tp1_trail_inactive_n ?? 0}`,
        `native_not_ok=${summary.binance_fill_projection_native_protection_not_ok_n ?? 0}`,
      ],
    },
  ];
}

async function maybeSendRuntimeIntegrityAlert(report = {}) {
  const sections = buildRuntimeIntegrityAlertSections(report);
  if (!sections.length) return { ok: true, skipped: true, reason: "NO_RUNTIME_ISSUES" };
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  return sendKoreanTelegramSummary({
    title: "[변경] 서버 실체결/프로젝션 무결성 경고",
    severity: "WARN",
    provider: PROVIDER,
    dedupeKey: `server-signal-runtime-integrity:${String(report.provider || PROVIDER)}`,
    dedupeWindowSec: 1800,
    dedupeFingerprint: {
      issue_n: Number(summary.binance_fill_projection_audit_issue_n || 0),
      out_of_sync_n: Number(summary.binance_live_state_projection_out_of_sync_n || 0),
      self_heal_required_n: Number(summary.binance_live_state_self_heal_required_n || 0),
      stop_missing_n: Number(summary.binance_live_state_native_stop_missing_n || 0),
      issue_by_code: summary.binance_fill_projection_issue_by_code || {},
    },
    sections,
  });
}

function isActivePaperPosition(pos = {}) {
  const state = String(pos.position_state || pos.state || "").trim().toUpperCase();
  const sizePct = Number(pos.size_pct);
  const qtyBase = Number(pos.qty_base);
  const hasSize = (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
  return hasSize && state !== "FLAT";
}

async function collectLivePositionHealth(provider = "BINANCEFUT") {
  const db = getFirestore();
  const [snap, fillSnap] = await Promise.all([
    db.collection("positions_paper")
      .where("exchange", "==", String(provider || "").toUpperCase())
      .limit(200)
      .get(),
    db.collection("fills_paper")
      .orderBy("created_at", "desc")
      .limit(3000)
      .get(),
  ]);

  const rows = [];
  snap.forEach((doc) => rows.push(doc.data() || {}));
  const fills = [];
  fillSnap.forEach((doc) => fills.push(doc.data() || {}));
  const activeRows = rows.filter((row) => isActivePaperPosition(row));
  const invariantCounts = {};
  let outOfSync = 0;
  let selfHealRequired = 0;
  let nativeStopMissing = 0;
  let trailWithoutTp1 = 0;
  let tp1DoneWithTpOrder = 0;

  for (const row of activeRows) {
    const meta = row && typeof row.meta === "object" ? row.meta : {};
    if (meta.exchange_projection_in_sync === false) outOfSync += 1;
    if (typeof liveStateSelfHealTest.shouldRepairBinanceLivePosition === "function"
      && liveStateSelfHealTest.shouldRepairBinanceLivePosition(meta)) {
      selfHealRequired += 1;
    }
    const invariants = Array.isArray(meta.exchange_projection_invariants) ? meta.exchange_projection_invariants : [];
    for (const key of invariants) {
      const label = String(key || "").trim();
      if (!label) continue;
      invariantCounts[label] = (invariantCounts[label] || 0) + 1;
    }
    nativeStopMissing += Number(invariants.includes("NATIVE_STOP_MISSING"));
    trailWithoutTp1 += Number(invariants.includes("TRAIL_WITHOUT_TP1"));
    tp1DoneWithTpOrder += Number(invariants.includes("TP1_DONE_WITH_TP_ORDER"));
  }

  const fillProjectionAudit = buildBinanceFillProjectionAudit({
    positions: activeRows,
    fills,
    nowMs: Date.now(),
  });

  return {
    active_position_n: activeRows.length,
    projection_out_of_sync_n: outOfSync,
    self_heal_required_n: selfHealRequired,
    native_stop_missing_n: nativeStopMissing,
    trail_without_tp1_n: trailWithoutTp1,
    tp1_done_with_tp_order_n: tp1DoneWithTpOrder,
    invariant_counts: invariantCounts,
    fill_projection_audit_issue_n: fillProjectionAudit.issue_n || 0,
    fill_projection_legacy_partial_tp_missing_n: fillProjectionAudit.legacy_partial_tp_fill_projection_missing_n || fillProjectionAudit.tp0_fill_projection_missing_n || 0,
    fill_projection_tp0_missing_n: fillProjectionAudit.tp0_fill_projection_missing_n || 0,
    fill_projection_tp1_missing_n: fillProjectionAudit.tp1_fill_projection_missing_n || 0,
    fill_projection_tp1_trail_inactive_n: fillProjectionAudit.tp1_fill_trail_inactive_n || 0,
    fill_projection_native_protection_not_ok_n: fillProjectionAudit.native_protection_not_ok_n || 0,
    fill_projection_issue_by_code: fillProjectionAudit.issue_by_code || {},
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const [systemRes, exchangeSettings, livePositionHealth] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getExchangeSettingsForProvider(PROVIDER, 0),
    collectLivePositionHealth(PROVIDER),
  ]);
  const objectiveSupervisor = readJsonRawSafe(OBJECTIVE_SUPERVISOR_PATH, null);
  const parity = readJsonRawSafe(PARITY_PATH, null);
  const cycleId = readCycleId(parity) || readCycleId(objectiveSupervisor);
  const report = deriveServerSignalRuntime({
    provider: PROVIDER,
    systemSettings: systemRes && systemRes.data ? systemRes.data : {},
    exchangeSettings: exchangeSettings || {},
    watchdog: readJsonRawSafe(WATCHDOG_PATH, null),
    livePolicyConfig: getLiveExecutionPolicyRuntimeConfig(),
    cycleId,
    livePositionHealth,
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      provider: PROVIDER,
      watchdog: WATCHDOG_PATH,
      objective_supervisor: OBJECTIVE_SUPERVISOR_PATH,
      parity: PARITY_PATH,
    },
    ...report,
  };

  const datedJson = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_runtime.json`);
  const datedMd = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_server_signal_runtime.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.md");
  writeJson(datedJson, payload);
  writeText(datedMd, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  await maybeSendRuntimeIntegrityAlert(payload);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_markdown: latestMd }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("SERVER_SIGNAL_RUNTIME_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    buildRuntimeIntegrityAlertSections,
  },
};
