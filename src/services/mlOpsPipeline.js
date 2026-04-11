"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");
const { defaultMarketsFromEnv, defaultExecTfFromEnv } = require("../utils/marketConfig");
const { KST_OFFSET_MS, toKstString } = require("../utils/timeKst");
const { buildFeatureLabelDataset } = require("./featureLabelDataset");
const { recordShadowCanaryGate } = require("../storage/shadowCanaryGates");

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

function parseMarkets(value, fallbackExchange = null) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const rows = raw
    .map((row) => upper(row))
    .filter(Boolean);
  if (rows.length) return rows;
  return defaultMarketsFromEnv(fallbackExchange || "BINANCEFUT");
}

function renderFeatureLabelDatasetMarkdown(payload = {}) {
  const summary = payload.summary || {};
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
  const limitValue = Math.max(100, Number(limitN || process.env.FEATURE_LABEL_DATASET_LIMIT_N || 2000));
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
  limit = Math.max(100, Number(process.env.SHADOW_EVAL_SUMMARY_LIMIT || 2000)),
} = {}) {
  const db = getFirestore();
  const snap = await db.collection("shadow_evaluations")
    .orderBy("created_at", "desc")
    .limit(Math.max(1, Math.trunc(Number(limit) || 2000)))
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
  const limitValue = Math.max(100, Number(limit || process.env.SHADOW_EVAL_SUMMARY_LIMIT || 2000));
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
  const limitValue = Math.max(100, Number(limit || process.env.SHADOW_INFERENCE_CANARY_LIMIT || 2000));
  const minIntervalMs = Math.max(5 * 60 * 1000, Number(process.env.SHADOW_INFERENCE_CANARY_MIN_INTERVAL_MS || (60 * 60 * 1000)));
  const latestJson = path.join(OPS_DAILY_DIR, "shadow_inference_canary_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "shadow_inference_canary_latest.md");
  const latestGateJson = path.join(OPS_DAILY_DIR, "shadow_inference_canary_gate_latest.json");
  const latestGateMd = path.join(OPS_DAILY_DIR, "shadow_inference_canary_gate_latest.md");
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
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_shadow_inference_canary`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const gateJsonPath = path.join(OPS_DAILY_DIR, `${base}_gate.json`);
  const gateMdPath = path.join(OPS_DAILY_DIR, `${base}_gate.md`);

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
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  copyLatest(gateJsonPath, latestGateJson);
  copyLatest(gateMdPath, latestGateMd);
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
    },
  }).catch(() => null);

  return {
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    latest_gate_json: latestGateJson,
    latest_gate_md: latestGateMd,
    compared_n: payload.summary.compared_n,
    disagreement_n: payload.summary.disagreement_n,
    rollback_triggered: payload.summary.rollback_triggered,
    gate: payload.gate,
    exchange: payload.exchange,
  };
}

async function runMlOpsPipelineJob(options = {}) {
  const dataset = await runFeatureLabelDatasetJob(options);
  const shadow = await runShadowEvaluationSummaryJob(options);
  const shadowCanary = await runShadowInferenceCanaryJob(options);
  return {
    ok: dataset.ok === true && shadow.ok === true && shadowCanary.ok === true,
    dataset,
    shadow,
    shadow_canary: shadowCanary,
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
  },
};
