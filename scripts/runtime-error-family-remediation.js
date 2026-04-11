#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { fetchRuntimeErrorSummary24h, resolveOperationalActiveWindowMs } = require("./lib/runtime-error-counter");

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function classifyRuntimeErrorFamily(item = {}, nowIso = new Date().toISOString()) {
  const family = String(item.family || "").trim().toUpperCase();
  const count = Number(item.count || 0);
  const latestAt = String(item.latest_at || "").trim() || null;
  const latestMs = latestAt ? Date.parse(latestAt) : NaN;
  const activeWindowMs = resolveOperationalActiveWindowMs(item);
  const clearAfterMs = Number.isFinite(latestMs) ? latestMs + Math.max(60 * 1000, Number(activeWindowMs) || (24 * 60 * 60 * 1000)) : NaN;
  const owner = family.startsWith("POSITION_WRITE_")
    ? "writer_authority"
    : (family.includes("LEVERAGE") ? "execution" : (family.includes("EXCEPTION") ? "runtime" : "ops"));
  let severity = "MEDIUM";
  let action = "최근 동일 family 재발 여부를 점검하고 24시간 창에서 자연 감소를 확인";
  if (family === "LIVE_EXCEPTION") {
    severity = "HIGH";
    action = "해당 intent의 cancel_note를 기준으로 provider action(fetch/place)별 재시도/캐시 우회 경로를 우선 수정";
  } else if (family === "LEVERAGE_SET_FAILED") {
    severity = "HIGH";
    action = "exit reduceOnly에서 leverage 설정을 건너뛰고, entry/add만 재시도 정책을 적용";
  } else if (family === "POSITION_WRITE_TOKEN_MISMATCH") {
    severity = "HIGH";
    action = "webhook immediate / fill sync / self-heal 중 stale token 경로를 추적하고 최신 snapshot 재적용 여부를 확인";
  } else if (family === "POSITION_WRITE_LEASE_HELD" || family === "POSITION_WRITE_LEASE_LOST") {
    severity = "HIGH";
    action = "동일 심볼 writer 경합을 줄이고 sync authority 재시도 경로가 정상 동작하는지 확인";
  } else if (family.includes("TIMEOUT") || family.includes("FETCH_FAIL")) {
    severity = "HIGH";
    action = "egress timeout/fetch fail을 retryable infra error로 취급하고 stale cache fallback을 우선 허용";
  } else if (family.includes("KEYS_MISSING")) {
    severity = "CRITICAL";
    action = "운영 키/시크릿 설정 복구 전 신규 진입을 열지 말 것";
  }
  return {
    family,
    count,
    severity,
    owner,
    latest_at: latestAt,
    clear_after_iso: Number.isFinite(clearAfterMs) ? new Date(clearAfterMs).toISOString() : null,
    clear_after_kst: Number.isFinite(clearAfterMs) ? toKstString(new Date(clearAfterMs).toISOString(), { fallbackToString: true }) : null,
    active: Number.isFinite(clearAfterMs) ? clearAfterMs > Date.parse(nowIso) : false,
    symbols: Array.isArray(item.symbols) ? item.symbols : [],
    sources: Array.isArray(item.sources) ? item.sources : [],
    action,
  };
}

function buildMarkdown(payload = {}) {
  const rows = Array.isArray(payload.families) ? payload.families : [];
  const body = rows.length
    ? rows.map((row, idx) => (
      `${idx + 1}. \`${row.family}\` | severity=${row.severity} | owner=${row.owner} | count=${row.count} | clear_after=${row.clear_after_kst || "N/A"}\n` +
      `   - symbols: ${(row.symbols || []).join(", ") || "N/A"}\n` +
      `   - action: ${row.action}`
    )).join("\n")
    : "1. active runtime error family 없음";
  return [
    `# Runtime Error Family Remediation`,
    ``,
    `- generated_at: ${payload.generated_at_kst || "N/A"}`,
    `- ops_status: ${payload.ops_status || "N/A"}`,
    `- ops_mode: ${payload.ops_mode || "N/A"}`,
    `- error_count_24h: ${payload.error_count_24h ?? "N/A"}`,
    `- error_occurrence_count_24h: ${payload.error_occurrence_count_24h ?? "N/A"}`,
    ``,
    `## Active Families`,
    body,
    ``,
  ].join("\n");
}

async function runRuntimeErrorFamilyRemediationJob({
  repoRoot = path.resolve(__dirname, ".."),
  runtimeSummary = null,
  nowIso = new Date().toISOString(),
} = {}) {
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const summary = runtimeSummary || await fetchRuntimeErrorSummary24h({});
  const opsPath = path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");
  const ops = readJsonSafe(opsPath) || {};
  const families = (Array.isArray(summary && summary.error_families_24h) ? summary.error_families_24h : [])
    .map((item) => classifyRuntimeErrorFamily(item, nowIso));
  const payload = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    ops_status: ops.status || null,
    ops_mode: ops.mode || null,
    error_count_24h: Number.isFinite(Number(summary && summary.error_count_24h)) ? Number(summary.error_count_24h) : null,
    error_occurrence_count_24h: Number.isFinite(Number(summary && summary.error_occurrence_count_24h)) ? Number(summary.error_occurrence_count_24h) : null,
    families,
  };

  const latestJson = path.join(repoRoot, "ops", "daily", "runtime_error_family_remediation_latest.json");
  const datedJson = path.join(repoRoot, "ops", "daily", `${dateKey}_runtime_error_family_remediation.json`);
  const latestMd = path.join(repoRoot, "ops", "daily", "runtime_error_family_remediation_latest.md");
  const datedMd = path.join(repoRoot, "ops", "daily", `${dateKey}_runtime_error_family_remediation.md`);
  const md = buildMarkdown(payload);
  fs.writeFileSync(latestJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${md}\n`, "utf8");
  fs.writeFileSync(datedMd, `${md}\n`, "utf8");

  return {
    ok: true,
    generated_at_iso: nowIso,
    error_count_24h: payload.error_count_24h,
    error_occurrence_count_24h: payload.error_occurrence_count_24h,
    family_count: families.length,
    output_json: latestJson,
    output_md: latestMd,
  };
}

if (require.main === module) {
  runRuntimeErrorFamilyRemediationJob().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((err) => {
    console.error("RUNTIME_ERROR_FAMILY_REMEDIATION_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  runRuntimeErrorFamilyRemediationJob,
  __test: {
    classifyRuntimeErrorFamily,
    buildMarkdown,
  },
};
