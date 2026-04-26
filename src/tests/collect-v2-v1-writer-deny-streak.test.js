"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildArtifact,
  classifyV1WriterRows,
  collect,
} = require("../../scripts/collect-v2-v1-writer-deny-streak");
const { runCheck } = require("../../scripts/check-v2-v1-writer-deny-streak");

function row(message, timestamp = "2026-04-26T00:00:00.000Z") {
  return { timestamp, jsonPayload: { message } };
}

function classifiesDeniedAndWriteRows() {
  const result = classifyV1WriterRows({
    rows: [
      row("V2_DISCOVERY_CANARY_LEGACY_ENTRY_WRITE_DENIED"),
      row("V2_DISCOVERY_CANARY_LEGACY_EXIT_WRITE_DENIED"),
      row("V1_LEGACY_EXCHANGE_WRITE_PERFORMED"),
      row("old V1_LEGACY_EXCHANGE_WRITE_PERFORMED", "2026-04-20T00:00:00.000Z"),
    ],
    env: { DONBEOLJA_V2_V1_WRITER_DENY_WINDOW_HOURS: "24" },
    nowMs: Date.parse("2026-04-26T01:00:00.000Z"),
  });
  assert.strictEqual(result.v1_writer_denied_call_n_24h, 2);
  assert.strictEqual(result.v1_place_futures_call_n_24h, 1);
  assert.strictEqual(result.log_row_n, 3);
}

function artifactBlocksOnLegacyWrite() {
  const artifact = buildArtifact({
    rows: [row("V1_PAPER_RUNNER_EXCHANGE_WRITE_PERFORMED")],
    nowMs: Date.parse("2026-04-26T01:00:00.000Z"),
  });
  assert.strictEqual(artifact.ok, false);
  assert.ok(artifact.blockers.includes("V1_WRITER_DENY_STREAK:V1_EXCHANGE_WRITE_CALLS_PRESENT"));
}

function collectorWritesArtifactConsumableByGate() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-writer-deny-collector-"));
  const latestFile = path.join(tmpDir, "latest.json");
  const historyFile = path.join(tmpDir, "history.jsonl");
  const { artifact: payload } = collect({
    DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON: JSON.stringify([
      row("V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED"),
    ]),
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE: latestFile,
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_HISTORY_FILE: historyFile,
  });
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(fs.existsSync(latestFile), true);
  assert.strictEqual(fs.existsSync(historyFile), true);

  const gate = runCheck({
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE: latestFile,
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT: "1",
  });
  assert.strictEqual(gate.ok, true);
  assert.strictEqual(gate.streak.metrics.v1_place_futures_call_n, 0);
  assert.strictEqual(gate.streak.metrics.v1_writer_denied_call_n, 1);
}

function collectorArtifactBlocksGateOnWrite() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v1-writer-deny-collector-block-"));
  const latestFile = path.join(tmpDir, "latest.json");
  const historyFile = path.join(tmpDir, "history.jsonl");
  const { artifact: payload } = collect({
    DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON: JSON.stringify([
      row("LEGACY_V1_EXCHANGE_WRITE_PERFORMED"),
    ]),
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE: latestFile,
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_HISTORY_FILE: historyFile,
  });
  assert.strictEqual(payload.ok, false);
  const gate = runCheck({
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE: latestFile,
    DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT: "1",
  });
  assert.strictEqual(gate.ok, false);
  assert.ok(gate.blockers.includes("V1_WRITER_DENY_STREAK:V1_EXCHANGE_WRITE_CALLS_PRESENT"));
}

function run() {
  classifiesDeniedAndWriteRows();
  artifactBlocksOnLegacyWrite();
  collectorWritesArtifactConsumableByGate();
  collectorArtifactBlocksGateOnWrite();
  console.log("COLLECT_V2_V1_WRITER_DENY_STREAK_TEST_OK");
}

run();
