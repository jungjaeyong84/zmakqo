#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const deployDecisionCheck = require("./check-v2-promotion-deploy-decision");

const DEPLOY_DECISION_FILENAME = "promotion-deploy-decision.json";
const OUTPUT_FILENAME = "v2_live_evidence_readiness_latest.json";

const AXES = Object.freeze([
  Object.freeze({
    id: "production_runtime_chain",
    label: "production runtime chain source audit",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_04C"]),
    runbook_refs: Object.freeze(["14B"]),
    blocker: "LIVE_EVIDENCE:PRODUCTION_RUNTIME_CHAIN_AUDIT_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasProductionRuntimeChainAudit(decision && decision.production_runtime_chain_audit);
    },
  }),
  Object.freeze({
    id: "repair_firestore_canary_streak",
    label: "repair Firestore canary 24h streak",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_11"]),
    runbook_refs: Object.freeze(["19"]),
    blocker: "LIVE_EVIDENCE:REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasRepairFirestoreCanaryStreak(bounded);
    },
  }),
  Object.freeze({
    id: "production_entry_route_canary_streak",
    label: "production entry route canary 24h streak",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_19"]),
    runbook_refs: Object.freeze(["26"]),
    blocker: "LIVE_EVIDENCE:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasProductionEntryRouteCanaryStreak(bounded);
    },
  }),
  Object.freeze({
    id: "exit_runtime_canary_streak",
    label: "exit runtime canary 24h streak",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_21"]),
    runbook_refs: Object.freeze(["28"]),
    blocker: "LIVE_EVIDENCE:EXIT_RUNTIME_CANARY_STREAK_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasExitRuntimeCanaryStreak(bounded);
    },
  }),
  Object.freeze({
    id: "production_entry_protected_canary",
    label: "protected entry canary proof",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_20A"]),
    runbook_refs: Object.freeze(["27A"]),
    blocker: "LIVE_EVIDENCE:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasProductionEntryProtectedCanary(bounded);
    },
  }),
  Object.freeze({
    id: "openclaw_supreme_closed_loop",
    label: "OpenClaw supreme closed-loop evidence",
    submit_check_ids: Object.freeze(["SUBMIT_CHK_23"]),
    runbook_refs: Object.freeze(["31"]),
    blocker: "LIVE_EVIDENCE:OPENCLAW_SUPREME_CONTROL_PLANE_REQUIRED",
    evaluate(decision, bounded) {
      return deployDecisionCheck.__test.hasOpenClawSupremeControlPlaneCoverage(bounded);
    },
  }),
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function resolveDeployDecision(env = process.env) {
  const inlineJson = trimOrNull(env.V2_PROMOTION_DEPLOY_DECISION_JSON);
  if (inlineJson) return JSON.parse(inlineJson);
  const explicitFile = trimOrNull(env.V2_PROMOTION_DEPLOY_DECISION_FILE);
  if (explicitFile) return readJsonFile(explicitFile);
  const artifactDir = resolveArtifactDir(env);
  return readJsonFile(path.join(artifactDir, DEPLOY_DECISION_FILENAME));
}

function buildAxisResult(axis, decision, bounded) {
  const ok = axis.evaluate(decision, bounded) === true;
  return Object.freeze({
    id: axis.id,
    label: axis.label,
    ok,
    blocker: ok ? null : axis.blocker,
    submit_check_ids: axis.submit_check_ids,
    runbook_refs: axis.runbook_refs,
  });
}

function buildTemporalCoherenceResult(decision, bounded, { artifactDir = null } = {}) {
  const mode = trimOrNull(decision && decision.mode);
  const positionCycleId = trimOrNull(decision && decision.position_cycle_id);
  const cycleBlockers = deployDecisionCheck.__test.collectLiveEvidenceCycleConsistencyBlockers(bounded, {
    mode,
    positionCycleId,
    artifactDir,
  });
  const temporalBlockers = deployDecisionCheck.__test.collectLiveStreakTemporalCoherenceBlockers(bounded, { mode });
  const blockers = Object.freeze([...cycleBlockers, ...temporalBlockers]);
  return Object.freeze({
    id: "live_evidence_temporal_coherence",
    label: "LIVE evidence cycle and temporal coherence",
    ok: blockers.length === 0,
    blockers,
    submit_check_ids: Object.freeze(["SUBMIT_CHK_06", "SUBMIT_CHK_07"]),
    runbook_refs: Object.freeze(["13E", "30"]),
  });
}

function collectUnique(rows = []) {
  const seen = new Set();
  ensureArray(rows).forEach((row) => {
    ensureArray(row).forEach((value) => {
      const text = trimOrNull(value);
      if (text) seen.add(text);
    });
  });
  return Object.freeze(Array.from(seen));
}

function evaluateLiveEvidenceReadiness({ deployDecision = null, artifactDir = null } = {}) {
  const decision = normalizeObject(deployDecision);
  const bounded = normalizeObject(decision && decision.bounded_runtime_summary);
  const mode = trimOrNull(decision && decision.mode);
  const axes = Object.freeze(AXES.map((axis) => buildAxisResult(axis, decision, bounded)));
  const temporal = buildTemporalCoherenceResult(decision, bounded, { artifactDir });
  const failedAxes = axes.filter((axis) => axis.ok !== true);
  const blockers = Object.freeze([
    ...failedAxes.map((axis) => axis.blocker).filter(Boolean),
    ...ensureArray(temporal.blockers),
  ]);
  const deployDecisionBlockers = Object.freeze(ensureArray(decision && decision.blockers));
  const evidenceReady = mode === "LIVE" && failedAxes.length === 0 && temporal.ok === true;
  const deployReady = evidenceReady && decision && decision.approved === true && deployDecisionBlockers.length === 0;
  const submitCheckIds = collectUnique([
    ...failedAxes.map((axis) => axis.submit_check_ids),
    temporal.ok === true ? [] : temporal.submit_check_ids,
  ]);
  const runbookRefs = collectUnique([
    ...failedAxes.map((axis) => axis.runbook_refs),
    temporal.ok === true ? [] : temporal.runbook_refs,
  ]);
  return Object.freeze({
    ok: deployReady === true,
    reason: deployReady === true ? "V2_LIVE_EVIDENCE_READY" : "V2_LIVE_EVIDENCE_NOT_READY",
    mode,
    artifact_dir: trimOrNull(artifactDir),
    position_cycle_id: trimOrNull(decision && decision.position_cycle_id),
    deploy_decision_approved: decision && decision.approved === true,
    evidence_ready: evidenceReady,
    deploy_ready: deployReady,
    blocker_n: blockers.length + deployDecisionBlockers.length,
    blockers,
    deploy_decision_blockers: deployDecisionBlockers,
    failed_axis_n: failedAxes.length,
    failed_axis_ids: Object.freeze(failedAxes.map((axis) => axis.id)),
    submit_check_ids: submitCheckIds,
    runbook_refs: runbookRefs,
    axes,
    temporal_coherence: temporal,
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function main(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const decision = resolveDeployDecision(env);
  const result = evaluateLiveEvidenceReadiness({ deployDecision: decision, artifactDir });
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, result);
  const payload = Object.freeze({ ...result, output_file: outputFile });
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  if (result.ok !== true) process.exitCode = 1;
  return payload;
}

if (require.main === module) main();

module.exports = {
  main,
  evaluateLiveEvidenceReadiness,
  __test: {
    AXES,
    OUTPUT_FILENAME,
    trimOrNull,
    resolveArtifactDir,
    buildAxisResult,
    buildTemporalCoherenceResult,
  },
};
