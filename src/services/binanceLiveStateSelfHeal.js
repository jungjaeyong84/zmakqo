"use strict";

const { getFirestore } = require("../storage/firestore");
const { getPosition } = require("../storage/positionsPaper");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { upsertSelfHealFailureObservation } = require("../storage/positionRuntimeObservations");
const { sendAlert } = require("../utils/alerts");
const {
  syncFuturesPositionOnly,
  resolveLiveFuturesConfig,
  repairActivePositionExitRuntimeState,
} = require("../engine/paperUpbitRunner");

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase() || null;
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
    title: `${sym} self-heal 경고`,
    body: [
      `exchange: ${String(exchange || "BINANCEFUT").toUpperCase()}`,
      `reason: ${String(reason || "UNKNOWN").trim().toUpperCase() || "UNKNOWN"}`,
      error ? `error: ${String(error).slice(0, 240)}` : null,
    ].filter(Boolean).join("\n"),
    severity: "WARN",
  });
}

async function healBinanceLivePosition({
  exchange = "BINANCEFUT",
  symbol,
  runId = null,
  forceRepair = false,
} = {}) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return { ok: false, skipped: true, reason: "SYMBOL_REQUIRED" };

  const syncRunId = runId || `RUN__SELF_HEAL__${String(exchange || "").toUpperCase()}__${sym}__${Date.now()}`;
  const syncBefore = await syncFuturesPositionOnly({
    runId: syncRunId,
    exchange,
    symbol: sym,
  });

  let pos = await getPosition({ exchange, symbol: sym });
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
      await repairActivePositionExitRuntimeState({
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
      repaired = true;
      await syncFuturesPositionOnly({
        runId: `${syncRunId}__POST_REPAIR`,
        exchange,
        symbol: sym,
      });
      pos = await getPosition({ exchange, symbol: sym });
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
        position: await getPosition({ exchange, symbol: sym }),
      };
    }
    const nextMeta = (pos && pos.meta && typeof pos.meta === "object") ? pos.meta : {};
    if (shouldRepairBinanceLivePosition(nextMeta)) {
      const failurePatch = buildSelfHealFailureMetaPatch({
        reason: "REPAIR_POST_SYNC_MISMATCH",
        error: Array.isArray(nextMeta.exchange_projection_invariants) ? nextMeta.exchange_projection_invariants.join(",") : null,
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
      pos = await getPosition({ exchange, symbol: sym });
    }
  }

  return {
    ok: true,
    symbol: sym,
    repaired,
    sync_before: syncBefore,
    position: pos,
  };
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
    const db = getFirestore();
    const snap = await db.collection("positions_paper")
      .where("exchange", "==", String(exchange || "").toUpperCase())
      .limit(Math.max(50, Number(maxPositions) * 4 || 80))
      .get();
    const rows = [];
    snap.forEach((doc) => rows.push(doc.data() || {}));
    targets = rows
      .filter((row) => isActivePaperPosition(row))
      .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
      .map((row) => normalizeSymbol(row.symbol_or_pair_id))
      .filter(Boolean)
      .slice(0, Math.max(1, Number(maxPositions) || 20));
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
    buildSelfHealFailureMetaPatch,
  },
};
