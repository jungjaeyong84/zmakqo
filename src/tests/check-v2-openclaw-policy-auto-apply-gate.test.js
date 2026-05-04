"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main } = require("../../scripts/check-v2-openclaw-policy-auto-apply-gate");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-policy-auto-apply-gate-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function baseEnv(tmp, overrides = {}) {
  return {
    V2_POLICY_AUTO_APPLY_FORMAL_LIVE_READINESS_FILE: path.join(tmp, "formal.json"),
    V2_POLICY_AUTO_APPLY_POLICY_PROMOTION_FILE: path.join(tmp, "promotion.json"),
    V2_POLICY_AUTO_APPLY_PERFORMANCE_GATE_FILE: path.join(tmp, "performance.json"),
    V2_POLICY_AUTO_APPLY_SAFETY_STREAK_FILE: path.join(tmp, "safety.json"),
    V2_POLICY_AUTO_APPLY_OUTPUT_FILE: path.join(tmp, "out.json"),
    DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "1",
    OPENCLAW_AGENT_APPLY_ENABLED: "1",
    ML_LIVE_SERVING_ARMED: "1",
    OPENCLAW_CONDUCTOR_SHADOW_ONLY: "0",
    OPENCLAW_NARRATIVE_SHADOW_ONLY: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_PAID_AI_API_DISABLED: "1",
    OPENCLAW_NARRATIVE_PROVIDER_MODE: "CODEX_CLI_ONLY",
    DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "V2_ONLY_OPENCLAW",
    V2_POLICY_AUTO_APPLY_SOFT: "1",
    ...overrides,
  };
}

function writePassingEvidence(env) {
  writeJson(env.V2_POLICY_AUTO_APPLY_FORMAL_LIVE_READINESS_FILE, { ok: true, reason: "FORMAL_READY", blockers: [] });
  writeJson(env.V2_POLICY_AUTO_APPLY_POLICY_PROMOTION_FILE, { ok: true, reason: "PROMOTION_PASS", blockers: [] });
  writeJson(env.V2_POLICY_AUTO_APPLY_PERFORMANCE_GATE_FILE, { ok: true, reason: "PERFORMANCE_PASS", blockers: [] });
  writeJson(env.V2_POLICY_AUTO_APPLY_SAFETY_STREAK_FILE, { ok: true, reason: "SAFETY_PASS", blockers: [] });
}

{
  const tmp = mkTmp();
  const env = baseEnv(tmp);
  writePassingEvidence(env);
  const result = main(env);
  assert.strictEqual(result.ok, true);
  assert.ok(fs.existsSync(env.V2_POLICY_AUTO_APPLY_OUTPUT_FILE));
}

{
  const tmp = mkTmp();
  const env = baseEnv(tmp, { DONBEOLJA_V2_OPENCLAW_POLICY_AUTO_APPLY_ENABLED: "0" });
  writePassingEvidence(env);
  const result = main(env);
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:EXPLICIT_ENABLE_REQUIRED"));
}

{
  const tmp = mkTmp();
  const env = baseEnv(tmp);
  writeJson(env.V2_POLICY_AUTO_APPLY_FORMAL_LIVE_READINESS_FILE, { ok: false, reason: "FORMAL_BLOCKED", blockers: ["FORMAL_LIVE_PROMOTION:SAMPLE_INSUFFICIENT"] });
  writeJson(env.V2_POLICY_AUTO_APPLY_POLICY_PROMOTION_FILE, { ok: true, reason: "PROMOTION_PASS", blockers: [] });
  writeJson(env.V2_POLICY_AUTO_APPLY_PERFORMANCE_GATE_FILE, { ok: false, reason: "PERFORMANCE_BLOCKED", blockers: ["PERFORMANCE_GATE:EXPECTANCY_NOT_POSITIVE"] });
  writeJson(env.V2_POLICY_AUTO_APPLY_SAFETY_STREAK_FILE, { ok: false, reason: "SAFETY_BLOCKED", blockers: ["SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS"] });
  const result = main(env);
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:FORMAL_LIVE_READINESS_NOT_PASS"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:PERFORMANCE_GATE_NOT_PASS"));
  assert.ok(result.blockers.includes("POLICY_AUTO_APPLY:SAFETY_STREAK_NOT_PASS"));
}

console.log("CHECK_V2_OPENCLAW_POLICY_AUTO_APPLY_GATE_TEST_OK");
