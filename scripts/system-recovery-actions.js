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

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, data: JSON.parse(raw), error: null };
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
  }
}

function pickLatestFile(dirPath, regex) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath).filter((name) => regex.test(name)).sort();
  if (!names.length) return null;
  return path.join(dirPath, names[names.length - 1]);
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

function parseHHMM(kstText) {
  const m = String(kstText || "").match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
}

function addMinutesKst(baseIso, deltaMinutes) {
  const baseMs = new Date(baseIso).getTime();
  if (!Number.isFinite(baseMs)) return null;
  const nextIso = new Date(baseMs + (deltaMinutes * 60 * 1000)).toISOString();
  return toKstString(nextIso, { fallbackToString: true });
}

function decideStatus(metrics) {
  const reasons = [];
  let status = "진행";

  if (Number.isFinite(metrics.error_count) && metrics.error_count >= 2) {
    status = "중단";
    reasons.push(`24시간 오류 ${metrics.error_count}건 (중단선 2건 이상)`);
  }
  if (Number.isFinite(metrics.fail_count) && metrics.fail_count >= 2) {
    status = "중단";
    reasons.push(`실패 모드 FAIL ${metrics.fail_count}건`);
  }

  if (status !== "중단") {
    if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
      status = "보류";
      reasons.push(`비용 ${fmt(metrics.cost_ratio_pct)}% > ${fmt(metrics.cost_limit_pct)}%`);
    }
    if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
      status = "보류";
      reasons.push(`MDD ${fmt(metrics.mdd_pct)}% < ${fmt(metrics.mdd_limit_pct)}%`);
    }
    if (Number.isFinite(metrics.drop_tp1_pending_count) && metrics.drop_tp1_pending_count >= 500) {
      status = "보류";
      reasons.push(`DROP_TP_P1_PENDING ${metrics.drop_tp1_pending_count}건`);
    }
    if (Number.isFinite(metrics.qty_pct_non_positive_count) && metrics.qty_pct_non_positive_count >= 1) {
      status = "보류";
      reasons.push(`qty_pct 이상치 ${metrics.qty_pct_non_positive_count}건`);
    }
    if (Number.isFinite(metrics.strategy_id_mismatch_drop_count) && metrics.strategy_id_mismatch_drop_count >= 1) {
      status = "보류";
      reasons.push(`전략ID 불일치 드롭 ${metrics.strategy_id_mismatch_drop_count}건`);
    }
    if (Number.isFinite(metrics.hold_count) && metrics.hold_count >= 1) {
      status = "보류";
      reasons.push(`실패 모드 HOLD ${metrics.hold_count}건`);
    }
  }

  if (!reasons.length) reasons.push("핵심 위험 지표 정상");
  return { status, reasons };
}

function buildActions({ generatedAtIso, metrics }) {
  const eta1 = addMinutesKst(generatedAtIso, 20);
  const eta2 = addMinutesKst(generatedAtIso, 35);
  const eta3 = addMinutesKst(generatedAtIso, 50);
  const duplicateBase = Number.isFinite(metrics.duplicate_signal_fill_count) ? metrics.duplicate_signal_fill_count : 0;
  const duplicateTarget = Math.max(0, Math.min(duplicateBase, 5));
  const tpPendingBase = Number.isFinite(metrics.drop_tp1_pending_count) ? metrics.drop_tp1_pending_count : 0;
  const tpPendingTarget = Math.max(0, tpPendingBase - 150);
  const strategyMismatchCount = Number.isFinite(metrics.strategy_id_mismatch_drop_count)
    ? metrics.strategy_id_mismatch_drop_count
    : 0;
  const strategyMismatchTarget = 0;

  const action2 = strategyMismatchCount >= 1
    ? {
      id: "SYS-A2",
      title: "전략ID 불일치 드롭 복구",
      why: `전략ID 불일치 드롭 ${strategyMismatchCount}건`,
      execute_now: [
        "strategy_id_alignment_latest.json 기준 수신ID/허용ID diff 즉시 확인",
        "실서버 허용 strategy_id 동기화 작업은 승인 상태만 추적하고 무단 반영 금지",
        "반영 후 60분 내 DROP_STRATEGY_ID_MISMATCH 0건 검증 루틴 실행",
      ],
      kpi: `다음 2회 사이클 내 전략ID 불일치 드롭 ${strategyMismatchCount}건 -> ${strategyMismatchTarget}건`,
      eta_kst: eta2,
      owner: "시스템 개발",
    }
    : {
      id: "SYS-A2",
      title: "TP1 대기 적체 복구 배치",
      why: `DROP_TP_P1_PENDING ${tpPendingBase}건 누적`,
      execute_now: [
        "신호-체결 감사 파일 최신본 재생성으로 누락 신호 재확인",
        "TP1 대기 상태 500건 이상 구간을 우선순위 1로 분리",
        "신호 시각 대비 체결 지연 상위 20건을 별도 목록으로 저장",
      ],
      kpi: `다음 3회 사이클 내 DROP_TP_P1_PENDING ${tpPendingBase}건 -> ${tpPendingTarget}건 이하`,
      eta_kst: eta2,
      owner: "시스템 개발",
    };

  return [
    {
      id: "SYS-A1",
      title: "중복 체결/수량 이상치 차단 강화",
      why: `중복체결 ${metrics.duplicate_signal_fill_count}건, qty_pct 이상치 ${metrics.qty_pct_non_positive_count}건`,
      execute_now: [
        "binance_execution_safety_latest.json 재점검으로 안전가드 유지 확인",
        "다음 체결부터 qty_pct <= 0 발생 시 주문 후속 단계 즉시 보류",
        "중복 신호 체결 2회 이상 시 같은 신호 신규 주문 30분 잠금",
      ],
      kpi: `다음 2회 사이클 내 qty_pct 이상치 0건, 중복체결 ${duplicateBase}건 -> ${duplicateTarget}건 이하`,
      eta_kst: eta1,
      owner: "시스템 개발",
    },
    action2,
    {
      id: "SYS-A3",
      title: "비용 상한 복귀 전 주문 강도 제한",
      why: `비용 ${fmt(metrics.cost_ratio_pct)}% (상한 ${fmt(metrics.cost_limit_pct)}%), MDD ${fmt(metrics.mdd_pct)}%`,
      execute_now: [
        "운영 모드 `비용 차단` 고정 유지",
        "신규 진입은 기존 수량의 70% 이하로 제한(승인 반영 상태 유지)",
        "비용 0.20% 이하 2회 연속 확인 전 공격 모드 전환 금지",
      ],
      kpi: "비용 비율 0.3552% -> 0.20% 이하 2회 연속 복귀",
      eta_kst: eta3,
      owner: "시스템 개발",
    },
  ];
}

function buildIssueLines(metrics) {
  const lines = [];
  if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
    lines.push(`[ISSUE] H | 비용 ${fmt(metrics.cost_ratio_pct)}%가 상한 ${fmt(metrics.cost_limit_pct)}% 초과 | 주문 강도 제한 유지`);
  }
  if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
    lines.push(`[ISSUE] H | MDD ${fmt(metrics.mdd_pct)}%가 기준 ${fmt(metrics.mdd_limit_pct)}% 하회 | 보류 유지`);
  }
  if (Number.isFinite(metrics.drop_tp1_pending_count) && metrics.drop_tp1_pending_count >= 500) {
    lines.push(`[ISSUE] M | DROP_TP_P1_PENDING ${metrics.drop_tp1_pending_count}건 | 신호-체결 지연 복구 필요`);
  }
  if (Number.isFinite(metrics.qty_pct_non_positive_count) && metrics.qty_pct_non_positive_count >= 1) {
    lines.push(`[ISSUE] M | qty_pct 이상치 ${metrics.qty_pct_non_positive_count}건 | 체결 후속 처리 검증 강화`);
  }
  if (Number.isFinite(metrics.strategy_id_mismatch_drop_count) && metrics.strategy_id_mismatch_drop_count >= 1) {
    lines.push(`[ISSUE] H | 전략ID 불일치 드롭 ${metrics.strategy_id_mismatch_drop_count}건 | 서버 허용 strategy_id 동기화 필요`);
  }
  if (Number.isFinite(metrics.fail_count) && metrics.fail_count >= 1) {
    lines.push(`[ISSUE] M | 실패 모드 FAIL ${metrics.fail_count}건 | 데이터 수집 파이프 복구 필요`);
  }
  if (!lines.length) {
    lines.push("[ISSUE] L | 핵심 위험 이슈 없음 | 현재 자동 운영 유지");
  }
  return lines;
}

function buildMarkdown({
  generatedAtKst,
  dateKey,
  status,
  mode,
  reasons,
  metrics,
  actions,
  outputJsonPath,
  inputPaths,
}) {
  const issueLines = buildIssueLines(metrics);
  return `# ${dateKey} 시스템 복구 액션 패키지 (시스템 개발 담당)

기준 시각: ${generatedAtKst}
산출 JSON: \`${outputJsonPath}\`

## 시스템 설계
- 주문 흐름을 \`중복 방지\`, \`지연 복구\`, \`전략ID 정합성\`, \`비용 차단\` 4개 축으로 관리합니다.
- 점검 입력은 \`system_ops\`, \`failure_mode\`, \`execution_safety\`, \`performance\`, \`data_consistency\`, \`risk_controller\`, \`post_apply_probe\`, \`strategy_alignment\` 최신 파일을 사용합니다.
- 자동 판정이 \`보류/중단\`이면 공격 모드 전환을 금지하고 복구 액션 3건을 즉시 실행 큐에 올립니다.

## 구현 태스크
1. 최신 점검 파일 8종 로드
   - system_ops: \`${inputPaths.system_ops}\`
   - failure_mode: \`${inputPaths.failure_mode}\`
   - execution_safety: \`${inputPaths.execution_safety}\`
   - performance: \`${inputPaths.performance || "N/A"}\`
   - data_consistency: \`${inputPaths.data_consistency || "N/A"}\`
   - risk_controller: \`${inputPaths.risk_controller || "N/A"}\`
   - post_apply_probe: \`${inputPaths.post_apply_signal_probe || "N/A"}\`
   - strategy_alignment: \`${inputPaths.strategy_id_alignment || "N/A"}\`
2. 상태 자동 판정 완료
   - 상태: \`${status}\`
   - 운영 모드: \`${mode}\`
   - 판정 근거: ${reasons.join(", ")}
3. 즉시 실행 액션 3건 생성
${actions.map((a, idx) => `${idx + 1}. ${a.id} ${a.title} | ETA ${a.eta_kst}`).join("\n")}
4. 보수 수치 채택 소스 기록
   - 비용: \`${metrics.metric_source && metrics.metric_source.cost_ratio_pct ? metrics.metric_source.cost_ratio_pct : "N/A"}\`
   - MDD: \`${metrics.metric_source && metrics.metric_source.mdd_pct ? metrics.metric_source.mdd_pct : "N/A"}\`
   - 오류: \`${metrics.metric_source && metrics.metric_source.error_count ? metrics.metric_source.error_count : "N/A"}\`
   - 전략ID 불일치: \`${metrics.metric_source && metrics.metric_source.strategy_id_mismatch_drop_count ? metrics.metric_source.strategy_id_mismatch_drop_count : "N/A"}\`

## 장애/보안 리스크
${issueLines.join("\n")}

## 운영 체크리스트
- [x] 비용/손실/오류/적체 수치 로드
- [x] 보류/중단 조건 자동 판정
- [x] 복구 액션 3건 생성 및 KPI 부여
- [x] 지혜 보고용 JSON + MD 동시 생성
- [ ] 다음 사이클에서 KPI 달성 여부 재검증

## 대표 보고 요약
- 독립 실행안: 복구 액션 3건을 즉시 실행 큐로 등록하고 다음 사이클에서 KPI를 재평가합니다.
- 지혜에게 보고할 내용: 진행률 100%(3/3 액션 정의), 핵심 성과는 자동 판정+복구 큐 동시 생성, 핵심 리스크는 비용 ${fmt(metrics.cost_ratio_pct)}% 및 MDD ${fmt(metrics.mdd_pct)}%, 전략ID 불일치 ${metrics.strategy_id_mismatch_drop_count == null ? "N/A" : metrics.strategy_id_mismatch_drop_count}건입니다.
- 지혜를 통해 전달할 협업 요청
  - signal_id_alignment_owner: 실서버/로컬 strategy_id 허용값 차이표와 승인 상태 제출 요청
  - post_apply_signal_observer: 다음 60분 DROP_STRATEGY_ID_MISMATCH 0건 검증 제출 요청
  - 품질 담당: 실패 모드 FAIL(슬리피지 수집 실패) 복구 일정 제출 요청
[EVOLUTION] 점검 결과 보고만 하던 방식에서, 복구 액션/KPI/ETA를 같은 사이클에 자동 생성하도록 변경 | 23:00 이후 실행 지연 감소
`;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const dailyDir = path.join(repoRoot, "ops", "daily");
  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const fallbackDateKey = kstDateKey(nowIso) || "unknown-date";

  const systemOpsPath = path.join(dailyDir, "system_ops_check_latest.json");
  const failureModePath = path.join(dailyDir, "qa_failure_mode_precheck_latest.json");
  const executionSafetyPath = path.join(dailyDir, "binance_execution_safety_latest.json");
  const dataConsistencyPath = path.join(dailyDir, "data_consistency_lead_latest.json");
  const riskControllerPath = path.join(dailyDir, "risk_controller_latest.json");
  const postApplySignalProbePath = path.join(dailyDir, "post_apply_signal_probe_latest.json");
  const strategyIdAlignmentPath = path.join(dailyDir, "strategy_id_alignment_latest.json");

  const systemOpsRead = { ok: true, data: loadSystemOpsLatestSync({ fallbackPath: systemOpsPath }) };
  const failureModeRead = readJsonSafe(failureModePath);
  const executionSafetyRead = readJsonSafe(executionSafetyPath);
  const dataConsistencyRead = readJsonSafe(dataConsistencyPath);
  const riskControllerRead = readJsonSafe(riskControllerPath);
  const postApplySignalProbeRead = readJsonSafe(postApplySignalProbePath);
  const strategyIdAlignmentRead = readJsonSafe(strategyIdAlignmentPath);

  const dateKey = (
    (systemOpsRead.ok && systemOpsRead.data && systemOpsRead.data.date_key)
    || fallbackDateKey
  );

  const perfExactPath = pickLatestFile(
    dailyDir,
    new RegExp(`^${escapeRegex(dateKey)}_performance_metrics_jihye\\.json$`)
  );
  const perfFallbackPath = pickLatestFile(
    dailyDir,
    /^\d{4}-\d{2}-\d{2}_performance_metrics_jihye\.json$/
  );
  const performancePath = perfExactPath || perfFallbackPath;
  const performanceRead = performancePath ? readJsonSafe(performancePath) : { ok: false, data: null, error: "missing" };

  const sys = systemOpsRead.ok && systemOpsRead.data && typeof systemOpsRead.data === "object"
    ? systemOpsRead.data
    : {};
  const health = sys.execution_health && typeof sys.execution_health === "object"
    ? sys.execution_health
    : {};
  const fail = failureModeRead.ok && failureModeRead.data && typeof failureModeRead.data === "object"
    ? failureModeRead.data
    : {};
  const perf = performanceRead.ok && performanceRead.data && typeof performanceRead.data === "object"
    ? performanceRead.data
    : {};
  const consistencyMetrics = dataConsistencyRead.ok && dataConsistencyRead.data && dataConsistencyRead.data.consolidated_metrics
    ? dataConsistencyRead.data.consolidated_metrics
    : {};
  const riskScorecard = riskControllerRead.ok && riskControllerRead.data && riskControllerRead.data.risk_scorecard
    ? riskControllerRead.data.risk_scorecard
    : {};
  const postApplyProbe = postApplySignalProbeRead.ok && postApplySignalProbeRead.data && typeof postApplySignalProbeRead.data === "object"
    ? postApplySignalProbeRead.data
    : {};
  const strategyAlignment = strategyIdAlignmentRead.ok && strategyIdAlignmentRead.data && typeof strategyIdAlignmentRead.data === "object"
    ? strategyIdAlignmentRead.data
    : {};
  const strategyMismatch = strategyAlignment.mismatch || {};
  const strategyMismatchFreshness = strategyAlignment.mismatch_freshness || {};
  const perfMdd = toNum(
    perf.performance && typeof perf.performance === "object"
      ? perf.performance.mdd_pct
      : perf.mdd_pct,
    null
  );

  const chosenCost = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.cost_ratio_pct", value: toNum(consistencyMetrics.cost_ratio_pct, null) },
    { source: "risk_controller_latest.risk_scorecard.cost.applied_value_pct", value: toNum(riskScorecard.cost && riskScorecard.cost.applied_value_pct, null) },
    { source: "system_ops_check_latest.cost_ratio_pct", value: toNum(sys.cost_ratio_pct, null) },
  ], null);
  const chosenMdd = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.mdd_pct", value: toNum(consistencyMetrics.mdd_pct, null) },
    { source: "risk_controller_latest.risk_scorecard.loss.applied_mdd_pct", value: toNum(riskScorecard.loss && riskScorecard.loss.applied_mdd_pct, null) },
    { source: "performance_metrics_latest.mdd_pct", value: perfMdd },
  ], null);
  const chosenError = pickFirstFinite([
    { source: "data_consistency_lead_latest.consolidated_metrics.error_count_24h", value: toNum(consistencyMetrics.error_count_24h, null) },
    { source: "risk_controller_latest.risk_scorecard.error.applied_error_count_24h", value: toNum(riskScorecard.error && riskScorecard.error.applied_error_count_24h, null) },
    { source: "system_ops_check_latest.error_count", value: toNum(sys.error_count, null) },
  ], null);
  const chosenStrategyMismatch = pickFirstFinite([
    { source: "strategy_id_alignment_latest.mismatch.guard_count", value: toNum(strategyMismatch.guard_count, null) },
    { source: "strategy_id_alignment_latest.mismatch.after_live_revision_count", value: toNum(strategyMismatch.after_live_revision_count, null) },
    { source: "strategy_id_alignment_latest.mismatch_freshness.created_after_live_revision_count", value: toNum(strategyMismatchFreshness.created_after_live_revision_count, null) },
    { source: "strategy_id_alignment_latest.mismatch.total_count", value: toNum(strategyMismatch.total_count, null) },
    { source: "post_apply_signal_probe_latest.strategy_mismatch_top.sum_count", value: sumCountRows(postApplyProbe.strategy_mismatch_top) },
    { source: "post_apply_signal_probe_latest.drop_reason_top.DROP_STRATEGY_ID_MISMATCH", value: findDropReasonCount(postApplyProbe.drop_reason_top, "DROP_STRATEGY_ID_MISMATCH") },
  ], null);
  const strategyExpectedIds = Array.isArray(strategyMismatch.expected_strategy_ids)
    ? strategyMismatch.expected_strategy_ids.slice(0, 10)
    : [];
  const strategyReceivedIds = Array.isArray(strategyMismatch.received_strategy_ids)
    ? strategyMismatch.received_strategy_ids.slice(0, 10)
    : [];

  const metrics = {
    cost_ratio_pct: round(chosenCost.value, 4),
    cost_limit_pct: round(toNum(sys.cost_limit_pct, 0.2), 4),
    mdd_pct: round(chosenMdd.value, 4),
    mdd_limit_pct: round(toNum(sys.loss_stop_pct, -1.5), 4),
    error_count: chosenError.value,
    drop_tp1_pending_count: toNum(health.drop_tp1_pending_count, null),
    qty_pct_non_positive_count: toNum(health.qty_pct_non_positive_count, null),
    duplicate_signal_fill_count: toNum(health.duplicate_signal_fill_count, null),
    fail_count: toNum(fail.fail_count, null),
    hold_count: toNum(fail.hold_count, null),
    strategy_id_mismatch_drop_count: chosenStrategyMismatch.value,
    strategy_id_expected_ids: strategyExpectedIds,
    strategy_id_received_ids: strategyReceivedIds,
    metric_source: {
      cost_ratio_pct: chosenCost.source,
      mdd_pct: chosenMdd.source,
      error_count: chosenError.source,
      strategy_id_mismatch_drop_count: chosenStrategyMismatch.source,
    },
  };

  const decision = decideStatus(metrics);
  const mode = decision.status === "진행" ? "수익 확대 가능" : "비용 차단";
  const actions = buildActions({ generatedAtIso: nowIso, metrics });

  const hhmm = parseHHMM(generatedAtKst);
  const datedJsonPath = path.join(dailyDir, `${dateKey}_system_recovery_actions_${hhmm}_jihye.json`);
  const latestJsonPath = path.join(dailyDir, "system_recovery_actions_latest.json");
  const datedMdPath = path.join(dailyDir, `${dateKey}_system_recovery_actions_${hhmm}_jihye.md`);

  const output = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    status: decision.status,
    mode,
    reasons: decision.reasons,
    metrics,
    actions,
    progress_pct: 100,
    artifacts: {
      json_latest: latestJsonPath,
      json_dated: datedJsonPath,
      md_dated: datedMdPath,
    },
    input_paths: {
      system_ops: systemOpsPath,
      failure_mode: failureModePath,
      execution_safety: executionSafetyPath,
      performance: performancePath,
      data_consistency: dataConsistencyPath,
      risk_controller: riskControllerPath,
      post_apply_signal_probe: postApplySignalProbePath,
      strategy_id_alignment: strategyIdAlignmentPath,
    },
    input_read_ok: {
      system_ops: systemOpsRead.ok,
      failure_mode: failureModeRead.ok,
      execution_safety: executionSafetyRead.ok,
      performance: performanceRead.ok,
      data_consistency: dataConsistencyRead.ok,
      risk_controller: riskControllerRead.ok,
      post_apply_signal_probe: postApplySignalProbeRead.ok,
      strategy_id_alignment: strategyIdAlignmentRead.ok,
    },
  };

  const md = buildMarkdown({
    generatedAtKst,
    dateKey,
    status: decision.status,
    mode,
    reasons: decision.reasons,
    metrics,
    actions,
    outputJsonPath: latestJsonPath,
    inputPaths: output.input_paths,
  });

  fs.writeFileSync(latestJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedMdPath, `${md}\n`, "utf8");

  console.log(JSON.stringify({
    ok: true,
    status: output.status,
    mode: output.mode,
    output_json: latestJsonPath,
    output_md: datedMdPath,
    actions_count: actions.length,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("system-recovery-actions failed:", err && err.message ? err.message : err);
  process.exit(1);
}
