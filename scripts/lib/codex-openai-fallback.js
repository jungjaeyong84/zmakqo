"use strict";

const { callOpenAI, safeJsonParse } = require("../../src/services/openaiClient");

const DEFAULT_OPENAI_CODEX_MODEL = "gpt-5.2-codex";

function tailLines(text, limit = 20) {
  return String(text || "").trim().split(/\r?\n/).filter(Boolean).slice(-limit);
}

function summarizeCliFailure({ cliResult = null, cliMissing = false } = {}) {
  if (cliMissing) return "CODEX_CLI_MISSING";
  if (!cliResult) return "CODEX_CLI_UNKNOWN";
  if (cliResult.res && cliResult.res.timedOut === true) return "CODEX_CLI_TIMEOUT";
  if (cliResult.res && cliResult.res.error && cliResult.res.error.code === "ETIMEDOUT") return "CODEX_CLI_TIMEOUT";
  const stderr = String(cliResult.res && cliResult.res.stderr || "");
  const stdout = String(cliResult.res && cliResult.res.stdout || "");
  const combined = `${stderr}\n${stdout}`.toUpperCase();
  if (/QUOTA|USAGE LIMIT|RATE LIMIT|TOO MANY REQUESTS|BILLING|CREDIT|EXHAUST/i.test(combined)) {
    return "CODEX_CLI_USAGE_EXHAUSTED";
  }
  if (/AUTH|LOGIN|UNAUTHORIZED|FORBIDDEN|API KEY/i.test(combined)) {
    return "CODEX_CLI_AUTH_BLOCKED";
  }
  if (cliResult.res && cliResult.res.error) return `CODEX_CLI_ERROR:${cliResult.res.error.code || "ERROR"}`;
  if (cliResult.res && Number.isFinite(cliResult.res.status) && cliResult.res.status !== 0) {
    return `CODEX_CLI_EXIT_${cliResult.res.status}`;
  }
  return "CODEX_CLI_PARSE_FAILED";
}

function shouldUseOpenAICodexFallback({ cliResult = null, cliMissing = false } = {}) {
  if (String(process.env.OPENAI_CODEX_FALLBACK_ENABLED || "0").trim() !== "1") return false;
  if (!String(process.env.OPENAI_API_KEY || "").trim()) return false;
  if (cliMissing) return true;
  if (!cliResult || cliResult.parsed) return false;
  return true;
}

async function runOpenAICodexFallback({
  prompt,
  system,
  schema = null,
  model = "",
  reasoningEffort = "",
  maxTokens = 2400,
} = {}) {
  const fallbackModel = String(model || process.env.OPENAI_CODEX_FALLBACK_MODEL || DEFAULT_OPENAI_CODEX_MODEL).trim();
  const fallbackReasoning = String(reasoningEffort || process.env.OPENAI_CODEX_FALLBACK_REASONING_EFFORT || "high").trim().toLowerCase();
  const schemaInstructions = schema
    ? `\n\nReturn a JSON object that matches this schema exactly:\n${JSON.stringify(schema, null, 2)}`
    : "";
  const result = await callOpenAI({
    apiKey: String(process.env.OPENAI_API_KEY || "").trim(),
    model: fallbackModel,
    prompt: `${String(prompt || "").trim()}${schemaInstructions}`,
    system: String(system || "You are Codex. Return valid JSON only.").trim(),
    temperature: 0.1,
    maxTokens,
    jsonMode: true,
    reasoningEffort: fallbackReasoning,
  });
  const parsed = safeJsonParse(result.text || "");
  return {
    ok: !!(result.ok && parsed),
    reason: result.ok ? (parsed ? null : "OPENAI_CODEX_PARSE_FAILED") : String(result.reason || "OPENAI_CODEX_FAILED"),
    parsed,
    finalRaw: String(result.text || ""),
    execution_provider: "OPENAI_API_CODEX",
    execution_model: fallbackModel,
    reasoning_effort: fallbackReasoning || null,
    stderr_tail: tailLines(result.reason || ""),
    raw: result.raw || null,
  };
}

module.exports = {
  DEFAULT_OPENAI_CODEX_MODEL,
  summarizeCliFailure,
  shouldUseOpenAICodexFallback,
  runOpenAICodexFallback,
  __test: {
    DEFAULT_OPENAI_CODEX_MODEL,
    summarizeCliFailure,
    shouldUseOpenAICodexFallback,
  },
};
