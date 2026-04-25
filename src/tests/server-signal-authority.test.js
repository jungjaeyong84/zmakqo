"use strict";

const assert = require("assert");
const { deriveServerSignalAuthority, __test } = require("../utils/serverSignalAuthority");

{
  const report = deriveServerSignalAuthority({
    signalsRecent: {
      docs: [
        {
          authoritative: true,
          source: "SERVER",
          symbol: "BTCUSDT",
          created_at: "2026-04-24T00:00:00.000Z",
        },
        {
          source: "PINE_SHADOW",
          symbol: "BTCUSDT",
          created_at: "2026-04-24T00:15:00.000Z",
        },
      ],
    },
    parityReport: {
      summary: {
        source_mode: "SERVER_PRIMARY",
        shadow_observed_n: 10,
        parity_mismatch_rate: 0.76,
        parity_mismatch_n: 8,
      },
    },
    nowMs: Date.parse("2026-04-24T01:00:00.000Z"),
  });
  assert.strictEqual(report.summary.source_mode, "SERVER_PRIMARY");
  assert.strictEqual(report.summary.execution_authority, "SERVER_PRIMARY_AUTHORITATIVE");
  assert.strictEqual(report.summary.pine_role, "VISUAL_SHADOW_ONLY");
  assert.strictEqual(report.summary.drift_status, "PARITY_DRIFT");
  assert.strictEqual(report.summary.parity_claim, "DO_NOT_CLAIM_PINE_SERVER_IDENTICAL");
}

{
  assert.strictEqual(__test.executionAuthorityForSourceMode("PINE_PRIMARY"), "PINE_PRIMARY_AUTHORITATIVE");
  assert.strictEqual(__test.pineRoleForSourceMode("PINE_PRIMARY"), "EXECUTION_AUTHORITY");
  assert.strictEqual(__test.parityClaimForStatus("PARITY_STABLE"), "PARITY_STABLE");
  assert.strictEqual(__test.parityClaimForStatus("PARITY_WATCH"), "DO_NOT_CLAIM_PINE_SERVER_IDENTICAL");
}

console.log("SERVER_SIGNAL_AUTHORITY_TEST_OK");
