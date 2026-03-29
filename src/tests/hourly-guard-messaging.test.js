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
  const signalFebt = {
    calc_ok_rate: 0.75,
    phase_known_rate: 0.75,
    fire_n: 3,
    late_n: 1,
    void_n: 0,
    disagreement_n: 2,
    fallback_legacy_n: 1,
    top_verdict: "ALLOW_CANDIDATE",
  };
  const dropFebt = {
    calc_ok_rate: 0.50,
    phase_known_rate: 0.50,
    fire_n: 0,
    late_n: 2,
    void_n: 1,
    disagreement_n: 1,
    fallback_legacy_n: 2,
    top_verdict: "BLOCK_CANDIDATE",
  };
  const phase0 = {
    legacy_wait_coverage_rate: 0.62,
    immediate_win_rate: 0.57,
    saved_loss_pct: 0.31,
    missed_gain_pct: 0.12,
    saved_loss_minus_missed_gain: 0.19,
  };

  const line = __test.buildHourlyPhysicsLine("신호", signalPhysics);
  assert.ok(line.includes("action DROP"));
  assert.ok(line.includes("wait HARD"));
  const febtLine = __test.buildHourlyFebtLine("신호", signalFebt);
  assert.ok(febtLine.includes("calc 75%"));
  assert.ok(febtLine.includes("disagree 2"));

  const sections = __test.buildHourlyGuardTelegramSections({
    findings: ["STAT_PHYSICS_CRITICAL", "DROP 증가"],
    recentSignals: [{ id: 1 }, { id: 2 }],
    recentDropped: [{ id: 3 }],
    gatePass: 4,
    integrity: { issue_count: 1 },
    report: { system_error_count_24h: 2 },
    signalPhysics,
    dropPhysics,
    signalFebt,
    dropFebt,
    phase0,
    action: "신규 진입 중지 후 원인 확인",
  });

  assert.strictEqual(Array.isArray(sections), true);
  assert.strictEqual(sections[1].header, "상태층(시장 물리)");
  assert.ok(sections[1].lines[0].includes("action DROP"));
  assert.ok(sections[1].lines[0].includes("wait HARD"));
  assert.ok(sections[1].lines[1].includes("action ALLOW"));
  assert.strictEqual(sections[2].header, "FEBT SHADOW");
  assert.ok(sections[2].lines[0].includes("fire 3"));
  assert.ok(sections[2].lines[1].includes("fallback 2"));
  assert.ok(sections[2].lines[2].includes("saved_loss 31%"));

  console.log("HOURLY_GUARD_MESSAGING_TEST_OK");
})();
