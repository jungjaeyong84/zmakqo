"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const aliasScript = require("../../scripts/sync-v2-openclaw-learning-artifact-aliases");

try {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-openclaw-alias-"));
  try {
    const legacyJson = path.join(tmpDir, "best_self_evolution_execution_quality_latest.json");
    const legacyMd = path.join(tmpDir, "best_self_evolution_execution_quality_latest.md");
    fs.writeFileSync(legacyJson, `${JSON.stringify({ status: "PASS", sample_n: 12 }, null, 2)}\n`, "utf8");
    fs.writeFileSync(legacyMd, "# Legacy Name\n\nbody\n", "utf8");

    const report = aliasScript.main({ V2_OPENCLAW_ALIAS_OPS_DAILY_DIR: tmpDir });
    assert.strictEqual(report.ok, true);
    assert.ok(report.alias_n >= 1);

    const aliased = JSON.parse(fs.readFileSync(path.join(tmpDir, "v2_openclaw_execution_quality_latest.json"), "utf8"));
    assert.strictEqual(aliased.status, "PASS");
    assert.strictEqual(aliased.report_namespace, "V2_OPENCLAW");
    assert.strictEqual(aliased.v2_learning_artifact_alias, true);
    assert.strictEqual(aliased.legacy_name_retained_for_compatibility, true);
    assert.strictEqual(aliased.legacy_artifact_base, "best_self_evolution_execution_quality_latest");
    assert.strictEqual(aliased.v2_artifact_base, "v2_openclaw_execution_quality_latest");

    const md = fs.readFileSync(path.join(tmpDir, "v2_openclaw_execution_quality_latest.md"), "utf8");
    assert.ok(md.includes("V2_OPENCLAW_ALIAS"));
    assert.ok(md.includes("# Legacy Name"));

    const latest = JSON.parse(fs.readFileSync(path.join(tmpDir, "v2_openclaw_learning_artifact_aliases_latest.json"), "utf8"));
    assert.strictEqual(latest.report_namespace, "V2_OPENCLAW");
    assert.ok(latest.rows.some((row) => row.id === "execution_quality" && row.json_written === true));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log("SYNC_V2_OPENCLAW_LEARNING_ARTIFACT_ALIASES_TEST_OK");
} catch (err) {
  console.error("SYNC_V2_OPENCLAW_LEARNING_ARTIFACT_ALIASES_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
