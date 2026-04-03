"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundTo(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

const BASE_IMPACT_WEIGHTS = Object.freeze({
  objective_score_delta: 1,
  server_signal_fill_24h_delta: 0.35,
  server_signal_intent_24h_delta: 0.15,
  server_signal_entry_24h_delta: 0.1,
  parity_mismatch_n_delta: 0.4,
});

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function mean(values = []) {
  const nums = (Array.isArray(values) ? values : []).map((value) => Number(value)).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((acc, value) => acc + value, 0) / nums.length;
}

function parseKstTimestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.endsWith(" KST")
    ? `${raw.slice(0, -4).replace(" ", "T")}+09:00`
    : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function summarizeObjectiveSnapshot(report = null, observedAtMs = null) {
  const raw = report && report.raw && typeof report.raw === "object" ? report.raw : report || {};
  const objective = raw.self_evolution_objective && typeof raw.self_evolution_objective === "object"
    ? raw.self_evolution_objective
    : {};
  const signalQuality = raw.self_evolution_server_signal_quality && typeof raw.self_evolution_server_signal_quality === "object"
    ? raw.self_evolution_server_signal_quality
    : {};
  const signalAuthority = raw.self_evolution_server_signal_authority && typeof raw.self_evolution_server_signal_authority === "object"
    ? raw.self_evolution_server_signal_authority
    : {};
  return {
    observed_at_kst: String(raw.generated_at_kst || "").trim() || null,
    observed_at_ms: observedAtMs != null ? observedAtMs : parseKstTimestampMs(raw.generated_at_kst || raw.generated_at),
    cycle_id: String(raw.cycle_id || raw.generation_id || "").trim() || null,
    verdict: String(raw.verdict || "").trim().toUpperCase() || null,
    objective_score: toNum(objective.objective_score ?? raw.objective_score),
    monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw ?? raw.monthly_run_rate_krw),
    server_signal_entry_24h_n: toNum(signalQuality.authoritative_entry_signal_24h_n),
    server_signal_intent_24h_n: toNum(signalQuality.order_intent_24h_n),
    server_signal_fill_24h_n: toNum(signalQuality.fill_24h_n),
    parity_mismatch_n: toNum(signalAuthority.parity_mismatch_n),
  };
}

function buildActionSignature(row = {}) {
  return String(
    row.signature
    || row.display_signature
    || row.next_display_signature
    || row.candidate_id
    || row.source
    || row.reason
    || "UNKNOWN"
  ).trim();
}

function deriveChangeEvents(stageReports = []) {
  const reports = Array.isArray(stageReports) ? stageReports : [];
  const events = [];
  const previousKeyByStage = new Map();
  for (const report of reports) {
    const raw = report && report.raw && typeof report.raw === "object" ? report.raw : report || {};
    const observedAtKst = String(raw.generated_at_kst || "").trim() || null;
    const observedAtMs = parseKstTimestampMs(observedAtKst);
    const cycleId = String(raw.cycle_id || raw.generation_id || "").trim() || null;
    const rows = Array.isArray(raw.stage_rows) ? raw.stage_rows : [];
    for (const row of rows) {
      const stage = String(row && row.stage || "").trim().toUpperCase();
      const action = String(row && row.last_action || "").trim().toUpperCase();
      if (!stage) continue;
      if (!["AUTO_APPLY", "AUTO_ROLLBACK", "OBSERVED_UPDATE"].includes(action)) continue;
      const signature = buildActionSignature(row);
      const dedupeKey = `${action}__${signature}`;
      if (previousKeyByStage.get(stage) === dedupeKey) continue;
      previousKeyByStage.set(stage, dedupeKey);
      events.push({
        event_id: `${stage}__${action}__${signature}`.slice(0, 256),
        observed_at_kst: observedAtKst,
        observed_at_ms: observedAtMs,
        cycle_id: cycleId,
        stage,
        action,
        reason: String(row && row.reason || "").trim() || null,
        source: String(row && row.source || "").trim().toUpperCase() || null,
        signature,
        candidate_id: String(row && row.candidate_id || "").trim() || null,
      });
    }
  }
  return events
    .filter((row) => Number.isFinite(row.observed_at_ms))
    .sort((a, b) => Number(a.observed_at_ms) - Number(b.observed_at_ms));
}

function selectBaselineSnapshot(snapshots = [], eventMs = null) {
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .filter((row) => Number.isFinite(row && row.observed_at_ms))
    .sort((a, b) => Number(a.observed_at_ms) - Number(b.observed_at_ms));
  if (!Number.isFinite(eventMs) || !rows.length) return null;
  let baseline = null;
  for (const row of rows) {
    if (Number(row.observed_at_ms) <= eventMs) baseline = row;
    else break;
  }
  return baseline || rows[0] || null;
}

function selectWindowSnapshot(snapshots = [], eventMs = null, windowHours = 24) {
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .filter((row) => Number.isFinite(row && row.observed_at_ms))
    .sort((a, b) => Number(a.observed_at_ms) - Number(b.observed_at_ms));
  if (!Number.isFinite(eventMs) || !rows.length) {
    return { status: "PENDING", snapshot: null };
  }
  const targetMs = eventMs + (Number(windowHours) * 60 * 60 * 1000);
  const laterRows = rows.filter((row) => Number(row.observed_at_ms) > eventMs);
  const complete = laterRows.find((row) => Number(row.observed_at_ms) >= targetMs) || null;
  if (complete) return { status: "COMPLETE", snapshot: complete };
  const partial = laterRows[laterRows.length - 1] || null;
  if (partial) return { status: "PARTIAL", snapshot: partial };
  return { status: "PENDING", snapshot: null };
}

function deriveAdaptiveImpactWeights(changes = []) {
  const base = { ...BASE_IMPACT_WEIGHTS };
  const windows = (Array.isArray(changes) ? changes : [])
    .map((row) => row && row.window_24h)
    .filter((row) => row && row.status === "COMPLETE" && toNum(row.objective_score_delta) != null);
  const positive = windows.filter((row) => Number(row.objective_score_delta) > 0);
  const adverse = windows.filter((row) => Number(row.objective_score_delta) < 0);
  if (!positive.length || !adverse.length) {
    return {
      ...base,
      tuning_status: "INSUFFICIENT_SAMPLE",
      sample_n: windows.length,
      positive_n: positive.length,
      adverse_n: adverse.length,
    };
  }

  const fillSignal = (mean(positive.map((row) => row.server_signal_fill_24h_delta)) || 0) - (mean(adverse.map((row) => row.server_signal_fill_24h_delta)) || 0);
  const intentSignal = (mean(positive.map((row) => row.server_signal_intent_24h_delta)) || 0) - (mean(adverse.map((row) => row.server_signal_intent_24h_delta)) || 0);
  const entrySignal = (mean(positive.map((row) => row.server_signal_entry_24h_delta)) || 0) - (mean(adverse.map((row) => row.server_signal_entry_24h_delta)) || 0);
  const mismatchSignal = (mean(adverse.map((row) => row.parity_mismatch_n_delta)) || 0) - (mean(positive.map((row) => row.parity_mismatch_n_delta)) || 0);

  return {
    objective_score_delta: 1,
    server_signal_fill_24h_delta: roundTo(clamp(base.server_signal_fill_24h_delta + (0.15 * Math.tanh(fillSignal / 8)), 0.15, 0.6), 4),
    server_signal_intent_24h_delta: roundTo(clamp(base.server_signal_intent_24h_delta + (0.08 * Math.tanh(intentSignal / 6)), 0.05, 0.35), 4),
    server_signal_entry_24h_delta: roundTo(clamp(base.server_signal_entry_24h_delta + (0.06 * Math.tanh(entrySignal / 6)), 0.03, 0.25), 4),
    parity_mismatch_n_delta: roundTo(clamp(base.parity_mismatch_n_delta + (0.2 * Math.tanh(mismatchSignal / 5)), 0.15, 0.7), 4),
    tuning_status: "ADAPTIVE",
    sample_n: windows.length,
    positive_n: positive.length,
    adverse_n: adverse.length,
  };
}

function deriveDeltaWindow({ baseline = null, selection = null, windowHours = 24, impactWeights = BASE_IMPACT_WEIGHTS } = {}) {
  const base = baseline && typeof baseline === "object" ? baseline : null;
  const snapshot = selection && selection.snapshot && typeof selection.snapshot === "object" ? selection.snapshot : null;
  const status = String(selection && selection.status || "PENDING").trim().toUpperCase() || "PENDING";
  if (!base || !snapshot) {
    return {
      status,
      window_hours: windowHours,
      effective_hours: null,
      observed_at_kst: snapshot ? snapshot.observed_at_kst : null,
      objective_score_delta: null,
      monthly_run_rate_krw_delta: null,
      server_signal_entry_24h_delta: null,
      server_signal_intent_24h_delta: null,
      server_signal_fill_24h_delta: null,
      parity_mismatch_n_delta: null,
      impact_score: null,
      impact_verdict: status === "PENDING" ? "PENDING" : "INSUFFICIENT_BASELINE",
    };
  }
  const effectiveHours = Number.isFinite(base.observed_at_ms) && Number.isFinite(snapshot.observed_at_ms)
    ? roundTo((Number(snapshot.observed_at_ms) - Number(base.observed_at_ms)) / (60 * 60 * 1000), 2)
    : null;
  const objectiveScoreDelta = roundTo((toNum(snapshot.objective_score) || 0) - (toNum(base.objective_score) || 0), 4);
  const monthlyRunRateDelta = roundTo((toNum(snapshot.monthly_run_rate_krw) || 0) - (toNum(base.monthly_run_rate_krw) || 0), 2);
  const entryDelta = roundTo((toNum(snapshot.server_signal_entry_24h_n) || 0) - (toNum(base.server_signal_entry_24h_n) || 0), 0);
  const intentDelta = roundTo((toNum(snapshot.server_signal_intent_24h_n) || 0) - (toNum(base.server_signal_intent_24h_n) || 0), 0);
  const fillDelta = roundTo((toNum(snapshot.server_signal_fill_24h_n) || 0) - (toNum(base.server_signal_fill_24h_n) || 0), 0);
  const mismatchDelta = roundTo((toNum(snapshot.parity_mismatch_n) || 0) - (toNum(base.parity_mismatch_n) || 0), 0);
  const impactScore = roundTo(
    ((objectiveScoreDelta || 0) * (toNum(impactWeights.objective_score_delta) || 1))
    + ((fillDelta || 0) * (toNum(impactWeights.server_signal_fill_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_fill_24h_delta))
    + ((intentDelta || 0) * (toNum(impactWeights.server_signal_intent_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_intent_24h_delta))
    + ((entryDelta || 0) * (toNum(impactWeights.server_signal_entry_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_entry_24h_delta))
    - ((mismatchDelta || 0) * (toNum(impactWeights.parity_mismatch_n_delta) || BASE_IMPACT_WEIGHTS.parity_mismatch_n_delta)),
    4
  );
  let impactVerdict = "NEUTRAL";
  if (status === "PARTIAL") impactVerdict = impactScore >= 0.75 ? "PARTIAL_POSITIVE" : (impactScore <= -0.75 ? "PARTIAL_ADVERSE" : "PARTIAL_MONITOR");
  else if (impactScore >= 1.0) impactVerdict = "POSITIVE";
  else if (impactScore <= -1.0) impactVerdict = "ADVERSE";
  return {
    status,
    window_hours: windowHours,
    effective_hours: effectiveHours,
    observed_at_kst: snapshot.observed_at_kst || null,
    objective_score_delta: objectiveScoreDelta,
    monthly_run_rate_krw_delta: monthlyRunRateDelta,
    server_signal_entry_24h_delta: entryDelta,
    server_signal_intent_24h_delta: intentDelta,
    server_signal_fill_24h_delta: fillDelta,
    parity_mismatch_n_delta: mismatchDelta,
    impact_weights: {
      objective_score_delta: toNum(impactWeights.objective_score_delta) || 1,
      server_signal_fill_24h_delta: toNum(impactWeights.server_signal_fill_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_fill_24h_delta,
      server_signal_intent_24h_delta: toNum(impactWeights.server_signal_intent_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_intent_24h_delta,
      server_signal_entry_24h_delta: toNum(impactWeights.server_signal_entry_24h_delta) || BASE_IMPACT_WEIGHTS.server_signal_entry_24h_delta,
      parity_mismatch_n_delta: toNum(impactWeights.parity_mismatch_n_delta) || BASE_IMPACT_WEIGHTS.parity_mismatch_n_delta,
    },
    impact_score: impactScore,
    impact_verdict: impactVerdict,
  };
}

function resolvePrimaryImpact(change = {}) {
  const window72h = change.window_72h && typeof change.window_72h === "object"
    ? change.window_72h
    : (change.window72h && typeof change.window72h === "object" ? change.window72h : {});
  const window24h = change.window_24h && typeof change.window_24h === "object"
    ? change.window_24h
    : (change.window24h && typeof change.window24h === "object" ? change.window24h : {});
  if (window72h.status === "COMPLETE") return { primary_window: "72H", ...window72h };
  if (window24h.status === "COMPLETE") return { primary_window: "24H", ...window24h };
  if (window72h.status === "PARTIAL") return { primary_window: "72H_PARTIAL", ...window72h };
  if (window24h.status === "PARTIAL") return { primary_window: "24H_PARTIAL", ...window24h };
  return {
    primary_window: "PENDING",
    status: "PENDING",
    impact_score: null,
    impact_verdict: "PENDING",
  };
}

function deriveChangeResultAttribution({
  stageReports = [],
  objectiveReports = [],
} = {}) {
  const objectiveSnapshots = (Array.isArray(objectiveReports) ? objectiveReports : [])
    .map((row) => {
      const raw = row && row.raw && typeof row.raw === "object" ? row.raw : row || {};
      const observedAtMs = parseKstTimestampMs(raw.generated_at_kst || raw.generated_at);
      return summarizeObjectiveSnapshot(raw, observedAtMs);
    })
    .filter((row) => Number.isFinite(row.observed_at_ms))
    .sort((a, b) => Number(a.observed_at_ms) - Number(b.observed_at_ms));
  const events = deriveChangeEvents(stageReports);
  function buildChanges(impactWeights = BASE_IMPACT_WEIGHTS) {
    return events.map((event) => {
      const baseline = selectBaselineSnapshot(objectiveSnapshots, event.observed_at_ms);
      const window24h = deriveDeltaWindow({
        baseline,
        selection: selectWindowSnapshot(objectiveSnapshots, event.observed_at_ms, 24),
        windowHours: 24,
        impactWeights,
      });
      const window72h = deriveDeltaWindow({
        baseline,
        selection: selectWindowSnapshot(objectiveSnapshots, event.observed_at_ms, 72),
        windowHours: 72,
        impactWeights,
      });
      const primary = resolvePrimaryImpact({ window24h, window72h });
      return {
        ...event,
        baseline: baseline ? {
          observed_at_kst: baseline.observed_at_kst,
          objective_score: baseline.objective_score,
          monthly_run_rate_krw: baseline.monthly_run_rate_krw,
          server_signal_entry_24h_n: baseline.server_signal_entry_24h_n,
          server_signal_intent_24h_n: baseline.server_signal_intent_24h_n,
          server_signal_fill_24h_n: baseline.server_signal_fill_24h_n,
          parity_mismatch_n: baseline.parity_mismatch_n,
        } : null,
        window_24h: window24h,
        window_72h: window72h,
        primary_impact: primary,
      };
    });
  }

  const provisionalChanges = buildChanges(BASE_IMPACT_WEIGHTS);
  const impactWeights = deriveAdaptiveImpactWeights(provisionalChanges);
  const changes = buildChanges(impactWeights);

  const evaluated24h = changes.filter((row) => row.window_24h && row.window_24h.status === "COMPLETE");
  const evaluated72h = changes.filter((row) => row.window_72h && row.window_72h.status === "COMPLETE");
  const partial = changes.filter((row) =>
    (row.window_24h && row.window_24h.status === "PARTIAL")
    || (row.window_72h && row.window_72h.status === "PARTIAL")
  );
  const scored = changes
    .filter((row) => row.primary_impact && toNum(row.primary_impact.impact_score) != null)
    .slice()
    .sort((a, b) => Number(b.primary_impact.impact_score) - Number(a.primary_impact.impact_score));
  const positive = scored.filter((row) => String(row.primary_impact.impact_verdict || "").includes("POSITIVE"));
  const adverse = scored.filter((row) => String(row.primary_impact.impact_verdict || "").includes("ADVERSE"));
  const pending = changes.filter((row) => row.primary_impact && row.primary_impact.status === "PENDING");
  const successRate = positive.length + adverse.length > 0
    ? roundTo(positive.length / (positive.length + adverse.length), 4)
    : null;

  return {
    status: changes.length ? "CHANGE_RESULT_TRACKING_ACTIVE" : "CHANGE_RESULT_TRACKING_PENDING",
    tracked_change_n: changes.length,
    evaluated_24h_n: evaluated24h.length,
    evaluated_72h_n: evaluated72h.length,
    partial_window_n: partial.length,
    pending_window_n: pending.length,
    positive_change_n: positive.length,
    adverse_change_n: adverse.length,
    success_rate: successRate,
    impact_weights: impactWeights,
    top_positive_change: positive[0] || null,
    top_adverse_change: adverse[0] || null,
    top_pending_change: pending[0] || partial[0] || null,
    top_watch_changes: changes.slice(0, 8).map((row) => ({
      stage: row.stage,
      action: row.action,
      reason: row.reason,
      source: row.source,
      candidate_id: row.candidate_id,
      primary_window: row.primary_impact.primary_window,
      impact_verdict: row.primary_impact.impact_verdict,
      impact_score: row.primary_impact.impact_score,
      objective_score_delta: row.primary_impact.objective_score_delta,
      server_signal_fill_24h_delta: row.primary_impact.server_signal_fill_24h_delta,
      parity_mismatch_n_delta: row.primary_impact.parity_mismatch_n_delta,
      observed_at_kst: row.observed_at_kst,
    })),
    changes,
  };
}

module.exports = {
  deriveChangeResultAttribution,
  __test: {
    parseKstTimestampMs,
    summarizeObjectiveSnapshot,
    deriveChangeEvents,
    selectBaselineSnapshot,
    selectWindowSnapshot,
    deriveDeltaWindow,
    deriveAdaptiveImpactWeights,
    resolvePrimaryImpact,
    BASE_IMPACT_WEIGHTS,
  },
};
