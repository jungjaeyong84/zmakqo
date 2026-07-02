#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3PaperValidationReport } = require("../src/v3/validationReport");
const { loadLocalEnv, sendKoreanTelegramSummary } = require("./lib/automation-utils");

loadLocalEnv();

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const ENTRY_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_entry_ledger.jsonl");
const EXIT_LEDGER_PATH = path.join(OPS_RUNTIME, "v3_paper_exit_ledger.jsonl");
const BOOTSTRAP_PATH = path.join(OPS_DAILY, "v3_paper_bootstrap_latest.json");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_validation_latest.json");
const HISTORY_PATH = path.join(OPS_RUNTIME, "v3_paper_validation_history.jsonl");

function readJsonSafe(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function readJsonlRows(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

function parseList(raw, fallback) {
  const text = String(raw || "").trim();
  if (!text) return fallback;
  const values = text
    .split(/[\s,]+/)
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? values : fallback;
}

function thresholdEnvNumber(key, fallback) {
  const num = Number(process.env[key]);
  return Number.isFinite(num) ? num : fallback;
}

function toUpper(value) {
  return String(value == null ? "" : value).trim().toUpperCase();
}

function toFixedOrDash(value, digits = 2, suffix = "") {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(digits)}${suffix}`;
}

function toIntOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : 0;
}

function alertsEnabled() {
  const raw = toUpper(process.env.V3_PAPER_VALIDATION_ALERTS_ENABLED || "1");
  return !["0", "FALSE", "NO", "OFF"].includes(raw);
}

function isPaperSampleReady(payload) {
  return Boolean(payload && payload.paper_gate && payload.paper_gate.sample_ok === true);
}

function isPaperQualityReady(payload) {
  return Boolean(payload && payload.paper_gate && payload.paper_gate.ok === true);
}

function validationReadinessLabel(value) {
  const code = toUpper(value);
  if (code === "READY_FOR_RUNTIME_LANE_REVIEW") return "runtime lane 검토 가능";
  if (code === "WAIT_LIVE_SEED_MIX_EXPANSION") return "live seed 비중 확장 필요";
  if (code === "WAIT_PAPER_SAMPLE_ACCUMULATION") return "paper 표본 누적 중";
  if (code === "PAPER_SAMPLE_FAILS_QUALITY") return "paper 품질 미달";
  if (code === "WAIT_BOOTSTRAP_EXPANSION") return "bootstrap 표본 부족";
  return code || "확인 중";
}

function buildAlertSections(payload, previousPayload, kind) {
  const paperGate = payload && payload.paper_gate ? payload.paper_gate : {};
  const bootstrapGate = payload && payload.bootstrap_gate ? payload.bootstrap_gate : {};
  const summaryLines = Array.isArray(payload && payload.summary_lines) ? payload.summary_lines : [];
  const prevClosed = previousPayload && previousPayload.paper_gate ? toIntOrZero(previousPayload.paper_gate.closed_trade_n) : 0;
  const currentClosed = toIntOrZero(paperGate.closed_trade_n);
  const milestoneN = toIntOrZero(paperGate.min_required_n);
  const currentReadiness = validationReadinessLabel(payload && payload.readiness);

  const sections = [];
  if (kind === "sample") {
    sections.push({
      header: "paper 표본 milestone",
      lines: [
        `closed trade ${currentClosed}건으로 최소 기준 ${milestoneN}건을 넘었습니다.`,
        `이전 closed trade: ${prevClosed}건`,
        `현재 all-time 승률: ${toFixedOrDash(paperGate.win_rate_pct, 2, "%")}`,
        `현재 expectancy: ${toFixedOrDash(paperGate.expectancy_r, 4, "R")}`,
        `현재 readiness: ${currentReadiness}`,
      ],
    });
  }
  if (kind === "quality") {
    sections.push({
      header: "paper 품질 기준 통과",
      lines: [
        `승률 기준: ${toFixedOrDash(paperGate.win_rate_pct, 2, "%")} / 최소 ${toFixedOrDash(paperGate.min_win_rate_pct, 2, "%")}`,
        `expectancy 기준: ${toFixedOrDash(paperGate.expectancy_r, 4, "R")} / 최소 ${toFixedOrDash(paperGate.min_expectancy_r, 4, "R")}`,
        `closed trade: ${currentClosed}건`,
        `현재 readiness: ${currentReadiness}`,
      ],
    });
  }
  sections.push({
    header: "bootstrap 상태",
    lines: [
      `retained sample: ${toIntOrZero(bootstrapGate.retained_sample_n)} / ${toIntOrZero(bootstrapGate.min_required_n)}`,
      `retained 승률: ${toFixedOrDash(bootstrapGate.win_rate_pct, 2, "%")}`,
      `retained expectancy: ${toFixedOrDash(bootstrapGate.expectancy_usdt, 4, " USDT")}`,
    ],
  });
  if (summaryLines.length) {
    sections.push({
      header: "요약",
      lines: summaryLines.slice(0, 4),
    });
  }
  return sections;
}

async function maybeSendTransitionAlerts(previousPayload, payload) {
  if (!alertsEnabled()) {
    return [{ ok: true, skipped: true, reason: "ALERTS_DISABLED" }];
  }

  const jobs = [];
  if (!isPaperSampleReady(previousPayload) && isPaperSampleReady(payload)) {
    jobs.push({
      kind: "sample",
      title: `[목표] V3 paper closed trade ${toIntOrZero(payload.paper_gate && payload.paper_gate.min_required_n)}건 도달`,
      dedupeKey: `v3_paper_closed_trade_${toIntOrZero(payload.paper_gate && payload.paper_gate.min_required_n)}`,
      severity: "PASS",
    });
  }
  if (!isPaperQualityReady(previousPayload) && isPaperQualityReady(payload)) {
    jobs.push({
      kind: "quality",
      title: "[목표] V3 paper 승률·expectancy 기준 충족",
      dedupeKey: "v3_paper_quality_gate_ok",
      severity: "PASS",
    });
  }

  const results = [];
  for (const job of jobs) {
    const result = await sendKoreanTelegramSummary({
      title: job.title,
      sections: buildAlertSections(payload, previousPayload, job.kind),
      severity: job.severity,
      provider: "BINANCEFUT",
      dedupeKey: job.dedupeKey,
      dedupeWindowSec: 24 * 60 * 60,
      dedupeFingerprint: {
        readiness: payload.readiness,
        paper_closed_trade_n: payload.paper_gate && payload.paper_gate.closed_trade_n,
        paper_expectancy_r: payload.paper_gate && payload.paper_gate.expectancy_r,
        paper_win_rate_pct: payload.paper_gate && payload.paper_gate.win_rate_pct,
      },
    });
    results.push({ kind: job.kind, ...result });
  }
  return results;
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.mkdirSync(OPS_RUNTIME, { recursive: true });

  const previousPayload = readJsonSafe(OUTPUT_PATH, null);
  const entryRows = readJsonlRows(ENTRY_LEDGER_PATH);
  const exitRows = readJsonlRows(EXIT_LEDGER_PATH);
  const bootstrap = readJsonSafe(BOOTSTRAP_PATH, {});
  const thresholds = {
    min_retained_sample_n: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_RETAINED_SAMPLE_N", 50),
    min_closed_trade_n: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_CLOSED_TRADE_N", 30),
    // 2026-06-25 profitability gate: WR floor 52 -> 48 (RR-aware breakeven
    // ~43.4%), expectancy floor 0 -> 0.15R (live-cost buffer). These runner
    // defaults were overriding the module defaults, so the paper quality
    // gate was still using the stale 52/0 — aligned here.
    min_paper_win_rate_pct: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_PAPER_WIN_RATE_PCT", 48),
    min_paper_expectancy_r: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_PAPER_EXPECTANCY_R", 0.15),
    min_live_seed_activation_n: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_LIVE_SEED_ACTIVATION_N", 5),
    min_live_seed_mature_n: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_LIVE_SEED_MATURE_N", 10),
    min_live_seed_share_pct: thresholdEnvNumber("V3_PAPER_VALIDATION_MIN_LIVE_SEED_SHARE_PCT", 10),
    live_seed_static_reference_cap_n: thresholdEnvNumber("V3_PAPER_VALIDATION_LIVE_SEED_STATIC_REFERENCE_CAP_N", 50),
    trade_windows: parseList(process.env.V3_PAPER_VALIDATION_TRADE_WINDOWS, [10, 20, 30]),
    day_windows: parseList(process.env.V3_PAPER_VALIDATION_DAY_WINDOWS, [7, 14, 30]),
  };

  const summary = buildV3PaperValidationReport({
    bootstrap,
    entryRows,
    exitRows,
    now: new Date(),
    thresholds,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    bootstrap_path: BOOTSTRAP_PATH,
    entry_ledger_path: ENTRY_LEDGER_PATH,
    exit_ledger_path: EXIT_LEDGER_PATH,
    thresholds,
    ...summary,
  };

  const alertResults = await maybeSendTransitionAlerts(previousPayload, payload);
  const finalPayload = {
    ...payload,
    alert_results: alertResults,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalPayload, null, 2));
  fs.appendFileSync(HISTORY_PATH, `${JSON.stringify(finalPayload)}\n`);

  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    readiness: finalPayload.readiness,
    bootstrap_retained_sample_n: finalPayload.bootstrap_gate.retained_sample_n,
    paper_closed_trade_n: finalPayload.paper_gate.closed_trade_n,
    summary_lines: finalPayload.summary_lines,
    alert_results: alertResults,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("REPORT_V3_PAPER_VALIDATION_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}

module.exports = {
  __test: {
    alertsEnabled,
    isPaperSampleReady,
    isPaperQualityReady,
    validationReadinessLabel,
    buildAlertSections,
  },
};
