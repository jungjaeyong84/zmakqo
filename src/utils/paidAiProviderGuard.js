"use strict";

function truthy(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function paidAiApiDisabled(env = process.env) {
  return truthy(env.DONBEOLJA_PAID_AI_API_DISABLED === undefined ? "1" : env.DONBEOLJA_PAID_AI_API_DISABLED);
}

function anthropicApiAllowed(env = process.env) {
  return !paidAiApiDisabled(env) && truthy(env.DONBEOLJA_ALLOW_ANTHROPIC_API);
}

function claudeCliAllowed(env = process.env) {
  return !paidAiApiDisabled(env) && truthy(env.DONBEOLJA_ALLOW_CLAUDE_CLI);
}

function openaiApiAllowed(env = process.env) {
  return !paidAiApiDisabled(env) && truthy(env.DONBEOLJA_ALLOW_OPENAI_API);
}

function geminiApiAllowed(env = process.env) {
  return !paidAiApiDisabled(env) && truthy(env.DONBEOLJA_ALLOW_GEMINI_API);
}

function retiredReason(provider) {
  return `${String(provider || "PAID_AI").toUpperCase()}_RETIRED_BY_DONBEOLJA_V2`;
}

module.exports = {
  anthropicApiAllowed,
  claudeCliAllowed,
  geminiApiAllowed,
  openaiApiAllowed,
  paidAiApiDisabled,
  retiredReason,
  __test: { truthy },
};
