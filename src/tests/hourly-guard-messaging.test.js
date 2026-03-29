"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-hourly-guard");

(() => {
  const signalPhysics = {
    display_state: "혼돈 임계",
    action: "DROP",
    qty_scale: 0,
    wait_hard: true,
    wait_assist: false,
    critical_rate: 0.5,
    disordered_rate: 0.25,
    free_energy: 0.7,
  };
  const dropPhysics = {
    display_state: "질서 우세",
    action: "ALLOW",
    qty_scale: 1,
    wait_hard: false,
    wait_assist: false,
    critical_rate: 0.1,
    disordered_rate: 0.2,
    free_energy: 0.3,
  };

  const line = __test.buildHourlyPhysicsLine("신호", signalPhysics);
  assert.ok(line.includes("action DROP"));
  assert.ok(line.includes("wait HARD"));

  const sections = __test.buildHourlyGuardTelegramSections({
    findings: ["STAT_PHYSICS_CRITICAL", "DROP 증가"],
    recentSignals: [{ id: 1 }, { id: 2 }],
    recentDropped: [{ id: 3 }],
    gatePass: 4,
    integrity: { issue_count: 1 },
    report: { system_error_count_24h: 2 },
    signalPhysics,
    dropPhysics,
    action: "신규 진입 중지 후 원인 확인",
  });

  assert.strictEqual(Array.isArray(sections), true);
  assert.strictEqual(sections[1].header, "상태층(시장 물리)");
  assert.ok(sections[1].lines[0].includes("action DROP"));
  assert.ok(sections[1].lines[0].includes("wait HARD"));
  assert.ok(sections[1].lines[1].includes("action ALLOW"));

  console.log("HOURLY_GUARD_MESSAGING_TEST_OK");
})();
