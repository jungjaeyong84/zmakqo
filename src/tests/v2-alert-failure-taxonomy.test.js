"use strict";

const assert = require("assert");
const {
  classifyAlertFailureReason,
  ALERT_FAILURE_TAXONOMY_CONTRACTS,
  __test,
} = require("../v2/alertFailureTaxonomy");

(function taxonomyContractsStayExplicit() {
  assert.ok(Array.isArray(ALERT_FAILURE_TAXONOMY_CONTRACTS));
  assert.strictEqual(ALERT_FAILURE_TAXONOMY_CONTRACTS.length, 5);
  for (const contract of ALERT_FAILURE_TAXONOMY_CONTRACTS) {
    assert.ok(contract.contract_id);
    assert.ok(Array.isArray(contract.sample_reasons));
    assert.ok(contract.sample_reasons.length >= 1);
    assert.ok(contract.family);
    assert.ok(contract.retry_policy_code);
    assert.ok(Array.isArray(contract.runbook_refs));
    assert.ok(contract.runbook_refs.length >= 1);
  }
})();

(function everyContractSampleClassifiesToItsOwnContract() {
  for (const contract of ALERT_FAILURE_TAXONOMY_CONTRACTS) {
    const sample = contract.sample_reasons[0];
    const actual = classifyAlertFailureReason(sample);
    assert.strictEqual(actual.family, contract.family, contract.contract_id);
    assert.strictEqual(actual.retryable, contract.retryable, contract.contract_id);
    assert.strictEqual(actual.terminal, contract.terminal, contract.contract_id);
    assert.strictEqual(actual.retry_policy_code, contract.retry_policy_code, contract.contract_id);
    assert.deepStrictEqual(actual.runbook_refs, contract.runbook_refs, contract.contract_id);
  }
})();

(function patternBasedReasonsStayInCorrectFamilies() {
  const muted = classifyAlertFailureReason("ALERT_CHANNEL_MUTED");
  assert.strictEqual(muted.family, "POLICY");
  assert.strictEqual(muted.retry_policy_code, "ALERT_POLICY_TERMINAL");

  const http = classifyAlertFailureReason("HTTP_503");
  assert.strictEqual(http.family, "TRANSPORT");
  assert.strictEqual(http.retry_policy_code, "ALERT_RETRY_TRANSPORT");

  const telegram = classifyAlertFailureReason("TELEGRAM_RATE_LIMIT");
  assert.strictEqual(telegram.family, "TRANSPORT");
  assert.strictEqual(telegram.retry_policy_code, "ALERT_RETRY_TRANSPORT");
})();

(function matcherHelpersRemainCoherent() {
  assert.strictEqual(__test.matchesOperatorConfig("TELEGRAM_BOT_TOKEN_MISSING"), true);
  assert.strictEqual(__test.matchesPayload("ALERT_PREPARED_PAYLOAD_REQUIRED"), true);
  assert.strictEqual(__test.matchesPolicy("CHANNEL_MUTED"), true);
  assert.strictEqual(__test.matchesTransport("OPENCLAW_SEND_FAILED_TIMEOUT"), true);
})();

console.log("V2_ALERT_FAILURE_TAXONOMY_TEST_OK");
