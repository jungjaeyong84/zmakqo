"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_RUNTIME_DIR = path.join(REPO_ROOT, "ops", "runtime");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DECISIONS_JSONL = path.join(OPS_RUNTIME_DIR, "openclaw_policy_decisions.jsonl");
const LATEST_JSON = path.join(OPS_DAILY_DIR, "openclaw_policy_decision_latest.json");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function normText(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function buildDecisionRecord(input = {}) {
  const createdAt = normText(input.createdAt) || new Date().toISOString();
  const traceSeed = JSON.stringify({
    exchange: input.exchange || null,
    symbol: input.symbol || null,
    signalId: input.signalId || null,
    intentId: input.intentId || null,
    requestId: input.requestId || null,
    createdAt,
  });
  return {
    id: normText(input.id) || `OPD__${crypto.createHash("sha1").update(traceSeed).digest("hex").slice(0, 16)}`,
    created_at: createdAt,
    exchange: normText(input.exchange),
    symbol: normText(input.symbol),
    event: normText(input.event),
    intent: normText(input.intent),
    side: normText(input.side),
    stage: normText(input.stage),
    signal_tf: normText(input.signalTf),
    trace_id: normText(input.traceId),
    request_id: normText(input.requestId),
    run_id: normText(input.runId),
    signal_id: normText(input.signalId),
    intent_id: normText(input.intentId),
    source: normText(input.source) || "UNKNOWN",
    requested_qty_pct: toNum(input.requestedQtyPct),
    final_qty_pct: toNum(input.finalQtyPct),
    scale_applied: toNum(input.scaleApplied),
    reason: normText(input.reason),
    blocked: input.blocked === true,
    exit_profile_mode: normText(input.exitProfileMode),
    cohort: normText(input.cohort),
    decision: asObject(input.decision),
    features_patch: asObject(input.featuresPatch),
  };
}

async function recordOpenClawPolicyDecision(input = {}) {
  const record = buildDecisionRecord(input);
  appendJsonl(DECISIONS_JSONL, record);
  writeJson(LATEST_JSON, record);
  return record;
}

module.exports = {
  recordOpenClawPolicyDecision,
  __test: {
    buildDecisionRecord,
  },
};
