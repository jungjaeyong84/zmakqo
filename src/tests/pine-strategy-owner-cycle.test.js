"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/pine-strategy-owner-cycle");

(() => {
  const staticBoolCheck = __test.buildStaticCheck(`
    bool pre_alert_enable = false
    entry_cooldown_bars = input.int(14, "entry")
    reverse_cooldown_bars = input.int(20, "reverse")
    strategy_id_override = input.string("", "id")
    string payload = "{\\"schema_version\\":\\"DBJ_WEBHOOK_V2\\",\\"signal_key\\":\\"k\\",\\"bar_index\\":1,\\"is_bar_close_confirmed\\":true}"
    request.security(syminfo.tickerid, "15", close, lookahead = barmerge.lookahead_off)
    if barstate.isconfirmed
        alert(payload)
    string reasonA = "ENTRY_COOLDOWN"
    string reasonB = "REVERSE_COOLDOWN"
  `);

  assert.strictEqual(staticBoolCheck.pass, true);
  assert.deepStrictEqual(staticBoolCheck.missing_required, []);

  const inputBoolCheck = __test.buildStaticCheck(`
    pre_alert_enable = input.bool(false, "pre")
    entry_cooldown_bars = input.int(14, "entry")
    reverse_cooldown_bars = input.int(20, "reverse")
    strategy_id_override = input.string("", "id")
    string payload = "{\\"schema_version\\":\\"DBJ_WEBHOOK_V2\\",\\"signal_key\\":\\"k\\",\\"bar_index\\":1,\\"is_bar_close_confirmed\\":true}"
    request.security(syminfo.tickerid, "15", close, lookahead = barmerge.lookahead_off)
    if barstate.isconfirmed
        alert(payload)
    string reasonA = "ENTRY_COOLDOWN"
    string reasonB = "REVERSE_COOLDOWN"
  `);

  assert.strictEqual(inputBoolCheck.pass, true);
  assert.deepStrictEqual(inputBoolCheck.missing_required, []);

  const filteredIssues = __test.buildIssues(
    {
      cost_ratio_pct: null,
      cost_limit_pct: 0.2,
      mdd_pct: null,
      mdd_limit_pct: -1.5,
      conflict_count_conservative: 0,
      conflict_count_clock: 3,
      on_time_rate_pct: 0,
      strategy_id_mismatch_drop_count: 18,
      strategy_id_mismatch_after_revision_count: 0,
      trace_payload_version_count: 1,
      active_trace_payload_version_count: 1,
      active_febt_contract_count: 1,
      active_febt_trace_contract_missing_count: 0,
    },
    { pass: true, missing_required: [] },
    {
      staff_deadline_label: "2026-03-30 16:28:00 KST",
      reporting_active: false,
      live_drift_current: false,
      strategy_mismatch_current: false,
      preflight_results: [{ ok: true }],
    }
  );

  assert.deepStrictEqual(filteredIssues, ["[ISSUE] L | 핵심 이슈 없음 | 현재 기준 유지"]);

  console.log("PINE_STRATEGY_OWNER_CYCLE_TEST_OK");
})();
