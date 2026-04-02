#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { CHARTER_EXPECTATIONS } = require("../src/config/charterExpectations");
const { checkCharterConsistency } = require("../src/services/charterCheck");
const { getExitRulesForExchange } = require("../src/engine/signalEngine");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  ensureDir,
  nowKstMeta,
  readJsonRawSafe,
  resolveAnchoredReportCycleId,
  resolveAutomationCycleMeta,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const SERVER_SIGNAL_RUNTIME_LATEST_PATH = path.join(OPS_DAILY_DIR, "server_signal_runtime_latest.json");
const EXCHANGES = Object.freeze(["BINANCEFUT", "UPBIT", "KIWOOM"]);

function deriveSummary({ runtime } = {}) {
  const runtimeSummary = runtime && runtime.summary && typeof runtime.summary === "object" ? runtime.summary : {};
  const contracts = EXCHANGES.map((exchange) => {
    const charter = checkCharterConsistency(exchange);
    const checks = Array.isArray(charter && charter.checks) ? charter.checks : [];
    const trailCheck = checks.find((row) => String(row && row.id || "").startsWith("TRAIL_")) || null;
    const rules = getExitRulesForExchange(exchange);
    const expected = (((CHARTER_EXPECTATIONS || {}).signal_engine || {}).by_exchange || {})[exchange]
      || ((CHARTER_EXPECTATIONS || {}).signal_engine || {}).default
      || {};
    return {
      exchange,
      charter_ok: charter && charter.ok === true,
      canonical_mode: Number.isFinite(Number(expected.TRAIL_R_MULTIPLE)) ? "TRAIL_R_MULTIPLE" : "TRAIL_PCT",
      trail_r_multiple: Number.isFinite(Number(rules.TRAIL_R_MULTIPLE)) ? Number(rules.TRAIL_R_MULTIPLE) : null,
      legacy_trail_pct: Number.isFinite(Number(rules.TRAIL_PCT)) ? Number(rules.TRAIL_PCT) : null,
      event_name_mode: Number.isFinite(Number(rules.TRAIL_R_MULTIPLE)) ? "EXIT_TRAIL_GENERIC" : "EXIT_TRAIL_PCT_TOKEN",
      expected_label: trailCheck && trailCheck.expected_label ? trailCheck.expected_label : null,
      actual_label: trailCheck && trailCheck.actual_label ? trailCheck.actual_label : null,
    };
  });

  const mismatch = contracts.find((row) => row.charter_ok !== true) || null;
  const canonicalExchanges = contracts.filter((row) => row.canonical_mode === "TRAIL_R_MULTIPLE");
  return {
    status: mismatch ? "EXIT_TRAILING_CONTRACT_MISMATCH" : "EXIT_TRAILING_CONTRACT_ACTIVE",
    runtime_source_mode: String(runtimeSummary.source_mode || runtimeSummary.canonical_engine_source_mode || "").trim() || null,
    canonical_mode: "TRAIL_R_MULTIPLE",
    legacy_pct_fallback_enabled: true,
    generic_trail_event_when_r_enabled: true,
    exchange_n: contracts.length,
    canonical_exchange_n: canonicalExchanges.length,
    mismatch_exchange: mismatch ? mismatch.exchange : null,
    exchange_contracts: contracts,
    notes: [
      "Server trailing must use TRAIL_R_MULTIPLE as the canonical contract.",
      "TRAIL_PCT is retained only as a legacy fallback and display compatibility field.",
      "When TRAIL_R_MULTIPLE is active, new trailing exits should emit generic EXIT_TRAIL instead of percent-token events.",
    ],
    next_actions: [
      "keep trailing exit stop computation anchored to entry R distance",
      "prefer TRAIL_R_MULTIPLE in alerts, dashboards, and audits",
      "do not reintroduce percent-token trailing events for new R-based exits",
    ],
  };
}

function renderMarkdown(report = {}) {
  const s = report.summary || {};
  const lines = [
    "# BEST Self-Evolution Exit Trailing Contract",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- runtime_source_mode: ${s.runtime_source_mode || "N/A"}`,
    `- canonical_mode: ${s.canonical_mode || "N/A"}`,
    `- legacy_pct_fallback_enabled: ${s.legacy_pct_fallback_enabled ? "YES" : "NO"}`,
    `- generic_trail_event_when_r_enabled: ${s.generic_trail_event_when_r_enabled ? "YES" : "NO"}`,
    "",
    "## Exchange Contracts",
  ];
  for (const row of Array.isArray(s.exchange_contracts) ? s.exchange_contracts : []) {
    lines.push(`- ${row.exchange}: mode=${row.canonical_mode} / r=${row.trail_r_multiple != null ? row.trail_r_multiple : "N/A"} / pct=${row.legacy_trail_pct != null ? row.legacy_trail_pct : "N/A"} / charter=${row.charter_ok ? "OK" : "MISMATCH"} / event=${row.event_name_mode}`);
  }
  lines.push("", "## Next Actions");
  for (const row of Array.isArray(s.next_actions) ? s.next_actions : []) {
    lines.push(`- ${row}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  ensureDir(OPS_DAILY_DIR);
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtime = readJsonRawSafe(SERVER_SIGNAL_RUNTIME_LATEST_PATH, null);
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [runtime],
  });
  const summary = deriveSummary({ runtime });
  const report = {
    ok: summary.status === "EXIT_TRAILING_CONTRACT_ACTIVE",
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      server_signal_runtime: SERVER_SIGNAL_RUNTIME_LATEST_PATH,
    },
    summary,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_exit_trailing_contract`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exit_trailing_contract_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_exit_trailing_contract_latest.md");

  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copySelfEvolutionLatest(jsonPath, selfEvolutionSnapshotLatestPath("exit_trailing_contract_latest.json"));
  copySelfEvolutionLatest(mdPath, selfEvolutionSnapshotLatestPath("exit_trailing_contract_latest.md"));

  console.log(JSON.stringify({
    ok: report.ok,
    cycle_id: report.cycle_id,
    status: summary.status,
    canonical_mode: summary.canonical_mode,
    latest_json: latestJsonPath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXIT_TRAILING_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
  __test: {
    deriveSummary,
    renderMarkdown,
  },
};
