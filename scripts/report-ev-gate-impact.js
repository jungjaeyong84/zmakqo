#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const { getFirestore } = require('../src/storage/firestore');
const { nowKstMeta, OPS_DAILY_DIR, writeJson, writeText, copyLatest } = require('./lib/automation-utils');
const { toKstString, KST_OFFSET_MS } = require('../src/utils/timeKst');
const { describeEntryEventForUser } = require('../src/utils/liveEntryTaxonomy');
const { addDisplayFieldsDeep } = require('../src/utils/jsonDisplayFields');

function todayKstKey() {
  const now = new Date(Date.now() + KST_OFFSET_MS);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function kstDayRange(dateStr) {
  const [y, m, d] = String(dateStr || todayKstKey()).split('-').map(Number);
  const startKstUtc = Date.UTC(y, m - 1, d, 0, 0, 0);
  const startUtcMs = startKstUtc - KST_OFFSET_MS;
  const endUtcMs = startUtcMs + (24 * 60 * 60 * 1000) - 1;
  return { startUtcMs, endUtcMs };
}

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const out = {
    rolling24h: false,
    dateArg: null,
  };
  for (const arg of args) {
    if (arg === '--rolling-24h') {
      out.rolling24h = true;
      continue;
    }
    if (!out.dateArg && /^\d{4}-\d{2}-\d{2}$/.test(String(arg || ''))) {
      out.dateArg = String(arg);
    }
  }
  return out;
}

function tierFromEvent(event) {
  const ev = String(event || '').toUpperCase();
  if (ev.startsWith('CORE_')) return 'CORE';
  if (ev.startsWith('PRE_REAL_') || ev === 'PRL' || ev.startsWith('PRL_')) return 'PRE_REAL';
  if (ev.startsWith('REAL_')) return 'REAL';
  return null;
}

function eventDisplay(event, side) {
  return describeEntryEventForUser(event, side);
}

function isScopedEntrySignal(row) {
  if (!row || typeof row !== 'object') return false;
  const intent = String(row.event_intent || row.intent || '').toUpperCase();
  const tier = tierFromEvent(row.event);
  if (!tier) return false;
  if (!intent) return true;
  return intent === 'ENTRY';
}

function resolveEvGateFeatures(row) {
  const featuresJson = row && row.features_json && typeof row.features_json === 'object' ? row.features_json : null;
  const features = row && row.features && typeof row.features === 'object' ? row.features : null;
  return featuresJson || features || {};
}

function resolveObservationMs(row) {
  const values = [
    row && row.bar_close_time_utc_ms,
    row && row.signal_bar_close_time_utc_ms,
    row && row.exec_bar_close_time_utc_ms,
  ];
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasEvGateObservation(row) {
  const reason = String(row && (row.drop_reason_code || row.reason) || '').toUpperCase();
  if (reason === 'DROP_EV_GATE_TP1_PROB' || reason === 'DROP_EV_GATE_BARS_MISSING') return true;
  const features = resolveEvGateFeatures(row);
  return features.ev_gate_enabled === true
    || features.ev_gate_tp1_reach_prob !== undefined
    || features.ev_gate_tp1_reach_prob_lower_bound !== undefined
    || features.ev_gate_exit_value_prob !== undefined
    || features.ev_gate_exit_value_prob_lower_bound !== undefined
    || features.ev_gate_policy_basis !== undefined
    || features.ev_gate_action !== undefined
    || features.ev_gate_skipped === true;
}

function isEvGateSkipped(row) {
  const features = resolveEvGateFeatures(row);
  return features.ev_gate_enabled === true && features.ev_gate_skipped === true;
}

function evGateEntryKey(row) {
  const features = resolveEvGateFeatures(row);
  const signalId = String(row && (row.signal_id || features.signal_id) || '').trim();
  if (signalId) return signalId;
  const exchange = String(row && row.exchange || '').toUpperCase();
  const symbol = String(row && (row.symbol_or_pair_id || row.symbol) || '').toUpperCase();
  const tf = String(row && row.tf || '').trim();
  const event = String(row && row.event || '').toUpperCase();
  const side = String(row && row.side || '').toUpperCase();
  const barMs = resolveObservationMs(row);
  return `${exchange}__${symbol}__${tf}__${event}__${side}__${Number.isFinite(barMs) ? barMs : 'NA'}`;
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || 'UNKNOWN';
    map.set(key, (map.get(key) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function summarizeNumbers(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);
  if (!nums.length) return { n: 0, avg: null, min: null, max: null };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    n: nums.length,
    avg: sum / nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}

function pctString(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'N/A';
  return `${(n * 100).toFixed(2)}%`;
}

function numString(raw, digits = 4) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'N/A';
  return n.toFixed(digits);
}

function uniqueEntryCount(rows = [], filterFn = null) {
  const keys = new Set();
  for (const row of rows) {
    if (filterFn && !filterFn(row)) continue;
    keys.add(evGateEntryKey(row));
  }
  return keys.size;
}

function buildEvGateBreakdowns(rows = []) {
  const scoped = Array.isArray(rows) ? rows : [];
  return {
    by_observation_source: countBy(scoped, (x) => String(x.observation_source || 'UNKNOWN').toUpperCase()),
    by_event: countBy(scoped, (x) => eventDisplay(x.event, x.side)),
    by_dir: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_dir) || x.side || 'UNKNOWN').toUpperCase()),
    by_policy_basis: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_policy_basis) || 'UNKNOWN').toUpperCase()),
    by_plan_source: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_plan_source) || 'UNKNOWN').toUpperCase()),
    by_exit_profile: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_exit_profile) || 'UNKNOWN').toUpperCase()),
    by_policy_version: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_policy_version) || 'UNKNOWN').toUpperCase()),
    by_policy_source: countBy(scoped, (x) => String((x.features_json && x.features_json.ev_gate_policy_source) || 'UNKNOWN').toUpperCase()),
    by_market_state: countBy(scoped, (x) => String((x.features_json && (x.features_json.market_state_summary_state || x.features_json.sp_state)) || 'UNKNOWN').toUpperCase()),
    by_market_action: countBy(scoped, (x) => String((x.features_json && (x.features_json.market_state_summary_action || x.features_json.market_physics_action)) || 'UNKNOWN').toUpperCase()),
    by_execution_mode: countBy(scoped, (x) => String(x.execution_mode || 'UNKNOWN').toUpperCase()),
  };
}

function buildRecentEvGateExamples(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => Number(resolveObservationMs(b) || 0) - Number(resolveObservationMs(a) || 0))
    .slice(0, 10)
    .map((x) => ({
      kst: toKstString(Number(resolveObservationMs(x) || 0), { fallbackToString: true }),
      observation_source: x.observation_source || null,
      symbol: x.symbol_or_pair_id || null,
      event: x.event || null,
      side: x.side || null,
      policy_basis: x.features_json && x.features_json.ev_gate_policy_basis,
      tp1_reach_prob: x.features_json && x.features_json.ev_gate_tp1_reach_prob,
      tp1_reach_prob_lower_bound: x.features_json && x.features_json.ev_gate_tp1_reach_prob_lower_bound,
      exit_value_prob: x.features_json && x.features_json.ev_gate_exit_value_prob,
      exit_value_prob_lower_bound: x.features_json && x.features_json.ev_gate_exit_value_prob_lower_bound,
      atr_pct: x.features_json && x.features_json.ev_gate_atr_pct,
      plan_source: x.features_json && x.features_json.ev_gate_plan_source,
      exit_profile: x.features_json && x.features_json.ev_gate_exit_profile,
      policy_version: x.features_json && x.features_json.ev_gate_policy_version,
      policy_source: x.features_json && x.features_json.ev_gate_policy_source,
      market_state: x.features_json && (x.features_json.market_state_summary_state || x.features_json.sp_state),
      market_action: x.features_json && (x.features_json.market_state_summary_action || x.features_json.market_physics_action),
      execution_mode: x.execution_mode || null,
    }));
}

async function fetchRange(col, startMs, endMs) {
  const db = getFirestore();
  const timeField = col === 'order_intents_paper'
    ? 'signal_bar_close_time_utc_ms'
    : ((col === 'fills_paper' || col === 'trades_paper')
      ? 'exec_bar_close_time_utc_ms'
      : 'bar_close_time_utc_ms');
  const snap = await db.collection(col)
    .where(timeField, '>=', startMs)
    .where(timeField, '<=', endMs)
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function withObservationSource(rows = [], source) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    ...row,
    observation_source: source,
  }));
}

function buildObservationSourceSummary(observed = {}) {
  return {
    signals: uniqueEntryCount(observed.signals || []),
    intents: uniqueEntryCount(observed.intents || []),
    drops: uniqueEntryCount(observed.drops || []),
    fills: uniqueEntryCount(observed.fills || []),
    trades: uniqueEntryCount(observed.trades || []),
  };
}

async function main() {
  const cli = parseArgs(process.argv);
  const dateArg = cli.dateArg || todayKstKey();
  const exchange = String(process.env.EV_GATE_REPORT_EXCHANGE || 'BINANCEFUT').toUpperCase();
  const tf = String(process.env.EV_GATE_REPORT_TF || '15m');
  const { dateKey, hhmm, kst } = nowKstMeta();
  const nowMs = Date.now();
  const { startUtcMs, endUtcMs } = cli.rolling24h
    ? { startUtcMs: nowMs - (24 * 60 * 60 * 1000), endUtcMs: nowMs }
    : kstDayRange(dateArg);
  const windowLabel = cli.rolling24h ? 'rolling_24h' : dateArg;

  const [signalsAll, dropsAll, intentsAll, fillsAll, tradesAll] = await Promise.all([
    fetchRange('signals', startUtcMs, endUtcMs),
    fetchRange('signals_dropped', startUtcMs, endUtcMs),
    fetchRange('order_intents_paper', startUtcMs, endUtcMs),
    fetchRange('fills_paper', startUtcMs, endUtcMs),
    fetchRange('trades_paper', startUtcMs, endUtcMs),
  ]);

  const signals = signalsAll.filter((x) => String(x.exchange || '').toUpperCase() === exchange && String(x.tf || '') === tf);
  const drops = dropsAll.filter((x) => String(x.exchange || '').toUpperCase() === exchange && String(x.tf || '') === tf);
  const intents = intentsAll.filter((x) => String(x.exchange || '').toUpperCase() === exchange && String(x.tf || '') === tf);
  const fills = fillsAll.filter((x) => String(x.exchange || '').toUpperCase() === exchange && String(x.tf || '') === tf);
  const trades = tradesAll.filter((x) => String(x.exchange || '').toUpperCase() === exchange && String(x.tf || '') === tf);
  const scopedSignals = signals.filter(isScopedEntrySignal);
  const observedSignals = scopedSignals.filter(hasEvGateObservation);
  const observedIntents = intents.filter((row) => isScopedEntrySignal(row) && hasEvGateObservation(row));
  const observedDrops = drops.filter((row) => isScopedEntrySignal(row) && hasEvGateObservation(row));
  const observedFills = fills.filter((row) => isScopedEntrySignal(row) && hasEvGateObservation(row));
  const observedTrades = trades.filter((row) => isScopedEntrySignal(row) && hasEvGateObservation(row));
  const observationSourceSummary = buildObservationSourceSummary({
    signals: observedSignals,
    intents: observedIntents,
    drops: observedDrops,
    fills: observedFills,
    trades: observedTrades,
  });
  const observedRows = [
    ...withObservationSource(observedSignals, 'SIGNAL'),
    ...withObservationSource(observedIntents, 'INTENT'),
    ...withObservationSource(observedDrops, 'DROP'),
    ...withObservationSource(observedFills, 'FILL'),
    ...withObservationSource(observedTrades, 'TRADE'),
  ];
  const evaluatedRows = observedRows.filter((row) => !isEvGateSkipped(row));
  const skippedRows = observedRows.filter(isEvGateSkipped);
  const evProbDrops = drops.filter((x) => String(x.drop_reason_code || x.reason || '').toUpperCase() === 'DROP_EV_GATE_TP1_PROB');
  const evBarsMissingDrops = drops.filter((x) => String(x.drop_reason_code || x.reason || '').toUpperCase() === 'DROP_EV_GATE_BARS_MISSING');
  const evTotalDrops = [...evProbDrops, ...evBarsMissingDrops];
  const evDrops = evProbDrops;

  const marketBase = new Map();
  for (const row of scopedSignals) {
    const symbol = String(row.symbol_or_pair_id || row.symbol || 'UNKNOWN');
    if (!marketBase.has(symbol)) marketBase.set(symbol, { symbol, scoped_entry_signals: 0, ev_drops: 0, events: new Map() });
    const m = marketBase.get(symbol);
    m.scoped_entry_signals += 1;
    const ev = String(row.event || 'UNKNOWN');
    m.events.set(ev, (m.events.get(ev) || 0) + 1);
  }
  for (const row of evDrops) {
    const symbol = String(row.symbol_or_pair_id || row.symbol || 'UNKNOWN');
    if (!marketBase.has(symbol)) marketBase.set(symbol, { symbol, scoped_entry_signals: 0, ev_drops: 0, events: new Map() });
    marketBase.get(symbol).ev_drops += 1;
  }
  const byMarket = Array.from(marketBase.values())
    .map((m) => ({
      symbol: m.symbol,
      scoped_entry_signals: m.scoped_entry_signals,
      ev_drops: m.ev_drops,
      ev_drop_rate: m.scoped_entry_signals > 0 ? (m.ev_drops / m.scoped_entry_signals) : null,
      top_events: Array.from(m.events.entries())
        .reduce((acc, [event, count]) => {
          const key = eventDisplay(event, event);
          acc.set(key, (acc.get(key) || 0) + Number(count || 0));
          return acc;
        }, new Map())
        .entries(),
    }))
    .map((m) => ({
      ...m,
      top_events: Array.from(m.top_events)
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .slice(0, 3)
        .map(([event, count]) => `${event}:${count}`),
    }))
    .filter((m) => m.scoped_entry_signals > 0 || m.ev_drops > 0)
    .sort((a,b) => b.ev_drops - a.ev_drops || b.scoped_entry_signals - a.scoped_entry_signals || a.symbol.localeCompare(b.symbol));

  const probStats = summarizeNumbers(evDrops.map((x) => x.features_json && x.features_json.ev_gate_tp1_reach_prob));
  const lowerBoundStats = summarizeNumbers(evDrops.map((x) => x.features_json && x.features_json.ev_gate_tp1_reach_prob_lower_bound));
  const exitProbStats = summarizeNumbers(evDrops.map((x) => x.features_json && x.features_json.ev_gate_exit_value_prob));
  const exitLowerBoundStats = summarizeNumbers(evDrops.map((x) => x.features_json && x.features_json.ev_gate_exit_value_prob_lower_bound));
  const atrStats = summarizeNumbers(evDrops.map((x) => x.features_json && x.features_json.ev_gate_atr_pct));

  const breakdowns = buildEvGateBreakdowns(evTotalDrops);
  const recentExamples = buildRecentEvGateExamples(evDrops);
  const fillBreakdowns = buildEvGateBreakdowns(withObservationSource(observedFills, 'FILL'));
  const tradeBreakdowns = buildEvGateBreakdowns(withObservationSource(observedTrades, 'TRADE'));
  const recentFillExamples = buildRecentEvGateExamples(withObservationSource(observedFills, 'FILL'));
  const recentTradeExamples = buildRecentEvGateExamples(withObservationSource(observedTrades, 'TRADE'));
  const byEvent = breakdowns.by_event;

  const payload = {
    ok: true,
    generated_at_kst: kst,
    exchange,
    tf,
    window: {
      mode: cli.rolling24h ? 'rolling_24h' : 'kst_day',
      date_kst: cli.rolling24h ? null : dateArg,
      start_utc_ms: startUtcMs,
      end_utc_ms: endUtcMs,
      start_kst: toKstString(startUtcMs),
      end_kst: toKstString(endUtcMs),
    },
    summary: {
      scoped_entry_signals: scopedSignals.length,
      ev_gate_observed_entries: uniqueEntryCount(observedRows),
      ev_gate_evaluated_entries: uniqueEntryCount(evaluatedRows),
      ev_gate_skipped_entries: uniqueEntryCount(skippedRows),
      ev_gate_signal_observations: observationSourceSummary.signals,
      ev_gate_intent_observations: observationSourceSummary.intents,
      ev_gate_drop_observations: observationSourceSummary.drops,
      ev_gate_fill_observations: observationSourceSummary.fills,
      ev_gate_trade_observations: observationSourceSummary.trades,
      all_drops: drops.length,
      ev_gate_drops_total: evTotalDrops.length,
      ev_gate_prob_drops: evProbDrops.length,
      ev_gate_bars_missing_drops: evBarsMissingDrops.length,
      ev_drop_share_of_all_drops: drops.length > 0 ? (evTotalDrops.length / drops.length) : null,
      ev_drop_rate_of_evaluated_entries: uniqueEntryCount(evaluatedRows) > 0 ? (evTotalDrops.length / uniqueEntryCount(evaluatedRows)) : null,
      ev_drop_rate_of_scoped_entries: scopedSignals.length > 0 ? (evTotalDrops.length / scopedSignals.length) : null,
    },
    stats: {
      exit_value_prob: exitProbStats,
      exit_value_prob_lower_bound: exitLowerBoundStats,
      tp1_reach_prob: probStats,
      tp1_reach_prob_lower_bound: lowerBoundStats,
      atr_pct: atrStats,
    },
    breakdowns: {
      ...breakdowns,
      by_market: byMarket,
      fills: fillBreakdowns,
      trades: tradeBreakdowns,
    },
    recent_examples: recentExamples,
    recent_fill_examples: recentFillExamples,
    recent_trade_examples: recentTradeExamples,
  };

  const baseName = cli.rolling24h
    ? `${dateKey}_${hhmm}_ev_gate_impact_report_24h`
    : `${dateKey}_${hhmm}_ev_gate_impact_report`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${baseName}.md`);
  const latestJson = path.join(
    OPS_DAILY_DIR,
    cli.rolling24h ? 'ev_gate_impact_report_24h_latest.json' : 'ev_gate_impact_report_latest.json'
  );
  const latestMd = path.join(
    OPS_DAILY_DIR,
    cli.rolling24h ? 'ev_gate_impact_report_24h_latest.md' : 'ev_gate_impact_report_latest.md'
  );

  const lines = [];
  lines.push('# EV Gate 영향 리포트');
  lines.push('');
  lines.push(`- 생성 시각: ${kst}`);
  lines.push(`- 범위: ${windowLabel} / ${exchange} / ${tf}`);
  lines.push('');
  lines.push('## 요약');
  lines.push(`- scoped entry signals: ${payload.summary.scoped_entry_signals}`);
  lines.push(`- ev gate observed entries: ${payload.summary.ev_gate_observed_entries}`);
  lines.push(`- ev gate evaluated entries: ${payload.summary.ev_gate_evaluated_entries}`);
  lines.push(`- ev gate skipped entries: ${payload.summary.ev_gate_skipped_entries}`);
  lines.push(`- source observations: signal ${payload.summary.ev_gate_signal_observations}, intent ${payload.summary.ev_gate_intent_observations}, drop ${payload.summary.ev_gate_drop_observations}, fill ${payload.summary.ev_gate_fill_observations}, trade ${payload.summary.ev_gate_trade_observations}`);
  lines.push(`- all drops: ${payload.summary.all_drops}`);
  lines.push(`- ev gate total drops: ${payload.summary.ev_gate_drops_total}`);
  lines.push(`- ev gate compatibility-code drops: ${payload.summary.ev_gate_prob_drops}`);
  lines.push(`- ev gate bars-missing drops: ${payload.summary.ev_gate_bars_missing_drops}`);
  lines.push(`- ev drop share of all drops: ${pctString(payload.summary.ev_drop_share_of_all_drops)}`);
  lines.push(`- ev drop rate of evaluated entries: ${pctString(payload.summary.ev_drop_rate_of_evaluated_entries)}`);
  lines.push(`- ev drop rate of scoped entries: ${pctString(payload.summary.ev_drop_rate_of_scoped_entries)}`);
  lines.push('');
  lines.push('## 수치');
  lines.push(`- exit_value_prob avg/min/max: ${numString(exitProbStats.avg)} / ${numString(exitProbStats.min)} / ${numString(exitProbStats.max)}`);
  lines.push(`- exit_value_lb avg/min/max: ${numString(exitLowerBoundStats.avg)} / ${numString(exitLowerBoundStats.min)} / ${numString(exitLowerBoundStats.max)}`);
  lines.push(`- tp1_prob avg/min/max: ${numString(probStats.avg)} / ${numString(probStats.min)} / ${numString(probStats.max)}`);
  lines.push(`- tp1_prob_lb avg/min/max: ${numString(lowerBoundStats.avg)} / ${numString(lowerBoundStats.min)} / ${numString(lowerBoundStats.max)}`);
  lines.push(`- atr_pct avg/min/max: ${numString(atrStats.avg)} / ${numString(atrStats.min)} / ${numString(atrStats.max)}`);
  lines.push('');
  lines.push('## 마켓별');
  if (!byMarket.length) {
    lines.push('- 해당 범위에서 EV gate 영향 없음');
  } else {
    for (const row of byMarket.slice(0, 20)) {
      lines.push(`- ${row.symbol}: ev_drops ${row.ev_drops}, scoped_entries ${row.scoped_entry_signals}, drop_rate ${pctString(row.ev_drop_rate)}, events ${row.top_events.join(', ') || '-'}`);
    }
  }
  lines.push('');
  lines.push('## 이벤트별');
  if (!byEvent.length) {
    lines.push('- 없음');
  } else {
    for (const row of byEvent.slice(0, 20)) lines.push(`- ${row.key}: ${row.count}`);
  }
  lines.push('');
  lines.push('## 정책/시장상태');
  if (!breakdowns.by_policy_source.length && !breakdowns.by_market_action.length) {
    lines.push('- 없음');
  } else {
    if (breakdowns.by_policy_basis.length) lines.push(`- policy basis: ${breakdowns.by_policy_basis.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (breakdowns.by_policy_version.length) lines.push(`- policy version: ${breakdowns.by_policy_version.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (breakdowns.by_policy_source.length) lines.push(`- policy source: ${breakdowns.by_policy_source.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (breakdowns.by_market_state.length) lines.push(`- market state: ${breakdowns.by_market_state.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (breakdowns.by_market_action.length) lines.push(`- market action: ${breakdowns.by_market_action.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## Fill/Trade 관측');
  if (!payload.summary.ev_gate_fill_observations && !payload.summary.ev_gate_trade_observations) {
    lines.push('- 해당 범위에서 fill/trade EV 관측 없음');
  } else {
    if (fillBreakdowns.by_policy_source.length) lines.push(`- fills policy source: ${fillBreakdowns.by_policy_source.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (fillBreakdowns.by_market_action.length) lines.push(`- fills market action: ${fillBreakdowns.by_market_action.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (tradeBreakdowns.by_policy_source.length) lines.push(`- trades policy source: ${tradeBreakdowns.by_policy_source.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
    if (tradeBreakdowns.by_market_action.length) lines.push(`- trades market action: ${tradeBreakdowns.by_market_action.slice(0, 5).map((row) => `${row.key}:${row.count}`).join(', ')}`);
  }
  lines.push('');
  lines.push('## 최근 사례');
  if (!recentExamples.length) {
    lines.push('- 없음');
  } else {
    for (const row of recentExamples) {
      lines.push(`- ${row.kst} | ${row.symbol} ${eventDisplay(row.event, row.side)} | exit_prob ${numString(row.exit_value_prob)} | exit_lb ${numString(row.exit_value_prob_lower_bound)} | tp1_prob ${numString(row.tp1_reach_prob)} | tp1_lb ${numString(row.tp1_reach_prob_lower_bound)} | atr_pct ${numString(row.atr_pct)} | ${row.policy_basis || 'N/A'} | ${row.plan_source}/${row.exit_profile} | ${row.policy_version || 'N/A'}/${row.policy_source || 'N/A'} | ${row.market_state || 'N/A'}/${row.market_action || 'N/A'}`);
    }
  }
  lines.push('');
  lines.push('## 최근 Fill/Trade 사례');
  if (!recentFillExamples.length && !recentTradeExamples.length) {
    lines.push('- 없음');
  } else {
    for (const row of recentFillExamples.slice(0, 5)) {
      lines.push(`- [FILL] ${row.kst} | ${row.symbol} ${eventDisplay(row.event, row.side)} | ${row.policy_version || 'N/A'}/${row.policy_source || 'N/A'} | ${row.market_state || 'N/A'}/${row.market_action || 'N/A'}`);
    }
    for (const row of recentTradeExamples.slice(0, 5)) {
      lines.push(`- [TRADE] ${row.kst} | ${row.symbol} ${eventDisplay(row.event, row.side)} | ${row.policy_version || 'N/A'}/${row.policy_source || 'N/A'} | ${row.market_state || 'N/A'}/${row.market_action || 'N/A'}`);
    }
  }

  writeJson(jsonPath, addDisplayFieldsDeep(payload));
  writeText(mdPath, `${lines.join('\n')}\n`);
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  console.log(JSON.stringify({ ok: true, jsonPath, mdPath, summary: payload.summary }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      hasEvGateObservation,
      isEvGateSkipped,
      uniqueEntryCount,
      evGateEntryKey,
      resolveObservationMs,
      buildEvGateBreakdowns,
      buildRecentEvGateExamples,
      buildObservationSourceSummary,
    },
  };
}
