"use strict";

const { candidateFingerprint } = require("./bestSelfEvolutionMemoryLedger");

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

function normalizeArray(value, fallback = ["ALL"]) {
  if (Array.isArray(value) && value.length) {
    return value.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean);
  }
  return fallback.slice();
}

function resolveDiffDirection(key, current, next) {
  const curr = toNum(current);
  const nxt = toNum(next);
  if (curr == null || nxt == null) return "SHIFT";
  if (curr === nxt) return "SHIFT";
  const keyUpper = String(key || "").toUpperCase();
  const isMaxLike = keyUpper.includes("_MAX") || keyUpper.includes("KILL");
  if (nxt > curr) return isMaxLike ? "LOOSEN" : "TIGHTEN";
  return isMaxLike ? "TIGHTEN" : "LOOSEN";
}

function aggregateDirection(changes = []) {
  const rows = Array.isArray(changes) ? changes : [];
  const tighten = rows.filter((row) => row.direction === "TIGHTEN").length;
  const loosen = rows.filter((row) => row.direction === "LOOSEN").length;
  if (tighten > loosen) return "TIGHTEN";
  if (loosen > tighten) return "LOOSEN";
  return "SHIFT";
}

function buildChange(key, current, next, reason) {
  return {
    key,
    current: current == null ? null : current,
    next: next == null ? null : next,
    direction: resolveDiffDirection(key, current, next),
    reason: String(reason || "N/A"),
  };
}

function buildGuardEffects(contract = null, marketGuard = null) {
  const selected = marketGuard && typeof marketGuard === "object" ? marketGuard : (contract || {});
  return {
    count_guard_effect: {
      projected_count_ratio_global: toNum(selected.projected_count_ratio_global),
      tightening_allowed: selected.tightening_allowed !== false,
      mode: String(selected.mode || contract && contract.mode || "NORMAL"),
    },
    replacement_effect: {
      projected_replacement_ratio: toNum(selected.projected_replacement_ratio),
      recovery_priority: selected.recovery_priority === true,
    },
  };
}

function buildRiskFlags({ direction, contract, marketGuard, blocked = false, ready = true } = {}) {
  const flags = [];
  const effective = marketGuard && typeof marketGuard === "object" ? marketGuard : contract;
  if (blocked) flags.push("BLOCKED_SOURCE_ACTION");
  if (ready === false) flags.push("NOT_READY");
  if (effective && effective.tightening_allowed === false && direction === "TIGHTEN") flags.push("COUNT_GUARD_ACTIVE");
  if (effective && effective.recovery_priority === true && direction === "TIGHTEN") flags.push("RECOVERY_PRIORITY_ACTIVE");
  if (effective && String(effective.mode || "").toUpperCase() === "COUNT_GUARD_ACTIVE") flags.push("MARKET_COUNT_GUARD");
  return flags;
}

function buildMemoryGuardContext(memoryLedger = null) {
  const raw = unwrapRawReport(memoryLedger);
  const summary = raw && raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const currentRows = Array.isArray(raw && raw.current_rows) ? raw.current_rows : [];
  return {
    blockedIds: new Set(
      (Array.isArray(summary.blocked_candidate_ids) ? summary.blocked_candidate_ids : [])
        .map((row) => String(row || "").trim())
        .filter(Boolean)
    ),
    recentFailedFingerprints: new Set(
      (Array.isArray(summary.recent_failed_fingerprints) ? summary.recent_failed_fingerprints : [])
        .map((row) => String(row || "").trim())
        .filter(Boolean)
    ),
    currentRowById: new Map(
      currentRows
        .map((row) => [String(row && row.candidate_id || "").trim(), row])
        .filter((row) => row[0])
    ),
  };
}

function applyMemoryGuards(candidate = {}, memoryContext = null) {
  const next = {
    ...candidate,
    risk_flags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.slice() : [],
  };
  if (!memoryContext) return next;
  const candidateId = String(candidate && candidate.candidate_id || "").trim();
  const fingerprint = candidateFingerprint(candidate);
  const memoryRow = candidateId ? (memoryContext.currentRowById.get(candidateId) || null) : null;
  const memoryBlocked = (candidateId && memoryContext.blockedIds.has(candidateId)) || (memoryRow && memoryRow.memory_blocked === true);
  const fingerprintRepeated = memoryContext.recentFailedFingerprints.has(fingerprint);

  next.change_fingerprint = fingerprint;
  next.memory_blocked = memoryBlocked === true;
  next.memory_block_reason = memoryBlocked
    ? String(memoryRow && memoryRow.memory_block_reason || "RECENT_FAIL_FINGERPRINT")
    : null;
  next.failed_fingerprint_repeat = fingerprintRepeated === true;

  if (memoryBlocked && !next.risk_flags.includes("MEMORY_BLOCKED")) next.risk_flags.push("MEMORY_BLOCKED");
  if (fingerprintRepeated && !next.risk_flags.includes("FAILED_FINGERPRINT_REPEAT")) next.risk_flags.push("FAILED_FINGERPRINT_REPEAT");
  if (memoryBlocked || fingerprintRepeated) next.ready_for_auto_apply = false;
  return next;
}

function buildPineCandidates({ patchCandidates, tf = "15m", contract = null, marketGuard = null, changeControl = null } = {}) {
  const raw = unwrapRawReport(patchCandidates);
  const rows = Array.isArray(raw && raw.candidates) ? raw.candidates : [];
  return rows.map((row) => {
    const changes = [
      {
        key: String(row.pine_patch_axis || row.reason_family || "PINE_FULL_QUALITY_BUNDLE"),
        current: null,
        next: toNum(row.pine_patch_delta),
        direction: String(row.direction || "SHIFT").trim().toUpperCase() || "SHIFT",
        reason: String(row.rationale || row.pine_hint || row.reason_family || "N/A"),
      },
    ];
    const direction = aggregateDirection(changes);
    const ready = row.ready_for_weekly_patch === true;
    return {
      candidate_id: String(row.candidate_id || "").trim() || null,
      display_candidate_id: String(row.display_candidate_id || row.candidate_id || "").trim() || null,
      scope: "PINE",
      source: "PINE_PATCH_CANDIDATE",
      markets: normalizeArray(row.markets, ["ALL"]),
      tf: String(row.tf || tf || "15m"),
      changes,
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: false, ready }),
      rollback_target: String(changeControl && changeControl.auto_rollback && changeControl.auto_rollback.rollback_file_path || "").trim() || null,
      direction,
      status: String(row.status || "N/A"),
      ready_for_auto_apply: ready,
      evidence: {
        support_n: toNum(row.analyzed_n),
        support_rate: null,
        priority_score: toNum(row.priority_score),
        avg_dropped_ret_net: toNum(row.avg_dropped_ret_net),
        rationale: String(row.rationale || ""),
      },
    };
  });
}

function buildMlCandidates({ ml, tf = "15m", contract = null, marketGuard = null } = {}) {
  const raw = unwrapRawReport(ml);
  const recs = raw && raw.recommendations && typeof raw.recommendations === "object" ? raw.recommendations : {};
  const out = [];
  const qualityRows = Array.isArray(recs.QUALITY) ? recs.QUALITY : [];
  for (const row of qualityRows) {
    const change = buildChange(row.key, row.current, row.next, row.display_reason || row.reason);
    const direction = String(change.direction || "SHIFT");
    out.push({
      candidate_id: `ML_${String(row.key || "QUALITY").trim().toUpperCase()}`,
      display_candidate_id: String(row.display_key || row.key || "ML_QUALITY"),
      scope: "ML",
      source: "ML_QUALITY_RECOMMENDATION",
      markets: ["ALL"],
      tf,
      changes: [change],
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: !!row.blocked_action, ready: true }),
      rollback_target: null,
      direction,
      status: String(row.action || "KEEP"),
      ready_for_auto_apply: /^REVIEW_/.test(String(row.action || "")) && !row.blocked_action,
      evidence: {
        support_n: toNum(row.support_n),
        support_rate: toNum(row.support_rate),
        priority_score: null,
        avg_dropped_ret_net: null,
        rationale: String(row.reason || ""),
      },
    });
  }
  for (const [key, scope] of [["MARKET", "ML"], ["AI", "AI"], ["EV", "ML"]]) {
    const row = recs[key];
    if (!row || typeof row !== "object") continue;
    const nextObj = row.next && typeof row.next === "object" ? row.next : null;
    const changes = nextObj
      ? Object.keys(nextObj).map((changeKey) => buildChange(changeKey, null, nextObj[changeKey], row.reason))
      : [];
    const direction = changes.length ? aggregateDirection(changes) : "SHIFT";
    out.push({
      candidate_id: `${scope}_${String((row.blocked_key || key) || key).trim().toUpperCase()}`,
      display_candidate_id: String(row.blocked_key || key),
      scope,
      source: `ML_${key}_RECOMMENDATION`,
      markets: scope === "ML" && marketGuard && marketGuard.market ? [marketGuard.market] : ["ALL"],
      tf,
      changes,
      objective_delta: null,
      ...buildGuardEffects(contract, marketGuard),
      risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: !!row.blocked_action, ready: /^REVIEW_/.test(String(row.action || "")) }),
      rollback_target: null,
      direction,
      status: String(row.action || "KEEP"),
      ready_for_auto_apply: /^REVIEW_/.test(String(row.action || "")) && !row.blocked_action,
      evidence: {
        support_n: null,
        support_rate: null,
        priority_score: null,
        avg_dropped_ret_net: null,
        rationale: String(row.reason || ""),
      },
    });
  }
  return out;
}

function buildEvCandidate({ ev, tf = "15m", contract = null, marketGuard = null } = {}) {
  const raw = unwrapRawReport(ev);
  if (!raw || typeof raw !== "object") return [];
  const currentBand = raw.current_band && typeof raw.current_band === "object" ? raw.current_band : {};
  const nextBand = raw.next_band && typeof raw.next_band === "object" ? raw.next_band : {};
  const changes = [
    buildChange("ev_gate_tp1_prob_min", raw.current_threshold, raw.next_threshold, raw.decision_reason),
    buildChange("ev_gate_tp1_prob_full", currentBand.fullThreshold, nextBand.fullThreshold, raw.decision_reason),
    buildChange("ev_gate_tp1_prob_kill", currentBand.killThreshold, nextBand.killThreshold, raw.decision_reason),
    buildChange("ev_gate_qty_scale_mid", currentBand.midScale, nextBand.midScale, raw.decision_reason),
    buildChange("ev_gate_qty_scale_low", currentBand.lowScale, nextBand.lowScale, raw.decision_reason),
  ].filter((row) => row.current != null || row.next != null);
  const direction = aggregateDirection(changes);
  return [{
    candidate_id: "EV_TP1_THRESHOLD_TUNE",
    display_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    scope: "EV",
    source: "EV_TUNER",
    markets: marketGuard && marketGuard.market ? [marketGuard.market] : ["ALL"],
    tf: String(raw.tf || tf || "15m"),
    changes,
    objective_delta: null,
    ...buildGuardEffects(contract, marketGuard),
    risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: false, ready: raw.settings_updated === true }),
    rollback_target: null,
    direction,
    status: String(raw.decision_reason || "N/A"),
    ready_for_auto_apply: raw.settings_updated === true,
    evidence: {
      support_n: null,
      support_rate: null,
      priority_score: null,
      avg_dropped_ret_net: null,
      rationale: String(raw.decision_reason || ""),
    },
  }];
}

function buildWaitCandidate({ wait, tf = "15m", contract = null, marketGuard = null } = {}) {
  const raw = unwrapRawReport(wait);
  if (!raw || typeof raw !== "object") return [];
  const current = raw.current && typeof raw.current === "object" ? raw.current : {};
  const next = raw.next && typeof raw.next === "object" ? raw.next : {};
  const keys = Array.from(new Set([...Object.keys(current), ...Object.keys(next)]));
  const changes = keys.map((key) => buildChange(key, current[key], next[key], raw.reason)).filter((row) => row.current != null || row.next != null);
  const direction = aggregateDirection(changes);
  return [{
    candidate_id: "WAIT_ONE_BAR_TUNE",
    display_candidate_id: "WAIT_ONE_BAR_TUNE",
    scope: "WAIT",
    source: "WAIT_TUNER",
    markets: marketGuard && marketGuard.market ? [marketGuard.market] : ["ALL"],
    tf: String(raw.tf || tf || "15m"),
    changes,
    objective_delta: null,
    ...buildGuardEffects(contract, marketGuard),
    risk_flags: buildRiskFlags({ direction, contract, marketGuard, blocked: false, ready: raw.changed === true }),
    rollback_target: null,
    direction,
    status: String(raw.reason || "N/A"),
    ready_for_auto_apply: raw.changed === true,
    evidence: {
      support_n: toNum(raw.enough_trigger_sample ? raw.current_summary && raw.current_summary.triggered_n : null),
      support_rate: null,
      priority_score: null,
      avg_dropped_ret_net: null,
      rationale: String(raw.reason || ""),
    },
  }];
}

function buildCandidateChangeSets({
  objectiveSupervisor = null,
  patchCandidates = null,
  ml = null,
  ev = null,
  wait = null,
  changeControl = null,
  memoryLedger = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const contract = supervisor.best_febt_tuning_contract || null;
  const marketGuard = Array.isArray(supervisor.best_febt_market_contracts)
    ? supervisor.best_febt_market_contracts.find((row) => row && (row.tightening_allowed === false || row.recovery_priority === true))
      || supervisor.best_febt_market_contracts[0]
      || null
    : null;
  const tf = String(supervisor.phase0 && supervisor.phase0.tf || "15m");
  const memoryContext = buildMemoryGuardContext(memoryLedger);
  const rows = [
    ...buildPineCandidates({ patchCandidates, tf, contract, marketGuard, changeControl: unwrapRawReport(changeControl) }),
    ...buildMlCandidates({ ml, tf, contract, marketGuard }),
    ...buildEvCandidate({ ev, tf, contract, marketGuard }),
    ...buildWaitCandidate({ wait, tf, contract, marketGuard }),
  ]
    .filter((row) => row && row.candidate_id)
    .map((row) => applyMemoryGuards(row, memoryContext));

  const byScope = rows.reduce((acc, row) => {
    const key = String(row.scope || "UNKNOWN");
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const ready = rows.filter((row) => row.ready_for_auto_apply === true).length;
  const blocked = rows.filter((row) => Array.isArray(row.risk_flags) && row.risk_flags.includes("BLOCKED_SOURCE_ACTION")).length;
  const memoryBlocked = rows.filter((row) => row.memory_blocked === true).length;
  const fingerprintRepeated = rows.filter((row) => row.failed_fingerprint_repeat === true).length;
  const topCandidate = rows.slice().sort((a, b) =>
    ((toNum(b.evidence && b.evidence.priority_score) ?? -Infinity) - (toNum(a.evidence && a.evidence.priority_score) ?? -Infinity))
    || ((toNum(b.evidence && b.evidence.support_n) ?? 0) - (toNum(a.evidence && a.evidence.support_n) ?? 0))
    || String(a.candidate_id).localeCompare(String(b.candidate_id))
  )[0] || null;

  return {
    rows,
    summary: {
      total_n: rows.length,
      ready_n: ready,
      blocked_n: blocked,
      memory_blocked_n: memoryBlocked,
      failed_fingerprint_repeat_n: fingerprintRepeated,
      by_scope: byScope,
      top_candidate_id: topCandidate && topCandidate.candidate_id || null,
      top_scope: topCandidate && topCandidate.scope || null,
    },
  };
}

module.exports = {
  unwrapRawReport,
  buildCandidateChangeSets,
  __test: {
    resolveDiffDirection,
    aggregateDirection,
  },
};
