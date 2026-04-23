"use strict";

const assert = require("assert");
const checker = require("../../scripts/check-v2-alert-runbook");

(function alertRunbookContractPasses() {
  const result = checker.evaluateAlertRunbookContract();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_ALERT_RUNBOOK_CONTRACT_OK");
  const fixtures = checker.__test.buildTaxonomyFixtures();
  const transportFixture = fixtures.find((row) => row.family === "TRANSPORT");
  assert.ok(transportFixture);
  const transportCheck = result.checks.find((row) => row.id === transportFixture.id);
  assert.ok(transportCheck);
  assert.strictEqual(transportCheck.status, "PASS");
  const governanceRow = result.checks.find((row) => row.id === "DOC_CHK_04");
  assert.ok(governanceRow);
  assert.strictEqual(governanceRow.status, "PASS");
})();

console.log("CHECK_V2_ALERT_RUNBOOK_TEST_OK");
