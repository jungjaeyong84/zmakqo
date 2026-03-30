"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/post-apply-signal-probe");

(() => {
  const verification = __test.buildVerification([
    {
      event: "LONG",
      side: "BUY",
      features_json: {
        entry_grade: "CORE",
        trace_payload_version: "TPTR_V2",
        febt_mode: "SHADOW",
        febt_phase: "ARMED",
        febt_calc_ok: true,
        febt_calc_reason: "OK",
        febt_timing_action: "OBSERVE",
        febt_authority: "SHADOW_ONLY",
      },
    },
    {
      event: "SHORT",
      side: "SELL",
      features_json: {
        trace_payload_version: "TPTR_V2",
        febt_mode: "SHADOW",
        febt_phase: "ARMED",
        febt_calc_ok: true,
        febt_calc_reason: "OK",
        febt_timing_action: "OBSERVE",
        febt_authority: "SHADOW_ONLY",
      },
    },
  ]);

  assert.strictEqual(verification.active_entry_taxonomy, "ACTIVE_ENTRY_FAMILY");
  assert.strictEqual(verification.active_trace_payload_version_count, 2);
  assert.strictEqual(verification.active_febt_contract_count, 2);
  assert.ok(verification.active_entry_family_counts.some((row) => row.key === "CORE_LONG" && row.count === 1));
  assert.ok(verification.active_entry_family_counts.some((row) => row.key === "EARLY_SHORT" && row.count === 1));

  console.log("POST_APPLY_SIGNAL_PROBE_TEST_OK");
})();
