#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { listV2Docs } = require("../src/v2/storage");
const { buildOpenClawDailyPerformanceReport } = require("../src/v2/openclawDailyPerformanceReport");

const OUTPUT_FILENAME = "v2_openclaw_daily_performance_report_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve("ops", "daily", OUTPUT_FILENAME);
}

function resolveInputRows(env = process.env) {
  const file = trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_INPUT_FILE);
  if (!file) return null;
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return Array.isArray(payload) ? payload : (Array.isArray(payload.outcomes) ? payload.outcomes : []);
}

async function collectOutcomes({ db = null, env = process.env } = {}) {
  const fixtureRows = resolveInputRows(env);
  if (fixtureRows) return fixtureRows;
  const limit = Math.max(1, Math.min(500, Number(env.V2_OPENCLAW_DAILY_PERFORMANCE_LIMIT || 100) || 100));
  const result = await listV2Docs({
    db,
    env,
    collectionKey: "OPENCLAW_OUTCOME_ADJUDICATIONS",
    limit,
    orderBy: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_ORDER_FIELD) || "adjudicated_at",
    direction: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_ORDER_DIRECTION) || "desc",
  });
  return result.rows || [];
}

async function main(env = process.env) {
  const rows = await collectOutcomes({ env });
  const payload = buildOpenClawDailyPerformanceReport({
    outcomes: rows,
    source: trimOrNull(env.V2_OPENCLAW_DAILY_PERFORMANCE_INPUT_FILE) ? "JSON_FIXTURE" : "OPENCLAW_OUTCOME_ADJUDICATIONS",
    lookbackHours: Number(env.V2_OPENCLAW_DAILY_PERFORMANCE_LOOKBACK_HOURS || 24) || 24,
  });
  const outputFile = resolveOutputFile(env);
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, payload);
  console.log(JSON.stringify({
    ok: true,
    reason: payload.reason,
    output_file: outputFile,
    sample_n: payload.sample_n,
    win_rate_pct: payload.win_rate_pct,
    profit_factor: payload.profit_factor,
    expectancy: payload.expectancy,
  }));
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, reason: "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    collectOutcomes,
    __test: { resolveOutputFile, resolveInputRows },
  };
}
