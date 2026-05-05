"use strict";

const { isSimplifiedExitV2Active, DEFAULT_TP1_TARGET_PCT } = require("./simplifiedExitV2");

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toUpper(value, fallback = null) {
  const text = String(value || "").trim().toUpperCase();
  return text || fallback;
}

function resolveExecutionMode(snapshot = null) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const meta = source.meta && typeof source.meta === "object" ? source.meta : {};
  return toUpper(
    source.execution_mode
      || source.executionMode
      || meta.execution_mode
      || meta.executionMode,
    null
  );
}

function clamp01(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return 0;
  if (num >= 1) return 1;
  return num;
}

function normalizeSnapshot(snapshot = {}) {
  const meta = (snapshot && typeof snapshot.meta === "object") ? snapshot.meta : {};
  const state = toUpper(snapshot.state || snapshot.position_state, "FLAT");
  const positionState = toUpper(snapshot.position_state, state);
  const sizePct = toNum(snapshot.size_pct);
  const qtyBase = toNum(snapshot.qty_base);
  return {
    state,
    position_state: positionState,
    execution_mode: toUpper(snapshot.execution_mode || snapshot.executionMode || meta.execution_mode || meta.executionMode, null),
    size_pct: sizePct,
    qty_base: qtyBase,
    position_side: toUpper(snapshot.position_side || meta.position_side, null),
    entry_qty_base: snapshot.entry_qty_base == null
      ? (
        meta.entry_qty_base == null
          ? (meta.entry_qty_abs == null ? null : toNum(meta.entry_qty_abs))
          : toNum(meta.entry_qty_base)
      )
      : toNum(snapshot.entry_qty_base),
    tp_p0_done: meta.tp_p0_done === true || snapshot.tpP0Done === true,
    tp_p1_done: meta.tp_p1_done === true || snapshot.tpP1Done === true,
    trail_active: meta.trail_active === true || snapshot.trailActive === true,
    meta,
  };
}

const ALLOWED_POSITION_STATE_TRANSITIONS = Object.freeze({
  UNKNOWN: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  FLAT: new Set(["FLAT", "PROBE", "COMMIT"]),
  PROBE: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  COMMIT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
  SCALE_OUT: new Set(["FLAT", "PROBE", "COMMIT", "SCALE_OUT"]),
});

function normalizeExitStage(value) {
  const upper = toUpper(value, "OTHER");
  if (!upper) return "OTHER";
  if (upper === "TP0" || upper === "TP1" || upper === "TRAIL" || upper === "SL") return upper;
  if (upper === "FORCE_EXIT_ALL" || upper === "FORCE_EXIT_HALF") return upper;
  if (upper === "OTHER_EXIT" || upper === "OTHER") return upper;
  return upper;
}

function normalizeTransitionEvent(value) {
  return toUpper(value, null);
}

function isSimplifiedExitV2Enabled({
  simplifiedExitV2Enabled = null,
  positionSnapshot = null,
} = {}) {
  if (simplifiedExitV2Enabled === true) return true;
  if (simplifiedExitV2Enabled === false) return false;
  const snapshot = positionSnapshot && typeof positionSnapshot === "object" ? positionSnapshot : {};
  return isSimplifiedExitV2Active(snapshot);
}

function isTp0RetiredRuntime({
  simplifiedExitV2Enabled = null,
  positionSnapshot = null,
} = {}) {
  const snapshot = positionSnapshot && typeof positionSnapshot === "object" ? positionSnapshot : {};
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  if (simplifiedExitV2Enabled === true) return true;
  if (snapshot.simplified_exit_v2_enabled === true || snapshot.simplifiedExitV2Enabled === true) return true;
  if (meta.simplified_exit_v2_enabled === true || meta.simplifiedExitV2Enabled === true) return true;
  const mode = resolveExecutionMode(snapshot);
  return mode === "LIVE" || mode === "LIVE_DRY_RUN" || mode === "PAPER";
}

function inferSimplifiedExitV2EnabledFromRules(rules = null) {
  const source = rules && typeof rules === "object" ? rules : {};
  const contractMode = toUpper(source.exit_contract_mode || source.EXIT_CONTRACT_MODE, null);
  if (contractMode === "TP_FULL_ONLY") return true;
  const tp1Qty = toNum(source.TP_P1_QTY ?? source.tp_p1_qty_ratio);
  if (Number.isFinite(tp1Qty)) {
    if (tp1Qty >= 0.999999) return true;
    if (tp1Qty > 0 && tp1Qty < 0.999999) return false;
  }
  const trailR = toNum(source.TRAIL_R_MULTIPLE ?? source.trail_r_multiple);
  const trailPct = toNum(source.TRAIL_PCT ?? source.trail_pct);
  const runnerMin = toNum(source.RUNNER_MIN_PROFIT_PCT ?? source.runner_min_profit_pct);
  const beEnabled = source.BE_ENABLE === true || source.be_enable === true;
  if ((Number.isFinite(trailR) && trailR > 0)
    || (Number.isFinite(trailPct) && trailPct > 0)
    || (Number.isFinite(runnerMin) && runnerMin > 0)
    || beEnabled) {
    return false;
  }
  return null;
}

function toBoolFlag(value) {
  if (value === true || value === false) return value;
  if (value == null || value === "") return null;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return null;
}

function resolveExplicitSimplifiedExitV2FlagFromSnapshot(positionSnapshot = null) {
  const snapshot = positionSnapshot && typeof positionSnapshot === "object" ? positionSnapshot : {};
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  const direct = toBoolFlag(snapshot.simplified_exit_v2_enabled ?? snapshot.simplifiedExitV2Enabled);
  if (direct !== null) return direct;
  const fromMeta = toBoolFlag(meta.simplified_exit_v2_enabled ?? meta.simplifiedExitV2Enabled);
  if (fromMeta !== null) return fromMeta;
  return null;
}

function resolveSimplifiedExitV2Decision({
  simplifiedExitV2Enabled = null,
  positionSnapshot = null,
  rules = null,
} = {}) {
  const explicit = simplifiedExitV2Enabled == null
    ? resolveExplicitSimplifiedExitV2FlagFromSnapshot(positionSnapshot)
    : simplifiedExitV2Enabled;
  const inferred = explicit == null
    ? inferSimplifiedExitV2EnabledFromRules(rules)
    : explicit;
  return isSimplifiedExitV2Enabled({
    simplifiedExitV2Enabled: inferred,
    positionSnapshot,
  });
}

function resolveFullTpOnlyDecision({
  positionSnapshot = null,
  rules = null,
} = {}) {
  const r = rules && typeof rules === "object" ? rules : {};
  const snapshot = positionSnapshot && typeof positionSnapshot === "object" ? positionSnapshot : {};
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  const overrideRules = meta.exit_rules_override && typeof meta.exit_rules_override === "object"
    ? meta.exit_rules_override
    : {};
  const mode = toUpper(
    r.exit_contract_mode
    || r.exitContractMode
    || snapshot.exit_contract_mode
    || snapshot.exitContractMode
    || meta.exit_contract_mode
    || meta.exitContractMode
    || overrideRules.exit_contract_mode
    || overrideRules.exitContractMode,
    null
  );
  if (mode === "TP_FULL_ONLY") return true;
  const qtyRatio = toNum(
    r.TP_P1_QTY
    ?? r.tp1_qty_ratio
    ?? snapshot.TP_P1_QTY
    ?? snapshot.tp1_qty_ratio
    ?? snapshot.tpP1QtyRatio
    ?? meta.TP_P1_QTY
    ?? meta.tp1_qty_ratio
    ?? meta.native_protection_tp_qty_ratio
    ?? overrideRules.TP_P1_QTY
    ?? overrideRules.tp1_qty_ratio
  );
  return Number.isFinite(qtyRatio) && qtyRatio >= 0.999999;
}

function trimPctToken(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 1000) / 1000;
  const asInt = Math.round(rounded);
  if (Math.abs(rounded - asInt) < 1e-9) return String(asInt);
  return String(rounded).replace(/\.?0+$/, "");
}

function ratioToPctToken(rawRatio) {
  const n = Number(rawRatio);
  if (!Number.isFinite(n)) return null;
  return trimPctToken(Math.abs(n) * 100);
}

// 2026-04-18 P2-2 (audit re-verified): legacy TP0 events flowing into
// `classifyExitEventStage` are silently remapped to the TP1 stage. That
// made "TP0 event was observed" impossible to see at the live namespace
// layer — callers downstream receive only "stage=TP1". The legacy
// canonical transition / backfill scripts depend on this remap so we
// keep `classifyExitEventStage` untouched (regression guard: the exact
// mapping was in place before the 2026-02 simplified-exit v2 cutover and
// still anchors historical records). `classifyExitEventStageLiveNamespace`
// preserves TP0 as "TP0" so live-flow code can classify, log, or reject
// it explicitly. A per-run counter + recent-set surfaces occurrences.
const legacyTp0LiveNamespaceObservations = {
  count: 0,
  recentEvents: [],
  recentSymbols: [],
};
function recordLegacyTp0LiveNamespaceObservation({ event = null, symbol = null } = {}) {
  legacyTp0LiveNamespaceObservations.count += 1;
  const ev = toUpper(event, null);
  if (ev && legacyTp0LiveNamespaceObservations.recentEvents.indexOf(ev) === -1) {
    legacyTp0LiveNamespaceObservations.recentEvents.push(ev);
    if (legacyTp0LiveNamespaceObservations.recentEvents.length > 16) {
      legacyTp0LiveNamespaceObservations.recentEvents.shift();
    }
  }
  const sym = toUpper(symbol, null);
  if (sym && legacyTp0LiveNamespaceObservations.recentSymbols.indexOf(sym) === -1) {
    legacyTp0LiveNamespaceObservations.recentSymbols.push(sym);
    if (legacyTp0LiveNamespaceObservations.recentSymbols.length > 16) {
      legacyTp0LiveNamespaceObservations.recentSymbols.shift();
    }
  }
  try {
    console.warn("[LEGACY_PARTIAL_TP_LIVE_NAMESPACE]", JSON.stringify({
      event: "legacy_partial_tp_event_observed_in_live_namespace",
      exit_event: ev,
      symbol: sym,
    }));
  } catch (_) { /* never let diagnostic kill the caller */ }
}
function getLegacyTp0LiveNamespaceObservations() {
  return {
    count: legacyTp0LiveNamespaceObservations.count,
    recentEvents: legacyTp0LiveNamespaceObservations.recentEvents.slice(),
    recentSymbols: legacyTp0LiveNamespaceObservations.recentSymbols.slice(),
  };
}
function resetLegacyTp0LiveNamespaceObservationsForTest() {
  legacyTp0LiveNamespaceObservations.count = 0;
  legacyTp0LiveNamespaceObservations.recentEvents.length = 0;
  legacyTp0LiveNamespaceObservations.recentSymbols.length = 0;
}

function classifyExitEventStage(event) {
  const ev = toUpper(event, null);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) return "TP1";
  if (ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TP_FULL") || ev.startsWith("EXIT_TP_C")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return null;
}

// 2026-04-18 P2-2 (audit re-verified): live-namespace-aware variant of
// `classifyExitEventStage` that preserves TP0 so the live flow can tell
// a true TP0 event apart from a TP1 event. When `observe` is true
// (default), every time a legacy TP0 event is seen we bump a counter
// and emit a structured warn — this lets ops quantify how often the
// legacy TP0 path still fires in production without flipping the
// behavior of backfill scripts that depend on the old remap.
function classifyExitEventStageLiveNamespace(event, { observe = true, symbol = null } = {}) {
  const ev = toUpper(event, null);
  if (!ev) return null;
  if (ev.startsWith("EXIT_TP_P0")) {
    if (observe) recordLegacyTp0LiveNamespaceObservation({ event: ev, symbol });
    return "TP0";
  }
  if (ev.startsWith("EXIT_TP_P1") || ev.startsWith("EXIT_TP_FULL") || ev.startsWith("EXIT_TP_C")) return "TP1";
  if (ev.startsWith("EXIT_TRAIL")) return "TRAIL";
  if (ev.startsWith("EXIT_SL")) return "SL";
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") return "FORCE_EXIT_ALL";
  if (ev === "FORCE_EXIT_HALF") return "FORCE_EXIT_HALF";
  if (ev.startsWith("EXIT_")) return "OTHER_EXIT";
  return null;
}

function requiresCanonicalExitEntryLineage({
  currentStage = null,
  event = null,
} = {}) {
  const stage = normalizeExitStage(currentStage || classifyExitEventStage(event));
  return stage === "TP0" || stage === "TP1" || stage === "TRAIL";
}

// 2026-04-28 senior audit Step 19 — `rules && rules.TP_P1` evaluates to
// `null` when rules is undefined/null, and `ratioToPctToken(null)`
// returns "0" because `Number(null) === 0`. The previous renderer
// emitted `EXIT_TP_P1_0P` for any caller that didn't supply rules
// (notably scripts/backfill-canonical-exit-transitions.js and
// scripts/backfill-canonical-exit-fill-metadata.js). A 0% TP1 trigger
// is not a meaningful contract — it confused operators reading the
// canonical-exit ledger and broke `EXIT_TP_P1_0P` substring checks.
// The local helper drops "0" / null / non-positive tokens so the
// renderer falls back to the bare `EXIT_TP_P1` / `EXIT_SL` / `EXIT_TRAIL`
// names when no positive percent is available.
function nonZeroPctToken(rawRatio) {
  const n = Number(rawRatio);
  if (!Number.isFinite(n) || n === 0) return null;
  return ratioToPctToken(rawRatio);
}

function buildCanonicalExitEvent({
  stage = null,
  rules = null,
  fallbackEvent = null,
  simplifiedExitV2Enabled = null,
  positionSnapshot = null,
} = {}) {
  const resolvedStage = normalizeExitStage(stage);
  const fallback = toUpper(fallbackEvent, null);
  if (resolvedStage === "TP0" || resolvedStage === "TP1") {
    const simplifiedV2 = resolveSimplifiedExitV2Decision({
      simplifiedExitV2Enabled,
      positionSnapshot,
      rules,
    });
    const rawTp1 = toNum(rules && rules.TP_P1);
    const fallbackIsLegacyV2Tp1 = simplifiedV2 === true && /^EXIT_TP_P1_1\.65P$/.test(fallback || "");
    const fallbackIsRetiredTp0 = simplifiedV2 === true && /^EXIT_TP_P0_/.test(fallback || "");
    const fullTpOnly = resolveFullTpOnlyDecision({ positionSnapshot, rules });
    const effectiveTp1 = (
      simplifiedV2 === true &&
      (
        (Number.isFinite(rawTp1) && Math.abs(rawTp1 - 0.0165) <= 1e-9) ||
        ((!Number.isFinite(rawTp1) || rawTp1 === 0) && (fallbackIsLegacyV2Tp1 || fallbackIsRetiredTp0))
      )
    )
      ? DEFAULT_TP1_TARGET_PCT
      : rawTp1;
    const token = nonZeroPctToken(effectiveTp1);
    if (fallback && fallback.startsWith("EXIT_TP_FULL")) return fallback;
    if (fullTpOnly) return token ? `EXIT_TP_FULL_${token}P` : "EXIT_TP_FULL";
    if (fallback && !fallbackIsLegacyV2Tp1 && (fallback.startsWith("EXIT_TP_P1") || fallback.startsWith("EXIT_TP_C"))) return fallback;
    return token ? `EXIT_TP_P1_${token}P` : "EXIT_TP_P1";
  }
  if (resolvedStage === "TRAIL") {
    const fullTpOnly = resolveFullTpOnlyDecision({ positionSnapshot, rules });
    if (fullTpOnly) {
      return fallback && fallback.startsWith("EXIT_TP_FULL")
        ? fallback
        : "EXIT_EXTERNAL_SYNC";
    }
    if (fallback && fallback.startsWith("EXIT_TRAIL")) return fallback;
    const trailR = toNum(rules && rules.TRAIL_R_MULTIPLE);
    if (Number.isFinite(trailR) && trailR > 0) return "EXIT_TRAIL";
    const token = nonZeroPctToken(rules && rules.TRAIL_PCT);
    return token ? `EXIT_TRAIL_${token}P` : "EXIT_TRAIL";
  }
  if (resolvedStage === "SL") {
    const token = nonZeroPctToken(rules && rules.SL);
    if (fallback && fallback.startsWith("EXIT_SL")) return fallback;
    return token ? `EXIT_SL_${token}P` : "EXIT_SL";
  }
  if (resolvedStage === "FORCE_EXIT_ALL" || resolvedStage === "FORCE_EXIT_HALF") return resolvedStage;
  return fallback;
}

function inferSimplifiedV2RunnerStage(snapshot = {}) {
  const meta = snapshot && typeof snapshot.meta === "object" ? snapshot.meta : {};
  const rules = meta.exit_rules_override && typeof meta.exit_rules_override === "object"
    ? meta.exit_rules_override
    : {};
  const entryQtyAbs = toNum(snapshot.entry_qty_base)
    ?? toNum(meta.entry_qty_base)
    ?? toNum(meta.entry_qty_abs);
  const currentQtyAbs = toNum(snapshot.qty_base);
  const tp1Ratio = resolveExitStageAbsoluteContractQtyRatio("TP1", rules, {
    simplifiedExitV2Enabled: true,
    positionSnapshot: snapshot,
  }) ?? 1;
  if (!(Number.isFinite(entryQtyAbs) && entryQtyAbs > 0 && Number.isFinite(currentQtyAbs) && currentQtyAbs > 0)) {
    return null;
  }
  const expectedRunnerQtyAbs = entryQtyAbs * Math.max(0, 1 - tp1Ratio);
  if (!(Number.isFinite(expectedRunnerQtyAbs) && expectedRunnerQtyAbs > 0)) return null;
  const tolerance = Math.max(1e-8, expectedRunnerQtyAbs * 0.05);
  if (Math.abs(currentQtyAbs - expectedRunnerQtyAbs) > tolerance) return null;
  return {
    stage: "TRAIL",
    source: "POSITION_STATE_MACHINE_V2_RUNNER_QTY",
    entry_qty_abs: entryQtyAbs,
    current_qty_abs: currentQtyAbs,
    expected_runner_qty_abs: expectedRunnerQtyAbs,
  };
}

function resolveExitStageAbsoluteContractQtyRatio(stage, rules = {}, options = {}) {
  const currentStage = normalizeExitStage(stage);
  const simplifiedV2 = isSimplifiedExitV2Enabled(options);
  if (currentStage === "TP0") return simplifiedV2 ? 0 : clamp01(toNum(rules.TP_P0_QTY) ?? 0.25);
  if (currentStage === "TP1") {
    if (simplifiedV2) return clamp01(toNum(rules.TP_P1_QTY) ?? 1);
    const tp0 = clamp01(toNum(rules.TP_P0_QTY) ?? 0.25) ?? 0.25;
    const tp1Remaining = clamp01(toNum(rules.TP_P1_QTY) ?? 0.5) ?? 0.5;
    return clamp01(tp1Remaining * Math.max(0, 1 - tp0));
  }
  return null;
}

// Canonical chain-key builder. Returns a plain string for backward
// compatibility; the P3-03 telemetry uses the `resolveCanonicalExitChainKey`
// variant below which also reports the "confidence" of the identifier.
function buildCanonicalExitChainKey({
  exchange,
  symbol,
  currentStage = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
} = {}) {
  return resolveCanonicalExitChainKey({
    exchange,
    symbol,
    currentStage,
    entryEventId,
    signalDocId,
    orderMeta,
  }).chainKey;
}

// P3-03 chainKey confidence telemetry.
// The chain-key fallback cascade is:
//   ENTRY   — bound to entry_event_id (strongest; unique per cycle)
//   SIGNAL  — bound to signal_doc_id (shared by a re-submitted signal)
//   ORDER   — bound to exchange orderId (shared if Binance re-uses an id)
//   CLIENT  — bound to our clientOrderId (misnaming can collide)
//   STAGE   — pure fallback (exchange+symbol+stage only; collides across cycles)
// Anything below ENTRY means the ledger is accounting without a unique cycle
// identifier and its cap can leak across re-submissions. Callers that observe
// `confidence !== "ENTRY"` should surface telemetry so ops can escalate.
const CANONICAL_CHAIN_KEY_CONFIDENCE = Object.freeze({
  ENTRY: "ENTRY",
  SIGNAL: "SIGNAL",
  ORDER: "ORDER",
  CLIENT: "CLIENT",
  STAGE: "STAGE",
});

function resolveCanonicalExitChainKey({
  exchange,
  symbol,
  currentStage = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
} = {}) {
  const ex = toUpper(exchange, "UNKNOWN");
  const sym = toUpper(symbol, "UNKNOWN");
  const stage = normalizeExitStage(currentStage);
  const entryKey = String(entryEventId || "").trim();
  if (entryKey) {
    return { chainKey: `${ex}__${sym}__ENTRY__${entryKey}`, confidence: "ENTRY", source_token: entryKey };
  }
  const signalKey = String(signalDocId || "").trim();
  if (signalKey) {
    return { chainKey: `${ex}__${sym}__SIGNAL__${signalKey}`, confidence: "SIGNAL", source_token: signalKey };
  }
  const rawOrderId = orderMeta && orderMeta.orderId != null ? orderMeta.orderId : null;
  const orderId = rawOrderId == null ? NaN : Number(rawOrderId);
  if (Number.isFinite(orderId)) {
    return { chainKey: `${ex}__${sym}__ORDER__${orderId}`, confidence: "ORDER", source_token: String(orderId) };
  }
  const clientOrderId = String(orderMeta && orderMeta.clientOrderId || "").trim();
  if (clientOrderId) {
    return { chainKey: `${ex}__${sym}__CLIENT__${clientOrderId}`, confidence: "CLIENT", source_token: clientOrderId };
  }
  return { chainKey: `${ex}__${sym}__STAGE__${stage}`, confidence: "STAGE", source_token: stage };
}

function normalizeAuthorityState(state = {}) {
  return {
    tp0: Math.max(0, toNum(state.tp0) ?? 0),
    tp1: Math.max(0, toNum(state.tp1) ?? 0),
    trail: Math.max(0, toNum(state.trail) ?? 0),
    sl: Math.max(0, toNum(state.sl) ?? 0),
    forceExitAll: Math.max(0, toNum(state.forceExitAll) ?? 0),
    forceExitHalf: Math.max(0, toNum(state.forceExitHalf) ?? 0),
    otherExit: Math.max(0, toNum(state.otherExit) ?? 0),
    total: Math.max(0, toNum(state.total) ?? 0),
  };
}

function buildExitQuantityContractLedger({
  positionSnapshot = null,
  authorityState = null,
  rules = null,
  simplifiedExitV2Enabled = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const state = normalizeAuthorityState(authorityState || {});
  const simplifiedV2 = resolveSimplifiedExitV2Decision({
    simplifiedExitV2Enabled,
    positionSnapshot: snapshot,
    rules,
  });
  const tp0AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP0", rules || {}, {
    simplifiedExitV2Enabled: simplifiedV2,
    positionSnapshot: snapshot,
  }) ?? 0;
  const tp1AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", rules || {}, {
    simplifiedExitV2Enabled: simplifiedV2,
    positionSnapshot: snapshot,
  }) ?? (simplifiedV2 ? 1 : 0.375);
  const tp0ConsumedRatio = simplifiedV2
    ? 0
    : (clamp01(Math.max(
        state.tp0,
        snapshot.tp_p0_done ? tp0AllowedRatio : 0
      )) ?? 0);
  const tp1ConsumedRatio = clamp01(Math.max(
    state.tp1,
    snapshot.tp_p1_done ? tp1AllowedRatio : 0
  )) ?? 0;
  const trailConsumedRatio = clamp01(state.trail) ?? 0;
  const lowerBoundTotal = tp0ConsumedRatio + tp1ConsumedRatio + trailConsumedRatio;
  const totalConsumedRatio = clamp01(Math.max(state.total, lowerBoundTotal)) ?? 0;
  const runnerAllowedRatio = clamp01(1 - Math.min(1, tp0AllowedRatio + tp1AllowedRatio)) ?? 0;
  const runnerRemainingRatio = clamp01(1 - Math.min(1, tp0ConsumedRatio + tp1ConsumedRatio + trailConsumedRatio)) ?? 0;
  const currentQtyAbs = snapshot.qty_base == null ? null : toNum(snapshot.qty_base);
  let entryQtyAbs = snapshot.entry_qty_base == null ? null : toNum(snapshot.entry_qty_base);
  if (!Number.isFinite(entryQtyAbs) && Number.isFinite(currentQtyAbs) && currentQtyAbs > 0) {
    if (runnerRemainingRatio > 0.000001) {
      entryQtyAbs = currentQtyAbs / runnerRemainingRatio;
    } else if (snapshot.trail_active !== true && snapshot.tp_p1_done !== true && (simplifiedV2 || snapshot.tp_p0_done !== true)) {
      entryQtyAbs = currentQtyAbs;
    }
  }
  return {
    entry_qty_abs: entryQtyAbs,
    entry_qty_ratio: 1,
    tp0_allowed_ratio: tp0AllowedRatio,
    tp0_consumed_ratio: tp0ConsumedRatio,
    tp1_allowed_ratio: tp1AllowedRatio,
    tp1_consumed_ratio: tp1ConsumedRatio,
    runner_allowed_ratio: runnerAllowedRatio,
    trail_consumed_ratio: trailConsumedRatio,
    total_consumed_ratio: totalConsumedRatio,
    runner_remaining_ratio: runnerRemainingRatio,
    tp0_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0AllowedRatio : null,
    tp0_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp0ConsumedRatio : null,
    tp1_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1AllowedRatio : null,
    tp1_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * tp1ConsumedRatio : null,
    runner_allowed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * runnerAllowedRatio : null,
    trail_consumed_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * trailConsumedRatio : null,
    runner_remaining_abs: Number.isFinite(entryQtyAbs) ? entryQtyAbs * runnerRemainingRatio : null,
  };
}

function validateExitQuantityContractLedger({
  ledger = null,
  positionSnapshot = null,
} = {}) {
  const source = ledger && typeof ledger === "object" ? ledger : {};
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const issues = [];
  const tp0AllowedRatio = toNum(source.tp0_allowed_ratio);
  const tp1AllowedRatio = toNum(source.tp1_allowed_ratio);
  const runnerAllowedRatio = toNum(source.runner_allowed_ratio);
  const tp0ConsumedRatio = toNum(source.tp0_consumed_ratio);
  const tp1ConsumedRatio = toNum(source.tp1_consumed_ratio);
  const trailConsumedRatio = toNum(source.trail_consumed_ratio);
  const totalConsumedRatio = toNum(source.total_consumed_ratio);
  const runnerRemainingRatio = toNum(source.runner_remaining_ratio);
  const entryQtyAbs = toNum(source.entry_qty_abs);
  const tp0AllowedAbs = toNum(source.tp0_allowed_abs);
  const tp0ConsumedAbs = toNum(source.tp0_consumed_abs);
  const tp1AllowedAbs = toNum(source.tp1_allowed_abs);
  const tp1ConsumedAbs = toNum(source.tp1_consumed_abs);
  const runnerAllowedAbs = toNum(source.runner_allowed_abs);
  const trailConsumedAbs = toNum(source.trail_consumed_abs);
  const totalConsumedAbs = Number.isFinite(entryQtyAbs) && Number.isFinite(totalConsumedRatio)
    ? entryQtyAbs * totalConsumedRatio
    : null;
  const currentQtyAbs = toNum(snapshot.qty_base);
  const runnerRemainingAbs = toNum(source.runner_remaining_abs);
  const hasExposure = (
    (Number.isFinite(snapshot.size_pct) && snapshot.size_pct > 0)
    || (Number.isFinite(snapshot.qty_base) && snapshot.qty_base > 0)
  );
  const ratioTolerance = 0.03;
  const absTolerance = Number.isFinite(entryQtyAbs)
    ? Math.max(Math.abs(entryQtyAbs) * 0.03, 1e-8)
    : 1e-8;

  if (hasExposure && !Number.isFinite(entryQtyAbs)) {
    issues.push({
      code: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "ENTRY_QTY_ABS_REQUIRED"
        : "ENTRY_QTY_ABS_MISSING",
      severity: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "critical"
        : "warn",
      message: snapshot.tp_p0_done === true || snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "Absolute qty contract cannot be audited after TP milestones without entry_qty_abs."
        : "Active exposure is missing entry_qty_abs, so absolute contract auditing is degraded.",
    });
  }

  const allowedRatioTotal = [
    tp0AllowedRatio,
    tp1AllowedRatio,
    runnerAllowedRatio,
  ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  if (Number.isFinite(allowedRatioTotal) && Math.abs(allowedRatioTotal - 1) > ratioTolerance) {
    issues.push({
      code: "EXIT_ALLOWED_RATIO_SUM_MISMATCH",
      severity: "critical",
      message: `tp0/tp1/runner allowed ratios must sum to 1. observed=${allowedRatioTotal}`,
    });
  }
  if (
    Number.isFinite(tp0AllowedRatio)
    && Number.isFinite(tp0ConsumedRatio)
    && tp0ConsumedRatio > (tp0AllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TP0_CONSUMED_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp0 consumed ratio exceeded allowed contract. consumed=${tp0ConsumedRatio} allowed=${tp0AllowedRatio}`,
    });
  }
  if (
    Number.isFinite(tp1AllowedRatio)
    && Number.isFinite(tp1ConsumedRatio)
    && tp1ConsumedRatio > (tp1AllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TP1_CONSUMED_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp1 consumed ratio exceeded allowed contract. consumed=${tp1ConsumedRatio} allowed=${tp1AllowedRatio}`,
    });
  }
  if (
    Number.isFinite(runnerAllowedRatio)
    && Number.isFinite(trailConsumedRatio)
    && trailConsumedRatio > (runnerAllowedRatio + ratioTolerance)
  ) {
    issues.push({
      code: "TRAIL_CONSUMED_EXCEEDS_RUNNER",
      severity: "critical",
      message: `trail consumed ratio exceeded runner contract. consumed=${trailConsumedRatio} allowed=${runnerAllowedRatio}`,
    });
  }
  if (Number.isFinite(totalConsumedRatio) && totalConsumedRatio > (1 + ratioTolerance)) {
    issues.push({
      code: "EXIT_TOTAL_CONSUMED_EXCEEDS_ENTRY",
      severity: "critical",
      message: `total consumed ratio cannot exceed 1. observed=${totalConsumedRatio}`,
    });
  }
  if (
    Number.isFinite(totalConsumedRatio)
    && Number.isFinite(runnerRemainingRatio)
    && Math.abs((totalConsumedRatio + runnerRemainingRatio) - 1) > ratioTolerance
  ) {
    issues.push({
      code: "RUNNER_REMAINING_MISMATCH",
      severity: "critical",
      message: `runner remaining ratio must complement total consumed ratio. observed=${totalConsumedRatio + runnerRemainingRatio}`,
    });
  }
  if (
    hasExposure
    && Number.isFinite(currentQtyAbs)
    && Number.isFinite(runnerRemainingAbs)
    && runnerRemainingAbs > 0
  ) {
    const qtyTolerance = Math.max(Math.abs(runnerRemainingAbs) * 0.03, 1e-8);
    if (Math.abs(currentQtyAbs - runnerRemainingAbs) > qtyTolerance) {
      issues.push({
        code: "RUNNER_REMAINING_QTY_MISMATCH",
        severity: "critical",
        message: `current qty must match runner remaining abs. qty=${currentQtyAbs} runner_remaining=${runnerRemainingAbs}`,
      });
    }
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(tp0AllowedAbs)
    && Number.isFinite(tp1AllowedAbs)
    && Number.isFinite(runnerAllowedAbs)
    && Math.abs((tp0AllowedAbs + tp1AllowedAbs + runnerAllowedAbs) - entryQtyAbs) > absTolerance
  ) {
    issues.push({
      code: "EXIT_ALLOWED_ABS_SUM_MISMATCH",
      severity: "critical",
      message: `tp0/tp1/runner allowed abs must sum to entry_qty_abs. observed=${tp0AllowedAbs + tp1AllowedAbs + runnerAllowedAbs} entry=${entryQtyAbs}`,
    });
  }
  if (
    Number.isFinite(tp0AllowedAbs)
    && Number.isFinite(tp0ConsumedAbs)
    && tp0ConsumedAbs > (tp0AllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TP0_CONSUMED_ABS_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp0 consumed abs exceeded allowed contract. consumed=${tp0ConsumedAbs} allowed=${tp0AllowedAbs}`,
    });
  }
  if (
    Number.isFinite(tp1AllowedAbs)
    && Number.isFinite(tp1ConsumedAbs)
    && tp1ConsumedAbs > (tp1AllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TP1_CONSUMED_ABS_EXCEEDS_ALLOWED",
      severity: "critical",
      message: `tp1 consumed abs exceeded allowed contract. consumed=${tp1ConsumedAbs} allowed=${tp1AllowedAbs}`,
    });
  }
  if (
    Number.isFinite(runnerAllowedAbs)
    && Number.isFinite(trailConsumedAbs)
    && trailConsumedAbs > (runnerAllowedAbs + absTolerance)
  ) {
    issues.push({
      code: "TRAIL_CONSUMED_ABS_EXCEEDS_RUNNER",
      severity: "critical",
      message: `trail consumed abs exceeded runner contract. consumed=${trailConsumedAbs} allowed=${runnerAllowedAbs}`,
    });
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(totalConsumedAbs)
    && totalConsumedAbs > (entryQtyAbs + absTolerance)
  ) {
    issues.push({
      code: "EXIT_TOTAL_CONSUMED_ABS_EXCEEDS_ENTRY",
      severity: "critical",
      message: `total consumed abs cannot exceed entry qty. consumed=${totalConsumedAbs} entry=${entryQtyAbs}`,
    });
  }
  if (
    Number.isFinite(entryQtyAbs)
    && Number.isFinite(totalConsumedAbs)
    && Number.isFinite(runnerRemainingAbs)
    && Math.abs((totalConsumedAbs + runnerRemainingAbs) - entryQtyAbs) > absTolerance
  ) {
    issues.push({
      code: "RUNNER_REMAINING_ABS_MISMATCH",
      severity: "critical",
      message: `runner remaining abs must complement consumed abs. observed=${totalConsumedAbs + runnerRemainingAbs} entry=${entryQtyAbs}`,
    });
  }
  if (Number.isFinite(runnerRemainingRatio) && runnerRemainingRatio < -ratioTolerance) {
    issues.push({
      code: "RUNNER_REMAINING_NEGATIVE",
      severity: "critical",
      message: `runner remaining ratio cannot be negative. observed=${runnerRemainingRatio}`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    blocked: issues.some((issue) => issue.severity === "critical"),
  };
}

function resolveCanonicalExitTransitionEvents({
  resolvedStage,
  positionSnapshot = null,
  recentStages = null,
  ledger = null,
  observedQtyRatio = null,
  fullExit = false,
  simplifiedExitV2Enabled = null,
  rules = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const stage = normalizeExitStage(resolvedStage);
  const simplifiedV2 = isSimplifiedExitV2Enabled({
    simplifiedExitV2Enabled,
    positionSnapshot: positionSnapshot || {},
  });
  const tp0RetiredRuntime = isTp0RetiredRuntime({
    simplifiedExitV2Enabled,
    positionSnapshot: positionSnapshot || {},
  });
  const recent = recentStages && typeof recentStages === "object" ? recentStages : {};
  const events = [];
  const effectiveStage = tp0RetiredRuntime && stage === "TP0" ? "TP1" : stage;
  const fullTpOnly = resolveFullTpOnlyDecision({ positionSnapshot: snapshot, rules });
  if (effectiveStage === "TP1") {
    if (snapshot.tp_p1_done !== true || (simplifiedV2 && fullExit === true)) {
      events.push(simplifiedV2 ? "TP1_FULL_EXIT" : "TP1_REACHED");
    }
    if (!simplifiedV2 && snapshot.trail_active !== true) events.push("TRAIL_ACTIVE");
  } else if (effectiveStage === "TRAIL") {
    if (simplifiedV2 || fullTpOnly) {
      if (fullExit === true) events.push("EXTERNAL_CLOSE_SYNC");
      return {
        transitionEvents: events,
        primaryTransitionEvent: events.length ? events[events.length - 1] : null,
      };
    }
    const recentTrail = normalizeExitStage(recent.trail) === "TRAIL";
    if (snapshot.trail_active !== true && !recentTrail) events.push(simplifiedV2 ? "TRAIL_ACTIVATED" : "TRAIL_ACTIVE");
    const observed = clamp01(observedQtyRatio);
    const remaining = ledger && Number.isFinite(Number(ledger.runner_remaining_ratio))
      ? Number(ledger.runner_remaining_ratio)
      : null;
    const likelyFinal = fullExit === true
      || (Number.isFinite(observed) && Number.isFinite(remaining) && observed >= Math.max(0, remaining - 0.03));
    events.push(simplifiedV2 ? "TRAIL_FINAL_EXIT" : (likelyFinal ? "TRAIL_FINAL_EXIT" : "TRAIL_PARTIAL"));
  } else if (effectiveStage === "SL") {
    events.push("SL_HIT");
  } else if (effectiveStage === "OTHER_EXIT" || effectiveStage === "OTHER") {
    if (fullExit === true) events.push("EXTERNAL_CLOSE_SYNC");
  }
  let primaryTransitionEvent = events.length ? events[events.length - 1] : null;
  if (effectiveStage === "TP1" && (events.includes("TP1_FULL_EXIT") || events.includes("TP1_REACHED"))) {
    primaryTransitionEvent = events.includes("TP1_FULL_EXIT") ? "TP1_FULL_EXIT" : "TP1_REACHED";
  }
  return {
    transitionEvents: events,
    primaryTransitionEvent,
  };
}

function resolveCanonicalAlertExitStage({
  primaryTransitionEvent = null,
  transitionEvents = null,
  fallbackStage = null,
} = {}) {
  const events = Array.isArray(transitionEvents)
    ? transitionEvents.map((item) => normalizeTransitionEvent(item)).filter(Boolean)
    : [];
  const primary = normalizeTransitionEvent(primaryTransitionEvent);
  const ordered = primary ? [primary, ...events.filter((item) => item !== primary)] : events;

  if (ordered.includes("TRAIL_FINAL_EXIT") || ordered.includes("TRAIL_PARTIAL")) return "TRAIL";
  if (ordered.includes("TP1_FULL_EXIT")) return "TP1";
  if (ordered.includes("TP1_REACHED")) return "TP1";
  if (ordered.includes("TP0_REACHED")) return "TP1";
  if (ordered.includes("TRAIL_ACTIVE") || ordered.includes("TRAIL_ACTIVATED")) return "TRAIL";
  return null;
}

// C17 single-reader contract: prefer `canonical_exit_stage` and fall back to
// the legacy `authoritative_exit_stage` only for in-flight positions written
// before the dual-owner cleanup. All new writers must only populate
// `canonical_exit_stage` on position meta.
function resolveStoredCanonicalExitStage(meta = null) {
  const source = meta && typeof meta === "object" ? meta : {};
  const canonical = normalizeExitStage(source.canonical_exit_stage);
  if (canonical && canonical !== "OTHER" && canonical !== "OTHER_EXIT") return canonical;
  const legacy = normalizeExitStage(source.authoritative_exit_stage);
  if (legacy && legacy !== "OTHER" && legacy !== "OTHER_EXIT") return legacy;
  return null;
}

function resolveCanonicalPositionExitStage({
  positionSnapshot = null,
  fallbackStage = null,
  simplifiedExitV2Enabled = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const meta = snapshot.meta && typeof snapshot.meta === "object" ? snapshot.meta : {};
  const simplifiedV2 = isSimplifiedExitV2Enabled({
    simplifiedExitV2Enabled,
    positionSnapshot: positionSnapshot || {},
  });
  const tp0RetiredRuntime = isTp0RetiredRuntime({
    simplifiedExitV2Enabled,
    positionSnapshot: positionSnapshot || {},
  });
  const fallback = normalizeExitStage(
    fallbackStage
    || meta.authoritative_exit_stage
    || meta.canonical_exit_stage
  );
  const fullTpOnly = resolveFullTpOnlyDecision({
    positionSnapshot: positionSnapshot || {},
    rules: meta.exit_rules_override && typeof meta.exit_rules_override === "object"
      ? meta.exit_rules_override
      : null,
  });
  const hasExposure = (
    (Number.isFinite(snapshot.size_pct) && snapshot.size_pct > 0)
    || (Number.isFinite(snapshot.qty_base) && snapshot.qty_base > 0)
  );
  if (fullTpOnly && hasExposure && (snapshot.trail_active === true || snapshot.tp_p1_done === true)) {
    return {
      stage: null,
      source: "POSITION_STATE_MACHINE_TP_FULL_ONLY_ACTIVE_MILESTONE_SUPPRESSED",
    };
  }
  if (snapshot.trail_active === true && simplifiedV2 === true) {
    return {
      stage: snapshot.tp_p1_done === true ? "TP1" : null,
      source: "POSITION_STATE_MACHINE_TP_FULL_ONLY_TRAIL_SUPPRESSED",
    };
  }
  if (snapshot.trail_active === true) {
    return {
      stage: "TRAIL",
      source: "POSITION_STATE_MACHINE_TRAIL_ACTIVE",
    };
  }
  if (snapshot.tp_p1_done === true) {
    return {
      stage: "TP1",
      source: "POSITION_STATE_MACHINE_TP1_DONE",
    };
  }
  if (tp0RetiredRuntime) {
    const inferredRunnerStage = simplifiedV2 === true ? null : inferSimplifiedV2RunnerStage(snapshot);
    if (inferredRunnerStage) return inferredRunnerStage;
    if (snapshot.tp_p0_done === true) {
      return {
        stage: null,
        source: simplifiedV2 ? "POSITION_STATE_MACHINE_V2_PRE_TP1" : "POSITION_STATE_MACHINE_TP0_RETIRED_PRE_TP1",
      };
    }
    if (fallback === "TP0") {
      return {
        stage: null,
        source: simplifiedV2 ? "POSITION_STATE_MACHINE_V2_FALLBACK_SUPPRESSED" : "POSITION_STATE_MACHINE_TP0_RETIRED_FALLBACK_SUPPRESSED",
      };
    }
  }
  if (fallback && fallback !== "OTHER" && fallback !== "OTHER_EXIT") {
    return { stage: fallback, source: "POSITION_STATE_MACHINE_CANONICAL_META" };
  }
  return { stage: null, source: null };
}

function resolveCanonicalExitStageFromCycleEvidence({
  cycleTrades = null,
  positionQty = null,
  tp0QtyRatio = 0.25,
  tp1QtyRatio = 1,
  simplifiedExitV2Enabled = null,
} = {}) {
  const simplifiedV2 = simplifiedExitV2Enabled === true;
  if (!Array.isArray(cycleTrades) || cycleTrades.length === 0) {
    return { stage: "UNKNOWN", reason: "CYCLE_EMPTY" };
  }
  const entries = cycleTrades.filter((trade) => Number(trade && trade.signedQty) > 0);
  const exits = cycleTrades.filter((trade) => Number(trade && trade.signedQty) < 0);
  const totalEntryQty = entries.reduce((sum, trade) => sum + (toNum(trade && trade.qty) || 0), 0);
  const remainingQty = toNum(positionQty);
  if (!Number.isFinite(totalEntryQty) || totalEntryQty <= 0 || !Number.isFinite(remainingQty) || remainingQty <= 0) {
    return { stage: "UNKNOWN", reason: "QTY_INVALID" };
  }
  const remainingRatio = remainingQty / totalEntryQty;
  const tp0RemainingRatio = simplifiedV2 ? 1 : Math.max(0, 1 - (toNum(tp0QtyRatio) ?? 0.25));
  const tp1AbsRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", {
    TP_P0_QTY: tp0QtyRatio,
    TP_P1_QTY: tp1QtyRatio,
  }, {
    simplifiedExitV2Enabled: simplifiedV2,
  }) ?? (simplifiedV2 ? 1 : 0.375);
  const trailRemainingRatio = Math.max(0, 1 - ((simplifiedV2 ? 0 : (toNum(tp0QtyRatio) ?? 0.25)) + tp1AbsRatio));
  if (simplifiedV2 && exits.length >= 1 && Math.abs(remainingRatio - trailRemainingRatio) <= 0.04) {
    return { stage: "TRAIL", entries, exits, totalEntryQty, remainingQty, remainingRatio, expectedAfterTp1: trailRemainingRatio };
  }
  if (exits.length >= 2 && Math.abs(remainingRatio - trailRemainingRatio) <= 0.04) {
    return { stage: "TRAIL", entries, exits, totalEntryQty, remainingQty, remainingRatio, expectedAfterTp1: trailRemainingRatio };
  }
  if (exits.length >= 1 && Math.abs(remainingRatio - tp0RemainingRatio) <= 0.04) {
    return { stage: "TP0", entries, exits, totalEntryQty, remainingQty, remainingRatio, expectedAfterTp0: tp0RemainingRatio };
  }
  return {
    stage: "UNKNOWN",
    entries,
    exits,
    totalEntryQty,
    remainingQty,
    remainingRatio,
    expectedAfterTp0: tp0RemainingRatio,
    expectedAfterTp1: trailRemainingRatio,
  };
}

function resolveCanonicalExitWritePayload({
  exchange,
  symbol,
  event = null,
  currentStage = null,
  chainKey = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  positionSnapshot = null,
  authorityState = null,
  recentStages = null,
  rules = null,
  observedQtyRatio = null,
  fullExit = false,
} = {}) {
  const rawEvent = toUpper(event, null);
  const rawStage = normalizeExitStage(currentStage || classifyExitEventStage(rawEvent));
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const explicitSimplifiedV2 = resolveExplicitSimplifiedExitV2FlagFromSnapshot(snapshot);
  let simplifiedV2 = resolveSimplifiedExitV2Decision({
    positionSnapshot: snapshot,
    rules,
  });
  const rawEventIsTp0 = /^EXIT_TP_P0_?/.test(rawEvent || "");
  if ((rawStage === "TP0" || rawEventIsTp0) && explicitSimplifiedV2 == null && simplifiedV2 !== true) {
    // TP0 is retired in the V2 live namespace. Legacy 50% rules can still be
    // attached to old metadata, but an observed TP0 event without an explicit
    // legacy flag must be normalized to the current TP_FULL contract.
    simplifiedV2 = isSimplifiedExitV2Enabled({ positionSnapshot: snapshot });
  }
  const decision = resolveCanonicalExitAuthorityDecision({
    exchange,
    symbol,
    currentStage: rawStage,
    chainKey,
    entryEventId,
    signalDocId,
    orderMeta,
    positionSnapshot,
    authorityState,
    recentStages,
    rules,
    observedQtyRatio,
    fullExit,
    simplifiedExitV2Enabled: simplifiedV2,
  });
  return {
    rawEvent,
    rawStage,
    event: decision.entryLineageMissing === true
      ? null
      : (buildCanonicalExitEvent({
          stage: decision.stage,
          rules,
          simplifiedExitV2Enabled: simplifiedV2,
          positionSnapshot: snapshot,
          fallbackEvent: decision.stage === rawStage ? rawEvent : null,
        }) || rawEvent),
    stage: decision.stage,
    chainKey: decision.chainKey,
    reason: decision.reason,
    stageRelocked: decision.stageRelocked === true,
    ledgerBlockedInvariant: decision.ledgerBlockedInvariant === true,
    blockedInvariant: decision.blockedInvariant === true,
    entryLineageRequired: decision.entryLineageRequired === true,
    entryLineageMissing: decision.entryLineageMissing === true,
    ledger: decision.ledger || null,
    ledgerValidation: decision.ledgerValidation || null,
    transitionEvents: Array.isArray(decision.transitionEvents) ? decision.transitionEvents : [],
    primaryTransitionEvent: decision.primaryTransitionEvent || null,
  };
}

function resolveCanonicalExitAuthorityDecision({
  exchange,
  symbol,
  currentStage = null,
  chainKey = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  positionSnapshot = null,
  authorityState = null,
  recentStages = null,
  rules = null,
  observedQtyRatio = null,
  fullExit = false,
  simplifiedExitV2Enabled = null,
} = {}) {
  const snapshot = normalizeSnapshot(positionSnapshot || {});
  const stage = normalizeExitStage(currentStage);
  const simplifiedV2 = resolveSimplifiedExitV2Decision({
    simplifiedExitV2Enabled,
    positionSnapshot: snapshot,
    rules,
  });
  const tp0RetiredRuntime = isTp0RetiredRuntime({
    simplifiedExitV2Enabled: simplifiedV2,
    positionSnapshot: snapshot,
  });
  const entryLineageRequired = requiresCanonicalExitEntryLineage({ currentStage: stage });
  const entryLineageMissing = entryLineageRequired && !String(entryEventId || "").trim();
  const resolvedChainKey = String(chainKey || "").trim() || buildCanonicalExitChainKey({
    exchange,
    symbol,
    currentStage: stage,
    entryEventId,
    signalDocId,
    orderMeta,
  });
  const ledger = buildExitQuantityContractLedger({
    positionSnapshot: snapshot,
    authorityState,
    rules,
    simplifiedExitV2Enabled: simplifiedV2,
  });
  const ledgerValidation = validateExitQuantityContractLedger({
    ledger,
    positionSnapshot: snapshot,
  });
  const recent = recentStages && typeof recentStages === "object" ? recentStages : {};
  const recentTrail = normalizeExitStage(recent.trail) === "TRAIL";
  const recentTp0 = tp0RetiredRuntime ? false : (normalizeExitStage(recent.tp0) === "TP0");
  const tp0AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP0", rules || {}, {
    simplifiedExitV2Enabled: simplifiedV2,
    positionSnapshot: snapshot,
  }) ?? 0;
  const tp1AllowedRatio = resolveExitStageAbsoluteContractQtyRatio("TP1", rules || {}, {
    simplifiedExitV2Enabled: simplifiedV2,
    positionSnapshot: snapshot,
  }) ?? (simplifiedV2 ? 1 : 0.375);
  const tp0Locked = tp0RetiredRuntime
    ? false
    : (Number(ledger.tp0_consumed_ratio || 0) >= Math.max(0, tp0AllowedRatio - 0.03));
  const tp1Locked = Number(ledger.tp1_consumed_ratio || 0) >= Math.max(0, tp1AllowedRatio - 0.03);
  const postTp1Locked = snapshot.tp_p1_done === true || snapshot.trail_active === true || tp1Locked || recentTrail;
  let resolvedStage = tp0RetiredRuntime && stage === "TP0" ? "TP1" : stage;
  let reason = "PASS_THROUGH";

  if (entryLineageMissing) {
    resolvedStage = null;
    reason = "ENTRY_LINEAGE_REQUIRED";
  } else if ((stage === "TP0" || stage === "TP1") || (tp0RetiredRuntime && resolvedStage === "TP1")) {
    if (postTp1Locked && simplifiedV2 !== true) {
      resolvedStage = "TRAIL";
      reason = snapshot.tp_p1_done === true || snapshot.trail_active === true
        ? "POST_TP1_STAGE_LOCK"
        : "AUTHORITY_TP1_LOCKED";
    } else if (postTp1Locked && simplifiedV2 === true) {
      resolvedStage = "TP1";
      reason = "TP_FULL_ONLY_POST_TP1_LOCK";
    } else if (tp0RetiredRuntime && stage === "TP0") {
      reason = simplifiedV2 ? "V2_TP0_REMAPPED_TO_TP1" : "TP0_RETIRED_RUNTIME_REMAPPED_TO_TP1";
    } else if (stage === "TP0" && (snapshot.tp_p0_done === true || tp0Locked || recentTp0)) {
      resolvedStage = "TP1";
      reason = "POST_TP0_STAGE_LOCK";
    }
  }

  const stageRelocked = entryLineageMissing !== true && resolvedStage !== stage && reason !== "PASS_THROUGH";
  const ledgerBlockedInvariant = ledgerValidation.blocked === true;
  const transition = entryLineageMissing || ledgerBlockedInvariant
    ? { transitionEvents: [], primaryTransitionEvent: null }
    : resolveCanonicalExitTransitionEvents({
      resolvedStage,
      positionSnapshot: snapshot,
      recentStages: recent,
      ledger,
      observedQtyRatio,
      fullExit,
      rules,
    });

  return {
    chainKey: resolvedChainKey,
    currentStage: stage,
    stage: resolvedStage,
    reason,
    stageRelocked,
    ledgerBlockedInvariant,
    blockedInvariant: stageRelocked || ledgerBlockedInvariant || entryLineageMissing,
    entryLineageRequired,
    entryLineageMissing,
    ledger,
    ledgerValidation,
    transitionEvents: transition.transitionEvents,
    primaryTransitionEvent: transition.primaryTransitionEvent,
  };
}

// C13 helper: detect a same-symbol direction flip (LONG ↔ SHORT) between two
// snapshots. A flip without a full ledger reset is a critical invariant
// violation — the previous cycle's TP/trail/SL accounting cannot be carried
// over into the opposite direction.
function detectPositionSideFlip({ prev = null, next = null } = {}) {
  const previous = normalizeSnapshot(prev || {});
  const current = normalizeSnapshot(next || {});
  const prevSide = previous.position_side;
  const nextSide = current.position_side;
  const flipped = prevSide && nextSide && prevSide !== nextSide;
  const ledgerCarried = current.tp_p0_done === true
    || current.tp_p1_done === true
    || current.trail_active === true
    || (Number.isFinite(current.entry_qty_base) && Number.isFinite(previous.entry_qty_base)
        && current.entry_qty_base > 0
        && current.entry_qty_base === previous.entry_qty_base);
  return {
    flipped: !!flipped,
    prev_side: prevSide,
    next_side: nextSide,
    ledger_carried_over: !!(flipped && ledgerCarried),
  };
}

function validatePositionSnapshotTransition({ prev = null, next = null } = {}) {
  const previous = normalizeSnapshot(prev || {});
  const current = normalizeSnapshot(next || {});
  const tp0RetiredRuntime = isTp0RetiredRuntime({ positionSnapshot: next || {} });
  const issues = [];

  const hasExposure = (Number.isFinite(current.size_pct) && current.size_pct > 0)
    || (Number.isFinite(current.qty_base) && current.qty_base > 0);

  if (current.state === "FLAT" && hasExposure) {
    issues.push({
      code: "FLAT_WITH_EXPOSURE",
      severity: "critical",
      message: "FLAT state cannot retain positive size or qty.",
    });
  }
  if (current.state !== "FLAT" && !hasExposure) {
    issues.push({
      code: "ACTIVE_WITHOUT_EXPOSURE",
      severity: "critical",
      message: "Active state requires positive size or qty.",
    });
  }
  if (current.position_state === "SCALE_OUT" && current.tp_p1_done !== true) {
    issues.push({
      code: "SCALE_OUT_WITHOUT_TP1",
      severity: "critical",
      message: "SCALE_OUT requires tp_p1_done=true.",
    });
  }
  if (tp0RetiredRuntime !== true && current.tp_p1_done === true && current.tp_p0_done !== true) {
    issues.push({
      code: "TP1_WITHOUT_TP0",
      severity: "critical",
      message: "tp_p1_done=true requires tp_p0_done=true.",
    });
  }
  if (current.trail_active === true && current.tp_p1_done !== true) {
    issues.push({
      code: "TRAIL_WITHOUT_TP1",
      severity: "critical",
      message: "trail_active requires tp_p1_done=true.",
    });
  }
  const fullTpOnly = resolveFullTpOnlyDecision({
    positionSnapshot: next || {},
    rules: current.meta && current.meta.exit_rules_override && typeof current.meta.exit_rules_override === "object"
      ? current.meta.exit_rules_override
      : null,
  });
  if (fullTpOnly && current.trail_active === true) {
    issues.push({
      code: "TP_FULL_ONLY_TRAIL_STATE",
      severity: "critical",
      message: "TP_FULL_ONLY positions cannot carry trail_active=true; TP_FULL exits are terminal and have no runner.",
    });
  }
  if (tp0RetiredRuntime !== true && current.trail_active === true && current.tp_p0_done !== true) {
    issues.push({
      code: "TRAIL_WITHOUT_TP0",
      severity: "critical",
      message: "trail_active=true requires tp_p0_done=true.",
    });
  }

  // C13 invariant: LONG→SHORT (or SHORT→LONG) flip requires the caller to
  // *completely* reset the exit ledger before writing the next snapshot.
  // Carrying over tp_p0/tp_p1/trail flags into the opposite direction would
  // apply the previous cycle's consumed contract against a brand-new entry.
  const sideFlip = detectPositionSideFlip({ prev, next });
  if (sideFlip.flipped && sideFlip.ledger_carried_over) {
    issues.push({
      code: "SIDE_FLIP_WITHOUT_LEDGER_RESET",
      severity: "critical",
      message: `position side flipped from ${sideFlip.prev_side} to ${sideFlip.next_side} but exit ledger flags/entry_qty were carried over.`,
    });
  }

  const fromState = previous.position_state || "UNKNOWN";
  const toState = current.position_state || "UNKNOWN";
  const allowed = ALLOWED_POSITION_STATE_TRANSITIONS[fromState] || ALLOWED_POSITION_STATE_TRANSITIONS.UNKNOWN;
  if (!allowed.has(toState)) {
    issues.push({
      code: "POSITION_STATE_TRANSITION_UNDECLARED",
      severity: "warn",
      message: `${fromState} -> ${toState} is outside the declared transition table.`,
    });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    issues,
    prev: previous,
    next: current,
    side_flip: sideFlip,
  };
}

module.exports = {
  validatePositionSnapshotTransition,
  detectPositionSideFlip,
  resolveCanonicalExitAuthorityDecision,
  resolveCanonicalExitTransitionEvents,
  resolveCanonicalAlertExitStage,
  resolveCanonicalPositionExitStage,
  resolveCanonicalExitStageFromCycleEvidence,
  resolveCanonicalExitWritePayload,
  buildExitQuantityContractLedger,
  validateExitQuantityContractLedger,
  buildCanonicalExitChainKey,
  resolveCanonicalExitChainKey,
  CANONICAL_CHAIN_KEY_CONFIDENCE,
  buildCanonicalExitEvent,
  classifyExitEventStage,
  classifyExitEventStageLiveNamespace,
  getLegacyTp0LiveNamespaceObservations,
  resetLegacyTp0LiveNamespaceObservationsForTest,
  resolveStoredCanonicalExitStage,
  resolveFullTpOnlyDecision,
  __test: {
    normalizeSnapshot,
    normalizeExitStage,
    normalizeTransitionEvent,
    detectPositionSideFlip,
    resolveExitStageAbsoluteContractQtyRatio,
    resolveCanonicalExitAuthorityDecision,
    resolveCanonicalExitTransitionEvents,
    resolveCanonicalAlertExitStage,
    resolveCanonicalPositionExitStage,
    resolveCanonicalExitStageFromCycleEvidence,
    resolveCanonicalExitWritePayload,
    buildExitQuantityContractLedger,
    validateExitQuantityContractLedger,
    buildCanonicalExitChainKey,
    resolveCanonicalExitChainKey,
    CANONICAL_CHAIN_KEY_CONFIDENCE,
    buildCanonicalExitEvent,
    classifyExitEventStage,
    resolveStoredCanonicalExitStage,
    resolveFullTpOnlyDecision,
    requiresCanonicalExitEntryLineage,
    isSimplifiedExitV2Enabled,
    ALLOWED_POSITION_STATE_TRANSITIONS,
  },
};
