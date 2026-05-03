"use strict";

const assert = require("assert");

(async () => {
  const guard = require("../utils/paidAiProviderGuard");
  const claude = require("../services/claudeClient");
  const claudeBatch = require("../services/claudeBatchClient");
  const openai = require("../services/openaiClient");
  const openaiBatch = require("../services/openaiBatchClient");
  const gemini = require("../services/geminiClient");
  const narrative = require("../services/openclawNarrativeReasoner");

  const prev = {
    disabled: process.env.DONBEOLJA_PAID_AI_API_DISABLED,
    anthropic: process.env.DONBEOLJA_ALLOW_ANTHROPIC_API,
    openai: process.env.DONBEOLJA_ALLOW_OPENAI_API,
    gemini: process.env.DONBEOLJA_ALLOW_GEMINI_API,
    claudeCli: process.env.DONBEOLJA_ALLOW_CLAUDE_CLI,
    mode: process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE,
  };
  try {
    delete process.env.DONBEOLJA_PAID_AI_API_DISABLED;
    delete process.env.DONBEOLJA_ALLOW_ANTHROPIC_API;
    delete process.env.DONBEOLJA_ALLOW_OPENAI_API;
    delete process.env.DONBEOLJA_ALLOW_GEMINI_API;
    delete process.env.DONBEOLJA_ALLOW_CLAUDE_CLI;

    assert.strictEqual(guard.paidAiApiDisabled(), true);
    assert.strictEqual((await claude.callClaude({ apiKey: "sk-test", prompt: "x" })).reason, "ANTHROPIC_API_RETIRED_BY_DONBEOLJA_V2");
    assert.strictEqual((await claudeBatch.createBatch("sk-test", [{ custom_id: "x", params: {} }])).error, "ANTHROPIC_BATCH_API_RETIRED_BY_DONBEOLJA_V2");
    assert.strictEqual((await openai.callOpenAI({ apiKey: "sk-test", prompt: "x" })).reason, "OPENAI_API_RETIRED_BY_DONBEOLJA_V2");
    assert.strictEqual((await openaiBatch.submitAndCollectResponses("sk-test", [])).error, "OPENAI_BATCH_API_RETIRED_BY_DONBEOLJA_V2");
    assert.strictEqual((await gemini.callGemini({ apiKey: "sk-test", prompt: "x" })).reason, "GEMINI_API_RETIRED_BY_DONBEOLJA_V2");

    for (const mode of ["CLI", "CLAUDE", "CODEX_CLAUDE", "CODEX_CLI_FIRST", "CODEX_FIRST", "OPENAI", "API"]) {
      process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = mode;
      assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY", `${mode} must normalize to CODEX_CLI_ONLY`);
      assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"]);
    }
  } finally {
    if (prev.disabled === undefined) delete process.env.DONBEOLJA_PAID_AI_API_DISABLED;
    else process.env.DONBEOLJA_PAID_AI_API_DISABLED = prev.disabled;
    if (prev.anthropic === undefined) delete process.env.DONBEOLJA_ALLOW_ANTHROPIC_API;
    else process.env.DONBEOLJA_ALLOW_ANTHROPIC_API = prev.anthropic;
    if (prev.openai === undefined) delete process.env.DONBEOLJA_ALLOW_OPENAI_API;
    else process.env.DONBEOLJA_ALLOW_OPENAI_API = prev.openai;
    if (prev.gemini === undefined) delete process.env.DONBEOLJA_ALLOW_GEMINI_API;
    else process.env.DONBEOLJA_ALLOW_GEMINI_API = prev.gemini;
    if (prev.claudeCli === undefined) delete process.env.DONBEOLJA_ALLOW_CLAUDE_CLI;
    else process.env.DONBEOLJA_ALLOW_CLAUDE_CLI = prev.claudeCli;
    if (prev.mode === undefined) delete process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
    else process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = prev.mode;
  }

  console.log("PAID_AI_PROVIDER_RETIREMENT_TEST_OK");
})().catch((err) => {
  console.error("PAID_AI_PROVIDER_RETIREMENT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
