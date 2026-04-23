"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { auditV2ProductionRuntimeChain } = require("../v2/productionRuntimeChainAudit");

const ROOT = path.resolve(__dirname, "../..");

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), "utf8");
}

function auditWithOverride(relPath, replacer) {
  const source = readRepoFile(relPath);
  const nextSource = typeof replacer === "function" ? replacer(source) : String(replacer || "");
  return auditV2ProductionRuntimeChain({
    sourceOverrides: {
      [relPath]: nextSource,
    },
  });
}

(function currentWorkspacePassesProductionRuntimeChainAudit() {
  const audit = auditV2ProductionRuntimeChain();
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.reason, "V2_PRODUCTION_RUNTIME_CHAIN_PASS");
})();

(function missingOpenClawPermitFailsClosed() {
  const audit = auditWithOverride("src/v2/productionEntryRoute.js", (source) => source.replace(/validateOpenClawExecutionPermit/g, "permitValidatorRemoved"));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_ENTRY_ROUTE_PERMIT_AND_KERNEL"));
})();

(function missingProtectionRequirementFailsClosed() {
  const audit = auditWithOverride("src/v2/entryExecutionKernel.js", (source) => source.replace(/TP1_ORDER_PRESENT/g, "nativeTpEvidenceRemoved"));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_ENTRY_KERNEL_REQUIRES_PROTECTION"));
})();

(function missingMlAiProposalGateFailsClosed() {
  const audit = auditWithOverride("src/v2/signalAuthorityRouter.js", (source) => source.replace(
    /ML_AI_PROPOSAL_NOT_APPROVED/g,
    "ML_AI_PROPOSAL_GATE_REMOVED"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_ML_AI_PROPOSAL_AND_SIZE_CAP_ENFORCED"));
})();

(function missingMlSizeRatioCapFailsClosed() {
  const audit = auditWithOverride("src/v2/entrySizingDecision.js", (source) => source.replace(
    /ML_SIZE_RATIO_CAPPED/g,
    "ML_SIZE_RATIO_CAP_REMOVED"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_ML_AI_PROPOSAL_AND_SIZE_CAP_ENFORCED"));
})();

(function missingReducedFillReducerFailsClosed() {
  const audit = auditWithOverride("src/v2/openclawShadowExitWriter.js", (source) => source.replace(/reduceV2ExitFill/g, "exitFillReducerRemoved"));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_FILL_SYNC_BOUNDARY_PASS"));
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_REDUCED_FILL_WRITES_BATCH_ALERT"));
})();

(function implicitLegacyCanonicalBackfillFailsClosed() {
  const audit = auditWithOverride("src/services/binanceFuturesFillsSync.js", (source) => source.replace(
    /DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED/g,
    "legacyCanonicalBackfillEnvRemoved"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_FILL_SYNC_BOUNDARY_PASS"));
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_FILL_SYNC_EXPLICIT_LEGACY_BACKFILL"));
})();

(function missingTrailNativeRefreshGateFailsClosed() {
  const audit = auditWithOverride("src/v2/openclawShadowExitWriter.js", (source) => source.replace(
    "refreshStatus !== \"OK\"",
    "refreshStatus === \"IGNORED\""
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_TRAIL_ACTIVATION_REQUIRES_NATIVE_OK"));
})();

(function missingTickNativeRefreshAuthorityFailsClosed() {
  const audit = auditWithOverride("src/services/binanceTickExit.js", (source) => source.replace(
    "nativeRefresh.ok !== true",
    "nativeRefresh.ok === \"ignored\""
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_TICK_NATIVE_REFRESH_SINGLE_WRITER"));
})();

(function missingProtectionWriteDeadlineFailsClosed() {
  const audit = auditWithOverride("src/v2/binanceProtectionTransport.js", (source) => source.replace(
    /withProtectionWriteDeadline/g,
    "protectionDeadlineRemoved"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_PROTECTION_WRITE_DEADLINE_ENFORCED"));
})();

(function stringOnlyProtectionDeadlineTokensFailClosed() {
  const audit = auditV2ProductionRuntimeChain({
    sourceOverrides: {
      "src/v2/binanceProtectionTransport.js": `
        function withProtectionWriteDeadline(operation) {
          const fake = "new AbortController signal, BINANCE_NATIVE_STOP_REFRESH_DEADLINE_EXCEEDED BINANCE_TP1_REPAIR_DEADLINE_EXCEEDED BINANCE_FULL_PROTECTION_SL_DEADLINE_EXCEEDED BINANCE_FULL_PROTECTION_TP1_DEADLINE_EXCEEDED";
          return operation();
        }
        function buildBinanceRefreshNativeStopTransport() {
          const fake = "withProtectionWriteDeadline refreshNativeProtectionWithRetry signal abortSignal";
        }
        function buildBinancePlaceOrReplaceTp1Transport() {
          const fake = "withProtectionWriteDeadline placeTakeProfitMarketOrder signal";
        }
        function buildBinancePlaceOrReplaceFullProtectionTransport() {
          const fake = "withProtectionWriteDeadline placeStopMarketOrder placeTakeProfitMarketOrder signal";
        }
      `,
    },
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_PROTECTION_WRITE_DEADLINE_ENFORCED"));
})();

(function missingRepairWriterLeaseFailsClosed() {
  const audit = auditWithOverride("src/v2/repairDelegatedExecutor.js", (source) => source.replace(
    /PROTECTION_WRITER_LEASE_REQUIRED/g,
    "PROTECTION_WRITER_LEASE_REMOVED"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_REPAIR_WRITER_LEASE_REQUIRED"));
})();

(function stringOnlyRepairWriterLeaseTokensFailClosed() {
  const audit = auditV2ProductionRuntimeChain({
    sourceOverrides: {
      "src/v2/repairDelegatedExecutor.js": `
        function validateProtectionWriterLease() {
          const fake = "PROTECTION_WRITER_LEASE_REQUIRED V2_PROTECTION_WRITER_EXCHANGE_WRITE PROTECTION_WRITER_LEASE_POSITION_CYCLE_MISMATCH PROTECTION_WRITER_LEASE_PLACEMENT_ATTEMPT_MISMATCH PROTECTION_WRITER_LEASE_COMMAND_TYPE_MISMATCH";
          return {};
        }
        function validateDelegatedRepair() {
          const fake = "validateProtectionWriterLease";
          return {};
        }
      `,
      "src/v2/watchdogRepairRuntime.js": `
        function buildProtectionWriterLease() {
          const fake = "V2_PROTECTION_WRITER_EXCHANGE_WRITE V2_SERVICES.PROTECTION_WRITER V2_SERVICES.REPAIR_EXECUTOR placement_attempt_id command_type";
          return {};
        }
      `,
    },
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_REPAIR_WRITER_LEASE_REQUIRED"));
})();

(function missingLiveTemporalCoherenceFailsClosed() {
  const audit = auditWithOverride("scripts/check-v2-promotion-deploy-decision.js", (source) => source.replace(
    /LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH/g,
    "LIVE_STREAK_TEMPORAL_WINDOW_REMOVED"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_24H_EVIDENCE_AND_OPENCLAW_SUPREME_GATED"));
})();

(function missingPromotionPackageLockFailsClosed() {
  const audit = auditWithOverride("package.json", (source) => source.replace(
    "v2-production-runtime-chain-audit.test.js",
    "v2-production-runtime-chain-audit.removed.js"
  ));
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("V2_PRODUCTION_CHAIN_PACKAGE_PROMOTION_PATH_LOCKED"));
})();

console.log("V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_TEST_OK");
