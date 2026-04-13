#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { loadNativeTrailProtectionRuntime } = require("../src/services/nativeTrailProtectionRuntime");

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildMarkdown(summary = {}) {
  const lines = [];
  lines.push("# Native Trail Protection Gap");
  lines.push("");
  lines.push(`- generated_at: ${summary.generated_at || "N/A"}`);
  lines.push(`- exchange: ${summary.exchange || "N/A"}`);
  lines.push(`- active_position_count: ${summary.active_position_count ?? "N/A"}`);
  lines.push(`- gap_count: ${summary.gap_count ?? "N/A"}`);
  lines.push("");
  lines.push("## Gap Rows");
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  if (!rows.length) {
    lines.push("- none");
  } else {
    for (const row of rows.slice(0, 30)) {
      lines.push(
        `- ${row.symbol} | state=${row.state || "N/A"} | qty_base=${row.qty_base ?? "N/A"} | trail_active=${row.trail_active ? "1" : "0"} | refresh=${row.native_refresh_status || "N/A"} | stop_order=${row.native_stop_order_id || "N/A"} | stop_price=${row.native_stop_price ?? "N/A"}`
      );
    }
  }
  lines.push("");
  return lines.join("\n");
}

function buildCliResult(summary = {}, jsonPath, mdPath) {
  const gapCount = Number(summary.gap_count || 0);
  return {
    ok: true,
    status: gapCount > 0 ? "WARN" : "OK",
    reason: gapCount > 0 ? "NATIVE_TRAIL_PROTECTION_GAP_PRESENT" : null,
    gap_count: gapCount,
    active_position_count: Number(summary.active_position_count || 0),
    top_symbols: Array.isArray(summary.top_symbols) ? summary.top_symbols.slice(0, 10) : [],
    jsonPath,
    mdPath,
  };
}

async function generateNativeTrailProtectionGapReport({
  exchange = "BINANCEFUT",
  outDir = path.join(process.cwd(), "ops", "daily"),
  loadRuntime = loadNativeTrailProtectionRuntime,
} = {}) {
  const runtime = await loadRuntime({ exchange });
  const summary = {
    ...(runtime && typeof runtime === "object" ? runtime : {}),
    generated_at: new Date().toISOString(),
  };
  ensureDir(outDir);
  const latestJson = path.join(outDir, "native_trail_protection_gap_latest.json");
  const datedMd = path.join(outDir, `${isoDate()}_native_trail_protection_gap.md`);
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
  const result = await generateNativeTrailProtectionGapReport({
    exchange: process.env.EXCHANGE || "BINANCEFUT",
  });
  console.log(JSON.stringify(result.cli));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_NATIVE_TRAIL_PROTECTION_GAP_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    generateNativeTrailProtectionGapReport,
    __test: {
      buildMarkdown,
      buildCliResult,
    },
  };
}
