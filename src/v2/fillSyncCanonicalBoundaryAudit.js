"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildCheck(id, ok, reason, evidence = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    evidence: Object.freeze({ ...evidence }),
  });
}

function countPattern(source, pattern) {
  const text = String(source || "");
  const regex = pattern instanceof RegExp
    ? new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)
    : new RegExp(String(pattern || ""), "g");
  return Array.from(text.matchAll(regex)).length;
}

function sliceFunctionBlock(source, functionName) {
  const text = String(source || "");
  const name = trimOrNull(functionName);
  if (!name) return "";
  const marker = `function ${name}`;
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const rest = text.slice(start + marker.length);
  const next = rest.search(/\n(?:async\s+)?function\s+[A-Za-z0-9_]+\s*\(/);
  return next >= 0 ? text.slice(start, start + marker.length + next) : text.slice(start);
}

function functionCallsBatchValidator(source, functionName) {
  const block = sliceFunctionBlock(source, functionName);
  return block.includes("validateV2ShadowCanonicalBatchWrite");
}

function hasAllRequiredBatchArtifacts(source) {
  const text = String(source || "");
  return [
    "CANONICAL_EXIT_TRANSITIONS",
    "EXIT_RUNTIME_PROJECTIONS",
    "TRADE_ALERT_OUTBOX",
  ].every((token) => text.includes(token));
}

function reducedFillWriterReturnsOperatorEvidence(source) {
  const block = sliceFunctionBlock(source, "commitReducedExitFillArtifacts");
  return block.includes("canonical_transition_id: reduced.transition.canonical_transition_id")
    && block.includes("alert_outbox_id:")
    && block.includes("write_mode: writeResult.write_mode")
    && block.includes("writes: batchWrites(writeResult)")
    && block.includes("buildPersistedPreparedAlertOutbox")
    && block.includes("deliverPreparedExitTransitionAlert");
}

function legacyCanonicalBackfillIsExplicitOnly(source) {
  const block = sliceFunctionBlock(source, "resolveLegacyCanonicalWriteDecision");
  return block.includes("v2BatchWritten && !isLegacyCanonicalBackfillEnabled(env)")
    && block.includes("V2_BATCH_CANONICAL_ALREADY_WRITTEN")
    && block.includes("LEGACY_CANONICAL_BACKFILL_ENABLED")
    && block.includes("LEGACY_CANONICAL_WRITE_ALLOWED")
    && String(source || "").includes("DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED");
}

function auditV2FillSyncCanonicalBoundary({
  fillSyncSource = "",
  shadowExitWriterSource = "",
} = {}) {
  const fill = String(fillSyncSource || "");
  const writer = String(shadowExitWriterSource || "");
  const directRecordCallN = countPattern(fill, /\brecordCanonicalExitTransitions\s*\(/);
  const checks = [
    buildCheck(
      "V2_FILL_SYNC_IMPORTS_EXIT_FILL_INGESTION",
      fill.includes("normalizeV2ExitFillEvidence"),
      "fill sync must normalize V2 exit evidence before invoking V2 shadow writers"
    ),
    buildCheck(
      "V2_FILL_SYNC_HAS_BATCH_EVIDENCE_VALIDATOR",
      fill.includes("validateV2ShadowCanonicalBatchWrite")
        && fill.includes("V2_SHADOW_CANONICAL_BATCH_EVIDENCE_MISSING"),
      "legacy canonical gate must have a batch evidence validator"
    ),
    buildCheck(
      "V2_FILL_SYNC_BATCH_VALIDATOR_REQUIRES_BATCH_MODE",
      /write_mode[\s\S]{0,120}BATCH/.test(fill),
      "legacy canonical gate must require write_mode=BATCH"
    ),
    buildCheck(
      "V2_FILL_SYNC_BATCH_VALIDATOR_REQUIRES_CANONICAL_ARTIFACTS",
      hasAllRequiredBatchArtifacts(fill),
      "legacy canonical gate must require transition/projection/outbox write evidence"
    ),
    buildCheck(
      "V2_FILL_SYNC_TP1_LEGACY_GATE_REQUIRES_BATCH_EVIDENCE",
      functionCallsBatchValidator(fill, "resolveLegacyCanonicalTp1WriteGate"),
      "TP1 legacy canonical gate must require V2 batch evidence"
    ),
    buildCheck(
      "V2_FILL_SYNC_STOP_LEGACY_GATE_REQUIRES_BATCH_EVIDENCE",
      functionCallsBatchValidator(fill, "resolveLegacyCanonicalStopWriteGate"),
      "SL/TRAIL legacy canonical gate must require V2 batch evidence"
    ),
    buildCheck(
      "V2_FILL_SYNC_EXTERNAL_LEGACY_GATE_REQUIRES_BATCH_EVIDENCE",
      functionCallsBatchValidator(fill, "resolveLegacyCanonicalExternalCloseWriteGate"),
      "EXTERNAL/MANUAL legacy canonical gate must require V2 batch evidence"
    ),
    buildCheck(
      "V2_FILL_SYNC_CANONICAL_TRANSITION_RECORD_CALL_WRAPPED",
      directRecordCallN === 1,
      "recordCanonicalExitTransitions must be called only by recordCanonicalExitTransitionsForFill wrapper",
      { direct_record_call_n: directRecordCallN }
    ),
    buildCheck(
      "V2_FILL_SYNC_CANONICAL_RECORD_GUARDED_BY_V2_BATCH_GATE",
      fill.includes("resolveLegacyCanonicalWriteDecision")
        && fill.includes("const canonicalExitWriteAllowed = legacyCanonicalWriteDecision.write === true")
        && fill.includes("legacyCanonicalTp1Gate.ok === true")
        && fill.includes("legacyCanonicalStopGate.ok === true")
        && fill.includes("legacyCanonicalExternalCloseGate.ok === true")
        && /if\s*\(\s*canonicalExitWriteAllowed\s*\)\s*\{[\s\S]{0,500}recordCanonicalExitTransitionsForFill/.test(fill),
      "legacy canonical record call must stay behind the combined V2 shadow gate"
    ),
    buildCheck(
      "V2_FILL_SYNC_LEGACY_CANONICAL_SKIPS_AFTER_V2_BATCH",
      fill.includes("V2_BATCH_CANONICAL_ALREADY_WRITTEN")
        && fill.includes("DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED")
        && fill.includes("hasV2CanonicalBatchWrittenGate"),
      "legacy canonical transition/stage-hint writes must skip by default after a V2 canonical batch write"
    ),
    buildCheck(
      "V2_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_EXPLICIT_ONLY",
      legacyCanonicalBackfillIsExplicitOnly(fill),
      "legacy canonical writes after V2 batch ownership must be explicit backfill-only, not an implicit fallback"
    ),
    buildCheck(
      "V2_SHADOW_EXIT_WRITER_USES_BATCH_STORAGE",
      writer.includes("putV2DocsBatch")
        && writer.includes("commitCanonicalExitArtifacts")
        && !/\bputV2Doc\s*\(/.test(writer),
      "V2 shadow exit writer must write canonical artifacts through batch storage only"
    ),
    buildCheck(
      "V2_SHADOW_EXIT_WRITER_USES_EXIT_FILL_REDUCER",
      writer.includes("reduceV2ExitFill")
        && writer.includes("commitReducedExitFillArtifacts"),
      "V2 shadow exit writer must reduce TP1/SL/TRAIL final/EXTERNAL fills through the canonical fill reducer"
    ),
    buildCheck(
      "V2_SHADOW_EXIT_WRITER_BATCHES_REDUCED_FILL_ARTIFACTS",
      writer.includes("commitReducedExitFillArtifacts")
        && writer.includes("commitCanonicalExitArtifacts")
        && writer.includes("TRADE_ALERT_OUTBOX"),
      "reduced fill transition/projection/outbox must be committed in one canonical artifact batch"
    ),
    buildCheck(
      "V2_SHADOW_EXIT_WRITER_RETURNS_CANONICAL_OUTBOX_EVIDENCE",
      reducedFillWriterReturnsOperatorEvidence(writer),
      "reduced fill writer must return canonical_transition_id, alert_outbox_id, write_mode, and batch writes as operator evidence"
    ),
  ];
  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "V2_FILL_SYNC_CANONICAL_BOUNDARY_PASS" : "V2_FILL_SYNC_CANONICAL_BOUNDARY_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    checks: Object.freeze(checks),
  });
}

module.exports = {
  auditV2FillSyncCanonicalBoundary,
  __test: {
    trimOrNull,
    buildCheck,
    countPattern,
    sliceFunctionBlock,
    functionCallsBatchValidator,
    hasAllRequiredBatchArtifacts,
    reducedFillWriterReturnsOperatorEvidence,
    legacyCanonicalBackfillIsExplicitOnly,
  },
};
