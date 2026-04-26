"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");
const { defaultMarketsFromEnv, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { KST_OFFSET_MS, toKstString } = require("../utils/timeKst");
const { buildFeatureLabelDataset } = require("./featureLabelDataset");
const { runOpenClawPolicyTuningReport } = require("./openclawPolicyTuning");
const { recordShadowCanaryGate } = require("../storage/shadowCanaryGates");
const { recordMlServingState } = require("../storage/mlServingStates");
const { recordMlServingBinding, ensureMlServingBinding } = require("../storage/mlServingBindings");
const { buildMlServingState } = require("./mlServingRuntime");
const { applyMlServingActuation } = require("./mlServingActuator");
const { getAiGuardSettingsCached } = require("../storage/settings");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text || ""), "utf8");
}

function copyLatest(sourcePath, latestPath) {
  ensureDir(path.dirname(latestPath));
  fs.copyFileSync(sourcePath, latestPath);
}

function statMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch (_) {
    return null;
  }
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function nowKstMeta(nowMs = Date.now()) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  const pad2 = (n) => String(n).padStart(2, "0");
  return {
    nowMs,
    iso: new Date(nowMs).toISOString(),
    kst: toKstString(nowMs),
    dateKey: `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`,
    hhmm: `${pad2(k.getUTCHours())}${pad2(k.getUTCMinutes())}`,
  };
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function norm(value) {
  const text = String(value || "").trim();
  return text || null;
}

function boolSetting(raw, fallback = true) {
  if (raw == null) return fallback;
  const text = String(raw).trim().toLowerCase();
  if (!text) return fallback;
  return !["0", "false", "off", "no"].includes(text);
}

function resolveBoundedInt(value, fallback, { min = 1, max = 1000 } = {}) {
  const n = Math.trunc(Number(value));
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(min, Math.min(max, Math.trunc(Number(base) || fallback || min)));
}

function buildServingBindingSnapshot({ aiGuard = null } = {}) {
  const guard = aiGuard && typeof aiGuard === "object" ? aiGuard : {};
  return {
    provider_mode: upper(process.env.SIGNAL_AI_PROVIDER_MODE) || "ENSEMBLE",
    claude_model: norm(process.env.SIGNAL_AI_CLAUDE_MODEL || process.env.SIGNAL_AI_MODEL || guard.claude_model || process.env.CLAUDE_MODEL || "claude-opus-4-5-20251101"),
    openai_model: norm(process.env.SIGNAL_AI_GPT_MODEL || process.env.SIGNAL_AI_OPENAI_MODEL || process.env.OPENAI_MODEL || "gpt-5.2"),
    openai_reasoning_effort: norm(process.env.SIGNAL_AI_OPENAI_REASONING_EFFORT || process.env.OPENAI_REASONING_EFFORT || "medium"),
    ensemble_enabled: boolSetting(process.env.SIGNAL_AI_ENSEMBLE_ENABLED, true),
    require_live_serving: false,
  };
}

function buildShadowPromotionAction({
  gate = null,
  servingState = null,
} = {}) {
  const resolvedGate = gate && typeof gate === "object" ? gate : {};
  const resolvedServing = servingState && typeof servingState === "object" ? servingState : {};
  const preferredArtifactId = norm(resolvedServing.preferred_model_artifact_id);
  if (resolvedGate.promotion_blocked === true || upper(resolvedGate.status) === "BLOCK") {
    return {
      action: "ROLLBACK_AND_BLOCK",
      rollback_triggered: true,
      block_new_entries: true,
      target_artifact_id: preferredArtifactId,
      reason: upper(resolvedGate.reason) || "SHADOW_CANARY_BLOCK",
    };
  }
  if (resolvedServing.live_serving_allowed === true && preferredArtifactId) {
    return {
      action: "PROMOTE_PREFERRED_ARTIFACT",
      rollback_triggered: false,
      block_new_entries: resolvedServing.block_new_entries === true,
      target_artifact_id: preferredArtifactId,
      reason: upper(resolvedServing.reason) || "ML_SERVING_CANARY_PASS",
    };
  }
  return {
    action: "HOLD_SHADOW_ONLY",
    rollback_triggered: false,
    block_new_entries: resolvedServing.block_new_entries === true,
    target_artifact_id: preferredArtifactId,
    reason: upper(resolvedServing.reason) || upper(resolvedGate.reason) || "SHADOW_ONLY",
  };
}

function parseMarkets(value, fallbackExchange = null) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\|]/);
  const rows = raw
    .map((row) => upper(row))
    .filter(Boolean);
  if (rows.length) return rows;
  return defaultMarketsFromEnv(fallbackExchange || "BINANCEFUT");
}

function resolveMlOpsPipelineMarkets(markets = null, fallbackExchange = null) {
  const explicit = parseMarkets(markets, fallbackExchange);
  if (markets != null && explicit.length) return explicit;
  const envMarkets = parseMarkets(
    process.env.ML_OPS_PIPELINE_MARKETS || process.env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS || "",
    fallbackExchange
  );
  return envMarkets.length ? envMarkets : explicit;
}

function renderFeatureLabelDatasetMarkdown(payload = {}) {
  const summary = payload.summary || {};
  const dataset = payload.dataset || {};
  const manifest = dataset.source_manifest || {};
  const topMarkets = (Array.isArray(summary.top_markets) ? summary.top_markets : [])
    .map((row) => `${row.market} ${row.rows_n}`)
    .join(" / ") || "N/A";
  return [
    "# Feature Label Dataset",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "N/A"} / tf: ${payload.tf || "N/A"}`,
    `- markets_n: ${payload.markets_n != null ? payload.markets_n : "N/A"} / rows_n: ${summary.rows_n != null ? summary.rows_n : "N/A"}`,
    `- window_from_ms: ${payload.window && payload.window.from_ms != null ? payload.window.from_ms : "N/A"} / window_to_ms: ${payload.window && payload.window.to_ms != null ? payload.window.to_ms : "N/A"}`,
    `- dataset_hash: ${dataset.dataset_hash || "N/A"} / manifest_hash: ${manifest.manifest_hash || "N/A"}`,
    `- top_markets: ${topMarkets}`,
  ].join("\n") + "\n";
}

function summarizeFeatureLabelDataset(dataset = null) {
  const rows = dataset && Array.isArray(dataset.rows) ? dataset.rows : [];
  const byMarket = new Map();
  for (const row of rows) {
    const market = upper(row.market) || "UNKNOWN";
    byMarket.set(market, (byMarket.get(market) || 0) + 1);
  }
  return {
    rows_n: rows.length,
    top_markets: [...byMarket.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([market, rowsN]) => ({ market, rows_n: rowsN })),
  };
}

async function runFeatureLabelDatasetJob({
  exchange = null,
  markets = null,
  tf = null,
  limitN = null,
  windowDays = null,
  fromMs = null,
  force = false,
} = {}) {
  const nowMeta = nowKstMeta();
  const exchangeUpper = upper(exchange || process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER) || "BINANCEFUT";
  const marketList = parseMarkets(markets, exchangeUpper);
  const tfValue = String(tf || defaultExecTfFromEnv() || "15m").trim() || "15m";
  const featureMaxLimit = resolveBoundedInt(process.env.FEATURE_LABEL_DATASET_MAX_LIMIT_N, 1000, {
    min: 100,
    max: 5000,
  });
  const limitValue = resolveBoundedInt(limitN || process.env.FEATURE_LABEL_DATASET_LIMIT_N, 500, {
    min: 20,
    max: featureMaxLimit,
  });
  const windowDaysValue = Math.max(1, Number(windowDays || process.env.FEATURE_LABEL_DATASET_WINDOW_DAYS || 14));
  const minIntervalMs = Math.max(5 * 60 * 1000, Number(process.env.FEATURE_LABEL_DATASET_MIN_INTERVAL_MS || (6 * 60 * 60 * 1000)));
  const latestJson = path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.md");
  const latestJsonl = path.join(OPS_DAILY_DIR, "feature_label_dataset_latest.jsonl");
  const latestMtimeMs = statMtimeMs(latestJson);
  if (force !== true && Number.isFinite(latestMtimeMs) && (nowMeta.nowMs - latestMtimeMs) < minIntervalMs) {
    return {
      ok: true,
      skipped: true,
      reason: "ARTIFACT_FRESH",
      latest_json: latestJson,
      latest_md: latestMd,
      latest_jsonl: latestJsonl,
      age_ms: nowMeta.nowMs - latestMtimeMs,
    };
  }
  const windowFromMs = Number.isFinite(Number(fromMs))
    ? Number(fromMs)
    : (nowMeta.nowMs - (windowDaysValue * 24 * 60 * 60 * 1000));
  const dataset = await buildFeatureLabelDataset({
    exchange: exchangeUpper,
    markets: marketList,
    tf: tfValue,
    limitN: limitValue,
    fromMs: windowFromMs,
  });
  const summary = summarizeFeatureLabelDataset(dataset);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: exchangeUpper,
    tf: tfValue,
    markets_n: marketList.length,
    limit_n: limitValue,
    window: {
      from_ms: windowFromMs,
      to_ms: nowMeta.nowMs,
    },
    summary,
    dataset,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_feature_label_dataset`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const jsonlPath = path.join(OPS_DAILY_DIR, `${base}.jsonl`);

  writeJson(jsonPath, payload);
  writeText(mdPath, renderFeatureLabelDatasetMarkdown(payload));
  writeText(jsonlPath, (dataset.rows || []).map((row) => JSON.stringify(row)).join("\n") + ((dataset.rows || []).length ? "\n" : ""));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copyLatest(jsonlPath, latestJsonl);

  return {
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    latest_jsonl: latestJsonl,
    rows_n: summary.rows_n,
    exchange: exchangeUpper,
    tf: tfValue,
  };
}

async function fetchRecentShadowEvaluations({
  exchange = null,
  fromMs = null,
  limit = null,
} = {}) {
  const db = getFirestore();
  const limitValue = resolveBoundedInt(limit || process.env.SHADOW_EVAL_SUMMARY_LIMIT, 500, {
    min: 20,
    max: resolveBoundedInt(process.env.SHADOW_EVAL_SUMMARY_MAX_LIMIT, 1000, { min: 100, max: 5000 }),
  });
  const snap = await db.collection("shadow_evaluations")
    .orderBy("created_at", "desc")
    .limit(limitValue)
    .get();
  const ex = upper(exchange);
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((row) => {
      if (ex && upper(row.exchange) !== ex) return false;
      const ms = Date.parse(String(row.created_at || ""));
      if (Number.isFinite(Number(fromMs)) && Number.isFinite(ms) && ms < Number(fromMs)) return false;
      return true;
    });
}

function summarizeShadowEvaluations(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const byEvent = new Map();
  const byModel = new Map();
  const bySymbol = new Map();
  const byReason = new Map();
  let allowN = 0;
  let blockN = 0;
  for (const row of items) {
    const event = upper(row.event) || "UNKNOWN";
    const model = upper(row.model_key) || "UNKNOWN";
    const symbol = upper(row.symbol) || "UNKNOWN";
    const reason = upper(row && row.baseline_decision && row.baseline_decision.reason) || "UNKNOWN";
    byEvent.set(event, (byEvent.get(event) || 0) + 1);
    byModel.set(model, (byModel.get(model) || 0) + 1);
    bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + 1);
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
    if (row && row.baseline_decision && row.baseline_decision.ok === true) allowN += 1;
    else blockN += 1;
  }
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
  return {
    rows_n: items.length,
    allow_n: allowN,
    block_n: blockN,
    by_event: top(byEvent),
    by_model: top(byModel),
    by_symbol: top(bySymbol),
    by_reason: top(byReason),
  };
}

function normalizeShadowInference(row = {}) {
  const baseline = row && row.baseline_decision && typeof row.baseline_decision === "object"
    ? row.baseline_decision
    : {};
  const shadow = row && row.shadow_decision && typeof row.shadow_decision === "object"
    ? row.shadow_decision
    : {};
  const inference = shadow && shadow.inference && typeof shadow.inference === "object"
    ? shadow.inference
    : {};
  const policy = shadow && shadow.policy && typeof shadow.policy === "object"
    ? shadow.policy
    : {};
  const baselineOk = baseline.ok === true;
  const shadowOk = inference.ok === true
    || (inference.ok == null && policy.blocked === false)
    || (inference.ok == null && Number.isFinite(Number(inference.qty_pct_final)) && Number(inference.qty_pct_final) > 0);
  return {
    baseline_ok: baselineOk,
    shadow_ok: shadowOk,
    baseline_reason: upper(baseline.reason) || null,
    shadow_reason: upper(inference.reason || policy.reason) || null,
    baseline_qty_pct_final: toNum(baseline.qty_pct_final),
    shadow_qty_pct_final: toNum(inference.qty_pct_final || policy.qty_after),
    compared: baseline.ok === true || baseline.ok === false,
  };
}

function summarizeShadowInferenceCanary(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const bySymbol = new Map();
  const byReason = new Map();
  let comparedN = 0;
  let disagreementN = 0;
  let baselineAllowN = 0;
  let shadowAllowN = 0;
  for (const row of items) {
    const normalized = normalizeShadowInference(row);
    if (!normalized.compared) continue;
    comparedN += 1;
    if (normalized.baseline_ok === true) baselineAllowN += 1;
    if (normalized.shadow_ok === true) shadowAllowN += 1;
    if (normalized.baseline_ok !== normalized.shadow_ok) {
      disagreementN += 1;
      const symbol = upper(row.symbol) || "UNKNOWN";
      const reason = normalized.shadow_reason || normalized.baseline_reason || "UNKNOWN";
      bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + 1);
      byReason.set(reason, (byReason.get(reason) || 0) + 1);
    }
  }
  const disagreementRate = comparedN > 0 ? (disagreementN / comparedN) : 0;
  const rollbackThreshold = Math.max(0, Math.min(1, Number(process.env.SHADOW_INFERENCE_CANARY_ROLLBACK_THRESHOLD || 0.15)));
  const minSamples = Math.max(5, Number(process.env.SHADOW_INFERENCE_CANARY_MIN_SAMPLES || 20));
  const top = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, count]) => ({ key, count }));
  return {
    rows_n: items.length,
    compared_n: comparedN,
    disagreement_n: disagreementN,
    disagreement_rate: disagreementRate,
    baseline_allow_n: baselineAllowN,
    shadow_allow_n: shadowAllowN,
    rollback_triggered: comparedN >= minSamples && disagreementRate >= rollbackThreshold,
    rollback_threshold: rollbackThreshold,
    min_samples: minSamples,
    by_symbol: top(bySymbol),
    by_reason: top(byReason),
  };
}

function buildShadowCanaryGate(summary = {}) {
  const comparedN = Math.max(0, Number(summary.compared_n) || 0);
  const disagreementRate = Math.max(0, Number(summary.disagreement_rate) || 0);
  const minSamples = Math.max(1, Number(summary.min_samples) || 20);
  const rollbackThreshold = Math.max(0, Math.min(1, Number(summary.rollback_threshold) || 0.15));
  const warnThreshold = Math.max(0, Math.min(rollbackThreshold, Number(process.env.SHADOW_INFERENCE_CANARY_WARN_THRESHOLD || (rollbackThreshold / 2))));
  const enoughSamples = comparedN >= minSamples;
  const block = summary.rollback_triggered === true;
  const warn = !block && ((!enoughSamples) || disagreementRate >= warnThreshold);
  let status = "PASS";
  let reason = "CANARY_STABLE";
  if (block) {
    status = "BLOCK";
    reason = enoughSamples ? "DISAGREEMENT_RATE_HIGH" : "INSUFFICIENT_SAMPLES";
  } else if (warn) {
    status = "WARN";
    reason = !enoughSamples ? "INSUFFICIENT_SAMPLES" : "DISAGREEMENT_RATE_ELEVATED";
  }
  return {
    status,
    reason,
    compared_n: comparedN,
    disagreement_rate: disagreementRate,
    min_samples: minSamples,
    rollback_threshold: rollbackThreshold,
    warn_threshold: warnThreshold,
    enough_samples: enoughSamples,
    promotion_blocked: block,
  };
}

function renderShadowCanaryGateMarkdown(payload = {}) {
  const gate = payload.gate || {};
  const summary = payload.summary || {};
  return [
    "# Shadow Canary Gate",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "ALL"}`,
    `- gate_status: ${gate.status || "N/A"} / reason: ${gate.reason || "N/A"}`,
    `- promotion_blocked: ${gate.promotion_blocked === true ? "YES" : "NO"} / enough_samples: ${gate.enough_samples === true ? "YES" : "NO"}`,
    `- compared_n: ${summary.compared_n != null ? summary.compared_n : "N/A"} / disagreement_rate: ${summary.disagreement_rate != null ? Number(summary.disagreement_rate).toFixed(4) : "N/A"}`,
    `- thresholds: warn ${gate.warn_threshold != null ? gate.warn_threshold : "N/A"} / rollback ${gate.rollback_threshold != null ? gate.rollback_threshold : "N/A"} / min_samples ${gate.min_samples != null ? gate.min_samples : "N/A"}`,
  ].join("\n") + "\n";
}

function renderMlServingStateMarkdown(payload = {}) {
  const state = payload.state || {};
  const promotionAction = state.promotion_action || {};
  return [
    "# ML Serving State",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "ALL"}`,
    `- status: ${state.status || "N/A"} / reason: ${state.reason || "N/A"}`,
    `- serving_mode: ${state.serving_mode || "N/A"} / live_allowed: ${state.live_serving_allowed === true ? "YES" : "NO"} / block_new_entries: ${state.block_new_entries === true ? "YES" : "NO"}`,
    `- gate_status: ${state.gate_status || "N/A"} / gate_reason: ${state.gate_reason || "N/A"} / stale: ${state.stale === true ? "YES" : "NO"}`,
    `- preferred_model_artifact_id: ${state.preferred_model_artifact_id || "N/A"}`,
    `- promotion_action: ${promotionAction.action || "N/A"} / rollback_triggered: ${promotionAction.rollback_triggered === true ? "YES" : "NO"} / target_artifact_id: ${promotionAction.target_artifact_id || "N/A"}`,
  ].join("\n") + "\n";
}

function renderShadowSummaryMarkdown(payload = {}) {
  const summary = payload.summary || {};
  const line = (rows) => (Array.isArray(rows) ? rows : []).map((row) => `${row.key} ${row.count}`).join(" / ") || "N/A";
  return [
    "# Shadow Evaluation Summary",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "ALL"}`,
    `- rows_n: ${summary.rows_n != null ? summary.rows_n : "N/A"} / allow ${summary.allow_n != null ? summary.allow_n : "N/A"} / block ${summary.block_n != null ? summary.block_n : "N/A"}`,
    `- by_event: ${line(summary.by_event)}`,
    `- by_model: ${line(summary.by_model)}`,
    `- by_symbol: ${line(summary.by_symbol)}`,
    `- by_reason: ${line(summary.by_reason)}`,
  ].join("\n") + "\n";
}

function renderShadowInferenceCanaryMarkdown(payload = {}) {
  const summary = payload.summary || {};
  const line = (rows) => (Array.isArray(rows) ? rows : []).map((row) => `${row.key} ${row.count}`).join(" / ") || "N/A";
  return [
    "# Shadow Inference Canary",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "ALL"}`,
    `- compared_n: ${summary.compared_n != null ? summary.compared_n : "N/A"} / disagreement_n: ${summary.disagreement_n != null ? summary.disagreement_n : "N/A"} / disagreement_rate: ${summary.disagreement_rate != null ? Number(summary.disagreement_rate).toFixed(4) : "N/A"}`,
    `- baseline_allow_n: ${summary.baseline_allow_n != null ? summary.baseline_allow_n : "N/A"} / shadow_allow_n: ${summary.shadow_allow_n != null ? summary.shadow_allow_n : "N/A"}`,
    `- rollback_triggered: ${summary.rollback_triggered === true ? "YES" : "NO"} / threshold ${summary.rollback_threshold != null ? summary.rollback_threshold : "N/A"} / min_samples ${summary.min_samples != null ? summary.min_samples : "N/A"}`,
    `- by_symbol: ${line(summary.by_symbol)}`,
    `- by_reason: ${line(summary.by_reason)}`,
  ].join("\n") + "\n";
}

async function runShadowEvaluationSummaryJob({
  exchange = null,
  fromMs = null,
  windowHours = null,
  limit = null,
  force = false,
} = {}) {
  const nowMeta = nowKstMeta();
  const exchangeUpper = upper(exchange || process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER || null);
  const windowHoursValue = Math.max(1, Number(windowHours || process.env.SHADOW_EVAL_SUMMARY_WINDOW_HOURS || 24));
  const limitValue = resolveBoundedInt(limit || process.env.SHADOW_EVAL_SUMMARY_LIMIT, 500, {
    min: 20,
    max: resolveBoundedInt(process.env.SHADOW_EVAL_SUMMARY_MAX_LIMIT, 1000, { min: 100, max: 5000 }),
  });
  const minIntervalMs = Math.max(5 * 60 * 1000, Number(process.env.SHADOW_EVAL_SUMMARY_MIN_INTERVAL_MS || (60 * 60 * 1000)));
  const latestJson = path.join(OPS_DAILY_DIR, "shadow_evaluation_summary_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "shadow_evaluation_summary_latest.md");
  const latestMtimeMs = statMtimeMs(latestJson);
  if (force !== true && Number.isFinite(latestMtimeMs) && (nowMeta.nowMs - latestMtimeMs) < minIntervalMs) {
    return {
      ok: true,
      skipped: true,
      reason: "ARTIFACT_FRESH",
      latest_json: latestJson,
      latest_md: latestMd,
      age_ms: nowMeta.nowMs - latestMtimeMs,
    };
  }
  const windowFromMs = Number.isFinite(Number(fromMs))
    ? Number(fromMs)
    : (nowMeta.nowMs - (windowHoursValue * 60 * 60 * 1000));
  const rows = await fetchRecentShadowEvaluations({
    exchange: exchangeUpper,
    fromMs: windowFromMs,
    limit: limitValue,
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: exchangeUpper,
    window: {
      from_ms: windowFromMs,
      to_ms: nowMeta.nowMs,
    },
    summary: summarizeShadowEvaluations(rows),
    sample: rows.slice(0, 50),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_shadow_evaluation_summary`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);

  writeJson(jsonPath, payload);
  writeText(mdPath, renderShadowSummaryMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  return {
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    rows_n: payload.summary.rows_n,
    exchange: payload.exchange,
  };
}

async function runShadowInferenceCanaryJob({
  exchange = null,
  fromMs = null,
  windowHours = null,
  limit = null,
  force = false,
} = {}) {
  const nowMeta = nowKstMeta();
  const exchangeUpper = upper(exchange || process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER || null);
  const windowHoursValue = Math.max(1, Number(windowHours || process.env.SHADOW_INFERENCE_CANARY_WINDOW_HOURS || 24));
  const limitValue = resolveBoundedInt(limit || process.env.SHADOW_INFERENCE_CANARY_LIMIT, 500, {
    min: 20,
    max: resolveBoundedInt(process.env.SHADOW_INFERENCE_CANARY_MAX_LIMIT, 1000, { min: 100, max: 5000 }),
  });
  const minIntervalMs = Math.max(5 * 60 * 1000, Number(process.env.SHADOW_INFERENCE_CANARY_MIN_INTERVAL_MS || (60 * 60 * 1000)));
  const latestJson = path.join(OPS_DAILY_DIR, "shadow_inference_canary_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "shadow_inference_canary_latest.md");
  const latestGateJson = path.join(OPS_DAILY_DIR, "shadow_inference_canary_gate_latest.json");
  const latestGateMd = path.join(OPS_DAILY_DIR, "shadow_inference_canary_gate_latest.md");
  const latestServingJson = path.join(OPS_DAILY_DIR, "ml_serving_state_latest.json");
  const latestServingMd = path.join(OPS_DAILY_DIR, "ml_serving_state_latest.md");
  const executionServingContract = safeReadJson(path.join(OPS_DAILY_DIR, "best_self_evolution_execution_serving_contract_latest.json"));
  const mlModelContract = safeReadJson(path.join(OPS_DAILY_DIR, "best_self_evolution_ml_model_contract_latest.json"));
  const latestMtimeMs = statMtimeMs(latestJson);
  if (force !== true && Number.isFinite(latestMtimeMs) && (nowMeta.nowMs - latestMtimeMs) < minIntervalMs) {
    return {
      ok: true,
      skipped: true,
      reason: "ARTIFACT_FRESH",
      latest_json: latestJson,
      latest_md: latestMd,
      age_ms: nowMeta.nowMs - latestMtimeMs,
    };
  }
  const windowFromMs = Number.isFinite(Number(fromMs))
    ? Number(fromMs)
    : (nowMeta.nowMs - (windowHoursValue * 60 * 60 * 1000));
  const rows = await fetchRecentShadowEvaluations({
    exchange: exchangeUpper,
    fromMs: windowFromMs,
    limit: limitValue,
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: exchangeUpper,
    window: {
      from_ms: windowFromMs,
      to_ms: nowMeta.nowMs,
    },
    summary: summarizeShadowInferenceCanary(rows),
    sample: rows.slice(0, 50).map((row) => ({
      evaluation_id: row.evaluation_id || row.id || null,
      symbol: row.symbol || null,
      event: row.event || null,
      created_at: row.created_at || null,
      normalized: normalizeShadowInference(row),
    })),
  };
  payload.gate = buildShadowCanaryGate(payload.summary);
  payload.serving_state = buildMlServingState({
    exchange: exchangeUpper,
    shadowCanaryGate: {
      generated_at: nowMeta.iso,
      gate: payload.gate,
      summary: payload.summary,
    },
    executionServingContract,
    mlModelContract,
  });
  payload.promotion_action = buildShadowPromotionAction({
    gate: payload.gate,
    servingState: payload.serving_state,
  });
  payload.actuation = await applyMlServingActuation({
    exchange: exchangeUpper,
    servingState: {
      ...(payload.serving_state || {}),
      promotion_action: payload.promotion_action,
    },
    generatedAt: nowMeta.iso,
  }).catch(() => null);
  if (payload.actuation && payload.actuation.next_serving_state) {
    payload.serving_state = payload.actuation.next_serving_state;
  }
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_shadow_inference_canary`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const gateJsonPath = path.join(OPS_DAILY_DIR, `${base}_gate.json`);
  const gateMdPath = path.join(OPS_DAILY_DIR, `${base}_gate.md`);
  const servingJsonPath = path.join(OPS_DAILY_DIR, `${base}_serving_state.json`);
  const servingMdPath = path.join(OPS_DAILY_DIR, `${base}_serving_state.md`);

  writeJson(jsonPath, payload);
  writeText(mdPath, renderShadowInferenceCanaryMarkdown(payload));
  writeJson(gateJsonPath, {
    ok: true,
    generated_at_kst: payload.generated_at_kst,
    exchange: payload.exchange,
    window: payload.window,
    summary: payload.summary,
    gate: payload.gate,
    artifacts: {
      canary_json: jsonPath,
      canary_md: mdPath,
    },
  });
  writeText(gateMdPath, renderShadowCanaryGateMarkdown(payload));
  writeJson(servingJsonPath, {
    ok: true,
    generated_at_kst: payload.generated_at_kst,
    exchange: payload.exchange,
    state: {
      ...(payload.serving_state || {}),
      promotion_action: payload.promotion_action,
      actuation: payload.actuation,
    },
    artifacts: {
      canary_json: jsonPath,
      gate_json: gateJsonPath,
    },
  });
  writeText(servingMdPath, renderMlServingStateMarkdown({
    generated_at_kst: payload.generated_at_kst,
    exchange: payload.exchange,
    state: payload.serving_state,
  }));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copyLatest(gateJsonPath, latestGateJson);
  copyLatest(gateMdPath, latestGateMd);
  copyLatest(servingJsonPath, latestServingJson);
  copyLatest(servingMdPath, latestServingMd);
  await recordShadowCanaryGate({
    exchange: exchangeUpper,
    generatedAt: nowMeta.iso,
    window: payload.window,
    summary: payload.summary,
    gate: payload.gate,
    sample: payload.sample,
    artifacts: {
      latest_json: latestJson,
      latest_md: latestMd,
      latest_gate_json: latestGateJson,
      latest_gate_md: latestGateMd,
      latest_serving_json: latestServingJson,
      latest_serving_md: latestServingMd,
    },
  }).catch(() => null);
  await recordMlServingState({
    exchange: exchangeUpper,
    generatedAt: nowMeta.iso,
    state: {
      ...(payload.serving_state || {}),
      promotion_action: payload.promotion_action,
      actuation: payload.actuation,
    },
    source: "SHADOW_INFERENCE_CANARY",
    artifacts: {
      latest_json: latestServingJson,
      latest_md: latestServingMd,
      latest_gate_json: latestGateJson,
      latest_gate_md: latestGateMd,
    },
  }).catch(() => null);
  const aiGuard = await getAiGuardSettingsCached(30_000)
    .then((res) => (res && res.data ? res.data : null))
    .catch(() => null);
  const binding = buildServingBindingSnapshot({ aiGuard });
  if (!(payload.actuation && payload.actuation.apply === true)) {
    await recordMlServingBinding({
      exchange: exchangeUpper,
      binding,
      source: "SHADOW_INFERENCE_CANARY",
      generatedAt: nowMeta.iso,
    }).catch(() => null);
  }
  if (payload.serving_state && payload.serving_state.preferred_model_artifact_id) {
    await ensureMlServingBinding({
      exchange: exchangeUpper,
      artifactId: payload.serving_state.preferred_model_artifact_id,
      binding,
      source: "SHADOW_INFERENCE_CANARY",
      generatedAt: nowMeta.iso,
    }).catch(() => null);
  }

  return {
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    latest_gate_json: latestGateJson,
    latest_gate_md: latestGateMd,
    latest_serving_json: latestServingJson,
    latest_serving_md: latestServingMd,
    compared_n: payload.summary.compared_n,
    disagreement_n: payload.summary.disagreement_n,
    rollback_triggered: payload.summary.rollback_triggered,
    gate: payload.gate,
    serving_state: payload.serving_state,
    promotion_action: payload.promotion_action,
    actuation: payload.actuation,
    exchange: payload.exchange,
  };
}

async function runMlOpsPipelineJob(options = {}) {
  const exchangeUpper = upper(options.exchange || process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER) || "BINANCEFUT";
  const pipelineMarkets = resolveMlOpsPipelineMarkets(options.markets, exchangeUpper);
  const datasetLimit = resolveBoundedInt(
    options.limitN || process.env.ML_OPS_PIPELINE_FEATURE_LIMIT_N || process.env.FEATURE_LABEL_DATASET_LIMIT_N,
    40,
    {
      min: 10,
      max: resolveBoundedInt(process.env.ML_OPS_PIPELINE_FEATURE_MAX_LIMIT_N, 100, { min: 20, max: 500 }),
    }
  );
  const shadowLimit = resolveBoundedInt(
    options.limit || process.env.ML_OPS_PIPELINE_SHADOW_LIMIT || process.env.SHADOW_EVAL_SUMMARY_LIMIT,
    100,
    {
      min: 20,
      max: resolveBoundedInt(process.env.ML_OPS_PIPELINE_SHADOW_MAX_LIMIT, 200, { min: 50, max: 1000 }),
    }
  );
  const openclawDecisionLimit = resolveBoundedInt(
    options.limitDecisions || process.env.ML_OPS_PIPELINE_OPENCLAW_LIMIT_DECISIONS || process.env.OPENCLAW_POLICY_TUNING_LIMIT_DECISIONS,
    200,
    {
      min: 50,
      max: resolveBoundedInt(process.env.ML_OPS_PIPELINE_OPENCLAW_MAX_DECISIONS, 500, { min: 100, max: 2000 }),
    }
  );
  const openclawFillLimit = resolveBoundedInt(
    options.limitFills || process.env.ML_OPS_PIPELINE_OPENCLAW_LIMIT_FILLS || process.env.OPENCLAW_POLICY_TUNING_LIMIT_FILLS,
    200,
    {
      min: 50,
      max: resolveBoundedInt(process.env.ML_OPS_PIPELINE_OPENCLAW_MAX_FILLS, 500, { min: 100, max: 2000 }),
    }
  );
  const openclawShadowLimit = resolveBoundedInt(
    options.limitShadow || process.env.ML_OPS_PIPELINE_OPENCLAW_LIMIT_SHADOW || process.env.OPENCLAW_POLICY_TUNING_LIMIT_SHADOW,
    100,
    {
      min: 50,
      max: resolveBoundedInt(process.env.ML_OPS_PIPELINE_OPENCLAW_MAX_SHADOW, 300, { min: 100, max: 2000 }),
    }
  );

  const common = {
    ...options,
    exchange: exchangeUpper,
  };
  const dataset = await runFeatureLabelDatasetJob({
    ...common,
    markets: pipelineMarkets,
    limitN: datasetLimit,
  });
  const shadow = await runShadowEvaluationSummaryJob({
    ...common,
    limit: shadowLimit,
  });
  const shadowCanary = await runShadowInferenceCanaryJob({
    ...common,
    limit: shadowLimit,
  });
  const openclaw = await runOpenClawPolicyTuningReport({
    ...common,
    limitDecisions: openclawDecisionLimit,
    limitFills: openclawFillLimit,
    limitShadow: openclawShadowLimit,
  });
  return {
    ok: dataset.ok === true && shadow.ok === true && shadowCanary.ok === true && openclaw.ok === true,
    caps: {
      markets: pipelineMarkets,
      dataset_limit_n: datasetLimit,
      shadow_limit: shadowLimit,
      openclaw_limit_decisions: openclawDecisionLimit,
      openclaw_limit_fills: openclawFillLimit,
      openclaw_limit_shadow: openclawShadowLimit,
    },
    dataset,
    shadow,
    shadow_canary: shadowCanary,
    openclaw,
  };
}

module.exports = {
  fetchRecentShadowEvaluations,
  runFeatureLabelDatasetJob,
  runShadowEvaluationSummaryJob,
  runShadowInferenceCanaryJob,
  runMlOpsPipelineJob,
  __test: {
    parseMarkets,
    summarizeFeatureLabelDataset,
    summarizeShadowEvaluations,
    normalizeShadowInference,
    summarizeShadowInferenceCanary,
    buildShadowCanaryGate,
    renderFeatureLabelDatasetMarkdown,
    renderShadowSummaryMarkdown,
    renderShadowInferenceCanaryMarkdown,
    renderShadowCanaryGateMarkdown,
    renderMlServingStateMarkdown,
    buildServingBindingSnapshot,
    buildShadowPromotionAction,
    resolveBoundedInt,
    resolveMlOpsPipelineMarkets,
  },
};
