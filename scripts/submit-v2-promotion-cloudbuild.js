#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const cloudbuildRuntime = require("./run-v2-promotion-cloudbuild");
const submitContractCheck = require("./check-v2-promotion-submit-contract");
const deployDecisionCheck = require("./check-v2-promotion-deploy-decision");
const runbookCheck = require("./check-v2-canary-runbook");
const operatorAlertPreview = require("./lib/v2-promotion-submit-operator-alert");
const operatorSummary = require("./lib/v2-promotion-operator-summary");
const submitTrace = require("./lib/v2-promotion-submit-trace");

const OUTPUT_FILENAME = "promotion-cloudbuild-submit-request.json";
const OPERATOR_ALERT_SEND_SCRIPT = path.resolve(__dirname, "send-v2-promotion-submit-operator-alert.js");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function isEnabled(value) {
  return String(value || "0").trim() === "1";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function readOptionalArtifact(artifactDir, filename) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return null;
  return Object.freeze({
    filePath,
    payload: readJsonFile(filePath),
  });
}

function buildVerificationCheck({ id, label, ok, reason, file = null, field = null }) {
  return Object.freeze({
    id,
    label,
    ok: ok === true,
    reason: trimOrNull(reason),
    file: trimOrNull(file),
    field: trimOrNull(field),
  });
}

function buildDocRefs({ runbookChecklist = [], artifactContract = [] } = {}) {
  return Object.freeze({
    runbook_checklist: Object.freeze(
      (Array.isArray(runbookChecklist) ? runbookChecklist : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    artifact_contract: Object.freeze(
      (Array.isArray(artifactContract) ? artifactContract : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
  });
}

function withDocRefs(check, refs) {
  return Object.freeze({
    ...check,
    doc_refs: buildDocRefs(refs),
  });
}

function buildVerificationSummary(checks) {
  const rows = Array.isArray(checks) ? checks : [];
  const failed = rows.filter((row) => row && row.ok !== true);
  const ids = failed.map((row) => trimOrNull(row.id)).filter(Boolean);
  const topFailures = failed
    .map((row) => trimOrNull(row.reason) || trimOrNull(row.label) || trimOrNull(row.id))
    .filter(Boolean)
    .slice(0, 3);
  const hasProvenanceBlocker = ids.some((id) => ["SUBMIT_CHK_01", "SUBMIT_CHK_01A", "SUBMIT_CHK_08"].includes(id));
  const hasBoundedRuntimeBlocker = ids.some((id) => ["SUBMIT_CHK_03", "SUBMIT_CHK_04", "SUBMIT_CHK_04B", "SUBMIT_CHK_10", "SUBMIT_CHK_11", "SUBMIT_CHK_12", "SUBMIT_CHK_19", "SUBMIT_CHK_20A"].includes(id));
  const hasEntryBoundaryBlocker = ids.some((id) => id === "SUBMIT_CHK_13");
  const hasFillSyncCanonicalBoundaryBlocker = ids.some((id) => id === "SUBMIT_CHK_18");
  const hasProductionCutoverBlocker = ids.some((id) => ["SUBMIT_CHK_14", "SUBMIT_CHK_15"].includes(id));
  const hasProductionLiveEntrySizingBlocker = ids.some((id) => id === "SUBMIT_CHK_20");
  const hasSchedulerTrafficBlocker = ids.some((id) => id === "SUBMIT_CHK_16");
  const hasSchedulerCollectorBlocker = ids.some((id) => id === "SUBMIT_CHK_17");
  const hasRunbookBlocker = ids.some((id) => id === "SUBMIT_CHK_05");
  const hasContextBlocker = ids.some((id) => ["SUBMIT_CHK_06", "SUBMIT_CHK_07"].includes(id));
  const hasCandidateSelectionBlocker = ids.some((id) => id === "SUBMIT_CHK_09");
  return Object.freeze({
    blocker_n: failed.length,
    top_failures: topFailures,
    has_provenance_blocker: hasProvenanceBlocker,
    has_bounded_runtime_blocker: hasBoundedRuntimeBlocker,
    has_entry_boundary_blocker: hasEntryBoundaryBlocker,
    has_fill_sync_canonical_boundary_blocker: hasFillSyncCanonicalBoundaryBlocker,
    has_production_cutover_blocker: hasProductionCutoverBlocker,
    has_production_live_entry_sizing_blocker: hasProductionLiveEntrySizingBlocker,
    has_scheduler_traffic_blocker: hasSchedulerTrafficBlocker,
    has_scheduler_collector_blocker: hasSchedulerCollectorBlocker,
    has_runbook_blocker: hasRunbookBlocker,
    has_context_blocker: hasContextBlocker,
    has_candidate_selection_blocker: hasCandidateSelectionBlocker,
  });
}

function buildVerificationRecommendedAction(summary) {
  const row = normalizeObject(summary);
  if (!row || Number(row.blocker_n) === 0) return "PROCEED_WITH_SUBMIT_WRAPPER";
  if (row.has_provenance_blocker) return "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT";
  if (row.has_bounded_runtime_blocker) return "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_entry_boundary_blocker) return "FIX_V2_ENTRY_BOUNDARY_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_fill_sync_canonical_boundary_blocker) return "FIX_V2_FILL_SYNC_CANONICAL_BOUNDARY_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_production_cutover_blocker) return "FIX_V2_PRODUCTION_CUTOVER_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_production_live_entry_sizing_blocker) return "FIX_V2_PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_scheduler_collector_blocker) return "FIX_V2_SCHEDULER_COLLECTOR_IAM_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER";
  if (row.has_scheduler_traffic_blocker) return "FIX_V2_SCHEDULER_TRAFFIC_CUTOVER_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER";
  if (row.has_runbook_blocker) return "RERUN_CANARY_RUNBOOK_AND_RECHECK_ARTIFACT_COHERENCE";
  if (row.has_context_blocker) return "REGENERATE_CLOUDBUILD_CONTEXT_AND_RECHECK_DEPLOY_DECISION";
  if (row.has_candidate_selection_blocker) return "RECHECK_SELECTED_POSITION_CYCLE_AND_RERUN_CANARY_FLOW";
  return "HOLD_AND_REVIEW_SUBMIT_VERIFICATION";
}

function buildVerificationRecommendedActionReason(summary) {
  const row = normalizeObject(summary);
  if (!row || Number(row.blocker_n) === 0) {
    return "all bounded submit verification checks passed";
  }
  if (row.has_provenance_blocker) {
    return "bounded lineage or approval contract integrity failed";
  }
  if (row.has_bounded_runtime_blocker) {
    return "bounded runtime or evidence snapshot coverage failed";
  }
  if (row.has_entry_boundary_blocker) {
    return "V2 entry execution boundary audit failed";
  }
  if (row.has_fill_sync_canonical_boundary_blocker) {
    return "V2 fill sync canonical boundary audit failed";
  }
  if (row.has_production_cutover_blocker) {
    return "V2 production cutover guard audit failed";
  }
  if (row.has_production_live_entry_sizing_blocker) {
    return "V2 production live entry sizing contract failed";
  }
  if (row.has_scheduler_collector_blocker) {
    return "V2 scheduler traffic collector cannot prove GCP project scheduler and Cloud Run read access";
  }
  if (row.has_scheduler_traffic_blocker) {
    return "V2 scheduler traffic cutover readiness failed";
  }
  if (row.has_runbook_blocker) {
    return "runbook review did not pass";
  }
  if (row.has_context_blocker) {
    return "cloudbuild context action or blocker summary is inconsistent";
  }
  if (row.has_candidate_selection_blocker) {
    return "auto-select candidate selection contract is incomplete";
  }
  return "submit verification blockers remain and require manual review";
}

function buildVerificationRecommendedActionReasonCode(summary) {
  const row = normalizeObject(summary);
  if (!row || Number(row.blocker_n) === 0) {
    return "ALL_CHECKS_PASSED";
  }
  if (row.has_provenance_blocker) {
    return "PROVENANCE_OR_CONTRACT_BLOCKER";
  }
  if (row.has_bounded_runtime_blocker) {
    return "BOUNDED_RUNTIME_BLOCKER";
  }
  if (row.has_entry_boundary_blocker) {
    return "ENTRY_BOUNDARY_BLOCKER";
  }
  if (row.has_fill_sync_canonical_boundary_blocker) {
    return "FILL_SYNC_CANONICAL_BOUNDARY_BLOCKER";
  }
  if (row.has_production_cutover_blocker) {
    return "PRODUCTION_CUTOVER_BLOCKER";
  }
  if (row.has_production_live_entry_sizing_blocker) {
    return "PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_BLOCKER";
  }
  if (row.has_scheduler_collector_blocker) {
    return "SCHEDULER_COLLECTOR_BLOCKER";
  }
  if (row.has_scheduler_traffic_blocker) {
    return "SCHEDULER_TRAFFIC_BLOCKER";
  }
  if (row.has_runbook_blocker) {
    return "RUNBOOK_BLOCKER";
  }
  if (row.has_context_blocker) {
    return "CONTEXT_BLOCKER";
  }
  if (row.has_candidate_selection_blocker) {
    return "CANDIDATE_SELECTION_BLOCKER";
  }
  return "MANUAL_REVIEW_REQUIRED";
}

function resolveProjectId(env = process.env) {
  const explicit = trimOrNull(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.PROJECT_ID);
  if (explicit) return explicit;
  const fromGcloud = trimOrNull(execFileSync("gcloud", ["config", "get-value", "project"], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf8",
  }));
  if (!fromGcloud) throw new Error("V2_PROMOTION_CLOUDBUILD_PROJECT_REQUIRED");
  return fromGcloud;
}

function resolveCloudBuildConfig(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_CLOUDBUILD_CONFIG) || "cloudbuild.yaml";
}

function resolveCloudBuildSourceDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_CLOUDBUILD_SOURCE_DIR) || ".";
}

function buildEvidenceRef({ file, field, expectedValue = null, note = null }) {
  return Object.freeze({
    file: trimOrNull(file),
    field: trimOrNull(field),
    ...(expectedValue == null ? {} : { expected_value: expectedValue }),
    ...(trimOrNull(note) ? { note: trimOrNull(note) } : {}),
  });
}

function buildSubstitutions(plan) {
  const row = plan && typeof plan === "object" ? plan : {};
  const requiresOpenClawExecutionAuditLedgerWrite = ["CANARY_FLOW", "PIPELINE"].includes(row.mode)
    && ["CANARY", "LIVE"].includes(row.promotionMode);
  const enablesProductionEntryRouteCanaryFirestore = ["CANARY", "LIVE"].includes(row.promotionMode);
  return Object.freeze({
    _V2_PROMOTION_CANARY_FLOW_ENABLED: row.mode === "CANARY_FLOW" ? "1" : "0",
    _V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: row.canaryAutoSelectEnabled ? "1" : "0",
    _V2_PROMOTION_PIPELINE_ENABLED: row.mode === "PIPELINE" ? "1" : "0",
    _V2_PROMOTION_GATE_ENABLED: row.mode === "GATE" ? "1" : "0",
    _V2_PROMOTION_MOCK_ARTIFACTS_ENABLED: row.mode === "MOCK" ? "1" : "0",
    _V2_PROMOTION_MOCK_PROFILE: trimOrNull(row.effectiveEnv && row.effectiveEnv.V2_PROMOTION_MOCK_PROFILE) || "CLEAN",
    _V2_PROMOTION_MODE: row.promotionMode || "CANARY",
    _V2_PROMOTION_ARTIFACT_DIR: row.artifactDir || "",
    _V2_PROMOTION_SELECT_POSITION_CYCLE_ID: row.positionCycleId || "",
    _V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON: trimOrNull(row.effectiveEnv && row.effectiveEnv.V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON) || "",
    _V2_PROMOTION_REPLAY_FIXTURE_PROFILE: trimOrNull(row.effectiveEnv && row.effectiveEnv.V2_PROMOTION_REPLAY_FIXTURE_PROFILE) || "REFERENCE_PASS",
    _V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: trimOrNull(row.effectiveEnv && row.effectiveEnv.V2_PROMOTION_COMPARISON_FIXTURE_PROFILE) || "REFERENCE_CLEAN",
    _DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: requiresOpenClawExecutionAuditLedgerWrite ? "1" : "0",
    _DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: trimOrNull(row.effectiveEnv && row.effectiveEnv.DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON) || "",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: trimOrNull(row.effectiveEnv && row.effectiveEnv.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED) || (enablesProductionEntryRouteCanaryFirestore ? "1" : "0"),
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: trimOrNull(row.effectiveEnv && row.effectiveEnv.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED) || (enablesProductionEntryRouteCanaryFirestore ? "1" : "0"),
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: trimOrNull(row.effectiveEnv && row.effectiveEnv.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE) || (enablesProductionEntryRouteCanaryFirestore ? "FIRESTORE" : "JSONL"),
  });
}

function serializeSubstitutions(substitutions) {
  return Object.entries(substitutions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value == null ? "" : value)}`)
    .join(",");
}

function buildRunbookReviewPolicy(plan) {
  const row = plan && typeof plan === "object" ? plan : {};
  const requiresDeployApproval = ["CANARY_FLOW", "PIPELINE"].includes(row.mode)
    && ["CANARY", "LIVE"].includes(row.promotionMode);
  if (!requiresDeployApproval) {
    return Object.freeze({
      required: false,
      strategy: "NOT_REQUIRED",
      reason: "mode does not require bounded deploy approval",
    });
  }
  if (trimOrNull(row.positionCycleId)) {
    return Object.freeze({
      required: true,
      strategy: "AUTO_BOUNDED_EXPLICIT",
      reason: "cloudbuild runtime will run canary runbook review on the bounded explicit cycle path",
    });
  }
  return Object.freeze({
    required: true,
    strategy: "AUTO_SELECT_RUNTIME_FINALIZE",
    reason: "cloudbuild runtime will finalize a cycle-bounded artifact dir after candidate selection and then run canary runbook review",
  });
}

function buildApprovalContract(plan) {
  const row = plan && typeof plan === "object" ? plan : {};
  const requiresBoundedApproval = ["CANARY_FLOW", "PIPELINE"].includes(row.mode)
    && ["CANARY", "LIVE"].includes(row.promotionMode);
  if (!requiresBoundedApproval) {
    return Object.freeze({
      required: false,
      reason: "mode does not require bounded canary/live approval contract",
      deploy_decision_approved_required: false,
      bounded_runtime_summary_required: false,
      lineage_contract_required: false,
      lineage_hash_match_required: false,
      evidence_snapshot_summary_required: false,
      runtime_chain_audit_summary_required: false,
      entry_boundary_audit_required: false,
      fill_sync_canonical_boundary_audit_required: false,
      production_cutover_audit_required: false,
      production_live_entry_sizing_contract_required: false,
      production_cutover_readiness_summary_required: false,
      scheduler_traffic_collector_preflight_summary_required: false,
      scheduler_traffic_cutover_readiness_summary_required: false,
      openclaw_execution_audit_ledger_write_required: false,
      repair_firestore_canary_streak_required: false,
      production_entry_route_canary_streak_required: false,
      production_entry_protected_canary_required: false,
      live_cutover_readiness_summary_required: false,
      runbook_review_pass_required: false,
      candidate_selection_ready_required: false,
      selected_preflight_required: false,
      blocker_free_required: false,
      recommended_next_action_required: null,
      resolved_artifact_dir_required: false,
    });
  }
  return Object.freeze({
    required: true,
    reason: "cloudbuild runtime must end with bounded deploy approval before submit is valid",
    deploy_decision_approved_required: true,
    bounded_runtime_summary_required: true,
    lineage_contract_required: true,
    lineage_hash_match_required: true,
    evidence_snapshot_summary_required: true,
    runtime_chain_audit_summary_required: true,
    entry_boundary_audit_required: true,
    fill_sync_canonical_boundary_audit_required: true,
    production_cutover_audit_required: true,
    production_live_entry_sizing_contract_required: true,
    production_cutover_readiness_summary_required: row.promotionMode === "LIVE",
    scheduler_traffic_collector_preflight_summary_required: row.promotionMode === "LIVE",
    scheduler_traffic_cutover_readiness_summary_required: row.promotionMode === "LIVE",
    openclaw_execution_audit_ledger_write_required: true,
    repair_firestore_canary_streak_required: row.promotionMode === "LIVE",
    production_entry_route_canary_streak_required: row.promotionMode === "LIVE",
    production_entry_protected_canary_required: true,
    live_cutover_readiness_summary_required: row.promotionMode === "LIVE",
    runbook_review_pass_required: true,
    candidate_selection_ready_required: row.canaryAutoSelectEnabled === true,
    selected_preflight_required: row.canaryAutoSelectEnabled === true,
    blocker_free_required: true,
    recommended_next_action_required: "PROCEED_WITH_SUBMIT_WRAPPER",
    resolved_artifact_dir_required: true,
  });
}

function buildApprovalEvidenceSources(plan) {
  const row = plan && typeof plan === "object" ? plan : {};
  const requiresBoundedApproval = ["CANARY_FLOW", "PIPELINE"].includes(row.mode)
    && ["CANARY", "LIVE"].includes(row.promotionMode);
  if (!requiresBoundedApproval) {
    return Object.freeze({
      required: false,
      reason: "mode does not require bounded canary/live evidence sources",
      deploy_decision: null,
      runbook_review: null,
      recommended_next_action: null,
      blocker_summary: null,
      bounded_runtime_summary: null,
      evidence_snapshot_summary: null,
      runtime_chain_audit_summary: null,
      entry_boundary_audit: null,
      fill_sync_canonical_boundary_audit: null,
      production_cutover_audit: null,
      production_live_entry_sizing_contract: null,
     production_cutover_readiness_summary: null,
      scheduler_traffic_collector_preflight_summary: null,
      scheduler_traffic_cutover_readiness_summary: null,
      production_entry_route_canary_streak: null,
      production_entry_protected_canary: null,
      lineage_hash_sources: [],
      candidate_selection: null,
      resolved_artifact_dir: null,
    });
  }

  return Object.freeze({
    required: true,
    reason: "submit wrapper defines the final artifact fields that must prove bounded approval",
    deploy_decision: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "approved",
      expectedValue: true,
    }),
    bounded_runtime_summary: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "bounded_runtime_summary",
      note: "selector_query_budget collector_query_budget exporter_snapshot_size_bytes manifest_counts must exist",
    }),
    evidence_snapshot_summary: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "bounded_runtime_summary.evidence_snapshot_summary",
      note: "ok=true and missing counts must both be 0",
    }),
    runtime_chain_audit_summary: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "bounded_runtime_summary.runtime_chain_audit_summary",
      note: "ok=true, check_n > 0, fail_n=0, and failed_check_ids=[]",
    }),
    entry_boundary_audit: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "entry_boundary_audit",
      note: "ok=true, reason=V2_ENTRY_BOUNDARY_AUDIT_PASS, violation_n=0, scope=src/v2",
    }),
    fill_sync_canonical_boundary_audit: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "fill_sync_canonical_boundary_audit",
      note: "ok=true, reason=V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS, scope=binance_fills_sync_canonical_boundary, contract.fail_n=0",
    }),
    production_cutover_audit: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "production_cutover_audit",
      note: "ok=true, reason=V2_PRODUCTION_CUTOVER_AUDIT_PASS, route guard import/apply/outcome checks pass",
    }),
    production_live_entry_sizing_contract: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "production_cutover_audit.contract.checks",
      note: "live endpoint resolves sizing-backed transports before route and transports require approved entrySizingDecision",
    }),
    production_cutover_readiness_summary: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-cloudbuild-context.json",
          field: "production_cutover_readiness_summary",
          note: "LIVE requires V2_PRODUCTION_CUTOVER_READINESS_PASS and legacy_webhook_blocked=true",
        })
      : null,
    scheduler_traffic_collector_preflight_summary: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-cloudbuild-context.json",
          field: "scheduler_traffic_collector_preflight_summary",
          note: "LIVE requires collector preflight to prove Cloud Build can resolve project, list Cloud Scheduler jobs, and describe Cloud Run services",
        })
      : null,
    scheduler_traffic_cutover_readiness_summary: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-cloudbuild-context.json",
          field: "scheduler_traffic_cutover_readiness_summary",
          note: "LIVE requires OpenClaw cron ownership, inactive legacy scheduler tick, disabled Cloud Run scheduler autostart, and ready 100% service traffic",
        })
      : null,
    openclaw_execution_audit_ledger_write: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "bounded_runtime_summary.openclaw_execution_audit_ledger_write",
      note: "reason must be OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN and skipped=false",
    }),
    repair_firestore_canary_streak: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-deploy-decision.json",
          field: "bounded_runtime_summary.repair_firestore_canary_streak",
          note: "LIVE requires V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS with no blockers",
        })
      : null,
    production_entry_route_canary_streak: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-deploy-decision.json",
          field: "bounded_runtime_summary.production_entry_route_canary_streak",
          note: "LIVE requires V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS with no blockers and no exchange write",
        })
      : null,
    production_entry_protected_canary: buildEvidenceRef({
      file: "promotion-deploy-decision.json",
      field: "bounded_runtime_summary.production_entry_protected_canary",
      note: "CANARY/LIVE requires fresh no-exchange proof that route, kernel, submitter, protection activation, SL and TP1 are connected",
    }),
    live_cutover_readiness_summary: row.promotionMode === "LIVE"
      ? buildEvidenceRef({
          file: "promotion-cloudbuild-context.json",
          field: "live_cutover_readiness_summary",
          note: "LIVE requires cutover readiness summary with auto_apply=false and mutates_environment=false",
        })
      : null,
    runbook_review: buildEvidenceRef({
      file: "promotion-runbook-review.json",
      field: "overall_status",
      expectedValue: "PASS",
    }),
    recommended_next_action: buildEvidenceRef({
      file: "promotion-cloudbuild-context.json",
      field: "recommended_next_action",
      expectedValue: "PROCEED_WITH_SUBMIT_WRAPPER",
    }),
    blocker_summary: buildEvidenceRef({
      file: "promotion-cloudbuild-context.json",
      field: "deploy_decision_summary.blocker_summary.blocker_n",
      expectedValue: 0,
    }),
    resolved_artifact_dir: buildEvidenceRef({
      file: "promotion-cloudbuild-context.json",
      field: "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id",
      note: "request artifact_dir, context artifact_dir/resolved_artifact_dir/self-check, and deploy/preflight/manifest/context cycle ids must describe the same finalized bounded directory",
    }),
    lineage_hash_sources: Object.freeze([
      buildEvidenceRef({
        file: "promotion-preflight.json",
        field: "lineage_contract.hash",
      }),
      buildEvidenceRef({
        file: "promotion-runtime-manifest.json",
        field: "snapshot_meta.lineage_contract.hash",
      }),
      buildEvidenceRef({
        file: "promotion-deploy-decision.json",
        field: "bounded_runtime_summary.lineage_contract.hash",
      }),
      buildEvidenceRef({
        file: "promotion-cloudbuild-context.json",
        field: "lineage_contract_hash",
      }),
    ]),
    candidate_selection: row.canaryAutoSelectEnabled === true
      ? buildEvidenceRef({
          file: "promotion-deploy-decision.json",
          field: "candidate_selection_summary.selection_contract",
          note: "all selection contract flags must be true on auto-select paths",
        })
      : null,
  });
}

function mustBeLiveTrue(row, field, liveRequired) {
  if (liveRequired) return row && row[field] === true;
  return row && typeof row[field] === "boolean";
}

function hasRequiredApprovalContract(contract, { promotionMode = null } = {}) {
  const row = normalizeObject(contract);
  const liveRequired = upper(promotionMode) === "LIVE";
  return !!(
    row &&
    row.required === true &&
    row.deploy_decision_approved_required === true &&
    row.bounded_runtime_summary_required === true &&
    row.lineage_contract_required === true &&
    row.lineage_hash_match_required === true &&
    row.evidence_snapshot_summary_required === true &&
    row.runtime_chain_audit_summary_required === true &&
    row.entry_boundary_audit_required === true &&
    row.fill_sync_canonical_boundary_audit_required === true &&
    row.production_cutover_audit_required === true &&
    row.production_live_entry_sizing_contract_required === true &&
    mustBeLiveTrue(row, "production_cutover_readiness_summary_required", liveRequired) &&
    mustBeLiveTrue(row, "scheduler_traffic_collector_preflight_summary_required", liveRequired) &&
    mustBeLiveTrue(row, "scheduler_traffic_cutover_readiness_summary_required", liveRequired) &&
    row.openclaw_execution_audit_ledger_write_required === true &&
    mustBeLiveTrue(row, "repair_firestore_canary_streak_required", liveRequired) &&
    mustBeLiveTrue(row, "production_entry_route_canary_streak_required", liveRequired) &&
    row.production_entry_protected_canary_required === true &&
    mustBeLiveTrue(row, "live_cutover_readiness_summary_required", liveRequired) &&
    row.runbook_review_pass_required === true &&
    typeof row.candidate_selection_ready_required === "boolean" &&
    typeof row.selected_preflight_required === "boolean" &&
    row.blocker_free_required === true &&
    row.recommended_next_action_required === "PROCEED_WITH_SUBMIT_WRAPPER" &&
    row.resolved_artifact_dir_required === true
  );
}

function collectLineageHashes(artifacts = {}) {
  const preflightHash = trimOrNull(
    artifacts.preflight && artifacts.preflight.payload
    && artifacts.preflight.payload.lineage_contract
    && artifacts.preflight.payload.lineage_contract.hash
  );
  const manifestHash = trimOrNull(
    artifacts.runtimeManifest && artifacts.runtimeManifest.payload
    && artifacts.runtimeManifest.payload.snapshot_meta
    && artifacts.runtimeManifest.payload.snapshot_meta.lineage_contract
    && artifacts.runtimeManifest.payload.snapshot_meta.lineage_contract.hash
  );
  const deployHash = trimOrNull(
    artifacts.deployDecision && artifacts.deployDecision.payload
    && artifacts.deployDecision.payload.bounded_runtime_summary
    && artifacts.deployDecision.payload.bounded_runtime_summary.lineage_contract
    && artifacts.deployDecision.payload.bounded_runtime_summary.lineage_contract.hash
  );
  const contextHash = trimOrNull(
    artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload
    && artifacts.cloudbuildContext.payload.lineage_contract_hash
  );
  return Object.freeze({
    preflight: preflightHash,
    runtime_manifest: manifestHash,
    deploy_decision: deployHash,
    cloudbuild_context: contextHash,
  });
}

function resolvePathOrNull(value) {
  const text = trimOrNull(value);
  return text ? path.resolve(text) : null;
}

function pathHasExactSegment(filePath, segment) {
  const resolved = resolvePathOrNull(filePath);
  const expected = trimOrNull(segment);
  if (!resolved || !expected) return false;
  return resolved.split(path.sep).includes(expected);
}

function hasResolvedArtifactDirCoherence({ artifactDir = null, artifacts = {}, deployDecision = null, cloudbuildContext = null } = {}) {
  const submittedArtifactDir = resolvePathOrNull(artifactDir);
  const contextArtifactDir = resolvePathOrNull(cloudbuildContext && cloudbuildContext.artifact_dir);
  const contextResolvedArtifactDir = resolvePathOrNull(cloudbuildContext && cloudbuildContext.resolved_artifact_dir);
  const selfCheck = cloudbuildContext && typeof cloudbuildContext.artifact_dir_coherence === "object"
    ? cloudbuildContext.artifact_dir_coherence
    : null;
  const selfCheckArtifactDir = resolvePathOrNull(selfCheck && selfCheck.artifact_dir);
  const selfCheckResolvedArtifactDir = resolvePathOrNull(selfCheck && selfCheck.resolved_artifact_dir);
  const decisionCycleId = trimOrNull(deployDecision && deployDecision.position_cycle_id);
  const contextCycleId = trimOrNull(cloudbuildContext && cloudbuildContext.position_cycle_id);
  const selfCheckCycleId = trimOrNull(selfCheck && selfCheck.position_cycle_id);
  const selfCheckDeployCycleId = trimOrNull(selfCheck && selfCheck.deploy_decision_position_cycle_id);
  const preflightCycleId = trimOrNull(artifacts.preflight && artifacts.preflight.payload && artifacts.preflight.payload.position_cycle_id);
  const manifestCycleId = trimOrNull(
    artifacts.runtimeManifest
    && artifacts.runtimeManifest.payload
    && artifacts.runtimeManifest.payload.snapshot_meta
    && artifacts.runtimeManifest.payload.snapshot_meta.selector_meta
    && artifacts.runtimeManifest.payload.snapshot_meta.selector_meta.position_cycle_id
  );
  return !!(
    submittedArtifactDir &&
    contextArtifactDir &&
    contextResolvedArtifactDir &&
    selfCheck &&
    selfCheck.ok === true &&
    selfCheckArtifactDir &&
    selfCheckResolvedArtifactDir &&
    decisionCycleId &&
    contextCycleId &&
    selfCheckCycleId &&
    selfCheckDeployCycleId &&
    preflightCycleId &&
    manifestCycleId &&
    submittedArtifactDir === contextArtifactDir &&
    submittedArtifactDir === contextResolvedArtifactDir &&
    submittedArtifactDir === selfCheckArtifactDir &&
    submittedArtifactDir === selfCheckResolvedArtifactDir &&
    pathHasExactSegment(submittedArtifactDir, decisionCycleId) &&
    contextCycleId === decisionCycleId &&
    selfCheckCycleId === decisionCycleId &&
    selfCheckDeployCycleId === decisionCycleId &&
    preflightCycleId === decisionCycleId &&
    manifestCycleId === decisionCycleId &&
    selfCheck.artifact_dir_matches_resolved_artifact_dir === true &&
    selfCheck.artifact_dir_contains_position_cycle_id === true &&
    selfCheck.resolved_artifact_dir_contains_position_cycle_id === true &&
    selfCheck.context_cycle_matches_deploy_decision === true
  );
}

function buildArtifactDirCoherenceSummary({ cloudbuildContext = null, filePath = null } = {}) {
  const row = normalizeObject(cloudbuildContext);
  const selfCheck = normalizeObject(row && row.artifact_dir_coherence);
  if (!selfCheck) return null;
  return Object.freeze({
    ok: selfCheck.ok === true,
    reason: trimOrNull(selfCheck.reason),
    artifact_dir: trimOrNull(selfCheck.artifact_dir),
    resolved_artifact_dir: trimOrNull(selfCheck.resolved_artifact_dir),
    position_cycle_id: trimOrNull(selfCheck.position_cycle_id),
    deploy_decision_position_cycle_id: trimOrNull(selfCheck.deploy_decision_position_cycle_id),
    artifact_dir_matches_resolved_artifact_dir: selfCheck.artifact_dir_matches_resolved_artifact_dir === true,
    artifact_dir_contains_position_cycle_id: selfCheck.artifact_dir_contains_position_cycle_id === true,
    resolved_artifact_dir_contains_position_cycle_id: selfCheck.resolved_artifact_dir_contains_position_cycle_id === true,
    context_cycle_matches_deploy_decision: selfCheck.context_cycle_matches_deploy_decision === true,
    file: trimOrNull(filePath),
  });
}

function buildSubmitTraceFamilies(summary) {
  const row = normalizeObject(summary);
  if (!row) return Object.freeze([]);
  const families = [];
  if (row.has_provenance_blocker) families.push("PROVENANCE");
  if (row.has_bounded_runtime_blocker) families.push("BOUNDED_RUNTIME");
  if (row.has_entry_boundary_blocker) families.push("ENTRY_BOUNDARY");
  if (row.has_fill_sync_canonical_boundary_blocker) families.push("FILL_SYNC_CANONICAL_BOUNDARY");
  if (row.has_production_cutover_blocker) families.push("PRODUCTION_CUTOVER");
  if (row.has_production_live_entry_sizing_blocker) families.push("ENTRY_SIZING");
  if (row.has_scheduler_collector_blocker) families.push("SCHEDULER_COLLECTOR");
  if (row.has_scheduler_traffic_blocker) families.push("SCHEDULER_TRAFFIC");
  if (row.has_runbook_blocker) families.push("RUNBOOK");
  if (row.has_context_blocker) families.push("CONTEXT");
  if (row.has_candidate_selection_blocker) families.push("CANDIDATE_SELECTION");
  if (Number(row.blocker_n || 0) > 0 && families.length === 0) families.push("UNCLASSIFIED");
  return Object.freeze(families);
}

function extractAlertRetrySummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const deployDecision = normalizeObject(artifacts.deployDecision && artifacts.deployDecision.payload);
  return normalizeObject(
    cloudbuildContext
    && cloudbuildContext.deploy_decision_summary
    && cloudbuildContext.deploy_decision_summary.alert_retry_summary
  ) || normalizeObject(deployDecision && deployDecision.alert_retry_summary)
    || normalizeObject(deployDecision && deployDecision.bounded_runtime_summary && deployDecision.bounded_runtime_summary.alert_retry_summary)
    || null;
}

function normalizeDeployWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : [])
    .map((value) => trimOrNull(value))
    .filter(Boolean);
}

function buildDeployWarningSummary(warnings) {
  const rows = normalizeDeployWarnings(warnings);
  const hasRepairFirestoreCanaryStreakWarning = rows.some((row) => row.includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  const hasProductionEntryRouteCanaryStreakWarning = rows.some((row) => row.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  return Object.freeze({
    warning_n: rows.length,
    top_warnings: Object.freeze(rows.slice(0, 3)),
    has_live_readiness_warning: hasRepairFirestoreCanaryStreakWarning || hasProductionEntryRouteCanaryStreakWarning,
    has_repair_firestore_canary_streak_warning: hasRepairFirestoreCanaryStreakWarning,
    has_production_entry_route_canary_streak_warning: hasProductionEntryRouteCanaryStreakWarning,
  });
}

function extractDeployWarningSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const deployDecision = normalizeObject(artifacts.deployDecision && artifacts.deployDecision.payload);
  const fromContext = normalizeObject(
    cloudbuildContext
    && cloudbuildContext.deploy_decision_summary
    && cloudbuildContext.deploy_decision_summary.warning_summary
  );
  if (fromContext) {
    const topWarnings = normalizeDeployWarnings(fromContext.top_warnings);
    const fallbackSummary = buildDeployWarningSummary(topWarnings);
    return Object.freeze({
      warning_n: Number.isFinite(Number(fromContext.warning_n)) ? Number(fromContext.warning_n) : 0,
      top_warnings: Object.freeze(topWarnings),
      has_live_readiness_warning: fromContext.has_live_readiness_warning === true || fallbackSummary.has_live_readiness_warning === true,
      has_repair_firestore_canary_streak_warning: fromContext.has_repair_firestore_canary_streak_warning === true
        || fallbackSummary.has_repair_firestore_canary_streak_warning === true,
      has_production_entry_route_canary_streak_warning: fromContext.has_production_entry_route_canary_streak_warning === true
        || fallbackSummary.has_production_entry_route_canary_streak_warning === true,
    });
  }
  return buildDeployWarningSummary(deployDecision && deployDecision.warnings);
}

function collectDeployWarningRunbookChecklist(summary) {
  const row = normalizeObject(summary);
  if (!row) return Object.freeze([]);
  const refs = new Set();
  const warnings = normalizeDeployWarnings(row.top_warnings);
  if (row.has_repair_firestore_canary_streak_warning || warnings.some((value) => value.includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"))) {
    refs.add("19");
  }
  if (row.has_production_entry_route_canary_streak_warning || warnings.some((value) => value.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"))) {
    refs.add("26");
  }
  if (
    row.has_live_readiness_warning
    && !row.has_repair_firestore_canary_streak_warning
    && !row.has_production_entry_route_canary_streak_warning
    && !refs.size
  ) {
    refs.add("19");
    refs.add("26");
  }
  return Object.freeze(Array.from(refs).sort());
}

function extractLiveCutoverReadinessSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const summary = normalizeObject(cloudbuildContext && cloudbuildContext.live_cutover_readiness_summary);
  if (!summary) return null;
  return Object.freeze({
    ok: summary.ok === true,
    reason: trimOrNull(summary.reason),
    auto_apply: summary.auto_apply === true,
    mutates_environment: summary.mutates_environment === true,
    recommended_next_action: trimOrNull(summary.recommended_next_action),
    blocker_n: Number.isFinite(Number(summary.blocker_n)) ? Number(summary.blocker_n) : 0,
    required_env_change_n: Number.isFinite(Number(summary.required_env_change_n)) ? Number(summary.required_env_change_n) : 0,
    submit_check_ids: Object.freeze(
      (Array.isArray(summary.submit_check_ids) ? summary.submit_check_ids : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    runbook_checklist: Object.freeze(
      (Array.isArray(summary.runbook_checklist) ? summary.runbook_checklist : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    file: trimOrNull(cloudbuildContext && cloudbuildContext.live_cutover_readiness_file),
  });
}

function extractProductionCutoverReadinessSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const summary = normalizeObject(cloudbuildContext && cloudbuildContext.production_cutover_readiness_summary);
  if (!summary) return null;
  return Object.freeze({
    ok: summary.ok === true,
    reason: trimOrNull(summary.reason),
    blocker_n: Number.isFinite(Number(summary.blocker_n)) ? Number(summary.blocker_n) : 0,
    guard_reason: trimOrNull(summary.guard_reason),
    legacy_webhook_blocked: summary.legacy_webhook_blocked === true,
    v2_enabled: summary.v2_enabled === true,
    v2_dry_run: summary.v2_dry_run === true,
    v2_canary_only: summary.v2_canary_only === true,
    require_production_cutover: summary.require_production_cutover === true,
    block_legacy_webhook_signal: summary.block_legacy_webhook_signal === true,
    allow_legacy_webhook_signal: summary.allow_legacy_webhook_signal === true,
    file: trimOrNull(cloudbuildContext && cloudbuildContext.production_cutover_readiness_file),
  });
}

function extractSchedulerTrafficCutoverReadinessSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const summary = normalizeObject(cloudbuildContext && cloudbuildContext.scheduler_traffic_cutover_readiness_summary);
  if (!summary) return null;
  return Object.freeze({
    ok: summary.ok === true,
    reason: trimOrNull(summary.reason),
    blocker_n: Number.isFinite(Number(summary.blocker_n)) ? Number(summary.blocker_n) : 0,
    scheduler_sot: trimOrNull(summary.scheduler_sot),
    required_openclaw_job_ids: Object.freeze(
      (Array.isArray(summary.required_openclaw_job_ids) ? summary.required_openclaw_job_ids : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    missing_openclaw_job_ids: Object.freeze(
      (Array.isArray(summary.missing_openclaw_job_ids) ? summary.missing_openclaw_job_ids : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    active_legacy_scheduler_job_n: Number.isFinite(Number(summary.active_legacy_scheduler_job_n))
      ? Number(summary.active_legacy_scheduler_job_n)
      : 0,
    cloud_run_services: Object.freeze(Array.isArray(summary.cloud_run_services) ? summary.cloud_run_services.slice() : []),
    file: trimOrNull(cloudbuildContext && cloudbuildContext.scheduler_traffic_cutover_readiness_file),
  });
}

function extractSchedulerTrafficCollectorPreflightSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const summary = normalizeObject(cloudbuildContext && cloudbuildContext.scheduler_traffic_collector_preflight_summary);
  if (!summary) return null;
  return Object.freeze({
    ok: summary.ok === true,
    reason: trimOrNull(summary.reason),
    blocker_n: Number.isFinite(Number(summary.blocker_n)) ? Number(summary.blocker_n) : 0,
    failed_check_ids: Object.freeze(
      (Array.isArray(summary.failed_check_ids) ? summary.failed_check_ids : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    project_id: trimOrNull(summary.project_id),
    region: trimOrNull(summary.region),
    service_names: Object.freeze(
      (Array.isArray(summary.service_names) ? summary.service_names : [])
        .map((value) => trimOrNull(value))
        .filter(Boolean)
    ),
    scheduler_job_n: Number.isFinite(Number(summary.scheduler_job_n)) ? Number(summary.scheduler_job_n) : null,
    file: trimOrNull(cloudbuildContext && cloudbuildContext.scheduler_traffic_collector_preflight_file) || trimOrNull(summary.file),
  });
}

function extractRunbookReviewSummaryFromArtifacts(artifacts = {}) {
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const contextSummary = normalizeObject(cloudbuildContext && cloudbuildContext.runbook_review_summary);
  if (contextSummary) {
    return Object.freeze({
      ok: contextSummary.ok === true,
      overall_status: trimOrNull(contextSummary.overall_status),
      check_n: Number.isFinite(Number(contextSummary.check_n)) ? Number(contextSummary.check_n) : 0,
      pass_n: Number.isFinite(Number(contextSummary.pass_n)) ? Number(contextSummary.pass_n) : 0,
      fail_n: Number.isFinite(Number(contextSummary.fail_n)) ? Number(contextSummary.fail_n) : 0,
      skip_n: Number.isFinite(Number(contextSummary.skip_n)) ? Number(contextSummary.skip_n) : 0,
      failed_check_ids: Object.freeze(
        (Array.isArray(contextSummary.failed_check_ids) ? contextSummary.failed_check_ids : [])
          .map((value) => trimOrNull(value))
          .filter(Boolean)
      ),
      top_failed_checks: Object.freeze(Array.isArray(contextSummary.top_failed_checks) ? contextSummary.top_failed_checks.slice(0, 3) : []),
      expected_position_cycle_id: trimOrNull(contextSummary.expected_position_cycle_id),
      file: trimOrNull(cloudbuildContext && cloudbuildContext.runbook_review_file) || trimOrNull(contextSummary.file),
    });
  }
  const runbookReview = normalizeObject(artifacts.runbookReview && artifacts.runbookReview.payload);
  if (!runbookReview) return null;
  const checks = Array.isArray(runbookReview.checks) ? runbookReview.checks : [];
  const failedChecks = checks.filter((check) => trimOrNull(check && check.status) === "FAIL");
  return Object.freeze({
    ok: runbookReview.ok === true,
    overall_status: trimOrNull(runbookReview.overall_status),
    check_n: Number.isFinite(Number(runbookReview.check_n)) ? Number(runbookReview.check_n) : checks.length,
    pass_n: Number.isFinite(Number(runbookReview.pass_n)) ? Number(runbookReview.pass_n) : checks.filter((check) => trimOrNull(check && check.status) === "PASS").length,
    fail_n: Number.isFinite(Number(runbookReview.fail_n)) ? Number(runbookReview.fail_n) : failedChecks.length,
    skip_n: Number.isFinite(Number(runbookReview.skip_n)) ? Number(runbookReview.skip_n) : checks.filter((check) => trimOrNull(check && check.status) === "SKIP").length,
    failed_check_ids: Object.freeze(failedChecks.map((check) => trimOrNull(check && check.id)).filter(Boolean)),
    top_failed_checks: Object.freeze(failedChecks.slice(0, 3)),
    expected_position_cycle_id: trimOrNull(runbookReview.expected_position_cycle_id),
    file: artifacts.runbookReview && artifacts.runbookReview.filePath,
  });
}

function hasLiveCutoverReadinessSummary(summary) {
  const row = normalizeObject(summary);
  return !!(
    row &&
    row.ok === true &&
    row.auto_apply === false &&
    row.mutates_environment === false &&
    Number(row.blocker_n || 0) === 0 &&
    Number(row.required_env_change_n || 0) >= 4 &&
    trimOrNull(row.file)
  );
}

function hasProductionCutoverReadinessSummary(summary) {
  const row = normalizeObject(summary);
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_PRODUCTION_CUTOVER_READINESS_PASS" &&
    Number(row.blocker_n || 0) === 0 &&
    trimOrNull(row.guard_reason) === "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED" &&
    row.legacy_webhook_blocked === true &&
    row.v2_enabled === true &&
    row.v2_dry_run === false &&
    row.v2_canary_only === false &&
    row.require_production_cutover === true &&
    row.block_legacy_webhook_signal === true &&
    row.allow_legacy_webhook_signal === false &&
    trimOrNull(row.file)
  );
}

function hasSchedulerTrafficCutoverReadinessSummary(summary) {
  const row = normalizeObject(summary);
  const cloudRunServices = Array.isArray(row && row.cloud_run_services) ? row.cloud_run_services : [];
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS" &&
    Number(row.blocker_n || 0) === 0 &&
    trimOrNull(row.scheduler_sot) === "OPENCLAW_CRON" &&
    Array.isArray(row.missing_openclaw_job_ids) &&
    row.missing_openclaw_job_ids.length === 0 &&
    Number(row.active_legacy_scheduler_job_n || 0) === 0 &&
    cloudRunServices.length >= 2 &&
    cloudRunServices.every((service) => (
      trimOrNull(service && service.scheduler_autostart) === "0" &&
      trimOrNull(service && service.scheduler_cutover_mode) === "OPENCLAW_CRON" &&
      Number(service && service.traffic_percent) === 100 &&
      service.latest_revision_ready === true
    )) &&
    trimOrNull(row.file)
  );
}

function hasSchedulerTrafficCollectorPreflightSummary(summary) {
  const row = normalizeObject(summary);
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS" &&
    Number(row.blocker_n || 0) === 0 &&
    trimOrNull(row.project_id) &&
    trimOrNull(row.region) &&
    Array.isArray(row.service_names) &&
    row.service_names.length >= 2 &&
    trimOrNull(row.file)
  );
}

function hasAlertRetryAttention(summary) {
  const row = normalizeObject(summary);
  if (!row) return false;
  return Number(row.failed_n || 0) > 0 || Number(row.pending_n || 0) > 0;
}

function collectAlertRunbookRefs(summary) {
  const row = normalizeObject(summary);
  if (!row) return Object.freeze([]);
  const refs = new Set();
  const countedRefs = normalizeObject(row.runbook_ref_counts);
  for (const key of Object.keys(countedRefs || {})) {
    const value = trimOrNull(key);
    if (value) refs.add(value);
  }
  const latestRefs = Array.isArray(row.latest_failed && row.latest_failed.runbook_refs)
    ? row.latest_failed.runbook_refs
    : [];
  latestRefs.map((value) => trimOrNull(value)).filter(Boolean).forEach((value) => refs.add(value));
  return Object.freeze(Array.from(refs).sort());
}

function buildSubmitTraceSummary(approvalVerification) {
  const row = normalizeObject(approvalVerification);
  if (!row) {
    return Object.freeze({
      required: false,
      ok: true,
      failed_submit_check_ids: Object.freeze([]),
      failed_runbook_checklist: Object.freeze([]),
      blocker_families: Object.freeze([]),
      primary_blocker_family: null,
      alert_retry_attention_required: false,
      alert_retry_summary: null,
      alert_runbook_refs: Object.freeze([]),
      deploy_warning_attention_required: false,
      deploy_warning_summary: null,
      deploy_warning_runbook_checklist: Object.freeze([]),
      live_cutover_readiness_summary: null,
      production_cutover_readiness_summary: null,
      scheduler_traffic_collector_preflight_summary: null,
      scheduler_traffic_cutover_readiness_summary: null,
      runbook_review_summary: null,
      artifact_dir_coherence_summary: null,
      lineage_consistency_summary: null,
      recommended_next_action: null,
      recommended_next_action_reason: null,
      recommended_next_action_reason_code: null,
    });
  }
  const failedChecks = Array.isArray(row.checks)
    ? row.checks.filter((entry) => entry && entry.ok !== true)
    : [];
  const failedSubmitCheckIds = Object.freeze(
    failedChecks.map((entry) => trimOrNull(entry.id)).filter(Boolean)
  );
  const blockerFamilies = buildSubmitTraceFamilies(row.blocker_summary);
  const alertRetrySummary = normalizeObject(row.alert_retry_summary);
  const deployWarningSummary = normalizeObject(row.deploy_warning_summary);
  const liveCutoverReadinessSummary = normalizeObject(row.live_cutover_readiness_summary);
  const productionCutoverReadinessSummary = normalizeObject(row.production_cutover_readiness_summary);
  const schedulerTrafficCollectorPreflightSummary = normalizeObject(row.scheduler_traffic_collector_preflight_summary);
  const schedulerTrafficCutoverReadinessSummary = normalizeObject(row.scheduler_traffic_cutover_readiness_summary);
  const runbookReviewSummary = normalizeObject(row.runbook_review_summary);
  const artifactDirCoherenceSummary = normalizeObject(row.artifact_dir_coherence_summary);
  const lineageConsistencySummary = normalizeObject(row.lineage_consistency_summary);
  return Object.freeze({
    required: row.required === true,
    ok: row.ok === true,
    failed_submit_check_ids: failedSubmitCheckIds,
    failed_runbook_checklist: submitTrace.collectRunbookChecklist(failedSubmitCheckIds),
    blocker_families: blockerFamilies,
    primary_blocker_family: blockerFamilies[0] || null,
    alert_retry_attention_required: row.alert_retry_attention_required === true,
    alert_retry_summary: alertRetrySummary,
    alert_runbook_refs: collectAlertRunbookRefs(alertRetrySummary),
    deploy_warning_attention_required: row.deploy_warning_attention_required === true,
    deploy_warning_summary: deployWarningSummary,
    deploy_warning_runbook_checklist: collectDeployWarningRunbookChecklist(deployWarningSummary),
    live_cutover_readiness_summary: liveCutoverReadinessSummary,
    production_cutover_readiness_summary: productionCutoverReadinessSummary,
    scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    runbook_review_summary: runbookReviewSummary,
    artifact_dir_coherence_summary: artifactDirCoherenceSummary,
    lineage_consistency_summary: lineageConsistencySummary,
    recommended_next_action: trimOrNull(row.recommended_next_action),
    recommended_next_action_reason: trimOrNull(row.recommended_next_action_reason),
    recommended_next_action_reason_code: trimOrNull(row.recommended_next_action_reason_code),
  });
}

function buildApprovalVerification(request) {
  const row = normalizeObject(request) || {};
  const requiresBoundedApproval = normalizeObject(row.approval_contract) && row.approval_contract.required === true;
  if (!requiresBoundedApproval) {
    const summary = buildVerificationSummary([]);
    return Object.freeze({
      required: false,
      ok: true,
      reason: "mode does not require bounded approval verification",
      fail_n: 0,
      check_n: 0,
      checks: [],
      blocker_summary: summary,
      alert_retry_summary: null,
      alert_retry_attention_required: false,
      deploy_warning_summary: null,
      deploy_warning_attention_required: false,
      live_cutover_readiness_summary: null,
      production_cutover_readiness_summary: null,
      scheduler_traffic_collector_preflight_summary: null,
      scheduler_traffic_cutover_readiness_summary: null,
      runbook_review_summary: null,
      artifact_dir_coherence_summary: null,
      lineage_consistency_summary: null,
      recommended_next_action: buildVerificationRecommendedAction(summary),
      recommended_next_action_reason: buildVerificationRecommendedActionReason(summary),
      recommended_next_action_reason_code: buildVerificationRecommendedActionReasonCode(summary),
      lineage_hashes: {
        preflight: null,
        runtime_manifest: null,
        deploy_decision: null,
        cloudbuild_context: null,
      },
    });
  }

  const artifactDir = trimOrNull(row.artifact_dir);
  if (!artifactDir) {
    const checks = [
      buildVerificationCheck({
        id: "SUBMIT_CHK_01",
        label: "artifact dir present",
        ok: false,
        reason: "artifact dir is required",
        file: null,
        field: "artifact_dir",
      }),
    ];
    const summary = buildVerificationSummary(checks);
    return Object.freeze({
      required: true,
      ok: false,
      reason: "artifact dir required for bounded approval verification",
      fail_n: 1,
      check_n: 1,
      checks,
      blocker_summary: summary,
      alert_retry_summary: null,
      alert_retry_attention_required: false,
      deploy_warning_summary: null,
      deploy_warning_attention_required: false,
      live_cutover_readiness_summary: null,
      production_cutover_readiness_summary: null,
      scheduler_traffic_collector_preflight_summary: null,
      scheduler_traffic_cutover_readiness_summary: null,
      runbook_review_summary: null,
      artifact_dir_coherence_summary: null,
      lineage_consistency_summary: null,
      recommended_next_action: buildVerificationRecommendedAction(summary),
      recommended_next_action_reason: buildVerificationRecommendedActionReason(summary),
      recommended_next_action_reason_code: buildVerificationRecommendedActionReasonCode(summary),
      lineage_hashes: {
        preflight: null,
        runtime_manifest: null,
        deploy_decision: null,
        cloudbuild_context: null,
      },
    });
  }

  const artifacts = Object.freeze({
    deployDecision: readOptionalArtifact(artifactDir, "promotion-deploy-decision.json"),
    runbookReview: readOptionalArtifact(artifactDir, "promotion-runbook-review.json"),
    cloudbuildContext: readOptionalArtifact(artifactDir, "promotion-cloudbuild-context.json"),
    preflight: readOptionalArtifact(artifactDir, "promotion-preflight.json"),
    runtimeManifest: readOptionalArtifact(artifactDir, "promotion-runtime-manifest.json"),
  });
  const deployDecision = normalizeObject(artifacts.deployDecision && artifacts.deployDecision.payload);
  const runbookReview = normalizeObject(artifacts.runbookReview && artifacts.runbookReview.payload);
  const cloudbuildContext = normalizeObject(artifacts.cloudbuildContext && artifacts.cloudbuildContext.payload);
  const lineageHashes = collectLineageHashes(artifacts);
  const alertRetrySummary = extractAlertRetrySummaryFromArtifacts(artifacts);
  const alertRetryAttentionRequired = hasAlertRetryAttention(alertRetrySummary);
  const deployWarningSummary = extractDeployWarningSummaryFromArtifacts(artifacts);
  const deployWarningAttentionRequired = Number(deployWarningSummary.warning_n || 0) > 0;
  const liveCutoverReadinessSummary = extractLiveCutoverReadinessSummaryFromArtifacts(artifacts);
  const productionCutoverReadinessSummary = extractProductionCutoverReadinessSummaryFromArtifacts(artifacts);
  const schedulerTrafficCollectorPreflightSummary = extractSchedulerTrafficCollectorPreflightSummaryFromArtifacts(artifacts);
  const schedulerTrafficCutoverReadinessSummary = extractSchedulerTrafficCutoverReadinessSummaryFromArtifacts(artifacts);
  const runbookReviewSummary = extractRunbookReviewSummaryFromArtifacts(artifacts);
  const artifactDirCoherenceSummary = buildArtifactDirCoherenceSummary({
    cloudbuildContext,
    filePath: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
  });
  const checks = [];

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_01",
    label: "approval contract complete",
    ok: hasRequiredApprovalContract(row.approval_contract, { promotionMode: row.promotion_mode }),
    reason: hasRequiredApprovalContract(row.approval_contract, { promotionMode: row.promotion_mode })
      ? "approval contract contains required bounded checks"
      : "approval contract is incomplete",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "approval_contract",
  }), {
    artifactContract: [
      "approval_contract.required",
      "approval_contract.deploy_decision_approved_required",
      "approval_contract.bounded_runtime_summary_required",
      "approval_contract.lineage_contract_required",
      "approval_contract.lineage_hash_match_required",
      "approval_contract.evidence_snapshot_summary_required",
      "approval_contract.runtime_chain_audit_summary_required",
      "approval_contract.entry_boundary_audit_required",
      "approval_contract.fill_sync_canonical_boundary_audit_required",
      "approval_contract.production_cutover_audit_required",
      "approval_contract.production_live_entry_sizing_contract_required",
      "approval_contract.production_cutover_readiness_summary_required",
      "approval_contract.scheduler_traffic_cutover_readiness_summary_required",
      "approval_contract.openclaw_execution_audit_ledger_write_required",
      "approval_contract.repair_firestore_canary_streak_required",
      "approval_contract.live_cutover_readiness_summary_required",
      "approval_contract.runbook_review_pass_required",
      "approval_contract.candidate_selection_ready_required",
      "approval_contract.selected_preflight_required",
      "approval_contract.blocker_free_required",
      "approval_contract.recommended_next_action_required",
      "approval_contract.resolved_artifact_dir_required",
    ],
  }));

  const resolvedArtifactDirCoherent = hasResolvedArtifactDirCoherence({
    artifactDir,
    artifacts,
    deployDecision,
    cloudbuildContext,
  });
  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_01A",
    label: "resolved artifact dir matches selected cycle",
    ok: resolvedArtifactDirCoherent,
    reason: resolvedArtifactDirCoherent
      ? "request artifact dir, context resolved dir, and selected cycle are coherent"
      : "request artifact dir, context self-check, resolved dir, or selected cycle is inconsistent",
    file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
    field: "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_01A"),
    artifactContract: [
      "approval_contract.resolved_artifact_dir_required",
      "approval_evidence_sources.resolved_artifact_dir",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_02",
    label: "deploy decision approved",
    ok: deployDecision && deployDecision.approved === true,
    reason: deployDecision && deployDecision.approved === true
      ? "deploy decision approved"
      : "deploy decision must be approved",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "approved",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_02"),
    artifactContract: ["approval_evidence_sources.deploy_decision"],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_03",
    label: "bounded runtime summary complete",
    ok: deployDecisionCheck.__test.hasBoundedRuntimeEvidence(deployDecision && deployDecision.bounded_runtime_summary),
    reason: deployDecisionCheck.__test.hasBoundedRuntimeEvidence(deployDecision && deployDecision.bounded_runtime_summary)
      ? "bounded runtime summary complete"
      : "bounded runtime summary incomplete",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_03"),
    artifactContract: [
      "approval_contract.bounded_runtime_summary_required",
      "approval_evidence_sources.bounded_runtime_summary",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_04",
    label: "evidence snapshot summary complete",
    ok: deployDecisionCheck.__test.hasEvidenceSnapshotCoverage(deployDecision && deployDecision.bounded_runtime_summary),
    reason: deployDecisionCheck.__test.hasEvidenceSnapshotCoverage(deployDecision && deployDecision.bounded_runtime_summary)
      ? "evidence snapshot coverage complete"
      : "evidence snapshot coverage incomplete",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.evidence_snapshot_summary",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_04"),
    artifactContract: [
      "approval_contract.evidence_snapshot_summary_required",
      "approval_evidence_sources.evidence_snapshot_summary",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_04B",
    label: "runtime chain audit complete",
    ok: deployDecisionCheck.__test.hasRuntimeChainAuditCoverage(deployDecision && deployDecision.bounded_runtime_summary),
    reason: deployDecisionCheck.__test.hasRuntimeChainAuditCoverage(deployDecision && deployDecision.bounded_runtime_summary)
      ? "runtime chain audit complete"
      : "runtime chain audit missing or failed",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.runtime_chain_audit_summary",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_04B"),
    artifactContract: [
      "approval_contract.runtime_chain_audit_summary_required",
      "approval_evidence_sources.runtime_chain_audit_summary",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_13",
    label: "V2 entry boundary audit complete",
    ok: deployDecisionCheck.__test.hasEntryBoundaryAudit(deployDecision && deployDecision.entry_boundary_audit),
    reason: deployDecisionCheck.__test.hasEntryBoundaryAudit(deployDecision && deployDecision.entry_boundary_audit)
      ? "V2 entry boundary audit passed"
      : "V2 entry boundary audit is missing or failed",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "entry_boundary_audit",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_13"),
    artifactContract: [
      "approval_contract.entry_boundary_audit_required",
      "approval_evidence_sources.entry_boundary_audit",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_18",
    label: "V2 fill sync canonical boundary audit complete",
    ok: deployDecisionCheck.__test.hasFillSyncCanonicalBoundaryAudit(deployDecision && deployDecision.fill_sync_canonical_boundary_audit),
    reason: deployDecisionCheck.__test.hasFillSyncCanonicalBoundaryAudit(deployDecision && deployDecision.fill_sync_canonical_boundary_audit)
      ? "V2 fill sync canonical boundary audit passed"
      : "V2 fill sync canonical boundary audit is missing or failed",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "fill_sync_canonical_boundary_audit",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_18"),
    artifactContract: [
      "approval_contract.fill_sync_canonical_boundary_audit_required",
      "approval_evidence_sources.fill_sync_canonical_boundary_audit",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_14",
    label: "V2 production cutover audit complete",
    ok: deployDecisionCheck.__test.hasProductionCutoverAudit(deployDecision && deployDecision.production_cutover_audit),
    reason: deployDecisionCheck.__test.hasProductionCutoverAudit(deployDecision && deployDecision.production_cutover_audit)
      ? "V2 production cutover audit passed"
      : "V2 production cutover audit is missing or failed",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "production_cutover_audit",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_14"),
    artifactContract: [
      "approval_contract.production_cutover_audit_required",
      "approval_evidence_sources.production_cutover_audit",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_20",
    label: "V2 production live entry sizing contract complete",
    ok: deployDecisionCheck.__test.hasProductionLiveEntrySizingContract(deployDecision && deployDecision.production_cutover_audit),
    reason: deployDecisionCheck.__test.hasProductionLiveEntrySizingContract(deployDecision && deployDecision.production_cutover_audit)
      ? "V2 production live endpoint requires approved sizing before route"
      : "V2 production live entry sizing contract is missing or failed",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "production_cutover_audit.contract.checks",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_20"),
    artifactContract: [
      "approval_contract.production_live_entry_sizing_contract_required",
      "approval_evidence_sources.production_live_entry_sizing_contract",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_10",
    label: "OpenClaw execution audit ledger write complete",
    ok: deployDecisionCheck.__test.hasOpenClawExecutionAuditLedgerWrite(deployDecision && deployDecision.bounded_runtime_summary),
    reason: deployDecisionCheck.__test.hasOpenClawExecutionAuditLedgerWrite(deployDecision && deployDecision.bounded_runtime_summary)
      ? "OpenClaw execution audit ledger write evidence complete"
      : "OpenClaw execution audit ledger write evidence is missing or skipped",
    file: artifacts.deployDecision && artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.openclaw_execution_audit_ledger_write",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_10"),
    artifactContract: [
      "approval_contract.openclaw_execution_audit_ledger_write_required",
      "approval_evidence_sources.openclaw_execution_audit_ledger_write",
    ],
  }));

  if (row.approval_contract && row.approval_contract.repair_firestore_canary_streak_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_11",
      label: "LIVE repair Firestore canary streak complete",
      ok: deployDecisionCheck.__test.hasRepairFirestoreCanaryStreak(deployDecision && deployDecision.bounded_runtime_summary),
      reason: deployDecisionCheck.__test.hasRepairFirestoreCanaryStreak(deployDecision && deployDecision.bounded_runtime_summary)
        ? "LIVE repair Firestore canary streak evidence complete"
        : "LIVE repair Firestore canary streak evidence is missing or blocked",
      file: artifacts.deployDecision && artifacts.deployDecision.filePath,
      field: "bounded_runtime_summary.repair_firestore_canary_streak",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_11"),
      artifactContract: [
        "approval_contract.repair_firestore_canary_streak_required",
        "approval_evidence_sources.repair_firestore_canary_streak",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.production_entry_route_canary_streak_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_19",
      label: "LIVE production entry route canary streak complete",
      ok: deployDecisionCheck.__test.hasProductionEntryRouteCanaryStreak(deployDecision && deployDecision.bounded_runtime_summary),
      reason: deployDecisionCheck.__test.hasProductionEntryRouteCanaryStreak(deployDecision && deployDecision.bounded_runtime_summary)
        ? "LIVE production entry route canary streak evidence complete"
        : "LIVE production entry route canary streak evidence is missing or blocked",
      file: artifacts.deployDecision && artifacts.deployDecision.filePath,
      field: "bounded_runtime_summary.production_entry_route_canary_streak",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_19"),
      artifactContract: [
        "approval_contract.production_entry_route_canary_streak_required",
        "approval_evidence_sources.production_entry_route_canary_streak",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.production_entry_protected_canary_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_20A",
      label: "production entry protected canary complete",
      ok: deployDecisionCheck.__test.hasProductionEntryProtectedCanary(deployDecision && deployDecision.bounded_runtime_summary),
      reason: deployDecisionCheck.__test.hasProductionEntryProtectedCanary(deployDecision && deployDecision.bounded_runtime_summary)
        ? "production entry protected canary evidence complete"
        : "production entry protected canary evidence is missing or blocked",
      file: artifacts.deployDecision && artifacts.deployDecision.filePath,
      field: "bounded_runtime_summary.production_entry_protected_canary",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_20A"),
      artifactContract: [
        "approval_contract.production_entry_protected_canary_required",
        "approval_evidence_sources.production_entry_protected_canary",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.live_cutover_readiness_summary_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_12",
      label: "LIVE repair cutover readiness summary visible",
      ok: hasLiveCutoverReadinessSummary(liveCutoverReadinessSummary),
      reason: hasLiveCutoverReadinessSummary(liveCutoverReadinessSummary)
        ? "LIVE repair cutover readiness summary is visible and non-mutating"
        : "LIVE repair cutover readiness summary is missing or not non-mutating",
      file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
      field: "live_cutover_readiness_summary",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_12"),
      artifactContract: [
        "approval_contract.live_cutover_readiness_summary_required",
        "approval_evidence_sources.live_cutover_readiness_summary",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.production_cutover_readiness_summary_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_15",
      label: "LIVE production cutover readiness blocks legacy webhook",
      ok: hasProductionCutoverReadinessSummary(productionCutoverReadinessSummary),
      reason: hasProductionCutoverReadinessSummary(productionCutoverReadinessSummary)
        ? "LIVE production cutover readiness proves legacy webhook is blocked"
        : "LIVE production cutover readiness is missing, failed, or does not block legacy webhook",
      file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
      field: "production_cutover_readiness_summary",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_15"),
      artifactContract: [
        "approval_contract.production_cutover_readiness_summary_required",
        "approval_evidence_sources.production_cutover_readiness_summary",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.scheduler_traffic_collector_preflight_summary_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_17",
      label: "LIVE scheduler traffic collector preflight can read GCP state",
      ok: hasSchedulerTrafficCollectorPreflightSummary(schedulerTrafficCollectorPreflightSummary),
      reason: hasSchedulerTrafficCollectorPreflightSummary(schedulerTrafficCollectorPreflightSummary)
        ? "LIVE scheduler traffic collector preflight proves Cloud Build can read GCP scheduler and service state"
        : "LIVE scheduler traffic collector preflight is missing, failed, or not traceable to an artifact",
      file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
      field: "scheduler_traffic_collector_preflight_summary",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_17"),
      artifactContract: [
        "approval_contract.scheduler_traffic_collector_preflight_summary_required",
        "approval_evidence_sources.scheduler_traffic_collector_preflight_summary",
      ],
    }));
  }

  if (row.approval_contract && row.approval_contract.scheduler_traffic_cutover_readiness_summary_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_16",
      label: "LIVE scheduler traffic cutover uses OpenClaw cron only",
      ok: hasSchedulerTrafficCutoverReadinessSummary(schedulerTrafficCutoverReadinessSummary),
      reason: hasSchedulerTrafficCutoverReadinessSummary(schedulerTrafficCutoverReadinessSummary)
        ? "LIVE scheduler traffic cutover proves OpenClaw cron ownership and ready Cloud Run traffic"
        : "LIVE scheduler traffic cutover readiness is missing, failed, or still has legacy/autostart traffic risk",
      file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
      field: "scheduler_traffic_cutover_readiness_summary",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_16"),
      artifactContract: [
        "approval_contract.scheduler_traffic_cutover_readiness_summary_required",
        "approval_evidence_sources.scheduler_traffic_cutover_readiness_summary",
      ],
    }));
  }

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_05",
    label: "runbook review passed",
    ok: runbookReview && runbookReview.overall_status === "PASS",
    reason: runbookReview && runbookReview.overall_status === "PASS"
      ? "runbook review passed"
      : "runbook review must be PASS",
    file: artifacts.runbookReview && artifacts.runbookReview.filePath,
    field: "overall_status",
  }), {
    artifactContract: [
      "approval_contract.runbook_review_pass_required",
      "approval_evidence_sources.runbook_review",
    ],
  }));

  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_06",
    label: "cloudbuild next action is submit",
    ok: cloudbuildContext && cloudbuildContext.recommended_next_action === "PROCEED_WITH_SUBMIT_WRAPPER",
    reason: cloudbuildContext && cloudbuildContext.recommended_next_action === "PROCEED_WITH_SUBMIT_WRAPPER"
      ? "cloudbuild context recommends submit wrapper"
      : "cloudbuild context must recommend submit wrapper",
    file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
    field: "recommended_next_action",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_06"),
    artifactContract: [
      "approval_contract.recommended_next_action_required",
      "approval_evidence_sources.recommended_next_action",
    ],
  }));

  const blockerN = Number(
    cloudbuildContext
    && cloudbuildContext.deploy_decision_summary
    && cloudbuildContext.deploy_decision_summary.blocker_summary
    && cloudbuildContext.deploy_decision_summary.blocker_summary.blocker_n
  );
  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_07",
    label: "cloudbuild blocker count is zero",
    ok: blockerN === 0,
    reason: blockerN === 0
      ? "cloudbuild blocker count is zero"
      : "cloudbuild blocker count must be zero",
    file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
    field: "deploy_decision_summary.blocker_summary.blocker_n",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_07"),
    artifactContract: ["approval_evidence_sources.blocker_summary"],
  }));

  const boundedLineageOk = runbookCheck.__test.hasConsistentLineageContract({
    preflight: artifacts.preflight && artifacts.preflight.payload,
    runtimeManifest: artifacts.runtimeManifest && artifacts.runtimeManifest.payload,
    deployDecision,
  });
  const contextHashMatchesDeployDecision = runbookCheck.__test.hasContextLineageHashMatch({
    cloudbuildContext,
    deployDecision,
  });
  const contextLineageOk = runbookCheck.__test.hasContextLineageConsistency({
    cloudbuildContext,
  });
  const lineageOk = boundedLineageOk && contextHashMatchesDeployDecision && contextLineageOk;
  const contextLineageSummary = normalizeObject(cloudbuildContext && cloudbuildContext.lineage_consistency_summary);
  const lineageConsistencySummary = Object.freeze({
    ok: lineageOk,
    reason: lineageOk
      ? "SUBMIT_LINEAGE_CONSISTENT"
      : (!boundedLineageOk
        ? "BOUNDED_LINEAGE_HASH_MISMATCH"
        : (!contextHashMatchesDeployDecision
          ? "CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH"
          : (trimOrNull(contextLineageSummary && contextLineageSummary.reason) || "CONTEXT_LINEAGE_CONSISTENCY_FAILED"))),
    bounded_lineage_ok: boundedLineageOk,
    context_hash_matches_deploy_decision: contextHashMatchesDeployDecision,
    context_lineage_ok: contextLineageOk,
    context_summary: contextLineageSummary,
  });
  checks.push(withDocRefs(buildVerificationCheck({
    id: "SUBMIT_CHK_08",
    label: "lineage hashes consistent across bounded artifacts",
    ok: lineageOk,
    reason: lineageOk
      ? "lineage hashes consistent across bounded artifacts and cloudbuild context lineage summary"
      : `lineage consistency failed: ${lineageConsistencySummary.reason}`,
    file: artifacts.cloudbuildContext && artifacts.cloudbuildContext.filePath,
    field: "lineage_consistency_summary",
  }), {
    runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_08"),
    artifactContract: [
      "approval_contract.lineage_contract_required",
      "approval_contract.lineage_hash_match_required",
      "approval_evidence_sources.lineage_hash_sources",
    ],
  }));

  if (row.approval_contract && row.approval_contract.candidate_selection_ready_required === true) {
    checks.push(withDocRefs(buildVerificationCheck({
      id: "SUBMIT_CHK_09",
      label: "candidate selection contract complete",
      ok: deployDecisionCheck.__test.hasCandidateSelectionContract(deployDecision && deployDecision.candidate_selection_summary),
      reason: deployDecisionCheck.__test.hasCandidateSelectionContract(deployDecision && deployDecision.candidate_selection_summary)
        ? "candidate selection contract complete"
        : "candidate selection contract incomplete",
      file: artifacts.deployDecision && artifacts.deployDecision.filePath,
      field: "candidate_selection_summary.selection_contract",
    }), {
      runbookChecklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_09"),
      artifactContract: [
        "approval_contract.candidate_selection_ready_required",
        "approval_evidence_sources.candidate_selection",
      ],
    }));
  }

  const failN = checks.filter((row) => row.ok !== true).length;
  const summary = buildVerificationSummary(checks);
  return Object.freeze({
    required: true,
    ok: failN === 0,
    reason: failN === 0
      ? "bounded submit approval verification passed"
      : "bounded submit approval verification blocked",
    fail_n: failN,
    check_n: checks.length,
    checks,
    blocker_summary: summary,
    alert_retry_summary: alertRetrySummary,
    alert_retry_attention_required: alertRetryAttentionRequired,
    deploy_warning_summary: deployWarningSummary,
    deploy_warning_attention_required: deployWarningAttentionRequired,
    live_cutover_readiness_summary: liveCutoverReadinessSummary,
    production_cutover_readiness_summary: productionCutoverReadinessSummary,
    scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    runbook_review_summary: runbookReviewSummary,
    artifact_dir_coherence_summary: artifactDirCoherenceSummary,
    lineage_consistency_summary: lineageConsistencySummary,
    recommended_next_action: buildVerificationRecommendedAction(summary),
    recommended_next_action_reason: buildVerificationRecommendedActionReason(summary),
    recommended_next_action_reason_code: buildVerificationRecommendedActionReasonCode(summary),
    lineage_hashes: lineageHashes,
  });
}

function buildSubmitRequest(env = process.env) {
  submitContractCheck.assertSubmitContract();
  const plan = cloudbuildRuntime.__test.buildCloudBuildPlan(env);
  if (plan.mode === "OFF") throw new Error("V2_PROMOTION_CLOUDBUILD_SUBMIT_MODE_REQUIRED");

  const projectId = resolveProjectId(env);
  const configPath = resolveCloudBuildConfig(env);
  const sourceDir = resolveCloudBuildSourceDir(env);
  const substitutions = buildSubstitutions(plan);
  const serialized = serializeSubstitutions(substitutions);
  const args = [
    "builds", "submit",
    "--config", configPath,
    "--project", projectId,
    "--substitutions", serialized,
    sourceDir,
  ];

  return Object.freeze({
    project_id: projectId,
    config_path: configPath,
    source_dir: sourceDir,
    mode: plan.mode,
    promotion_mode: plan.promotionMode,
    position_cycle_id: plan.positionCycleId,
    artifact_dir: plan.artifactDir,
    runbook_review_policy: buildRunbookReviewPolicy(plan),
    approval_contract: buildApprovalContract(plan),
    approval_evidence_sources: buildApprovalEvidenceSources(plan),
    approval_verification: null,
    submit_trace_summary: null,
    substitutions,
    command: Object.freeze(["gcloud", ...args]),
    submit_enabled: isEnabled(env.V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED),
  });
}

function writeSubmitRequestArtifact(request) {
  const artifactDir = trimOrNull(request && request.artifact_dir);
  if (!artifactDir) throw new Error("V2_PROMOTION_CLOUDBUILD_SUBMIT_ARTIFACT_DIR_REQUIRED");
  ensureDir(artifactDir);
  const filePath = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(filePath, {
    ...request,
    generated_at: new Date().toISOString(),
  });
  return filePath;
}

function buildOperatorSummaryResult({ approvalVerification, request, outputFile = null }) {
  return Object.freeze({
    ok: approvalVerification.ok === true,
    reason: approvalVerification.ok === true
      ? "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY"
      : "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED",
    output_file: outputFile,
    request,
  });
}

function buildOperatorDeliverySummary(delivery, { artifactDir = null, outputFile = null } = {}) {
  const row = normalizeObject(delivery);
  const sendEnabled = row && row.send_enabled === true;
  const transport = normalizeObject(row && row.transport_result);
  const deliveryOk = row && row.ok === true;
  const error = normalizeObject(row && row.error);
  const transportState = transport
    ? (transport.skipped === true
      ? "SKIPPED"
      : (transport.ok === true ? "SENT" : "FAILED"))
    : "NONE";
  const status = !row
    ? "NOT_ATTEMPTED"
    : (deliveryOk
      ? (sendEnabled ? (transportState === "SKIPPED" ? "DELIVERY_SKIPPED" : "DELIVERED") : "READY_NOT_SENT")
      : "DELIVERY_FAILED");
  const lines = Object.freeze([
    `delivery_status=${status}`,
    `delivery_send_enabled=${sendEnabled ? "YES" : "NO"}`,
    `delivery_transport_state=${transportState}`,
    `delivery_reason=${trimOrNull(row && row.reason) || "NONE"}`,
    `delivery_error=${trimOrNull(error && error.message) || "NONE"}`,
    `artifact_dir=${trimOrNull(artifactDir) || "NONE"}`,
    `output_file=${trimOrNull(outputFile) || "NONE"}`,
  ]);
  return Object.freeze({
    status,
    send_enabled: sendEnabled,
    transport_state: transportState,
    reason: trimOrNull(row && row.reason),
    error_message: trimOrNull(error && error.message),
    artifact_dir: trimOrNull(artifactDir),
    output_file: trimOrNull(outputFile),
    lines,
    text: lines.join("\n"),
  });
}

function parseJsonTextOrNull(raw) {
  const text = trimOrNull(raw);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function buildOperatorAlertDeliverySummary(payload, { sendEnabled }) {
  const row = normalizeObject(payload) || {};
  return Object.freeze({
    required: true,
    send_enabled: sendEnabled === true,
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    preview: normalizeObject(row.preview),
    telegram_args: normalizeObject(row.telegram_args),
    transport_result: normalizeObject(row.transport_result),
  });
}

function runOperatorAlertDelivery(request, env = process.env) {
  const artifactDir = trimOrNull(request && request.artifact_dir);
  const sendEnabled = isEnabled(env.V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED);
  if (!artifactDir) {
    return Object.freeze({
      required: false,
      send_enabled: sendEnabled,
      ok: false,
      reason: "V2_PROMOTION_OPERATOR_ALERT_ARTIFACT_DIR_REQUIRED",
      preview: null,
      telegram_args: null,
      transport_result: null,
      error: null,
    });
  }
  try {
    const stdout = execFileSync(process.execPath, [OPERATOR_ALERT_SEND_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...env,
        V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return buildOperatorAlertDeliverySummary(parseJsonTextOrNull(stdout), { sendEnabled });
  } catch (error) {
    const stdoutPayload = parseJsonTextOrNull(error && error.stdout);
    const stderrPayload = parseJsonTextOrNull(error && error.stderr);
    const payload = stdoutPayload || stderrPayload;
    if (payload) {
      return Object.freeze({
        ...buildOperatorAlertDeliverySummary(payload, { sendEnabled }),
        error: null,
      });
    }
    return Object.freeze({
      required: true,
      send_enabled: sendEnabled,
      ok: false,
      reason: "V2_PROMOTION_OPERATOR_ALERT_DELIVERY_FAILED",
      preview: null,
      telegram_args: null,
      transport_result: null,
      error: Object.freeze({
        message: trimOrNull(error && error.message) || "UNKNOWN_OPERATOR_ALERT_DELIVERY_ERROR",
      }),
    });
  }
}

function submitCloudBuild(env = process.env) {
  const request = buildSubmitRequest(env);
  const approvalVerification = buildApprovalVerification(request);
  const verifiedRequest = Object.freeze({
    ...request,
    approval_verification: approvalVerification,
    submit_trace_summary: buildSubmitTraceSummary(approvalVerification),
    operator_summary: null,
    operator_alert_preview: null,
  });
  const initialSummary = operatorSummary.buildOperatorSummary(
    buildOperatorSummaryResult({
      approvalVerification,
      request: verifiedRequest,
      outputFile: null,
    })
  );
  const finalizedRequest = Object.freeze({
    ...verifiedRequest,
    operator_summary: initialSummary,
    operator_alert_preview: operatorAlertPreview.buildOperatorAlertPreview(
      buildOperatorSummaryResult({
        approvalVerification,
        request: Object.freeze({
          ...verifiedRequest,
          operator_summary: initialSummary,
        }),
        outputFile: null,
      })
    ),
  });
  const outputFile = writeSubmitRequestArtifact(finalizedRequest);
  const finalSummary = operatorSummary.buildOperatorSummary(
    buildOperatorSummaryResult({
      approvalVerification,
      request: finalizedRequest,
      outputFile,
    })
  );
  const requestWithOutput = Object.freeze({
    ...finalizedRequest,
    operator_summary: finalSummary,
    operator_alert_preview: operatorAlertPreview.buildOperatorAlertPreview(
      buildOperatorSummaryResult({
        approvalVerification,
        request: Object.freeze({
          ...finalizedRequest,
          operator_summary: finalSummary,
        }),
        outputFile,
      })
    ),
    operator_alert_delivery: null,
    operator_delivery_summary: null,
  });
  writeSubmitRequestArtifact(requestWithOutput);
  const alertDelivery = runOperatorAlertDelivery(requestWithOutput, env);
  const requestWithDelivery = Object.freeze({
    ...requestWithOutput,
    operator_alert_delivery: alertDelivery,
    operator_delivery_summary: buildOperatorDeliverySummary(alertDelivery, {
      artifactDir: requestWithOutput.artifact_dir,
      outputFile,
    }),
  });
  writeSubmitRequestArtifact(requestWithDelivery);
  if (requestWithOutput.approval_verification.required && requestWithOutput.approval_verification.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED",
      output_file: outputFile,
      request: requestWithDelivery,
    });
  }
  if (alertDelivery.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "V2_PROMOTION_CLOUDBUILD_SUBMIT_ALERT_FAILED",
      output_file: outputFile,
      request: requestWithDelivery,
    });
  }
  if (requestWithDelivery.submit_enabled) {
    execFileSync(requestWithDelivery.command[0], requestWithDelivery.command.slice(1), {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  }
  return Object.freeze({
    ok: true,
    reason: requestWithDelivery.submit_enabled
      ? "V2_PROMOTION_CLOUDBUILD_SUBMIT_TRIGGERED"
      : "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY",
    output_file: outputFile,
    request: requestWithDelivery,
  });
}

function buildCliResultPayload(result) {
  const row = normalizeObject(result) || {};
  const request = normalizeObject(row.request) || {};
  const alertPreview = normalizeObject(request.operator_alert_preview)
    || (
      normalizeObject(request.operator_summary)
        ? operatorAlertPreview.buildOperatorAlertPreview({
            ok: row.ok === true,
            output_file: trimOrNull(row.output_file),
            request,
          })
        : null
    );
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    output_file: trimOrNull(row.output_file),
    project_id: trimOrNull(request.project_id),
    mode: trimOrNull(request.mode),
    promotion_mode: trimOrNull(request.promotion_mode),
    position_cycle_id: trimOrNull(request.position_cycle_id),
    artifact_dir: trimOrNull(request.artifact_dir),
    submit_enabled: request.submit_enabled === true,
    operator_summary: normalizeObject(request.operator_summary),
    operator_alert_preview: alertPreview,
    operator_alert_delivery: normalizeObject(request.operator_alert_delivery),
    operator_delivery_summary: normalizeObject(request.operator_delivery_summary),
    submit_trace_summary: normalizeObject(request.submit_trace_summary),
    approval_verification: normalizeObject(request.approval_verification),
  });
}

async function main(env = process.env) {
  const result = submitCloudBuild(env);
  if (result.ok !== true) {
    console.error(JSON.stringify(buildCliResultPayload(result)));
    process.exit(1);
  }
  console.log(JSON.stringify(buildCliResultPayload(result)));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("SUBMIT_V2_PROMOTION_CLOUDBUILD_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    submitCloudBuild,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      isEnabled,
      resolveProjectId,
      resolveCloudBuildConfig,
      resolveCloudBuildSourceDir,
      buildSubstitutions,
      serializeSubstitutions,
      buildRunbookReviewPolicy,
      buildApprovalContract,
      buildApprovalEvidenceSources,
      buildEvidenceRef,
      buildApprovalVerification,
      buildVerificationCheck,
      buildDocRefs,
      withDocRefs,
      buildVerificationSummary,
      buildVerificationRecommendedAction,
      buildVerificationRecommendedActionReason,
      buildVerificationRecommendedActionReasonCode,
      buildSubmitTraceFamilies,
      extractAlertRetrySummaryFromArtifacts,
      normalizeDeployWarnings,
      buildDeployWarningSummary,
      extractDeployWarningSummaryFromArtifacts,
      collectDeployWarningRunbookChecklist,
      extractLiveCutoverReadinessSummaryFromArtifacts,
      hasLiveCutoverReadinessSummary,
      extractSchedulerTrafficCollectorPreflightSummaryFromArtifacts,
      extractRunbookReviewSummaryFromArtifacts,
      hasSchedulerTrafficCollectorPreflightSummary,
      hasAlertRetryAttention,
      collectAlertRunbookRefs,
      buildSubmitTraceSummary,
      buildOperatorSummary: operatorSummary.buildOperatorSummary,
      buildOperatorSummaryLines: operatorSummary.buildOperatorSummaryLines,
      buildOperatorSummaryText: operatorSummary.buildOperatorSummaryText,
      buildOperatorAlertPreview: operatorAlertPreview.buildOperatorAlertPreview,
      buildOperatorAlertTelegramArgs: operatorAlertPreview.buildTelegramSummaryArgs,
      parseJsonTextOrNull,
      buildOperatorAlertDeliverySummary,
      buildOperatorDeliverySummary,
      runOperatorAlertDelivery,
      buildCliResultPayload,
      validateSubmitContract: submitContractCheck.assertSubmitContract,
      buildOperatorSummaryResult,
      collectLineageHashes,
      resolvePathOrNull,
      pathHasExactSegment,
      hasResolvedArtifactDirCoherence,
      buildArtifactDirCoherenceSummary,
      mustBeLiveTrue,
      hasRequiredApprovalContract,
      normalizeObject,
      readJsonFile,
      readOptionalArtifact,
      buildSubmitRequest,
    },
  };
}
