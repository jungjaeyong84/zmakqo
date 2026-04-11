#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const DEFAULT_LIMIT = Math.max(3000, Number(process.env.ANALYTICS_CACHE_DEFAULT_LIMIT || 30000));
const FILL_LIMIT = Math.max(DEFAULT_LIMIT * 2, Number(process.env.ANALYTICS_CACHE_FILLS_LIMIT || (DEFAULT_LIMIT * 2)));
const PAGE_SIZE = Math.max(500, Number(process.env.ANALYTICS_CACHE_PAGE_SIZE || 1000));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEPENDENT_REPORT_SCRIPTS = Object.freeze([
  "report-server-signal-authority.js",
  "report-server-signal-quality.js",
  "report-server-signal-runtime.js",
  "report-server-signal-cutover-readiness.js",
  "build-feature-label-dataset.js",
  "report-shadow-evaluation-summary.js",
  "report-shadow-inference-canary.js",
  "report-best-self-evolution-ev-gate-composite-policy.js",
  "report-best-self-evolution-openclaw-autonomy-contract.js",
  "report-best-self-evolution-loop-monitor.js",
]);

function renderMarkdown({ nowMeta, collections, dependentReports = [] }) {
  const lines = [];
  lines.push("# Analytics Local Cache Refresh");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push("");
  lines.push("## 컬렉션");
  for (const row of collections) {
    lines.push(`- ${row.name}: ${row.filePath} / cached=${row.count} / returned=${row.returned} / new=${row.fetched_new} / overlap=${row.overlap_fetched} / source=${row.source}`);
  }
  lines.push("");
  lines.push("## Dependent Reports");
  for (const row of dependentReports) {
    lines.push(`- ${row.script}: ${row.status}${row.reason ? ` / ${row.reason}` : ""}${row.exit_code == null ? "" : ` / code=${row.exit_code}`}`);
  }
  return `${lines.join("\n")}\n`;
}

function runDependentReports() {
  if (String(process.env.ANALYTICS_CACHE_SKIP_DEPENDENT_REPORTS || "").trim() === "1") {
    return DEPENDENT_REPORT_SCRIPTS.map((script) => ({
      script,
      status: "SKIPPED",
      exit_code: null,
      reason: "ANALYTICS_CACHE_SKIP_DEPENDENT_REPORTS",
    }));
  }
  return DEPENDENT_REPORT_SCRIPTS.map((script) => {
    const scriptPath = path.join(__dirname, script);
    const child = spawnSync(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        BEST_SELF_EVOLUTION_ALLOW_LATEST_WRITE: "1",
      },
      maxBuffer: 1024 * 1024 * 4,
    });
    return {
      script,
      status: child.status === 0 ? "PASS" : "FAIL",
      exit_code: child.status,
      stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-3),
      stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-3),
    };
  });
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const [signals, drops, fills, intents, trades] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: DEFAULT_LIMIT, maxDocs: DEFAULT_LIMIT, overlapDocs: 400, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: DEFAULT_LIMIT, maxDocs: DEFAULT_LIMIT, overlapDocs: 400, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: FILL_LIMIT, maxDocs: FILL_LIMIT, overlapDocs: 800, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: FILL_LIMIT, maxDocs: FILL_LIMIT, overlapDocs: 800, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("trades_paper", { limit: FILL_LIMIT, maxDocs: FILL_LIMIT, overlapDocs: 800, pageSize: PAGE_SIZE, refresh: true }),
  ]);

  const collections = [
    { name: "signals", ...signals.meta },
    { name: "signals_dropped", ...drops.meta },
    { name: "fills_paper", ...fills.meta },
    { name: "order_intents_paper", ...intents.meta },
    { name: "trades_paper", ...trades.meta },
  ];
  const dependentReports = runDependentReports();
  const failedDependent = dependentReports.find((row) => row.status === "FAIL");

  const report = {
    ok: !failedDependent,
    generated_at_kst: nowMeta.kst,
    collections,
    dependent_reports: dependentReports,
  };

  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_analytics_local_cache_refresh.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_analytics_local_cache_refresh.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown({ nowMeta, collections, dependentReports }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.md"));
  console.log(JSON.stringify(report, null, 2));
  if (failedDependent) {
    throw new Error(`dependent report failed: ${failedDependent.script}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("refresh-analytics-local-cache failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    DEPENDENT_REPORT_SCRIPTS,
    runDependentReports,
  },
};
