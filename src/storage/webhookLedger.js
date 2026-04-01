const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { normalizeTf } = require("../utils/marketConfig");

function nowIso() {
  return new Date().toISOString();
}

function clipString(v, max = 2000) {
  if (v == null) return null;
  const s = String(v);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…(truncated:${s.length - max})`;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safePayload(payload) {
  if (payload == null) return null;
  let cloned = null;
  try {
    cloned = JSON.parse(JSON.stringify(payload));
  } catch (_) {
    return { _raw: clipString(payload, 4000) };
  }
  if (!cloned || typeof cloned !== "object") return cloned;

  const out = {};
  const entries = Object.entries(cloned);
  for (const [k, v] of entries.slice(0, 120)) {
    if (typeof v === "string") out[k] = clipString(v, 2000);
    else out[k] = v;
  }
  if (entries.length > 120) out._truncated_keys = entries.length - 120;

  if (out.features && typeof out.features === "object") {
    const fOut = {};
    const fEntries = Object.entries(out.features);
    for (const [k, v] of fEntries.slice(0, 120)) {
      if (typeof v === "string") fOut[k] = clipString(v, 2000);
      else fOut[k] = v;
    }
    if (fEntries.length > 120) fOut._truncated_feature_keys = fEntries.length - 120;
    out.features = fOut;
  }

  return out;
}

function buildWebhookRequestId() {
  const ms = Date.now();
  const rnd = crypto.randomBytes(4).toString("hex");
  return `WHK__${ms}__${rnd}`;
}

function hashRaw(rawBody) {
  if (rawBody == null) return null;
  return crypto.createHash("sha256").update(String(rawBody)).digest("hex");
}

function pickHeaders(headers = {}) {
  return {
    user_agent: clipString(headers["user-agent"], 512),
    content_type: clipString(headers["content-type"], 128),
    x_forwarded_for: clipString(headers["x-forwarded-for"], 256),
    x_tradingview_signature: clipString(headers["x-tradingview-signature"], 256),
    x_webhook_token_present: !!headers["x-webhook-token"],
  };
}

function normalizeLedgerExchange(exchange) {
  const ex = String(exchange || "").trim().toUpperCase();
  if (!ex) return "";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return ex;
}

function normalizeLedgerSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase()
    .replace(/\.P$/, "");
}

async function findRecentWebhookSummaryForBar({
  exchange,
  symbol,
  tf,
  barCloseMs,
  lookbackHours = 6,
  limit = 500,
} = {}) {
  const ex = normalizeLedgerExchange(exchange);
  const sym = normalizeLedgerSymbol(symbol);
  const tfNorm = normalizeTf(tf);
  const barMs = Number(barCloseMs);
  if (!ex || !sym || !tfNorm || !Number.isFinite(barMs)) {
    return {
      webhook_seen: false,
      outcome_n: 0,
      top_decision: null,
      top_reason: null,
      decisions: {},
      reasons: {},
    };
  }

  const db = getFirestore();
  const fromIso = new Date(Date.now() - Math.max(1, Number(lookbackHours) || 6) * 60 * 60 * 1000).toISOString();
  const snap = await db.collection("webhook_ledger")
    .where("created_at", ">=", fromIso)
    .orderBy("created_at", "desc")
    .limit(Math.max(50, Number(limit) || 500))
    .get();

  const decisions = {};
  const reasons = {};
  let outcomeN = 0;

  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.stage || "") !== "OUTCOME") return;
    if (normalizeLedgerExchange(x.exchange) !== ex) return;
    if (normalizeLedgerSymbol(x.symbol) !== sym) return;
    if (normalizeTf(x.tf) !== tfNorm) return;
    if (Number(x.bar_close_time_utc_ms) !== barMs) return;
    outcomeN += 1;
    const decision = String(x.decision || "UNKNOWN");
    const reason = String(x.reason || "UNKNOWN");
    decisions[decision] = (decisions[decision] || 0) + 1;
    reasons[reason] = (reasons[reason] || 0) + 1;
  });

  const topDecision = Object.entries(decisions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    webhook_seen: outcomeN > 0,
    outcome_n: outcomeN,
    top_decision: topDecision,
    top_reason: topReason,
    decisions,
    reasons,
  };
}

async function appendWebhookLedger(stage, payload = {}) {
  const db = getFirestore();
  const id = `${payload.request_id || "UNKNOWN"}__${Date.now()}__${stage}__${crypto.randomBytes(3).toString("hex")}`;
  const doc = {
    ...payload,
    stage,
    created_at: nowIso(),
  };
  await db.collection("webhook_ledger").doc(id).set(doc, { merge: false });
}

async function recordWebhookIngress({
  requestId,
  path,
  method,
  headers,
  rawBody,
  parsedBody,
} = {}) {
  const raw = rawBody == null ? null : String(rawBody);
  await appendWebhookLedger("INGRESS", {
    request_id: requestId || buildWebhookRequestId(),
    path: path || "/webhook/signal",
    method: String(method || "POST").toUpperCase(),
    headers: pickHeaders(headers || {}),
    raw_body_sha256: hashRaw(raw),
    raw_body_len: raw == null ? 0 : raw.length,
    raw_body_preview: clipString(raw, 4000),
    parsed_body: safePayload(parsedBody),
  });
}

async function recordWebhookOutcome({
  requestId,
  httpStatus,
  decision,
  reason,
  exchange,
  symbol,
  tf,
  event,
  side,
  action,
  intent,
  qtyPct,
  signalId,
  barCloseMs,
  mappingOk,
  exchangeSideAllowed,
  error,
  detail,
} = {}) {
  await appendWebhookLedger("OUTCOME", {
    request_id: requestId,
    http_status: safeNumber(httpStatus),
    decision: decision || null,
    reason: reason || null,
    exchange: exchange || null,
    symbol: symbol || null,
    tf: tf || null,
    event: event || null,
    side: side || null,
    action: action || null,
    intent: intent || null,
    qty_pct: safeNumber(qtyPct),
    signal_id: signalId || null,
    bar_close_time_utc_ms: safeNumber(barCloseMs),
    mapping_ok: (mappingOk == null ? null : !!mappingOk),
    exchange_side_allowed: (exchangeSideAllowed == null ? null : !!exchangeSideAllowed),
    error: error ? clipString(error, 2000) : null,
    detail: detail ? safePayload(detail) : null,
  });
}

module.exports = {
  buildWebhookRequestId,
  recordWebhookIngress,
  recordWebhookOutcome,
  findRecentWebhookSummaryForBar,
};
