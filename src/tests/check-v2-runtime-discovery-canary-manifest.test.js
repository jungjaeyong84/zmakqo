"use strict";

const assert = require("assert");
const checker = require("../../scripts/check-v2-runtime-discovery-canary-manifest");

function serviceJson({
  symbols = "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT",
  maxSymbolCount = "8",
  maxNotionalQuote = "6",
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
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT", value: maxSymbolCount }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE", value: maxNotionalQuote }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE", value: "10" }),
                Object.freeze({ name: "DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_COLLECTION_PREFIX", value: "v2__" }),
                Object.freeze({ name: "ML_LIVE_SERVING_ARMED", value: "0" }),
                Object.freeze({ name: "OPENCLAW_AGENT_APPLY_ENABLED", value: "0" }),
                Object.freeze({ name: "OPENCLAW_NARRATIVE_PROVIDER_MODE", value: "CODEX_CLI_ONLY" }),
                Object.freeze({ name: "OPENAI_CODEX_FALLBACK_ENABLED", value: "0" }),
                Object.freeze({ name: "SIGNAL_AI_ENABLED", value: "0" }),
                Object.freeze({ name: "AI_ALLOC_CLAUDE_ENABLED", value: "0" }),
                Object.freeze({ name: "AI_ALLOC_ENSEMBLE_ENABLED", value: "0" }),
                Object.freeze({ name: "AI_ALLOC_GPT_ENABLED", value: "0" }),
                Object.freeze({ name: "NEWS_PROVIDER", value: "disabled" }),
                Object.freeze({ name: "SIGNAL_AI_NEWS_PROVIDER", value: "disabled" }),
              ]),
            }),
          ]),
        }),
      }),
    }),
  });
}

function traceOnlyServiceJson({
  image = "gcr.io/donbeolja-dev/donbeolja:v2-fixture",
  commit = "0123456789abcdef0123456789abcdef01234567",
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
                Object.freeze({ name: "RUNTIME_MODE", value: "production" }),
                Object.freeze({ name: "EGRESS_PROXY_ONLY", value: "1" }),
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
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, true);
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson({
      symbols: "SOLUSDT|XRPUSDT",
      maxSymbolCount: "2",
      maxNotionalQuote: "25",
    })),
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: "XRPUSDT|SOLUSDT",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "2",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25",
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_PASS");
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(serviceJson({ symbols: "BTCUSDT" })),
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

{
  const unsafeService = JSON.parse(JSON.stringify(serviceJson()));
  unsafeService.spec.template.spec.containers[0].env.push(Object.freeze({
    name: "OPENAI_API_KEY",
    valueFrom: { secretKeyRef: { name: "OPENAI_API_KEY", key: "latest" } },
  }));
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(unsafeService),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:FORBIDDEN_ENV_PRESENT:OPENAI_API_KEY"));
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON_MAP: JSON.stringify({
      donbeolja: serviceJson(),
      "donbeolja-exit-worker": serviceJson({ symbols: "" }),
    }),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:donbeolja-exit-worker:SYMBOLS_MISMATCH"));
  assert.strictEqual(result.mismatches["donbeolja-exit-worker:DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS"].actual, null);
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON_MAP: JSON.stringify({
      donbeolja: serviceJson(),
      "donbeolja-exit-worker": serviceJson(),
      "donbeolja-egress": traceOnlyServiceJson(),
      "donbeolja-egress-private": traceOnlyServiceJson(),
    }),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.service_results.length, 4);
  assert.strictEqual(result.service_results.find((row) => row.service_name === "donbeolja-egress").env_contract_checked, false);
  assert.strictEqual(result.service_results.find((row) => row.service_name === "donbeolja").env_contract_checked, true);
}

{
  const unsafeService = JSON.parse(JSON.stringify(serviceJson()));
  unsafeService.spec.template.spec.containers[0].env.push(Object.freeze({
    name: "ANTHROPIC_API_KEY",
    valueFrom: { secretKeyRef: { name: "CLAUDE_API_KEY", key: "latest" } },
  }));
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(unsafeService),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:FORBIDDEN_ENV_PRESENT:ANTHROPIC_API_KEY"));
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON_MAP: JSON.stringify({
      donbeolja: serviceJson(),
      "donbeolja-exit-worker": serviceJson(),
      "donbeolja-egress": traceOnlyServiceJson({ image: "gcr.io/donbeolja-dev/donbeolja:v2-old" }),
    }),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:donbeolja-egress:IMAGE_TAG_MISMATCH"));
}

console.log("check-v2-runtime-discovery-canary-manifest.test.js: OK");
