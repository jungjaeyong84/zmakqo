"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pipeline = require("../../scripts/run-v2-promotion-pipeline");
const { buildReferencePassEpisode, buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const { buildWebhookBundle } = require("../v2/comparisonFixtureFactory");

const PREFIX = "donbeolja_v2__";

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

(function pipelineRejectsMockMix() {
  let err = null;
  try {
    pipeline.__test.validatePipelineEnv({
      V2_PROMOTION_MOCK_ARTIFACTS_ENABLED: "1",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_PIPELINE_MOCK_MIX_FORBIDDEN");
})();

(async function cleanPipelinePasses() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-clean-"));
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "SHADOW",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_NATIVE_PASS",
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
    });
    assert.strictEqual(result.report.pass, true);
    assert.ok(fs.existsSync(path.join(dir, "replay-report.json")));
    assert.ok(fs.existsSync(path.join(dir, "shadow-live-comparison.json")));
    assert.ok(fs.existsSync(path.join(dir, "source-mode-comparison.json")));
    assert.ok(fs.existsSync(path.join(dir, "unified-promotion-report.json")));
    assert.ok(fs.existsSync(path.join(dir, "promotion-deploy-decision.json")));
    assert.strictEqual(result.unifiedReport.pass, true);
    assert.strictEqual(result.deployDecision.approved, false);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function blockedPipelineFailsClosed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-blocked-"));
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "SHADOW",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_BLOCKED",
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
    });
    assert.strictEqual(result.report.pass, false);
    assert.ok(result.report.blockers.some((row) => row.includes("REPLAY:WATCHDOG_FAIL:WATCHDOG_ISSUES_PRESENT")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runtimeSnapshotInputIsExportedAndUsed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-runtime-snapshot-"));
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_RUNTIME_SNAPSHOT_JSON: JSON.stringify({
        snapshotMeta: {
          source: "TEST_RUNTIME_SNAPSHOT",
          query_budget: {
            limits: {
              transitionsLimit: 50,
              outboxesLimit: 50,
            },
            counts: {
              transitions: 3,
              outboxes: 1,
            },
          },
          selector_meta: {
            position_cycle_id: "PCY__RUNTIME__TEST",
            query_budget: {
              query_limit: 25,
              recent_window_hours: 168,
              recent_cutoff_at: "2026-04-13T00:00:00.000Z",
            },
            alignment_checks: {
              symbol_match: true,
              side_match: true,
              timeframe_match: true,
              policy_scope_match: true,
            },
          },
          openclaw_execution_separation_audits: [
            {
              ok: true,
              audit_id: "OCEXSEPAUDV2__PIPELINE",
              fail_n: 0,
              failed_check_ids: [],
            },
          ],
          runtime_chain_audits: [
            {
              ok: true,
              check_n: 18,
              fail_n: 0,
              failed_check_ids: [],
            },
          ],
          openclaw_execution_audit_ledger_write: {
            ok: true,
            skipped: false,
            reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
            collection_key: "OPENCLAW_EXECUTION_AUDITS",
            doc_id: "OCEXSEPAUDV2__PIPELINE",
          },
          repair_evidence_summary: {
            ok: true,
            repair_request_n: 0,
            repair_execution_ledger_n: 0,
            completion_ledger_n: 0,
            completion_evidence_n: 0,
            completed_success_n: 0,
            completed_failed_n: 0,
            missing_completion_evidence_n: 0,
            runbook_refs: [],
            order_evidence_n: 0,
            latest_completion: null,
          },
        },
        episodes: require("../v2/replayFixtureFactory").buildReferenceReplayFixtureSet("REFERENCE_NATIVE_PASS").episodes,
        shadowLivePairs: require("../v2/comparisonFixtureFactory").buildReferenceComparisonFixtures("REFERENCE_CLEAN").shadowLivePairs,
        sourceModePairs: require("../v2/comparisonFixtureFactory").buildReferenceComparisonFixtures("REFERENCE_CLEAN").sourceModePairs,
      }),
    });
    assert.strictEqual(result.report.pass, true);
    assert.ok(fs.existsSync(path.join(dir, "promotion-runtime-manifest.json")));
    assert.ok(fs.existsSync(path.join(dir, "replay-fixtures.json")));
    assert.ok(fs.existsSync(path.join(dir, "comparison-fixtures.json")));
    assert.ok(fs.existsSync(path.join(dir, "unified-promotion-report.json")));
    assert.ok(fs.existsSync(path.join(dir, "promotion-deploy-decision.json")));
    assert.strictEqual(result.deployDecision.approved, true);
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(storedDecision.bounded_runtime_summary.exporter_snapshot_size_bytes > 0, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.openclaw_execution_separation_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.runtime_chain_audit_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_evidence_summary.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function collectorInputBuildsSnapshotThenPassesPipeline() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-collector-"));
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__PIPE",
    decision_mode: "SHADOW",
    created_at: "2026-04-20T00:00:00.000Z",
  };
  const store = {
    [`${PREFIX}position_cycles_v2`]: {
      [episode.positionCycle.position_cycle_id]: {
        ...episode.positionCycle,
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
        policy_scope: nativeBundle.openclawDecision.policy_scope,
      },
    },
  };
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
      V2_PROMOTION_COLLECT_SELECTOR_META_JSON: JSON.stringify({
        position_cycle_id: episode.positionCycle.position_cycle_id,
        query_budget: {
          query_limit: 25,
          recent_window_hours: 168,
          recent_cutoff_at: "2026-04-13T00:00:00.000Z",
        },
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      }),
    }, {
      collectorDb: buildFakeDb(store),
    });
    assert.strictEqual(result.report.pass, true);
    assert.ok(fs.existsSync(path.join(dir, "promotion-runtime-snapshot.json")));
    assert.ok(fs.existsSync(path.join(dir, "unified-promotion-report.json")));
    assert.ok(fs.existsSync(path.join(dir, "promotion-deploy-decision.json")));
    assert.strictEqual(result.deployDecision.approved, true);
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(storedDecision.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
    assert.strictEqual(storedDecision.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function collectorTerminalMismatchFailsPipelineClosed() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-terminal-mismatch-"));
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__PIPE_TERMINAL_MISMATCH",
    decision_mode: "SHADOW",
    created_at: "2026-04-20T00:00:00.000Z",
  };
  const nonTerminalTransitions = episode.transitions.slice(0, 2);
  const store = {
    [`${PREFIX}position_cycles_v2`]: {
      [episode.positionCycle.position_cycle_id]: {
        ...episode.positionCycle,
        signal_intent_id: nativeBundle.signalIntent.signal_intent_id,
        openclaw_decision_id: nativeBundle.openclawDecision.openclaw_decision_id,
      },
    },
    [`${PREFIX}exit_runtime_projection_v2`]: {
      [episode.projection.exit_runtime_projection_id]: {
        ...episode.projection,
        stage: "TRAIL_ACTIVE",
        trail_active: true,
        health_status: "HEALTHY",
      },
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
      nonTerminalTransitions.map((row, index) => [`t${index}`, row])
    ),
    [`${PREFIX}trade_alert_outbox_v2`]: Object.fromEntries(
      episode.outboxes.slice(0, 2).map((row, index) => [`o${index}`, row])
    ),
    [`${PREFIX}exit_repair_requests_v2`]: {},
    [`${PREFIX}signal_intents_v2`]: {
      [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
      [webhookBundle.signalIntent.signal_intent_id]: {
        ...webhookBundle.signalIntent,
        symbol: nativeBundle.signalIntent.symbol,
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
        policy_scope: nativeBundle.openclawDecision.policy_scope,
      },
    },
  };
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
      V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON: JSON.stringify({
        has_active_position: false,
      }),
      V2_PROMOTION_COLLECT_SELECTOR_META_JSON: JSON.stringify({
        position_cycle_id: episode.positionCycle.position_cycle_id,
        query_budget: {
          query_limit: 25,
          recent_window_hours: 168,
          recent_cutoff_at: "2026-04-13T00:00:00.000Z",
        },
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      }),
    }, {
      collectorDb: buildFakeDb(store),
    });
    assert.strictEqual(result.report.pass, false);
    assert.ok(result.report.blockers.some((row) => row.includes("TERMINAL_TRANSITION_MISSING")));
    assert.strictEqual(result.deployDecision.approved, false);
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(storedDecision.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function selectorInputBuildsCollectorSnapshotThenPassesPipeline() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-selector-"));
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__PIPE_SELECTOR",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__PIPE",
    decision_mode: "SHADOW",
    symbol: nativeBundle.signalIntent.symbol,
    side: nativeBundle.signalIntent.side,
    timeframe: nativeBundle.featureSnapshot.timeframe,
    created_at: "2026-04-20T00:00:00.000Z",
  };
  const store = {
    [`${PREFIX}position_cycles_v2`]: {
      [episode.positionCycle.position_cycle_id]: {
        ...episode.positionCycle,
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
        policy_scope: nativeBundle.openclawDecision.policy_scope,
        signal_intent_id: webhookBundle.signalIntent.signal_intent_id,
        created_at: "2026-04-20T00:06:00.000Z",
      },
    },
  };
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    }, {
      selectorDb: buildFakeDb(store),
      collectorDb: buildFakeDb(store),
    });
    assert.strictEqual(result.report.pass, true);
    assert.ok(fs.existsSync(path.join(dir, "promotion-collector-inputs.json")));
    assert.ok(fs.existsSync(path.join(dir, "promotion-runtime-snapshot.json")));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "promotion-runtime-manifest.json"), "utf8"));
    assert.strictEqual(manifest.snapshot_meta.selector_meta.position_cycle_id, episode.positionCycle.position_cycle_id);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("RUN_V2_PROMOTION_PIPELINE_TEST_OK");
