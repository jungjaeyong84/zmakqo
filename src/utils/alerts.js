const DEFAULT_TIMEOUT_MS = 8000;

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
  if (s === "ERROR") return "오류";
  if (s === "WARN" || s === "WARNING") return "주의";
  if (s === "PASS" || s === "OK" || s === "SUCCESS") return "정상";
  return "알림";
}

function normalizeTelegramLine(line) {
  let out = String(line || "");
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

async function sendTelegram({ token, chatId, title, body, severity }) {
  const apiToken = String(token || process.env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!apiToken) throw new Error("TELEGRAM_BOT_TOKEN_MISSING");
  const chat = String(chatId || process.env.TELEGRAM_CHAT_ID || "").trim();
  if (!chat) throw new Error("TELEGRAM_CHAT_ID_MISSING");
  const normalizedTitle = normalizeTelegramTitle(title, severity);
  const normalizedBody = normalizeTelegramBody(body);
  const text = `${normalizedTitle}\n${normalizedBody}`.trim();
  const url = `https://api.telegram.org/bot${apiToken}/sendMessage`;
  return postJson(url, { chat_id: chat, text, disable_web_page_preview: true });
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
  },
};
