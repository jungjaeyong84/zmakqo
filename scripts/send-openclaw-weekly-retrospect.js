#!/usr/bin/env node
"use strict";

// Weekly OpenClaw retrospect telegram summary.
//
// Reads the three agent-cycle artifacts (evidence linker, calibration,
// retrospect) plus the latest 7-day evidence counts, formats a short
// Korean-language summary, and ships it to the operator's telegram
// channel via the existing `sendAlert` helper.
//
// Safety:
//   - Never sends if DRY_RUN=1 (prints to stdout instead).
//   - Never includes raw narrative text — only decision counts + trust
//     weights + next-action recommendations so we do not leak LLM content
//     into a chat channel.
//   - Exits 0 on all errors so the launchd cron does not flap; errors
//     are surfaced via stdout for the wrapper log.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const DRY_RUN = String(process.env.DRY_RUN || "").trim() === "1";
const ALERT_CHANNEL = String(process.env.OPENCLAW_WEEKLY_ALERT_CHANNEL || process.env.ALERT_CHANNEL || "").trim();

function readJson(filename) {
  try {
    const p = path.join(OPS_DAILY, filename);
    const raw = fs.readFileSync(p, "utf8");
    const payload = JSON.parse(raw);
    const st = fs.statSync(p);
    return { payload, mtime: new Date(st.mtimeMs).toISOString(), path: p };
  } catch (err) {
    return { payload: null, error: err && err.code === "ENOENT" ? "MISSING" : (err && err.message) || String(err) };
  }
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(Number(n))) return "n/a";
  return `${(Number(n) * 100).toFixed(1)}%`;
}

function buildBody() {
  const linker = readJson("openclaw_evidence_linker_latest.json");
  const calibration = readJson("openclaw_calibration_latest.json");
  const retrospect = readJson("openclaw_retrospect_latest.json");

  const lines = [];
  lines.push("🧠 OpenClaw Weekly Retrospect");
  lines.push(`- 생성: ${new Date().toISOString()}`);

  lines.push("");
  lines.push("📊 Evidence Linker");
  if (linker.error) {
    lines.push(`  · status: ${linker.error}`);
  } else {
    const p = linker.payload || {};
    const counts = p.counts || {};
    lines.push(`  · mtime: ${linker.mtime}`);
    lines.push(`  · linked: ${counts.linked != null ? counts.linked : "n/a"}`);
    lines.push(`  · tp1_first: ${counts.tp1_first != null ? counts.tp1_first : "n/a"}`);
    lines.push(`  · sl_first: ${counts.sl_first != null ? counts.sl_first : "n/a"}`);
  }

  lines.push("");
  lines.push("🎯 Calibration (trust_weights)");
  if (calibration.error) {
    lines.push(`  · status: ${calibration.error}`);
  } else {
    const p = calibration.payload || {};
    const tw = p.trust_weights || {};
    lines.push(`  · mtime: ${calibration.mtime}`);
    for (const source of Object.keys(tw).sort()) {
      const entry = tw[source] || {};
      const hit = entry.hit_rate != null ? entry.hit_rate : (entry.tp1_hit_rate != null ? entry.tp1_hit_rate : null);
      const weight = entry.weight != null ? entry.weight : (entry.trust_weight != null ? entry.trust_weight : null);
      lines.push(`  · ${source}: weight=${weight != null ? Number(weight).toFixed(2) : "n/a"} hit=${fmtPct(hit)}`);
    }
  }

  lines.push("");
  lines.push("🔍 Retrospect Proposals (safety-rail only)");
  if (retrospect.error) {
    lines.push(`  · status: ${retrospect.error}`);
  } else {
    const p = retrospect.payload || {};
    const proposals = Array.isArray(p.proposals) ? p.proposals : [];
    lines.push(`  · mtime: ${retrospect.mtime}`);
    lines.push(`  · total: ${proposals.length}`);
    const byKind = {};
    for (const prop of proposals) {
      const k = String((prop && prop.action) || (prop && prop.kind) || "unknown");
      byKind[k] = (byKind[k] || 0) + 1;
    }
    for (const kind of Object.keys(byKind).sort()) {
      lines.push(`  · ${kind}: ${byKind[kind]}`);
    }
  }

  return lines.join("\n");
}

async function main() {
  const body = buildBody();

  if (DRY_RUN || !ALERT_CHANNEL) {
    const mode = DRY_RUN ? "DRY_RUN" : "NO_ALERT_CHANNEL";
    console.log(JSON.stringify({ ok: true, mode, body }));
    return;
  }

  try {
    const { sendAlert } = require("../src/utils/alerts");
    const result = await sendAlert({
      channel: ALERT_CHANNEL,
      title: "OpenClaw Weekly Retrospect",
      body,
      severity: "info",
    });
    console.log(JSON.stringify({ ok: true, sent: Boolean(result && result.ok), result }));
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, fatal: err && err.stack ? err.stack : String(err) }));
  process.exit(0);
});
