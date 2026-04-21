"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selector = require("../../scripts/select-v2-promotion-canary-candidate");
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

function buildReadyCycleStore({ createdAt = "2026-04-20T00:00:00.000Z", suffix = "A" } = {}) {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const cycleId = `${episode.positionCycle.position_cycle_id}__${suffix}`;
  const nativeSignalIntentId = `${nativeBundle.signalIntent.signal_intent_id}__${suffix}`;
  const nativeDecisionId = `${nativeBundle.openclawDecision.openclaw_decision_id}__${suffix}`;
  const featureSnapshotId = `${nativeBundle.featureSnapshot.feature_snapshot_id}__${suffix}`;
  const nativeProposalId = `${nativeBundle.mlAiSignalProposal.ml_ai_signal_proposal_id}__${suffix}`;
  const mlEvidenceId = `${nativeBundle.mlAiEvidence.decision_id}__${suffix}`;
  const shadowProposalId = `MSPV2__SHADOW__CANDIDATE__${suffix}`;
  const webhookSignalIntentId = `${webhookBundle.signalIntent.signal_intent_id}__${suffix}`;
  const webhookDecisionId = `${webhookBundle.openclawDecision.openclaw_decision_id}__${suffix}`;

  const positionCycle = {
    ...episode.positionCycle,
    position_cycle_id: cycleId,
    created_at: createdAt,
    status: "ACTIVE_PROTECTED",
    signal_intent_id: nativeSignalIntentId,
    openclaw_decision_id: nativeDecisionId,
  };
  const projection = {
    ...episode.projection,
    exit_runtime_projection_id: `ERPv2__${cycleId}`,
    position_cycle_id: cycleId,
  };
  const protectionRuntime = {
    protection_runtime_id: `PRTV2__${cycleId}`,
    position_cycle_id: cycleId,
    sl_order_id: "STOP__1",
    tp1_order_id: "TP1__1",
    last_exchange_evidence: episode.protectionRuntime.last_exchange_evidence,
    last_evidence_observed_at: episode.protectionRuntime.last_evidence_observed_at,
  };
  const transitions = Object.fromEntries(
    episode.transitions.map((row, index) => [`t${suffix}${index}`, { ...row, position_cycle_id: cycleId }])
  );
  const outboxes = Object.fromEntries(
    episode.outboxes.map((row, index) => [`o${suffix}${index}`, { ...row, position_cycle_id: cycleId }])
  );
  const signalIntent = {
    ...nativeBundle.signalIntent,
    signal_intent_id: nativeSignalIntentId,
  };
  const featureSnapshot = {
    ...nativeBundle.featureSnapshot,
    feature_snapshot_id: featureSnapshotId,
    signal_intent_id: nativeSignalIntentId,
  };
  const nativeProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: nativeProposalId,
    signal_intent_id: nativeSignalIntentId,
    feature_snapshot_id: featureSnapshotId,
  };
  const mlEvidence = {
    ...nativeBundle.mlAiEvidence,
    decision_id: mlEvidenceId,
    signal_intent_id: nativeSignalIntentId,
    feature_snapshot_id: featureSnapshotId,
  };
  const nativeDecision = {
    ...nativeBundle.openclawDecision,
    openclaw_decision_id: nativeDecisionId,
    signal_intent_id: nativeSignalIntentId,
  };
  const shadowProposal = {
    ...nativeProposal,
    ml_ai_signal_proposal_id: shadowProposalId,
    signal_intent_id: `SIGINTV2__SHADOW_CONTEXT__${suffix}`,
    decision_mode: "SHADOW",
    symbol: signalIntent.symbol,
    side: signalIntent.side,
    timeframe: featureSnapshot.timeframe,
    created_at: createdAt,
  };
  const webhookSignalIntent = {
    ...webhookBundle.signalIntent,
    signal_intent_id: webhookSignalIntentId,
    symbol: signalIntent.symbol,
    side: signalIntent.side,
    created_at: createdAt,
  };
  const webhookDecision = {
    ...webhookBundle.openclawDecision,
    openclaw_decision_id: webhookDecisionId,
    signal_intent_id: webhookSignalIntentId,
    policy_scope: nativeDecision.policy_scope,
    created_at: createdAt,
  };

  return {
    cycleId,
    store: {
      [`${PREFIX}position_cycles_v2`]: {
        [cycleId]: positionCycle,
      },
      [`${PREFIX}exit_runtime_projection_v2`]: {
        [projection.exit_runtime_projection_id]: projection,
      },
      [`${PREFIX}protection_runtime_v2`]: {
        [protectionRuntime.protection_runtime_id]: protectionRuntime,
      },
      [`${PREFIX}canonical_exit_transitions_v2`]: transitions,
      [`${PREFIX}trade_alert_outbox_v2`]: outboxes,
      [`${PREFIX}exit_repair_requests_v2`]: {},
      [`${PREFIX}signal_intents_v2`]: {
        [signalIntent.signal_intent_id]: signalIntent,
        [webhookSignalIntent.signal_intent_id]: webhookSignalIntent,
      },
      [`${PREFIX}feature_snapshots_v2`]: {
        [featureSnapshot.feature_snapshot_id]: featureSnapshot,
      },
      [`${PREFIX}ml_ai_signal_proposals_v2`]: {
        [nativeProposal.ml_ai_signal_proposal_id]: nativeProposal,
        [shadowProposal.ml_ai_signal_proposal_id]: shadowProposal,
      },
      [`${PREFIX}ml_ai_evidence_ledger_v2`]: {
        [mlEvidence.decision_id]: mlEvidence,
      },
      [`${PREFIX}openclaw_decisions_v2`]: {
        [nativeDecision.openclaw_decision_id]: nativeDecision,
        [webhookDecision.openclaw_decision_id]: webhookDecision,
      },
    },
  };
}

function mergeStores(...stores) {
  const merged = {};
  for (const store of stores) {
    for (const [collection, bucket] of Object.entries(store || {})) {
      merged[collection] = {
        ...(merged[collection] || {}),
        ...(bucket || {}),
      };
    }
  }
  return merged;
}

(function candidateConfigDefaultsToProtectedActiveCanary() {
  const cfg = selector.__test.resolveCandidateConfig({});
  assert.strictEqual(cfg.mode, "CANARY");
  assert.strictEqual(cfg.status, "ACTIVE_PROTECTED");
  assert.strictEqual(cfg.scanLimit, 10);
})();

(async function selectsNewestReadyCandidate() {
  const older = buildReadyCycleStore({
    createdAt: "2026-04-19T00:00:00.000Z",
    suffix: "OLD",
  });
  const newer = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "NEW",
  });
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(mergeStores(older.store, newer.store)),
    env: {
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANDIDATE_LIMIT: "5",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.selected_position_cycle_id, newer.cycleId);
  assert.strictEqual(result.collector_env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID, newer.cycleId);
  assert.strictEqual(result.selection_contract.ok, true);
  assert.strictEqual(result.selection_contract.selected_preflight_ok, true);
  assert.strictEqual(result.selection_contract.selected_cycle_matches_collector_env, true);
})();

(async function candidateSelectionForwardsExchangeStateToCollectorEnv() {
  const ready = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "EXCHANGE_STATE",
  });
  const exchangeStateJson = JSON.stringify({
    has_active_position: false,
  });
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(ready.store),
    env: {
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON: exchangeStateJson,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.collector_env.V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON, exchangeStateJson);
  assert.strictEqual(result.selection_contract.ok, true);
})();

(async function failsClosedWhenNoCandidatePassesPreflight() {
  const blocked = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "BLOCKED",
  });
  const collectionName = `${PREFIX}openclaw_decisions_v2`;
  const blockedDecisionId = Object.keys(blocked.store[collectionName]).find((id) => id.includes("LIVE")) || Object.keys(blocked.store[collectionName])[1];
  blocked.store[collectionName][blockedDecisionId] = {
    ...blocked.store[collectionName][blockedDecisionId],
    policy_scope: "MISMATCH_SCOPE",
  };
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(blocked.store),
    env: {
      V2_PROMOTION_MODE: "CANARY",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.selection_status, "NO_PREFLIGHT_READY_CANDIDATES");
  assert.strictEqual(result.selected_position_cycle_id, null);
  assert.strictEqual(result.selection_contract.ok, false);
  assert.ok(result.evaluated_candidates[0].error || (result.evaluated_candidates[0].preflight && result.evaluated_candidates[0].preflight.ok === false));
})();

(async function terminalMismatchCandidateIsExcludedBeforeSelection() {
  const blocked = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "TERMINAL_MISMATCH",
  });
  const cycleId = blocked.cycleId;
  blocked.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`] = {
    ...blocked.store[`${PREFIX}exit_runtime_projection_v2`][`ERPv2__${cycleId}`],
    stage: "TRAIL_ACTIVE",
    trail_active: true,
    health_status: "HEALTHY",
  };
  const transitionKeys = Object.keys(blocked.store[`${PREFIX}canonical_exit_transitions_v2`]).sort();
  blocked.store[`${PREFIX}canonical_exit_transitions_v2`] = {
    [transitionKeys[0]]: blocked.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[0]],
    [transitionKeys[1]]: blocked.store[`${PREFIX}canonical_exit_transitions_v2`][transitionKeys[1]],
  };
  blocked.store[`${PREFIX}trade_alert_outbox_v2`] = Object.fromEntries(
    Object.entries(blocked.store[`${PREFIX}trade_alert_outbox_v2`]).slice(0, 2)
  );

  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(blocked.store),
    env: {
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON: JSON.stringify({
        has_active_position: false,
      }),
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.selection_status, "NO_PREFLIGHT_READY_CANDIDATES");
  assert.strictEqual(result.selection_contract.ok, false);
  assert.ok(result.evaluated_candidates[0].preflight.blockers.includes("PREFLIGHT:TERMINAL_WATCHDOG_MISMATCH:TERMINAL_TRANSITION_MISSING"));
})();

(async function reportsEmptyActiveUniverseExplicitly() {
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb({}),
    env: {
      V2_PROMOTION_MODE: "CANARY",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.selection_status, "NO_ACTIVE_POSITION_CYCLES");
  assert.strictEqual(result.active_position_cycle_n, 0);
  assert.strictEqual(result.selection_contract.ok, false);
  assert.deepStrictEqual(result.evaluated_candidates, []);
})();

(async function reportsNoRecentActiveCyclesExplicitly() {
  const stale = buildReadyCycleStore({
    createdAt: "2026-04-01T00:00:00.000Z",
    suffix: "STALE",
  });
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(stale.store),
    env: {
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANDIDATE_RECENT_WINDOW_HOURS: "24",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.selection_status, "NO_RECENT_ACTIVE_POSITION_CYCLES");
  assert.strictEqual(result.active_position_cycle_n, 1);
  assert.strictEqual(result.recent_active_position_cycle_n, 0);
  assert.strictEqual(result.selection_contract.ok, false);
})();

(async function failsClosedWhenActiveCycleScanHitsBudgetLimit() {
  const ready = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "SCAN_LIMIT",
  });
  const result = await selector.selectCanaryCandidate({
    db: buildFakeDb(ready.store),
    env: {
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_CANDIDATE_LIMIT: "1",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.selection_status, "ACTIVE_CYCLE_SCAN_LIMIT_REACHED");
  assert.strictEqual(result.selection_contract.scan_limit_respected, false);
  assert.strictEqual(result.evaluated_candidates.length, 0);
})();

(async function mainWritesSelectionArtifact() {
  const ready = buildReadyCycleStore({
    createdAt: "2026-04-20T00:00:00.000Z",
    suffix: "FILE",
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-candidate-"));
  try {
    await selector.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    }, buildFakeDb(ready.store));
    const file = path.join(dir, "promotion-canary-candidate-selection.json");
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.selected_position_cycle_id, ready.cycleId);
    assert.strictEqual(payload.selection_contract.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("SELECT_V2_PROMOTION_CANARY_CANDIDATE_TEST_OK");
