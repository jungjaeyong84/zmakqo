"use strict";

const fs = require("fs");
const path = require("path");
const { getFirestore } = require("../src/storage/firestore");

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d = new Date()) {
  return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isBackfilledTrailRunnerFloorViolation(row) {
  return !!(row && row.extra && row.extra.trail_runner_floor_backfilled_at);
}

function violationDirection(row) {
  const side = String(row.position_side || "").toUpperCase();
  const exec = toNum(row.exec_price);
  const floor = toNum(row.runner_floor_px);
  if (!Number.isFinite(exec) || !Number.isFinite(floor)) return null;
  if (side === "SHORT") return exec > floor ? "ABOVE_FLOOR_SHORT" : null;
  return exec < floor ? "BELOW_FLOOR_LONG" : null;
}

function buildMd(report) {
  const lines = [];
  lines.push(`# Trail Runner Floor Audit`);
  lines.push(``);
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- lookback_days: ${report.lookback_days}`);
  lines.push(`- scanned_rows: ${report.scanned_rows}`);
  lines.push(`- candidate_rows: ${report.candidate_rows}`);
  lines.push(`- violation_total_n: ${report.violation_total_n}`);
  lines.push(`- violation_n: ${report.violation_n}`);
  lines.push(`- live_bar_runner_violation_total_n: ${report.live_bar_runner_violation_total_n}`);
  lines.push(`- live_bar_runner_violation_n: ${report.live_bar_runner_violation_n}`);
  lines.push(``);
  if (!report.top_violations.length) {
    lines.push(`최근 조회 범위에서 unresolved runner floor 위반은 없습니다.`);
    return `${lines.join("\n")}\n`;
  }
  lines.push(`## Top Unresolved Violations`);
  lines.push(``);
  for (const row of report.top_violations) {
    lines.push(`- ${row.created_at} ${row.symbol} ${row.position_side} exec=${row.exec_price} floor=${row.runner_floor_px} diff_pct=${row.floor_gap_pct} run=${row.run_id} source=${row.source}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildCliResult(report, latestJson, datedMd) {
  return {
    ok: true,
    status: report.violation_n > 0 ? "WARN" : "OK",
    reason: report.violation_n > 0 ? "RUNNER_FLOOR_VIOLATIONS_PRESENT" : null,
    candidate_rows: report.candidate_rows,
    violation_n: report.violation_n,
    violation_total_n: report.violation_total_n,
    live_bar_runner_violation_n: report.live_bar_runner_violation_n,
    live_bar_runner_violation_total_n: report.live_bar_runner_violation_total_n,
    jsonPath: latestJson,
    mdPath: datedMd,
  };
}

async function main() {
  const lookbackDays = Math.max(1, Number(process.env.TRAIL_RUNNER_FLOOR_AUDIT_LOOKBACK_DAYS || 7));
  const limit = Math.max(100, Number(process.env.TRAIL_RUNNER_FLOOR_AUDIT_LIMIT || 5000));
  const sinceMs = Date.now() - (lookbackDays * 24 * 60 * 60 * 1000);
  const sinceIso = new Date(sinceMs).toISOString();
  const db = getFirestore();

  const snap = await db.collection("fills_paper").orderBy("created_at", "desc").limit(limit).get();
  const scanned = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    if (String(d.exchange || "").toUpperCase() !== "BINANCEFUT") return;
    const createdAt = String(d.created_at || "");
    if (!createdAt || createdAt < sinceIso) return;
    if (String(d.event || "").toUpperCase() !== "EXIT_TRAIL") return;
    const fx = d.features_json && typeof d.features_json === "object" ? d.features_json : {};
    const extra = d.extra && typeof d.extra === "object" ? d.extra : {};
    if (String(fx.runner_stop_source || "").toUpperCase() !== "RUNNER_FLOOR") return;
    scanned.push({
      fill_id: doc.id,
      created_at: createdAt,
      symbol: String(d.symbol || ""),
      source: String(d.source || ""),
      run_id: String(d.run_id || ""),
      execution_mode: String(d.execution_mode || ""),
      decision_reason: String(d.decision_reason || ""),
      position_side: String(fx.position_side || ""),
      exec_price: toNum(d.exec_price),
      signal_price: toNum(d.signal_price),
      runner_floor_px: toNum(fx.runner_floor_px),
      runner_stop_px: toNum(fx.runner_stop_px),
      extra,
    });
  });

  const violationsAll = scanned.map((row) => {
    const exec = toNum(row.exec_price);
    const floor = toNum(row.runner_floor_px);
    const gapPct = Number.isFinite(exec) && Number.isFinite(floor) && floor !== 0
      ? ((exec - floor) / floor)
      : null;
    return {
      ...row,
      violation: violationDirection(row),
      floor_gap_pct: Number.isFinite(gapPct) ? Number((gapPct * 100).toFixed(4)) : null,
      live_bar_runner: row.run_id.startsWith("RUN__BINANCEFUT__15m__"),
      backfilled: isBackfilledTrailRunnerFloorViolation(row),
    };
  }).filter((row) => !!row.violation);

  violationsAll.sort((a, b) => Math.abs(Number(b.floor_gap_pct || 0)) - Math.abs(Number(a.floor_gap_pct || 0)));
  const violations = violationsAll.filter((row) => !row.backfilled);

  const report = {
    generated_at: new Date().toISOString(),
    lookback_days: lookbackDays,
    scanned_rows: snap.size,
    candidate_rows: scanned.length,
    violation_total_n: violationsAll.length,
    violation_n: violations.length,
    live_bar_runner_violation_total_n: violationsAll.filter((row) => row.live_bar_runner).length,
    live_bar_runner_violation_n: violations.filter((row) => row.live_bar_runner).length,
    top_violations: violations.slice(0, 50),
  };

  const outDir = path.join(process.cwd(), "ops", "daily");
  ensureDir(outDir);
  const latestJson = path.join(outDir, "trail_runner_floor_audit_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_trail_runner_floor_audit.md`);
  fs.writeFileSync(latestJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(datedMd, buildMd(report));

  console.log(JSON.stringify(buildCliResult(report, latestJson, datedMd)));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("TRAIL_RUNNER_FLOOR_AUDIT_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      buildCliResult,
    },
  };
}
