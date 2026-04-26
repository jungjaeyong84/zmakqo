"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/check-v2-system-settings-live-disabled");

(function blocksFirestoreLiveEnabledDuringDiscoveryCanary() {
  const result = __test.evaluateSystemSettingsLiveDisabled({
    provider: "BINANCEFUT",
    settings: { execution_mode: "LIVE", live_enabled: true },
    source: "fixture",
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("SYSTEM_SETTINGS:LIVE_ENABLED_MUST_BE_FALSE_FOR_DISCOVERY_CANARY"));
})();

(function passesWhenLiveEnabledIsFalse() {
  const result = __test.evaluateSystemSettingsLiveDisabled({
    provider: "BINANCEFUT",
    settings: { execution_mode: "LIVE", live_enabled: false },
    source: "fixture",
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
    },
  });
  assert.strictEqual(result.ok, true);
})();

(function formalLiveOverrideIsExplicitOnly() {
  const blocked = __test.evaluateSystemSettingsLiveDisabled({
    settings: { execution_mode: "LIVE", live_enabled: true },
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
    },
  });
  assert.strictEqual(blocked.ok, false);

  const allowed = __test.evaluateSystemSettingsLiveDisabled({
    settings: { execution_mode: "LIVE", live_enabled: true },
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_CANARY_ONLY: "1",
      DONBEOLJA_V2_ALLOW_SYSTEM_SETTINGS_LIVE_ENABLED: "1",
    },
  });
  assert.strictEqual(allowed.ok, true);
})();

console.log("CHECK_V2_SYSTEM_SETTINGS_LIVE_DISABLED_TEST_OK");
