#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveWeightTuningPlan } = require("../src/utils/bestSelfEvolutionWeightTuning");

loadLocalEnv();

const INPUTS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const suggestions = Array.isArray(report.suggestions) ? report.suggestions : [];
  const lines = [
    "# BEST Self-Evolution Weight Tuning",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    "",
    "## Summary",
    `- advisory_mode: ${summary.advisory_mode || "N/A"}`,
    `- suggestion_n: ${summary.suggestion_n ?? 0} / dominant_axis: ${summary.dominant_axis || "N/A"}`,
    `- count/replacement/memory/canary block: ${summary.count_guard_blocked ? "YES" : "NO"} / ${summary.replacement_guard_blocked ? "YES" : "NO"} / ${summary.memory_blocked ? "YES" : "NO"} / ${summary.canary_blocked ? "YES" : "NO"}`,
    "",
    "## Suggestions",
  ];
  if (!suggestions.length) {
    lines.push("- none");
  } else {
    for (const row of suggestions.slice(0, 20)) {
      lines.push(`- ${row.axis}: ${row.direction} ${row.delta} / ${row.reason}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const supervisor = readJsonRawSafe(INPUTS.objectiveSupervisor, null) || {};
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    inputs: { ...INPUTS },
    ...deriveWeightTuningPlan({
      objective: supervisor.self_evolution_objective,
      attribution: supervisor.self_evolution_attribution,
      canary: supervisor.self_evolution_canary,
      memoryLedger: supervisor.self_evolution_memory,
    }),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_weight_tuning.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_weight_tuning.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_weight_tuning_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_weight_tuning_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({ ok: true, json: jsonPath, markdown: mdPath, latest_json: latestJsonPath, latest_markdown: latestMdPath }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_WEIGHT_TUNING_REPORT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    renderMarkdown,
  },
};
