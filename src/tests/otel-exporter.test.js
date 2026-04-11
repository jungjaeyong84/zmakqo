"use strict";

const assert = require("assert");
const { buildOtlpTracePayload, exportTraceContext, __test } = require("../services/otelExporter");
const { normalizeTraceContext } = require("../utils/traceContext");

async function run() {
  const originalEnabled = process.env.OTEL_EXPORTER_ENABLED;
  const originalEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const originalBaseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const originalHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS;
  const originalUseGoogleAuth = process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH;
  const originalGoogleCloudProject = process.env.GOOGLE_CLOUD_PROJECT;
  const originalOtelGcpProjectId = process.env.OTEL_GCP_PROJECT_ID;

  try {
    const trace = normalizeTraceContext({
      requestId: "REQ-OTEL-1",
      runId: "RUN-OTEL-1",
      exchange: "binancefut",
      symbol: "btcusdt",
      mutationKind: "system_runtime_guards",
      source: "system_runtime_guards_job",
      spanName: "system.runtime.guards",
    });
    process.env.OTEL_GCP_PROJECT_ID = "donbeolja-dev";

    const payload = buildOtlpTracePayload({
      trace,
      serviceName: "donbeolja-test",
      environment: "test",
      attributes: { circuit_breaker_open: true, issue_count: 2 },
      startTime: "2026-04-11T00:00:00.000Z",
      endTime: "2026-04-11T00:00:01.000Z",
    });
    const spans = payload.resourceSpans[0].scopeSpans[0].spans;
    const resourceAttrs = payload.resourceSpans[0].resource.attributes;
    assert.strictEqual(spans.length, 1);
    assert.strictEqual(spans[0].traceId, trace.otel_trace_id);
    assert.strictEqual(spans[0].spanId, trace.otel_span_id);
    assert.ok(Array.isArray(spans[0].attributes));
    assert.ok(resourceAttrs.some((row) => row.key === "gcp.project_id" && row.value && row.value.stringValue === "donbeolja-dev"));

    process.env.OTEL_EXPORTER_ENABLED = "0";
    let result = await exportTraceContext({ trace });
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.reason, "OTEL_EXPORTER_DISABLED");

    process.env.OTEL_EXPORTER_ENABLED = "1";
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "https://otel.example.test/v1/traces";
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer test,x-tenant=donbeolja";
    const posted = [];
    result = await exportTraceContext({
      trace,
      attributes: { status: "BLOCK" },
      postJson: async (payload) => {
        posted.push(payload);
        return { ok: true, status: 200, body: "" };
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(posted.length, 1);
    assert.strictEqual(posted[0].url, "https://otel.example.test/v1/traces");
    assert.strictEqual(posted[0].headers.authorization, "Bearer test");
    assert.strictEqual(posted[0].headers["x-tenant"], "donbeolja");
    assert.strictEqual(posted[0].body.resourceSpans[0].scopeSpans[0].spans[0].traceId, trace.otel_trace_id);

    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://otel.example.test";
    assert.strictEqual(__test.resolveTracesEndpoint(), "https://otel.example.test/v1/traces");
    assert.strictEqual(__test.shouldUseGoogleAuth("https://telemetry.googleapis.com/v1/traces"), true);
    process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH = "0";
    assert.strictEqual(__test.shouldUseGoogleAuth("https://telemetry.googleapis.com/v1/traces"), false);
    process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH = "1";
    const headers = await __test.buildAuthHeaders({
      endpoint: "https://example.test/v1/traces",
      headers: { Authorization: "Bearer existing" },
    });
    assert.strictEqual(headers.Authorization, "Bearer existing");
  } finally {
    if (originalEnabled == null) delete process.env.OTEL_EXPORTER_ENABLED;
    else process.env.OTEL_EXPORTER_ENABLED = originalEnabled;
    if (originalEndpoint == null) delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = originalEndpoint;
    if (originalBaseEndpoint == null) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalBaseEndpoint;
    if (originalHeaders == null) delete process.env.OTEL_EXPORTER_OTLP_HEADERS;
    else process.env.OTEL_EXPORTER_OTLP_HEADERS = originalHeaders;
    if (originalUseGoogleAuth == null) delete process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH;
    else process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH = originalUseGoogleAuth;
    if (originalGoogleCloudProject == null) delete process.env.GOOGLE_CLOUD_PROJECT;
    else process.env.GOOGLE_CLOUD_PROJECT = originalGoogleCloudProject;
    if (originalOtelGcpProjectId == null) delete process.env.OTEL_GCP_PROJECT_ID;
    else process.env.OTEL_GCP_PROJECT_ID = originalOtelGcpProjectId;
  }
}

run()
  .then(() => {
    console.log("OTEL_EXPORTER_TEST_OK");
  })
  .catch((err) => {
    console.error("OTEL_EXPORTER_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
