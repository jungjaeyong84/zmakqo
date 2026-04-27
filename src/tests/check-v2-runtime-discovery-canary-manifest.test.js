"use strict";

const assert = require("assert");
const checker = require("../../scripts/check-v2-runtime-discovery-canary-manifest");

function serviceJson({
  symbols = "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT",
  maxSymbolCount = "8",
  maxNotionalQuote = "6",
  symbolNotionalQuoteMap = "BTCUSDT:155|ETHUSDT:120|LINKUSDT:120|BNBUSDT:120|XRPUSDT:120|SOLUSDT:120|AXSUSDT:120|DOGEUSDT:120",
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
                Object.freeze({ name: "GOOGLE_CLIENT_ID", value: "350958953672-a4434l780u05o2a1ppa29p4fpa2s6l8r.apps.googleusercontent.com" }),
                Object.freeze({ name: "GOOGLE_OAUTH_BASE_URL", value: "https://donbeolja-350958953672.asia-northeast3.run.app" }),
                Object.freeze({ name: "ALLOWLIST_EMAIL", value: "jungjaeyong@gmail.com" }),
                Object.freeze({ name: "SESSION_STORE", value: "firestore" }),
                Object.freeze({ name: "SESSION_TTL_MS", value: "604800000" }),
                Object.freeze({ name: "SESSION_COOKIE_SAMESITE", value: "none" }),
                Object.freeze({ name: "SESSION_COOKIE_SECURE", value: "true" }),
                Object.freeze({ name: "DONBEOLJA_V2_ENABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_DRY_RUN", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_CANARY_ONLY", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED", value: endpointEnabled }),
                Object.freeze({ name: "DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS", value: "8" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED", value: discoveryEnabled }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS", value: symbols }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT", value: maxSymbolCount }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE", value: maxNotionalQuote }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP", value: symbolNotionalQuoteMap }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT", value: "5" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY", value: "UNLIMITED" }),
                Object.freeze({ name: "DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE", value: "10" }),
                Object.freeze({ name: "DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE", value: "900" }),
                Object.freeze({ name: "DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE", value: "200" }),
                Object.freeze({ name: "DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE", value: "900" }),
                Object.freeze({ name: "DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY", value: "UNLIMITED" }),
                Object.freeze({ name: "DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES", value: "0" }),
                Object.freeze({ name: "DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED", value: "1" }),
                Object.freeze({ name: "DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED", value: "1" }),
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
      symbolNotionalQuoteMap: "SOLUSDT:15|XRPUSDT:15",
    })),
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: "XRPUSDT|SOLUSDT",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "2",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "25",
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "SOLUSDT:15|XRPUSDT:15",
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
  unsafeService.spec.template.spec.containers[0].env = unsafeService.spec.template.spec.containers[0].env
    .filter((item) => item.name !== "GOOGLE_CLIENT_ID");
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(unsafeService),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:GOOGLE_CLIENT_ID_MISMATCH"));
}

{
  const unsafeService = JSON.parse(JSON.stringify(serviceJson()));
  unsafeService.spec.template.spec.containers[0].env = unsafeService.spec.template.spec.containers[0].env
    .filter((item) => item.name !== "DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED");
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(unsafeService),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED_MISMATCH"));
}

{
  const unsafeService = JSON.parse(JSON.stringify(serviceJson()));
  unsafeService.spec.template.spec.containers[0].env = unsafeService.spec.template.spec.containers[0].env
    .filter((item) => item.name !== "DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED");
  const result = checker.runCheck({
    DONBEOLJA_V2_RUNTIME_SERVICE_JSON: JSON.stringify(unsafeService),
    TAG: "v2-fixture",
    COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("RUNTIME_DISCOVERY_CANARY:DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED_MISMATCH"));
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
