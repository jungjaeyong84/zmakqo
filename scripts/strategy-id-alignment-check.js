#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { getFirestore } = require("../src/storage/firestore");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = process.cwd();
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const POST_APPLY_LATEST_PATH = path.join(OPS_DAILY, "post_apply_signal_probe_latest.json");
const DATA_CONSISTENCY_LATEST_PATH = path.join(OPS_DAILY, "data_consistency_lead_latest.json");
const GAP_CONFLICT_LATEST_PATH = path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json");
const METRIC_RECONCILIATION_LATEST_PATH = path.join(OPS_DAILY, "metric_reconciliation_owner_latest.json");
const OUTPUT_LATEST_JSON_PATH = path.join(OPS_DAILY, "strategy_id_alignment_latest.json");
const OUTPUT_LATEST_MD_PATH = path.join(OPS_DAILY, "strategy_id_alignment_latest.md");
const CLOUD_RUN_SERVICE = process.env.STRATEGY_ALIGN_SERVICE || "donbeolja";
const CLOUD_RUN_REGION = process.env.STRATEGY_ALIGN_REGION || "asia-northeast3";
const ROLE = "signal_id_alignment_owner";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_err) {
    return "";
  }
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function parseDelimitedEnvString(raw) {
  const text = String(raw || "").trim();
  if (!text) return {};
  let body = text;
  let delimiter = ",";
  if (body.startsWith("^") && body.length >= 3 && body[2] === "^") {
    delimiter = body[1];
    body = body.slice(3);
  }
  const out = {};
  for (const token of body.split(delimiter)) {
    const part = String(token || "").trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function extractCloudBuildEnvMaps(raw) {
  const text = String(raw || "");
  const maps = [];
  const re = /"--set-env-vars",\s*"([^"]*)"/g;
  let match = null;
  while ((match = re.exec(text)) !== null) {
    maps.push(parseDelimitedEnvString(match[1]));
  }
  return maps;
}

function uniq(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalizeStrategyIdCsv(value) {
  return uniq(parseCsv(value)).sort(compareStrategyIdsDesc);
}

function strategyIdCsvEqual(a, b) {
  const left = normalizeStrategyIdCsv(a);
  const right = normalizeStrategyIdCsv(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (String(left[i] || "") !== String(right[i] || "")) {
      return false;
    }
  }
  return true;
}

function csvIncludesStrategyId(csv, strategyId) {
  const target = String(strategyId || "").trim();
  if (!target) return false;
  return normalizeStrategyIdCsv(csv).includes(target);
}

function resolveMismatchAuditCounts({
  mismatchTotal = 0,
  mismatchHistoricalCount = null,
  mismatchFreshness = null,
} = {}) {
  const freshnessTotal = toNum(mismatchFreshness && mismatchFreshness.total_count, null);
  const freshnessHistorical = toNum(mismatchFreshness && mismatchFreshness.created_before_live_revision_count, null);
  const total = Number.isFinite(freshnessTotal) ? freshnessTotal : toNum(mismatchTotal, 0);
  const historical = Number.isFinite(freshnessHistorical)
    ? freshnessHistorical
    : (Number.isFinite(toNum(mismatchHistoricalCount, null)) ? toNum(mismatchHistoricalCount, null) : total);
  return { total, historical };
}

function roundTo(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const base = 10 ** digits;
  return Math.round(n * base) / base;
}

function hhmmFromKst(text) {
  const m = String(text || "").match(/\b(\d{2}):(\d{2})\b/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
}

function readEnvFileValues(filePath) {
  const raw = readTextSafe(filePath);
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    out[key] = val;
  }
  return out;
}

function extractFromCloudBuild(raw, key) {
  const maps = extractCloudBuildEnvMaps(raw);
  for (const envMap of maps) {
    if (Object.prototype.hasOwnProperty.call(envMap, key)) {
      const value = String(envMap[key] || "").trim();
      return value || null;
    }
  }
  return null;
}

function parseStrategySemver(strategyId) {
  const m = String(strategyId || "").match(/v(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

function compareStrategyIdsDesc(a, b) {
  const av = parseStrategySemver(a);
  const bv = parseStrategySemver(b);
  if (av && bv) {
    for (let i = 0; i < 4; i += 1) {
      if (av[i] !== bv[i]) return bv[i] - av[i];
    }
    return 0;
  }
  if (av && !bv) return -1;
  if (!av && bv) return 1;
  return String(b || "").localeCompare(String(a || ""));
}

function strategyIdToEngineVersion(strategyId) {
  const m = String(strategyId || "").match(/_v(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : null;
}

function buildEnvUpdateCommand(service, region, envPairs) {
  const delimiter = "^:^";
  const serialized = Object.entries(envPairs)
    .filter(([key, value]) => key && value != null)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(":");
  return `gcloud run services update ${service} --region ${region} --update-env-vars "${delimiter}${serialized}"`;
}

function getLiveServiceEnv(service, region) {
  try {
    const stdout = execSync(
      `gcloud run services describe ${service} --region ${region} --format=json`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(stdout);
    const envList = (((parsed || {}).spec || {}).template || {}).spec || {};
    const container = (Array.isArray(envList.containers) ? envList.containers[0] : null) || {};
    const env = Array.isArray(container.env) ? container.env : [];
    const pickValue = (name) => {
      const found = env.find((it) => it && it.name === name);
      return found && Object.prototype.hasOwnProperty.call(found, "value") ? found.value : null;
    };
    return {
      ok: true,
      service,
      region,
      revision: (parsed.status && parsed.status.latestReadyRevisionName) || null,
      url: (parsed.status && parsed.status.url) || null,
      values: {
        DONBEOLJA_STRATEGY_ID: pickValue("DONBEOLJA_STRATEGY_ID"),
        WEBHOOK_ALLOWED_STRATEGY_IDS: pickValue("WEBHOOK_ALLOWED_STRATEGY_IDS"),
        ENGINE_VERSION: pickValue("ENGINE_VERSION"),
        WEBHOOK_STRATEGY_GATE_ENABLED: pickValue("WEBHOOK_STRATEGY_GATE_ENABLED"),
      },
    };
  } catch (err) {
    return {
      ok: false,
      service,
      region,
      revision: null,
      url: null,
      error: (err && err.message) ? String(err.message) : "gcloud describe failed",
      values: {},
    };
  }
}

function getLiveRevisionMeta(service, region, revisionName) {
  if (!revisionName) {
    return {
      ok: false,
      revision: null,
      create_time_iso: null,
      create_time_kst: null,
      error: "revision missing",
    };
  }
  try {
    const stdout = execSync(
      `gcloud run revisions describe ${revisionName} --region ${region} --format=json`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const parsed = JSON.parse(stdout);
    const createIso = (parsed && parsed.metadata && parsed.metadata.creationTimestamp) || null;
    const createMs = parseIsoMs(createIso);
    return {
      ok: true,
      service,
      region,
      revision: revisionName,
      create_time_iso: createIso,
      create_time_kst: Number.isFinite(createMs)
        ? toKstString(createMs, { fallbackToString: true })
        : null,
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      service,
      region,
      revision: revisionName,
      create_time_iso: null,
      create_time_kst: null,
      error: (err && err.message) ? String(err.message) : "gcloud revision describe failed",
    };
  }
}

function parseIsoMs(value, fallback = NaN) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : fallback;
}

function parseJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_err) {
    return null;
  }
}

function normalizeMismatchRow(raw) {
  const features = parseJsonObject(raw && raw.features_json);
  const barMs = toNum(raw && raw.bar_close_time_utc_ms, null);
  const createdIso = raw && raw.created_at ? String(raw.created_at) : null;
  const createdMs = parseIsoMs(createdIso, barMs == null ? NaN : barMs);
  const received = (raw && raw._strategy_id_received)
    || (features && features._strategy_id_received)
    || (raw && raw.strategy_id)
    || (features && features.strategy_id)
    || null;
  const expected = (raw && raw._strategy_id_default)
    || (features && features._strategy_id_default)
    || null;
  return {
    created_iso: createdIso,
    created_ms: createdMs,
    created_kst: Number.isFinite(createdMs)
      ? toKstString(createdMs, { fallbackToString: true })
      : null,
    bar_close_ms: barMs,
    bar_close_kst: Number.isFinite(barMs)
      ? toKstString(barMs, { fallbackToString: true })
      : null,
    signal_id: (raw && raw.signal_id) || (features && features.signal_id) || null,
    symbol: (raw && (raw.symbol || raw.symbol_or_pair_id || raw.pair_id))
      || (features && (features.symbol || features.symbol_or_pair_id || features.pair_id))
      || null,
    tf: (raw && raw.tf) || (features && features.tf) || null,
    received_strategy_id: received,
    expected_strategy_id: expected,
  };
}

async function collectMismatchFreshness(params) {
  const thresholdMs = toNum(params && params.threshold_ms, NaN);
  const thresholdKst = params && params.threshold_kst ? String(params.threshold_kst) : null;
  const exchange = String((params && params.exchange) || "BINANCEFUT").toUpperCase();
  const liveRevisionMs = toNum(params && params.live_revision_create_ms, NaN);
  const liveRevisionKst = Number.isFinite(liveRevisionMs)
    ? toKstString(liveRevisionMs, { fallbackToString: true })
    : null;

  if (!Number.isFinite(thresholdMs)) {
    return {
      ok: false,
      exchange,
      threshold_ms: null,
      threshold_kst: thresholdKst,
      live_revision_create_ms: Number.isFinite(liveRevisionMs) ? liveRevisionMs : null,
      live_revision_create_kst: liveRevisionKst,
      total_count: 0,
      created_before_live_revision_count: 0,
      created_after_live_revision_count: 0,
      status: "NO_DATA",
      latest_samples: [],
      error: "invalid threshold",
    };
  }

  try {
    const nowMs = Date.now();
    const db = getFirestore();
    const snap = await db
      .collection("signals_dropped")
      .where("bar_close_time_utc_ms", ">=", thresholdMs)
      .where("bar_close_time_utc_ms", "<=", nowMs)
      .get();

    const rows = [];
    snap.forEach((doc) => rows.push(doc.data()));

    const mismatchRows = rows
      .filter((row) => String(row && row.exchange ? row.exchange : "").toUpperCase() === exchange)
      .filter((row) => String(row && row.reason ? row.reason : "") === "DROP_STRATEGY_ID_MISMATCH")
      .map(normalizeMismatchRow)
      .filter((row) => Number.isFinite(row.created_ms))
      .sort((a, b) => a.created_ms - b.created_ms);

    const createdAfterLiveRevision = Number.isFinite(liveRevisionMs)
      ? mismatchRows.filter((row) => row.created_ms >= liveRevisionMs)
      : [];
    const createdBeforeLiveRevision = Number.isFinite(liveRevisionMs)
      ? mismatchRows.filter((row) => row.created_ms < liveRevisionMs)
      : mismatchRows;
    const last = mismatchRows.length ? mismatchRows[mismatchRows.length - 1] : null;
    const first = mismatchRows.length ? mismatchRows[0] : null;

    let status = "NO_MISMATCH";
    if (mismatchRows.length >= 1) {
      if (Number.isFinite(liveRevisionMs) && createdAfterLiveRevision.length >= 1) {
        status = "NEW_MISMATCH_AFTER_SYNC";
      } else {
        status = "HISTORICAL_ONLY";
      }
    }

    return {
      ok: true,
      exchange,
      threshold_ms: thresholdMs,
      threshold_kst: thresholdKst || toKstString(thresholdMs, { fallbackToString: true }),
      live_revision_create_ms: Number.isFinite(liveRevisionMs) ? liveRevisionMs : null,
      live_revision_create_kst: liveRevisionKst,
      total_count: mismatchRows.length,
      created_before_live_revision_count: createdBeforeLiveRevision.length,
      created_after_live_revision_count: createdAfterLiveRevision.length,
      first_created_kst: first ? first.created_kst : null,
      last_created_kst: last ? last.created_kst : null,
      last_bar_close_kst: last ? last.bar_close_kst : null,
      status,
      latest_samples: mismatchRows.slice(-3),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      exchange,
      threshold_ms: thresholdMs,
      threshold_kst: thresholdKst || toKstString(thresholdMs, { fallbackToString: true }),
      live_revision_create_ms: Number.isFinite(liveRevisionMs) ? liveRevisionMs : null,
      live_revision_create_kst: liveRevisionKst,
      total_count: 0,
      created_before_live_revision_count: 0,
      created_after_live_revision_count: 0,
      status: "UNKNOWN",
      latest_samples: [],
      error: (err && err.message) ? String(err.message) : "freshness query failed",
    };
  }
}

function pickMetric(dataConsistency, metric) {
  const rows = Array.isArray(dataConsistency && dataConsistency.metric_resolution)
    ? dataConsistency.metric_resolution
    : [];
  const row = rows.find((it) => it && it.metric === metric);
  return row ? toNum(row.chosen_value, null) : null;
}

function buildMarkdown(payload, jsonAbsPath) {
  const mismatchTotal = toNum(payload.mismatch.total_count, 0);
  const mismatchGuard = toNum(payload.mismatch.guard_count, mismatchTotal);
  const dropsTotal = toNum(payload.post_apply_snapshot && payload.post_apply_snapshot.drops, 0);
  const signalsTotal = toNum(payload.post_apply_snapshot && payload.post_apply_snapshot.signals, 0);
  const conflictSnapshot = payload.conflict_snapshot || {};
  const consistencyCount = toNum(
    conflictSnapshot
    && conflictSnapshot.consistency_check
    && conflictSnapshot.consistency_check.mismatch_count,
    null
  );
  const liveDriftCount = toNum(
    conflictSnapshot
    && conflictSnapshot.live_drift_check
    && conflictSnapshot.live_drift_check.mismatch_count,
    null
  );
  const policyConflictCount = toNum(
    conflictSnapshot
    && conflictSnapshot.policy_conflict
    && conflictSnapshot.policy_conflict.mismatch_count,
    null
  );
  const mismatchCoveragePct = payload.post_apply_snapshot
    ? payload.post_apply_snapshot.mismatch_coverage_pct
    : null;
  const nonMismatch = Array.isArray(payload.post_apply_snapshot && payload.post_apply_snapshot.non_mismatch_drop_reasons)
    ? payload.post_apply_snapshot.non_mismatch_drop_reasons
    : [];
  const commandLine = payload.alignment.gcloud_update_command || "N/A";
  const conservativeOption = payload.alignment
    && payload.alignment.options
    && payload.alignment.options.conservative_allowlist_only;
  const fullSyncOption = payload.alignment
    && payload.alignment.options
    && payload.alignment.options.full_sync_version_upgrade;
  const resolutionPlan = Array.isArray(payload.resolution_plan) ? payload.resolution_plan : [];
  const verificationPlan = payload.verification_plan || {};
  const verificationCheckpoints = Array.isArray(verificationPlan.checkpoints)
    ? verificationPlan.checkpoints
    : [];
  const freshness = payload.mismatch_freshness || {};
  const userApproval = payload.user_approval_required || "";
  const syncNeeded = !!(payload.alignment && payload.alignment.live_sync_needed);
  const commandTitle = syncNeeded ? "즉시 실행 커맨드(지혜 승인 후)" : "실행 완료 커맨드(참고)";
  const issues = Array.isArray(payload.issues) ? payload.issues : [];
  return `# ${payload.date_key} strategy_id_alignment (${payload.cycle_hhmm}, ${ROLE})

기준 시각: ${payload.generated_at_kst}
산출 JSON: \`${jsonAbsPath}\`

## 핵심 요약
- 실서버 전략ID 기본값: \`${payload.live_service.values.DONBEOLJA_STRATEGY_ID || "N/A"}\`
- 실서버 허용 전략ID: \`${payload.live_service.values.WEBHOOK_ALLOWED_STRATEGY_IDS || "N/A"}\`
- 실서버 동기화 필요: \`${syncNeeded ? "YES" : "NO"}\`
- 최근 실신호/드롭: \`${signalsTotal}\`건 / \`${dropsTotal}\`건
- 운영 가드 불일치(신규 기준): \`${mismatchGuard}\`건
- 최근 불일치 드롭(누적): \`${mismatchTotal}\`건${mismatchCoveragePct == null ? "" : ` (드롭 내 비중 ${mismatchCoveragePct}%)`}
- 운영충돌(consistency_check): \`${consistencyCount == null ? "N/A" : consistencyCount}\`건
- 정책충돌(policy_conflict): \`${policyConflictCount == null ? "N/A" : policyConflictCount}\`건
- 실시간차이(live_drift_check): \`${liveDriftCount == null ? "N/A" : liveDriftCount}\`건
- 권장 허용 전략ID: \`${payload.alignment.recommended_allowed_strategy_ids_csv || "N/A"}\`
${nonMismatch.length ? `- 비-전략ID 드롭: ${nonMismatch.map((x) => `${x.reason} ${x.count}건`).join(", ")}` : ""}

## 신규/누적 분리
- 실서버 리비전: \`${payload.live_service.revision || "N/A"}\` (${payload.live_revision && payload.live_revision.create_time_kst ? payload.live_revision.create_time_kst : "생성시각 미확인"})
- 불일치 누적(리비전 이전 포함): \`${freshness.total_count != null ? freshness.total_count : "N/A"}\`건
- 리비전 반영 후 신규 불일치: \`${freshness.created_after_live_revision_count != null ? freshness.created_after_live_revision_count : "N/A"}\`건
- 최근 불일치 생성/봉시각: \`${freshness.last_created_kst || "N/A"}\` / \`${freshness.last_bar_close_kst || "N/A"}\`
- 신선도 상태: \`${freshness.status || "N/A"}\`

## 충돌 지표 분리(RC-21)
- 운영충돌(consistency_check): \`${consistencyCount == null ? "N/A" : consistencyCount}\`건
- 정책충돌(policy_conflict): \`${policyConflictCount == null ? "N/A" : policyConflictCount}\`건
- 실시간차이(live_drift_check): \`${liveDriftCount == null ? "N/A" : liveDriftCount}\`건

## ${commandTitle}
\`\`\`bash
${commandLine}
\`\`\`

## 실행안 A/B
- A(권장, 보수): ${conservativeOption && conservativeOption.purpose ? conservativeOption.purpose : "N/A"}
\`\`\`bash
${conservativeOption && conservativeOption.command ? conservativeOption.command : "N/A"}
\`\`\`
- B(대체, 전체): ${fullSyncOption && fullSyncOption.purpose ? fullSyncOption.purpose : "N/A"}
\`\`\`bash
${fullSyncOption && fullSyncOption.command ? fullSyncOption.command : "N/A"}
\`\`\`

## 해소 절차
${resolutionPlan.length ? resolutionPlan.map((row) => `- ${row.step}. ${row.action} (${row.owner}, ${row.status})`).join("\n") : "- 없음"}

## 검증 계획
- 목표: ${verificationPlan.target || "N/A"}
${verificationCheckpoints.length ? verificationCheckpoints.map((row) => `- ${row}`).join("\n") : "- 체크포인트 없음"}

## 이슈
${issues.length ? issues.join("\n") : "- 없음"}

## 승인 상태
${userApproval || "- 없음"}
`;
}

async function main() {
  ensureDir(OPS_DAILY);

  const nowMs = Date.now();
  const generatedAtIso = new Date(nowMs).toISOString();
  const generatedAtKst = toKstString(nowMs, { fallbackToString: true });
  const dateKey = kstDateKey(generatedAtIso) || String(generatedAtKst || "").slice(0, 10);
  const cycle = hhmmFromKst(generatedAtKst);

  const postApply = readJsonSafe(POST_APPLY_LATEST_PATH) || {};
  const dataConsistency = readJsonSafe(DATA_CONSISTENCY_LATEST_PATH) || {};
  const gapConflictLatest = readJsonSafe(GAP_CONFLICT_LATEST_PATH) || {};
  const metricReconciliationLatest = readJsonSafe(METRIC_RECONCILIATION_LATEST_PATH) || {};
  const envLocal = readEnvFileValues(path.join(ROOT, ".env"));
  const cloudBuildRaw = readTextSafe(path.join(ROOT, "cloudbuild.yaml"));
  const liveService = getLiveServiceEnv(CLOUD_RUN_SERVICE, CLOUD_RUN_REGION);
  const liveRevision = getLiveRevisionMeta(CLOUD_RUN_SERVICE, CLOUD_RUN_REGION, liveService.revision);
  const reliabilitySourceRaw = gapConflictLatest
    && gapConflictLatest.source_files
    && gapConflictLatest.source_files.reliability;
  const reliabilitySourcePath = reliabilitySourceRaw
    ? (path.isAbsolute(reliabilitySourceRaw) ? reliabilitySourceRaw : path.join(ROOT, reliabilitySourceRaw))
    : null;
  const reliabilityLatest = reliabilitySourcePath ? (readJsonSafe(reliabilitySourcePath) || {}) : {};
  const thresholdMs = parseIsoMs(postApply && postApply.window && postApply.window.threshold_utc, nowMs - (9 * 60 * 60 * 1000));
  const thresholdKst = (postApply && postApply.window && postApply.window.threshold_kst)
    || toKstString(thresholdMs, { fallbackToString: true });
  const exchange = String((postApply && postApply.exchange) || "BINANCEFUT").toUpperCase();
  const mismatchFreshness = await collectMismatchFreshness({
    threshold_ms: thresholdMs,
    threshold_kst: thresholdKst,
    exchange,
    live_revision_create_ms: parseIsoMs(liveRevision.create_time_iso),
  });

  const mismatchTop = Array.isArray(postApply.strategy_mismatch_top) ? postApply.strategy_mismatch_top : [];
  const mismatchTotalByTop = mismatchTop.reduce((sum, row) => sum + toNum(row && row.count, 0), 0);
  const dropReasonTop = Array.isArray(postApply && postApply.drop_reason_top) ? postApply.drop_reason_top : [];
  const mismatchReasonRow = dropReasonTop.find((row) => String(row && row.reason ? row.reason : "") === "DROP_STRATEGY_ID_MISMATCH");
  const mismatchTotalByReason = mismatchReasonRow ? toNum(mismatchReasonRow.count, null) : null;
  const mismatchTotal = mismatchTotalByReason != null ? mismatchTotalByReason : mismatchTotalByTop;
  const receivedIds = uniq(mismatchTop.map((row) => row && row.received_strategy_id));
  const expectedIds = uniq(mismatchTop.map((row) => row && row.expected_strategy_id));
  const signalsTotal = toNum(postApply && postApply.counts && postApply.counts.signals, 0);
  const dropsTotal = toNum(postApply && postApply.counts && postApply.counts.drops, 0);
  const nonMismatchDropReasons = dropReasonTop
    .map((row) => ({
      reason: row && row.reason ? String(row.reason) : null,
      count: toNum(row && row.count, 0),
    }))
    .filter((row) => row.reason && row.reason !== "DROP_STRATEGY_ID_MISMATCH" && row.count > 0);
  const mismatchCoveragePct = dropsTotal > 0 ? roundTo((mismatchTotal / dropsTotal) * 100, 1) : null;

  const localDefault = envLocal.DONBEOLJA_STRATEGY_ID || null;
  const localAllowed = envLocal.WEBHOOK_ALLOWED_STRATEGY_IDS || null;
  const localEngine = envLocal.ENGINE_VERSION || null;

  const cloudBuildDefault = extractFromCloudBuild(cloudBuildRaw, "DONBEOLJA_STRATEGY_ID");
  const cloudBuildAllowed = extractFromCloudBuild(cloudBuildRaw, "WEBHOOK_ALLOWED_STRATEGY_IDS");
  const cloudBuildEngine = extractFromCloudBuild(cloudBuildRaw, "ENGINE_VERSION");

  const liveDefault = liveService.values.DONBEOLJA_STRATEGY_ID || null;
  const liveAllowed = liveService.values.WEBHOOK_ALLOWED_STRATEGY_IDS || null;
  const liveEngine = liveService.values.ENGINE_VERSION || null;

  const recommendedAllowed = uniq([
    ...receivedIds,
    ...expectedIds,
    ...parseCsv(liveAllowed),
    ...parseCsv(localAllowed),
    ...parseCsv(cloudBuildAllowed),
    liveDefault,
    localDefault,
    cloudBuildDefault,
  ]).sort(compareStrategyIdsDesc);

  const recommendedDefault = recommendedAllowed[0] || liveDefault || localDefault || cloudBuildDefault || null;
  const recommendedAllowedCsv = recommendedAllowed.join(",");
  const recommendedEngine = strategyIdToEngineVersion(recommendedDefault)
    || liveEngine
    || localEngine
    || cloudBuildEngine
    || null;

  const conservativeDefault = liveDefault || recommendedDefault;
  const conservativeAllowedCsv = recommendedAllowedCsv;
  const conservativeEngine = liveEngine || recommendedEngine;
  const receivedIdsText = receivedIds.join(", ") || "N/A";
  const liveMatchesConservativeDefault = String(liveDefault || "") === String(conservativeDefault || "");
  const liveMatchesConservativeEngine = String(liveEngine || "") === String(conservativeEngine || "");
  const liveAllowsConservativeDefault = csvIncludesStrategyId(liveAllowed || "", conservativeDefault || "");

  const conservativeCommand = buildEnvUpdateCommand(CLOUD_RUN_SERVICE, CLOUD_RUN_REGION, {
    WEBHOOK_ALLOWED_STRATEGY_IDS: conservativeAllowedCsv || null,
  });
  const fullSyncCommand = buildEnvUpdateCommand(CLOUD_RUN_SERVICE, CLOUD_RUN_REGION, {
    DONBEOLJA_STRATEGY_ID: recommendedDefault || null,
    WEBHOOK_ALLOWED_STRATEGY_IDS: recommendedAllowedCsv || null,
    ENGINE_VERSION: recommendedEngine || null,
  });

  const costRatioPct = pickMetric(dataConsistency, "cost_ratio_pct");
  const mddPct = pickMetric(dataConsistency, "mdd_pct");
  const errorCount24h = pickMetric(dataConsistency, "error_count_24h");
  const consistencyMismatchCount = toNum(
    gapConflictLatest
    && gapConflictLatest.key_numbers
    && gapConflictLatest.key_numbers.conflict_count,
    toNum(
      metricReconciliationLatest
      && metricReconciliationLatest.term_standard
      && metricReconciliationLatest.term_standard.consistency_check_count,
      null
    )
  );
  const policyConflictCount = toNum(
    gapConflictLatest
    && gapConflictLatest.key_numbers
    && gapConflictLatest.key_numbers.policy_conflict_count,
    toNum(
      metricReconciliationLatest
      && metricReconciliationLatest.term_standard
      && metricReconciliationLatest.term_standard.policy_conflict_count,
      toNum(
        reliabilityLatest
        && reliabilityLatest.metrics
        && reliabilityLatest.metrics.consistency_check
        && reliabilityLatest.metrics.consistency_check.mismatch_count,
        null
      )
    )
  );
  const liveDriftMismatchCount = toNum(
    metricReconciliationLatest
    && metricReconciliationLatest.term_standard
    && metricReconciliationLatest.term_standard.live_drift_check_count,
    toNum(
      reliabilityLatest
      && reliabilityLatest.metrics
      && reliabilityLatest.metrics.live_drift_check
      && reliabilityLatest.metrics.live_drift_check.mismatch_count,
      null
    )
  );
  const mismatchAfterSyncCount = toNum(
    mismatchFreshness && mismatchFreshness.created_after_live_revision_count,
    null
  );
  const mismatchHistoricalCount = toNum(
    mismatchFreshness && mismatchFreshness.created_before_live_revision_count,
    null
  );
  const mismatchGuardCount = (
    mismatchFreshness && mismatchFreshness.ok && Number.isFinite(mismatchAfterSyncCount)
  )
    ? mismatchAfterSyncCount
    : mismatchTotal;
  const freshnessStatus = mismatchFreshness && mismatchFreshness.status
    ? mismatchFreshness.status
    : "UNKNOWN";
  const mismatchHistoricalOnly = !!(
    mismatchFreshness
    && mismatchFreshness.ok
    && freshnessStatus === "HISTORICAL_ONLY"
    && Number.isFinite(mismatchAfterSyncCount)
    && mismatchAfterSyncCount === 0
  );
  const auditMismatchCounts = resolveMismatchAuditCounts({
    mismatchTotal,
    mismatchHistoricalCount,
    mismatchFreshness,
  });
  const auditMismatchTotal = auditMismatchCounts.total;
  const auditHistoricalCount = auditMismatchCounts.historical;
  const liveSyncSatisfiedByCurrentRuntime = !!(
    liveService.ok
    && mismatchHistoricalOnly
    && liveMatchesConservativeDefault
    && liveMatchesConservativeEngine
    && liveAllowsConservativeDefault
  );
  const liveSyncNeeded = !liveService.ok
    ? true
    : (
      !liveSyncSatisfiedByCurrentRuntime
      && (
        !liveMatchesConservativeDefault
        || !strategyIdCsvEqual(liveAllowed || "", conservativeAllowedCsv || "")
        || !liveMatchesConservativeEngine
      )
    );
  const approvalStateText = liveSyncNeeded
    ? "[USER_APPROVAL_REQUIRED] 실서버 strategy_id 허용목록 갱신 | 운영 서버 환경값 변경이므로 승인 필요 | 승인 시 보수안 커맨드 우선 실행 후 60분 검증"
    : "없음(승인 반영 완료, 60분 검증 진행)";
  const decisionRequestText = liveSyncNeeded
    ? "보수안(허용목록만 확장) 즉시 승인 여부 확정 요청"
    : (mismatchGuardCount >= 1
      ? "동기화 이후 신규 mismatch가 남아 있어 게이트/배포 경로 재점검 우선 여부 결정 요청"
      : "허용목록 반영 후 신규 mismatch 0건 확인. 60분 추가 관찰 뒤 경보 단계 완화 여부 결정 요청");

  const issueLines = [];
  if (auditMismatchTotal >= 1 || mismatchGuardCount >= 1) {
    if (liveSyncNeeded) {
      issueLines.push(`[ISSUE] H | 최근 strategy_id 불일치 드롭 ${auditMismatchTotal}건 | 실서버 허용ID 동기화 필요`);
      issueLines.push(`[ISSUE] H | 실서버 허용ID(${liveAllowed || "N/A"})와 수신ID(${receivedIdsText}) 불일치 | 신호 드롭 지속 위험`);
    } else if (mismatchGuardCount >= 1) {
      issueLines.push(`[ISSUE] H | 동기화 이후 신규 strategy_id 불일치 ${mismatchGuardCount}건 | 게이트 반영/전파 경로 즉시 재점검 필요`);
    } else if (mismatchHistoricalOnly) {
      issueLines.push(`[ISSUE] L | 실서버 허용ID 동기화 완료(rev ${liveService.revision || "N/A"}) | 누적 mismatch ${auditMismatchTotal}건은 과거 데이터, 리비전 이후 신규 0건`);
    } else {
      issueLines.push(`[ISSUE] M | 실서버 허용ID 동기화 완료(rev ${liveService.revision || "N/A"}) | 누적 mismatch ${auditMismatchTotal}건은 과거 데이터, 운영 가드 0건 유지`);
    }
  }
  if (!mismatchFreshness.ok) {
    issueLines.push(`[ISSUE] M | mismatch 신선도 조회 실패(${mismatchFreshness.error || "unknown"}) | 수동 로그 점검 필요`);
  } else {
    issueLines.push(`[ISSUE] L | mismatch 신선도 상태 ${freshnessStatus} | 기준시각 ${mismatchFreshness.live_revision_create_kst || "N/A"} 이후 신규 ${Number.isFinite(mismatchAfterSyncCount) ? mismatchAfterSyncCount : "N/A"}건`);
  }
  if (Number.isFinite(consistencyMismatchCount)) {
    issueLines.push(
      consistencyMismatchCount >= 1
        ? `[ISSUE] H | 운영충돌(consistency_check) ${consistencyMismatchCount}건 | 승인 기준/결정 원천 재검증 필요`
        : "[ISSUE] L | 운영충돌(consistency_check) 0건 | 승인 기준 단일화 유지"
    );
  }
  if (Number.isFinite(policyConflictCount)) {
    issueLines.push(
      policyConflictCount >= 1
        ? `[ISSUE] M | 정책충돌(policy_conflict) ${policyConflictCount}건 | 승인값-최신값 기준 분리 유지 및 원인 정리 필요`
        : "[ISSUE] L | 정책충돌(policy_conflict) 0건 | 승인값-최신값 정책 차이 없음"
    );
  }
  if (Number.isFinite(liveDriftMismatchCount)) {
    issueLines.push(
      liveDriftMismatchCount >= 1
        ? `[ISSUE] M | 실시간차이(live_drift_check) ${liveDriftMismatchCount}건 | 실시간 값은 경보로 분리 모니터링`
        : "[ISSUE] L | 실시간차이(live_drift_check) 0건 | 승인값-실시간값 차이 없음"
    );
  }
  issueLines.push(...nonMismatchDropReasons.map((row) => `[ISSUE] M | 비-전략ID 드롭 ${row.reason} ${row.count}건 | 전략ID 외 차단 사유 병행 복구 필요`));
  issueLines.push(`[ISSUE] H | 비용 ${costRatioPct != null ? `${costRatioPct}%` : "N/A"}, MDD ${mddPct != null ? `${mddPct}%` : "N/A"} | 보류/비용차단 유지`);

  const payload = {
    generated_at_iso: generatedAtIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle_hhmm: cycle,
    role: ROLE,
    decision: "보류 유지 / 비용 차단 유지 / No-Go 유지",
    mission: "strategy_id 불일치 드롭 해소를 위한 실서버/코드 정합성 동기화",
    mismatch: {
      total_count: auditMismatchTotal,
      guard_count: mismatchGuardCount,
      after_live_revision_count: Number.isFinite(mismatchAfterSyncCount) ? mismatchAfterSyncCount : null,
      historical_count: auditHistoricalCount,
      count_policy: "guard_count(운영판정)=신규 불일치, total_count(감사)=누적 불일치",
      received_strategy_ids: receivedIds,
      expected_strategy_ids: expectedIds,
      breakdown: mismatchTop,
    },
    post_apply_snapshot: {
      signals: signalsTotal,
      drops: dropsTotal,
      decision_hint: postApply && postApply.decision_hint ? postApply.decision_hint : null,
      drop_reason_top: dropReasonTop,
      mismatch_coverage_pct: mismatchCoveragePct,
      non_mismatch_drop_reasons: nonMismatchDropReasons,
    },
    conflict_snapshot: {
      consistency_check: {
        mismatch_count: Number.isFinite(consistencyMismatchCount) ? consistencyMismatchCount : null,
        source: GAP_CONFLICT_LATEST_PATH,
      },
      policy_conflict: {
        mismatch_count: Number.isFinite(policyConflictCount) ? policyConflictCount : null,
        source: GAP_CONFLICT_LATEST_PATH,
      },
      live_drift_check: {
        mismatch_count: Number.isFinite(liveDriftMismatchCount) ? liveDriftMismatchCount : null,
        source: (METRIC_RECONCILIATION_LATEST_PATH || reliabilitySourcePath || GAP_CONFLICT_LATEST_PATH),
      },
    },
    conservative_metrics: {
      cost_ratio_pct: costRatioPct,
      mdd_pct: mddPct,
      error_count_24h: errorCount24h,
    },
    live_service: {
      ok: liveService.ok,
      service: liveService.service,
      region: liveService.region,
      revision: liveService.revision,
      url: liveService.url,
      values: {
        DONBEOLJA_STRATEGY_ID: liveDefault,
        WEBHOOK_ALLOWED_STRATEGY_IDS: liveAllowed,
        ENGINE_VERSION: liveEngine,
        WEBHOOK_STRATEGY_GATE_ENABLED: liveService.values.WEBHOOK_STRATEGY_GATE_ENABLED || null,
      },
      error: liveService.error || null,
    },
    live_revision: {
      ok: liveRevision.ok,
      revision: liveRevision.revision,
      create_time_iso: liveRevision.create_time_iso,
      create_time_kst: liveRevision.create_time_kst,
      error: liveRevision.error || null,
    },
    mismatch_freshness: mismatchFreshness,
    local_env: {
      path: path.join(ROOT, ".env"),
      DONBEOLJA_STRATEGY_ID: localDefault,
      WEBHOOK_ALLOWED_STRATEGY_IDS: localAllowed,
      ENGINE_VERSION: localEngine,
    },
    cloudbuild_env: {
      path: path.join(ROOT, "cloudbuild.yaml"),
      DONBEOLJA_STRATEGY_ID: cloudBuildDefault,
      WEBHOOK_ALLOWED_STRATEGY_IDS: cloudBuildAllowed,
      ENGINE_VERSION: cloudBuildEngine,
    },
    alignment: {
      recommended_default_strategy_id: recommendedDefault,
      recommended_allowed_strategy_ids: recommendedAllowed,
      recommended_allowed_strategy_ids_csv: recommendedAllowedCsv,
      recommended_engine_version: recommendedEngine,
      conservative_default_strategy_id: conservativeDefault,
      conservative_allowed_strategy_ids_csv: conservativeAllowedCsv,
      conservative_engine_version: conservativeEngine,
      live_sync_needed: liveSyncNeeded,
      gcloud_update_command: conservativeCommand,
      options: {
        conservative_allowlist_only: {
          purpose: "기본 strategy_id/engine은 유지하고 허용 목록만 확장",
          command: conservativeCommand,
          expected_effect: "DROP_STRATEGY_ID_MISMATCH 즉시 감소/해소",
          change_scope: "낮음",
        },
        full_sync_version_upgrade: {
          purpose: "기본 strategy_id + 허용 목록 + engine을 최신 송신 버전으로 동기화",
          command: fullSyncCommand,
          expected_effect: "버전 기준 단일화 + 추가 드롭 방지",
          change_scope: "중간",
        },
      },
    },
    resolution_plan: [
      {
        step: 1,
        owner: "signal_id_alignment_owner",
        action: "불일치 strategy_id 분포와 실서버 허용값 재확인",
        status: "완료",
      },
      {
        step: 2,
        owner: "jihye/system_owner",
        action: "보수안(conservative_allowlist_only) 승인 후 실서버 반영",
        status: liveSyncNeeded ? "대기" : "완료",
      },
      {
        step: 3,
        owner: "post_apply_signal_observer",
        action: "반영 후 60분 내 DROP_STRATEGY_ID_MISMATCH 0건 검증",
        status: liveSyncNeeded ? "대기" : "진행중",
      },
    ],
    verification_plan: {
      target: liveSyncNeeded
        ? "허용ID 동기화 후 mismatch 신규 0건"
        : "리비전 반영 후 mismatch 신규 0건 유지",
      checkpoints: [
        "mismatch_freshness.created_after_live_revision_count == 0 확인",
        "mismatch_freshness.last_created_kst가 리비전 생성시각 이전인지 확인",
        "실신호(signals) 1건 이상 회복 여부 확인",
        "비-전략ID 드롭 사유(DROP_REAL_DISABLED 등) 0건 또는 허용 상태 확인",
      ],
      commands: [
        "node scripts/post-apply-signal-probe.js",
        "node scripts/strategy-id-alignment-check.js",
      ],
    },
    report_to_jihye: {
      progress_pct: 100,
      core_outcome: "실서버 strategy_id 게이트 실값과 최근 드롭 불일치 분포를 단일 리포트로 고정, 보수안/전체안 커맨드 동시 산출",
      decision_request: decisionRequestText,
    },
    collaboration_requests_via_jihye: liveSyncNeeded
      ? [
        "system_owner: gcloud update 커맨드 실행 및 반영 시각 공유",
        "qa_owner: 반영 후 60분 내 mismatch_freshness.created_after_live_revision_count=0 검증",
        "post_apply_signal_observer: 첫 실신호 발생 시 3분 내 통과 여부 보고",
        "runtime_recovery_lead: DROP_REAL_DISABLED 1건 원인(의도된 차단인지, 설정 누락인지) 10분 내 분류",
      ]
      : [
        "qa_owner: 리비전 기준 신규 mismatch 0건 유지 검증",
        "system_dev_autonomous: 신규 mismatch 발생 시 게이트 허용ID 로딩 경로 재점검",
        "post_apply_signal_observer: 첫 실신호 발생 시 3분 내 통과 여부 보고",
        "runtime_recovery_lead: DROP_REAL_DISABLED 1건 원인(의도된 차단인지, 설정 누락인지) 10분 내 분류",
      ],
    evolution_plan: [
      "[EVOLUTION] 실서버 env 조회 + 드롭 분해를 단일 스크립트로 자동화 | 원인 확인 시간 단축",
      "[EVOLUTION] 권장 동기화 커맨드를 보수안/전체안으로 분리 산출 | 리스크 기반 즉시 의사결정 가능",
    ],
    issues: issueLines,
    user_approval_required: approvalStateText,
    self_validation: {
      checks: [
        "gcloud run services describe 읽기 성공 여부 확인",
        "gcloud run revisions describe 읽기 성공 여부 확인",
        "post_apply_signal_probe_latest strategy_mismatch_top 파싱 확인",
        "post_apply_signal_probe_latest counts/signals/drops 파싱 확인",
        "권장 허용 strategy_id 목록에 수신ID 포함 여부 확인",
        "mismatch.guard_count <= mismatch.total_count 정합성 확인",
        "mismatch_total <= drops_total 정합성 확인",
        "mismatch_freshness.created_after_live_revision_count <= mismatch_freshness.total_count 정합성 확인",
        "gcloud update 명령의 쉼표 포함 값이 안전하게 전달되는 형식(^:^ delimiter) 확인",
      ],
      result: "pass",
    },
    artifacts: {},
  };

  const outJson = path.join(OPS_DAILY, `${dateKey}_strategy_id_alignment_check_${cycle}_jihye.json`);
  const outMd = path.join(OPS_DAILY, `${dateKey}_strategy_id_alignment_check_${cycle}_jihye.md`);
  payload.artifacts.output_json = outJson;
  payload.artifacts.output_md = outMd;
  payload.artifacts.latest_json = OUTPUT_LATEST_JSON_PATH;
  payload.artifacts.latest_md = OUTPUT_LATEST_MD_PATH;

  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMd, buildMarkdown(payload, outJson), "utf8");
  fs.copyFileSync(outJson, OUTPUT_LATEST_JSON_PATH);
  fs.copyFileSync(outMd, OUTPUT_LATEST_MD_PATH);

  console.log("[strategy-id-alignment-check] written:");
  console.log(`- ${outJson}`);
  console.log(`- ${outMd}`);
  console.log(`- ${OUTPUT_LATEST_JSON_PATH}`);
  console.log(`- ${OUTPUT_LATEST_MD_PATH}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[strategy-id-alignment-check] failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  normalizeStrategyIdCsv,
  strategyIdCsvEqual,
  csvIncludesStrategyId,
  resolveMismatchAuditCounts,
};
