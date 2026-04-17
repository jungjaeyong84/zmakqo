"use strict";

const assert = require("assert");
const { __test } = require("../services/liveTrailingStageRepair");

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;

function run() {
  assert.strictEqual(typeof __test.resolveRepairTargetStage, "function");
  assert.strictEqual(typeof __test.buildRepairedMeta, "function");
  assert.strictEqual(typeof __test.shouldEnforceSingleStopWriter, "function");
  assert.strictEqual(typeof __test.resolveNonAuthorityRepairStatus, "function");
  assert.strictEqual(typeof __test.sanitizeNativeProtectionResultForNonAuthority, "function");
  assert.strictEqual(__test.shouldEnforceSingleStopWriter(), true);
  assert.strictEqual(__test.resolveNonAuthorityRepairStatus(), "REPAIR_REQUESTED_NON_AUTHORITY_LAYER");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const stage = __test.resolveRepairTargetStage({
    positionSnapshot: {
      qty_base: 0.167,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: false,
      },
    },
    externalQty: 0.167,
  });
  assert.strictEqual(stage.stage, "TRAIL");
  assert.strictEqual(stage.reason, "TP1_DONE_WITH_OPEN_RUNNER");

  const nextMeta = __test.buildRepairedMeta({
    tp_p0_done: false,
    tp_p1_done: false,
    trail_active: false,
  }, stage);
  assert.strictEqual(nextMeta.tp_p0_done, false);
  assert.strictEqual(nextMeta.tp_p1_done, true);
  assert.strictEqual(nextMeta.trail_active, true);

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const simplifiedStage = __test.resolveRepairTargetStage({
    positionSnapshot: {
      qty_base: 0.25,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: false,
        tp_p1_done: true,
        trail_active: false,
      },
    },
    externalQty: 0.25,
  });
  assert.strictEqual(simplifiedStage.stage, "TRAIL");
  assert.strictEqual(simplifiedStage.reason, "TP1_DONE_WITH_OPEN_RUNNER");

  const simplifiedNextMeta = __test.buildRepairedMeta({
    simplified_exit_v2_enabled: true,
    tp_p0_done: false,
    tp_p1_done: false,
    trail_active: false,
  }, simplifiedStage);
  assert.strictEqual(simplifiedNextMeta.tp_p0_done, false);
  assert.strictEqual(simplifiedNextMeta.tp_p1_done, true);
  assert.strictEqual(simplifiedNextMeta.trail_active, true);
  assert.strictEqual(simplifiedNextMeta.canonical_exit_stage, "TRAIL");

  const simplifiedRejectedTp0Stage = __test.resolveRepairTargetStage({
    positionSnapshot: {
      qty_base: 0.5,
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
        canonical_exit_stage: "TP0",
      },
    },
    externalQty: 0.5,
  });
  assert.strictEqual(simplifiedRejectedTp0Stage.stage, null);
  assert.strictEqual(simplifiedRejectedTp0Stage.reason, "TP0_STAGE_REJECTED");

  const sanitized = __test.sanitizeNativeProtectionResultForNonAuthority({ ok: true, stop_order_id: "123" });
  assert.strictEqual(sanitized.ok, false);
  assert.strictEqual(sanitized.skipped, true);
  assert.strictEqual(sanitized.reason, "REPAIR_REQUESTED_NON_AUTHORITY_LAYER");
  assert.strictEqual(sanitized.requested, true);
  assert.deepStrictEqual(sanitized.source_result, { ok: true, stop_order_id: "123" });

  console.log("LIVE_TRAILING_STAGE_REPAIR_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("LIVE_TRAILING_STAGE_REPAIR_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
} finally {
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
}
