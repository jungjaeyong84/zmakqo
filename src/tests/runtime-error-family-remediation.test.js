"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/runtime-error-family-remediation");

function run() {
  const family = __test.classifyRuntimeErrorFamily({
    family: "LIVE_EXCEPTION",
    count: 2,
    latest_at: "2026-04-10T21:19:24.616Z",
    symbols: ["AXSUSDT", "BNBUSDT"],
    sources: ["order_intents_paper"],
  }, "2026-04-11T07:57:23.743Z");
  assert.strictEqual(family.family, "LIVE_EXCEPTION");
  assert.strictEqual(family.severity, "HIGH");
  assert.strictEqual(family.owner, "runtime");
  assert.strictEqual(family.active, true);
  assert.ok(String(family.action).includes("provider action"));

  const writerFamily = __test.classifyRuntimeErrorFamily({
    family: "POSITION_WRITE_TOKEN_MISMATCH",
    count: 3,
    latest_at: "2026-04-11T07:19:24.616Z",
    symbols: ["XRPUSDT"],
    sources: ["position_writer_authority_events"],
  }, "2026-04-11T07:57:23.743Z");
  assert.strictEqual(writerFamily.owner, "writer_authority");
  assert.strictEqual(writerFamily.severity, "HIGH");
  assert.ok(String(writerFamily.action).includes("stale token"));
  assert.strictEqual(writerFamily.active, true);
  assert.ok(String(writerFamily.clear_after_iso || "").startsWith("2026-04-11T13:19:24"));

  const singleWriterExpired = __test.classifyRuntimeErrorFamily({
    family: "POSITION_WRITE_TOKEN_MISMATCH",
    count: 1,
    latest_at: "2026-04-11T07:19:24.616Z",
    symbols: ["ETHUSDT"],
    sources: ["position_writer_authority_events"],
  }, "2026-04-11T09:30:00.000Z");
  assert.strictEqual(singleWriterExpired.active, false);

  const md = __test.buildMarkdown({
    generated_at_kst: "2026-04-11 16:57:23 KST",
    ops_status: "중단",
    ops_mode: "비용 차단",
    error_count_24h: 2,
    error_occurrence_count_24h: 3,
    families: [family, writerFamily],
  });
  assert.ok(md.includes("LIVE_EXCEPTION"));
  assert.ok(md.includes("POSITION_WRITE_TOKEN_MISMATCH"));
  assert.ok(md.includes("error_count_24h: 2"));

  console.log("RUNTIME_ERROR_FAMILY_REMEDIATION_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
