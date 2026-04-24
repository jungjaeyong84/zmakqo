const { getFirestore } = require("../storage/firestore");
const admin = require("firebase-admin");
const { getSystemSettingsForProvider, getAiAllocationSettingsForProvider, getAiGuardSettingsCached } = require("../storage/settings");
const { AI_ALLOCATION_DEFAULTS } = require("../config/aiAllocationDefaults");
const { fetchNews } = require("./newsFetch");
const { callOpenAI, safeJsonParse } = require("./openaiClient");
const { callClaude } = require("./claudeClient");
const {
  buildBatchRequest: buildClaudeBatchRequest,
  submitAndCollect: submitClaudeBatchAndCollect,
  parseResultsAsJson: parseClaudeBatchResultsAsJson,
} = require("./claudeBatchClient");
const {
  buildResponsesBatchRequest,
  submitAndCollectResponses,
  parseResponsesBatchResults,
} = require("./openaiBatchClient");
const { getBinanceFuturesAccountSummary } = require("./binanceFuturesAccountSummary");
const { normalizeProviderId } = require("../utils/providerUtils");
const { getEffectiveExchangesSettings, getExchangeSettingsForProvider, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { defaultMarketsFromEnv, normalizeMarketSymbolForProvider } = require("../utils/marketConfig");
const { pickModelCanary } = require("../utils/modelCanary");
const { sendAlert } = require("../utils/alerts");
const { reasonSummaryKo } = require("../utils/aiReasonKo");

function nowIso() {
  return new Date().toISOString();
}

function toBool(v, fallback = false) {
  if (v === undefined || v === null || v === "") return fallback;
  const s = String(v).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseChannelList(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isTelegramChannel(raw) {
  const v = String(raw || "").trim().toLowerCase();
  return v.startsWith("telegram:") || v.startsWith("tg:") || v.startsWith("telegram://") || v.startsWith("tg://");
}

function filterTelegramChannels(raw) {
  return parseChannelList(raw).filter(isTelegramChannel).join(",");
}

function toPctText(raw, digits = 2) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}

function toNumText(raw, digits = 2) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(digits);
}

function directionKo(dir) {
  const d = normalizeDirection(dir);
  if (d === "long") return "롱우위";
  if (d === "short") return "숏우위";
  return "중립";
}

function modeKo(mode) {
  const m = normalizeMode(mode);
  if (m === "aggressive") return "공격";
  if (m === "conservative") return "보수";
  return "중립";
}

function applyReasonKo(reason) {
  const r = String(reason || "").toUpperCase();
  if (!r) return "정상 적용";
  if (r === "LIVE_MODE_OFF") return "LIVE 모드 비활성";
  if (r === "APPLY_LIVE_DISABLED") return "AI LIVE 적용 OFF";
  if (r === "CONFIRM_REQUIRED") return "LIVE 확인 필요";
  if (r === "FORCE_MODE") return "강제 실행";
  if (r === "DRY_RUN") return "DRY RUN";
  return r;
}

function topMarketsText(mapObj, n = 5) {
  const rows = Object.entries(mapObj || {})
    .map(([market, value]) => ({ market: String(market || "").toUpperCase(), value: Number(value) }))
    .filter((x) => x.market && Number.isFinite(x.value))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
  if (!rows.length) return "-";
  return rows.map((r) => r.market).join(", ");
}

function diffMarketsText(nextMap, curMap, sign = "up", n = 5) {
  const allMarkets = Array.from(new Set([
    ...Object.keys(nextMap || {}),
    ...Object.keys(curMap || {}),
  ]));
  const rows = allMarkets
    .map((market) => {
      const next = Number((nextMap && nextMap[market]) || 0);
      const cur = Number((curMap && curMap[market]) || 0);
      return { market: String(market || "").toUpperCase(), delta: next - cur };
    })
    .filter((x) => x.market && Number.isFinite(x.delta));
  const filtered = sign === "up"
    ? rows.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta)
    : rows.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);
  if (!filtered.length) return "-";
  return filtered.slice(0, n).map((r) => r.market).join(", ");
}

function toKstIso(rawIso) {
  const ms = Date.parse(String(rawIso || ""));
  if (!Number.isFinite(ms)) return "-";
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss} KST`;
}

async function sendAiAllocationSummaryAlert({
  provider,
  runDoc,
  applied,
  applyReason,
  alertChannel,
  executionMode,
}) {
  if (!toBool(process.env.AI_ALLOC_SUMMARY_ALERT_ENABLED, true)) {
    return { ok: false, skipped: true, reason: "DISABLED" };
  }
  const providerNorm = normalizeProviderId(provider || "BINANCEFUT");
  const allowedProviders = parseChannelList(process.env.AI_ALLOC_SUMMARY_ALERT_PROVIDERS || "BINANCEFUT")
    .map((p) => normalizeProviderId(p))
    .filter(Boolean);
  if (allowedProviders.length && !allowedProviders.includes(providerNorm)) {
    return { ok: false, skipped: true, reason: "PROVIDER_FILTERED" };
  }

  let channel = String(process.env.AI_ALLOC_SUMMARY_ALERT_CHANNEL || alertChannel || "").trim();
  if (!channel) return { ok: false, skipped: true, reason: "NO_CHANNEL" };
  if (toBool(process.env.AI_ALLOC_SUMMARY_ALERT_TELEGRAM_ONLY, true)) {
    channel = filterTelegramChannels(channel);
    if (!channel) return { ok: false, skipped: true, reason: "NO_TELEGRAM_CHANNEL" };
  }

  const dir = normalizeDirection(runDoc && runDoc.direction);
  const title = `[AI] ${providerNorm} ${directionKo(dir)} 요약`;
  const bodyLines = [
    `시각: ${toKstIso(runDoc && runDoc.created_at)}`,
    `방향: ${directionKo(dir)} (score ${toNumText(runDoc && runDoc.direction_score)}, conf ${toPctText(runDoc && runDoc.direction_confidence)})`,
    `모드: ${modeKo(runDoc && runDoc.mode)} (conf ${toPctText(runDoc && runDoc.mode_confidence)})`,
    `적용: ${applied ? "APPLIED" : "DRY"} (${applyReasonKo(applyReason)})`,
    `실행모드: ${String(executionMode || "-")}`,
    `요약(KO): ${reasonSummaryKo(runDoc && runDoc.mode_reason)}`,
  ];

  return sendAlert({
    channel,
    title,
    body: bodyLines.join("\n"),
    severity: "INFO",
  });
}

function resolveApplyReason({ apply, applyLive, liveOk, confirmRequired, force }) {
  if (!apply) return "DRY_RUN";
  if (!applyLive) return "APPLY_LIVE_DISABLED";
  if (force) return "FORCE_MODE";
  if (!liveOk) return "LIVE_MODE_OFF";
  if (confirmRequired) return "CONFIRM_REQUIRED";
  return "SKIPPED";
}

function buildRecommendationGroups(provider) {
  return {
    large_sector: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
    growth: ["ADAUSDT", "AVAXUSDT", "LTCUSDT", "LINKUSDT", "ATOMUSDT"],
    momentum: ["DOGEUSDT", "PEPEUSDT", "SHIBUSDT", "ARBUSDT", "OPUSDT"],
  };
}

function normalizeGroupMarkets(groups, provider) {
  const out = {};
  for (const [k, arr] of Object.entries(groups || {})) {
    const list = Array.isArray(arr) ? arr : [];
    out[k] = list
      .map((m) => normalizeMarketSymbolForProvider(m, provider))
      .filter(Boolean)
      .slice(0, 5);
  }
  return out;
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function boolEnv(name, fallback = null) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  if (!s) return fallback;
  return !(s === "0" || s === "false" || s === "no" || s === "off");
}

function modeToScore(mode) {
  const m = normalizeMode(mode);
  if (m === "aggressive") return 1;
  if (m === "conservative") return -1;
  return 0;
}

function scoreToMode(score) {
  const s = clamp(Number(score), -1, 1) ?? 0;
  if (s >= 0.25) return "aggressive";
  if (s <= -0.25) return "conservative";
  return "neutral";
}

function directionToScore(direction) {
  const d = normalizeDirection(direction);
  if (d === "long") return 1;
  if (d === "short") return -1;
  return 0;
}

function scoreToDirection(score, neutralThreshold = 0.1) {
  const s = clamp(Number(score), -1, 1) ?? 0;
  if (Math.abs(s) < Math.max(0, Number(neutralThreshold) || 0)) return "neutral";
  return s > 0 ? "long" : "short";
}

function safeWeight(v, fallback = 0.5) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function combineModeDecisions({
  gpt,
  claude,
  wGptRaw,
  wClaudeRaw,
  neutralThreshold,
}) {
  const wGpt0 = safeWeight(wGptRaw, AI_ALLOCATION_DEFAULTS.ensemble_w_gpt);
  const wClaude0 = safeWeight(wClaudeRaw, AI_ALLOCATION_DEFAULTS.ensemble_w_claude);
  const wSum = (wGpt0 + wClaude0) > 0 ? (wGpt0 + wClaude0) : 1;
  const wGpt = wGpt0 / wSum;
  const wClaude = wClaude0 / wSum;

  const gptModeConf = clamp(Number(gpt && gpt.confidence), 0, 1) ?? 1;
  const claudeModeConf = clamp(Number(claude && claude.confidence), 0, 1) ?? 1;
  const gptModeScore = modeToScore(gpt && gpt.mode) * gptModeConf;
  const claudeModeScore = modeToScore(claude && claude.mode) * claudeModeConf;
  const modeScore = (wGpt * gptModeScore) + (wClaude * claudeModeScore);
  const mode = scoreToMode(modeScore);

  const gptDirConf = clamp(Number(gpt && gpt.direction_confidence), 0, 1);
  const claudeDirConf = clamp(Number(claude && claude.direction_confidence), 0, 1);
  const gptDirScoreBase = Number.isFinite(Number(gpt && gpt.direction_score))
    ? Number(gpt.direction_score)
    : directionToScore(gpt && gpt.direction);
  const claudeDirScoreBase = Number.isFinite(Number(claude && claude.direction_score))
    ? Number(claude.direction_score)
    : directionToScore(claude && claude.direction);
  const gptDirScore = (clamp(gptDirScoreBase, -1, 1) ?? 0) * (Number.isFinite(gptDirConf) ? gptDirConf : 1);
  const claudeDirScore = (clamp(claudeDirScoreBase, -1, 1) ?? 0) * (Number.isFinite(claudeDirConf) ? claudeDirConf : 1);
  const directionScore = (wGpt * gptDirScore) + (wClaude * claudeDirScore);
  const direction = scoreToDirection(directionScore, neutralThreshold);

  const modeConfidence = clamp(Math.abs(modeScore), 0, 1);
  const directionConfidence = clamp(Math.abs(directionScore), 0, 1);

  return {
    mode,
    confidence: modeConfidence,
    direction,
    direction_confidence: directionConfidence,
    direction_score: clamp(directionScore, -1, 1) ?? 0,
    ensemble_mode_score: modeScore,
    ensemble_direction_score: directionScore,
    ensemble_w_gpt: wGpt,
    ensemble_w_claude: wClaude,
  };
}

function buildEffectiveModeReason({ gptParsed, claudeParsed, gptReason, claudeReason, ensembleUsed }) {
  const sanitize = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return "";
    if (text === "GPT_BATCH_OK" || text === "CLAUDE_BATCH_OK") return "";
    return text;
  };
  const gptText = sanitize(gptParsed && gptParsed.reason);
  const claudeText = sanitize(claudeParsed && claudeParsed.reason);
  const gptFallback = sanitize(gptReason);
  const claudeFallback = sanitize(claudeReason);
  if (ensembleUsed) {
    const parts = [gptText, claudeText].filter(Boolean);
    if (parts.length) return parts.join(" | ");
    return [gptFallback, claudeFallback].filter(Boolean).join("|") || null;
  }
  return gptText || claudeText || gptFallback || claudeFallback || null;
}

function normalizeRunHours(raw) {
  if (raw === null || raw === undefined || raw === "") return [];
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "string") {
    list = raw.split(/[\s,]+/);
  } else {
    list = [raw];
  }
  const hours = [];
  for (const v of list) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const h = Math.trunc(n);
    if (h < 0 || h > 23) continue;
    if (!hours.includes(h)) hours.push(h);
  }
  return hours.sort((a, b) => a - b);
}

function normalizeRunMinute(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(0, Math.min(59, Math.trunc(Number(fallback) || 0)));
  const m = Math.trunc(n);
  if (m < 0) return 0;
  if (m > 59) return 59;
  return m;
}

function resolveRunHours({ provider, runHoursRaw, runHourRaw }) {
  const explicit = normalizeRunHours(runHoursRaw);
  if (explicit.length) return explicit;
  const runHour = Number(runHourRaw);
  const p = String(provider || "").toUpperCase();
  const isBinance = p === "BINANCEFUT" || p === "BINANCE";
  if (isBinance) {
    if (Number.isFinite(runHour)) {
      const base = Math.trunc(runHour);
      const alt = (base + 12) % 24;
      if (base === alt) return [base];
      return base < alt ? [base, alt] : [alt, base];
    }
    return [7, 19];
  }
  if (Number.isFinite(runHour)) return [Math.trunc(runHour)];
  return [];
}

function mean(arr) {
  if (!arr.length) return null;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return null;
  const m = mean(arr);
  if (m == null) return null;
  const v = mean(arr.map((x) => (x - m) ** 2));
  return v == null ? null : Math.sqrt(v);
}

function computeVol(closeSeries) {
  if (!Array.isArray(closeSeries) || closeSeries.length < 3) return null;
  const returns = [];
  for (let i = 1; i < closeSeries.length; i += 1) {
    const prev = closeSeries[i - 1];
    const cur = closeSeries[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    returns.push((cur / prev) - 1);
  }
  return stddev(returns);
}

function normalizeMode(x) {
  const s = String(x || "").toLowerCase();
  if (s.includes("agg")) return "aggressive";
  if (s.includes("cons")) return "conservative";
  return "neutral";
}

function normalizeDirection(x) {
  const s = String(x || "").trim().toLowerCase();
  if (!s) return "neutral";
  if (s.includes("long") || s.includes("bull") || s === "up") return "long";
  if (s.includes("short") || s.includes("bear") || s === "down") return "short";
  return "neutral";
}

function clampOrDefault(v, min, max, fallback) {
  const n = clamp(Number(v), min, max);
  return n == null ? fallback : n;
}

function buildSideAllocation({ modeInfo, aiCfg }) {
  const directionalEnabled = aiCfg.directional_enabled !== false;
  const maxTilt = clampOrDefault(aiCfg.side_bias_max_tilt, 0, 0.9, AI_ALLOCATION_DEFAULTS.side_bias_max_tilt);
  const neutralThreshold = clampOrDefault(
    aiCfg.side_bias_neutral_threshold,
    0,
    0.5,
    AI_ALLOCATION_DEFAULTS.side_bias_neutral_threshold
  );
  const minConfidence = clampOrDefault(
    aiCfg.side_bias_min_confidence,
    0,
    1,
    AI_ALLOCATION_DEFAULTS.side_bias_min_confidence
  );
  const sideScaleMin = clampOrDefault(aiCfg.side_scale_min, 0.1, 1.0, AI_ALLOCATION_DEFAULTS.side_scale_min);
  const sideScaleMax = clampOrDefault(
    aiCfg.side_scale_max,
    Math.max(1.0, sideScaleMin),
    3.0,
    AI_ALLOCATION_DEFAULTS.side_scale_max
  );

  const dir = normalizeDirection(modeInfo && modeInfo.direction);
  let score = Number(modeInfo && modeInfo.direction_score);
  const dirConf = clamp(Number(modeInfo && modeInfo.direction_confidence), 0, 1);
  const modeConf = clamp(Number((modeInfo && modeInfo.mode_confidence) ?? (modeInfo && modeInfo.confidence)), 0, 1);

  if (!Number.isFinite(score)) {
    if (dir === "long") score = 1;
    else if (dir === "short") score = -1;
    else score = 0;
  }
  score = clamp(score, -1, 1) ?? 0;
  const confApplied = Number.isFinite(dirConf) && Number.isFinite(modeConf)
    ? Math.min(dirConf, modeConf)
    : (Number.isFinite(dirConf) ? dirConf : (Number.isFinite(modeConf) ? modeConf : 1));
  score *= confApplied;
  if (!directionalEnabled || confApplied < minConfidence || Math.abs(score) < neutralThreshold) {
    score = 0;
  }

  const tilt = clamp(score * maxTilt, -maxTilt, maxTilt) ?? 0;
  const longScale = clamp(1 + tilt, sideScaleMin, sideScaleMax) ?? 1;
  const shortScale = clamp(1 - tilt, sideScaleMin, sideScaleMax) ?? 1;

  const lw = Math.max(0.0001, longScale);
  const sw = Math.max(0.0001, shortScale);
  const sum = lw + sw;
  const longPct = lw / sum;
  const shortPct = sw / sum;

  let bias = "neutral";
  if (score > 0) bias = "long";
  else if (score < 0) bias = "short";

  return {
    enabled: directionalEnabled,
    bias_direction: bias,
    bias_score: score,
    bias_confidence: confApplied,
    max_tilt: maxTilt,
    neutral_threshold: neutralThreshold,
    min_confidence: minConfidence,
    long_scale: longScale,
    short_scale: shortScale,
    long_pct: longPct,
    short_pct: shortPct,
    source: "ai_allocation",
    updated_at: nowIso(),
  };
}

function normalizeMarketToken(raw) {
  const s = String(raw || "").toUpperCase();
  if (!s) return null;
  const v = s.replace("KRW-", "").replace("USDT", "").replace(".P", "");
  const token = v.replace(/[^A-Z0-9]/g, "").trim();
  return token || null;
}

function buildNewsKeywords(markets) {
  const marketTokens = (markets || [])
    .map(normalizeMarketToken)
    .filter(Boolean)
    .slice(0, 3);
  const core = ["crypto", "bitcoin", "ethereum"];
  const macro = [
    "fed",
    "interest rates",
    "inflation",
    "USD",
    "Treasury yields",
    "Nasdaq",
    "S&P 500",
    "credit spreads",
    "oil",
    "tariffs",
    "ETF flows",
  ];
  const merged = [
    ...core,
    ...marketTokens,
    ...macro,
    "altcoin",
    "blockchain",
    "dollar",
    "equity",
    "recession",
  ];
  const uniq = [];
  for (const k of merged) {
    const key = String(k || "").trim().toLowerCase();
    if (!key || uniq.includes(key)) continue;
    uniq.push(key);
  }
  return uniq;
}

function buildNewsKeywordsForProvider(provider, markets) {
  return buildNewsKeywords(markets);
}

function buildNewsPrompt(provider, headlines) {
  return [
    "You are a risk-aware quant assistant.",
    "Given the last 7 days of crypto + global macro headlines, decide market risk mode and directional bias.",
    "Focus on how macro (rates, USD, equities, credit, oil) impacts crypto risk-on/off.",
    "- aggressive, neutral, or conservative",
    "- direction: long, short, or neutral",
    "Return JSON only: {\"mode\":\"aggressive|neutral|conservative\",\"confidence\":0-1,\"direction\":\"long|short|neutral\",\"direction_confidence\":0-1,\"direction_score\":-1..1,\"reason\":\"short\"}",
    "",
    "Headlines:",
    headlines,
  ].join("\n");
}

function buildNewsFilterPrompt(provider, headlines) {
  const lines = (Array.isArray(headlines) ? headlines : []).map((h, i) => `${i + 1}. ${String(h || "").trim()}`).filter(Boolean);
  return [
    "You are a strict news relevance filter for crypto.",
    "Task: keep only headlines with direct market impact in the next 24-72 hours.",
    "Drop generic, duplicate, old, promotional, or weak-signal headlines.",
    "Return JSON only: {\"keep_indices\":[1,2,...],\"reason\":\"short\"}",
    "",
    "Headlines:",
    lines.join("\n"),
  ].join("\n");
}

function parseNewsFilterDecision(text, headlines) {
  const src = Array.isArray(headlines) ? headlines : [];
  const parsed = safeJsonParse(text) || parseJsonObjectFromText(text) || {};
  const keep = [];
  const byIdxRaw = Array.isArray(parsed.keep_indices) ? parsed.keep_indices : [];
  for (const v of byIdxRaw) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    let idx = Math.trunc(n);
    if (idx >= 1 && idx <= src.length) idx -= 1; // 1-based
    if (idx >= 0 && idx < src.length) keep.push(src[idx]);
  }
  const byTitleRaw = Array.isArray(parsed.keep_titles) ? parsed.keep_titles : [];
  for (const t of byTitleRaw) {
    const q = String(t || "").trim();
    if (!q) continue;
    const found = src.find((x) => String(x || "").trim() === q || String(x || "").includes(q));
    if (found) keep.push(found);
  }
  const uniq = [];
  for (const h of keep) {
    const k = String(h || "").trim();
    if (!k || uniq.includes(k)) continue;
    uniq.push(k);
  }
  const reason = String(parsed.reason || "").trim() || null;
  return { keep_headlines: uniq, reason };
}

function buildEventAnalysisPrompt(provider, headlines) {
  return [
    "You are an event analyst for crypto macro.",
    "Identify dominant risk events from headlines and map to market regime and direction.",
    "Return JSON only: {\"mode\":\"aggressive|neutral|conservative\",\"confidence\":0-1,\"direction\":\"long|short|neutral\",\"direction_confidence\":0-1,\"direction_score\":-1..1,\"reason\":\"short\"}",
    "",
    "Headlines:",
    headlines,
  ].join("\n");
}

function buildImpactAnalysisPrompt(provider, headlines) {
  return [
    "You are a market impact analyst for crypto.",
    "Estimate next 24-72h market impact from headlines, emphasizing direction and confidence.",
    "Return JSON only: {\"mode\":\"aggressive|neutral|conservative\",\"confidence\":0-1,\"direction\":\"long|short|neutral\",\"direction_confidence\":0-1,\"direction_score\":-1..1,\"reason\":\"short\"}",
    "",
    "Headlines:",
    headlines,
  ].join("\n");
}

function parseJsonObjectFromText(raw) {
  const src = String(raw || "");
  if (!src.trim()) return null;

  const fenced = src.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const parsedFence = safeJsonParse(fenced[1].trim());
    if (parsedFence && typeof parsedFence === "object") return parsedFence;
  }

  let start = src.indexOf("{");
  while (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < src.length; i += 1) {
      const ch = src[i];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === "\"") {
          inStr = false;
        }
        continue;
      }
      if (ch === "\"") {
        inStr = true;
        continue;
      }
      if (ch === "{") depth += 1;
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = src.slice(start, i + 1);
          const parsed = safeJsonParse(candidate);
          if (parsed && typeof parsed === "object") return parsed;
          break;
        }
      }
    }
    start = src.indexOf("{", start + 1);
  }

  return null;
}

function parseGptMode(text) {
  const parsed = safeJsonParse(text) || parseJsonObjectFromText(text);
  if (!parsed) return null;
  const mode = normalizeMode(parsed.mode || parsed.market_mode || parsed.risk_mode);
  const confidence = Number(parsed.confidence);
  const direction = normalizeDirection(parsed.direction || parsed.bias_direction || parsed.market_direction);
  const directionConfidence = Number(parsed.direction_confidence);
  let directionScore = Number(parsed.direction_score);
  if (!Number.isFinite(directionScore)) {
    const longProb = Number(parsed.long_probability);
    const shortProb = Number(parsed.short_probability);
    if (Number.isFinite(longProb) && Number.isFinite(shortProb)) {
      directionScore = clamp(longProb - shortProb, -1, 1);
    }
  }
  const reason = String(parsed.reason || parsed.rationale || "").trim();
  return {
    mode,
    confidence: Number.isFinite(confidence) ? confidence : null,
    direction,
    direction_confidence: Number.isFinite(directionConfidence) ? (clamp(directionConfidence, 0, 1) ?? directionConfidence) : null,
    direction_score: Number.isFinite(directionScore) ? (clamp(directionScore, -1, 1) ?? directionScore) : null,
    reason: reason || null,
  };
}

async function loadMarketBars(db, markets, limit) {
  const snap = await db.collection("bars_snapshots")
    .select("symbol", "symbol_or_pair_id", "ohlcv_json", "created_at")
    .orderBy("created_at", "desc")
    .limit(limit)
    .get();
  const byMarket = {};
  for (const mk of markets) byMarket[mk] = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const mk = x.symbol || x.symbol_or_pair_id;
    if (!mk || !byMarket[mk]) return;
    const o = x.ohlcv_json || {};
    const close = Number(o.close);
    if (!Number.isFinite(close)) return;
    byMarket[mk].push(close);
  });
  for (const mk of markets) {
    byMarket[mk].reverse();
  }
  return byMarket;
}

function buildWeights(markets, volByMarket) {
  const weights = {};
  let sum = 0;
  for (const mk of markets) {
    const v = volByMarket[mk];
    const w = Number.isFinite(v) && v > 0 ? (1 / v) : 1;
    weights[mk] = w;
    sum += w;
  }
  if (!Number.isFinite(sum) || sum <= 0) {
    const eq = 1 / Math.max(1, markets.length);
    for (const mk of markets) weights[mk] = eq;
    return weights;
  }
  for (const mk of markets) weights[mk] = weights[mk] / sum;
  return weights;
}

function applyBudgetConstraints({ markets, weights, baseTotal, minKrw, maxKrw, maxChangePct, currentByMarket }) {
  const list = Array.isArray(markets) ? markets : [];
  if (!list.length) return {};

  const total = Number(baseTotal);
  if (!Number.isFinite(total) || total <= 0) {
    const zeroed = {};
    for (const mk of list) zeroed[mk] = 0;
    return zeroed;
  }

  // Safety clamp: prevent per-market min from exceeding feasible total allocation.
  const perMarketFeasible = total / Math.max(1, list.length);
  let minVal = Number(minKrw);
  if (!Number.isFinite(minVal) || minVal < 0) minVal = 0;
  minVal = Math.min(minVal, perMarketFeasible);

  let maxVal = Number(maxKrw);
  if (!Number.isFinite(maxVal) || maxVal <= 0) maxVal = total;
  maxVal = Math.max(minVal, Math.min(maxVal, total));

  const targetRaw = {};
  let sum = 0;
  for (const mk of list) {
    const raw = total * (weights[mk] || 0);
    const clamped = clamp(raw, minVal, maxVal);
    const cur = Number(currentByMarket[mk] || 0) || null;
    let final = clamped;
    if (cur && Number.isFinite(maxChangePct)) {
      const min = cur * (1 - maxChangePct);
      const max = cur * (1 + maxChangePct);
      final = clamp(clamped, min, max);
    }
    const safe = Number.isFinite(Number(final)) ? Math.max(0, Number(final)) : 0;
    targetRaw[mk] = safe;
    sum += safe;
  }

  // Hard cap total to baseTotal even when min/max/change constraints interact badly.
  if (sum > total && sum > 0) {
    const scale = total / sum;
    for (const mk of list) targetRaw[mk] = targetRaw[mk] * scale;
  }

  const target = {};
  let roundedSum = 0;
  for (const mk of list) {
    const v = Math.round(targetRaw[mk] || 0);
    target[mk] = v;
    roundedSum += v;
  }

  const totalRounded = Math.round(total);
  if (roundedSum > totalRounded) {
    let excess = roundedSum - totalRounded;
    const sorted = [...list].sort((a, b) => (target[b] || 0) - (target[a] || 0));
    for (const mk of sorted) {
      if (excess <= 0) break;
      if ((target[mk] || 0) <= 0) continue;
      const cut = Math.min(excess, target[mk]);
      target[mk] -= cut;
      excess -= cut;
    }
  }

  return target;
}

async function getNewsMode({
  provider,
  keywords,
  windowDays,
  gptEnabled,
  gptModel,
  gptModelRouter,
  gptModelPro,
  routerConfThreshold,
  gptTemp,
  gptKey,
  newsLanguage,
  claudeEnabled,
  claudeModel,
  claudeCanaryModel,
  claudeCanaryPct,
  claudeKey,
  claudeTimeoutMs,
  ensembleEnabled,
  ensembleWGpt,
  ensembleWClaude,
  ensembleNeutralThreshold,
}) {
  const newsProvider = String(process.env.NEWS_PROVIDER || "gdelt");
  const apiKey = (newsProvider.toLowerCase().startsWith("openai"))
    ? String(process.env.OPENAI_API_KEY || gptKey || "")
    : String(process.env.NEWS_API_KEY || "");
  const newsModel = String(process.env.NEWS_WEB_MODEL || "gpt-5.2");
  const now = new Date();
  const from = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const news = await fetchNews({
    apiKey,
    keywords,
    fromIso: from.toISOString(),
    toIso: now.toISOString(),
    pageSize: 80,
    provider: newsProvider,
    language: newsLanguage,
    model: newsModel,
  });

  const newsMeta = {
    news_provider: news.provider || newsProvider,
    news_reason: news.reason || null,
    news_cached: news.cached === true,
  };

  const headlines = news.articles.slice(0, 40).map((a) => `- ${a.title}`).join("\n");
  const gptAttempted = gptEnabled && !!headlines;
  const claudeAttempted = !!(claudeEnabled && claudeKey && headlines);
  const claudeModelPick = pickModelCanary({
    primaryModel: claudeModel,
    canaryModel: claudeCanaryModel,
    canaryPct: claudeCanaryPct,
    key: `${provider || ""}|${from.toISOString().slice(0, 13)}`,
  });
  const claudeModelUsed = claudeModelPick.model || claudeModel;
  if (!gptAttempted && !claudeAttempted) {
    return {
      mode: "neutral",
      confidence: null,
      direction: "neutral",
      direction_confidence: null,
      direction_score: 0,
      reason: news.ok ? "NO_MODEL_OR_EMPTY_NEWS" : (news.reason || "NO_NEWS"),
      news_ok: news.ok,
      news_count: news.articles.length,
      gpt_ok: false,
      gpt_attempted: gptAttempted,
      claude_ok: false,
      claude_attempted: claudeAttempted,
      claude_model: claudeModelUsed || null,
      claude_model_primary: claudeModel || null,
      claude_model_canary: claudeCanaryModel || null,
      claude_canary_pct: Number.isFinite(Number(claudeCanaryPct)) ? Math.max(0, Math.min(1, Number(claudeCanaryPct))) : 0,
      claude_canary_used: claudeModelPick.canary_used === true,
      ensemble_enabled: ensembleEnabled === true,
      ensemble_used: false,
      ensemble_batch_enabled: toBool(process.env.AI_ALLOC_ENSEMBLE_BATCH_ENABLED, false),
      ensemble_batch_used: false,
      ensemble_batch_timeout_ms: Number(process.env.AI_ALLOC_ENSEMBLE_BATCH_TIMEOUT_MS || 1_500_000),
      ensemble_batch_reason: "NOT_APPLICABLE",
      ...newsMeta,
    };
  }

  const prompt = buildNewsPrompt(provider, headlines);

  const routerModel = gptModelRouter || gptModel;
  const proModel = gptModelPro || gptModel;
  const threshold = Number.isFinite(routerConfThreshold) ? routerConfThreshold : 0.6;
  let gptParsed = null;
  let gptReason = "GPT_DISABLED";
  let gptModelUsed = null;
  let routerParsed = null;
  let routerOk = false;
  let claudeParsed = null;
  let claudeReason = "CLAUDE_DISABLED";
  const batchEnabled = toBool(process.env.AI_ALLOC_ENSEMBLE_BATCH_ENABLED, false);
  const batchTimeoutMsRaw = Number(process.env.AI_ALLOC_ENSEMBLE_BATCH_TIMEOUT_MS || 1_500_000);
  const batchTimeoutMs = Number.isFinite(batchTimeoutMsRaw) ? Math.max(60_000, Math.min(3_600_000, Math.floor(batchTimeoutMsRaw))) : 1_500_000;
  const batchPollMsRaw = Number(process.env.AI_ALLOC_ENSEMBLE_BATCH_POLL_MS || 15_000);
  const batchPollMs = Number.isFinite(batchPollMsRaw) ? Math.max(3_000, Math.min(60_000, Math.floor(batchPollMsRaw))) : 15_000;
  let batchUsed = false;
  let batchReason = null;

  if (batchEnabled && gptAttempted && claudeAttempted && gptKey && claudeKey) {
    batchUsed = true;
    const temp = Number.isFinite(Number(gptTemp)) ? Number(gptTemp) : 0.2;
    const [claudeBatchRes, gptBatchRes] = await Promise.all([
      submitClaudeBatchAndCollect(
        claudeKey,
        [buildClaudeBatchRequest("ai_alloc_claude", {
          model: claudeModelUsed,
          prompt,
          temperature: temp,
          maxTokens: 300,
          jsonMode: true,
          cacheSystem: false,
        })],
        { timeoutMs: batchTimeoutMs, intervalMs: batchPollMs }
      ),
      submitAndCollectResponses(
        gptKey,
        [buildResponsesBatchRequest("ai_alloc_openai", {
          model: proModel,
          prompt,
          temperature: temp,
          maxTokens: 300,
          jsonMode: true,
        })],
        { timeoutMs: batchTimeoutMs, pollIntervalMs: batchPollMs }
      ),
    ]);

    if (claudeBatchRes.ok) {
      const rows = parseClaudeBatchResultsAsJson(claudeBatchRes.succeeded || []);
      const row = rows.find((r) => r.custom_id === "ai_alloc_claude");
      const parsed = row && row.data ? parseGptMode(JSON.stringify(row.data)) : null;
      if (parsed) {
        claudeParsed = parsed;
        claudeReason = "CLAUDE_BATCH_OK";
      } else {
        claudeReason = row && row.parse_error ? "CLAUDE_BATCH_PARSE_FAIL" : "CLAUDE_BATCH_EMPTY";
      }
    } else {
      claudeReason = `CLAUDE_BATCH_FAIL:${claudeBatchRes.error || "UNKNOWN"}`;
    }

    if (gptBatchRes.ok) {
      const rows = parseResponsesBatchResults(gptBatchRes.results || []);
      const row = rows.find((r) => r.custom_id === "ai_alloc_openai");
      const parsed = row && row.data ? parseGptMode(JSON.stringify(row.data)) : null;
      if (parsed) {
        gptParsed = parsed;
        gptReason = "GPT_BATCH_OK";
        gptModelUsed = proModel;
      } else if (row && row.error) {
        gptReason = "GPT_BATCH_ROW_ERROR";
      } else {
        gptReason = "GPT_BATCH_PARSE_FAIL";
      }
    } else {
      gptReason = `GPT_BATCH_FAIL:${gptBatchRes.error || "UNKNOWN"}`;
    }
    batchReason = `${gptReason}|${claudeReason}`;
  }

  if (gptAttempted && !gptParsed) {
    const router = await callOpenAI({
      apiKey: gptKey,
      model: routerModel,
      prompt,
      temperature: gptTemp,
      maxTokens: 300,
    });
    routerParsed = router.ok ? parseGptMode(router.text) : null;
    routerOk = !!(routerParsed && Number.isFinite(routerParsed.confidence));
    if (routerParsed && routerParsed.confidence >= threshold) {
      gptParsed = routerParsed;
      gptReason = routerParsed.reason || "ROUTER_OK";
      gptModelUsed = routerModel;
    } else {
      const gpt = await callOpenAI({
        apiKey: gptKey,
        model: proModel,
        prompt,
        temperature: gptTemp,
        maxTokens: 300,
      });
      gptParsed = gpt.ok ? parseGptMode(gpt.text) : null;
      gptReason = gptParsed ? (gptParsed.reason || "GPT_OK") : (gpt.reason || "GPT_FAILED");
      gptModelUsed = proModel;
    }
  }

  if (claudeAttempted && !claudeParsed) {
    const claudeCall = callClaude({
      apiKey: claudeKey,
      model: claudeModelUsed,
      prompt,
      temperature: gptTemp,
      maxTokens: 300,
      jsonMode: true,
    });
    const claudeRes = await Promise.race([
      claudeCall,
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, reason: "TIMEOUT" }), Number(claudeTimeoutMs) || 8000)),
    ]);
    claudeParsed = claudeRes && claudeRes.ok ? parseGptMode(claudeRes.text) : null;
      claudeReason = claudeParsed ? (claudeParsed.reason || "CLAUDE_OK") : (claudeRes && claudeRes.reason ? claudeRes.reason : "CLAUDE_FAILED");
  }

  const gptOk = !!gptParsed;
  const claudeOk = !!claudeParsed;
  const ensembleActive = ensembleEnabled === true && gptOk && claudeOk;
  if (ensembleActive) {
    const combined = combineModeDecisions({
      gpt: gptParsed,
      claude: claudeParsed,
      wGptRaw: ensembleWGpt,
      wClaudeRaw: ensembleWClaude,
      neutralThreshold: ensembleNeutralThreshold,
    });
    return {
      ...combined,
      reason: buildEffectiveModeReason({
        gptParsed,
        claudeParsed,
        gptReason,
        claudeReason,
        ensembleUsed: true,
      }),
      news_ok: news.ok,
      news_count: news.articles.length,
      gpt_ok: gptOk,
      gpt_attempted: gptAttempted,
      gpt_model: gptModelUsed,
      gpt_reason: gptReason,
      gpt_mode: gptParsed.mode,
      gpt_direction: gptParsed.direction || "neutral",
      gpt_direction_score: gptParsed.direction_score ?? null,
      claude_ok: claudeOk,
      claude_attempted: claudeAttempted,
      claude_model: claudeModelUsed || null,
      claude_model_primary: claudeModel || null,
      claude_model_canary: claudeCanaryModel || null,
      claude_canary_pct: Number.isFinite(Number(claudeCanaryPct)) ? Math.max(0, Math.min(1, Number(claudeCanaryPct))) : 0,
      claude_canary_used: claudeModelPick.canary_used === true,
      claude_reason: claudeReason,
      claude_mode: claudeParsed.mode,
      claude_direction: claudeParsed.direction || "neutral",
      claude_direction_score: claudeParsed.direction_score ?? null,
      router_ok: routerOk,
      router_confidence: routerParsed ? routerParsed.confidence : null,
      router_model: routerModel,
      final_model: `${gptModelUsed || "gpt"}+${claudeModelUsed || "claude"}`,
      ensemble_enabled: true,
      ensemble_used: true,
      ensemble_batch_enabled: batchEnabled,
      ensemble_batch_used: batchUsed,
      ensemble_batch_timeout_ms: batchEnabled ? batchTimeoutMs : null,
      ensemble_batch_reason: batchReason,
      ...newsMeta,
    };
  }

  if (gptOk) {
    return {
      mode: gptParsed.mode,
      confidence: gptParsed.confidence,
      direction: gptParsed.direction || "neutral",
      direction_confidence: gptParsed.direction_confidence ?? null,
      direction_score: gptParsed.direction_score ?? null,
      reason: buildEffectiveModeReason({ gptParsed, claudeParsed, gptReason, claudeReason, ensembleUsed: false }),
      news_ok: news.ok,
      news_count: news.articles.length,
      gpt_ok: true,
      gpt_attempted: gptAttempted,
      gpt_model: gptModelUsed,
      claude_ok: claudeOk,
      claude_attempted: claudeAttempted,
      claude_model: claudeModelUsed || null,
      claude_model_primary: claudeModel || null,
      claude_model_canary: claudeCanaryModel || null,
      claude_canary_pct: Number.isFinite(Number(claudeCanaryPct)) ? Math.max(0, Math.min(1, Number(claudeCanaryPct))) : 0,
      claude_canary_used: claudeModelPick.canary_used === true,
      claude_reason: claudeReason,
      router_ok: routerOk,
      router_confidence: routerParsed ? routerParsed.confidence : null,
      router_model: routerModel,
      final_model: gptModelUsed,
      ensemble_enabled: ensembleEnabled === true,
      ensemble_used: false,
      ensemble_batch_enabled: batchEnabled,
      ensemble_batch_used: batchUsed,
      ensemble_batch_timeout_ms: batchEnabled ? batchTimeoutMs : null,
      ensemble_batch_reason: batchReason,
      ...newsMeta,
    };
  }

  if (claudeOk) {
    return {
      mode: claudeParsed.mode,
      confidence: claudeParsed.confidence,
      direction: claudeParsed.direction || "neutral",
      direction_confidence: claudeParsed.direction_confidence ?? null,
      direction_score: claudeParsed.direction_score ?? null,
      reason: buildEffectiveModeReason({ gptParsed, claudeParsed, gptReason, claudeReason, ensembleUsed: false }),
      news_ok: news.ok,
      news_count: news.articles.length,
      gpt_ok: false,
      gpt_attempted: gptAttempted,
      gpt_reason: gptReason,
      claude_ok: true,
      claude_attempted: claudeAttempted,
      claude_model: claudeModelUsed || null,
      claude_model_primary: claudeModel || null,
      claude_model_canary: claudeCanaryModel || null,
      claude_canary_pct: Number.isFinite(Number(claudeCanaryPct)) ? Math.max(0, Math.min(1, Number(claudeCanaryPct))) : 0,
      claude_canary_used: claudeModelPick.canary_used === true,
      router_ok: routerOk,
      router_confidence: routerParsed ? routerParsed.confidence : null,
      router_model: routerModel,
      final_model: claudeModelUsed || "claude",
      ensemble_enabled: ensembleEnabled === true,
      ensemble_used: false,
      ensemble_batch_enabled: batchEnabled,
      ensemble_batch_used: batchUsed,
      ensemble_batch_timeout_ms: batchEnabled ? batchTimeoutMs : null,
      ensemble_batch_reason: batchReason,
      ...newsMeta,
    };
  }

  return {
    mode: "neutral",
    confidence: null,
    direction: "neutral",
    direction_confidence: null,
    direction_score: 0,
    reason: buildEffectiveModeReason({ gptParsed, claudeParsed, gptReason, claudeReason, ensembleUsed: false }),
    news_ok: news.ok,
    news_count: news.articles.length,
    gpt_ok: false,
    gpt_attempted: gptAttempted,
    gpt_reason: gptReason,
    claude_ok: false,
    claude_attempted: claudeAttempted,
    claude_model: claudeModelUsed || null,
    claude_model_primary: claudeModel || null,
    claude_model_canary: claudeCanaryModel || null,
    claude_canary_pct: Number.isFinite(Number(claudeCanaryPct)) ? Math.max(0, Math.min(1, Number(claudeCanaryPct))) : 0,
    claude_canary_used: claudeModelPick.canary_used === true,
    claude_reason: claudeReason,
    router_ok: routerOk,
    router_confidence: routerParsed ? routerParsed.confidence : null,
    router_model: routerModel,
    final_model: gptAttempted ? proModel : (claudeModelUsed || null),
    ensemble_enabled: ensembleEnabled === true,
    ensemble_used: false,
    ensemble_batch_enabled: batchEnabled,
    ensemble_batch_used: batchUsed,
    ensemble_batch_timeout_ms: batchEnabled ? batchTimeoutMs : null,
    ensemble_batch_reason: batchReason,
    ...newsMeta,
  };
}

async function getLastMode(db) {
  const snap = await db.collection("ai_allocation_runs")
    .orderBy("created_at", "desc")
    .limit(5)
    .get();
  for (const doc of snap.docs) {
    const d = doc.data() || {};
    if (!d.mode) continue;
    return {
      mode: d.mode,
      confidence: d.mode_confidence ?? null,
      direction: normalizeDirection(d.direction || d.bias_direction || (d.side_allocation && d.side_allocation.bias_direction)),
      direction_confidence: d.direction_confidence ?? null,
      direction_score: d.direction_score ?? (d.side_allocation && d.side_allocation.bias_score) ?? null,
      created_at: d.created_at || null,
    };
  }
  return null;
}

async function runAiAllocation({ apply = false, provider: providerRaw = null, force = false } = {}) {
  const db = getFirestore();
  const exCfg = await getEffectiveExchangesSettings(3000);
  const provider = normalizeProviderId(providerRaw || (exCfg && exCfg.provider) || "BINANCEFUT");
  const activeProviders = parseChannelList(process.env.EXCHANGE_PROVIDERS || "")
    .map((p) => normalizeProviderId(p))
    .filter(Boolean);
  if (activeProviders.length && !activeProviders.includes(provider)) {
    return { ok: true, skipped: true, reason: "PROVIDER_DISABLED_BY_ENV", provider };
  }
  const aiCfgRaw = await getAiAllocationSettingsForProvider(provider, 5000);
  const aiCfg = { ...AI_ALLOCATION_DEFAULTS, ...(aiCfgRaw.data || {}) };

  if (!aiCfg.enabled) {
    return { ok: true, skipped: true, reason: "DISABLED" };
  }

  // Schedule guard (KST 기준 주간 실행)
  const cadenceDays = Number(aiCfg.cadence_days || 7);
  const runDowRaw = aiCfg.run_dow;
  const runDow = (runDowRaw === null || runDowRaw === undefined || runDowRaw === "")
    ? null
    : Number(runDowRaw);
  const runHourKst = Number.isFinite(Number(aiCfg.run_hour_kst)) ? Number(aiCfg.run_hour_kst) : null;
  const runMinuteKst = normalizeRunMinute(
    aiCfg.run_minute_kst,
    AI_ALLOCATION_DEFAULTS.run_minute_kst,
  );
  const runHoursKst = resolveRunHours({
    provider,
    runHoursRaw: aiCfg.run_hours_kst,
    runHourRaw: runHourKst,
  });
  const isDaily = Number.isFinite(cadenceDays) && cadenceDays <= 1;
  if (!force) {
    const now = Date.now();
    const kst = new Date(now + 9 * 60 * 60 * 1000);
    const dow = kst.getUTCDay();
    const hour = kst.getUTCHours();
    const minute = kst.getUTCMinutes();
    if (!isDaily && Number.isFinite(runDow) && dow !== runDow) {
      return { ok: true, skipped: true, reason: "SCHEDULE_DOW_MISMATCH" };
    }
    if (runHoursKst.length > 0) {
      if (!runHoursKst.includes(hour)) {
        return { ok: true, skipped: true, reason: "SCHEDULE_HOUR_NOT_MATCH" };
      }
      if (minute < runMinuteKst) {
        return { ok: true, skipped: true, reason: "SCHEDULE_MINUTE_TOO_EARLY" };
      }
    } else if (Number.isFinite(runHourKst) && hour < runHourKst) {
      return { ok: true, skipped: true, reason: "SCHEDULE_HOUR_TOO_EARLY" };
    } else if (Number.isFinite(runHourKst) && hour === runHourKst && minute < runMinuteKst) {
      return { ok: true, skipped: true, reason: "SCHEDULE_MINUTE_TOO_EARLY" };
    }
    if (Number.isFinite(cadenceDays) && cadenceDays > 0) {
      try {
        const lastSnap = await db.collection("ai_allocation_runs")
          .where("provider", "==", provider)
          .orderBy("created_at", "desc")
          .limit(1)
          .get();
        if (!lastSnap.empty) {
          const last = lastSnap.docs[0].data() || {};
          const lastMs = Date.parse(String(last.created_at || ""));
          if (Number.isFinite(lastMs)) {
            if (isDaily && runHoursKst.length > 1) {
              const lastKst = new Date(lastMs + 9 * 60 * 60 * 1000);
              const sameDay = lastKst.getUTCFullYear() === kst.getUTCFullYear()
                && lastKst.getUTCMonth() === kst.getUTCMonth()
                && lastKst.getUTCDate() === kst.getUTCDate();
              if (sameDay && lastKst.getUTCHours() === hour && lastKst.getUTCMinutes() >= runMinuteKst) {
                return { ok: true, skipped: true, reason: "CADENCE_NOT_DUE" };
              }
            } else {
              const diffDays = (now - lastMs) / (24 * 60 * 60 * 1000);
              if (diffDays < cadenceDays) {
                return { ok: true, skipped: true, reason: "CADENCE_NOT_DUE", next_in_days: Math.ceil(cadenceDays - diffDays) };
              }
            }
          }
        }
      } catch (_) {
        // 조회 실패 시에는 실행을 막지 않음
      }
    }
  }

  const sys = (await getSystemSettingsForProvider(provider, 5000)).data || {};
  const executionMode = String(sys.execution_mode || "PAPER").toUpperCase();
  const isLiveMode = executionMode === "LIVE";
  const isLiveDryRunMode = executionMode === "LIVE_DRY_RUN";
  const liveOk = (isLiveMode && sys.live_enabled === true) || isLiveDryRunMode;
  const confirmRequired = isLiveMode && sys.live_confirm_required === true;
  const shouldApplyLive = apply && aiCfg.apply_live && liveOk && !confirmRequired && !force;
  const applyReasonWhenSkipped = resolveApplyReason({
    apply,
    applyLive: aiCfg.apply_live,
    liveOk,
    confirmRequired,
    force,
  });
  const allowFallback = !shouldApplyLive;

  const ex = await getExchangeSettingsForProvider(provider, 3000);
  const risk = (await getRiskBudgetForProvider(provider, 5000)).data || {};
  let baseTotal = 0;
  let accountSummary = null;
  if (provider === "BINANCEFUT") {
    const apiKey = String(process.env.BINANCEFUT_API_KEY || (ex && ex.api_key) || "");
    const apiSecret = String(process.env.BINANCEFUT_API_SECRET || (ex && ex.api_secret) || "");
    if (!apiKey || !apiSecret) {
      if (allowFallback) {
        const fallback = Number(risk.total_max_krw || risk.default_max_krw || 0);
        baseTotal = Number.isFinite(fallback) ? fallback : 0;
        accountSummary = { total_krw: baseTotal || 0, updated_at: nowIso(), source: "fallback_risk_budget", unit: "USDT" };
      } else {
        return { ok: false, error: "BINANCEFUT_KEYS_MISSING", message: "Binance futures keys required for total budget" };
      }
    } else {
      try {
        const summary = await getBinanceFuturesAccountSummary({ apiKey, apiSecret });
        baseTotal = Number(summary && summary.total_value) || 0;
        accountSummary = {
          total_krw: Number.isFinite(baseTotal) ? baseTotal : null,
          updated_at: summary && summary.updated_at ? summary.updated_at : nowIso(),
          unit: "USDT",
        };
      } catch (e) {
        if (allowFallback) {
          const fallback = Number(risk.total_max_krw || risk.default_max_krw || 0);
          baseTotal = Number.isFinite(fallback) ? fallback : 0;
          accountSummary = { total_krw: baseTotal || 0, updated_at: nowIso(), source: "fallback_risk_budget", unit: "USDT" };
        } else {
          return { ok: false, error: "BINANCEFUT_ACCOUNT_FAILED", message: e?.message || String(e) };
        }
      }
      if (!baseTotal) {
        if (allowFallback) {
          const fallback = Number(risk.total_max_krw || risk.default_max_krw || 0);
          baseTotal = Number.isFinite(fallback) ? fallback : 0;
          accountSummary = { total_krw: baseTotal || 0, updated_at: nowIso(), source: "fallback_risk_budget", unit: "USDT" };
        } else {
          return { ok: false, error: "BINANCEFUT_TOTAL_EMPTY", message: "Binance futures total is empty" };
        }
      }
    }
  }

  const marketsRaw = Array.isArray(ex && ex.markets) && ex.markets.length ? ex.markets : defaultMarketsFromEnv(provider);
  const uniqueMarkets = Array.from(new Set((marketsRaw || []).filter(Boolean)));
  if (!uniqueMarkets.length) {
    return { ok: false, error: "NO_MARKETS", message: "markets list is empty" };
  }

  const isUpbitMarket = (m) => String(m || "").toUpperCase().startsWith("KRW-");
  const isBinanceMarket = (m) => String(m || "").toUpperCase().includes("USDT");

  let eligibleMarkets = uniqueMarkets;
  if (provider === "BINANCEFUT") {
    eligibleMarkets = uniqueMarkets.filter(isBinanceMarket);
  }
  // Ensure AI recommendation list has 5 markets for BINANCEFUT.
  if (provider === "BINANCEFUT") {
    const fallback = defaultMarketsFromEnv("BINANCEFUT") || [];
    const seen = new Set(eligibleMarkets);
    for (const m of fallback) {
      if (eligibleMarkets.length >= 5) break;
      if (!seen.has(m)) {
        eligibleMarkets.push(m);
        seen.add(m);
      }
    }
  }
  const excludedMarkets = uniqueMarkets.filter((m) => !eligibleMarkets.includes(m));
  if (!eligibleMarkets.length) {
    return { ok: false, error: "NO_ELIGIBLE_MARKETS", message: "eligible markets list is empty" };
  }

  const gptKey = String(process.env.OPENAI_API_KEY || aiCfg.api_key || "");
  let guardData = null;
  try {
    const guardRes = await getAiGuardSettingsCached(5000);
    guardData = guardRes && guardRes.data ? guardRes.data : null;
  } catch (_) {}
  let claudeKey = String(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || "");
  if (!claudeKey && guardData && guardData.claude_api_key) {
    claudeKey = String(guardData.claude_api_key);
  }
  if (!claudeKey && aiCfg.claude_api_key) {
    claudeKey = String(aiCfg.claude_api_key);
  }
  const guardClaudeEnabled = (guardData && typeof guardData.claude_enabled === "boolean")
    ? guardData.claude_enabled
    : null;
  const aiClaudeEnabled = (typeof aiCfg.claude_enabled === "boolean") ? aiCfg.claude_enabled : null;
  const claudeEnabled = boolEnv(
    "AI_ALLOC_CLAUDE_ENABLED",
    aiClaudeEnabled != null
      ? aiClaudeEnabled
      : (guardClaudeEnabled != null ? guardClaudeEnabled : false)
  );
  const guardEnsembleEnabled = (guardData && typeof guardData.ensemble_enabled === "boolean")
    ? guardData.ensemble_enabled
    : null;
  const aiEnsembleEnabled = (typeof aiCfg.ensemble_enabled === "boolean") ? aiCfg.ensemble_enabled : null;
  const ensembleEnabled = boolEnv(
    "AI_ALLOC_ENSEMBLE_ENABLED",
    aiEnsembleEnabled != null
      ? aiEnsembleEnabled
      : (guardEnsembleEnabled != null ? guardEnsembleEnabled : false)
  );
  const defaultClaudeModel = String(AI_ALLOCATION_DEFAULTS.claude_model || "claude-3-7-sonnet-20250219");
  const claudeModel = String(
    process.env.AI_ALLOC_CLAUDE_MODEL ||
    process.env.CLAUDE_MODEL ||
    (guardData && guardData.claude_model) ||
    aiCfg.claude_model ||
    defaultClaudeModel
  ).trim() || defaultClaudeModel;
  const claudeCanaryModel = String(
    process.env.AI_ALLOC_CLAUDE_MODEL_CANARY ||
    process.env.CLAUDE_MODEL_CANARY ||
    ""
  ).trim();
  const claudeCanaryPctRaw = Number(
    process.env.AI_ALLOC_CLAUDE_CANARY_PCT ||
    process.env.CLAUDE_CANARY_PCT ||
    0
  );
  const claudeCanaryPct = Number.isFinite(claudeCanaryPctRaw)
    ? Math.max(0, Math.min(1, claudeCanaryPctRaw))
    : 0;
  const claudeTimeoutMsRaw = Number(process.env.AI_ALLOC_CLAUDE_TIMEOUT_MS || aiCfg.claude_timeout_ms || 8000);
  const claudeTimeoutMs = Number.isFinite(claudeTimeoutMsRaw) ? claudeTimeoutMsRaw : 8000;
  const ensembleWGptRaw = Number(
    process.env.AI_ALLOC_ENSEMBLE_W_GPT ||
    aiCfg.ensemble_w_gpt ||
    (guardData && guardData.ensemble_w_gpt) ||
    AI_ALLOCATION_DEFAULTS.ensemble_w_gpt
  );
  const ensembleWClaudeRaw = Number(
    process.env.AI_ALLOC_ENSEMBLE_W_CLAUDE ||
    aiCfg.ensemble_w_claude ||
    (guardData && guardData.ensemble_w_claude) ||
    AI_ALLOCATION_DEFAULTS.ensemble_w_claude
  );
  const ensembleWGpt = Number.isFinite(ensembleWGptRaw) ? ensembleWGptRaw : AI_ALLOCATION_DEFAULTS.ensemble_w_gpt;
  const ensembleWClaude = Number.isFinite(ensembleWClaudeRaw) ? ensembleWClaudeRaw : AI_ALLOCATION_DEFAULTS.ensemble_w_claude;
  const keywords = buildNewsKeywordsForProvider(provider, eligibleMarkets);
  const newsLanguage = aiCfg.news_language || "en";
  let modeInfo = await getNewsMode({
    provider,
    keywords,
    windowDays: aiCfg.news_window_days,
    gptEnabled: aiCfg.gpt_enabled && !!gptKey,
    gptModel: aiCfg.gpt_model,
    gptModelRouter: aiCfg.gpt_model_router || aiCfg.gpt_model,
    gptModelPro: aiCfg.gpt_model_pro || aiCfg.gpt_model,
    routerConfThreshold: Number(aiCfg.router_conf_threshold),
    gptTemp: aiCfg.gpt_temperature,
    gptKey,
    newsLanguage,
    claudeEnabled,
    claudeModel,
    claudeCanaryModel,
    claudeCanaryPct,
    claudeKey,
    claudeTimeoutMs,
    ensembleEnabled,
    ensembleWGpt,
    ensembleWClaude,
    ensembleNeutralThreshold: aiCfg.side_bias_neutral_threshold,
  });
  const noModelDecision = (modeInfo.gpt_attempted || modeInfo.claude_attempted)
    && !modeInfo.gpt_ok
    && !modeInfo.claude_ok;
  if (noModelDecision) {
    const last = await getLastMode(db);
    if (last && last.mode) {
      modeInfo = {
        ...modeInfo,
        mode: last.mode,
        confidence: last.confidence ?? null,
        direction: last.direction || "neutral",
        direction_confidence: last.direction_confidence ?? null,
        direction_score: last.direction_score ?? null,
        reason: `FALLBACK_LAST_MODE:${modeInfo.reason || "GPT_FAIL"}`,
        fallback_from: last.created_at || null,
      };
    }
  }

  const sideAllocation = buildSideAllocation({ modeInfo, aiCfg });
  const totalCap = Number.isFinite(Number(aiCfg.total_cap_pct_max)) ? Number(aiCfg.total_cap_pct_max) : AI_ALLOCATION_DEFAULTS.total_cap_pct_max;
  const scale = Math.min(Math.max(totalCap, 0.1), 1.0);

  const anchorRaw = Number(risk.total_max_krw || 0);
  const anchorTotal = (Number.isFinite(anchorRaw) && anchorRaw > 0) ? anchorRaw : baseTotal;
  const profit = baseTotal - anchorTotal;
  const reinvestRate = Number.isFinite(Number(aiCfg.reinvest_rate)) ? Number(aiCfg.reinvest_rate) : AI_ALLOCATION_DEFAULTS.reinvest_rate;
  const lossRate = Number.isFinite(Number(aiCfg.reinvest_loss_rate)) ? Number(aiCfg.reinvest_loss_rate) : AI_ALLOCATION_DEFAULTS.reinvest_loss_rate;
  const eqMin = Number.isFinite(Number(aiCfg.equity_mult_min)) ? Number(aiCfg.equity_mult_min) : AI_ALLOCATION_DEFAULTS.equity_mult_min;
  const eqMax = Number.isFinite(Number(aiCfg.equity_mult_max)) ? Number(aiCfg.equity_mult_max) : AI_ALLOCATION_DEFAULTS.equity_mult_max;
  const equity = anchorTotal + (profit > 0 ? (profit * reinvestRate) : (profit * lossRate));
  const equityMultRaw = (anchorTotal > 0) ? (equity / anchorTotal) : 1.0;
  const equityMult = clamp(equityMultRaw, eqMin, eqMax) ?? 1.0;
  const targetTotal = Math.round(anchorTotal * equityMult * scale);

  const barMap = await loadMarketBars(db, eligibleMarkets, aiCfg.bars_limit);
  const volByMarket = {};
  for (const mk of eligibleMarkets) {
    const series = barMap[mk] || [];
    if (series.length < aiCfg.min_bars) {
      volByMarket[mk] = null;
      continue;
    }
    volByMarket[mk] = computeVol(series);
  }

  const weights = buildWeights(eligibleMarkets, volByMarket);
  const currentByMarketRaw = typeof risk.by_market === "object" && risk.by_market ? risk.by_market : {};
  const currentByMarket = {};
  for (const mk of eligibleMarkets) {
    if (Object.prototype.hasOwnProperty.call(currentByMarketRaw, mk)) {
      currentByMarket[mk] = currentByMarketRaw[mk];
    }
  }
  const nextByMarket = applyBudgetConstraints({
    markets: eligibleMarkets,
    weights,
    baseTotal: targetTotal,
    minKrw: aiCfg.min_per_market_krw,
    maxKrw: aiCfg.max_per_market_krw,
    maxChangePct: aiCfg.max_change_pct,
    currentByMarket,
  });
  // Keep budget map strictly aligned to currently eligible markets.
  // This prevents stale symbols (removed from trading universe) from persisting.
  const mergedByMarket = {};
  for (const mk of eligibleMarkets) {
    if (Object.prototype.hasOwnProperty.call(nextByMarket, mk)) {
      mergedByMarket[mk] = nextByMarket[mk];
    } else if (Object.prototype.hasOwnProperty.call(currentByMarketRaw, mk)) {
      mergedByMarket[mk] = currentByMarketRaw[mk];
    }
  }

  const runDoc = {
    created_at: nowIso(),
    mode: modeInfo.mode,
    mode_confidence: modeInfo.confidence,
    mode_reason: modeInfo.reason,
    direction: normalizeDirection(modeInfo.direction),
    direction_confidence: modeInfo.direction_confidence ?? null,
    direction_score: modeInfo.direction_score ?? null,
    side_allocation: sideAllocation,
    news_ok: modeInfo.news_ok,
    news_count: modeInfo.news_count,
    news_provider: modeInfo.news_provider || null,
    news_reason: modeInfo.news_reason || null,
    news_cached: modeInfo.news_cached === true,
    gpt_ok: modeInfo.gpt_ok === true,
    gpt_attempted: modeInfo.gpt_attempted === true,
    gpt_model: modeInfo.gpt_model || null,
    gpt_mode: modeInfo.gpt_mode || null,
    gpt_direction: modeInfo.gpt_direction || null,
    gpt_direction_score: modeInfo.gpt_direction_score ?? null,
    gpt_reason: modeInfo.gpt_reason || null,
    claude_ok: modeInfo.claude_ok === true,
    claude_attempted: modeInfo.claude_attempted === true,
    claude_model: modeInfo.claude_model || null,
    claude_model_primary: modeInfo.claude_model_primary || null,
    claude_model_canary: modeInfo.claude_model_canary || null,
    claude_canary_pct: modeInfo.claude_canary_pct ?? null,
    claude_canary_used: modeInfo.claude_canary_used === true,
    claude_mode: modeInfo.claude_mode || null,
    claude_direction: modeInfo.claude_direction || null,
    claude_direction_score: modeInfo.claude_direction_score ?? null,
    claude_reason: modeInfo.claude_reason || null,
    ensemble_enabled: modeInfo.ensemble_enabled === true,
    ensemble_used: modeInfo.ensemble_used === true,
    ensemble_w_gpt: modeInfo.ensemble_w_gpt ?? null,
    ensemble_w_claude: modeInfo.ensemble_w_claude ?? null,
    ensemble_mode_score: modeInfo.ensemble_mode_score ?? null,
    ensemble_direction_score: modeInfo.ensemble_direction_score ?? null,
    router_ok: modeInfo.router_ok === true,
    router_confidence: modeInfo.router_confidence ?? null,
    router_model: modeInfo.router_model || null,
    final_model: modeInfo.final_model || null,
    news_query_keywords: keywords.slice(0, 10),
    fallback_from: modeInfo.fallback_from || null,
    base_total_krw: baseTotal,
    account_total_krw: baseTotal,
    account_updated_at: accountSummary && accountSummary.updated_at ? accountSummary.updated_at : null,
    target_total_krw: targetTotal,
    total_cap_pct_max: totalCap,
    mode_scale_raw: 1.0,
    mode_scale_applied: scale,
    equity_anchor_krw: anchorTotal,
    equity_profit_krw: profit,
    equity_mult: equityMult,
    weights,
    current_by_market: currentByMarket,
    next_by_market: nextByMarket,
    excluded_markets: excludedMarkets,
    provider,
    news_language: newsLanguage,
    apply_requested: apply,
    force_requested: force === true,
    live_ok: liveOk,
    confirm_required: confirmRequired,
    apply_live: aiCfg.apply_live,
    recommended_groups: normalizeGroupMarkets(buildRecommendationGroups(provider), provider),
    recommended_group_labels: {
      large_sector: "대형/섹터분산",
      growth: "성장 우선형",
      momentum: "모멘텀형",
    },
  };

  let applied = false;
  let apply_reason = null;
  if (shouldApplyLive) {
    const newBudget = {
      ...risk,
      total_max_krw: targetTotal,
      by_market: mergedByMarket,
      side_allocation: sideAllocation,
      source: "ai_allocation",
      updated_at: nowIso(),
      updated_by: "ai_allocation",
    };
    const snap = await db.collection("settings").doc("risk_budget").get();
    const raw = snap.exists ? (snap.data() || {}) : {};
    const rawProviders = (raw.providers && typeof raw.providers === "object") ? raw.providers : {};
    const providers = { ...rawProviders };
    providers[provider] = newBudget;
    const payload = {
      providers,
      enabled: newBudget.enabled,
      on_exceed: newBudget.on_exceed,
      total_max_krw: newBudget.total_max_krw,
      default_max_krw: newBudget.default_max_krw,
      by_market: newBudget.by_market,
      side_allocation: newBudget.side_allocation,
      unit: newBudget.unit || "KRW",
      updated_at: newBudget.updated_at,
      updated_by: newBudget.updated_by,
    };
    await db.collection("settings").doc("risk_budget").set(payload, { merge: true });
    // Firestore merge keeps unknown nested keys; explicitly remove stale by_market keys.
    const oldRootByMarket = (raw.by_market && typeof raw.by_market === "object") ? raw.by_market : {};
    const oldProviderByMarket = (
      rawProviders[provider] &&
      typeof rawProviders[provider] === "object" &&
      rawProviders[provider].by_market &&
      typeof rawProviders[provider].by_market === "object"
    ) ? rawProviders[provider].by_market : {};
    const deletePayload = {};
    for (const key of Object.keys(oldRootByMarket)) {
      if (!Object.prototype.hasOwnProperty.call(mergedByMarket, key)) {
        deletePayload[`by_market.${key}`] = admin.firestore.FieldValue.delete();
      }
    }
    for (const key of Object.keys(oldProviderByMarket)) {
      if (!Object.prototype.hasOwnProperty.call(mergedByMarket, key)) {
        deletePayload[`providers.${provider}.by_market.${key}`] = admin.firestore.FieldValue.delete();
      }
    }
    if (Object.keys(deletePayload).length) {
      const riskRef = db.collection("settings").doc("risk_budget");
      try {
        await riskRef.update(deletePayload);
      } catch (_) {
        await riskRef.set(deletePayload, { merge: true });
      }
    }
    applied = true;
  } else {
    apply_reason = applyReasonWhenSkipped;
  }

  await db.collection("ai_allocation_runs").add({
    ...runDoc,
    applied,
    apply_reason,
  });
  sendAiAllocationSummaryAlert({
    provider,
    runDoc,
    applied,
    applyReason: apply_reason,
    alertChannel: sys.alert_channel,
    executionMode,
  }).catch((err) => {
    console.warn("[AI_ALLOC_SUMMARY_ALERT_FAIL]", err?.message || err);
  });

  return {
    ok: true,
    applied,
    apply_reason,
    mode: modeInfo,
    target_total_krw: targetTotal,
    side_allocation: sideAllocation,
    next_by_market: nextByMarket,
  };
}

module.exports = {
  runAiAllocation,
  __test: {
    buildNewsKeywords,
    buildNewsKeywordsForProvider,
    buildEffectiveModeReason,
  },
};
