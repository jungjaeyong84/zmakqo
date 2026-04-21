"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const exporter = require("../../scripts/export-v2-promotion-runtime-snapshot");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");
const { buildReferenceReplayFixtureSet } = require("../v2/replayFixtureFactory");
const { buildReferenceComparisonFixtures } = require("../v2/comparisonFixtureFactory");

const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;

(function validateRuntimeSnapshotRejectsMissingArrays() {
  let err = null;
  try {
    exporter.__test.validateRuntimeSnapshot({});
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_RUNTIME_SNAPSHOT_EPISODES_REQUIRED");
})();

(function validateRuntimeSnapshotRejectsOversizedPayload() {
  const replay = buildReferenceReplayFixtureSet("REFERENCE_NATIVE_PASS");
  const comparison = buildReferenceComparisonFixtures("REFERENCE_CLEAN");
  let err = null;
  try {
    exporter.__test.validateRuntimeSnapshot({
      snapshotMeta: {
        source: "TEST",
        oversized_note: "X".repeat(4096),
      },
      episodes: replay.episodes,
      shadowLivePairs: comparison.shadowLivePairs,
      sourceModePairs: comparison.sourceModePairs,
    }, {
      env: {
        V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_BYTES: "128",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_BYTES_EXCEEDED");
})();

(async function mainExportsFixtureFilesAndManifest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runtime-snapshot-"));
  try {
    const replay = buildReferenceReplayFixtureSet("REFERENCE_NATIVE_PASS");
    const comparison = buildReferenceComparisonFixtures("REFERENCE_CLEAN");
    await exporter.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_RUNTIME_SNAPSHOT_JSON: JSON.stringify({
        snapshotMeta: {
          source: "TEST",
          observed_at: "2026-04-20T00:00:00.000Z",
          alert_retry_summary: {
            outbox_n: 3,
            failed_n: 1,
            sent_n: 2,
            pending_n: 0,
            retryable_failed_n: 1,
            terminal_failed_n: 0,
            family_counts: {
              TRANSPORT: 1,
            },
            retry_policy_counts: {
              ALERT_RETRY_TRANSPORT: 1,
            },
            runbook_ref_counts: {
              ALERT_RBK_04: 1,
            },
            latest_failed: {
              alert_outbox_id: "TAOV2__TEST",
              last_reason: "ALERT_DELIVERY_FAILED",
              last_reason_family: "TRANSPORT",
              retry_policy_code: "ALERT_RETRY_TRANSPORT",
              runbook_refs: ["ALERT_RBK_04"],
              last_attempt_at: "2026-04-20T00:00:00.000Z",
            },
          },
          selector_meta: {
            position_cycle_id: "PCY__TEST",
            alignment_checks: {
              policy_scope_match: true,
            },
          },
          openclaw_execution_separation_audits: [
            {
              ok: true,
              audit_id: "OCEXSEPAUDV2__TEST",
              fail_n: 0,
              failed_check_ids: [],
            },
          ],
          runtime_chain_audits: [
            {
              ok: true,
              check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
              fail_n: 0,
              check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
              passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
              failed_check_ids: [],
            },
          ],
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
        episodes: replay.episodes,
        shadowLivePairs: comparison.shadowLivePairs,
        sourceModePairs: comparison.sourceModePairs,
      }),
    });
    const replayFile = path.join(dir, "replay-fixtures.json");
    const comparisonFile = path.join(dir, "comparison-fixtures.json");
    const manifestFile = path.join(dir, "promotion-runtime-manifest.json");
    assert.ok(fs.existsSync(replayFile));
    assert.ok(fs.existsSync(comparisonFile));
    assert.ok(fs.existsSync(manifestFile));
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const replayPayload = JSON.parse(fs.readFileSync(replayFile, "utf8"));
    assert.strictEqual(replayPayload.replay_context.scope, "RUNTIME_CANDIDATE");
    assert.strictEqual(replayPayload.replay_context.require_transition_event_coverage, false);
    assert.strictEqual(manifest.source, "V2_PROMOTION_RUNTIME_SNAPSHOT");
    assert.strictEqual(manifest.counts.episode_n, replay.episodes.length);
    assert.strictEqual(manifest.counts.shadow_live_pair_n, 1);
    assert.strictEqual(manifest.counts.source_mode_pair_n, 1);
    assert.ok(manifest.snapshot_size_bytes > 0);
    assert.strictEqual(manifest.snapshot_meta.selector_meta.position_cycle_id, "PCY__TEST");
    assert.ok(manifest.snapshot_meta.lineage_contract);
    assert.strictEqual(manifest.snapshot_meta.selector_meta.lineage_contract.hash, manifest.snapshot_meta.lineage_contract.hash);
    assert.strictEqual(manifest.snapshot_meta.evidence_snapshot_summary.ok, true);
    assert.ok(manifest.snapshot_meta.evidence_snapshot_summary.transition_n > 0);
    assert.strictEqual(
      manifest.snapshot_meta.evidence_snapshot_summary.transition_evidence_n,
      manifest.snapshot_meta.evidence_snapshot_summary.transition_n
    );
    assert.strictEqual(manifest.snapshot_meta.evidence_snapshot_summary.missing_transition_evidence_n, 0);
    assert.ok(manifest.snapshot_meta.evidence_snapshot_summary.protection_runtime_n > 0);
    assert.strictEqual(
      manifest.snapshot_meta.evidence_snapshot_summary.protection_runtime_evidence_n,
      manifest.snapshot_meta.evidence_snapshot_summary.protection_runtime_n
    );
    assert.strictEqual(manifest.snapshot_meta.evidence_snapshot_summary.missing_protection_runtime_evidence_n, 0);
    assert.strictEqual(manifest.snapshot_meta.openclaw_execution_separation_summary.ok, true);
    assert.strictEqual(manifest.snapshot_meta.openclaw_execution_separation_summary.audit_n, 1);
    assert.strictEqual(manifest.snapshot_meta.openclaw_execution_separation_summary.fail_n, 0);
    assert.strictEqual(manifest.snapshot_meta.runtime_chain_audit_summary.ok, true);
    assert.strictEqual(manifest.snapshot_meta.runtime_chain_audit_summary.check_n, REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length);
    assert.strictEqual(manifest.snapshot_meta.runtime_chain_audit_summary.fail_n, 0);
    assert.deepStrictEqual(manifest.snapshot_meta.runtime_chain_audit_summary.passed_check_ids, REQUIRED_RUNTIME_CHAIN_CHECK_IDS);
    assert.strictEqual(manifest.snapshot_meta.repair_evidence_summary.ok, true);
    assert.strictEqual(manifest.snapshot_meta.repair_evidence_summary.repair_request_n, 0);
    assert.strictEqual(manifest.snapshot_meta.repair_evidence_summary.missing_completion_evidence_n, 0);
    assert.strictEqual(manifest.snapshot_meta.alert_retry_summary.failed_n, 1);
    assert.strictEqual(manifest.snapshot_meta.alert_retry_summary.latest_failed.retry_policy_code, "ALERT_RETRY_TRANSPORT");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function buildOpenClawExecutionSeparationSummaryCountsFailures() {
  const summary = exporter.__test.buildOpenClawExecutionSeparationSummary({
    openclaw_execution_separation_audits: [
      { ok: true, failed_check_ids: [] },
      { ok: false, failed_check_ids: ["SHADOW_DECISION_NEVER_ROUTES_ENTRY"] },
    ],
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.audit_n, 2);
  assert.strictEqual(summary.fail_n, 1);
  assert.deepStrictEqual(summary.failed_check_ids, ["SHADOW_DECISION_NEVER_ROUTES_ENTRY"]);
})();

(function buildRuntimeChainAuditSummaryCountsFailures() {
  const summary = exporter.__test.buildRuntimeChainAuditSummary({
    runtime_chain_audits: [
      {
        ok: true,
        check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
        fail_n: 0,
        check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
        passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
        failed_check_ids: [],
      },
      {
        ok: false,
        check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
        fail_n: 1,
        check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
        passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(0, -1),
        failed_check_ids: ["REPLAY_GATE_EPISODE_VALID"],
      },
    ],
  });
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.check_n, REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length * 2);
  assert.strictEqual(summary.fail_n, 1);
  assert.deepStrictEqual(summary.failed_check_ids, ["REPLAY_GATE_EPISODE_VALID"]);
  assert.deepStrictEqual(summary.check_ids, REQUIRED_RUNTIME_CHAIN_CHECK_IDS);
})();

(function buildEvidenceSnapshotSummaryCountsMissingCoverage() {
  const summary = exporter.__test.buildEvidenceSnapshotSummary([
    {
      transitions: [
        { source_exchange_evidence: { evidence_kind: "TP1_FILL" } },
        {},
      ],
      protectionRuntime: {
        last_exchange_evidence: null,
        last_evidence_observed_at: null,
      },
    },
  ]);
  assert.strictEqual(summary.ok, false);
  assert.strictEqual(summary.transition_n, 2);
  assert.strictEqual(summary.transition_evidence_n, 1);
  assert.strictEqual(summary.missing_transition_evidence_n, 1);
  assert.strictEqual(summary.protection_runtime_n, 1);
  assert.strictEqual(summary.protection_runtime_evidence_n, 0);
  assert.strictEqual(summary.missing_protection_runtime_evidence_n, 1);
})();

console.log("EXPORT_V2_PROMOTION_RUNTIME_SNAPSHOT_TEST_OK");
