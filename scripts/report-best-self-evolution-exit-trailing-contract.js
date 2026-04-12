#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { CHARTER_EXPECTATIONS } = require("../src/config/charterExpectations");
const { checkCharterConsistency } = require("../src/services/charterCheck");
const { resolveExitRulesForPosition } = require("../src/engine/signalEngine");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { resolveExitStageAbsoluteContractQtyRatio } = require("../src/utils/exitQtyContract");
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

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pctAbs(value, digits = 4) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return null;
  const v = Math.abs(n) * 100;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function pctSigned(value, digits = 4) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return null;
  const v = n * 100;
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function normalizeExitProfileMode(raw, fallback = "BASE") {
  const v = String(raw || "").trim().toUpperCase();
  if (v === "BASE" || v === "AGGRESSIVE") return v;
  return fallback;
}

function summarizeRules(rules = null) {
  const r = rules && typeof rules === "object" ? rules : {};
  return {
    sl_pct_abs: pctAbs(r.SL),
    tp1_pct: pctSigned(r.TP_P1),
    tp1_qty_pct: pctSigned(resolveExitStageAbsoluteContractQtyRatio("TP1", r)),
    be_pct: pctSigned(r.BE_PCT),
    trail_r_multiple: toNum(r.TRAIL_R_MULTIPLE),
    trail_pct_fallback: pctSigned(r.TRAIL_PCT),
    runner_min_profit_pct: pctSigned(r.RUNNER_MIN_PROFIT_PCT),
  };
}

function deriveSummary({ runtime, systemByExchange } = {}) {
  const runtimeSummary = runtime && runtime.summary && typeof runtime.summary === "object" ? runtime.summary : {};
  const systemMap = systemByExchange && typeof systemByExchange === "object" ? systemByExchange : {};
  const contracts = EXCHANGES.map((exchange) => {
    const system = systemMap[exchange] && typeof systemMap[exchange] === "object" ? systemMap[exchange] : {};
    const profileMode = exchange === "BINANCEFUT"
      ? normalizeExitProfileMode(system.futures_exit_profile_mode, "BASE")
      : "BASE";
    const charter = checkCharterConsistency(exchange);
    const checks = Array.isArray(charter && charter.checks) ? charter.checks : [];
    const trailCheck = checks.find((row) => String(row && row.id || "").startsWith("TRAIL_")) || null;
    const rules = resolveExitRulesForPosition({ exchange, exitProfileMode: profileMode });
    const expected = (((CHARTER_EXPECTATIONS || {}).signal_engine || {}).by_exchange || {})[exchange]
      || ((CHARTER_EXPECTATIONS || {}).signal_engine || {}).default
      || {};
    const entryExitContract = summarizeRules(rules);
    return {
      exchange,
      profile_mode: profileMode,
      charter_ok: charter && charter.ok === true,
      canonical_mode: Number.isFinite(Number(expected.TRAIL_R_MULTIPLE)) ? "TRAIL_R_MULTIPLE" : "TRAIL_PCT",
      trail_r_multiple: entryExitContract.trail_r_multiple,
      legacy_trail_pct: entryExitContract.trail_pct_fallback != null ? (entryExitContract.trail_pct_fallback / 100) : null,
      event_name_mode: Number.isFinite(Number(rules.TRAIL_R_MULTIPLE)) ? "EXIT_TRAIL_GENERIC" : "EXIT_TRAIL_PCT_TOKEN",
      expected_label: trailCheck && trailCheck.expected_label ? trailCheck.expected_label : null,
      actual_label: trailCheck && trailCheck.actual_label ? trailCheck.actual_label : null,
      entry_exit_contract: entryExitContract,
    };
  });

  const mismatch = contracts.find((row) => row.charter_ok !== true) || null;
  const canonicalExchanges = contracts.filter((row) => row.canonical_mode === "TRAIL_R_MULTIPLE");
  const activeBinance = contracts.find((row) => row.exchange === "BINANCEFUT") || null;
  return {
    status: mismatch ? "EXIT_TRAILING_CONTRACT_MISMATCH" : "EXIT_TRAILING_CONTRACT_ACTIVE",
    runtime_source_mode: String(runtimeSummary.source_mode || runtimeSummary.canonical_engine_source_mode || "").trim() || null,
    canonical_mode: "TRAIL_R_MULTIPLE",
    r_basis: "STRUCTURE_STOP",
    leverage_invariant_r: true,
    r_fallback_basis: "LEVERAGED_SL_FALLBACK",
    legacy_pct_fallback_enabled: true,
    generic_trail_event_when_r_enabled: true,
    exchange_n: contracts.length,
    canonical_exchange_n: canonicalExchanges.length,
    mismatch_exchange: mismatch ? mismatch.exchange : null,
    active_binance_profile_mode: activeBinance ? activeBinance.profile_mode : "BASE",
    active_binance_entry_exit_contract: activeBinance ? activeBinance.entry_exit_contract : null,
    exchange_contracts: contracts,
    notes: [
      "Server trailing must use TRAIL_R_MULTIPLE as the canonical contract.",
      "Entry R distance must be anchored to structure stop_price first, not leverage-scaled SL distance.",
      "TRAIL_PCT is retained only as a legacy fallback and display compatibility field.",
      "When TRAIL_R_MULTIPLE is active, new trailing exits should emit generic EXIT_TRAIL instead of percent-token events.",
    ],
    next_actions: [
      "keep trailing exit stop computation anchored to structure stop-based entry R distance",
      "prefer TRAIL_R_MULTIPLE in alerts, dashboards, and audits",
      "do not reintroduce percent-token trailing events for new R-based exits",
      "allow leveraged SL distance only as a missing-structure fallback",
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
    `- r_basis: ${s.r_basis || "N/A"}`,
    `- leverage_invariant_r: ${s.leverage_invariant_r ? "YES" : "NO"}`,
    `- r_fallback_basis: ${s.r_fallback_basis || "N/A"}`,
    `- legacy_pct_fallback_enabled: ${s.legacy_pct_fallback_enabled ? "YES" : "NO"}`,
    `- generic_trail_event_when_r_enabled: ${s.generic_trail_event_when_r_enabled ? "YES" : "NO"}`,
    `- active_binance_profile_mode: ${s.active_binance_profile_mode || "N/A"}`,
    `- active_binance_contract: ${s.active_binance_entry_exit_contract ? `SL_${s.active_binance_entry_exit_contract.sl_pct_abs ?? "N/A"} / TP1_${s.active_binance_entry_exit_contract.tp1_pct ?? "N/A"} / TP1_QTY_${s.active_binance_entry_exit_contract.tp1_qty_pct ?? "N/A"} / BE_${s.active_binance_entry_exit_contract.be_pct ?? "N/A"} / TRAIL_R_${s.active_binance_entry_exit_contract.trail_r_multiple ?? "N/A"} / RUNNER_MIN_${s.active_binance_entry_exit_contract.runner_min_profit_pct ?? "N/A"}` : "N/A"}`,
    "",
    "## Exchange Contracts",
  ];
  for (const row of Array.isArray(s.exchange_contracts) ? s.exchange_contracts : []) {
    const c = row.entry_exit_contract || {};
    lines.push(`- ${row.exchange}: profile=${row.profile_mode || "BASE"} / mode=${row.canonical_mode} / SL=${c.sl_pct_abs != null ? c.sl_pct_abs : "N/A"} / TP1=${c.tp1_pct != null ? c.tp1_pct : "N/A"} / TP1_QTY=${c.tp1_qty_pct != null ? c.tp1_qty_pct : "N/A"} / BE=${c.be_pct != null ? c.be_pct : "N/A"} / TRAIL_R=${c.trail_r_multiple != null ? c.trail_r_multiple : "N/A"} / RUNNER_MIN=${c.runner_min_profit_pct != null ? c.runner_min_profit_pct : "N/A"} / charter=${row.charter_ok ? "OK" : "MISMATCH"} / event=${row.event_name_mode}`);
  }
  lines.push("", "## Next Actions");
  for (const row of Array.isArray(s.next_actions) ? s.next_actions : []) {
    lines.push(`- ${row}`);
  }
  return `${lines.join("\n")}\n`;
}

async function loadSystemByExchange() {
  const out = {};
  for (const exchange of EXCHANGES) {
    try {
      const res = await getSystemSettingsForProvider(exchange, 5000);
      out[exchange] = res && res.data && typeof res.data === "object" ? res.data : {};
    } catch (_err) {
      out[exchange] = {};
    }
  }
  return out;
}

async function main() {
  ensureDir(OPS_DAILY_DIR);
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const runtime = readJsonRawSafe(SERVER_SIGNAL_RUNTIME_LATEST_PATH, null);
  const systemByExchange = await loadSystemByExchange();
  const reportCycleId = resolveAnchoredReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    fallbackCycleId: cycleMeta.cycle_id,
    sources: [runtime],
  });
  const summary = deriveSummary({ runtime, systemByExchange });
  const report = {
    ok: summary.status === "EXIT_TRAILING_CONTRACT_ACTIVE",
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    inputs: {
      server_signal_runtime: SERVER_SIGNAL_RUNTIME_LATEST_PATH,
      system_settings_by_exchange: "settings/system (provider merge)",
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
  main().catch((err) => {
    console.error("BEST_SELF_EVOLUTION_EXIT_TRAILING_CONTRACT_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  main,
  __test: {
    summarizeRules,
    normalizeExitProfileMode,
    deriveSummary,
    renderMarkdown,
  },
};
