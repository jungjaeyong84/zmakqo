#!/usr/bin/env node
"use strict";

// 2026-04-20 senior-audit P2 deploy gate subreport.
//
// Reads positions_paper.meta.native_protection_{cancel,stop_ack,tp_ack}_ms
// for every active exchange position, classifies each one via
// classifyUnprotectedWindowRecord, and emits a JSON CLI result that the
// exit-integrity cycle aggregates into a PASS/BLOCK decision.
//
// Exit code is always 0 when the script runs to completion — the deploy
// gate wrapper (`check-binance-exit-integrity-gate.js`) decides what to
// block on based on the parsed summary. This mirrors how the other
// `report-*` scripts behave in the cycle.

const fs = require("fs");
const path = require("path");
const {
  loadUnprotectedWindowRuntime,
  DEFAULT_THRESHOLD_MS,
  DEFAULT_STALE_MAX_AGE_MS,
} = require("../src/services/nativeProtectionUnprotectedWindowRuntime");

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildMarkdown(summary = {}) {
  const lines = [];
  lines.push("# Native Protection Unprotected Window");
  lines.push("");
  lines.push(`- generated_at_ms: ${summary.generated_at_ms ?? "N/A"}`);
  lines.push(`- exchange: ${summary.exchange || "N/A"}`);
  lines.push(`- threshold_ms: ${summary.threshold_ms ?? "N/A"}`);
  lines.push(`- active_position_count: ${summary.active_position_count ?? "N/A"}`);
  lines.push(`- breach_count: ${summary.breach_count ?? "N/A"}`);
  lines.push(`- breach_window_count: ${summary.breach_window_count ?? "N/A"}`);
  lines.push(`- breach_cancel_without_ack_count: ${summary.breach_cancel_without_ack_count ?? "N/A"}`);
  lines.push(`- max_window_ms: ${summary.max_window_ms ?? "N/A"}`);
  lines.push(`- avg_window_ms: ${summary.avg_window_ms ?? "N/A"}`);
  lines.push("");
  lines.push("## Class counts");
  const classCounts = summary.class_counts || {};
  for (const key of Object.keys(classCounts).sort()) {
    lines.push(`- ${key}: ${classCounts[key]}`);
  }
  lines.push("");
  lines.push("## Breach rows");
  const rows = Array.isArray(summary.breach_rows) ? summary.breach_rows : [];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 30)) {
      lines.push(
        `- ${row.symbol} | class=${row.class} | window_ms=${row.window_ms ?? "N/A"}`
        + ` | cancel_ms=${row.cancel_ms ?? "N/A"} | stop_ack_ms=${row.stop_ack_ms ?? "N/A"}`
        + ` | tp_ack_ms=${row.tp_ack_ms ?? "N/A"} | refresh=${row.refresh_status || "N/A"}`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

// buildCliResult intentionally sets `ok: true` even on breach — the deploy
// gate wrapper inspects breach_count / gate_status. A non-zero exit here
// would hide the breach details from the cycle aggregator.
//
// 2026-04-20 senior-audit M1: when `available === false` (listPositions
// threw — typically Firestore UNAVAILABLE), we cannot prove the
// unprotected-window invariant either way. Treat it as BLOCK — the
// deploy gate would otherwise pass on fleet-blindness.
function buildCliResult(summary = {}, jsonPath, mdPath) {
  const available = summary && summary.available !== false;
  const breachCount = Number(summary.breach_count || 0);
  let gateStatus;
  let status;
  let reason;
  if (!available) {
    gateStatus = "BLOCK";
    status = "WARN";
    reason = "NATIVE_PROTECTION_UNPROTECTED_WINDOW_UNAVAILABLE";
  } else if (breachCount > 0) {
    gateStatus = "BLOCK";
    status = "WARN";
    reason = "NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH";
  } else {
    gateStatus = "PASS";
    status = "OK";
    reason = null;
  }
  return {
    ok: true,
    status,
    gate_status: gateStatus,
    reason,
    available,
    unavailable_reason: summary && summary.unavailable_reason ? summary.unavailable_reason : null,
    unavailable_detail: summary && summary.unavailable_detail ? summary.unavailable_detail : null,
    breach_count: breachCount,
    breach_window_count: Number(summary.breach_window_count || 0),
    breach_cancel_without_ack_count: Number(summary.breach_cancel_without_ack_count || 0),
    partial_ack_count: Number(summary.partial_ack_count || 0),
    max_window_ms: Number.isFinite(Number(summary.max_window_ms)) ? Number(summary.max_window_ms) : null,
    avg_window_ms: Number.isFinite(Number(summary.avg_window_ms)) ? Number(summary.avg_window_ms) : null,
    threshold_ms: Number(summary.threshold_ms || DEFAULT_THRESHOLD_MS),
    active_position_count: Number(summary.active_position_count || 0),
    top_breach_symbols: Array.isArray(summary.breach_rows)
      ? summary.breach_rows.slice(0, 10).map((r) => ({
        symbol: r.symbol,
        class: r.class,
        window_ms: r.window_ms,
      }))
      : [],
    jsonPath,
    mdPath,
  };
}

async function generateUnprotectedWindowReport({
  exchange = "BINANCEFUT",
  outDir = path.join(process.cwd(), "ops", "daily"),
  thresholdMs = Number(process.env.NATIVE_PROTECTION_UNPROTECTED_WINDOW_THRESHOLD_MS || DEFAULT_THRESHOLD_MS),
  staleMaxAgeMs = Number(process.env.NATIVE_PROTECTION_UNPROTECTED_WINDOW_STALE_MAX_AGE_MS || DEFAULT_STALE_MAX_AGE_MS),
  loadRuntime = loadUnprotectedWindowRuntime,
} = {}) {
  const summary = await loadRuntime({
    exchange,
    thresholdMs,
    staleMaxAgeMs,
  });
  ensureDir(outDir);
  const latestJson = path.join(outDir, "native_protection_unprotected_window_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_native_protection_unprotected_window.md`);
  fs.writeFileSync(latestJson, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMd, `${buildMarkdown(summary)}\n`, "utf8");
  return {
    summary,
    jsonPath: latestJson,
    mdPath: datedMd,
    cli: buildCliResult(summary, latestJson, datedMd),
  };
}

async function main() {
  const result = await generateUnprotectedWindowReport({
    exchange: process.env.EXCHANGE || "BINANCEFUT",
  });
  console.log(JSON.stringify(result.cli));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_NATIVE_PROTECTION_UNPROTECTED_WINDOW_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    generateUnprotectedWindowReport,
    __test: {
      buildMarkdown,
      buildCliResult,
    },
  };
}
