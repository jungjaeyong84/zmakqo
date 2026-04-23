"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const preflight = require("../../scripts/check-v2-promotion-canary-preflight");
const { buildReferencePassEpisode, buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const { buildWebhookBundle } = require("../v2/comparisonFixtureFactory");

const PREFIX = "donbeolja_v2__";
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = preflight.__test.REQUIRED_PREFLIGHT_RUNTIME_CHAIN_CHECK_IDS;

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

function buildStore() {
  const episode = buildReferencePassEpisode();
  const nativeBundle = buildReferenceNativeMlEvidencePack();
  const webhookBundle = buildWebhookBundle();
  const shadowProposal = {
    ...nativeBundle.mlAiSignalProposal,
    ml_ai_signal_proposal_id: "MSPV2__SHADOW__PREFLIGHT",
    signal_intent_id: "SIGINTV2__SHADOW_CONTEXT__PREFLIGHT",
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

(function preflightRequiresPositionCycleId() {
  let err = null;
  try {
    preflight.__test.resolvePreflightConfig({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_PREFLIGHT_POSITION_CYCLE_ID_REQUIRED");
})();

(async function preflightPassesForBoundedReadyCycle() {
  const fixture = buildStore();
  const report = await preflight.runPreflight({
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: fixture.episode.positionCycle.position_cycle_id,
  }, {
    db: buildFakeDb(fixture.store),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.snapshot_counts.episode_n, 1);
  assert.strictEqual(report.runtime_chain_audit.ok, true);
  assert.strictEqual(report.selector_meta.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
  assert.ok(report.lineage_contract);
  assert.strictEqual(report.selector_meta.lineage_contract.hash, report.lineage_contract.hash);
})();

(async function preflightFailsClosedOnMissingRuntimeChainAudit() {
  const evaluation = preflight.__test.evaluateSnapshot({
    snapshotMeta: {
      selector_meta: {
        position_cycle_id: "PCY__OK",
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      },
    },
    episodes: [{
      positionCycle: { position_cycle_id: "PCY__OK" },
      projection: { position_cycle_id: "PCY__OK" },
      protectionRuntime: { position_cycle_id: "PCY__OK" },
      watchdog: { issueCodes: [] },
    }],
    shadowLivePairs: [{}],
    sourceModePairs: [{}],
  });
  assert.strictEqual(evaluation.ready, false);
  assert.ok(evaluation.blockers.includes("PREFLIGHT:RUNTIME_CHAIN_AUDIT_REQUIRED"));
  assert.ok(evaluation.blockers.some((row) => row.includes("PREFLIGHT:RUNTIME_CHAIN_CHECKS_MISSING")));
})();

(async function preflightFailsClosedOnTerminalEvidenceRuntimeChainFailure() {
  const evaluation = preflight.__test.evaluateSnapshot({
    snapshotMeta: {
      selector_meta: {
        position_cycle_id: "PCY__OK",
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      },
      runtime_chain_audits: [{
        ok: false,
        fail_n: 2,
        check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
        passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.filter((id) => ![
          "COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT",
          "COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT",
        ].includes(id)),
        failed_check_ids: [
          "COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT",
          "COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT",
        ],
      }],
    },
    episodes: [{
      positionCycle: { position_cycle_id: "PCY__OK" },
      projection: { position_cycle_id: "PCY__OK" },
      protectionRuntime: { position_cycle_id: "PCY__OK" },
      watchdog: { issueCodes: [] },
    }],
    shadowLivePairs: [{}],
    sourceModePairs: [{}],
  });
  assert.strictEqual(evaluation.ready, false);
  assert.ok(evaluation.blockers.includes(
    "PREFLIGHT:RUNTIME_CHAIN_AUDIT_FAILED:COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT|COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT"
  ));
})();

(async function preflightFailsClosedOnAlignmentMismatch() {
  const evaluation = preflight.__test.evaluateSnapshot({
    snapshotMeta: {
      selector_meta: {
        position_cycle_id: "PCY__BAD",
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: false,
          policy_scope_match: true,
        },
      },
    },
    episodes: [{}],
    shadowLivePairs: [{}],
    sourceModePairs: [{}],
  });
  assert.strictEqual(evaluation.ready, false);
  assert.ok(evaluation.blockers.includes("PREFLIGHT:TIMEFRAME_MISMATCH"));
})();

(async function preflightFailsClosedOnTerminalWatchdogMismatch() {
  const evaluation = preflight.__test.evaluateSnapshot({
    snapshotMeta: {
      selector_meta: {
        position_cycle_id: "PCY__OK",
        alignment_checks: {
          symbol_match: true,
          side_match: true,
          timeframe_match: true,
          policy_scope_match: true,
        },
      },
    },
    episodes: [{
      positionCycle: { position_cycle_id: "PCY__OK" },
      projection: { position_cycle_id: "PCY__OK" },
      protectionRuntime: { position_cycle_id: "PCY__OK" },
      watchdog: {
        issueCodes: ["TERMINAL_TRANSITION_MISSING"],
      },
    }],
    shadowLivePairs: [{}],
    sourceModePairs: [{}],
  });
  assert.strictEqual(evaluation.ready, false);
  assert.ok(evaluation.blockers.includes("PREFLIGHT:TERMINAL_WATCHDOG_MISMATCH:TERMINAL_TRANSITION_MISSING"));
})();

(async function mainWritesPreflightArtifact() {
  const fixture = buildStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-preflight-"));
  try {
    await preflight.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: fixture.episode.positionCycle.position_cycle_id,
    }, buildFakeDb(fixture.store));
    const file = path.join(dir, "promotion-preflight.json");
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.ok, true);
    assert.strictEqual(payload.position_cycle_id, fixture.episode.positionCycle.position_cycle_id);
    assert.ok(payload.lineage_contract);
    assert.strictEqual(payload.selector_meta.lineage_contract.hash, payload.lineage_contract.hash);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("CHECK_V2_PROMOTION_CANARY_PREFLIGHT_TEST_OK");
