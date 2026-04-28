"use strict";

// OpenClaw ML+AI agent monitoring dashboard (Phase B..E).
//
// This route exposes a JSON snapshot of the three agent-cycle artifacts and
// the in-memory evidence ledger tail so an operator can confirm, with a
// single HTTP hit, that:
//
//   1. The outcome-linker cron is fresh (ops/daily/openclaw_evidence_linker_latest.json).
//   2. The calibration cron produced per-source trust_weights (openclaw_calibration_latest.json).
//   3. The retrospect loop emitted safety-rail-only proposals (openclaw_retrospect_latest.json).
//   4. The live runtime is still writing evidence-ledger decision rows.
//
// No business logic lives here — this route is strictly read-only and must
// never mutate agent state. When an artifact is missing we mark it as
// `status: "missing"` instead of erroring so the dashboard degrades
// gracefully on a fresh environment.

const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const { getRecentEvidence, KINDS, MAX_BUFFER } = require("../services/openclawEvidenceLedger");
const { OPENCLAW_CRON_JOBS, OPENCLAW_CLOUD_SCHEDULER_JOBS } = require("../../scripts/lib/openclaw-cron-manifest");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// The test suite sets OPENCLAW_DASHBOARD_OPS_DAILY_DIR to a temp directory so
// the test fixtures don't clobber the live ops/daily artifacts. In prod this
// env var is unset and we fall back to the real repo path.
const OPS_DAILY = (process.env.OPENCLAW_DASHBOARD_OPS_DAILY_DIR && String(process.env.OPENCLAW_DASHBOARD_OPS_DAILY_DIR).trim())
  ? String(process.env.OPENCLAW_DASHBOARD_OPS_DAILY_DIR).trim()
  : path.join(REPO_ROOT, "ops", "daily");

// Map agent-cycle artifacts to their manifest job_id so SLA and filename
// stay single-sourced from scripts/lib/openclaw-cron-manifest.js. Before
// this indirection the dashboard carried its own SLA numbers (2/6/6h) which
// drifted away from the manifest (1/5/5h) — dashboard reported GREEN while
// the cron SLA monitor considered the same artifact stale.
const ARTIFACT_JOB_IDS = Object.freeze({
  evidence_linker: "openclaw_agent_evidence_linker",
  calibration: "openclaw_agent_calibration",
  retrospect: "openclaw_agent_retrospect",
});

function resolveArtifactsFromManifest() {
  const out = {};
  const slaOut = {};
  // 2026-04-28 senior audit Step 18 — the 3 OpenClaw agent-cycle crons
  // (evidence_linker / calibration / retrospect) were migrated from
  // local launchd (OPENCLAW_CRON_JOBS) to Cloud Scheduler
  // (OPENCLAW_CLOUD_SCHEDULER_JOBS) in 2026-04-18. This dashboard route
  // kept reading only OPENCLAW_CRON_JOBS, so body.artifacts ended up
  // empty and the dashboard reported all 3 artifacts as missing.
  // Search both arrays so the manifest single-source contract still
  // holds across the launchd → Cloud Scheduler migration.
  for (const [key, jobId] of Object.entries(ARTIFACT_JOB_IDS)) {
    const job = OPENCLAW_CRON_JOBS.find((j) => j.job_id === jobId)
      || OPENCLAW_CLOUD_SCHEDULER_JOBS.find((j) => j.job_id === jobId);
    if (!job || !job.produces_artifact) continue;
    out[key] = job.produces_artifact;
    slaOut[key] = Number(job.artifact_sla_hours) || null;
  }
  return { filenames: Object.freeze(out), slaHours: Object.freeze(slaOut) };
}

const { filenames: ARTIFACTS, slaHours: ARTIFACT_SLA_HOURS } = resolveArtifactsFromManifest();

function safeReadJson(absPath) {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    if (!raw) return { ok: false, error: "EMPTY" };
    return { ok: true, payload: JSON.parse(raw) };
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, error: "MISSING" };
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function staleness(filePath, slaHours) {
  try {
    const st = fs.statSync(filePath);
    const ageMs = Date.now() - Number(st.mtimeMs || 0);
    const ageHours = ageMs / (60 * 60 * 1000);
    return {
      mtime_iso: new Date(st.mtimeMs).toISOString(),
      age_hours: Math.round(ageHours * 100) / 100,
      sla_hours: slaHours,
      healthy: ageHours <= slaHours,
    };
  } catch (_) {
    return { mtime_iso: null, age_hours: null, sla_hours: slaHours, healthy: false };
  }
}

function summarizeEvidence({ limit = 25 } = {}) {
  const snapshot = getRecentEvidence({ limit: MAX_BUFFER });
  const byKind = {};
  for (const kind of Object.values(KINDS)) byKind[kind] = 0;
  let lastRecordedAt = null;
  for (const record of snapshot) {
    const k = String(record && record.kind || "").toUpperCase();
    if (byKind[k] != null) byKind[k] += 1;
    const ts = record && record.recorded_at;
    if (typeof ts === "string" && (!lastRecordedAt || ts > lastRecordedAt)) {
      lastRecordedAt = ts;
    }
  }
  // Only expose the minimum fields the dashboard needs — we must not leak
  // the full `inputs` blob because that contains unsanitized LLM content.
  const tail = snapshot.slice(0, Math.max(1, Math.min(MAX_BUFFER, Number(limit) || 25))).map((r) => ({
    decision_id: r.decision_id || null,
    recorded_at: r.recorded_at || null,
    kind: r.kind || null,
    decision: r.decision || null,
    confidence: r.confidence != null ? r.confidence : null,
    symbol: r.symbol || null,
    market: r.market || null,
    tf_exec: r.tf_exec || null,
    rule_verdict: r.rule_verdict || null,
    narrative_verdict: r.narrative_verdict || null,
  }));
  return {
    buffer_size: snapshot.length,
    buffer_capacity: MAX_BUFFER,
    by_kind: byKind,
    last_recorded_at: lastRecordedAt,
    tail,
  };
}

function healthFromArtifacts(artifacts) {
  const unhealthy = Object.entries(artifacts)
    .filter(([, v]) => v && v.stat && v.stat.healthy === false)
    .map(([k]) => k);
  if (unhealthy.length === 0) return { color: "GREEN", unhealthy: [] };
  if (unhealthy.length === 1) return { color: "AMBER", unhealthy };
  return { color: "RED", unhealthy };
}

function buildDashboardPayload({ tailLimit } = {}) {
  const artifacts = {};
  for (const [key, filename] of Object.entries(ARTIFACTS)) {
    const filePath = path.join(OPS_DAILY, filename);
    const stat = staleness(filePath, ARTIFACT_SLA_HOURS[key]);
    const { ok, payload, error } = safeReadJson(filePath);
    artifacts[key] = {
      filename,
      path: filePath,
      status: ok ? "ok" : (error === "MISSING" ? "missing" : "error"),
      stat,
      error: ok ? null : error,
      // Intentionally trim large payload fields so the dashboard hit stays
      // lightweight; the operator can cat the artifact directly for detail.
      summary: ok ? {
        generated_at: payload && (payload.generated_at || payload.ran_at || payload.iso) || null,
        counts: payload && payload.counts ? payload.counts : null,
        trust_weights: payload && payload.trust_weights ? payload.trust_weights : null,
        proposals_count: payload && Array.isArray(payload.proposals) ? payload.proposals.length : null,
        dry_run: payload && payload.dry_run != null ? Boolean(payload.dry_run) : null,
        skipped: payload && payload.skipped === true ? true : false,
      } : null,
    };
  }

  const evidence = summarizeEvidence({ limit: Number.isFinite(tailLimit) ? tailLimit : 25 });
  const health = healthFromArtifacts(artifacts);

  return {
    ok: true,
    generated_at: new Date().toISOString(),
    health,
    artifacts,
    evidence,
    phase: {
      // The operator flips the phase via apply_openclaw_phase.sh — the
      // dashboard just reflects whatever env the live runtime is using.
      narrative_enabled: String(process.env.OPENCLAW_NARRATIVE_ENABLED || "").trim() === "1",
      narrative_provider_mode: process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE || "CODEX_CLI_ONLY",
      conductor_enabled: String(process.env.OPENCLAW_CONDUCTOR_ENABLED || "").trim() === "1",
      conductor_shadow_only: String(process.env.OPENCLAW_CONDUCTOR_SHADOW_ONLY || "1").trim() !== "0",
      retrospect_apply_enabled: String(process.env.OPENCLAW_RETROSPECT_APPLY_ENABLED || "").trim() === "1",
      autonomy_auto_degrade: String(process.env.OPENCLAW_AUTONOMY_AUTO_DEGRADE || "").trim() === "1",
      ml_min_tp1_prob: Number(process.env.OPENCLAW_ML_MIN_TP1_PROB || 0.45) || 0.45,
    },
  };
}

// Monitoring UI is rendered via src/views/openclaw.ejs so it inherits the
// same sidebar/topbar + CSS tokens as the rest of the DONBEOLJA dashboards
// (home / profit / trading / settings / ...). This route just passes the
// JSON payload into res.render and lets the EJS template do the layout.

router.get("/dashboard/openclaw", (req, res) => {
  const tailLimit = Number(req.query.tail_limit);
  const payload = buildDashboardPayload({ tailLimit });
  return res.json(payload);
});

router.get("/dashboard/openclaw/view", (req, res) => {
  const tailLimit = Number(req.query.tail_limit);
  const payload = buildDashboardPayload({ tailLimit });
  // Cache: 0 so every reload shows the freshest artifact state.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  // src/views/openclaw.ejs includes app_start_unified / app_end_unified so
  // the page inherits the canonical sidebar + topbar + CSS tokens from the
  // rest of the DONBEOLJA dashboards.
  return res.render("openclaw", { payload });
});

module.exports = router;
