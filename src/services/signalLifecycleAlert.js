"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");
const { getSystemSettingsForProvider } = require("../storage/settings");
const { sendAlert } = require("../utils/alerts");
const { classifySignalReasonStage, explainSignalReason } = require("../utils/signalReasonView");
const { canonicalExternalEntryEvent } = require("../utils/liveEntryTaxonomy");
const { riskGovernorTelegramLine } = require("../v2/riskGovernorSurface");

const channelCache = new Map();
const ROOT = path.resolve(__dirname, "../..");
const OPS_RUNTIME = path.join(ROOT, "ops", "runtime");
const SIGNAL_COMPARE_STATE_PATH = path.join(OPS_RUNTIME, "signal_compare_alert_state.json");
const SIGNAL_LIFECYCLE_ALERT_OUTBOX_COLLECTION = "signal_lifecycle_alert_outbox";

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

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cloneJson(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function compactIdToken(value, fallback = "NA") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "")
    .slice(0, 180) || fallback;
}

function nowIso() {
  return new Date().toISOString();
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

function appendRiskGovernorLine(lines, payload = {}) {
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : {};
  const line = riskGovernorTelegramLine(
    payload.riskGovernor
    || payload.risk_governor
    || meta.v2_discovery_risk_governor_surface
    || meta.risk_governor_surface
    || null
  );
  if (line) lines.push(line);
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

function isFiniteNum(value) {
  return Number.isFinite(Number(value));
}

function appendDropQtyLines(lines, payload = {}, options = {}) {
  const requested = Number(payload.qtyPct);
  const afterOpenclaw = Number(payload.qtyAfterOpenclawPct);
  const finalQty = Number(payload.qtyFinalPct);
  const requiredQty = Number(payload.requiredQtyPct);
  const floorQty = Number(payload.floorQtyPct);
  const isTimingDefer = options.isTimingDefer === true;

  if (!isFiniteNum(finalQty)) {
    if (isTimingDefer) {
      lines.push(`수량: ${fmtQty(requested)}`);
      return;
    }
    lines.push(`수량(요청): ${fmtQty(requested)}`);
    lines.push("수량(최종): 0%");
    return;
  }

  lines.push(`수량(요청): ${fmtQty(requested)}`);
  if (isFiniteNum(afterOpenclaw)) lines.push(`수량(OpenClaw 후): ${fmtQty(afterOpenclaw)}`);
  lines.push(`수량(최종): ${fmtQty(finalQty)}`);
  if (isFiniteNum(requiredQty)) lines.push(`최소필요수량: ${fmtQty(requiredQty)}`);
  if (payload.floorApplied === true && isFiniteNum(floorQty)) {
    lines.push(`floor 보정수량: ${fmtQty(floorQty)}`);
  }
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
  const reason = String(payload.dropReasonCode || payload.reason || "").trim().toUpperCase();
  const authoritative = payload.authoritative === true || source === "SERVER";
  const isWebhook = source === "WEBHOOK";
  if (kind === "RECEIVED") {
    if (authoritative) return `${symbol} 서버 신호 생성`;
    if (isWebhook) return `${symbol} 웹훅 신호 수신`;
    return `${symbol} 신호 수신`;
  }
  if (kind === "PROGRESSED") {
    if (authoritative) return `${symbol} 서버 신호 진행`;
    if (isWebhook) return `${symbol} 웹훅 신호 진행`;
    return `${symbol} 신호 진행`;
  }
  if (
    reason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL"
    || reason === "V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL"
  ) {
    return `${symbol} 보호주문 복구 필요`;
  }
  if (reason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED") {
    return `${symbol} 진입 체결 후 기록 확인 필요`;
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
  const postFillReason = String(dropReason || "").trim().toUpperCase();
  const isPostFillCritical = postFillReason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_PROTECTION_CRITICAL"
    || postFillReason === "V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL";
  const isPostFillProtected = postFillReason === "V2_PRODUCTION_ENTRY_LIVE_POST_FILL_ROUTE_FAILURE_PROTECTED";
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
    `실행모드: ${String(payload.executionMode || "-")}`,
  ];
  appendDropQtyLines(lines, payload, { isTimingDefer });
  appendRiskGovernorLine(lines, payload);
  if (payload.signalId) lines.push(`signal_id: ${payload.signalId}`);
  return { title, body: lines.join("\n"), severity: isPostFillCritical ? "CRITICAL" : (isPostFillProtected ? "ERROR" : (isTimingDefer ? "INFO" : "WARN")) };
}

function buildProgressMessage(payload = {}) {
  const symbol = String(payload.symbol || "").toUpperCase();
  const event = String(payload.event || "-").toUpperCase();
  if (!symbol || !event) return null;

  const pendingReason = String(payload.pendingReason || "").trim().toUpperCase();
  const nextStep = (() => {
    if (pendingReason === "WAIT_NEXT_BAR") return "다음 바 집행 대기";
    if (pendingReason === "EXEC_CURRENT_BAR" || pendingReason === "IMMEDIATE_ENTRY" || pendingReason === "IMMEDIATE_EXEC") return "주문/집행 진행";
    return "주문 판단 진행";
  })();

  const title = buildLifecycleTitle(payload, "PROGRESSED");
  const lines = [
    `이벤트: ${formatEventTag(event)}`,
    `출처: ${formatSignalSource(payload)}`,
    `사이드: ${fmtSide(payload.side)}`,
    `TF: ${String(payload.tf || "-")}`,
    `수량: ${fmtQty(payload.qtyPct)}`,
    `실행모드: ${String(payload.executionMode || "-")}`,
    `진행 상태: ${String(payload.progressReason || "INTENT_CREATED")}`,
    `다음 단계: ${nextStep}`,
  ];
  appendRiskGovernorLine(lines, payload);
  if (payload.signalId) lines.push(`signal_id: ${payload.signalId}`);
  if (payload.scheduledExecBarCloseUtc) lines.push(`예정 집행시각: ${String(payload.scheduledExecBarCloseUtc)}`);
  return { title, body: lines.join("\n"), severity: "INFO" };
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonSafe(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadCompareState() {
  return readJsonSafe(SIGNAL_COMPARE_STATE_PATH, { records: {} }) || { records: {} };
}

function saveCompareState(state) {
  writeJsonSafe(SIGNAL_COMPARE_STATE_PATH, state || { records: {} });
}

function buildCompareDedupeKey(payload = {}) {
  return [
    normalizeExchange(payload.exchange),
    String(payload.symbol || "").toUpperCase(),
    String(payload.tf || ""),
    Number.isFinite(Number(payload.barCloseMs)) ? Number(payload.barCloseMs) : "NA",
  ].join("__");
}

function shouldSendCompareAlert(payload = {}) {
  if (payload.newBar === false) return false;
  if (String(payload.serverReason || "").trim().toUpperCase() === "NO_NEW_BAR") return false;
  return !!(
    payload.webhookSeen
    || payload.serverSignalCreated
    || Number(payload.signalDropN || 0) > 0
  );
}

function buildCompareMessage(payload = {}) {
  const symbol = String(payload.symbol || "").toUpperCase();
  if (!symbol) return null;
  const webhookText = payload.webhookSeen
    ? `있음${payload.webhookDecision ? ` (${payload.webhookDecision})` : ""}`
    : "없음";
  const serverCreated = payload.serverSignalCreated ? "예" : "아니오";
  const serverReasonLabel = payload.serverSignalCreated ? "생성 후 상태" : "미생성 주원인";
  const lines = [
    `시장: ${symbol}`,
    `바시각: ${String(payload.barCloseUtc || "-")}`,
    `웹훅신호: ${webhookText}`,
    `서버신호 생성여부: ${serverCreated}`,
    `${serverReasonLabel}: ${String(payload.serverReason || "-")}`,
    `드롭상위사유: ${String(payload.topDropReason || "-")}`,
  ];
  return {
    title: `${symbol} 서버 신호 비교`,
    body: lines.join("\n"),
    severity: payload.serverSignalCreated ? "INFO" : "WARN",
  };
}

function resolveSignalLifecycleAlertIdentity(payload = {}) {
  return trimOrNull(
    payload.signalId
    || payload.signal_id
    || payload.signalDocId
    || payload.signal_doc_id
    || payload.intentId
    || payload.intent_id
    || payload.canonicalEventId
    || payload.canonical_event_id
    || payload.idempotencyKey
    || payload.idempotency_key
    || payload.entryEventId
    || payload.entry_event_id
  );
}

function resolveSignalLifecycleAlertBarToken(payload = {}) {
  const raw = payload.barCloseMs
    || payload.bar_close_time_utc_ms
    || payload.execBarCloseMs
    || payload.exec_bar_close_time_utc_ms;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return String(Math.trunc(n));
  return trimOrNull(payload.barCloseUtc || payload.bar_close_time_utc || payload.scheduledExecBarCloseUtc);
}

function resolveSignalLifecycleAlertReasonToken(type, payload = {}) {
  const normalizedType = upper(type);
  if (normalizedType === "DROPPED") {
    return upper(payload.dropReasonCode || payload.drop_reason_code || payload.reason) || "DROP";
  }
  if (normalizedType === "PROGRESSED") {
    return upper(payload.progressReason || payload.progress_reason || payload.pendingReason || payload.pending_reason) || "PROGRESS";
  }
  return normalizedType || "LIFECYCLE";
}

function resolveSignalLifecycleAlertDedupeKey({ type, exchange, payload = {} } = {}) {
  const normalizedType = upper(type);
  if (!normalizedType) return null;
  const symbol = upper(payload.symbol);
  const event = upper(payload.event);
  if (!symbol || !event) return null;
  const identity = resolveSignalLifecycleAlertIdentity(payload)
    || resolveSignalLifecycleAlertBarToken(payload);
  if (!identity) return null;
  const parts = [
    normalizeExchange(exchange || payload.exchange),
    symbol,
    String(payload.tf || "NA").trim() || "NA",
    event,
    normalizedType,
    resolveSignalLifecycleAlertReasonToken(normalizedType, payload),
    identity,
  ];
  return parts.map((part) => String(part || "NA")).join("__");
}

function buildSignalLifecycleAlertOutboxId({ type, exchange, symbol, event, dedupeKey, payload = {} } = {}) {
  const stableSeed = trimOrNull(dedupeKey)
    || crypto.createHash("sha1").update(JSON.stringify({
      type: upper(type),
      exchange: normalizeExchange(exchange || payload.exchange),
      symbol: upper(symbol || payload.symbol),
      event: upper(event || payload.event),
      signal_id: trimOrNull(payload.signalId || payload.signal_id),
      reason: resolveSignalLifecycleAlertReasonToken(type, payload),
    })).digest("hex").slice(0, 20);
  return [
    "SIGNAL_LIFECYCLE_ALERT",
    compactIdToken(upper(type), "LIFECYCLE"),
    compactIdToken(normalizeExchange(exchange || payload.exchange), "BINANCEFUT"),
    compactIdToken(upper(symbol || payload.symbol), "UNKNOWN"),
    compactIdToken(upper(event || payload.event), "UNKNOWN"),
    compactIdToken(stableSeed, "NA"),
  ].join("__");
}

async function prepareSignalLifecycleAlertOutbox({
  type,
  exchange,
  symbol,
  event,
  title = null,
  body = null,
  channel = null,
  payload = {},
  dedupeKey = null,
  allowResend = false,
  db: injectedDb = null,
} = {}) {
  const resolvedDedupeKey = trimOrNull(dedupeKey);
  if (!resolvedDedupeKey) return { skipOutbox: true, reason: "NO_STABLE_DEDUPE_KEY" };
  const outboxId = buildSignalLifecycleAlertOutboxId({
    type,
    exchange,
    symbol,
    event,
    dedupeKey: resolvedDedupeKey,
    payload,
  });
  const db = injectedDb || getFirestore();
  const ref = db.collection(SIGNAL_LIFECYCLE_ALERT_OUTBOX_COLLECTION).doc(outboxId);
  const snap = await ref.get();
  const prev = snap.exists ? (snap.data() || {}) : null;
  if (prev && upper(prev.status) === "SENT" && allowResend !== true) {
    return { outboxId, ref, doc: prev, skipSend: true };
  }
  const now = nowIso();
  const attemptCount = Math.max(0, Number(prev && prev.attempt_count) || 0) + 1;
  const doc = {
    signal_lifecycle_alert_outbox_id: outboxId,
    type: upper(type),
    exchange: normalizeExchange(exchange || payload.exchange),
    symbol: upper(symbol || payload.symbol),
    event: upper(event || payload.event),
    tf: trimOrNull(payload.tf),
    status: "PENDING",
    dedupe_key: resolvedDedupeKey,
    signal_id: trimOrNull(payload.signalId || payload.signal_id),
    reason: resolveSignalLifecycleAlertReasonToken(type, payload),
    created_at: trimOrNull(prev && prev.created_at) || now,
    updated_at: now,
    last_attempt_at: now,
    attempt_count: attemptCount,
    last_channel: trimOrNull(channel) || trimOrNull(prev && prev.last_channel),
    last_title: trimOrNull(title) || trimOrNull(prev && prev.last_title),
    last_body: trimOrNull(body) || trimOrNull(prev && prev.last_body),
    last_error: null,
    last_result: null,
    payload: cloneJson(payload) || cloneJson(prev && prev.payload),
  };
  await ref.set(doc, { merge: true });
  return { outboxId, ref, doc, skipSend: false };
}

async function markSignalLifecycleAlertOutboxResult({
  outboxId,
  ok = false,
  skipped = false,
  reason = null,
  error = null,
  result = null,
  channel = null,
  title = null,
  body = null,
} = {}) {
  const id = trimOrNull(outboxId);
  if (!id) return null;
  const db = getFirestore();
  const now = nowIso();
  const status = skipped === true ? "SKIPPED" : (ok === true ? "SENT" : "FAILED");
  const patch = {
    status,
    updated_at: now,
    last_reason: trimOrNull(reason),
    last_error: status === "SENT" ? null : (trimOrNull(error) || trimOrNull(reason)),
    last_result: cloneJson(result),
    last_channel: trimOrNull(channel),
    last_title: trimOrNull(title),
    last_body: trimOrNull(body),
  };
  if (status === "SENT") patch.sent_at = now;
  else if (status === "SKIPPED") patch.skipped_at = now;
  else patch.failed_at = now;
  await db.collection(SIGNAL_LIFECYCLE_ALERT_OUTBOX_COLLECTION).doc(id).set(patch, { merge: true });
  return { outboxId: id, status };
}

function shouldNotifyType(type) {
  if (type === "RECEIVED") {
    return toBool(process.env.SIGNAL_LIFECYCLE_ALERT_RECEIVED_ENABLED, true);
  }
  if (type === "PROGRESSED") {
    return toBool(process.env.SIGNAL_LIFECYCLE_ALERT_PROGRESS_ENABLED, true);
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

  const msg = type === "RECEIVED"
    ? buildReceivedMessage(payload)
    : (type === "PROGRESSED" ? buildProgressMessage(payload) : buildDroppedMessage(payload));
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

  const outboxEnabled = toBool(process.env.SIGNAL_LIFECYCLE_ALERT_OUTBOX_ENABLED, true);
  const dedupeKey = outboxEnabled
    ? resolveSignalLifecycleAlertDedupeKey({ type, exchange, payload })
    : null;
  let outbox = null;
  if (outboxEnabled && dedupeKey) {
    try {
      outbox = await prepareSignalLifecycleAlertOutbox({
        type,
        exchange,
        symbol: payload.symbol,
        event: payload.event,
        title: msg.title,
        body: msg.body,
        channel,
        payload,
        dedupeKey,
        allowResend: payload.forceAlertReplay === true || payload.force_alert_replay === true,
      });
      if (outbox && outbox.skipSend === true) {
        return {
          ok: true,
          skipped: true,
          reason: "OUTBOX_ALREADY_SENT",
          outboxId: outbox.outboxId,
          dedupeKey,
        };
      }
    } catch (err) {
      // Alert delivery must not break signal processing. If Firestore outbox is
      // unavailable, preserve the old send path and surface the dedupe failure.
      try {
        console.warn("[SIGNAL_LIFECYCLE_ALERT_OUTBOX_PREP_FAIL]", JSON.stringify({
          type,
          exchange,
          symbol: String(payload && payload.symbol || "").toUpperCase(),
          event: String(payload && payload.event || "").toUpperCase(),
          signal_id: payload.signalId || payload.signal_id || null,
          dedupe_key: dedupeKey,
          error_message: err && err.message ? String(err.message) : String(err),
        }));
      } catch (_) {}
    }
  }

  const result = await sendAlert({
    channel,
    title: msg.title,
    body: msg.body,
    severity: msg.severity,
  });
  if (outbox && outbox.outboxId) {
    try {
      await markSignalLifecycleAlertOutboxResult({
        outboxId: outbox.outboxId,
        ok: result && result.ok === true,
        reason: result && result.reason,
        error: result && result.error_message,
        result,
        channel,
        title: msg.title,
        body: msg.body,
      });
    } catch (err) {
      try {
        console.warn("[SIGNAL_LIFECYCLE_ALERT_OUTBOX_MARK_FAIL]", JSON.stringify({
          type,
          outbox_id: outbox.outboxId,
          error_message: err && err.message ? String(err.message) : String(err),
        }));
      } catch (_) {}
    }
  }
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

async function sendSignalCompareAlert(payload = {}) {
  if (!toBool(process.env.SIGNAL_COMPARE_ALERT_ENABLED, true)) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  if (!shouldSendCompareAlert(payload)) {
    return { ok: false, skipped: true, reason: "NO_RELEVANT_COMPARE" };
  }
  const exchange = normalizeExchange(payload.exchange);
  if (!isAllowedExchange(exchange)) {
    return { ok: false, skipped: true, reason: "EXCHANGE_FILTERED" };
  }
  const msg = buildCompareMessage(payload);
  if (!msg) return { ok: false, skipped: true, reason: "INVALID_MESSAGE" };

  const dedupeKey = buildCompareDedupeKey(payload);
  const state = loadCompareState();
  if (state.records && state.records[dedupeKey]) {
    return { ok: false, skipped: true, reason: "DEDUPED" };
  }

  const rawChannel = await resolveAlertChannel(exchange);
  if (!rawChannel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  const channel = filterTelegramChannels(rawChannel);
  if (!channel) return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };

  const result = await sendAlert({
    channel,
    title: msg.title,
    body: msg.body,
    severity: msg.severity,
  });
  if (result && result.ok === true) {
    state.records = state.records || {};
    state.records[dedupeKey] = { sent_at: new Date().toISOString() };
    const keys = Object.keys(state.records);
    if (keys.length > 1000) {
      keys.sort((a, b) => String(state.records[b]?.sent_at || "").localeCompare(String(state.records[a]?.sent_at || "")));
      const trimmed = {};
      keys.slice(0, 500).forEach((key) => {
        trimmed[key] = state.records[key];
      });
      state.records = trimmed;
    }
    saveCompareState(state);
  }
  return result;
}

async function sendSignalReceivedAlert(payload = {}) {
  return sendSignalLifecycleAlert({ type: "RECEIVED", ...payload });
}

async function sendSignalProgressAlert(payload = {}) {
  return sendSignalLifecycleAlert({ type: "PROGRESSED", ...payload });
}

async function sendSignalDroppedAlert(payload = {}) {
  return sendSignalLifecycleAlert({ type: "DROPPED", ...payload });
}

module.exports = {
  sendSignalLifecycleAlert,
  sendSignalReceivedAlert,
  sendSignalProgressAlert,
  sendSignalDroppedAlert,
  sendSignalCompareAlert,
  __test: {
    resolveAlertChannelFromSources,
    buildTelegramChannelFromChatId,
    buildReceivedMessage,
    buildProgressMessage,
    buildDroppedMessage,
    buildCompareMessage,
    appendRiskGovernorLine,
    shouldSendCompareAlert,
    resolveSignalLifecycleAlertDedupeKey,
    buildSignalLifecycleAlertOutboxId,
    prepareSignalLifecycleAlertOutbox,
    markSignalLifecycleAlertOutboxResult,
  },
};
