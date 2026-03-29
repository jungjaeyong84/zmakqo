"use strict";

const assert = require("assert");
const {
  resolveStatPhysFeatures,
  displayStatPhysState,
} = require("../utils/statPhysFeatures");

(async () => {
  const ordered = resolveStatPhysFeatures({
    features_json: {
      sp_entropy_score: 0.28,
      sp_coherence_score: 0.72,
      sp_transition_risk: 0.24,
      sp_field_alignment: 0.78,
      sp_domain_wall_density: 0.18,
      sp_susceptibility: 0.22,
      sp_free_energy: 0.26,
    },
  });
  assert.strictEqual(ordered.state, "ORDERED");
  assert.strictEqual(ordered.entropy_bucket, "<0.35");
  assert.strictEqual(ordered.coherence_bucket, "0.65+");
  assert.strictEqual(ordered.transition_bucket, "<0.30");
  assert.strictEqual(ordered.field_alignment_bucket, "0.65+");
  assert.strictEqual(ordered.domain_wall_bucket, "<0.25");
  assert.strictEqual(ordered.free_energy_bucket, "<0.35");
  assert.strictEqual(displayStatPhysState(ordered.state), "질서 상태");

  const disordered = resolveStatPhysFeatures({
    sp_entropy_score: 0.54,
    sp_coherence_score: 0.55,
    sp_transition_risk: 0.48,
    sp_field_alignment: 0.40,
    sp_domain_wall_density: 0.58,
    sp_susceptibility: 0.62,
    sp_free_energy: 0.64,
  });
  assert.strictEqual(disordered.state, "DISORDERED");
  assert.strictEqual(disordered.domain_wall_bucket, "0.45-0.59");
  assert.strictEqual(displayStatPhysState(disordered.state), "무질서 상태");

  const critical = resolveStatPhysFeatures({
    sp_entropy_score: 0.63,
    sp_coherence_score: 0.51,
    sp_transition_risk: 0.60,
    sp_field_alignment: 0.36,
    sp_domain_wall_density: 0.53,
    sp_susceptibility: 0.72,
    sp_free_energy: 0.77,
  });
  assert.strictEqual(critical.state, "CRITICAL");
  assert.strictEqual(critical.susceptibility_bucket, "0.65+");
  assert.strictEqual(displayStatPhysState(critical.state), "임계 전이 위험");

  console.log("STAT_PHYS_FEATURES_TEST_OK");
})().catch((err) => {
  console.error("STAT_PHYS_FEATURES_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
