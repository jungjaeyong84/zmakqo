"use strict";

const assert = require("assert");
const {
  __test,
} = require("../../scripts/lib/codex-openai-fallback");

(() => {
  const prevKey = process.env.OPENAI_API_KEY;
  const prevEnabled = process.env.OPENAI_CODEX_FALLBACK_ENABLED;

  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENAI_CODEX_FALLBACK_ENABLED;

  assert.strictEqual(
    __test.shouldUseOpenAICodexFallback({
      cliMissing: true,
      cliResult: null,
    }),
    false
  );

  process.env.OPENAI_CODEX_FALLBACK_ENABLED = "1";

  assert.strictEqual(__test.DEFAULT_OPENAI_CODEX_MODEL, "gpt-5.2-codex");
  assert.strictEqual(
    __test.summarizeCliFailure({ cliMissing: true }),
    "CODEX_CLI_MISSING"
  );
  assert.strictEqual(
    __test.summarizeCliFailure({
      cliResult: {
        res: {
          status: 1,
          stderr: "You have reached your usage limit for Codex CLI.",
          stdout: "",
          timedOut: false,
        },
      },
    }),
    "CODEX_CLI_USAGE_EXHAUSTED"
  );
  assert.strictEqual(
    __test.shouldUseOpenAICodexFallback({
      cliMissing: true,
      cliResult: null,
    }),
    true
  );
  assert.strictEqual(
    __test.shouldUseOpenAICodexFallback({
      cliMissing: false,
      cliResult: { parsed: { ok: true }, res: { status: 0 } },
    }),
    false
  );

  process.env.OPENAI_API_KEY = prevKey;
  process.env.OPENAI_CODEX_FALLBACK_ENABLED = prevEnabled;
  console.log("CODEX_OPENAI_FALLBACK_TEST_OK");
})();
