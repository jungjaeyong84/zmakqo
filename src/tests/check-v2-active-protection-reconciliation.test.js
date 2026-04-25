"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/check-v2-active-protection-reconciliation");

(() => {
  const pass = __test.summarizeActiveProtection({
    ok: true,
    exchange: "BINANCEFUT",
    issue_count: 0,
    issues: [],
    markets: [
      { symbol: "BNBUSDT", internal_active: true, external_active: true },
      { symbol: "SOLUSDT", internal_active: false, external_active: false },
    ],
  });
  assert.strictEqual(pass.ok, true);
  assert.strictEqual(pass.reason, "V2_ACTIVE_PROTECTION_RECONCILIATION_PASS");
  assert.strictEqual(pass.active_position_n, 1);
  assert.strictEqual(pass.protected_position_n, 1);
  assert.strictEqual(pass.unprotected_position_n, 0);

  const warnOnly = __test.summarizeActiveProtection({
    ok: false,
    exchange: "BINANCEFUT",
    issue_count: 1,
    issues: [{ symbol: "ETHUSDT", severity: "WARN", code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE" }],
    markets: [{ symbol: "ETHUSDT", internal_active: false, external_active: true }],
  });
  assert.strictEqual(warnOnly.ok, true);
  assert.strictEqual(warnOnly.protected_position_n, 1);
  assert.strictEqual(warnOnly.unprotected_position_n, 0);

  const blocked = __test.summarizeActiveProtection({
    ok: false,
    exchange: "BINANCEFUT",
    issue_count: 1,
    issues: [
      { symbol: "XRPUSDT", severity: "CRIT", code: "NATIVE_TP1_MISSING" },
      { symbol: "ETHUSDT", severity: "WARN", code: "NATIVE_ALGO_ORDER_VERIFY_UNAVAILABLE" },
    ],
    markets: [
      { symbol: "XRPUSDT", internal_active: true, external_active: true },
      { symbol: "ETHUSDT", internal_active: false, external_active: true },
    ],
  });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.reason, "V2_ACTIVE_PROTECTION_RECONCILIATION_BLOCKED");
  assert.strictEqual(blocked.active_position_n, 2);
  assert.strictEqual(blocked.protected_position_n, 1);
  assert.strictEqual(blocked.unprotected_position_n, 1);
  assert.deepStrictEqual(blocked.unprotected_symbols, ["XRPUSDT"]);
  assert.ok(__test.buildAlertBody(blocked).includes("protected=1/2"));
  assert.strictEqual(__test.boolEnv("1"), true);
  assert.strictEqual(__test.boolEnv("0", true), false);

  console.log("CHECK_V2_ACTIVE_PROTECTION_RECONCILIATION_TEST_OK");
})();
