#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { isPrimaryLongShortEvent } = require("../src/utils/liveEntryTaxonomy");

loadLocalEnv();

const INPUTS = Object.freeze({
  dataset: path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
});

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ratio(num, den) {
  const n = Number(num);
  const d = Number(den);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return n / d;
}

function mean(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((acc, value) => acc + value, 0) / nums.length;
}

function featureObj(row = {}) {
  return (row.features_json && typeof row.features_json === "object")
    ? row.features_json
    : ((row.features && typeof row.features === "object") ? row.features : {});
}

function normalizeSourceMode(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "PINE_PRIMARY" || raw === "SERVER_PRIMARY" || raw === "SERVER_SHADOW") return raw;
  return "UNKNOWN";
}

function qualifiesRow(row = {}) {
  return isPrimaryLongShortEvent(row && row.event);
}

function isExecutedLike(row = {}) {
  const kind = String(row && row.source_row_type || "").trim().toUpperCase();
  return kind === "EXECUTED" || kind === "PARTIAL" || kind === "FALLBACK";
}

function countBy(items = [], keyFn) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = String(keyFn(item) || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key));
}

function buildRollbackTriggers({ pineShadowObservedN, pineShadowDisagreementRate, realizedN, avgRetNet, winRate } = {}) {
  const triggers = [];
  if (Number(pineShadowObservedN || 0) >= 2 && Number(pineShadowDisagreementRate || 0) > 0.15) {
    triggers.push("PINE_SHADOW_DISAGREEMENT");
  }
  if (Number(realizedN || 0) >= 2 && Number.isFinite(avgRetNet) && avgRetNet < 0) {
    triggers.push("NEGATIVE_AVG_RET");
  }
  if (Number(realizedN || 0) >= 3 && Number.isFinite(winRate) && winRate < 0.5) {
    triggers.push("LOW_WIN_RATE");
  }
  return triggers;
}

function buildMarketRow(rows = [], market = "UNKNOWN") {
  const executed = rows.filter(isExecutedLike);
  const realized = executed.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const pineObserved = rows.filter((row) => featureObj(row).pine_shadow_parity_match !== null && featureObj(row).pine_shadow_parity_match !== undefined);
  const pineDisagreement = pineObserved.filter((row) => featureObj(row).pine_shadow_parity_match === false);
  const winRate = ratio(realized.filter((row) => Number(row.realized_ret_net) > 0).length, realized.length);
  const avgRetNet = mean(realized.map((row) => row.realized_ret_net));
  const rollbackTriggers = buildRollbackTriggers({
    pineShadowObservedN: pineObserved.length,
    pineShadowDisagreementRate: ratio(pineDisagreement.length, pineObserved.length),
    realizedN: realized.length,
    avgRetNet,
    winRate,
  });
  return {
    market,
    row_n: rows.length,
    executed_n: executed.length,
    realized_n: realized.length,
    pine_shadow_observed_n: pineObserved.length,
    pine_shadow_disagreement_n: pineDisagreement.length,
    pine_shadow_disagreement_rate: ratio(pineDisagreement.length, pineObserved.length),
    win_rate: winRate,
    avg_ret_net: avgRetNet,
    rollback_trigger_n: rollbackTriggers.length,
    rollback_triggers: rollbackTriggers,
    source_row_type_breakdown: countBy(rows, (row) => row.source_row_type),
  };
}

function deriveServerPrimaryCanary({ dataset = null, stageAutopilot = null } = {}) {
  const raw = dataset && typeof dataset === "object" ? dataset : {};
  const stageRaw = stageAutopilot && typeof stageAutopilot === "object"
    ? ((stageAutopilot.raw && typeof stageAutopilot.raw === "object") ? stageAutopilot.raw : stageAutopilot)
    : {};
  const allRows = Array.isArray(raw.rows) ? raw.rows : [];
  const longShortRows = allRows.filter(qualifiesRow);
  const scoped = longShortRows
    .filter((row) => normalizeSourceMode(featureObj(row).canonical_engine_source_mode_effective) === "SERVER_PRIMARY");
  const executed = scoped.filter(isExecutedLike);
  const realized = executed.filter((row) => Number.isFinite(toNum(row.realized_ret_net)));
  const pineObserved = scoped.filter((row) => featureObj(row).pine_shadow_parity_match !== null && featureObj(row).pine_shadow_parity_match !== undefined);
  const pineDisagreement = pineObserved.filter((row) => featureObj(row).pine_shadow_parity_match === false);
  const sourceModeStage = Array.isArray(stageRaw.stage_rows)
    ? stageRaw.stage_rows.find((row) => String(row && row.stage || "").trim().toUpperCase() === "SOURCE_MODE")
    : null;
  const configuredServerPrimaryMarkets = Array.isArray(sourceModeStage && sourceModeStage.current_source_modes)
    ? sourceModeStage.current_source_modes
      .filter((row) => normalizeSourceMode(row && row.source_mode) === "SERVER_PRIMARY")
      .map((row) => String(row && row.market || "").trim().toUpperCase())
      .filter(Boolean)
    : [];
  const acceptanceMinExecuted = Math.max(2, Number(process.env.SELF_EVOLUTION_SERVER_PRIMARY_ACCEPTANCE_MIN_EXECUTED || 2));
  const markets = Array.from(new Set(scoped.map((row) => String(row.market || row.symbol_or_pair_id || "UNKNOWN").trim().toUpperCase() || "UNKNOWN")))
    .sort((a, b) => a.localeCompare(b))
    .map((market) => buildMarketRow(scoped.filter((row) => String(row.market || row.symbol_or_pair_id || "").trim().toUpperCase() === market), market))
    .sort((a, b) => (b.executed_n - a.executed_n) || a.market.localeCompare(b.market));
  const summaryRollbackTriggers = markets.filter((row) => row.rollback_trigger_n > 0);
  const applyPass = markets.length > 0 ? summaryRollbackTriggers.length === 0 : null;
  const executedN = executed.length;
  let acceptanceReason = "NO_SERVER_PRIMARY_ROWS";
  if (scoped.length === 0 && configuredServerPrimaryMarkets.length > 0) acceptanceReason = "NO_SERVER_PRIMARY_ROWS_AFTER_SWITCH";
  else if (scoped.length === 0) acceptanceReason = "NO_SERVER_PRIMARY_ROWS";
  else if (applyPass === false) acceptanceReason = "SERVER_PRIMARY_CANARY_BLOCK";
  else if (executedN < acceptanceMinExecuted) acceptanceReason = "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT";
  else if (applyPass === true) acceptanceReason = "SERVER_PRIMARY_ACCEPTANCE_READY";
  return {
    summary: {
      row_n: scoped.length,
      server_primary_markets_n: markets.length,
      server_primary_executed_n: executed.length,
      server_primary_realized_n: realized.length,
      pine_shadow_observed_n: pineObserved.length,
      pine_shadow_disagreement_n: pineDisagreement.length,
      pine_shadow_disagreement_rate: ratio(pineDisagreement.length, pineObserved.length),
      server_primary_win_rate: ratio(realized.filter((row) => Number(row.realized_ret_net) > 0).length, realized.length),
      server_primary_avg_ret_net: mean(realized.map((row) => row.realized_ret_net)),
      rollback_trigger_n: summaryRollbackTriggers.length,
      rollback_trigger_markets: summaryRollbackTriggers.map((row) => row.market),
      configured_server_primary_markets_n: configuredServerPrimaryMarkets.length,
      configured_server_primary_markets: configuredServerPrimaryMarkets,
      apply_pass: applyPass,
      acceptance_min_executed: acceptanceMinExecuted,
      acceptance_ready: applyPass === true && executedN >= acceptanceMinExecuted,
      acceptance_reason: acceptanceReason,
      by_source_mode: countBy(longShortRows, (row) => normalizeSourceMode(featureObj(row).canonical_engine_source_mode_effective)),
    },
    rows: markets,
  };
}

function pct(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(2)}%`;
}

function signedPct(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const lines = [
    "# BEST Self-Evolution Server-Primary Canary",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- rows / markets: ${summary.row_n || 0} / ${summary.server_primary_markets_n || 0}`,
    `- configured server-primary markets: ${summary.configured_server_primary_markets_n || 0} / ${Array.isArray(summary.configured_server_primary_markets) && summary.configured_server_primary_markets.length ? summary.configured_server_primary_markets.join(", ") : "none"}`,
    `- executed / realized: ${summary.server_primary_executed_n || 0} / ${summary.server_primary_realized_n || 0}`,
    `- pine shadow observed / disagreement: ${summary.pine_shadow_observed_n || 0} / ${summary.pine_shadow_disagreement_n || 0} (${pct(summary.pine_shadow_disagreement_rate)})`,
    `- win_rate / avg_ret_net: ${pct(summary.server_primary_win_rate)} / ${signedPct(summary.server_primary_avg_ret_net)}`,
    `- rollback triggers: ${summary.rollback_trigger_n || 0} / ${Array.isArray(summary.rollback_trigger_markets) && summary.rollback_trigger_markets.length ? summary.rollback_trigger_markets.join(", ") : "none"}`,
    `- apply_pass: ${summary.apply_pass == null ? "N/A" : (summary.apply_pass ? "YES" : "NO")}`,
    `- acceptance: ${summary.acceptance_ready ? "READY" : "PENDING"} / min ${summary.acceptance_min_executed ?? "N/A"} / ${summary.acceptance_reason || "N/A"}`,
    `- source_mode breakdown: ${Array.isArray(summary.by_source_mode) && summary.by_source_mode.length ? summary.by_source_mode.map((row) => `${row.key}=${row.count}`).join(", ") : "none"}`,
    "",
    "## Markets",
  ];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows) {
      lines.push(`- ${row.market}: executed=${row.executed_n} / realized=${row.realized_n} / pine_shadow=${row.pine_shadow_disagreement_n}/${row.pine_shadow_observed_n} (${pct(row.pine_shadow_disagreement_rate)}) / win=${pct(row.win_rate)} / avg_ret=${signedPct(row.avg_ret_net)} / rollback=${row.rollback_trigger_n ? row.rollback_triggers.join("|") : "none"}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const report = deriveServerPrimaryCanary({
    dataset: readJsonRawSafe(INPUTS.dataset, null),
    stageAutopilot: readJsonRawSafe(INPUTS.stageAutopilot, null),
  });
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    summary: report.summary,
    rows: report.rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_primary_canary.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_server_primary_canary.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copySelfEvolutionLatest(jsonPath, latestJsonPath);
  copySelfEvolutionLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_SERVER_PRIMARY_CANARY_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    deriveServerPrimaryCanary,
    renderMarkdown,
  },
};
