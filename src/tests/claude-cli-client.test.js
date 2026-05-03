"use strict";

// Contract tests for the Claude CLI adapter. These avoid invoking the real
// binary so CI stays offline; we exercise the pure parsers + argument
// builder and verify the spawn path refuses an empty prompt.

const assert = require("assert");
const cli = require("../services/claudeCliClient");

(async () => {
  // ---- stripCodeFences ---------------------------------------------------
  assert.strictEqual(cli.__test.stripCodeFences("```json\n{\"ok\":true}\n```"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences("```\n{\"ok\":true}\n```"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences("{\"ok\":true}"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences(""), "");

  // ---- tryParseJson ------------------------------------------------------
  assert.deepStrictEqual(cli.__test.tryParseJson("{\"ok\":true}"), { ok: true });
  assert.deepStrictEqual(cli.__test.tryParseJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepStrictEqual(cli.__test.tryParseJson("prefix garbage {\"ok\":true} suffix"), { ok: true });
  assert.strictEqual(cli.__test.tryParseJson("not json at all"), null);
  assert.strictEqual(cli.__test.tryParseJson(""), null);

  // ---- buildArgs ---------------------------------------------------------
  const base = cli.__test.buildArgs({ model: "sonnet" });
  assert.ok(base.includes("-p"));
  assert.ok(base.includes("--output-format"));
  assert.ok(base.includes("json"));
  assert.ok(base.includes("--model"));
  assert.ok(base.includes("sonnet"));
  assert.ok(base.includes("--tools"));
  assert.ok(base.includes(""));
  assert.ok(base.includes("--no-session-persistence"));
  assert.ok(base.includes("--permission-mode"));
  assert.ok(base.includes("dontAsk"),
    "must use the non-interactive permission mode so the pipeline cannot hang on prompts");

  const withSystem = cli.__test.buildArgs({ model: "sonnet", systemPrompt: "SYSTEM" });
  assert.ok(withSystem.includes("--append-system-prompt"));
  assert.ok(withSystem.includes("SYSTEM"));

  // ---- env resolvers -----------------------------------------------------
  const prev = {
    bin: process.env.OPENCLAW_CLAUDE_CLI_BIN,
    model: process.env.OPENCLAW_CLAUDE_CLI_MODEL,
    timeout: process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS,
  };
  try {
    delete process.env.OPENCLAW_CLAUDE_CLI_BIN;
    delete process.env.OPENCLAW_CLAUDE_CLI_MODEL;
    delete process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS;
    assert.strictEqual(cli.__test.resolveBin(), cli.DEFAULT_BIN);
    assert.strictEqual(cli.__test.resolveModel(), cli.DEFAULT_MODEL);
    assert.strictEqual(cli.__test.resolveTimeoutMs(), cli.DEFAULT_TIMEOUT_MS);
    assert.strictEqual(cli.__test.resolveTimeoutMs(100), cli.MIN_TIMEOUT_MS,
      "sub-minimum timeouts must be clamped up");
    assert.strictEqual(cli.__test.resolveTimeoutMs(9999999), cli.MAX_TIMEOUT_MS,
      "super-maximum timeouts must be clamped down");

    process.env.OPENCLAW_CLAUDE_CLI_MODEL = "opus";
    assert.strictEqual(cli.__test.resolveModel(), "opus");
    process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS = "5000";
    assert.strictEqual(cli.__test.resolveTimeoutMs(), 5000);
  } finally {
    if (prev.bin === undefined) delete process.env.OPENCLAW_CLAUDE_CLI_BIN;
    else process.env.OPENCLAW_CLAUDE_CLI_BIN = prev.bin;
    if (prev.model === undefined) delete process.env.OPENCLAW_CLAUDE_CLI_MODEL;
    else process.env.OPENCLAW_CLAUDE_CLI_MODEL = prev.model;
    if (prev.timeout === undefined) delete process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS;
    else process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS = prev.timeout;
  }

  // ---- Empty prompt refused ---------------------------------------------
  const emptyResult = await cli.callClaudeCli({ prompt: "" });
  assert.strictEqual(emptyResult.ok, false);
  assert.strictEqual(emptyResult.reason, "CLAUDE_CLI_RETIRED_BY_DONBEOLJA_V2");

  // ---- Unknown binary: fails cleanly with SPAWN_FAIL or CHILD_ERROR ------
  const bogusBin = process.env.OPENCLAW_CLAUDE_CLI_BIN;
  const prevPaidAiDisabled = process.env.DONBEOLJA_PAID_AI_API_DISABLED;
  const prevAllowClaudeCli = process.env.DONBEOLJA_ALLOW_CLAUDE_CLI;
  try {
    process.env.DONBEOLJA_PAID_AI_API_DISABLED = "0";
    process.env.DONBEOLJA_ALLOW_CLAUDE_CLI = "1";
    process.env.OPENCLAW_CLAUDE_CLI_BIN = "/this/binary/does/not/exist";
    const bogusResult = await cli.callClaudeCli({
      prompt: "hi",
      timeoutMs: 2000,
    });
    assert.strictEqual(bogusResult.ok, false);
    assert.ok(
      ["SPAWN_FAIL", "CHILD_ERROR", "NONZERO_EXIT"].includes(bogusResult.reason),
      `expected SPAWN_FAIL/CHILD_ERROR/NONZERO_EXIT, got ${bogusResult.reason}`
    );
  } finally {
    if (bogusBin === undefined) delete process.env.OPENCLAW_CLAUDE_CLI_BIN;
    else process.env.OPENCLAW_CLAUDE_CLI_BIN = bogusBin;
    if (prevPaidAiDisabled === undefined) delete process.env.DONBEOLJA_PAID_AI_API_DISABLED;
    else process.env.DONBEOLJA_PAID_AI_API_DISABLED = prevPaidAiDisabled;
    if (prevAllowClaudeCli === undefined) delete process.env.DONBEOLJA_ALLOW_CLAUDE_CLI;
    else process.env.DONBEOLJA_ALLOW_CLAUDE_CLI = prevAllowClaudeCli;
  }

  // ---- Provider mode wiring (narrative reasoner) ------------------------
  const narrative = require("../services/openclawNarrativeReasoner");
  const prevMode = process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
  try {
    delete process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY",
      "narrative reasoner defaults to CODEX_CLI_ONLY so V2 does not create Claude spend");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "default sequence runs Codex CLI only");

    // V2 is Codex CLI only. Legacy Claude/OpenAI aliases are normalized away
    // unless the code is intentionally changed in a separate audited commit.
    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CLI";
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"]);

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CODEX_CLI_FIRST";
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "explicit fallback aliases must still run Codex CLI only");

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CODEX_FIRST";
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"]);

    // AUTO → CODEX_CLI_ONLY so auto-tune operators get no Claude fallback.
    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "AUTO";
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY");
  } finally {
    if (prevMode === undefined) delete process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
    else process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = prevMode;
  }

  console.log("CLAUDE_CLI_CLIENT_TEST_OK");
})().catch((err) => {
  console.error("CLAUDE_CLI_CLIENT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
