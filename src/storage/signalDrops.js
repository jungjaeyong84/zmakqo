const { getFirestore } = require("./firestore");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { confirmSelfEvolutionRuntimeSignal } = require("../utils/selfEvolutionRuntimeState");
const { buildEventEnvelope } = require("../utils/eventEnvelope");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { extractLiveExecutionPolicyTrace, toLiveExecutionPolicyTopLevel } = require("../utils/liveExecutionPolicyTrace");

function nowIso() {
  return new Date().toISOString();
}

function normalizeExecutionMode(v) {
  const s = String(v || "").toUpperCase();
  if (s === "LIVE" || s === "LIVE_DRY_RUN" || s === "PAPER") return s;
  return null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function deriveReasonFamily(codeOrReason = null) {
  const s = upper(codeOrReason);
  if (!s) return "UNKNOWN";
  if (s.includes("EV_POLICY")) return "EV_POLICY";
  if (s.includes("COOLDOWN")) return "COOLDOWN_POLICY";
  if (s.includes("STRATEGY")) return "STRATEGY_GATE";
  if (s.includes("EXECUTION_QUALITY")) return "EXECUTION_QUALITY";
  if (s.includes("TF_")) return "TF_GATE";
  if (s.includes("WEBHOOK")) return "WEBHOOK_INGRESS";
  const parts = s.split("_").filter(Boolean).slice(0, 2);
  return parts.length ? parts.join("_") : "UNKNOWN";
}

function isLineageFillIntentReason(value) {
  return upper(value) === "LINEAGE_SLO_FILL_INTENT_NULL_RATE";
}

function deriveEffectiveDropReason({ resolvedReason = null, liveExecPolicyTrace = null } = {}) {
  const trace = liveExecPolicyTrace && typeof liveExecPolicyTrace === "object" ? liveExecPolicyTrace : {};
  const rawReason = upper(resolvedReason);
  if (!isLineageFillIntentReason(rawReason)) return rawReason || null;

  const hasEntryMetric = trace._live_exec_policy_lineage_has_entry_fill_intent_metric === true;
  const entryFillIntentNullRate = Number(trace._live_exec_policy_lineage_entry_fills_intent_id_null_rate);
  const lineageReasonSuppressed = trace._live_exec_policy_lineage_reason_suppressed === true;

  if (
    lineageReasonSuppressed
    || !hasEntryMetric
    || !Number.isFinite(entryFillIntentNullRate)
    || entryFillIntentNullRate <= 0
  ) {
    const policyReason = upper(trace._live_exec_policy_reason);
    if (policyReason && policyReason !== rawReason && policyReason !== "LIVE_POLICY_OK") {
      return policyReason;
    }
    if (upper(trace._live_exec_policy_action) === "QUARANTINE") {
      return "LIVE_POLICY_QUARANTINE_HARD_BLOCK";
    }
    if (upper(trace._live_exec_policy_plan_mode) === "WATCH_ONLY") {
      return "LIVE_POLICY_PLAN_WATCH_ONLY_BLOCK";
    }
    return "LIVE_POLICY_BLOCK";
  }

  return rawReason;
}

function dropId({ exchange, symbol, tf, barCloseMs, event, side, group, subtype }) {
  return [
    "DROP",
    String(exchange || ""),
    String(symbol || ""),
    String(tf || ""),
    String(barCloseMs || ""),
    String(event || ""),
    String(side || ""),
    String(group || ""),
    String(subtype || ""),
  ].join("__");
}

function deriveCanonicalEventId({ exchange, symbol, tf, barCloseMs, event, side } = {}) {
  return [
    "EVENT",
    String(exchange || "").trim().toUpperCase(),
    String(symbol || "").trim().toUpperCase(),
    String(tf || "").trim(),
    String(barCloseMs || "").trim(),
    String(event || "").trim().toUpperCase(),
    String(side || "").trim().toUpperCase(),
  ].join("__");
}

function pickDropStrategyId(payload = null) {
  if (!payload || typeof payload !== "object") return null;
  const features = payload.features_json && typeof payload.features_json === "object"
    ? payload.features_json
    : {};
  const strategyId = String(
    payload.strategy_id
    || features.strategy_id
    || ""
  ).trim();
  return strategyId || null;
}

function shouldConfirmSelfEvolutionFromDrop(payload = null) {
  if (!payload || typeof payload !== "object") return false;
  const executionMode = normalizeExecutionMode(payload.execution_mode);
  if (executionMode !== "LIVE") return false;
  if (!String(payload.signal_id || "").trim()) return false;
  if (!pickDropStrategyId(payload)) return false;
  return true;
}

async function recordSignalDrops({ exchange, symbol, tf, drops = [], requestId = null, runId = null, decisionReason = null } = {}) {
  if (!Array.isArray(drops) || drops.length === 0) return { ok: true, written: 0 };
  const db = getFirestore();
  const now = nowIso();

  const normalizedDrops = [];
  const writes = drops.map((d) => {
    const group = String(d.event_group || d.group || "UNKNOWN").toUpperCase();
    const subtype = String(d.event_subtype || d.subtype || "GEN").toUpperCase();
    const id = dropId({
      exchange,
      symbol,
      tf,
      barCloseMs: d.bar_close_time_utc_ms,
      event: d.event,
      side: d.side,
      group,
      subtype,
    });
    const regimeMeta = enrichFeaturesWithRegime(d.features_json || d.features || {});
    const resolvedSource = upper(
      d.source
      || (d.meta && d.meta.source)
      || (d.features_json && d.features_json.source)
      || (d.features && d.features.source)
      || "SERVER"
    ) || "SERVER";
    let resolvedSignalId = String(
      d.signal_id
      || (d.features_json && d.features_json.signal_id)
      || (d.features && d.features.signal_id)
      || ""
    ).trim() || null;
    const resolvedSignalDocId = String(
      d.signal_doc_id
      || (d.features_json && d.features_json.signal_doc_id)
      || (d.features && d.features.signal_doc_id)
      || deriveSignalDocId({
        exchange,
        symbol,
        tf,
        barCloseMs: d.bar_close_time_utc_ms,
        event: d.event,
        signalId: resolvedSignalId,
      })
      || ""
    ).trim() || null;
    if (!resolvedSignalId && String(resolvedSignalDocId || "").startsWith("SIG__")) {
      resolvedSignalId = resolvedSignalDocId;
    }
    const liveExecPolicyTrace = extractLiveExecutionPolicyTrace(d.features_json || d.features || {});
    const rawResolvedReason = d.decision_reason || decisionReason || d.reason || d.drop_reason_code || null;
    const resolvedReason = deriveEffectiveDropReason({
      resolvedReason: rawResolvedReason,
      liveExecPolicyTrace,
    });
    const resolvedReasonFamily = deriveReasonFamily(d.reason_family || d.drop_reason_code || resolvedReason);
    const canonicalEventId = String(
      d.canonical_event_id
      || deriveCanonicalEventId({ exchange, symbol, tf, barCloseMs: d.bar_close_time_utc_ms, event: d.event, side: d.side })
      || ""
    ).trim() || null;

    const payload = {
      drop_id: id,
      ...buildEventEnvelope({
        requestId: d.request_id || requestId || null,
        runId: d.run_id || runId || (d.features_json && d.features_json.run_id) || (d.features && d.features.run_id) || null,
        signalId: resolvedSignalId,
        intentId: d.intent_id || null,
        event: d.event || null,
        exchange,
        symbol,
        tf,
        decisionReason: resolvedReason,
        action: d.event_intent || null,
        intent: d.event_intent || null,
        executionMode: d.execution_mode
          || (d.meta && d.meta.execution_mode)
          || (d.features_json && d.features_json.execution_mode)
          || (d.features && d.features.execution_mode)
          || null,
        source: resolvedSource,
        reasonFamily: resolvedReasonFamily,
        authority: "SERVER",
        barCloseMs: d.bar_close_time_utc_ms,
        createdAt: now,
      }),
      exchange: String(exchange || "").toUpperCase(),
      symbol_or_pair_id: String(symbol || ""),
      tf: String(tf || ""),
      bar_close_time_utc_ms: Number(d.bar_close_time_utc_ms || 0) || null,
      event: d.event || null,
      side: d.side || null,
      qty_pct: Number.isFinite(Number(d.qty_pct)) ? Number(d.qty_pct) : null,
      reason: resolvedReason || d.reason || "DROP_FILTER",
      decision_reason: resolvedReason,
      reason_family: resolvedReasonFamily,
      features_json: regimeMeta.features,
      execution_mode: normalizeExecutionMode(
        d.execution_mode ||
        (d.meta && d.meta.execution_mode) ||
        (d.features_json && d.features_json.execution_mode) ||
        (d.features && d.features.execution_mode)
      ),
      request_id: d.request_id || requestId || null,
      run_id: d.run_id || runId || (d.features_json && d.features_json.run_id) || (d.features && d.features.run_id) || null,
      event_group: group,
      event_subtype: subtype,
      drop_key: d.drop_key || null,
      drop_reason_code: resolvedReason || d.drop_reason_code || null,
      drop_reason_code_raw: d.drop_reason_code || null,
      decision_reason_raw: rawResolvedReason,
      signal_id: resolvedSignalId || null,
      signal_doc_id: resolvedSignalDocId || null,
      canonical_event_id: canonicalEventId,
      event_intent: d.event_intent || null,
      mapping_ok: d.mapping_ok === true,
      mapping_version: d.mapping_version || null,
      source: resolvedSource,
      source_authority: "SERVER",
      regime: regimeMeta.regime,
      market_regime: regimeMeta.market_regime,
      regime_source: regimeMeta.regime_source,
      ...toLiveExecutionPolicyTopLevel(liveExecPolicyTrace),
      created_at: now,
      updated_at: now,
    };
    normalizedDrops.push(payload);
    return db.collection("signals_dropped").doc(id).set(payload, { merge: true });
  });

  await Promise.allSettled(writes);
  const confirmations = normalizedDrops
    .filter((payload) => shouldConfirmSelfEvolutionFromDrop(payload))
    .map((payload) =>
      confirmSelfEvolutionRuntimeSignal({
        signalId: payload.signal_id || null,
        createdAt: payload.created_at || now,
        event: payload.event || null,
        strategyId: pickDropStrategyId(payload),
        updatedBy: "webhook_drop_signal_confirm",
      })
    );
  if (confirmations.length) {
    await Promise.allSettled(confirmations);
  }
  const alerts = normalizedDrops.map((d) =>
    sendSignalDroppedAlert({
      exchange: d.exchange,
      symbol: d.symbol_or_pair_id,
      tf: d.tf,
      event: d.event,
      side: d.side,
      qtyPct: d.qty_pct,
      reason: d.reason,
      dropReasonCode: d.drop_reason_code,
      signalId: d.signal_id,
      executionMode: d.execution_mode,
      source: d.source || "SERVER",
      authoritative: true,
      dropGroup: d.event_group,
      dropSubtype: d.event_subtype,
    })
  );
  await Promise.allSettled(alerts);
  return { ok: true, written: writes.length };
}

module.exports = {
  recordSignalDrops,
  __test: {
    pickDropStrategyId,
    shouldConfirmSelfEvolutionFromDrop,
    deriveReasonFamily,
    deriveCanonicalEventId,
    deriveEffectiveDropReason,
  },
};
