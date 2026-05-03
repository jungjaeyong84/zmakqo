"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const collector = require("../../scripts/collect-v2-promotion-runtime-snapshot");
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
            async set(payload) {
              bucket[id] = payload;
              store[name] = bucket;
            },
            async get() {
              const row = bucket[id];
              return {
                exists: !!row,
                data() {
                  return row;
                },
              };
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

(function configRequiresExplicitIds() {
  let err = null;
  try {
    collector.__test.resolveCollectorConfig({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_COLLECT_POSITION_CYCLE_ID_REQUIRED");
})();

(async function collectRuntimeSnapshotBuildsCanonicalShape() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__1",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
  const snapshot = await collector.collectRuntimeSnapshot({
    db: buildFakeDb(store),
    env: {
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
    },
  });
  assert.strictEqual(snapshot.episodes.length, 1);
  assert.strictEqual(snapshot.shadowLivePairs.length, 1);
  assert.strictEqual(snapshot.sourceModePairs.length, 1);
  assert.strictEqual(snapshot.episodes[0].signalIntent.signal_intent_id, nativeBundle.signalIntent.signal_intent_id);
  assert.strictEqual(snapshot.snapshotMeta.selector_meta, null);
  assert.strictEqual(snapshot.snapshotMeta.query_budget.limits.transitionsLimit, 50);
  assert.strictEqual(snapshot.snapshotMeta.query_budget.counts.transitions, episode.transitions.length);
  assert.strictEqual(snapshot.snapshotMeta.query_budget.counts.repair_execution_ledgers, 0);
  assert.strictEqual(snapshot.snapshotMeta.alert_retry_summary.outbox_n, episode.outboxes.length);
  assert.strictEqual(snapshot.snapshotMeta.alert_retry_summary.failed_n, 0);
  assert.strictEqual(snapshot.snapshotMeta.alert_retry_summary.sent_n, episode.outboxes.length);
  assert.strictEqual(snapshot.snapshotMeta.repair_evidence_summary.ok, true);
  assert.strictEqual(snapshot.snapshotMeta.repair_evidence_summary.repair_request_n, 0);
  assert.strictEqual(snapshot.snapshotMeta.repair_evidence_summary.completion_evidence_n, 0);
  assert.strictEqual(snapshot.snapshotMeta.runtime_chain_audits[0].ok, true);
  assert.deepStrictEqual(
    snapshot.snapshotMeta.runtime_chain_audits[0].passed_check_ids,
    collector.__test.REQUIRED_COLLECTED_RUNTIME_CHAIN_CHECK_IDS
  );
  assert.strictEqual(snapshot.snapshotMeta.openclaw_execution_audit_ledger_write.skipped, true);
  assert.strictEqual(snapshot.snapshotMeta.openclaw_execution_audit_ledger_write.reason, "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED");
})();

(function collectedRuntimeChainAuditFailsOnOutboxCycleDrift() {
  const episode = buildReferencePassEpisode();
  const audit = collector.__test.buildCollectedRuntimeChainAudit({
    ...episode,
    outboxes: episode.outboxes.map((row, index) => index === 0
      ? { ...row, position_cycle_id: "PCY__DRIFT" }
      : row),
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("COLLECTED_OUTBOX_POSITION_CYCLE_MATCH"));
  assert.ok(audit.passed_check_ids.includes("COLLECTED_POSITION_CYCLE_ID_PRESENT"));
})();

(function collectedRuntimeChainAuditFailsOnWeakTerminalEvidence() {
  const episode = buildReferencePassEpisode();
  const transitions = episode.transitions.map((row, index, arr) => {
    if (index !== arr.length - 1) return row;
    const raw = { ...row.source_exchange_evidence.raw_payload };
    delete raw.full_exit;
    delete raw.position_amt_after;
    delete raw.order_type;
    delete raw.stop_price;
    return {
      ...row,
      source_exchange_evidence: {
        ...row.source_exchange_evidence,
        evidence_kind: "AMBIGUOUS_EXIT",
        raw_payload: raw,
      },
    };
  });
  const audit = collector.__test.buildCollectedRuntimeChainAudit({
    ...episode,
    transitions,
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT"));
  assert.ok(!audit.failed_check_ids.includes("COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT"));
  assert.ok(audit.failed_check_ids.includes("REPLAY_GATE_EPISODE_VALID"));
})();

(function repairEvidenceSummaryRequiresCompletionEvidenceWhenRepairRequested() {
  const summary = collector.__test.buildRepairEvidenceSummary({
    repairRequests: [
      {
        exit_repair_request_id: "RQRV2__TP1__1",
        position_cycle_id: "PCY__REPAIR__1",
        issue_code: "TP1_ORDER_MISSING",
      },
    ],
    repairExecutionLedgers: [
      {
        repair_execution_ledger_id: "RQLEDGERV2__DELEGATED__1",
        exit_repair_request_id: "RQRV2__TP1__1",
        position_cycle_id: "PCY__REPAIR__1",
        issue_code: "TP1_ORDER_MISSING",
        execution_status: "DELEGATED",
        recorded_at: "2026-04-21T01:00:00.000Z",
      },
    ],
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.repair_request_n, 1);
  assert.strictEqual(summary.completion_ledger_n, 0);
  assert.strictEqual(summary.completion_evidence_n, 0);
})();

(function repairEvidenceSummaryAggregatesCompletionEvidence() {
  const summary = collector.__test.buildRepairEvidenceSummary({
    repairRequests: [
      {
        exit_repair_request_id: "RQRV2__TP1__1",
        position_cycle_id: "PCY__REPAIR__2",
        issue_code: "TP1_ORDER_MISSING",
      },
    ],
    repairExecutionLedgers: [
      {
        repair_execution_ledger_id: "RQLEDGERV2__COMPLETED_SUCCESS__1",
        exit_repair_request_id: "RQRV2__TP1__1",
        position_cycle_id: "PCY__REPAIR__2",
        issue_code: "TP1_ORDER_MISSING",
        execution_status: "COMPLETED_SUCCESS",
        command_type: "PLACE_OR_REPLACE_TP1",
        recorded_at: "2026-04-21T01:01:00.000Z",
        result_snapshot: {
          runbook_refs: ["RQ_RBK_01"],
          repair_evidence_summary: {
            issue_code: "TP1_ORDER_MISSING",
            command_type: "PLACE_OR_REPLACE_TP1",
            runbook_refs: ["RQ_RBK_01"],
            order_evidence: [
              {
                leg: "TP1",
                order_id: "TP1__1",
              },
            ],
          },
        },
      },
    ],
  });
  assert.strictEqual(summary.ok, true);
  assert.deepStrictEqual(summary.runbook_refs, ["RQ_RBK_01"]);
  assert.strictEqual(summary.order_evidence_n, 1);
  assert.strictEqual(summary.latest_completion.issue_code, "TP1_ORDER_MISSING");
})();

(async function collectorCanPersistOpenClawExecutionAuditLedgerWhenExplicitlyEnabled() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__AUDIT_LEDGER",
    decision_mode: "SHADOW",
    created_at: "2026-04-20T00:00:00.000Z",
  };
  const store = {
    [`${PREFIX}position_cycles_v2`]: {
      [episode.positionCycle.position_cycle_id]: {
        ...episode.positionCycle,
        signal_intent_id: nativeBundle.signalIntent.signal_intent_id,
        openclaw_decision_id: nativeBundle.openClawDecisionId || nativeBundle.openclawDecision.openclaw_decision_id,
      },
    },
    [`${PREFIX}exit_runtime_projection_v2`]: {
      [episode.projection.exit_runtime_projection_id]: episode.projection,
    },
    [`${PREFIX}protection_runtime_v2`]: {
      [`PRTV2__${episode.positionCycle.position_cycle_id}`]: {
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
    [`${PREFIX}openclaw_execution_audits_v2`]: {},
  };
  const snapshot = await collector.collectRuntimeSnapshot({
    db: buildFakeDb(store),
    env: {
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
    },
  });
  const write = snapshot.snapshotMeta.openclaw_execution_audit_ledger_write;
  assert.strictEqual(write.skipped, false);
  assert.strictEqual(write.collection_key, "OPENCLAW_EXECUTION_AUDITS");
  const rows = Object.values(store[`${PREFIX}openclaw_execution_audits_v2`]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].openclaw_execution_audit_id, write.doc_id);
  assert.strictEqual(rows[0].ok, true);
  assert.strictEqual(rows[0].position_cycle_id, episode.positionCycle.position_cycle_id);
})();

(async function collectorCarriesSelectorMetaIntoSnapshot() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__SELECTOR_META",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
  const snapshot = await collector.collectRuntimeSnapshot({
    db: buildFakeDb(store),
    env: {
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
      V2_PROMOTION_COLLECT_SELECTOR_META_JSON: JSON.stringify({
        position_cycle_id: episode.positionCycle.position_cycle_id,
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      }),
    },
  });
  assert.strictEqual(snapshot.snapshotMeta.selector_meta.position_cycle_id, episode.positionCycle.position_cycle_id);
})();

(function alertRetrySummaryAggregatesFailedOutboxes() {
  const summary = collector.__test.buildAlertRetrySummary([
    {
      alert_outbox_id: "A1",
      status: "FAILED",
      last_reason: "V2_SHADOW_ALERT_DELIVERY_DISABLED",
      last_reason_family: "OPERATOR_CONFIG",
      retry_policy_code: "ALERT_CFG_TERMINAL",
      runbook_refs: ["ALERT_RBK_01"],
      last_attempt_at: "2026-04-21T10:00:00.000Z",
    },
    {
      alert_outbox_id: "A2",
      status: "FAILED",
      last_reason: "ALERT_DELIVERY_FAILED",
      last_reason_family: "TRANSPORT",
      retry_policy_code: "ALERT_RETRY_TRANSPORT",
      runbook_refs: ["ALERT_RBK_04"],
      last_attempt_at: "2026-04-21T11:00:00.000Z",
    },
    {
      alert_outbox_id: "A3",
      status: "SENT",
    },
  ]);
  assert.strictEqual(summary.outbox_n, 3);
  assert.strictEqual(summary.failed_n, 2);
  assert.strictEqual(summary.sent_n, 1);
  assert.strictEqual(summary.retryable_failed_n, 1);
  assert.strictEqual(summary.terminal_failed_n, 1);
  assert.strictEqual(summary.family_counts.OPERATOR_CONFIG, 1);
  assert.strictEqual(summary.family_counts.TRANSPORT, 1);
  assert.strictEqual(summary.retry_policy_counts.ALERT_CFG_TERMINAL, 1);
  assert.strictEqual(summary.retry_policy_counts.ALERT_RETRY_TRANSPORT, 1);
  assert.strictEqual(summary.runbook_ref_counts.ALERT_RBK_01, 1);
  assert.strictEqual(summary.runbook_ref_counts.ALERT_RBK_04, 1);
  assert.strictEqual(summary.latest_failed.alert_outbox_id, "A2");
})();

(async function collectorSynthesizesTerminalProjectionMismatchIntoWatchdog() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__TERMINAL_MISMATCH",
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
      [episode.projection.exit_runtime_projection_id]: {
        ...episode.projection,
        stage: "TRAIL_ACTIVE",
        trail_active: true,
        health_status: "HEALTHY",
      },
    },
    [`${PREFIX}protection_runtime_v2`]: {
      [`PRTV2__${episode.positionCycle.position_cycle_id}`]: {
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
  const snapshot = await collector.collectRuntimeSnapshot({
    db: buildFakeDb(store),
    env: {
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
    },
  });
  assert.ok(snapshot.episodes[0].watchdog.issueCodes.includes("TERMINAL_PROJECTION_MISMATCH"));
})();

(async function collectorSynthesizesTerminalTransitionMissingFromExchangeFlatSignal() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__FLAT_SIGNAL",
    decision_mode: "SHADOW",
    created_at: "2026-04-20T00:00:00.000Z",
  };
  const nonTerminalTransitions = [];
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
      },
    },
    [`${PREFIX}canonical_exit_transitions_v2`]: Object.fromEntries(
      nonTerminalTransitions.map((row, index) => [`t${index}`, row])
    ),
    [`${PREFIX}trade_alert_outbox_v2`]: Object.fromEntries(
      [].map((row, index) => [`o${index}`, row])
    ),
    [`${PREFIX}exit_repair_requests_v2`]: {},
    [`${PREFIX}signal_intents_v2`]: {
      [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
      [webhookBundle.signalIntent.signal_intent_id]: {
        ...webhookBundle.signalIntent,
        symbol: nativeBundle.signalIntent.symbol,
        side: nativeBundle.signalIntent.side,
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
  const snapshot = await collector.collectRuntimeSnapshot({
    db: buildFakeDb(store),
    env: {
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
      V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON: JSON.stringify({
        has_active_position: false,
      }),
    },
  });
  assert.ok(snapshot.episodes[0].watchdog.issueCodes.includes("TERMINAL_TRANSITION_MISSING"));
})();

(async function collectorFailsClosedOnSelectorMetaPositionCycleMismatch() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__BAD_META",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
      },
    },
    [`${PREFIX}canonical_exit_transitions_v2`]: {},
    [`${PREFIX}trade_alert_outbox_v2`]: {},
    [`${PREFIX}exit_repair_requests_v2`]: {},
    [`${PREFIX}signal_intents_v2`]: {
      [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
      [webhookBundle.signalIntent.signal_intent_id]: {
        ...webhookBundle.signalIntent,
        symbol: nativeBundle.signalIntent.symbol,
        side: nativeBundle.signalIntent.side,
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
  let err = null;
  try {
    await collector.collectRuntimeSnapshot({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
        V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
        V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
        V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
        V2_PROMOTION_COLLECT_SELECTOR_META_JSON: JSON.stringify({
          position_cycle_id: "PCY__WRONG",
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        }),
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_COLLECT_SELECTOR_META_POSITION_CYCLE_MISMATCH");
})();

(async function collectorFailsClosedWhenTransitionQueryTouchesBudgetLimit() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__QUERY_LIMIT",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
  let err = null;
  try {
    await collector.collectRuntimeSnapshot({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
        V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
        V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
        V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
        V2_PROMOTION_COLLECT_TRANSITIONS_LIMIT: "1",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_COLLECT_TRANSITIONS_QUERY_LIMIT_REACHED");
})();

(async function collectorFailsClosedOnWebhookPolicyScopeMismatch() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__POLICY",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
      },
    },
    [`${PREFIX}canonical_exit_transitions_v2`]: {},
    [`${PREFIX}trade_alert_outbox_v2`]: {},
    [`${PREFIX}exit_repair_requests_v2`]: {},
    [`${PREFIX}signal_intents_v2`]: {
      [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
      [webhookBundle.signalIntent.signal_intent_id]: {
        ...webhookBundle.signalIntent,
        symbol: nativeBundle.signalIntent.symbol,
        side: nativeBundle.signalIntent.side,
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
        policy_scope: "BTC_15M",
      },
    },
  };
  let err = null;
  try {
    await collector.collectRuntimeSnapshot({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
        V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
        V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
        V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_COLLECT_WEBHOOK_POLICY_SCOPE_MISMATCH");
})();

(async function mainWritesSnapshotFile() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__2",
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
        ...episode.protectionRuntime,
        protection_runtime_id: `PRTV2__${episode.positionCycle.position_cycle_id}`,
        position_cycle_id: episode.positionCycle.position_cycle_id,
        sl_order_id: "STOP__1",
        tp1_order_id: "TP1__1",
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runtime-collector-"));
  try {
    await collector.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_COLLECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID: shadowProposal.ml_ai_signal_proposal_id,
      V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID: webhookBundle.signalIntent.signal_intent_id,
      V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID: webhookBundle.openclawDecision.openclaw_decision_id,
    }, buildFakeDb(store));
    assert.ok(fs.existsSync(path.join(dir, "promotion-runtime-snapshot.json")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("COLLECT_V2_PROMOTION_RUNTIME_SNAPSHOT_TEST_OK");
