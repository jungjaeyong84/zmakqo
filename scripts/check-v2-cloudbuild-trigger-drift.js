#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function normalizeTrigger(row = {}) {
  const substitutions = row.substitutions && typeof row.substitutions === "object" ? row.substitutions : {};
  const github = row.github && typeof row.github === "object" ? row.github : {};
  const push = github.push && typeof github.push === "object" ? github.push : {};
  return Object.freeze({
    id: trimOrNull(row.id),
    name: trimOrNull(row.name),
    disabled: row.disabled === true,
    filename: trimOrNull(row.filename),
    tag: trimOrNull(substitutions._TAG),
    commitSha: trimOrNull(substitutions._COMMIT_SHA),
    github_owner: trimOrNull(github.owner),
    github_name: trimOrNull(github.name),
    branch_pattern: trimOrNull(push.branch),
  });
}

function isMasterCloudBuildTrigger(trigger) {
  return trigger
    && trigger.filename === "cloudbuild.yaml"
    && (trigger.branch_pattern === "^master$" || trigger.branch_pattern === "master");
}

function evaluateCloudBuildTriggerDrift({ triggers = [] } = {}) {
  const rows = (Array.isArray(triggers) ? triggers : []).map(normalizeTrigger);
  const blockers = [];
  const offending = [];
  for (const trigger of rows) {
    if (trigger.disabled === true) continue;
    if (!isMasterCloudBuildTrigger(trigger)) continue;
    const rowBlockers = [];
    if (!trigger.tag) rowBlockers.push("TRIGGER_TAG_MISSING");
    if (trigger.tag === "latest") rowBlockers.push("TRIGGER_TAG_LATEST");
    if (trigger.tag && !/^v2-[0-9a-f]{8}$/i.test(trigger.tag)) rowBlockers.push("TRIGGER_TAG_NOT_V2_COMMIT_TAG");
    if (!trigger.commitSha) rowBlockers.push("TRIGGER_COMMIT_SHA_MISSING");
    if (trigger.commitSha === "unknown") rowBlockers.push("TRIGGER_COMMIT_SHA_UNKNOWN");
    if (trigger.commitSha && !/^[0-9a-f]{40}$/i.test(trigger.commitSha)) rowBlockers.push("TRIGGER_COMMIT_SHA_INVALID");
    if (rowBlockers.length) {
      blockers.push(`CLOUDBUILD_TRIGGER_DRIFT:${trigger.id || trigger.name || "UNKNOWN"}:${rowBlockers.join("+")}`);
      offending.push(Object.freeze({ ...trigger, blockers: Object.freeze(rowBlockers) }));
    }
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_CLOUDBUILD_TRIGGER_DRIFT_PASS" : "V2_CLOUDBUILD_TRIGGER_DRIFT_BLOCKED",
    blockers: Object.freeze(blockers),
    trigger_n: rows.length,
    offending_trigger_n: offending.length,
    offending_triggers: Object.freeze(offending),
  });
}

function loadTriggersFromEnv(env = process.env) {
  const raw = trimOrNull(env.V2_CLOUDBUILD_TRIGGERS_JSON);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function loadTriggersFromGcloud() {
  const out = execFileSync("gcloud", ["builds", "triggers", "list", "--format=json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? parsed : [];
}

function main(env = process.env) {
  if (parseBool(env.V2_CLOUDBUILD_TRIGGER_DRIFT_CHECK_DISABLED, false)) {
    const result = Object.freeze({
      ok: true,
      reason: "V2_CLOUDBUILD_TRIGGER_DRIFT_CHECK_DISABLED",
      blockers: Object.freeze([]),
    });
    console.log(JSON.stringify(result));
    return result;
  }
  let triggers;
  try {
    triggers = loadTriggersFromEnv(env) || loadTriggersFromGcloud();
  } catch (error) {
    const result = Object.freeze({
      ok: false,
      reason: "V2_CLOUDBUILD_TRIGGER_DRIFT_READ_FAILED",
      blockers: Object.freeze(["CLOUDBUILD_TRIGGER_DRIFT:READ_FAILED"]),
      error: error && error.message ? error.message : String(error),
    });
    console.error(JSON.stringify(result));
    process.exitCode = 1;
    return result;
  }
  const result = evaluateCloudBuildTriggerDrift({ triggers });
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
    normalizeTrigger,
    evaluateCloudBuildTriggerDrift,
    loadTriggersFromEnv,
    __test: { trimOrNull, parseBool, isMasterCloudBuildTrigger },
  };
}
