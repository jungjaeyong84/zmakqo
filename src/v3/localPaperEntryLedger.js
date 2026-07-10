"use strict";

const fs = require("fs");
const { computeCostR } = require("./localPaperExitLedger");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upper(value) {
  const text = trimOrNull(value);
  return text ? text.toUpperCase() : null;
}

function parseTimeMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function parseTfToMs(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const match = /^(\d+)([mhdw])$/i.exec(text);
  if (!match) return null;
  const count = Number(match[1]);
  const unit = String(match[2] || "").toLowerCase();
  if (!Number.isFinite(count) || count <= 0) return null;
  const unitMs = (
    unit === "m" ? 60 * 1000
      : unit === "h" ? 60 * 60 * 1000
        : unit === "d" ? 24 * 60 * 60 * 1000
          : unit === "w" ? 7 * 24 * 60 * 60 * 1000
            : null
  );
  return unitMs ? count * unitMs : null;
}

function buildPositionLockKey(symbol, side) {
  const normalizedSymbol = upper(symbol);
  const normalizedSide = upper(side);
  if (!normalizedSymbol || !normalizedSide) return null;
  return `${normalizedSymbol}::${normalizedSide}`;
}

function readJsonlRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

function appendJsonlRows(filePath, rows = []) {
  if (!rows.length) return 0;
  const payload = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.appendFileSync(filePath, payload);
  return rows.length;
}

function writeJsonlRows(filePath, rows = []) {
  const payloadRows = Array.isArray(rows) ? rows : [];
  if (!payloadRows.length) {
    fs.writeFileSync(filePath, "");
    return 0;
  }
  const payload = `${payloadRows.map((row) => JSON.stringify(row)).join("\n")}\n`;
  fs.writeFileSync(filePath, payload);
  return payloadRows.length;
}

function hasCompleteLearningContext(row = {}) {
  return (
    upper(row.side)
    && upper(row.setup_type)
    && upper(row.structural_regime)
    && upper(row.edge_cohort)
    && trimOrNull(row.cohort_key)
    && upper(row.profile_id)
    && upper(row.entry_grade)
    && row.market_quality_score !== null
    && row.market_quality_score !== undefined
    && row.spread_bps !== null
    && row.spread_bps !== undefined
    && row.funding_rate !== null
    && row.funding_rate !== undefined
    && upper(row.btc_1h_trend)
    && upper(row.mtf_1h_direction)
    && row.signal_price !== null
    && row.signal_price !== undefined
    && row.stop_price !== null
    && row.stop_price !== undefined
    && row.target_price !== null
    && row.target_price !== undefined
  );
}

function buildEntryId(queueRow = {}) {
  const signalId = trimOrNull(queueRow.signal_id) || "UNKNOWN_SIGNAL";
  return `V3ENTRY__${signalId}`;
}

function resolveConfiguredMaxSignalAgeMs() {
  const raw = Number(process.env.V3_LEDGER_MAX_SIGNAL_AGE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function resolveSignalStaleGraceMs() {
  const raw = Number(process.env.V3_LEDGER_SIGNAL_STALE_GRACE_MS || (5 * 60 * 1000));
  return Number.isFinite(raw) && raw >= 0 ? raw : (5 * 60 * 1000);
}

function resolveSignalAgeLimitMs(row = {}) {
  const configured = resolveConfiguredMaxSignalAgeMs();
  if (configured) return configured;
  const tfMs = parseTfToMs(row && row.tf) || (15 * 60 * 1000);
  return tfMs + resolveSignalStaleGraceMs();
}

function resolveSymbolCooldownMs(row = {}) {
  const configured = Number(process.env.V3_LEDGER_SYMBOL_COOLDOWN_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return parseTfToMs(row && row.tf) || (15 * 60 * 1000);
}

// 2026-06-19 — portfolio risk controls (live-readiness prerequisite).
// The v3 short engine fires up to ~19 correlated SHORT entries in a single
// market-wide down-move (crypto symbols are 0.7-0.9 correlated), so the
// per-symbol-side lock alone does NOT bound real exposure: one adverse
// macro move can hit every stacked short at once. These caps bound the
// effective single-bet size and add a daily circuit breaker. All are
// env-overridable so paper and live can be tuned without a code change.
//
//   V3_MAX_OPEN_TOTAL       max concurrent open positions (default 6)
//   V3_MAX_OPEN_PER_SIDE    max concurrent per direction  (default 5)
//   V3_DAILY_DRAWDOWN_KILL_R  if today's realized R <= this (negative),
//                             halt ALL new entries for the rest of the UTC
//                             day. Default -5R. Set 0 to disable.
function resolveMaxOpenTotal() {
  const raw = Number(process.env.V3_MAX_OPEN_TOTAL);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 6;
}

function resolveMaxOpenPerSide() {
  const raw = Number(process.env.V3_MAX_OPEN_PER_SIDE);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
}

function resolveDailyDrawdownKillR() {
  const raw = Number(process.env.V3_DAILY_DRAWDOWN_KILL_R);
  // 0 (or unset-to-0) disables the kill switch; only negative values arm it.
  if (Number.isFinite(raw)) return raw;
  return -5;
}

// 2026-07-05 — symmetric entry-quality filters (operator doctrine: no
// policy may treat LONG and SHORT differently — same rule, same threshold,
// both sides).
//
// Evidence (post-RR era n=498, chronological 70/30 train/test, see
// scripts/analyze-v3-wr-levers-round2.js):
//   - funding_rate >= 0 at entry improves BOTH sides independently
//     (LONG 31.4%→46.6% WR, SHORT 53.2%→59.5% WR) and holds out-of-sample.
//   - INJUSDT was a robust drag on the SHORT side (TR -0.15 / TE -0.49,
//     n=13/13) and its LONG edge had already collapsed out-of-sample; the
//     ban is applied to BOTH sides per the symmetry doctrine.
//   - combined: era 52.0%→55.3% WR, +0.187→+0.280R per trade,
//     live-cost-adjusted expectancy +0.067→+0.160R (2.4x), at the cost of
//     ~47% of trade volume (the cut bucket was ~breakeven, +0.08R).
//
//   V3_ENTRY_MIN_FUNDING      minimum funding_rate at entry, applied to both
//                             sides identically (default 0). In practice
//                             funding is always present here because the
//                             learning-context gate upstream already rejects
//                             rows without it; the isFinite guard below is
//                             defensive only.
//   V3_ENTRY_SYMBOL_DENYLIST  comma-separated symbols blocked for BOTH
//                             sides (default "INJUSDT").
function resolveEntryMinFunding() {
  const raw = Number(process.env.V3_ENTRY_MIN_FUNDING);
  return Number.isFinite(raw) ? raw : 0;
}

function resolveEntrySymbolDenylist() {
  const raw = process.env.V3_ENTRY_SYMBOL_DENYLIST;
  const list = raw == null ? ["INJUSDT"] : String(raw).split(",");
  return new Set(list.map((s) => String(s || "").trim().toUpperCase()).filter(Boolean));
}

// 2026-07-10 — equity-curve state, OBSERVE-ONLY. The trailing-20 filter
// (trade only when the last 20 closed trades net > 0 after costs) showed
// ON +0.224R vs OFF -0.064R net on the full ledger, but only window=20
// survived the chronological 70/30 split and only barely (+0.046R);
// windows 10/30 flipped negative out-of-sample. Not shippable as a
// blocking filter — we stamp the state on every admitted entry so forward
// samples accumulate, and promote it only if the split keeps holding.
//
//   V3_EQUITY_CURVE_WINDOW  trailing closed-trade count (default 20).
function resolveEquityCurveWindowN() {
  const raw = Number(process.env.V3_EQUITY_CURVE_WINDOW);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 20;
}

function toExitNetR(row) {
  const net = Number(row && row.realized_r_net);
  if (Number.isFinite(net)) return net;
  const gross = Number(row && row.realized_r);
  if (!Number.isFinite(gross)) return null;
  const costR = computeCostR(row || {});
  return costR === null ? gross : gross - costR;
}

function computeEquityCurveState(exitRows = [], nowMs = Date.now(), windowN = resolveEquityCurveWindowN()) {
  const closed = [];
  for (const row of Array.isArray(exitRows) ? exitRows : []) {
    if (upper(row && row.status) !== "CLOSED") continue;
    const closedMs = parseTimeMs(row && row.closed_at);
    if (!Number.isFinite(closedMs) || closedMs >= nowMs) continue;
    const netR = toExitNetR(row);
    if (netR === null) continue;
    closed.push({ closed_ms: closedMs, net_r: netR });
  }
  closed.sort((a, b) => a.closed_ms - b.closed_ms);
  if (closed.length < windowN) {
    return Object.freeze({ state: null, window_n: windowN, trailing_net_r: null, sample_n: closed.length });
  }
  const trailingNetR = closed
    .slice(closed.length - windowN)
    .reduce((acc, row) => acc + row.net_r, 0);
  return Object.freeze({
    state: trailingNetR > 0 ? "ON" : "OFF",
    window_n: windowN,
    trailing_net_r: Number(trailingNetR.toFixed(4)),
    sample_n: closed.length,
  });
}

// Sum realized R for exits closed since 00:00 UTC of `nowMs`. Drives the
// daily-drawdown circuit breaker. Open-position unrealized PnL is
// deliberately excluded — the breaker trips on booked losses only.
function computeTodayRealizedR(exitRows = [], nowMs = Date.now()) {
  const dayStart = new Date(Number(nowMs) || Date.now());
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();
  let net = 0;
  let n = 0;
  for (const row of Array.isArray(exitRows) ? exitRows : []) {
    if (upper(row && row.status) !== "CLOSED") continue;
    const closedMs = parseTimeMs(row && row.closed_at);
    if (!Number.isFinite(closedMs) || closedMs < dayStartMs) continue;
    const r = Number(row && row.realized_r);
    if (!Number.isFinite(r)) continue;
    net += r;
    n += 1;
  }
  return { net, n, day_start_ms: dayStartMs };
}

function buildOpenSymbolIndex(existingRows = [], { closedSignalIds = new Set() } = {}) {
  const openBySymbol = new Map();
  const seenSignalIds = new Set();
  for (const row of existingRows) {
    const signalId = trimOrNull(row && row.signal_id);
    if (signalId) seenSignalIds.add(signalId);
    if (upper(row && row.status) !== "OPEN") continue;
    if (signalId && closedSignalIds.has(signalId)) continue;
    const positionKey = buildPositionLockKey(row && row.symbol, row && row.side);
    if (!positionKey) continue;
    openBySymbol.set(positionKey, row);
  }
  return Object.freeze({ openBySymbol, seenSignalIds });
}

function buildRecordedSignalIdSet(existingRows = []) {
  const ids = new Set();
  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    if (signalId) ids.add(signalId);
  }
  return ids;
}

function buildRecentClosedSymbolIndex(exitRows = []) {
  const latestClosedBySymbol = new Map();
  for (const row of Array.isArray(exitRows) ? exitRows : []) {
    if (upper(row && row.status) !== "CLOSED") continue;
    const positionKey = buildPositionLockKey(row && row.symbol, row && row.side);
    const closedAtMs = parseTimeMs(row && row.closed_at);
    if (!positionKey || !Number.isFinite(closedAtMs)) continue;
    const previous = latestClosedBySymbol.get(positionKey);
    if (!previous || closedAtMs > previous.closed_at_ms) {
      latestClosedBySymbol.set(positionKey, Object.freeze({
        position_key: positionKey,
        symbol: upper(row && row.symbol),
        side: upper(row && row.side),
        closed_at_ms: closedAtMs,
        closed_at: trimOrNull(row && row.closed_at),
        signal_id: trimOrNull(row && row.signal_id),
        tf: trimOrNull(row && row.tf),
      }));
    }
  }
  return Object.freeze({ latestClosedBySymbol });
}

function compactQueueRows(queueRows = [], {
  recordedSignalIds = new Set(),
  nowMs = Date.now(),
} = {}) {
  const retainedRows = [];
  const prunedReasonCounts = Object.create(null);
  const seenQueueSignalIds = new Set();

  for (const row of Array.isArray(queueRows) ? queueRows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    const symbol = upper(row && row.symbol);
    if (!signalId || !symbol) {
      prunedReasonCounts.V3_QUEUE_SIGNAL_OR_SYMBOL_MISSING = Number(prunedReasonCounts.V3_QUEUE_SIGNAL_OR_SYMBOL_MISSING || 0) + 1;
      continue;
    }
    if (seenQueueSignalIds.has(signalId)) {
      prunedReasonCounts.V3_QUEUE_DUPLICATE_SIGNAL_ID = Number(prunedReasonCounts.V3_QUEUE_DUPLICATE_SIGNAL_ID || 0) + 1;
      continue;
    }
    seenQueueSignalIds.add(signalId);
    const signalCreatedAtMs = parseTimeMs(row && row.created_at);
    if (signalCreatedAtMs === null) {
      prunedReasonCounts.V3_QUEUE_SIGNAL_CREATED_AT_REQUIRED = Number(prunedReasonCounts.V3_QUEUE_SIGNAL_CREATED_AT_REQUIRED || 0) + 1;
      continue;
    }
    const signalAgeLimitMs = resolveSignalAgeLimitMs(row);
    if ((nowMs - signalCreatedAtMs) > signalAgeLimitMs) {
      prunedReasonCounts.V3_QUEUE_SIGNAL_STALE = Number(prunedReasonCounts.V3_QUEUE_SIGNAL_STALE || 0) + 1;
      continue;
    }
    if (recordedSignalIds.has(signalId)) {
      prunedReasonCounts.V3_QUEUE_SIGNAL_ALREADY_RECORDED = Number(prunedReasonCounts.V3_QUEUE_SIGNAL_ALREADY_RECORDED || 0) + 1;
      continue;
    }
    retainedRows.push(row);
  }

  return Object.freeze({
    max_signal_age_ms: resolveSignalAgeLimitMs((Array.isArray(queueRows) && queueRows[0]) || {}),
    signal_age_policy: resolveConfiguredMaxSignalAgeMs() ? "FIXED_MAX_AGE" : "TF_PLUS_GRACE",
    source_queue_n: Array.isArray(queueRows) ? queueRows.length : 0,
    retained_queue_n: retainedRows.length,
    pruned_queue_n: Math.max(0, (Array.isArray(queueRows) ? queueRows.length : 0) - retainedRows.length),
    pruned_reason_counts: Object.freeze(prunedReasonCounts),
    retained_rows: Object.freeze(retainedRows.slice()),
  });
}

function buildV3PaperEntryLedgerReport(queueRows = [], {
  ledgerPath = null,
  closedSignalIds = new Set(),
  exitRows = [],
  nowMs = Date.now(),
} = {}) {
  const existingRows = ledgerPath ? readJsonlRows(ledgerPath) : [];
  const index = buildOpenSymbolIndex(existingRows, { closedSignalIds });
  const recentClosed = buildRecentClosedSymbolIndex(exitRows);
  const blockedReasonCounts = Object.create(null);
  const newEntries = [];

  // --- symmetric entry-quality filters (see resolver block above) ---------
  const entryMinFunding = resolveEntryMinFunding();
  const entrySymbolDenylist = resolveEntrySymbolDenylist();
  // --- portfolio risk controls (see resolver block above) -----------------
  const maxOpenTotal = resolveMaxOpenTotal();
  const maxOpenPerSide = resolveMaxOpenPerSide();
  const dailyKillR = resolveDailyDrawdownKillR();
  const today = computeTodayRealizedR(exitRows, nowMs);
  const killSwitchActive = dailyKillR < 0 && today.net <= dailyKillR;
  // observe-only equity-curve state, stamped on every admitted entry
  // (never blocks — see the resolver block comment above).
  const equityCurve = computeEquityCurveState(exitRows, nowMs);
  // running open counts per side, seeded from positions already open.
  let openLongN = 0;
  let openShortN = 0;
  for (const openRow of index.openBySymbol.values()) {
    const openSide = upper(openRow && openRow.side);
    if (openSide === "LONG") openLongN += 1;
    else if (openSide === "SHORT") openShortN += 1;
  }

  for (const row of Array.isArray(queueRows) ? queueRows : []) {
    const signalId = trimOrNull(row && row.signal_id);
    const symbol = upper(row && row.symbol);
    const side = upper(row && row.side);
    if (!signalId || !symbol) {
      blockedReasonCounts.V3_LEDGER_SIGNAL_OR_SYMBOL_MISSING = Number(blockedReasonCounts.V3_LEDGER_SIGNAL_OR_SYMBOL_MISSING || 0) + 1;
      continue;
    }
    const signalCreatedAtMs = parseTimeMs(row && row.created_at);
    if (signalCreatedAtMs === null) {
      blockedReasonCounts.V3_LEDGER_SIGNAL_CREATED_AT_REQUIRED = Number(blockedReasonCounts.V3_LEDGER_SIGNAL_CREATED_AT_REQUIRED || 0) + 1;
      continue;
    }
    const signalAgeLimitMs = resolveSignalAgeLimitMs(row);
    if ((nowMs - signalCreatedAtMs) > signalAgeLimitMs) {
      blockedReasonCounts.V3_LEDGER_SIGNAL_STALE = Number(blockedReasonCounts.V3_LEDGER_SIGNAL_STALE || 0) + 1;
      continue;
    }
    if (index.seenSignalIds.has(signalId)) {
      blockedReasonCounts.V3_LEDGER_SIGNAL_ALREADY_RECORDED = Number(blockedReasonCounts.V3_LEDGER_SIGNAL_ALREADY_RECORDED || 0) + 1;
      continue;
    }
    const positionKey = buildPositionLockKey(symbol, side);
    const recentClosedEntry = positionKey ? recentClosed.latestClosedBySymbol.get(positionKey) : null;
    if (recentClosedEntry) {
      const cooldownMs = resolveSymbolCooldownMs(row);
      if ((signalCreatedAtMs - recentClosedEntry.closed_at_ms) < cooldownMs) {
        blockedReasonCounts.V3_LEDGER_SYMBOL_COOLDOWN_ACTIVE = Number(blockedReasonCounts.V3_LEDGER_SYMBOL_COOLDOWN_ACTIVE || 0) + 1;
        continue;
      }
    }
    if (positionKey && index.openBySymbol.has(positionKey)) {
      blockedReasonCounts.V3_LEDGER_SYMBOL_ALREADY_OPEN = Number(blockedReasonCounts.V3_LEDGER_SYMBOL_ALREADY_OPEN || 0) + 1;
      continue;
    }
    // symmetric quality filter 1 — symbol denylist (both sides, same list)
    if (entrySymbolDenylist.has(symbol)) {
      blockedReasonCounts.V3_LEDGER_SYMBOL_DENYLISTED = Number(blockedReasonCounts.V3_LEDGER_SYMBOL_DENYLISTED || 0) + 1;
      continue;
    }
    // symmetric quality filter 2 — funding floor (both sides, same threshold).
    // Missing funding passes: absence of data is not a signal defect.
    const rowFunding = Number(row && row.funding_rate);
    if (Number.isFinite(rowFunding) && rowFunding < entryMinFunding) {
      blockedReasonCounts.V3_LEDGER_FUNDING_BELOW_MIN = Number(blockedReasonCounts.V3_LEDGER_FUNDING_BELOW_MIN || 0) + 1;
      continue;
    }
    // risk control 1 — daily drawdown circuit breaker halts every new entry
    if (killSwitchActive) {
      blockedReasonCounts.V3_LEDGER_DAILY_DRAWDOWN_KILL = Number(blockedReasonCounts.V3_LEDGER_DAILY_DRAWDOWN_KILL || 0) + 1;
      continue;
    }
    // risk control 2 — total concurrent-position cap (counts existing + admitted)
    if (index.openBySymbol.size >= maxOpenTotal) {
      blockedReasonCounts.V3_LEDGER_MAX_OPEN_TOTAL = Number(blockedReasonCounts.V3_LEDGER_MAX_OPEN_TOTAL || 0) + 1;
      continue;
    }
    // risk control 3 — per-direction concurrent cap (bounds correlated clusters)
    if (side === "LONG" || side === "SHORT") {
      const sideOpenN = side === "LONG" ? openLongN : openShortN;
      if (sideOpenN >= maxOpenPerSide) {
        blockedReasonCounts.V3_LEDGER_MAX_OPEN_PER_SIDE = Number(blockedReasonCounts.V3_LEDGER_MAX_OPEN_PER_SIDE || 0) + 1;
        continue;
      }
    }
    if (!hasCompleteLearningContext(row)) {
      blockedReasonCounts.V3_LEDGER_LEARNING_CONTEXT_REQUIRED = Number(blockedReasonCounts.V3_LEDGER_LEARNING_CONTEXT_REQUIRED || 0) + 1;
      continue;
    }
    const entry = Object.freeze({
      v3_paper_entry_id: buildEntryId(row),
      created_at: new Date().toISOString(),
      signal_id: signalId,
      symbol,
      exchange: upper(row.exchange),
      tf: trimOrNull(row.tf),
      side: upper(row.side),
      setup_type: upper(row.setup_type),
      structural_regime: upper(row.structural_regime),
      edge_cohort: upper(row.edge_cohort),
      cohort_key: trimOrNull(row.cohort_key),
      profile_id: upper(row.profile_id),
      entry_grade: upper(row.entry_grade),
      market_state: upper(row.market_state),
      htf_bias: upper(row.htf_bias),
      opportunity_score: row.opportunity_score == null ? null : Number(row.opportunity_score),
      confidence: row.confidence == null ? null : Number(row.confidence),
      setup_quality_score: row.setup_quality_score == null ? null : Number(row.setup_quality_score),
      structure_alignment: row.structure_alignment == null ? null : Number(row.structure_alignment),
      htf_alignment_score: row.htf_alignment_score == null ? null : Number(row.htf_alignment_score),
      market_quality_score: row.market_quality_score == null ? null : Number(row.market_quality_score),
      spread_bps: row.spread_bps == null ? null : Number(row.spread_bps),
      funding_rate: row.funding_rate == null ? null : Number(row.funding_rate),
      btc_1h_trend: upper(row.btc_1h_trend),
      mtf_1h_direction: upper(row.mtf_1h_direction),
      feature_lineage_source: upper(row.feature_lineage_source),
      rr: row.rr == null ? null : Number(row.rr),
      signal_price: row.signal_price == null ? null : Number(row.signal_price),
      stop_price: row.stop_price == null ? null : Number(row.stop_price),
      target_price: row.target_price == null ? null : Number(row.target_price),
      equity_curve_state: equityCurve.state,
      equity_curve_window_n: equityCurve.window_n,
      equity_curve_trailing_net_r: equityCurve.trailing_net_r,
      status: "OPEN",
      source: "V3_LOCAL_PAPER_LANE",
    });
    newEntries.push(entry);
    index.seenSignalIds.add(signalId);
    if (positionKey) index.openBySymbol.set(positionKey, entry);
    if (side === "LONG") openLongN += 1;
    else if (side === "SHORT") openShortN += 1;
  }

  const appendedEntryN = ledgerPath ? appendJsonlRows(ledgerPath, newEntries) : 0;

  return Object.freeze({
    ok: true,
    source_queue_n: Array.isArray(queueRows) ? queueRows.length : 0,
    existing_entry_n: existingRows.length,
    appended_entry_n: appendedEntryN,
    max_signal_age_ms: resolveSignalAgeLimitMs((Array.isArray(queueRows) && queueRows[0]) || {}),
    signal_age_policy: resolveConfiguredMaxSignalAgeMs() ? "FIXED_MAX_AGE" : "TF_PLUS_GRACE",
    symbol_cooldown_ms: resolveSymbolCooldownMs((Array.isArray(queueRows) && queueRows[0]) || {}),
    position_lock_scope: "SYMBOL_SIDE",
    blocked_reason_counts: Object.freeze(blockedReasonCounts),
    new_entries: Object.freeze(newEntries.slice(0, 50)),
    open_entries: Object.freeze([...index.openBySymbol.values()].slice(0, 50)),
    open_position_n: index.openBySymbol.size,
    entry_filters: Object.freeze({
      min_funding: entryMinFunding,
      symbol_denylist: Object.freeze([...entrySymbolDenylist]),
    }),
    equity_curve: equityCurve,
    risk_controls: Object.freeze({
      max_open_total: maxOpenTotal,
      max_open_per_side: maxOpenPerSide,
      daily_drawdown_kill_r: dailyKillR,
      kill_switch_active: killSwitchActive,
      today_realized_r: Number(today.net.toFixed(4)),
      today_closed_n: today.n,
      open_long_n: openLongN,
      open_short_n: openShortN,
    }),
  });
}

module.exports = Object.freeze({
  buildV3PaperEntryLedgerReport,
  __test: {
    readJsonlRows,
    writeJsonlRows,
    buildPositionLockKey,
    buildOpenSymbolIndex,
    buildRecordedSignalIdSet,
    buildRecentClosedSymbolIndex,
    compactQueueRows,
    buildEntryId,
    hasCompleteLearningContext,
    parseTimeMs,
    parseTfToMs,
    resolveSignalAgeLimitMs,
    resolveSymbolCooldownMs,
    resolveMaxOpenTotal,
    resolveMaxOpenPerSide,
    resolveDailyDrawdownKillR,
    computeTodayRealizedR,
    resolveEntryMinFunding,
    resolveEntrySymbolDenylist,
    resolveEquityCurveWindowN,
    computeEquityCurveState,
  },
});
