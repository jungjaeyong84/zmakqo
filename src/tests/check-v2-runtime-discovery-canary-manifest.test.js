"use strict";

const assert = require("assert");
const checker = require("../../scripts/check-v2-runtime-discovery-canary-manifest");

function serviceJson({
  symbols = "SOLUSDT|XRPUSDT",
  image = "gcr.io/donbeolja-dev/donbeolja:v2-fixture",
  commit = "0123456789abcdef0123456789abcdef01234567",
  endpointEnabled = "1",
  discoveryEnabled = "1",
} = {}) {
  return Object.freeze({
    metadata: Object.freeze({
      labels: Object.freeze({
        "image-tag": "v2-fixture",
        "commit-sha": commit,
      }),
    }),
    spec: Object.freeze({
      template: Object.freeze({
        spec: Object.freeze({
          containers: Object.freeze([
            Object.freeze({
              image,
              env: Object.freeze([
                Object.freeze({ name: "DONBEOLJA_V2_ENABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DRY_RUN", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_CANARY_ONLY", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED", value: endpointEnabled }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", value: discoveryEnabled }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS", value: symbols }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE", value: "25" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE", value: "10" }),
                Object.freeze({ name: "DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_COLLECTION_PREFIX", value: "v2__" }),
                Object.freeze({ name: "ML_LIVE_SERVING_ARMED", value: "0" }),
                Object.freeze({ name: "OPENCLAW_AGENT_APPLY_ENABLED", value: "0" }),
              ]),
            }),
          ]),
        }),
      }),
    }),
  });
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson()),
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: "XRPUSDT|SOLUSDT",
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_PASS");
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson({ symbols: "BTCUSDT" })),
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_BLOCKED");
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:SYMBOLS_MISMATCH"));
  assert.strictEqual(result.mismatches.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS.actual, "BTCUSDT");
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson({ image: "gcr.io/donbeolja-dev/donbeolja:v2-old" })),
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:IMAGE_TAG_MISMATCH"));
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson({
      symbols: "",
      endpointEnabled: "0",
      discoveryEnabled: "0",
    })),
    DONBEOLJA_V2_EXPECTED_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_ENABLED: "0",
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, true);
}

console.log("check-v2-runtime-discovery-canary-manifest.test.js: OK");
