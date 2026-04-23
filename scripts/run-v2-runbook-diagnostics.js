#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildRunbookDiagnosticPlan } = require("../src/v2/runbookDiagnosticRunner");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readJsonIfExists(file) {
  const target = trimOrNull(file);
  if (!target || !fs.existsSync(path.resolve(target))) return null;
  return JSON.parse(fs.readFileSync(path.resolve(target), "utf8"));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectBlockers(env = process.env) {
  const raw = trimOrNull(env.V2_RUNBOOK_DIAGNOSTIC_BLOCKERS_JSON);
  if (raw) return JSON.parse(raw);
  const files = [
    "ops/daily/v2_production_entry_route_canary_streak_latest.json",
    "ops/daily/v2_exit_runtime_canary_streak_latest.json",
    "ops/daily/v2_repair_queue_firestore_canary_streak_latest.json",
    "ops/daily/v2_performance_gate_latest.json",
    "ops/daily/v2_firestore_cost_guard_latest.json",
    "ops/daily/v2_risk_governor_latest.json",
    "ops/daily/v2_market_data_quality_latest.json",
    "ops/daily/v2_openclaw_policy_promotion_gate_latest.json",
  ];
  return files.flatMap((file) => {
    const payload = readJsonIfExists(file);
    return asArray(payload && payload.blockers);
  });
}

function main(env = process.env) {
  const outputFile = path.resolve(trimOrNull(env.V2_RUNBOOK_DIAGNOSTIC_OUTPUT_FILE) || path.join("ops", "daily", "v2_runbook_diagnostics_latest.json"));
  const blockers = collectBlockers(env);
  const payload = {
    ...buildRunbookDiagnosticPlan({ blockers }),
    generated_at: new Date().toISOString(),
    output_file: outputFile,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ok: payload.ok, reason: payload.reason, blocker_n: payload.blocker_n, families: payload.families, output_file: outputFile }));
  return payload;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reason: "V2_RUNBOOK_DIAGNOSTIC_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, collectBlockers, __test: { trimOrNull, readJsonIfExists } };
}
