"use strict";

const crypto = require("crypto");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map((row) => stableObject(row));
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableObject(value[key]);
    return acc;
  }, {});
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || ""), "utf8").digest("hex");
}

function isoWeekKeyFromDateKey(dateKey) {
  const text = String(dateKey || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const isoYear = dt.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return `${isoYear}W${String(week).padStart(2, "0")}`;
}

function parseIsoWeekKey(weekKey) {
  const text = String(weekKey || "").trim().toUpperCase();
  const match = text.match(/^(\d{4})W(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(week)) return null;
  return { year, week };
}

function isoWeekDistance(currentWeekKey, previousWeekKey) {
  const current = parseIsoWeekKey(currentWeekKey);
  const previous = parseIsoWeekKey(previousWeekKey);
  if (!current || !previous) return null;
  return ((current.year * 53) + current.week) - ((previous.year * 53) + previous.week);
}

function candidateFingerprint(candidate = {}) {
  const payload = stableObject({
    scope: String(candidate.scope || "").trim().toUpperCase(),
    markets: Array.isArray(candidate.markets) ? candidate.markets.map((row) => String(row || "").trim().toUpperCase()).sort() : [],
    changes: Array.isArray(candidate.changes)
      ? candidate.changes.map((row) => ({
        key: String(row && row.key || "").trim(),
        current: row && row.current != null ? row.current : null,
        next: row && row.next != null ? row.next : null,
        direction: String(row && row.direction || "").trim().toUpperCase(),
      }))
      : [],
  });
  return sha1(JSON.stringify(payload));
}

function normalizeMarkets(value) {
  return Array.isArray(value)
    ? value.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
}

function mapByCandidateId(rows = [], idField = "candidate_id") {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row && row[idField] || "").trim();
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(row);
  }
  return out;
}

function deriveVerdict({ replay = null, canaryRows = [] } = {}) {
  const replayVerdict = String(replay && replay.validation_verdict || "").trim().toUpperCase();
  const rollbackRow = canaryRows.find((row) => row && row.rollback_ready === true);
  if (rollbackRow) {
    return {
      verdict: "ROLLED_BACK",
      rollback_reason: Array.isArray(rollbackRow.blockers) && rollbackRow.blockers.length ? rollbackRow.blockers.join("|") : "CANARY_ROLLBACK",
    };
  }
  if (replayVerdict === "BLOCK") {
    return {
      verdict: "FAIL",
      rollback_reason: Array.isArray(replay && replay.blockers) && replay.blockers.length ? replay.blockers.join("|") : null,
    };
  }
  const successRow = canaryRows.find((row) => row && (row.current_stage === "SOFT" || row.current_stage === "HARD") && row.canary_verdict === "READY");
  if (successRow) {
    return {
      verdict: "SUCCESS",
      rollback_reason: null,
    };
  }
  return {
    verdict: "NEUTRAL",
    rollback_reason: null,
  };
}

function average(values = []) {
  const scoped = values.map((row) => toNum(row)).filter((row) => row != null);
  if (!scoped.length) return null;
  return scoped.reduce((acc, row) => acc + row, 0) / scoped.length;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function buildSampleReadinessContext(cutover = null) {
  const summary = readSummary(cutover);
  const configuredMin = toNum(summary.ev_policy_remediation_min_post_samples);
  const floorMin = Math.max(3, Number(process.env.OPENCLAW_EV_POLICY_VERIFICATION_MIN_SAMPLES || 5));
  return {
    ev_policy_post_apply_comparable_n: toNum(summary.ev_policy_post_apply_comparable_n),
    ev_policy_post_apply_mismatch_n: toNum(summary.ev_policy_post_apply_mismatch_n),
    ev_policy_min_samples: Math.max(configuredMin || 3, floorMin),
  };
}

function buildCurrentRows({
  candidateChangeSet = null,
  replayReport = null,
  canaryReport = null,
  nowMeta = null,
  previousLedger = null,
  sampleReadiness = null,
} = {}) {
  const candidateRows = [
    ...(Array.isArray(candidateChangeSet && candidateChangeSet.rows) ? candidateChangeSet.rows : []),
    ...(Array.isArray(candidateChangeSet && candidateChangeSet.blocked_rows) ? candidateChangeSet.blocked_rows : []),
  ];
  const replayRows = Array.isArray(replayReport && replayReport.validations) ? replayReport.validations : [];
  const canaryRows = Array.isArray(canaryReport && canaryReport.rows) ? canaryReport.rows : [];
  const previousRows = Array.isArray(previousLedger && previousLedger.rows) ? previousLedger.rows : [];
  const weekKey = isoWeekKeyFromDateKey(nowMeta && nowMeta.dateKey) || String(nowMeta && nowMeta.dateKey || "N/A");
  const replayMap = new Map(replayRows.map((row) => [String(row && row.candidate_id || "").trim(), row]));
  const canaryMap = mapByCandidateId(canaryRows);
  const fingerprintBlockTtlWeeks = Math.max(1, Number(process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS || 2));
  const previousFailMap = new Map();
  const previousSuccessFingerprintSet = new Set();
  for (const row of previousRows) {
    if (String(row && row.applied_week_key || "").trim() === weekKey) continue;
    const fingerprint = String(row && row.change_fingerprint || "").trim();
    if (!fingerprint) continue;
    const verdict = String(row && row.verdict || "").trim().toUpperCase();
    if (verdict === "SUCCESS") {
      previousSuccessFingerprintSet.add(fingerprint);
      continue;
    }
    if (verdict !== "FAIL" && verdict !== "ROLLED_BACK") continue;
    const ageWeeks = isoWeekDistance(weekKey, String(row && row.applied_week_key || "").trim());
    if (ageWeeks != null && ageWeeks > fingerprintBlockTtlWeeks) continue;
    if (!previousFailMap.has(fingerprint)) previousFailMap.set(fingerprint, []);
    previousFailMap.get(fingerprint).push(row);
  }

  const sampleContext = buildSampleReadinessContext(sampleReadiness);
  return candidateRows.map((candidate) => {
    const candidateId = String(candidate && candidate.candidate_id || "").trim() || null;
    const fingerprint = candidateFingerprint(candidate);
    const replay = candidateId ? (replayMap.get(candidateId) || null) : null;
    const perCandidateCanary = candidateId ? (canaryMap.get(candidateId) || []) : [];
    const derived = deriveVerdict({ replay, canaryRows: perCandidateCanary });
    const countDelta = toNum(replay && replay.count_delta) != null
      ? toNum(replay && replay.count_delta)
      : (toNum(candidate && candidate.count_guard_effect && candidate.count_guard_effect.projected_count_ratio_global) != null
        ? Number((toNum(candidate.count_guard_effect.projected_count_ratio_global) - 1).toFixed(4))
        : null);
    const replacementDelta = toNum(replay && replay.replacement_delta) != null
      ? toNum(replay && replay.replacement_delta)
      : (toNum(candidate && candidate.replacement_effect && candidate.replacement_effect.projected_replacement_ratio) != null
        ? Number((toNum(candidate.replacement_effect.projected_replacement_ratio) - 0.8).toFixed(4))
        : null);
    const avgRetNetDelta = toNum(replay && replay.avg_ret_net_delta);
    const previousFails = previousFailMap.get(fingerprint) || [];
    const successReleased = previousSuccessFingerprintSet.has(fingerprint);
    const isEvScope = String(candidate && candidate.scope || "").trim().toUpperCase() === "EV";
    const lowSampleEvContext = isEvScope
      && Number.isFinite(sampleContext.ev_policy_post_apply_comparable_n)
      && sampleContext.ev_policy_post_apply_comparable_n < sampleContext.ev_policy_min_samples;
    const provisionalFail = lowSampleEvContext
      && (derived.verdict === "FAIL" || derived.verdict === "ROLLED_BACK");
    const memoryBlocked = previousFails.length > 0 && !successReleased && !provisionalFail;
    const latestFail = previousFails[0] || null;
    const previousFailAgeWeeks = latestFail ? isoWeekDistance(weekKey, String(latestFail.applied_week_key || "").trim()) : null;
    return {
      candidate_id: candidateId,
      display_candidate_id: String(candidate && (candidate.display_candidate_id || candidate.candidate_id) || "").trim() || null,
      applied_week_key: weekKey,
      scope: String(candidate && candidate.scope || "").trim().toUpperCase() || "UNKNOWN",
      markets: normalizeMarkets(candidate && candidate.markets),
      change_fingerprint: fingerprint,
      generated_at_kst: String(nowMeta && nowMeta.kst || "N/A"),
      objective_delta: toNum(replay && replay.candidate_objective_delta),
      count_delta: countDelta,
      replacement_delta: replacementDelta,
      avg_ret_net_delta: avgRetNetDelta,
      verdict: provisionalFail ? "PROVISIONAL_FAIL" : derived.verdict,
      rollback_reason: provisionalFail ? "LOW_SAMPLE_POST_APPLY" : derived.rollback_reason,
      replay_verdict: String(replay && replay.validation_verdict || "").trim().toUpperCase() || null,
      canary_stage: perCandidateCanary.map((row) => String(row && row.current_stage || "").trim().toUpperCase()).filter(Boolean)[0] || "SHADOW",
      canary_action: perCandidateCanary.map((row) => String(row && row.canary_action || "").trim().toUpperCase()).filter(Boolean)[0] || "KEEP",
      memory_blocked: memoryBlocked,
      memory_block_reason: provisionalFail ? null : (memoryBlocked ? "RECENT_FAIL_FINGERPRINT_WITHIN_TTL" : null),
      provisional_fail: provisionalFail,
      provisional_fail_reason: provisionalFail ? "LOW_SAMPLE_POST_APPLY" : null,
      previous_fail_week_key: memoryBlocked ? String(latestFail && latestFail.applied_week_key || "").trim() || null : null,
      previous_fail_verdict: memoryBlocked ? String(latestFail && latestFail.verdict || "").trim().toUpperCase() || null : null,
      previous_fail_age_weeks: memoryBlocked ? previousFailAgeWeeks : null,
      memory_block_ttl_weeks: fingerprintBlockTtlWeeks,
      memory_released_by_success: successReleased,
      current_week: true,
    };
  });
}

function mergeLedgerRows(previousRows = [], currentRows = []) {
  const merged = new Map();
  for (const row of Array.isArray(previousRows) ? previousRows : []) {
    const key = `${String(row && row.candidate_id || "").trim()}__${String(row && row.applied_week_key || "").trim()}__${String(row && row.change_fingerprint || "").trim()}`;
    if (!key.replace(/_/g, "")) continue;
    merged.set(key, { ...row, current_week: false });
  }
  for (const row of Array.isArray(currentRows) ? currentRows : []) {
    const key = `${String(row && row.candidate_id || "").trim()}__${String(row && row.applied_week_key || "").trim()}__${String(row && row.change_fingerprint || "").trim()}`;
    if (!key.replace(/_/g, "")) continue;
    merged.set(key, row);
  }
  return Array.from(merged.values()).sort((a, b) =>
    String(b.applied_week_key || "").localeCompare(String(a.applied_week_key || ""))
    || String(a.candidate_id || "").localeCompare(String(b.candidate_id || ""))
  );
}

function buildMemoryLedger({
  candidateChangeSet = null,
  replayReport = null,
  canaryReport = null,
  previousLedger = null,
  nowMeta = null,
  sampleReadiness = null,
} = {}) {
  const previousRows = Array.isArray(previousLedger && previousLedger.rows) ? previousLedger.rows : [];
  const currentRows = buildCurrentRows({
    candidateChangeSet,
    replayReport,
    canaryReport,
    nowMeta,
    previousLedger,
    sampleReadiness,
  });
  const rows = mergeLedgerRows(previousRows, currentRows);
  const successRows = rows.filter((row) => row.verdict === "SUCCESS");
  const provisionalFailRows = rows.filter((row) => row.verdict === "PROVISIONAL_FAIL");
  const failRows = rows.filter((row) => row.verdict === "FAIL");
  const rolledBackRows = rows.filter((row) => row.verdict === "ROLLED_BACK");
  const neutralRows = rows.filter((row) => row.verdict === "NEUTRAL");
  const currentBlocked = currentRows.filter((row) => row.memory_blocked === true);
  return {
    summary: {
      total_n: rows.length,
      current_n: currentRows.length,
      success_n: successRows.length,
      provisional_fail_n: provisionalFailRows.length,
      neutral_n: neutralRows.length,
      fail_n: failRows.length,
      rolled_back_n: rolledBackRows.length,
      blocked_candidate_n: currentBlocked.length,
      blocked_candidate_ids: currentBlocked.map((row) => row.candidate_id).filter(Boolean),
      top_success_candidate_id: successRows[0] ? successRows[0].candidate_id : null,
      top_failed_candidate_id: failRows[0] ? failRows[0].candidate_id : (rolledBackRows[0] ? rolledBackRows[0].candidate_id : null),
      avg_objective_delta: average(currentRows.map((row) => row.objective_delta)),
      avg_count_delta: average(currentRows.map((row) => row.count_delta)),
      avg_replacement_delta: average(currentRows.map((row) => row.replacement_delta)),
      avg_ret_net_delta: average(currentRows.map((row) => row.avg_ret_net_delta)),
      fingerprint_block_ttl_weeks: Math.max(1, Number(process.env.BEST_SELF_EVOLUTION_MEMORY_BLOCK_TTL_WEEKS || 2)),
      recent_failed_fingerprints: rows
        .filter((row) => row.verdict === "FAIL" || row.verdict === "ROLLED_BACK")
        .slice(0, 5)
        .map((row) => row.change_fingerprint),
      latest_week_key: currentRows[0] ? currentRows[0].applied_week_key : null,
    },
    current_rows: currentRows,
    rows,
  };
}

module.exports = {
  buildMemoryLedger,
  candidateFingerprint,
  isoWeekKeyFromDateKey,
  unwrapRawReport,
};
