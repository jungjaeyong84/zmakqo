"use strict";

// Phase C backend — Codex CLI adapter.
//
// Shells out to the local `codex` binary (OpenAI's Codex CLI) non-interactively
// so the openclaw narrative reasoner can run on the user's already-authenticated
// Codex CLI quota instead of (or in front of) the Claude CLI.
//
// The invocation contract is deliberately narrow and matches what `codex exec`
// supports directly — NO shell wrappers. The `codex-with-fallback` wrapper
// installed at `~/.local/bin/codex-with-fallback` implements ITS OWN fallback
// logic and munges output; running that from Node would break the response
// contract. openclaw owns its fallback (see openclawNarrativeReasoner.js).
//
// Subprocess contract:
//   codex exec --sandbox read-only
//              --skip-git-repo-check
//              --ephemeral
//              --color never
//              --output-last-message <TMPFILE>
//              --model <MODEL>
//              -   (prompt on stdin)
//
//   stdout/stderr: progress chatter we ignore aside from the quota-pattern
//     scan that detects usage exhaustion.
//   <TMPFILE>: the agent's final message, possibly fenced. We strip fences
//     and JSON-parse.
//
// Safety:
//   - `--sandbox read-only` and `--ephemeral` prevent the CLI from mutating
//     anything on disk even if the model tries to call tools.
//   - `--skip-git-repo-check` lets us run outside a repo root without the
//     CLI prompting.
//   - Timeout is enforced by SIGTERM then SIGKILL after a 500ms grace.
//   - The tmp output file is unlinked in finally.
//
// Quota detection: on non-zero exit or missing output, we scan combined
// stderr+stdout for the same patterns used by scripts/lib/codex-openai-fallback.js
// (QUOTA|USAGE LIMIT|RATE LIMIT|TOO MANY REQUESTS|BILLING|CREDIT|EXHAUST) and
// return `reason: "CODEX_CLI_USAGE_EXHAUSTED"`. The narrative reasoner uses
// that specific reason to trigger Claude-CLI fallback.
//
// Env:
//   OPENCLAW_CODEX_CLI_BIN         path to codex binary (default 'codex')
//   OPENCLAW_CODEX_CLI_MODEL       default model (default 'gpt-5.2-codex')
//   OPENCLAW_CODEX_CLI_TIMEOUT_MS  default timeout (default 15000)
//   OPENCLAW_CODEX_CLI_SANDBOX     sandbox mode (default 'read-only')

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_BIN = "codex";
const DEFAULT_MODEL = "gpt-5.2-codex";
const DEFAULT_SANDBOX = "read-only";
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60_000;

// Patterns shared with scripts/lib/codex-openai-fallback.js so the fallback
// trigger is consistent across the Node stack and the shell wrapper.
const QUOTA_PATTERN = /QUOTA|USAGE LIMIT|RATE LIMIT|TOO MANY REQUESTS|BILLING|CREDIT|EXHAUST/i;
const AUTH_PATTERN = /AUTH|LOGIN|UNAUTHORIZED|FORBIDDEN|API KEY/i;

function resolveBin() {
  // Priority:
  //   1. OPENCLAW_CODEX_CLI_BIN (openclaw-specific override)
  //   2. CODEX_BIN              (set by ops/launchd/load_ai_cli_env.sh →
  //                              points at /Applications/Codex.app/.../codex
  //                              because `codex` itself is only on PATH inside
  //                              zsh via the `codex-with-fallback` shell function,
  //                              which Node's subprocess spawn does NOT inherit)
  //   3. "codex"                (bare name — resolved via PATH)
  return (
    String(process.env.OPENCLAW_CODEX_CLI_BIN || "").trim()
    || String(process.env.CODEX_BIN || "").trim()
    || DEFAULT_BIN
  );
}

function resolveModel() {
  return String(process.env.OPENCLAW_CODEX_CLI_MODEL || "").trim() || DEFAULT_MODEL;
}

function resolveSandbox() {
  const raw = String(process.env.OPENCLAW_CODEX_CLI_SANDBOX || "").trim().toLowerCase();
  if (raw === "workspace-write" || raw === "danger-full-access" || raw === "read-only") {
    return raw;
  }
  return DEFAULT_SANDBOX;
}

function resolveTimeoutMs(explicit) {
  const n = Number(explicit);
  if (!Number.isFinite(n)) {
    const raw = Number(process.env.OPENCLAW_CODEX_CLI_TIMEOUT_MS);
    const fromEnv = Number.isFinite(raw) ? raw : DEFAULT_TIMEOUT_MS;
    return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, fromEnv));
  }
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, n));
}

function stripCodeFences(text = "") {
  const t = String(text || "").trim();
  if (!t) return t;
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

function classifyFailure({ stdout = "", stderr = "" }) {
  const combined = `${stderr}\n${stdout}`;
  if (QUOTA_PATTERN.test(combined)) return "CODEX_CLI_USAGE_EXHAUSTED";
  if (AUTH_PATTERN.test(combined)) return "CODEX_CLI_AUTH_BLOCKED";
  return null;
}

function buildArgs({ model, sandbox, outputFile }) {
  // `-` as positional arg forces stdin reading even if, on some shells, the
  // arg parser would otherwise consume a trailing token.
  return [
    "exec",
    "--sandbox", sandbox,
    "--skip-git-repo-check",
    "--ephemeral",
    "--color", "never",
    "--output-last-message", outputFile,
    "--model", model,
    "-",
  ];
}

function composePrompt({ prompt, systemPrompt }) {
  const body = String(prompt == null ? "" : prompt);
  if (!systemPrompt) return body;
  return `${String(systemPrompt).trim()}\n\n---\n\n${body}`;
}

function makeTmpFile() {
  const rand = crypto.randomBytes(4).toString("hex");
  return path.join(os.tmpdir(), `openclaw-codex-${process.pid}-${Date.now()}-${rand}.txt`);
}

function safeUnlink(p) {
  if (!p) return;
  try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
}

async function callCodexCli({
  prompt,
  model = null,
  systemPrompt = null,
  timeoutMs = null,
  cwd = null,
} = {}) {
  const resolvedPrompt = String(prompt == null ? "" : prompt);
  if (!resolvedPrompt) {
    return { ok: false, reason: "EMPTY_PROMPT" };
  }
  const bin = resolveBin();
  const resolvedModel = String(model || "").trim() || resolveModel();
  const resolvedSandbox = resolveSandbox();
  const resolvedTimeout = resolveTimeoutMs(timeoutMs);
  const outputFile = makeTmpFile();
  const args = buildArgs({ model: resolvedModel, sandbox: resolvedSandbox, outputFile });
  const composedPrompt = composePrompt({ prompt: resolvedPrompt, systemPrompt });

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
      safeUnlink(outputFile);
      resolve({
        ok: false,
        reason: "SPAWN_FAIL",
        error: err && err.message ? err.message : String(err),
        bin,
        model: resolvedModel,
        duration_ms: Date.now() - startedAt,
      });
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
      safeUnlink(outputFile);
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

      // Quota/auth scan runs before the exit-code branch so we surface the
      // specific fallback-trigger reason even on soft 0 exits.
      const classified = classifyFailure({ stdout, stderr });

      if (code !== 0) {
        finalize({
          ok: false,
          reason: classified || "NONZERO_EXIT",
          exit_code: code,
          signal: signal || null,
          stderr_tail: stderr.slice(-800),
          stdout_tail: stdout.slice(-800),
        });
        return;
      }

      // Read the last-message file. If the file is empty or missing, the
      // model produced nothing useful — classify accordingly.
      let lastMessage = "";
      try {
        lastMessage = fs.readFileSync(outputFile, "utf8");
      } catch (_) {
        finalize({
          ok: false,
          reason: classified || "NO_OUTPUT_FILE",
          stderr_tail: stderr.slice(-800),
        });
        return;
      }

      if (!lastMessage || !lastMessage.trim()) {
        finalize({
          ok: false,
          reason: classified || "EMPTY_OUTPUT",
          stderr_tail: stderr.slice(-800),
        });
        return;
      }

      const parsed = tryParseJson(lastMessage);
      if (!parsed) {
        finalize({
          ok: false,
          reason: "NON_JSON_OUTPUT",
          last_message_tail: lastMessage.slice(-800),
          stderr_tail: stderr.slice(-800),
        });
        return;
      }

      finalize({
        ok: true,
        parsed,
        raw_last_message: lastMessage,
      });
    });

    try {
      child.stdin.write(composedPrompt);
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
  DEFAULT_SANDBOX,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  QUOTA_PATTERN,
  AUTH_PATTERN,
  callCodexCli,
  __test: {
    buildArgs,
    stripCodeFences,
    tryParseJson,
    classifyFailure,
    composePrompt,
    resolveBin,
    resolveModel,
    resolveSandbox,
    resolveTimeoutMs,
  },
};
