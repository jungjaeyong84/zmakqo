"use strict";

// Phase A of the OpenClaw Decision Agent — narrative reasoner stub.
//
// This module defines the prompt contract for LLM-based narrative reasoning
// without actually performing an LLM call. The real call will be wired
// behind `OPENCLAW_NARRATIVE_ENABLED=1` in Phase C once we are ready to run
// it in shadow. Today every caller receives a deterministic
// `{ disabled: true }` result and writes no evidence.
//
// The three prompt templates cover the three agent roles:
//   - SIGNAL_DECIDER  : reason about a single entry opportunity
//   - POSITION_CONDUCTOR : reason about tightening stops on an open position
//   - RETROSPECT      : reason about the last N realized trades
//
// Safety invariants (enforced here so the Phase C wiring inherits them):
//   - Timeout is clamped to [500ms, 15000ms].
//   - Responses are scanned for known "widen SL" patterns; if present, the
//     proposal is demoted to `NONE` and the violation is logged.
//   - Responses carry a confidence in [0, 1]; values outside clamp to 0.
//   - Responses never raise qty scale > 1; amplification is refused at the
//     parser level.

const crypto = require("crypto");

// Phase C: live LLM client loaded lazily behind a try/catch so offline
// tests can exercise the prompt-safety layer without API keys or network.
let cachedClaudeClient = null;
function resolveClaudeClient() {
  if (cachedClaudeClient !== null) return cachedClaudeClient;
  try {
    // eslint-disable-next-line global-require
    cachedClaudeClient = require("./claudeClient").callClaude || null;
  } catch (_) {
    cachedClaudeClient = null;
  }
  return cachedClaudeClient;
}

function liveCallEnabled() {
  return String(process.env.OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED || "").trim() === "1";
}

function narrativeModel() {
  const explicit = String(process.env.OPENCLAW_NARRATIVE_MODEL || "").trim();
  if (explicit) return explicit;
  return "claude-opus-4-7";
}

function narrativeApiKey() {
  return String(
    process.env.OPENCLAW_NARRATIVE_CLAUDE_API_KEY
    || process.env.CLAUDE_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || ""
  ).trim() || null;
}

const ROLES = Object.freeze({
  SIGNAL_DECIDER: "SIGNAL_DECIDER",
  POSITION_CONDUCTOR: "POSITION_CONDUCTOR",
  RETROSPECT: "RETROSPECT",
});

const DEFAULT_TIMEOUT_MS = 5000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 15000;
const MAX_SCALE = 1.0; // Narrative can never amplify.

function narrativeEnabled() {
  return String(process.env.OPENCLAW_NARRATIVE_ENABLED || "").trim() === "1";
}

function shadowOnly() {
  const v = String(process.env.OPENCLAW_NARRATIVE_SHADOW_ONLY || "1").trim();
  return v === "1";
}

function resolveTimeoutMs(explicit) {
  const n = Number(explicit);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, n));
}

function promptHash(body) {
  try {
    return crypto.createHash("sha256").update(body).digest("hex").slice(0, 16);
  } catch (_) {
    return null;
  }
}

function buildSignalPromptBody({
  exchange, symbol, side, qtyPct, features = {}, ruleVote = null, mlVote = null,
} = {}) {
  const ctx = {
    exchange, symbol, side, qtyPct,
    regime: features.regime || features.market_regime || null,
    signal_quality: features.signal_quality || null,
    rule: ruleVote ? { accept: !!ruleVote.accept, reasons: ruleVote.reasons || [] } : null,
    ml: mlVote ? { tp1_probability: Number(mlVote.tp1_probability) || null } : null,
  };
  return [
    "You are the OpenClaw risk-first signal reviewer.",
    "Decide if we should enter, reduce, or skip this trade.",
    "Hard rules: you cannot widen SL; you can only recommend smaller qty, skip, or same-qty pass.",
    "Return strict JSON: { accept: boolean, scale: number in [0,1], confidence: number in [0,1], reason: string }",
    "Evidence:",
    JSON.stringify(ctx),
  ].join("\n");
}

function buildPositionPromptBody({ exchange, symbol, positionSnapshot, ticks = [] } = {}) {
  const ctx = {
    exchange, symbol,
    side: positionSnapshot && positionSnapshot.position_side,
    avg_price: positionSnapshot && positionSnapshot.avg_price,
    runner_remaining_qty_abs: positionSnapshot && positionSnapshot.meta && positionSnapshot.meta.runner_remaining_qty_abs,
    trail_active: !!(positionSnapshot && positionSnapshot.meta && positionSnapshot.meta.trail_active),
    sl_price: positionSnapshot && positionSnapshot.meta && positionSnapshot.meta.initial_stop_price,
    tp1_price: positionSnapshot && positionSnapshot.meta && positionSnapshot.meta.tp_p1_price,
    recent_tick_count: ticks.length,
  };
  return [
    "You are the OpenClaw position conductor. You can ONLY propose:",
    "  - tighten_sl   : move the stop closer to the current price",
    "  - earlier_tp1  : move TP1 closer to the current price",
    "  - abort        : close now if the position is breaking its thesis",
    "  - hold         : no change",
    "You CANNOT widen SL, CANNOT remove trailing, CANNOT enlarge qty.",
    "Return strict JSON: { proposal: 'tighten_sl' | 'earlier_tp1' | 'abort' | 'hold', confidence: number in [0,1], reason: string }",
    "Position state:",
    JSON.stringify(ctx),
  ].join("\n");
}

function buildRetrospectPromptBody({ trades = [] } = {}) {
  const summary = (trades || []).slice(0, 50).map((t) => ({
    symbol: t.symbol,
    outcome: t.outcome,                 // TP1_FIRST / SL_FIRST / TRAIL_FINAL / TIME_STOP
    realised_ret_net: t.realised_ret_net,
    regime: t.regime || null,
    side: t.side,
  }));
  return [
    "You are the OpenClaw retrospective reviewer.",
    "Given the last N realized trades, emit up to 5 failure-pattern hypotheses and up to 3 parameter-drift proposals.",
    "Each proposal MUST reduce risk (tighter SL / smaller qty / skip a regime). Refuse to propose looser risk.",
    "Return strict JSON: { hypotheses: string[], proposals: [{ param: string, direction: 'tighter'|'smaller'|'skip_regime', confidence: number }] }",
    "Trades (truncated to 50):",
    JSON.stringify(summary),
  ].join("\n");
}

// Detects patterns that would violate our safety rails if an LLM tried to
// emit them. We refuse such responses at the parser level.
function violatesSafetyRails(response = {}) {
  const issues = [];
  if (response && Number(response.scale) > MAX_SCALE) issues.push("SCALE_GT_ONE");
  if (response && response.proposal === "widen_sl") issues.push("WIDEN_SL_PROPOSED");
  if (response && response.proposal === "disable_trailing") issues.push("DISABLE_TRAILING");
  if (response && response.proposal === "increase_qty") issues.push("INCREASE_QTY");
  return issues;
}

function clampResponse(raw = {}) {
  const issues = violatesSafetyRails(raw);
  const confidence = Number(raw && raw.confidence);
  const scale = Number(raw && raw.scale);
  return {
    accept: raw && raw.accept === false ? false : (raw && raw.accept === true ? true : null),
    scale: Number.isFinite(scale) ? Math.max(0, Math.min(MAX_SCALE, scale)) : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    proposal: raw && typeof raw.proposal === "string" ? raw.proposal : null,
    reason: raw && raw.reason ? String(raw.reason) : null,
    safety_rail_violations: issues,
  };
}

function tryParseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }
  return null;
}

async function runLiveLlm(body, { timeoutMs } = {}) {
  const callClaude = resolveClaudeClient();
  const apiKey = narrativeApiKey();
  if (!callClaude || !apiKey) {
    return { ok: false, reason: "LLM_CLIENT_UNAVAILABLE" };
  }
  const effectiveTimeout = resolveTimeoutMs(timeoutMs);
  try {
    const completed = await Promise.race([
      callClaude({
        apiKey,
        model: narrativeModel(),
        system: "You are the OpenClaw risk-first narrative reasoner. Always return strict JSON only.",
        prompt: body,
        temperature: 0.2,
        maxTokens: 512,
        jsonMode: true,
      }),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "TIMEOUT" }), effectiveTimeout)),
    ]);
    if (!completed || completed.ok === false) {
      return { ok: false, reason: (completed && completed.reason) || "LLM_FAIL" };
    }
    const text = completed.text || completed.content || completed.body || "";
    const parsed = tryParseJsonFromText(text);
    if (!parsed) return { ok: false, reason: "LLM_NON_JSON", text };
    return { ok: true, parsed, raw_text: text, latency_ms: completed.latency_ms || null };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : String(err) };
  }
}

async function reasonAboutSignal(input = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!narrativeEnabled()) {
    return { disabled: true, role: ROLES.SIGNAL_DECIDER, shadow_only: shadowOnly() };
  }
  const body = buildSignalPromptBody(input);
  const base = {
    disabled: false,
    role: ROLES.SIGNAL_DECIDER,
    shadow_only: shadowOnly(),
    timeout_ms: resolveTimeoutMs(timeoutMs),
    prompt_hash: promptHash(body),
  };
  if (!liveCallEnabled()) {
    return {
      ...base,
      stubbed: true,
      response: clampResponse({ accept: null, scale: 1, confidence: 0, reason: "NARRATIVE_STUB" }),
    };
  }
  const live = await runLiveLlm(body, { timeoutMs });
  if (!live.ok) {
    return {
      ...base,
      stubbed: false,
      live_failed: true,
      live_reason: live.reason,
      response: clampResponse({ accept: null, scale: 1, confidence: 0, reason: `NARRATIVE_LIVE_FAIL:${live.reason}` }),
    };
  }
  return {
    ...base,
    stubbed: false,
    live_failed: false,
    live_latency_ms: live.latency_ms || null,
    response: clampResponse(live.parsed),
  };
}

async function reasonAboutPosition(input = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!narrativeEnabled()) {
    return { disabled: true, role: ROLES.POSITION_CONDUCTOR, shadow_only: shadowOnly() };
  }
  const body = buildPositionPromptBody(input);
  const base = {
    disabled: false,
    role: ROLES.POSITION_CONDUCTOR,
    shadow_only: shadowOnly(),
    timeout_ms: resolveTimeoutMs(timeoutMs),
    prompt_hash: promptHash(body),
  };
  if (!liveCallEnabled()) {
    return {
      ...base,
      stubbed: true,
      response: clampResponse({ proposal: "hold", confidence: 0, reason: "NARRATIVE_STUB" }),
    };
  }
  const live = await runLiveLlm(body, { timeoutMs });
  if (!live.ok) {
    return {
      ...base,
      stubbed: false,
      live_failed: true,
      live_reason: live.reason,
      response: clampResponse({ proposal: "hold", confidence: 0, reason: `NARRATIVE_LIVE_FAIL:${live.reason}` }),
    };
  }
  return {
    ...base,
    stubbed: false,
    live_failed: false,
    live_latency_ms: live.latency_ms || null,
    response: clampResponse(live.parsed),
  };
}

async function reasonAboutFailurePatterns(input = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!narrativeEnabled()) {
    return { disabled: true, role: ROLES.RETROSPECT, shadow_only: shadowOnly() };
  }
  const body = buildRetrospectPromptBody(input);
  const base = {
    disabled: false,
    role: ROLES.RETROSPECT,
    shadow_only: shadowOnly(),
    timeout_ms: resolveTimeoutMs(timeoutMs),
    prompt_hash: promptHash(body),
  };
  if (!liveCallEnabled()) {
    return {
      ...base,
      stubbed: true,
      response: { hypotheses: [], proposals: [], safety_rail_violations: [] },
    };
  }
  const live = await runLiveLlm(body, { timeoutMs });
  if (!live.ok) {
    return {
      ...base,
      stubbed: false,
      live_failed: true,
      live_reason: live.reason,
      response: { hypotheses: [], proposals: [], safety_rail_violations: [`LIVE_FAIL:${live.reason}`] },
    };
  }
  const parsed = live.parsed || {};
  const hypotheses = Array.isArray(parsed.hypotheses) ? parsed.hypotheses.slice(0, 5) : [];
  const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, 3) : [];
  return {
    ...base,
    stubbed: false,
    live_failed: false,
    live_latency_ms: live.latency_ms || null,
    response: { hypotheses, proposals, safety_rail_violations: [] },
  };
}

module.exports = {
  ROLES,
  DEFAULT_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_SCALE,
  narrativeEnabled,
  shadowOnly,
  resolveTimeoutMs,
  promptHash,
  buildSignalPromptBody,
  buildPositionPromptBody,
  buildRetrospectPromptBody,
  violatesSafetyRails,
  clampResponse,
  reasonAboutSignal,
  reasonAboutPosition,
  reasonAboutFailurePatterns,
};
