"use strict";

const fs = require("fs");
const path = require("path");

const { getFirestore } = require("../src/storage/firestore");
const { backfillLatestPositionReadModel } = require("../src/services/positionReadModelBackfill");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function nowMeta() {
  const date = new Date();
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    iso: date.toISOString(),
    kst: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} KST`,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}${parts.minute}`,
  };
}

async function countQuery(query) {
  const snap = await query.get();
  return snap.size;
}

async function countQuerySafe(label, queryFactory) {
  try {
    const size = await countQuery(queryFactory());
    return { ok: true, size, code: null, error: null };
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    const code = /requires an index/i.test(msg) ? "INDEX_MISSING" : "QUERY_FAILED";
    return { ok: false, size: null, code, error: msg, label };
  }
}

async function buildPositionReadModelCutoverReport({
  exchange = "BINANCEFUT",
  ensureBackfill = false,
  maxSample = 20,
} = {}) {
  const ex = upper(exchange) || "BINANCEFUT";
  const db = getFirestore();
  const generated = nowMeta();
  const backfill = ensureBackfill
    ? await backfillLatestPositionReadModel({ exchange: ex, dryRun: false })
    : null;

  const [positionCount, latestCountIndexed, latestCountRaw, eventCountIndexed, eventCountRaw, timelineCount] = await Promise.all([
    countQuerySafe("positions_paper", () => db.collection("positions_paper").where("exchange", "==", ex)),
    countQuerySafe("position_read_model_latest", () => db.collection("position_read_model_latest").where("exchange", "==", ex).orderBy("ts_ms", "desc")),
    countQuerySafe("position_read_model_latest_raw", () => db.collection("position_read_model_latest").where("exchange", "==", ex)),
    countQuerySafe("position_events", () => db.collection("position_events").where("exchange", "==", ex).orderBy("sequence_ms", "desc")),
    countQuerySafe("position_events_raw", () => db.collection("position_events").where("exchange", "==", ex)),
    countQuerySafe("unified_event_timeline", () => db.collection("unified_event_timeline").where("exchange", "==", ex).where("event_kind", "==", "POSITION_MUTATION")),
  ]);

  let samples = [];
  let latestSamplesError = null;
  try {
    const latestSnap = await db.collection("position_read_model_latest")
      .where("exchange", "==", ex)
      .orderBy("ts_ms", "desc")
      .limit(Math.max(1, Number(maxSample) || 20))
      .get();
    samples = latestSnap.docs.map((doc) => {
      const row = doc.data() || {};
      return {
        symbol: row.symbol || null,
        ts_ms: row.ts_ms || null,
        mutation_kind: row.mutation_kind || null,
        position_event_id: row.position_event_id || null,
        state: row.after_summary && row.after_summary.state || null,
      };
    });
  } catch (err) {
    latestSamplesError = err && err.message ? String(err.message) : String(err);
  }

  const latestCountValue = Number.isFinite(latestCountIndexed.size) ? latestCountIndexed.size : latestCountRaw.size;
  const eventCountValue = Number.isFinite(eventCountIndexed.size) ? eventCountIndexed.size : eventCountRaw.size;
  const coveragePct = positionCount.size > 0 && Number.isFinite(latestCountValue) ? (latestCountValue / positionCount.size) : null;
  const timelineCoveragePct = eventCountValue > 0 && Number.isFinite(timelineCount.size) ? (timelineCount.size / eventCountValue) : null;
  const blockers = [
    positionCount,
    latestCountIndexed,
    eventCountIndexed,
    timelineCount,
  ].filter((row) => row.ok !== true).map((row) => `${row.label}:${row.code}`);
  if (latestSamplesError) blockers.push("position_read_model_latest_samples:INDEX_MISSING");
  const summary = {
    generated_at_iso: generated.iso,
    generated_at_kst: generated.kst,
    exchange: ex,
    ensure_backfill: ensureBackfill === true,
    backfill_result: backfill,
    positions_paper_count: positionCount.size,
    position_read_model_latest_count: latestCountValue,
    position_events_count: eventCountValue,
    unified_position_timeline_count: timelineCount.size,
    latest_coverage_pct: coveragePct,
    timeline_coverage_pct: timelineCoveragePct,
    query_blockers: blockers,
    latest_ready: blockers.length === 0 && latestCountValue > 0 && latestCountValue >= Math.min(positionCount.size || 0, latestCountValue),
    dominant_status: blockers.length
      ? blockers[0]
      : latestCountValue === 0
      ? "LATEST_EMPTY"
      : (coveragePct != null && coveragePct < 0.9 ? "LATEST_COVERAGE_SHORT" : "LATEST_READY"),
  };

  return {
    summary,
    samples,
  };
}

function buildMarkdown(report = null) {
  const summary = report && report.summary ? report.summary : {};
  const samples = Array.isArray(report && report.samples) ? report.samples : [];
  const pct = (value) => Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : "N/A";
  return [
    "# Position Read Model Cutover",
    "",
    `- generated_at: ${summary.generated_at_kst || "N/A"}`,
    `- exchange: ${summary.exchange || "N/A"}`,
    `- dominant_status: ${summary.dominant_status || "N/A"}`,
    `- positions_paper_count: ${summary.positions_paper_count ?? "N/A"}`,
    `- position_read_model_latest_count: ${summary.position_read_model_latest_count ?? "N/A"}`,
    `- position_events_count: ${summary.position_events_count ?? "N/A"}`,
    `- unified_position_timeline_count: ${summary.unified_position_timeline_count ?? "N/A"}`,
    `- latest_coverage_pct: ${pct(summary.latest_coverage_pct)}`,
    `- timeline_coverage_pct: ${pct(summary.timeline_coverage_pct)}`,
    `- query_blockers: ${Array.isArray(summary.query_blockers) && summary.query_blockers.length ? summary.query_blockers.join(", ") : "none"}`,
    "",
    "## Samples",
    ...(
      samples.length
        ? samples.map((row) => `- ${row.symbol || "N/A"} / ${row.state || "N/A"} / ${row.mutation_kind || "N/A"} / ${row.position_event_id || "N/A"}`)
        : ["- none"]
    ),
    "",
  ].join("\n");
}

async function main() {
  const ensureBackfill = process.argv.includes("--ensure-backfill");
  const exchangeArg = process.argv.find((arg) => arg.startsWith("--exchange="));
  const exchange = exchangeArg ? exchangeArg.split("=")[1] : "BINANCEFUT";
  const report = await buildPositionReadModelCutoverReport({
    exchange,
    ensureBackfill,
  });
  const meta = nowMeta();
  const base = `${meta.dateKey}_${meta.hhmm}`;
  const datedJson = path.join(OPS_DAILY_DIR, `${base}_position_read_model_cutover.json`);
  const datedMd = path.join(OPS_DAILY_DIR, `${base}_position_read_model_cutover.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "position_read_model_cutover_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "position_read_model_cutover_latest.md");
  fs.mkdirSync(OPS_DAILY_DIR, { recursive: true });
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const md = buildMarkdown(report);
  fs.writeFileSync(datedMd, md, "utf8");
  fs.writeFileSync(latestMd, md, "utf8");
  console.log(JSON.stringify({
    ok: true,
    exchange: upper(exchange),
    latest_json: latestJson,
    latest_md: latestMd,
    dominant_status: report.summary.dominant_status,
    positions_paper_count: report.summary.positions_paper_count,
    position_read_model_latest_count: report.summary.position_read_model_latest_count,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("report-position-read-model-cutover failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  buildPositionReadModelCutoverReport,
  __test: {
    buildMarkdown,
  },
};
