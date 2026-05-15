#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3PaperBootstrapReport } = require("../src/v3/paperBootstrap");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const OPS_RUNTIME = path.join(REPO_ROOT, "ops", "runtime");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_paper_bootstrap_latest.json");
const STATIC_SEED_PATH = path.join(OPS_RUNTIME, "v3_bootstrap_seed.jsonl");
const LIVE_SEED_PATH = path.join(OPS_RUNTIME, "v3_bootstrap_live_seed.jsonl");

function toPositiveInt(value, fallback) {
  const num = Math.trunc(Number(value));
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function toFiniteNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function round(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const scale = 10 ** digits;
  return Math.round(num * scale) / scale;
}

function readJsonlRows(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_) {
    return [];
  }
}

function buildSeedMixSummary(staticRows = [], liveRows = []) {
  const staticSeedSourceN = Array.isArray(staticRows) ? staticRows.length : 0;
  const liveSeedSourceN = Array.isArray(liveRows) ? liveRows.length : 0;
  const activationMinN = toPositiveInt(process.env.V3_PAPER_BOOTSTRAP_LIVE_SEED_ACTIVATION_N, 5);
  const matureTargetN = Math.max(
    activationMinN,
    toPositiveInt(process.env.V3_PAPER_BOOTSTRAP_LIVE_SEED_MATURE_TARGET_N, 10)
  );
  const staticReferenceCapN = Math.max(
    1,
    toPositiveInt(process.env.V3_PAPER_BOOTSTRAP_STATIC_REFERENCE_CAP_N, 50)
  );
  const minLiveSeedSharePct = toFiniteNumber(process.env.V3_PAPER_BOOTSTRAP_MIN_LIVE_SEED_SHARE_PCT, 10);
  const effectiveStaticReferenceN = Math.min(staticSeedSourceN, staticReferenceCapN);
  const denominator = liveSeedSourceN + effectiveStaticReferenceN;
  const effectiveLiveSeedSharePct = denominator > 0
    ? round((liveSeedSourceN / denominator) * 100, 2)
    : 0;
  const active = liveSeedSourceN >= activationMinN;
  const mature = liveSeedSourceN >= matureTargetN;
  const ok = !active || effectiveLiveSeedSharePct >= minLiveSeedSharePct;
  return {
    active,
    ok,
    mature,
    live_seed_source_n: liveSeedSourceN,
    static_seed_source_n: staticSeedSourceN,
    effective_static_reference_n: effectiveStaticReferenceN,
    effective_live_seed_share_pct: effectiveLiveSeedSharePct,
    min_live_seed_share_pct: round(minLiveSeedSharePct, 2),
    activation_min_n: activationMinN,
    mature_target_n: matureTargetN,
    static_reference_cap_n: staticReferenceCapN,
    remaining_to_activation_n: Math.max(0, activationMinN - liveSeedSourceN),
    remaining_to_mature_n: Math.max(0, matureTargetN - liveSeedSourceN),
  };
}

async function main() {
  const staticRows = readJsonlRows(STATIC_SEED_PATH);
  const liveRows = readJsonlRows(LIVE_SEED_PATH);
  const rows = [...staticRows, ...liveRows];
  if (!rows.length) {
    throw new Error(`V3_BOOTSTRAP_SEED_MISSING:${STATIC_SEED_PATH}`);
  }
  const summary = buildV3PaperBootstrapReport(rows);
  const seedMix = buildSeedMixSummary(staticRows, liveRows);
  const payload = {
    generated_at: new Date().toISOString(),
    source: liveRows.length ? "V3_BOOTSTRAP_SEED_MERGED" : "V3_BOOTSTRAP_SEED",
    static_seed_path: STATIC_SEED_PATH,
    live_seed_path: LIVE_SEED_PATH,
    static_seed_source_n: staticRows.length,
    live_seed_source_n: liveRows.length,
    combined_seed_source_n: rows.length,
    seed_mix: seedMix,
    ...summary,
  };
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    source_sample_n: payload.source_sample_n,
    retained_sample_n: payload.retained_sample_n,
    retained_win_rate_pct: payload.retained_metrics && payload.retained_metrics.win_rate_pct,
    recommendation: payload.recommendation,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("REPORT_V3_PAPER_BOOTSTRAP_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
