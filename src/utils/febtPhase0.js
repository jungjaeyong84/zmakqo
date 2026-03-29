"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUpper(value, fallback = "UNKNOWN") {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function parseMs(value) {
  const n = toNum(value);
  if (Number.isFinite(n)) return n;
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveFeatures(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function resolveMarket(row) {
  return toUpper((row && (row.symbol_or_pair_id || row.symbol || row.market)) || "", "");
}

function resolveTf(row) {
  return String((row && row.tf) || "").trim();
}

function resolveEvent(row) {
  return toUpper(row && row.event, "");
}

function resolveBarCloseMs(row) {
  return (
    toNum(row && row.signal_bar_close_time_utc_ms) ??
    toNum(row && row.bar_close_time_utc_ms) ??
    toNum(row && row.exec_bar_close_time_utc_ms) ??
    parseMs(row && row.created_at) ??
    parseMs(row && row.updated_at)
  );
}

function normalizeWaitAction(raw, reason = "") {
  const value = toUpper(raw, "UNKNOWN");
  const why = toUpper(reason, "");
  if (value === "WAIT_ONE_BAR" || why === "DROP_WAIT_ONE_BAR_TIMING") return "WAIT_ONE_BAR";
  if (value === "ALLOW") return "ALLOW";
  if (value === "SKIP") return "SKIP";
  if (value === "NO_OP") return "NO_OP";
  return "UNKNOWN";
}

function normalizeWaitTriggerPath(raw) {
  const value = toUpper(raw, "UNKNOWN");
  if (value === "BASE" || value === "PHYSICS_ASSIST" || value === "PHYSICS_HARD") return value;
  return "UNKNOWN";
}

function normalizeEntryExecTiming(raw) {
  const value = toUpper(raw, "UNKNOWN");
  return value || "UNKNOWN";
}

function mean(values = []) {
  const nums = values.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v));
  if (!nums.length) return null;
  return nums.reduce((acc, n) => acc + n, 0) / nums.length;
}

function summarizeBreakdown(rows = [], field, normalizer = (v) => toUpper(v, "UNKNOWN"), limit = 6) {
  const counts = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizer(row && row[field]);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, n]) => ({ value, n }))
    .sort((a, b) => (b.n - a.n) || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function summarizeLatencySeries(values = []) {
  const nums = values.filter((v) => Number.isFinite(Number(v)) && Number(v) >= 0).map((v) => Number(v)).sort((a, b) => a - b);
  if (!nums.length) return { n: 0, avg: null, p50: null, p95: null, max: null };
  const pick = (ratio) => nums[Math.min(nums.length - 1, Math.max(0, Math.ceil(nums.length * ratio) - 1))];
  return {
    n: nums.length,
    avg: nums.reduce((acc, n) => acc + n, 0) / nums.length,
    p50: pick(0.50),
    p95: pick(0.95),
    max: nums[nums.length - 1],
  };
}

function buildSignalKey(row) {
  const signalId = String(row && row.signal_id || "").trim();
  if (signalId) return signalId;
  const market = resolveMarket(row);
  const tf = resolveTf(row);
  const event = resolveEvent(row);
  const barCloseMs = resolveBarCloseMs(row);
  if (!market || !tf || !event || !Number.isFinite(barCloseMs)) return null;
  return `${market}__${tf}__${barCloseMs}__${event}`;
}

function summarizeLegacyWaitBaseline({
  current = {},
  drops = [],
} = {}) {
  const quality = current && current.quality && typeof current.quality === "object" ? current.quality : {};
  const chainRows = Array.isArray(quality.chain_rows) ? quality.chain_rows : [];
  const timingStats = current
    && current.drop_counterfactual
    && current.drop_counterfactual.by_stage
    && current.drop_counterfactual.by_stage.TIMING
      ? current.drop_counterfactual.by_stage.TIMING
      : {};
  const timingDrops = (Array.isArray(drops) ? drops : []).filter((row) => {
    const features = resolveFeatures(row);
    return normalizeWaitAction(features.wait_one_bar_action, row && (row.drop_reason_code || row.reason)) === "WAIT_ONE_BAR";
  });

  const allowChains = chainRows.filter((row) => normalizeWaitAction(row && row.legacy_wait_action) === "ALLOW");
  const skipChains = chainRows.filter((row) => normalizeWaitAction(row && row.legacy_wait_action) === "SKIP");
  const unknownChains = chainRows.filter((row) => normalizeWaitAction(row && row.legacy_wait_action) === "UNKNOWN");
  const observedChains = chainRows.filter((row) => normalizeWaitAction(row && row.legacy_wait_action) !== "UNKNOWN");
  const observedExecTiming = chainRows.filter((row) => normalizeEntryExecTiming(row && row.entry_exec_timing) !== "UNKNOWN");
  const realizedAllow = allowChains.filter((row) => row && row.realized === true && Number.isFinite(toNum(row.realized_ret_net)));

  const immediateExec = allowChains.filter((row) => normalizeEntryExecTiming(row && row.entry_exec_timing) !== "UNKNOWN");
  const immediateWinRate = realizedAllow.length
    ? (realizedAllow.filter((row) => Number(row.realized_ret_net) > 0).length / realizedAllow.length)
    : null;

  return {
    candidate_signals_n: toNum(current && current.signals_n) || 0,
    executed_entry_chains_n: chainRows.length,
    wait_allow_chain_n: allowChains.length,
    wait_skip_chain_n: skipChains.length,
    wait_unknown_chain_n: unknownChains.length,
    legacy_wait_observed_chain_n: observedChains.length,
    legacy_wait_coverage_rate: chainRows.length > 0 ? (observedChains.length / chainRows.length) : null,
    entry_exec_timing_observed_chain_n: observedExecTiming.length,
    immediate_exec_n: immediateExec.length,
    immediate_realized_n: realizedAllow.length,
    immediate_win_rate: immediateWinRate,
    immediate_avg_ret_net: mean(realizedAllow.map((row) => row.realized_ret_net)),
    timing_drop_signal_n: timingDrops.length,
    timing_drop_counterfactual_matured_n: toNum(timingStats.matured_n) || 0,
    timing_drop_tp1_first_rate: toNum(timingStats.tp1_first_rate),
    timing_drop_sl_first_rate: toNum(timingStats.sl_first_rate),
    timing_drop_avg_horizon_ret_net: toNum(timingStats.avg_horizon_ret_net),
    saved_loss_pct: toNum(timingStats.sl_first_rate),
    missed_gain_pct: toNum(timingStats.tp1_first_rate),
    saved_loss_minus_missed_gain: (() => {
      const saved = toNum(timingStats.sl_first_rate);
      const missed = toNum(timingStats.tp1_first_rate);
      if (!Number.isFinite(saved) || !Number.isFinite(missed)) return null;
      return saved - missed;
    })(),
    wait_trigger_path_breakdown: summarizeBreakdown(
      timingDrops.map((row) => ({ path: resolveFeatures(row).wait_one_bar_trigger_path })),
      "path",
      normalizeWaitTriggerPath
    ),
    market_action_breakdown: summarizeBreakdown(
      allowChains.map((row) => ({ action: row.market_state_summary_action })),
      "action",
      (v) => toUpper(v, "UNKNOWN")
    ),
    entry_exec_timing_breakdown: summarizeBreakdown(
      allowChains.map((row) => ({ timing: row.entry_exec_timing })),
      "timing",
      normalizeEntryExecTiming
    ),
  };
}

function summarizeLegacyWaitOverlap({
  current = {},
  drops = [],
} = {}) {
  const quality = current && current.quality && typeof current.quality === "object" ? current.quality : {};
  const chainRows = Array.isArray(quality.chain_rows) ? quality.chain_rows : [];
  const timingDrops = (Array.isArray(drops) ? drops : []).filter((row) => {
    const features = resolveFeatures(row);
    return normalizeWaitAction(features.wait_one_bar_action, row && (row.drop_reason_code || row.reason)) === "WAIT_ONE_BAR";
  });

  const rows = [];
  for (const row of chainRows) {
    rows.push({
      legacy_wait_action: normalizeWaitAction(row && row.legacy_wait_action),
      legacy_wait_trigger_path: normalizeWaitTriggerPath(row && row.legacy_wait_trigger_path),
      market_state_summary_action: toUpper(row && row.market_state_summary_action, "UNKNOWN"),
      market_state_summary_state: toUpper(row && row.market_state_summary_state, "UNKNOWN"),
      entry_exec_timing: normalizeEntryExecTiming(row && row.entry_exec_timing),
      ev_gate_policy_source: toUpper(row && row.ev_gate_policy_source, "UNKNOWN"),
      tier: toUpper(row && row.tier, "UNKNOWN"),
      side: toUpper(row && row.side, "UNKNOWN"),
      executed: true,
      realized_ret_net: toNum(row && row.realized_ret_net),
    });
  }
  for (const row of timingDrops) {
    const f = resolveFeatures(row);
    rows.push({
      legacy_wait_action: "WAIT_ONE_BAR",
      legacy_wait_trigger_path: normalizeWaitTriggerPath(f.wait_one_bar_trigger_path),
      market_state_summary_action: toUpper(f.market_state_summary_action, "UNKNOWN"),
      market_state_summary_state: toUpper(f.market_state_summary_state, "UNKNOWN"),
      entry_exec_timing: "NOT_EXECUTED",
      ev_gate_policy_source: toUpper(f.ev_gate_policy_source, "UNKNOWN"),
      tier: toUpper(row && row.entry_grade || row && row.entry_tier || row && row.entry_signal_type || row && row.event, "UNKNOWN"),
      side: toUpper(row && row.side, "UNKNOWN"),
      executed: false,
      realized_ret_net: null,
    });
  }

  function summarizePairs(field) {
    const counts = new Map();
    for (const row of rows) {
      const key = `${row.legacy_wait_action}__${toUpper(row[field], "UNKNOWN")}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, n]) => {
        const [waitAction, value] = key.split("__");
        return { wait_action: waitAction, value, n };
      })
      .sort((a, b) => (b.n - a.n) || a.wait_action.localeCompare(b.wait_action) || a.value.localeCompare(b.value))
      .slice(0, 16);
  }

  return {
    compared_n: rows.length,
    wait_action_breakdown: summarizeBreakdown(rows, "legacy_wait_action", normalizeWaitAction),
    market_state_action_pairs: summarizePairs("market_state_summary_action"),
    market_state_state_pairs: summarizePairs("market_state_summary_state"),
    entry_exec_timing_pairs: summarizePairs("entry_exec_timing"),
    ev_policy_source_pairs: summarizePairs("ev_gate_policy_source"),
    tier_pairs: summarizePairs("tier"),
    side_pairs: summarizePairs("side"),
  };
}

function buildWebhookSignalKey(row) {
  const signalId = String(row && row.signal_id || "").trim();
  if (signalId) return signalId;
  const market = resolveMarket(row);
  const tf = resolveTf(row);
  const event = resolveEvent(row);
  const barCloseMs = toNum(row && row.bar_close_time_utc_ms);
  if (!market || !tf || !event || !Number.isFinite(barCloseMs)) return null;
  return `${market}__${tf}__${barCloseMs}__${event}`;
}

function buildIntentSignalKey(row) {
  const signalId = String(row && row.signal_id || "").trim();
  if (signalId) return signalId;
  const market = resolveMarket(row);
  const tf = resolveTf(row);
  const event = resolveEvent(row);
  const barCloseMs = toNum(row && row.signal_bar_close_time_utc_ms);
  if (!market || !tf || !event || !Number.isFinite(barCloseMs)) return null;
  return `${market}__${tf}__${barCloseMs}__${event}`;
}

function buildFillSignalKey(row) {
  const signalId = String(row && row.signal_id || "").trim();
  if (signalId) return signalId;
  const market = resolveMarket(row);
  const tf = resolveTf(row);
  const event = toUpper(row && (row.entry_signal_type || row.event), "");
  const barCloseMs = toNum(row && row.signal_bar_close_time_utc_ms);
  if (!market || !tf || !event || !Number.isFinite(barCloseMs)) return null;
  return `${market}__${tf}__${barCloseMs}__${event}`;
}

function summarizeBridgeLatency({
  webhooks = [],
  intents = [],
  fills = [],
  provider = "BINANCEFUT",
  tf = "",
  fromMs = null,
  toMs = null,
} = {}) {
  const providerUpper = toUpper(provider, "BINANCEFUT");
  const tfText = String(tf || "").trim();
  const ingressByRequest = new Map();
  const outcomeByKey = new Map();
  const outcomeCountByKey = new Map();
  const webhookRows = (Array.isArray(webhooks) ? webhooks : []).filter((row) => {
    const ex = toUpper(row && row.exchange, providerUpper);
    const rowTf = resolveTf(row);
    const createdMs = parseMs(row && row.created_at);
    if (providerUpper && ex !== providerUpper && ex !== "UNKNOWN") return false;
    if (tfText && rowTf && rowTf !== tfText) return false;
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) return false;
    if (Number.isFinite(toMs) && Number.isFinite(createdMs) && createdMs >= toMs) return false;
    return true;
  });

  for (const row of webhookRows) {
    const stage = toUpper(row && row.stage, "");
    const requestId = String(row && row.request_id || "").trim();
    if (stage === "INGRESS" && requestId) {
      if (!ingressByRequest.has(requestId)) ingressByRequest.set(requestId, row);
      continue;
    }
    if (stage !== "OUTCOME") continue;
    const key = buildWebhookSignalKey(row);
    if (!key) continue;
    outcomeCountByKey.set(key, (outcomeCountByKey.get(key) || 0) + 1);
    const prev = outcomeByKey.get(key);
    const createdMs = parseMs(row && row.created_at);
    const prevMs = parseMs(prev && prev.created_at);
    if (!prev || (Number.isFinite(createdMs) && (!Number.isFinite(prevMs) || createdMs < prevMs))) {
      outcomeByKey.set(key, row);
    }
  }

  const intentsByKey = new Map();
  let staleCount = 0;
  let rejectCount = 0;
  for (const row of Array.isArray(intents) ? intents : []) {
    const ex = toUpper(row && row.exchange, providerUpper);
    const rowTf = resolveTf(row);
    const createdMs = parseMs(row && row.created_at);
    if (providerUpper && ex !== providerUpper && ex !== "UNKNOWN") continue;
    if (tfText && rowTf && rowTf !== tfText) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(createdMs) && createdMs >= toMs) continue;
    const status = toUpper(row && row.status, "");
    const reason = toUpper(row && (row.status_reason || row.cancel_reason || row.pending_reason), "");
    if (reason.includes("STALE") || reason.includes("EXPIRED")) staleCount += 1;
    if (status.includes("CANCEL") || status.includes("REJECT") || reason.includes("REJECT") || reason.includes("FAILED")) rejectCount += 1;
    const key = buildIntentSignalKey(row);
    if (!key) continue;
    const prev = intentsByKey.get(key);
    const prevMs = parseMs(prev && prev.created_at);
    if (!prev || (Number.isFinite(createdMs) && (!Number.isFinite(prevMs) || createdMs < prevMs))) {
      intentsByKey.set(key, row);
    }
  }

  const fillsByIntent = new Map();
  const fillsBySignalKey = new Map();
  for (const row of Array.isArray(fills) ? fills : []) {
    const ex = toUpper(row && row.exchange, providerUpper);
    const rowTf = resolveTf(row);
    const createdMs = parseMs(row && row.created_at);
    if (providerUpper && ex !== providerUpper && ex !== "UNKNOWN") continue;
    if (tfText && rowTf && rowTf !== tfText) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(createdMs) && createdMs < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(createdMs) && createdMs >= toMs) continue;
    const intentId = String(row && row.intent_id || "").trim();
    if (intentId && !fillsByIntent.has(intentId)) fillsByIntent.set(intentId, row);
    const key = buildFillSignalKey(row);
    if (key && !fillsBySignalKey.has(key)) fillsBySignalKey.set(key, row);
  }

  const proxyAlertToWebhook = [];
  const webhookToIntent = [];
  const intentToFill = [];
  const webhookToFill = [];
  let matchedOutcomeN = 0;
  let matchedIntentN = 0;
  let matchedFillN = 0;

  for (const [key, outcome] of outcomeByKey.entries()) {
    matchedOutcomeN += 1;
    const requestId = String(outcome && outcome.request_id || "").trim();
    const ingress = requestId ? ingressByRequest.get(requestId) : null;
    const outcomeMs = parseMs(outcome && outcome.created_at);
    const ingressMs = parseMs(ingress && ingress.created_at);
    const barCloseMs = toNum(outcome && outcome.bar_close_time_utc_ms);
    if (Number.isFinite(ingressMs) && Number.isFinite(barCloseMs) && ingressMs >= barCloseMs) {
      proxyAlertToWebhook.push(ingressMs - barCloseMs);
    }
    const intent = intentsByKey.get(key);
    if (!intent) continue;
    matchedIntentN += 1;
    const intentMs = parseMs(intent && intent.created_at);
    const baseWebhookMs = Number.isFinite(outcomeMs) ? outcomeMs : ingressMs;
    if (Number.isFinite(intentMs) && Number.isFinite(baseWebhookMs) && intentMs >= baseWebhookMs) {
      webhookToIntent.push(intentMs - baseWebhookMs);
    }
    const intentId = String(intent && intent.intent_id || "").trim();
    const fill = (intentId && fillsByIntent.get(intentId)) || fillsBySignalKey.get(key);
    if (!fill) continue;
    matchedFillN += 1;
    const fillMs = parseMs(fill && fill.created_at);
    if (Number.isFinite(fillMs) && Number.isFinite(intentMs) && fillMs >= intentMs) {
      intentToFill.push(fillMs - intentMs);
    }
    if (Number.isFinite(fillMs) && Number.isFinite(baseWebhookMs) && fillMs >= baseWebhookMs) {
      webhookToFill.push(fillMs - baseWebhookMs);
    }
  }

  const duplicateCount = Array.from(outcomeCountByKey.values()).filter((n) => Number(n) > 1).length;

  return {
    outcome_n: matchedOutcomeN,
    matched_intent_n: matchedIntentN,
    matched_fill_n: matchedFillN,
    duplicate_count: duplicateCount,
    stale_count: staleCount,
    reject_count: rejectCount,
    bar_close_to_webhook_ms_proxy: summarizeLatencySeries(proxyAlertToWebhook),
    webhook_to_intent_ms: summarizeLatencySeries(webhookToIntent),
    intent_to_fill_ms: summarizeLatencySeries(intentToFill),
    webhook_to_fill_ms: summarizeLatencySeries(webhookToFill),
  };
}

module.exports = {
  summarizeLegacyWaitBaseline,
  summarizeLegacyWaitOverlap,
  summarizeBridgeLatency,
  __test: {
    normalizeWaitAction,
    normalizeWaitTriggerPath,
    normalizeEntryExecTiming,
    summarizeLatencySeries,
    buildSignalKey,
    buildWebhookSignalKey,
    buildIntentSignalKey,
    buildFillSignalKey,
  },
};
