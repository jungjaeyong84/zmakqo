"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { auditV2FillSyncCanonicalBoundary, __test } = require("../v2/fillSyncCanonicalBoundaryAudit");

const ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

(function currentWorkspacePassesBoundaryAudit() {
  const audit = auditV2FillSyncCanonicalBoundary({
    fillSyncSource: readRepoFile("src/services/binanceFuturesFillsSync.js"),
    shadowExitWriterSource: readRepoFile("src/v2/openclawShadowExitWriter.js"),
  });
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.reason, "V2_FILL_SYNC_CANONICAL_BOUNDARY_PASS");
})();

(function missingBatchEvidenceValidatorFailsClosed() {
  const fillSyncSource = `
    const { normalizeV2ExitFillEvidence } = require("../v2/exitFillIngestion");
    function resolveLegacyCanonicalTp1WriteGate() { return { ok: true }; }
    function resolveLegacyCanonicalStopWriteGate() { return { ok: true }; }
    function resolveLegacyCanonicalExternalCloseWriteGate() { return { ok: true }; }
    async function recordCanonicalExitTransitionsForFill() {
      return recordCanonicalExitTransitions({});
    }
    function resolveLegacyCanonicalWriteDecision() {}
    function hasV2CanonicalBatchWrittenGate() {}
    const marker = "V2_BATCH_CANONICAL_ALREADY_WRITTEN DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED";
    const legacyCanonicalWriteDecision = { write: true };
    const canonicalExitWriteAllowed = legacyCanonicalWriteDecision.write === true
      && legacyCanonicalTp1Gate.ok === true
      && legacyCanonicalStopGate.ok === true
      && legacyCanonicalExternalCloseGate.ok === true;
    if (canonicalExitWriteAllowed) {
      await recordCanonicalExitTransitionsForFill({});
    }
  `;
  const audit = auditV2FillSyncCanonicalBoundary({
    fillSyncSource,
    shadowExitWriterSource: "const { putV2DocsBatch } = require('./storage'); async function commitCanonicalExitArtifacts() { return putV2DocsBatch({}); }",
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_FILL_SYNC_HAS_BATCH_EVIDENCE_VALIDATOR"));
  assert.ok(audit.failed_check_ids.includes("V2_FILL_SYNC_TP1_LEGACY_GATE_REQUIRES_BATCH_EVIDENCE"));
})();

(function directCanonicalRecordCallOutsideWrapperFailsClosed() {
  const fillSyncSource = readRepoFile("src/services/binanceFuturesFillsSync.js")
    .replace(
      "console.warn(\"[BINANCEFUT_CANONICAL_EXIT_TRANSITION_RECORD_FAIL]\", transitionErr && transitionErr.message ? transitionErr.message : String(transitionErr));",
      "recordCanonicalExitTransitions({});\n          console.warn(\"[BINANCEFUT_CANONICAL_EXIT_TRANSITION_RECORD_FAIL]\", transitionErr && transitionErr.message ? transitionErr.message : String(transitionErr));"
    );
  const audit = auditV2FillSyncCanonicalBoundary({
    fillSyncSource,
    shadowExitWriterSource: readRepoFile("src/v2/openclawShadowExitWriter.js"),
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_FILL_SYNC_CANONICAL_TRANSITION_RECORD_CALL_WRAPPED"));
})();

(function functionBlockSlicerFindsValidatorInsideGate() {
  const block = __test.sliceFunctionBlock(readRepoFile("src/services/binanceFuturesFillsSync.js"), "resolveLegacyCanonicalTp1WriteGate");
  assert.ok(block.includes("validateV2ShadowCanonicalBatchWrite"));
})();

(function reducedFillWriterMustReturnCanonicalOutboxEvidence() {
  const source = readRepoFile("src/v2/openclawShadowExitWriter.js").replace(
    "canonical_transition_id: reduced.transition.canonical_transition_id,",
    "canonical_transition_id: null,"
  );
  const audit = auditV2FillSyncCanonicalBoundary({
    fillSyncSource: readRepoFile("src/services/binanceFuturesFillsSync.js"),
    shadowExitWriterSource: source,
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_SHADOW_EXIT_WRITER_RETURNS_CANONICAL_OUTBOX_EVIDENCE"));
})();

console.log("V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_TEST_OK");
