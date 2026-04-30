"use strict";

const {
  describeEntryEventForUser,
  describeTimingTierForUser,
} = require("./liveEntryTaxonomy");
const { displayStage1IntegrityReason } = require("./stage1IntegrityReason");
const { explainSignalReason } = require("./signalReasonView");

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

const TIER_KEY_SET = new Set(["EARLY", "CORE", "PRE_REAL", "REAL"]);
const STAGE_DISPLAY_MAP = Object.freeze({
  PINE: "서버 정본 품질",
  QUALITY: "V2 신호 기준/서버 정본",
  AI: "V2 진입 품질/시장 데이터",
  MARKET: "V2 리스크 거버너/사이징",
  EV: "V2 기대값 게이트",
  TIMING: "Retired legacy timing guard",
  LEGACY_RETIRED: "Retired legacy guard",
  BUDGET: "예산/최소주문 가드",
  EXECUTOR: "OpenClaw 실행 가드",
  LIVE_POLICY: "라이브 운영 정책",
  OPS: "운영/기타",
});

function describeStageForUser(stageRaw) {
  const stage = normalizeUpper(stageRaw);
  if (!stage) return null;
  return STAGE_DISPLAY_MAP[stage] || stage;
}

function describeReasonForUser(reasonRaw) {
  const text = String(reasonRaw || "").trim();
  if (!text) return null;
  const code = normalizeUpper(text);
  const looksLikeCode = /^[A-Z0-9_]+$/.test(code);
  if (!looksLikeCode) return text;

  const integrityLabel = displayStage1IntegrityReason(code);
  if (integrityLabel && integrityLabel !== code) return integrityLabel;

  const explained = explainSignalReason(code);
  if (explained) return explained;

  return code;
}

function maybeSetDisplayField(target, rawKey, displayKey, resolver) {
  if (!target || typeof target !== "object") return;
  if (target[displayKey] !== undefined) return;
  const rawValue = target[rawKey];
  if (rawValue === undefined || rawValue === null || rawValue === "") return;
  const resolved = resolver(rawValue, target);
  if (resolved !== undefined && resolved !== null && resolved !== "") {
    target[displayKey] = resolved;
  }
}

function decorateObject(input, keyFromParent = null) {
  const out = {};
  for (const [key, value] of Object.entries(input || {})) {
    out[key] = addDisplayFieldsDeep(value, key);
  }

  const parentKey = normalizeUpper(keyFromParent);
  if (parentKey && TIER_KEY_SET.has(parentKey) && out.display_tier === undefined) {
    out.display_tier = describeTimingTierForUser(parentKey);
  }
  if (parentKey && STAGE_DISPLAY_MAP[parentKey] && out.display_stage === undefined) {
    out.display_stage = describeStageForUser(parentKey);
  }

  maybeSetDisplayField(out, "event", "display_event", (raw, obj) => describeEntryEventForUser(raw, obj.side));
  maybeSetDisplayField(out, "entry_event", "display_entry_event", (raw, obj) => describeEntryEventForUser(raw, obj.side));
  maybeSetDisplayField(out, "exit_event", "display_exit_event", (raw, obj) => describeEntryEventForUser(raw, obj.side));
  maybeSetDisplayField(out, "tier", "display_tier", (raw) => describeTimingTierForUser(raw));
  maybeSetDisplayField(out, "stage", "display_stage", (raw) => describeStageForUser(raw));
  maybeSetDisplayField(out, "stage_key", "display_stage_key", (raw) => describeStageForUser(raw));
  maybeSetDisplayField(out, "reason", "display_reason", (raw) => describeReasonForUser(raw));
  maybeSetDisplayField(out, "stage_drop_reason", "display_stage_drop_reason", (raw) => describeReasonForUser(raw));
  maybeSetDisplayField(out, "drop_reason_code", "display_drop_reason", (raw) => describeReasonForUser(raw));

  return out;
}

function addDisplayFieldsDeep(input, keyFromParent = null) {
  if (Array.isArray(input)) {
    return input.map((value) => addDisplayFieldsDeep(value, null));
  }
  if (!input || typeof input !== "object") return input;
  return decorateObject(input, keyFromParent);
}

function sanitizeDisplayDeep(input) {
  if (Array.isArray(input)) {
    return input.map((value) => sanitizeDisplayDeep(value));
  }
  if (!input || typeof input !== "object") return input;

  const out = {};
  const dropAlways = new Set([
    "chain_rows",
    "enriched_rows",
    "recent_resolved_examples",
    "signal_key",
    "signal_id",
    "sample_signal_id",
    "signalId",
    "signalKey",
    "entryEventId",
    "entry_event_id",
    "entry_signal_type",
    "trades",
    "stderr_tail",
    "stdout_tail",
  ]);
  const dropIfDisplayExists = new Map([
    ["event", "display_event"],
    ["entry_event", "display_entry_event"],
    ["exit_event", "display_exit_event"],
    ["tier", "display_tier"],
    ["key", "display_key"],
    ["state", "display_state"],
    ["stage", "display_stage"],
    ["stage_key", "display_stage_key"],
    ["reason", "display_reason"],
    ["stage_drop_reason", "display_stage_drop_reason"],
    ["drop_reason_code", "display_drop_reason"],
    ["candidate_id", "display_candidate_id"],
  ]);

  for (const [key, value] of Object.entries(input)) {
    if (dropAlways.has(key)) continue;
    const displayAlias = dropIfDisplayExists.get(key);
    if (displayAlias && input[displayAlias] !== undefined) continue;
    out[key] = sanitizeDisplayDeep(value);
  }

  if (Array.isArray(out.by_tier_rows)) delete out.by_tier;
  if (Array.isArray(out.quality_by_tier_rows)) delete out.quality_by_tier;
  if (Array.isArray(out.settings_snapshot_rows)) delete out.settings_snapshot;
  if (Array.isArray(out.tier_plan_rows) || Array.isArray(out.tier_threshold_rows)) delete out.tierPlans;
  if (Array.isArray(out.tier_threshold_rows)) delete out.tier_thresholds;
  if (Array.isArray(out.recent_rows)) delete out.rows;
  if (out.threshold_eval && Array.isArray(out.threshold_eval.rows)) {
    out.threshold_eval = { ...out.threshold_eval };
    delete out.threshold_eval.rows;
  }

  return out;
}

function unwrapDisplayAndRawReport(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const raw = input.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  return input;
}

function wrapDisplayAndRawReport(rawInput) {
  const raw = unwrapDisplayAndRawReport(rawInput);
  return {
    display: sanitizeDisplayDeep(addDisplayFieldsDeep(raw)),
    raw,
  };
}

function tierMapToRows(tierMap) {
  if (!tierMap || typeof tierMap !== "object" || Array.isArray(tierMap)) return [];
  const ordered = ["EARLY", "CORE"];
  return ordered
    .filter((tier) => tierMap[tier] && typeof tierMap[tier] === "object")
    .map((tier) => ({
      tier,
      display_tier: describeTimingTierForUser(tier),
      ...addDisplayFieldsDeep(tierMap[tier]),
    }));
}

module.exports = {
  addDisplayFieldsDeep,
  describeReasonForUser,
  describeStageForUser,
  tierMapToRows,
  sanitizeDisplayDeep,
  unwrapDisplayAndRawReport,
  wrapDisplayAndRawReport,
};
