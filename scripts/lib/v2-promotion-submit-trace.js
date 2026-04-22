"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

const TRACE_INDEX = Object.freeze([
  Object.freeze({
    id: "SUBMIT_CHK_01A",
    runbookChecklist: Object.freeze(["1", "5", "9"]),
    summary: "resolved artifact dir matches selected cycle",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_02",
    runbookChecklist: Object.freeze(["7"]),
    summary: "deploy decision approved",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_03",
    runbookChecklist: Object.freeze(["8"]),
    summary: "bounded runtime summary complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_04",
    runbookChecklist: Object.freeze(["14"]),
    summary: "evidence snapshot coverage complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_04B",
    runbookChecklist: Object.freeze(["14A"]),
    summary: "runtime chain audit complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_13",
    runbookChecklist: Object.freeze(["21"]),
    summary: "V2 entry boundary audit complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_18",
    runbookChecklist: Object.freeze(["25"]),
    summary: "V2 fill sync canonical boundary audit complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_14",
    runbookChecklist: Object.freeze(["22"]),
    summary: "V2 production cutover audit complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_20",
    runbookChecklist: Object.freeze(["27"]),
    summary: "V2 production live entry sizing contract complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_20A",
    runbookChecklist: Object.freeze(["27A"]),
    summary: "V2 production protected entry canary complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_15",
    runbookChecklist: Object.freeze(["23"]),
    summary: "LIVE production cutover readiness blocks legacy webhook",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_16",
    runbookChecklist: Object.freeze(["24"]),
    summary: "LIVE scheduler traffic cutover uses OpenClaw cron only",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_17",
    runbookChecklist: Object.freeze(["24A"]),
    summary: "LIVE scheduler traffic collector preflight can read GCP state",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_10",
    runbookChecklist: Object.freeze(["18"]),
    summary: "OpenClaw execution audit ledger write complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_11",
    runbookChecklist: Object.freeze(["19"]),
    summary: "LIVE repair Firestore canary streak complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_19",
    runbookChecklist: Object.freeze(["26"]),
    summary: "LIVE production entry route canary streak complete",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_12",
    runbookChecklist: Object.freeze(["20"]),
    summary: "LIVE repair cutover readiness summary visible in final submit path",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_05",
    runbookChecklist: Object.freeze([]),
    summary: "runbook review aggregate passed",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_06",
    runbookChecklist: Object.freeze(["11"]),
    summary: "cloudbuild next action is submit",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_07",
    runbookChecklist: Object.freeze(["13"]),
    summary: "cloudbuild blocker count is zero",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_08",
    runbookChecklist: Object.freeze(["16", "17"]),
    summary: "lineage hashes consistent across bounded artifacts",
  }),
  Object.freeze({
    id: "SUBMIT_CHK_09",
    runbookChecklist: Object.freeze(["15"]),
    summary: "candidate selection contract complete",
  }),
]);

function getSubmitTrace(id) {
  const key = trimOrNull(id);
  if (!key) return null;
  return TRACE_INDEX.find((row) => row.id === key) || null;
}

function getRunbookChecklistForSubmitCheck(id) {
  const row = getSubmitTrace(id);
  return row ? row.runbookChecklist : Object.freeze([]);
}

function collectRunbookChecklist(ids) {
  const seen = new Set();
  const rows = Array.isArray(ids) ? ids : [];
  rows.forEach((id) => {
    getRunbookChecklistForSubmitCheck(id).forEach((value) => seen.add(value));
  });
  return Object.freeze(Array.from(seen).sort((a, b) => Number(a) - Number(b)));
}

function collectSubmitCheckIdsForRunbookChecklist(checklist) {
  const wanted = new Set(
    (Array.isArray(checklist) ? checklist : [checklist])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  if (!wanted.size) return Object.freeze([]);
  return Object.freeze(
    TRACE_INDEX
      .filter((row) => row.runbookChecklist.some((value) => wanted.has(value)))
      .map((row) => row.id)
  );
}

module.exports = {
  TRACE_INDEX,
  getSubmitTrace,
  getRunbookChecklistForSubmitCheck,
  collectRunbookChecklist,
  collectSubmitCheckIdsForRunbookChecklist,
  __test: {
    trimOrNull,
  },
};
