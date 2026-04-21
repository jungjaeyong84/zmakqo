"use strict";

const ALERT_FAILURE_TAXONOMY_CONTRACTS = Object.freeze([
  Object.freeze({
    contract_id: "ALERT_FAILURE_OPERATOR_CONFIG",
    sample_reasons: Object.freeze([
      "V2_SHADOW_ALERT_DELIVERY_DISABLED",
      "TELEGRAM_CHAT_ID_MISSING",
      "TELEGRAM_BOT_TOKEN_MISSING",
    ]),
    family: "OPERATOR_CONFIG",
    retryable: false,
    terminal: true,
    retry_policy_code: "ALERT_CFG_TERMINAL",
    runbook_refs: Object.freeze(["ALERT_RBK_01"]),
  }),
  Object.freeze({
    contract_id: "ALERT_FAILURE_PAYLOAD",
    sample_reasons: Object.freeze([
      "PREPARED_ALERT_REQUIRED",
      "PREPARED_ALERT_NOT_DELIVERABLE",
      "ALERT_OUTBOX_REQUIRED",
      "ALERT_DELIVERY_REQUEST_REQUIRED",
      "ALERT_PREPARED_PAYLOAD_REQUIRED",
    ]),
    family: "PAYLOAD",
    retryable: false,
    terminal: true,
    retry_policy_code: "ALERT_PAYLOAD_TERMINAL",
    runbook_refs: Object.freeze(["ALERT_RBK_02"]),
  }),
  Object.freeze({
    contract_id: "ALERT_FAILURE_POLICY",
    sample_reasons: Object.freeze([
      "SKIP_ALERT",
      "OPERATOR_MUTED",
    ]),
    family: "POLICY",
    retryable: false,
    terminal: true,
    retry_policy_code: "ALERT_POLICY_TERMINAL",
    runbook_refs: Object.freeze(["ALERT_RBK_03"]),
  }),
  Object.freeze({
    contract_id: "ALERT_FAILURE_TRANSPORT",
    sample_reasons: Object.freeze([
      "HTTP_429",
      "OPENCLAW_SEND_FAILED_TIMEOUT",
      "TELEGRAM_TIMEOUT",
      "ALERT_DELIVERY_FAILED",
    ]),
    family: "TRANSPORT",
    retryable: true,
    terminal: false,
    retry_policy_code: "ALERT_RETRY_TRANSPORT",
    runbook_refs: Object.freeze(["ALERT_RBK_04"]),
  }),
  Object.freeze({
    contract_id: "ALERT_FAILURE_UNKNOWN",
    sample_reasons: Object.freeze([
      "UNCLASSIFIED_FAILURE",
      "",
    ]),
    family: "UNKNOWN",
    retryable: false,
    terminal: true,
    retry_policy_code: "ALERT_POLICY_UNKNOWN",
    runbook_refs: Object.freeze(["ALERT_RBK_99"]),
  }),
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function buildClassification(contract) {
  return Object.freeze({
    family: contract.family,
    retryable: contract.retryable,
    terminal: contract.terminal,
    retry_policy_code: contract.retry_policy_code,
    runbook_refs: contract.runbook_refs,
  });
}

function matchesOperatorConfig(normalized) {
  return normalized === "V2_SHADOW_ALERT_DELIVERY_DISABLED"
    || normalized === "TELEGRAM_CHAT_ID_MISSING"
    || normalized === "TELEGRAM_BOT_TOKEN_MISSING";
}

function matchesPayload(normalized) {
  return normalized === "PREPARED_ALERT_REQUIRED"
    || normalized === "PREPARED_ALERT_NOT_DELIVERABLE"
    || normalized === "ALERT_OUTBOX_REQUIRED"
    || normalized === "ALERT_DELIVERY_REQUEST_REQUIRED"
    || normalized === "ALERT_PREPARED_PAYLOAD_REQUIRED";
}

function matchesPolicy(normalized) {
  return normalized === "SKIP_ALERT"
    || normalized.endsWith("_MUTED");
}

function matchesTransport(normalized) {
  return normalized.startsWith("HTTP_")
    || normalized.startsWith("OPENCLAW_SEND_FAILED")
    || normalized.startsWith("TELEGRAM_")
    || normalized === "ALERT_DELIVERY_FAILED";
}

function classifyAlertFailureReason(reason) {
  const normalized = upper(reason);
  if (!normalized) {
    return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[4]);
  }

  if (matchesOperatorConfig(normalized)) {
    return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[0]);
  }

  if (matchesPayload(normalized)) {
    return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[1]);
  }

  if (matchesPolicy(normalized)) {
    return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[2]);
  }

  if (matchesTransport(normalized)) {
    return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[3]);
  }

  return buildClassification(ALERT_FAILURE_TAXONOMY_CONTRACTS[4]);
}

module.exports = {
  classifyAlertFailureReason,
  ALERT_FAILURE_TAXONOMY_CONTRACTS,
  __test: {
    trimOrNull,
    upper,
    buildClassification,
    matchesOperatorConfig,
    matchesPayload,
    matchesPolicy,
    matchesTransport,
  },
};
