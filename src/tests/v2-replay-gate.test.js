"use strict";

const assert = require("assert");
const { evaluateReplayFixtureSet } = require("../v2/replayGate");
const {
  buildReferencePassEpisode,
  buildReferenceNativeMlEvidencePack,
  buildReferenceReplayFixtureSet,
} = require("../v2/replayFixtureFactory");

(function healthyReplayFixturePasses() {
  const report = evaluateReplayFixtureSet(buildReferenceReplayFixtureSet("REFERENCE_PASS"));
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.failClosed, false);
  assert.strictEqual(report.block_n, 0);
  assert.strictEqual(report.transition_event_coverage.TP1_REACHED > 0, true);
  assert.strictEqual(report.transition_event_coverage.TRAIL_ACTIVATED > 0, true);
  assert.strictEqual(report.transition_event_coverage.SL_HIT > 0, true);
  assert.strictEqual(report.transition_event_coverage.TRAIL_HIT > 0, true);
  assert.strictEqual(report.transition_event_coverage.EXTERNAL_CLOSE_SYNC > 0, true);
  assert.strictEqual(report.transition_event_coverage.MANUAL_CLOSE_SYNC > 0, true);
})();

(function singleHappyPathWithoutFamilyCoverageFailsClosed() {
  const report = evaluateReplayFixtureSet({
    episodes: [buildReferencePassEpisode()],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("REPLAY_TRANSITION_EVENT_MISSING:SL_HIT")));
  assert.ok(report.blockers.some((row) => row.includes("REPLAY_TRANSITION_EVENT_MISSING:EXTERNAL_CLOSE_SYNC")));
  assert.ok(report.blockers.some((row) => row.includes("REPLAY_TRANSITION_EVENT_MISSING:MANUAL_CLOSE_SYNC")));
})();

(function runtimeCandidateCanSkipGlobalFamilyCoverageButStillChecksEpisodeIntegrity() {
  const report = evaluateReplayFixtureSet({
    replay_context: {
      scope: "RUNTIME_CANDIDATE",
      require_transition_event_coverage: false,
    },
    episodes: [buildReferencePassEpisode()],
  });
  assert.strictEqual(report.pass, true);
  assert.strictEqual(report.transition_event_coverage_required, false);
  assert.strictEqual(report.block_n, 0);
})();

(function missingOutboxFailsClosed() {
  const episode = buildReferencePassEpisode();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "MISSING_OUTBOX",
      outboxes: episode.outboxes.slice(0, 2),
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("TRANSITION_OUTBOX_COUNT_MISMATCH")));
})();

(function missingTransitionExchangeEvidenceFailsClosed() {
  const episode = buildReferencePassEpisode();
  const transitions = episode.transitions.map((row, index) => (
    index === 1
      ? { ...row, source_exchange_evidence: null }
      : row
  ));
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "MISSING_TRANSITION_EVIDENCE",
      transitions,
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("TRANSITION_EXCHANGE_EVIDENCE_MISSING:1")));
})();

(function terminalFullExitEvidenceMissingFailsClosed() {
  const episode = buildReferencePassEpisode();
  const transitions = episode.transitions.map((row, index, arr) => {
    if (index !== arr.length - 1) return row;
    const raw = { ...row.source_exchange_evidence.raw_payload };
    delete raw.full_exit;
    delete raw.fullExit;
    delete raw.position_amt_after;
    delete raw.positionAmtAfter;
    delete raw.position_qty_after;
    delete raw.positionQtyAfter;
    delete raw.remaining_position_qty_abs;
    delete raw.remainingPositionQtyAbs;
    return {
      ...row,
      source_exchange_evidence: {
        ...row.source_exchange_evidence,
        raw_payload: raw,
      },
    };
  });
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "TERMINAL_FULL_EXIT_EVIDENCE_MISSING",
      transitions,
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("TERMINAL_FULL_EXIT_EVIDENCE_MISSING:2")));
})();

(function stopTerminalFillEvidenceMissingFailsClosed() {
  const episode = buildReferencePassEpisode();
  const transitions = episode.transitions.map((row, index, arr) => {
    if (index !== arr.length - 1) return row;
    const raw = { ...row.source_exchange_evidence.raw_payload };
    delete raw.order_type;
    delete raw.orderType;
    delete raw.type;
    delete raw.o;
    delete raw.stop_price;
    delete raw.stopPrice;
    delete raw.sp;
    return {
      ...row,
      source_exchange_evidence: {
        ...row.source_exchange_evidence,
        evidence_kind: "AMBIGUOUS_EXIT",
        raw_payload: raw,
      },
    };
  });
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "STOP_FILL_EVIDENCE_MISSING",
      transitions,
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("STOP_TERMINAL_FILL_EVIDENCE_MISSING:2")));
})();

(function finalStageMismatchFailsClosed() {
  const episode = buildReferencePassEpisode();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "STAGE_MISMATCH",
      projection: {
        ...episode.projection,
        stage: "TRAIL_ACTIVE",
        trail_active: true,
        health_status: "HEALTHY",
      },
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("FINAL_STAGE_MISMATCH")));
})();

(function missingProtectionRuntimeEvidenceFailsClosed() {
  const episode = buildReferencePassEpisode();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "MISSING_RUNTIME_EVIDENCE",
      protectionRuntime: {
        ...episode.protectionRuntime,
        last_exchange_evidence: null,
      },
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("PROTECTION_RUNTIME_EXCHANGE_EVIDENCE_MISSING")));
})();

(function terminalExitQtyMismatchFailsClosed() {
  const episode = buildReferencePassEpisode();
  const brokenTransitions = episode.transitions.map((row, index, arr) => {
    if (index !== arr.length - 1) return row;
    return {
      ...row,
      ledger_patch: {
        ...row.ledger_patch,
        final_exit_qty_abs: 0.25,
      },
    };
  });
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "TERMINAL_EXIT_QTY_MISMATCH",
      transitions: brokenTransitions,
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("TERMINAL_EXIT_QTY_MISMATCH")));
})();

(function watchdogIssueFailsClosed() {
  const episode = buildReferencePassEpisode();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "WATCHDOG_FAIL",
      watchdog: {
        issueCodes: ["TRAIL_STOP_MISSING"],
        repairRequests: [],
      },
    }],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("WATCHDOG_ISSUES_PRESENT")));
})();

(function prepFailureOutboxStillFailsClosed() {
  const fixtureSet = buildReferenceReplayFixtureSet("REFERENCE_PASS");
  const episode = fixtureSet.episodes[0];
  const failedOutbox = {
    ...episode.outboxes[1],
    status: "FAILED",
    last_reason: "ALERT_STAGE_MISMATCH",
  };
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "FAILED_OUTBOX",
      outboxes: [episode.outboxes[0], failedOutbox, episode.outboxes[2]],
    }, ...fixtureSet.episodes.slice(1)],
  });
  assert.strictEqual(report.pass, true, "durable failure is allowed if link integrity is preserved");
})();

(function nativeMlEvidenceCompletenessPasses() {
  const fixtureSet = buildReferenceReplayFixtureSet("REFERENCE_PASS");
  const episode = fixtureSet.episodes[0];
  const evidence = buildReferenceNativeMlEvidencePack();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "NATIVE_COMPLETE",
      signalIntent: evidence.signalIntent,
      featureSnapshot: evidence.featureSnapshot,
      mlAiSignalProposal: evidence.mlAiSignalProposal,
      mlAiEvidence: evidence.mlAiEvidence,
      openclawDecision: evidence.openclawDecision,
    }, ...fixtureSet.episodes.slice(1)],
  });
  assert.strictEqual(report.pass, true);
})();

(function nativeMlEvidenceLinkBreakFailsClosed() {
  const fixtureSet = buildReferenceReplayFixtureSet("REFERENCE_PASS");
  const episode = fixtureSet.episodes[0];
  const evidence = buildReferenceNativeMlEvidencePack();
  const report = evaluateReplayFixtureSet({
    episodes: [{
      ...episode,
      label: "NATIVE_BROKEN_LINK",
      signalIntent: evidence.signalIntent,
      featureSnapshot: evidence.featureSnapshot,
      mlAiSignalProposal: {
        ...evidence.mlAiSignalProposal,
        feature_snapshot_id: "FSV2__BROKEN",
      },
      mlAiEvidence: evidence.mlAiEvidence,
      openclawDecision: evidence.openclawDecision,
    }, ...fixtureSet.episodes.slice(1)],
  });
  assert.strictEqual(report.pass, false);
  assert.ok(report.blockers.some((row) => row.includes("PROPOSAL_FEATURE_LINK_BROKEN")));
})();

console.log("V2_REPLAY_GATE_TEST_OK");
