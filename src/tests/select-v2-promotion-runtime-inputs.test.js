"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const selector = require("../../scripts/select-v2-promotion-runtime-inputs");
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

(function selectorRequiresPositionCycleId() {
  let err = null;
  try {
    selector.__test.resolveSelectorConfig({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_SELECT_POSITION_CYCLE_ID_REQUIRED");
})();

(async function selectorBuildsCollectorEnvFromPositionCycleContext() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__SELECTOR",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__1",
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
  };

  const selected = await selector.selectCollectorInputs({
    db: buildFakeDb(store),
    env: {
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON: JSON.stringify({
        has_active_position: false,
      }),
    },
  });

  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_POSITION_CYCLE_ID, episode.positionCycle.position_cycle_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_NATIVE_SIGNAL_INTENT_ID, nativeBundle.signalIntent.signal_intent_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_NATIVE_DECISION_ID, nativeBundle.openclawDecision.openclaw_decision_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID, shadowProposal.ml_ai_signal_proposal_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_WEBHOOK_SIGNAL_INTENT_ID, webhookBundle.signalIntent.signal_intent_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_WEBHOOK_DECISION_ID, webhookBundle.openclawDecision.openclaw_decision_id);
  assert.strictEqual(selected.collectorEnv.V2_PROMOTION_COLLECT_EXCHANGE_STATE_JSON, JSON.stringify({ has_active_position: false }));
  assert.ok(selected.selectorMeta.alignment_checks.policy_scope_match);
  assert.ok(selected.selectorMeta.lineage_contract);
  assert.ok(selected.selectorMeta.lineage_contract.hash);
  assert.ok(selected.collectorEnv.V2_PROMOTION_COLLECT_SELECTOR_META_JSON);
  assert.strictEqual(selected.selectorMeta.query_budget.query_limit, 25);
})();

(async function selectorFailsClosedOnWebhookPolicyScopeMismatch() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__SELECTOR_MISMATCH",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__MISMATCH",
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
        policy_scope: "MISMATCH_SCOPE",
        created_at: "2026-04-20T00:06:00.000Z",
      },
    },
  };

  let err = null;
  try {
    await selector.selectCollectorInputs({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_SELECT_WEBHOOK_POLICY_SCOPE_MISMATCH");
})();

(async function selectorFailsClosedOnStalePositionCycle() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__STALE",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__STALE",
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
        created_at: "2026-04-01T00:00:00.000Z",
        signal_intent_id: nativeBundle.signalIntent.signal_intent_id,
        openclaw_decision_id: nativeBundle.openclawDecision.openclaw_decision_id,
      },
    },
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
  };

  let err = null;
  try {
    await selector.selectCollectorInputs({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
        V2_PROMOTION_SELECT_RECENT_WINDOW_HOURS: "24",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_SELECT_POSITION_CYCLE_OUTSIDE_RECENT_WINDOW");
})();

(async function selectorFailsClosedWhenQueryTouchesBudgetLimit() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__QUERY_LIMIT",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__QUERY_LIMIT",
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
    [`${PREFIX}signal_intents_v2`]: {
      [nativeBundle.signalIntent.signal_intent_id]: nativeBundle.signalIntent,
      [webhookBundle.signalIntent.signal_intent_id]: {
        ...webhookBundle.signalIntent,
        symbol: nativeBundle.signalIntent.symbol,
        side: nativeBundle.signalIntent.side,
        created_at: "2026-04-20T00:05:00.000Z",
      },
    },
    [`${PREFIX}feature_snapshots_v2`]: Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => {
        const row = {
          ...nativeBundle.featureSnapshot,
          feature_snapshot_id: `${nativeBundle.featureSnapshot.feature_snapshot_id}__${index}`,
          signal_intent_id: nativeBundle.signalIntent.signal_intent_id,
          snapshot_at: `2026-04-20T00:0${index}:00.000Z`,
        };
        return [row.feature_snapshot_id, row];
      })
    ),
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
  };

  let err = null;
  try {
    await selector.selectCollectorInputs({
      db: buildFakeDb(store),
      env: {
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
        V2_PROMOTION_SELECT_QUERY_LIMIT: "5",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_SELECT_NATIVE_FEATURE_SNAPSHOT_NOT_FOUND_QUERY_LIMIT_REACHED");
})();

(async function selectorWritesCollectorInputsArtifact() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__SELECTOR_FILE",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__FILE",
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
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-selector-"));
  try {
    await selector.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: episode.positionCycle.position_cycle_id,
    }, buildFakeDb(store));
    const file = path.join(dir, "promotion-collector-inputs.json");
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.collectorEnv.V2_PROMOTION_COLLECT_SHADOW_PROPOSAL_ID, shadowProposal.ml_ai_signal_proposal_id);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("SELECT_V2_PROMOTION_RUNTIME_INPUTS_TEST_OK");
