"use strict";

// Contract tests for the Codex CLI adapter. These avoid invoking the real
// binary so CI stays offline; we exercise the pure parsers + argument
// builder, verify the spawn path refuses an empty prompt, and confirm the
// narrative reasoner wires Codex CLI as the default primary provider with
// Claude CLI as fallback.

const assert = require("assert");
const cli = require("../services/codexCliClient");

(async () => {
  // ---- stripCodeFences ---------------------------------------------------
  assert.strictEqual(cli.__test.stripCodeFences("```json\n{\"ok\":true}\n```"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences("```\n{\"ok\":true}\n```"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences("{\"ok\":true}"), '{"ok":true}');
  assert.strictEqual(cli.__test.stripCodeFences(""), "");

  // ---- tryParseJson ------------------------------------------------------
  assert.deepStrictEqual(cli.__test.tryParseJson("{\"ok\":true}"), { ok: true });
  assert.deepStrictEqual(cli.__test.tryParseJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepStrictEqual(cli.__test.tryParseJson("prefix {\"ok\":true} suffix"), { ok: true });
  assert.strictEqual(cli.__test.tryParseJson("not json"), null);
  assert.strictEqual(cli.__test.tryParseJson(""), null);

  // ---- classifyFailure (quota / auth detection) --------------------------
  // This is the key fallback-trigger. The regex MUST match the shell
  // wrapper's pattern so Node-level openclaw falls back to Claude CLI
  // on exactly the same signals the `codex-with-fallback` wrapper does.
  const exhaustedVariants = [
    "Error: You have exceeded your usage limit.",
    "429 Too Many Requests",
    "quota exceeded",
    "rate limit reached",
    "insufficient credit balance",
    "billing issue — cannot process request",
    "token budget exhausted",
  ];
  for (const sample of exhaustedVariants) {
    assert.strictEqual(
      cli.__test.classifyFailure({ stderr: sample, stdout: "" }),
      "CODEX_CLI_USAGE_EXHAUSTED",
      `quota pattern must match: ${sample}`
    );
  }
  assert.strictEqual(
    cli.__test.classifyFailure({ stderr: "please login with `codex login`", stdout: "" }),
    "CODEX_CLI_AUTH_BLOCKED"
  );
  assert.strictEqual(
    cli.__test.classifyFailure({ stderr: "unrelated network hiccup", stdout: "" }),
    null,
    "non-quota / non-auth stderr must not be misclassified"
  );

  // ---- composePrompt -----------------------------------------------------
  assert.strictEqual(
    cli.__test.composePrompt({ prompt: "hello", systemPrompt: null }),
    "hello",
    "no system prompt → body is the prompt verbatim"
  );
  const composed = cli.__test.composePrompt({
    prompt: "analyse this trade",
    systemPrompt: "You are OpenClaw.",
  });
  assert.ok(composed.startsWith("You are OpenClaw."),
    "system prompt must lead the composed body");
  assert.ok(composed.includes("---"),
    "composed prompt must separate system and user sections with a delimiter");
  assert.ok(composed.endsWith("analyse this trade"),
    "user prompt must end the composed body");

  // ---- buildArgs ---------------------------------------------------------
  const args = cli.__test.buildArgs({
    model: "gpt-5.2-codex",
    sandbox: "read-only",
    outputFile: "/tmp/x.txt",
  });
  assert.ok(args.includes("exec"), "must invoke `codex exec`");
  assert.ok(args.includes("--sandbox"));
  assert.ok(args.includes("read-only"),
    "default sandbox must be read-only — we never let the model mutate disk");
  assert.ok(args.includes("--skip-git-repo-check"),
    "must skip git repo check so we can run outside a repo");
  assert.ok(args.includes("--ephemeral"),
    "must not persist sessions to disk");
  assert.ok(args.includes("--color"));
  assert.ok(args.includes("never"));
  assert.ok(args.includes("--output-last-message"));
  assert.ok(args.includes("/tmp/x.txt"));
  assert.ok(args.includes("--model"));
  assert.ok(args.includes("gpt-5.2-codex"));
  assert.strictEqual(args[args.length - 1], "-",
    "final positional arg must be `-` so codex reads prompt from stdin");

  // ---- env resolvers -----------------------------------------------------
  const prev = {
    bin: process.env.OPENCLAW_CODEX_CLI_BIN,
    codexBinEnv: process.env.CODEX_BIN,
    model: process.env.OPENCLAW_CODEX_CLI_MODEL,
    timeout: process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS,
    sandbox: process.env.OPENCLAW_CODEX_CLI_SANDBOX,
  };
  try {
    delete process.env.OPENCLAW_CODEX_CLI_BIN;
    delete process.env.CODEX_BIN;
    delete process.env.OPENCLAW_CODEX_CLI_MODEL;
    delete process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS;
    delete process.env.OPENCLAW_CODEX_CLI_SANDBOX;
    assert.strictEqual(cli.__test.resolveBin(), cli.DEFAULT_BIN);
    // CODEX_BIN is set by ops/launchd/load_ai_cli_env.sh so launchd jobs
    // can locate the app-bundled binary without the openclaw-specific var.
    process.env.CODEX_BIN = "/Applications/Codex.app/Contents/Resources/codex";
    assert.strictEqual(cli.__test.resolveBin(),
      "/Applications/Codex.app/Contents/Resources/codex",
      "CODEX_BIN must be picked up as a fallback for OPENCLAW_CODEX_CLI_BIN");
    // OPENCLAW_CODEX_CLI_BIN must win over CODEX_BIN when both are set.
    process.env.OPENCLAW_CODEX_CLI_BIN = "/opt/custom/codex";
    assert.strictEqual(cli.__test.resolveBin(), "/opt/custom/codex",
      "OPENCLAW_CODEX_CLI_BIN must take precedence over CODEX_BIN");
    delete process.env.OPENCLAW_CODEX_CLI_BIN;
    delete process.env.CODEX_BIN;

    assert.strictEqual(cli.__test.resolveModel(), cli.DEFAULT_MODEL);
    assert.strictEqual(cli.__test.resolveSandbox(), cli.DEFAULT_SANDBOX);
    assert.strictEqual(cli.__test.resolveTimeoutMs(), cli.DEFAULT_TIMEOUT_MS);
    assert.strictEqual(cli.__test.resolveTimeoutMs(100), cli.MIN_TIMEOUT_MS,
      "sub-minimum timeouts must be clamped up");
    assert.strictEqual(cli.__test.resolveTimeoutMs(9999999), cli.MAX_TIMEOUT_MS,
      "super-maximum timeouts must be clamped down");

    process.env.OPENCLAW_CODEX_CLI_MODEL = "gpt-5.3-codex";
    assert.strictEqual(cli.__test.resolveModel(), "gpt-5.3-codex");
    process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS = "7000";
    assert.strictEqual(cli.__test.resolveTimeoutMs(), 7000);
    process.env.OPENCLAW_CODEX_CLI_SANDBOX = "workspace-write";
    assert.strictEqual(cli.__test.resolveSandbox(), "workspace-write");
    process.env.OPENCLAW_CODEX_CLI_SANDBOX = "bogus-mode";
    assert.strictEqual(cli.__test.resolveSandbox(), cli.DEFAULT_SANDBOX,
      "unknown sandbox mode must fall back to the safe default");
  } finally {
    if (prev.bin === undefined) delete process.env.OPENCLAW_CODEX_CLI_BIN;
    else process.env.OPENCLAW_CODEX_CLI_BIN = prev.bin;
    if (prev.codexBinEnv === undefined) delete process.env.CODEX_BIN;
    else process.env.CODEX_BIN = prev.codexBinEnv;
    if (prev.model === undefined) delete process.env.OPENCLAW_CODEX_CLI_MODEL;
    else process.env.OPENCLAW_CODEX_CLI_MODEL = prev.model;
    if (prev.timeout === undefined) delete process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS;
    else process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS = prev.timeout;
    if (prev.sandbox === undefined) delete process.env.OPENCLAW_CODEX_CLI_SANDBOX;
    else process.env.OPENCLAW_CODEX_CLI_SANDBOX = prev.sandbox;
  }

  // ---- Empty prompt refused ---------------------------------------------
  const emptyResult = await cli.callCodexCli({ prompt: "" });
  assert.strictEqual(emptyResult.ok, false);
  assert.strictEqual(emptyResult.reason, "EMPTY_PROMPT");

  // ---- Unknown binary: fails cleanly with SPAWN_FAIL or CHILD_ERROR ------
  const bogusBin = process.env.OPENCLAW_CODEX_CLI_BIN;
  try {
    process.env.OPENCLAW_CODEX_CLI_BIN = "/this/codex/does/not/exist";
    const bogusResult = await cli.callCodexCli({
      prompt: "hi",
      timeoutMs: 2000,
    });
    assert.strictEqual(bogusResult.ok, false);
    assert.ok(
      ["SPAWN_FAIL", "CHILD_ERROR", "NONZERO_EXIT"].includes(bogusResult.reason),
      `expected SPAWN_FAIL/CHILD_ERROR/NONZERO_EXIT, got ${bogusResult.reason}`
    );
  } finally {
    if (bogusBin === undefined) delete process.env.OPENCLAW_CODEX_CLI_BIN;
    else process.env.OPENCLAW_CODEX_CLI_BIN = bogusBin;
  }

  // ---- Narrative reasoner wiring ----------------------------------------
  // The reasoner must stay Codex CLI only; Claude/OpenAI fallback aliases are
  // retired in V2 so local automation cannot create paid API spend.
  const narrative = require("../services/openclawNarrativeReasoner");
  const prevMode = process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
  try {
    delete process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY",
      "default mode must be CODEX_CLI_ONLY so V2 never falls through to Claude");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "default sequence must attempt Codex CLI only");

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CODEX_CLI_ONLY";
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "explicit CODEX_CLI_ONLY must skip Claude fallback");

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CODEX_CLAUDE";
    assert.strictEqual(narrative.providerMode(), "CODEX_CLI_ONLY",
      "CODEX_CLAUDE alias must no longer enable Claude fallback");
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"]);

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CODEX_FIRST";
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "explicit CODEX_FIRST must no longer use OpenAI HTTP or Claude CLI");

    process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = "CLI";
    assert.deepStrictEqual(narrative.resolveProviderSequence(), ["CODEX_CLI"],
      "explicit CLI mode must be normalized to Codex CLI only");
  } finally {
    if (prevMode === undefined) delete process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE;
    else process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE = prevMode;
  }

  console.log("CODEX_CLI_CLIENT_TEST_OK");
})().catch((err) => {
  console.error("CODEX_CLI_CLIENT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
