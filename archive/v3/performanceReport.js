"use strict";

const { evaluateV3PaperPolicy } = require("./paperPolicy");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function deriveExactCohortKey(row = {}) {
  const existing = trimOrNull(row && row.cohort_key);
  if (existing) return existing;
  return [
    upper(row && row.side) || "UNKNOWN",
    upper(row && row.setup_type) || "UNKNOWN",
    upper(row && row.structural_regime) || "UNKNOWN",
    upper(row && row.edge_cohort) || "UNKNOWN",
    upper(row && row.entry_grade) || "UNKNOWN",
  ].join(" | ");
}

function round(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function formatKstDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function buildClosedSignalIdSet(exitRows = []) {
  const ids = new Set();
  for (const row of exitRows) {
    const signalId = trimOrNull(row && row.signal_id);
    if (signalId) ids.add(signalId);
  }
  return ids;
}

function hydrateExitRows(exitRows = [], entryRows = []) {
  const entryBySignalId = new Map();
  for (const row of Array.isArray(entryRows) ? entryRows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    if (!signalId) continue;
    entryBySignalId.set(signalId, row);
  }
  return Object.freeze(
    (Array.isArray(exitRows) ? exitRows : []).map((row) => {
      const signalId = trimOrNull(row && row.signal_id);
      const entry = signalId ? entryBySignalId.get(signalId) : null;
      return Object.freeze({
        ...row,
        side: upper(row && row.side) || upper(entry && entry.side),
        setup_type: upper(row && row.setup_type) || upper(entry && entry.setup_type),
        structural_regime: upper(row && row.structural_regime) || upper(entry && entry.structural_regime),
        edge_cohort: upper(row && row.edge_cohort) || upper(entry && entry.edge_cohort),
        cohort_key: trimOrNull(row && row.cohort_key) || trimOrNull(entry && entry.cohort_key),
        profile_id: upper(row && row.profile_id) || upper(entry && entry.profile_id),
        entry_grade: upper(row && row.entry_grade) || upper(entry && entry.entry_grade),
      });
    })
  );
}

function buildOpenEntries(entryRows = [], exitRows = []) {
  const closedSignalIds = buildClosedSignalIdSet(exitRows);
  return Object.freeze(
    (Array.isArray(entryRows) ? entryRows : [])
      .filter((row) => upper(row && row.status) === "OPEN")
      .filter((row) => {
        const signalId = trimOrNull(row && row.signal_id);
        return signalId && !closedSignalIds.has(signalId);
      })
      .map((row) => Object.freeze({
        v3_paper_entry_id: trimOrNull(row.v3_paper_entry_id),
        signal_id: trimOrNull(row.signal_id),
        symbol: upper(row.symbol),
        exchange: upper(row.exchange),
        tf: trimOrNull(row.tf),
        side: upper(row.side),
        setup_type: upper(row.setup_type),
        structural_regime: upper(row.structural_regime),
        edge_cohort: upper(row.edge_cohort),
        cohort_key: trimOrNull(row.cohort_key),
        profile_id: upper(row.profile_id),
        entry_grade: upper(row.entry_grade),
        created_at: trimOrNull(row.created_at),
        signal_price: toNumberOrNull(row.signal_price),
        stop_price: toNumberOrNull(row.stop_price),
        target_price: toNumberOrNull(row.target_price),
      }))
  );
}

function summarizeRows(rows = [], field) {
  let winN = 0;
  let lossN = 0;
  let flatN = 0;
  let net = 0;
  let grossProfit = 0;
  let grossLossAbs = 0;

  for (const row of rows) {
    const value = toNumberOrNull(row && row[field]);
    if (value === null) continue;
    net += value;
    if (value > 0) {
      winN += 1;
      grossProfit += value;
    } else if (value < 0) {
      lossN += 1;
      grossLossAbs += Math.abs(value);
    } else {
      flatN += 1;
    }
  }

  const sampleN = rows.length;
  const winRatePct = sampleN > 0 ? (winN / sampleN) * 100 : 0;
  const expectancy = sampleN > 0 ? net / sampleN : 0;
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : (grossProfit > 0 ? Infinity : 0);

  return Object.freeze({
    sample_n: sampleN,
    win_n: winN,
    loss_n: lossN,
    flat_n: flatN,
    win_rate_pct: round(winRatePct, 2),
    expectancy: round(expectancy, 4),
    net: round(net, 4),
    gross_profit: round(grossProfit, 4),
    gross_loss_abs: round(grossLossAbs, 4),
    profit_factor: profitFactor === Infinity ? "INF" : round(profitFactor, 4),
  });
}

function buildGroupedMetrics(exitRows = [], field) {
  const groups = new Map();
  for (const row of exitRows) {
    const key = deriveExactCohortKey(row);
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  }
  return Object.freeze(
    [...groups.entries()]
      .map(([key, rows]) => Object.freeze({
        key,
        cohort_key: key,
        profile_ids: Object.freeze(
          [...new Set(rows.map((row) => upper(row && row.profile_id)).filter(Boolean))]
            .sort((a, b) => String(a).localeCompare(String(b)))
        ),
        side: upper(rows[0] && rows[0].side),
        setup_type: upper(rows[0] && rows[0].setup_type),
        structural_regime: upper(rows[0] && rows[0].structural_regime),
        edge_cohort: upper(rows[0] && rows[0].edge_cohort),
        entry_grade: upper(rows[0] && rows[0].entry_grade),
        ...summarizeRows(rows, field),
      }))
      .sort((a, b) => (
        Number(b.net || 0) - Number(a.net || 0)
        || Number(b.sample_n || 0) - Number(a.sample_n || 0)
        || String(a.key).localeCompare(String(b.key))
      ))
  );
}

function buildSideMetrics(exitRows = [], field) {
  const sides = ["LONG", "SHORT"];
  const metrics = {};
  for (const side of sides) {
    metrics[side] = summarizeRows(
      exitRows.filter((row) => upper(row && row.side) === side),
      field
    );
  }
  return Object.freeze(metrics);
}

function buildRecentExits(exitRows = [], limit = 20) {
  return Object.freeze(
    [...exitRows]
      .sort((a, b) => String(b.closed_at || "").localeCompare(String(a.closed_at || "")))
      .slice(0, limit)
      .map((row) => Object.freeze({
        v3_paper_exit_id: trimOrNull(row.v3_paper_exit_id),
        signal_id: trimOrNull(row.signal_id),
        closed_at: trimOrNull(row.closed_at),
        symbol: upper(row.symbol),
        side: upper(row.side),
        setup_type: upper(row.setup_type),
        structural_regime: upper(row.structural_regime),
        edge_cohort: upper(row.edge_cohort),
        cohort_key: trimOrNull(row.cohort_key),
        profile_id: upper(row.profile_id),
        entry_grade: upper(row.entry_grade),
        exit_event: upper(row.exit_event),
        realized_r: toNumberOrNull(row.realized_r),
        realized_pnl_pct: toNumberOrNull(row.realized_pnl_pct),
      }))
  );
}

function isCurrentPolicyExit(row = {}) {
  const verdict = evaluateV3PaperPolicy({
    side: upper(row && row.side),
    setup_type: upper(row && row.setup_type),
    structural_regime: upper(row && row.structural_regime),
    edge_cohort: upper(row && row.edge_cohort),
    entry_grade: upper(row && row.entry_grade),
  });
  return verdict && verdict.ok === true && String(verdict.apply_mode || "ACTIVE").toUpperCase() === "ACTIVE";
}

function buildV3PaperPerformanceReport(entryRows = [], exitRows = [], { now = new Date() } = {}) {
  const allExitRows = hydrateExitRows(
    (Array.isArray(exitRows) ? exitRows : []).filter((row) => upper(row && row.status) === "CLOSED"),
    entryRows
  );
  const currentPolicyExitRows = allExitRows.filter(isCurrentPolicyExit);
  const todayKey = formatKstDateKey(now);
  const todayExitRows = allExitRows.filter((row) => formatKstDateKey(row && row.closed_at) === todayKey);
  const currentPolicyTodayExitRows = currentPolicyExitRows.filter((row) => formatKstDateKey(row && row.closed_at) === todayKey);
  const openEntries = buildOpenEntries(entryRows, allExitRows);

  return Object.freeze({
    ok: true,
    timezone: "Asia/Seoul",
    kst_trade_date: todayKey,
    source_entry_n: Array.isArray(entryRows) ? entryRows.length : 0,
    source_exit_n: allExitRows.length,
    open_position_n: openEntries.length,
    today_closed_trade_n: todayExitRows.length,
    current_policy_closed_trade_n: currentPolicyExitRows.length,
    all_time_metrics_r: summarizeRows(allExitRows, "realized_r"),
    all_time_metrics_pct: summarizeRows(allExitRows, "realized_pnl_pct"),
    current_policy_metrics_r: summarizeRows(currentPolicyExitRows, "realized_r"),
    current_policy_metrics_pct: summarizeRows(currentPolicyExitRows, "realized_pnl_pct"),
    today_metrics_r: summarizeRows(todayExitRows, "realized_r"),
    today_metrics_pct: summarizeRows(todayExitRows, "realized_pnl_pct"),
    current_policy_today_metrics_r: summarizeRows(currentPolicyTodayExitRows, "realized_r"),
    current_policy_today_metrics_pct: summarizeRows(currentPolicyTodayExitRows, "realized_pnl_pct"),
    all_time_side_metrics_r: buildSideMetrics(allExitRows, "realized_r"),
    current_policy_side_metrics_r: buildSideMetrics(currentPolicyExitRows, "realized_r"),
    today_side_metrics_r: buildSideMetrics(todayExitRows, "realized_r"),
    group_metric_basis: "EXACT_COHORT",
    all_time_group_metrics_r: Object.freeze(buildGroupedMetrics(allExitRows, "realized_r").slice(0, 20)),
    current_policy_group_metrics_r: Object.freeze(buildGroupedMetrics(currentPolicyExitRows, "realized_r").slice(0, 20)),
    recent_exits: buildRecentExits(allExitRows, 20),
    open_positions: Object.freeze(openEntries.slice(0, 20)),
  });
}

module.exports = Object.freeze({
  buildV3PaperPerformanceReport,
  __test: {
    formatKstDateKey,
    buildOpenEntries,
    summarizeRows,
    deriveExactCohortKey,
    hydrateExitRows,
  },
});
