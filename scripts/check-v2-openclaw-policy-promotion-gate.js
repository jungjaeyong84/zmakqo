#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateOpenClawPolicyPromotionGate, resolvePolicyPromotionThresholds } = require("../src/v2/openclawPolicyPromotionGate");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readJson(envValue, fileValue, fallback) {
  const raw = trimOrNull(envValue);
  if (raw) return JSON.parse(raw);
  const file = trimOrNull(fileValue);
  if (file && fs.existsSync(path.resolve(file))) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  return fallback;
}

function main(env = process.env) {
  const champion = readJson(env.V2_POLICY_PROMOTION_CHAMPION_JSON, env.V2_POLICY_PROMOTION_CHAMPION_FILE, {});
  const challenger = readJson(env.V2_POLICY_PROMOTION_CHALLENGER_JSON, env.V2_POLICY_PROMOTION_CHALLENGER_FILE, {});
  const learner = readJson(env.V2_POLICY_PROMOTION_LEARNER_JSON, env.V2_POLICY_PROMOTION_LEARNER_FILE, {});
  const outputFile = path.resolve(trimOrNull(env.V2_POLICY_PROMOTION_OUTPUT_FILE) || path.join("ops", "daily", "v2_openclaw_policy_promotion_gate_latest.json"));
  const payload = {
    ...evaluateOpenClawPolicyPromotionGate({
      env,
      thresholds: resolvePolicyPromotionThresholds(env),
      champion,
      challenger,
      learner,
    }),
    generated_at: new Date().toISOString(),
    output_file: outputFile,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const line = JSON.stringify({ ok: payload.ok, reason: payload.reason, decision: payload.decision, blockers: payload.blockers, output_file: outputFile });
  if (!payload.ok && String(env.V2_POLICY_PROMOTION_SOFT || "0") !== "1") {
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
    console.error(JSON.stringify({ ok: false, reason: "OPENCLAW_POLICY_PROMOTION_GATE_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, __test: { trimOrNull, readJson } };
}
