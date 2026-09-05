const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const DEFAULT_TIMEOUT_MS = 8000;
const OPENCLAW_TIMEOUT_MS = 15000;
const OPENCLAW_MAX_BUFFER = 1024 * 1024;
const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(__dirname, "../..");

const TELEGRAM_LABEL_MAP = new Map([
  ["reason:", "사유:"],
  ["error:", "오류:"],
  ["phase:", "단계:"],
  ["state:", "상태:"],
  ["price:", "가격:"],
  ["symbol:", "종목:"],
  ["side:", "방향:"],
  ["mode:", "실행 모드:"],
  ["attempts:", "시도 횟수:"],
  ["order_id:", "주문 ID:"],
  ["client_order_id:", "클라이언트 주문 ID:"],
  ["order_type:", "주문 유형:"],
  ["close_position:", "포지션 종료 주문:"],
  ["tracked_client:", "내부 추적 주문 여부:"],
  ["trade_time_utc:", "체결 시각(UTC):"],
  ["after_tp1_sec:", "TP1 후 경과 초:"],
  ["tp1_event:", "TP1 기준 이벤트:"],
  ["tp1_done:", "1차 익절 완료:"],
  ["trail_active:", "트레일링 활성화:"],
]);

const TELEGRAM_TOKEN_MAP = new Map([
  ["PASS", "정상"],
  ["FAIL", "실패"],
  ["WARN", "주의"],
  ["ERROR", "오류"],
  ["INFO", "알림"],
  ["HOLD", "유지"],
  ["KEEP", "유지"],
  ["READY", "준비 완료"],
  ["BLOCKED", "차단됨"],
  ["BLOCK", "차단"],
  ["APPLIED", "적용"],
  ["DRY", "참고용"],
  ["BUY", "매수"],
  ["SELL", "매도"],
  ["LIVE_FAILED", "실거래 실행 실패"],
  ["LIVE_EXCEPTION", "실거래 예외"],
  ["DAILY_NO_TRADE_ACTIVITY", "오늘 거래가 없음"],
  ["ZERO_KRW_IDLE", "거래가 없어 수익이 0원임"],
  ["OBJECTIVE_SAMPLE_NOT_READY", "판단할 표본이 아직 부족함"],
  ["MONTHLY_TARGET_NOT_MET", "월간 목표 미달"],
  ["OBJECTIVE_NOT_MET", "핵심 목표 미달"],
  ["NO_CHANNEL", "알림 채널 없음"],
  ["NO_TELEGRAM_CHANNEL", "텔레그램 채널 없음"],
  ["UNKNOWN", "미확인"],
  ["RUN", "실행"],
  ["true", "예"],
  ["false", "아니오"],
]);

function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeChannel(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;

  if (v.startsWith("slack://")) {
    return { type: "slack", url: v.slice("slack://".length) };
  }
  if (v.startsWith("https://hooks.slack.com/")) {
    return { type: "slack", url: v };
  }
  if (v.startsWith("telegram://") || v.startsWith("tg://")) {
    const rest = v.replace(/^telegram:\/\//, "").replace(/^tg:\/\//, "");
    const at = rest.lastIndexOf("@");
    if (at > 0) {
      return { type: "telegram", token: rest.slice(0, at), chatId: rest.slice(at + 1) };
    }
    return { type: "telegram", token: null, chatId: rest };
  }
  if (v.startsWith("telegram:")) {
    return { type: "telegram", token: null, chatId: v.slice("telegram:".length) };
  }
  if (v.startsWith("tg:")) {
    return { type: "telegram", token: null, chatId: v.slice("tg:".length) };
  }
  if (v.startsWith("mailto:")) {
    return { type: "email", to: v.slice("mailto:".length) };
  }
  if (v.startsWith("email:")) {
    return { type: "email", to: v.slice("email:".length) };
  }

  return { type: "unknown", raw: v };
}

async function postJson(url, payload, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP_${res.status}: ${text}`);
    }
    return { ok: true, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendSlack({ url, title, body, severity }) {
  const prefix = severity ? `[${String(severity).toUpperCase()}] ` : "";
  const text = `${prefix}${title}\n${body}`;
  return postJson(url, { text });
}

function normalizeTelegramSeverity(severity) {
  const s = String(severity || "").trim().toUpperCase();
  if (s === "CRITICAL" || s === "CRIT") return "긴급";
  if (s === "ERROR") return "오류";
  if (s === "WARN" || s === "WARNING") return "주의";
  if (s === "PASS" || s === "OK" || s === "SUCCESS") return "정상";
  return "알림";
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return fallback;
}

function resolveV2TelegramRuntimeContext(env = process.env) {
  const source = env && typeof env === "object" ? env : {};
  if (!parseBool(source.DONBEOLJA_V2_ENABLED, false)) return null;
  if (parseBool(source.DONBEOLJA_V2_TELEGRAM_CONTEXT_ENABLED, true) !== true) return null;

  const discovery = parseBool(source.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, false);
  const canaryOnly = parseBool(source.DONBEOLJA_V2_CANARY_ONLY, false);
  const liveEndpoint = parseBool(source.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, false);
  const dryRun = parseBool(source.DONBEOLJA_V2_DRY_RUN, false);
  const mlLive = parseBool(source.ML_LIVE_SERVING_ARMED, false);
  const agentApply = parseBool(source.OPENCLAW_AGENT_APPLY_ENABLED, false);
  const blockLegacy = parseBool(source.DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, false);
  const allowLegacy = parseBool(source.DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, false);
  const symbols = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS || "").trim();
  const maxNotional = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE || "").trim();
  const symbolNotionalMap = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP || "").trim();
  const maxPositionCount = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT || "").trim();
  const maxTradesPerDay = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY || "").trim();
  const dailyLossHalt = String(source.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE || "").trim();
  const riskTotal = String(source.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE || "").trim();
  const riskSymbol = String(source.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE || "").trim();
  const riskGroup = String(source.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE || "").trim();

  // 2026-09-05 — the banner reported the V2 environment flags, and V2 no longer
  // exists in this repo. On 2026-08-24 a carry alert therefore carried
  // "dry_run=0 | live_endpoint=1 | risk_total=1300", which reads as 1,300 USDT
  // of live trading authorised. Nothing was authorised: those flags describe a
  // runtime that was purged, and tracing the live import graph found no
  // reachable order path at all.
  //
  // What actually gates a live order is now one thing — the kill switch in
  // binanceFuturesPrivate — so that is what the banner reports. The V2 flags
  // are kept below only when orders are genuinely armed, where they describe
  // real limits instead of ghosts.
  const ordersArmed = String(source.BINANCE_LIVE_ORDERS_ARMED || "").trim() === "1";
  if (!ordersArmed) {
    return Object.freeze({
      label: "PAPER",
      line: "runtime=PAPER | live_orders=DISARMED | 실거래 노출 0 "
        + "(주문 경로가 BINANCE_LIVE_ORDERS_ARMED 로 차단됨)",
    });
  }

  const mode = discovery
    ? "DISCOVERY_CANARY"
    : (canaryOnly ? "CANARY_ONLY" : "LIVE");
  const formalLive = !dryRun && !canaryOnly && !discovery;
  const risk = [
    `dry_run=${dryRun ? "1" : "0"}`,
    `canary_only=${canaryOnly ? "1" : "0"}`,
    `formal_live=${formalLive ? "1" : "0"}`,
    `live_endpoint=${liveEndpoint ? "1" : "0"}`,
    `ml_live=${mlLive ? "1" : "0"}`,
    `agent_apply=${agentApply ? "1" : "0"}`,
    `legacy_webhook=${blockLegacy && !allowLegacy ? "BLOCKED" : "OPEN"}`,
  ];
  if (symbols) risk.push(`symbols=${symbols}`);
  if (maxNotional) risk.push(`fallback_notional=${maxNotional}`);
  if (symbolNotionalMap) risk.push(`symbol_notional=${symbolNotionalMap}`);
  if (maxPositionCount) risk.push(`max_pos=${maxPositionCount}`);
  if (maxTradesPerDay) risk.push(`max_trades=${maxTradesPerDay}`);
  if (dailyLossHalt) risk.push(`daily_loss_halt=${dailyLossHalt}`);
  if (riskTotal) risk.push(`risk_total=${riskTotal}`);
  if (riskSymbol) risk.push(`risk_symbol=${riskSymbol}`);
  if (riskGroup) risk.push(`risk_group=${riskGroup}`);
  return Object.freeze({
    label: `V2 ${mode}`,
    line: `runtime=V2 ${mode} | ${risk.join(" | ")}`,
  });
}

function normalizeLegacyPriorityTokens(text) {
  return String(text || "")
    .replace(/\[P0\]/gi, "[V2 긴급]")
    .replace(/\bP0\b/g, "V2_CRITICAL");
}

function normalizeTelegramLine(line) {
  let out = normalizeLegacyPriorityTokens(line);
  for (const [from, to] of TELEGRAM_LABEL_MAP.entries()) {
    const re = new RegExp(`(^|\\s)${from.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`, "i");
    out = out.replace(re, (m, lead = "") => `${lead}${to}`);
  }
  for (const [from, to] of TELEGRAM_TOKEN_MAP.entries()) {
    const re = new RegExp(`\\b${from.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`, "g");
    out = out.replace(re, to);
  }
  out = out.replace(/^\[AI\]\s*/i, "AI 판단 ");
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

function normalizeTelegramTitle(title, severity) {
  const core = normalizeTelegramLine(String(title || "").trim());
  const prefix = `[${normalizeTelegramSeverity(severity)}]`;
  return core ? `${prefix} ${core}` : prefix;
}

function normalizeTelegramBody(body) {
  return String(body || "")
    .split("\n")
    .map((line) => normalizeTelegramLine(line))
    .join("\n");
}

function buildTelegramText({ title, body, severity, env = process.env }) {
  const context = resolveV2TelegramRuntimeContext(env);
  const titleWithContext = context && !String(title || "").toUpperCase().includes("V2")
    ? `[${context.label}] ${String(title || "").trim()}`
    : title;
  const normalizedTitle = normalizeTelegramTitle(titleWithContext, severity);
  const normalizedBody = normalizeTelegramBody(body);
  const contextLine = context ? normalizeTelegramLine(context.line) : "";
  if (contextLine) {
    return `${normalizedTitle}\n${contextLine}${normalizedBody ? `\n${normalizedBody}` : ""}`.trim();
  }
  return `${normalizedTitle}\n${normalizedBody}`.trim();
}

function resolveTelegramTransport({ token } = {}) {
  const raw = String(process.env.TELEGRAM_ALERT_TRANSPORT || process.env.ALERT_TELEGRAM_TRANSPORT || "auto")
    .trim()
    .toLowerCase();
  if (raw === "api" || raw === "direct" || raw === "telegram_api") return "api";
  if (raw === "openclaw_required") return "openclaw_required";
  if (raw === "openclaw") return "openclaw";
  if (String(token || "").trim()) return "api";
  return "auto";
}

function buildOpenClawSendArgs({ chatId, text }) {
  return [
    "message",
    "send",
    "--channel",
    "telegram",
    "--target",
    String(chatId || "").trim(),
    "--message",
    String(text || ""),
    "--json",
  ];
}

async function sendTelegramViaOpenClaw({ chatId, title, body, severity }) {
  const chat = String(chatId || process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!chat) throw new Error("TELEGRAM_CHAT_ID_MISSING");
  const text = buildTelegramText({ title, body, severity });
  const bin = String(process.env.OPENCLAW_BIN || "openclaw").trim() || "openclaw";
  const args = buildOpenClawSendArgs({ chatId: chat, text });
  const { stdout } = await execFileAsync(bin, args, {
    cwd: REPO_ROOT,
    timeout: Number(process.env.OPENCLAW_ALERT_TIMEOUT_MS || OPENCLAW_TIMEOUT_MS),
    maxBuffer: OPENCLAW_MAX_BUFFER,
  });
  const parsed = JSON.parse(String(stdout || "{}"));
  const payload = parsed && parsed.payload ? parsed.payload : {};
  if (payload.ok !== true) {
    throw new Error(`OPENCLAW_SEND_FAILED:${JSON.stringify(parsed)}`);
  }
  return {
    ok: true,
    transport: "openclaw",
    chatId: payload.chatId || chat,
    messageId: payload.messageId || null,
    raw: parsed,
  };
}

async function sendTelegram({ token, chatId, title, body, severity }) {
  const chat = String(chatId || process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!chat) throw new Error("TELEGRAM_CHAT_ID_MISSING");
  const transport = resolveTelegramTransport({ token });
  if (transport !== "api") {
    try {
      return await sendTelegramViaOpenClaw({ chatId: chat, title, body, severity });
    } catch (err) {
      if (
        transport === "openclaw_required"
        || String(process.env.ALERT_OPENCLAW_REQUIRED || "").trim() === "1"
      ) {
        throw err;
      }
    }
  }
  const apiToken = String(token || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!apiToken) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const text = buildTelegramText({ title, body, severity });
  const url = `https://api.telegram.org/bot${apiToken}/sendMessage`;
  const result = await postJson(url, { chat_id: chat, text, disable_web_page_preview: true });
  return { ...result, transport: "telegram_api" };
}

async function sendEmailSendGrid({ to, from, subject, body }) {
  const apiKey = String(process.env.SENDGRID_API_KEY || "").trim();
  const fromAddr = String(from || process.env.ALERT_EMAIL_FROM || "").trim();
  const toAddr = String(to || process.env.ALERT_EMAIL_TO || "").trim();

  if (!apiKey) throw new Error("SENDGRID_API_KEY_MISSING");
  if (!fromAddr) throw new Error("ALERT_EMAIL_FROM_MISSING");
  if (!toAddr) throw new Error("ALERT_EMAIL_TO_MISSING");

  const payload = {
    personalizations: [{ to: toAddr.split(/[;,]/).map((email) => ({ email: email.trim() })).filter((x) => x.email) }],
    from: { email: fromAddr },
    subject,
    content: [{ type: "text/plain", value: body }],
  };

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SENDGRID_HTTP_${res.status}: ${text}`);
  }

  return { ok: true };
}

async function sendAlert({ channel, title, body, severity }) {
  const list = parseChannelList(channel);
  if (!list.length) return { ok: false, reason: "NO_CHANNEL" };

  const results = [];
  for (const raw of list) {
    const c = normalizeChannel(raw);
    if (!c) continue;
    try {
      if (c.type === "slack") {
        results.push({ channel: raw, type: "slack", result: await sendSlack({ url: c.url, title, body, severity }) });
      } else if (c.type === "telegram") {
        results.push({
          channel: raw,
          type: "telegram",
          result: await sendTelegram({ token: c.token, chatId: c.chatId, title, body, severity }),
        });
      } else if (c.type === "email") {
        results.push({
          channel: raw,
          type: "email",
          result: await sendEmailSendGrid({ to: c.to, subject: title, body }),
        });
      } else {
        results.push({ channel: raw, type: "unknown", error: "UNKNOWN_CHANNEL" });
      }
    } catch (e) {
      results.push({ channel: raw, type: c.type, error: e?.message || String(e) });
    }
  }

  const ok = results.some((r) => r.result && r.result.ok);
  return { ok, results };
}

module.exports = {
  sendAlert,
  __test: {
    normalizeTelegramSeverity,
    normalizeTelegramTitle,
    normalizeTelegramBody,
    normalizeTelegramLine,
    normalizeLegacyPriorityTokens,
    resolveV2TelegramRuntimeContext,
    buildTelegramText,
    resolveTelegramTransport,
    buildOpenClawSendArgs,
  },
};
