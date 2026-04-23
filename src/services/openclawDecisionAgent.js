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
const mlSoftGate = require("./openclawMlSoftGate");
// liveInferenceRouter is loaded lazily so offline tests do not hit Firestore.
let cachedRouterLoader = null;
function resolveRouterLoader() {
  if (cachedRouterLoader) return cachedRouterLoader;
  try {
    // eslint-disable-next-line global-require
    cachedRouterLoader = require("./liveInferenceRouter").loadLiveInferenceRouter;
  } catch (_) {
    cachedRouterLoader = async () => null;
  }
  return cachedRouterLoader;
}

let cachedV2ShadowWriter = null;
function resolveV2ShadowWriter() {
  if (cachedV2ShadowWriter) return cachedV2ShadowWriter;
  try {
    cachedV2ShadowWriter = require("../v2/openclawShadowWriter");
  } catch (_) {
    cachedV2ShadowWriter = {
      writeOpenClawShadowDecision: async () => ({ ok: false, written: false, skipped: true, reason: "V2_SHADOW_WRITER_UNAVAILABLE" }),
    };
  }
  return cachedV2ShadowWriter;
}

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
function autonomyEnabled() { return envFlagOn("OPENCLAW_AGENT_AUTONOMY_ENABLED"); }

// Phase E auto-degrade: the calibration report at
// `ops/daily/openclaw_calibration_latest.json` declares per-source trust
// weights. When autonomy is enabled and a source's trust falls below
// OPENCLAW_AGENT_AUTONOMY_TRUST_FLOOR (default 0.3) its vote is dropped.
// The report path / trust values are NEVER consulted when autonomy is
// off, so Phase A..D behaviour is unchanged.
function autonomyTrustFloor() {
  const raw = Number(process.env.OPENCLAW_AGENT_AUTONOMY_TRUST_FLOOR);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 1) return raw;
  return 0.3;
}

const _calibrationCache = { loaded_at_ms: 0, trust: {} };
const _calibrationTtlMs = 60_000;
function loadAutonomyTrustWeights() {
  if (!autonomyEnabled()) return {};
  const now = Date.now();
  if ((now - _calibrationCache.loaded_at_ms) < _calibrationTtlMs) {
    return _calibrationCache.trust;
  }
  try {
    // eslint-disable-next-line global-require
    const fs = require("fs");
    // eslint-disable-next-line global-require
    const path = require("path");
    const p = path.resolve(__dirname, "..", "..", "ops", "daily", "openclaw_calibration_latest.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    const tw = (raw && raw.trust_weights && typeof raw.trust_weights === "object") ? raw.trust_weights : {};
    _calibrationCache.trust = {
      rule: Number.isFinite(Number(tw.rule)) ? Number(tw.rule) : 1,
      ml: Number.isFinite(Number(tw.ml)) ? Number(tw.ml) : 0.7,
      narrative: Number.isFinite(Number(tw.narrative)) ? Number(tw.narrative) : 0.4,
    };
  } catch (_) {
    _calibrationCache.trust = { rule: 1, ml: 0.7, narrative: 0.4 };
  }
  _calibrationCache.loaded_at_ms = now;
  return _calibrationCache.trust;
}

function shouldDropVote(source) {
  if (!autonomyEnabled()) return false;
  const trust = loadAutonomyTrustWeights();
  const value = Number(trust && trust[source]);
  if (!Number.isFinite(value)) return false;
  return value < autonomyTrustFloor();
}

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

// Phase B ML soft-gate. Reads the predicted TP1 probability carried in
// features, looks up the empirical calibration bucket from
// `best_self_evolution_ev_probability_calibration_latest.json`, and votes
// accept/reject against `OPENCLAW_ML_MIN_TP1_PROB` (default 0.22). It also
// honours the live inference router's `block_new_entries` flag — when the
// ML serving state is degraded/rolled-back, the gate vetoes regardless of
// probability. Any Firestore / artifact failure falls back to a neutral
// vote so the rule engine is still authoritative.
async function evaluateMlGate(input = {}) {
  if (!mlGateEnabled()) return null;
  const routerLoader = resolveRouterLoader();
  const router = await routerLoader({ exchange: input.exchange }).catch(() => null);
  return mlSoftGate.evaluate({
    features: input.features || null,
    liveInferenceRouter: router || null,
  });
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

  // Phase E auto-degrade: when autonomy is enabled and calibration says a
  // source is untrustworthy, its vote is dropped entirely (it cannot veto
  // AND it cannot reduce scale).
  const mlDemoted = shouldDropVote("ml");
  const narrativeDemoted = shouldDropVote("narrative");
  if (mlDemoted) reasonTrace.push("ML_GATE:AUTO_DEMOTED");
  if (narrativeDemoted) reasonTrace.push("NARRATIVE:AUTO_DEMOTED");

  // ML soft-gate: in Phase B a live calibrated probability votes.
  if (!mlDemoted && mlVote && mlVote.accept === false) {
    return {
      accept: false,
      scale: 0,
      qty_pct_final: 0,
      reason_trace: [...reasonTrace, "ML_GATE_REJECT"],
    };
  }
  if (!mlDemoted && mlVote && mlVote.stubbed) reasonTrace.push("ML_GATE:STUB");
  if (!mlDemoted && mlVote && mlVote.reason) reasonTrace.push(`ML:${mlVote.reason}`);

  // Narrative can only reduce. It cannot amplify. It cannot accept over a
  // rule block (already handled above).
  if (!narrativeDemoted && narrativeVote && narrativeVote.disabled !== true) {
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

  if (shadowEnabled() && !applyEnabled()) {
    try {
      const v2ShadowWriter = resolveV2ShadowWriter();
      const shadowWrite = await v2ShadowWriter.writeOpenClawShadowDecision({
        input,
        ruleResult,
        composite,
        mlVote,
        narrativeVote,
      });
      if (shadowWrite && shadowWrite.ok !== true && shadowWrite.skipped !== true) {
        console.warn("[OPENCLAW_AGENT_V2_SHADOW_WRITE_FAIL]", {
          symbol: input && input.symbol ? String(input.symbol).toUpperCase() : null,
          reason: shadowWrite.reason || "UNKNOWN",
        });
      }
    } catch (shadowWriteError) {
      console.warn("[OPENCLAW_AGENT_V2_SHADOW_WRITE_THROW]", {
        symbol: input && input.symbol ? String(input.symbol).toUpperCase() : null,
        error: shadowWriteError && shadowWriteError.message ? shadowWriteError.message : String(shadowWriteError),
      });
    }
  }

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
