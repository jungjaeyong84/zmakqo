"use strict";

const assert = require("assert");
const { __test } = require("../services/liveInferenceRouter");

(() => {
  const config = __test.buildLiveInferenceRouterConfig({
    exchange: "BINANCEFUT",
    servingState: {
      status: "PASS",
      serving_mode: "LIVE_ACTIVE",
      live_serving_allowed: true,
      active_model_artifact_id: "MODEL_SCOPE__ACTIVE",
      preferred_model_artifact_id: "MODEL_SCOPE__2",
    },
    bindingDoc: {
      artifact_id: "MODEL_SCOPE__ACTIVE",
      binding: {
        provider_mode: "OPENAI_PRIMARY",
        openai_model: "gpt-5.4",
        openai_reasoning_effort: "high",
        claude_model: "claude-opus-4-5-20251101",
        require_live_serving: true,
      },
    },
  });

  assert.strictEqual(config.source, "ARTIFACT_BINDING");
  assert.strictEqual(config.provider_mode, "OPENAI_PRIMARY");
  assert.strictEqual(config.openai_model, "gpt-5.4");
  assert.strictEqual(config.openai_reasoning_effort, "high");
  assert.strictEqual(config.active_model_artifact_id, "MODEL_SCOPE__ACTIVE");
  assert.strictEqual(config.preferred_model_artifact_id, "MODEL_SCOPE__2");
  assert.strictEqual(config.binding_found, true);
  assert.strictEqual(config.live_serving_allowed, true);
})();

(() => {
  const config = __test.buildLiveInferenceRouterConfig({
    exchange: "BINANCEFUT",
    servingState: {
      status: "WARN",
      serving_mode: "SHADOW_ONLY",
      live_serving_allowed: false,
      preferred_model_artifact_id: "MODEL_SCOPE__3",
    },
    bindingDoc: {
      artifact_id: "MODEL_SCOPE__3",
      binding: {
        provider_mode: "OPENAI_PRIMARY",
        openai_model: "gpt-5.4",
        require_live_serving: true,
      },
    },
  });

  assert.strictEqual(config.source, "DEFAULT");
  assert.notStrictEqual(config.provider_mode, "OPENAI_PRIMARY");
  assert.strictEqual(config.binding_found, true);
  assert.strictEqual(config.live_serving_allowed, false);
})();

(() => {
  const config = __test.buildLiveInferenceRouterConfig({
    exchange: "BINANCEFUT",
    servingState: {
      status: "PASS",
      serving_mode: "LIVE_ACTIVE",
      live_serving_allowed: true,
    },
    bindingDoc: {
      artifact_id: null,
      binding: {
        provider_mode: "CLAUDE_PRIMARY",
        claude_model: "claude-sonnet-test",
      },
    },
  });

  assert.strictEqual(config.source, "EXCHANGE_BINDING");
  assert.strictEqual(config.provider_mode, "CLAUDE_PRIMARY");
  assert.strictEqual(config.claude_model, "claude-sonnet-test");
})();

console.log("LIVE_INFERENCE_ROUTER_TEST_OK");
