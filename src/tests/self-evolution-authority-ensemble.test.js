"use strict";

const assert = require("assert");
const { deriveAuthorityEnsemble } = require("../../src/utils/selfEvolutionAuthorityEnsemble");

(() => {
  const consensus = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE", confidence: 0.8 },
    claudeReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE", confidence: 0.6 },
  });
  assert.strictEqual(consensus.owner, "CODEX_CLAUDE_ENSEMBLE");
  assert.strictEqual(consensus.verdict, "PROMOTE");
  assert.strictEqual(consensus.recommended_candidate_id, "AUTO_CORE");
  assert.strictEqual(consensus.consensus, true);

  const disagreement = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "FRESH", verdict: "HOLD" },
  });
  assert.strictEqual(disagreement.verdict, "HOLD");
  assert.strictEqual(disagreement.reason, "AUTHORITY_DISAGREEMENT");
  assert.ok(disagreement.blockers.includes("AUTHORITY_DISAGREEMENT"));

  const degraded = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "SKIPPED", verdict: "HOLD" },
  });
  assert.strictEqual(degraded.verdict, "HOLD");
  assert.ok(degraded.blockers.includes("CLAUDE_REVIEW_REQUIRED"));

  const codexOnly = deriveAuthorityEnsemble({
    authorityMode: "CODEX_ONLY",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "FAILED", verdict: "HOLD" },
  });
  assert.strictEqual(codexOnly.owner, "CODEX");
  assert.strictEqual(codexOnly.verdict, "PROMOTE");
  console.log("SELF_EVOLUTION_AUTHORITY_ENSEMBLE_TEST_OK");
})();
