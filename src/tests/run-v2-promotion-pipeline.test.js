"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const pipeline = require("../../scripts/run-v2-promotion-pipeline");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");
const { buildReferencePassEpisode, buildReferenceNativeMlEvidencePack } = require("../v2/replayFixtureFactory");
const { buildWebhookBundle } = require("../v2/comparisonFixtureFactory");

const PREFIX = "donbeolja_v2__";
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;

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

function buildHealthyProductionRouteCanaryPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS",
    scope: "production_entry_route_canary",
    canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
    exchange_write_performed: false,
    route_called: true,
    kernel_called: true,
    persist_called: true,
    generated_at: generatedAt,
    fail_n: 0,
    check_ids: [
      "V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_APPROVED",
      "V2_PRODUCTION_ROUTE_CANARY_ENTRY_SIZING_QTY_MATCHES_FILL",
    ],
    failed_check_ids: [],
    route_result_summary: {
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
      position_cycle_id: "PCYV2__ETHUSDT__ENTRY__CANARY",
      entry_event_id: "ENTRY__V2_PRODUCTION_ROUTE_CANARY",
      protection_runtime_id: "PCYV2__ETHUSDT__ENTRY__CANARY__PROTECTION_RUNTIME__CANARY",
      audit_ledger_reason: "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED",
      entry_sizing_decision: {
        ok: true,
        status: "APPROVED",
        entry_qty_abs: 0.8,
      },
    },
  };
}

function buildHealthyExitRuntimeCanaryPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_EXIT_RUNTIME_CANARY_PASS",
    scope: "exit_runtime_canary",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
    exchange_write_performed: false,
    generated_at: generatedAt,
    active_position_n: 2,
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    fail_n: 0,
    failed_check_ids: [],
  };
}

function buildHealthyRepairFirestoreCanaryPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY",
    canary_mode: "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION",
    generated_at: generatedAt,
    firestore_write_performed: true,
    exchange_write_performed: false,
    service_status: "HEALTHY",
    selected_issue_code: "TRAIL_STOP_MISSING",
    summary: {
      requested_repair_n: 1,
      delegated_repair_n: 1,
      completion_success_n: 1,
      completion_failed_n: 0,
    },
  };
}

function writeRepairFirestoreCanaryHistory(filePath, nowMs) {
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyRepairFirestoreCanaryPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function buildProductionRouteCanaryHistoryDb(rows) {
  return {
    collection() {
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  return {
                    docs: rows
                      .map((payload) => ({
                        production_entry_route_canary_id: `PERCHV2__${payload.generated_at}`,
                        generated_at_ms: Date.parse(payload.generated_at),
                        artifact_snapshot: payload,
                      }))
                      .filter((doc) => op === ">=" && Number(doc[field]) >= Number(value))
                      .slice(0, limit)
                      .map((doc) => ({ data: () => ({ ...doc }) })),
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

function buildExitRuntimeCanaryHistoryDb(rows) {
  return {
    collection() {
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  return {
                    docs: rows
                      .map((payload) => ({
                        exit_runtime_canary_id: `ERTCHV2__${payload.generated_at}`,
                        generated_at_ms: Date.parse(payload.generated_at),
                        artifact_snapshot: payload,
                      }))
                      .filter((doc) => op === ">=" && Number(doc[field]) >= Number(value))
                      .slice(0, limit)
                      .map((doc) => ({ data: () => ({ ...doc }) })),
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
              check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
              fail_n: 0,
              check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
              passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
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
    assert.ok(fs.existsSync(path.join(dir, "v2_production_entry_protected_canary_latest.json")));
    assert.strictEqual(result.deployDecision.approved, true);
    assert.strictEqual(result.productionEntryProtectedCanaryStatus, "PRODUCTION_ENTRY_PROTECTED_CANARY_REFRESH_PASS");
    assert.strictEqual(result.productionEntryProtectedCanary.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS");
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(storedDecision.bounded_runtime_summary.exporter_snapshot_size_bytes > 0, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.openclaw_execution_separation_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.runtime_chain_audit_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_evidence_summary.ok, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS");
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.artifact_file, path.join(dir, "v2_production_entry_protected_canary_latest.json"));
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.artifact_dir, dir);
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.artifact_filename, "v2_production_entry_protected_canary_latest.json");
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.artifact_current_dir_match, true);
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_protected_canary.exchange_write_performed, false);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function canaryPipelineRefreshesRepairFirestoreCanaryStreakBeforeDeployDecision() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-repair-streak-"));
  const historyFile = path.join(dir, "repair-history.jsonl");
  const externalStreakFile = path.join(os.tmpdir(), `dbj-v2-external-repair-streak-${Date.now()}.json`);
  writeRepairFirestoreCanaryHistory(historyFile, Date.now());
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_NATIVE_PASS",
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
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
            position_cycle_id: "PCY__REPAIR_STREAK__TEST",
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
              audit_id: "OCEXSEPAUDV2__PIPELINE_REPAIR_STREAK",
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
          openclaw_execution_audit_ledger_write: {
            ok: true,
            skipped: false,
            reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
            collection_key: "OPENCLAW_EXECUTION_AUDITS",
            doc_id: "OCEXSEPAUDV2__PIPELINE_REPAIR_STREAK",
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
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE: historyFile,
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE: externalStreakFile,
    });
    const streakFile = path.join(dir, "v2_repair_queue_firestore_canary_streak_latest.json");
    assert.ok(fs.existsSync(streakFile));
    assert.strictEqual(fs.existsSync(externalStreakFile), false);
    assert.strictEqual(result.repairFirestoreCanaryStreakStatus, "REPAIR_FIRESTORE_CANARY_STREAK_REFRESH_PASS");
    assert.strictEqual(result.repairFirestoreCanaryStreak.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS");
    const storedReport = JSON.parse(fs.readFileSync(path.join(dir, "unified-promotion-report.json"), "utf8"));
    assert.strictEqual(
      storedReport.bounded_runtime_summary.repair_firestore_canary_streak.reason,
      "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS"
    );
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(
      storedDecision.bounded_runtime_summary.repair_firestore_canary_streak.reason,
      "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS"
    );
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_firestore_canary_streak.artifact_file, streakFile);
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_firestore_canary_streak.artifact_dir, dir);
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_firestore_canary_streak.artifact_filename, "v2_repair_queue_firestore_canary_streak_latest.json");
    assert.strictEqual(storedDecision.bounded_runtime_summary.repair_firestore_canary_streak.artifact_current_dir_match, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(externalStreakFile, { force: true }); } catch (_) {}
  }
})();

(async function canaryPipelineRefreshesProductionRouteCanaryStreakBeforeDeployDecision() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-prod-route-streak-"));
  const externalStreakFile = path.join(os.tmpdir(), `dbj-v2-external-production-route-streak-${Date.now()}.json`);
  const nowMs = Date.now();
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyProductionRouteCanaryPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_NATIVE_PASS",
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
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
            position_cycle_id: "PCY__PROD_ROUTE_STREAK__TEST",
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
              audit_id: "OCEXSEPAUDV2__PIPELINE_PROD_ROUTE_STREAK",
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
          openclaw_execution_audit_ledger_write: {
            ok: true,
            skipped: false,
            reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
            collection_key: "OPENCLAW_EXECUTION_AUDITS",
            doc_id: "OCEXSEPAUDV2__PIPELINE_PROD_ROUTE_STREAK",
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
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE: externalStreakFile,
    }, {
      collectorDb: buildProductionRouteCanaryHistoryDb(rows),
    });
    const streakFile = path.join(dir, "v2_production_entry_route_canary_streak_latest.json");
    assert.ok(fs.existsSync(streakFile));
    assert.strictEqual(fs.existsSync(externalStreakFile), false);
    assert.strictEqual(result.productionEntryRouteCanaryStreakStatus, "PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REFRESH_PASS");
    assert.strictEqual(result.productionEntryRouteCanaryStreak.history_source, "FIRESTORE");
    assert.strictEqual(result.productionEntryRouteCanaryStreak.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS");
    const storedReport = JSON.parse(fs.readFileSync(path.join(dir, "unified-promotion-report.json"), "utf8"));
    assert.strictEqual(
      storedReport.bounded_runtime_summary.production_entry_route_canary_streak.reason,
      "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"
    );
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(
      storedDecision.bounded_runtime_summary.production_entry_route_canary_streak.reason,
      "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"
    );
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_route_canary_streak.artifact_file, streakFile);
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_route_canary_streak.artifact_dir, dir);
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_route_canary_streak.artifact_filename, "v2_production_entry_route_canary_streak_latest.json");
    assert.strictEqual(storedDecision.bounded_runtime_summary.production_entry_route_canary_streak.artifact_current_dir_match, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(externalStreakFile, { force: true }); } catch (_) {}
  }
})();

(async function canaryPipelineRefreshesExitRuntimeCanaryStreakBeforeDeployDecision() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-pipeline-exit-runtime-streak-"));
  const externalStreakFile = path.join(os.tmpdir(), `dbj-v2-external-exit-runtime-streak-${Date.now()}.json`);
  const nowMs = Date.now();
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyExitRuntimeCanaryPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  try {
    const result = await pipeline.runPipeline({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_NATIVE_PASS",
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
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
            position_cycle_id: "PCY__EXIT_RUNTIME_STREAK__TEST",
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
              audit_id: "OCEXSEPAUDV2__PIPELINE_EXIT_RUNTIME_STREAK",
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
          openclaw_execution_audit_ledger_write: {
            ok: true,
            skipped: false,
            reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
            collection_key: "OPENCLAW_EXECUTION_AUDITS",
            doc_id: "OCEXSEPAUDV2__PIPELINE_EXIT_RUNTIME_STREAK",
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
      DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
      DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
      DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_FILE: externalStreakFile,
    }, {
      collectorDb: buildExitRuntimeCanaryHistoryDb(rows),
    });
    const streakFile = path.join(dir, "v2_exit_runtime_canary_streak_latest.json");
    assert.ok(fs.existsSync(streakFile));
    assert.strictEqual(fs.existsSync(externalStreakFile), false);
    assert.strictEqual(result.exitRuntimeCanaryStreakStatus, "EXIT_RUNTIME_CANARY_STREAK_REFRESH_PASS");
    assert.strictEqual(result.exitRuntimeCanaryStreak.history_source, "FIRESTORE");
    assert.strictEqual(result.exitRuntimeCanaryStreak.reason, "V2_EXIT_RUNTIME_CANARY_STREAK_PASS");
    const storedReport = JSON.parse(fs.readFileSync(path.join(dir, "unified-promotion-report.json"), "utf8"));
    assert.strictEqual(
      storedReport.bounded_runtime_summary.exit_runtime_canary_streak.reason,
      "V2_EXIT_RUNTIME_CANARY_STREAK_PASS"
    );
    const storedDecision = JSON.parse(fs.readFileSync(path.join(dir, "promotion-deploy-decision.json"), "utf8"));
    assert.strictEqual(
      storedDecision.bounded_runtime_summary.exit_runtime_canary_streak.reason,
      "V2_EXIT_RUNTIME_CANARY_STREAK_PASS"
    );
    assert.strictEqual(storedDecision.bounded_runtime_summary.exit_runtime_canary_streak.artifact_file, streakFile);
    assert.strictEqual(storedDecision.bounded_runtime_summary.exit_runtime_canary_streak.artifact_dir, dir);
    assert.strictEqual(storedDecision.bounded_runtime_summary.exit_runtime_canary_streak.artifact_filename, "v2_exit_runtime_canary_streak_latest.json");
    assert.strictEqual(storedDecision.bounded_runtime_summary.exit_runtime_canary_streak.artifact_current_dir_match, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(externalStreakFile, { force: true }); } catch (_) {}
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
        ...episode.protectionRuntime,
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
        ...episode.protectionRuntime,
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
        ...episode.protectionRuntime,
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
