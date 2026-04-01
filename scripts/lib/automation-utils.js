#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { sendAlert } = require("../../src/utils/alerts");
const { getSystemSettingsForProvider, getExchangesSettingsCached } = require("../../src/storage/settings");
const { toKstString, kstDateKey, KST_OFFSET_MS } = require("../../src/utils/timeKst");
const { unwrapDisplayAndRawReport } = require("../../src/utils/jsonDisplayFields");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME_DIR = path.join(REPO_ROOT, "ops", "runtime");
const DEFAULT_MAIN_SERVICE = process.env.CLOUD_RUN_SERVICE || "donbeolja";
const DEFAULT_REGION = process.env.CLOUD_RUN_REGION || "asia-northeast3";

const TELEGRAM_KO_EXACT_MAP = Object.freeze({
  PASS: "정상",
  FAIL: "실패",
  WARN: "주의",
  INFO: "안내",
  HOLD: "유지",
  KEEP: "유지",
  READY: "준비 완료",
  BLOCK: "차단",
  UPDATE: "업데이트",
  RECOVERED: "복구 완료",
  PROMOTE: "승격",
  ROLLBACK: "롤백",
  PATCH_CANDIDATE: "변경 후보",
  ROLLBACK_CANDIDATE: "롤백 후보",
  AUTO_APPLY: "자동 적용",
  AUTO_ROLLBACK: "자동 롤백",
  N_A: "정보 없음",
  N_A_ALIAS: "정보 없음",
  NONE: "없음",
  FRESH: "최신",
  STALE: "오래됨",
  MISSING: "없음",
  LOADED: "실행 중",
  OK: "정상",
  OBJECTIVE_SAMPLE_NOT_READY: "목표 판단에 필요한 표본이 아직 부족합니다",
  GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY: "거버넌스 목표 판단에 필요한 표본이 아직 부족합니다",
  MONTHLY_TARGET_NOT_MET: "월간 목표를 아직 달성하지 못했습니다",
  OBJECTIVE_NOT_MET: "공통 목표를 아직 달성하지 못했습니다",
  DAILY_OBJECTIVE_FAIL: "오늘 목표를 달성하지 못했습니다",
  WEEKLY_OBJECTIVE_FAIL: "주간 목표를 달성하지 못했습니다",
  RETROSPECTIVE_MONTHLY_FAIL: "월간 회고 기준으로 목표 미달 상태입니다",
  DAILY_NO_TRADE_ACTIVITY: "오늘 거래가 한 번도 없었습니다",
  ZERO_KRW_IDLE: "실현 손익이 0원이라 목표를 충족하지 못했습니다",
  CHANGE_CONTROL_HOLD: "안전 장치 때문에 변경을 보류했습니다",
  EXTERNAL_AUTHORITY_REQUIRED_PROMOTION: "자동 승격 전에 외부 권위 심사가 필요합니다",
  EXTERNAL_AUTHORITY_BLOCK_PROMOTION: "외부 권위 심사 결과 이번 승격은 보류입니다",
  EXTERNAL_AUTHORITY_REQUIRED_ROLLBACK: "자동 롤백 전에 외부 권위 심사가 필요합니다",
  EXTERNAL_AUTHORITY_BLOCK_ROLLBACK: "외부 권위 심사 결과 이번 롤백은 보류입니다",
  STAGE_AUTOPILOT_REQUIRED_PROMOTION: "자동 적용 엔진 상태 확인이 먼저 필요합니다",
  AUTO_PROMOTION_READY: "자동 승격 준비가 끝났습니다",
  CANDIDATE_NOT_READY: "아직 변경 후보가 준비되지 않았습니다",
  ROLLBACK_NOT_READY: "지금은 롤백할 상황이 아닙니다",
  NO_PATCHED_HISTORY: "되돌릴 이전 변경 이력이 없습니다",
  INSUFFICIENT_SAMPLE: "판단에 필요한 표본이 아직 부족합니다",
  TRIGGER_SAMPLE_TOO_SMALL: "트리거 표본이 아직 너무 적습니다",
  TARGET_NOT_MET: "목표 기준을 아직 충족하지 못했습니다",
  NO_TRADE_ACTIVITY: "거래가 없었습니다",
  PERIOD_TARGET_NOT_MET: "기간 목표를 아직 달성하지 못했습니다",
  SIGNAL_DATA_INTEGRITY_WARN: "데이터 무결성 경고가 발생했습니다",
});

function humanizeTelegramText(raw) {
  let text = String(raw == null ? "" : raw);
  if (!text) return text;
  text = text.replace(/\[노예\//g, "[자동 알림/");
  text = text.replace(/\bN\/A\b/g, "정보 없음");

  const exactCodes = Object.keys(TELEGRAM_KO_EXACT_MAP)
    .filter((key) => key !== "N_A" && key !== "N_A_ALIAS")
    .sort((a, b) => b.length - a.length);
  for (const code of exactCodes) {
    const replacement = TELEGRAM_KO_EXACT_MAP[code];
    const pattern = new RegExp(`\\b${code.replace(/[.*+?^${}()|[\]\\\\]/g, "\\$&")}\\b`, "g");
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/\bexecuted\b/g, "실행")
    .replace(/\brealized\b/g, "실현")
    .replace(/\bobjective\b/g, "목표")
    .replace(/\bcoverage\b/g, "커버리지")
    .replace(/\bcanary\b/g, "검증")
    .replace(/\bcandidate\b/g, "후보")
    .replace(/\breason\b/g, "사유")
    .replace(/\bissues\b/g, "이슈")
    .replace(/\bloaded\b/g, "실행 중")
    .replace(/\bexit\b/g, "청산")
    .replace(/\btrigger\b/g, "발동")
    .replace(/\bstage ledger\b/gi, "단계 기록")
    .replace(/\bnone\b/gi, "없음");
  return text;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function readJsonRawSafe(filePath, fallback = null) {
  return unwrapDisplayAndRawReport(readJsonSafe(filePath, fallback));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text || ""), "utf8");
}

function copyLatest(sourcePath, latestPath) {
  if (!sourcePath || !latestPath) return;
  ensureDir(path.dirname(latestPath));
  fs.copyFileSync(sourcePath, latestPath);
}

function shouldWriteSelfEvolutionLatest() {
  const cycleId = String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim();
  const allowLatestWrite = String(process.env.BEST_SELF_EVOLUTION_ALLOW_LATEST_WRITE || "").trim();
  return Boolean(cycleId) && allowLatestWrite === "1";
}

function copySelfEvolutionLatest(sourcePath, latestPath) {
  if (!shouldWriteSelfEvolutionLatest()) return false;
  copyLatest(sourcePath, latestPath);
  return true;
}

function selfEvolutionSnapshotLatestPath(fileName) {
  const base = String(fileName || "").trim();
  if (!base) return null;
  return path.join(OPS_DAILY_DIR, `best_self_evolution_${base}`);
}

function sha1(text) {
  return crypto.createHash("sha1").update(String(text || ""), "utf8").digest("hex");
}

function readAlertDedupeState() {
  return readJsonSafe(path.join(OPS_RUNTIME_DIR, "telegram_alert_dedupe_state.json"), { records: {} }) || { records: {} };
}

function writeAlertDedupeState(state) {
  writeJson(path.join(OPS_RUNTIME_DIR, "telegram_alert_dedupe_state.json"), state || { records: {} });
}

function parseEnvFile(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadLocalEnv() {
  const home = String(process.env.HOME || "").trim();
  const paths = [
    path.join(REPO_ROOT, ".env"),
    path.join(REPO_ROOT, "ops", ".env.runtime.local"),
    home ? path.join(home, ".openclaw", ".env") : "",
  ].filter(Boolean);
  for (const filePath of paths) {
    const parsed = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

async function ensureExchangeApiKeys(provider = "BINANCEFUT") {
  const prefix = String(provider || "").trim().toUpperCase();
  if (!prefix) return { ok: false, reason: "PROVIDER_MISSING" };

  const envKeyName = `${prefix}_API_KEY`;
  const envSecretName = `${prefix}_API_SECRET`;
  const currentKey = String(process.env[envKeyName] || "").trim();
  const currentSecret = String(process.env[envSecretName] || "").trim();
  if (currentKey && currentSecret) {
    return { ok: true, source: "env", apiKey: currentKey, apiSecret: currentSecret };
  }

  try {
    const raw = await getExchangesSettingsCached(5000);
    const data = raw && raw.data ? raw.data : {};
    const entry = data && data.exchanges && typeof data.exchanges === "object"
      ? (data.exchanges[prefix] || data.exchanges[prefix.toLowerCase()] || null)
      : null;
    const legacy = !entry && String(data.provider || "").toUpperCase() === prefix ? data : null;
    const apiKey = String(currentKey || (entry && entry.api_key) || (legacy && legacy.api_key) || "").trim();
    const apiSecret = String(currentSecret || (entry && entry.api_secret) || (legacy && legacy.api_secret) || "").trim();
    if (!apiKey || !apiSecret) {
      return { ok: false, reason: `${prefix}_KEYS_MISSING`, source: "settings" };
    }
    if (!currentKey) process.env[envKeyName] = apiKey;
    if (!currentSecret) process.env[envSecretName] = apiSecret;
    return { ok: true, source: "settings", apiKey, apiSecret };
  } catch (err) {
    return {
      ok: false,
      reason: `${prefix}_KEYS_LOOKUP_FAILED`,
      error: err && err.message ? String(err.message) : "UNKNOWN_ERROR",
    };
  }
}

function nowKstMeta() {
  const nowMs = Date.now();
  const dateKey = kstDateKey(nowMs);
  const text = toKstString(nowMs, { fallbackToString: true }) || "";
  const hhmm = String(text.match(/\b(\d{2}):(\d{2})\b/) ? `${RegExp.$1}${RegExp.$2}` : "0000");
  return { nowMs, dateKey, hhmm, kst: text };
}

function resolveAutomationCycleMeta({ envKey = "AUTOMATION_CYCLE_ID", prefix = "automation", nowMeta = null } = {}) {
  const meta = nowMeta && typeof nowMeta === "object" ? nowMeta : nowKstMeta();
  const explicit = String(process.env[envKey] || "").trim();
  const cycleId = explicit || `${String(prefix || "automation").trim()}_${meta.dateKey}_${meta.hhmm}_${sha1(`${prefix}:${meta.nowMs}:${process.pid}`).slice(0, 8)}`;
  return {
    cycle_id: cycleId,
    generation_id: cycleId,
  };
}

function resolveAnchoredReportCycleId({ preferredCycleId = null, fallbackCycleId = null, sources = [] } = {}) {
  const fromPreferred = String(preferredCycleId || "").trim();
  if (fromPreferred) return fromPreferred;
  for (const source of Array.isArray(sources) ? sources : []) {
    const row = source && typeof source === "object" ? source : null;
    if (!row) continue;
    const cycleId = String(
      row.source_cycle_id
      || row.cycle_id
      || row.generation_id
      || row.evaluation_cycle_id
      || ""
    ).trim();
    if (cycleId) return cycleId;
  }
  return String(fallbackCycleId || "").trim() || null;
}

function formatPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function formatSignedPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  const pct = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : ""}${pct}%`;
}

function formatSignedNumber(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function isWithinMs(value, sinceMs) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= sinceMs;
}

function docCreatedMs(doc) {
  if (!doc || typeof doc !== "object") return null;
  const candidates = [
    doc.created_at_ms,
    doc.createdAtMs,
    doc.bar_close_time_utc_ms,
    parseIsoMs(doc.created_at),
    parseIsoMs(doc.createdAt),
    parseIsoMs(doc.updated_at),
    parseIsoMs(doc.ts),
  ];
  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function summarizeLines(lines = []) {
  return String(lines || [])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function execJson(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      cwd: opts.cwd || REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: opts.maxBuffer || (10 * 1024 * 1024),
    });
    return { ok: true, data: JSON.parse(out), raw: out };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : "EXEC_JSON_FAILED", data: null, raw: "" };
  }
}

function execText(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      cwd: opts.cwd || REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: opts.maxBuffer || (10 * 1024 * 1024),
    });
    return { ok: true, text: out };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : "EXEC_TEXT_FAILED", text: "" };
  }
}

async function resolveAlertChannel(provider = "BINANCEFUT") {
  const envCandidates = [
    String(process.env.SIGNAL_LIFECYCLE_ALERT_CHANNEL || "").trim(),
    String(process.env.TRADE_ALERT_CHANNEL || "").trim(),
    String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim(),
  ].filter(Boolean);
  if (envCandidates.length) return envCandidates[0];

  try {
    const sys = await getSystemSettingsForProvider(provider, 5000);
    const fromSettings = String(sys && sys.data && sys.data.alert_channel || "").trim();
    if (fromSettings) return fromSettings;
  } catch (_err) {}

  const chatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  if (chatId) return `telegram:${chatId}`;
  return "";
}

async function sendKoreanTelegramSummary({
  title,
  sections,
  severity = "INFO",
  provider = "BINANCEFUT",
  dedupeKey = "",
  dedupeWindowSec = 0,
  dedupeFingerprint = null,
} = {}) {
  if (String(process.env.SKIP_ALERT || "").trim() === "1") {
    return { ok: false, skipped: true, reason: "SKIP_ALERT" };
  }
  const channel = await resolveAlertChannel(provider);
  const normalizedTitle = humanizeTelegramText(title);
  const normalizedSections = (Array.isArray(sections) ? sections : []).map((row) => ({
    header: humanizeTelegramText(String(row && row.header || "").trim()),
    lines: (Array.isArray(row && row.lines) ? row.lines : []).map((line) => humanizeTelegramText(line)),
  }));
  const body = normalizedSections
    .map((row) => {
      const header = String(row && row.header || "").trim();
      const lines = Array.isArray(row && row.lines) ? row.lines : [];
      const compact = lines.map((line) => `- ${line}`).join("\n");
      return header ? `${header}\n${compact}` : compact;
    })
    .filter(Boolean)
    .join("\n\n");
  const normalizedDedupeKey = String(dedupeKey || "").trim();
  const normalizedDedupeWindowSec = Math.max(60, Number(dedupeWindowSec || 0));
  const fingerprint = sha1(JSON.stringify({
    channel,
    title: normalizedTitle,
    severity,
    body,
    provider,
    extra: dedupeFingerprint,
  }));
  if (normalizedDedupeKey && normalizedDedupeWindowSec > 0) {
    const state = readAlertDedupeState();
    const record = state && state.records ? state.records[normalizedDedupeKey] : null;
    const nowMs = Date.now();
    if (
      record
      && record.fingerprint === fingerprint
      && Number.isFinite(Number(record.sent_at_ms))
      && (nowMs - Number(record.sent_at_ms)) < (normalizedDedupeWindowSec * 1000)
    ) {
      return { ok: true, skipped: true, reason: "DEDUPED", dedupe_key: normalizedDedupeKey };
    }
  }
  const result = await sendAlert({ channel, title: normalizedTitle, body, severity });
  if (normalizedDedupeKey && normalizedDedupeWindowSec > 0 && result && result.ok) {
    const state = readAlertDedupeState();
    state.records = state.records && typeof state.records === "object" ? state.records : {};
    state.records[normalizedDedupeKey] = {
      fingerprint,
      sent_at_ms: Date.now(),
      title: normalizedTitle,
      severity,
    };
    writeAlertDedupeState(state);
  }
  return result;
}

async function resolveBaseUrlInfo() {
  const envBase = String(process.env.BASE_URL || process.env.AUTO_BASE_URL || "").trim();
  if (envBase) {
    const normalized = envBase.replace(/\/+$/, "");
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized);
    if (!isLocal) return { url: normalized, source: "env" };
    try {
      const res = await fetch(`${normalized}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { url: normalized, source: "env_local" };
    } catch (_err) {}
  }

  try {
    const res = await fetch("http://localhost:3000/health", { signal: AbortSignal.timeout(1500) });
    if (res.ok) return { url: "http://localhost:3000", source: "localhost" };
  } catch (_err) {}

  const describe = execJson(
    `gcloud run services describe ${DEFAULT_MAIN_SERVICE} --region ${DEFAULT_REGION} --format=json`,
    { maxBuffer: 5 * 1024 * 1024 }
  );
  if (describe.ok) {
    const url = String(describe.data && describe.data.status && describe.data.status.url || "").trim();
    if (url) return { url: url.replace(/\/+$/, ""), source: "cloud_run" };
  }

  return { url: "https://donbeolja-4ljfegivrq-du.a.run.app", source: "cloud_run_fallback" };
}

async function resolveBaseUrl() {
  const info = await resolveBaseUrlInfo();
  return info && info.url ? info.url : "https://donbeolja-4ljfegivrq-du.a.run.app";
}

function kstStartOfTodayUtcMs(baseMs = Date.now()) {
  const date = new Date(baseMs + KST_OFFSET_MS);
  const midnightUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0);
  return midnightUtc - KST_OFFSET_MS;
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

module.exports = {
  REPO_ROOT,
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  ensureDir,
  readJsonSafe,
  readJsonRawSafe,
  writeJson,
  writeText,
  copyLatest,
  copySelfEvolutionLatest,
  selfEvolutionSnapshotLatestPath,
  shouldWriteSelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  resolveAutomationCycleMeta,
  resolveAnchoredReportCycleId,
  formatPct,
  formatSignedPct,
  formatSignedNumber,
  parseIsoMs,
  isWithinMs,
  docCreatedMs,
  summarizeLines,
  execJson,
  execText,
  sendKoreanTelegramSummary,
  readAlertDedupeState,
  writeAlertDedupeState,
  resolveBaseUrlInfo,
  resolveBaseUrl,
  kstStartOfTodayUtcMs,
  toIso,
  ensureExchangeApiKeys,
};
