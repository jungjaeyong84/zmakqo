"use strict";

const fs = require("fs");
const path = require("path");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { prepareTradeAlertOutbox, markTradeAlertOutboxResult } = require("../storage/tradeAlertOutbox");
const { sendAlert } = require("../utils/alerts");
const { resolveEventMapping } = require("./signalStandard");
const { resolveCanonicalAlertExitStage } = require("./positionStateMachine");
const { isSimplifiedExitV2Active } = require("./simplifiedExitV2");
const { canonicalExternalEntryEvent, resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");
// 2026-04-30 Step 2 — sibling consolidation. The
// normalizeTpP1EventForExchange helper was previously inlined here;
// canonicalised in src/utils/signalTypeNormalization.js (P1-1.8
// commit 11760325) and migrated here. Production-equivalent across
// the 4 historical variants — see canonical module header.
const { normalizeTpP1EventForExchange } = require("../utils/signalTypeNormalization");

const channelCache = new Map();
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TRADE_ALERT_AUDIT_PATH = path.join(REPO_ROOT, "ops", "runtime", "trade_execution_alert_audit.jsonl");

function toBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function normalizeExchange(exchange) {
  const ex = String(exchange || "").trim().toUpperCase();
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

// 2026-04-30 Step 2 — local normalizeTpP1EventForExchange removed;
// imported from ../utils/signalTypeNormalization at the top of this
// file. The local normalizeExchange() helper is kept because it is
// used by 9 other call sites in this file (isAllowedExchange,
// payload-event resolution, etc.) — only the TpP1-event variant is
// consolidated here.

function parseList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isAllowedExchange(exchange) {
  const allowRaw = String(process.env.TRADE_ALERT_EXCHANGES || "BINANCEFUT");
  const allow = parseList(allowRaw).map((x) => normalizeExchange(x));
  if (!allow.length) return true;
  return allow.includes(normalizeExchange(exchange));
}

function isAllowedFailureExchange(exchange) {
  const allowRaw = String(process.env.TRADE_FAILURE_ALERT_EXCHANGES || process.env.TRADE_ALERT_EXCHANGES || "BINANCEFUT");
  const allow = parseList(allowRaw).map((x) => normalizeExchange(x));
  if (!allow.length) return true;
  return allow.includes(normalizeExchange(exchange));
}

function resolveIntent({ intent, event } = {}) {
  const ev = String(event || "").trim().toUpperCase();
  if (
    ev.startsWith("EXIT_")
    || ev === "FORCE_EXIT_ALL"
    || ev === "FORCE_EXIT_HALF"
    || ev === "EXIT_ALL"
    || ev === "EXIT_FORCE_ALL"
  ) return "EXIT";
  const rawIntent = String(intent || "").trim().toUpperCase();
  if (rawIntent === "ENTRY" || rawIntent === "ADD" || rawIntent === "EXIT") return rawIntent;
  if (ev === "ENTRY_LONG" || ev === "ENTRY_SHORT" || ev.startsWith("ENTRY_")) return "ENTRY";
  if (ev === "LONG" || ev === "SHORT") return "ENTRY";
  if (ev.startsWith("CORE_") || ev.startsWith("EARLY_")) return "ENTRY";
  return null;
}

function normalizeDirection(value) {
  const v = String(value || "").trim().toUpperCase();
  if (v === "LONG" || v === "SHORT") return v;
  return null;
}

function directionFromSide(side, exchange) {
  const s = String(side || "").trim().toUpperCase();
  const ex = normalizeExchange(exchange);
  if (s === "LONG" || s === "SHORT") return s;
  if (s === "BUY") return "LONG";
  if (s === "SELL") return ex.includes("BINANCE") ? "SHORT" : "LONG";
  return null;
}

function directionFromEvent(event) {
  const mapping = resolveEventMapping({ event });
  if (mapping.side === "BUY") return "LONG";
  if (mapping.side === "SELL") return "SHORT";
  return null;
}

function resolveDirection({ intent, positionSideBefore, positionSideAfter, event, side, exchange } = {}) {
  const eventDirection = directionFromEvent(event);
  const beforeDirection = normalizeDirection(positionSideBefore);
  const afterDirection = normalizeDirection(positionSideAfter);
  const sideDirection = directionFromSide(side, exchange);

  if (intent === "ENTRY" || intent === "ADD") {
    return eventDirection || afterDirection || beforeDirection || sideDirection;
  }
  if (intent === "EXIT") {
    return beforeDirection || afterDirection || eventDirection || sideDirection;
  }
  return eventDirection || beforeDirection || afterDirection || sideDirection;
}

function formatMoney(value, { unit = "USDT", signed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const digits = String(unit).toUpperCase() === "KRW" ? 0 : (abs >= 100 ? 2 : 3);
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (!signed) return text;
  const sign = n > 0 ? "+" : (n < 0 ? "-" : "");
  return `${sign}${text}`;
}

function formatPercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const pct = Math.max(0, Math.min(100, n * 100));
  const digits = pct >= 10 ? 0 : 1;
  return `${pct.toFixed(digits)}%`;
}

function formatLeverage(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}x`;
}

function formatBaseQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const abs = Math.abs(n);
  const digits = abs >= 100 ? 2 : (abs >= 1 ? 3 : 6);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function resolveExitContractLedgerLines(payload = {}) {
  const lines = [];
  const simplifiedV2 = isSimplifiedExitV2Enabled(payload);
  const observed = Number(payload.contractObservedQtyAbs);
  const entry = Number(payload.contractEntryQtyAbs);
  const tp0Allowed = Number(payload.contractTp0AllowedAbs);
  const tp1Allowed = Number(payload.contractTp1AllowedAbs);
  const runnerRemaining = Number(payload.contractRunnerRemainingAbs);
  if (Number.isFinite(observed) && observed > 0) {
    lines.push(`체결수량(base): ${formatBaseQty(observed)}`);
  }
  const contractParts = [];
  if (Number.isFinite(entry) && entry > 0) contractParts.push(`ENTRY ${formatBaseQty(entry)}`);
  if (Number.isFinite(tp1Allowed) && tp1Allowed > 0) contractParts.push(`TP1 ${formatBaseQty(tp1Allowed)}`);
  if (Number.isFinite(runnerRemaining) && runnerRemaining >= 0) contractParts.push(`RUNNER ${formatBaseQty(runnerRemaining)}`);
  if (contractParts.length) {
    lines.push(`계약수량(base): ${contractParts.join(" / ")}`);
  }
  return lines;
}

function resolveBaseAssetSymbol(symbol) {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) return null;
  if (raw.startsWith("KRW-")) return raw.slice(4) || null;
  for (const suffix of ["USDT", "FDUSD", "BUSD", "USDC", "BTC", "ETH"]) {
    if (raw.endsWith(suffix) && raw.length > suffix.length) {
      return raw.slice(0, -suffix.length) || null;
    }
  }
  return raw;
}

function resolveEntryQtyBase(payload = {}, execPrice = null, notional = null) {
  const explicit = Number(payload.execQtyBase ?? payload.qtyBase);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const px = Number(execPrice);
  const q = Number(notional);
  if (Number.isFinite(px) && px > 0 && Number.isFinite(q) && q > 0) return q / px;
  return null;
}

function trimPctToken(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 1000) / 1000;
  const asInt = Math.round(rounded);
  if (Math.abs(rounded - asInt) < 1e-9) return String(asInt);
  return String(rounded).replace(/\.?0+$/, "");
}

function ratioToPctToken(rawRatio, { abs = false } = {}) {
  const n = Number(rawRatio);
  if (!Number.isFinite(n)) return null;
  const ratio = abs ? Math.abs(n) : n;
  return trimPctToken(ratio * 100);
}

function parseExitEventMeta(event, { simplifiedExitV2Enabled = false } = {}) {
  const ev = String(event || "").toUpperCase();
  let m = ev.match(/^EXIT_TP_P0_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `TP1_${m[1]}`, label: `익절(TP1) ${m[1]}%` };
  m = ev.match(/^EXIT_TP_P1_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `TP1_${m[1]}`, label: `익절(TP1) ${m[1]}%` };
  m = ev.match(/^EXIT_TP_C_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `TP1_${m[1]}`, label: `익절(TP1) ${m[1]}%` };
  m = ev.match(/^EXIT_TRAIL_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `TRAIL_${m[1]}`, label: `트레일링 ${m[1]}%` };
  m = ev.match(/^EXIT_TRAIL_([0-9]+(?:\.[0-9]+)?)R$/);
  if (m) return { token: `TRAIL_${m[1]}R`, label: `트레일링 ${m[1]}R` };
  m = ev.match(/^EXIT_SL_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `SL_${m[1]}`, label: `손절 ${m[1]}%` };
  m = ev.match(/^EXIT_BE_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `BE_${m[1]}`, label: `브레이크이븐 ${m[1]}%` };
  m = ev.match(/^EXIT_TIME_STOP_(\d+)B$/);
  if (m) return { token: `TIME_STOP_${m[1]}B`, label: `시간청산 ${m[1]}봉` };
  if (ev.startsWith("EXIT_TP_P0")) return { token: "TP1", label: "익절(TP1)" };
  if (ev.startsWith("EXIT_TP_P1")) return { token: "TP1", label: "익절(TP1)" };
  if (ev.startsWith("EXIT_TP_C")) return { token: "TP1", label: "익절(TP1)" };
  if (ev.startsWith("EXIT_TRAIL")) return { token: "TRAIL", label: "트레일링" };
  if (ev.startsWith("EXIT_SL")) return { token: "SL", label: "손절" };
  if (ev.startsWith("EXIT_BE")) return { token: "BE", label: "브레이크이븐" };
  if (ev === "FORCE_EXIT_ALL" || ev === "EXIT_ALL" || ev === "EXIT_FORCE_ALL") {
    return { token: "FORCE_EXIT_ALL", label: "강제 전량 청산" };
  }
  if (ev === "FORCE_EXIT_HALF") {
    return { token: "FORCE_EXIT_HALF", label: "강제 부분 청산" };
  }
  if (ev === "EXIT_OPPOSITE_SIGNAL") return { token: "OPPOSITE", label: "반대신호 청산" };
  if (ev === "EXIT_LIQUIDATION_RISK") return { token: "RISK", label: "리스크 청산" };
  if (ev === "EXIT_EXTERNAL_SYNC") return { token: "EXTERNAL_SYNC", label: "외부 동기화 청산" };
  return { token: "EXIT", label: "청산" };
}

function firstFinitePositiveRatio(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && Math.abs(num) > 0) return Math.abs(num);
  }
  return null;
}

function resolveV2Tp1TargetPctForAlert(payload = {}) {
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});
  const meta = (payload.meta && typeof payload.meta === "object") ? payload.meta : {};
  const protection = (payload.protectionRuntime && typeof payload.protectionRuntime === "object")
    ? payload.protectionRuntime
    : ((payload.protection_runtime && typeof payload.protection_runtime === "object") ? payload.protection_runtime : {});
  const explicitTarget = firstFinitePositiveRatio(
    payload.tp1TargetPct,
    payload.tp1_target_pct,
    payload.protectionTp1TargetPct,
    payload.protection_tp1_target_pct,
    payload.nativeTp1TargetPct,
    payload.native_tp1_target_pct,
    meta.tp1TargetPct,
    meta.tp1_target_pct,
    meta.tp_p1_target_pct,
    protection.tp1TargetPct,
    protection.tp1_target_pct,
    protection.tp_p1_target_pct,
    feat.tp1TargetPct,
    feat.tp1_target_pct,
    feat.tp_p1_target_pct
  );
  if (explicitTarget) return explicitTarget;

  const rules = (payload.exitRules && typeof payload.exitRules === "object")
    ? payload.exitRules
    : ((payload.exit_rules && typeof payload.exit_rules === "object") ? payload.exit_rules : null);
  const rulesTp1 = firstFinitePositiveRatio(rules && rules.TP_P1);
  // In V2 live-write the historical 1.65% TP1 token is a legacy/rescue
  // signal-engine label, not the protected-entry TP1 contract. Without this
  // guard operators see "TP1_1.65" even though native protection was placed at
  // the V2 default 2.5% leveraged-PnL target.
  if (rulesTp1 && Math.abs(rulesTp1 - 0.0165) > 1e-9) return rulesTp1;
  return 0.025;
}

function buildV2Tp1AlertMeta(payload = {}) {
  const pct = resolveV2Tp1TargetPctForAlert(payload);
  const token = ratioToPctToken(pct) || "2.5";
  return { token: `TP1_${token}`, label: `익절(TP1) ${token}%` };
}

function isSimplifiedExitV2Enabled(payload = {}) {
  if (payload.simplifiedExitV2Enabled === true || payload.simplified_exit_v2_enabled === true) return true;
  const shadow = payload.simplifiedExitV2Shadow || payload.simplified_exit_v2_shadow;
  if (shadow && typeof shadow === "object" && shadow.available === true) return true;
  if (isSimplifiedExitV2Active(payload) === true) return true;
  const exitRules = (payload.exitRules && typeof payload.exitRules === "object")
    ? payload.exitRules
    : ((payload.exit_rules && typeof payload.exit_rules === "object") ? payload.exit_rules : null);
  if (exitRules) {
    const tp0Pct = Number(exitRules.TP_P0);
    const tp0Qty = Number(exitRules.TP_P0_QTY);
    if ((Number.isFinite(tp0Pct) ? tp0Pct <= 0 : true) && (Number.isFinite(tp0Qty) ? tp0Qty <= 0 : true)) {
      return true;
    }
  }
  return false;
}

function hasExplicitSimplifiedExitV2Flag(payload = {}) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.simplifiedExitV2Enabled !== undefined || payload.simplified_exit_v2_enabled !== undefined) {
    return payload.simplifiedExitV2Enabled === true || payload.simplified_exit_v2_enabled === true;
  }
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : null;
  if (meta && (meta.simplifiedExitV2Enabled !== undefined || meta.simplified_exit_v2_enabled !== undefined)) {
    return meta.simplifiedExitV2Enabled === true || meta.simplified_exit_v2_enabled === true;
  }
  return false;
}

function isCanonicalStageExit(stage) {
  const normalized = String(stage || "").trim().toUpperCase();
  return normalized === "TP0" || normalized === "TP1" || normalized === "TRAIL";
}

function isCanonicalExitEvidenceEvent(event) {
  const raw = String(event || "").trim().toUpperCase();
  if (!raw) return false;
  return raw.startsWith("EXIT_TP_P0")
    || raw.startsWith("EXIT_TP_P1")
    || raw.startsWith("EXIT_TP_C")
    || raw.startsWith("EXIT_TRAIL");
}

function resolveRawEvidenceEvent(payload = {}, event = null) {
  const raw = String(payload.rawEvidenceEvent || payload.raw_evidence_event || event || "").trim().toUpperCase();
  return raw || null;
}

function resolveCanonicalTransitionEventList(payload = {}) {
  const allowed = new Set([
    "ENTRY_FILL",
    "ENTRY_FILLED",
    "TP0_REACHED",
    "TP1_REACHED",
    "SL_HIT",
    "TRAIL_HIT",
    "FORCE_EXIT_ALL",
    "EXTERNAL_CLOSE_SYNC",
    "TRAIL_ACTIVE",
    "TRAIL_ACTIVATED",
    "TRAIL_PARTIAL",
    "TRAIL_FINAL_EXIT",
  ]);
  const items = [];
  if (Array.isArray(payload.canonicalTransitionEvents)) {
    items.push(...payload.canonicalTransitionEvents);
  }
  if (Array.isArray(payload.canonical_transition_events)) {
    items.push(...payload.canonical_transition_events);
  }
  const primary = payload.canonicalTransitionEvent || payload.canonical_primary_transition_event;
  if (primary) items.unshift(primary);
  const seen = new Set();
  return items
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item) => {
      if (!item || seen.has(item) || !allowed.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function normalizeSimplifiedExitV2TransitionEvents(payload = {}) {
  const normalized = [];
  const seen = new Set();
  for (const item of resolveCanonicalTransitionEventList(payload)) {
    let event = item;
    if (event === "TRAIL_ACTIVE") event = "TRAIL_ACTIVATED";
    if (event === "ENTRY_FILL") event = "ENTRY_FILLED";
    if (!event || seen.has(event)) continue;
    seen.add(event);
    normalized.push(event);
  }
  // TP1 fill and trail activation can be written in the same canonical batch.
  // The executed contract is still the TP1 partial; TRAIL_ACTIVATED is the
  // post-TP1 runner protection state. If primary_transition_event is
  // TRAIL_ACTIVATED, resolveCanonicalTransitionEventList() prepends it and the
  // alert used to mislabel TP1 as TRAIL.
  if (
    normalized.includes("TP1_REACHED") &&
    normalized.includes("TRAIL_ACTIVATED") &&
    !normalized.includes("TRAIL_HIT") &&
    !normalized.includes("TRAIL_FINAL_EXIT")
  ) {
    return [
      "TP1_REACHED",
      ...normalized.filter((event) => event !== "TP1_REACHED"),
    ];
  }
  return normalized;
}

function resolveSimplifiedExitV2MetaFromTransition({
  transitionEvent = null,
  canonicalExitEvent = null,
  payload = {},
} = {}) {
  const transition = String(transitionEvent || "").trim().toUpperCase();
  const canonicalMeta = canonicalExitEvent
    ? parseExitEventMeta(canonicalExitEvent, { simplifiedExitV2Enabled: true })
    : null;
  if (transition === "TP1_REACHED") {
    return buildV2Tp1AlertMeta(payload);
  }
  if (transition === "TRAIL_ACTIVATED" || transition === "TRAIL_HIT" || transition === "TRAIL_FINAL_EXIT") {
    return canonicalMeta && String(canonicalMeta.token || "").startsWith("TRAIL")
      ? canonicalMeta
      : { token: "TRAIL", label: "트레일링" };
  }
  if (transition === "SL_HIT") {
    return canonicalMeta && String(canonicalMeta.token || "").startsWith("SL")
      ? canonicalMeta
      : { token: "SL", label: "손절" };
  }
  if (transition === "FORCE_EXIT_ALL") return { token: "FORCE_EXIT_ALL", label: "강제 전량 청산" };
  if (transition === "EXTERNAL_CLOSE_SYNC") return { token: "EXTERNAL_SYNC", label: "외부 동기화 청산" };
  return canonicalMeta;
}

function resolveSimplifiedExitV2AlertProjection(payload = {}, rawEvent = null) {
  const enabled = isSimplifiedExitV2Enabled(payload);
  const canonicalExitEvent = String(payload.canonicalExitEvent || payload.canonical_exit_event || "").trim().toUpperCase() || null;
  const rawEvidenceEvent = resolveRawEvidenceEvent(payload, rawEvent || payload.event);
  const transitionEvents = normalizeSimplifiedExitV2TransitionEvents(payload);
  const invalidTransitions = transitionEvents.filter((event) => event === "TP0_REACHED" || event === "TRAIL_PARTIAL");
  const primaryTransitionEvent = transitionEvents[0] || null;
  const meta = resolveSimplifiedExitV2MetaFromTransition({
    transitionEvent: primaryTransitionEvent,
    canonicalExitEvent,
    payload,
  });
  const stage = primaryTransitionEvent === "TP0_REACHED" || primaryTransitionEvent === "TP1_REACHED"
    ? "TP1"
    : (
      primaryTransitionEvent === "TRAIL_ACTIVATED" || primaryTransitionEvent === "TRAIL_HIT" || primaryTransitionEvent === "TRAIL_FINAL_EXIT"
        ? "TRAIL"
        : (
          primaryTransitionEvent === "SL_HIT"
            ? "SL"
            : (
              primaryTransitionEvent === "FORCE_EXIT_ALL"
                ? "FORCE_EXIT_ALL"
                : (primaryTransitionEvent === "EXTERNAL_CLOSE_SYNC" ? "EXTERNAL_SYNC" : null)
            )
        )
    );
  return {
    enabled,
    valid: enabled !== true || invalidTransitions.length === 0,
    reason: invalidTransitions.length ? "INVALID_V2_CANONICAL_TRANSITION" : null,
    invalidTransitions,
    transitionEvents,
    primaryTransitionEvent,
    canonicalExitEvent,
    rawEvidenceEvent,
    stage,
    meta,
  };
}

function normalizeResolvedCanonicalAlertStage(stage, {
  explicitCanonicalStage = null,
  canonicalTransitionEvents = [],
  primaryTransitionEvent = null,
} = {}) {
  const normalized = String(stage || "").trim().toUpperCase() || null;
  if (
    normalized === "OTHER"
    && !String(explicitCanonicalStage || "").trim()
    && !String(primaryTransitionEvent || "").trim()
    && (!Array.isArray(canonicalTransitionEvents) || canonicalTransitionEvents.length === 0)
  ) {
    return null;
  }
  return normalized;
}

function resolveCanonicalExitAlertRequirement(payload = {}, rawEvent = null) {
  const simplifiedExitV2 = resolveSimplifiedExitV2AlertProjection(payload, rawEvent || payload.event);
  const rawEvidenceEvent = resolveRawEvidenceEvent(payload, rawEvent || payload.event);
  const canonicalEvent = String(payload.canonicalExitEvent || payload.canonical_exit_event || "").trim().toUpperCase();
  const canonicalTransitionEvents = resolveCanonicalTransitionEventList(payload);
  const explicitCanonicalStage = String(payload.canonicalExitStage || payload.canonical_exit_stage || "").trim().toUpperCase() || null;
  const primaryTransitionEvent = payload.canonicalTransitionEvent || payload.canonical_primary_transition_event || null;
  const canonicalStage = resolveCanonicalAlertExitStage({
    primaryTransitionEvent,
    transitionEvents: canonicalTransitionEvents,
    fallbackStage: explicitCanonicalStage,
  });
  const effectiveStage = normalizeResolvedCanonicalAlertStage(canonicalStage, {
    explicitCanonicalStage,
    canonicalTransitionEvents,
    primaryTransitionEvent,
  }) || explicitCanonicalStage;
  const required = isCanonicalStageExit(effectiveStage)
    || isCanonicalExitEvidenceEvent(rawEvidenceEvent)
    || isCanonicalExitEvidenceEvent(canonicalEvent);
  if (simplifiedExitV2.enabled === true) {
    const requiredV2 = required || Boolean(simplifiedExitV2.primaryTransitionEvent) || Boolean(canonicalEvent);
    const satisfiedV2 = !requiredV2
      || (simplifiedExitV2.transitionEvents.length > 0 && simplifiedExitV2.valid === true);
    return {
      required: requiredV2,
      satisfied: satisfiedV2,
      reason: requiredV2 && simplifiedExitV2.valid !== true
        ? simplifiedExitV2.reason
        : (requiredV2 && simplifiedExitV2.transitionEvents.length === 0 ? "MISSING_CANONICAL_EXIT_TRANSITION" : null),
      rawEvidenceEvent,
      canonicalEvent: canonicalEvent || null,
      canonicalStage: simplifiedExitV2.stage || effectiveStage,
      canonicalTransitionEvents: simplifiedExitV2.transitionEvents,
      simplifiedExitV2,
    };
  }
  return {
    required,
    satisfied: !required || canonicalTransitionEvents.length > 0,
    reason: required && canonicalTransitionEvents.length === 0 ? "MISSING_CANONICAL_EXIT_TRANSITION" : null,
    rawEvidenceEvent,
    canonicalEvent: canonicalEvent || null,
    canonicalStage: effectiveStage,
    canonicalTransitionEvents,
  };
}

function buildGenericExitMeta(stage, { simplifiedExitV2Enabled = false } = {}) {
  if (stage === "TP0") {
    return { token: "TP1", label: "익절(TP1)" };
  }
  if (stage === "TP1") return { token: "TP1", label: "익절(TP1)" };
  if (stage === "TRAIL") return { token: "TRAIL", label: "트레일링" };
  return null;
}

function resolveEffectiveExitMeta(payload = {}, rawEvent) {
  const simplifiedExitV2 = resolveSimplifiedExitV2AlertProjection(payload, rawEvent);
  const rawEvidenceEvent = resolveRawEvidenceEvent(payload, rawEvent);
  const rawMeta = parseExitEventMeta(rawEvidenceEvent, {
    simplifiedExitV2Enabled: simplifiedExitV2.enabled === true,
  });
  const canonicalEvent = String(payload.canonicalExitEvent || payload.canonical_exit_event || "").trim().toUpperCase();
  const canonicalEventMeta = canonicalEvent
    ? parseExitEventMeta(canonicalEvent, { simplifiedExitV2Enabled: simplifiedExitV2.enabled === true })
    : null;
  const canonicalTransitionEvents = resolveCanonicalTransitionEventList(payload);
  const explicitCanonicalStage = String(payload.canonicalExitStage || payload.canonical_exit_stage || "").trim().toUpperCase() || null;
  const primaryTransitionEvent = payload.canonicalTransitionEvent || payload.canonical_primary_transition_event || null;
  const canonicalStage = resolveCanonicalAlertExitStage({
    primaryTransitionEvent,
    transitionEvents: canonicalTransitionEvents,
    fallbackStage: explicitCanonicalStage,
  });
  const effectiveCanonicalStage = normalizeResolvedCanonicalAlertStage(canonicalStage, {
    explicitCanonicalStage,
    canonicalTransitionEvents,
    primaryTransitionEvent,
  });
  const rawToken = String(rawMeta && rawMeta.token || "").trim().toUpperCase() || null;
  const canonicalToken = String(canonicalEventMeta && canonicalEventMeta.token || effectiveCanonicalStage || "").trim().toUpperCase() || null;
  const overrideApplied = (
    (!!canonicalToken && canonicalToken !== rawToken)
    || (!!canonicalEvent && canonicalEvent !== rawEvidenceEvent)
  );
  if (simplifiedExitV2.enabled === true && simplifiedExitV2.valid === true && simplifiedExitV2.primaryTransitionEvent) {
    const projectedMeta = simplifiedExitV2.meta || rawMeta;
    const projectedToken = String(projectedMeta && projectedMeta.token || simplifiedExitV2.stage || "").trim().toUpperCase() || null;
    return {
      meta: projectedMeta,
      rawMeta,
      canonicalEvent: canonicalEvent || null,
      canonicalStage: simplifiedExitV2.stage || effectiveCanonicalStage,
      rawStage: rawToken,
      rawEvidenceEvent,
      overrideApplied: !!projectedToken && projectedToken !== rawToken,
      canonicalTransitionEvents: simplifiedExitV2.transitionEvents,
      simplifiedExitV2,
    };
  }
  const meta = canonicalEventMeta
    ? canonicalEventMeta
    : (effectiveCanonicalStage && canonicalTransitionEvents.length > 0 && overrideApplied)
    ? (buildGenericExitMeta(effectiveCanonicalStage, { simplifiedExitV2Enabled: simplifiedExitV2.enabled === true }) || rawMeta)
    : rawMeta;
  return {
    meta,
    rawMeta,
    canonicalEvent: canonicalEvent || null,
    canonicalStage: effectiveCanonicalStage,
    rawStage: rawToken,
    rawEvidenceEvent,
    overrideApplied,
    canonicalTransitionEvents,
    simplifiedExitV2,
  };
}

function resolveCanonicalReclassificationLine(resolved = {}) {
  if (!resolved || resolved.overrideApplied !== true) return null;
  const rawEvidenceEvent = String(resolved.rawEvidenceEvent || "").trim().toUpperCase();
  const simplifiedV2Enabled = !!(resolved.simplifiedExitV2 && resolved.simplifiedExitV2.enabled === true);
  const rawToken = (rawEvidenceEvent.startsWith("EXIT_TP_P0"))
    ? "RAW_EVIDENCE"
    : String(resolved.rawMeta && resolved.rawMeta.token || resolved.rawStage || "").trim();
  const canonicalToken = String(resolved.meta && resolved.meta.token || resolved.canonicalStage || "").trim();
  if (!rawToken || !canonicalToken || rawToken === canonicalToken) return null;
  return `${rawToken} -> ${canonicalToken}`;
}

function normalizeCohort(value) {
  const upper = String(value || "").trim().toUpperCase();
  if (upper === "RESCUE" || upper === "MIXED" || upper === "KEEP_DROP" || upper === "HOLD_SAMPLE") return upper;
  return null;
}

function cohortLabel(cohort) {
  if (cohort === "RESCUE") return "RESCUE";
  if (cohort === "MIXED") return "MIXED";
  if (cohort === "KEEP_DROP") return "KEEP_DROP";
  if (cohort === "HOLD_SAMPLE") return "HOLD_SAMPLE";
  return null;
}

function resolveMarketRegimeLines(payload = {}, features = {}) {
  const cohort = normalizeCohort(
    payload.openclawMarketRegimeCohort
    || payload.marketRegimeCohort
    || features.openclaw_market_regime_cohort
    || features.market_regime_cohort
  );
  const verdict = String(
    payload.openclawMarketRegimeDropVerdict
    || payload.marketRegimeDropVerdict
    || features.openclaw_market_regime_drop_verdict
    || features.market_regime_drop_verdict
    || ""
  ).trim().toUpperCase();
  const lines = [];
  const cohortText = cohortLabel(cohort);
  if (cohortText) lines.push(`시장군: ${cohortText}`);
  if (verdict) lines.push(`시장판정: ${verdict}`);
  return lines;
}

function resolveExitLabel(payload = {}, exitMeta = {}) {
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});
  const reason = String(payload.reason || payload.statusReason || payload.cancelReason || feat.reason || "").trim().toUpperCase();
  const scope = String(feat.time_stop_scope || "").trim().toUpperCase();
  if (String(exitMeta.token || "").startsWith("TIME_STOP_") && (scope === "PRE_TP1" || reason === "EXIT_TIME_STOP_PRE_TP1")) {
    return `${exitMeta.label} (pre-TP1)`;
  }
  return exitMeta.label;
}

function resolveCanonicalStageLines(payload = {}, resolved = {}) {
  const lines = [];
  const canonicalStage = String(resolved.canonicalStage || "").trim().toUpperCase();
  const transitionEvents = Array.isArray(resolved.canonicalTransitionEvents)
    ? resolved.canonicalTransitionEvents
    : [];
  const reclassification = resolveCanonicalReclassificationLine(resolved);
  if (reclassification) {
    lines.push(`정본재분류: ${reclassification}`);
  }
  if (resolved.overrideApplied && canonicalStage) {
    lines.push(`정본단계: ${canonicalStage}`);
  }
  if (transitionEvents.length) {
    lines.push(`정본전이: ${transitionEvents.join(" -> ")}`);
  }
  return lines;
}

function buildExitEventFromMeta(meta = null, fallback = null) {
  const token = String(meta && meta.token || "").trim().toUpperCase();
  if (token.startsWith("TP1_")) return `EXIT_TP_P1_${token.slice(4)}P`;
  if (token === "TP1") return "EXIT_TP_P1";
  if (token.startsWith("SL_")) return `EXIT_SL_${token.slice(3)}P`;
  if (token === "SL") return "EXIT_SL";
  if (token.startsWith("TRAIL_")) return `EXIT_TRAIL_${token.slice(6)}P`;
  if (token === "TRAIL") return "EXIT_TRAIL";
  if (token.startsWith("BE_")) return `EXIT_BE_${token.slice(3)}P`;
  if (token === "EXTERNAL_SYNC") return "EXIT_EXTERNAL_SYNC";
  if (token === "FORCE_EXIT_ALL") return "FORCE_EXIT_ALL";
  return String(fallback || "").trim().toUpperCase() || null;
}

function resolveDisplayExitEventForAlert(resolved = {}, fallback = null) {
  const projected = buildExitEventFromMeta(resolved && resolved.meta, fallback);
  const raw = String(resolved && resolved.rawEvidenceEvent || fallback || "").trim().toUpperCase();
  if (
    resolved &&
    resolved.simplifiedExitV2 &&
    resolved.simplifiedExitV2.enabled === true &&
    projected
  ) {
    return projected;
  }
  return raw || projected;
}

function resolveExitIntegrityLines(payload = {}) {
  const lines = [];
  const items = Array.isArray(payload.stopDivergenceItems)
    ? payload.stopDivergenceItems
    : [];
  const divergence = items
    .map((item) => String(item && (item.display || item.code) || "").trim())
    .filter(Boolean);
  if (divergence.length) {
    lines.push(`청산경고: ${divergence.join(" / ")}`);
  }
  const chosenSource = String(payload.chosenStopSource || "").trim().toUpperCase();
  const chosenStopPrice = Number(payload.chosenStopPrice);
  const runnerFloorStop = Number(payload.runnerFloorStop);
  const trailStopByR = Number(payload.trailStopByR);
  const nativeStopPrice = Number(payload.nativeStopPrice);
  const validChosenStopPrice = Number.isFinite(chosenStopPrice) && chosenStopPrice > 0;
  const validRunnerFloorStop = Number.isFinite(runnerFloorStop) && runnerFloorStop > 0;
  const validTrailStopByR = Number.isFinite(trailStopByR) && trailStopByR > 0;
  const validNativeStopPrice = Number.isFinite(nativeStopPrice) && nativeStopPrice > 0;
  const stopParts = [];
  if (chosenSource || validChosenStopPrice) {
    stopParts.push(`chosen ${chosenSource || "-"} ${validChosenStopPrice ? formatMoney(chosenStopPrice) : "-"}`);
  }
  if (validRunnerFloorStop) stopParts.push(`floor ${formatMoney(runnerFloorStop)}`);
  if (validTrailStopByR) stopParts.push(`r ${formatMoney(trailStopByR)}`);
  if (validNativeStopPrice) stopParts.push(`native ${formatMoney(nativeStopPrice)}`);
  if (stopParts.length) {
    lines.push(`stop근거: ${stopParts.join(" / ")}`);
  }
  return lines;
}

function resolveExternalSyncContextLines(payload = {}) {
  const ev = String(payload.event || "").trim().toUpperCase();
  if (ev !== "EXIT_EXTERNAL_SYNC") return [];
  const simplifiedExitV2Enabled = isSimplifiedExitV2Enabled(payload);
  const stage = String(payload.externalSyncHintStage || "").trim().toUpperCase();
  const reason = String(
    payload.reason || payload.statusReason || payload.cancelReason || payload.decisionReason || ""
  ).trim().toUpperCase();
  const orderType = String(payload.externalSyncOrderType || "").trim().toUpperCase();
  const closePosition = payload.externalSyncClosePosition;
  const lines = [];
  if (stage === "TRAIL_AFTER_TP1") lines.push("동기화맥락: 트레일 종료 후 외부 동기화");
  else if (stage === "AFTER_TP1") lines.push("동기화맥락: TP1 이후 외부 동기화");
  else if (stage === "AFTER_TP0") lines.push("동기화맥락: 러너 진입 전 외부 동기화");
  else if (stage === "UNTRACKED_CLOSE_POSITION") lines.push("동기화맥락: 비추적 closePosition 외부 청산");
  if (reason) lines.push(`동기화사유: ${reason}`);
  if (orderType || typeof closePosition === "boolean") {
    lines.push(`동기화주문: ${orderType || "UNKNOWN"} / close_position=${typeof closePosition === "boolean" ? String(closePosition) : "NA"}`);
  }
  return lines;
}

function resolveExecutedExitContract(event) {
  const meta = parseExitEventMeta(event);
  const token = String(meta && meta.token || "").trim();
  return token || null;
}

function formatEventTag(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return "-";
  const canonicalEntry = canonicalExternalEntryEvent(ev, null);
  if (canonicalEntry) return canonicalEntry;
  return ev;
}

function formatExitRulesCompact(exitRules) {
  if (!exitRules || typeof exitRules !== "object") return null;
  const sl = ratioToPctToken(exitRules.SL, { abs: true });
  const tp1 = ratioToPctToken(exitRules.TP_P1);
  const trailR = Number(exitRules.TRAIL_R_MULTIPLE);
  const trail = Number.isFinite(trailR) && trailR > 0
    ? `${String(trailR).replace(/\.?0+$/, "")}R`
    : ratioToPctToken(exitRules.TRAIL_PCT);
  const runnerMin = ratioToPctToken(exitRules.RUNNER_MIN_PROFIT_PCT);
  const be = ratioToPctToken(exitRules.BE_PCT);
  const parts = [];
  if (sl) parts.push(`SL_${sl}`);
  if (tp1) parts.push(`TP1_${tp1}`);
  if (trail) parts.push(`TRAIL_${trail}`);
  if (runnerMin) parts.push(`RUNNER_MIN_${runnerMin}`);
  if (be) parts.push(`BE_${be}`);
  return parts.length ? parts.join(" / ") : null;
}

function resolveExitRulesForAlertDisplay(payload = {}, resolvedExitMeta = null) {
  const rules = (payload.exitRules && typeof payload.exitRules === "object")
    ? payload.exitRules
    : ((payload.exit_rules && typeof payload.exit_rules === "object") ? payload.exit_rules : null);
  if (!rules) return null;
  const explicitSimplifiedV2 = hasExplicitSimplifiedExitV2Flag(payload);
  if (!explicitSimplifiedV2) return rules;
  return {
    ...rules,
    TP_P1: resolveV2Tp1TargetPctForAlert(payload),
  };
}

function resolveSizingLines(payload = {}) {
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});
  const marketMult = Number(payload.marketBiasMult ?? feat.market_bias_mult ?? feat.ai_bias_gate_qty_scale);
  const evMult = Number(payload.evMult ?? feat.ev_mult ?? feat.ev_gate_qty_scale);
  const finalMult = Number(
    payload.finalQtyMult
      ?? feat.market_ev_final_mult
      ?? (
        (Number.isFinite(marketMult) ? marketMult : 1)
        * (Number.isFinite(evMult) ? evMult : 1)
      )
  );
  const parts = [];
  if (Number.isFinite(marketMult) && marketMult > 0 && marketMult < 0.9999) {
    parts.push(`시황 ${formatPercent(marketMult)}`);
  }
  if (Number.isFinite(evMult) && evMult > 0 && evMult < 0.9999) {
    parts.push(`EV ${formatPercent(evMult)}`);
  }
  if (!parts.length) return [];
  const lines = [`수량조정: ${parts.join(" × ")}`];
  if (Number.isFinite(finalMult) && finalMult > 0 && finalMult < 0.9999) {
    lines.push(`최종비중: ${formatPercent(finalMult)}`);
  }
  return lines;
}

function isTelegramChannel(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v.startsWith("telegram:") || v.startsWith("tg:") || v.startsWith("telegram://") || v.startsWith("tg://");
}

function filterTelegramChannels(raw) {
  const list = parseList(raw).filter(isTelegramChannel);
  return list.join(",");
}

function appendTradeExecutionAlertAudit(entry = {}) {
  try {
    fs.mkdirSync(path.dirname(TRADE_ALERT_AUDIT_PATH), { recursive: true });
    fs.appendFileSync(TRADE_ALERT_AUDIT_PATH, `${JSON.stringify({
      ts: new Date().toISOString(),
      ...entry,
    })}\n`, "utf8");
  } catch (err) {
    console.warn("[TRADE_EXEC_AUDIT_APPEND_FAIL]", err && err.message ? err.message : String(err));
  }
}

function appendTradeExecutionAlertDecisionAudit({
  type = "TRADE_EXECUTION_ALERT",
  exchange = null,
  payload = {},
  intent = null,
  executionMode = null,
  channel = null,
  title = null,
  body = null,
  ok = false,
  skipped = false,
  reason = null,
  source = null,
} = {}) {
  const canonicalTransitionEvents = resolveCanonicalTransitionEventList(payload);
  appendTradeExecutionAlertAudit({
    type,
    exchange,
    symbol: String(payload.symbol || "").toUpperCase() || null,
    event: String(payload.event || "").trim().toUpperCase() || null,
    raw_evidence_event: resolveRawEvidenceEvent(payload, payload.event),
    canonical_event: String(payload.canonicalExitEvent || payload.canonical_exit_event || "").trim().toUpperCase() || null,
    canonical_stage: String(payload.canonicalExitStage || payload.canonical_exit_stage || "").trim().toUpperCase() || null,
    canonical_transition_events: canonicalTransitionEvents,
    simplified_exit_v2_enabled: isSimplifiedExitV2Enabled(payload),
    intent,
    execution_mode: executionMode,
    channel,
    title,
    body,
    ok,
    skipped,
    reason,
    order_id: Number.isFinite(Number(payload.orderId ?? payload.order_id))
      ? Number(payload.orderId ?? payload.order_id)
      : null,
    client_order_id: String(payload.clientOrderId || payload.client_order_id || "").trim() || null,
    entry_event_id: String(payload.entryEventId || payload.entry_event_id || "").trim() || null,
    source_fill_id: String(
      payload.sourceFillId
      || payload.source_fill_id
      || payload.fillId
      || payload.fill_id
      || ""
    ).trim() || null,
    dedupe_key: resolveTradeAlertDedupeKey(payload),
    source,
  });
}

function resolveTradeAlertSourceFillId(payload = {}) {
  return String(
    payload.sourceFillId
    || payload.source_fill_id
    || payload.fillId
    || payload.fill_id
    || ""
  ).trim() || null;
}

function resolveTradeAlertReplayReason(payload = {}) {
  return String(payload.replayReason || payload.replay_reason || "").trim() || null;
}

function trimAlertIdentity(value) {
  return String(value || "").trim() || null;
}

function resolveStableEntryAlertDedupeKey(payload = {}) {
  const intent = resolveIntent(payload);
  if (intent !== "ENTRY" && intent !== "ADD") return null;
  const symbol = String(payload.symbol || payload.symbol_or_pair_id || "").trim().toUpperCase();
  if (!symbol) return null;
  const identity = trimAlertIdentity(payload.signalId)
    || trimAlertIdentity(payload.signal_id)
    || trimAlertIdentity(payload.signalIntentId)
    || trimAlertIdentity(payload.signal_intent_id)
    || trimAlertIdentity(payload.intentId)
    || trimAlertIdentity(payload.intent_id)
    || trimAlertIdentity(payload.entryEventId)
    || trimAlertIdentity(payload.entry_event_id)
    || trimAlertIdentity(payload.clientOrderId)
    || trimAlertIdentity(payload.client_order_id)
    || trimAlertIdentity(payload.orderId)
    || trimAlertIdentity(payload.order_id)
    || trimAlertIdentity(payload.runId)
    || trimAlertIdentity(payload.run_id);
  if (!identity) return null;
  return `${symbol}__ENTRY__${identity}`;
}

function resolveTradeAlertDedupeKey(payload = {}) {
  // C10 invariant: dedupe key MUST bind each alert to its cycle (entry_event_id
  // or canonical_chain_key) so that a close→reopen on the same symbol in
  // seconds cannot silently collide with a previous cycle's alert.  The
  // caller-supplied key is preserved (for replay compatibility) but augmented
  // with the cycle identifier so rotations produce a distinct outbox row.
  const baseKey = String(
    payload.tradeAlertDedupeKey
    || payload.trade_alert_dedupe_key
    || payload.idempotencyKey
    || payload.idempotency_key
    || ""
  ).trim() || null;
  const stableEntryKey = resolveStableEntryAlertDedupeKey(payload);
  const cycleToken = String(
    payload.entry_event_id
    || payload.entryEventId
    || (payload.meta && (payload.meta.entry_event_id || payload.meta.entryEventId))
    || payload.canonical_chain_key
    || payload.canonicalChainKey
    || (payload.meta && (payload.meta.canonical_chain_key || payload.meta.canonicalChainKey))
    || ""
  ).trim();
  if (!baseKey) return stableEntryKey;
  if (!cycleToken) return baseKey;
  return `${baseKey}::CYCLE_${cycleToken}`;
}

function shouldAllowTradeAlertResend(payload = {}) {
  return payload.forceAlertReplay === true || payload.force_alert_replay === true;
}

function resolveAlertSendResultReason(result = null) {
  if (result && String(result.reason || "").trim()) return String(result.reason).trim();
  if (!result || !Array.isArray(result.results)) return null;
  const failed = result.results.find((row) => row && String(row.error || "").trim());
  return failed ? String(failed.error).trim() : null;
}

async function resolveAlertChannel(exchange) {
  const envChannel = String(process.env.TRADE_ALERT_CHANNEL || "").trim();
  if (envChannel) return envChannel;

  const ex = normalizeExchange(exchange);
  const cacheTtl = Number(process.env.TRADE_ALERT_CHANNEL_CACHE_MS || 30_000);
  const now = Date.now();
  const cached = channelCache.get(ex);
  if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < cacheTtl) {
    return cached.channel || "";
  }

  const sys = await getSystemSettingsForProvider(ex, 5_000);
  const channel = String(sys && sys.data && sys.data.alert_channel || "").trim();
  channelCache.set(ex, { ts: now, channel });
  return channel;
}

async function resolveFailureAlertChannel(exchange) {
  const envChannel = String(process.env.TRADE_FAILURE_ALERT_CHANNEL || "").trim();
  if (envChannel) return envChannel;
  return resolveAlertChannel(exchange);
}

function isExitFailureEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  if (ev.startsWith("EXIT_TP_P0")) return true;
  return ev.startsWith("EXIT_TP_P1")
    || ev.startsWith("EXIT_TP_C")
    || ev.startsWith("EXIT_TIME_STOP")
    || ev.startsWith("EXIT_TRAIL")
    || ev.startsWith("EXIT_SL");
}

function buildMessage(payload) {
  const exchange = normalizeExchange(payload.exchange);
  const symbol = String(payload.symbol || "").toUpperCase();
  const inputEvent = String(payload.event || "").trim().toUpperCase();
  const event = normalizeTpP1EventForExchange(inputEvent, exchange);
  const intent = resolveIntent(payload);
  if (!symbol || !event || !intent) return null;
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});

  const unit = exchange.includes("BINANCE") ? "USDT" : "KRW";
  const notional = Number(payload.notional);
  const execPrice = Number(payload.execPrice);
  const closeRatio = Number(payload.closeRatio);
  const fullExit = payload.fullExit === true;
  const pnl = Number(payload.realizedPnl);
  const leverageLabel = formatLeverage(payload.appliedLeverage);
  const leverageReason = String(payload.leverageReason || "").trim();
  const direction = resolveDirection({
    intent,
    positionSideBefore: payload.positionSideBefore,
    positionSideAfter: payload.positionSideAfter,
    event,
    side: payload.side,
    exchange,
  });
  const directionKo = direction === "SHORT" ? "숏" : (direction === "LONG" ? "롱" : null);

  if (intent === "ENTRY" || intent === "ADD") {
    const action = intent === "ADD" ? "추가진입" : "진입";
    const title = directionKo ? `${symbol} ${directionKo} ${action}` : `${symbol} ${action}`;
    const lines = [];
    const tier = resolveEntryTimingTier(event, feat);
    const qtyBase = resolveEntryQtyBase(payload, execPrice, notional);
    const baseAsset = resolveBaseAssetSymbol(symbol);
    const leverageNum = Number(payload.appliedLeverage);
    const marginEstimate = (String(unit).toUpperCase() === "USDT" && Number.isFinite(notional) && Number.isFinite(leverageNum) && leverageNum > 0)
      ? (notional / leverageNum)
      : null;
    if (Number.isFinite(notional)) lines.push(`노출금액: ${formatMoney(notional, { unit })} ${unit}`);
    if (Number.isFinite(marginEstimate) && marginEstimate > 0) lines.push(`증거금추정: ${formatMoney(marginEstimate, { unit })} ${unit}`);
    if (Number.isFinite(qtyBase) && qtyBase > 0) lines.push(`체결수량: ${formatBaseQty(qtyBase)}${baseAsset ? ` ${baseAsset}` : ""}`);
    if (Number.isFinite(execPrice)) lines.push(`체결가: ${formatMoney(execPrice, { unit })} ${unit}`);
    if (tier) lines.push(`티어: ${tier}`);
    if (leverageLabel) {
      lines.push(`배율: ${leverageLabel}${leverageReason ? ` (${leverageReason})` : ""}`);
    }
    lines.push(...resolveSizingLines(payload));
    lines.push(...resolveMarketRegimeLines(payload, feat));
    const rulesTxt = formatExitRulesCompact(resolveExitRulesForAlertDisplay(payload));
    if (rulesTxt) lines.push(`청산규칙: ${rulesTxt}`);
    const replayReason = resolveTradeAlertReplayReason(payload);
    if (replayReason) lines.push(`재발송사유: ${replayReason}`);
    lines.push(`이벤트: ${formatEventTag(event)}`);
    return { title, body: lines.join("\n") };
  }

  if (intent === "EXIT") {
    const canonicalRequirement = resolveCanonicalExitAlertRequirement({
      ...payload,
      rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || inputEvent,
    }, event);
    if (canonicalRequirement.required && canonicalRequirement.satisfied !== true) return null;
    const resolvedExitMeta = resolveEffectiveExitMeta({
      ...payload,
      rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || inputEvent,
    }, event);
    const exitMeta = resolvedExitMeta.meta;
    const exitLabel = resolveExitLabel(payload, exitMeta);
    const executedContract = String(exitMeta && exitMeta.token || "").trim() || resolveExecutedExitContract(event);
    const qtyText = fullExit ? "전량" : (formatPercent(closeRatio) || "부분");
    const reclassification = resolveCanonicalReclassificationLine(resolvedExitMeta);
    const suppressRawTp0V2ReclassTitle = (
      resolvedExitMeta
      && resolvedExitMeta.simplifiedExitV2
      && resolvedExitMeta.simplifiedExitV2.enabled === true
      && String(resolvedExitMeta.rawEvidenceEvent || "").trim().toUpperCase().startsWith("EXIT_TP_P0")
    );
    const title = (reclassification && !suppressRawTp0V2ReclassTitle)
      ? `${symbol} 정본재분류 ${reclassification.replace(/\s*->\s*/g, "->")} ${qtyText} 청산`
      : `${symbol} ${exitMeta.token} ${qtyText} 청산`;
    const lines = [];
    lines.push(`종류: ${exitLabel}`);
    if (executedContract) lines.push(`실행계약: ${executedContract}`);
    if (Number.isFinite(notional)) lines.push(`청산규모: ${formatMoney(notional, { unit })} ${unit}`);
    if (Number.isFinite(pnl)) {
      const pnlLabel = pnl >= 0 ? "수익" : "손익";
      lines.push(`${pnlLabel}: ${formatMoney(pnl, { unit, signed: true })} ${unit}`);
    }
    if (Number.isFinite(execPrice)) lines.push(`체결가: ${formatMoney(execPrice, { unit })} ${unit}`);
    lines.push(...resolveExitContractLedgerLines(payload));
    if (leverageLabel) {
      lines.push(`배율: ${leverageLabel}${leverageReason ? ` (${leverageReason})` : ""}`);
    }
    lines.push(...resolveExternalSyncContextLines(payload));
    lines.push(...resolveCanonicalStageLines(payload, resolvedExitMeta));
    lines.push(...resolveExitIntegrityLines(payload));
    lines.push(...resolveMarketRegimeLines(payload, feat));
    const rulesTxt = formatExitRulesCompact(resolveExitRulesForAlertDisplay(payload, resolvedExitMeta));
    if (rulesTxt) lines.push(`전략계약: ${rulesTxt}`);
    const replayReason = resolveTradeAlertReplayReason(payload);
    if (replayReason) lines.push(`재발송사유: ${replayReason}`);
    const displayEvent = resolveDisplayExitEventForAlert(resolvedExitMeta, event);
    lines.push(`이벤트: ${formatEventTag(displayEvent || resolvedExitMeta.rawEvidenceEvent || event)}`);
    if (
      displayEvent &&
      resolvedExitMeta.rawEvidenceEvent &&
      displayEvent !== resolvedExitMeta.rawEvidenceEvent
    ) {
      lines.push(`원본이벤트: ${formatEventTag(resolvedExitMeta.rawEvidenceEvent)}`);
    }
    return { title, body: lines.join("\n") };
  }

  return null;
}

// 2026-04-27 P0-D — lineage-gap degraded fallback message builder.
//
// When resolveCanonicalExitAlertRequirement reports required && !satisfied
// (typical symptom: entry_event_id missing → simplifiedExitV2 transitions
// empty), the standard buildMessage returns null and the operator gets
// silence on what is supposed to be a TP1/TRAIL alert. This helper emits a
// best-effort *degraded* message with a [LINEAGE_GAP:<reason>] prefix so
// the operator is never silently denied a notification — the degraded line
// still carries symbol, side, price, qty, notional, and event when present
// in the payload, which is enough for ops to recognize the position and
// drill into outbox/audit for full canonical context.
function buildDegradedExitMessage(payload = {}, { reason } = {}) {
  const exchange = normalizeExchange(payload.exchange);
  const symbol = String(payload.symbol || "").toUpperCase();
  const inputEvent = String(payload.event || "").trim().toUpperCase();
  const event = normalizeTpP1EventForExchange(inputEvent, exchange);
  const intent = resolveIntent(payload);
  if (!symbol || intent !== "EXIT" || !event) return null;

  const unit = exchange.includes("BINANCE") ? "USDT" : "KRW";
  const closeRatio = Number(payload.closeRatio);
  const fullExit = payload.fullExit === true
    || (Number.isFinite(closeRatio) && closeRatio >= 0.999);
  const qtyText = fullExit ? "전량" : (formatPercent(closeRatio) || "부분");
  const direction = resolveDirection({
    intent,
    positionSideBefore: payload.positionSideBefore,
    positionSideAfter: payload.positionSideAfter,
    event,
    side: payload.side,
    exchange,
  });
  const directionKo = direction === "SHORT" ? "숏" : (direction === "LONG" ? "롱" : null);
  const execPrice = Number(payload.execPrice);
  const qtyBase = Number(payload.qtyBase);
  const baseAsset = String(payload.baseAsset || "").trim().toUpperCase() || null;
  const notional = Number(payload.notional);
  const pnl = Number(payload.pnl);
  const tag = String(reason || "MISSING_CANONICAL_EXIT_TRANSITION");

  const title = `[LINEAGE_GAP:${tag}] ${symbol} ${qtyText} 청산 (degraded)`;
  const lines = [];
  lines.push("종류: 청산 알림 (정본 lineage 없음 — degraded)");
  lines.push("주의: entry_event_id 가 없어 정본 메타가 비어 있습니다. 데이터 검증 필요.");
  if (directionKo) lines.push(`방향: ${directionKo}`);
  if (Number.isFinite(notional)) lines.push(`청산규모: ${formatMoney(notional, { unit })} ${unit}`);
  if (Number.isFinite(pnl)) {
    const pnlLabel = pnl >= 0 ? "수익" : "손익";
    lines.push(`${pnlLabel}: ${formatMoney(pnl, { unit, signed: true })} ${unit}`);
  }
  if (Number.isFinite(execPrice)) lines.push(`체결가: ${formatMoney(execPrice, { unit })} ${unit}`);
  if (Number.isFinite(qtyBase) && qtyBase > 0) {
    lines.push(`체결수량: ${formatBaseQty(qtyBase)}${baseAsset ? ` ${baseAsset}` : ""}`);
  }
  lines.push(`이벤트: ${formatEventTag(event)}`);
  lines.push(`사유: ${tag}`);
  return { title, body: lines.join("\n") };
}

function buildFailureMessage(payload) {
  const exchange = normalizeExchange(payload.exchange);
  const symbol = String(payload.symbol || "").toUpperCase();
  const inputEvent = String(payload.event || "").trim().toUpperCase();
  const event = normalizeTpP1EventForExchange(inputEvent, exchange);
  const intent = resolveIntent(payload);
  if (!symbol || intent !== "EXIT" || !isExitFailureEvent(event)) return null;
  const canonicalRequirement = resolveCanonicalExitAlertRequirement({
    ...payload,
    rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || inputEvent,
  }, event);
  if (canonicalRequirement.required && canonicalRequirement.satisfied !== true) return null;
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});

  const unit = exchange.includes("BINANCE") ? "USDT" : "KRW";
  const resolvedExitMeta = resolveEffectiveExitMeta({
    ...payload,
    rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || inputEvent,
  }, event);
  const exitMeta = resolvedExitMeta.meta;
  const exitLabel = resolveExitLabel(payload, exitMeta);
  const executedContract = String(exitMeta && exitMeta.token || "").trim() || resolveExecutedExitContract(event);
  const closeRatio = Number(payload.closeRatio);
  const qtyPct = Number(payload.qtyPct);
  const execPrice = Number(payload.execPrice);
  const leverageLabel = formatLeverage(payload.appliedLeverage);
  const leverageReason = String(payload.leverageReason || "").trim();
  const direction = resolveDirection({
    intent,
    positionSideBefore: payload.positionSideBefore,
    positionSideAfter: payload.positionSideAfter,
    event,
    side: payload.side,
    exchange,
  });
  const directionKo = direction === "SHORT" ? "숏" : (direction === "LONG" ? "롱" : null);
  const reason = String(payload.reason || payload.cancelReason || payload.statusReason || "LIVE_FAILED").trim() || "LIVE_FAILED";
  const note = String(payload.note || payload.cancelNote || payload.error || "").trim();
  const qtyLabel = payload.fullExit === true
    ? "전량"
    : (formatPercent(closeRatio) || formatPercent(qtyPct) || null);

  const reclassification = resolveCanonicalReclassificationLine(resolvedExitMeta);
  const suppressRawTp0V2ReclassTitle = (
    resolvedExitMeta
    && resolvedExitMeta.simplifiedExitV2
    && resolvedExitMeta.simplifiedExitV2.enabled === true
    && String(resolvedExitMeta.rawEvidenceEvent || "").trim().toUpperCase().startsWith("EXIT_TP_P0")
  );
  const title = (reclassification && !suppressRawTp0V2ReclassTitle)
    ? `${symbol} 정본재분류 ${reclassification.replace(/\s*->\s*/g, "->")} 주문 실패`
    : `${symbol} ${exitLabel} 주문 실패`;
  const lines = [`종류: ${exitLabel}`];
  if (executedContract) lines.push(`실행계약: ${executedContract}`);
  if (directionKo) lines.push(`방향: ${directionKo} 청산`);
  if (qtyLabel) lines.push(`주문비율: ${qtyLabel}`);
  if (Number.isFinite(execPrice)) lines.push(`기준가: ${formatMoney(execPrice, { unit })} ${unit}`);
  if (leverageLabel) {
    lines.push(`배율: ${leverageLabel}${leverageReason ? ` (${leverageReason})` : ""}`);
  }
  lines.push(...resolveExitContractLedgerLines(payload));
  lines.push(...resolveCanonicalStageLines(payload, resolvedExitMeta));
  lines.push(...resolveExitIntegrityLines(payload));
  lines.push(...resolveMarketRegimeLines(payload, feat));
  const rulesTxt = formatExitRulesCompact(resolveExitRulesForAlertDisplay(payload, resolvedExitMeta));
  if (rulesTxt) lines.push(`전략계약: ${rulesTxt}`);
  lines.push(`실패사유: ${reason}`);
  if (note) lines.push(`메모: ${note.slice(0, 240)}`);
  const replayReason = resolveTradeAlertReplayReason(payload);
  if (replayReason) lines.push(`재발송사유: ${replayReason}`);
  lines.push(`이벤트: ${formatEventTag(resolvedExitMeta.rawEvidenceEvent || event)}`);
  return { title, body: lines.join("\n") };
}

async function sendTradeExecutionAlert(payload = {}) {
  const exchange = normalizeExchange(payload.exchange);
  const mode = String(payload.executionMode || "").trim().toUpperCase();
  const intent = resolveIntent(payload);

  if (!toBool(process.env.TRADE_ALERT_ENABLED, true)) {
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "DISABLED",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  if (!isAllowedExchange(exchange)) {
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "EXCHANGE_FILTERED",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }

  if (!toBool(process.env.TRADE_ALERT_INCLUDE_PAPER, false)) {
    if (mode !== "LIVE" && mode !== "LIVE_DRY_RUN") {
      appendTradeExecutionAlertDecisionAudit({
        exchange,
        payload,
        intent,
        executionMode: mode,
        ok: false,
        skipped: true,
        reason: "NON_LIVE_MODE",
        source: "tradeExecutionAlert.sendTradeExecutionAlert",
      });
      return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
    }
  }

  const exchangeEvent = normalizeTpP1EventForExchange(String(payload.event || "").trim().toUpperCase(), exchange);
  const canonicalRequirement = intent === "EXIT"
    ? resolveCanonicalExitAlertRequirement({
      ...payload,
      rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || payload.event,
    }, exchangeEvent)
    : null;
  if (canonicalRequirement && canonicalRequirement.required && canonicalRequirement.satisfied !== true) {
    appendTradeExecutionAlertAudit({
      type: "TRADE_EXECUTION_ALERT",
      exchange,
      symbol: String(payload.symbol || "").toUpperCase() || null,
      event: String(payload.event || "").trim().toUpperCase() || null,
      intent,
      execution_mode: mode,
      ok: false,
      skipped: true,
      reason: canonicalRequirement.reason,
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    // 2026-04-27 P0-D — lineage-gap degraded fallback. Last line of defense
    // against the V2 entry_event_id-missing class of bugs (P0-A catches at
    // write boundary; this catches at the alert boundary). When canonical
    // exit metadata is unavailable, still notify the operator with a
    // [LINEAGE_GAP:<reason>] prefixed message carrying best-effort context
    // (price, qty, side, event). On any failure (no message buildable, no
    // channel, send error), we fall through to the BLOCKED row writer
    // below so observability is never worse than the prior behaviour.
    const lineageGapDegraded = toBool(process.env.TRADE_ALERT_LINEAGE_GAP_DEGRADED, true);
    if (lineageGapDegraded && intent === "EXIT") {
      const degradedReason = canonicalRequirement.reason || "MISSING_CANONICAL_EXIT_TRANSITION";
      const degradedMsg = buildDegradedExitMessage(payload, { reason: degradedReason });
      if (degradedMsg) {
        let degradedOutboxState = null;
        try {
          degradedOutboxState = await prepareTradeAlertOutbox({
            type: "TRADE_EXECUTION_ALERT",
            exchange,
            symbol: payload.symbol,
            event: payload.event,
            title: degradedMsg.title,
            body: degradedMsg.body,
            payload: { ...payload, lineage_gap_degraded: true, lineage_gap_reason: degradedReason },
            sourceFillId: resolveTradeAlertSourceFillId(payload),
            dedupeKey: resolveTradeAlertDedupeKey(payload),
            allowResend: false,
            source: "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
          });
        } catch (err) {
          console.warn("[TRADE_EXEC_ALERT_DEGRADED_OUTBOX_PREP_FAIL]",
            err && err.message ? err.message : String(err));
        }
        if (degradedOutboxState && degradedOutboxState.skipSend === true) {
          // Prior SENT exists for this dedupe key — degraded or canonical
          // already dispatched. Don't redispatch and don't downgrade to
          // BLOCKED below; surface the prior id and exit.
          appendTradeExecutionAlertDecisionAudit({
            exchange,
            payload,
            intent,
            executionMode: mode,
            title: degradedMsg.title,
            body: degradedMsg.body,
            ok: true,
            skipped: true,
            reason: "OUTBOX_ALREADY_SENT_DEGRADED",
            source: "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
          });
          return {
            ok: true,
            skipped: true,
            reason: "OUTBOX_ALREADY_SENT",
            degraded: true,
            outboxId: degradedOutboxState.outboxId,
          };
        }
        if (degradedOutboxState && degradedOutboxState.outboxId) {
          const rawChannelDegraded = await resolveAlertChannel(exchange);
          const telegramOnlyDegraded = toBool(process.env.TRADE_ALERT_TELEGRAM_ONLY, true);
          const channelDegraded = rawChannelDegraded
            ? (telegramOnlyDegraded ? filterTelegramChannels(rawChannelDegraded) : rawChannelDegraded)
            : null;
          if (channelDegraded) {
            let degradedResult = null;
            let degradedSendError = null;
            try {
              degradedResult = await sendAlert({
                channel: channelDegraded,
                title: degradedMsg.title,
                body: degradedMsg.body,
                severity: "WARN",
              });
            } catch (err) {
              degradedSendError = err;
              console.warn("[TRADE_EXEC_ALERT_DEGRADED_SEND_FAIL]",
                err && err.message ? err.message : String(err));
            }
            if (degradedResult && degradedResult.ok === true) {
              await markTradeAlertOutboxResult({
                outboxId: degradedOutboxState.outboxId,
                ok: true,
                skipped: false,
                reason: "DEGRADED_LINEAGE_GAP",
                result: degradedResult,
                channel: channelDegraded,
                title: degradedMsg.title,
                body: degradedMsg.body,
                source: "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
              }).catch(() => null);
              appendTradeExecutionAlertDecisionAudit({
                exchange,
                payload,
                intent,
                executionMode: mode,
                channel: channelDegraded,
                title: degradedMsg.title,
                body: degradedMsg.body,
                ok: true,
                skipped: false,
                reason: "DEGRADED_LINEAGE_GAP",
                source: "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
              });
              return {
                ...(degradedResult || {}),
                ok: true,
                skipped: false,
                reason: "DEGRADED_LINEAGE_GAP",
                degraded: true,
                outboxId: degradedOutboxState.outboxId,
              };
            }
            // Degraded send failed — record the failure on the degraded
            // row so ops can correlate, then fall through to BLOCKED.
            await markTradeAlertOutboxResult({
              outboxId: degradedOutboxState.outboxId,
              ok: false,
              skipped: false,
              reason: degradedSendError
                ? (degradedSendError.message || String(degradedSendError))
                : resolveAlertSendResultReason(degradedResult),
              error: degradedSendError && degradedSendError.stack
                ? degradedSendError.stack
                : (degradedSendError ? String(degradedSendError) : null),
              channel: channelDegraded,
              title: degradedMsg.title,
              body: degradedMsg.body,
              source: "tradeExecutionAlert.sendTradeExecutionAlert.degraded",
            }).catch(() => null);
          }
        }
      }
    }
    // 2026-04-20 senior-audit P3: persist a durable BLOCKED row in
    // trade_alert_outbox so that canonical-exit gate rejections are
    // query-indexable by (symbol, event, time) in Firestore. Prior to this,
    // the skip returned here before prepareTradeAlertOutbox, leaving no
    // symbol-keyed evidence — ops had to scan audit logs to discover a
    // Telegram miss. The write is best-effort: if outbox prep fails we
    // fall through to the original return so the trading path is never
    // blocked by alert-observability storage.
    let blockedOutboxId = null;
    try {
      const blockedOutboxState = await prepareTradeAlertOutbox({
        type: "TRADE_EXECUTION_ALERT",
        exchange,
        symbol: payload.symbol,
        event: payload.event,
        // No title/body yet — buildMessage hasn't run. Use a canonical
        // placeholder so downstream dashboards can still display the row.
        title: `[BLOCKED:${canonicalRequirement.reason}] ${String(payload.symbol || "").toUpperCase() || "?"} ${String(payload.event || "").toUpperCase() || "?"}`,
        body: null,
        payload,
        sourceFillId: resolveTradeAlertSourceFillId(payload),
        dedupeKey: resolveTradeAlertDedupeKey(payload),
        allowResend: false,
        source: "tradeExecutionAlert.sendTradeExecutionAlert.blocked",
      });
      if (blockedOutboxState && blockedOutboxState.outboxId) {
        blockedOutboxId = blockedOutboxState.outboxId;
        // Only downgrade to BLOCKED when the prior state was not already
        // SENT — skipSend=true means the outbox already reflects a
        // successful prior dispatch and we must not clobber it. In that
        // case the skip here is a duplicate request, not a silent drop.
        if (blockedOutboxState.skipSend !== true) {
          await markTradeAlertOutboxResult({
            outboxId: blockedOutboxId,
            blocked: true,
            reason: canonicalRequirement.reason,
            source: "tradeExecutionAlert.sendTradeExecutionAlert.blocked",
          }).catch((err) => {
            console.warn("[TRADE_EXEC_ALERT_OUTBOX_BLOCKED_MARK_FAIL]",
              err && err.message ? err.message : String(err));
            return null;
          });
        }
      }
    } catch (err) {
      console.warn("[TRADE_EXEC_ALERT_OUTBOX_BLOCKED_PREP_FAIL]",
        err && err.message ? err.message : String(err));
    }
    return {
      ok: false,
      skipped: true,
      reason: canonicalRequirement.reason,
      blocked: true,
      outboxId: blockedOutboxId,
    };
  }

  const msg = buildMessage(payload);
  if (!msg) {
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "UNSUPPORTED_EVENT",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return { ok: false, skipped: true, reason: "UNSUPPORTED_EVENT" };
  }

  const sourceFillId = resolveTradeAlertSourceFillId(payload);
  let outboxState = null;
  try {
    outboxState = await prepareTradeAlertOutbox({
      type: "TRADE_EXECUTION_ALERT",
      exchange,
      symbol: payload.symbol,
      event: payload.event,
      title: msg.title,
      body: msg.body,
      payload,
      sourceFillId,
      dedupeKey: resolveTradeAlertDedupeKey(payload),
      allowResend: shouldAllowTradeAlertResend(payload),
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
  } catch (err) {
    console.warn("[TRADE_EXEC_ALERT_OUTBOX_PREP_FAIL]", err && err.message ? err.message : String(err));
  }
  if (outboxState && outboxState.skipSend === true) {
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: true,
      skipped: true,
      reason: "OUTBOX_ALREADY_SENT",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return {
      ok: true,
      skipped: true,
      reason: "OUTBOX_ALREADY_SENT",
      outboxId: outboxState.outboxId,
    };
  }

  const rawChannel = await resolveAlertChannel(exchange);
  if (!rawChannel) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: true,
        reason: "NO_CHANNEL",
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionAlert",
      }).catch(() => null);
    }
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: false,
      skipped: true,
      reason: "NO_CHANNEL",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  }

  const telegramOnly = toBool(process.env.TRADE_ALERT_TELEGRAM_ONLY, true);
  const channel = telegramOnly ? filterTelegramChannels(rawChannel) : rawChannel;
  if (!channel) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: true,
        reason: "NO_TELEGRAM_CHANNEL",
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionAlert",
      }).catch(() => null);
    }
    appendTradeExecutionAlertDecisionAudit({
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: false,
      skipped: true,
      reason: "NO_TELEGRAM_CHANNEL",
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    });
    return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };
  }

  let result = null;
  try {
    result = await sendAlert({
      channel,
      title: msg.title,
      body: msg.body,
      severity: "INFO",
    });
  } catch (err) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: false,
        reason: err && err.message ? err.message : String(err),
        error: err && err.stack ? err.stack : (err && err.message ? err.message : String(err)),
        channel,
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionAlert",
      }).catch(() => null);
    }
    throw err;
  }
  if (outboxState && outboxState.outboxId) {
    await markTradeAlertOutboxResult({
      outboxId: outboxState.outboxId,
      ok: result && result.ok === true,
      skipped: false,
      reason: resolveAlertSendResultReason(result),
      result,
      channel,
      title: msg.title,
      body: msg.body,
      source: "tradeExecutionAlert.sendTradeExecutionAlert",
    }).catch(() => null);
  }
  appendTradeExecutionAlertDecisionAudit({
    exchange,
    payload,
    intent,
    executionMode: mode,
    channel,
    title: msg.title,
    body: msg.body,
    ok: result && result.ok === true,
    skipped: false,
    reason: resolveAlertSendResultReason(result),
    source: "tradeExecutionAlert.sendTradeExecutionAlert",
  });
  return outboxState && outboxState.outboxId
    ? { ...(result || {}), outboxId: outboxState.outboxId }
    : result;
}

async function sendTradeExecutionFailureAlert(payload = {}) {
  const exchange = normalizeExchange(payload.exchange);
  const mode = String(payload.executionMode || "").trim().toUpperCase();
  const intent = resolveIntent(payload);

  if (!toBool(process.env.TRADE_FAILURE_ALERT_ENABLED, true)) {
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "DISABLED",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  if (!isAllowedFailureExchange(exchange)) {
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "EXCHANGE_FILTERED",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }

  if (mode !== "LIVE") {
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "NON_LIVE_MODE",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
  }

  const exchangeEvent = normalizeTpP1EventForExchange(String(payload.event || "").trim().toUpperCase(), exchange);
  const canonicalRequirement = intent === "EXIT"
    ? resolveCanonicalExitAlertRequirement({
      ...payload,
      rawEvidenceEvent: payload.rawEvidenceEvent || payload.raw_evidence_event || payload.event,
    }, exchangeEvent)
    : null;
  if (canonicalRequirement && canonicalRequirement.required && canonicalRequirement.satisfied !== true) {
    appendTradeExecutionAlertAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      symbol: String(payload.symbol || "").toUpperCase() || null,
      event: String(payload.event || "").trim().toUpperCase() || null,
      intent,
      execution_mode: mode,
      ok: false,
      skipped: true,
      reason: canonicalRequirement.reason,
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: canonicalRequirement.reason };
  }

  const msg = buildFailureMessage(payload);
  if (!msg) {
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      ok: false,
      skipped: true,
      reason: "UNSUPPORTED_EVENT",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "UNSUPPORTED_EVENT" };
  }

  const sourceFillId = resolveTradeAlertSourceFillId(payload);
  let outboxState = null;
  try {
    outboxState = await prepareTradeAlertOutbox({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      symbol: payload.symbol,
      event: payload.event,
      title: msg.title,
      body: msg.body,
      payload,
      sourceFillId,
      dedupeKey: resolveTradeAlertDedupeKey(payload),
      allowResend: shouldAllowTradeAlertResend(payload),
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
  } catch (err) {
    console.warn("[TRADE_EXEC_FAIL_ALERT_OUTBOX_PREP_FAIL]", err && err.message ? err.message : String(err));
  }
  if (outboxState && outboxState.skipSend === true) {
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: true,
      skipped: true,
      reason: "OUTBOX_ALREADY_SENT",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return {
      ok: true,
      skipped: true,
      reason: "OUTBOX_ALREADY_SENT",
      outboxId: outboxState.outboxId,
    };
  }

  const rawChannel = await resolveFailureAlertChannel(exchange);
  if (!rawChannel) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: true,
        reason: "NO_CHANNEL",
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
      }).catch(() => null);
    }
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: false,
      skipped: true,
      reason: "NO_CHANNEL",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  }

  const telegramOnly = toBool(process.env.TRADE_FAILURE_ALERT_TELEGRAM_ONLY, true);
  const channel = telegramOnly ? filterTelegramChannels(rawChannel) : rawChannel;
  if (!channel) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: true,
        reason: "NO_TELEGRAM_CHANNEL",
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
      }).catch(() => null);
    }
    appendTradeExecutionAlertDecisionAudit({
      type: "TRADE_EXECUTION_FAILURE_ALERT",
      exchange,
      payload,
      intent,
      executionMode: mode,
      title: msg.title,
      body: msg.body,
      ok: false,
      skipped: true,
      reason: "NO_TELEGRAM_CHANNEL",
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    });
    return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };
  }

  let result = null;
  try {
    result = await sendAlert({
      channel,
      title: msg.title,
      body: msg.body,
      severity: "WARN",
    });
  } catch (err) {
    if (outboxState && outboxState.outboxId) {
      await markTradeAlertOutboxResult({
        outboxId: outboxState.outboxId,
        ok: false,
        skipped: false,
        reason: err && err.message ? err.message : String(err),
        error: err && err.stack ? err.stack : (err && err.message ? err.message : String(err)),
        channel,
        title: msg.title,
        body: msg.body,
        source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
      }).catch(() => null);
    }
    throw err;
  }
  if (outboxState && outboxState.outboxId) {
    await markTradeAlertOutboxResult({
      outboxId: outboxState.outboxId,
      ok: result && result.ok === true,
      skipped: false,
      reason: resolveAlertSendResultReason(result),
      result,
      channel,
      title: msg.title,
      body: msg.body,
      source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
    }).catch(() => null);
  }
  appendTradeExecutionAlertDecisionAudit({
    type: "TRADE_EXECUTION_FAILURE_ALERT",
    exchange,
    payload,
    intent,
    executionMode: mode,
    channel,
    title: msg.title,
    body: msg.body,
    ok: result && result.ok === true,
    skipped: false,
    reason: resolveAlertSendResultReason(result),
    source: "tradeExecutionAlert.sendTradeExecutionFailureAlert",
  });
  return outboxState && outboxState.outboxId
    ? { ...(result || {}), outboxId: outboxState.outboxId }
    : result;
}

module.exports = {
  sendTradeExecutionAlert,
  sendTradeExecutionFailureAlert,
  __test: {
    buildMessage,
    buildDegradedExitMessage,
    buildFailureMessage,
    parseExitEventMeta,
    isSimplifiedExitV2Enabled,
    normalizeSimplifiedExitV2TransitionEvents,
    resolveSimplifiedExitV2AlertProjection,
    resolveEffectiveExitMeta,
    resolveCanonicalExitAlertRequirement,
    resolveRawEvidenceEvent,
    resolveDirection,
    resolveExternalSyncContextLines,
    appendTradeExecutionAlertAudit,
    resolveTradeAlertSourceFillId,
    resolveAlertSendResultReason,
    resolveStableEntryAlertDedupeKey,
    resolveTradeAlertDedupeKey,
  },
};
