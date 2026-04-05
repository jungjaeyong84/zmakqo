const { buildTradesFromFillsWithFunding } = require("./tradesFromFills");
const { buildFilterFeatureSignature } = require("../utils/filterFeatureBuckets");
const { resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");
const {
  computeMfeMae,
  loadBarsForChainRows,
  normalizeBarsByMarket,
} = require("../utils/barPathMetrics");

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUpper(v) {
  return String(v || "").trim().toUpperCase();
}

function normalizeExchange(v) {
  const ex = toUpper(v);
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function normalizeMarket(row) {
  return String(
    (row && (row.symbol_or_pair_id || row.symbol || row.market)) || ""
  ).trim().toUpperCase();
}

function normalizeTf(row) {
  return String((row && row.tf) || "").trim();
}

function normalizeTier(eventRaw) {
  return resolveEntryTimingTier(eventRaw);
}

function isEntryTierEvent(eventRaw) {
  return normalizeTier(eventRaw) !== null;
}

function normalizeSide(v) {
  const side = toUpper(v);
  if (side === "BUY" || side === "LONG") return "LONG";
  if (side === "SELL" || side === "SHORT") return "SHORT";
  return null;
}

function resolveBarMs(row) {
  return (
    toNum(row && row.signal_bar_close_time_utc_ms) ??
    toNum(row && row.bar_close_time_utc_ms) ??
    toNum(row && row.exec_bar_close_time_utc_ms)
  );
}

function makeSignalKey(row) {
  const market = normalizeMarket(row);
  const tf = normalizeTf(row);
  const event = toUpper(row && row.event);
  const barMs = resolveBarMs(row);
  if (!market || !tf || !event || !Number.isFinite(barMs)) return null;
  return `${market}__${tf}__${barMs}__${event}`;
}

function resolveExecMs(row) {
  return (
    toNum(row && row.exec_bar_close_time_utc_ms) ??
    toNum(row && row.signal_bar_close_time_utc_ms) ??
    toNum(row && row.bar_close_time_utc_ms)
  );
}

function resolveEntryEventId(row) {
  const direct = String(
    (row && (row.entry_event_id || row.entryEventId)) || ""
  ).trim();
  if (direct) return direct;
  const market = normalizeMarket(row);
  const tf = normalizeTf(row);
  const ev = toUpper(
    row && (row.entry_signal_type || row.entrySignalType || row.event)
  );
  const barMs = resolveBarMs(row);
  const ex = normalizeExchange(row && row.exchange);
  if (!market || !tf || !ev || !Number.isFinite(barMs)) return null;
  return ["ENTRY", ex || "UNKNOWN", market, tf, barMs, ev].join("__");
}

function classifyExitEvent(eventRaw) {
  const ev = toUpper(eventRaw);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) return "TP0";
  if (ev.startsWith("EXIT_TP_P1")) return "TP1";
  if (ev.startsWith("EXIT_TIME_STOP")) return "TIME_STOP";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev.startsWith("EXIT_BE")) return "BE";
  if (ev.startsWith("EXIT_")) return "EXIT_OTHER";
  return null;
}

function emptyTierStats() {
  return {
    signals_n: 0,
    executed_n: 0,
    execution_rate: null,
    exits_seen_n: 0,
    tp1_hit_n: 0,
    tp1_hit_rate: null,
    sl_before_tp1_n: 0,
    sl_before_tp1_rate: null,
    trail_after_tp1_n: 0,
    trail_capture_rate: null,
    realized_chains_n: 0,
    win_n: 0,
    win_rate: null,
    avg_ret_net: null,
    avg_pnl_quote: null,
    entropy_sum: 0,
    entropy_n: 0,
    coherence_sum: 0,
    coherence_n: 0,
    transition_risk_sum: 0,
    transition_risk_n: 0,
    field_alignment_sum: 0,
    field_alignment_n: 0,
    domain_wall_density_sum: 0,
    domain_wall_density_n: 0,
    susceptibility_sum: 0,
    susceptibility_n: 0,
    free_energy_sum: 0,
    free_energy_n: 0,
    febt_payload_missing_n: 0,
    febt_calc_ok_n: 0,
    febt_phase_known_n: 0,
    febt_prepare_n: 0,
    febt_armed_n: 0,
    febt_fire_n: 0,
    febt_late_n: 0,
    febt_void_n: 0,
    febt_unknown_n: 0,
    febt_disagreement_n: 0,
    febt_fallback_legacy_n: 0,
    febt_lock_score_sum: 0,
    febt_lock_score_n: 0,
    febt_delay_cost_sum: 0,
    febt_delay_cost_n: 0,
    febt_late_risk_sum: 0,
    febt_late_risk_n: 0,
    febt_failure_risk_sum: 0,
    febt_failure_risk_n: 0,
    febt_edge_sum: 0,
    febt_edge_n: 0,
  };
}

function finalizeTierStats(stats) {
  const out = { ...stats };
  out.execution_rate = out.signals_n > 0 ? (out.executed_n / out.signals_n) : null;
  out.tp1_hit_rate = out.executed_n > 0 ? (out.tp1_hit_n / out.executed_n) : null;
  out.sl_before_tp1_rate = out.executed_n > 0 ? (out.sl_before_tp1_n / out.executed_n) : null;
  out.trail_capture_rate = out.tp1_hit_n > 0 ? (out.trail_after_tp1_n / out.tp1_hit_n) : null;
  out.win_rate = out.realized_chains_n > 0 ? (out.win_n / out.realized_chains_n) : null;
  out.avg_ret_net = out.realized_chains_n > 0 ? (out.avg_ret_net / out.realized_chains_n) : null;
  out.avg_pnl_quote = out.realized_chains_n > 0 ? (out.avg_pnl_quote / out.realized_chains_n) : null;
  out.avg_entropy_score = out.entropy_n > 0 ? (out.entropy_sum / out.entropy_n) : null;
  out.avg_coherence_score = out.coherence_n > 0 ? (out.coherence_sum / out.coherence_n) : null;
  out.avg_transition_risk = out.transition_risk_n > 0 ? (out.transition_risk_sum / out.transition_risk_n) : null;
  out.avg_field_alignment = out.field_alignment_n > 0 ? (out.field_alignment_sum / out.field_alignment_n) : null;
  out.avg_domain_wall_density = out.domain_wall_density_n > 0 ? (out.domain_wall_density_sum / out.domain_wall_density_n) : null;
  out.avg_susceptibility = out.susceptibility_n > 0 ? (out.susceptibility_sum / out.susceptibility_n) : null;
  out.avg_free_energy = out.free_energy_n > 0 ? (out.free_energy_sum / out.free_energy_n) : null;
  out.febt_calc_ok_rate = out.executed_n > 0 ? (out.febt_calc_ok_n / out.executed_n) : null;
  out.febt_phase_known_rate = out.executed_n > 0 ? (out.febt_phase_known_n / out.executed_n) : null;
  out.febt_payload_missing_rate = out.executed_n > 0 ? (out.febt_payload_missing_n / out.executed_n) : null;
  out.febt_disagreement_rate = out.executed_n > 0 ? (out.febt_disagreement_n / out.executed_n) : null;
  out.febt_fallback_legacy_rate = out.executed_n > 0 ? (out.febt_fallback_legacy_n / out.executed_n) : null;
  out.avg_febt_lock_score = out.febt_lock_score_n > 0 ? (out.febt_lock_score_sum / out.febt_lock_score_n) : null;
  out.avg_febt_delay_cost = out.febt_delay_cost_n > 0 ? (out.febt_delay_cost_sum / out.febt_delay_cost_n) : null;
  out.avg_febt_late_risk = out.febt_late_risk_n > 0 ? (out.febt_late_risk_sum / out.febt_late_risk_n) : null;
  out.avg_febt_failure_risk = out.febt_failure_risk_n > 0 ? (out.febt_failure_risk_sum / out.febt_failure_risk_n) : null;
  out.avg_febt_edge = out.febt_edge_n > 0 ? (out.febt_edge_sum / out.febt_edge_n) : null;
  return out;
}

async function summarizePineSignalQuality({
  signals = [],
  fills = [],
  intents = [],
  exchange = null,
  tf = null,
  fromMs = null,
  toMs = null,
  barsByMarket = null,
  loadPathMetrics = false,
} = {}) {
  const exchangeNorm = normalizeExchange(exchange);
  const tfNorm = String(tf || "").trim();
  const preferredTierOrder = ["EARLY", "CORE"];
  const fallbackTierOrder = [];
  const byTier = Object.fromEntries(preferredTierOrder.concat(fallbackTierOrder).map((tier) => [tier, emptyTierStats()]));
  const ensureTierStats = (tier) => {
    if (!tier) return null;
    if (!byTier[tier]) byTier[tier] = emptyTierStats();
    return byTier[tier];
  };

  const signalRows = [];
  const signalMetaByKey = new Map();
  const mergeSignalMeta = (key, patch = {}) => {
    if (!key) return;
    const prev = signalMetaByKey.get(key) || {};
    const next = { ...prev };
    for (const [field, value] of Object.entries(patch || {})) {
      if (value === null || value === undefined || value === "") continue;
      if (typeof value === "boolean") {
        next[field] = value;
        continue;
      }
      if (typeof value === "number" && Number.isFinite(value)) {
        next[field] = value;
        continue;
      }
      const hasPrev = prev[field] !== null && prev[field] !== undefined && prev[field] !== "" && prev[field] !== "unknown" && prev[field] !== "UNKNOWN";
      if (!hasPrev) next[field] = value;
    }
    signalMetaByKey.set(key, next);
  };
  for (const row of signals || []) {
    const event = toUpper(row && row.event);
    const tier = normalizeTier(row);
    if (!tier) continue;
    const ex = normalizeExchange(row && row.exchange);
    const rowTf = normalizeTf(row);
    const barMs = resolveBarMs(row);
    if (exchangeNorm && ex && ex !== exchangeNorm) continue;
    if (tfNorm && rowTf && rowTf !== tfNorm) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(barMs) && barMs < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(barMs) && barMs >= toMs) continue;
    ensureTierStats(tier).signals_n += 1;
    signalRows.push({
      exchange: ex,
      market: normalizeMarket(row),
      tf: rowTf,
      event,
      tier,
      bar_ms: barMs,
      side: normalizeSide(row && row.side),
      ...buildFilterFeatureSignature(row),
    });
    const key = makeSignalKey(row);
    if (key && !signalMetaByKey.has(key)) {
      signalMetaByKey.set(key, {
        side: normalizeSide(row && row.side),
        ...buildFilterFeatureSignature(row),
      });
    }
  }

  for (const row of intents || []) {
    const event = toUpper(row && row.event);
    const tier = normalizeTier(row);
    if (!tier) continue;
    const ex = normalizeExchange(row && row.exchange);
    const rowTf = normalizeTf(row);
    const barMs = resolveBarMs(row);
    if (exchangeNorm && ex && ex !== exchangeNorm) continue;
    if (tfNorm && rowTf && rowTf !== tfNorm) continue;
    if (Number.isFinite(fromMs) && Number.isFinite(barMs) && barMs < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(barMs) && barMs >= toMs) continue;
    const key = makeSignalKey({
      exchange: ex,
      symbol_or_pair_id: normalizeMarket(row),
      tf: rowTf,
      event,
      signal_bar_close_time_utc_ms: barMs,
      bar_close_time_utc_ms: barMs,
    });
    mergeSignalMeta(key, {
      side: normalizeSide(row && row.side),
      ...buildFilterFeatureSignature(row),
    });
  }

  const fillsFiltered = [];
  const chains = new Map();
  for (const row of fills || []) {
    const ex = normalizeExchange(row && row.exchange);
    const rowTf = normalizeTf(row);
    const execMs = resolveExecMs(row);
    if (exchangeNorm && ex && ex !== exchangeNorm) continue;
    if (tfNorm && rowTf && rowTf !== tfNorm) continue;
    if (Number.isFinite(toMs) && Number.isFinite(execMs) && execMs >= toMs) continue;
    fillsFiltered.push(row);

    const chainId = resolveEntryEventId(row);
    if (!chainId) continue;
    const entrySignalType = toUpper(
      row && (row.entry_signal_type || row.entrySignalType || row.event)
    );
    const tier = normalizeTier({
      event: entrySignalType,
      features_json: row && row.features_json,
      features: row && row.features,
    });
    if (!tier) continue;
    const barMs = resolveBarMs(row);
    let chain = chains.get(chainId);
    if (!chain) {
      chain = {
        entry_event_id: chainId,
        entry_signal_type: entrySignalType,
        tier,
        exchange: ex,
        market: normalizeMarket(row),
        tf: rowTf,
        entry_bar_ms: barMs,
        entry_exec_ms: null,
        entry_price: null,
        fills: [],
      };
      chains.set(chainId, chain);
    }
    chain.fills.push(row);
    if (isEntryTierEvent(row && row.event)) {
      const entryMs = resolveExecMs(row);
      const entryPrice = toNum(row && row.exec_price);
      chain.entry_exec_ms = Number.isFinite(chain.entry_exec_ms)
        ? Math.min(chain.entry_exec_ms, entryMs)
        : entryMs;
      if (Number.isFinite(entryPrice)) {
        chain.entry_price = Number.isFinite(chain.entry_price)
          ? chain.entry_price
          : entryPrice;
      }
      if (Number.isFinite(barMs)) {
        chain.entry_bar_ms = Number.isFinite(chain.entry_bar_ms)
          ? Math.min(chain.entry_bar_ms, barMs)
          : barMs;
      }
    }
  }

  const selectedChains = [];
  for (const chain of chains.values()) {
    const barMs = toNum(chain.entry_bar_ms);
    if (Number.isFinite(fromMs) && Number.isFinite(barMs) && barMs < fromMs) continue;
    if (Number.isFinite(toMs) && Number.isFinite(barMs) && barMs >= toMs) continue;
    selectedChains.push(chain);
    ensureTierStats(chain.tier).executed_n += 1;
  }

  const tradeRows = [];
  const fillsByMarket = {};
  for (const row of fillsFiltered) {
    const market = normalizeMarket(row);
    if (!market) continue;
    if (!fillsByMarket[market]) fillsByMarket[market] = [];
    fillsByMarket[market].push(row);
  }
  for (const [market, marketFills] of Object.entries(fillsByMarket)) {
    marketFills.sort((a, b) => resolveExecMs(a) - resolveExecMs(b));
    const res = await buildTradesFromFillsWithFunding(marketFills, {
      exchange: exchangeNorm || normalizeExchange(marketFills[0] && marketFills[0].exchange),
      symbol: market,
      mode: "EACH_SELL",
    });
    for (const trade of res.trades || []) {
      const entryEventId = String(trade && trade.entry_event_id || "").trim();
      if (!entryEventId) continue;
      tradeRows.push(trade);
    }
  }

  const tradesByEntry = new Map();
  for (const trade of tradeRows) {
    const key = String(trade.entry_event_id || "").trim();
    if (!key) continue;
    if (!tradesByEntry.has(key)) tradesByEntry.set(key, []);
    tradesByEntry.get(key).push(trade);
  }

  const selectedChainInputs = selectedChains.map((chain) => {
    const fillsSorted = chain.fills
      .slice()
      .sort((a, b) => resolveExecMs(a) - resolveExecMs(b));
    const exitRows = fillsSorted
      .map((row) => ({ kind: classifyExitEvent(row && row.event), ms: resolveExecMs(row), event: toUpper(row && row.event) }))
      .filter((row) => row.kind && Number.isFinite(row.ms));
    const chainTrades = tradesByEntry.get(chain.entry_event_id) || [];
    const tradeExitRows = chainTrades
      .map((row) => ({
        kind: classifyExitEvent(row && (row.exit_event || row.event)),
        ms: toNum(row && (row.close_ms || row.exec_bar_close_time_utc_ms)) ?? parseMs(row && row.created_at),
        event: toUpper(row && (row.exit_event || row.event)),
      }))
      .filter((row) => row.kind && Number.isFinite(row.ms));
    const scopedExits = (exitRows.length > 0 ? exitRows : tradeExitRows).sort((a, b) => a.ms - b.ms);
    const lastExit = scopedExits.length > 0 ? scopedExits[scopedExits.length - 1] : null;
    return {
      market: chain.market,
      entry_bar_ms: chain.entry_bar_ms,
      path_end_ms: lastExit ? lastExit.ms : null,
      first_exit_ms: scopedExits.length > 0 ? scopedExits[0].ms : null,
      tp1_ms: (() => {
        const tp1Row = scopedExits.find((row) => row.kind === "TP1");
        return tp1Row ? tp1Row.ms : null;
      })(),
      sl_ms: (() => {
        const slRow = scopedExits.find((row) => row.kind === "SL");
        return slRow ? slRow.ms : null;
      })(),
    };
  });
  let pathBarsByMarket = normalizeBarsByMarket(barsByMarket);
  if (pathBarsByMarket.size <= 0 && loadPathMetrics) {
    pathBarsByMarket = await loadBarsForChainRows(selectedChainInputs, {
      exchange: exchangeNorm,
      tf: tfNorm,
    });
  }

  const chainRows = [];
  for (const chain of selectedChains) {
    const fillsSorted = chain.fills
      .slice()
      .sort((a, b) => resolveExecMs(a) - resolveExecMs(b));
    const exitKindsFromFills = fillsSorted
      .map((row) => ({ kind: classifyExitEvent(row && row.event), ms: resolveExecMs(row), event: toUpper(row && row.event) }))
      .filter((row) => row.kind && Number.isFinite(row.ms));
    const chainTrades = tradesByEntry.get(chain.entry_event_id) || [];
    const exitKindsFromTrades = chainTrades
      .map((row) => ({
        kind: classifyExitEvent(row && (row.exit_event || row.event)),
        ms: toNum(row && (row.close_ms || row.exec_bar_close_time_utc_ms)) ?? parseMs(row && row.created_at),
        event: toUpper(row && (row.exit_event || row.event)),
      }))
      .filter((row) => row.kind && Number.isFinite(row.ms));
    const exitKinds = (exitKindsFromFills.length > 0 ? exitKindsFromFills : exitKindsFromTrades)
      .slice()
      .sort((a, b) => a.ms - b.ms);

    const hasExits = exitKinds.length > 0;
    const firstExit = hasExits ? exitKinds[0] : null;
    const firstTp0Idx = exitKinds.findIndex((x) => x.kind === "TP0");
    const firstTp1Idx = exitKinds.findIndex((x) => x.kind === "TP1");
    const firstTimeStopIdx = exitKinds.findIndex((x) => x.kind === "TIME_STOP");
    const hasTp0 = firstTp0Idx >= 0;
    const hasTp1 = firstTp1Idx >= 0;
    const hasTimeStop = firstTimeStopIdx >= 0;
    const hasTrailAfterTp1 = hasTp1 && exitKinds.slice(firstTp1Idx + 1).some((x) => x.kind === "TRAIL");
    const slBeforeTp1 = exitKinds.some((x, idx) => x.kind === "SL" && (firstTp1Idx < 0 || idx < firstTp1Idx));
    const tp0First = firstTp0Idx >= 0 && [firstTp1Idx, firstTimeStopIdx]
      .filter((value) => value >= 0)
      .every((value) => firstTp0Idx < value);
    const timeStopFirst = firstTimeStopIdx >= 0 && [firstTp0Idx, firstTp1Idx]
      .filter((value) => value >= 0)
      .every((value) => firstTimeStopIdx < value);
    const tp0ToTp1Converted = hasTp0 && hasTp1 && firstTp0Idx < firstTp1Idx;
    const preTp1TimeStop = hasTimeStop && !hasTp1;
    const firstTp0 = hasTp0 ? exitKinds[firstTp0Idx] : null;
    const firstTp1 = hasTp1 ? exitKinds[firstTp1Idx] : null;
    const firstSl = exitKinds.find((x) => x.kind === "SL") || null;
    const signalKey = `${chain.market}__${chain.tf}__${chain.entry_bar_ms}__${chain.entry_signal_type}`;
    const signalMeta = signalMetaByKey.get(signalKey) || {};

    const tierStats = ensureTierStats(chain.tier);
    if (hasExits) tierStats.exits_seen_n += 1;
    if (hasTp1) tierStats.tp1_hit_n += 1;
    if (slBeforeTp1) tierStats.sl_before_tp1_n += 1;
    if (hasTrailAfterTp1) tierStats.trail_after_tp1_n += 1;
    if (Number.isFinite(signalMeta.entropy_score)) {
      tierStats.entropy_sum += Number(signalMeta.entropy_score);
      tierStats.entropy_n += 1;
    }
    if (Number.isFinite(signalMeta.coherence_score)) {
      tierStats.coherence_sum += Number(signalMeta.coherence_score);
      tierStats.coherence_n += 1;
    }
    if (Number.isFinite(signalMeta.transition_risk)) {
      tierStats.transition_risk_sum += Number(signalMeta.transition_risk);
      tierStats.transition_risk_n += 1;
    }
    if (Number.isFinite(signalMeta.field_alignment)) {
      tierStats.field_alignment_sum += Number(signalMeta.field_alignment);
      tierStats.field_alignment_n += 1;
    }
    if (Number.isFinite(signalMeta.domain_wall_density)) {
      tierStats.domain_wall_density_sum += Number(signalMeta.domain_wall_density);
      tierStats.domain_wall_density_n += 1;
    }
    if (Number.isFinite(signalMeta.susceptibility)) {
      tierStats.susceptibility_sum += Number(signalMeta.susceptibility);
      tierStats.susceptibility_n += 1;
    }
    if (Number.isFinite(signalMeta.free_energy)) {
      tierStats.free_energy_sum += Number(signalMeta.free_energy);
      tierStats.free_energy_n += 1;
    }
    if (signalMeta.febt_payload_missing === true) {
      tierStats.febt_payload_missing_n += 1;
    }
    if (signalMeta.febt_shadow_disagrees_legacy_wait === true) {
      tierStats.febt_disagreement_n += 1;
    }
    if (signalMeta.febt_shadow_fallback_to_legacy === true) {
      tierStats.febt_fallback_legacy_n += 1;
    }
    if (signalMeta.febt_calc_ok === true) {
      tierStats.febt_calc_ok_n += 1;
    }
    const febtPhase = toUpper(signalMeta.febt_phase);
    if (febtPhase && febtPhase !== "UNKNOWN") {
      tierStats.febt_phase_known_n += 1;
    }
    if (febtPhase === "PREPARE") tierStats.febt_prepare_n += 1;
    else if (febtPhase === "ARMED") tierStats.febt_armed_n += 1;
    else if (febtPhase === "FIRE") tierStats.febt_fire_n += 1;
    else if (febtPhase === "LATE") tierStats.febt_late_n += 1;
    else if (febtPhase === "VOID") tierStats.febt_void_n += 1;
    else tierStats.febt_unknown_n += 1;
    if (Number.isFinite(signalMeta.febt_lock_score)) {
      tierStats.febt_lock_score_sum += Number(signalMeta.febt_lock_score);
      tierStats.febt_lock_score_n += 1;
    }
    if (Number.isFinite(signalMeta.febt_delay_cost)) {
      tierStats.febt_delay_cost_sum += Number(signalMeta.febt_delay_cost);
      tierStats.febt_delay_cost_n += 1;
    }
    if (Number.isFinite(signalMeta.febt_late_risk)) {
      tierStats.febt_late_risk_sum += Number(signalMeta.febt_late_risk);
      tierStats.febt_late_risk_n += 1;
    }
    if (Number.isFinite(signalMeta.febt_failure_risk)) {
      tierStats.febt_failure_risk_sum += Number(signalMeta.febt_failure_risk);
      tierStats.febt_failure_risk_n += 1;
    }
    if (Number.isFinite(signalMeta.febt_edge)) {
      tierStats.febt_edge_sum += Number(signalMeta.febt_edge);
      tierStats.febt_edge_n += 1;
    }

    let pnlQuote = 0;
    let notional = 0;
    for (const trade of chainTrades) {
      const pnl = toNum(trade.pnl_krw);
      const tradeNotional = toNum(trade.notional_krw);
      if (Number.isFinite(pnl)) pnlQuote += pnl;
      if (Number.isFinite(tradeNotional) && tradeNotional > 0) notional += tradeNotional;
    }
    const retNet = notional > 0 ? (pnlQuote / notional) : null;
    const realized = chainTrades.length > 0 && Number.isFinite(retNet);
    if (realized) {
      tierStats.realized_chains_n += 1;
      if (retNet > 0) tierStats.win_n += 1;
      tierStats.avg_ret_net += retNet;
      tierStats.avg_pnl_quote += pnlQuote;
    }
    const entryRow = fillsSorted.find((row) => isEntryTierEvent(row && row.event)) || null;
    const inferredSide = normalizeSide(
      signalMeta.side
      || (entryRow && entryRow.side)
      || (chain && chain.side)
    );
    const pathEndMs = firstExit ? resolveExecMs(fillsSorted[fillsSorted.length - 1]) : null;
    const marketBars = pathBarsByMarket.get(chain.market) || [];
    const pathBars = marketBars.filter((bar) => {
      const ts = toNum(bar && (bar.timestamp ?? bar.closeTimeUtcMs));
      return Number.isFinite(ts)
        && Number.isFinite(chain.entry_bar_ms)
        && ts > Number(chain.entry_bar_ms)
        && Number.isFinite(pathEndMs)
        && ts <= Number(pathEndMs);
    });
    const pathMetrics = computeMfeMae({
      entry: chain.entry_price,
      bars: pathBars,
      side: inferredSide,
    });

    chainRows.push({
      entry_event_id: chain.entry_event_id,
      exchange: chain.exchange,
      market: chain.market,
      tf: chain.tf,
      tier: chain.tier,
      side: signalMeta.side || null,
      regime: signalMeta.regime || "unknown",
      score_abs: Number.isFinite(signalMeta.score_abs) ? signalMeta.score_abs : null,
      confidence: Number.isFinite(signalMeta.confidence) ? signalMeta.confidence : null,
      wave_conf: Number.isFinite(signalMeta.wave_conf) ? signalMeta.wave_conf : null,
      volatility: Number.isFinite(signalMeta.volatility) ? signalMeta.volatility : null,
      entropy_score: Number.isFinite(signalMeta.entropy_score) ? signalMeta.entropy_score : null,
      coherence_score: Number.isFinite(signalMeta.coherence_score) ? signalMeta.coherence_score : null,
      transition_risk: Number.isFinite(signalMeta.transition_risk) ? signalMeta.transition_risk : null,
      field_alignment: Number.isFinite(signalMeta.field_alignment) ? signalMeta.field_alignment : null,
      domain_wall_density: Number.isFinite(signalMeta.domain_wall_density) ? signalMeta.domain_wall_density : null,
      susceptibility: Number.isFinite(signalMeta.susceptibility) ? signalMeta.susceptibility : null,
      free_energy: Number.isFinite(signalMeta.free_energy) ? signalMeta.free_energy : null,
      stat_phys_state: signalMeta.stat_phys_state || "unknown",
      market_state_summary_state: signalMeta.market_state_summary_state || "unknown",
      market_state_summary_action: signalMeta.market_state_summary_action || "unknown",
      wait_one_bar_market_state_action: signalMeta.wait_one_bar_market_state_action || "unknown",
      legacy_wait_action: signalMeta.legacy_wait_action || "unknown",
      legacy_wait_trigger_path: signalMeta.legacy_wait_trigger_path || "unknown",
      entry_exec_timing: signalMeta.entry_exec_timing || "unknown",
      ev_gate_policy_version: signalMeta.ev_gate_policy_version || "unknown",
      ev_gate_policy_source: signalMeta.ev_gate_policy_source || "unknown",
      febt_shadow_verdict: signalMeta.febt_shadow_verdict || "unknown",
      febt_shadow_fallback_to_legacy: signalMeta.febt_shadow_fallback_to_legacy === true,
      febt_shadow_fallback_reason: signalMeta.febt_shadow_fallback_reason || "unknown",
      febt_shadow_disagrees_legacy_wait: signalMeta.febt_shadow_disagrees_legacy_wait === true,
      febt_shadow_disagreement_reason: signalMeta.febt_shadow_disagreement_reason || "unknown",
      febt_shadow_legacy_wait_action: signalMeta.febt_shadow_legacy_wait_action || "unknown",
      febt_shadow_legacy_wait_trigger_path: signalMeta.febt_shadow_legacy_wait_trigger_path || "unknown",
      febt_mode: signalMeta.febt_mode || "unknown",
      febt_phase: signalMeta.febt_phase || "unknown",
      febt_calc_ok: signalMeta.febt_calc_ok === true,
      febt_calc_reason: signalMeta.febt_calc_reason || "unknown",
      febt_timing_action: signalMeta.febt_timing_action || "unknown",
      febt_authority: signalMeta.febt_authority || "unknown",
      febt_payload_missing: signalMeta.febt_payload_missing === true,
      febt_lock_score: Number.isFinite(signalMeta.febt_lock_score) ? signalMeta.febt_lock_score : null,
      febt_delay_cost: Number.isFinite(signalMeta.febt_delay_cost) ? signalMeta.febt_delay_cost : null,
      febt_late_risk: Number.isFinite(signalMeta.febt_late_risk) ? signalMeta.febt_late_risk : null,
      febt_failure_risk: Number.isFinite(signalMeta.febt_failure_risk) ? signalMeta.febt_failure_risk : null,
      febt_edge: Number.isFinite(signalMeta.febt_edge) ? signalMeta.febt_edge : null,
      late_by_bars: Number.isFinite(signalMeta.late_by_bars) ? signalMeta.late_by_bars : null,
      score_bucket: signalMeta.score_bucket || "unknown",
      conf_bucket: signalMeta.conf_bucket || "unknown",
      wave_bucket: signalMeta.wave_bucket || "unknown",
      volatility_bucket: signalMeta.volatility_bucket || "unknown",
      entropy_bucket: signalMeta.entropy_bucket || "unknown",
      coherence_bucket: signalMeta.coherence_bucket || "unknown",
      transition_bucket: signalMeta.transition_bucket || "unknown",
      field_alignment_bucket: signalMeta.field_alignment_bucket || "unknown",
      domain_wall_bucket: signalMeta.domain_wall_bucket || "unknown",
      susceptibility_bucket: signalMeta.susceptibility_bucket || "unknown",
      free_energy_bucket: signalMeta.free_energy_bucket || "unknown",
      late_bucket: signalMeta.late_bucket || "on_time",
      session_bucket: signalMeta.session_bucket || "unknown",
      entry_signal_type: chain.entry_signal_type,
      entry_bar_ms: chain.entry_bar_ms,
      entry_exec_ms: chain.entry_exec_ms,
      entry_price: Number.isFinite(chain.entry_price) ? chain.entry_price : null,
      exits_seen: hasExits,
      tp0_hit: hasTp0,
      tp0_first: tp0First,
      tp0_to_tp1_converted: tp0ToTp1Converted,
      first_exit_kind: firstExit ? firstExit.kind : null,
      first_exit_event: firstExit ? firstExit.event : null,
      first_exit_ms: firstExit ? firstExit.ms : null,
      last_exit_ms: pathEndMs,
      tp1_hit: hasTp1,
      tp1_first: hasTp1 && (!hasTp0 || firstTp1Idx < firstTp0Idx),
      time_stop_hit: hasTimeStop,
      time_stop_first: timeStopFirst,
      pre_tp1_time_stop: preTp1TimeStop,
      time_to_tp0_minutes: Number.isFinite(chain.entry_exec_ms) && firstTp0 ? ((firstTp0.ms - chain.entry_exec_ms) / 60000) : null,
      tp1_ms: firstTp1 ? firstTp1.ms : null,
      time_to_tp1_minutes: Number.isFinite(chain.entry_exec_ms) && firstTp1 ? ((firstTp1.ms - chain.entry_exec_ms) / 60000) : null,
      sl_before_tp1: slBeforeTp1,
      sl_ms: firstSl ? firstSl.ms : null,
      trail_after_tp1: hasTrailAfterTp1,
      mfe: Number.isFinite(pathMetrics.mfe) ? pathMetrics.mfe : null,
      mae: Number.isFinite(pathMetrics.mae) ? pathMetrics.mae : null,
      path_bars_n: pathBars.length,
      realized_ret_net: retNet,
      realized_pnl_quote: realized ? pnlQuote : null,
      realized: realized,
    });
  }

  const tierOrder = preferredTierOrder
    .concat(fallbackTierOrder)
    .filter((tier) => {
      const stats = byTier[tier];
      return Number(stats && (stats.signals_n || stats.executed_n || stats.realized_chains_n || 0)) > 0;
    });
  const tierSummary = {};
  for (const tier of tierOrder) tierSummary[tier] = finalizeTierStats(byTier[tier]);

  return {
    meta: {
      exchange: exchangeNorm || null,
      tf: tfNorm || null,
      from_ms: Number.isFinite(fromMs) ? fromMs : null,
      to_ms: Number.isFinite(toMs) ? toMs : null,
      signals_scanned_n: signalRows.length,
      fills_scanned_n: fillsFiltered.length,
      chains_n: selectedChains.length,
    },
    by_tier: tierSummary,
    chain_rows: chainRows.sort((a, b) => (a.entry_bar_ms || 0) - (b.entry_bar_ms || 0)),
  };
}

module.exports = {
  summarizePineSignalQuality,
  __test: {
    normalizeTier,
    classifyExitEvent,
    resolveEntryEventId,
  },
};
