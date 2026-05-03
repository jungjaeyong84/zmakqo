"use strict";

// Phase C backend — Claude CLI adapter.
//
// Shells out to the local `claude` binary (as shipped with Claude Code /
// Claude CLI) instead of hitting the HTTP API directly. This matches the
// operator's chosen deployment: no plaintext ANTHROPIC_API_KEY env, use the
// already-authenticated CLI instead.
//
// Subprocess contract:
//   claude -p --print --output-format json --model <model>
//          --tools "" --no-session-persistence --permission-mode dontAsk
//          [--system-prompt "…"]
//          "<prompt>"
//
//   stdout: single-line JSON { type:"result", result:"…", duration_ms, total_cost_usd, … }
//   .result may be a fenced code block containing the LLM's actual JSON;
//   this adapter strips fences and tries to JSON-parse the inner payload.
//
// Safety:
//   - Every call enforces `timeoutMs` by killing the child with SIGTERM,
//     then SIGKILL after a 500ms grace.
//   - Disallows all tools (`--tools ""`) so the CLI cannot browse the
//     filesystem / call subprocesses / touch git — it only reasons about
//     the prompt and returns text.
//   - Runs with `--permission-mode dontAsk` so no interactive prompts can
//     hang the pipeline.
//   - Returns a structured object; the caller decides what to do on error.
//
// Env:
//   OPENCLAW_CLAUDE_CLI_BIN         path to claude binary (default 'claude')
//   OPENCLAW_CLAUDE_CLI_MODEL       default model (default 'sonnet')
//   OPENCLAW_CLAUDE_CLI_TIMEOUT_MS  default timeout (default 15000)

const { spawn } = require("child_process");
const { claudeCliAllowed, retiredReason } = require("../utils/paidAiProviderGuard");

const DEFAULT_BIN = "claude";
const DEFAULT_MODEL = "sonnet";
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60_000;

function resolveBin() {
  return String(process.env.OPENCLAW_CLAUDE_CLI_BIN || "").trim() || DEFAULT_BIN;
}

function resolveModel() {
  return String(process.env.OPENCLAW_CLAUDE_CLI_MODEL || "").trim() || DEFAULT_MODEL;
}

function resolveTimeoutMs(explicit) {
  const n = Number(explicit);
  if (!Number.isFinite(n)) {
    const raw = Number(process.env.OPENCLAW_CLAUDE_CLI_TIMEOUT_MS);
    const fromEnv = Number.isFinite(raw) ? raw : DEFAULT_TIMEOUT_MS;
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, fromEnv));
  }
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, n));
}

function stripCodeFences(text = "") {
  const t = String(text || "").trim();
  if (!t) return t;
  // ``` or ```json
  const match = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1].trim() : t;
}

function tryParseJson(text = "") {
  const cleaned = stripCodeFences(text).trim();
  if (!cleaned) return null;
  try { return JSON.parse(cleaned); } catch (_) {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

function buildArgs({ model, systemPrompt = null }) {
  const args = [
    "-p",
    "--output-format", "json",
    "--model", model,
    "--tools", "",
    "--no-session-persistence",
    "--permission-mode", "dontAsk",
  ];
  if (systemPrompt) {
    args.push("--append-system-prompt", systemPrompt);
  }
  return args;
}

async function callClaudeCli({
  prompt,
  model = null,
  systemPrompt = null,
  timeoutMs = null,
  cwd = null,
} = {}) {
  if (!claudeCliAllowed()) {
    return { ok: false, reason: retiredReason("CLAUDE_CLI") };
  }
  const resolvedPrompt = String(prompt == null ? "" : prompt);
  if (!resolvedPrompt) {
    return { ok: false, reason: "EMPTY_PROMPT" };
  }
  const bin = resolveBin();
  const resolvedModel = String(model || "").trim() || resolveModel();
  const resolvedTimeout = resolveTimeoutMs(timeoutMs);
  const args = buildArgs({ model: resolvedModel, systemPrompt });

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let child;
    try {
      child = spawn(bin, args, {
        cwd: cwd || process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ ok: false, reason: "SPAWN_FAIL", error: err && err.message ? err.message : String(err) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    const finalize = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ...result,
        duration_ms: Date.now() - startedAt,
        bin,
        model: resolvedModel,
      });
    };

    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });

    child.on("error", (err) => {
      finalize({
        ok: false,
        reason: "CHILD_ERROR",
        error: err && err.message ? err.message : String(err),
        stderr_tail: stderr.slice(-800),
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finalize({ ok: false, reason: "TIMEOUT", timeout_ms: resolvedTimeout });
        return;
      }
      if (code !== 0) {
        finalize({
          ok: false,
          reason: "NONZERO_EXIT",
          exit_code: code,
          signal: signal || null,
          stderr_tail: stderr.slice(-800),
        });
        return;
      }
      const outer = tryParseJson(stdout);
      if (!outer) {
        finalize({ ok: false, reason: "NON_JSON_STDOUT", stdout_tail: stdout.slice(-800) });
        return;
      }
      if (outer.is_error === true || outer.subtype === "error" || outer.type === "error") {
        finalize({
          ok: false,
          reason: "CLI_REPORTED_ERROR",
          outer_result: outer.result || null,
          raw_outer: outer,
        });
        return;
      }
      const inner = tryParseJson(outer.result || "");
      if (!inner) {
        finalize({
          ok: false,
          reason: "NON_JSON_INNER_RESULT",
          outer_result: outer.result || null,
          raw_outer: outer,
        });
        return;
      }
      finalize({
        ok: true,
        parsed: inner,
        raw_outer: outer,
        cost_usd: outer.total_cost_usd ?? null,
        api_duration_ms: outer.duration_api_ms ?? null,
      });
    });

    try {
      child.stdin.write(resolvedPrompt);
      child.stdin.end();
    } catch (_) { /* ignore; close event will capture the error */ }

    killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch (_) {}
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch (_) {}
      }, 500).unref();
    }, resolvedTimeout);
    if (killTimer && typeof killTimer.unref === "function") killTimer.unref();
  });
}

module.exports = {
  DEFAULT_BIN,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  callClaudeCli,
  __test: {
    buildArgs,
    stripCodeFences,
    tryParseJson,
    resolveBin,
    resolveModel,
    resolveTimeoutMs,
  },
};
