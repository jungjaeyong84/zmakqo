#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { buildOpenClawPolicyCandidateFromRootCause } = require("../src/v2/openclawPolicyCandidateFromRootCause");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_INPUT = path.join(OPS_DAILY_DIR, "v2_openclaw_root_cause_analysis_latest.json");
const DEFAULT_OUTPUT = path.join(OPS_DAILY_DIR, "v2_openclaw_policy_candidate_from_root_cause_latest.json");
const DEFAULT_MD = path.join(OPS_DAILY_DIR, "v2_openclaw_policy_candidate_from_root_cause_latest.md");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, payload) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveRunId(env = process.env, analysis = {}) {
  return trimOrNull(env.V2_EVIDENCE_CYCLE_RUN_ID)
    || trimOrNull(env.OPENCLAW_RUN_ID)
    || trimOrNull(analysis.run_id)
    || trimOrNull(analysis.source_cycle_id)
    || null;
}

function renderMarkdown(payload) {
  const lines = [];
  lines.push("# V2 OpenClaw Policy Candidate From Root Cause");
  lines.push("");
  lines.push(`generated_at: ${payload.candidate && payload.candidate.generated_at ? payload.candidate.generated_at : "N/A"}`);
  lines.push(`candidate_id: ${payload.policy_candidate_id}`);
  lines.push(`decision: ${payload.decision}`);
  lines.push(`live_apply_allowed: ${payload.live_apply_allowed ? "true" : "false"}`);
  lines.push(`source_sample_n: ${payload.candidate && payload.candidate.source_sample_n != null ? payload.candidate.source_sample_n : "N/A"}`);
  lines.push("");
  lines.push("## Blockers");
  if (payload.blockers && payload.blockers.length) payload.blockers.forEach((code) => lines.push(`- ${code}`));
  else lines.push("- none");
  lines.push("");
  lines.push("## Shadow Actions");
  const actions = payload.candidate && Array.isArray(payload.candidate.actions) ? payload.candidate.actions : [];
  if (!actions.length) lines.push("- none");
  for (const action of actions) {
    lines.push(`- ${action.id} (${action.kind})`);
    lines.push(`  - status: ${action.status}`);
    lines.push(`  - description: ${action.description || ""}`);
    lines.push(`  - evidence: ${JSON.stringify(action.evidence || {})}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main(env = process.env) {
  const inputFile = path.resolve(trimOrNull(env.V2_OPENCLAW_POLICY_CANDIDATE_ROOT_CAUSE_FILE) || DEFAULT_INPUT);
  const outputFile = path.resolve(trimOrNull(env.V2_OPENCLAW_POLICY_CANDIDATE_OUTPUT_FILE) || DEFAULT_OUTPUT);
  const mdFile = path.resolve(trimOrNull(env.V2_OPENCLAW_POLICY_CANDIDATE_MARKDOWN_FILE) || DEFAULT_MD);
  const analysis = readJson(inputFile);
  const runId = resolveRunId(env, analysis);
  const payload = buildOpenClawPolicyCandidateFromRootCause({ analysis, env });
  const withFiles = Object.freeze({
    ...payload,
    run_id: runId,
    source_cycle_id: runId,
    manual_run: trimOrNull(env.V2_EVIDENCE_CYCLE_MANUAL_RUN) === "1",
    source_analysis_run_id: trimOrNull(analysis.run_id),
    input_file: inputFile,
    output_file: outputFile,
    markdown_file: mdFile,
  });
  writeJson(outputFile, withFiles);
  ensureDir(mdFile);
  fs.writeFileSync(mdFile, renderMarkdown(withFiles), "utf8");
  const line = JSON.stringify({
    ok: withFiles.ok,
    reason: withFiles.reason,
    decision: withFiles.decision,
    policy_candidate_id: withFiles.policy_candidate_id,
    action_n: withFiles.candidate.actions.length,
    blockers: withFiles.blockers,
    output_file: outputFile,
    markdown_file: mdFile,
  });
  if (withFiles.ok === true || String(env.V2_OPENCLAW_POLICY_CANDIDATE_SOFT || "0") === "1") console.log(line);
  else {
    console.error(line);
    process.exitCode = 1;
  }
  return withFiles;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_OPENCLAW_POLICY_CANDIDATE_FROM_ROOT_CAUSE_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    renderMarkdown,
    __test: { trimOrNull, readJson },
  };
}
