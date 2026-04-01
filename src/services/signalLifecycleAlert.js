"use strict";

const { getSystemSettingsForProvider } = require("../storage/settings");
const { sendAlert } = require("../utils/alerts");
const { classifySignalReasonStage, explainSignalReason } = require("../utils/signalReasonView");
const { canonicalExternalEntryEvent } = require("../utils/liveEntryTaxonomy");

const channelCache = new Map();

function toBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (!s) return def;
  return ["1", "true", "yes", "y", "on"].includes(s);
}

function parseList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeExchange(exchange) {
  const ex = String(exchange || "").trim().toUpperCase();
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function isAllowedExchange(exchange) {
  const allow = parseList(process.env.SIGNAL_LIFECYCLE_ALERT_EXCHANGES || "")
    .map((x) => normalizeExchange(x));
  if (!allow.length) return true;
  return allow.includes(normalizeExchange(exchange));
}

function isLiveExecutionMode(mode) {
  const m = String(mode || "").trim().toUpperCase();
  return m === "LIVE" || m === "LIVE_DRY_RUN";
}

function shouldAlertForMode(mode) {
  if (toBool(process.env.SIGNAL_LIFECYCLE_ALERT_INCLUDE_PAPER, false)) return true;
  return isLiveExecutionMode(mode);
}

function isTelegramChannel(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v.startsWith("telegram:") || v.startsWith("tg:") || v.startsWith("telegram://") || v.startsWith("tg://");
}

function filterTelegramChannels(raw) {
  return parseList(raw).filter(isTelegramChannel).join(",");
}

function buildTelegramChannelFromChatId(chatId) {
  const v = String(chatId || "").trim();
  if (!v) return "";
  return `telegram:${v}`;
}

function resolveAlertChannelFromSources({
  lifecycleChannel,
  systemChannel,
  tradeChannel,
  exitIntegrityChannel,
  telegramChatId,
} = {}) {
  const lifecycle = String(lifecycleChannel || "").trim();
  if (lifecycle) return lifecycle;

  const system = String(systemChannel || "").trim();
  if (system) return system;

  const trade = String(tradeChannel || "").trim();
  if (trade) return trade;

  const exitIntegrity = String(exitIntegrityChannel || "").trim();
  if (exitIntegrity) return exitIntegrity;

  return buildTelegramChannelFromChatId(telegramChatId);
}

async function resolveAlertChannel(exchange) {
  const envChannel = String(process.env.SIGNAL_LIFECYCLE_ALERT_CHANNEL || "").trim();
  if (envChannel) return envChannel;

  const tradeEnvChannel = String(process.env.TRADE_ALERT_CHANNEL || "").trim();
  const exitIntegrityEnvChannel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  const telegramChatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();

  const ex = normalizeExchange(exchange);
  const cacheTtl = Number(process.env.SIGNAL_LIFECYCLE_ALERT_CHANNEL_CACHE_MS || 30_000);
  const now = Date.now();
  const cached = channelCache.get(ex);
  if (cached && Number.isFinite(cached.ts) && (now - cached.ts) < cacheTtl) {
    return resolveAlertChannelFromSources({
      systemChannel: cached.channel || "",
      tradeChannel: tradeEnvChannel,
      exitIntegrityChannel: exitIntegrityEnvChannel,
      telegramChatId,
    });
  }

  const sys = await getSystemSettingsForProvider(ex, 5_000);
  const systemChannel = String(sys && sys.data && sys.data.alert_channel || "").trim();
  channelCache.set(ex, { ts: now, channel: systemChannel });
  return resolveAlertChannelFromSources({
    systemChannel,
    tradeChannel: tradeEnvChannel,
    exitIntegrityChannel: exitIntegrityEnvChannel,
    telegramChatId,
  });
}

function logLifecycleSkip(type, payload, reason) {
  if (reason !== "NO_CHANNEL" && reason !== "NO_TELEGRAM_CHANNEL") return;
  try {
    console.warn("[SIGNAL_LIFECYCLE_ALERT_SKIP]", JSON.stringify({
      type,
      reason,
      exchange: normalizeExchange(payload && payload.exchange),
      symbol: String(payload && payload.symbol || "").toUpperCase(),
      event: String(payload && payload.event || "").toUpperCase(),
      tf: String(payload && payload.tf || ""),
      executionMode: String(payload && payload.executionMode || "").toUpperCase(),
    }));
  } catch (_) {}
}

function fmtQty(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "-";
  const pct = Math.max(0, Math.min(100, n * 100));
  const digits = pct >= 10 ? 0 : 1;
  return `${pct.toFixed(digits)}%`;
}

function fmtSide(side) {
  const s = String(side || "").trim().toUpperCase();
  if (s === "BUY") return "매수";
  if (s === "SELL") return "매도";
  return "-";
}

function formatEventTag(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return "-";
  const canonicalEntry = canonicalExternalEntryEvent(ev, null);
  if (canonicalEntry) return canonicalEntry;
  return ev;
}

function formatSignalSource(payload = {}) {
  const source = String(payload.source || "").trim().toUpperCase();
  if (payload.authoritative === true || source === "SERVER") return "서버 정본";
  if (source === "WEBHOOK") return "외부 수신";
  if (source === "PINE_SHADOW") return "외부 수신";
  return source || "-";
}

function buildLifecycleTitle(payload = {}, kind = "RECEIVED") {
  const symbol = String(payload.symbol || "").toUpperCase();
  const source = String(payload.source || "").trim().toUpperCase();
  const authoritative = payload.authoritative === true || source === "SERVER";
  const isWebhook = source === "WEBHOOK";
  if (kind === "RECEIVED") {
    if (authoritative) return `${symbol} 서버 신호 생성`;
    if (isWebhook) return `${symbol} 웹훅 신호 수신`;
    return `${symbol} 신호 수신`;
  }
  if (authoritative) return `${symbol} 서버 신호 드롭`;
  if (isWebhook) return `${symbol} 웹훅 신호 드롭`;
  return `${symbol} 신호 드롭`;
}

function buildReceivedMessage(payload = {}) {
  const symbol = String(payload.symbol || "").toUpperCase();
  const event = String(payload.event || "-").toUpperCase();
  if (!symbol || !event) return null;

  const title = buildLifecycleTitle(payload, "RECEIVED");
  const lines = [
    `이벤트: ${formatEventTag(event)}`,
    `출처: ${formatSignalSource(payload)}`,
    `사이드: ${fmtSide(payload.side)}`,
    `TF: ${String(payload.tf || "-")}`,
    `수량: ${fmtQty(payload.qtyPct)}`,
    `실행모드: ${String(payload.executionMode || "-")}`,
    `다음 단계: 서버 판단 대기`,
  ];
  if (payload.signalId) lines.push(`signal_id: ${payload.signalId}`);
  if (payload.reason) lines.push(`사유: ${String(payload.reason)}`);
  return { title, body: lines.join("\n"), severity: "INFO" };
}

function buildDroppedMessage(payload = {}) {
  const symbol = String(payload.symbol || "").toUpperCase();
  const event = String(payload.event || "-").toUpperCase();
  if (!symbol || !event) return null;

  const reasonCode = String(payload.dropReasonCode || "").trim();
  const reason = String(payload.reason || "").trim();
  const dropReason = reasonCode || reason || "DROP_FILTER";
  const stage = classifySignalReasonStage(dropReason);
  const reasonKo = explainSignalReason(dropReason);
  const isTimingDefer = stage && stage.key === "TIMING";
  const dropGroup = String(payload.dropGroup || payload.eventGroup || "").trim().toUpperCase() || null;
  const dropSubtype = String(payload.dropSubtype || payload.eventSubtype || "").trim().toUpperCase() || null;
  const dropLocation = [
    stage && stage.text ? stage.text : null,
    dropGroup,
    dropSubtype,
  ].filter(Boolean).join(" / ");

  const title = isTimingDefer ? `${symbol} 신호 연기` : buildLifecycleTitle(payload, "DROPPED");
  const lines = [
    `이벤트: ${formatEventTag(event)}`,
    `출처: ${formatSignalSource(payload)}`,
    `사이드: ${fmtSide(payload.side)}`,
    `TF: ${String(payload.tf || "-")}`,
    `드롭 위치: ${dropLocation || stage.text || "미분류"}`,
    `사유: ${dropReason}`,
    `해석: ${reasonKo || "현재 조건상 신호를 보류했습니다."}`,
    `수량: ${fmtQty(payload.qtyPct)}`,
    `실행모드: ${String(payload.executionMode || "-")}`,
  ];
  if (payload.signalId) lines.push(`signal_id: ${payload.signalId}`);
  return { title, body: lines.join("\n"), severity: isTimingDefer ? "INFO" : "WARN" };
}

function shouldNotifyType(type) {
  if (type === "RECEIVED") {
    return toBool(process.env.SIGNAL_LIFECYCLE_ALERT_RECEIVED_ENABLED, true);
  }
  if (type === "DROPPED") {
    return toBool(process.env.SIGNAL_LIFECYCLE_ALERT_DROPPED_ENABLED, true);
  }
  return false;
}

async function sendSignalLifecycleAlert({ type, ...payload } = {}) {
  if (!toBool(process.env.SIGNAL_LIFECYCLE_ALERT_ENABLED, true)) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  if (!shouldNotifyType(type)) {
    return { ok: false, skipped: true, reason: "TYPE_DISABLED" };
  }

  const exchange = normalizeExchange(payload.exchange);
  if (!isAllowedExchange(exchange)) {
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }
  if (!shouldAlertForMode(payload.executionMode)) {
    return { ok: false, skipped: true, reason: "NON_LIVE_MODE" };
  }

  const msg = type === "RECEIVED" ? buildReceivedMessage(payload) : buildDroppedMessage(payload);
  if (!msg) return { ok: false, skipped: true, reason: "INVALID_MESSAGE" };

  const rawChannel = await resolveAlertChannel(exchange);
  if (!rawChannel) {
    logLifecycleSkip(type, payload, "NO_CHANNEL");
    return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  }

  const telegramOnly = toBool(process.env.SIGNAL_LIFECYCLE_ALERT_TELEGRAM_ONLY, true);
  const channel = telegramOnly ? filterTelegramChannels(rawChannel) : rawChannel;
  if (!channel) {
    logLifecycleSkip(type, payload, "NO_TELEGRAM_CHANNEL");
    return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };
  }

  const result = await sendAlert({
    channel,
    title: msg.title,
    body: msg.body,
    severity: msg.severity,
  });
  if (!result || result.ok !== true) {
    try {
      console.warn("[SIGNAL_LIFECYCLE_ALERT_SEND_FAIL]", JSON.stringify({
        type,
        exchange,
        symbol: String(payload && payload.symbol || "").toUpperCase(),
        event: String(payload && payload.event || "").toUpperCase(),
        tf: String(payload && payload.tf || ""),
        result,
      }));
    } catch (_) {}
  }
  return result;
}

async function sendSignalReceivedAlert(payload = {}) {
  return sendSignalLifecycleAlert({ type: "RECEIVED", ...payload });
}

async function sendSignalDroppedAlert(payload = {}) {
  return sendSignalLifecycleAlert({ type: "DROPPED", ...payload });
}

module.exports = {
  sendSignalLifecycleAlert,
  sendSignalReceivedAlert,
  sendSignalDroppedAlert,
  __test: {
    resolveAlertChannelFromSources,
    buildTelegramChannelFromChatId,
    buildReceivedMessage,
    buildDroppedMessage,
  },
};
