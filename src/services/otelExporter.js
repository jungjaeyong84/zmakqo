"use strict";

const http = require("http");
const https = require("https");
const { GoogleAuth } = require("google-auth-library");

const GOOGLE_OTLP_TRACE_HOST = "telemetry.googleapis.com";

function cleanText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function isExporterEnabled() {
  return String(process.env.OTEL_EXPORTER_ENABLED || "1").trim() !== "0";
}

function shouldUseGoogleAuth(endpoint = null) {
  const raw = String(process.env.OTEL_EXPORTER_OTLP_USE_GOOGLE_AUTH || "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  const resolved = cleanText(endpoint) || resolveTracesEndpoint();
  if (!resolved) return false;
  try {
    return new URL(resolved).hostname === GOOGLE_OTLP_TRACE_HOST;
  } catch (_) {
    return false;
  }
}

function resolveTracesEndpoint() {
  const explicit = cleanText(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (explicit) return explicit;
  const base = cleanText(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!base) return null;
  return `${base.replace(/\/+$/, "")}/v1/traces`;
}

function parseHeaders(headerText = null) {
  const out = {};
  const raw = cleanText(headerText);
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = String(part.slice(0, idx)).trim();
    const value = String(part.slice(idx + 1)).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function toAnyValue(value) {
  if (value == null) return { stringValue: "" };
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { intValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function buildAttribute(key, value) {
  return {
    key: String(key || "").trim(),
    value: toAnyValue(value),
  };
}

function toUnixNanos(value = null, fallbackMs = Date.now()) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value * 1000000));
  const date = value instanceof Date ? value : (value ? new Date(value) : new Date(fallbackMs));
  const ms = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : fallbackMs;
  return String(Math.trunc(ms * 1000000));
}

function buildOtlpTracePayload({
  trace = null,
  serviceName = null,
  serviceVersion = null,
  environment = null,
  spanName = null,
  startTime = null,
  endTime = null,
  attributes = null,
} = {}) {
  const normalizedTrace = trace && typeof trace === "object" ? trace : {};
  const resourceAttributes = [
    buildAttribute("service.name", cleanText(serviceName) || cleanText(process.env.OTEL_SERVICE_NAME) || "donbeolja"),
    buildAttribute("deployment.environment", cleanText(environment) || cleanText(process.env.OTEL_SERVICE_ENV) || cleanText(process.env.NODE_ENV) || "production"),
  ];
  const gcpProjectId =
    cleanText(process.env.OTEL_GCP_PROJECT_ID) ||
    cleanText(process.env.GOOGLE_CLOUD_PROJECT) ||
    cleanText(process.env.GCLOUD_PROJECT);
  if (gcpProjectId) resourceAttributes.push(buildAttribute("gcp.project_id", gcpProjectId));
  const resolvedVersion = cleanText(serviceVersion) || cleanText(process.env.OTEL_SERVICE_VERSION) || cleanText(process.env.npm_package_version);
  if (resolvedVersion) resourceAttributes.push(buildAttribute("service.version", resolvedVersion));

  const spanAttributes = [];
  const merged = {
    trace_id: normalizedTrace.trace_id || null,
    request_id: normalizedTrace.request_id || null,
    run_id: normalizedTrace.run_id || null,
    exchange: normalizedTrace.exchange || null,
    symbol: normalizedTrace.symbol || null,
    mutation_kind: normalizedTrace.mutation_kind || null,
    source: normalizedTrace.source || null,
    traceparent: normalizedTrace.traceparent || null,
    ...(attributes && typeof attributes === "object" ? attributes : {}),
  };
  for (const [key, value] of Object.entries(merged)) {
    if (!String(key || "").trim()) continue;
    if (value == null || value === "") continue;
    spanAttributes.push(buildAttribute(key, value));
  }

  return {
    resourceSpans: [
      {
        resource: {
          attributes: resourceAttributes,
        },
        scopeSpans: [
          {
            scope: {
              name: "donbeolja.runtime",
              version: resolvedVersion || "unknown",
            },
            spans: [
              {
                traceId: cleanText(normalizedTrace.otel_trace_id),
                spanId: cleanText(normalizedTrace.otel_span_id),
                name: cleanText(spanName) || cleanText(normalizedTrace.span_name) || "donbeolja.runtime",
                kind: 1,
                startTimeUnixNano: toUnixNanos(startTime),
                endTimeUnixNano: toUnixNanos(endTime),
                attributes: spanAttributes,
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };
}

function defaultPostJson({ url, headers = null, body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const payload = JSON.stringify(body || {});
    const req = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname || "/"}${target.search || ""}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        ...(headers && typeof headers === "object" ? headers : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        const status = Number(res.statusCode || 0);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          body: raw || null,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("OTEL_EXPORT_TIMEOUT"));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

let googleAuthClientPromise = null;

async function getGoogleAccessToken() {
  if (!googleAuthClientPromise) {
    googleAuthClientPromise = Promise.resolve().then(async () => {
      const auth = new GoogleAuth({
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
      const client = await auth.getClient();
      return client;
    });
  }
  const client = await googleAuthClientPromise;
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string"
    ? tokenResponse
    : (tokenResponse && tokenResponse.token) || null;
  const cleaned = cleanText(token);
  if (!cleaned) throw new Error("GOOGLE_ACCESS_TOKEN_EMPTY");
  return cleaned;
}

async function buildAuthHeaders({ endpoint = null, headers = null } = {}) {
  const base = {
    ...(headers && typeof headers === "object" ? headers : {}),
  };
  const hasAuth = Object.keys(base).some((key) => String(key || "").toLowerCase() === "authorization");
  if (hasAuth) return base;
  if (shouldUseGoogleAuth(endpoint) !== true) return base;
  return {
    ...base,
    Authorization: `Bearer ${await getGoogleAccessToken()}`,
  };
}

async function exportTraceContext({
  trace = null,
  serviceName = null,
  serviceVersion = null,
  environment = null,
  spanName = null,
  startTime = null,
  endTime = null,
  attributes = null,
  endpoint = null,
  headers = null,
  timeoutMs = null,
  postJson = defaultPostJson,
} = {}) {
  if (isExporterEnabled() !== true) {
    return { ok: true, skipped: true, reason: "OTEL_EXPORTER_DISABLED" };
  }
  const resolvedEndpoint = cleanText(endpoint) || resolveTracesEndpoint();
  if (!resolvedEndpoint) {
    return { ok: true, skipped: true, reason: "OTEL_EXPORTER_ENDPOINT_MISSING" };
  }
  if (!trace || typeof trace !== "object" || !cleanText(trace.otel_trace_id) || !cleanText(trace.otel_span_id)) {
    return { ok: false, skipped: false, reason: "OTEL_TRACE_CONTEXT_INVALID", endpoint: resolvedEndpoint };
  }
  const payload = buildOtlpTracePayload({
    trace,
    serviceName,
    serviceVersion,
    environment,
    spanName,
    startTime,
    endTime,
    attributes,
  });
  try {
    const authHeaders = await buildAuthHeaders({
      endpoint: resolvedEndpoint,
      headers,
    });
    const response = await postJson({
      url: resolvedEndpoint,
      headers: {
        ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
        ...authHeaders,
      },
      body: payload,
      timeoutMs: Number(timeoutMs || process.env.OTEL_EXPORTER_TIMEOUT_MS || 5000),
    });
    return {
      ok: response.ok === true,
      skipped: false,
      endpoint: resolvedEndpoint,
      status: response.status,
      reason: response.ok === true ? "OTEL_EXPORT_OK" : "OTEL_EXPORT_HTTP_ERROR",
      response_body: response.body,
    };
  } catch (err) {
    return {
      ok: false,
      skipped: false,
      endpoint: resolvedEndpoint,
      reason: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = {
  buildOtlpTracePayload,
  exportTraceContext,
  __test: {
    cleanText,
    isExporterEnabled,
    shouldUseGoogleAuth,
    resolveTracesEndpoint,
    parseHeaders,
    toUnixNanos,
    defaultPostJson,
    buildAuthHeaders,
  },
};
