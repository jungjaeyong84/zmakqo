"use strict";

const assert = require("assert");
const { deriveServerPrimaryAcceptanceWatch } = require("../../src/utils/serverPrimaryAcceptanceWatch");

(() => {
  const pending = deriveServerPrimaryAcceptanceWatch({
    autonomyContract: { phase_d_policy: { min_server_primary_executed_n: 2, max_server_primary_disagreement_rate: 0.15, max_server_primary_rollback_trigger_n: 0 } },
    serverPrimaryCanary: { summary: { configured_server_primary_markets: ["AXSUSDT"], row_n: 1, server_primary_executed_n: 1, server_primary_realized_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0, apply_pass: true, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", acceptance_ready: false } },
  });
  assert.strictEqual(pending.summary.phase_d_status, "PENDING");
  assert.strictEqual(pending.summary.phase_d_ready, false);

  const ready = deriveServerPrimaryAcceptanceWatch({
    autonomyContract: { phase_d_policy: { min_server_primary_executed_n: 2, max_server_primary_disagreement_rate: 0.15, max_server_primary_rollback_trigger_n: 0 } },
    serverPrimaryCanary: { summary: { configured_server_primary_markets: ["AXSUSDT"], row_n: 2, server_primary_executed_n: 2, server_primary_realized_n: 1, pine_shadow_disagreement_rate: 0.1, rollback_trigger_n: 0, apply_pass: true, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_READY", acceptance_ready: true } },
  });
  assert.strictEqual(ready.summary.phase_d_status, "READY");
  assert.strictEqual(ready.summary.phase_d_ready, true);

  const fallbackReady = deriveServerPrimaryAcceptanceWatch({
    autonomyContract: { phase_d_policy: { min_server_primary_executed_n: 2, max_server_primary_disagreement_rate: 0.15, max_server_primary_rollback_trigger_n: 0 } },
    serverPrimaryCanary: { summary: { configured_server_primary_markets: [], configured_server_primary_markets_n: 0, server_primary_markets_n: 7, row_n: 13, server_primary_executed_n: 13, server_primary_realized_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0, apply_pass: true, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_READY", acceptance_ready: true } },
    cutoverReadiness: { summary: { runtime_market_count: 7 } },
    serverRuntime: { summary: { market_count: 7 } },
  });
  assert.strictEqual(fallbackReady.summary.configured_server_primary_markets_n, 7);
  assert.strictEqual(fallbackReady.summary.phase_d_status, "READY");
  console.log("SERVER_PRIMARY_ACCEPTANCE_WATCH_TEST_OK");
})();
