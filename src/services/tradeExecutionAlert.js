"use strict";

const fs = require("fs");
const path = require("path");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { prepareTradeAlertOutbox, markTradeAlertOutboxResult } = require("../storage/tradeAlertOutbox");
const { sendAlert } = require("../utils/alerts");
const { resolveEventMapping } = require("./signalStandard");
const { resolveCanonicalAlertExitStage } = require("./positionStateMachine");
const { canonicalExternalEntryEvent, resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");

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

function normalizeTpP1EventForExchange(eventRaw, exchange) {
  const ev = String(eventRaw || "").trim().toUpperCase();
  const ex = normalizeExchange(exchange);
  if (ex === "BINANCEFUT" && ev === "EXIT_TP_P1_5P") return "EXIT_TP_P1_3P";
  return ev;
}

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
  if (Number.isFinite(tp0Allowed) && tp0Allowed > 0) contractParts.push(`TP0 ${formatBaseQty(tp0Allowed)}`);
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

function parseExitEventMeta(event) {
  const ev = String(event || "").toUpperCase();
  let m = ev.match(/^EXIT_TP_P0_([0-9]+(?:\.[0-9]+)?)P$/);
  if (m) return { token: `TP0_${m[1]}`, label: `익절(TP0) ${m[1]}%` };
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
  if (ev.startsWith("EXIT_TP_P0")) return { token: "TP0", label: "익절(TP0)" };
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
    "TP0_REACHED",
    "TP1_REACHED",
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

function buildGenericExitMeta(stage) {
  if (stage === "TP0") return { token: "TP0", label: "익절(TP0)" };
  if (stage === "TP1") return { token: "TP1", label: "익절(TP1)" };
  if (stage === "TRAIL") return { token: "TRAIL", label: "트레일링" };
  return null;
}

function resolveEffectiveExitMeta(payload = {}, rawEvent) {
  const rawEvidenceEvent = resolveRawEvidenceEvent(payload, rawEvent);
  const rawMeta = parseExitEventMeta(rawEvidenceEvent);
  const canonicalEvent = String(payload.canonicalExitEvent || payload.canonical_exit_event || "").trim().toUpperCase();
  const canonicalEventMeta = canonicalEvent ? parseExitEventMeta(canonicalEvent) : null;
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
  const meta = canonicalEventMeta
    ? canonicalEventMeta
    : (effectiveCanonicalStage && canonicalTransitionEvents.length > 0 && overrideApplied)
    ? (buildGenericExitMeta(effectiveCanonicalStage) || rawMeta)
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
  };
}

function resolveCanonicalReclassificationLine(resolved = {}) {
  if (!resolved || resolved.overrideApplied !== true) return null;
  const rawToken = String(resolved.rawMeta && resolved.rawMeta.token || resolved.rawStage || "").trim();
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
  const stopParts = [];
  if (chosenSource || Number.isFinite(chosenStopPrice)) {
    stopParts.push(`chosen ${chosenSource || "-"} ${Number.isFinite(chosenStopPrice) ? formatMoney(chosenStopPrice) : "-"}`);
  }
  if (Number.isFinite(runnerFloorStop)) stopParts.push(`floor ${formatMoney(runnerFloorStop)}`);
  if (Number.isFinite(trailStopByR)) stopParts.push(`r ${formatMoney(trailStopByR)}`);
  if (Number.isFinite(nativeStopPrice)) stopParts.push(`native ${formatMoney(nativeStopPrice)}`);
  if (stopParts.length) {
    lines.push(`stop근거: ${stopParts.join(" / ")}`);
  }
  return lines;
}

function resolveExternalSyncContextLines(payload = {}) {
  const ev = String(payload.event || "").trim().toUpperCase();
  if (ev !== "EXIT_EXTERNAL_SYNC") return [];
  const stage = String(payload.externalSyncHintStage || "").trim().toUpperCase();
  const reason = String(
    payload.reason || payload.statusReason || payload.cancelReason || payload.decisionReason || ""
  ).trim().toUpperCase();
  const orderType = String(payload.externalSyncOrderType || "").trim().toUpperCase();
  const closePosition = payload.externalSyncClosePosition;
  const lines = [];
  if (stage === "TRAIL_AFTER_TP1") lines.push("동기화맥락: 트레일 종료 후 외부 동기화");
  else if (stage === "AFTER_TP1") lines.push("동기화맥락: TP1 이후 외부 동기화");
  else if (stage === "AFTER_TP0") lines.push("동기화맥락: TP0 이후 외부 동기화");
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
  appendTradeExecutionAlertAudit({
    type,
    exchange,
    symbol: String(payload.symbol || "").toUpperCase() || null,
    event: String(payload.event || "").trim().toUpperCase() || null,
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

function resolveTradeAlertDedupeKey(payload = {}) {
  return String(
    payload.tradeAlertDedupeKey
    || payload.trade_alert_dedupe_key
    || payload.idempotencyKey
    || payload.idempotency_key
    || ""
  ).trim() || null;
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
    const rulesTxt = formatExitRulesCompact(payload.exitRules || payload.exit_rules);
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
    const title = reclassification
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
    const rulesTxt = formatExitRulesCompact(payload.exitRules || payload.exit_rules);
    if (rulesTxt) lines.push(`전략계약: ${rulesTxt}`);
    const replayReason = resolveTradeAlertReplayReason(payload);
    if (replayReason) lines.push(`재발송사유: ${replayReason}`);
    lines.push(`이벤트: ${formatEventTag(resolvedExitMeta.rawEvidenceEvent || event)}`);
    return { title, body: lines.join("\n") };
  }

  return null;
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
  const title = reclassification
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
  const rulesTxt = formatExitRulesCompact(payload.exitRules || payload.exit_rules);
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
    return { ok: false, skipped: true, reason: canonicalRequirement.reason };
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
    buildFailureMessage,
    parseExitEventMeta,
    resolveEffectiveExitMeta,
    resolveCanonicalExitAlertRequirement,
    resolveRawEvidenceEvent,
    resolveDirection,
    resolveExternalSyncContextLines,
    appendTradeExecutionAlertAudit,
    resolveTradeAlertSourceFillId,
    resolveAlertSendResultReason,
  },
};
