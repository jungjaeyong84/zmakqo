"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  buildArtifact,
  collect,
} = require("../../scripts/collect-v2-algo-endpoint-degradation-state");
const { buildAlgoEndpointDegradationDocPath } = require("../v2/algoEndpointDegradationState");

function makeFakeFirestore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  function ref(docPath) {
    return {
      path: docPath,
      async get() {
        const data = docs.get(docPath);
        return {
          exists: data !== undefined,
          data: () => ({ ...(data || {}) }),
        };
      },
      async set(payload) {
        docs.set(docPath, { ...(payload || {}) });
      },
    };
  }
  return {
    docs,
    doc(docPath) {
      return ref(docPath);
    },
    collection(name) {
      return {
        doc(id) {
          return ref(`${name}/${id}`);
        },
      };
    },
  };
}

function algoDoc({ status = "DEGRADED", durationMs = 0, escalated = false } = {}) {
  return {
    state_type: "V2_ALGO_ENDPOINT_DEGRADATION",
    status,
    duration_ms: durationMs,
    escalated,
    first_seen_at: "2026-04-26T00:00:00.000Z",
    last_seen_at: "2026-04-26T00:01:00.000Z",
    consecutive_seen_n: 1,
    note: "ALGO_ENDPOINT_UNAVAILABLE",
  };
}

function artifactBlocksCriticalDegradation() {
  const artifact = buildArtifact({
    rows: [
      {
        symbol: "LINKUSDT",
        doc_path: buildAlgoEndpointDegradationDocPath({ symbol: "LINKUSDT" }),
        exists: true,
        data: algoDoc({ durationMs: 601000 }),
      },
    ],
    env: { DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS: "600000" },
    nowMs: Date.parse("2026-04-26T00:10:00.000Z"),
  });
  assert.strictEqual(artifact.ok, false);
  assert.strictEqual(artifact.degraded_crit_n, 1);
  assert.ok(artifact.blockers.includes("ALGO_ENDPOINT_DEGRADATION:LINKUSDT:CRIT"));
}

function artifactAllowsWarnAndRecovered() {
  const artifact = buildArtifact({
    rows: [
      {
        symbol: "BNBUSDT",
        doc_path: buildAlgoEndpointDegradationDocPath({ symbol: "BNBUSDT" }),
        exists: true,
        data: algoDoc({ durationMs: 1000 }),
      },
      {
        symbol: "XRPUSDT",
        doc_path: buildAlgoEndpointDegradationDocPath({ symbol: "XRPUSDT" }),
        exists: true,
        data: algoDoc({ status: "RECOVERED", durationMs: 601000 }),
      },
      {
        symbol: "DOGEUSDT",
        doc_path: buildAlgoEndpointDegradationDocPath({ symbol: "DOGEUSDT" }),
        exists: false,
        data: null,
      },
    ],
    env: { DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS: "600000" },
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.degraded_warn_n, 1);
  assert.strictEqual(artifact.recovered_n, 1);
  assert.strictEqual(artifact.missing_n, 1);
}

async function collectorWritesLatestAndHistory() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "algo-degradation-collector-"));
  const latestFile = path.join(tmpDir, "latest.json");
  const historyFile = path.join(tmpDir, "history.jsonl");
  const symbol = "SOLUSDT";
  const db = makeFakeFirestore({
    [buildAlgoEndpointDegradationDocPath({ symbol })]: algoDoc({ status: "RECOVERED", durationMs: 10000 }),
  });
  const { artifact, files } = await collect({
    db,
    env: {
      DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_SYMBOLS: symbol,
      DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_FILE: latestFile,
      DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_HISTORY_FILE: historyFile,
    },
  });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.symbol_n, 1);
  assert.strictEqual(artifact.recovered_n, 1);
  assert.strictEqual(files.outputFile, latestFile);
  assert.strictEqual(fs.existsSync(latestFile), true);
  assert.strictEqual(fs.existsSync(historyFile), true);
}

(async function run() {
  artifactBlocksCriticalDegradation();
  artifactAllowsWarnAndRecovered();
  await collectorWritesLatestAndHistory();
  console.log("COLLECT_V2_ALGO_ENDPOINT_DEGRADATION_STATE_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
