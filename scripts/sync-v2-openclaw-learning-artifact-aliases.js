#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

const ALIASES = Object.freeze([
  Object.freeze({
    id: "execution_quality",
    legacyBase: "best_self_evolution_execution_quality_latest",
    v2Base: "v2_openclaw_execution_quality_latest",
  }),
  Object.freeze({
    id: "execution_watch_markets",
    legacyBase: "best_self_evolution_execution_watch_markets_latest",
    v2Base: "v2_openclaw_execution_watch_markets_latest",
  }),
  Object.freeze({
    id: "canonical_engine_parity",
    legacyBase: "best_self_evolution_canonical_engine_parity_latest",
    v2Base: "v2_openclaw_canonical_engine_parity_latest",
  }),
  Object.freeze({
    id: "learning_dataset",
    legacyBase: "best_self_evolution_dataset_latest",
    v2Base: "v2_openclaw_learning_dataset_latest",
  }),
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function resolveOpsDailyDir(env = process.env) {
  return path.resolve(trimOrNull(env.V2_OPENCLAW_ALIAS_OPS_DAILY_DIR) || DEFAULT_OPS_DAILY_DIR);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function aliasJsonPayload(payload, alias, nowIso) {
  const base = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : { payload };
  return {
    ...base,
    report_namespace: "V2_OPENCLAW",
    v2_learning_artifact_alias: true,
    legacy_name_retained_for_compatibility: true,
    legacy_artifact_base: alias.legacyBase,
    v2_artifact_base: alias.v2Base,
    alias_generated_at: nowIso,
  };
}

function aliasMarkdownPayload(text, alias, nowIso) {
  return [
    "<!-- V2_OPENCLAW_ALIAS: legacy best_self_evolution name retained for compatibility. -->",
    `<!-- alias_generated_at: ${nowIso} -->`,
    `<!-- legacy_artifact_base: ${alias.legacyBase} -->`,
    `<!-- v2_artifact_base: ${alias.v2Base} -->`,
    "",
    text,
  ].join("\n");
}

function syncAlias(alias, { opsDailyDir, nowIso }) {
  const legacyJson = path.join(opsDailyDir, `${alias.legacyBase}.json`);
  const v2Json = path.join(opsDailyDir, `${alias.v2Base}.json`);
  const legacyMd = path.join(opsDailyDir, `${alias.legacyBase}.md`);
  const v2Md = path.join(opsDailyDir, `${alias.v2Base}.md`);

  const row = {
    id: alias.id,
    legacy_json: legacyJson,
    v2_json: v2Json,
    legacy_md: legacyMd,
    v2_md: v2Md,
    json_written: false,
    markdown_written: false,
    skipped: [],
  };

  if (fs.existsSync(legacyJson)) {
    writeJson(v2Json, aliasJsonPayload(readJson(legacyJson), alias, nowIso));
    row.json_written = true;
  } else {
    row.skipped.push("LEGACY_JSON_MISSING");
  }

  if (fs.existsSync(legacyMd)) {
    writeText(v2Md, aliasMarkdownPayload(fs.readFileSync(legacyMd, "utf8"), alias, nowIso));
    row.markdown_written = true;
  } else {
    row.skipped.push("LEGACY_MD_MISSING");
  }

  return row;
}

function buildReport({ rows, opsDailyDir, nowIso }) {
  const aliasN = rows.filter((row) => row.json_written || row.markdown_written).length;
  const skippedN = rows.filter((row) => row.skipped.length > 0).length;
  return {
    ok: aliasN > 0,
    reason: aliasN > 0 ? (skippedN > 0 ? "V2_OPENCLAW_LEARNING_ALIAS_PASS_WITH_SKIPS" : "V2_OPENCLAW_LEARNING_ALIAS_PASS") : "V2_OPENCLAW_LEARNING_ALIAS_NO_SOURCES",
    report_namespace: "V2_OPENCLAW",
    generated_at: nowIso,
    ops_daily_dir: opsDailyDir,
    alias_n: aliasN,
    skipped_n: skippedN,
    rows,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# V2 OpenClaw Learning Artifact Aliases",
    "",
    `- generated_at: ${report.generated_at}`,
    `- reason: ${report.reason}`,
    `- alias_n: ${report.alias_n}`,
    `- skipped_n: ${report.skipped_n}`,
    "",
    "## Aliases",
  ];
  for (const row of report.rows) {
    lines.push(`- ${row.id}: json=${row.json_written ? "written" : "missing"} md=${row.markdown_written ? "written" : "missing"} skipped=${row.skipped.join("|") || "none"}`);
  }
  return `${lines.join("\n")}\n`;
}

function main(env = process.env) {
  const opsDailyDir = resolveOpsDailyDir(env);
  const nowIso = new Date().toISOString();
  const rows = ALIASES.map((alias) => syncAlias(alias, { opsDailyDir, nowIso }));
  const report = buildReport({ rows, opsDailyDir, nowIso });
  const latestJson = path.join(opsDailyDir, "v2_openclaw_learning_artifact_aliases_latest.json");
  const latestMd = path.join(opsDailyDir, "v2_openclaw_learning_artifact_aliases_latest.md");
  writeJson(latestJson, report);
  writeText(latestMd, renderMarkdown(report));
  console.log(JSON.stringify({
    ok: report.ok,
    reason: report.reason,
    alias_n: report.alias_n,
    skipped_n: report.skipped_n,
    jsonPath: latestJson,
    mdPath: latestMd,
  }, null, 2));
  if (!report.ok) process.exit(1);
  return report;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (err) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_OPENCLAW_LEARNING_ALIAS_THROWN",
      error: err && err.message ? err.message : String(err),
    }, null, 2));
    process.exit(1);
  }
}

module.exports = {
  ALIASES,
  aliasJsonPayload,
  buildReport,
  main,
  resolveOpsDailyDir,
  syncAlias,
};
