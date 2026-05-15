"use strict";

function normalizeOpenClawCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function normalizeTp1LadderProfile(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "BASE") return upper;
  return null;
}

module.exports = {
  normalizeOpenClawCohort,
  normalizeTp1LadderProfile,
};
