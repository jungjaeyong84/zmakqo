#!/usr/bin/env node
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  REPO_ROOT,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { openPineFileForReview } = require("./lib/pine-file-ops");
const {
  resolveCurrentVersionPineSource,
  syncCurrentVersionPineAlias,
} = require("./lib/current-version-pine");

loadLocalEnv();

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "current_version_pine_sync_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "current_version_pine_sync_latest.md");
const LATEST_GENERATED_PATH = path.join(REPO_ROOT, "code", "donbeolja_latest_generated.pine.txt");

function renderMarkdown(report = {}) {
  const lines = [
    "# Current Version Pine Sync",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- strategy_id: ${report.strategy_id || "N/A"}`,
    `- source: ${report.source_file_path || "N/A"}`,
    `- latest: ${report.latest_generated_file_path || "N/A"}`,
    `- synced: ${report.synced ? "YES" : "NO"}`,
    `- opened: ${report.opened ? "YES" : "NO"}`,
  ];
  if (report.open_method) lines.push(`- open_method: ${report.open_method}`);
  if (Array.isArray(report.tried_candidates) && report.tried_candidates.length) {
    lines.push("", "## Candidates");
    for (const row of report.tried_candidates) lines.push(`- ${row}`);
  }
  return `${lines.join("\n")}\n`;
}

function main() {
  const meta = nowKstMeta();
  const strategyId = String(process.env.DONBEOLJA_STRATEGY_ID || "").trim();
  const engineVersion = String(process.env.ENGINE_VERSION || "").trim();
  const resolved = resolveCurrentVersionPineSource({
    repoRoot: REPO_ROOT,
    strategyId,
    engineVersion,
  });
  const sync = syncCurrentVersionPineAlias({
    sourceFilePath: resolved.source_file_path,
    latestFilePath: LATEST_GENERATED_PATH,
  });
  let openResult = { ok: false, method: null, error: null };
  if (sync.ok && (sync.synced || String(process.env.OPEN_CURRENT_VERSION_PINE_FORCE || "0") === "1")) {
    openResult = openPineFileForReview(LATEST_GENERATED_PATH);
  }

  const report = {
    ok: resolved.ok && sync.ok,
    generated_at_kst: meta.kst,
    status: !resolved.ok ? "SOURCE_MISSING" : (!sync.ok ? sync.reason : (sync.synced ? "SYNCED" : "UNCHANGED")),
    strategy_id: resolved.strategy_id,
    source_file_path: resolved.source_file_path,
    latest_generated_file_path: LATEST_GENERATED_PATH,
    synced: sync.synced === true,
    opened: openResult.ok === true,
    open_method: openResult.method || null,
    open_error: openResult.error || null,
    source_sha256: sync.source_sha256 || null,
    latest_sha256: sync.latest_sha256 || null,
    tried_candidates: resolved.tried_candidates || [],
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_current_version_pine_sync.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_current_version_pine_sync.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    strategy_id: report.strategy_id,
    source_file_path: report.source_file_path,
    latest_generated_file_path: report.latest_generated_file_path,
    synced: report.synced,
    opened: report.opened,
    jsonPath,
    mdPath,
  }, null, 2));

  if (!report.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("automation-sync-current-version-pine failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
