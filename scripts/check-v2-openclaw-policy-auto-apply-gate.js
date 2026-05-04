#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateOpenClawPolicyAutoApplyGate } = require("../src/v2/openclawPolicyAutoApplyGate");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function readJsonSafe(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) };
  } catch (error) {
    return { ok: false, data: null, error };
  }
}

function resolveFile(env, key, fallbackName) {
  return path.resolve(trimOrNull(env[key]) || path.join(OPS_DAILY_DIR, fallbackName));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function loadEvidence(env = process.env) {
  const files = {
    formal_live_readiness: resolveFile(env, "V2_POLICY_AUTO_APPLY_FORMAL_LIVE_READINESS_FILE", "v2_formal_live_promotion_readiness_latest.json"),
    policy_promotion_gate: resolveFile(env, "V2_POLICY_AUTO_APPLY_POLICY_PROMOTION_FILE", "v2_openclaw_policy_promotion_gate_latest.json"),
    performance_gate: resolveFile(env, "V2_POLICY_AUTO_APPLY_PERFORMANCE_GATE_FILE", "v2_performance_gate_latest.json"),
    safety_streak: resolveFile(env, "V2_POLICY_AUTO_APPLY_SAFETY_STREAK_FILE", "v2_30d_safety_streak_latest.json"),
  };
  const loaded = Object.fromEntries(Object.entries(files).map(([key, file]) => [key, { file, ...readJsonSafe(file) }]));
  return { files, loaded };
}

function main(env = process.env) {
  const outputFile = path.resolve(trimOrNull(env.V2_POLICY_AUTO_APPLY_OUTPUT_FILE) || path.join(OPS_DAILY_DIR, "v2_openclaw_policy_auto_apply_gate_latest.json"));
  const { files, loaded } = loadEvidence(env);
  const evidenceLoadBlockers = [];
  Object.entries(loaded).forEach(([key, row]) => {
    if (row.ok !== true) evidenceLoadBlockers.push(`POLICY_AUTO_APPLY:EVIDENCE_${key.toUpperCase()}_MISSING`);
  });
  const result = evaluateOpenClawPolicyAutoApplyGate({
    env,
    formalLiveReadiness: loaded.formal_live_readiness.data,
    policyPromotionGate: loaded.policy_promotion_gate.data,
    performanceGate: loaded.performance_gate.data,
    safetyStreak: loaded.safety_streak.data,
  });
  const payload = Object.freeze({
    ...result,
    blockers: Object.freeze(Array.from(new Set([...(result.blockers || []), ...evidenceLoadBlockers]))),
    generated_at: new Date().toISOString(),
    evidence_files: files,
    output_file: outputFile,
  });
  writeJson(outputFile, payload);
  const line = JSON.stringify({
    ok: payload.ok && evidenceLoadBlockers.length === 0,
    reason: evidenceLoadBlockers.length ? "OPENCLAW_POLICY_AUTO_APPLY_BLOCKED" : payload.reason,
    decision: payload.decision,
    blockers: payload.blockers,
    output_file: outputFile,
  });
  if (payload.ok === true && evidenceLoadBlockers.length === 0) {
    console.log(line);
  } else {
    console.error(line);
    if (String(env.V2_POLICY_AUTO_APPLY_SOFT || "0") !== "1") process.exitCode = 1;
  }
  return payload;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "OPENCLAW_POLICY_AUTO_APPLY_GATE_THROWN",
      blockers: ["POLICY_AUTO_APPLY:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    loadEvidence,
    __test: {
      trimOrNull,
      readJsonSafe,
      resolveFile,
    },
  };
}
