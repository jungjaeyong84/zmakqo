#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_OUTPUT_FILE,
  main: buildArtifact,
} = require("./build-v2-discovery-notional-cap-artifact");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function numberWithDefault(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function readArtifact(file) {
  try {
    return { artifact: JSON.parse(fs.readFileSync(file, "utf8")), missing: false, error: null };
  } catch (error) {
    return { artifact: null, missing: error && error.code === "ENOENT", error };
  }
}

function evaluateArtifact({ artifact, artifactMissing = false, artifactFile = DEFAULT_OUTPUT_FILE, env = process.env, nowMs = Date.now() } = {}) {
  const blockers = [];
  const warnings = [];
  const requireArtifact = parseBool(env.DONBEOLJA_V2_DISCOVERY_NOTIONAL_CAP_REQUIRE_ARTIFACT, false);
  const maxAgeMs = Math.max(0, numberWithDefault(env.DONBEOLJA_V2_DISCOVERY_NOTIONAL_CAP_MAX_AGE_MS, 6 * 60 * 60 * 1000));

  if (artifactMissing) {
    if (requireArtifact) blockers.push("DISCOVERY_NOTIONAL_CAP:ARTIFACT_MISSING");
    else warnings.push("DISCOVERY_NOTIONAL_CAP:ARTIFACT_MISSING");
    return Object.freeze({
      ok: blockers.length === 0,
      reason: blockers.length === 0
        ? "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_GATE_PASS"
        : "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_GATE_BLOCKED",
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      artifact_file: artifactFile,
      artifact_missing: true,
      metrics: null,
    });
  }

  const generatedMs = Date.parse(String(artifact && artifact.generated_at || ""));
  const ageMs = Number.isFinite(generatedMs) ? Math.max(0, nowMs - generatedMs) : null;
  if (!Number.isFinite(generatedMs)) blockers.push("DISCOVERY_NOTIONAL_CAP:GENERATED_AT_MISSING");
  if (Number.isFinite(ageMs) && maxAgeMs > 0 && ageMs > maxAgeMs) {
    blockers.push("DISCOVERY_NOTIONAL_CAP:ARTIFACT_STALE");
  }
  if (!artifact || artifact.ok !== true) {
    const nested = Array.isArray(artifact && artifact.blockers) ? artifact.blockers : [];
    blockers.push(...(nested.length ? nested : ["DISCOVERY_NOTIONAL_CAP:ARTIFACT_NOT_OK"]));
  }

  const evidence = artifact && artifact.evidence && typeof artifact.evidence === "object" ? artifact.evidence : {};
  const policy = artifact && artifact.policy && typeof artifact.policy === "object" ? artifact.policy : {};
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_GATE_PASS"
      : "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_GATE_BLOCKED",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(warnings),
    artifact_file: artifactFile,
    artifact_missing: false,
    artifact_age_ms: ageMs,
    max_age_ms: maxAgeMs,
    metrics: Object.freeze({
      total_configured_notional_quote: Number(evidence.total_configured_notional_quote) || 0,
      largest_notional_position_basket_quote: Number(evidence.largest_notional_position_basket_quote) || 0,
      btc_beta_configured_notional_quote: Number(evidence.btc_beta_configured_notional_quote) || 0,
      btc_beta_group_cap_headroom_quote: Number(evidence.btc_beta_group_cap_headroom_quote) || 0,
      risk_total_cap_quote: Number(policy.risk_total_cap_quote) || 0,
      risk_symbol_cap_quote: Number(policy.risk_symbol_cap_quote) || 0,
      risk_correlated_group_cap_quote: Number(policy.risk_correlated_group_cap_quote) || 0,
    }),
  });
}

function runCheck(env = process.env) {
  const artifactFile = trimOrNull(env.V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE) || DEFAULT_OUTPUT_FILE;
  let artifactResult = readArtifact(artifactFile);
  if (artifactResult.missing && parseBool(env.DONBEOLJA_V2_DISCOVERY_NOTIONAL_CAP_BUILD_IF_MISSING, true)) {
    buildArtifact({ ...env, V2_DISCOVERY_NOTIONAL_CAP_ARTIFACT_FILE: artifactFile });
    artifactResult = readArtifact(artifactFile);
  }
  if (artifactResult.error && !artifactResult.missing) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_NOTIONAL_CAP_CONSISTENCY_GATE_BLOCKED",
      blockers: Object.freeze(["DISCOVERY_NOTIONAL_CAP:ARTIFACT_READ_FAILED"]),
      warnings: Object.freeze([]),
      artifact_file: artifactFile,
      error: artifactResult.error.message || String(artifactResult.error),
    });
  }
  return evaluateArtifact({
    artifact: artifactResult.artifact,
    artifactMissing: artifactResult.missing,
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
    main,
    runCheck,
    evaluateArtifact,
    readArtifact,
    __test: { trimOrNull, numberWithDefault, parseBool },
  };
}
