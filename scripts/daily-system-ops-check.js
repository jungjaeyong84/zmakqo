#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { parseErrorCount } = require("./lib/report-metrics");
const { fetchRuntimeErrorSummary24h } = require("./lib/runtime-error-counter");

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function pct(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) return null;
  return (value / base) * 100;
}

function fmt(value, digits = 2) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, data: JSON.parse(raw), raw };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      data: null,
      raw: "",
    };
  }
}

function isLearningEpochActive(summary = {}) {
  if (!summary || typeof summary !== "object") return false;
  if (summary.active === true) return true;
  const status = String(summary.status || "").trim().toUpperCase();
  return status.includes("EPOCH_ACTIVE");
}

function resolveRelaxedCostLimitPct({
  repoRoot,
  baseCostLimitPct,
} = {}) {
  const out = {
    cost_limit_pct: baseCostLimitPct,
    relaxed: false,
    learning_epoch_active: false,
    microstructure_active: false,
    reason: "BASE_LIMIT",
  };
  const objectiveRetrospective = readJsonSafe(path.join(repoRoot, "ops", "daily", "objective_retrospective_latest.json"));
  const learningEpoch = readJsonSafe(path.join(repoRoot, "ops", "daily", "best_self_evolution_server_primary_learning_epoch_latest.json"));
  const display = objectiveRetrospective.ok && objectiveRetrospective.data && objectiveRetrospective.data.display && typeof objectiveRetrospective.data.display === "object"
    ? objectiveRetrospective.data.display
    : {};
  const daily = display.periods && display.periods.DAILY && typeof display.periods.DAILY === "object"
    ? display.periods.DAILY
    : {};
  const micro = daily.execution_microstructure && typeof daily.execution_microstructure === "object"
    ? daily.execution_microstructure
    : (display.execution_microstructure && typeof display.execution_microstructure === "object" ? display.execution_microstructure : {});
  const tp0HitRate = toNum(micro.tp0_hit_rate, null);
  const learningSummary = learningEpoch.ok && learningEpoch.data && typeof learningEpoch.data === "object"
    ? (learningEpoch.data.summary && typeof learningEpoch.data.summary === "object" ? learningEpoch.data.summary : learningEpoch.data)
    : {};
  const learningEpochActive = isLearningEpochActive(learningSummary);
  const microstructureActive = Number.isFinite(tp0HitRate) && tp0HitRate >= toNum(process.env.DAILY_COST_LIMIT_RELAX_TP0_HIT_RATE_MIN, 0.75);
  if (!learningEpochActive || !microstructureActive) {
    out.learning_epoch_active = learningEpochActive;
    out.microstructure_active = microstructureActive;
    out.reason = learningEpochActive ? "MICROSTRUCTURE_NOT_READY" : "LEARNING_EPOCH_INACTIVE";
    return out;
  }
  const relaxedLimit = toNum(process.env.DAILY_COST_LIMIT_PCT_LEARNING_EPOCH, 0.4);
  out.learning_epoch_active = true;
  out.microstructure_active = true;
  out.relaxed = Number.isFinite(relaxedLimit) && relaxedLimit > baseCostLimitPct;
  out.cost_limit_pct = out.relaxed ? relaxedLimit : baseCostLimitPct;
  out.reason = out.relaxed ? "LEARNING_EPOCH_MICROSTRUCTURE_RELAX" : "BASE_LIMIT";
  return out;
}

function pickDocs(input) {
  if (Array.isArray(input)) return input.slice();
  if (input && Array.isArray(input.docs)) return input.docs.slice();
  if (input && Array.isArray(input.rows)) return input.rows.slice();
  if (input && Array.isArray(input.data)) return input.data.slice();
  return [];
}

function docDateKey(row) {
  const candidates = [
    row && row.created_at,
    row && row.updated_at,
    row && row.closed_at,
    row && row.bar_close_time_utc_ms,
  ];
  for (const value of candidates) {
    const key = kstDateKey(value);
    if (key) return key;
  }
  return null;
}

function countDocsForDate(input, dateKey, predicate = null) {
  let count = 0;
  for (const row of pickDocs(input)) {
    if (docDateKey(row) !== dateKey) continue;
    if (typeof predicate === "function" && !predicate(row)) continue;
    count += 1;
  }
  return count;
}

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pickLatestCycleFile(dirPath, regex) {
  if (!fs.existsSync(dirPath)) return null;
  const names = fs.readdirSync(dirPath);
  let best = null;
  for (const name of names) {
    const match = String(name).match(regex);
    if (!match) continue;
    const cycle = Number(match[1]);
    if (!Number.isFinite(cycle)) continue;
    if (!best || cycle > best.cycle || (cycle === best.cycle && name > best.name)) {
      best = { name, cycle };
    }
  }
  return best ? path.join(dirPath, best.name) : null;
}

function findPairCount(pairs, key) {
  for (const row of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (String(row[0]) === key) return toNum(row[1], 0);
  }
  return 0;
}

function sumPairPrefix(pairs, prefix) {
  let total = 0;
  for (const row of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(row) || row.length < 2) continue;
    if (String(row[0]).startsWith(prefix)) total += toNum(row[1], 0);
  }
  return total;
}

function loadExecutionHealth({ repoRoot, dateKey }) {
  const dailyDir = path.join(repoRoot, "ops", "daily");
  const recentDir = path.join(dailyDir, "cache", "firestore_recent");
  const escapedDate = escapeRegex(dateKey);
  const signalsPath = pickLatestCycleFile(
    dailyDir,
    new RegExp(`^${escapedDate}_tp1_trailing_signals_check_cycle(\\d+)\\.json$`)
  );
  const auditPath = pickLatestCycleFile(
    dailyDir,
    new RegExp(`^${escapedDate}_fill_signal_audit_cycle(\\d+)_binancefut\\.json$`)
  );

  const out = {
    available: false,
    signals_source_path: signalsPath || null,
    audit_source_path: auditPath || null,
    recent_signals_source_path: path.join(recentDir, "signals.json"),
    recent_intents_source_path: path.join(recentDir, "order_intents_paper.json"),
    recent_fills_source_path: path.join(recentDir, "fills_paper.json"),
    recent_trades_source_path: path.join(recentDir, "trades_paper.json"),
    firestore_dns_ok: null,
    firestore_dns_host: null,
    signals_count: null,
    drops_count: null,
    drop_tp1_pending_count: null,
    tp1_signal_count: null,
    trailing_signal_count: null,
    intents_count: null,
    fills_count: null,
    trades_count: null,
    audit_issue_count: null,
    qty_pct_non_positive_count: null,
    duplicate_signal_fill_count: null,
  };

  if (signalsPath) {
    const signalsRead = readJsonSafe(signalsPath);
    if (signalsRead.ok && signalsRead.data && typeof signalsRead.data === "object") {
      const s = signalsRead.data;
      out.available = true;
      out.firestore_dns_ok = s.dns_precheck && typeof s.dns_precheck === "object"
        ? s.dns_precheck.ok === true
        : null;
      out.firestore_dns_host = s.dns_precheck && s.dns_precheck.host
        ? String(s.dns_precheck.host)
        : null;
      out.signals_count = toNum(s.signals, null);
      out.drops_count = toNum(s.drops, null);
      out.drop_tp1_pending_count = findPairCount(s.drop_reasons, "DROP_TP_P1_PENDING");
      out.tp1_signal_count = sumPairPrefix(s.events, "EXIT_TP_P1");
      out.trailing_signal_count = sumPairPrefix(s.events, "EXIT_TRAIL");
    }
  }

  if (auditPath) {
    const auditRead = readJsonSafe(auditPath);
    if (auditRead.ok && auditRead.data && typeof auditRead.data === "object") {
      const summary = auditRead.data.summary && typeof auditRead.data.summary === "object"
        ? auditRead.data.summary
        : {};
      out.available = true;
      out.fills_count = toNum(summary.fills_count, null);
      out.audit_issue_count = toNum(summary.issue_count, null);
      out.qty_pct_non_positive_count = toNum(summary.qty_pct_non_positive_count, null);
      out.duplicate_signal_fill_count = toNum(summary.duplicate_signal_fill_count, null);
    }
  }

  const recentSignalsRead = readJsonSafe(out.recent_signals_source_path);
  const recentIntentsRead = readJsonSafe(out.recent_intents_source_path);
  const recentFillsRead = readJsonSafe(out.recent_fills_source_path);
  const recentTradesRead = readJsonSafe(out.recent_trades_source_path);
  const recentSignalsCount = recentSignalsRead.ok ? countDocsForDate(recentSignalsRead.data, dateKey) : null;
  const recentIntentsCount = recentIntentsRead.ok ? countDocsForDate(recentIntentsRead.data, dateKey) : null;
  const recentFillsCount = recentFillsRead.ok ? countDocsForDate(recentFillsRead.data, dateKey) : null;
  const recentTradesCount = recentTradesRead.ok ? countDocsForDate(recentTradesRead.data, dateKey) : null;

  if (
    Number.isFinite(recentSignalsCount)
    || Number.isFinite(recentIntentsCount)
    || Number.isFinite(recentFillsCount)
    || Number.isFinite(recentTradesCount)
  ) {
    out.available = true;
    if (!Number.isFinite(out.signals_count)) out.signals_count = recentSignalsCount;
    if (!Number.isFinite(out.intents_count)) out.intents_count = recentIntentsCount;
    if (!Number.isFinite(out.fills_count)) out.fills_count = recentFillsCount;
    if (!Number.isFinite(out.trades_count)) out.trades_count = recentTradesCount;
  }

  return out;
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
    || Number.isFinite(health.intents_count)
    || Number.isFinite(health.trades_count)
    || Number.isFinite(health.audit_issue_count)
    || Number.isFinite(health.qty_pct_non_positive_count)
    || Number.isFinite(health.duplicate_signal_fill_count)
  );
  return hasSignalSide && hasFillSide;
}

function decideStatus({
  netPnlPct,
  costRatioPct,
  errorCount,
  costLimitPct,
  lossStopPct,
  stopErrorCount,
  executionHealth,
}) {
  const reasons = [];
  let status = "진행";

  if (Number.isFinite(netPnlPct) && netPnlPct <= lossStopPct) {
    status = "중단";
    reasons.push(`일 손실률 ${fmt(netPnlPct)}% <= ${fmt(lossStopPct)}%`);
  }

  if (Number.isFinite(errorCount) && errorCount >= stopErrorCount) {
    status = "중단";
    reasons.push(`핵심 오류 ${errorCount}건 >= ${stopErrorCount}건`);
  }

  if (status !== "중단") {
    if (Number.isFinite(costRatioPct) && costRatioPct > costLimitPct) {
      status = "보류";
      reasons.push(`비용 비율 ${fmt(costRatioPct)}% > ${fmt(costLimitPct)}%`);
    }
    if (Number.isFinite(errorCount) && errorCount >= 1) {
      if (status === "진행") status = "보류";
      reasons.push(`24시간 오류 ${errorCount}건`);
    }
    if (!hasExecutionFlowCoverage(executionHealth)) {
      if (status === "진행") status = "보류";
      reasons.push("신호→주문→체결 감사 데이터 미수집");
    }
    if (executionHealth && executionHealth.available) {
      if (executionHealth.firestore_dns_ok === false) {
        if (status === "진행") status = "보류";
        reasons.push("Firestore DNS 사전점검 실패");
      }
      if (Number.isFinite(executionHealth.drop_tp1_pending_count) && executionHealth.drop_tp1_pending_count >= 500) {
        if (status === "진행") status = "보류";
        reasons.push(`DROP_TP_P1_PENDING ${executionHealth.drop_tp1_pending_count}건`);
      }
      if (Number.isFinite(executionHealth.qty_pct_non_positive_count) && executionHealth.qty_pct_non_positive_count >= 1) {
        if (status === "진행") status = "보류";
        reasons.push(`체결 수량 비율 이상치 ${executionHealth.qty_pct_non_positive_count}건`);
      }
    }
  }

  if (!reasons.length) reasons.push("핵심 리스크 신호 없음");
  return { status, reasons };
}

function buildIssueLines(summary) {
  const lines = [];
  const health = summary.execution_health || {};
  const flowCoverageReady = hasExecutionFlowCoverage(health);

  if (Number.isFinite(summary.cost_ratio_pct) && Number.isFinite(summary.cost_limit_pct) && summary.cost_ratio_pct > summary.cost_limit_pct) {
    lines.push(`[ISSUE] H | 비용 비율 ${fmt(summary.cost_ratio_pct)}%로 상한 ${fmt(summary.cost_limit_pct)}% 초과 | 신규 진입 확대 금지 유지`);
  } else {
    lines.push("[ISSUE] L | 비용 비율 상한 내 유지 | 현재 비용 차단 규칙 유지");
  }

  if (Number.isFinite(summary.error_count) && summary.error_count >= 1) {
    lines.push(`[ISSUE] M | 최근 24시간 오류 ${summary.error_count}건 존재 | 동일 오류 재발 방지 2건 실행 필요`);
  } else {
    lines.push("[ISSUE] L | 최근 24시간 핵심 오류 없음 | 현재 장애 복구 플랜 유지");
  }

  if (Number.isFinite(summary.net_pnl_pct) && Number.isFinite(summary.gap_pct) && summary.gap_pct < 0) {
    lines.push(`[ISSUE] M | 순손익 ${fmt(summary.net_pnl_pct)}%로 월 목표 일평균 대비 ${fmt(summary.gap_pct)}%p 미달 | 고비용 구간 진입 억제 적용 필요`);
  }

  if (health.available) {
    if (health.firestore_dns_ok === false) {
      lines.push("[ISSUE] H | Firestore DNS 사전점검 실패 | DNS/네트워크 복구 전 원본 검증 보류");
    }
    if (Number.isFinite(health.drop_tp1_pending_count) && health.drop_tp1_pending_count >= 500) {
      lines.push(`[ISSUE] M | DROP_TP_P1_PENDING ${health.drop_tp1_pending_count}건 누적 | TP1 대기 잠금 해제 조건 원인 분류 필요`);
    }
    if (Number.isFinite(health.qty_pct_non_positive_count) && health.qty_pct_non_positive_count >= 1) {
      lines.push(`[ISSUE] M | 체결 수량 비율 이상치 ${health.qty_pct_non_positive_count}건 | 수량 비율 필드 누락 방지 규칙 점검 필요`);
    }
    if (Number.isFinite(health.duplicate_signal_fill_count) && health.duplicate_signal_fill_count >= 5) {
      lines.push(`[ISSUE] M | 동일 신호 다중 체결 ${health.duplicate_signal_fill_count}건 | 중복 체결 허용 범위 재검토 필요`);
    }
    if (!flowCoverageReady) {
      lines.push("[ISSUE] H | 신호/체결 한쪽 데이터가 비어 전체 흐름 점검 불가 | 데이터 수집 복구 전 수익 확대 금지");
    }
  } else {
    lines.push("[ISSUE] H | 주문 경로 감사 파일 미수집 | 신호/체결 점검 스크립트 재실행 및 수집 경로 복구 필요");
  }

  return lines;
}

function buildMarkdown({
  dateKey,
  generatedAtKst,
  snapshotPath,
  reportPath,
  executionHealth,
  summary,
  outputJsonPath,
}) {
  const mode = summary.status === "진행" ? "수익 확대 가능" : "비용 차단";
  const statusLine = `${summary.status} (${summary.reasons.join(" / ")})`;
  const executionCheckDone = executionHealth && executionHealth.available;
  const health = executionHealth || {};
  const issueLines = buildIssueLines(summary);
  const approvalLines = (Array.isArray(summary.approvals) ? summary.approvals : [])
    .map((item) =>
      `[USER_APPROVAL_REQUIRED] ${item.title} | ${item.reason} | ${item.action}`
    )
    .join("\n");
  const approvalSection = approvalLines
    ? `\n- 승인 필요사항\n${approvalLines}`
    : "\n- 승인 필요사항: 없음";

  return `# ${dateKey} 시스템 일일 운영 가드 보고 (시스템 개발 담당)

기준 시각: ${summary.snapshot_end_kst || generatedAtKst}
생성 시각: ${generatedAtKst}
기준 데이터: \`${snapshotPath}\`, \`${reportPath}\`

## 시스템 설계
- 신호→주문→체결 흐름에서 \`비용 비율\`, \`순손익\`, \`오류 건수\` 3개 지표로 오늘 상태를 자동 판정합니다.
- 주문 경로 건강도(\`DNS\`, \`TP1/트레일링 신호\`, \`신호-체결 감사 이슈\`)를 같은 보고서에 결합해 장애 조기 감지를 강화합니다.
- 상태가 \`보류\` 또는 \`중단\`이면 신규 진입 확대를 막고, 운영 가드 모드를 자동으로 \`비용 차단\`으로 고정합니다.
- API 안전장치는 \`중복주문 방지 키\`, \`재시도 상한\`, \`오류 로그 추적\` 3개를 기본으로 유지합니다.

## 구현 태스크
1. \`scripts/daily-system-ops-check.js\` 실행: 스냅샷/리포트 읽기, 수치 계산, 상태 판정, 결과 저장.
2. 자동 산출물 생성: \`${outputJsonPath}\` (기계 점검용 JSON), 일일 보고서(현재 문서).
3. 오늘 수치 계산 완료
   - 비용 비율: \`${fmt(summary.cost_ratio_pct)}%\` (상한 \`${fmt(summary.cost_limit_pct)}%\`)
   - 순손익: \`${fmt(summary.net_pnl_usdt)} USDT\` (\`${fmt(summary.net_pnl_pct)}%\`)
   - 월 5% 기준 일평균 필요치: \`${fmt(summary.required_daily_pct)}%\`, 오늘 격차: \`${fmt(summary.gap_pct)}%p\`
   - 오류(24h): \`${summary.error_count == null ? "N/A" : summary.error_count}\`건
4. 주문 경로 건강도 점검 완료
   - Firestore DNS: \`${health.firestore_dns_ok === null ? "N/A" : (health.firestore_dns_ok ? "정상" : "실패")}\` (${health.firestore_dns_host || "host N/A"})
   - 신호/인텐트/체결/트레이드: \`${health.signals_count == null ? "N/A" : health.signals_count}\` / \`${health.intents_count == null ? "N/A" : health.intents_count}\` / \`${health.fills_count == null ? "N/A" : health.fills_count}\` / \`${health.trades_count == null ? "N/A" : health.trades_count}\`
   - TP1/트레일링 신호: \`${health.tp1_signal_count == null ? "N/A" : health.tp1_signal_count}\` / \`${health.trailing_signal_count == null ? "N/A" : health.trailing_signal_count}\`
   - DROP_TP_P1_PENDING: \`${health.drop_tp1_pending_count == null ? "N/A" : health.drop_tp1_pending_count}\`건
   - 감사 이슈/중복체결: \`${health.audit_issue_count == null ? "N/A" : health.audit_issue_count}\`건 / \`${health.duplicate_signal_fill_count == null ? "N/A" : health.duplicate_signal_fill_count}\`건
5. 오늘 운영 가드 모드 확정: \`${mode}\`

## 장애/보안 리스크
${issueLines.join("\n")}

## 운영 체크리스트
- [x] 기준 데이터 시각 확인 (${summary.snapshot_end_kst || "N/A"})
- [x] 비용/손익/오류 3개 지표 재계산
- ${executionCheckDone ? "[x]" : "[ ]"} 주문 경로 건강도 점검 (${executionCheckDone ? "완료" : "파일 미수집"})
- [x] 상태 판정 (${statusLine})
- [x] 비용 초과 시 운영 가드 모드 \`비용 차단\` 고정
- [ ] 20:30 KST까지 오류 재발방지 액션 2건 확정
- [ ] 21:30 KST 최종 보고용 수치 재검증

## 대표 보고 요약
- 오늘 운영 가드 판정은 \`${summary.status}\`입니다.
- 이유: ${summary.reasons.join(", ")}
- 독립 실행안: 비용 초과 경보 자동화 + 오류 재발방지 2건 제출 + 21:30 재검증 자동 실행.
- 지혜 의사결정 요청: 비용 비율 0.20% 복귀 전 \`신규 진입 확대 금지\` 유지 여부 최종 확정.
- 지혜 의사결정 요청(승인): 아래 승인 항목 확인 필요
- 지혜를 통한 협업 요청
  - 성과분석: 수수료 상위 원인 3개와 절감효과(20/30%) 수치 전달 요청
  - 퀀트: 고비용 시간대 회피 A/B안의 검증 우선순위 전달 요청
  - 품질: 21:30 보고 전 손익/비용/자산 정합성 재확인 요청
[EVOLUTION] 수동 계산 위주 운영에서 자동 판정 스크립트 기반으로 전환 | 보고 속도와 수치 일관성 개선${approvalSection}
`;
}

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const snapshotPath = process.argv[2] || path.join(repoRoot, "noye", "binance_snapshot_latest.json");
  const reportPath = process.argv[3] || path.join(repoRoot, "noye", "report.md");

  const snapshotRaw = fs.readFileSync(snapshotPath, "utf8");
  const reportRaw = fs.readFileSync(reportPath, "utf8");
  const snapshot = JSON.parse(snapshotRaw);

  const baseCostLimitPct = toNum(process.env.DAILY_COST_LIMIT_PCT, 0.20);
  const costLimitDecision = resolveRelaxedCostLimitPct({
    repoRoot,
    baseCostLimitPct,
  });
  const costLimitPct = toNum(costLimitDecision.cost_limit_pct, baseCostLimitPct);
  const lossStopPct = toNum(process.env.DAILY_LOSS_STOP_PCT, -1.5);
  const monthlyTargetPct = toNum(process.env.MONTHLY_TARGET_PCT, 5.0);
  const stopErrorCount = toNum(process.env.STOP_ERROR_COUNT, 2);

  const equity = toNum(snapshot.total_equity, 0);
  const realizedPnl = toNum(snapshot.realized_pnl, 0);
  const commission = toNum(snapshot.commission, 0);
  const funding = toNum(snapshot.funding, 0);

  const costTotalSigned = commission + funding;
  const costTotalAbs = Math.abs(costTotalSigned);
  const costRatioPct = pct(costTotalAbs, equity);

  const netPnlUsdt = realizedPnl + costTotalSigned;
  const netPnlPct = pct(netPnlUsdt, equity);

  const requiredDailyPct = monthlyTargetPct / 30;
  const gapPct = Number.isFinite(netPnlPct) ? (netPnlPct - requiredDailyPct) : null;

  const runtimeErrorSummary = await fetchRuntimeErrorSummary24h({}).catch(() => null);
  const runtimeErrorCount = toNum(runtimeErrorSummary && runtimeErrorSummary.error_count_24h, null);
  const snapshotErrorCount = toNum(snapshot && snapshot.derived && snapshot.derived.error_count_24h, null);
  const reportErrorCount = parseErrorCount(reportRaw);
  const errorCount = Number.isFinite(runtimeErrorCount)
    ? runtimeErrorCount
    : (Number.isFinite(snapshotErrorCount) ? snapshotErrorCount : reportErrorCount);

  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(snapshot.end_kst || nowIso) || kstDateKey(nowIso) || "unknown-date";
  const executionHealth = loadExecutionHealth({ repoRoot, dateKey });

  const summary = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    snapshot_end_kst: toKstString(snapshot.end_kst, { fallbackToString: true }),
    status: "진행",
    reasons: [],
    total_equity_usdt: round(equity, 8),
    realized_pnl_usdt: round(realizedPnl, 8),
    commission_usdt: round(commission, 8),
    funding_usdt: round(funding, 8),
    cost_total_usdt: round(costTotalSigned, 8),
    cost_ratio_pct: round(costRatioPct, 4),
    net_pnl_usdt: round(netPnlUsdt, 8),
    net_pnl_pct: round(netPnlPct, 4),
    monthly_target_pct: round(monthlyTargetPct, 4),
    required_daily_pct: round(requiredDailyPct, 4),
    gap_pct: round(gapPct, 4),
    cost_limit_pct: round(costLimitPct, 4),
    cost_limit_base_pct: round(baseCostLimitPct, 4),
    cost_limit_relaxed: costLimitDecision.relaxed === true,
    cost_limit_reason: costLimitDecision.reason,
    learning_epoch_active: costLimitDecision.learning_epoch_active,
    microstructure_cost_relax_ready: costLimitDecision.microstructure_active,
    loss_stop_pct: round(lossStopPct, 4),
    stop_error_count: stopErrorCount,
    error_count: Number.isFinite(errorCount) ? errorCount : null,
    error_count_source: Number.isFinite(runtimeErrorCount)
      ? "runtime_error_counter"
      : (Number.isFinite(snapshotErrorCount) ? "snapshot.derived.error_count_24h" : (Number.isFinite(reportErrorCount) ? "report_parse" : "unresolved")),
    mode: "수익 확대 가능",
    execution_health: executionHealth,
    approvals: [],
  };

  const statusResultWithHealth = decideStatus({
    netPnlPct,
    costRatioPct,
    errorCount,
    costLimitPct,
    lossStopPct,
    stopErrorCount,
    executionHealth,
  });
  summary.status = statusResultWithHealth.status;
  summary.reasons = statusResultWithHealth.reasons;
  summary.mode = summary.status === "진행" ? "수익 확대 가능" : "비용 차단";

  if (Number.isFinite(costRatioPct) && costRatioPct > costLimitPct) {
    summary.approvals.push({
      title: "72시간 신규 진입 규모 30% 축소",
      reason: `비용 비율 ${fmt(costRatioPct)}%가 상한 ${fmt(costLimitPct)}%를 초과한 상태에서 추가 비용 누수를 막기 위해`,
      action: "승인 시 72시간 동안 신규 진입 수량 상한을 현재 대비 30% 낮춰 적용",
    });
  }

  const outputJsonPath = path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const outputMdPath = path.join(repoRoot, "ops", "daily", `${dateKey}_system_auto_execution_jihye.md`);
  const md = buildMarkdown({
    dateKey,
    generatedAtKst,
    snapshotPath,
    reportPath,
    executionHealth,
    summary,
    outputJsonPath,
  });
  fs.writeFileSync(outputMdPath, md, "utf8");

  console.log(JSON.stringify({
    ok: true,
    output_json: outputJsonPath,
    output_md: outputMdPath,
    status: summary.status,
    mode: summary.mode,
    cost_ratio_pct: summary.cost_ratio_pct,
    net_pnl_pct: summary.net_pnl_pct,
    error_count: summary.error_count,
    execution_health_available: executionHealth.available,
    drop_tp1_pending_count: executionHealth.drop_tp1_pending_count,
    qty_pct_non_positive_count: executionHealth.qty_pct_non_positive_count,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("daily-system-ops-check failed:", err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    pickDocs,
    docDateKey,
    countDocsForDate,
    loadExecutionHealth,
    hasExecutionFlowCoverage,
    isLearningEpochActive,
    resolveRelaxedCostLimitPct,
  },
};
