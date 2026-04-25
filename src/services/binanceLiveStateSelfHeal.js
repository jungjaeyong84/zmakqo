"use strict";

const { upsertPositionMetaOnly, runWithPositionWriterLease } = require("../storage/positionsPaper");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { upsertSelfHealFailureObservation } = require("../storage/positionRuntimeObservations");
const { sendAlert } = require("../utils/alerts");
const { getPositionReadView, listExchangePositionReadViews } = require("./positionReadModel");
const { repairLiveTrailingStageForSymbol } = require("./liveTrailingStageRepair");
const { fetchBinanceFuturesAccount } = require("../exchanges/binanceFuturesPrivate");
const {
  syncFuturesPositionOnly,
  runDistributedFuturesPositionSync,
  resolveFuturesPositionSyncRequest,
  resolveLiveFuturesConfig,
  repairActivePositionExitRuntimeState,
  requestBinanceNativeProtectionRefresh,
} = require("../engine/paperBinanceRunner");

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase() || null;
}

function extractExternalActiveSymbolsFromAccount(account = {}) {
  const rows = Array.isArray(account && account.positions) ? account.positions : [];
  return rows
    .filter((row) => {
      const qty = Number(row && row.positionAmt);
      return Number.isFinite(qty) && qty !== 0;
    })
    .map((row) => normalizeSymbol(row && row.symbol))
    .filter(Boolean);
}

function buildSelfHealTargetSymbols({
  explicitSymbols = [],
  internalRows = [],
  externalSymbols = [],
  maxPositions = 20,
} = {}) {
  const limit = Math.max(1, Number(maxPositions) || 20);
  const explicit = Array.isArray(explicitSymbols)
    ? explicitSymbols.map((row) => normalizeSymbol(row)).filter(Boolean)
    : [];
  if (explicit.length) return Array.from(new Set(explicit)).slice(0, limit);

  const internal = Array.isArray(internalRows)
    ? internalRows
      .filter((row) => isActivePaperPosition(row))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .map((row) => normalizeSymbol(row.symbol_or_pair_id || row.symbol))
      .filter(Boolean)
    : [];
  const external = Array.isArray(externalSymbols)
    ? externalSymbols.map((row) => normalizeSymbol(row)).filter(Boolean)
    : [];

  // External-active symbols are first-class recovery targets.  This covers the
  // failure mode where Binance has a live position but the internal read model
  // is temporarily FLAT, so an internal-active-only scan would never heal it.
  return Array.from(new Set([...external, ...internal])).slice(0, limit);
}

async function listExternalActiveBinanceSymbols({ exchange = "BINANCEFUT" } = {}) {
  if (String(exchange || "").toUpperCase() !== "BINANCEFUT") return [];
  const liveCfg = await resolveLiveFuturesConfig({ exchange }).catch(() => null);
  if (!liveCfg || !liveCfg.apiKey || !liveCfg.apiSecret) return [];
  const account = await fetchBinanceFuturesAccount({
    apiKey: liveCfg.apiKey,
    apiSecret: liveCfg.apiSecret,
  }).catch(() => null);
  return extractExternalActiveSymbolsFromAccount(account || {});
}

function isActivePaperPosition(pos = {}) {
  const state = String(pos.position_state || pos.state || "").trim().toUpperCase();
  const sizePct = Number(pos.size_pct);
  const qtyBase = Number(pos.qty_base);
  const hasSize = (Number.isFinite(sizePct) && sizePct > 0) || (Number.isFinite(qtyBase) && qtyBase > 0);
  if (!hasSize) return false;
  return state !== "FLAT";
}

function shouldRepairBinanceLivePosition(meta = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  const invariants = Array.isArray(state.exchange_projection_invariants) ? state.exchange_projection_invariants : [];
  const refreshStatus = String(state.native_protection_refresh_status || "").trim().toUpperCase();
  const inSync = state.exchange_projection_in_sync !== false;
  const stageNeedsTpProtection = state.tp_p1_done !== true && state.trail_active !== true;
  if (!inSync) return true;
  if (refreshStatus === "MISSING" || refreshStatus === "FAILED") return true;
  if (invariants.includes("NATIVE_STOP_MISSING")) return true;
  if (invariants.includes("TRAIL_WITHOUT_TP1")) return true;
  if (invariants.includes("TP1_DONE_WITH_TP_ORDER")) return true;
  if (stageNeedsTpProtection && !state.native_protection_tp0_order_id && !state.native_protection_tp_order_id) {
    return true;
  }
  return false;
}

function shouldForceImmediateSelfHealNativeProtection(meta = {}) {
  const state = (meta && typeof meta === "object") ? meta : {};
  const refreshStatus = String(state.native_protection_refresh_status || "").trim().toUpperCase();
  const stageNeedsTpProtection = state.tp_p1_done !== true && state.trail_active !== true;
  const hasTpProtection = !!(state.native_protection_tp0_order_id || state.native_protection_tp_order_id);
  const hasStopProtection = !!state.native_protection_stop_order_id;
  if (stageNeedsTpProtection) {
    if (refreshStatus === "MISSING" || refreshStatus === "FAILED") return true;
    if (!hasTpProtection || !hasStopProtection) return true;
    return false;
  }
  if (state.tp_p1_done === true || state.trail_active === true) {
    if (refreshStatus === "MISSING" || refreshStatus === "FAILED") return true;
    if (!hasStopProtection) return true;
  }
  return false;
}

function buildSelfHealFailureMetaPatch({
  reason = "UNKNOWN",
  error = null,
  atMs = Date.now(),
} = {}) {
  return {
    native_protection_refresh_status: "FAILED",
    native_protection_refresh_reason: String(reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN",
    last_self_heal_error: error ? String(error).slice(0, 240) : null,
    last_self_heal_at_ms: Number.isFinite(Number(atMs)) ? Number(atMs) : Date.now(),
  };
}

async function sendSelfHealFailureAlert({
  exchange = "BINANCEFUT",
  symbol,
  reason = "UNKNOWN",
  error = null,
} = {}) {
  const channel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_REQUIRED" };
  return sendAlert({
    channel,
    title: `[V2 Self-Heal] ${sym} self-heal 경고`,
    body: [
      `exchange: ${String(exchange || "BINANCEFUT").toUpperCase()}`,
      `reason: ${String(reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN"}`,
      error ? `error: ${String(error).slice(0, 240)}` : null,
    ].filter(Boolean).join("\n"),
    severity: "WARN",
  });
}

async function loadPositionReadState(exchange, symbol) {
  const position = await getPositionReadView({
    exchange,
    symbol,
  });
  return { position };
}

async function healBinanceLivePosition({
  exchange = "BINANCEFUT",
  symbol,
  runId = null,
  forceRepair = false,
} = {}) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_REQUIRED" };
  return runDistributedFuturesPositionSync({
    exchange,
    symbol: sym,
    ttlMs: 120000,
    runner: async () => runWithPositionWriterLease({
      exchange,
      symbol: sym,
      ttlMs: 120000,
      waitMs: 3000,
      runner: async () => {
      const syncRunId = runId || `RUN__SELF_HEAL__${String(exchange || "").toUpperCase()}__${sym}__${Date.now()}`;
      const syncBefore = await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
        source: "SELF_HEAL_PRECHECK",
        runId: syncRunId,
        exchange,
        symbol: sym,
      }));

      let { position: pos } = await loadPositionReadState(exchange, sym);
      if (!isActivePaperPosition(pos)) {
        return {
          ok: true,
          skipped: true,
          reason: "NO_ACTIVE_POSITION",
          symbol: sym,
          sync_before: syncBefore,
          position: pos,
        };
      }

      const meta = (pos && typeof pos.meta === "object") ? pos.meta : {};
      const needsRepair = forceRepair === true || shouldRepairBinanceLivePosition(meta);
      let repaired = false;

      if (needsRepair) {
        try {
          const sys = await getSystemSettingsForProvider(exchange, 2000);
          const sysCfg = sys && sys.data ? sys.data : {};
          const liveCfg = await resolveLiveFuturesConfig({ exchange, symbol: sym });
          const repairedMeta = await repairActivePositionExitRuntimeState({
            exchange,
            symbol: sym,
            positionSide: pos.position_side || meta.position_side || null,
            entryPrice: pos.avg_price,
            leverage: meta.leverage || meta.native_protection_leverage || null,
            liveCfg,
            posMeta: meta,
            cohort: meta.openclaw_market_regime_cohort || meta.market_regime_cohort || null,
            sysCfg,
            execBarCloseMs: Number(meta.entry_exec_bar_ms || meta.last_entry_bar_ms) || null,
          });
          if (repairedMeta && typeof repairedMeta === "object") {
            await upsertPositionMetaOnly({
              exchange,
              symbol: sym,
              runId: `${syncRunId}__REPAIR_META`,
              executionMode: "LIVE",
              meta: repairedMeta,
              source: "SELF_HEAL",
              mutationKind: "POSITION_META_UPSERT",
              reason: "SELF_HEAL_REPAIR_META",
              expectedWriteToken: pos && Object.prototype.hasOwnProperty.call(pos, "position_write_token")
                ? (pos.position_write_token ?? null)
                : null,
            });
          }
          repaired = true;
          await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
            source: "SELF_HEAL_POST_REPAIR",
            runId: `${syncRunId}__POST_REPAIR`,
            exchange,
            symbol: sym,
            force: true,
          }));
          ({ position: pos } = await loadPositionReadState(exchange, sym));
          let nextMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : {};
          if (
            liveCfg &&
            liveCfg.apiKey &&
            liveCfg.apiSecret &&
            shouldForceImmediateSelfHealNativeProtection(nextMeta)
          ) {
            const fallbackEntryPrice = Number(pos && pos.avg_price);
            const fallbackLeverage = Number(nextMeta.leverage || nextMeta.external_leverage || nextMeta.native_protection_leverage);
            await requestBinanceNativeProtectionRefresh({
              exchange,
              symbol: sym,
              fallbackSide: pos && pos.position_side ? pos.position_side : (nextMeta.position_side || null),
              fallbackEntryPrice: Number.isFinite(fallbackEntryPrice) && fallbackEntryPrice > 0 ? fallbackEntryPrice : null,
              fallbackLeverage: Number.isFinite(fallbackLeverage) && fallbackLeverage > 0 ? fallbackLeverage : null,
              exitRulesOverride: nextMeta.exit_rules_override || null,
              posMeta: nextMeta,
              source: "BINANCE_LIVE_STATE_SELF_HEAL",
              reason: "SELF_HEAL_NATIVE_PROTECTION_GUARD",
              dispatchReason: `SELF_HEAL_FORCE_NATIVE_PROTECTION_${String(exchange || "").toUpperCase()}_${sym}`,
              dispatchExitWorker: true,
              executeImmediately: true,
            });
            await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
              source: "SELF_HEAL_POST_NATIVE_PROTECTION_GUARD",
              runId: `${syncRunId}__POST_NATIVE_PROTECTION_GUARD`,
              exchange,
              symbol: sym,
              force: true,
            }));
            ({ position: pos } = await loadPositionReadState(exchange, sym));
            nextMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : {};
          }
        } catch (e) {
          const errorText = e && e.message ? e.message : String(e);
          await upsertSelfHealFailureObservation({
            exchange,
            symbol: sym,
            reason: "REPAIR_EXCEPTION",
            error: errorText,
          });
          await sendSelfHealFailureAlert({
            exchange,
            symbol: sym,
            reason: "REPAIR_EXCEPTION",
            error: errorText,
          }).catch(() => {});
          return {
            ok: false,
            symbol: sym,
            repaired: false,
            error: errorText,
            sync_before: syncBefore,
            position: (await loadPositionReadState(exchange, sym)).position,
          };
        }
        const nextMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : {};
        if (forceRepair === true || shouldRepairBinanceLivePosition(nextMeta)) {
          try {
            const trailingRepair = await repairLiveTrailingStageForSymbol({
              exchange,
              symbol: sym,
            });
            if (trailingRepair && trailingRepair.ok === true && trailingRepair.skipped !== true) {
              repaired = true;
              await syncFuturesPositionOnly(resolveFuturesPositionSyncRequest({
                source: "SELF_HEAL_POST_TRAIL_REPAIR",
                runId: `${syncRunId}__POST_TRAIL_REPAIR`,
                exchange,
                symbol: sym,
                force: true,
              }));
              ({ position: pos } = await loadPositionReadState(exchange, sym));
            }
          } catch (trailRepairErr) {
            const errorText = trailRepairErr && trailRepairErr.message ? trailRepairErr.message : String(trailRepairErr);
            await upsertSelfHealFailureObservation({
              exchange,
              symbol: sym,
              reason: "TRAIL_STAGE_REPAIR_EXCEPTION",
              error: errorText,
            });
          }
        }
        const finalMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : {};
        if (shouldRepairBinanceLivePosition(finalMeta)) {
          const failurePatch = buildSelfHealFailureMetaPatch({
            reason: "REPAIR_POST_SYNC_MISMATCH",
            error: Array.isArray(finalMeta.exchange_projection_invariants) ? finalMeta.exchange_projection_invariants.join(",") : null,
          });
          await upsertSelfHealFailureObservation({
            exchange,
            symbol: sym,
            reason: failurePatch.native_protection_refresh_reason,
            error: failurePatch.last_self_heal_error,
            atMs: failurePatch.last_self_heal_at_ms,
          });
          await sendSelfHealFailureAlert({
            exchange,
            symbol: sym,
            reason: "REPAIR_POST_SYNC_MISMATCH",
            error: failurePatch.last_self_heal_error,
          }).catch(() => {});
          ({ position: pos } = await loadPositionReadState(exchange, sym));
        }
      }

      return {
        ok: true,
        symbol: sym,
        repaired,
        sync_before: syncBefore,
        position: pos,
      };
      },
    }),
  });
}

async function runBinanceLiveStateSelfHeal({
  exchange = "BINANCEFUT",
  symbols = null,
  maxPositions = 20,
  forceRepair = false,
  reason = "SCHEDULED",
} = {}) {
  const explicitSymbols = Array.isArray(symbols)
    ? symbols.map((row) => normalizeSymbol(row)).filter(Boolean)
    : [];
  let targets = explicitSymbols;

  if (!targets.length) {
    const [rows, externalSymbols] = await Promise.all([
      listExchangePositionReadViews({
        exchange,
        limit: Math.max(50, Number(maxPositions) * 4 || 80),
      }).catch(() => []),
      listExternalActiveBinanceSymbols({ exchange }).catch(() => []),
    ]);
    targets = buildSelfHealTargetSymbols({
      internalRows: rows,
      externalSymbols,
      maxPositions,
    });
  }

  const results = [];
  for (const symbol of targets) {
    try {
      const healed = await healBinanceLivePosition({
        exchange,
        symbol,
        runId: `RUN__SELF_HEAL__${String(reason || "SCHEDULED").toUpperCase()}__${symbol}__${Date.now()}`,
        forceRepair,
      });
      results.push(healed);
    } catch (e) {
      results.push({
        ok: false,
        symbol,
        error: e && e.message ? e.message : String(e),
      });
    }
  }

  return {
    ok: true,
    exchange: String(exchange || "").toUpperCase(),
    scanned: targets.length,
    healed_n: results.filter((row) => row && row.repaired === true).length,
    skipped_n: results.filter((row) => row && row.skipped === true).length,
    results,
  };
}

module.exports = {
  healBinanceLivePosition,
  runBinanceLiveStateSelfHeal,
  __test: {
    isActivePaperPosition,
    shouldRepairBinanceLivePosition,
    shouldForceImmediateSelfHealNativeProtection,
    buildSelfHealFailureMetaPatch,
    extractExternalActiveSymbolsFromAccount,
    buildSelfHealTargetSymbols,
  },
};
