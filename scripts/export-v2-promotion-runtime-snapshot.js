#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildLineageContract } = require("./lib/v2-promotion-lineage-contract");

const SNAPSHOT_FILENAME = "promotion-runtime-snapshot.json";
const REPLAY_FIXTURES_FILENAME = "replay-fixtures.json";
const COMPARISON_FIXTURES_FILENAME = "comparison-fixtures.json";
const MANIFEST_FILENAME = "promotion-runtime-manifest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function resolveRuntimeSnapshotInput(env = process.env) {
  const filePath = trimOrNull(env.V2_PROMOTION_RUNTIME_SNAPSHOT_FILE);
  if (filePath) return readJsonFile(filePath);

  const inlineJson = trimOrNull(env.V2_PROMOTION_RUNTIME_SNAPSHOT_JSON);
  if (inlineJson) return JSON.parse(inlineJson);

  const artifactDir = resolveArtifactDir(env);
  const artifactFile = path.join(artifactDir, SNAPSHOT_FILENAME);
  if (fs.existsSync(artifactFile)) return readJsonFile(artifactFile);
  return null;
}

function validateRuntimeSnapshot(snapshot, { env = process.env } = {}) {
  const row = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!row) throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_REQUIRED");
  const maxBytes = parsePositiveInt(env.V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_BYTES, 524288, { max: 10485760 });
  const serialized = JSON.stringify(row);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  if (sizeBytes > maxBytes) {
    throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_BYTES_EXCEEDED");
  }
  const replayFixtures = {
    replay_context: {
      scope: "RUNTIME_CANDIDATE",
      require_transition_event_coverage: false,
      reason: "single collected runtime cycle cannot cover every terminal event family",
    },
    episodes: Array.isArray(row.episodes) ? row.episodes : [],
  };
  const comparisonFixtures = {
    shadowLivePairs: Array.isArray(row.shadowLivePairs) ? row.shadowLivePairs : [],
    sourceModePairs: Array.isArray(row.sourceModePairs) ? row.sourceModePairs : [],
  };
  if (replayFixtures.episodes.length === 0) throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_EPISODES_REQUIRED");
  if (comparisonFixtures.shadowLivePairs.length === 0) throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_SHADOW_LIVE_PAIRS_REQUIRED");
  if (comparisonFixtures.sourceModePairs.length === 0) throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_SOURCE_MODE_PAIRS_REQUIRED");
  const maxEpisodes = parsePositiveInt(env.V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_EPISODES, 5, { max: 100 });
  const maxShadowLivePairs = parsePositiveInt(env.V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_SHADOW_LIVE_PAIRS, 5, { max: 100 });
  const maxSourceModePairs = parsePositiveInt(env.V2_PROMOTION_RUNTIME_SNAPSHOT_MAX_SOURCE_MODE_PAIRS, 5, { max: 100 });
  if (replayFixtures.episodes.length > maxEpisodes) {
    throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_EPISODE_LIMIT_EXCEEDED");
  }
  if (comparisonFixtures.shadowLivePairs.length > maxShadowLivePairs) {
    throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_SHADOW_LIVE_PAIR_LIMIT_EXCEEDED");
  }
  if (comparisonFixtures.sourceModePairs.length > maxSourceModePairs) {
    throw new Error("V2_PROMOTION_RUNTIME_SNAPSHOT_SOURCE_MODE_PAIR_LIMIT_EXCEEDED");
  }
  return Object.freeze({
    snapshotMeta: row.snapshotMeta && typeof row.snapshotMeta === "object" ? row.snapshotMeta : {},
    sizeBytes,
    replayFixtures,
    comparisonFixtures,
  });
}

function buildEvidenceSnapshotSummary(episodes) {
  const rows = Array.isArray(episodes) ? episodes : [];
  let transitionCount = 0;
  let transitionEvidenceCount = 0;
  let protectionRuntimeCount = 0;
  let protectionRuntimeEvidenceCount = 0;

  for (const episode of rows) {
    const episodeRow = normalizeObject(episode);
    const transitions = Array.isArray(episodeRow && episodeRow.transitions) ? episodeRow.transitions : [];
    transitionCount += transitions.length;
    transitionEvidenceCount += transitions.filter((transition) => normalizeObject(transition && transition.source_exchange_evidence)).length;

    const protectionRuntime = normalizeObject(episodeRow && episodeRow.protectionRuntime);
    if (!protectionRuntime) continue;
    protectionRuntimeCount += 1;
    if (normalizeObject(protectionRuntime.last_exchange_evidence) && trimOrNull(protectionRuntime.last_evidence_observed_at)) {
      protectionRuntimeEvidenceCount += 1;
    }
  }

  const missingTransitionEvidenceCount = Math.max(transitionCount - transitionEvidenceCount, 0);
  const missingProtectionRuntimeEvidenceCount = Math.max(protectionRuntimeCount - protectionRuntimeEvidenceCount, 0);
  return Object.freeze({
    ok: missingTransitionEvidenceCount === 0 && missingProtectionRuntimeEvidenceCount === 0,
    transition_n: transitionCount,
    transition_evidence_n: transitionEvidenceCount,
    missing_transition_evidence_n: missingTransitionEvidenceCount,
    protection_runtime_n: protectionRuntimeCount,
    protection_runtime_evidence_n: protectionRuntimeEvidenceCount,
    missing_protection_runtime_evidence_n: missingProtectionRuntimeEvidenceCount,
  });
}

function buildOpenClawExecutionSeparationSummary(snapshotMeta) {
  const row = normalizeObject(snapshotMeta);
  if (!row) return null;
  const existing = normalizeObject(row.openclaw_execution_separation_summary);
  if (existing) {
    const auditN = Number(existing.audit_n);
    const failN = Number(existing.fail_n);
    return Object.freeze({
      ok: existing.ok === true,
      audit_n: Number.isFinite(auditN) ? auditN : null,
      fail_n: Number.isFinite(failN) ? failN : null,
      failed_check_ids: Array.isArray(existing.failed_check_ids) ? existing.failed_check_ids.slice() : [],
    });
  }

  const audits = Array.isArray(row.openclaw_execution_separation_audits)
    ? row.openclaw_execution_separation_audits
    : [];
  if (!audits.length) return null;

  const failedCheckIds = [];
  let failCount = 0;
  for (const audit of audits) {
    const auditRow = normalizeObject(audit);
    if (!auditRow || auditRow.ok !== true) {
      failCount += 1;
    }
    if (Array.isArray(auditRow && auditRow.failed_check_ids)) {
      failedCheckIds.push(...auditRow.failed_check_ids.map(String).filter(Boolean));
    }
  }
  return Object.freeze({
    ok: failCount === 0,
    audit_n: audits.length,
    fail_n: failCount,
    failed_check_ids: Array.from(new Set(failedCheckIds)),
  });
}

function buildRuntimeChainAuditSummary(snapshotMeta) {
  const row = normalizeObject(snapshotMeta);
  if (!row) return null;
  const existing = normalizeObject(row.runtime_chain_audit_summary);
  if (existing) {
    const checkN = Number(existing.check_n);
    const failN = Number(existing.fail_n);
    return Object.freeze({
      ok: existing.ok === true,
      check_n: Number.isFinite(checkN) ? checkN : null,
      fail_n: Number.isFinite(failN) ? failN : null,
      check_ids: Array.isArray(existing.check_ids) ? existing.check_ids.slice() : [],
      passed_check_ids: Array.isArray(existing.passed_check_ids) ? existing.passed_check_ids.slice() : [],
      failed_check_ids: Array.isArray(existing.failed_check_ids) ? existing.failed_check_ids.slice() : [],
    });
  }

  const audits = Array.isArray(row.runtime_chain_audits)
    ? row.runtime_chain_audits
    : [];
  if (!audits.length) return null;

  const failedCheckIds = [];
  const passedCheckIds = [];
  const checkIds = [];
  let checkCount = 0;
  let failCount = 0;
  for (const audit of audits) {
    const auditRow = normalizeObject(audit);
    const auditCheckN = Number(auditRow && auditRow.check_n);
    const auditFailN = Number(auditRow && auditRow.fail_n);
    if (Number.isFinite(auditCheckN)) checkCount += auditCheckN;
    if (Number.isFinite(auditFailN)) {
      failCount += auditFailN;
    } else if (!auditRow || auditRow.ok !== true) {
      failCount += 1;
    }
    if (Array.isArray(auditRow && auditRow.failed_check_ids)) {
      failedCheckIds.push(...auditRow.failed_check_ids.map(String).filter(Boolean));
    }
    if (Array.isArray(auditRow && auditRow.passed_check_ids)) {
      passedCheckIds.push(...auditRow.passed_check_ids.map(String).filter(Boolean));
    }
    if (Array.isArray(auditRow && auditRow.check_ids)) {
      checkIds.push(...auditRow.check_ids.map(String).filter(Boolean));
    } else if (Array.isArray(auditRow && auditRow.checks)) {
      checkIds.push(...auditRow.checks.map((check) => check && check.id).map(String).filter(Boolean));
    }
  }
  return Object.freeze({
    ok: failCount === 0 && checkCount > 0,
    check_n: checkCount,
    fail_n: failCount,
    check_ids: Array.from(new Set(checkIds)),
    passed_check_ids: Array.from(new Set(passedCheckIds)),
    failed_check_ids: Array.from(new Set(failedCheckIds)),
  });
}

function buildRepairEvidenceSummary(snapshotMeta) {
  const row = normalizeObject(snapshotMeta);
  if (!row) return null;
  const existing = normalizeObject(row.repair_evidence_summary);
  if (!existing) return null;
  const repairRequestCount = Number(existing.repair_request_n);
  const ledgerCount = Number(existing.repair_execution_ledger_n);
  const completionCount = Number(existing.completion_ledger_n);
  const evidenceCount = Number(existing.completion_evidence_n);
  const missingEvidenceCount = Number(existing.missing_completion_evidence_n);
  const orderEvidenceCount = Number(existing.order_evidence_n);
  return Object.freeze({
    ok: existing.ok === true,
    repair_request_n: Number.isFinite(repairRequestCount) ? repairRequestCount : null,
    repair_execution_ledger_n: Number.isFinite(ledgerCount) ? ledgerCount : null,
    completion_ledger_n: Number.isFinite(completionCount) ? completionCount : null,
    completion_evidence_n: Number.isFinite(evidenceCount) ? evidenceCount : null,
    completed_success_n: Number.isFinite(Number(existing.completed_success_n)) ? Number(existing.completed_success_n) : null,
    completed_failed_n: Number.isFinite(Number(existing.completed_failed_n)) ? Number(existing.completed_failed_n) : null,
    missing_completion_evidence_n: Number.isFinite(missingEvidenceCount) ? missingEvidenceCount : null,
    runbook_refs: Array.isArray(existing.runbook_refs) ? existing.runbook_refs.slice() : [],
    order_evidence_n: Number.isFinite(orderEvidenceCount) ? orderEvidenceCount : null,
    latest_completion: normalizeObject(existing.latest_completion),
  });
}

function buildManifest({ snapshotMeta = {}, sizeBytes = null, replayFixtures, comparisonFixtures, artifactDir }) {
  const snapshotMetaRow = normalizeObject(snapshotMeta) || {};
  const selectorMeta = normalizeObject(snapshotMetaRow.selector_meta);
  const lineageContract = selectorMeta && normalizeObject(selectorMeta.lineage_contract)
    ? selectorMeta.lineage_contract
    : buildLineageContract(selectorMeta);
  const selectorMetaWithLineage = selectorMeta && lineageContract
    ? Object.freeze({
        ...selectorMeta,
        lineage_contract: lineageContract,
      })
    : selectorMeta;
  const evidenceSnapshotSummary = buildEvidenceSnapshotSummary(replayFixtures && replayFixtures.episodes);
  const openclawExecutionSeparationSummary = buildOpenClawExecutionSeparationSummary(snapshotMetaRow);
  const runtimeChainAuditSummary = buildRuntimeChainAuditSummary(snapshotMetaRow);
  const repairEvidenceSummary = buildRepairEvidenceSummary(snapshotMetaRow);
  return Object.freeze({
    ok: true,
    generated_at: new Date().toISOString(),
    artifact_dir: artifactDir,
    source: "V2_PROMOTION_RUNTIME_SNAPSHOT",
    snapshot_meta: Object.freeze({
      ...snapshotMetaRow,
      ...(selectorMetaWithLineage ? { selector_meta: selectorMetaWithLineage } : {}),
      ...(lineageContract ? { lineage_contract: lineageContract } : {}),
      evidence_snapshot_summary: evidenceSnapshotSummary,
      ...(repairEvidenceSummary ? { repair_evidence_summary: repairEvidenceSummary } : {}),
      ...(openclawExecutionSeparationSummary ? { openclaw_execution_separation_summary: openclawExecutionSeparationSummary } : {}),
      ...(runtimeChainAuditSummary ? { runtime_chain_audit_summary: runtimeChainAuditSummary } : {}),
    }),
    snapshot_size_bytes: sizeBytes,
    counts: Object.freeze({
      episode_n: Array.isArray(replayFixtures.episodes) ? replayFixtures.episodes.length : 0,
      shadow_live_pair_n: Array.isArray(comparisonFixtures.shadowLivePairs) ? comparisonFixtures.shadowLivePairs.length : 0,
      source_mode_pair_n: Array.isArray(comparisonFixtures.sourceModePairs) ? comparisonFixtures.sourceModePairs.length : 0,
    }),
    outputs: Object.freeze({
      replay_fixtures_file: path.join(artifactDir, REPLAY_FIXTURES_FILENAME),
      comparison_fixtures_file: path.join(artifactDir, COMPARISON_FIXTURES_FILENAME),
      manifest_file: path.join(artifactDir, MANIFEST_FILENAME),
    }),
  });
}

async function main(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const rawSnapshot = resolveRuntimeSnapshotInput(env);
  const normalized = validateRuntimeSnapshot(rawSnapshot, { env });
  ensureDir(artifactDir);
  writeJson(path.join(artifactDir, REPLAY_FIXTURES_FILENAME), normalized.replayFixtures);
  writeJson(path.join(artifactDir, COMPARISON_FIXTURES_FILENAME), normalized.comparisonFixtures);
  const manifest = buildManifest({
    snapshotMeta: normalized.snapshotMeta,
    sizeBytes: normalized.sizeBytes,
    replayFixtures: normalized.replayFixtures,
    comparisonFixtures: normalized.comparisonFixtures,
    artifactDir,
  });
  writeJson(path.join(artifactDir, MANIFEST_FILENAME), manifest);
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_RUNTIME_SNAPSHOT_EXPORTED",
    artifact_dir: artifactDir,
    counts: manifest.counts,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("EXPORT_V2_PROMOTION_RUNTIME_SNAPSHOT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      trimOrNull,
      parsePositiveInt,
      normalizeObject,
      resolveArtifactDir,
      resolveRuntimeSnapshotInput,
      validateRuntimeSnapshot,
      buildEvidenceSnapshotSummary,
      buildOpenClawExecutionSeparationSummary,
      buildRuntimeChainAuditSummary,
      buildRepairEvidenceSummary,
      buildManifest,
      SNAPSHOT_FILENAME,
      REPLAY_FIXTURES_FILENAME,
      COMPARISON_FIXTURES_FILENAME,
      MANIFEST_FILENAME,
    },
  };
}
