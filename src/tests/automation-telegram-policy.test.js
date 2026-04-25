"use strict";

const assert = require("assert");
const {
  classifyAutomationTelegramTitle,
  resolveAutomationTelegramPolicyDecision,
  sanitizeTelegramTitle,
  sanitizeTelegramSections,
} = require("../../scripts/lib/automation-utils");

function run() {
  delete process.env.AUTOMATION_TELEGRAM_POLICY;
  delete process.env.AUTOMATION_TELEGRAM_ALLOW_TITLES;
  delete process.env.AUTOMATION_TELEGRAM_MUTE_TITLES;

  assert.strictEqual(classifyAutomationTelegramTitle("[목표] HOLD"), "ESSENTIAL");
  assert.strictEqual(classifyAutomationTelegramTitle("[4차 EV/시간가치층 자동 조정] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[V2 OpenClaw 학습 점검] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[자산] BINANCEFUT"), "ESSENTIAL");

  let decision = resolveAutomationTelegramPolicyDecision({
    title: "[4차 EV/시간가치층 자동 조정] BINANCEFUT",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, false);
  assert.strictEqual(decision.policy_mode, "ESSENTIAL_ONLY");

  decision = resolveAutomationTelegramPolicyDecision({
    title: "[목표] PATCH_CANDIDATE",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, true);

  decision = resolveAutomationTelegramPolicyDecision({
    title: "[일일 운영 점검] FAIL",
    severity: "INFO",
  });
  assert.strictEqual(decision.send, false);

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

  assert.strictEqual(sanitizeTelegramTitle("[Pine shadow 점검]"), "[OpenClaw 업데이트]");
  const sanitized = sanitizeTelegramSections([
    {
      header: "OpenClaw 요약",
      lines: [
        "server ready",
        "PINE_SHADOW_COMPARE_ONLY",
        "shadow gap review",
      ],
    },
    {
      header: "pine details",
      lines: ["pine primary"],
    },
  ]);
  assert.deepStrictEqual(sanitized, [
    {
      header: "OpenClaw 요약",
      lines: ["server ready"],
    },
  ]);

  console.log("AUTOMATION_TELEGRAM_POLICY_TEST_OK");
}

run();
