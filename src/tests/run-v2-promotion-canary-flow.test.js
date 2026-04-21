"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const flow = require("../../scripts/run-v2-promotion-canary-flow");
const { buildReferencePassEpisode, buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const { buildWebhookBundle } = require("../v2/comparisonFixtureFactory");

const PREFIX = "donbeolja_v2__";
const tests = [];

function buildFakeDb(store) {
  return {
    collection(name) {
      const bucket = store[name] || {};
      return {
        doc(id) {
          return {
            async get() {
              const row = bucket[id];
              return {
                exists: !!row,
                data() {
                  return row;
                },
              };
            },
            async set(payload) {
              bucket[id] = payload;
              store[name] = bucket;
            },
          };
        },
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  const rows = Object.values(bucket)
                    .filter((row) => row && row[field] === value)
                    .slice(0, limit);
                  return {
                    docs: rows.map((row) => ({
                      data() {
                        return row;
                      },
                    })),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function buildStore() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__FLOW",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__FLOW",
    decision_mode: "SHADOW",
    symbol: nativeBundle.signalIntent.symbol,
    side: nativeBundle.signalIntent.side,
    timeframe: nativeBundle.featureSnapshot.timeframe,
    created_at: "2026-04-20T00:00:00.000Z",
  };
  return {
    episode,
    nativeBundle,
    webhookBundle,
    shadowProposal,
    store: {
      [`${PREFIX}position_cycles_v2`]: {
        [episode.positionCycle.position_cycle_id]: {
          ...episode.positionCycle,
          status: "ACTIVE_PROTECTED",
          signal_intent_id: nativeBundle.signalIntent.signal_intent_id,
          openclaw_decision_id: nativeBundle.openclawDecision.openclaw_decision_id,
        },
      },
      [`${PREFIX}exit_runtime_projection_v2`]: {
        [episode.projection.exit_runtime_projection_id]: episode.projection,
      },
      [`${PREFIX}protection_runtime_v2`]: {
        [`PRTV2__${episode.positionCycle.position_cycle_id}`]: {
          protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
          position_cycle_id: episode.positionCycle.position_cycle_id,
          sl_order_id: "STOP__1",
          tp1_order_id: "TP1__1",
          last_exchange_evidence: episode.protectionRuntime.last_exchange_evidence,
          last_evidence_observed_at: episode.protectionRuntime.last_evidence_observed_at,
        },
      },
      [`${PREFIX}canonical_exit_transitions_v2`]: Object.fromEntries(
        episode.transitions.map((row, index) => [`t${index}`, row])
      ),
      [`${PREFIX}trade_alert_outbox_v2`]: Object.fromEntries(
        episode.outboxes.map((row, index) => [`o${index}`, row])
      ),
      [`${PREFIX}exit_repair_requests_v2`]: {},
      [`${PREFIX}signal_intents_v2`]: {
        [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
        [webhookBundle.signalIntent.signal_intent_id]: {
          ...webhookBundle.signalIntent,
          symbol: nativeBundle.signalIntent.symbol,
          side: nativeBundle.signalIntent.side,
          created_at: "2026-04-20T00:05:00.000Z",
        },
      },
      [`${PREFIX}feature_snapshots_v2`]: {
        [nativeBundle.featureSnapshot.feature_snapshot_id]: nativeBundle.featureSnapshot,
      },
      [`${PREFIX}ml_ai_signal_proposals_v2`]: {
        [nativeBundle.mlAiSignalProposal.ml_ai_signal_proposal_id]: nativeBundle.mlAiSignalProposal,
        [shadowProposal.ml_ai_signal_proposal_id]: shadowProposal,
      },
      [`${PREFIX}ml_ai_evidence_ledger_v2`]: {
        [nativeBundle.mlAiEvidence.decision_id]: nativeBundle.mlAiEvidence,
      },
      [`${PREFIX}openclaw_decisions_v2`]: {
        [nativeBundle.openclawDecision.openclaw_decision_id]: nativeBundle.openclawDecision,
        [webhookBundle.openclawDecision.openclaw_decision_id]: {
          ...webhookBundle.openclawDecision,
          signal_intent_id: webhookBundle.signalIntent.signal_intent_id,
          policy_scope: nativeBundle.openclawDecision.policy_scope,
          created_at: "2026-04-20T00:06:00.000Z",
        },
      },
    },
  };
}

(function flowRequiresCanaryOrLiveMode() {
  let err = null;
  try {
    flow.__test.resolveFlowConfig({
      V2_PROMOTION_MODE: "SHADOW",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__1",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CANARY_FLOW_MODE_INVALID");
})();

tests.push(async function canaryFlowPassesWithBoundedRuntimePath() {
  const fixture = buildStore();
  const report = await flow.runCanaryFlow({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_ARTIFACT_DIR: path.join(os.tmpdir(), "unused-flow"),
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: fixture.episode.positionCycle.position_cycle_id,
    DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
  }, {
    selectorDb: buildFakeDb(fixture.store),
    collectorDb: buildFakeDb(fixture.store),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.stage, "PIPELINE_PASS");
  assert.strictEqual(report.artifact_dir_bounded_by_cycle, true);
  assert.ok(report.artifact_dir.endsWith(path.join("unused-flow", fixture.episode.positionCycle.position_cycle_id)));
  assert.strictEqual(report.artifact_dir_strategy, "NESTED_BY_SELECTED_POSITION_CYCLE");
});

tests.push(async function canaryFlowBlocksOnTerminalMismatchPreflight() {
  const fixture = buildStore();
  const cycleId = fixture.episode.positionCycle.position_cycle_id;
  fixture.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`] = {
    ...fixture.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`],
    stage: "TRAIL_ACTIVE",
    trail_active: true,
    health_status: "HEALTHY",
  };
  const transitionKeys = Object.keys(fixture.store[`${PREFIX}canonical_exit_transitions_v2`]).sort();
  fixture.store[`${PREFIX}canonical_exit_transitions_v2`] = {
    [transitionKeys[0]]: fixture.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[0]],
    [transitionKeys[1]]: fixture.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[1]],
  };
  fixture.store[`${PREFIX}trade_alert_outbox_v2`] = Object.fromEntries(
    Object.entries(fixture.store[`${PREFIX}trade_alert_outbox_v2`]).slice(0, 2)
  );

  const report = await flow.runCanaryFlow({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_ARTIFACT_DIR: path.join(os.tmpdir(), "unused-flow-terminal-mismatch"),
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
    V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON: JSON.stringify({
      has_active_position: false,
    }),
  }, {
    selectorDb: buildFakeDb(fixture.store),
    collectorDb: buildFakeDb(fixture.store),
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.stage, "PREFLIGHT_BLOCKED");
  assert.ok(report.blockers.includes("PREFLIGHT:TERMINAL_WATCHDOG_MISMATCH:TERMINAL_TRANSITION_MISSING"));
  assert.strictEqual(report.pipeline, null);
});

tests.push(async function autoCanaryFlowSelectsReadyCandidate() {
  const fixture = buildStore();
  const report = await flow.runCanaryFlow({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
    V2_PROMOTION_ARTIFACT_DIR: path.join(os.tmpdir(), "unused-flow-auto-select"),
    DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
  }, {
    selectorDb: buildFakeDb(fixture.store),
    collectorDb: buildFakeDb(fixture.store),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.stage, "PIPELINE_PASS");
  assert.strictEqual(report.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
  assert.ok(report.candidate_selection);
  assert.strictEqual(report.candidate_selection.ok, true);
  assert.strictEqual(report.candidate_selection.selection_contract.ok, true);
  assert.strictEqual(
    report.candidate_selection.selected_position_cycle_id,
    fixture.episode.positionCycle.position_cycle_id
  );
  assert.strictEqual(report.artifact_dir_bounded_by_cycle, true);
  assert.ok(report.artifact_dir.endsWith(path.join("unused-flow-auto-select", fixture.episode.positionCycle.position_cycle_id)));
  assert.strictEqual(report.artifact_dir_strategy, "NESTED_BY_SELECTED_POSITION_CYCLE");
});

tests.push(async function autoCanaryFlowRejectsTerminalMismatchCandidateBeforePipeline() {
  const fixture = buildStore();
  const cycleId = fixture.episode.positionCycle.position_cycle_id;
  fixture.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`] = {
    ...fixture.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`],
    stage: "TRAIL_ACTIVE",
    trail_active: true,
    health_status: "HEALTHY",
  };
  const transitionKeys = Object.keys(fixture.store[`${PREFIX}canonical_exit_transitions_v2`]).sort();
  fixture.store[`${PREFIX}canonical_exit_transitions_v2`] = {
    [transitionKeys[0]]: fixture.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[0]],
    [transitionKeys[1]]: fixture.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[1]],
  };
  fixture.store[`${PREFIX}trade_alert_outbox_v2`] = Object.fromEntries(
    Object.entries(fixture.store[`${PREFIX}trade_alert_outbox_v2`]).slice(0, 2)
  );

  const report = await flow.runCanaryFlow({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
    V2_PROMOTION_ARTIFACT_DIR: path.join(os.tmpdir(), "unused-flow-auto-select-terminal-mismatch"),
    V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON: JSON.stringify({
      has_active_position: false,
    }),
  }, {
    selectorDb: buildFakeDb(fixture.store),
    collectorDb: buildFakeDb(fixture.store),
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.stage, "CANDIDATE_BLOCKED");
  assert.ok(report.candidate_selection);
  assert.strictEqual(report.candidate_selection.selection_contract.ok, false);
  assert.strictEqual(report.preflight, null);
  assert.strictEqual(report.pipeline, null);
  assert.ok(report.blockers.includes("PREFLIGHT:TERMINAL_WATCHDOG_MISMATCH:TERMINAL_TRANSITION_MISSING"));
});

tests.push(async function flowMainWritesArtifact() {
  const fixture = buildStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-canary-flow-"));
  try {
    await flow.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: fixture.episode.positionCycle.position_cycle_id,
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    }, buildFakeDb(fixture.store));
    const file = path.join(dir, "promotion-canary-flow.json");
    const finalDir = path.join(dir, fixture.episode.positionCycle.position_cycle_id);
    const preflightFile = path.join(finalDir, flow.__test.PREFLIGHT_OUTPUT_FILENAME);
    const deployDecisionFile = path.join(finalDir, "promotion-deploy-decision.json");
    assert.ok(fs.existsSync(preflightFile));
    assert.ok(fs.existsSync(file));
    assert.ok(fs.existsSync(deployDecisionFile));
    const preflightPayload = JSON.parse(fs.readFileSync(preflightFile, "utf8"));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const deployDecisionPayload = JSON.parse(fs.readFileSync(deployDecisionFile, "utf8"));
    assert.strictEqual(preflightPayload.ok, true);
    assert.strictEqual(preflightPayload.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.strictEqual(payload.artifact_dir, finalDir);
    assert.strictEqual(deployDecisionPayload.approved, true);
    assert.strictEqual(
      deployDecisionPayload.bounded_runtime_summary.lineage_contract.hash,
      preflightPayload.lineage_contract.hash
    );
    assert.strictEqual(deployDecisionPayload.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.strictEqual(deployDecisionPayload.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

tests.push(async function flowMainWritesAutoSelectionArtifact() {
  const fixture = buildStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-canary-flow-auto-"));
  try {
    await flow.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    }, buildFakeDb(fixture.store));
    const candidateFile = path.join(dir, flow.__test.CANDIDATE_OUTPUT_FILENAME);
    const file = path.join(dir, "promotion-canary-flow.json");
    const finalDir = path.join(dir, fixture.episode.positionCycle.position_cycle_id);
    const preflightFile = path.join(finalDir, flow.__test.PREFLIGHT_OUTPUT_FILENAME);
    const finalCandidateFile = path.join(finalDir, flow.__test.CANDIDATE_OUTPUT_FILENAME);
    const finalFlowFile = path.join(finalDir, "promotion-canary-flow.json");
    assert.ok(fs.existsSync(candidateFile));
    assert.ok(fs.existsSync(preflightFile));
    assert.ok(fs.existsSync(file));
    assert.ok(fs.existsSync(finalCandidateFile));
    assert.ok(fs.existsSync(finalFlowFile));
    const candidatePayload = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const finalPayload = JSON.parse(fs.readFileSync(finalFlowFile, "utf8"));
    const deployDecisionPayload = JSON.parse(fs.readFileSync(path.join(finalDir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(candidatePayload.ok, true);
    assert.strictEqual(candidatePayload.selected_position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.strictEqual(payload.artifact_dir, finalDir);
    assert.strictEqual(finalPayload.artifact_dir, finalDir);
    assert.strictEqual(deployDecisionPayload.approved, true);
    assert.strictEqual(
      deployDecisionPayload.bounded_runtime_summary.lineage_contract.hash,
      finalPayload.preflight.lineage_contract.hash
    );
    assert.strictEqual(deployDecisionPayload.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
});

async function runTestsSequentially() {
  for (const test of tests) {
    await test();
  }
}

runTestsSequentially()
  .then(() => {
    console.log("RUN_V2_PROMOTION_CANARY_FLOW_TEST_OK");
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
