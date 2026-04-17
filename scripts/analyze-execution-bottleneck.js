#!/usr/bin/env node
"use strict";

// Phase 3d — execution bottleneck waterfall.
//
// Reads the latest execution-related artifacts and prints a single-pass
// breakdown of where time (and value) accumulates between signal arrival
// and fill confirmation. Purely offline — it only reads files from
// `ops/daily/`.
//
// Output (stdout JSON and, with --write, ops/daily/exit_exec_bottleneck_waterfall_latest.json):
//   {
//     generated_at: ...,
//     stage_latency_p95_ms: {
//       signal_to_intent: ...,
//       webhook_saved_to_intent: ...,
//       intent_to_fill_measured: ...,
//       intent_to_fill_fallback: ...,
//       created_to_fill_guarded: ...,   // exit_quality report's filtered p95
//     },
//     top_bottleneck_stage: "INTENT_TO_FILL",
//     per_market_rows: [
//       { market, avg_created_to_fill_ms, partial_fill_rate_pct, adverse_slippage_bps, verdict }
//     ],
//     recommendations: [...],
//   }

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val == null || String(val).startsWith("--")) { out[key] = true; continue; }
    out[key] = val;
    i += 1;
  }
  return out;
}

function readLatest(name) {
  const p = path.join(OPS_DAILY, name);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {
    return null;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function topByField(rows, field, desc = true, take = 5) {
  return [...(rows || [])]
    .filter((r) => Number.isFinite(Number(r[field])))
    .sort((a, b) => (desc ? Number(b[field]) - Number(a[field]) : Number(a[field]) - Number(b[field])))
    .slice(0, take);
}

function classifyBottleneck(stages) {
  // Return the dominant stage by milliseconds; ignore obviously absurd
  // outliers (> 7 days) since those are usually MANUAL_REPLAY pollution.
  const entries = Object.entries(stages)
    .map(([k, v]) => [k, num(v)])
    .filter(([, v]) => Number.isFinite(v))
    .filter(([, v]) => v < 7 * 24 * 60 * 60 * 1000); // drop > 1 week as manual-replay noise
  if (!entries.length) return { stage: null, ms: null, noise_dropped: true };
  entries.sort((a, b) => b[1] - a[1]);
  return { stage: entries[0][0], ms: entries[0][1], noise_dropped: false };
}

function buildRecommendations({ stages, perMarket, bottleneck, quality }) {
  const recs = [];
  if (bottleneck.stage === "intent_to_fill_measured" || bottleneck.stage === "intent_to_fill_fallback") {
    recs.push({
      severity: "HIGH",
      action: "Review LIMIT→MARKET fallback TTL. Consider IOC/FOK on entry so non-filling orders bail fast instead of waiting.",
      evidence: `${bottleneck.stage} p95=${Math.round(bottleneck.ms)}ms`,
    });
  }
  if (bottleneck.stage === "webhook_saved_to_intent") {
    recs.push({
      severity: "HIGH",
      action: "Intent creation is slow. Check openclaw executor latency (evaluateOpenClawExecutionAuthority) and any Firestore writes on the hot path.",
      evidence: `webhook_saved_to_intent p95=${Math.round(bottleneck.ms)}ms`,
    });
  }
  if (bottleneck.stage === "signal_to_intent" && bottleneck.ms > 60_000) {
    recs.push({
      severity: "MEDIUM",
      action: "signal_to_intent p95 > 1min — inspect server-side signal handler + webhook replay queue. MANUAL_REPLAY pollution often inflates this.",
      evidence: `signal_to_intent p95=${Math.round(bottleneck.ms)}ms`,
    });
  }
  if (quality && Number.isFinite(Number(quality.partial_fill_rate_pct)) && Number(quality.partial_fill_rate_pct) >= 50) {
    recs.push({
      severity: "HIGH",
      action: "Partial fill rate >= 50%. Split entry size into sub-orders or switch to IOC MARKET to avoid stale LIMIT hanging.",
      evidence: `partial_fill_rate_pct=${Number(quality.partial_fill_rate_pct).toFixed(1)}`,
    });
  }
  if (quality && Number.isFinite(Number(quality.adverse_slippage_p95_bps)) && Number(quality.adverse_slippage_p95_bps) >= 50) {
    recs.push({
      severity: "MEDIUM",
      action: `adverse_slippage_p95_bps >= 50. At TP1=3.25% (~325bps), ${(Number(quality.adverse_slippage_p95_bps) / 325 * 100).toFixed(1)}% of edge is eaten by entry slippage alone.`,
      evidence: `adverse_slippage_p95_bps=${Number(quality.adverse_slippage_p95_bps).toFixed(1)}`,
    });
  }
  const highPartial = (perMarket || []).filter((r) => Number(r.partial_fill_rate_pct) >= 70);
  if (highPartial.length) {
    recs.push({
      severity: "HIGH",
      action: `Per-market partial-fill emergency: ${highPartial.map((r) => `${r.market} ${Number(r.partial_fill_rate_pct).toFixed(0)}%`).join(", ")}. Urgent order-type review for these markets.`,
      evidence: "top_partial_market in execution_quality report",
    });
  }
  if (!recs.length) {
    recs.push({ severity: "INFO", action: "No stage flagged above thresholds. Verify thresholds are tight enough; raw latency p95 is above guard p95." });
  }
  return recs;
}

function buildWaterfall() {
  const stageLatency = readLatest("best_self_evolution_execution_stage_latency_latest.json") || {};
  const quality = readLatest("best_self_evolution_execution_quality_latest.json") || {};
  const bottleneckDelta = readLatest("best_self_evolution_execution_bottleneck_delta_latest.json") || {};

  const stageSummary = stageLatency.summary || stageLatency;
  const qualitySummary = quality.summary || quality;

  const stages = {
    signal_to_intent: num(stageSummary.signal_to_intent_p95_ms),
    webhook_saved_to_intent: num(stageSummary.webhook_saved_to_intent_p95_ms),
    intent_to_fill_measured: num(stageSummary.intent_to_fill_measured_p95_ms),
    intent_to_fill_fallback: num(stageSummary.intent_to_fill_fallback_p95_ms),
    webhook_to_outcome: num(stageSummary.webhook_to_outcome_p95_ms),
    created_to_fill_guarded: num(qualitySummary.guard_created_to_fill_p95_ms ?? qualitySummary.created_to_fill_p95_ms),
    created_to_fill_raw: num(qualitySummary.created_to_fill_p95_ms_raw),
  };

  const bottleneck = classifyBottleneck(stages);

  const topLatencyRows = Array.isArray(qualitySummary.top_latency_rows)
    ? qualitySummary.top_latency_rows
    : [];

  const perMarket = topLatencyRows.map((row) => ({
    market: row.market,
    intent_n: num(row.intent_n),
    fill_n: num(row.fill_n),
    avg_created_to_fill_ms: num(row.avg_created_to_fill_ms),
    avg_slippage_bps: num(row.avg_slippage_bps),
    partial_fill_rate_pct: num(row.partial_fill_rate_pct),
    partial_fill_intent_n: num(row.partial_fill_intent_n),
    verdict: Number(row.partial_fill_rate_pct) >= 70
      ? "URGENT_PARTIAL_FILL"
      : Number(row.avg_created_to_fill_ms) >= 120_000
        ? "SLOW_FILL"
        : "OK",
  }));

  const recommendations = buildRecommendations({ stages, perMarket, bottleneck, quality: qualitySummary });

  const output = {
    ok: true,
    generated_at: new Date().toISOString(),
    artifact_sources: {
      stage_latency: stageLatency.generated_at_kst || stageLatency.generated_at || null,
      execution_quality: quality.generated_at_kst || quality.generated_at || null,
      bottleneck_delta: bottleneckDelta.generated_at_kst || bottleneckDelta.generated_at || null,
    },
    stage_latency_p95_ms: stages,
    top_bottleneck_stage: bottleneck.stage,
    top_bottleneck_ms: bottleneck.ms,
    bottleneck_noise_dropped: bottleneck.noise_dropped,
    execution_quality_summary: {
      status: qualitySummary.status || null,
      partial_fill_rate_pct: num(qualitySummary.partial_fill_rate_pct),
      adverse_slippage_p95_bps: num(qualitySummary.adverse_slippage_p95_bps),
      guard_created_to_fill_p95_ms: num(qualitySummary.guard_created_to_fill_p95_ms),
      top_partial_market: qualitySummary.top_partial_market || null,
      top_latency_market: qualitySummary.top_latency_market || null,
      top_slippage_market: qualitySummary.top_slippage_market || null,
    },
    per_market_rows: perMarket,
    top_partial_markets: topByField(perMarket, "partial_fill_rate_pct", true, 3),
    top_latency_markets: topByField(perMarket, "avg_created_to_fill_ms", true, 3),
    recommendations,
  };
  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildWaterfall();
  if (args.write) {
    fs.mkdirSync(OPS_DAILY, { recursive: true });
    fs.writeFileSync(path.join(OPS_DAILY, "exit_exec_bottleneck_waterfall_latest.json"), JSON.stringify(payload, null, 2));
  }
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("ANALYZE_EXECUTION_BOTTLENECK_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    buildWaterfall,
    __test: { classifyBottleneck, buildRecommendations, topByField },
  };
}
