#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE_FILE = path.join(__dirname, "..", "src", "storage", "signalDrops.js");
const DEFAULT_ARTIFACT_FILE = path.join(__dirname, "..", "ops", "daily", "v2_canary_evolution_hygiene_latest.json");

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function numberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function readTextFile(file) {
  try {
    return { ok: true, text: fs.readFileSync(file, "utf8"), error: null };
  } catch (error) {
    return { ok: false, text: "", error };
  }
}

function readJsonFile(file) {
  try {
    return { ok: true, artifact: JSON.parse(fs.readFileSync(file, "utf8")), missing: false, error: null };
  } catch (error) {
    return { ok: false, artifact: null, missing: error && error.code === "ENOENT", error };
  }
}

function evaluateStaticSource({ sourceText = "", sourceReadOk = true, sourceFile = DEFAULT_SOURCE_FILE } = {}) {
  const checks = [];
  const blockers = [];

  function check(id, ok, blocker) {
    checks.push(Object.freeze({ id, ok: ok === true }));
    if (ok !== true) blockers.push(blocker);
  }

  check("source_readable", sourceReadOk === true, "CANARY_EVOLUTION_HYGIENE:SOURCE_READ_FAILED");
  check(
    "shadow_collection_present",
    sourceText.includes("v2__signals_canary_evolution_shadow"),
    "CANARY_EVOLUTION_HYGIENE:SHADOW_COLLECTION_MISSING"
  );
  check(
    "shadow_predicate_present",
    sourceText.includes("shouldShadowSelfEvolutionCanaryFromDrop"),
    "CANARY_EVOLUTION_HYGIENE:SHADOW_PREDICATE_MISSING"
  );
  check(
    "formal_confirm_predicate_present",
    sourceText.includes("shouldConfirmSelfEvolutionFromDrop"),
    "CANARY_EVOLUTION_HYGIENE:FORMAL_CONFIRM_PREDICATE_MISSING"
  );
  check(
    "formal_exclusion_reason_present",
    sourceText.includes("DISCOVERY_CANARY_EXCLUDED_FROM_FORMAL_SELF_EVOLUTION"),
    "CANARY_EVOLUTION_HYGIENE:FORMAL_EXCLUSION_REASON_MISSING"
  );
  check(
    "formal_evolution_forced_false_in_shadow_doc",
    /formal_self_evolution_confirmed\s*:\s*false/.test(sourceText),
    "CANARY_EVOLUTION_HYGIENE:SHADOW_DOC_FORMAL_FALSE_MISSING"
  );
  check(
    "discovery_canary_detector_present",
    sourceText.includes("isV2DiscoveryCanaryBridgePayload"),
    "CANARY_EVOLUTION_HYGIENE:DISCOVERY_CANARY_DETECTOR_MISSING"
  );

  return Object.freeze({
    ok: blockers.length === 0,
    source_file: sourceFile,
    checks: Object.freeze(checks),
    blockers: Object.freeze(blockers),
  });
}

function evaluateArtifact({
  artifact = null,
  artifactMissing = false,
  artifactReadError = null,
  artifactFile = DEFAULT_ARTIFACT_FILE,
  env = process.env,
} = {}) {
  const blockers = [];
  const warnings = [];
  const requireArtifact = parseBool(env.DONBEOLJA_V2_CANARY_EVOLUTION_HYGIENE_REQUIRE_ARTIFACT, false);

  if (artifactMissing) {
    if (requireArtifact) blockers.push("CANARY_EVOLUTION_HYGIENE:ARTIFACT_MISSING");
    else warnings.push("CANARY_EVOLUTION_HYGIENE:ARTIFACT_MISSING");
    return Object.freeze({
      ok: blockers.length === 0,
      artifact_file: artifactFile,
      artifact_missing: true,
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      metrics: Object.freeze({
        formal_dataset_canary_row_n: 0,
        shadow_dataset_canary_row_n: 0,
      }),
    });
  }

  if (artifactReadError) {
    blockers.push("CANARY_EVOLUTION_HYGIENE:ARTIFACT_READ_FAILED");
    return Object.freeze({
      ok: false,
      artifact_file: artifactFile,
      artifact_missing: false,
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      error: artifactReadError.message || String(artifactReadError),
      metrics: Object.freeze({
        formal_dataset_canary_row_n: 0,
        shadow_dataset_canary_row_n: 0,
      }),
    });
  }

  const metricsSource = artifact && artifact.metrics && typeof artifact.metrics === "object"
    ? artifact.metrics
    : artifact || {};
  const formalDatasetCanaryRowN = numberOrZero(
    metricsSource.formal_dataset_canary_row_n
      ?? metricsSource.formal_self_evolution_canary_row_n
      ?? metricsSource.canary_rows_in_formal_dataset_n
  );
  const shadowDatasetCanaryRowN = numberOrZero(
    metricsSource.shadow_dataset_canary_row_n
      ?? metricsSource.canary_evolution_shadow_row_n
      ?? metricsSource.shadowed_canary_row_n
  );

  if (artifact && artifact.ok === false) {
    const nested = Array.isArray(artifact.blockers) ? artifact.blockers : [];
    blockers.push(...(nested.length ? nested : ["CANARY_EVOLUTION_HYGIENE:ARTIFACT_NOT_OK"]));
  }
  if (formalDatasetCanaryRowN > 0) {
    blockers.push("CANARY_EVOLUTION_HYGIENE:FORMAL_DATASET_CANARY_CONTAMINATION");
  }

  return Object.freeze({
    ok: blockers.length === 0,
    artifact_file: artifactFile,
    artifact_missing: false,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(warnings),
    metrics: Object.freeze({
      formal_dataset_canary_row_n: formalDatasetCanaryRowN,
      shadow_dataset_canary_row_n: shadowDatasetCanaryRowN,
    }),
  });
}

function evaluateCanaryEvolutionHygiene({
  sourceText = "",
  sourceReadOk = true,
  sourceFile = DEFAULT_SOURCE_FILE,
  artifact = null,
  artifactMissing = false,
  artifactReadError = null,
  artifactFile = DEFAULT_ARTIFACT_FILE,
  env = process.env,
} = {}) {
  const staticResult = evaluateStaticSource({ sourceText, sourceReadOk, sourceFile });
  const artifactResult = evaluateArtifact({
    artifact,
    artifactMissing,
    artifactReadError,
    artifactFile,
    env,
  });
  const blockers = [
    ...staticResult.blockers,
    ...artifactResult.blockers,
  ];
  const warnings = [...artifactResult.warnings];

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_CANARY_EVOLUTION_HYGIENE_PASS"
      : "V2_CANARY_EVOLUTION_HYGIENE_BLOCKED",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(Array.from(new Set(warnings))),
    checks: staticResult.checks,
    source_file: sourceFile,
    artifact_file: artifactFile,
    artifact_missing: artifactResult.artifact_missing,
    metrics: artifactResult.metrics,
  });
}

function runCheck(env = process.env) {
  const sourceFile = trimOrNull(env.V2_CANARY_EVOLUTION_HYGIENE_SOURCE_FILE) || DEFAULT_SOURCE_FILE;
  const artifactFile = trimOrNull(env.V2_CANARY_EVOLUTION_HYGIENE_ARTIFACT_FILE) || DEFAULT_ARTIFACT_FILE;
  const source = readTextFile(sourceFile);
  const artifact = readJsonFile(artifactFile);

  return evaluateCanaryEvolutionHygiene({
    sourceText: source.text,
    sourceReadOk: source.ok,
    sourceFile,
    artifact: artifact.artifact,
    artifactMissing: artifact.missing,
    artifactReadError: artifact.ok ? null : (artifact.missing ? null : artifact.error),
    artifactFile,
    env,
  });
}

function main(env = process.env) {
  const result = runCheck(env);
  const out = JSON.stringify(result);
  if (result.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  main(process.env);
} else {
  module.exports = {
    DEFAULT_ARTIFACT_FILE,
    DEFAULT_SOURCE_FILE,
    evaluateArtifact,
    evaluateCanaryEvolutionHygiene,
    evaluateStaticSource,
    main,
    readJsonFile,
    readTextFile,
    runCheck,
    __test: { numberOrZero, parseBool, trimOrNull },
  };
}
