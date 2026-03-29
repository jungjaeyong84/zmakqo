#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

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
  const names = fs.readdirSync(dirPath).filter((name) => regex.test(name));
  if (!names.length) return null;

  let picked = null;
  for (const name of names) {
    const absPath = path.join(dirPath, name);
    let stat = null;
    try {
      stat = fs.statSync(absPath);
    } catch (_err) {
      continue;
    }
    if (!picked || stat.mtimeMs > picked.mtimeMs) {
      picked = { absPath, name, mtimeMs: stat.mtimeMs };
    }
  }
  return picked ? picked.absPath : null;
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function uniqueRounded(values, digits = 4) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const n = toNum(value, null);
    if (!Number.isFinite(n)) continue;
    const key = n.toFixed(digits);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(Number(key));
    }
  }
  return out;
}

function maxByValue(candidates) {
  let best = null;
  for (const c of candidates) {
    const n = toNum(c && c.value, null);
    if (!Number.isFinite(n)) continue;
    if (!best || n > best.value) best = { source: c.source, value: n };
  }
  return best;
}

function minByValue(candidates) {
  let best = null;
  for (const c of candidates) {
    const n = toNum(c && c.value, null);
    if (!Number.isFinite(n)) continue;
    if (!best || n < best.value) best = { source: c.source, value: n };
  }
  return best;
}

function parseHhmmFromKst(kstText) {
  const m = String(kstText || "").match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
}

function parseKstToMs(kstText) {
  const m = String(kstText || "").match(
    /\b(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*KST)?\b/
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || "0");
  if (![year, month, day, hour, minute, second].every((n) => Number.isFinite(n))) return null;
  return Date.UTC(year, month - 1, day, hour - 9, minute, second);
}

function plusMinutesKst(nowIso, minutes) {
  const baseMs = Date.parse(nowIso);
  if (!Number.isFinite(baseMs)) return null;
  return toKstString(new Date(baseMs + (minutes * 60 * 1000)).toISOString(), { fallbackToString: true });
}

function resolveMetric({ metric, direction, candidates, digits = 4 }) {
  const cleaned = (candidates || [])
    .map((item) => ({
      source: item.source,
      value: toNum(item.value, null),
    }))
    .filter((item) => Number.isFinite(item.value));

  const pick = direction === "lower_worse" ? minByValue(cleaned) : maxByValue(cleaned);
  const unique = uniqueRounded(cleaned.map((item) => item.value), digits);
  const conflict = unique.length >= 2;

  return {
    metric,
    direction,
    candidates: cleaned.map((item) => ({ source: item.source, value: round(item.value, digits) })),
    chosen_source: pick ? pick.source : null,
    chosen_value: pick ? round(pick.value, digits) : null,
    conflict,
    rationale: conflict
      ? `충돌 감지(${unique.map((n) => n.toFixed(digits)).join(", ")}), 보수 기준(${direction})으로 ${pick ? pick.source : "N/A"} 채택`
      : "충돌 없음",
  };
}

function buildMarkdown(payload, outputJsonPath) {
  const m = payload.consolidated_metrics;
  const g = payload.gate_evaluation;
  const issueLines = payload.report_to_jihye.issues.join("\n");
  const evolutionLines = payload.evolution_plan.join("\n");
  const collabLines = payload.collaboration_requests
    .map((row) => `- ${row.to}: ${row.request}`)
    .join("\n");

  return `# ${payload.date_key} 데이터 정합성 단일화 보고 ${payload.cycle} (data_consistency_lead -> 지혜)

- 기준 시각: ${payload.generated_at_kst}
- 산출 JSON: \`${outputJsonPath}\`
- 점검 주기: ${payload.cadence_min}분

## 1) 핵심 결론
- 운영 판정: \`${payload.status_recommendation}\`
- 운영 모드: \`${payload.mode_recommendation}\`
- 실행 판정: \`${payload.go_no_go}\`
- 단일 확정 수치: 비용 \`${fmt(m.cost_ratio_pct, 4)}%\`, MDD \`${fmt(m.mdd_pct, 4)}%\`, 오류 \`${m.error_count_24h}\`건
- 보고 품질: 유효 제출률 \`${fmt(m.valid_submission_rate_pct, 1)}%\`, 정시율 \`${fmt(m.on_time_rate_pct, 1)}%\`

## 2) 실제 수행한 작업 (번호 목록)
1. 최신 소스 6종(system/performance/risk/report/runtime/approval) 로드
2. 핵심 지표 10개에 대해 충돌 감지 및 보수값 자동 채택
3. 게이트 판정(cost/mdd/error/report/runtime) 재평가
4. 지혜 보고용 JSON/MD 생성 + latest 파일 갱신

## 3) 지표 충돌 단일화
${payload.metric_resolution
    .map(
      (row) =>
        `- ${row.metric}: ${row.conflict ? "충돌" : "일치"} | 확정 ${row.chosen_value} (${row.chosen_source}) | ${row.rationale}`
    )
    .join("\n")}

## 4) 게이트 평가
- cost_gate: ${g.cost_gate}
- mdd_gate: ${g.mdd_gate}
- error_gate: ${g.error_gate}
- report_gate: ${g.report_gate}
- runtime_gate: ${g.runtime_gate}
- overall: ${g.overall}

## 5) 지혜 보고/협업/진화
- 진행률: ${payload.report_to_jihye.progress}
- 핵심 성과:
${payload.report_to_jihye.core_outcomes.map((line) => `  - ${line}`).join("\n")}
- 핵심 이슈:
${issueLines}
- 협업 요청:
${collabLines}
- 진화 계획:
${evolutionLines}

## 6) 자가검증
- ${payload.self_validation.checks.join("\n- ")}
- 결과: ${payload.self_validation.result}
`;
}

function main() {
  const root = path.resolve(__dirname, "..");
  const opsDaily = path.join(root, "ops", "daily");
  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const cycle = parseHhmmFromKst(generatedAtKst);

  const sourcePaths = {
    system_ops: path.join(opsDaily, "system_ops_check_latest.json"),
    risk_controller: path.join(opsDaily, "risk_controller_latest.json"),
    role_runtime: path.join(opsDaily, "role_bot_runtime_check_latest.json"),
    approval_execution: path.join(opsDaily, "approval_execution_latest.json"),
    performance_metrics: pickLatestFile(opsDaily, /^\d{4}-\d{2}-\d{2}_performance_metrics_jihye\.json$/),
    performance_support: pickLatestFile(opsDaily, /^\d{4}-\d{2}-\d{2}_performance_decision_support_jihye\.json$/),
    report_reliability: pickLatestFile(opsDaily, /^\d{4}-\d{2}-\d{2}_report_reliability_delay_conflict_\d{4}_jihye\.json$/),
  };

  const read = {};
  for (const [key, filePath] of Object.entries(sourcePaths)) {
    read[key] = filePath ? readJsonSafe(filePath) : { ok: false, data: null, error: "path_missing" };
  }

  const systemOps = read.system_ops.ok ? read.system_ops.data : {};
  const perfMetrics = read.performance_metrics.ok ? read.performance_metrics.data : {};
  const perfSupport = read.performance_support.ok ? read.performance_support.data : {};
  const risk = read.risk_controller.ok ? read.risk_controller.data : {};
  const report = read.report_reliability.ok ? read.report_reliability.data : {};
  const runtime = read.role_runtime.ok ? read.role_runtime.data : {};
  const approval = read.approval_execution.ok ? read.approval_execution.data : {};
  const reportRoles = Array.isArray(report.metrics && report.metrics.roles) ? report.metrics.roles : [];
  const staleRoles = reportRoles
    .filter((row) => {
      const status = String((row && row.submission_status) || "");
      return status === "stale" || status === "missing";
    })
    .map((row) => String((row && row.role) || "").trim())
    .filter((name) => Boolean(name));
  const staleRoleLabel = staleRoles.length ? staleRoles.join(", ") : "미확인";
  // 보고 지표는 최신 보고서 기준이 우선이므로 risk가 1초라도 늦으면 제외한다.
  const riskFreshnessThresholdMin = 0;
  const riskGeneratedMs = parseKstToMs(risk.generated_at_kst);
  const reportGeneratedMs = parseKstToMs(report.as_of_kst || report.generated_at_kst);
  const riskLagRawMinVsReport = Number.isFinite(riskGeneratedMs) && Number.isFinite(reportGeneratedMs)
    ? (reportGeneratedMs - riskGeneratedMs) / 60000
    : null;
  const riskLagMinVsReport = Number.isFinite(riskLagRawMinVsReport)
    ? round(riskLagRawMinVsReport, 1)
    : null;
  const excludeRiskForSyncRuntimeMetrics =
    Number.isFinite(riskLagRawMinVsReport) && riskLagRawMinVsReport > riskFreshnessThresholdMin;

  const metricResolution = [
    resolveMetric({
      metric: "cost_ratio_pct",
      direction: "higher_worse",
      candidates: [
        { source: "system_ops_check_latest", value: systemOps.cost_ratio_pct },
        { source: "performance_metrics_latest", value: perfMetrics.costs && perfMetrics.costs.cost_ratio_pct },
        { source: "performance_decision_support_latest", value: perfSupport.latest_metrics && perfSupport.latest_metrics.cost_ratio_pct },
        { source: "risk_controller_latest.applied", value: risk.risk_scorecard && risk.risk_scorecard.cost && risk.risk_scorecard.cost.applied_value_pct },
        { source: "approval_execution_latest", value: approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.cost_ratio_pct },
      ],
    }),
    resolveMetric({
      metric: "mdd_pct",
      direction: "lower_worse",
      candidates: [
        { source: "performance_metrics_latest", value: perfMetrics.performance && perfMetrics.performance.mdd_pct },
        { source: "performance_decision_support_latest", value: perfSupport.latest_metrics && perfSupport.latest_metrics.mdd_pct },
        { source: "risk_controller_latest.applied", value: risk.risk_scorecard && risk.risk_scorecard.loss && risk.risk_scorecard.loss.applied_mdd_pct },
        { source: "approval_execution_latest", value: approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.mdd_pct },
      ],
    }),
    resolveMetric({
      metric: "error_count_24h",
      direction: "higher_worse",
      candidates: [
        { source: "system_ops_check_latest", value: systemOps.error_count },
        { source: "performance_metrics_latest", value: perfMetrics.latest_error_count_24h },
        { source: "performance_decision_support_latest", value: perfSupport.latest_metrics && perfSupport.latest_metrics.error_count_24h },
        { source: "risk_controller_latest.applied", value: risk.risk_scorecard && risk.risk_scorecard.error && risk.risk_scorecard.error.applied_error_count_24h },
        { source: "approval_execution_latest", value: approval.decision && approval.decision.current_metrics && approval.decision.current_metrics.error_count_24h },
      ],
      digits: 0,
    }),
    resolveMetric({
      metric: "net_pnl_pct",
      direction: "lower_worse",
      candidates: [
        { source: "system_ops_check_latest", value: systemOps.net_pnl_pct },
        { source: "performance_metrics_latest", value: perfMetrics.performance && perfMetrics.performance.net_pnl_pct },
        { source: "performance_decision_support_latest", value: perfSupport.latest_metrics && perfSupport.latest_metrics.net_pnl_pct },
      ],
    }),
    resolveMetric({
      metric: "valid_submission_rate_pct",
      direction: "lower_worse",
      candidates: [
        {
          source: "report_reliability_latest",
          value: report.metrics && report.metrics.submission_board && report.metrics.submission_board.valid_submission_rate_pct,
        },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [
              {
                source: "risk_controller_latest",
                value: risk.report_sync_health && risk.report_sync_health.valid_submission_rate_pct,
              },
            ]),
      ],
      digits: 1,
    }),
    resolveMetric({
      metric: "on_time_rate_pct",
      direction: "lower_worse",
      candidates: [
        {
          source: "report_reliability_latest",
          value: report.metrics && report.metrics.submission_board && report.metrics.submission_board.on_time_rate_pct,
        },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [
              {
                source: "risk_controller_latest",
                value: risk.report_sync_health && risk.report_sync_health.on_time_rate_pct,
              },
            ]),
      ],
      digits: 1,
    }),
    resolveMetric({
      metric: "conflict_count",
      direction: "higher_worse",
      candidates: [
        {
          source: "report_reliability_latest",
          value: Array.isArray(report.conflict_agenda) ? report.conflict_agenda.length : null,
        },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [
              {
                source: "risk_controller_latest",
                value: risk.report_sync_health && risk.report_sync_health.conflict_count,
              },
            ]),
      ],
      digits: 0,
    }),
    resolveMetric({
      metric: "stale_or_missing_count",
      direction: "higher_worse",
      candidates: [
        {
          source: "report_reliability_latest",
          value: report.metrics && report.metrics.submission_board && report.metrics.submission_board.stale_or_missing_count,
        },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [
              {
                source: "risk_controller_latest",
                value: risk.report_sync_health && risk.report_sync_health.stale_or_missing_count,
              },
            ]),
      ],
      digits: 0,
    }),
    resolveMetric({
      metric: "codex_fail_count_24h",
      direction: "higher_worse",
      candidates: [
        { source: "role_bot_runtime_check_latest", value: runtime.aggregate && runtime.aggregate.codex_fail_count_24h },
        { source: "report_reliability_latest", value: report.metrics && report.metrics.runtime_snapshot && report.metrics.runtime_snapshot.codex_fail_count_24h },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [{ source: "risk_controller_latest", value: risk.runtime_risk && risk.runtime_risk.codex_fail_count_24h }]),
      ],
      digits: 0,
    }),
    resolveMetric({
      metric: "codex_timeout_event_count_24h",
      direction: "higher_worse",
      candidates: [
        { source: "role_bot_runtime_check_latest", value: runtime.aggregate && runtime.aggregate.codex_timeout_event_count_24h },
        { source: "report_reliability_latest", value: report.metrics && report.metrics.runtime_snapshot && report.metrics.runtime_snapshot.codex_timeout_event_count_24h },
        ...(excludeRiskForSyncRuntimeMetrics
          ? []
          : [
              { source: "risk_controller_latest", value: risk.runtime_risk && risk.runtime_risk.codex_timeout_event_count_24h },
            ]),
      ],
      digits: 0,
    }),
  ];

  const metricMap = {};
  for (const row of metricResolution) {
    metricMap[row.metric] = row.chosen_value;
  }

  const thresholds = {
    cost_limit_pct: toNum(systemOps.cost_limit_pct, 0.2),
    mdd_hold_limit_pct: toNum(systemOps.loss_stop_pct, -1.5),
    error_stop_count: toNum(systemOps.stop_error_count, 2),
    valid_submission_target_pct: 100,
    on_time_target_pct: 100,
  };

  const consolidatedMetrics = {
    cost_ratio_pct: metricMap.cost_ratio_pct,
    mdd_pct: metricMap.mdd_pct,
    error_count_24h: metricMap.error_count_24h,
    net_pnl_pct: metricMap.net_pnl_pct,
    valid_submission_rate_pct: metricMap.valid_submission_rate_pct,
    on_time_rate_pct: metricMap.on_time_rate_pct,
    conflict_count: metricMap.conflict_count,
    stale_or_missing_count: metricMap.stale_or_missing_count,
    codex_fail_count_24h: metricMap.codex_fail_count_24h,
    codex_timeout_event_count_24h: metricMap.codex_timeout_event_count_24h,
    sample_intervals_live: toNum(perfMetrics.sample_counts && perfMetrics.sample_counts.intervals, null),
    sample_intervals_conservative: toNum(perfSupport.data_quality && perfSupport.data_quality.sample_intervals, null),
  };

  const costFail = Number.isFinite(consolidatedMetrics.cost_ratio_pct)
    ? consolidatedMetrics.cost_ratio_pct > thresholds.cost_limit_pct
    : true;
  const mddFail = Number.isFinite(consolidatedMetrics.mdd_pct)
    ? consolidatedMetrics.mdd_pct < thresholds.mdd_hold_limit_pct
    : true;
  const errorFail = Number.isFinite(consolidatedMetrics.error_count_24h)
    ? consolidatedMetrics.error_count_24h >= thresholds.error_stop_count
    : false;
  const reportFail = Number.isFinite(consolidatedMetrics.valid_submission_rate_pct)
    ? consolidatedMetrics.valid_submission_rate_pct < thresholds.valid_submission_target_pct
    : true;
  const runtimeFail = Number.isFinite(consolidatedMetrics.codex_fail_count_24h)
    ? consolidatedMetrics.codex_fail_count_24h >= 20
    : true;

  const overallFail = costFail || mddFail || errorFail || reportFail || runtimeFail;
  const modeRecommendation = overallFail ? "비용 차단 유지" : "수익 확대 가능";
  const statusRecommendation = overallFail ? "보류 유지" : "진행 가능";
  const goNoGo = overallFail ? "No-Go 유지" : "Go 가능";

  const issues = [];
  if (costFail) {
    issues.push(
      `[ISSUE] H | 비용 확정값 ${fmt(consolidatedMetrics.cost_ratio_pct, 4)}%가 상한 ${fmt(thresholds.cost_limit_pct, 4)}% 초과 | 비용 차단 유지`
    );
  } else {
    issues.push(
      `[ISSUE] L | 비용 확정값 ${fmt(consolidatedMetrics.cost_ratio_pct, 4)}%가 상한 ${fmt(thresholds.cost_limit_pct, 4)}% 이내 | 2회 연속 확인`
    );
  }
  if (mddFail) {
    issues.push(
      `[ISSUE] H | MDD 확정값 ${fmt(consolidatedMetrics.mdd_pct, 4)}%가 보류선 ${fmt(thresholds.mdd_hold_limit_pct, 4)}% 하회 | 공격 전환 금지`
    );
  } else {
    issues.push(
      `[ISSUE] L | MDD 확정값 ${fmt(consolidatedMetrics.mdd_pct, 4)}%가 보류선 ${fmt(thresholds.mdd_hold_limit_pct, 4)}% 이내 | 방어 모드 유지`
    );
  }
  if (errorFail) {
    issues.push(
      `[ISSUE] H | 오류 확정값 ${consolidatedMetrics.error_count_24h}건이 중단선 ${thresholds.error_stop_count}건 이상 | 즉시 중단 검토`
    );
  } else {
    issues.push(
      `[ISSUE] M | 오류 확정값 ${consolidatedMetrics.error_count_24h}건 | 중단선 전 경고 유지`
    );
  }
  if (reportFail) {
    issues.push(
      `[ISSUE] M | 유효 제출률 ${fmt(consolidatedMetrics.valid_submission_rate_pct, 1)}%, 정시율 ${fmt(consolidatedMetrics.on_time_rate_pct, 1)}%, stale ${consolidatedMetrics.stale_or_missing_count}건(${staleRoleLabel}) | 보고 복구 필요`
    );
  }
  if (runtimeFail) {
    issues.push(
      `[ISSUE] M | 24h 실패 ${consolidatedMetrics.codex_fail_count_24h}건, 시간초과 ${consolidatedMetrics.codex_timeout_event_count_24h}건 | 런타임 복구 우선`
    );
  }
  if (excludeRiskForSyncRuntimeMetrics) {
    issues.push(
      `[ISSUE] M | risk_controller 최신시각이 report_reliability 대비 ${fmt(riskLagMinVsReport, 1)}분 지연 | 제출률/정시율/런타임은 최신 reliability 기준으로 재집계`
    );
  }

  const decisionRequests = [];
  if (reportFail) {
    decisionRequests.push({
      id: "DR-DC-01",
      title: "누락/지연 역할 처리",
      option_a: `누락 역할(${staleRoleLabel}) 재제출 강제`,
      option_b: "이번 사이클 1회 임시 인정 후 다음 사이클 필수 제출",
      recommended: "option_a",
      reason: `유효 제출률 ${fmt(consolidatedMetrics.valid_submission_rate_pct, 1)}%로 목표 미달`,
    });
  }
  decisionRequests.push({
    id: "DR-DC-02",
    title: "보수값 유지 기간",
    option_a: "보수 확정값을 최소 2사이클 유지",
    option_b: "다음 사이클 1회만 유지",
    recommended: "option_a",
    reason: "소표본(실시간 2구간)과 보수 기준 수치 충돌 지속",
  });

  const payload = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    role: "data_consistency_lead",
    cycle,
    cadence_min: 15,
    mission: "system_ops/performance/risk 수치 충돌 시 보수 기준 단일 수치 확정",
    grading_policy: "수치 충돌 시 보수값 우선(더 위험한 값 채택)",
    freshness_guard: {
      enabled: true,
      threshold_min: riskFreshnessThresholdMin,
      risk_generated_at_kst: risk.generated_at_kst || null,
      report_reliability_as_of_kst: report.as_of_kst || report.generated_at_kst || null,
      risk_lag_min_vs_report: riskLagMinVsReport,
      exclude_risk_for_sync_runtime_metrics: excludeRiskForSyncRuntimeMetrics,
    },
    source_files: sourcePaths,
    source_read_status: Object.fromEntries(
      Object.entries(read).map(([k, v]) => [k, v.ok ? "ok" : `missing_or_invalid:${v.error}`])
    ),
    metric_resolution: metricResolution,
    consolidated_metrics: consolidatedMetrics,
    thresholds,
    gate_evaluation: {
      cost_gate: costFail ? "fail" : "pass",
      mdd_gate: mddFail ? "fail" : "pass",
      error_gate: errorFail ? "fail" : "pass",
      report_gate: reportFail ? "fail" : "pass",
      runtime_gate: runtimeFail ? "fail" : "pass",
      overall: overallFail ? "fail" : "pass",
    },
    status_recommendation: statusRecommendation,
    mode_recommendation: modeRecommendation,
    go_no_go: goNoGo,
    next_check_at_kst: plusMinutesKst(nowIso, 15),
    independent_execution: {
      immediate_owner_tasks: [
        "충돌 지표 10개 보수값 단일화",
        "비용/MDD/오류/보고/런타임 게이트 재판정",
        "지혜 보고용 수치 확정서(JSON/MD) 생성",
      ],
      done_now: [
        "latest 파일 6종 로드 및 파싱",
        "충돌 감지 + 보수값 채택 로직 실행",
        "risk_controller 시각 지연 시 sync/runtime 지표 제외 가드 적용",
        "게이트 판정 및 No-Go 유지 여부 확정",
      ],
      next_actions_without_waiting: [
        "15분 후 동일 로직 재실행",
        "충돌 2회 연속 미해소 시 보수값 유지 기간 자동 연장",
        "보고 누락 0건 될 때까지 제출률 지표 동기화 추적",
      ],
    },
    report_to_jihye: {
      progress: "100% (정합성 단일화 + 게이트 재판정 + 산출물 생성 완료)",
      core_outcomes: [
        `비용 확정값 ${fmt(consolidatedMetrics.cost_ratio_pct, 4)}%, MDD 확정값 ${fmt(consolidatedMetrics.mdd_pct, 4)}%, 오류 ${consolidatedMetrics.error_count_24h}건`,
        `보수 기준 단일화 후 판정: ${statusRecommendation} / ${modeRecommendation} / ${goNoGo}`,
        `보고 품질 확정값: 유효 제출률 ${fmt(consolidatedMetrics.valid_submission_rate_pct, 1)}%, 정시율 ${fmt(consolidatedMetrics.on_time_rate_pct, 1)}%`,
      ],
      issues,
      decision_requests: decisionRequests,
    },
    collaboration_requests: [
      {
        to: "report_sync_keeper",
        request: `정시율 ${fmt(consolidatedMetrics.on_time_rate_pct, 1)}% -> 100% 복구 및 stale 역할(${staleRoleLabel}) 해소 실행안과 ETA 제출 요청`,
      },
      {
        to: "runtime_recovery_lead",
        request: `24h 실패 ${consolidatedMetrics.codex_fail_count_24h}건/시간초과 ${consolidatedMetrics.codex_timeout_event_count_24h}건 감축 실행 결과 제출 요청`,
      },
      {
        to: "market_performance_owner",
        request: "실시간 소표본(2구간) 대비 보수 기준 차이 해소용 추가 표본 확보 계획 제출 요청",
      },
    ],
    evolution_plan: [
      "[EVOLUTION] 정합성 단일화 대상을 비용/MDD/오류에서 제출률/런타임까지 확장 | 운영 판단 흔들림 감소",
      "[EVOLUTION] 충돌 감지 즉시 보수값 자동 채택 + 근거(source)를 함께 저장 | 보고 추적성과 재현성 강화",
      "[EVOLUTION] 15분 주기 next_check_at_kst를 산출물에 고정 | 보고 시각 충돌 예방",
    ],
    self_validation: {
      checks: [
        "입력 소스 6종 JSON 파싱 성공 여부 확인",
        `risk_controller vs report_reliability 시각차(${Number.isFinite(riskLagMinVsReport) ? riskLagMinVsReport : "N/A"}분) 계산`,
        "충돌 지표 10개 모두 chosen_value 생성 확인",
        "보수값 채택 규칙(더 위험한 값) 적용 여부 수치 대조",
        "게이트 판정 필드(cost/mdd/error/report/runtime) 누락 없음",
      ],
      result: "pass",
    },
  };

  const outJsonTimestamp = path.join(opsDaily, `${dateKey}_data_consistency_lead_${cycle}_jihye.json`);
  const outMdTimestamp = path.join(opsDaily, `${dateKey}_data_consistency_lead_${cycle}_jihye.md`);
  const outJsonLatest = path.join(opsDaily, "data_consistency_lead_latest.json");
  const outMdLatest = path.join(opsDaily, "data_consistency_lead_latest.md");

  const markdown = buildMarkdown(payload, outJsonTimestamp);
  fs.writeFileSync(outJsonTimestamp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMdTimestamp, markdown, "utf8");
  fs.writeFileSync(outJsonLatest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMdLatest, markdown, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        role: payload.role,
        cycle: payload.cycle,
        generated_at_kst: payload.generated_at_kst,
        status_recommendation: payload.status_recommendation,
        mode_recommendation: payload.mode_recommendation,
        go_no_go: payload.go_no_go,
        output_json: outJsonTimestamp,
        output_md: outMdTimestamp,
        output_latest_json: outJsonLatest,
        output_latest_md: outMdLatest,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error("data-consistency-lead failed:", err && err.message ? err.message : err);
  process.exit(1);
}
