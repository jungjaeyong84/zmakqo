#!/usr/bin/env node
"use strict";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function resolveCloudBuildSubstitutions(env = process.env) {
  return Object.freeze({
    tag: trimOrNull(env._TAG) || trimOrNull(env.TAG),
    commitSha: trimOrNull(env._COMMIT_SHA) || trimOrNull(env.COMMIT_SHA),
  });
}

function evaluateCloudBuildSubstitutions({ tag, commitSha } = {}) {
  const blockers = [];
  const resolvedTag = trimOrNull(tag);
  const resolvedCommitSha = trimOrNull(commitSha);
  if (!resolvedTag) blockers.push("CLOUDBUILD_SUBSTITUTIONS:TAG_MISSING");
  if (resolvedTag === "latest") blockers.push("CLOUDBUILD_SUBSTITUTIONS:TAG_LATEST_FORBIDDEN");
  if (resolvedTag && !/^v2-[0-9a-f]{8}$/i.test(resolvedTag)) blockers.push("CLOUDBUILD_SUBSTITUTIONS:TAG_NOT_V2_COMMIT_TAG");
  if (!resolvedCommitSha) blockers.push("CLOUDBUILD_SUBSTITUTIONS:COMMIT_SHA_MISSING");
  if (resolvedCommitSha === "unknown") blockers.push("CLOUDBUILD_SUBSTITUTIONS:COMMIT_SHA_UNKNOWN_FORBIDDEN");
  if (resolvedCommitSha && !/^[0-9a-f]{40}$/i.test(resolvedCommitSha)) blockers.push("CLOUDBUILD_SUBSTITUTIONS:COMMIT_SHA_INVALID");
  if (resolvedTag && resolvedCommitSha && /^v2-[0-9a-f]{8}$/i.test(resolvedTag) && /^[0-9a-f]{40}$/i.test(resolvedCommitSha)) {
    const shortSha = resolvedCommitSha.slice(0, 8).toLowerCase();
    if (resolvedTag.slice(3).toLowerCase() !== shortSha) blockers.push("CLOUDBUILD_SUBSTITUTIONS:TAG_COMMIT_SHA_MISMATCH");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_CLOUDBUILD_SUBSTITUTIONS_PASS" : "V2_CLOUDBUILD_SUBSTITUTIONS_BLOCKED",
    blockers: Object.freeze(blockers),
    tag: resolvedTag,
    commit_sha: resolvedCommitSha,
  });
}

function main(env = process.env) {
  const result = evaluateCloudBuildSubstitutions(resolveCloudBuildSubstitutions(env));
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
    resolveCloudBuildSubstitutions,
    evaluateCloudBuildSubstitutions,
    __test: { trimOrNull },
  };
}
