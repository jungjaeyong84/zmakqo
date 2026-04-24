"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../storage/firestore");
const { listRecentOpenClawPolicyDecisions } = require("../storage/openclawPolicyDecisions");
const { KST_OFFSET_MS, toKstString } = require("../utils/timeKst");

const REPO_ROOT = path.resolve(__dirname, "../..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function norm(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boundedPositiveInt(value, fallback, { min = 100, max = 5000 } = {}) {
  const n = Math.trunc(Number(value));
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(min, Math.min(max, Math.trunc(Number(base) || fallback || min)));
}

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

function topEntries(map, valueKey = "count", limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => ({ key, [valueKey]: value }));
}

function readRealizedPnl(fill = null) {
  if (!fill || typeof fill !== "object") return null;
  return toNum(
    fill.external_realized_pnl
    ?? fill.realized_pnl
    ?? fill.realizedPnl
    ?? (fill.extra && (fill.extra.external_realized_pnl ?? fill.extra.realized_pnl))
  );
}

function readFee(fill = null) {
  if (!fill || typeof fill !== "object") return 0;
  return toNum(fill.fee_value ?? fill.feeValue) || 0;
}

function isExitFill(fill = null) {
  const ev = upper(fill && fill.event);
  if (!ev) return false;
  return ev.includes("EXIT") || ev.includes("TRAIL") || ev.includes("TP") || ev.includes("SL") || ev.includes("FORCE_EXIT");
}

function actionIsReduce(row = null) {
  return upper(row && row.action) === "REDUCE"
    || ((toNum(row && row.requested_qty_pct) || 0) > (toNum(row && row.final_qty_pct) || 0));
}

function isAggressive(row = null) {
  return upper(row && row.exit_profile_mode) === "AGGRESSIVE";
}

function kstStartOfDayMs(nowMs) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate(), 0, 0, 0) - KST_OFFSET_MS;
}

function kstStartOfWeekMs(nowMs) {
  const startOfDayMs = kstStartOfDayMs(nowMs);
  const k = new Date(startOfDayMs + KST_OFFSET_MS);
  const day = k.getUTCDay();
  const mondayOffset = day === 0 ? 6 : (day - 1);
  return startOfDayMs - (mondayOffset * 24 * 60 * 60 * 1000);
}

function kstStartOfMonthMs(nowMs) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), 1, 0, 0, 0) - KST_OFFSET_MS;
}

function kstStartOfYearMs(nowMs) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  return Date.UTC(k.getUTCFullYear(), 0, 1, 0, 0, 0) - KST_OFFSET_MS;
}

function buildPeriods(nowMs = Date.now()) {
  return {
    DAILY: { label: "일간", from_ms: kstStartOfDayMs(nowMs), to_ms: nowMs },
    WEEKLY: { label: "주간", from_ms: kstStartOfWeekMs(nowMs), to_ms: nowMs },
    DAYS_7: { label: "최근 7일", from_ms: nowMs - (7 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_14: { label: "최근 14일", from_ms: nowMs - (14 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_30: { label: "최근 30일", from_ms: nowMs - (30 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    DAYS_90: { label: "최근 90일", from_ms: nowMs - (90 * 24 * 60 * 60 * 1000), to_ms: nowMs },
    MONTHLY: { label: "월간", from_ms: kstStartOfMonthMs(nowMs), to_ms: nowMs },
    YEARLY: { label: "연간", from_ms: kstStartOfYearMs(nowMs), to_ms: nowMs },
  };
}

async function listRecentFills({ exchange = null, fromMs = null, limit = 20000 } = {}) {
  const db = getFirestore();
  const ex = upper(exchange);
  const resolvedLimit = boundedPositiveInt(limit, 2000, {
    min: 100,
    max: boundedPositiveInt(process.env.OPENCLAW_POLICY_TUNING_MAX_FILLS, 5000, { min: 500, max: 20000 }),
  });
  const snap = await db.collection("fills_paper")
    .orderBy("created_at", "desc")
    .limit(resolvedLimit)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((row) => {
      if (ex && upper(row.exchange) !== ex) return false;
      const ms = Date.parse(String(row.created_at || row.updated_at || ""));
      if (Number.isFinite(Number(fromMs)) && Number.isFinite(ms) && ms < Number(fromMs)) return false;
      return true;
    });
}

async function listRecentOpenClawShadowEvaluations({ exchange = null, fromMs = null, limit = 5000 } = {}) {
  const db = getFirestore();
  const ex = upper(exchange);
  const resolvedLimit = boundedPositiveInt(limit, 1000, {
    min: 100,
    max: boundedPositiveInt(process.env.OPENCLAW_POLICY_TUNING_MAX_SHADOW, 3000, { min: 500, max: 10000 }),
  });
  const snap = await db.collection("shadow_evaluations")
    .orderBy("created_at", "desc")
    .limit(resolvedLimit)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((row) => {
      if (upper(row.model_key) !== "OPENCLAW_POLICY_AUTHORITY_V1") return false;
      if (ex && upper(row.exchange) !== ex) return false;
      const ms = Date.parse(String(row.created_at || ""));
      if (Number.isFinite(Number(fromMs)) && Number.isFinite(ms) && ms < Number(fromMs)) return false;
      return true;
    });
}

function filterRowsByPeriod(rows = [], period = null, timeField = "created_at") {
  const fromMs = Number(period && period.from_ms);
  const toMs = Number(period && period.to_ms);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const ms = Date.parse(String(row && row[timeField] || row && row.updated_at || ""));
    if (!Number.isFinite(ms)) return false;
    return ms >= fromMs && ms <= toMs;
  });
}

function summarizeDecisionRows(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const byReason = new Map();
  const byAction = new Map();
  const byStage = new Map();
  const bySymbol = new Map();
  let blockedN = 0;
  let reducedN = 0;
  let aggressiveN = 0;
  for (const row of items) {
    const reason = upper(row.reason) || "UNKNOWN";
    const action = upper(row.action) || "UNKNOWN";
    const stage = upper(row.stage) || "UNKNOWN";
    const symbol = upper(row.symbol) || "UNKNOWN";
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
    byAction.set(action, (byAction.get(action) || 0) + 1);
    byStage.set(stage, (byStage.get(stage) || 0) + 1);
    bySymbol.set(symbol, (bySymbol.get(symbol) || 0) + 1);
    if (row.blocked === true || action === "BLOCK") blockedN += 1;
    if (actionIsReduce(row)) reducedN += 1;
    if (isAggressive(row)) aggressiveN += 1;
  }
  return {
    rows_n: items.length,
    blocked_n: blockedN,
    reduced_n: reducedN,
    aggressive_n: aggressiveN,
    allow_n: Math.max(0, items.length - blockedN),
    blocked_rate: items.length > 0 ? blockedN / items.length : 0,
    reduced_rate: items.length > 0 ? reducedN / items.length : 0,
    aggressive_rate: items.length > 0 ? aggressiveN / items.length : 0,
    by_reason: topEntries(byReason),
    by_action: topEntries(byAction),
    by_stage: topEntries(byStage),
    by_symbol: topEntries(bySymbol),
  };
}

function summarizeFillRows(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const bySymbol = new Map();
  let fillsN = 0;
  let exitFillsN = 0;
  let feeSum = 0;
  let realizedPnlSum = 0;
  let aggressiveExitN = 0;
  let aggressiveRealizedPnlSum = 0;
  let baseExitN = 0;
  let baseRealizedPnlSum = 0;
  for (const row of items) {
    fillsN += 1;
    const symbol = upper(row.symbol || row.symbol_or_pair_id) || "UNKNOWN";
    const fee = readFee(row);
    const realized = readRealizedPnl(row) || 0;
    feeSum += fee;
    if (isExitFill(row)) {
      exitFillsN += 1;
      realizedPnlSum += realized;
      if (upper(row.exit_profile) === "AGGRESSIVE") {
        aggressiveExitN += 1;
        aggressiveRealizedPnlSum += realized;
      } else {
        baseExitN += 1;
        baseRealizedPnlSum += realized;
      }
    }
    const acc = bySymbol.get(symbol) || { symbol, fee_sum: 0, realized_pnl_sum: 0, exit_fills_n: 0 };
    acc.fee_sum += fee;
    if (isExitFill(row)) {
      acc.realized_pnl_sum += realized;
      acc.exit_fills_n += 1;
    }
    bySymbol.set(symbol, acc);
  }
  const bySymbolRows = [...bySymbol.values()]
    .map((row) => ({
      ...row,
      fee_to_abs_realized_ratio: Math.abs(row.realized_pnl_sum) > 0 ? (row.fee_sum / Math.abs(row.realized_pnl_sum)) : null,
    }))
    .sort((a, b) => (toNum(b.fee_to_abs_realized_ratio) || -Infinity) - (toNum(a.fee_to_abs_realized_ratio) || -Infinity))
    .slice(0, 10);
  return {
    fills_n: fillsN,
    exit_fills_n: exitFillsN,
    fee_sum: feeSum,
    realized_pnl_sum: realizedPnlSum,
    fee_to_abs_realized_ratio: Math.abs(realizedPnlSum) > 0 ? (feeSum / Math.abs(realizedPnlSum)) : null,
    aggressive_exit_n: aggressiveExitN,
    aggressive_realized_pnl_sum: aggressiveRealizedPnlSum,
    base_exit_n: baseExitN,
    base_realized_pnl_sum: baseRealizedPnlSum,
    by_symbol: bySymbolRows,
  };
}

function summarizeShadowRows(rows = []) {
  const items = Array.isArray(rows) ? rows : [];
  const byReason = new Map();
  const byStage = new Map();
  let allowN = 0;
  let blockN = 0;
  let aggressiveN = 0;
  for (const row of items) {
    const inference = row && row.shadow_decision && row.shadow_decision.inference && typeof row.shadow_decision.inference === "object"
      ? row.shadow_decision.inference
      : {};
    const policy = row && row.shadow_decision && row.shadow_decision.policy && typeof row.shadow_decision.policy === "object"
      ? row.shadow_decision.policy
      : {};
    const reason = upper(inference.reason) || "UNKNOWN";
    const stage = upper(policy.stage || (row.extra && row.extra.policy_stage)) || "UNKNOWN";
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
    byStage.set(stage, (byStage.get(stage) || 0) + 1);
    if (inference.ok === true) allowN += 1;
    else blockN += 1;
    if (upper(inference.exit_profile_mode) === "AGGRESSIVE") aggressiveN += 1;
  }
  return {
    rows_n: items.length,
    allow_n: allowN,
    block_n: blockN,
    aggressive_n: aggressiveN,
    by_reason: topEntries(byReason),
    by_stage: topEntries(byStage),
  };
}

function buildRecommendations({ decisionSummary = {}, fillSummary = {}, shadowSummary = {} } = {}) {
  const recommendations = [];
  const feeRatio = toNum(fillSummary.fee_to_abs_realized_ratio);
  const blockedRate = toNum(decisionSummary.blocked_rate) || 0;
  const aggressiveExitN = Number(fillSummary.aggressive_exit_n || 0);
  const aggressivePnl = Number(fillSummary.aggressive_realized_pnl_sum || 0);
  const topCostSymbol = Array.isArray(fillSummary.by_symbol) && fillSummary.by_symbol[0] ? fillSummary.by_symbol[0] : null;
  if (Number.isFinite(feeRatio) && feeRatio >= 0.35) {
    recommendations.push({
      key: "RAISE_RECENT_REENTRY_GUARD",
      priority: 1,
      reason: "FEE_TO_REALIZED_RATIO_HIGH",
      target_symbol: topCostSymbol ? topCostSymbol.symbol : null,
      target_fee_to_abs_realized_ratio: topCostSymbol ? toNum(topCostSymbol.fee_to_abs_realized_ratio) : null,
      target_realized_pnl_sum: topCostSymbol ? toNum(topCostSymbol.realized_pnl_sum) : null,
      target_exit_fills_n: topCostSymbol ? Number(topCostSymbol.exit_fills_n || 0) : 0,
      suggested_env: {
        OPENCLAW_EXECUTOR_RECENT_EXIT_BLOCK_MS: 45 * 60 * 1000,
        OPENCLAW_EXECUTOR_RECENT_EXIT_SCALE: 0.45,
      },
    });
  }
  if (topCostSymbol && Number.isFinite(toNum(topCostSymbol.fee_to_abs_realized_ratio)) && toNum(topCostSymbol.fee_to_abs_realized_ratio) >= 1) {
    recommendations.push({
      key: "REVIEW_TOP_COST_SYMBOL",
      priority: 1,
      reason: "TOP_COST_SYMBOL_FEE_DRAG",
      target_symbol: topCostSymbol.symbol,
      target_fee_to_abs_realized_ratio: toNum(topCostSymbol.fee_to_abs_realized_ratio),
      target_realized_pnl_sum: toNum(topCostSymbol.realized_pnl_sum),
      target_exit_fills_n: Number(topCostSymbol.exit_fills_n || 0),
      suggested_env: null,
    });
  }
  if (blockedRate < 0.08 && Number.isFinite(feeRatio) && feeRatio >= 0.25) {
    recommendations.push({
      key: "TIGHTEN_CLUSTER_GUARD",
      priority: 2,
      reason: "LOW_BLOCK_RATE_WITH_ELEVATED_COST",
      suggested_env: {
        OPENCLAW_EXECUTOR_SAME_SIDE_REDUCE_THRESHOLD: 1,
        OPENCLAW_EXECUTOR_CORRELATED_REDUCE_THRESHOLD: 1,
      },
    });
  }
  if (aggressiveExitN >= 8 && aggressivePnl <= 0) {
    recommendations.push({
      key: "DISABLE_AGGRESSIVE_UPSCALE",
      priority: 1,
      reason: "AGGRESSIVE_PROFILE_UNDERPERFORMING",
      suggested_env: {
        OPENCLAW_EXECUTOR_ALLOW_UPSCALE: 0,
        OPENCLAW_EXECUTOR_CONFIDENCE_HIGH_MIN: 0.86,
        OPENCLAW_EXECUTOR_POSTERIOR_HIGH_MIN: 0.72,
      },
    });
  }
  if (Number(shadowSummary.rows_n || 0) < 40) {
    recommendations.push({
      key: "INSUFFICIENT_POLICY_EVIDENCE",
      priority: 3,
      reason: "OPENCLAW_SHADOW_SAMPLE_LOW",
      suggested_env: null,
    });
  }
  return recommendations.sort((a, b) => a.priority - b.priority);
}

function buildPromotionGate({ decisionSummary = {}, fillSummary = {}, shadowSummary = {}, recommendations = [] } = {}) {
  const feeRatio = toNum(fillSummary.fee_to_abs_realized_ratio);
  const topCostSymbol = Array.isArray(fillSummary.by_symbol) && fillSummary.by_symbol[0] ? fillSummary.by_symbol[0] : null;
  const enoughDecisions = Number(decisionSummary.rows_n || 0) >= 40;
  const enoughShadow = Number(shadowSummary.rows_n || 0) >= 40;
  const aggressiveExitN = Number(fillSummary.aggressive_exit_n || 0);
  const aggressivePnl = Number(fillSummary.aggressive_realized_pnl_sum || 0);
  let status = "PASS";
  let reason = "OPENCLAW_POLICY_STABLE";
  if (!enoughDecisions || !enoughShadow) {
    status = "WARN";
    reason = "OPENCLAW_POLICY_SAMPLE_LOW";
  }
  if (Number.isFinite(feeRatio) && feeRatio >= 0.6) {
    status = "BLOCK";
    reason = "OPENCLAW_POLICY_COST_TOO_HIGH";
  }
  if (aggressiveExitN >= 8 && aggressivePnl <= 0) {
    status = "BLOCK";
    reason = "OPENCLAW_POLICY_AGGRESSIVE_UNDERPERFORMING";
  }
  return {
    status,
    reason,
    promotion_ready: status === "PASS",
    enough_decisions: enoughDecisions,
    enough_shadow: enoughShadow,
    fee_to_abs_realized_ratio: feeRatio,
    top_cost_symbol: topCostSymbol ? topCostSymbol.symbol : null,
    top_cost_symbol_fee_to_abs_realized_ratio: topCostSymbol ? toNum(topCostSymbol.fee_to_abs_realized_ratio) : null,
    top_cost_symbol_realized_pnl_sum: topCostSymbol ? toNum(topCostSymbol.realized_pnl_sum) : null,
    aggressive_exit_n: aggressiveExitN,
    aggressive_realized_pnl_sum: aggressivePnl,
    recommendation_count: Array.isArray(recommendations) ? recommendations.length : 0,
  };
}

function buildPeriodSummary({ period = null, decisions = [], fills = [], shadows = [] } = {}) {
  const decisionSummary = summarizeDecisionRows(decisions);
  const fillSummary = summarizeFillRows(fills);
  const shadowSummary = summarizeShadowRows(shadows);
  const recommendations = buildRecommendations({ decisionSummary, fillSummary, shadowSummary });
  const gate = buildPromotionGate({ decisionSummary, fillSummary, shadowSummary, recommendations });
  return {
    label: period && period.label ? period.label : null,
    from_ms: period && period.from_ms,
    to_ms: period && period.to_ms,
    decision_summary: decisionSummary,
    fill_summary: fillSummary,
    shadow_summary: shadowSummary,
    recommendations,
    gate,
  };
}

function renderPeriodSection(name, summary = {}) {
  const gate = summary.gate || {};
  const decision = summary.decision_summary || {};
  const fill = summary.fill_summary || {};
  return [
    `## ${name}`,
    `- gate: ${gate.status || "N/A"} / ${gate.reason || "N/A"} / promotion_ready=${gate.promotion_ready === true ? "YES" : "NO"}`,
    `- decisions: total ${decision.rows_n ?? "N/A"} / block ${decision.blocked_n ?? "N/A"} / reduce ${decision.reduced_n ?? "N/A"} / aggressive ${decision.aggressive_n ?? "N/A"}`,
    `- fills: exit ${fill.exit_fills_n ?? "N/A"} / realized ${fill.realized_pnl_sum != null ? Number(fill.realized_pnl_sum).toFixed(4) : "N/A"} / fee ${fill.fee_sum != null ? Number(fill.fee_sum).toFixed(4) : "N/A"} / fee_ratio ${fill.fee_to_abs_realized_ratio != null ? Number(fill.fee_to_abs_realized_ratio).toFixed(4) : "N/A"}`,
    `- top_cost_symbol: ${gate.top_cost_symbol || "N/A"} / fee_ratio ${gate.top_cost_symbol_fee_to_abs_realized_ratio != null ? Number(gate.top_cost_symbol_fee_to_abs_realized_ratio).toFixed(4) : "N/A"} / realized ${gate.top_cost_symbol_realized_pnl_sum != null ? Number(gate.top_cost_symbol_realized_pnl_sum).toFixed(4) : "N/A"}`,
    `- top_reason: ${Array.isArray(decision.by_reason) && decision.by_reason[0] ? `${decision.by_reason[0].key} ${decision.by_reason[0].count}` : "N/A"}`,
    `- recommendations: ${Array.isArray(summary.recommendations) && summary.recommendations.length ? summary.recommendations.map((row) => row.target_symbol ? `${row.key}(${row.target_symbol})` : row.key).join(", ") : "none"}`,
    "",
  ].join("\n");
}

function renderMarkdown(payload = {}) {
  const periods = payload.periods || {};
  const lines = [
    "# OpenClaw Policy Authority",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "N/A"}`,
    "",
  ];
  for (const key of ["DAILY", "WEEKLY", "DAYS_7", "DAYS_14", "DAYS_30", "DAYS_90", "MONTHLY", "YEARLY"]) {
    if (!periods[key]) continue;
    lines.push(renderPeriodSection(`${key} (${periods[key].label || key})`, periods[key]));
  }
  return `${lines.join("\n").trim()}\n`;
}

async function runOpenClawPolicyTuningReport({
  exchange = null,
  limitDecisions = process.env.OPENCLAW_POLICY_TUNING_LIMIT_DECISIONS || 2000,
  limitFills = process.env.OPENCLAW_POLICY_TUNING_LIMIT_FILLS || 2000,
  limitShadow = process.env.OPENCLAW_POLICY_TUNING_LIMIT_SHADOW || 1000,
  force = false,
} = {}) {
  const nowMeta = nowKstMeta();
  const exchangeUpper = upper(exchange || process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT") || "BINANCEFUT";
  const periods = buildPeriods(nowMeta.nowMs);
  const earliestFromMs = Math.min(...Object.values(periods).map((row) => Number(row.from_ms || nowMeta.nowMs)));
  const resolvedLimitDecisions = boundedPositiveInt(limitDecisions, 2000, {
    min: 100,
    max: boundedPositiveInt(process.env.OPENCLAW_POLICY_TUNING_MAX_DECISIONS, 5000, { min: 500, max: 20000 }),
  });
  const [decisionRows, fillRows, shadowRows] = await Promise.all([
    listRecentOpenClawPolicyDecisions({ exchange: exchangeUpper, fromMs: earliestFromMs, limit: resolvedLimitDecisions }),
    listRecentFills({ exchange: exchangeUpper, fromMs: earliestFromMs, limit: limitFills }),
    listRecentOpenClawShadowEvaluations({ exchange: exchangeUpper, fromMs: earliestFromMs, limit: limitShadow }),
  ]);

  const periodPayload = {};
  for (const [key, period] of Object.entries(periods)) {
    periodPayload[key] = buildPeriodSummary({
      period,
      decisions: filterRowsByPeriod(decisionRows, period, "created_at"),
      fills: filterRowsByPeriod(fillRows, period, "created_at"),
      shadows: filterRowsByPeriod(shadowRows, period, "created_at"),
    });
  }

  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    exchange: exchangeUpper,
    periods: periodPayload,
    source_counts: {
      decisions_n: decisionRows.length,
      fills_n: fillRows.length,
      shadow_n: shadowRows.length,
    },
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_openclaw_policy_authority`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "openclaw_policy_authority_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "openclaw_policy_authority_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  return {
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    periods: payload.periods,
    exchange: exchangeUpper,
  };
}

module.exports = {
  runOpenClawPolicyTuningReport,
  __test: {
    boundedPositiveInt,
    buildPeriods,
    summarizeDecisionRows,
    summarizeFillRows,
    summarizeShadowRows,
    buildRecommendations,
    buildPromotionGate,
    buildPeriodSummary,
    renderMarkdown,
  },
};
