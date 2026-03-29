"use strict";

const assert = require("assert");
const { classifyStage1IntegrityReason, explainStage1IntegrityReason } = require("../utils/stage1IntegrityReason");

(() => {
  const gate = classifyStage1IntegrityReason("DROP_LONG_GATE_CONF");
  assert.ok(gate);
  assert.strictEqual(gate.family, "FALLBACK_GATE");
  assert.strictEqual(gate.key, "CONF");

  const quality = classifyStage1IntegrityReason("DROP_ENTRY_QUALITY_POSTERIOR_MISSING");
  assert.ok(quality);
  assert.strictEqual(quality.family, "FALLBACK_QUALITY");
  assert.strictEqual(quality.key, "POSTERIOR");

  const lowScore = classifyStage1IntegrityReason("DROP_LOW_SCORE");
  assert.ok(lowScore);
  assert.strictEqual(lowScore.key, "SCORE");

  const explain = explainStage1IntegrityReason("DROP_SHORT_GATE_REGIME");
  assert.ok(explain.includes("Pine 품질 번들"));
  assert.ok(explain.includes("fallback 무결성 검사"));

  console.log("STAGE1_INTEGRITY_REASON_TEST_OK");
})();
