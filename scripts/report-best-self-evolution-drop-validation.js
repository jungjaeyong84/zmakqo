#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  buildReasonRows,
  buildFamilyRows,
  deriveRecommendedActions,
} = require("../src/utils/dropValidation");

const SIGNAL_DROPS_CACHE_PATH = path.join(OPS_DAILY_DIR, "cache", "firestore_recent", "signals_dropped.json");
const WEEKLY_GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(value, digits = 2) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function buildReport({ governance = {}, dropsWrapper = {}, nowMeta = nowKstMeta(), cycleMeta = null } = {}) {
  const governanceRaw = governance && governance.raw && typeof governance.raw === "object" ? governance.raw : governance;
  const dropCounterfactual = governanceRaw
    && governanceRaw.current
    && governanceRaw.current.drop_counterfactual
    && typeof governanceRaw.current.drop_counterfactual === "object"
      ? governanceRaw.current.drop_counterfactual
      : {};
  const droppedDocs = Array.isArray(dropsWrapper.docs) ? dropsWrapper.docs : [];
  const reasonRows = buildReasonRows(dropCounterfactual);
  const familyRows = buildFamilyRows(reasonRows, dropCounterfactual.by_reason_market, droppedDocs);
  const recommendedActions = deriveRecommendedActions(familyRows);
  const rescueFamilies = familyRows.filter((row) => row.verdict === "FAVOR_RESCUE");
  const keepFamilies = familyRows.filter((row) => row.verdict === "KEEP_DROP");
  const mixedFamilies = familyRows.filter((row) => row.verdict === "MIXED");
  const topRescueFamily = rescueFamilies[0] || null;
  const dominantFamily = familyRows[0] || null;
  const status = topRescueFamily
    ? "ACTIONABLE_RESCUE_REVIEW"
    : (mixedFamilies.length ? "MIXED_REVIEW" : (keepFamilies.length ? "KEEP_DROP_CONFIRMED" : "HOLD_SAMPLE"));

  return {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta && cycleMeta.cycle_id ? cycleMeta.cycle_id : null,
    generation_id: cycleMeta && cycleMeta.generation_id ? cycleMeta.generation_id : null,
    summary: {
      status,
      recent_drop_n: droppedDocs.length,
      matured_reason_n: reasonRows.reduce((sum, row) => sum + (row.matured_n || 0), 0),
      family_n: familyRows.length,
      rescue_family_n: rescueFamilies.length,
      keep_drop_family_n: keepFamilies.length,
      mixed_family_n: mixedFamilies.length,
      dominant_family: dominantFamily ? dominantFamily.family : null,
      dominant_verdict: dominantFamily ? dominantFamily.verdict : null,
      top_rescue_family: topRescueFamily ? topRescueFamily.family : null,
      top_rescue_reason: topRescueFamily ? topRescueFamily.top_reason : null,
      top_rescue_market: topRescueFamily ? topRescueFamily.top_market : null,
      top_rescue_avg_horizon_ret_net: topRescueFamily ? topRescueFamily.avg_horizon_ret_net : null,
      top_rescue_tp1_first_rate: topRescueFamily ? topRescueFamily.tp1_first_rate : null,
      top_rescue_sl_first_rate: topRescueFamily ? topRescueFamily.sl_first_rate : null,
      recommended_actions: recommendedActions,
      next_actions: recommendedActions.map((row) => `DROP_VALIDATION_ACTION: ${row.family} -> ${row.action}`),
      cache_meta: {
        path: SIGNAL_DROPS_CACHE_PATH,
        updated_at: dropsWrapper.updated_at || null,
        latest_created_at: dropsWrapper.latest_created_at || null,
      },
      governance_meta: {
        path: WEEKLY_GOVERNANCE_LATEST_PATH,
        generated_at_kst: governanceRaw.generated_at_kst || null,
      },
    },
    by_family: familyRows,
    by_reason: reasonRows
      .sort((a, b) => {
        const order = { FAVOR_RESCUE: 0, MIXED: 1, KEEP_DROP: 2, HOLD_SAMPLE: 3 };
        return (order[a.verdict] ?? 9) - (order[b.verdict] ?? 9)
          || b.matured_n - a.matured_n
          || a.reason.localeCompare(b.reason);
      })
      .slice(0, 16),
    recent_examples: droppedDocs.slice(0, 20).map((row) => ({
      created_at: row.created_at || null,
      market: String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || "UNKNOWN",
      event: String(row.event || "").trim().toUpperCase() || "UNKNOWN",
      reason: String(row.drop_reason_code || row.reason || "").trim().toUpperCase() || "UNKNOWN",
    })),
  };
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Drop Validation",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- recent_drop_n: ${summary.recent_drop_n ?? 0}`,
    `- matured_reason_n: ${summary.matured_reason_n ?? 0}`,
    `- dominant_family: ${summary.dominant_family || "N/A"} / ${summary.dominant_verdict || "N/A"}`,
    `- top_rescue: ${summary.top_rescue_family || "N/A"} / ${summary.top_rescue_reason || "N/A"} / ${summary.top_rescue_market || "N/A"} / avg_ret ${signedPct(summary.top_rescue_avg_horizon_ret_net)} / tp1 ${pct(summary.top_rescue_tp1_first_rate)} / sl ${pct(summary.top_rescue_sl_first_rate)}`,
    `- next_actions: ${Array.isArray(summary.next_actions) && summary.next_actions.length ? summary.next_actions.join(" | ") : "none"}`,
    "",
    "## By Family",
    ...((Array.isArray(report.by_family) && report.by_family.length)
      ? report.by_family.map((row) => `- ${row.family}: ${row.verdict} / matured ${row.matured_n} / tp1 ${pct(row.tp1_first_rate)} / sl ${pct(row.sl_first_rate)} / horizon_win ${pct(row.horizon_pos_rate)} / avg_ret ${signedPct(row.avg_horizon_ret_net)} / top_reason ${row.top_reason || "N/A"} / top_market ${row.top_market || "N/A"}`)
      : ["- none"]),
    "",
    "## By Reason",
    ...((Array.isArray(report.by_reason) && report.by_reason.length)
      ? report.by_reason.map((row) => `- ${row.reason}: ${row.verdict} / family ${row.family} / matured ${row.matured_n} / tp1 ${pct(row.tp1_first_rate)} / sl ${pct(row.sl_first_rate)} / horizon_win ${pct(row.horizon_pos_rate)} / avg_ret ${signedPct(row.avg_horizon_ret_net)}`)
      : ["- none"]),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const governance = readJsonRawSafe(WEEKLY_GOVERNANCE_LATEST_PATH, {}) || {};
  const dropsWrapper = readJsonRawSafe(SIGNAL_DROPS_CACHE_PATH, {}) || {};
  const report = buildReport({ governance, dropsWrapper, nowMeta, cycleMeta });
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_drop_validation.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_drop_validation.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_drop_validation_latest.md");
  const selfEvolutionLatestJson = selfEvolutionSnapshotLatestPath("drop_validation_latest.json");
  const selfEvolutionLatestMd = selfEvolutionSnapshotLatestPath("drop_validation_latest.md");
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  if (selfEvolutionLatestJson) copySelfEvolutionLatest(jsonPath, selfEvolutionLatestJson);
  if (selfEvolutionLatestMd) copySelfEvolutionLatest(mdPath, selfEvolutionLatestMd);
  console.log(JSON.stringify({
    ok: true,
    cycle_id: report.cycle_id,
    status: report.summary && report.summary.status,
    top_rescue_family: report.summary && report.summary.top_rescue_family,
    latest_json: latestJsonPath,
    latest_markdown: latestMdPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_DROP_VALIDATION_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    buildReport,
    renderMarkdown,
  },
};
