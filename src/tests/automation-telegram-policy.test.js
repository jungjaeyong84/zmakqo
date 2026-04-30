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
  assert.strictEqual(classifyAutomationTelegramTitle("[4차 EV/시간가치층 복합 기대값 자동 조정] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[V2 기대값 게이트 자동 점검] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[V2 retired timing evidence] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[V2 OpenClaw 학습 점검] BINANCEFUT"), "TUNING");
  assert.strictEqual(classifyAutomationTelegramTitle("[자산] BINANCEFUT"), "ESSENTIAL");
  assert.strictEqual(classifyAutomationTelegramTitle("[ETHUSDT] TP1"), "ESSENTIAL");
  assert.strictEqual(classifyAutomationTelegramTitle("[BTCUSDT] TRAIL_EXIT"), "ESSENTIAL");
  assert.strictEqual(classifyAutomationTelegramTitle("[지연복구] [ETHUSDT] TP1"), "ESSENTIAL");

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
    title: "[ETHUSDT] TP1",
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
  assert.strictEqual(
    sanitizeTelegramTitle("[4차 EV/시간가치층 복합 기대값 자동 조정] BINANCEFUT"),
    "[V2 기대값 게이트 자동 점검] BINANCEFUT"
  );
  assert.strictEqual(
    sanitizeTelegramTitle("[5차 진입 타이밍 자동 조정] BINANCEFUT"),
    "[V2 retired timing evidence] BINANCEFUT"
  );
  assert.strictEqual(
    sanitizeTelegramTitle("[Claude 주간 패치 엔진] HOLD"),
    "[Codex 주간 패치 엔진] HOLD"
  );
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

  const v2Sanitized = sanitizeTelegramSections([
    {
      header: "BEST/FEBT 공통 계약",
      lines: [
        "1차 상태/무결성 KEEP / 4차 EV/시간가치층 BLOCK",
        "5차 WAIT 타이밍층 legacy WAIT coverage / FEBT Phase0",
        "공통 목표 미달 / BEST/FEBT contract NORMAL",
      ],
    },
  ]);
  const v2Text = JSON.stringify(v2Sanitized);
  for (const legacy of [
    "1차 상태/무결성",
    "4차 EV/시간가치층",
    "5차 WAIT 타이밍층",
    "legacy WAIT",
    "FEBT Phase0",
    "BEST/FEBT",
    "공통 목표",
  ]) {
    assert.strictEqual(v2Text.includes(legacy), false, legacy);
  }
  assert.ok(v2Text.includes("V2 Discovery 기회 보존 계약"));
  assert.ok(v2Text.includes("V2 신호 기준/서버 정본"));
  assert.ok(v2Text.includes("V2 기대값 게이트"));

  console.log("AUTOMATION_TELEGRAM_POLICY_TEST_OK");
}

run();
