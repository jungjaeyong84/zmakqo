const assert = require("assert");
const { deriveServerSignalCutoverReadiness } = require("../utils/serverSignalCutoverReadiness");

function toKstStringFromMs(ms) {
  const d = new Date(Number(ms) + (9 * 60 * 60 * 1000));
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} KST`;
}

function buildBaseInputs({ nowMs, parityGeneratedMs }) {
  const cycleId = "best_self_evolution_2026-04-02_2113_post_apply";
  return {
    authority: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {
        source_mode: "PINE_PRIMARY",
        drift_status: "PARITY_MATCH",
        pine_shadow_24h_n: 10,
        parity_mismatch_n: 0,
      },
    },
    quality: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {
        quality_status: "OK",
        authoritative_entry_signal_24h_n: 3,
        order_intent_24h_n: 3,
        fill_24h_n: 3,
      },
    },
    parity: {
      generated_at_kst: toKstStringFromMs(parityGeneratedMs),
      cycle_id: cycleId,
      summary: {
        source_parity_mismatch_n: 0,
        final_downstream_mismatch_n: 0,
        by_actual_drop_reason_family: [],
      },
      rows: [],
    },
    runtime: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {
        runtime_status: "READY",
        canonical_engine_source_mode: "PINE_PRIMARY",
        exec_tf: "15m",
        market_count: 7,
      },
    },
    evGateRescue: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {},
    },
    strategyAlignment: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {},
    },
    serverPrimaryCanary: {
      generated_at_kst: toKstStringFromMs(nowMs),
      cycle_id: cycleId,
      summary: {
        acceptance_ready: true,
        acceptance_reason: "OK",
      },
    },
  };
}

(() => {
  const prevFreshness = process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS;
  const prevSkew = process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS;
  const prevRequireFresh = process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS;
  const prevRequireCycle = process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS = "60000";
    process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS = "10000";
    process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS = "1";
    process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT = "0";

    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - (5 * 60 * 1000) });
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(blockers.includes("ARTIFACT_FRESHNESS_STALE"));
    assert.ok(blockers.includes("ARTIFACT_GENERATED_AT_SKEW_EXCEEDED"));
    assert.strictEqual(out.current_status.artifact_coherence_status, "BLOCKED");
    assert.strictEqual(out.current_status.artifact_coherence_ready, false);
    assert.strictEqual(out.current_status.artifact_generated_at_skew_exceeded, true);
    assert.strictEqual(out.current_status.artifact_generated_at_skew_exceeded_effective, true);
    assert.strictEqual(out.current_status.artifact_coherence_reason, "ARTIFACT_FRESHNESS_STALE");
  } finally {
    if (prevFreshness === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS;
    else process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS = prevFreshness;
    if (prevSkew === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS;
    else process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS = prevSkew;
    if (prevRequireFresh === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS;
    else process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS = prevRequireFresh;
    if (prevRequireCycle === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT;
    else process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT = prevRequireCycle;
  }
})();

(() => {
  const prevFreshness = process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS;
  const prevSkew = process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS;
  const prevRequireFresh = process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS;
  const prevRequireCycle = process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS = "3600000";
    process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS = "600000";
    process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS = "1";
    process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT = "0";

    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(!blockers.some((x) => String(x).startsWith("ARTIFACT_")));
    assert.strictEqual(out.current_status.artifact_coherence_status, "READY");
    assert.strictEqual(out.current_status.artifact_coherence_ready, true);
    assert.strictEqual(out.current_status.artifact_coherence_reason, "READY");
  } finally {
    if (prevFreshness === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS;
    else process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_FRESHNESS_SLA_MS = prevFreshness;
    if (prevSkew === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS;
    else process.env.SERVER_SIGNAL_CUTOVER_ARTIFACT_SKEW_MAX_MS = prevSkew;
    if (prevRequireFresh === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS;
    else process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_ARTIFACT_FRESHNESS = prevRequireFresh;
    if (prevRequireCycle === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT;
    else process.env.SERVER_SIGNAL_CUTOVER_REQUIRE_CYCLE_ALIGNMENT = prevRequireCycle;
  }
})();

(() => {
  const prevCooldownMin = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN = "2";
    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    inputs.parity.summary.final_downstream_mismatch_n = 1;
    inputs.parity.summary.by_actual_drop_reason_family = [
      { key: "COOLDOWN_POLICY", count: 1 },
    ];
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(!blockers.includes("COOLDOWN_POLICY_DRIFT_ACTIVE"));
    assert.ok(blockers.includes("FINAL_DOWNSTREAM_MISMATCH_ACTIVE"));
  } finally {
    if (prevCooldownMin === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN = prevCooldownMin;
  }
})();

(() => {
  const prevCooldownMin = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN = "2";
    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    inputs.parity.summary.final_downstream_mismatch_n = 2;
    inputs.parity.summary.by_actual_drop_reason_family = [
      { key: "COOLDOWN_POLICY", count: 2 },
    ];
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(blockers.includes("COOLDOWN_POLICY_DRIFT_ACTIVE"));
  } finally {
    if (prevCooldownMin === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_COOLDOWN_POLICY_MISMATCH_MIN = prevCooldownMin;
  }
})();

(() => {
  const prevFinalMismatchBlockInPrimary = process.env.SERVER_SIGNAL_CUTOVER_FINAL_MISMATCH_BLOCK_IN_PRIMARY;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_FINAL_MISMATCH_BLOCK_IN_PRIMARY = "0";
    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    inputs.authority.summary.source_mode = "SERVER_PRIMARY";
    inputs.runtime.summary.canonical_engine_source_mode = "SERVER_PRIMARY";
    inputs.parity.summary.final_downstream_mismatch_n = 1;
    inputs.parity.summary.by_actual_drop_reason_family = [
      { key: "OTHER_SERVER_POLICY", count: 1 },
    ];
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    const blockerActions = Array.isArray(out.summary && out.summary.blocker_actions) ? out.summary.blocker_actions : [];
    assert.ok(!blockers.includes("FINAL_DOWNSTREAM_MISMATCH_ACTIVE"));
    assert.strictEqual(out.summary.final_downstream_mismatch_monitor_only, true);
    assert.ok(blockerActions.some((row) => row && row.family === "FINAL_DOWNSTREAM_MISMATCH" && row.action === "MONITOR_ON_SERVER_PRIMARY"));
  } finally {
    if (prevFinalMismatchBlockInPrimary === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_FINAL_MISMATCH_BLOCK_IN_PRIMARY;
    else process.env.SERVER_SIGNAL_CUTOVER_FINAL_MISMATCH_BLOCK_IN_PRIMARY = prevFinalMismatchBlockInPrimary;
  }
})();

(() => {
  const prevOtherBlockMin = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN;
  const prevOtherInPrimary = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN = "2";
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY = "0";
    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    inputs.authority.summary.source_mode = "SERVER_PRIMARY";
    inputs.runtime.summary.canonical_engine_source_mode = "SERVER_PRIMARY";
    inputs.parity.summary.final_downstream_mismatch_n = 1;
    inputs.parity.summary.by_actual_drop_reason_family = [
      { key: "OTHER_SERVER_POLICY", count: 1 },
    ];
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(!blockers.includes("OTHER_SERVER_POLICY_DRIFT_ACTIVE"));
    assert.strictEqual(out.current_status.other_server_policy_monitor_only, true);
  } finally {
    if (prevOtherBlockMin === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN = prevOtherBlockMin;
    if (prevOtherInPrimary === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY = prevOtherInPrimary;
  }
})();

(() => {
  const prevOtherBlockMin = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN;
  const prevOtherInPrimary = process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY;
  try {
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN = "2";
    process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY = "0";
    const nowMs = Date.now();
    const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
    inputs.authority.summary.source_mode = "PINE_PRIMARY";
    inputs.runtime.summary.canonical_engine_source_mode = "PINE_PRIMARY";
    inputs.parity.summary.final_downstream_mismatch_n = 2;
    inputs.parity.summary.by_actual_drop_reason_family = [
      { key: "OTHER_SERVER_POLICY", count: 2 },
    ];
    const out = deriveServerSignalCutoverReadiness(inputs);
    const blockers = Array.isArray(out.summary && out.summary.blockers) ? out.summary.blockers : [];
    assert.ok(blockers.includes("OTHER_SERVER_POLICY_DRIFT_ACTIVE"));
  } finally {
    if (prevOtherBlockMin === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_MISMATCH_MIN = prevOtherBlockMin;
    if (prevOtherInPrimary === undefined) delete process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY;
    else process.env.SERVER_SIGNAL_CUTOVER_BLOCK_OTHER_SERVER_POLICY_IN_PRIMARY = prevOtherInPrimary;
  }
})();

(() => {
  const nowMs = Date.now();
  const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
  inputs.authority.summary.source_mode = "SERVER_PRIMARY";
  inputs.runtime.summary.canonical_engine_source_mode = "SERVER_PRIMARY";
  inputs.serverPrimaryCanary.summary.acceptance_ready = false;
  inputs.serverPrimaryCanary.summary.acceptance_reason = "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT";
  inputs.parity.summary.final_downstream_mismatch_n = 2;
  inputs.parity.summary.by_actual_drop_reason_family = [
    { key: "COOLDOWN_POLICY", count: 2 },
  ];
  const out = deriveServerSignalCutoverReadiness(inputs);
  assert.strictEqual(out.summary.readiness_status, "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT");
  assert.strictEqual(out.summary.already_server_primary, true);
  assert.strictEqual(out.summary.promotion_gate_status, "BLOCKED");
  assert.ok(out.summary.promotion_block_reasons.includes("COOLDOWN_POLICY_DRIFT_ACTIVE"));
  assert.ok(out.summary.promotion_block_reasons.includes("SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT"));
})();

(() => {
  const nowMs = Date.now();
  const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
  inputs.authority.summary.source_mode = "SERVER_PRIMARY";
  inputs.runtime.summary.canonical_engine_source_mode = "SERVER_PRIMARY";
  inputs.parity.rows = [
    {
      observation_ms: nowMs - 500,
      parity_match: false,
      actual_drop_reason_family: "EV_POLICY",
      actual_drop_reason: "DROP_EV_GATE_TP1_PROB",
    },
  ];
  inputs.parity.summary.final_downstream_mismatch_n = 1;
  inputs.parity.summary.by_actual_drop_reason_family = [
    { key: "EV_POLICY", count: 1 },
  ];
  inputs.driftRemediationApply = {
    applied: true,
    generated_at_kst: toKstStringFromMs(nowMs - 1000),
    exception_release_applied: true,
    ev_policy_patch_applied: false,
    ev_policy_patch_report_only_applied: true,
    ev_policy_patch_requested_n: 2,
    ev_policy_patch_applied_n: 0,
    ev_policy_patch_report_only_applied_n: 2,
  };
  const out = deriveServerSignalCutoverReadiness(inputs);
  assert.strictEqual(out.current_status.ev_policy_remediation_applied, true);
  assert.strictEqual(out.current_status.learning_epoch_exception_release_applied, true);
  assert.strictEqual(out.current_status.ev_policy_patch_applied, false);
  assert.strictEqual(out.current_status.ev_policy_patch_report_only_applied, true);
  assert.strictEqual(out.current_status.ev_policy_effective_patch_applied, true);
  assert.strictEqual(out.current_status.ev_policy_patch_requested_n, 2);
  assert.strictEqual(out.current_status.ev_policy_patch_applied_n, 0);
  assert.strictEqual(out.current_status.ev_policy_patch_report_only_applied_n, 2);
  assert.strictEqual(out.current_status.ev_policy_post_apply_tracking_active, true);
  assert.strictEqual(out.current_status.ev_policy_post_apply_comparable_n, 1);
})();

(() => {
  const nowMs = Date.now();
  const lastAppliedMs = nowMs - (2 * 60 * 60 * 1000);
  const generatedMs = nowMs - (30 * 1000);
  const inputs = buildBaseInputs({ nowMs, parityGeneratedMs: nowMs - 1000 });
  inputs.authority.summary.source_mode = "SERVER_PRIMARY";
  inputs.runtime.summary.canonical_engine_source_mode = "SERVER_PRIMARY";
  inputs.parity.rows = [
    {
      observation_ms: lastAppliedMs + 60 * 1000,
      parity_match: false,
      actual_drop_reason_family: "EV_POLICY",
      actual_drop_reason: "DROP_EV_GATE_TP1_PROB",
    },
  ];
  inputs.parity.summary.final_downstream_mismatch_n = 1;
  inputs.parity.summary.by_actual_drop_reason_family = [
    { key: "EV_POLICY", count: 1 },
  ];
  inputs.driftRemediationApply = {
    applied: true,
    generated_at_kst: toKstStringFromMs(generatedMs),
    last_applied_at_kst: toKstStringFromMs(lastAppliedMs),
    exception_release_applied: true,
    ev_policy_patch_applied: false,
    ev_policy_patch_report_only_applied: true,
    ev_policy_patch_requested_n: 2,
    ev_policy_patch_applied_n: 0,
    ev_policy_patch_report_only_applied_n: 2,
  };
  const out = deriveServerSignalCutoverReadiness(inputs);
  assert.strictEqual(out.current_status.ev_policy_remediation_applied_at_kst, toKstStringFromMs(lastAppliedMs));
  assert.strictEqual(out.current_status.ev_policy_post_apply_comparable_n, 1);
})();

console.log("SERVER_SIGNAL_CUTOVER_READINESS_TEST_OK");
