"use strict";

const TERMINAL_STAGES = new Set(["EXITED_TP1", "EXITED_SL", "EXITED_TRAIL", "EXITED_EXTERNAL", "EXITED_MANUAL"]);
const TERMINAL_TRANSITION_EVENTS = new Set(["TP1_FULL_EXIT", "SL_HIT", "TRAIL_HIT", "EXTERNAL_CLOSE_SYNC", "MANUAL_CLOSE_SYNC"]);
const STOP_TERMINAL_TRANSITION_EVENTS = new Set(["SL_HIT", "TRAIL_HIT"]);
const REQUIRED_REPLAY_TRANSITION_EVENTS = Object.freeze([
  "TP1_FULL_EXIT",
  "SL_HIT",
  "EXTERNAL_CLOSE_SYNC",
  "MANUAL_CLOSE_SYNC",
]);
const EPSILON = 1e-8;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseBoolStrict(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return null;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return null;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickEvidenceValue(evidence, keys) {
  const row = isObject(evidence) ? evidence : {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return null;
}

function collectTransitionIds(transitions) {
  return new Set(ensureArray(transitions).map((row) => trimOrNull(row && row.canonical_transition_id)).filter(Boolean));
}

function resolveLatestTp1FilledQtyAbs(transitions) {
  let latest = 0;
  for (const row of ensureArray(transitions)) {
    const event = upper(row && row.transition_event);
    if (event !== "TP1_REACHED" && event !== "TP1_FULL_EXIT") continue;
    const filled = toNumberOrNull(row && row.ledger_patch && row.ledger_patch.tp1_filled_qty_abs);
    if (filled != null) latest = filled;
  }
  return latest;
}

function hasValidExchangeEvidenceSnapshot(snapshot) {
  const row = isObject(snapshot) ? snapshot : null;
  if (!row) return false;
  const kind = trimOrNull(row.evidence_kind);
  const observedAt = trimOrNull(row.observed_at);
  const sourceFillId = trimOrNull(row.source_fill_id);
  const sourceOrderId = trimOrNull(row.source_order_id);
  return !!(
    kind &&
    observedAt &&
    (sourceFillId || sourceOrderId) &&
    Object.prototype.hasOwnProperty.call(row, "raw_payload")
  );
}

function hasTerminalFullExitEvidence(snapshot) {
  const rawPayload = isObject(snapshot) && isObject(snapshot.raw_payload) ? snapshot.raw_payload : null;
  if (!rawPayload) return false;

  const evidenceFlag = parseBoolStrict(pickEvidenceValue(rawPayload, [
    "full_exit",
    "fullExit",
    "is_full_exit",
    "isFullExit",
    "is_final_exit",
    "isFinalExit",
    "position_closed",
    "positionClosed",
  ]));
  if (evidenceFlag === true) return true;
  if (evidenceFlag === false) return false;

  const remainingQty = toNumberOrNull(pickEvidenceValue(rawPayload, [
    "position_amt_after",
    "positionAmtAfter",
    "position_qty_after",
    "positionQtyAfter",
    "remaining_position_qty_abs",
    "remainingPositionQtyAbs",
  ]));
  return Number.isFinite(remainingQty) && Math.abs(remainingQty) <= EPSILON;
}

function hasStopFillEvidence({ snapshot }) {
  const rawPayload = isObject(snapshot) && isObject(snapshot.raw_payload) ? snapshot.raw_payload : null;
  if (!rawPayload) return false;

  const executionType = upper(pickEvidenceValue(rawPayload, [
    "execution_type",
    "executionType",
    "x",
  ]));
  const exchangeEvent = upper(pickEvidenceValue(rawPayload, [
    "event",
    "event_type",
    "eventType",
    "execution_event",
    "executionEvent",
    "order_event",
    "orderEvent",
  ]));
  const orderType = upper(pickEvidenceValue(rawPayload, [
    "order_type",
    "orderType",
    "type",
    "o",
  ]));
  const stopPrice = toNumberOrNull(pickEvidenceValue(rawPayload, [
    "stop_price",
    "stopPrice",
    "sp",
  ]));
  const stopEvent = [
    "EXIT_SL",
    "EXIT_STOP",
    "EXIT_TRAIL",
    "SL_HIT",
    "STOP_EXIT",
    "TRAIL_HIT",
  ].includes(exchangeEvent);
  const stopOrderType = [
    "STOP",
    "STOP_MARKET",
    "TRAILING_STOP_MARKET",
  ].includes(orderType);

  return executionType === "TRADE" && (stopEvent || stopOrderType || stopPrice > 0);
}

function resolveSignalSourceMode(episode) {
  const signalIntentMode = upper(episode && episode.signalIntent && episode.signalIntent.signal_source_mode);
  if (signalIntentMode) return signalIntentMode;
  const proposalMode = upper(episode && episode.mlAiSignalProposal && episode.mlAiSignalProposal.signal_source_mode);
  if (proposalMode) return proposalMode;
  const snapshotMode = upper(episode && episode.featureSnapshot && episode.featureSnapshot.signal_source_mode);
  if (snapshotMode) return snapshotMode;
  const summaryMode = upper(
    episode
    && episode.openclawDecision
    && episode.openclawDecision.canonical_evidence_summary
    && episode.openclawDecision.canonical_evidence_summary.signal_source_mode
  );
  return summaryMode || null;
}

function collectReplayTransitionEventCoverage(episodes) {
  const counts = new Map(REQUIRED_REPLAY_TRANSITION_EVENTS.map((event) => [event, 0]));
  for (const episode of ensureArray(episodes)) {
    for (const transition of ensureArray(episode && episode.transitions)) {
      const event = upper(transition && transition.transition_event);
      if (!counts.has(event)) continue;
      counts.set(event, counts.get(event) + 1);
    }
  }
  return Object.freeze(Object.fromEntries(counts.entries()));
}

function resolveReplayCoverageBlockers(episodes) {
  const coverage = collectReplayTransitionEventCoverage(episodes);
  return REQUIRED_REPLAY_TRANSITION_EVENTS
    .filter((event) => !(coverage[event] > 0))
    .map((event) => `REPLAY_TRANSITION_EVENT_MISSING:${event}`);
}

function resolveTransitionEventCoverageRequired(fixtureSet = {}, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options || {}, "requireTransitionEventCoverage")) {
    return options.requireTransitionEventCoverage !== false;
  }
  const context = fixtureSet && typeof fixtureSet === "object" && fixtureSet.replay_context && typeof fixtureSet.replay_context === "object"
    ? fixtureSet.replay_context
    : null;
  if (context && context.require_transition_event_coverage === false) return false;
  return true;
}

function validateEpisode(episode) {
  const label = trimOrNull(episode && episode.label) || "UNNAMED_EPISODE";
  const blockers = [];
  const positionCycle = episode && episode.positionCycle;
  const transitions = ensureArray(episode && episode.transitions);
  const projection = episode && episode.projection;
  const outboxes = ensureArray(episode && episode.outboxes);
  const protectionRuntime = episode && episode.protectionRuntime;
  const watchdog = episode && episode.watchdog ? episode.watchdog : { issueCodes: [], repairRequests: [] };
  const signalIntent = episode && episode.signalIntent;
  const featureSnapshot = episode && episode.featureSnapshot;
  const mlAiSignalProposal = episode && episode.mlAiSignalProposal;
  const mlAiEvidence = episode && episode.mlAiEvidence;
  const openclawDecision = episode && episode.openclawDecision;

  const cycleId = trimOrNull(positionCycle && positionCycle.position_cycle_id);
  if (!cycleId) blockers.push("POSITION_CYCLE_MISSING");
  if (!trimOrNull(positionCycle && positionCycle.entry_event_id)) blockers.push("ENTRY_EVENT_ID_MISSING");
  if (!projection || typeof projection !== "object") blockers.push("PROJECTION_MISSING");

  if (!blockers.length) {
    if (trimOrNull(projection.position_cycle_id) !== cycleId) {
      blockers.push("PROJECTION_POSITION_CYCLE_MISMATCH");
    }
  }

  if (!blockers.length && transitions.length > 0) {
    for (let index = 0; index < transitions.length; index += 1) {
      const row = transitions[index];
      if (trimOrNull(row.position_cycle_id) !== cycleId) {
        blockers.push(`TRANSITION_POSITION_CYCLE_MISMATCH:${index}`);
      }
      if (index > 0) {
        const prev = transitions[index - 1];
        if (upper(prev.next_stage) !== upper(row.previous_stage)) {
          blockers.push(`TRANSITION_CHAIN_BROKEN:${index}`);
        }
      }
      if (!hasValidExchangeEvidenceSnapshot(row.source_exchange_evidence)) {
        blockers.push(`TRANSITION_EXCHANGE_EVIDENCE_MISSING:${index}`);
      } else {
        const event = upper(row && row.transition_event);
        if (TERMINAL_TRANSITION_EVENTS.has(event) && !hasTerminalFullExitEvidence(row.source_exchange_evidence)) {
          blockers.push(`TERMINAL_FULL_EXIT_EVIDENCE_MISSING:${index}`);
        }
        if (
          STOP_TERMINAL_TRANSITION_EVENTS.has(event) &&
          !hasStopFillEvidence({ snapshot: row.source_exchange_evidence })
        ) {
          blockers.push(`STOP_TERMINAL_FILL_EVIDENCE_MISSING:${index}`);
        }
      }
    }
    const last = transitions[transitions.length - 1];
    if (upper(last.next_stage) !== upper(projection.stage)) {
      blockers.push("FINAL_STAGE_MISMATCH");
    }
  }

  const transitionIds = collectTransitionIds(transitions);
  if (transitions.length !== outboxes.length) {
    blockers.push("TRANSITION_OUTBOX_COUNT_MISMATCH");
  }
  for (const outbox of outboxes) {
    const transitionId = trimOrNull(outbox && outbox.canonical_transition_id);
    if (!transitionId || !transitionIds.has(transitionId)) {
      blockers.push("OUTBOX_WITHOUT_TRANSITION");
    }
  }
  for (const transition of transitions) {
    const transitionId = trimOrNull(transition && transition.canonical_transition_id);
    const linked = outboxes.filter((row) => trimOrNull(row && row.canonical_transition_id) === transitionId);
    if (linked.length !== 1) {
      blockers.push("TRANSITION_OUTBOX_LINK_BROKEN");
      break;
    }
  }

  const stage = upper(projection && projection.stage);
  const issueCodes = ensureArray(watchdog.issueCodes).map((code) => upper(code)).filter(Boolean);
  if (issueCodes.length > 0) {
    blockers.push(`WATCHDOG_ISSUES_PRESENT:${issueCodes.join("|")}`);
  }

  if (stage === "TRAIL_ACTIVE") {
    if (!(projection.trail_active === true)) blockers.push("TRAIL_ACTIVE_FLAG_MISMATCH");
    if (!trimOrNull(projection.chosen_stop_source)) blockers.push("CHOSEN_STOP_SOURCE_MISSING");
    if (!(Number(projection.final_effective_stop) > 0)) blockers.push("FINAL_EFFECTIVE_STOP_MISSING");
    if (!isObject(protectionRuntime)) {
      blockers.push("PROTECTION_RUNTIME_MISSING");
    } else if (trimOrNull(protectionRuntime.position_cycle_id) !== cycleId) {
      blockers.push("PROTECTION_RUNTIME_POSITION_CYCLE_MISMATCH");
    } else {
      if (!hasValidExchangeEvidenceSnapshot(protectionRuntime.last_exchange_evidence)) {
        blockers.push("PROTECTION_RUNTIME_EXCHANGE_EVIDENCE_MISSING");
      }
      if (!trimOrNull(protectionRuntime.last_evidence_observed_at)) {
        blockers.push("PROTECTION_RUNTIME_EVIDENCE_OBSERVED_AT_MISSING");
      }
    }
  }

  if (TERMINAL_STAGES.has(stage)) {
    if (upper(projection.health_status) !== "TERMINAL_EXITED") {
      blockers.push("TERMINAL_HEALTH_STATUS_MISMATCH");
    }
    const lastTransition = transitions.length > 0 ? transitions[transitions.length - 1] : null;
    const entryQtyAbs = toNumberOrNull(positionCycle && positionCycle.entry_qty_abs);
    const finalExitQtyAbs = toNumberOrNull(lastTransition && lastTransition.ledger_patch && lastTransition.ledger_patch.final_exit_qty_abs);
    const expectedFinalExitQtyAbs = upper(lastTransition && lastTransition.transition_event) === "TP1_FULL_EXIT"
      ? entryQtyAbs
      : (
        entryQtyAbs == null
          ? null
          : Number((entryQtyAbs - resolveLatestTp1FilledQtyAbs(transitions)).toFixed(8))
      );
    if (!(finalExitQtyAbs >= 0)) {
      blockers.push("TERMINAL_EXIT_QTY_MISSING");
    } else if (expectedFinalExitQtyAbs != null && Math.abs(finalExitQtyAbs - expectedFinalExitQtyAbs) > EPSILON) {
      blockers.push("TERMINAL_EXIT_QTY_MISMATCH");
    }
    if (!isObject(protectionRuntime)) {
      blockers.push("PROTECTION_RUNTIME_MISSING");
    } else if (trimOrNull(protectionRuntime.position_cycle_id) !== cycleId) {
      blockers.push("PROTECTION_RUNTIME_POSITION_CYCLE_MISMATCH");
    } else {
      if (!hasValidExchangeEvidenceSnapshot(protectionRuntime.last_exchange_evidence)) {
        blockers.push("PROTECTION_RUNTIME_EXCHANGE_EVIDENCE_MISSING");
      }
      if (!trimOrNull(protectionRuntime.last_evidence_observed_at)) {
        blockers.push("PROTECTION_RUNTIME_EVIDENCE_OBSERVED_AT_MISSING");
      }
    }
  }

  const signalSourceMode = resolveSignalSourceMode(episode);
  if (signalSourceMode === "SERVER_NATIVE_ML_AI") {
    const signalIntentId = trimOrNull(signalIntent && signalIntent.signal_intent_id);
    const featureSnapshotId = trimOrNull(featureSnapshot && featureSnapshot.feature_snapshot_id);
    const proposalId = trimOrNull(mlAiSignalProposal && mlAiSignalProposal.ml_ai_signal_proposal_id);
    const mlAiDecisionId = trimOrNull(mlAiEvidence && mlAiEvidence.decision_id);
    if (!signalIntentId) blockers.push("NATIVE_SIGNAL_INTENT_MISSING");
    if (!featureSnapshotId) blockers.push("NATIVE_FEATURE_SNAPSHOT_MISSING");
    if (!proposalId) blockers.push("NATIVE_SIGNAL_PROPOSAL_MISSING");
    if (!mlAiDecisionId) blockers.push("NATIVE_ML_EVIDENCE_MISSING");
    if (!trimOrNull(openclawDecision && openclawDecision.openclaw_decision_id)) blockers.push("NATIVE_OPENCLAW_DECISION_MISSING");

    if (!blockers.length) {
      if (trimOrNull(featureSnapshot.signal_intent_id) !== signalIntentId) blockers.push("FEATURE_SNAPSHOT_SIGNAL_LINK_BROKEN");
      if (trimOrNull(mlAiSignalProposal.signal_intent_id) !== signalIntentId) blockers.push("PROPOSAL_SIGNAL_LINK_BROKEN");
      if (trimOrNull(mlAiEvidence.signal_intent_id) !== signalIntentId) blockers.push("ML_EVIDENCE_SIGNAL_LINK_BROKEN");
      if (trimOrNull(openclawDecision.signal_intent_id) !== signalIntentId) blockers.push("OPENCLAW_DECISION_SIGNAL_LINK_BROKEN");
      if (trimOrNull(mlAiSignalProposal.feature_snapshot_id) !== featureSnapshotId) blockers.push("PROPOSAL_FEATURE_LINK_BROKEN");
      if (trimOrNull(mlAiEvidence.feature_snapshot_id) !== featureSnapshotId) blockers.push("ML_EVIDENCE_FEATURE_LINK_BROKEN");
      if (trimOrNull(openclawDecision.ml_ai_evidence_decision_id) !== mlAiDecisionId) blockers.push("OPENCLAW_ML_EVIDENCE_LINK_BROKEN");
      const summary = openclawDecision.canonical_evidence_summary || {};
      if (!(summary.feature_snapshot && summary.feature_snapshot.present === true)) blockers.push("OPENCLAW_FEATURE_SUMMARY_MISSING");
      if (!(summary.ml_ai_signal_proposal && summary.ml_ai_signal_proposal.present === true)) blockers.push("OPENCLAW_PROPOSAL_SUMMARY_MISSING");
      if (!(summary.ml_ai_evidence && summary.ml_ai_evidence.present === true)) blockers.push("OPENCLAW_ML_EVIDENCE_SUMMARY_MISSING");
    }
  }

  return Object.freeze({
    label,
    pass: blockers.length === 0,
    blockers,
  });
}

function evaluateReplayFixtureSet(fixtureSet = {}, options = {}) {
  const episodes = ensureArray(fixtureSet && fixtureSet.episodes);
  const rows = episodes.map(validateEpisode);
  const coverage = collectReplayTransitionEventCoverage(episodes);
  const transitionEventCoverageRequired = resolveTransitionEventCoverageRequired(fixtureSet, options);
  const coverageBlockers = transitionEventCoverageRequired ? resolveReplayCoverageBlockers(episodes) : [];
  const pass = rows.length > 0 && rows.every((row) => row.pass === true) && coverageBlockers.length === 0;
  const blockerRows = rows.filter((row) => row.pass !== true);
  return Object.freeze({
    pass,
    failClosed: pass !== true,
    episode_n: rows.length,
    pass_n: rows.filter((row) => row.pass === true).length,
    block_n: blockerRows.length + coverageBlockers.length,
    blockers: [
      ...coverageBlockers,
      ...blockerRows.flatMap((row) => row.blockers.map((blocker) => `${row.label}:${blocker}`)),
    ],
    transition_event_coverage_required: transitionEventCoverageRequired,
    transition_event_coverage: coverage,
    required_transition_events: REQUIRED_REPLAY_TRANSITION_EVENTS,
    rows,
  });
}

module.exports = {
  REQUIRED_REPLAY_TRANSITION_EVENTS,
  evaluateReplayFixtureSet,
  __test: {
    REQUIRED_REPLAY_TRANSITION_EVENTS,
    collectReplayTransitionEventCoverage,
    resolveReplayCoverageBlockers,
    validateEpisode,
    resolveTransitionEventCoverageRequired,
    resolveLatestTp1FilledQtyAbs,
    hasValidExchangeEvidenceSnapshot,
    hasTerminalFullExitEvidence,
    hasStopFillEvidence,
  },
};
