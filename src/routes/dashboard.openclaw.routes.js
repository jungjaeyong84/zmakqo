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

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");

const ARTIFACTS = Object.freeze({
  evidence_linker: "openclaw_evidence_linker_latest.json",
  calibration: "openclaw_calibration_latest.json",
  retrospect: "openclaw_retrospect_latest.json",
});

// How stale an artifact may be before the dashboard flags it as RED.
// Mirrors artifact_sla_hours in openclaw-cron-manifest.js (+ grace margin).
const ARTIFACT_SLA_HOURS = Object.freeze({
  evidence_linker: 2, // cron every 15m → alarm at >2h
  calibration: 6, // cron every 4h → alarm at >6h
  retrospect: 6, // cron every 4h → alarm at >6h
});

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

router.get("/dashboard/openclaw", (req, res) => {
  const tailLimit = Number(req.query.tail_limit);
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

  return res.json({
    ok: true,
    generated_at: new Date().toISOString(),
    health,
    artifacts,
    evidence,
    phase: {
      // The operator flips the phase via apply_openclaw_phase.sh — the
      // dashboard just reflects whatever env the live runtime is using.
      narrative_enabled: String(process.env.OPENCLAW_NARRATIVE_ENABLED || "").trim() === "1",
      narrative_provider_mode: process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE || "CLI",
      conductor_enabled: String(process.env.OPENCLAW_CONDUCTOR_ENABLED || "").trim() === "1",
      conductor_shadow_only: String(process.env.OPENCLAW_CONDUCTOR_SHADOW_ONLY || "1").trim() !== "0",
      retrospect_apply_enabled: String(process.env.OPENCLAW_RETROSPECT_APPLY_ENABLED || "").trim() === "1",
      autonomy_auto_degrade: String(process.env.OPENCLAW_AUTONOMY_AUTO_DEGRADE || "").trim() === "1",
      ml_min_tp1_prob: Number(process.env.OPENCLAW_ML_MIN_TP1_PROB || 0.22) || 0.22,
    },
  });
});

module.exports = router;
