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

  console.log("PINE_STRATEGY_OWNER_CYCLE_TEST_OK");
})();
