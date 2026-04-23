#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { URLSearchParams } = require("url");

const OUTPUT_FILENAME = "v2_firestore_billing_metric_latest.json";
const METRIC_TYPE = "firestore.googleapis.com/document/read_count";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : Number(fallback);
}

function iso(value) {
  return new Date(value).toISOString();
}

function resolveProjectId(env = process.env) {
  return trimOrNull(env.GOOGLE_CLOUD_PROJECT)
    || trimOrNull(env.GCLOUD_PROJECT)
    || trimOrNull(env.PROJECT_ID)
    || trimOrNull(execFileSync("gcloud", ["config", "get-value", "project"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}

function resolveAccessToken(env = process.env) {
  return trimOrNull(env.GOOGLE_OAUTH_ACCESS_TOKEN)
    || trimOrNull(execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_FIRESTORE_BILLING_METRIC_OUTPUT_FILE)
    || path.resolve("ops", "daily", OUTPUT_FILENAME);
}

function extractPointValue(point = {}) {
  const value = point.value || {};
  const raw = value.int64Value ?? value.doubleValue ?? value.distributionValue;
  const num = Number(raw);
  return Number.isFinite(num) ? num : 0;
}

async function fetchMonitoringTimeSeries({
  projectId,
  token,
  startTime,
  endTime,
  pageSize = 200,
  fetchImpl = fetch,
} = {}) {
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT_REQUIRED");
  if (!token) throw new Error("GOOGLE_ACCESS_TOKEN_REQUIRED");
  if (typeof fetchImpl !== "function") throw new Error("FETCH_IMPL_REQUIRED");
  const params = new URLSearchParams({
    filter: `metric.type="${METRIC_TYPE}"`,
    "interval.startTime": startTime,
    "interval.endTime": endTime,
    pageSize: String(pageSize),
  });
  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response || response.ok !== true) {
    const body = response && typeof response.text === "function" ? await response.text().catch(() => "") : "";
    throw new Error(`MONITORING_TIME_SERIES_FETCH_FAILED:${response && response.status || "NO_STATUS"}:${body.slice(0, 300)}`);
  }
  return response.json();
}

function buildBillingMetricPayload({ data, projectId, startTime, endTime, generatedAt = new Date().toISOString() } = {}) {
  const series = Array.isArray(data && data.timeSeries) ? data.timeSeries : [];
  const rows = [];
  for (const [seriesIndex, item] of series.entries()) {
    const labels = {
      ...((item.resource && item.resource.labels) || {}),
      ...((item.metric && item.metric.labels) || {}),
    };
    const points = Array.isArray(item.points) ? item.points : [];
    const readOps = points.reduce((sum, point) => sum + extractPointValue(point), 0);
    if (!Number.isFinite(readOps)) continue;
    rows.push({
      id: `firestore_read_ops_${seriesIndex + 1}`,
      source: "cloud_monitoring_firestore_read_count",
      metric_type: METRIC_TYPE,
      window_start: startTime,
      window_end: endTime,
      read_ops: readOps,
      point_n: points.length,
      labels,
    });
  }
  return {
    ok: rows.length > 0,
    reason: rows.length > 0 ? "V2_FIRESTORE_BILLING_METRIC_COLLECTED" : "V2_FIRESTORE_BILLING_METRIC_EMPTY",
    generated_at: generatedAt,
    project_id: projectId,
    source: "cloud_monitoring_firestore_read_count",
    metric_type: METRIC_TYPE,
    window_start: startTime,
    window_end: endTime,
    row_n: rows.length,
    read_ops_total: rows.reduce((sum, row) => sum + Number(row.read_ops || 0), 0),
    rows,
  };
}

async function main(env = process.env) {
  const outputFile = path.resolve(resolveOutputFile(env));
  const projectId = resolveProjectId(env);
  const token = resolveAccessToken(env);
  const lookbackMinutes = parsePositiveNumber(env.V2_FIRESTORE_BILLING_METRIC_LOOKBACK_MINUTES, 120);
  const endMs = Date.now();
  const startTime = trimOrNull(env.V2_FIRESTORE_BILLING_METRIC_START_TIME) || iso(endMs - lookbackMinutes * 60 * 1000);
  const endTime = trimOrNull(env.V2_FIRESTORE_BILLING_METRIC_END_TIME) || iso(endMs);
  const data = await fetchMonitoringTimeSeries({
    projectId,
    token,
    startTime,
    endTime,
    pageSize: Math.floor(parsePositiveNumber(env.V2_FIRESTORE_BILLING_METRIC_PAGE_SIZE, 200)),
  });
  const payload = {
    ...buildBillingMetricPayload({ data, projectId, startTime, endTime }),
    output_file: outputFile,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    ok: payload.ok,
    reason: payload.reason,
    row_n: payload.row_n,
    read_ops_total: payload.read_ops_total,
    output_file: outputFile,
  }));
  if (payload.ok !== true && String(env.V2_FIRESTORE_BILLING_METRIC_SOFT || "0").trim() !== "1") {
    process.exit(1);
  }
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_FIRESTORE_BILLING_METRIC_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    METRIC_TYPE,
    fetchMonitoringTimeSeries,
    buildBillingMetricPayload,
    __test: {
      trimOrNull,
      parsePositiveNumber,
      extractPointValue,
      resolveOutputFile,
    },
  };
}
