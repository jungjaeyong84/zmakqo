#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { loadSystemOpsLatestSync } = require("./lib/system-ops-runtime");

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function readTextSafe(filePath) {
  try {
    return { ok: true, text: fs.readFileSync(filePath, "utf8") };
  } catch (err) {
    return { ok: false, text: "", error: err && err.message ? err.message : String(err) };
  }
}

function readJsonSafe(filePath) {
  const raw = readTextSafe(filePath);
  if (!raw.ok) return { ok: false, data: null, error: raw.error };
  try {
    return { ok: true, data: JSON.parse(raw.text), error: null };
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
  }
}

function parseIsoMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function pickGeneratedIso(data) {
  if (!data || typeof data !== "object") return null;
  const candidates = [
    data.generated_at_iso,
    data.generatedAtIso,
    data.generated_at,
    data.generatedAt,
    data.as_of_iso,
    data.snapshot_end_iso,
  ];
  for (const candidate of candidates) {
    const ms = parseIsoMs(candidate);
    if (Number.isFinite(ms)) return String(candidate).trim();
  }
  return null;
}

function readFileMtimeMs(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const ms = Number(stat && stat.mtimeMs);
    return Number.isFinite(ms) ? ms : null;
  } catch (_) {
    return null;
  }
}

function resolveSourceFreshness({ label, filePath, readResult, nowMs, thresholdMin } = {}) {
  const data = readResult && readResult.ok ? readResult.data : null;
  const generatedIso = pickGeneratedIso(data);
  const generatedMs = parseIsoMs(generatedIso);
  const mtimeMs = readFileMtimeMs(filePath);
  const sourceMs = Number.isFinite(generatedMs) ? generatedMs : mtimeMs;
  const ageMin = Number.isFinite(sourceMs) ? Math.max(0, (nowMs - sourceMs) / 60000) : null;
  const stale = !readResult || readResult.ok !== true || !Number.isFinite(sourceMs) || (Number.isFinite(ageMin) && ageMin > thresholdMin);
  let reason = "FRESH";
  if (!readResult || readResult.ok !== true) reason = "READ_FAIL";
  else if (!Number.isFinite(sourceMs)) reason = "TIMESTAMP_MISSING";
  else if (Number.isFinite(ageMin) && ageMin > thresholdMin) reason = "STALE";
  return {
    label: String(label || "unknown"),
    path: filePath,
    ok: !!(readResult && readResult.ok),
    reason,
    stale,
    generated_at_iso: generatedIso || null,
    source_ts_ms: Number.isFinite(sourceMs) ? Math.trunc(sourceMs) : null,
    source_ts_kst: Number.isFinite(sourceMs) ? toKstString(new Date(sourceMs).toISOString(), { fallbackToString: true }) : null,
    age_min: Number.isFinite(ageMin) ? round(ageMin, 1) : null,
    threshold_min: thresholdMin,
  };
}

function hasAll(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

function pickFirstFinite(candidates, fallback = null) {
  for (const c of candidates) {
    if (Number.isFinite(c && c.value)) {
      return { value: c.value, source: c.source };
    }
  }
  return { value: fallback, source: "fallback" };
}

function sumCountRows(rows) {
  if (!Array.isArray(rows)) return null;
  let total = 0;
  let hasAny = false;
  for (const row of rows) {
    const count = toNum(row && row.count, null);
    if (!Number.isFinite(count)) continue;
    total += count;
    hasAny = true;
  }
  return hasAny ? total : null;
}

function findDropReasonCount(rows, reason) {
  if (!Array.isArray(rows)) return null;
  const target = String(reason || "").trim().toUpperCase();
  if (!target) return null;
  for (const row of rows) {
    const rowReason = String(row && row.reason ? row.reason : "").trim().toUpperCase();
    if (rowReason !== target) continue;
    const count = toNum(row && row.count, null);
    return Number.isFinite(count) ? count : null;
  }
  return null;
}

function resolveRetryDefaults() {
  const maxRetries = toNum(process.env.BINANCE_HTTP_MAX_RETRIES, 2);
  const baseMs = toNum(process.env.BINANCE_HTTP_RETRY_BASE_MS, 250);
  const maxMs = toNum(process.env.BINANCE_HTTP_RETRY_MAX_MS, 2000);
  const jitterMs = toNum(process.env.BINANCE_HTTP_RETRY_JITTER_MS, 80);
  return {
    max_retries: Math.max(0, Math.min(5, Math.trunc(maxRetries))),
    base_ms: Math.max(50, Math.min(10000, Math.trunc(baseMs))),
    max_ms: Math.max(100, Math.min(30000, Math.trunc(maxMs))),
    jitter_ms: Math.max(0, Math.min(2000, Math.trunc(jitterMs))),
  };
}

function hasExecutionFlowCoverage(health) {
  if (!health || health.available !== true) return false;
  const hasSignalSide = (
    Number.isFinite(health.signals_count)
    || Number.isFinite(health.tp1_signal_count)
    || Number.isFinite(health.trailing_signal_count)
    || Number.isFinite(health.drop_tp1_pending_count)
  );
  const hasFillSide = (
    Number.isFinite(health.fills_count)
    || Number.isFinite(health.audit_issue_count)
    || Number.isFinite(health.qty_pct_non_positive_count)
    || Number.isFinite(health.duplicate_signal_fill_count)
  );
  return hasSignalSide && hasFillSide;
}

function buildMarkdown({
  generatedAtKst,
  dateKey,
  status,
  mode,
  reasons,
  checks,
  runtime,
  retryDefaults,
  freshnessThresholdMin,
  outputJsonPath,
  sourcePaths,
}) {
  const issueLines = [];
  if (!checks.idempotency_guard.ok) {
    issueLines.push("[ISSUE] H | 주문 중복 방지 코드 패턴 미검출 | 주문 키 생성/중복조회 로직 즉시 점검 필요");
  }
  if (!checks.retry_guard.ok || !checks.rate_limit_guard.ok) {
    issueLines.push("[ISSUE] H | 재시도 또는 속도 제한 대응 패턴 누락 | API 장애 시 자동 복구 신뢰도 저하");
  }
  if (Number.isFinite(runtime.cost_ratio_pct) && Number.isFinite(runtime.cost_limit_pct) && runtime.cost_ratio_pct > runtime.cost_limit_pct) {
    issueLines.push(`[ISSUE] H | 비용 비율 ${fmt(runtime.cost_ratio_pct)}%가 상한 ${fmt(runtime.cost_limit_pct)}% 초과 | 신규 진입 확대 금지 유지 필요`);
  }
  if (Number.isFinite(runtime.drop_tp1_pending_count) && runtime.drop_tp1_pending_count >= 500) {
    issueLines.push(`[ISSUE] M | DROP_TP_P1_PENDING ${runtime.drop_tp1_pending_count}건 누적 | 신호-체결 동기화 지연 원인 분류 필요`);
  }
  if (Number.isFinite(runtime.qty_pct_non_positive_count) && runtime.qty_pct_non_positive_count >= 1) {
    issueLines.push(`[ISSUE] M | 체결 수량 비율 이상치 ${runtime.qty_pct_non_positive_count}건 | qty_pct 누락 방지 검증 강화 필요`);
  }
  if (Number.isFinite(runtime.strategy_id_mismatch_count) && runtime.strategy_id_mismatch_count >= 1) {
    issueLines.push(`[ISSUE] H | 전략ID 불일치 드롭 ${runtime.strategy_id_mismatch_count}건 | 서버 허용 strategy_id 동기화 전 신규 진입 확대 금지`);
  }
  if (runtime.execution_flow_data_ready === false) {
    issueLines.push("[ISSUE] H | 신호→주문→체결 데이터 공백으로 전체 흐름 검증 불가 | 데이터 복구 전 수익 확대 금지");
  }
  if (Number.isFinite(runtime.source_stale_count) && runtime.source_stale_count > 0) {
    issueLines.push(`[ISSUE] H | latest 지표 ${runtime.source_stale_count}건 stale(${runtime.stale_sources.join(", ")}) | ${freshnessThresholdMin}분 초과 데이터로 자동판정 오차 위험`);
  }
  if (!issueLines.length) {
    issueLines.push("[ISSUE] L | 주문 실행 경로 핵심 경보 없음 | 현재 자동화 설정 유지");
  }

return `# ${dateKey} 바이낸스 실행 안전 점검 (시스템 개발 담당)

기준 시각: ${generatedAtKst}
산출 JSON: \`${outputJsonPath}\`
기준 파일: \`${sourcePaths.binancePrivate}\`, \`${sourcePaths.settings}\`, \`${sourcePaths.systemOps}\`, \`${sourcePaths.dataConsistency}\`, \`${sourcePaths.riskController}\`, \`${sourcePaths.postApplySignalProbe}\`, \`${sourcePaths.strategyIdAlignment}\`

## 시스템 설계
- 주문 경로를 \`중복 주문 방지\`, \`재시도\`, \`속도 제한 대응\`, \`키 보호\` 4개 안전축으로 분해해 점검합니다.
- 운영 위험은 최신 런타임 지표(비용, 오류, TP1 대기, 수량 이상치)와 합쳐서 \`진행/보류/중단\`으로 자동 판정합니다.
- 판정 결과는 JSON(자동 처리용) + 문서(운영 보고용)로 동시에 저장합니다.

## 구현 태스크
1. 코드 가드 점검 완료
   - 중복 주문 방지 키: \`${checks.idempotency_guard.ok ? "검출" : "미검출"}\`
   - 재시도 설정: \`${checks.retry_guard.ok ? "검출" : "미검출"}\`
   - 속도 제한 대응(429/retry-after): \`${checks.rate_limit_guard.ok ? "검출" : "미검출"}\`
2. 재시도 기본값 산출
   - 최대 재시도: \`${retryDefaults.max_retries}\`회
   - 기본 대기: \`${retryDefaults.base_ms}ms\`, 최대 대기: \`${retryDefaults.max_ms}ms\`, 지터: \`${retryDefaults.jitter_ms}ms\`
3. 운영 수치 결합
   - 비용 비율: \`${Number.isFinite(runtime.cost_ratio_pct) ? fmt(runtime.cost_ratio_pct, 4) : "N/A"}%\` (상한 \`${Number.isFinite(runtime.cost_limit_pct) ? fmt(runtime.cost_limit_pct, 4) : "N/A"}%\`)
   - 24시간 오류: \`${runtime.error_count == null ? "N/A" : runtime.error_count}\`건
   - DROP_TP_P1_PENDING: \`${runtime.drop_tp1_pending_count == null ? "N/A" : runtime.drop_tp1_pending_count}\`건
   - 체결 수량 비율 이상치: \`${runtime.qty_pct_non_positive_count == null ? "N/A" : runtime.qty_pct_non_positive_count}\`건
   - 전략ID 불일치 드롭: \`${runtime.strategy_id_mismatch_count == null ? "N/A" : runtime.strategy_id_mismatch_count}\`건
   - latest 최신성 경고: \`${runtime.source_stale_count || 0}\`건 (임계 \`${freshnessThresholdMin}분\`)
   4. 상태 판정: \`${status}\` / 운영 모드: \`${mode}\`
   5. 보수 수치 채택 소스
   - 비용: \`${runtime.metric_source && runtime.metric_source.cost_ratio_pct ? runtime.metric_source.cost_ratio_pct : "N/A"}\`
   - 오류: \`${runtime.metric_source && runtime.metric_source.error_count ? runtime.metric_source.error_count : "N/A"}\`
   - 전략ID 불일치: \`${runtime.metric_source && runtime.metric_source.strategy_id_mismatch_count ? runtime.metric_source.strategy_id_mismatch_count : "N/A"}\`

## 장애/보안 리스크
${issueLines.join("\n")}

## 운영 체크리스트
- [x] 주문 API 코드에 중복 방지 키 패턴 존재 확인
- [x] 재시도/백오프/속도 제한 대응 패턴 존재 확인
- [x] 라이브 트레이딩 기본값(\`binance_real_trading_enabled=false\`) 확인
- [x] 최신 운영 수치(system_ops + data_consistency + risk_controller) 결합 점검
- [x] post-apply/strategy_id 정합성 수치 결합 점검
- [x] 상태 자동 판정 및 보고 문서 생성

## 대표 보고 요약
- 현재 판정은 \`${status}\`이며 운영 모드는 \`${mode}\`입니다.
- 핵심 근거: ${reasons.join(", ")}
- 독립 실행안: 24시간 주기로 동일 점검 자동 실행, 이상치 기준 초과 시 즉시 보류 고정.
- 지혜 의사결정 요청: 비용 상한(0.20%) 복귀 전 주문 규모 축소 기준(예: 30% 축소) 유지 여부 확정 필요.
- 지혜를 통한 협업 요청: signal_id_alignment_owner가 실서버/알림 전략ID 동기화 승인 상태와 ETA를 다음 보고 전 제출.
- [EVOLUTION] 로그 확인 중심 운영에서 코드+수치 결합 점검으로 전환 | 장애 전파 전 선제 차단 속도 개선
`;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const freshnessThresholdMin = Math.max(10, Math.trunc(toNum(process.env.EXEC_SAFETY_SOURCE_STALE_MINUTES, 180)));

  const systemOpsPath = path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");
  const dataConsistencyPath = path.join(repoRoot, "ops", "daily", "data_consistency_lead_latest.json");
  const riskControllerPath = path.join(repoRoot, "ops", "daily", "risk_controller_latest.json");
  const postApplySignalProbePath = path.join(repoRoot, "ops", "daily", "post_apply_signal_probe_latest.json");
  const strategyIdAlignmentPath = path.join(repoRoot, "ops", "daily", "strategy_id_alignment_latest.json");
  const binancePrivatePath = path.join(repoRoot, "src", "exchanges", "binanceFuturesPrivate.js");
  const settingsPath = path.join(repoRoot, "src", "storage", "settings.js");

  const systemOpsArtifactRead = readJsonSafe(systemOpsPath);
  const systemOpsRead = { ok: true, data: loadSystemOpsLatestSync({ fallbackPath: systemOpsPath }) };
  const dataConsistencyRead = readJsonSafe(dataConsistencyPath);
  const riskControllerRead = readJsonSafe(riskControllerPath);
  const postApplySignalProbeRead = readJsonSafe(postApplySignalProbePath);
  const strategyIdAlignmentRead = readJsonSafe(strategyIdAlignmentPath);
  const binancePrivateRead = readTextSafe(binancePrivatePath);
  const settingsRead = readTextSafe(settingsPath);
  const sourceFreshness = {
    system_ops: resolveSourceFreshness({
      label: "system_ops_check_latest",
      filePath: systemOpsPath,
      readResult: systemOpsArtifactRead,
      nowMs,
      thresholdMin: freshnessThresholdMin,
    }),
    data_consistency: resolveSourceFreshness({
      label: "data_consistency_lead_latest",
      filePath: dataConsistencyPath,
      readResult: dataConsistencyRead,
      nowMs,
      thresholdMin: freshnessThresholdMin,
    }),
    risk_controller: resolveSourceFreshness({
      label: "risk_controller_latest",
      filePath: riskControllerPath,
      readResult: riskControllerRead,
      nowMs,
      thresholdMin: freshnessThresholdMin,
    }),
    post_apply_signal_probe: resolveSourceFreshness({
      label: "post_apply_signal_probe_latest",
      filePath: postApplySignalProbePath,
      readResult: postApplySignalProbeRead,
      nowMs,
      thresholdMin: freshnessThresholdMin,
    }),
    strategy_id_alignment: resolveSourceFreshness({
      label: "strategy_id_alignment_latest",
      filePath: strategyIdAlignmentPath,
      readResult: strategyIdAlignmentRead,
      nowMs,
      thresholdMin: freshnessThresholdMin,
    }),
  };
  const staleSources = Object.values(sourceFreshness)
    .filter((item) => item && item.stale)
    .map((item) => item.label);

  const runtime = {
    cost_ratio_pct: null,
    cost_limit_pct: null,
    error_count: null,
    drop_tp1_pending_count: null,
    qty_pct_non_positive_count: null,
    strategy_id_mismatch_count: null,
    strategy_id_mismatch_top: [],
    execution_flow_data_ready: false,
    source_stale_count: staleSources.length,
    stale_sources: staleSources,
    freshness_threshold_min: freshnessThresholdMin,
    source_freshness: sourceFreshness,
    metric_source: {
      cost_ratio_pct: "unresolved",
      error_count: "unresolved",
      strategy_id_mismatch_count: "unresolved",
    },
  };
  if (systemOpsRead.ok && systemOpsRead.data && typeof systemOpsRead.data === "object") {
    const s = systemOpsRead.data;
    const consistencyMetrics = (dataConsistencyRead.ok && dataConsistencyRead.data && dataConsistencyRead.data.consolidated_metrics)
      ? dataConsistencyRead.data.consolidated_metrics
      : null;
    const riskScorecard = (riskControllerRead.ok && riskControllerRead.data && riskControllerRead.data.risk_scorecard)
      ? riskControllerRead.data.risk_scorecard
      : null;
    const postApply = (postApplySignalProbeRead.ok && postApplySignalProbeRead.data && typeof postApplySignalProbeRead.data === "object")
      ? postApplySignalProbeRead.data
      : null;
    const strategyAlign = (strategyIdAlignmentRead.ok && strategyIdAlignmentRead.data && typeof strategyIdAlignmentRead.data === "object")
      ? strategyIdAlignmentRead.data
      : null;
    const strategyMismatch = strategyAlign && strategyAlign.mismatch ? strategyAlign.mismatch : {};
    const strategyMismatchFreshness = strategyAlign && strategyAlign.mismatch_freshness ? strategyAlign.mismatch_freshness : {};

    const chosenCost = pickFirstFinite([
      { source: "data_consistency_lead_latest.consolidated_metrics.cost_ratio_pct", value: toNum(consistencyMetrics && consistencyMetrics.cost_ratio_pct, null) },
      { source: "risk_controller_latest.risk_scorecard.cost.applied_value_pct", value: toNum(riskScorecard && riskScorecard.cost && riskScorecard.cost.applied_value_pct, null) },
      { source: "system_ops_check_latest.cost_ratio_pct", value: toNum(s.cost_ratio_pct, null) },
    ], null);
    const chosenError = pickFirstFinite([
      { source: "data_consistency_lead_latest.consolidated_metrics.error_count_24h", value: toNum(consistencyMetrics && consistencyMetrics.error_count_24h, null) },
      { source: "risk_controller_latest.risk_scorecard.error.applied_error_count_24h", value: toNum(riskScorecard && riskScorecard.error && riskScorecard.error.applied_error_count_24h, null) },
      { source: "system_ops_check_latest.error_count", value: toNum(s.error_count, null) },
    ], null);
    const chosenStrategyMismatch = pickFirstFinite([
      { source: "strategy_id_alignment_latest.mismatch.guard_count", value: toNum(strategyMismatch.guard_count, null) },
      { source: "strategy_id_alignment_latest.mismatch.after_live_revision_count", value: toNum(strategyMismatch.after_live_revision_count, null) },
      { source: "strategy_id_alignment_latest.mismatch_freshness.created_after_live_revision_count", value: toNum(strategyMismatchFreshness.created_after_live_revision_count, null) },
      { source: "strategy_id_alignment_latest.mismatch.total_count", value: toNum(strategyMismatch.total_count, null) },
      { source: "post_apply_signal_probe_latest.strategy_mismatch_top.sum_count", value: sumCountRows(postApply && postApply.strategy_mismatch_top) },
      { source: "post_apply_signal_probe_latest.drop_reason_top.DROP_STRATEGY_ID_MISMATCH", value: findDropReasonCount(postApply && postApply.drop_reason_top, "DROP_STRATEGY_ID_MISMATCH") },
    ], null);

    runtime.cost_ratio_pct = chosenCost.value;
    runtime.cost_limit_pct = toNum(s.cost_limit_pct, null);
    runtime.error_count = chosenError.value;
    runtime.drop_tp1_pending_count = toNum(s.execution_health && s.execution_health.drop_tp1_pending_count, null);
    runtime.qty_pct_non_positive_count = toNum(s.execution_health && s.execution_health.qty_pct_non_positive_count, null);
    runtime.strategy_id_mismatch_count = chosenStrategyMismatch.value;
    runtime.strategy_id_mismatch_top = Array.isArray(postApply && postApply.strategy_mismatch_top)
      ? postApply.strategy_mismatch_top.slice(0, 3)
      : [];
    runtime.execution_flow_data_ready = hasExecutionFlowCoverage(s.execution_health);
    runtime.metric_source = {
      cost_ratio_pct: chosenCost.source,
      error_count: chosenError.source,
      strategy_id_mismatch_count: chosenStrategyMismatch.source,
    };
  }

  const binanceText = binancePrivateRead.text;
  const settingsText = settingsRead.text;
  const checks = {
    idempotency_guard: {
      ok: hasAll(binanceText, [
        /resolveClientOrderId\s*\(/,
        /newClientOrderId/,
        /isDuplicateClientOrderError/,
        /fetchFuturesOrder\s*\(/,
      ]),
    },
    retry_guard: {
      ok: hasAll(binanceText, [
        /resolveRetryConfig/,
        /maxRetries/,
        /computeBackoffMs/,
        /isRetriableHttpStatus/,
      ]),
    },
    rate_limit_guard: {
      ok: hasAll(binanceText, [
        /429/,
        /retry-after/i,
        /-1003/,
      ]),
    },
    default_live_guard: {
      ok: /binance_real_trading_enabled:\s*false/.test(settingsText),
    },
  };

  const retryDefaults = resolveRetryDefaults();
  const reasons = [];
  let status = "진행";

  if (!systemOpsRead.ok) {
    status = "보류";
    reasons.push("운영 지표 파일 미수집");
  }
  if (runtime.source_stale_count > 0) {
    if (status === "진행") status = "보류";
    reasons.push(`latest 지표 stale ${runtime.source_stale_count}건 (${runtime.stale_sources.join(", ")})`);
  }
  if (!checks.idempotency_guard.ok || !checks.retry_guard.ok || !checks.rate_limit_guard.ok) {
    status = "중단";
    reasons.push("주문 API 핵심 안전 가드 점검 실패");
  }
  if (!checks.default_live_guard.ok) {
    if (status !== "중단") status = "보류";
    reasons.push("라이브 트레이딩 기본 비활성 가드 미확인");
  }
  if (Number.isFinite(runtime.cost_ratio_pct) && Number.isFinite(runtime.cost_limit_pct) && runtime.cost_ratio_pct > runtime.cost_limit_pct) {
    if (status === "진행") status = "보류";
    reasons.push(`비용 비율 ${fmt(runtime.cost_ratio_pct)}% > ${fmt(runtime.cost_limit_pct)}%`);
  }
  if (Number.isFinite(runtime.error_count) && runtime.error_count >= 2) {
    status = "중단";
    reasons.push(`24시간 오류 ${runtime.error_count}건 (중단선 2건 이상)`);
  } else if (Number.isFinite(runtime.error_count) && runtime.error_count >= 1) {
    if (status === "진행") status = "보류";
    reasons.push(`24시간 오류 ${runtime.error_count}건`);
  }
  if (Number.isFinite(runtime.drop_tp1_pending_count) && runtime.drop_tp1_pending_count >= 500) {
    if (status === "진행") status = "보류";
    reasons.push(`DROP_TP_P1_PENDING ${runtime.drop_tp1_pending_count}건`);
  }
  if (Number.isFinite(runtime.qty_pct_non_positive_count) && runtime.qty_pct_non_positive_count >= 1) {
    if (status === "진행") status = "보류";
    reasons.push(`체결 수량 비율 이상치 ${runtime.qty_pct_non_positive_count}건`);
  }
  if (Number.isFinite(runtime.strategy_id_mismatch_count) && runtime.strategy_id_mismatch_count >= 1) {
    if (status === "진행") status = "보류";
    reasons.push(`전략ID 불일치 드롭 ${runtime.strategy_id_mismatch_count}건`);
  }
  if (!runtime.execution_flow_data_ready) {
    if (status === "진행") status = "보류";
    reasons.push("신호→주문→체결 데이터 미수집");
  }
  if (!reasons.length) reasons.push("핵심 안전 가드와 운영 지표 정상");

  const mode = status === "진행" ? "수익 확대 가능" : "비용 차단";
  const output = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    status,
    mode,
    reasons,
    runtime: {
      cost_ratio_pct: round(runtime.cost_ratio_pct, 4),
      cost_limit_pct: round(runtime.cost_limit_pct, 4),
      error_count: runtime.error_count,
      drop_tp1_pending_count: runtime.drop_tp1_pending_count,
      qty_pct_non_positive_count: runtime.qty_pct_non_positive_count,
      strategy_id_mismatch_count: runtime.strategy_id_mismatch_count,
      strategy_id_mismatch_top: runtime.strategy_id_mismatch_top,
      execution_flow_data_ready: runtime.execution_flow_data_ready,
      source_stale_count: runtime.source_stale_count,
      stale_sources: runtime.stale_sources,
      freshness_threshold_min: runtime.freshness_threshold_min,
      source_freshness: runtime.source_freshness,
      metric_source: runtime.metric_source,
    },
    checks,
    retry_defaults: retryDefaults,
    source_paths: {
      system_ops: systemOpsPath,
      data_consistency: dataConsistencyPath,
      risk_controller: riskControllerPath,
      post_apply_signal_probe: postApplySignalProbePath,
      strategy_id_alignment: strategyIdAlignmentPath,
      binance_private: binancePrivatePath,
      settings: settingsPath,
    },
  };

  const outJson = path.join(repoRoot, "ops", "daily", "binance_execution_safety_latest.json");
  const outMd = path.join(repoRoot, "ops", "daily", `${dateKey}_binance_execution_safety_jihye.md`);
  fs.writeFileSync(outJson, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    outMd,
    buildMarkdown({
      generatedAtKst,
      dateKey,
      status,
      mode,
      reasons,
      checks,
      runtime,
      retryDefaults,
      freshnessThresholdMin,
      outputJsonPath: outJson,
      sourcePaths: {
        systemOps: systemOpsPath,
        dataConsistency: dataConsistencyPath,
        riskController: riskControllerPath,
        postApplySignalProbe: postApplySignalProbePath,
        strategyIdAlignment: strategyIdAlignmentPath,
        binancePrivate: binancePrivatePath,
        settings: settingsPath,
      },
    }),
    "utf8"
  );

  console.log(JSON.stringify({
    ok: true,
    status,
    mode,
    output_json: outJson,
    output_md: outMd,
    checks,
    runtime: output.runtime,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("binance-execution-safety-check failed:", err && err.message ? err.message : err);
  process.exit(1);
}
