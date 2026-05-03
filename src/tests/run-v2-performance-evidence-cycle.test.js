"use strict";

const assert = require("assert");
const cycle = require("../../scripts/run-v2-performance-evidence-cycle");

(async () => {
  {
    const env = cycle.buildCycleEnv({});
    assert.strictEqual(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE, "FIRESTORE");
    assert.strictEqual(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE, "1");
    assert.strictEqual(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_REQUIRE_NONEMPTY, "0");
    assert.strictEqual(env.V2_PERFORMANCE_GATE_SOFT, "1");
  }

  {
    const env = cycle.buildCycleEnv({
      V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: "JSON_FIXTURE",
      V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: "0",
      V2_PERFORMANCE_GATE_SOFT: "0",
    });
    assert.strictEqual(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE, "JSON_FIXTURE");
    assert.strictEqual(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE, "0");
    assert.strictEqual(env.V2_PERFORMANCE_GATE_SOFT, "0");
  }

  {
    const order = [];
    const result = await cycle.main({
      env: {},
      setProcessExitCode: false,
      steps: [
        {
          id: "collector",
          critical: true,
          run: async () => {
            order.push("collector");
            return { ok: true, reason: "COLLECTED" };
          },
          summarize: (payload) => ({ ok: payload.ok, reason: payload.reason }),
        },
        {
          id: "performance_gate",
          critical: true,
          allowBlocked: true,
          run: async () => {
            order.push("performance_gate");
            return { ok: false, reason: "V2_PERFORMANCE_GATE_BLOCKED" };
          },
          summarize: (payload) => ({ ok: true, gate_ok: payload.ok === true, reason: payload.reason }),
        },
        {
          id: "formal_live_promotion_readiness",
          critical: true,
          allowBlocked: true,
          run: async () => {
            order.push("formal_live_promotion_readiness");
            return { ok: false, reason: "FORMAL_LIVE_PROMOTION_BLOCKED" };
          },
          summarize: (payload) => ({ ok: true, readiness_ok: payload.ok === true, reason: payload.reason }),
        },
      ],
    });
    assert.deepStrictEqual(order, ["collector", "performance_gate", "formal_live_promotion_readiness"]);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.gate_ok, false);
    assert.strictEqual(result.formal_live_ok, false);
  }

  {
    const result = await cycle.main({
      env: {},
      setProcessExitCode: false,
      steps: [
        {
          id: "collector",
          critical: true,
          run: async () => {
            throw new Error("boom");
          },
        },
        {
          id: "must_not_run",
          critical: true,
          run: async () => {
            throw new Error("should not run");
          },
        },
      ],
    });
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.failed_step_ids, ["collector"]);
    assert.strictEqual(result.step_n, 1);
  }

  console.log("RUN_V2_PERFORMANCE_EVIDENCE_CYCLE_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
