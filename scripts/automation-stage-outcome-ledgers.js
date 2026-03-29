#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildCoverageGuard,
  buildEvResolvedLedger,
  buildWaitStateMachineLedger,
} = require("./lib/stage-outcome-ledgers");
const { describeEntryEventForUser } = require("../src/utils/liveEntryTaxonomy");
const { describeStageForUser, wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

const PROVIDER = String(process.env.STAGE_LEDGER_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const TF = String(process.env.STAGE_LEDGER_TF || "15m").trim();
const LOOKBACK_DAYS = Math.max(10, Number(process.env.STAGE_LEDGER_LOOKBACK_DAYS || 21));
const EV_MATURITY_HOURS = Math.max(3, Number(process.env.STAGE_LEDGER_EV_MATURITY_HOURS || 12));
const WAIT_HORIZON_HOURS = Math.max(4, Number(process.env.STAGE_LEDGER_WAIT_HORIZON_HOURS || 12));
const SCAN_LIMIT = Math.max(4000, Number(process.env.STAGE_LEDGER_SCAN_LIMIT || 20000));

function pct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedPct(v, digits = 2) {
  if (v === null || v === undefined || v === "") return "N/A";
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${(n * 100).toFixed(digits)}%`;
}

function describeWaitStateForUser(state) {
  const key = String(state || "").trim().toUpperCase();
  switch (key) {
    case "ALLOW":
      return "대기 없음";
    case "WAIT_THEN_ENTER_TP1":
      return "한 봉 대기 후 진입, TP1 도달";
    case "WAIT_THEN_ENTER_SL":
      return "한 봉 대기 후 진입, 손절 종료";
    case "WAIT_THEN_ENTER_HOLD":
      return "한 봉 대기 후 진입, 미해결 유지";
    default:
      return key ? key.replace(/_/g, " ") : "알 수 없음";
  }
}

function buildWaitStateRows(summary = {}) {
  const byState = summary && summary.by_state && typeof summary.by_state === "object" ? summary.by_state : {};
  return Object.entries(byState)
    .map(([state, count]) => ({
      state,
      display_state: describeWaitStateForUser(state),
      count: Number(count || 0),
    }))
    .sort((a, b) => b.count - a.count || String(a.state).localeCompare(String(b.state)));
}

function buildCoverageGuardRows(guard = {}) {
  const rows = [];
  if (guard && typeof guard === "object") {
    if (guard.ai) {
      rows.push({
        stage: "AI",
        display_stage: describeStageForUser("AI"),
        pass: guard.ai.pass === true,
        sample_n: Number(guard.ai.sample_n || 0),
      });
    }
    if (guard.market) {
      rows.push({
        stage: "MARKET",
        display_stage: describeStageForUser("MARKET"),
        pass: guard.market.pass === true,
        sample_n: Number(guard.market.sample_n || 0),
        ai_bias_coverage: guard.market.ai_bias_coverage ?? null,
      });
    }
  }
  return rows;
}

function buildRecentRows(rows, limit = 20) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, Math.max(0, limit));
}

function readLatestMlPolicy() {
  const filePath = path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json");
  const data = readJsonRawSafe(filePath, null);
  return data ? { filePath, data } : { filePath: null, data: null };
}

function renderEvMarkdown(report = {}) {
  const s = report.summary || {};
  const lines = [
    "# EV Resolved Ledger",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- model: ${report.model || "N/A"}`,
    `- maturity: ${report.maturity_hours || "N/A"}h`,
    `- total: ${s.total_n || 0}`,
    `- resolved: ${s.resolved_n || 0}`,
    `- executed entry: ${s.executed_entry_n || 0}`,
    `- ev drop: ${s.ev_drop_n || 0}`,
    `- wait after stage4: ${s.wait_after_stage4_n || 0}`,
    `- TP1 hit: ${s.tp1_hit_n || 0}`,
    `- no TP1: ${s.no_tp1_n || 0}`,
    `- unresolved stale: ${s.unresolved_stale_n || 0}`,
    `- avg_ret_net: ${signedPct(s.avg_ret_net)}`,
    "",
    "## Recent",
  ];
  const rows = Array.isArray(report.rows) ? report.rows.slice(0, 20) : [];
  if (!rows.length) lines.push("- none");
  for (const row of rows) {
    lines.push(`- ${describeEntryEventForUser(row.event, row.side)} ${row.symbol} ${row.stage4_source} / p=${pct(row.predicted)} / outcome=${row.outcome} / ret=${signedPct(row.realized_ret_net)}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderWaitMarkdown(report = {}) {
  const s = report.summary || {};
  const lines = [
    "# WAIT State Machine Ledger",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- horizon: ${report.horizon_hours || "N/A"}h`,
    `- total: ${s.total_n || 0}`,
    `- matured: ${s.matured_n || 0}`,
    `- skipped: ${s.skipped_n || 0}`,
    `- wait trigger: ${s.wait_trigger_n || 0}`,
    `- beneficial wait: ${s.beneficial_wait_n || 0}`,
    `- harmful wait: ${s.harmful_wait_n || 0}`,
    `- avg_delta_ret_net: ${signedPct(s.avg_delta_ret_net)}`,
    "",
    "## States",
  ];
  const states = s.by_state || {};
  const entries = Object.entries(states).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) lines.push("- none");
  for (const [key, value] of entries) lines.push(`- ${key}: ${value}`);
  return `${lines.join("\n")}\n`;
}

function renderCoverageMarkdown(report = {}) {
  const guard = report.guard || {};
  return [
    "# Stage Coverage Guard",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- 대상: ${report.provider || "N/A"} ${report.tf || "N/A"}`,
    `- overall: ${guard.pass ? "PASS" : "BLOCK"}`,
    `- self-validation: ${guard.self_validation_ok === true ? "OK" : "WARN"}`,
    `- 2차 진입 품질: ${guard.ai && guard.ai.pass ? "PASS" : "BLOCK"} / sample ${guard.ai && guard.ai.sample_n || 0}/${guard.ai && guard.ai.min_sample || 0}`,
    `- 3차 상태 기반 Soft Sizing: ${guard.market && guard.market.pass ? "PASS" : "BLOCK"} / sample ${guard.market && guard.market.sample_n || 0}/${guard.market && guard.market.min_sample || 0} / ai_bias_coverage ${pct(guard.market && guard.market.ai_bias_coverage)}`,
  ].join("\n") + "\n";
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const nowMs = nowMeta.nowMs;
  const fromMs = nowMs - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [sysRes, signalsRes, dropsRes, intentsRes, fillsRes] = await Promise.all([
    getSystemSettingsForProvider(PROVIDER, 0),
    getCachedRecentByCreatedAt("signals", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: SCAN_LIMIT, maxDocs: SCAN_LIMIT, overlapDocs: 400, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: SCAN_LIMIT * 2, maxDocs: SCAN_LIMIT * 2, overlapDocs: 800, pageSize: 1000, refresh: true }),
  ]);
  const sysCfg = sysRes && sysRes.data ? sysRes.data : {};
  const mlPolicy = readLatestMlPolicy();

  const [evLedger, waitLedger] = await Promise.all([
    buildEvResolvedLedger({
      provider: PROVIDER,
      tf: TF,
      fromMs,
      toMs: nowMs,
      nowMs,
      maturityHours: EV_MATURITY_HOURS,
      intents: intentsRes.rows,
      fills: fillsRes.rows,
      drops: dropsRes.rows,
      sysCfg,
    }),
    buildWaitStateMachineLedger({
      provider: PROVIDER,
      tf: TF,
      fromMs,
      toMs: nowMs,
      nowMs,
      horizonHours: WAIT_HORIZON_HOURS,
      signals: signalsRes.rows,
      drops: dropsRes.rows,
      sysCfg,
    }),
  ]);

  const coverageGuard = {
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    source: mlPolicy.filePath,
    guard: buildCoverageGuard(mlPolicy.data || {}),
  };

  const summary = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    lookback_days: LOOKBACK_DAYS,
    ev_ledger: { ...evLedger, generated_at_kst: nowMeta.kst },
    wait_ledger: { ...waitLedger, generated_at_kst: nowMeta.kst },
    coverage_guard: coverageGuard,
    artifacts: {
      cache: {
        signals: signalsRes.meta,
        drops: dropsRes.meta,
        intents: intentsRes.meta,
        fills: fillsRes.meta,
      },
      ml_policy_report: mlPolicy.filePath,
    },
  };
  if (summary.ev_ledger) {
    summary.ev_ledger.recent_rows = buildRecentRows(summary.ev_ledger.rows, 20);
  }
  if (summary.wait_ledger) {
    summary.wait_ledger.recent_rows = buildRecentRows(summary.wait_ledger.rows, 20);
  }
  if (summary.wait_ledger && summary.wait_ledger.summary) {
    summary.wait_ledger.summary.by_state_rows = buildWaitStateRows(summary.wait_ledger.summary);
  }
  if (summary.coverage_guard && summary.coverage_guard.guard) {
    summary.coverage_guard.guard_rows = buildCoverageGuardRows(summary.coverage_guard.guard);
  }

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const summaryJsonPath = path.join(OPS_DAILY_DIR, `${base}_stage_outcome_ledgers.json`);
  const summaryMdPath = path.join(OPS_DAILY_DIR, `${base}_stage_outcome_ledgers.md`);
  const evJsonPath = path.join(OPS_DAILY_DIR, `${base}_ev_resolved_ledger.json`);
  const evMdPath = path.join(OPS_DAILY_DIR, `${base}_ev_resolved_ledger.md`);
  const waitJsonPath = path.join(OPS_DAILY_DIR, `${base}_wait_state_machine.json`);
  const waitMdPath = path.join(OPS_DAILY_DIR, `${base}_wait_state_machine.md`);
  const coverageJsonPath = path.join(OPS_DAILY_DIR, `${base}_stage_coverage_guard.json`);
  const coverageMdPath = path.join(OPS_DAILY_DIR, `${base}_stage_coverage_guard.md`);

  writeJson(summaryJsonPath, wrapDisplayAndRawReport(summary));
  writeText(summaryMdPath, [
    "# Stage Outcome Ledgers",
    "",
    `- 실행 시각: ${nowMeta.kst}`,
    `- 대상: ${PROVIDER} ${TF}`,
    `- EV resolved: ${summary.ev_ledger.summary.resolved_n}`,
    `- WAIT matured: ${summary.wait_ledger.summary.matured_n}`,
    `- Coverage guard: ${summary.coverage_guard.guard.pass ? "PASS" : "BLOCK"}`,
    "",
    `- EV ledger: ${evMdPath}`,
    `- WAIT ledger: ${waitMdPath}`,
    `- Coverage guard: ${coverageMdPath}`,
  ].join("\n") + "\n");
  writeJson(evJsonPath, wrapDisplayAndRawReport(summary.ev_ledger));
  writeText(evMdPath, renderEvMarkdown(summary.ev_ledger));
  writeJson(waitJsonPath, wrapDisplayAndRawReport(summary.wait_ledger));
  writeText(waitMdPath, renderWaitMarkdown(summary.wait_ledger));
  writeJson(coverageJsonPath, wrapDisplayAndRawReport(summary.coverage_guard));
  writeText(coverageMdPath, renderCoverageMarkdown(summary.coverage_guard));

  copyLatest(summaryJsonPath, path.join(OPS_DAILY_DIR, "stage_outcome_ledgers_latest.json"));
  copyLatest(summaryMdPath, path.join(OPS_DAILY_DIR, "stage_outcome_ledgers_latest.md"));
  copyLatest(evJsonPath, path.join(OPS_DAILY_DIR, "ev_resolved_ledger_latest.json"));
  copyLatest(evMdPath, path.join(OPS_DAILY_DIR, "ev_resolved_ledger_latest.md"));
  copyLatest(waitJsonPath, path.join(OPS_DAILY_DIR, "wait_state_machine_latest.json"));
  copyLatest(waitMdPath, path.join(OPS_DAILY_DIR, "wait_state_machine_latest.md"));
  copyLatest(coverageJsonPath, path.join(OPS_DAILY_DIR, "stage_coverage_guard_latest.json"));
  copyLatest(coverageMdPath, path.join(OPS_DAILY_DIR, "stage_coverage_guard_latest.md"));

  await sendKoreanTelegramSummary({
    title: `[단계별 성과 점검] ${PROVIDER}`,
    provider: PROVIDER,
    severity: summary.coverage_guard.guard.pass ? "INFO" : "WARN",
    sections: [
      {
        header: "4차 EV/시간가치층",
        lines: [
          `resolved ${summary.ev_ledger.summary.resolved_n} / entry ${summary.ev_ledger.summary.executed_entry_n} / ev_drop ${summary.ev_ledger.summary.ev_drop_n} / wait_after_stage4 ${summary.ev_ledger.summary.wait_after_stage4_n}`,
          `TP1 ${summary.ev_ledger.summary.tp1_hit_n} / no_tp1 ${summary.ev_ledger.summary.no_tp1_n} / avg_ret ${signedPct(summary.ev_ledger.summary.avg_ret_net)}`,
        ],
      },
      {
        header: "5차 WAIT 타이밍층",
        lines: [
          `matured ${summary.wait_ledger.summary.matured_n} / trigger ${summary.wait_ledger.summary.wait_trigger_n}`,
          `beneficial ${summary.wait_ledger.summary.beneficial_wait_n} / harmful ${summary.wait_ledger.summary.harmful_wait_n} / avg_delta ${signedPct(summary.wait_ledger.summary.avg_delta_ret_net)}`,
        ],
      },
      {
        header: "2·3차 데이터 충분성",
        lines: [
          `2차 진입 품질 ${summary.coverage_guard.guard.ai.pass ? "PASS" : "BLOCK"} / sample ${summary.coverage_guard.guard.ai.sample_n}`,
          `3차 상태 기반 Soft Sizing ${summary.coverage_guard.guard.market.pass ? "PASS" : "BLOCK"} / sample ${summary.coverage_guard.guard.market.sample_n} / ai_bias ${pct(summary.coverage_guard.guard.market.ai_bias_coverage)}`,
        ],
      },
      {
        header: "보고서",
        lines: [summaryMdPath, evMdPath, waitMdPath, coverageMdPath],
      },
    ],
  });

  console.log(JSON.stringify({
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    tf: TF,
    ev_resolved_n: summary.ev_ledger.summary.resolved_n,
    wait_matured_n: summary.wait_ledger.summary.matured_n,
    coverage_pass: summary.coverage_guard.guard.pass,
    summary_json: summaryJsonPath,
    summary_md: summaryMdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-stage-outcome-ledgers failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    buildWaitStateRows,
    describeWaitStateForUser,
  },
};
