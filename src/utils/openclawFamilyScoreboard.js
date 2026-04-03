"use strict";

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return {};
}

function firstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value.slice();
  }
  return [];
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function unique(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function familyStatus(mismatchN, dominantFamily, family) {
  if ((toNum(mismatchN) || 0) <= 0) return "CLEAR";
  if (upper(dominantFamily) === upper(family)) return "PRIORITY";
  return "MONITOR";
}

function buildFamilyScoreboard({
  quality = null,
  cutover = null,
  observation = null,
  reasoningJournal = null,
  autonomyParity = null,
  capabilities = [],
} = {}) {
  const qualitySummary = firstObject(quality && quality.summary);
  const qualityRows = firstObject(quality && quality.rows);
  const cutoverSummary = firstObject(cutover && cutover.summary);
  const observationSummary = firstObject(observation && observation.summary);
  const journalSummary = firstObject(reasoningJournal && reasoningJournal.summary);
  const paritySummary = firstObject(autonomyParity && autonomyParity.summary);

  const families = new Map();
  for (const row of firstArray(qualityRows.final_downstream_family_actions)) {
    const family = upper(row.family);
    if (!family) continue;
    families.set(family, {
      family,
      mismatch_n: toNum(row.mismatch_n),
      recommended_action: row.recommended_action || null,
    });
  }
  if ((toNum(qualitySummary.other_server_policy_mismatch_n) || 0) > 0 && !families.has("OTHER_SERVER_POLICY")) {
    families.set("OTHER_SERVER_POLICY", {
      family: "OTHER_SERVER_POLICY",
      mismatch_n: toNum(qualitySummary.other_server_policy_mismatch_n),
      recommended_action: observationSummary.top_other_server_policy_reason_action
        && observationSummary.top_other_server_policy_reason_action.recommended_action || "WATCH_ONLY_REVIEW",
    });
  }

  const rows = Array.from(families.values()).map((row) => {
    const capabilityIds = unique(
      firstArray(capabilities).filter((cap) => {
        const triggerFamilies = firstArray(cap && cap.trigger && cap.trigger.dominant_mismatch_family_in).map((v) => upper(v));
        return triggerFamilies.includes(row.family) || triggerFamilies.length === 0;
      }).map((cap) => cap.id)
    );
    return {
      family: row.family,
      mismatch_n: row.mismatch_n,
      recommended_action: row.recommended_action,
      status: familyStatus(row.mismatch_n, cutoverSummary.dominant_mismatch_family, row.family),
      capability_ids: capabilityIds,
      verification_hint: row.family === "OTHER_SERVER_POLICY"
        ? "other_server_policy_mismatch_n < baseline"
        : row.family === "EV_POLICY"
          ? "ev_policy_post_apply_comparable_n >= min_post_samples"
          : "final_downstream_mismatch_n < baseline",
    };
  }).sort((a, b) => b.mismatch_n - a.mismatch_n || String(a.family).localeCompare(String(b.family)));

  return {
    ok: true,
    summary: {
      tracked_family_n: rows.length,
      dominant_mismatch_family: upper(cutoverSummary.dominant_mismatch_family),
      top_family: rows[0] && rows[0].family || null,
      top_family_mismatch_n: rows[0] && rows[0].mismatch_n || 0,
      objective_verdict: String(journalSummary.current_objective_verdict || paritySummary.current_objective_verdict || "").trim() || null,
      authority_state: String(journalSummary.current_authority_state || paritySummary.current_authority_state || "").trim() || null,
    },
    rows,
  };
}

module.exports = {
  buildFamilyScoreboard,
};
