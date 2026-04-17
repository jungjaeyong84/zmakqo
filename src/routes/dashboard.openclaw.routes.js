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
      narrative_provider_mode: process.env.OPENCLAW_NARRATIVE_PROVIDER_MODE || "CLI",
      conductor_enabled: String(process.env.OPENCLAW_CONDUCTOR_ENABLED || "").trim() === "1",
      conductor_shadow_only: String(process.env.OPENCLAW_CONDUCTOR_SHADOW_ONLY || "1").trim() !== "0",
      retrospect_apply_enabled: String(process.env.OPENCLAW_RETROSPECT_APPLY_ENABLED || "").trim() === "1",
      autonomy_auto_degrade: String(process.env.OPENCLAW_AUTONOMY_AUTO_DEGRADE || "").trim() === "1",
      ml_min_tp1_prob: Number(process.env.OPENCLAW_ML_MIN_TP1_PROB || 0.22) || 0.22,
    },
  };
}

// Minimal HTML escape for text nodes and attribute values. No dependency on
// a template engine — we generate a single self-contained page.
function esc(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function healthBadge(color) {
  const map = {
    GREEN: { bg: "#16a34a", label: "GREEN — 정상" },
    AMBER: { bg: "#d97706", label: "AMBER — 부분 지연" },
    RED: { bg: "#dc2626", label: "RED — 확인 필요" },
  };
  const pick = map[color] || map.RED;
  return `<span class="badge" style="background:${pick.bg}">${esc(pick.label)}</span>`;
}

function boolPill(v) {
  const on = Boolean(v);
  const bg = on ? "#16a34a" : "#6b7280";
  const label = on ? "ON" : "OFF";
  return `<span class="pill" style="background:${bg}">${label}</span>`;
}

function artifactCard(key, art) {
  const stat = art.stat || {};
  const healthy = stat.healthy === true;
  const borderColor = healthy ? "#16a34a" : (art.status === "missing" ? "#9ca3af" : "#dc2626");
  const ageLabel = stat.age_hours != null
    ? `${stat.age_hours}h (SLA ${stat.sla_hours}h)`
    : `없음 (SLA ${stat.sla_hours}h)`;

  const summary = art.summary || {};
  const bits = [];
  if (summary.counts && typeof summary.counts === "object") {
    for (const [k, v] of Object.entries(summary.counts)) {
      bits.push(`<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`);
    }
  }
  if (summary.proposals_count != null) {
    bits.push(`<div class="kv"><span class="k">proposals</span><span class="v">${esc(summary.proposals_count)}</span></div>`);
  }
  if (summary.trust_weights && typeof summary.trust_weights === "object") {
    for (const [source, entry] of Object.entries(summary.trust_weights)) {
      const w = entry && entry.weight != null ? Number(entry.weight).toFixed(2) : "n/a";
      const hit = entry && entry.hit_rate != null
        ? `${(Number(entry.hit_rate) * 100).toFixed(1)}%`
        : "n/a";
      bits.push(`<div class="kv"><span class="k">${esc(source)}</span><span class="v">w=${w} · hit=${hit}</span></div>`);
    }
  }
  if (!bits.length) {
    bits.push(`<div class="kv muted">요약 데이터 없음</div>`);
  }
  if (summary.dry_run === true) {
    bits.push(`<div class="kv"><span class="k">mode</span><span class="v">DRY_RUN</span></div>`);
  }

  const statusLabel = art.status === "ok"
    ? (healthy ? "정상" : "만료됨")
    : (art.status === "missing" ? "파일 없음 (cron 아직 안 돎)" : `오류: ${art.error || ""}`);

  return `
    <div class="card" style="border-left-color:${borderColor}">
      <div class="card-head">
        <div class="title">${esc(key)}</div>
        <div class="meta">${esc(statusLabel)}</div>
      </div>
      <div class="meta small">age: ${esc(ageLabel)}</div>
      <div class="kv-list">${bits.join("")}</div>
      <div class="filename">${esc(art.filename)}</div>
    </div>
  `;
}

function phaseRow(k, v) {
  return `<tr><td>${esc(k)}</td><td>${typeof v === "boolean" ? boolPill(v) : esc(v)}</td></tr>`;
}

function evidenceTable(tail) {
  if (!tail || !tail.length) {
    return `<div class="muted small">아직 Evidence Ledger 기록 없음. OPENCLAW_AGENT_SHADOW_ENABLED=1 이후 신호가 들어와야 쌓입니다.</div>`;
  }
  const rows = tail.map((r) => `
    <tr>
      <td class="ts">${esc((r.recorded_at || "").slice(5, 19).replace("T", " "))}</td>
      <td>${esc(r.kind || "")}</td>
      <td>${esc(r.symbol || "")}</td>
      <td>${esc(r.tf_exec || "")}</td>
      <td>${esc(r.decision || "")}</td>
      <td>${r.confidence != null ? Number(r.confidence).toFixed(2) : ""}</td>
      <td>${esc(r.rule_verdict || "")}</td>
      <td>${esc(r.narrative_verdict || "")}</td>
    </tr>
  `).join("");
  return `
    <table class="evi">
      <thead>
        <tr>
          <th>시각 (UTC)</th><th>kind</th><th>symbol</th><th>tf</th>
          <th>decision</th><th>conf</th><th>rule</th><th>narrative</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderHtml(payload) {
  const evi = payload.evidence || {};
  const phase = payload.phase || {};
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>OpenClaw Agent — 대시보드</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Helvetica Neue", Arial, sans-serif; background: #0b0f14; color: #e5e7eb; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .subtitle { color: #9ca3af; font-size: 13px; margin-bottom: 24px; }
  .row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; margin-bottom: 24px; }
  .badge { display: inline-block; padding: 6px 14px; border-radius: 999px; color: #fff; font-weight: 600; font-size: 13px; }
  .pill { display: inline-block; padding: 2px 10px; border-radius: 999px; color: #fff; font-weight: 600; font-size: 11px; letter-spacing: 0.02em; }
  .btn { display: inline-block; padding: 6px 14px; border-radius: 8px; background: #1f2937; color: #e5e7eb; border: 1px solid #374151; font-size: 13px; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #374151; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px; }
  @media (max-width: 820px) { .grid3 { grid-template-columns: 1fr; } }
  .card { background: #111827; border-radius: 12px; padding: 16px 18px; border-left: 4px solid #6b7280; box-shadow: 0 1px 0 rgba(255,255,255,0.02); }
  .card-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 6px; }
  .card .title { font-weight: 700; font-size: 15px; }
  .card .meta { color: #9ca3af; font-size: 12px; }
  .card .small { font-size: 11px; margin-bottom: 10px; }
  .card .filename { color: #4b5563; font-size: 10px; margin-top: 10px; font-family: ui-monospace, Menlo, monospace; word-break: break-all; }
  .kv-list { display: flex; flex-direction: column; gap: 4px; }
  .kv { display: flex; justify-content: space-between; font-size: 13px; font-family: ui-monospace, Menlo, monospace; }
  .kv .k { color: #9ca3af; }
  .kv .v { color: #e5e7eb; }
  .kv.muted { color: #6b7280; }
  .section { background: #111827; border-radius: 12px; padding: 18px 20px; margin-bottom: 24px; }
  .section h2 { font-size: 15px; margin: 0 0 12px; color: #e5e7eb; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table th, table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #1f2937; }
  table th { color: #9ca3af; font-weight: 500; }
  table.evi td.ts { font-family: ui-monospace, Menlo, monospace; color: #9ca3af; }
  table.phase td:first-child { color: #9ca3af; width: 40%; }
  .muted { color: #9ca3af; }
  .small { font-size: 12px; }
  .footer { margin-top: 32px; text-align: center; color: #4b5563; font-size: 11px; }
  .footer a { color: #6b7280; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>OpenClaw Agent — 모니터링</h1>
  <div class="subtitle">
    생성: <span id="ts">${esc(payload.generated_at)}</span> ·
    <a class="btn" href="/dashboard/openclaw" title="JSON 원본" style="padding:2px 10px;font-size:11px">JSON 보기</a>
    <a class="btn" href="#" onclick="location.reload();return false;" style="padding:2px 10px;font-size:11px">새로고침</a>
  </div>

  <div class="row">
    ${healthBadge(payload.health && payload.health.color)}
    ${payload.health && payload.health.unhealthy && payload.health.unhealthy.length
      ? `<span class="muted small">미건강: ${payload.health.unhealthy.map(esc).join(", ")}</span>`
      : `<span class="muted small">모든 크론 아티팩트 정상</span>`}
  </div>

  <div class="grid3">
    ${artifactCard("evidence_linker", payload.artifacts.evidence_linker)}
    ${artifactCard("calibration", payload.artifacts.calibration)}
    ${artifactCard("retrospect", payload.artifacts.retrospect)}
  </div>

  <div class="section">
    <h2>현재 Phase 상태 (live env)</h2>
    <table class="phase">
      <tbody>
        ${phaseRow("narrative_enabled", phase.narrative_enabled)}
        ${phaseRow("narrative_provider_mode", phase.narrative_provider_mode)}
        ${phaseRow("conductor_enabled", phase.conductor_enabled)}
        ${phaseRow("conductor_shadow_only", phase.conductor_shadow_only)}
        ${phaseRow("retrospect_apply_enabled", phase.retrospect_apply_enabled)}
        ${phaseRow("autonomy_auto_degrade", phase.autonomy_auto_degrade)}
        ${phaseRow("ml_min_tp1_prob", phase.ml_min_tp1_prob)}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Evidence Ledger 최근 기록
      <span class="muted small">(${esc(evi.buffer_size || 0)} / ${esc(evi.buffer_capacity || 0)})</span>
    </h2>
    ${evidenceTable(evi.tail || [])}
  </div>

  <div class="footer">
    <div>OpenClaw ML+AI Decision Agent · paper trading · shadow-first</div>
    <div>Phase 전환: <code>./ops/deploy/apply_openclaw_phase.sh day{0,1,7,10,14,17,22} --restart</code></div>
  </div>
</div>
<script>
  // 30초마다 자동 새로고침 — 라이브 모니터링용. 사용자가 수동 새로고침 하면 타이머 리셋됨.
  setTimeout(function(){ location.reload(); }, 30000);
</script>
</body>
</html>`;
}

router.get("/dashboard/openclaw", (req, res) => {
  const tailLimit = Number(req.query.tail_limit);
  const payload = buildDashboardPayload({ tailLimit });
  return res.json(payload);
});

router.get("/dashboard/openclaw/view", (req, res) => {
  const tailLimit = Number(req.query.tail_limit);
  const payload = buildDashboardPayload({ tailLimit });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Cache: 0 so every reload shows the freshest artifact state.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.send(renderHtml(payload));
});

module.exports = router;
