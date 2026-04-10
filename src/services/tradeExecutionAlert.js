"use strict";

const { getSystemSettingsForProvider } = require("../storage/settings");
const { sendAlert } = require("../utils/alerts");
const { resolveEventMapping } = require("./signalStandard");
const { canonicalExternalEntryEvent, resolveEntryTimingTier } = require("../utils/liveEntryTaxonomy");

const channelCache = new Map();

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
  const rawIntent = String(intent || "").trim().toUpperCase();
  if (rawIntent === "ENTRY" || rawIntent === "ADD" || rawIntent === "EXIT") return rawIntent;
  const ev = String(event || "").trim().toUpperCase();
  if (ev.startsWith("EXIT_")) return "EXIT";
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
  if (ev === "EXIT_OPPOSITE_SIGNAL") return { token: "OPPOSITE", label: "반대신호 청산" };
  if (ev === "EXIT_LIQUIDATION_RISK") return { token: "RISK", label: "리스크 청산" };
  if (ev === "EXIT_EXTERNAL_SYNC") return { token: "EXTERNAL_SYNC", label: "외부 동기화 청산" };
  return { token: "EXIT", label: "청산" };
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
  const event = normalizeTpP1EventForExchange(payload.event, exchange);
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
    lines.push(`이벤트: ${formatEventTag(event)}`);
    return { title, body: lines.join("\n") };
  }

  if (intent === "EXIT") {
    const exitMeta = parseExitEventMeta(event);
    const exitLabel = resolveExitLabel(payload, exitMeta);
    const executedContract = resolveExecutedExitContract(event);
    const qtyText = fullExit ? "전량" : (formatPercent(closeRatio) || "부분");
    const title = `${symbol} ${exitMeta.token} ${qtyText} 청산`;
    const lines = [];
    lines.push(`종류: ${exitLabel}`);
    if (executedContract) lines.push(`실행계약: ${executedContract}`);
    if (Number.isFinite(notional)) lines.push(`청산규모: ${formatMoney(notional, { unit })} ${unit}`);
    if (Number.isFinite(pnl)) {
      const pnlLabel = pnl >= 0 ? "수익" : "손익";
      lines.push(`${pnlLabel}: ${formatMoney(pnl, { unit, signed: true })} ${unit}`);
    }
    if (Number.isFinite(execPrice)) lines.push(`체결가: ${formatMoney(execPrice, { unit })} ${unit}`);
    if (leverageLabel) {
      lines.push(`배율: ${leverageLabel}${leverageReason ? ` (${leverageReason})` : ""}`);
    }
    lines.push(...resolveMarketRegimeLines(payload, feat));
    const rulesTxt = formatExitRulesCompact(payload.exitRules || payload.exit_rules);
    if (rulesTxt) lines.push(`전략계약: ${rulesTxt}`);
    lines.push(`이벤트: ${formatEventTag(event)}`);
    return { title, body: lines.join("\n") };
  }

  return null;
}

function buildFailureMessage(payload) {
  const exchange = normalizeExchange(payload.exchange);
  const symbol = String(payload.symbol || "").toUpperCase();
  const event = normalizeTpP1EventForExchange(payload.event, exchange);
  const intent = resolveIntent(payload);
  if (!symbol || intent !== "EXIT" || !isExitFailureEvent(event)) return null;
  const feat = (payload.features && typeof payload.features === "object")
    ? payload.features
    : ((payload.features_json && typeof payload.features_json === "object") ? payload.features_json : {});

  const unit = exchange.includes("BINANCE") ? "USDT" : "KRW";
  const exitMeta = parseExitEventMeta(event);
  const exitLabel = resolveExitLabel(payload, exitMeta);
  const executedContract = resolveExecutedExitContract(event);
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

  const title = `${symbol} ${exitLabel} 주문 실패`;
  const lines = [`종류: ${exitLabel}`];
  if (executedContract) lines.push(`실행계약: ${executedContract}`);
  if (directionKo) lines.push(`방향: ${directionKo} 청산`);
  if (qtyLabel) lines.push(`주문비율: ${qtyLabel}`);
  if (Number.isFinite(execPrice)) lines.push(`기준가: ${formatMoney(execPrice, { unit })} ${unit}`);
  if (leverageLabel) {
    lines.push(`배율: ${leverageLabel}${leverageReason ? ` (${leverageReason})` : ""}`);
  }
  lines.push(...resolveMarketRegimeLines(payload, feat));
  const rulesTxt = formatExitRulesCompact(payload.exitRules || payload.exit_rules);
  if (rulesTxt) lines.push(`전략계약: ${rulesTxt}`);
  lines.push(`실패사유: ${reason}`);
  if (note) lines.push(`메모: ${note.slice(0, 240)}`);
  lines.push(`이벤트: ${formatEventTag(event)}`);
  return { title, body: lines.join("\n") };
}

async function sendTradeExecutionAlert(payload = {}) {
  if (!toBool(process.env.TRADE_ALERT_ENABLED, true)) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  const exchange = normalizeExchange(payload.exchange);
  if (!isAllowedExchange(exchange)) {
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }

  const mode = String(payload.executionMode || "").trim().toUpperCase();
  if (!toBool(process.env.TRADE_ALERT_INCLUDE_PAPER, false)) {
    if (mode !== "LIVE" && mode !== "LIVE_DRY_RUN") {
      return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
    }
  }

  const msg = buildMessage(payload);
  if (!msg) return { ok: false, skipped: true, reason: "UNSUPPORTED_EVENT" };

  const rawChannel = await resolveAlertChannel(exchange);
  if (!rawChannel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };

  const telegramOnly = toBool(process.env.TRADE_ALERT_TELEGRAM_ONLY, true);
  const channel = telegramOnly ? filterTelegramChannels(rawChannel) : rawChannel;
  if (!channel) return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };

  return sendAlert({
    channel,
    title: msg.title,
    body: msg.body,
    severity: "INFO",
  });
}

async function sendTradeExecutionFailureAlert(payload = {}) {
  if (!toBool(process.env.TRADE_FAILURE_ALERT_ENABLED, true)) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }

  const exchange = normalizeExchange(payload.exchange);
  if (!isAllowedFailureExchange(exchange)) {
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }

  const mode = String(payload.executionMode || "").trim().toUpperCase();
  if (mode !== "LIVE") {
    return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
  }

  const msg = buildFailureMessage(payload);
  if (!msg) return { ok: false, skipped: true, reason: "UNSUPPORTED_EVENT" };

  const rawChannel = await resolveFailureAlertChannel(exchange);
  if (!rawChannel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };

  const telegramOnly = toBool(process.env.TRADE_FAILURE_ALERT_TELEGRAM_ONLY, true);
  const channel = telegramOnly ? filterTelegramChannels(rawChannel) : rawChannel;
  if (!channel) return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };

  return sendAlert({
    channel,
    title: msg.title,
    body: msg.body,
    severity: "WARN",
  });
}

module.exports = {
  sendTradeExecutionAlert,
  sendTradeExecutionFailureAlert,
  __test: {
    buildMessage,
    buildFailureMessage,
    parseExitEventMeta,
    resolveDirection,
  },
};
