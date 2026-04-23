#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateV2RiskGovernor, resolveRiskGovernorPolicy } = require("../src/v2/riskGovernor");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readJsonEnvOrFile({ envValue, fileValue, fallback }) {
  const raw = trimOrNull(envValue);
  if (raw) return JSON.parse(raw);
  const file = trimOrNull(fileValue);
  if (file && fs.existsSync(path.resolve(file))) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return fallback;
}

function main(env = process.env) {
  const account = readJsonEnvOrFile({ envValue: env.V2_RISK_GOVERNOR_ACCOUNT_JSON, fileValue: env.V2_RISK_GOVERNOR_ACCOUNT_FILE, fallback: {} });
  const positions = readJsonEnvOrFile({ envValue: env.V2_RISK_GOVERNOR_POSITIONS_JSON, fileValue: env.V2_RISK_GOVERNOR_POSITIONS_FILE, fallback: [] });
  const candidate = readJsonEnvOrFile({ envValue: env.V2_RISK_GOVERNOR_CANDIDATE_JSON, fileValue: env.V2_RISK_GOVERNOR_CANDIDATE_FILE, fallback: {} });
  const market = readJsonEnvOrFile({ envValue: env.V2_RISK_GOVERNOR_MARKET_JSON, fileValue: env.V2_RISK_GOVERNOR_MARKET_FILE, fallback: {} });
  const outputFile = path.resolve(trimOrNull(env.V2_RISK_GOVERNOR_OUTPUT_FILE) || path.join("ops", "daily", "v2_risk_governor_latest.json"));
  const payload = {
    ...evaluateV2RiskGovernor({
      env,
      policy: resolveRiskGovernorPolicy(env),
      account,
      positions,
      candidate,
      market,
    }),
    generated_at: new Date().toISOString(),
    output_file: outputFile,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const line = JSON.stringify({ ok: payload.ok, reason: payload.reason, blockers: payload.blockers, output_file: outputFile });
  if (!payload.ok && String(env.V2_RISK_GOVERNOR_SOFT || "0") !== "1") {
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
    console.error(JSON.stringify({ ok: false, reason: "V2_RISK_GOVERNOR_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, __test: { trimOrNull, readJsonEnvOrFile } };
}
