"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { generateNativeTrailProtectionGapReport, __test } = require("../../scripts/report-native-trail-protection-gap");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-trail-gap-report-"));
  const result = await generateNativeTrailProtectionGapReport({
    exchange: "BINANCEFUT",
    outDir: root,
    loadRuntime: async () => ({
      exchange: "BINANCEFUT",
      available: true,
      active_position_count: 3,
      gap_count: 1,
      top_symbols: [{ symbol: "ETHUSDT", count: 1 }],
      rows: [
        {
          symbol: "ETHUSDT",
          state: "OPEN",
          qty_base: 0.32,
          trail_active: true,
          native_refresh_status: "MISSING",
          native_stop_order_id: null,
          native_stop_price: null,
        },
      ],
    }),
  });

  assert.strictEqual(result.summary.gap_count, 1);
  assert.strictEqual(result.cli.status, "WARN");
  assert.ok(fs.existsSync(result.jsonPath));
  assert.ok(fs.existsSync(result.mdPath));

  const cliOk = __test.buildCliResult({
    gap_count: 0,
    active_position_count: 4,
    top_symbols: [],
  }, "/tmp/a.json", "/tmp/a.md");
  assert.strictEqual(cliOk.status, "OK");

  const md = __test.buildMarkdown({
    generated_at: "2026-04-13T00:00:00.000Z",
    exchange: "BINANCEFUT",
    active_position_count: 2,
    gap_count: 1,
    rows: [{ symbol: "ETHUSDT", state: "OPEN", qty_base: 1, trail_active: true }],
  });
  assert.ok(md.includes("ETHUSDT"));

  console.log("NATIVE_TRAIL_PROTECTION_GAP_REPORT_TEST_OK");
})().catch((err) => {
  console.error("NATIVE_TRAIL_PROTECTION_GAP_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
