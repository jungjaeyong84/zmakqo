"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cloudbuild = require("../../scripts/run-v2-promotion-cloudbuild");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function buildBoundedRuntimeSummaryFixture() {
  return {
    selector_query_budget: {
      query_limit: 25,
    },
    collector_query_budget: {
      limits: {
        transitionsLimit: 50,
      },
    },
    exporter_snapshot_size_bytes: 12345,
    manifest_counts: {
      episode_n: 1,
    },
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    evidence_snapshot_summary: {
      ok: true,
      transition_n: 3,
      transition_evidence_n: 3,
      missing_transition_evidence_n: 0,
      protection_runtime_n: 1,
      protection_runtime_evidence_n: 1,
      missing_protection_runtime_evidence_n: 0,
    },
    openclaw_execution_separation_summary: {
      ok: true,
      audit_n: 1,
      fail_n: 0,
      failed_check_ids: [],
    },
    runtime_chain_audit_summary: {
      ok: true,
      check_n: 18,
      fail_n: 0,
      failed_check_ids: [],
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
    openclaw_execution_audit_ledger_write: {
      ok: true,
      skipped: false,
      reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
      collection_key: "OPENCLAW_EXECUTION_AUDITS",
      doc_id: "OCEXSEPAUDV2__CLOUDBUILD",
    },
    repair_firestore_canary_streak: {
      ok: true,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
      healthy_run_n: 13,
      min_run_count: 12,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      blockers: [],
    },
    alert_retry_summary: {
      outbox_n: 3,
      failed_n: 1,
      sent_n: 2,
      pending_n: 0,
      retryable_failed_n: 1,
      terminal_failed_n: 0,
      family_counts: { TRANSPORT: 1 },
      retry_policy_counts: { ALERT_RETRY_TRANSPORT: 1 },
      runbook_ref_counts: { ALERT_RBK_04: 1 },
      latest_failed: {
        alert_outbox_id: "TAOV2__READ__01",
        last_reason: "ALERT_DELIVERY_FAILED",
        last_reason_family: "TRANSPORT",
        retry_policy_code: "ALERT_RETRY_TRANSPORT",
        runbook_refs: ["ALERT_RBK_04"],
        last_attempt_at: "2026-04-21T00:00:00.000Z",
      },
    },
  };
}

function buildPassingRepairFirestoreStreakFixture() {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
    healthy_run_n: 13,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    latest_age_minutes: 42,
    coverage_minutes: 1440,
    blockers: [],
  };
}

function buildEntryBoundaryAuditFixture() {
  return {
    ok: true,
    reason: "V2_ENTRY_BOUNDARY_AUDIT_PASS",
    scope: "src/v2",
    checked_file_n: 12,
    violation_n: 0,
    violations: [],
  };
}

function buildProductionCutoverAuditFixture() {
  return {
    ok: true,
    reason: "V2_PRODUCTION_CUTOVER_AUDIT_PASS",
    scope: "production_webhook_cutover",
    contract: {
      ok: true,
      reason: "V2_PRODUCTION_CUTOVER_CONTRACT_PASS",
      check_n: 4,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function buildFillSyncCanonicalBoundaryAuditFixture() {
  return {
    ok: true,
    reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS",
    scope: "binance_fills_sync_canonical_boundary",
    contract: {
      ok: true,
      reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_PASS",
      check_n: 14,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function buildSchedulerTrafficStateFixture() {
  return {
    scheduler_sot: "OPENCLAW_CRON",
    openclaw_cron_jobs: [
      { job_id: "binance_exit_integrity_cycle", enabled: true },
      { job_id: "openclaw_hourly_cycle", enabled: true },
      { job_id: "v2_repair_queue_service", enabled: true },
      { job_id: "openclaw_daily_cycle", enabled: true },
    ],
    legacy_scheduler_jobs: [
      { label: "com.jaeyong.donbeolja.tick", enabled: false, active: false, target: "/scheduler/tick" },
    ],
    cloud_run_services: [
      {
        name: "donbeolja",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
        },
      },
      {
        name: "donbeolja-exit-worker",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
        },
      },
    ],
  };
}

function seedRunbookArtifacts(dir, cycleId) {
  writeJson(path.join(dir, "promotion-preflight.json"), {
    ok: true,
    position_cycle_id: cycleId,
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
  });
  writeJson(path.join(dir, "promotion-canary-flow.json"), {
    ok: true,
    stage: "PIPELINE_PASS",
    position_cycle_id: cycleId,
  });
  writeJson(path.join(dir, "promotion-runtime-manifest.json"), {
    snapshot_meta: {
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    },
  });
  writeJson(path.join(dir, "unified-promotion-report.json"), {
    position_cycle_id: cycleId,
  });
  writeJson(path.join(dir, "promotion-deploy-decision.json"), {
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: cycleId,
    blockers: [],
    warnings: [],
    entry_boundary_audit: buildEntryBoundaryAuditFixture(),
    fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
    production_cutover_audit: buildProductionCutoverAuditFixture(),
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
  });
  writeJson(path.join(dir, "promotion-cloudbuild-context.json"), {
    lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
    final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
    recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
    recommended_next_action_reason: "deploy decision approved with no blocking families",
    deploy_decision_summary: {
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      blocker_summary: {
        blocker_n: 0,
      },
    },
  });
}

(function noFlagsMeansOff() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({});
  assert.strictEqual(plan.mode, "OFF");
  assert.strictEqual(plan.script, null);
})();

(function conflictingModesFailClosed() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_GATE_ENABLED: "1",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_MODE_CONFLICT:gate,pipeline");
})();

(function canaryFlowRequiresPositionCycleId() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_POSITION_CYCLE_ID_REQUIRED");
})();

(function canaryFlowAutoSelectAllowsExplicitArtifactDirWithoutPositionCycleId() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/canary_flow/auto-select",
  });
  assert.strictEqual(plan.mode, "CANARY_FLOW");
  assert.strictEqual(plan.positionCycleId, null);
  assert.strictEqual(plan.canaryAutoSelectEnabled, true);
  assert.strictEqual(plan.effectiveEnv.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.ok(plan.artifactDir.endsWith(path.join("tmp", "v2-promotion-artifacts", "canary_flow", "auto-select")));
})();

(function canaryFlowDerivesBoundedArtifactDir() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__TEST__01",
  });
  assert.strictEqual(plan.mode, "CANARY_FLOW");
  assert.strictEqual(plan.script, "run:v2-promotion-canary-flow");
  assert.strictEqual(plan.effectiveEnv.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.ok(plan.artifactDir.endsWith(path.join("tmp", "v2-promotion-artifacts", "canary_flow", "PCY__TEST__01")));
})();

(function explicitArtifactDirMustContainPositionCycleIdForBoundedModes() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__01",
      V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/live/wrong-cycle",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_POSITION_CYCLE_MISMATCH");
})();

(function boundedPipelineRequiresPositionCycleIdInCanaryLive() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/pipeline/PCY__X",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_BOUNDED_PIPELINE_POSITION_CYCLE_ID_REQUIRED");
})();

(function gateModeRequiresExplicitArtifactDir() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_GATE_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_REQUIRED");
})();

(function canaryFlowRequiresApprovedDeployDecision() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: "PCY__TEST__01",
  }, {
    approved: false,
    position_cycle_id: "PCY__TEST__01",
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_NOT_APPROVED"));
})();

(function autoSelectedCanaryFlowRequiresDeployDecisionPositionCycleId() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: null,
  }, {
    approved: true,
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_REQUIRED"));
})();

(function boundedPipelineRequiresMatchingPositionCycleIdInDeployDecision() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "PIPELINE",
    promotionMode: "LIVE",
    positionCycleId: "PCY__LIVE__01",
  }, {
    approved: true,
    position_cycle_id: "PCY__LIVE__02",
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_MISMATCH"));
})();

(function canaryFlowBlocksWhenDeployDecisionCarriesCandidateSelectionMismatch() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: "PCY__TEST__01",
  }, {
    approved: false,
    position_cycle_id: "PCY__TEST__01",
    blockers: [
      "DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH",
    ],
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_NOT_APPROVED"));
})();

(function deployDecisionSummaryCapturesBoundedAndCandidateContext() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: "PCY__READ__01",
    blockers: [],
    warnings: [],
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: {
      ok: true,
      selection_status: "READY",
      selected_position_cycle_id: "PCY__READ__01",
      recent_active_position_cycle_n: 1,
      selection_contract: {
        ok: true,
        scan_limit_respected: true,
        recent_window_enforced: true,
        selected_candidate_present: true,
        selected_preflight_ok: true,
        selected_cycle_matches_preflight: true,
        selected_cycle_matches_collector_env: true,
        selected_snapshot_counts_exact: true,
      },
    },
  });
  assert.strictEqual(summary.approved, true);
  assert.strictEqual(summary.lineage_contract_hash, "lineage-hash-fixture");
  assert.strictEqual(summary.bounded_runtime_summary.selector_query_budget.query_limit, 25);
  assert.strictEqual(summary.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
  assert.strictEqual(summary.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
  assert.strictEqual(summary.alert_retry_attention_required, true);
  assert.strictEqual(summary.alert_retry_summary.failed_n, 1);
  assert.strictEqual(summary.bounded_runtime_summary.alert_retry_summary.latest_failed.last_reason_family, "TRANSPORT");
  assert.strictEqual(summary.candidate_selection_summary.selected_position_cycle_id, "PCY__READ__01");
  assert.strictEqual(summary.candidate_selection_summary.selection_contract.ok, true);
  assert.strictEqual(summary.blocker_summary.blocker_n, 0);
})();

(function blockerSummaryFlagsKeyFailureFamilies() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__02",
    blockers: [
      "PROVENANCE:POSITION_CYCLE_ID_REQUIRED",
      "DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH",
      "REPLAY:WATCHDOG_FAIL:WATCHDOG_ISSUES_PRESENT:TERMINAL_PROJECTION_MISMATCH",
      "DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.blocker_n, 4);
  assert.strictEqual(summary.blocker_summary.top_blockers.length, 3);
  assert.strictEqual(summary.blocker_summary.has_provenance_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_watchdog_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_candidate_selection_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_bounded_runtime_blocker, true);
})();

(function statusLineSummarizesDecisionForOperators() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__03",
    blocker_n: 2,
    warning_n: 1,
    warning_summary: {
      top_warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
    },
    blocker_summary: {
      top_blockers: [
        "DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED",
        "PROVENANCE:POSITION_CYCLE_ID_REQUIRED",
      ],
    },
  });
  assert.ok(statusLine.includes("HOLD"));
  assert.ok(statusLine.includes("cycle=PCY__READ__03"));
  assert.ok(statusLine.includes("blockers=2"));
  assert.ok(statusLine.includes("warnings=1"));
  assert.ok(statusLine.includes("warn=DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  assert.ok(statusLine.includes("top=DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED|PROVENANCE:POSITION_CYCLE_ID_REQUIRED"));
})();

(function statusLineShowsAlertAttentionWithoutChangingApproval() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: "PCY__READ__04",
    blocker_n: 0,
    warning_n: 0,
    alert_retry_summary: {
      failed_n: 2,
      pending_n: 1,
    },
    blocker_summary: {
      top_blockers: [],
    },
  });
  assert.ok(statusLine.includes("APPROVE_DEPLOY"));
  assert.ok(statusLine.includes("alert_failed=2"));
  assert.ok(statusLine.includes("alert_pending=1"));
})();

(function recommendedNextActionFollowsBlockerFamily() {
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: true,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: false,
      },
    }),
    "PROCEED_WITH_SUBMIT_WRAPPER"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: true,
      },
    }),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: true,
      },
    }),
    "RECHECK_SELECTED_POSITION_CYCLE_AND_RERUN_CANARY_FLOW"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: true,
      },
    }),
    "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: true,
      },
    }),
    "HOLD_PROMOTION_AND_REVIEW_REPLAY_WATCHDOG_EVIDENCE"
  );
})();

(function recommendedNextActionReasonExplainsWhy() {
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReason({
      approved: true,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: false,
      },
    }),
    "deploy decision approved with no blocking families"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReason({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: true,
      },
    }),
    "provenance blocker detected; bounded artifact lineage is not trustworthy"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: true,
        has_watchdog_blocker: false,
      },
    }),
    "BOUNDED_RUNTIME_BLOCKER"
  );
})();

(function contextSubmitTraceFlagsBrokenChecksAndRunbookNumbers() {
  const trace = cloudbuild.__test.buildContextSubmitTrace({
    approved: false,
    lineage_contract_hash: null,
    blocker_summary: {
      blocker_n: 2,
      has_provenance_blocker: false,
      has_candidate_selection_blocker: false,
      has_bounded_runtime_blocker: true,
      has_watchdog_blocker: false,
    },
  });
  assert.deepStrictEqual(trace.relevant_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
  assert.deepStrictEqual(trace.relevant_runbook_checklist, ["11", "13", "16", "17"]);
  assert.deepStrictEqual(trace.failed_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
  assert.deepStrictEqual(trace.failed_runbook_checklist, ["11", "13", "16", "17"]);
  assert.deepStrictEqual(trace.blocker_families, ["BOUNDED_RUNTIME"]);
  assert.strictEqual(trace.primary_blocker_family, "BOUNDED_RUNTIME");
})();

(function shadowPipelineDoesNotRequireDeployApproval() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "PIPELINE",
    promotionMode: "SHADOW",
    positionCycleId: null,
  }, null);
  assert.strictEqual(approval.required, false);
  assert.deepStrictEqual(approval.blockers, []);
})();

(function deployDecisionArtifactCanBeReadFromArtifactDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-"));
  try {
    fs.writeFileSync(path.join(dir, cloudbuild.__test.DEPLOY_DECISION_FILENAME), JSON.stringify({
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: "PCY__READ__01",
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        ok: true,
        selection_status: "READY",
        selected_position_cycle_id: "PCY__READ__01",
        selection_contract: {
          ok: true,
          scan_limit_respected: true,
          recent_window_enforced: true,
          selected_candidate_present: true,
          selected_preflight_ok: true,
          selected_cycle_matches_preflight: true,
          selected_cycle_matches_collector_env: true,
          selected_snapshot_counts_exact: true,
        },
      },
    }, null, 2), "utf8");
    const decision = cloudbuild.__test.readDeployDecisionArtifact(dir);
    assert.strictEqual(decision.approved, true);
    assert.strictEqual(decision.position_cycle_id, "PCY__READ__01");
    const summary = cloudbuild.__test.buildDeployDecisionSummary(decision);
    assert.strictEqual(summary.lineage_contract_hash, "lineage-hash-fixture");
    assert.strictEqual(summary.bounded_runtime_summary.exporter_snapshot_size_bytes, 12345);
    assert.strictEqual(summary.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
    assert.strictEqual(summary.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(summary.bounded_runtime_summary.repair_evidence_summary.ok, true);
    assert.strictEqual(summary.bounded_runtime_summary.openclaw_execution_audit_ledger_write.reason, "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN");
    assert.strictEqual(summary.bounded_runtime_summary.repair_firestore_canary_streak.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS");
    assert.strictEqual(summary.candidate_selection_summary.selection_contract.ok, true);
    assert.strictEqual(summary.blocker_summary.blocker_n, 0);
    const statusLine = cloudbuild.__test.buildStatusLine(summary);
    assert.ok(statusLine.includes("APPROVE_DEPLOY"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactWritesFinalStatusLine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-"));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: "PCY__CTX__01",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__01",
        blockers: [],
        warnings: [],
      },
    });
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(payload.final_status_line.includes("APPROVE_DEPLOY"));
    assert.strictEqual(payload.lineage_contract_hash, null);
    assert.strictEqual(payload.requested_artifact_dir, dir);
    assert.strictEqual(payload.resolved_artifact_dir, dir);
    assert.strictEqual(payload.deploy_decision_summary.blocker_summary.blocker_n, 0);
    assert.strictEqual(payload.recommended_next_action, "PROCEED_WITH_SUBMIT_WRAPPER");
    assert.strictEqual(payload.recommended_next_action_reason, "deploy decision approved with no blocking families");
    assert.strictEqual(payload.recommended_next_action_reason_code, "APPROVED_NO_BLOCKING_FAMILIES");
    assert.deepStrictEqual(payload.submit_trace.relevant_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
    assert.deepStrictEqual(payload.submit_trace.relevant_runbook_checklist, ["11", "13", "16", "17"]);
    assert.deepStrictEqual(payload.submit_trace.failed_submit_check_ids, ["SUBMIT_CHK_08"]);
    assert.deepStrictEqual(payload.submit_trace.failed_runbook_checklist, ["16", "17"]);
    assert.strictEqual(payload.submit_trace.primary_blocker_family, "PROVENANCE");
    assert.strictEqual(payload.submit_trace.recommended_next_action_reason_code, "APPROVED_NO_BLOCKING_FAMILIES");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactCanExposeRequestedAndResolvedDirs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-finalized-"));
  const finalDir = path.join(dir, "PCY__CTX__FINAL");
  try {
    fs.mkdirSync(finalDir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: finalDir,
      positionCycleId: "PCY__CTX__FINAL",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      requestedArtifactDir: dir,
      resolvedArtifactDir: finalDir,
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__FINAL",
        blockers: [],
        warnings: [],
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.lineage_contract_hash, null);
    assert.strictEqual(payload.requested_artifact_dir, dir);
    assert.strictEqual(payload.resolved_artifact_dir, finalDir);
    assert.strictEqual(payload.artifact_dir, finalDir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactSurfacesLineageHashWhenPresent() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-lineage-"));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: "PCY__CTX__LINEAGE",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__LINEAGE",
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.lineage_contract_hash, "lineage-hash-fixture");
    assert.strictEqual(payload.deploy_decision_summary.lineage_contract_hash, "lineage-hash-fixture");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function boundedDeployPathRunsRunbookReview() {
  const cycleId = "PCY__RUNBOOK__01";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    seedRunbookArtifacts(dir, cycleId);
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {
        V2_PROMOTION_ARTIFACT_DIR: dir,
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
      },
    };
    const deployApproval = {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    };
    const result = cloudbuild.__test.runCanaryRunbookReview(plan, deployApproval);
    assert.strictEqual(result.required, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.reason, "RUNBOOK_REVIEW_PASS");
    assert.ok(result.review);
    assert.strictEqual(result.review.ok, true);
    assert.ok(fs.existsSync(result.output_file));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveDeployPathGeneratesCutoverReadinessBeforeRunbookReview() {
  const cycleId = "PCY__RUNBOOK__LIVE_CUTOVER";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    seedRunbookArtifacts(dir, cycleId);
    writeJson(path.join(dir, "promotion-deploy-decision.json"), {
      mode: "LIVE",
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(
      path.join(dir, "v2_repair_queue_firestore_canary_streak_latest.json"),
      buildPassingRepairFirestoreStreakFixture()
    );
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {
        V2_PROMOTION_ARTIFACT_DIR: dir,
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
        DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR: dir,
        DONBEOLJA_V2_ENABLED: "1",
        DONBEOLJA_V2_DRY_RUN: "0",
        DONBEOLJA_V2_CANARY_ONLY: "0",
        DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
        DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(buildSchedulerTrafficStateFixture()),
      },
    };
    const deployApproval = {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    };
    const cutover = cloudbuild.__test.generateLiveCutoverReadiness(plan, deployApproval);
    assert.strictEqual(cutover.required, true);
    assert.strictEqual(cutover.reason, "LIVE_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(cutover.output_file));
    const contextFile = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(context.live_cutover_readiness_file, cutover.output_file);
    assert.strictEqual(context.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.live_cutover_readiness_summary.auto_apply, false);
    assert.strictEqual(context.live_cutover_readiness_summary.mutates_environment, false);
    assert.strictEqual(context.live_cutover_readiness_summary.required_env_change_n, 4);

    const productionCutover = cloudbuild.__test.generateProductionCutoverReadiness(plan, deployApproval);
    assert.strictEqual(productionCutover.required, true);
    assert.strictEqual(productionCutover.reason, "PRODUCTION_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(productionCutover.output_file));
    const contextFileWithProduction = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
    });
    const contextWithProduction = JSON.parse(fs.readFileSync(contextFileWithProduction, "utf8"));
    assert.strictEqual(contextWithProduction.production_cutover_readiness_file, productionCutover.output_file);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.legacy_webhook_blocked, true);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.guard_reason, "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED");

    const schedulerTrafficCutover = cloudbuild.__test.generateSchedulerTrafficCutoverReadiness(plan, deployApproval);
    assert.strictEqual(schedulerTrafficCutover.required, true);
    assert.strictEqual(schedulerTrafficCutover.reason, "SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(schedulerTrafficCutover.output_file));
    const contextFileWithSchedulerTraffic = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
      schedulerTrafficCutoverReadiness: schedulerTrafficCutover.report,
      schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover.output_file,
    });
    const contextWithSchedulerTraffic = JSON.parse(fs.readFileSync(contextFileWithSchedulerTraffic, "utf8"));
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_file, schedulerTrafficCutover.output_file);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.scheduler_sot, "OPENCLAW_CRON");

    const result = cloudbuild.__test.runCanaryRunbookReview(plan, deployApproval);
    assert.strictEqual(result.review.ok, true);
    const cutoverCheck = result.review.checks.find((row) => row.id === "CHK_20");
    assert.ok(cutoverCheck);
    assert.strictEqual(cutoverCheck.status, "PASS");
    const productionCutoverCheck = result.review.checks.find((row) => row.id === "CHK_23");
    assert.ok(productionCutoverCheck);
    assert.strictEqual(productionCutoverCheck.status, "PASS");
    const schedulerTrafficCutoverCheck = result.review.checks.find((row) => row.id === "CHK_24");
    assert.ok(schedulerTrafficCutoverCheck);
    assert.strictEqual(schedulerTrafficCutoverCheck.status, "PASS");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function schedulerTrafficPreflightFailureContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__LIVE_PREFLIGHT_FAIL";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {},
    };
    const preflightFile = path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const failedPreflight = {
      ok: false,
      reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED",
      fail_n: 1,
      failed_check_ids: ["SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST"],
      project_id: "donbeolja-dev",
      region: "asia-northeast3",
      service_names: ["donbeolja", "donbeolja-exit-worker"],
      scheduler_job_n: null,
    };
    writeJson(preflightFile, failedPreflight);
    const schedulerTrafficError = new Error("V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED");
    schedulerTrafficError.scheduler_traffic_collector_preflight = failedPreflight;
    schedulerTrafficError.scheduler_traffic_collector_preflight_file = preflightFile;
    const contextFile = cloudbuild.__test.writeSchedulerTrafficFailureContext(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutover: {
        report: {
          ok: true,
          reason: "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT",
          auto_apply: false,
          mutates_environment: false,
          required_env_changes: [],
          blockers: [],
        },
        output_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
      },
      productionCutover: {
        report: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          fail_n: 0,
          failed_check_ids: [],
          guard: {
            allowed: false,
            reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
            context: {
              v2_enabled: true,
              v2_dry_run: false,
              v2_canary_only: false,
              require_production_cutover: true,
              block_legacy_webhook_signal: true,
              allow_legacy_webhook_signal: false,
            },
          },
        },
        output_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
      },
      schedulerTrafficError,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isSchedulerTrafficReadinessError(schedulerTrafficError), true);
    assert.strictEqual(context.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_file, preflightFile);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.ok, false);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.reason, "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED");
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.blocker_n, 1);
    assert.deepStrictEqual(
      context.scheduler_traffic_collector_preflight_summary.failed_check_ids,
      ["SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST"]
    );
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.project_id, "donbeolja-dev");
    assert.strictEqual(context.scheduler_traffic_cutover_readiness_summary, null);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveAndProductionReadinessFailureContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__LIVE_READINESS_FAIL";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {},
    };
    const deployDecision = {
      mode: "LIVE",
      approved: true,
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const liveFile = path.join(dir, "v2_repair_live_cutover_readiness_latest.json");
    const liveError = new Error("V2_PROMOTION_CLOUDBUILD_LIVE_CUTOVER_READINESS_BLOCKED");
    liveError.live_cutover_readiness = {
      ok: false,
      reason: "V2_REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY",
      auto_apply: false,
      mutates_environment: false,
      required_env_changes: [],
      blockers: ["REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
      submit_check_ids: ["SUBMIT_CHK_12"],
      runbook_checklist: ["20"],
    };
    liveError.live_cutover_readiness_file = liveFile;
    const liveContextFile = cloudbuild.__test.writePromotionReadinessFailureContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutoverError: liveError,
    });
    const liveContext = JSON.parse(fs.readFileSync(liveContextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isLiveCutoverReadinessError(liveError), true);
    assert.strictEqual(liveContext.live_cutover_readiness_file, liveFile);
    assert.strictEqual(liveContext.live_cutover_readiness_summary.ok, false);
    assert.strictEqual(liveContext.live_cutover_readiness_summary.reason, "V2_REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY");
    assert.strictEqual(liveContext.live_cutover_readiness_summary.blocker_n, 1);
    assert.deepStrictEqual(liveContext.live_cutover_readiness_summary.submit_check_ids, ["SUBMIT_CHK_12"]);

    const productionFile = path.join(dir, "v2_production_cutover_readiness_latest.json");
    const productionError = new Error("V2_PROMOTION_CLOUDBUILD_PRODUCTION_CUTOVER_READINESS_BLOCKED");
    productionError.production_cutover_readiness = {
      ok: false,
      reason: "V2_PRODUCTION_CUTOVER_READINESS_BLOCKED",
      fail_n: 1,
      failed_check_ids: ["PROD_CUTOVER_READINESS_03_LEGACY_WEBHOOK_BLOCKED"],
      guard: {
        allowed: true,
        reason: "V2_LEGACY_WEBHOOK_SIGNAL_ALLOWED",
        context: {
          v2_enabled: true,
          v2_dry_run: false,
          v2_canary_only: false,
          require_production_cutover: true,
          block_legacy_webhook_signal: false,
          allow_legacy_webhook_signal: true,
        },
      },
    };
    productionError.production_cutover_readiness_file = productionFile;
    const productionContextFile = cloudbuild.__test.writePromotionReadinessFailureContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutover: {
        report: liveError.live_cutover_readiness,
        output_file: liveFile,
      },
      productionCutoverError: productionError,
    });
    const productionContext = JSON.parse(fs.readFileSync(productionContextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isProductionCutoverReadinessError(productionError), true);
    assert.strictEqual(productionContext.live_cutover_readiness_summary.ok, false);
    assert.strictEqual(productionContext.production_cutover_readiness_file, productionFile);
    assert.strictEqual(productionContext.production_cutover_readiness_summary.ok, false);
    assert.strictEqual(productionContext.production_cutover_readiness_summary.legacy_webhook_blocked, false);
    assert.deepStrictEqual(
      productionContext.production_cutover_readiness_summary.failed_check_ids,
      ["PROD_CUTOVER_READINESS_03_LEGACY_WEBHOOK_BLOCKED"]
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function runbookReviewContextPreservesPassAndFailureCause() {
  const cycleId = "PCY__RUNBOOK__REVIEW_CONTEXT";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {},
    };
    const deployDecision = {
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const passReviewFile = path.join(dir, "promotion-runbook-review.json");
    const passReview = {
      ok: true,
      overall_status: "PASS",
      expected_position_cycle_id: cycleId,
      check_n: 2,
      pass_n: 2,
      fail_n: 0,
      skip_n: 0,
      checks: [
        { id: "CHK_01", status: "PASS", label: "cycle", reason: "ok" },
        { id: "CHK_02", status: "PASS", label: "artifact", reason: "ok" },
      ],
    };
    const passContextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: passReview,
      runbookReviewFile: passReviewFile,
    });
    const passContext = JSON.parse(fs.readFileSync(passContextFile, "utf8"));
    assert.strictEqual(passContext.runbook_review_file, passReviewFile);
    assert.strictEqual(passContext.runbook_review_summary.ok, true);
    assert.strictEqual(passContext.runbook_review_summary.overall_status, "PASS");
    assert.deepStrictEqual(passContext.runbook_review_summary.failed_check_ids, []);

    const failReviewFile = path.join(dir, "promotion-runbook-review-fail.json");
    const failReview = {
      ok: false,
      overall_status: "FAIL",
      expected_position_cycle_id: cycleId,
      check_n: 3,
      pass_n: 2,
      fail_n: 1,
      skip_n: 0,
      checks: [
        { id: "CHK_01", status: "PASS", label: "cycle", reason: "ok" },
        {
          id: "CHK_17",
          status: "FAIL",
          label: "cloudbuild context lineage hash matches deploy decision",
          reason: "cloudbuild context lineage hash is missing or mismatched",
          file: path.join(dir, "promotion-cloudbuild-context.json"),
          field: "lineage_contract_hash",
        },
        { id: "CHK_21", status: "PASS", label: "entry boundary", reason: "ok" },
      ],
    };
    const failContextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: failReview,
      runbookReviewFile: failReviewFile,
    });
    const failContext = JSON.parse(fs.readFileSync(failContextFile, "utf8"));
    assert.strictEqual(failContext.runbook_review_file, failReviewFile);
    assert.strictEqual(failContext.runbook_review_summary.ok, false);
    assert.strictEqual(failContext.runbook_review_summary.fail_n, 1);
    assert.deepStrictEqual(failContext.runbook_review_summary.failed_check_ids, ["CHK_17"]);
    assert.strictEqual(failContext.runbook_review_summary.top_failed_checks[0].field, "lineage_contract_hash");
    assert.strictEqual(failContext.runbook_review_summary.expected_position_cycle_id, cycleId);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function thrownRunbookReviewContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__THROWN_CONTEXT";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {},
    };
    const deployDecision = {
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const cause = new Error("V2_CANARY_RUNBOOK_ARTIFACT_REQUIRED:promotion-runtime-manifest.json");
    const thrownReview = cloudbuild.__test.buildThrownRunbookReview({
      plan,
      expectedPositionCycleId: cycleId,
      cause,
    });
    const contextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: thrownReview,
      runbookReviewFile: null,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(context.runbook_review_file, null);
    assert.strictEqual(context.runbook_review_summary.ok, false);
    assert.strictEqual(context.runbook_review_summary.fail_n, 1);
    assert.deepStrictEqual(context.runbook_review_summary.failed_check_ids, ["CHK_RUNBOOK_REVIEW_THROWN"]);
    assert.strictEqual(
      context.runbook_review_summary.top_failed_checks[0].reason,
      "V2_CANARY_RUNBOOK_ARTIFACT_REQUIRED:promotion-runtime-manifest.json"
    );
    assert.strictEqual(context.runbook_review_summary.top_failed_checks[0].field, "promotion-runbook-review");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function autoSelectPathSkipsRunbookReview() {
  const result = cloudbuild.__test.runCanaryRunbookReview({
    mode: "CANARY_FLOW",
    artifactDir: "/tmp/auto-select",
    positionCycleId: null,
    promotionMode: "CANARY",
    effectiveEnv: {},
  }, {
    required: true,
    approved: true,
    decision: {
      approved: true,
      position_cycle_id: "PCY__AUTO__01",
    },
  });
  assert.strictEqual(result.required, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "RUNBOOK_REVIEW_SKIPPED_UNBOUNDED_OR_NOT_APPROVED");
})();

(function autoSelectFinalizedPathRunsRunbookReview() {
  const cycleId = "PCY__AUTO_FINAL__01";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-auto-final-"));
  const finalDir = path.join(dir, cycleId);
  try {
    fs.mkdirSync(finalDir, { recursive: true });
    seedRunbookArtifacts(finalDir, cycleId);
    const result = cloudbuild.__test.runCanaryRunbookReview({
      mode: "CANARY_FLOW",
      artifactDir: finalDir,
      positionCycleId: null,
      promotionMode: "CANARY",
      effectiveEnv: {},
    }, {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    });
    assert.strictEqual(result.required, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.review.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function canReadCanaryFlowArtifactFromRequestedDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-flow-artifact-"));
  try {
    fs.writeFileSync(path.join(dir, cloudbuild.__test.CANARY_FLOW_FILENAME), JSON.stringify({
      ok: true,
      artifact_dir: path.join(dir, "PCY__FLOW__01"),
      position_cycle_id: "PCY__FLOW__01",
    }, null, 2), "utf8");
    const flowArtifact = cloudbuild.__test.readCanaryFlowArtifact(dir);
    assert.strictEqual(flowArtifact.position_cycle_id, "PCY__FLOW__01");
    assert.ok(flowArtifact.artifact_dir.endsWith(path.join(path.basename(dir), "PCY__FLOW__01")) || flowArtifact.artifact_dir.endsWith(path.join("PCY__FLOW__01")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("RUN_V2_PROMOTION_CLOUDBUILD_TEST_OK");
