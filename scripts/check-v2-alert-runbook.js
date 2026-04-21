#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  classifyAlertFailureReason,
  ALERT_FAILURE_TAXONOMY_CONTRACTS,
} = require("../src/v2/alertFailureTaxonomy");

const FILES = Object.freeze({
  runbook: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_ALERT_RETRY_RUNBOOK_2026-04-21.md"),
  taxonomy: path.resolve(__dirname, "..", "src", "v2", "alertFailureTaxonomy.js"),
  retryWorker: path.resolve(__dirname, "..", "src", "v2", "alertRetryWorker.js"),
  deliveryWorker: path.resolve(__dirname, "..", "src", "v2", "alertDeliveryWorker.js"),
  implementationStatus: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_IMPLEMENTATION_STATUS_2026-04-21.md"),
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function buildCheck({ id, label, ok, reason, file = null }) {
  return Object.freeze({
    id,
    label,
    status: ok ? "PASS" : "FAIL",
    reason: trimOrNull(reason),
    file: trimOrNull(file),
  });
}

function buildRunbookRowPattern({ runbookRef, family, retryPolicyCode }) {
  return `| \`${runbookRef}\` | \`${family}\` | \`${retryPolicyCode}\` |`;
}

function buildTaxonomyFixtures() {
  return Object.freeze(ALERT_FAILURE_TAXONOMY_CONTRACTS.map((contract) => Object.freeze({
    id: contract.contract_id,
    reason: contract.sample_reasons[0],
    family: contract.family,
    retryPolicyCode: contract.retry_policy_code,
    runbookRef: contract.runbook_refs[0],
  })));
}

function evaluateAlertRunbookContract() {
  const runbookText = readText(FILES.runbook);
  const implementationStatusText = readText(FILES.implementationStatus);
  const taxonomyText = readText(FILES.taxonomy);
  const taxonomyFixtures = buildTaxonomyFixtures();
  const checks = [];

  checks.push(buildCheck({
    id: "DOC_CHK_01",
    label: "runbook references taxonomy module path",
    ok: runbookText.includes("src/v2/alertFailureTaxonomy.js"),
    reason: runbookText.includes("src/v2/alertFailureTaxonomy.js")
      ? "runbook points to taxonomy source"
      : "runbook must reference src/v2/alertFailureTaxonomy.js",
    file: FILES.runbook,
  }));

  checks.push(buildCheck({
    id: "DOC_CHK_02",
    label: "runbook references retry worker path",
    ok: runbookText.includes("src/v2/alertRetryWorker.js"),
    reason: runbookText.includes("src/v2/alertRetryWorker.js")
      ? "runbook points to retry worker source"
      : "runbook must reference src/v2/alertRetryWorker.js",
    file: FILES.runbook,
  }));

  checks.push(buildCheck({
    id: "DOC_CHK_03",
    label: "runbook references delivery worker path",
    ok: runbookText.includes("src/v2/alertDeliveryWorker.js"),
    reason: runbookText.includes("src/v2/alertDeliveryWorker.js")
      ? "runbook points to delivery worker source"
      : "runbook must reference src/v2/alertDeliveryWorker.js",
    file: FILES.runbook,
  }));

  checks.push(buildCheck({
    id: "DOC_CHK_00",
    label: "checker reads taxonomy contracts from source module",
    ok: taxonomyText.includes("ALERT_FAILURE_TAXONOMY_CONTRACTS"),
    reason: taxonomyText.includes("ALERT_FAILURE_TAXONOMY_CONTRACTS")
      ? "taxonomy contract catalog exists in source module"
      : "taxonomy source must export ALERT_FAILURE_TAXONOMY_CONTRACTS",
    file: FILES.taxonomy,
  }));

  for (const fixture of taxonomyFixtures) {
    const taxonomy = classifyAlertFailureReason(fixture.reason);
    const taxonomyOk = taxonomy.family === fixture.family
      && taxonomy.retry_policy_code === fixture.retryPolicyCode
      && Array.isArray(taxonomy.runbook_refs)
      && taxonomy.runbook_refs.includes(fixture.runbookRef);
    checks.push(buildCheck({
      id: fixture.id,
      label: `${fixture.reason} classification matches runbook contract`,
      ok: taxonomyOk,
      reason: taxonomyOk
        ? `${fixture.reason} -> ${fixture.family}/${fixture.retryPolicyCode}/${fixture.runbookRef}`
        : `${fixture.reason} classification drifted from runbook contract`,
      file: FILES.taxonomy,
    }));

    const rowPattern = buildRunbookRowPattern(fixture);
    checks.push(buildCheck({
      id: `${fixture.id}_DOC`,
      label: `${fixture.runbookRef} row exists in runbook with family and policy code`,
      ok: runbookText.includes(rowPattern),
      reason: runbookText.includes(rowPattern)
        ? `${fixture.runbookRef} row matches taxonomy contract`
        : `${fixture.runbookRef} row must include ${fixture.family}/${fixture.retryPolicyCode}`,
      file: FILES.runbook,
    }));
  }

  checks.push(buildCheck({
    id: "DOC_CHK_04",
    label: "runbook documents retry governance row",
    ok: runbookText.includes("| `ALERT_RBK_05` | `RETRY_GOVERNANCE` | `ALERT_RETRY_GOVERNANCE` |"),
    reason: runbookText.includes("| `ALERT_RBK_05` | `RETRY_GOVERNANCE` | `ALERT_RETRY_GOVERNANCE` |")
      ? "retry governance row exists"
      : "runbook must document ALERT_RBK_05 with ALERT_RETRY_GOVERNANCE",
    file: FILES.runbook,
  }));

  checks.push(buildCheck({
    id: "DOC_CHK_05",
    label: "implementation status references alert runbook",
    ok: implementationStatusText.includes("DONBEOLJA_V2_ALERT_RETRY_RUNBOOK_2026-04-21.md"),
    reason: implementationStatusText.includes("DONBEOLJA_V2_ALERT_RETRY_RUNBOOK_2026-04-21.md")
      ? "implementation status references alert runbook"
      : "implementation status must reference alert runbook",
    file: FILES.implementationStatus,
  }));

  checks.push(buildCheck({
    id: "DOC_CHK_06",
    label: "implementation status references alert runbook checker",
    ok: implementationStatusText.includes("check-v2-alert-runbook.js"),
    reason: implementationStatusText.includes("check-v2-alert-runbook.js")
      ? "implementation status references checker"
      : "implementation status must reference scripts/check-v2-alert-runbook.js",
    file: FILES.implementationStatus,
  }));

  const failCount = checks.filter((check) => check.status === "FAIL").length;
  return Object.freeze({
    ok: failCount === 0,
    reason: failCount === 0
      ? "V2_ALERT_RUNBOOK_CONTRACT_OK"
      : "V2_ALERT_RUNBOOK_CONTRACT_FAIL",
    check_n: checks.length,
    fail_n: failCount,
    checks: Object.freeze(checks),
  });
}

function main() {
  const result = evaluateAlertRunbookContract();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
  return result;
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateAlertRunbookContract,
  main,
  __test: {
    buildTaxonomyFixtures,
    buildRunbookRowPattern,
  },
};
