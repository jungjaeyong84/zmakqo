#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveV2RuntimeConfig } = require("../src/v2/runtime");
const { buildUnifiedPromotionReport } = require("../src/v2/unifiedPromotionReport");
const { hasLineageContract, contractsMatch } = require("./lib/v2-promotion-lineage-contract");

const ARTIFACT_FILENAMES = Object.freeze({
  replayReport: "replay-report.json",
  shadowLiveComparisonReport: "shadow-live-comparison.json",
  sourceModeComparisonReport: "source-mode-comparison.json",
  runtimeManifest: "promotion-runtime-manifest.json",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function readJsonFromFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  return JSON.parse(raw);
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR);
}

function resolveArtifactFilePath(artifactDir, logicalName) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  const filename = ARTIFACT_FILENAMES[logicalName];
  if (!filename) throw new Error(`ARTIFACT_LOGICAL_NAME_INVALID:${logicalName}`);
  return path.resolve(dir, filename);
}

function readJsonInput({ logicalName, fileEnv, jsonEnv, required = true }, env = process.env) {
  const filePath = trimOrNull(env[fileEnv]);
  if (filePath) return readJsonFromFile(filePath);
  const inline = trimOrNull(env[jsonEnv]);
  if (inline) return JSON.parse(inline);
  const artifactDir = resolveArtifactDir(env);
  const artifactFilePath = resolveArtifactFilePath(artifactDir, logicalName);
  if (artifactFilePath && fs.existsSync(artifactFilePath)) {
    return readJsonFromFile(artifactFilePath);
  }
  if (required) throw new Error(`${fileEnv}_OR_${jsonEnv}_REQUIRED`);
  return null;
}

function resolveGateInputs(env = process.env) {
  const cfg = resolveV2RuntimeConfig(env);
  return Object.freeze({
    mode: upper(env.V2_PROMOTION_MODE) || "CANARY",
    policy: cfg.defaultDeployGatePolicy,
    replayReport: readJsonInput({
      logicalName: "replayReport",
      fileEnv: "V2_PROMOTION_REPLAY_FILE",
      jsonEnv: "V2_PROMOTION_REPLAY_JSON",
      required: true,
    }, env),
    shadowLiveComparisonReport: readJsonInput({
      logicalName: "shadowLiveComparisonReport",
      fileEnv: "V2_PROMOTION_SHADOW_LIVE_FILE",
      jsonEnv: "V2_PROMOTION_SHADOW_LIVE_JSON",
      required: true,
    }, env),
    sourceModeComparisonReport: readJsonInput({
      logicalName: "sourceModeComparisonReport",
      fileEnv: "V2_PROMOTION_SOURCE_MODE_FILE",
      jsonEnv: "V2_PROMOTION_SOURCE_MODE_JSON",
      required: true,
    }, env),
    runtimeManifest: readJsonInput({
      logicalName: "runtimeManifest",
      fileEnv: "V2_PROMOTION_RUNTIME_MANIFEST_FILE",
      jsonEnv: "V2_PROMOTION_RUNTIME_MANIFEST_JSON",
      required: false,
    }, env),
  });
}

function buildProvenanceBlockers(inputs) {
  const blockers = [];
  const row = inputs && typeof inputs === "object" ? inputs : {};
  const mode = upper(row.mode) || "CANARY";
  if (mode === "SHADOW") return blockers;

  const manifest = row.runtimeManifest && typeof row.runtimeManifest === "object" ? row.runtimeManifest : null;
  if (!manifest) {
    blockers.push("PROVENANCE:MANIFEST_REQUIRED");
    return blockers;
  }
  const selectorMeta = manifest.snapshot_meta && typeof manifest.snapshot_meta === "object"
    ? manifest.snapshot_meta.selector_meta
    : null;
  const manifestLineageContract = manifest.snapshot_meta && typeof manifest.snapshot_meta === "object"
    ? manifest.snapshot_meta.lineage_contract
    : null;
  if (!selectorMeta || typeof selectorMeta !== "object") {
    blockers.push("PROVENANCE:SELECTOR_META_REQUIRED");
    return blockers;
  }
  if (!trimOrNull(selectorMeta.position_cycle_id)) {
    blockers.push("PROVENANCE:POSITION_CYCLE_ID_REQUIRED");
  }
  const checks = selectorMeta.alignment_checks && typeof selectorMeta.alignment_checks === "object"
    ? selectorMeta.alignment_checks
    : null;
  if (!checks) {
    blockers.push("PROVENANCE:ALIGNMENT_CHECKS_REQUIRED");
    return blockers;
  }
  if (!hasLineageContract(selectorMeta.lineage_contract) || !hasLineageContract(manifestLineageContract)) {
    blockers.push("PROVENANCE:LINEAGE_CONTRACT_REQUIRED");
  } else if (!contractsMatch(selectorMeta.lineage_contract, manifestLineageContract)) {
    blockers.push("PROVENANCE:LINEAGE_CONTRACT_MISMATCH");
  }
  if (checks.symbol_match !== true) blockers.push("PROVENANCE:SYMBOL_MISMATCH");
  if (checks.side_match !== true) blockers.push("PROVENANCE:SIDE_MISMATCH");
  if (checks.timeframe_match !== true) blockers.push("PROVENANCE:TIMEFRAME_MISMATCH");
  if (checks.policy_scope_match !== true) blockers.push("PROVENANCE:POLICY_SCOPE_MISMATCH");

  const counts = manifest.counts && typeof manifest.counts === "object" ? manifest.counts : null;
  if (!counts) {
    blockers.push("PROVENANCE:MANIFEST_COUNTS_REQUIRED");
    return blockers;
  }
  const replayEpisodeN = Number(row.replayReport && row.replayReport.episode_n);
  const shadowLivePairN = Number(row.shadowLiveComparisonReport && row.shadowLiveComparisonReport.pair_n);
  const sourceModePairN = Number(row.sourceModeComparisonReport && row.sourceModeComparisonReport.pair_n);
  if (Number(counts.episode_n) !== replayEpisodeN) {
    blockers.push("PROVENANCE:REPLAY_EPISODE_COUNT_MISMATCH");
  }
  if (Number(counts.shadow_live_pair_n) !== shadowLivePairN) {
    blockers.push("PROVENANCE:SHADOW_LIVE_PAIR_COUNT_MISMATCH");
  }
  if (Number(counts.source_mode_pair_n) !== sourceModePairN) {
    blockers.push("PROVENANCE:SOURCE_MODE_PAIR_COUNT_MISMATCH");
  }
  return blockers;
}

function buildGateFailureReasons(report) {
  const reasons = [];
  const row = report && typeof report === "object" ? report : null;
  if (!row) return ["UNIFIED_PROMOTION_REPORT_MISSING"];
  reasons.push(...Array.isArray(row.blockers) ? row.blockers : []);
  return reasons;
}

function evaluateGateFromEnv(env = process.env) {
  const inputs = resolveGateInputs(env);
  const report = buildUnifiedPromotionReport(inputs);
  const provenanceBlockers = buildProvenanceBlockers(inputs);
  const mergedReport = provenanceBlockers.length
    ? Object.freeze({
        ...report,
        pass: false,
        failClosed: true,
        block_n: Number(report.block_n || 0) + provenanceBlockers.length,
        blockers: [...(Array.isArray(report.blockers) ? report.blockers : []), ...provenanceBlockers],
      })
    : report;
  return Object.freeze({ inputs, report: mergedReport });
}

async function main(env = process.env) {
  let result = null;
  try {
    result = evaluateGateFromEnv(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_GATE_THROWN",
      error: {
        message: error && error.message ? error.message : String(error),
      },
    }));
    process.exit(1);
  }

  const { report } = result;
  if (report.pass !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_GATE_BLOCKED",
      mode: report.mode,
      blockers: buildGateFailureReasons(report),
      warnings: Array.isArray(report.warnings) ? report.warnings : [],
      report,
    }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
      reason: "V2_PROMOTION_GATE_PASS",
      mode: report.mode,
      warnings: Array.isArray(report.warnings) ? report.warnings : [],
      report,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_PROMOTION_GATE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      trimOrNull,
      upper,
      resolveArtifactDir,
      resolveArtifactFilePath,
      ARTIFACT_FILENAMES,
      readJsonInput,
      resolveGateInputs,
      buildProvenanceBlockers,
      buildGateFailureReasons,
      evaluateGateFromEnv,
    },
  };
}
