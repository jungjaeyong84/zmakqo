"use strict";

// Phase D — OpenClaw Position Conductor.
//
// Per-tick conductor for open positions. Given the current snapshot + the
// last N ticks, the conductor may propose:
//   tighten_sl   — move SL closer to current price
//   earlier_tp1  — move TP1 closer to current price
//   abort        — exit immediately because the thesis is broken
//   hold         — no change
//
// Non-negotiable safety rails (enforced in code, not in prompt):
//   - CANNOT widen SL (propose a stop further from current price than the
//     existing stop). Violations downgrade the proposal to `hold` and log.
//   - CANNOT disable trailing.
//   - CANNOT increase qty / runner size.
//   - SL adjustments are only applied when the new stop is strictly safer
//     (closer to price in the profit direction).
//   - Runs only when `OPENCLAW_CONDUCTOR_ENABLED=1`. Defaults to disabled,
//     i.e. `proposeAdjustment()` returns `{ disabled: true }`.
//   - When `OPENCLAW_CONDUCTOR_SHADOW_ONLY=1` (default 1) the proposal is
//     returned but `apply_ready: false` so callers must not mutate. Flip
//     only when the Phase D→E promotion gate says so.

const narrativeReasoner = require("./openclawNarrativeReasoner");
const evidenceLedger = require("./openclawEvidenceLedger");

function envFlagOn(name, def = false) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

function conductorEnabled() { return envFlagOn("OPENCLAW_CONDUCTOR_ENABLED", false); }
function conductorShadowOnly() { return envFlagOn("OPENCLAW_CONDUCTOR_SHADOW_ONLY", true); }

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function upper(v) { return String(v || "").trim().toUpperCase() || null; }

function classifyProposal(raw) {
  const p = String(raw || "").trim().toLowerCase();
  if (p === "tighten_sl" || p === "earlier_tp1" || p === "abort" || p === "hold") return p;
  return "hold";
}

// Hard clamp: applied to every conductor proposal before it leaves this module.
function enforceSafetyRails({ proposal, positionSnapshot = null, adjustment = null }) {
  const violations = [];
  const normalized = classifyProposal(proposal);
  const snap = positionSnapshot || {};
  const side = upper(snap.position_side);
  const currentStop = toNum(snap.meta && (snap.meta.final_effective_stop || snap.meta.initial_stop_price));
  const currentPrice = toNum(snap.current_price) || toNum(snap.avg_price);

  let finalProposal = normalized;
  let normalizedAdjustment = null;

  if (normalized === "tighten_sl") {
    const newStop = toNum(adjustment && adjustment.new_stop_price);
    if (!(Number.isFinite(currentStop) && Number.isFinite(newStop) && Number.isFinite(currentPrice))) {
      violations.push("TIGHTEN_SL_MISSING_PRICES");
      finalProposal = "hold";
    } else if (side === "LONG" && newStop <= currentStop) {
      violations.push("TIGHTEN_SL_NOT_TIGHTER_LONG");
      finalProposal = "hold";
    } else if (side === "SHORT" && newStop >= currentStop) {
      violations.push("TIGHTEN_SL_NOT_TIGHTER_SHORT");
      finalProposal = "hold";
    } else if (side === "LONG" && newStop >= currentPrice) {
      violations.push("TIGHTEN_SL_ABOVE_PRICE_LONG");
      finalProposal = "hold";
    } else if (side === "SHORT" && newStop <= currentPrice) {
      violations.push("TIGHTEN_SL_BELOW_PRICE_SHORT");
      finalProposal = "hold";
    } else {
      normalizedAdjustment = { new_stop_price: newStop };
    }
  }

  if (normalized === "earlier_tp1") {
    const newTp1 = toNum(adjustment && adjustment.new_tp1_price);
    if (!(Number.isFinite(newTp1) && Number.isFinite(currentPrice))) {
      violations.push("EARLIER_TP1_MISSING_PRICES");
      finalProposal = "hold";
    } else if (side === "LONG" && newTp1 <= currentPrice) {
      violations.push("EARLIER_TP1_BELOW_PRICE_LONG");
      finalProposal = "hold";
    } else if (side === "SHORT" && newTp1 >= currentPrice) {
      violations.push("EARLIER_TP1_ABOVE_PRICE_SHORT");
      finalProposal = "hold";
    } else {
      normalizedAdjustment = { new_tp1_price: newTp1 };
    }
  }

  return { proposal: finalProposal, adjustment: normalizedAdjustment, violations };
}

async function proposeAdjustment({
  exchange = null,
  symbol = null,
  positionSnapshot = null,
  ticks = [],
} = {}) {
  if (!conductorEnabled()) {
    return {
      disabled: true,
      role: "POSITION_CONDUCTOR",
      shadow_only: conductorShadowOnly(),
    };
  }
  const narrative = await narrativeReasoner.reasonAboutPosition({
    exchange,
    symbol,
    positionSnapshot,
    ticks,
  }).catch((err) => ({
    disabled: true,
    live_failed: true,
    live_reason: err && err.message ? err.message : String(err),
  }));
  const rawProposal = narrative && narrative.response && narrative.response.proposal;
  const adjustment = narrative && narrative.response && narrative.response.adjustment;
  const safety = enforceSafetyRails({
    proposal: rawProposal,
    positionSnapshot,
    adjustment,
  });
  const applyReady = conductorShadowOnly() !== true
    && safety.violations.length === 0
    && safety.proposal !== "hold";
  const record = {
    role: "POSITION_CONDUCTOR",
    disabled: false,
    shadow_only: conductorShadowOnly(),
    apply_ready: applyReady,
    raw_proposal: String(rawProposal || "").trim() || null,
    normalized_proposal: safety.proposal,
    normalized_adjustment: safety.adjustment,
    safety_rail_violations: safety.violations,
    narrative,
  };
  await evidenceLedger.writeEvidenceRecord({
    kind: evidenceLedger.KINDS.POSITION_CONDUCTOR,
    exchange,
    symbol,
    market: symbol,
    inputs: {
      position_snapshot_hash: evidenceLedger.hashJson({
        position_side: upper(positionSnapshot && positionSnapshot.position_side),
        avg_price: toNum(positionSnapshot && positionSnapshot.avg_price),
        meta: positionSnapshot && positionSnapshot.meta,
      }),
      tick_count: Array.isArray(ticks) ? ticks.length : 0,
    },
    predictions: {
      narrative: narrative || null,
    },
    composite: {
      proposal: safety.proposal,
      adjustment: safety.adjustment,
      apply_ready: applyReady,
      safety_rail_violations: safety.violations,
    },
  });
  return record;
}

function resetForTest() {
  // Nothing to reset; export exists for symmetry with other modules.
}

module.exports = {
  conductorEnabled,
  conductorShadowOnly,
  classifyProposal,
  enforceSafetyRails,
  proposeAdjustment,
  __test: {
    resetForTest,
    envFlagOn,
  },
};
