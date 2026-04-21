"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { evaluateOpenClawExecutionSeparation } = require("../v2/openclawExecutionSeparationAudit");
const { buildOpenClawExecutionAuditDoc } = require("../v2/contracts");
const {
  isOpenClawExecutionAuditLedgerWriteEnabled,
  persistOpenClawExecutionAudit,
} = require("../v2/openclawExecutionAuditLedger");

function buildFakeDb(calls) {
  return {
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", id });
          return {
            async set(payload, options) {
              calls.push({ type: "set", payload, options });
            },
          };
        },
      };
    },
  };
}

function buildAudit() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__AUDIT_LEDGER",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.82,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "audit ledger fixture",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.72,
      volatility_rank: 0.41,
    },
    proposalVerdict: "PASS",
    rankScore: 0.69,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_audit_ledger",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "deterministic router may create canary entry intent",
  });
  return evaluateOpenClawExecutionSeparation({ bundle });
}

(function writeEnableFlagDefaultsOff() {
  assert.strictEqual(isOpenClawExecutionAuditLedgerWriteEnabled({}), false);
  assert.strictEqual(isOpenClawExecutionAuditLedgerWriteEnabled({
    DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
  }), true);
})();

(function buildAuditDocUsesAuditIdAsCanonicalDocId() {
  const audit = buildAudit();
  const doc = buildOpenClawExecutionAuditDoc({
    audit,
    positionCycleId: "PCY__ETH__AUDIT",
    artifactRunId: "RUN__AUDIT",
    recordedAt: "2026-04-21T04:00:00.000Z",
  });
  assert.strictEqual(doc.openclaw_execution_audit_id, audit.audit_id);
  assert.strictEqual(doc.audit_id, audit.audit_id);
  assert.strictEqual(doc.position_cycle_id, "PCY__ETH__AUDIT");
  assert.strictEqual(doc.ok, true);
  assert.strictEqual(doc.fail_n, 0);
  assert.strictEqual(doc.audit_snapshot.audit_id, audit.audit_id);
})();

(async function persistAuditSkipsWhenLedgerWriteDisabled() {
  const calls = [];
  const audit = buildAudit();
  const result = await persistOpenClawExecutionAudit({
    db: buildFakeDb(calls),
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    audit,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function persistAuditWritesDedicatedV2CollectionWhenEnabled() {
  const calls = [];
  const audit = buildAudit();
  const result = await persistOpenClawExecutionAudit({
    db: buildFakeDb(calls),
    env: {
      DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
      DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    },
    audit,
    positionCycleId: "PCY__ETH__AUDIT",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.persisted.collectionName, "dbjv2__openclaw_execution_audits_v2");
  assert.deepStrictEqual(calls[0], { type: "collection", name: "dbjv2__openclaw_execution_audits_v2" });
  assert.deepStrictEqual(calls[1], { type: "doc", id: audit.audit_id });
  assert.strictEqual(calls[2].type, "set");
  assert.strictEqual(calls[2].payload.position_cycle_id, "PCY__ETH__AUDIT");
  assert.deepStrictEqual(calls[2].options, { merge: true });
})();

console.log("V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_TEST_OK");
