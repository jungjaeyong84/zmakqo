#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateMarketDataQualityGate, resolveMarketDataQualityPolicy } = require("../src/v2/marketDataQualityGate");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readSnapshot(env = process.env) {
  const raw = trimOrNull(env.V2_MARKET_DATA_QUALITY_SNAPSHOT_JSON);
  if (raw) return JSON.parse(raw);
  const file = trimOrNull(env.V2_MARKET_DATA_QUALITY_SNAPSHOT_FILE);
  if (file && fs.existsSync(path.resolve(file))) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return {};
}

function main(env = process.env) {
  const outputFile = path.resolve(trimOrNull(env.V2_MARKET_DATA_QUALITY_OUTPUT_FILE) || path.join("ops", "daily", "v2_market_data_quality_latest.json"));
  const payload = {
    ...evaluateMarketDataQualityGate({
      env,
      policy: resolveMarketDataQualityPolicy(env),
      snapshot: readSnapshot(env),
    }),
    generated_at: new Date().toISOString(),
    output_file: outputFile,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const line = JSON.stringify({ ok: payload.ok, reason: payload.reason, blockers: payload.blockers, output_file: outputFile });
  if (!payload.ok && String(env.V2_MARKET_DATA_QUALITY_SOFT || "0") !== "1") {
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
    console.error(JSON.stringify({ ok: false, reason: "V2_MARKET_DATA_QUALITY_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, __test: { trimOrNull, readSnapshot } };
}
