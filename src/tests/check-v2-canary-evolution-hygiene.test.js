"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluateArtifact,
  evaluateStaticSource,
  runCheck,
} = require("../../scripts/check-v2-canary-evolution-hygiene");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "canary-evolution-hygiene-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function staticSourcePassesCurrentImplementation() {
  const sourceText = fs.readFileSync(path.join(__dirname, "..", "storage", "signalDrops.js"), "utf8");
  const result = evaluateStaticSource({ sourceText, sourceReadOk: true, sourceFile: "signalDrops.js" });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.blockers, []);
  assert.ok(result.checks.every((row) => row.ok === true));
}

function staticSourceBlocksMissingShadowContract() {
  const result = evaluateStaticSource({
    sourceText: "function shouldConfirmSelfEvolutionFromDrop() { return true; }",
    sourceReadOk: true,
    sourceFile: "bad-signalDrops.js",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("CANARY_EVOLUTION_HYGIENE:SHADOW_COLLECTION_MISSING"));
  assert.ok(result.blockers.includes("CANARY_EVOLUTION_HYGIENE:SHADOW_PREDICATE_MISSING"));
  assert.ok(result.blockers.includes("CANARY_EVOLUTION_HYGIENE:FORMAL_EXCLUSION_REASON_MISSING"));
}

function artifactMissingWarnsByDefault() {
  const result = evaluateArtifact({
    artifactMissing: true,
    artifactFile: "/tmp/missing.json",
    env: {},
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.warnings.includes("CANARY_EVOLUTION_HYGIENE:ARTIFACT_MISSING"));
}

function artifactMissingBlocksWhenRequired() {
  const result = evaluateArtifact({
    artifactMissing: true,
    artifactFile: "/tmp/missing.json",
    env: { DONBEOLJA_V2_CANARY_EVOLUTION_HYGIENE_REQUIRE_ARTIFACT: "1" },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("CANARY_EVOLUTION_HYGIENE:ARTIFACT_MISSING"));
}

function artifactBlocksFormalDatasetContamination() {
  const result = evaluateArtifact({
    artifact: {
      ok: true,
      metrics: {
        formal_dataset_canary_row_n: 2,
        shadow_dataset_canary_row_n: 9,
      },
    },
    artifactMissing: false,
    artifactFile: "/tmp/hygiene.json",
    env: {},
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("CANARY_EVOLUTION_HYGIENE:FORMAL_DATASET_CANARY_CONTAMINATION"));
  assert.strictEqual(result.metrics.formal_dataset_canary_row_n, 2);
}

function runCheckReadsSourceAndArtifact() {
  const tmp = mkTmp();
  const sourceFile = path.join(__dirname, "..", "storage", "signalDrops.js");
  const artifactFile = path.join(tmp, "hygiene.json");
  writeJson(artifactFile, {
    ok: true,
    metrics: {
      formal_dataset_canary_row_n: 0,
      shadow_dataset_canary_row_n: 3,
    },
  });
  const result = runCheck({
    V2_CANARY_EVOLUTION_HYGIENE_SOURCE_FILE: sourceFile,
    V2_CANARY_EVOLUTION_HYGIENE_ARTIFACT_FILE: artifactFile,
    DONBEOLJA_V2_CANARY_EVOLUTION_HYGIENE_REQUIRE_ARTIFACT: "1",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.metrics.shadow_dataset_canary_row_n, 3);
}

staticSourcePassesCurrentImplementation();
staticSourceBlocksMissingShadowContract();
artifactMissingWarnsByDefault();
artifactMissingBlocksWhenRequired();
artifactBlocksFormalDatasetContamination();
runCheckReadsSourceAndArtifact();
console.log("CHECK_V2_CANARY_EVOLUTION_HYGIENE_TEST_OK");
