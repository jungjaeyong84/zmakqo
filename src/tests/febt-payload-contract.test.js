const assert = require('assert');
const { mergeFebtPayloadContract, hasFebtContract } = require('../utils/febtPayloadContract');

(function testBackfillsTopLevelFebtFields() {
  const merged = mergeFebtPayloadContract({
    payload: {
      trace_payload_version: 'TPTR_V2',
      febt_mode: 'SHADOW',
      febt_phase: 'FIRE',
      febt_calc_ok: true,
      febt_calc_reason: 'OK',
      febt_timing_action: 'OBSERVE',
      febt_authority: 'SHADOW_ONLY',
      febt_lock_score: 0.61,
    },
    features: {
      trace_emit_mode: 'BAR_CLOSE',
    },
  });

  assert.strictEqual(merged.features.febt_mode, 'SHADOW');
  assert.strictEqual(merged.features.febt_phase, 'FIRE');
  assert.strictEqual(merged.features.febt_calc_ok, true);
  assert.strictEqual(merged.features.febt_calc_reason, 'OK');
  assert.strictEqual(merged.features.febt_timing_action, 'OBSERVE');
  assert.strictEqual(merged.features.febt_authority, 'SHADOW_ONLY');
  assert.strictEqual(merged.features.febt_lock_score, 0.61);
  assert.strictEqual(merged.features._febt_backfilled_from_top_level, true);
  assert.strictEqual(hasFebtContract(merged.features), true);
  assert.strictEqual(merged.trace_contract_missing, false);
})();

(function testMarksTraceContractMissingWhenTptrWithoutFebt() {
  const merged = mergeFebtPayloadContract({
    payload: {
      trace_payload_version: 'TPTR_V2',
      trace_emit_mode: 'BAR_CLOSE',
    },
    features: {},
  });

  assert.strictEqual(merged.febt_contract_present, false);
  assert.strictEqual(merged.trace_contract_missing, true);
  assert.strictEqual(merged.features._febt_trace_contract_missing, true);
  assert.strictEqual(merged.features._febt_trace_contract_version, 'TPTR_V2');
})();

console.log('FEBT_PAYLOAD_CONTRACT_TEST_OK');
