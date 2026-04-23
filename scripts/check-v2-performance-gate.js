#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateV2PerformanceGate, resolvePerformanceGateThresholds } = require("../src/v2/performanceGate");

const OUTPUT_FILENAME = "v2_performance_gate_latest.json";

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

function resolveInputFile(env = process.env) {
  return trimOrNull(env.V2_PERFORMANCE_GATE_INPUT_FILE)
    || path.resolve("ops", "daily", "v2_openclaw_daily_performance_report_latest.json");
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_PERFORMANCE_GATE_OUTPUT_FILE)
    || path.resolve("ops", "daily", OUTPUT_FILENAME);
}

function main(env = process.env) {
  const inputFile = path.resolve(resolveInputFile(env));
  const outputFile = path.resolve(resolveOutputFile(env));
  const metrics = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const payload = {
    ...evaluateV2PerformanceGate({
      metrics,
      thresholds: resolvePerformanceGateThresholds(env),
      mode: trimOrNull(env.V2_PERFORMANCE_GATE_MODE) || metrics.mode || "LIVE",
    }),
    input_file: inputFile,
    output_file: outputFile,
    generated_at: new Date().toISOString(),
  };
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, payload);
  const line = JSON.stringify({
    ok: payload.ok,
    reason: payload.reason,
    output_file: outputFile,
    blockers: payload.blockers,
    sample_n: payload.metrics.sample_n,
    profit_factor: payload.metrics.profit_factor,
    expectancy: payload.metrics.expectancy_r != null ? payload.metrics.expectancy_r : payload.metrics.avg_ret_net,
    net_pnl_pct: payload.metrics.net_pnl_pct,
  });
  if (payload.ok !== true && String(env.V2_PERFORMANCE_GATE_SOFT || "0").trim() !== "1") {
    console.error(line);
    process.exit(1);
  }
  console.log(line);
  return payload;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reason: "V2_PERFORMANCE_GATE_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, __test: { resolveInputFile, resolveOutputFile } };
}
