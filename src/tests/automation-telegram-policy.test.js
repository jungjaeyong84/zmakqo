"use strict";

const assert = require("assert");
const {
  classifyAutomationTelegramTitle,
  resolveAutomationTelegramPolicyDecision,
} = require("../../scripts/lib/automation-utils");

function run() {
  delete process.env.AUTOMATION_TELEGRAM_POLICY;
  delete process.env.AUTOMATION_TELEGRAM_ALLOW_TITLES;
  delete process.env.AUTOMATION_TELEGRAM_MUTE_TITLES;

  assert.strictEqual(classifyAutomationTelegramTitle("[목표 점검] HOLD"), "ESSENTIAL");
  assert.strictEqual(classifyAutomationTelegramTitle("[4차 EV/시간가치층 자동 조정] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[시간별 자산 현황] BINANCEFUT"), "SUMMARY");

  let decision = resolveAutomationTelegramPolicyDecision({
    title: "[4차 EV/시간가치층 자동 조정] BINANCEFUT",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, false);
  assert.strictEqual(decision.policy_mode, "ESSENTIAL_ONLY");

  decision = resolveAutomationTelegramPolicyDecision({
    title: "[목표 점검] PATCH_CANDIDATE",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, true);

  decision = resolveAutomationTelegramPolicyDecision({
    title: "[주간 전략 점검] BINANCEFUT",
    severity: "WARN",
  });
  assert.strictEqual(decision.send, true);

  process.env.AUTOMATION_TELEGRAM_ALLOW_TITLES = "[주간 전략 점검]";
  decision = resolveAutomationTelegramPolicyDecision({
    title: "[주간 전략 점검] BINANCEFUT",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, true);
  delete process.env.AUTOMATION_TELEGRAM_ALLOW_TITLES;

  console.log("AUTOMATION_TELEGRAM_POLICY_TEST_OK");
}

run();
