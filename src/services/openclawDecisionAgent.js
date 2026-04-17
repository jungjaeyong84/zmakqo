"use strict";

// OpenClaw Decision Agent — Phase A shell.
//
// The long-term goal (see docs/OPENCLAW_ML_AI_AGENT_DESIGN_2026-04-17.md)
// is for this module to own every entry / position-lifecycle / retrospect
// decision. Today it is deliberately a thin wrapper that:
//
//   1. Calls `evaluateOpenClawExecutionAuthority` (the current rule engine).
//   2. Optionally consults the ML soft-gate and the narrative reasoner when
//      the per-phase env flags are enabled.
//   3. Combines the votes under a veto-and-scale rule that never loosens
//      the rule engine's safety — narrative / ML can only reduce qty, never
//      amplify; rule HARD blocks are terminal.
//   4. Writes an Evidence Ledger record.
//   5. In **shadow mode** (`OPENCLAW_AGENT_SHADOW_ENABLED=1` but
//      `OPENCLAW_AGENT_APPLY_ENABLED=0`) the rule-engine decision is
//      returned unchanged to production; the agent decision is only
//      recorded for side-by-side calibration.
//
// Defaults are safe: with no env set, this module is a no-op — callers get
// the same object the current `evaluateOpenClawExecutionAuthority` returns.

const {
  evaluateOpenClawExecutionAuthority,
} = require("./openclawExecutionAuthority");
const evidenceLedger = require("./openclawEvidenceLedger");
const narrativeReasoner = require("./openclawNarrativeReasoner");

const SCALE_MAX = (() => {
  const raw = Number(process.env.LIVE_EXEC_POLICY_SCALE_MAX);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 2) return raw;
  return 1.2;
})();
const SCALE_MIN = (() => {
  const raw = Number(process.env.LIVE_EXEC_POLICY_SCALE_MIN);
  if (Number.isFinite(raw) && raw > 0 && raw <= 1) return raw;
  return 0.2;
})();

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function envFlagOn(name) {
  return String(process.env[name] || "").trim() === "1";
}

function agentEnabled() { return envFlagOn("OPENCLAW_AGENT_ENABLED"); }
function shadowEnabled() { return envFlagOn("OPENCLAW_AGENT_SHADOW_ENABLED"); }
function applyEnabled() { return envFlagOn("OPENCLAW_AGENT_APPLY_ENABLED"); }
function mlGateEnabled() { return envFlagOn("OPENCLAW_ML_GATE_ENABLED"); }

// Hard clamp: any proposal is bounded by the existing SCALE window so the
// agent cannot exceed the policy layer's own global qty ceiling.
function clampScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n)) return 1;
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, n));
}

// Turn a rule-engine result into a vote entry.
function ruleVoteFromAuthority(result) {
  if (!result || typeof result !== "object") return { accept: false, scale: 0, reasons: ["RULE_NO_RESULT"] };
  const qty = Number(result.qtyPctFinal);
  const accept = result.ok === true && Number.isFinite(qty) && qty > 0;
  return {
    accept,
    scale: accept ? 1 : 0,
    qty_pct_final: Number.isFinite(qty) ? qty : 0,
    reasons: Array.isArray(result.reasons) ? result.reasons : (result.reason ? [result.reason] : []),
    raw_reason: result.reason || null,
  };
}

// Phase A: ML soft-gate is a stub — Phase B wires the real model call.
async function evaluateMlGate(/* input */) {
  if (!mlGateEnabled()) return null;
  return {
    accept: true,
    tp1_probability: null,
    version_id: null,
    stubbed: true,
  };
}

function composeVotes({ ruleVote, mlVote, narrativeVote }) {
  // HARD rule block is terminal.
  if (!ruleVote || ruleVote.accept !== true) {
    return {
      accept: false,
      scale: 0,
      qty_pct_final: ruleVote ? ruleVote.qty_pct_final : 0,
      reason_trace: (ruleVote && ruleVote.reasons) || ["RULE_HARD_BLOCK"],
    };
  }

  let scale = 1;
  const reasonTrace = [];
  const ruleReason = (ruleVote && ruleVote.raw_reason) || (ruleVote && ruleVote.reasons && ruleVote.reasons[0]);
  if (ruleReason) reasonTrace.push(`RULE:${ruleReason}`);

  // ML soft-gate: in Phase A we only emit a trace line. The real veto goes
  // in Phase B once we have a calibrated probability.
  if (mlVote && mlVote.accept === false) {
    return {
      accept: false,
      scale: 0,
      qty_pct_final: 0,
      reason_trace: [...reasonTrace, "ML_GATE_REJECT"],
    };
  }
  if (mlVote && mlVote.stubbed) reasonTrace.push("ML_GATE:STUB");

  // Narrative can only reduce. It cannot amplify. It cannot accept over a
  // rule block (already handled above).
  if (narrativeVote && narrativeVote.disabled !== true) {
    const resp = narrativeVote.response || {};
    if (resp.accept === false) {
      return {
        accept: false,
        scale: 0,
        qty_pct_final: 0,
        reason_trace: [...reasonTrace, "NARRATIVE_VETO"],
      };
    }
    if (Number.isFinite(Number(resp.scale)) && Number(resp.scale) < scale) {
      scale = Math.max(0, Number(resp.scale));
      reasonTrace.push(`NARRATIVE_SCALE_REDUCE:${scale.toFixed(3)}`);
    }
    if (narrativeVote.shadow_only === true) reasonTrace.push("NARRATIVE:SHADOW_ONLY");
  }

  const composedScale = clampScale(scale);
  return {
    accept: true,
    scale: composedScale,
    qty_pct_final: (ruleVote.qty_pct_final || 0) * composedScale,
    reason_trace: reasonTrace,
  };
}

async function decideOnSignal(input = {}) {
  const ruleResult = await evaluateOpenClawExecutionAuthority(input);
  const ruleVote = ruleVoteFromAuthority(ruleResult);

  // Default: agent is a pass-through so production behaviour is unchanged.
  if (!agentEnabled() && !shadowEnabled()) {
    return { ...ruleResult, _agent_applied: false, _agent_shadow: false };
  }

  const mlVote = await evaluateMlGate(input).catch(() => null);
  const narrativeVote = await narrativeReasoner.reasonAboutSignal({
    exchange: input.exchange,
    symbol: input.symbol,
    side: input.side,
    qtyPct: input.qtyPct,
    features: input.features,
    ruleVote,
    mlVote,
  }).catch((err) => ({
    disabled: true,
    error: err && err.message ? err.message : String(err),
  }));

  const composite = composeVotes({ ruleVote, mlVote, narrativeVote });

  const record = await evidenceLedger.writeEvidenceRecord({
    kind: evidenceLedger.KINDS.SIGNAL_DECIDER,
    exchange: input.exchange,
    symbol: input.symbol,
    market: input.symbol,
    intent: input.intent,
    stage: input.stage,
    inputs: {
      features_hash: evidenceLedger.hashJson(input.features || {}),
      qty_pct_in: input.qtyPct,
      rule_raw_reason: ruleVote.raw_reason,
    },
    predictions: {
      rule: { accept: ruleVote.accept, scale: ruleVote.scale, reasons: ruleVote.reasons },
      ml: mlVote || null,
      narrative: narrativeVote || null,
    },
    composite,
  });

  // Shadow mode — return the rule result verbatim to production so
  // nothing actually changes. The agent's composite is only in the
  // evidence ledger for side-by-side review.
  if (shadowEnabled() && !applyEnabled()) {
    return {
      ...ruleResult,
      _agent_applied: false,
      _agent_shadow: true,
      _agent_decision_id: record && record.record && record.record.decision_id,
      _agent_composite: composite,
    };
  }

  if (!agentEnabled()) {
    return { ...ruleResult, _agent_applied: false, _agent_shadow: false };
  }

  // Live agent mode — the composite can reduce scale but never change
  // acceptance if the rule engine already said pass. A rule HARD block is
  // already terminal above.
  const baseQty = Number(ruleResult.qtyPctFinal);
  const finalQty = Number.isFinite(baseQty) && composite.accept
    ? Math.max(0, Math.min(1, baseQty * composite.scale))
    : 0;
  return {
    ...ruleResult,
    ok: composite.accept === true && finalQty > 0,
    qtyPctFinal: finalQty,
    reason: composite.accept ? ruleResult.reason : (composite.reason_trace.join(",") || ruleResult.reason),
    _agent_applied: true,
    _agent_shadow: false,
    _agent_decision_id: record && record.record && record.record.decision_id,
    _agent_composite: composite,
  };
}

module.exports = {
  decideOnSignal,
  composeVotes,
  ruleVoteFromAuthority,
  evaluateMlGate,
  clampScale,
  agentEnabled,
  shadowEnabled,
  applyEnabled,
  mlGateEnabled,
  __test: {
    SCALE_MAX,
    SCALE_MIN,
    envFlagOn,
  },
};
