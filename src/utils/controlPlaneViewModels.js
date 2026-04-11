const fs = require("fs");
const path = require("path");
const { unwrapDisplayAndRawReport } = require("./jsonDisplayFields");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const ARTIFACT_INDEX_TTL_MS = Math.max(5_000, Number(process.env.CONTROL_PLANE_ARTIFACT_INDEX_TTL_MS || 30_000));

let artifactIndexCache = {
  tsMs: 0,
  files: [],
};

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_err) {
    return fallback;
  }
}

function tryReadJson(filePath) {
  try {
    return {
      ok: true,
      data: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err && err.message ? String(err.message) : "JSON_READ_FAILED",
    };
  }
}

function hasArtifactContent(file = null) {
  if (!file || typeof file !== "object") return false;
  if (Array.isArray(file)) return file.length > 0;
  return Object.keys(file).length > 0;
}

function listDailyArtifactFiles({ force = false } = {}) {
  const nowMs = Date.now();
  if (!force && Array.isArray(artifactIndexCache.files) && artifactIndexCache.files.length && (nowMs - artifactIndexCache.tsMs) <= ARTIFACT_INDEX_TTL_MS) {
    return artifactIndexCache.files.slice();
  }
  let files = [];
  try {
    files = fs.readdirSync(OPS_DAILY_DIR).filter((name) => name.endsWith(".json"));
  } catch (_err) {
    files = [];
  }
  artifactIndexCache = {
    tsMs: nowMs,
    files: files.slice(),
  };
  return files;
}

function buildFallbackArtifactCandidates(fileName) {
  const baseName = String(fileName || "").trim();
  if (!baseName.endsWith("_latest.json")) return [];
  const coreName = baseName.slice(0, -"_latest.json".length);
  const suffix = `_${coreName}.json`;
  return listDailyArtifactFiles()
    .filter((name) => name !== baseName && name.endsWith(suffix))
    .sort()
    .reverse();
}

function loadLatestArtifact(fileName) {
  const absPath = path.join(OPS_DAILY_DIR, fileName);
  const latestRead = tryReadJson(absPath);
  let sourceFileName = fileName;
  let sourcePath = absPath;
  let sourceKind = "latest";
  let readError = latestRead.ok ? null : latestRead.error;
  let file = latestRead.ok && hasArtifactContent(latestRead.data) ? latestRead.data : null;

  if (!file) {
    const candidates = buildFallbackArtifactCandidates(fileName);
    for (const candidateName of candidates) {
      const candidatePath = path.join(OPS_DAILY_DIR, candidateName);
      const candidateRead = tryReadJson(candidatePath);
      if (!candidateRead.ok || !hasArtifactContent(candidateRead.data)) continue;
      file = candidateRead.data;
      sourceFileName = candidateName;
      sourcePath = candidatePath;
      sourceKind = latestRead.ok ? "fallback_empty_latest" : "fallback_after_latest_read_fail";
      if (!readError) readError = candidateRead.error;
      break;
    }
  }

  const raw = unwrapDisplayAndRawReport(file);
  const display = file && typeof file === "object" && !Array.isArray(file) && file.display && typeof file.display === "object"
    ? file.display
    : raw;
  const rows =
    (Array.isArray(display && display.rows) && display.rows) ||
    (Array.isArray(raw && raw.rows) && raw.rows) ||
    (Array.isArray(display && display.stage_rows) && display.stage_rows) ||
    (Array.isArray(raw && raw.stage_rows) && raw.stage_rows) ||
    [];
  return {
    fileName,
    absPath,
    sourceFileName,
    sourcePath,
    sourceKind,
    readError,
    missing: !file,
    file,
    raw,
    display,
    summary: (raw && raw.summary) || (display && display.summary) || {},
    currentStatus: (raw && raw.current_status) || (display && display.current_status) || {},
    rows,
  };
}

function statusTone(value) {
  const s = String(value || "").toUpperCase();
  if (!s) return "dim";
  if (s === "COMPLETE" || s === "DONE") return "ok";
  if (s === "IN_PROGRESS") return "warn";
  if (s.includes("PENDING")) return "warn";
  if (s.includes("FAIL") || s.includes("BLOCK") || s.includes("ROLLBACK") || s.includes("DRIFT") || s.includes("NOT_REACHING_EXECUTION") || s === "HOLD" || s === "TIMEOUT_HOLD" || s === "OBJECTIVE_RECOVERY_REQUIRED") return "bad";
  if (["PASS", "OK", "ACTIVE", "APPROVED", "PROMOTE", "READY", "YES", "TRUE", "ON_TRACK"].includes(s) || s.includes("ACTIVE")) return "ok";
  if (s.includes("STABLE")) return "ok";
  if (s.includes("WATCH") || s.includes("MONITOR") || s.includes("WARN") || s.includes("PARTIAL") || s.includes("SHORT") || s.includes("FILL_SHORT") || s === "N/A") return "warn";
  return "dim";
}

function numberText(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function timeText(value) {
  if (value == null || value === "") return "-";
  const ms = Number(value);
  const parsed = Number.isFinite(ms) ? ms : Date.parse(String(value));
  if (!Number.isFinite(parsed)) return compactText(String(value), 32);
  const kst = new Date(parsed + (9 * 60 * 60 * 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())} KST`;
}

function signedNumberText(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${numberText(n, digits)}`;
}

function compactText(value, maxLen = 140) {
  const s = String(value || "").trim();
  if (!s) return "-";
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function joinList(values, fallback = "-") {
  if (!Array.isArray(values) || !values.length) return fallback;
  return values.filter(Boolean).map((v) => String(v)).join(" / ");
}

function sliceList(values, max = 3) {
  if (!Array.isArray(values) || !values.length) return [];
  return values.slice(0, Math.max(0, max));
}

function extractThresholdPair(signatureText) {
  const text = String(signatureText || "");
  const core = text.match(/core_score_abs\\?":(\d+)/);
  const transition = text.match(/transition_core_score_abs\\?":(\d+)/);
  if (core && transition) return `${core[1]}/${transition[1]}`;
  return null;
}

function toDisplayPercent(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${numberText(n * 100, digits)}%`;
}

function buildMarketImpactRows(validation) {
  const rows = Array.isArray(validation && validation.market_objective_deltas)
    ? validation.market_objective_deltas.slice()
    : [];
  rows.sort((a, b) => Math.abs(Number(b && b.candidate_objective_delta) || 0) - Math.abs(Number(a && a.candidate_objective_delta) || 0));
  return rows.slice(0, 6).map((row) => ({
    market: compactText(row.market),
    delta: signedNumberText(row.candidate_objective_delta, 2),
    executed: `${numberText(row.before_metrics && row.before_metrics.executed_n, 0)} -> ${numberText(row.after_metrics && row.after_metrics.executed_n, 0)}`,
    realized: `${numberText(row.before_metrics && row.before_metrics.realized_n, 0)} -> ${numberText(row.after_metrics && row.after_metrics.realized_n, 0)}`,
    win_rate: `${toDisplayPercent(row.before_metrics && row.before_metrics.win_rate, 0)} -> ${toDisplayPercent(row.after_metrics && row.after_metrics.win_rate, 0)}`,
  }));
}

function buildRowsPreview(rows, mapper, limit = 5) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.slice(0, Math.max(0, limit)).map(mapper).filter(Boolean);
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolveRuntimeGuardSoftScale({
  ops = null,
  slo = null,
  anomaly = null,
} = {}) {
  const opsStatus = String(ops && ops.status || "").trim();
  const opsCostRatio = toNum(ops && ops.cost_ratio_pct, null);
  const opsCostLimit = toNum(ops && ops.cost_limit_pct, null);
  const opsActiveErrors = toNum(ops && ops.active_error_count, null);
  const opsAuditIssues = toNum(ops && ops.execution_health && ops.execution_health.audit_issue_count, 0);
  const opsQtyIssues = toNum(ops && ops.execution_health && ops.execution_health.qty_pct_non_positive_count, 0);
  const anomalyState = anomaly && anomaly.state && typeof anomaly.state === "object" ? anomaly.state : {};
  const sloState = slo && slo.state && typeof slo.state === "object" ? slo.state : {};

  if (anomalyState.circuit_breaker_open === true) {
    return { scale: 0, mode: "BLOCK", reason: "CIRCUIT_BREAKER_OPEN" };
  }
  if (opsStatus === "중단") {
    return { scale: 0, mode: "BLOCK", reason: "OPS_GUARD_STOP" };
  }
  if (String(sloState.status || "").trim().toUpperCase() === "BLOCK") {
    return { scale: 0, mode: "BLOCK", reason: String(sloState.reason || "SYSTEM_SLO_BLOCK").trim() || "SYSTEM_SLO_BLOCK" };
  }
  const costHoldSoftScaleReady = (
    opsStatus === "보류"
    && Number.isFinite(opsCostRatio)
    && Number.isFinite(opsCostLimit)
    && opsCostRatio > opsCostLimit
    && (!Number.isFinite(opsActiveErrors) || opsActiveErrors <= 0)
    && (!Number.isFinite(opsAuditIssues) || opsAuditIssues <= 0)
    && (!Number.isFinite(opsQtyIssues) || opsQtyIssues <= 0)
  );
  if (costHoldSoftScaleReady) {
    return { scale: 0.7, mode: "SOFT_SCALE", reason: "OPS_GUARD_HOLD_COST_SOFT_SCALE" };
  }
  if (opsStatus === "보류") {
    return { scale: 0, mode: "BLOCK", reason: "OPS_GUARD_HOLD" };
  }
  return { scale: 1, mode: "PASS", reason: "NO_RUNTIME_GUARD_BLOCK" };
}

function formatRuntimeGuardReason(code) {
  const key = String(code || "").trim().toUpperCase();
  const map = {
    OPS_GUARD_HOLD: "운영 보류",
    OPS_GUARD_STOP: "운영 중단",
    ANOMALY_SYSTEM_SLO_HOLD: "시스템 SLO 보류 연동",
    ANOMALY_OPS_GUARD_HOLD: "운영 보류 연동",
    ANOMALY_LATENCY_P95_HIGH: "실행 지연 높음",
    EXECUTION_LATENCY_P95_HIGH: "실행 지연 높음",
    OPS_GUARD_HOLD_COST_SOFT_SCALE: "비용 홀드 감속 적용",
    CIRCUIT_BREAKER_OPEN: "서킷 브레이커 열림",
    NO_RUNTIME_GUARD_BLOCK: "추가 차단 없음",
  };
  return map[key] || compactText(code);
}

function buildArtifactHealthCard(artifacts = [], { limit = 6 } = {}) {
  const degraded = (Array.isArray(artifacts) ? artifacts : []).filter((artifact) => artifact && (artifact.missing || artifact.sourceKind !== "latest"));
  if (!degraded.length) return null;
  return {
    title: "Artifact Health",
    tone: degraded.some((artifact) => artifact.missing) ? "bad" : "warn",
    rows: buildRowsPreview(degraded, (artifact) => ({
      label: compactText(String(artifact.fileName || "").replace(/_latest\.json$/i, ""), 28),
      value: artifact.missing
        ? "MISSING"
        : (artifact.sourceKind === "fallback_after_latest_read_fail" ? "FALLBACK_AFTER_READ_FAIL" : "FALLBACK_EMPTY_LATEST"),
    }), limit),
    notes: degraded.slice(0, limit).map((artifact) => compactText(`${artifact.fileName} -> ${artifact.sourceFileName || "missing"}`, 120)),
  };
}

function buildUrl(basePath, params = {}) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    qs.set(key, String(value));
  });
  const query = qs.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildLink(label, href) {
  if (!href) return label || "-";
  return { label: label || href, href };
}

function buildStrategyLatestHref(period) {
  const key = String(period || "").trim().toLowerCase();
  if (!key) return null;
  return `/dashboard/strategy-latest?period=${encodeURIComponent(key)}`;
}

function buildStrategyCard(title, artifact, fallbackStatus, period) {
  const lines = Array.isArray(artifact && artifact.raw && artifact.raw.lines)
    ? artifact.raw.lines.filter(Boolean)
    : [];
  const hasStrategy = lines.length > 0;
  const rows = hasStrategy
    ? lines.slice(0, 4).map((line, index) => ({
        label: `${index + 1}`,
        value: compactText(line, 180),
      }))
    : [{ label: "안내", value: compactText(fallbackStatus || "아직 생성되지 않았습니다.", 180) }];
  return {
    title,
    tone: hasStrategy ? "ok" : "warn",
    rows: [
      { label: "상태", value: hasStrategy ? "READY" : "PENDING" },
      { label: "기준", value: compactText(artifact && artifact.raw && artifact.raw.source) },
      { label: "갱신 시각", value: compactText(artifact && artifact.raw && artifact.raw.generated_at_kst) },
      ...rows,
    ],
    actions: hasStrategy && period ? [{ label: "원문 보기", href: buildStrategyLatestHref(period), tone: "ghost" }] : [],
  };
}

const UI_TEXT_MAP = {
  "Mission Control": "미션 컨트롤",
  "Objective Recovery": "목표 회복",
  "Bundle Deployment": "번들 배포",
  "Canonical Execution": "정본 실행",
  "Cycle and Evidence": "사이클과 증거",
  "Cycle Audit": "사이클 감사",
  "Phase D Acceptance": "Phase D 수용성",
  "Recovery": "회복",
  "Deployment": "배포",
  "Execution": "실행",
  "Audit": "감사",
  "Settings": "설정",
  "Authority": "권한",
  "Objective Score": "목표 점수",
  "Source": "원천",
  "Source Mode": "신호 원천",
  "Phase D": "Phase D",
  "Ops": "운영",
  "Strategic State": "핵심 운영 상태",
  "Operator Strip": "핵심 운영 상태",
  "Runtime Guards": "런타임 가드",
  "Ops Status": "운영 상태",
  "Ops Reason": "운영 보류 사유",
  "Active Errors": "활성 오류",
  "Writer Authority 24h": "Writer Authority 24h",
  "Cost Ratio": "비용 비율",
  "SLO": "시스템 SLO",
  "Anomaly": "이상 감지",
  "Entry Scale": "신규 진입 배율",
  "Scale Reason": "배율 사유",
  "Count": "건수",
  "Severity": "심각도",
  "Action": "조치",
  "Latency P95": "지연 P95",
  "Webhook P95": "웹훅 P95",
  "Slippage P95": "슬리피지 P95",
  "Partial Fill": "부분 체결률",
  "Top Latency": "지연 상위 마켓",
  "Top Delay Cause": "지연 주요 원인",
  "Execution Runtime": "실행 품질",
  "Why Blocked": "현재 막힌 이유",
  "Root Cause": "핵심 원인",
  "Failed Checks": "실패 항목",
  "Projected Score": "예상 점수",
  "Dominant Drag": "주요 악화 마켓",
  "Next Autonomous Action": "다음 자동 행동",
  "Target": "대상",
  "Governor": "거버너",
  "Replay / Canary": "재생 / 카나리",
  "Gap Closure": "격차 회복률",
  "Open Recovery": "회복 보기",
  "Bundle State": "번들 상태",
  "Engine Bundle": "엔진 번들",
  "Policy Bundle": "정책 번들",
  "Shadow Pine": "그림자 Pine",
  "Engine Bundle": "엔진 번들",
  "Policy Bundle": "정책 번들",
  "Shadow Pine": "그림자 Pine",
  "Role": "역할",
  "Execution SOT": "실행 정본",
  "Telegram": "텔레그램",
  "Scheduler": "스케줄러",
  "Evidence Chain": "증거 체인",
  "Deployment": "배포",
  "Execution": "실행",
  "Evidence": "증거",
  "Plan": "계획",
  "Probe": "프로브",
  "Activation": "활성화",
  "Primary Unit": "주 배포 단위",
  "Open Deployment": "배포 보기",
  "Acceptance": "수용성",
  "Executed": "실행",
  "Rollback Trigger": "롤백 트리거",
  "Open Execution": "실행 보기",
  "Open Phase D": "Phase D 보기",
  "Evidence": "증거",
  "Source Parity": "원천 일치",
  "Downstream": "하류 차이",
  "Provenance": "출처 추적",
  "Open Audit": "감사 보기",
  "Current Score": "현재 점수",
  "Projected Score": "예상 점수",
  "Decision": "판단",
  "Score Path": "점수 경로",
  "Release Gates": "출시 게이트",
  "Signal Authority": "정본 신호 상태",
  "Authoritative 24h": "정본 신호(24h)",
  "Shadow 24h": "그림자 신호(24h)",
  "Latest Server": "최근 정본 신호",
  "Latest Shadow": "최근 그림자 신호",
  "Parity Drift": "정합성 드리프트",
  "Source Mode": "원천 모드",
  "Top Server Markets": "정본 상위 마켓",
  "Top Shadow Markets": "그림자 상위 마켓",
  "Signal Quality": "정본 실행 품질",
  "Entry 24h": "엔트리 신호(24h)",
  "Intent 24h": "주문 의도(24h)",
  "Fill 24h": "체결(24h)",
  "Trade 24h": "거래 완료(24h)",
  "Intent Conversion": "주문 전환율",
  "Fill Conversion": "체결 전환율",
  "Latest Entry": "최근 정본 엔트리",
  "Top Signal Reasons": "주요 신호 사유",
  "Top Entry Markets": "주요 엔트리 마켓",
  "Recent Drift Cases": "최근 드리프트 사례",
  "Main Drift Reason": "주요 드리프트 이유",
  "Main Drop Family": "주요 차단 계열",
  "Mismatch Count": "불일치 수",
  "Quality Status": "품질 상태",
  "Observed": "관측 시각",
  "Market": "마켓",
  "Tier": "등급",
  "Target Delta": "목표 변화폭",
  "Best Replay Delta": "최적 재생 변화폭",
  "Next": "다음 단계",
  "Weekly Report": "주간 리포트",
  "Current": "현재",
  "Projected": "예상",
  "Release Evidence": "배포 증거",
  "Recovery Detail": "회복 상세",
  "Target and Alternative": "현재 대상과 대안",
  "Current Target": "현재 대상",
  "Alternative": "대안",
  "Deploy Unit": "배포 단위",
  "Projected Win Rate": "예상 승률",
  "Projected Avg Ret": "예상 평균 수익률",
  "Higher Delta": "더 큰 변화폭 후보",
  "Higher Delta Value": "더 큰 변화폭",
  "Higher Delta Ready": "자동 적용 가능",
  "Higher Delta Hold": "보류 사유",
  "Retrospective Blockers": "회고 기준 차단 사유",
  "Monthly Failed": "월간 실패 항목",
  "Top Drop Reason": "주요 드롭 사유",
  "Validation": "검증",
  "Objective Delta": "목표 변화폭",
  "Count Delta": "거래 수 변화",
  "Risk Flags": "리스크 표시",
  "Canary State": "카나리 상태",
  "Replay Detail": "재생 상세",
  "Ready Wave": "준비 웨이브",
  "Top Ready": "최우선 준비 시장",
  "Scale Allowed": "확장 허용",
  "Scale Block": "확장 차단",
  "Deployment Guards": "배포 가드",
  "Promotion Ready": "승격 준비",
  "Canary Open Wave": "카나리 개방 웨이브",
  "Memory Blocked": "메모리 차단",
  "Primary": "주 배포 단위",
  "Active Runtime": "현재 런타임",
  "Bundle Pair": "번들 조합",
  "Prepared and Rollback": "준비/롤백",
  "Prepared": "준비본",
  "Rollback": "롤백본",
  "Origin": "출처",
  "Manual Step": "수동 단계",
  "Runtime Evidence": "런타임 증거",
  "Prepared State": "준비 상태",
  "Prepare Pass": "준비 통과",
  "Ack": "확인",
  "Probe Detail": "프로브 상세",
  "Engine Loaded": "엔진 적재",
  "Policy Loaded": "정책 적재",
  "Data Flow": "데이터 흐름",
  "Latest Data": "최근 데이터",
  "Runtime Ack": "런타임 확인",
  "Acknowledged": "확인됨",
  "Plan Status": "계획 상태",
  "Execution Source": "실행 원천",
  "Execution Evidence": "실행 증거",
  "Current Runtime": "현재 런타임",
  "Latest Runtime Row": "최신 런타임 행",
  "At": "시각",
  "Market": "마켓",
  "Type": "유형",
  "Reason": "사유",
  "Open Report": "리포트 열기",
  "Policy Alignment": "정책 정렬",
  "Threshold": "임계값",
  "Policy Reason": "정책 사유",
  "Focused Source": "집중 원천",
  "Parity": "정합성",
  "Observed": "관측",
  "Source Mismatch": "원천 불일치",
  "Downstream Mismatch": "하류 불일치",
  "Stored Evidence": "저장 증거",
  "Eligible": "대상 수",
  "Complete": "완료 수",
  "By Source": "원천별",
  "By Overlay": "오버레이별",
  "Collection": "컬렉션",
  "Open": "열기",
  "Market-Level Evidence": "마켓 단위 증거",
  "Market Parity": "마켓 정합성",
  "Match": "일치",
  "Mismatch": "불일치",
  "Execution Source Breakdown": "실행 원천 분해",
  "Count": "건수",
  "Recent Runtime Rows": "최근 런타임 행",
  "Dataset Preview": "데이터셋 미리보기",
  "Rows": "행 수",
  "Focus Source": "집중 원천",
  "Focus Collection": "집중 컬렉션",
  "Meaning": "의미",
  "Interpretation": "해석",
  "Recent Cache": "최근 캐시",
  "Fallback SOT": "대체 정본",
  "Phase D Gate": "Phase D 기준",
  "Current Market": "현재 시장",
  "Expand Rule": "확장 기준",
  "Acceptance Threshold": "수용 기준",
  "Thresholds": "기준치",
  "Min Executed": "최소 실행",
  "Max Disagreement": "최대 불일치",
  "Max Rollback": "최대 롤백",
  "Ready": "준비",
  "Market Evidence": "마켓 증거",
  "Realized": "실현",
  "Disagreement": "불일치율",
  "Cycle": "사이클",
  "Fresh": "신선도",
  "Watchdog": "감시기",
  "Stage Eval": "단계 재평가",
  "Current Cycle": "현재 사이클",
  "Critical Blockers": "핵심 차단 수",
  "Supervisor": "감독기",
  "Cycle Health": "사이클 상태",
  "Stale": "지연",
  "Current Blocker": "현재 차단 사유",
  "Overall": "종합 상태",
  "Artifact Timeline": "산출물 타임라인",
  "Artifact": "산출물",
  "Generated": "생성 시각",
  "Status": "상태",
  "Critical Loops": "핵심 루프",
  "Loop Rows": "루프 행",
  "Loop": "루프",
  "Stage Autopilot Caveat": "단계 자동조종 주의",
  "Artifact Health": "산출물 상태",
  "Focused Drill-Through": "집중 추적",
  "Focused Target": "집중 대상",
  "Focus": "집중",
  "Next Jump": "다음 이동",
  "Current Evidence": "현재 증거",
  "current cycle, freshness, wrapper caveat을 함께 점검합니다.": "현재 사이클, 최신성, 래퍼 주의사항을 함께 점검합니다.",
  "current cycle + post-loop re-evaluation": "기본 사이클 + 루프 이후 재평가",
  "main cycle + post-loop re-evaluation": "기본 사이클 + 루프 이후 재평가",
  "query-scoped drill-through": "질의 범위에 맞춘 세부 추적",
  "open from Execution tables to focus a target": "실행 표에서 열어 특정 대상을 집중 추적",
  "recent runtime evidence across drop/missed/fallback rows": "드롭·미스·대체 행을 포함한 최근 런타임 증거",
  "signals/signals_dropped/order_intents are currently sparse in local cache": "로컬 캐시의 signals/signals_dropped/order_intents 데이터가 아직 적습니다.",
  "source parity와 provenance를 분리해 보여줍니다.": "원천 일치와 출처 추적을 분리해서 보여줍니다.",
  "Execution/Audit query focus를 그대로 노출합니다.": "실행/기록 점검 화면에서 선택한 집중 대상을 그대로 보여줍니다.",
};

const VALUE_TEXT_MAP = {
  PARITY_STABLE: "정본과 그림자가 거의 일치함",
  PARITY_WATCH: "정본과 그림자 차이를 지켜봐야 함",
  PARITY_DRIFT: "정본과 그림자 차이가 큼",
  PARITY_UNKNOWN: "정합성 자료가 아직 부족함",
  NO_SHADOW_OBSERVED: "최근 그림자 비교가 없음",
  WATCH_PARITY_DRIFT: "정본과 그림자 차이가 커서 점검이 필요함",
  SERVER_SIGNAL_NOT_REACHING_EXECUTION: "정본 신호가 주문 단계로 거의 이어지지 않음",
  SERVER_SIGNAL_FILL_SHORT: "정본 신호는 나오지만 체결이 부족함",
  NO_SERVER_ENTRY_SIGNAL: "최근 정본 엔트리 신호가 없음",
  FINAL_DOWNSTREAM_MISMATCH: "최종 실행 결과가 다름",
  SOURCE_DECISION_MISMATCH: "정본 판단 단계가 다름",
  EV_POLICY: "기대값 정책",
  DROP_EV_GATE_TP1_PROB: "기대값 게이트(TP 복합 기대값)",
  PINE_DROP_STALE_POS_TO_ENTRY: "기존 포지션 영향으로 엔트리 미진행",
  COOLDOWN_POLICY: "쿨다운 정책",
  STRATEGY_GATE: "전략 게이트",
  CORE: "코어",
  EARLY: "얼리",
  PINE_PRIMARY: "파인 우선",
  SERVER_PRIMARY: "서버 우선",
  COMPLETE: "완료",
  IN_PROGRESS: "진행 중",
  NOT_STARTED: "미시작",
  DONE: "완료",
  PENDING: "대기",
};

function valueText(value) {
  const s = String(value || "").trim();
  if (!s) return "-";
  return VALUE_TEXT_MAP[s] || s;
}

const VALUE_REPLACEMENTS = [
  ["SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", "서버 정본 표본 부족"],
  ["STALE_ARTIFACT_SHADOW_FALLBACK", "오래된 산출물로 인한 그림자 대체"],
  ["RETROSPECTIVE_OBJECTIVE_FAIL", "회고 성과 미달"],
  ["OBJECTIVE_RECOVERY_REQUIRED", "목표 회복 필요"],
  ["RECOVERY_PROMOTION_READY", "회복 승격 준비됨"],
  ["PARTIAL_RECOVERY_ONLY", "부분 회복만 가능"],
  ["ACTIVE_BY_PROBE", "프로브 확인으로 활성"],
  ["ACTIVE_BY_TIMEOUT", "시간 경과로 활성"],
  ["APPLIED_ACTIVE_PENDING_AUTHORITY", "활성 적용·권한 대기"],
  ["APPLIED_ACTIVE", "활성 적용"],
  ["TIMEOUT_HOLD", "타임아웃 보류"],
  ["SHADOW_OVERLAY_AUDIT", "그림자·오버레이·감사"],
  ["OPENCLAW_FIRST", "OpenClaw 우선"],
  ["OPENCLAW_CRON", "OpenClaw 크론"],
  ["SERVER_PRIMARY", "서버 정본"],
  ["PINE_PRIMARY", "파인 우선"],
  ["PINE_SHADOW", "파인 그림자"],
  ["SERVER", "서버 정본"],
  ["PARITY_STABLE", "정합성 안정"],
  ["PARITY_WATCH", "정합성 주시"],
  ["PARITY_DRIFT", "정합성 드리프트"],
  ["PARITY_UNKNOWN", "정합성 미확인"],
  ["NO_SHADOW_OBSERVED", "그림자 관측 없음"],
  ["APPROVED", "승인"],
  ["PENDING", "대기"],
  ["PROMOTE", "승격"],
  ["ACTIVE", "활성"],
  ["READY", "준비"],
  ["CLEAR", "해제"],
  ["CONSISTENT", "일치"],
  ["MISMATCH", "불일치"],
  ["PASS", "통과"],
  ["FAIL", "실패"],
  ["HOLD", "보류"],
  ["WARN", "주의"],
  ["YES", "예"],
  ["NO", "아니오"],
  ["TRUE", "예"],
  ["FALSE", "아니오"],
  ["LONG", "롱"],
  ["SHORT", "숏"],
  ["ENTRY", "진입"],
  ["DROP", "드롭"],
  ["FALLBACK_AFTER_READ_FAIL", "latest 읽기 실패로 직전 산출물 사용"],
  ["FALLBACK_EMPTY_LATEST", "latest 비어 직전 산출물 사용"],
  ["MISSING", "산출물 없음"],
];

function translateStaticText(value) {
  const text = String(value || "");
  return UI_TEXT_MAP[text] || text;
}

function translateMixedText(value) {
  const text = String(value || "");
  if (!text || text.startsWith("/")) return text;
  let out = UI_TEXT_MAP[text] || text;
  for (const [from, to] of VALUE_REPLACEMENTS) {
    out = out.split(from).join(to);
  }
  return out;
}

function localizeStringByKey(key, value) {
  if (typeof value !== "string") return value;
  if (["href", "absPath", "fileName", "active", "key"].includes(key)) return value;
  if (["title", "label", "description", "eyebrow", "hint"].includes(key)) return translateStaticText(value);
  if (["value", "meta", "detail", "reason", "status", "type", "event", "verdict", "deploy", "source", "artifact", "loop"].includes(key)) return translateMixedText(value);
  return value;
}

function localizeViewModel(node, parentKey = "") {
  if (Array.isArray(node)) {
    return node.map((item) => {
      if (typeof item === "string") return localizeStringByKey(parentKey, item);
      return localizeViewModel(item, parentKey);
    });
  }
  if (!node || typeof node !== "object") return node;
  const out = {};
  Object.entries(node).forEach(([key, value]) => {
    if (typeof value === "string") {
      out[key] = localizeStringByKey(key, value);
      return;
    }
    out[key] = localizeViewModel(value, key);
  });
  return out;
}

function buildReportUrl(market) {
  return buildUrl("/dashboard/report", { mode: "weekly", market });
}

function buildExecutionUrl(market) {
  return buildUrl("/dashboard/execution", { exchange: "BINANCEFUT", market });
}

function buildAuditUrl(params = {}) {
  return buildUrl("/dashboard/audit", params);
}

function buildLoopHref(loopName) {
  const loop = String(loopName || "").toUpperCase();
  if (loop.includes("SERVER_PRIMARY")) return "/dashboard/server-primary";
  if (loop.includes("DEPLOYMENT") || loop.includes("BUNDLE_ACTIVATION") || loop.includes("PROBE")) return "/dashboard/deployment";
  if (loop.includes("RECOVERY") || loop.includes("CANDIDATE") || loop.includes("CANARY") || loop.includes("AUTHORITY")) return "/dashboard/recovery";
  if (loop.includes("PARITY") || loop.includes("PROVENANCE") || loop.includes("EXECUTION")) return "/dashboard/execution";
  return "/dashboard/audit";
}

function rowReasonText(row) {
  if (!row || typeof row !== "object") return "-";
  return compactText(
    row.drop_reason ||
    row.reason ||
    (row.features_json && (row.features_json.reason || row.features_json._intent_override_reason || row.features_json._reason_raw)) ||
    row.source_row_type ||
    "-",
    56,
  );
}

function buildRecentRuntimeRows(datasetArtifact, limit = 6) {
  const rows = Array.isArray(datasetArtifact.rows) ? datasetArtifact.rows.slice() : [];
  rows.sort((a, b) => {
    const ax = Number(a && (a.created_at_ms || a.signal_bar_close_time_utc_ms || Date.parse(a.created_at || a.created_kst || ""))) || 0;
    const bx = Number(b && (b.created_at_ms || b.signal_bar_close_time_utc_ms || Date.parse(b.created_at || b.created_kst || ""))) || 0;
    return bx - ax;
  });
  return rows.slice(0, Math.max(0, limit)).map((row) => ({
    at: timeText(row.created_at_ms || row.signal_bar_close_time_utc_ms || row.created_at || row.created_kst),
    market: compactText(row.market),
    type: compactText(row.source_row_type),
    event: compactText(row.event),
    reason: rowReasonText(row),
    open: buildLink("Report", buildReportUrl(row.market)),
  }));
}

function pickStageRow(stageArtifact, stageName) {
  const target = String(stageName || "").toUpperCase();
  return (stageArtifact.rows || []).find((row) => {
    const stage = String(row.display_stage || row.stage || "").toUpperCase();
    return stage === target;
  }) || null;
}

function buildSourceModeText(stageArtifact) {
  const row = pickStageRow(stageArtifact, "SOURCE_MODE");
  if (!row) return { value: "-", tone: "dim", detail: "원천 모드 스냅샷이 없습니다." };
  const modes = Array.isArray(row.current_source_modes)
    ? row.current_source_modes.map((item) => `${item.market || "?"} ${item.source_mode || "?"}`)
    : [];
  return {
    value: translateMixedText(modes.length ? modes.join(" / ") : compactText(row.active_display_signature || row.active_signature)),
    tone: statusTone(row.server_primary_acceptance_reason || row.machine_state),
    detail: translateMixedText(compactText(row.server_primary_acceptance_reason || row.display_reason || row.active_reason)),
  };
}

function buildPolicyBundleLabel(deploymentPlan, stageAutopilot) {
  const canonicalPolicyRow = pickStageRow(stageAutopilot, "CANONICAL_POLICY");
  const sourceMode = buildSourceModeText(stageAutopilot);
  const thresholdPair =
    extractThresholdPair(
      (canonicalPolicyRow && (canonicalPolicyRow.active_signature || canonicalPolicyRow.signature)) ||
      deploymentPlan.summary.threshold_bundle_signature
    ) ||
    extractThresholdPair(deploymentPlan.summary.active_policy_bundle_id) ||
    "-";
  return localizeViewModel({
    primary: `${thresholdPair} · ${sourceMode.value}`,
    detail: compactText((canonicalPolicyRow && canonicalPolicyRow.active_reason) || deploymentPlan.summary.recommended_target_stage_reason),
  });
}

function buildMissionControlViewModel() {
  const autonomy = loadLatestArtifact("best_self_evolution_openclaw_autonomy_contract_latest.json");
  const recoveryGovernor = loadLatestArtifact("best_self_evolution_objective_recovery_governor_latest.json");
  const recoveryEffect = loadLatestArtifact("best_self_evolution_objective_recovery_effect_latest.json");
  const deploymentPlan = loadLatestArtifact("best_self_evolution_deployment_plan_latest.json");
  const deploymentProbe = loadLatestArtifact("best_self_evolution_deployment_probe_latest.json");
  const bundleActivation = loadLatestArtifact("best_self_evolution_bundle_activation_latest.json");
  const acceptanceWatch = loadLatestArtifact("best_self_evolution_server_primary_acceptance_watch_latest.json");
  const loopMonitor = loadLatestArtifact("best_self_evolution_loop_monitor_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const watchdog = loadLatestArtifact("automation_watchdog_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const parity = loadLatestArtifact("best_self_evolution_canonical_engine_parity_latest.json");
  const provenance = loadLatestArtifact("best_self_evolution_canonical_engine_provenance_latest.json");
  const monthlyStrategy = loadLatestArtifact("objective_monthly_strategy_latest.json");
  const weeklyStrategy = loadLatestArtifact("objective_weekly_strategy_latest.json");
  const dailyStrategy = loadLatestArtifact("objective_daily_strategy_latest.json");

  const sourceMode = buildSourceModeText(stageAutopilot);
  const policyBundle = buildPolicyBundleLabel(deploymentPlan, stageAutopilot);
  const autonomyControlPlane =
    (autonomy.raw && autonomy.raw.control_plane) ||
    (autonomy.display && autonomy.display.control_plane) ||
    {};
  const topBlocker = Array.isArray(loopMonitor.summary.critical_blockers) && loopMonitor.summary.critical_blockers.length
    ? loopMonitor.summary.critical_blockers[0]
    : compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause);

  return localizeViewModel({
    active: "mission",
    title: "Mission Control",
    hero: {
      eyebrow: "OpenClaw Governor",
      title: compactText(autonomy.summary.goal_state),
      detail: `${compactText(topBlocker)} · target ${compactText(recoveryGovernor.summary.display_candidate_id || recoveryGovernor.summary.target_candidate_id)}`,
      tone: statusTone(autonomy.summary.goal_state),
      pills: [
        { label: "Authority", value: compactText(deploymentPlan.summary.authority_state), tone: statusTone(deploymentPlan.summary.authority_state) },
        { label: "Deployment", value: compactText(deploymentPlan.summary.plan_status), tone: statusTone(deploymentPlan.summary.plan_status) },
        { label: "Source", value: sourceMode.value, tone: sourceMode.tone },
        { label: "Phase D", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason), tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
      ],
      actions: [
        { label: "Recovery", href: "/dashboard/recovery", tone: "primary" },
        { label: "Deployment", href: "/dashboard/deployment", tone: "ghost" },
        { label: "Execution", href: "/dashboard/execution", tone: "ghost" },
        { label: "Audit", href: "/dashboard/audit", tone: "ghost" },
      ],
    },
    metrics: [
      {
        label: "Objective Score",
        value: signedNumberText(autonomy.currentStatus.objective_score, 2),
        meta: `monthly ${signedNumberText(autonomy.currentStatus.monthly_run_rate_krw, 0)} KRW`,
        tone: statusTone(autonomy.summary.goal_state),
      },
      {
        label: "Authority",
        value: compactText(deploymentPlan.summary.authority_state),
        meta: compactText(recoveryGovernor.summary.governor_reason || objectiveSupervisor.display && objectiveSupervisor.display.root_cause),
        tone: statusTone(deploymentPlan.summary.authority_state),
      },
      {
        label: "Deployment",
        value: compactText(deploymentPlan.summary.plan_status),
        meta: `${compactText(deploymentPlan.summary.activation_status)} / ${compactText(deploymentPlan.summary.activation_reason)}`,
        tone: statusTone(deploymentPlan.summary.plan_status),
      },
      {
        label: "Source Mode",
        value: sourceMode.value,
        meta: sourceMode.detail,
        tone: sourceMode.tone,
      },
      {
        label: "Phase D",
        value: `${numberText(acceptanceWatch.summary.executed_n, 0)}/${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`,
        meta: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
        tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      },
      {
        label: "Ops",
        value: compactText(watchdog.display && watchdog.display.verdict),
        meta: `${compactText(watchdog.display && watchdog.display.scheduler_mode)} / issues ${numberText(watchdog.display && watchdog.display.issue_count, 0)}`,
        tone: statusTone(watchdog.display && watchdog.display.verdict),
      },
    ],
    sections: [
      {
        title: "Strategic State",
        description: "현재 목표와 회복 경로를 먼저 읽습니다.",
        columns: 2,
        cards: [
          {
            title: "Why Blocked",
            tone: statusTone(objectiveSupervisor.display && objectiveSupervisor.display.verdict),
            rows: [
              { label: "Root Cause", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Failed Checks", value: joinList(objectiveSupervisor.display && objectiveSupervisor.display.blockers, "-") },
              { label: "Projected Score", value: signedNumberText(recoveryEffect.summary.projected_objective_score, 2) },
              { label: "Dominant Drag", value: compactText(recoveryEffect.summary.dominant_negative_market || "N/A") },
            ],
            notes: sliceList(objectiveSupervisor.display && objectiveSupervisor.display.blockers, 5),
          },
          {
            title: "Next Autonomous Action",
            tone: statusTone(recoveryGovernor.summary.governor_status),
            rows: [
              { label: "Target", value: compactText(recoveryGovernor.summary.display_candidate_id || recoveryGovernor.summary.target_candidate_id) },
              { label: "Governor", value: compactText(recoveryGovernor.summary.governor_status) },
              { label: "Replay / Canary", value: `${recoveryGovernor.summary.replay_pass ? "PASS" : "FAIL"} / ${recoveryGovernor.summary.canary_ready ? "READY" : "HOLD"}` },
              { label: "Gap Closure", value: `${numberText((recoveryEffect.summary.gap_closure_rate || 0) * 100, 1)}%` },
            ],
            notes: sliceList(recoveryGovernor.summary.next_actions || objectiveSupervisor.display && objectiveSupervisor.display.action_plan, 3),
            actions: [
              { label: "Open Recovery", href: "/dashboard/recovery", tone: "ghost" },
            ],
          },
        ],
      },
      {
        title: "전략 계층",
        description: "월간 큰 전략, 주간 쪼개기, 오늘 실행 계획을 미션 화면에서 바로 확인합니다.",
        columns: 3,
        cards: [
          buildStrategyCard("월간 전략", monthlyStrategy, "다음달 1일 회고 후 최신 전략이 갱신됩니다.", "monthly"),
          buildStrategyCard("주간 전략", weeklyStrategy, "다음 월요일 회고 후 최신 전략이 갱신됩니다.", "weekly"),
          buildStrategyCard("일간 계획", dailyStrategy, "오늘 회고 후 최신 계획이 갱신됩니다.", "daily"),
        ],
      },
      {
        title: "Bundle State",
        description: "현재 active engine/policy bundle과 shadow 역할을 읽습니다.",
        columns: 3,
        cards: [
          {
            title: "Engine Bundle",
            tone: "ok",
            rows: [
              { label: "Active", value: compactText(deploymentPlan.summary.active_engine_bundle && deploymentPlan.summary.active_engine_bundle.strategy_id) },
              { label: "Prepared", value: compactText(deploymentPlan.summary.prepared_engine_bundle_id) },
              { label: "Rollback", value: compactText(deploymentPlan.summary.rollback_engine_bundle_id) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason) },
            ],
          },
          {
            title: "Policy Bundle",
            tone: "warn",
            rows: [
              { label: "Active Policy", value: compactText(policyBundle.primary, 84) },
              { label: "Policy Reason", value: compactText(policyBundle.detail) },
              { label: "Source Mode", value: sourceMode.value },
              { label: "Stage", value: compactText(deploymentPlan.summary.recommended_target_stage_reason) },
            ],
          },
          {
            title: "Shadow Pine",
            tone: "dim",
            rows: [
              { label: "Role", value: compactText(autonomyControlPlane.pine_role || "SHADOW_OVERLAY_AUDIT") },
              { label: "Execution SOT", value: compactText(autonomyControlPlane.execution_sot) },
              { label: "Telegram", value: compactText(autonomyControlPlane.telegram_transport_sot || autonomy.currentStatus.telegram_transport_sot) },
              { label: "Scheduler", value: compactText(autonomyControlPlane.scheduler_sot || autonomy.currentStatus.scheduler_mode) },
            ],
          },
        ],
      },
      {
        title: "Evidence Chain",
        description: "현재 배포와 실행의 근거 artifact를 같은 높이에서 봅니다.",
        columns: 3,
        cards: [
          {
            title: "Deployment",
            tone: statusTone(deploymentPlan.summary.plan_status),
            rows: [
              { label: "Plan", value: compactText(deploymentPlan.summary.plan_status) },
              { label: "Probe", value: compactText(deploymentProbe.summary.probe_status) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason || deploymentPlan.summary.activation_reason) },
              { label: "Primary Unit", value: compactText(deploymentPlan.summary.deploy_unit_primary) },
            ],
            actions: [{ label: "Open Deployment", href: "/dashboard/deployment", tone: "ghost" }],
          },
          {
            title: "Execution",
            tone: sourceMode.tone,
            rows: [
              { label: "Source Mode", value: sourceMode.value },
              { label: "Acceptance", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
              { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0) },
              { label: "Rollback Trigger", value: numberText(acceptanceWatch.summary.rollback_trigger_n, 0) },
            ],
            actions: [
              { label: "Open Execution", href: "/dashboard/execution", tone: "ghost" },
              { label: "Open Phase D", href: "/dashboard/server-primary", tone: "ghost" },
            ],
          },
          {
            title: "Evidence",
            tone: statusTone(parity.summary.source_parity_mismatch_n === 0 ? "PASS" : "WARN"),
            rows: [
              { label: "Source Parity", value: `${numberText(parity.summary.source_parity_match_n, 0)}/${numberText(parity.summary.shadow_observed_n, 0)}` },
              { label: "Downstream", value: numberText(parity.summary.final_downstream_mismatch_n, 0) },
              { label: "Provenance", value: `${numberText(provenance.summary.complete_n, 0)}/${numberText(provenance.summary.engine_eligible_n, 0)}` },
              { label: "Ops", value: compactText(watchdog.display && watchdog.display.verdict) },
            ],
            actions: [{ label: "Open Audit", href: "/dashboard/audit", tone: "ghost" }],
          },
        ],
      },
    ],
  });
}

function buildRecoveryViewModel() {
  const governor = loadLatestArtifact("best_self_evolution_objective_recovery_governor_latest.json");
  const effect = loadLatestArtifact("best_self_evolution_objective_recovery_effect_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const replay = loadLatestArtifact("best_self_evolution_replay_latest.json");
  const canary = loadLatestArtifact("best_self_evolution_canary_latest.json");
  const deploymentGuards = loadLatestArtifact("best_self_evolution_deployment_guards_latest.json");
  const signalAuthority = loadLatestArtifact("server_signal_authority_latest.json");
  const signalQuality = loadLatestArtifact("server_signal_quality_latest.json");
  const signalRuntime = loadLatestArtifact("server_signal_runtime_latest.json");
  const autonomyContract = loadLatestArtifact("best_self_evolution_openclaw_autonomy_contract_latest.json");
  const executionQuality = loadLatestArtifact("best_self_evolution_execution_quality_latest.json");
  const monthlyStrategy = loadLatestArtifact("objective_monthly_strategy_latest.json");
  const weeklyStrategy = loadLatestArtifact("objective_weekly_strategy_latest.json");
  const dailyStrategy = loadLatestArtifact("objective_daily_strategy_latest.json");
  const systemOps = loadLatestArtifact("system_ops_check_latest.json");
  const systemSlo = loadLatestArtifact("system_slo_state_latest.json");
  const systemAnomaly = loadLatestArtifact("system_anomaly_state_latest.json");
  const runtimeGuardScale = resolveRuntimeGuardSoftScale({
    ops: systemOps.raw,
    slo: systemSlo.raw,
    anomaly: systemAnomaly.raw,
  });
  const artifactHealthCard = buildArtifactHealthCard([
    governor,
    effect,
    objectiveSupervisor,
    replay,
    canary,
    deploymentGuards,
    signalAuthority,
    signalQuality,
    signalRuntime,
    autonomyContract,
    executionQuality,
    monthlyStrategy,
    weeklyStrategy,
    dailyStrategy,
    systemOps,
    systemSlo,
    systemAnomaly,
  ]);
  const nextAction = Array.isArray(governor.summary.next_actions) && governor.summary.next_actions.length
    ? governor.summary.next_actions[0]
    : null;
  const targetValidation = Array.isArray(replay.raw && replay.raw.validations)
    ? replay.raw.validations.find((row) => row.candidate_id === effect.summary.target_candidate_id || row.display_candidate_id === effect.summary.target_candidate_id)
    : null;
  return localizeViewModel({
    active: "recovery",
    title: "Recovery",
    hero: {
      eyebrow: "Objective Recovery Governor",
      title: compactText(governor.summary.governor_status),
      detail: compactText(governor.summary.governor_reason),
      tone: statusTone(governor.summary.governor_status),
      pills: [
        { label: "Target", value: compactText(governor.summary.display_candidate_id || governor.summary.target_candidate_id), tone: "warn" },
        { label: "Replay", value: governor.summary.replay_pass ? "PASS" : "HOLD", tone: statusTone(governor.summary.replay_pass ? "PASS" : "HOLD") },
        { label: "Canary", value: governor.summary.canary_ready ? "READY" : "HOLD", tone: statusTone(governor.summary.canary_ready ? "READY" : "HOLD") },
        { label: "Guards", value: governor.summary.deployment_guards_pass ? "PASS" : "FAIL", tone: statusTone(governor.summary.deployment_guards_pass ? "PASS" : "FAIL") },
        { label: "Active Errors", value: numberText(systemOps.raw && systemOps.raw.active_error_count, 0), tone: toNum(systemOps.raw && systemOps.raw.active_error_count, 0) > 0 ? "bad" : "ok" },
        { label: "Entry Scale", value: runtimeGuardScale.scale <= 0 ? "BLOCK" : `${numberText(runtimeGuardScale.scale, 2)}x`, tone: runtimeGuardScale.scale <= 0 ? "bad" : (runtimeGuardScale.scale < 1 ? "warn" : "ok") },
        { label: "Latency P95", value: `${numberText(executionQuality.summary.guard_created_to_fill_p95_ms ?? executionQuality.summary.created_to_fill_p95_ms, 0)}ms`, tone: toNum(executionQuality.summary.guard_created_to_fill_p95_ms ?? executionQuality.summary.created_to_fill_p95_ms, 0) > 3000 ? "warn" : "ok" },
      ],
    },
    metrics: [
      { label: "Current Score", value: signedNumberText(effect.summary.current_objective_score, 2), meta: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause), tone: "bad" },
      { label: "Projected Score", value: signedNumberText(effect.summary.projected_objective_score, 2), meta: compactText(effect.summary.tracking_status), tone: statusTone(effect.summary.tracking_status) },
      { label: "Target Delta", value: signedNumberText(effect.summary.target_candidate_objective_delta, 2), meta: compactText(effect.summary.target_candidate_id), tone: "ok" },
      { label: "Best Replay Delta", value: signedNumberText(effect.summary.best_replay_objective_delta, 2), meta: compactText(effect.summary.best_replay_candidate_id), tone: effect.summary.higher_delta_candidate_available ? "warn" : "dim" },
    ],
    sections: [
      {
        title: "Operator Strip",
        description: "운영자가 먼저 보는 회복 판단 3가지를 고정합니다.",
        columns: 3,
        cards: [
          ...(artifactHealthCard ? [artifactHealthCard] : []),
          {
            title: "Runtime Guards",
            tone: runtimeGuardScale.scale <= 0 ? "bad" : (runtimeGuardScale.scale < 1 ? "warn" : "ok"),
            rows: [
              { label: "Ops Status", value: compactText(systemOps.raw && systemOps.raw.status) },
              { label: "Ops Reason", value: compactText(joinList(systemOps.raw && systemOps.raw.reasons, "-")) },
              { label: "Active Errors", value: numberText(systemOps.raw && systemOps.raw.active_error_count, 0) },
              { label: "Writer Authority 24h", value: numberText(systemOps.raw && systemOps.raw.position_writer_authority_24h && systemOps.raw.position_writer_authority_24h.occurrence_count, 0) },
              { label: "Cost Ratio", value: `${numberText(systemOps.raw && systemOps.raw.cost_ratio_pct, 2)}% / ${numberText(systemOps.raw && systemOps.raw.cost_limit_pct, 2)}%` },
              { label: "SLO", value: formatRuntimeGuardReason(systemSlo.raw && systemSlo.raw.state && systemSlo.raw.state.reason) },
              { label: "Anomaly", value: formatRuntimeGuardReason(systemAnomaly.raw && systemAnomaly.raw.state && systemAnomaly.raw.state.reason) },
              { label: "Entry Scale", value: runtimeGuardScale.scale <= 0 ? "BLOCK" : `${numberText(runtimeGuardScale.scale, 2)}x` },
              { label: "Scale Reason", value: formatRuntimeGuardReason(runtimeGuardScale.reason) },
            ],
            table: systemOps.raw
              && systemOps.raw.position_writer_authority_24h
              && Array.isArray(systemOps.raw.position_writer_authority_24h.remediation_candidates)
              && systemOps.raw.position_writer_authority_24h.remediation_candidates.length
              ? {
                columns: [
                  { key: "symbol", label: "Market" },
                  { key: "count", label: "Count" },
                  { key: "severity", label: "Severity" },
                  { key: "action", label: "Action" },
                  { key: "open", label: "Open" },
                ],
                rows: buildRowsPreview(
                  systemOps.raw.position_writer_authority_24h.remediation_candidates,
                  (row) => ({
                    symbol: buildLink(compactText(row.symbol), buildReportUrl(row.symbol)),
                    count: numberText(row.count, 0),
                    severity: compactText(row.severity),
                    action: compactText(row.action, 44),
                    open: buildLink("Execution", buildExecutionUrl(row.symbol)),
                  }),
                  5,
                ),
              }
              : null,
            notes: sliceList(
              []
                .concat((systemSlo.raw && systemSlo.raw.state && Array.isArray(systemSlo.raw.state.issues) ? systemSlo.raw.state.issues : []))
                .concat((systemAnomaly.raw && systemAnomaly.raw.state && Array.isArray(systemAnomaly.raw.state.issues) ? systemAnomaly.raw.state.issues : []))
                .concat(
                  systemOps.raw
                  && systemOps.raw.position_writer_authority_24h
                  && Array.isArray(systemOps.raw.position_writer_authority_24h.top_symbols)
                    ? systemOps.raw.position_writer_authority_24h.top_symbols.map((row) => `writer-authority ${row.symbol}(${row.count})`)
                    : []
                ),
              6,
            ),
          },
          {
            title: "Execution Runtime",
            tone: statusTone(executionQuality.summary.status || "WARN"),
            rows: [
              { label: "Latency P95", value: `${numberText(executionQuality.summary.guard_created_to_fill_p95_ms ?? executionQuality.summary.created_to_fill_p95_ms, 0)}ms` },
              { label: "Webhook P95", value: `${numberText(executionQuality.summary.webhook_to_fill_p95_ms, 0)}ms` },
              { label: "Slippage P95", value: `${numberText(executionQuality.summary.adverse_slippage_p95_bps, 2)}bps` },
              { label: "Partial Fill", value: `${numberText(executionQuality.summary.partial_fill_rate_pct, 1)}%` },
              { label: "Top Latency", value: compactText(executionQuality.summary.top_latency_market) },
              { label: "Top Delay Cause", value: compactText(executionQuality.summary.top_operational_webhook_delay_cause) },
            ],
            table: Array.isArray(executionQuality.summary.top_watch_markets) && executionQuality.summary.top_watch_markets.length ? {
              columns: [
                { key: "market", label: "Market" },
                { key: "latency", label: "Latency" },
                { key: "partial", label: "Partial" },
                { key: "slippage", label: "Slippage" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(
                executionQuality.summary.top_watch_markets,
                (row) => ({
                  market: buildLink(compactText(row.market), buildReportUrl(row.market)),
                  latency: `${numberText(row.avg_created_to_fill_ms, 0)}ms`,
                  partial: `${numberText(row.partial_fill_rate_pct, 1)}%`,
                  slippage: `${numberText(row.avg_slippage_bps, 2)}bps`,
                  open: buildLink("Execution", buildExecutionUrl(row.market)),
                }),
                5,
              ),
            } : null,
            notes: sliceList(executionQuality.summary.review_reasons || [], 6),
          },
          {
            title: "Signal Authority",
            tone: statusTone(signalAuthority.summary.drift_status || "PARITY_UNKNOWN"),
            rows: [
              { label: "Authoritative 24h", value: numberText(signalAuthority.summary.authoritative_server_24h_n, 0) },
              { label: "Shadow 24h", value: numberText(signalAuthority.summary.pine_shadow_24h_n, 0) },
              { label: "Latest Server", value: compactText(signalAuthority.summary.latest_authoritative_signal_at_kst) },
              { label: "Latest Shadow", value: compactText(signalAuthority.summary.latest_shadow_signal_at_kst) },
              { label: "Parity Drift", value: compactText(valueText(signalAuthority.summary.drift_status)) },
              { label: "Source Mode", value: compactText(signalAuthority.summary.source_mode) },
            ],
            table: {
              columns: [
                { key: "server", label: "Top Server Markets" },
                { key: "shadow", label: "Top Shadow Markets" },
              ],
              rows: buildRowsPreview(
                Array.from({
                  length: Math.max(
                    Array.isArray(signalAuthority.raw && signalAuthority.raw.rows && signalAuthority.raw.rows.by_market_server)
                      ? signalAuthority.raw.rows.by_market_server.length
                      : 0,
                    Array.isArray(signalAuthority.raw && signalAuthority.raw.rows && signalAuthority.raw.rows.by_market_shadow)
                      ? signalAuthority.raw.rows.by_market_shadow.length
                      : 0,
                  ),
                }).map((_, idx) => ({
                  server: signalAuthority.raw && signalAuthority.raw.rows && signalAuthority.raw.rows.by_market_server && signalAuthority.raw.rows.by_market_server[idx],
                  shadow: signalAuthority.raw && signalAuthority.raw.rows && signalAuthority.raw.rows.by_market_shadow && signalAuthority.raw.rows.by_market_shadow[idx],
                })),
                (row) => ({
                  server: row.server ? `${compactText(row.server.key)} (${numberText(row.server.count, 0)})` : "-",
                  shadow: row.shadow ? `${compactText(row.shadow.key)} (${numberText(row.shadow.count, 0)})` : "-",
                }),
                5,
              ),
            },
          },
          {
            title: "Signal Quality",
            tone: statusTone(signalQuality.summary.quality_status || "N/A"),
            rows: [
              { label: "Entry 24h", value: numberText(signalQuality.summary.authoritative_entry_signal_24h_n, 0) },
              { label: "Intent 24h", value: numberText(signalQuality.summary.order_intent_24h_n, 0) },
              { label: "Fill 24h", value: numberText(signalQuality.summary.fill_24h_n, 0) },
              { label: "Trade 24h", value: numberText(signalQuality.summary.trade_24h_n, 0) },
              { label: "Intent Conversion", value: toDisplayPercent(signalQuality.summary.intent_conversion_rate, 0) },
              { label: "Fill Conversion", value: toDisplayPercent(signalQuality.summary.fill_conversion_rate, 0) },
              { label: "Latest Entry", value: compactText(signalQuality.summary.latest_authoritative_entry_signal_at_kst) },
              { label: "Quality Status", value: compactText(valueText(signalQuality.summary.quality_status)) },
            ],
          },
          {
            title: "서버 우선 전환 진행률",
            tone: statusTone(autonomyContract.summary.server_signal_transition_status || "IN_PROGRESS"),
            rows: [
              { label: "진행률", value: `${numberText(autonomyContract.summary.server_signal_transition_progress_pct, 0)}%` },
              { label: "상태", value: compactText(valueText(autonomyContract.summary.server_signal_transition_status)) },
              { label: "현재 단계", value: compactText(autonomyContract.raw && autonomyContract.raw.server_signal_transition && autonomyContract.raw.server_signal_transition.current_label) },
              { label: "실행 TF", value: compactText(signalRuntime.summary.exec_tf || autonomyContract.currentStatus.server_signal_runtime_exec_tf) },
              { label: "활성 마켓 수", value: numberText(signalRuntime.summary.market_count || autonomyContract.currentStatus.server_signal_runtime_market_count, 0) },
              { label: "소스 모드", value: compactText(valueText(autonomyContract.currentStatus.server_signal_source_mode)) },
              { label: "드리프트", value: compactText(valueText(autonomyContract.currentStatus.server_signal_drift_status)) },
              { label: "실행 품질", value: compactText(valueText(autonomyContract.currentStatus.server_signal_quality_status)) },
            ],
            table: autonomyContract.raw && autonomyContract.raw.server_signal_transition && Array.isArray(autonomyContract.raw.server_signal_transition.phases) ? {
              columns: [
                { key: "phase", label: "전환 단계" },
                { key: "status", label: "상태" },
              ],
              rows: buildRowsPreview(
                autonomyContract.raw.server_signal_transition.phases,
                (row) => ({
                  phase: compactText(row.label),
                  status: compactText(valueText(row.status)),
                }),
                4,
              ),
            } : null,
          },
          {
            title: "Decision",
            tone: statusTone(governor.summary.governor_status),
            rows: [
              { label: "Governor", value: compactText(governor.summary.governor_status) },
              { label: "Target", value: compactText(governor.summary.display_candidate_id || governor.summary.target_candidate_id) },
              { label: "Reason", value: compactText(governor.summary.governor_reason) },
              { label: "Next", value: compactText(nextAction) },
            ],
            actions: [{ label: "Weekly Report", href: buildReportUrl(effect.summary.target_market || "AXSUSDT"), tone: "ghost" }],
          },
          {
            title: "Score Path",
            tone: statusTone(effect.summary.tracking_status),
            rows: [
              { label: "Current", value: signedNumberText(effect.summary.current_objective_score, 2) },
              { label: "Projected", value: signedNumberText(effect.summary.projected_objective_score, 2) },
              { label: "Gap Closure", value: `${numberText((effect.summary.gap_closure_rate || 0) * 100, 1)}%` },
              { label: "Target Delta", value: signedNumberText(effect.summary.target_candidate_objective_delta, 2) },
            ],
          },
          {
            title: "Release Gates",
            tone: governor.summary.replay_pass && governor.summary.canary_ready && governor.summary.deployment_guards_pass ? "ok" : "warn",
            rows: [
              { label: "Replay", value: governor.summary.replay_pass ? "PASS" : "HOLD" },
              { label: "Canary", value: governor.summary.canary_ready ? "READY" : "HOLD" },
              { label: "Guards", value: governor.summary.deployment_guards_pass ? "PASS" : "FAIL" },
              { label: "Memory", value: governor.summary.target_memory_blocked ? compactText(governor.summary.target_memory_block_reason) : "CLEAR" },
            ],
          },
        ],
      },
      {
        title: "Recovery Detail",
        description: "현재 target, 대안 candidate, retrospective blocker를 같은 레벨에서 봅니다.",
        columns: 2,
        cards: [
          {
            title: "Recent Drift Cases",
            tone: statusTone(signalAuthority.summary.drift_status || signalQuality.summary.quality_status || "N/A"),
            rows: [
              { label: "Main Drift Reason", value: compactText(valueText(signalQuality.summary.top_mismatch_scope && signalQuality.summary.top_mismatch_scope.key)) },
              { label: "Main Drop Family", value: compactText(valueText(signalQuality.summary.top_drop_reason_family && signalQuality.summary.top_drop_reason_family.key)) },
              { label: "Mismatch Count", value: numberText(signalQuality.summary.parity_mismatch_n, 0) },
            ],
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "tier", label: "Tier" },
                { key: "scope", label: "Main Drift Reason" },
                { key: "reason", label: "Main Drop Family" },
                { key: "observed", label: "Observed" },
              ],
              rows: buildRowsPreview(
                signalQuality.raw && signalQuality.raw.rows && signalQuality.raw.rows.mismatch_examples,
                (row) => ({
                  market: compactText(row.market),
                  tier: compactText(row.tier),
                  scope: compactText(valueText(row.scope)),
                  reason: compactText(valueText(row.reason)),
                  observed: compactText(row.observed_at_kst),
                }),
                5,
              ),
            },
          },
          {
            title: "Target and Alternative",
            tone: "warn",
            rows: [
              { label: "Current Target", value: compactText(effect.summary.target_candidate_id) },
              { label: "Deploy Unit", value: compactText(effect.summary.target_deploy_unit) },
              { label: "Projected Win Rate", value: numberText((effect.summary.projected_win_rate || 0) * 100, 1) + "%" },
              { label: "Projected Avg Ret", value: signedNumberText((effect.summary.projected_avg_ret_net || 0) * 100, 2) + "%" },
              { label: "Higher Delta", value: compactText(effect.summary.higher_delta_candidate_id || "N/A") },
              { label: "Higher Delta Value", value: signedNumberText(effect.summary.higher_delta_candidate_objective_delta, 2) },
              { label: "Higher Delta Ready", value: effect.summary.higher_delta_candidate_ready_for_auto_apply ? "YES" : "NO" },
              { label: "Higher Delta Hold", value: compactText(effect.summary.higher_delta_candidate_hold_reason) },
            ],
          },
          {
            title: "Retrospective Blockers",
            tone: "bad",
            rows: [
              { label: "Root Cause", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Monthly Failed", value: joinList(effect.summary.retrospective_monthly_failed_checks || []) },
              { label: "Top Drop Reason", value: compactText(effect.summary.retrospective_monthly_top_drop_reason) },
              { label: "Dominant Drag", value: `${compactText(effect.summary.dominant_negative_market)} (${numberText((effect.summary.dominant_negative_share || 0) * 100, 1)}%)` },
            ],
            notes: sliceList(objectiveSupervisor.display && objectiveSupervisor.display.blockers, 4),
          },
        ],
      },
      {
        title: "전략 계층",
        description: "월간 큰 전략, 주간 쪼개기, 오늘 실행 계획을 같은 화면에서 바로 읽습니다.",
        columns: 3,
        cards: [
          buildStrategyCard("월간 전략", monthlyStrategy, "다음달 1일 회고 후 최신 전략이 갱신됩니다.", "monthly"),
          buildStrategyCard("주간 전략", weeklyStrategy, "다음 월요일 회고 후 최신 전략이 갱신됩니다.", "weekly"),
          buildStrategyCard("일간 계획", dailyStrategy, "오늘 회고 후 최신 계획이 갱신됩니다.", "daily"),
        ],
      },
      {
        title: "Release Evidence",
        description: "replay, canary, deployment guards를 release 관점으로 압축합니다.",
        columns: 3,
        cards: [
          {
            title: "Replay Detail",
            tone: statusTone(targetValidation && targetValidation.validation_verdict),
            rows: [
              { label: "Validation", value: compactText(targetValidation && targetValidation.validation_verdict) },
              { label: "Objective Delta", value: signedNumberText(targetValidation && targetValidation.candidate_objective_delta, 2) },
              { label: "Count Delta", value: signedNumberText(targetValidation && targetValidation.count_delta, 2) },
              { label: "Risk Flags", value: joinList(targetValidation && targetValidation.risk_flags, "-") },
            ],
            table: targetValidation ? {
              columns: [
                { key: "market", label: "Market" },
                { key: "delta", label: "Delta" },
                { key: "executed", label: "Executed" },
                { key: "realized", label: "Realized" },
                { key: "win_rate", label: "Win Rate" },
                { key: "open", label: "Open" },
              ],
              rows: buildMarketImpactRows(targetValidation).map((row) => ({
                ...row,
                open: buildLink("Report", buildReportUrl(row.market)),
              })),
            } : null,
          },
          {
            title: "Canary State",
            tone: statusTone(canary.summary.global_canary_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Ready Wave", value: numberText(canary.summary.open_wave, 0) },
              { label: "Top Ready", value: compactText(canary.summary.top_ready_market) },
              { label: "Scale Allowed", value: canary.summary.scale_allowed ? "YES" : "NO" },
              { label: "Scale Block", value: compactText(canary.summary.scale_block_reason) },
            ],
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "wave", label: "Wave" },
                { key: "candidate", label: "Candidate" },
                { key: "verdict", label: "Verdict" },
                { key: "blockers", label: "Blockers" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(canary.rows, (row) => ({
                market: compactText(row.market),
                wave: numberText(row.wave, 0),
                candidate: compactText(row.candidate_id),
                verdict: compactText(row.canary_verdict),
                blockers: joinList(row.blockers, "-"),
                open: buildLink("Report", buildReportUrl(row.market)),
              }), 5),
            },
          },
          {
            title: "Deployment Guards",
            tone: statusTone(deploymentGuards.summary.deploy_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Target", value: compactText(deploymentGuards.summary.target_candidate_id) },
              { label: "Promotion Ready", value: deploymentGuards.summary.promotion_ready ? "YES" : "NO" },
              { label: "Canary Open Wave", value: numberText(deploymentGuards.summary.canary_open_wave, 0) },
              { label: "Memory Blocked", value: numberText(deploymentGuards.summary.memory_blocked_candidate_n, 0) },
            ],
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "wave", label: "Wave" },
                { key: "candidate", label: "Candidate" },
                { key: "deploy", label: "Deploy" },
                { key: "blockers", label: "Blockers" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(deploymentGuards.rows, (row) => ({
                market: compactText(row.market),
                wave: numberText(row.wave, 0),
                candidate: compactText(row.candidate_id),
                deploy: row.deploy_pass ? "PASS" : "HOLD",
                blockers: joinList(row.blockers, "-"),
                open: buildLink("Report", buildReportUrl(row.market)),
              }), 6),
            },
          },
        ],
      },
    ],
  });
}

function buildDeploymentViewModel() {
  const deploymentPlan = loadLatestArtifact("best_self_evolution_deployment_plan_latest.json");
  const deploymentProbe = loadLatestArtifact("best_self_evolution_deployment_probe_latest.json");
  const bundleActivation = loadLatestArtifact("best_self_evolution_bundle_activation_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const runtimeAck = loadLatestArtifact("self_evolution_manual_paste_ack_latest.json");
  const policyBundle = buildPolicyBundleLabel(deploymentPlan, stageAutopilot);
  return localizeViewModel({
    active: "deployment",
    title: "Deployment",
    hero: {
      eyebrow: "Bundle Deployment",
      title: compactText(deploymentPlan.summary.plan_status),
      detail: `${compactText(deploymentPlan.summary.activation_status)} · ${compactText(deploymentPlan.summary.activation_reason)}`,
      tone: statusTone(deploymentPlan.summary.plan_status),
      pills: [
        { label: "Authority", value: compactText(deploymentPlan.summary.authority_state), tone: statusTone(deploymentPlan.summary.authority_state) },
        { label: "Probe", value: compactText(deploymentProbe.summary.probe_status), tone: statusTone(deploymentProbe.summary.probe_status) },
        { label: "Activation", value: compactText(bundleActivation.summary.activation_status), tone: statusTone(bundleActivation.summary.activation_status) },
        { label: "Primary", value: compactText(deploymentPlan.summary.deploy_unit_primary), tone: "dim" },
      ],
    },
    metrics: [
      { label: "Engine Bundle", value: compactText(deploymentPlan.summary.active_engine_bundle && deploymentPlan.summary.active_engine_bundle.strategy_id), meta: compactText(deploymentPlan.summary.rollback_engine_bundle_id), tone: "ok" },
      { label: "Policy Bundle", value: compactText(deploymentPlan.summary.active_policy_bundle && deploymentPlan.summary.active_policy_bundle.source), meta: compactText(deploymentPlan.summary.recommended_target_stage_reason), tone: "warn" },
      { label: "Probe", value: compactText(deploymentProbe.summary.probe_reason), meta: compactText(deploymentProbe.summary.latest_market_data_at_kst), tone: statusTone(deploymentProbe.summary.probe_status) },
      { label: "Activation", value: compactText(bundleActivation.summary.activation_reason), meta: compactText(bundleActivation.summary.confirmation_deadline_kst), tone: statusTone(bundleActivation.summary.activation_status) },
    ],
    sections: [
      {
        title: "Operator Strip",
        description: "배포에서 먼저 봐야 할 3개 상태를 우선 배치합니다.",
        columns: 3,
        cards: [
          {
            title: "Active Runtime",
            tone: "ok",
            rows: [
              { label: "Plan", value: compactText(deploymentPlan.summary.plan_status) },
              { label: "Authority", value: compactText(deploymentPlan.summary.authority_state) },
              { label: "Probe", value: compactText(deploymentProbe.summary.probe_reason) },
              { label: "Activation", value: compactText(bundleActivation.summary.activation_reason) },
            ],
          },
          {
            title: "Bundle Pair",
            tone: "warn",
            rows: [
              { label: "Engine", value: compactText(deploymentPlan.summary.active_engine_bundle_id) },
              { label: "Policy", value: compactText(policyBundle.primary, 84) },
              { label: "Source Mode", value: compactText(deploymentPlan.summary.source_mode_signature, 84) },
              { label: "Shadow Pine", value: "SHADOW_OVERLAY_AUDIT" },
            ],
          },
          {
            title: "Prepared and Rollback",
            tone: statusTone(deploymentPlan.summary.prepare_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Prepared", value: compactText(deploymentPlan.summary.prepared_engine_bundle_id) },
              { label: "Rollback", value: compactText(deploymentPlan.summary.rollback_engine_bundle_id) },
              { label: "Origin", value: compactText(deploymentPlan.summary.applied_origin_display_candidate_id || deploymentPlan.summary.applied_origin_candidate_id) },
              { label: "Manual Step", value: deploymentPlan.summary.manual_step_required ? "YES" : "NO" },
            ],
          },
        ],
      },
      {
        title: "Runtime Evidence",
        description: "probe, activation, runtime ack를 증거 체인으로 압축합니다.",
        columns: 2,
        cards: [
          {
            title: "Prepared State",
            tone: statusTone(deploymentPlan.summary.prepare_pass ? "PASS" : "FAIL"),
            rows: [
              { label: "Prepare Pass", value: deploymentPlan.summary.prepare_pass ? "YES" : "NO" },
              { label: "Manual Step", value: deploymentPlan.summary.manual_step_required ? "YES" : "NO" },
              { label: "Ack", value: deploymentPlan.summary.manual_paste_acknowledged ? "YES" : "NO" },
              { label: "Origin", value: compactText(deploymentPlan.summary.applied_origin_display_candidate_id || deploymentPlan.summary.applied_origin_candidate_id) },
            ],
          },
          {
            title: "Probe Detail",
            tone: statusTone(deploymentProbe.summary.probe_status),
            rows: [
              { label: "Engine Loaded", value: deploymentProbe.summary.engine_bundle_loaded ? "YES" : "NO" },
              { label: "Policy Loaded", value: deploymentProbe.summary.policy_bundle_loaded ? "YES" : "NO" },
              { label: "Data Flow", value: deploymentProbe.summary.market_data_flow_ok ? "YES" : "NO" },
              { label: "Latest Data", value: compactText(deploymentProbe.summary.latest_market_data_at_kst) },
            ],
            notes: [
              compactText(bundleActivation.summary.activation_status),
              compactText(bundleActivation.summary.activation_reason),
            ],
          },
          {
            title: "Runtime Ack",
            tone: statusTone(runtimeAck.summary && runtimeAck.summary.plan_status),
            rows: [
              { label: "Acknowledged", value: runtimeAck.raw && runtimeAck.raw.acknowledged ? "YES" : "NO" },
              { label: "Plan Status", value: compactText(runtimeAck.summary && runtimeAck.summary.plan_status) },
              { label: "Engine Loaded", value: runtimeAck.raw && runtimeAck.raw.engine_bundle_loaded ? "YES" : "NO" },
              { label: "Activation", value: compactText(runtimeAck.raw && runtimeAck.raw.bundle_activation_status) },
            ],
          },
        ],
      },
    ],
  });
}

function buildExecutionViewModel(query = {}) {
  const parity = loadLatestArtifact("best_self_evolution_canonical_engine_parity_latest.json");
  const provenance = loadLatestArtifact("best_self_evolution_canonical_engine_provenance_latest.json");
  const dataset = loadLatestArtifact("best_self_evolution_dataset_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const sourceMode = buildSourceModeText(stageAutopilot);
  const canonicalPolicyRow = pickStageRow(stageAutopilot, "CANONICAL_POLICY");
  const paritySummary = parity.summary;
  const provenanceSummary = provenance.summary;
  const focusedCollection = String(query.collection || "").trim();
  const focusedSource = String(query.source || "").trim();
  const recentRuntimeRows = buildRecentRuntimeRows(dataset, 6);
  const latestRuntimeRow = recentRuntimeRows[0] || null;
  return localizeViewModel({
    active: "execution",
    title: "Execution",
    hero: {
      eyebrow: "Canonical Execution",
      title: sourceMode.value,
      detail: sourceMode.detail,
      tone: sourceMode.tone,
      pills: [
        { label: "Source Parity", value: `${numberText(paritySummary.source_parity_match_n, 0)}/${numberText(paritySummary.shadow_observed_n, 0)}`, tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL") },
        { label: "Downstream", value: numberText(paritySummary.final_downstream_mismatch_n, 0), tone: paritySummary.final_downstream_mismatch_n > 0 ? "warn" : "ok" },
        { label: "Provenance", value: `${numberText(provenanceSummary.complete_n, 0)}/${numberText(provenanceSummary.engine_eligible_n, 0)}`, tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN") },
        { label: "Execution Source", value: joinList((provenanceSummary.by_execution_source || []).map((row) => `${row.key}:${row.count}`)), tone: "dim" },
      ],
      actions: [
        { label: "Phase D", href: "/dashboard/server-primary", tone: "ghost" },
        { label: "Audit", href: "/dashboard/audit", tone: "ghost" },
      ],
    },
    metrics: [
      { label: "Source Mode", value: sourceMode.value, meta: sourceMode.detail, tone: sourceMode.tone },
      { label: "Source Parity", value: numberText(paritySummary.source_parity_mismatch_n, 0), meta: `stored ${numberText(paritySummary.source_evidence_stored_n, 0)} / derived ${numberText(paritySummary.source_evidence_derived_n, 0)}`, tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL") },
      { label: "Downstream Mismatch", value: numberText(paritySummary.final_downstream_mismatch_n, 0), meta: compactText(paritySummary.top_downstream_reason || "policy gates"), tone: paritySummary.final_downstream_mismatch_n > 0 ? "warn" : "ok" },
      { label: "Provenance Complete", value: `${numberText(provenanceSummary.complete_n, 0)}/${numberText(provenanceSummary.engine_eligible_n, 0)}`, meta: `exec src ${numberText(provenanceSummary.with_execution_source_n, 0)} / overlay ${numberText(provenanceSummary.with_pine_overlay_role_n, 0)}`, tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN") },
    ],
    sections: [
      {
        title: "Operator Strip",
        description: "실행 화면에서 먼저 봐야 할 현재 source, 최신 row, policy alignment입니다.",
        columns: 3,
        cards: [
          {
            title: "Current Runtime",
            tone: sourceMode.tone,
            rows: [
              { label: "Source Mode", value: sourceMode.value },
              { label: "Acceptance", value: sourceMode.detail },
              { label: "Source Parity", value: `${numberText(paritySummary.source_parity_match_n, 0)}/${numberText(paritySummary.shadow_observed_n, 0)}` },
              { label: "Downstream", value: numberText(paritySummary.final_downstream_mismatch_n, 0) },
            ],
          },
          {
            title: "Latest Runtime Row",
            tone: latestRuntimeRow ? "warn" : "dim",
            rows: [
              { label: "At", value: latestRuntimeRow ? latestRuntimeRow.at : "-" },
              { label: "Market", value: latestRuntimeRow ? latestRuntimeRow.market : "-" },
              { label: "Type", value: latestRuntimeRow ? latestRuntimeRow.type : "-" },
              { label: "Reason", value: latestRuntimeRow ? latestRuntimeRow.reason : "-" },
            ],
            actions: latestRuntimeRow ? [{ label: "Open Report", href: buildReportUrl(latestRuntimeRow.market), tone: "ghost" }] : [],
          },
          {
            title: "Policy Alignment",
            tone: "warn",
            rows: [
              { label: "Threshold", value: extractThresholdPair(canonicalPolicyRow && canonicalPolicyRow.active_signature) || "-" },
              { label: "Policy Reason", value: compactText(canonicalPolicyRow && canonicalPolicyRow.active_reason) },
              { label: "Execution Source", value: joinList((provenanceSummary.by_execution_source || []).map((row) => `${row.key}:${row.count}`)) },
              { label: "Focused Source", value: compactText(focusedSource || "all") },
            ],
          },
        ],
      },
      {
        title: "Execution Evidence",
        description: "source parity와 provenance를 분리해 보여줍니다.",
        columns: 3,
        cards: [
          {
            title: "Active Policy",
            tone: "warn",
            rows: [
              { label: "Threshold", value: extractThresholdPair(canonicalPolicyRow && canonicalPolicyRow.active_signature) || "-" },
              { label: "Policy Reason", value: compactText(canonicalPolicyRow && canonicalPolicyRow.active_reason) },
              { label: "Source Mode", value: sourceMode.value },
              { label: "Acceptance", value: sourceMode.detail },
            ],
          },
          {
            title: "Parity",
            tone: statusTone(paritySummary.source_parity_mismatch_n === 0 ? "PASS" : "FAIL"),
            rows: [
              { label: "Observed", value: numberText(paritySummary.shadow_observed_n, 0) },
              { label: "Source Mismatch", value: numberText(paritySummary.source_parity_mismatch_n, 0) },
              { label: "Downstream Mismatch", value: numberText(paritySummary.final_downstream_mismatch_n, 0) },
              { label: "Stored Evidence", value: numberText(paritySummary.source_evidence_stored_n, 0) },
            ],
          },
          {
            title: "Provenance",
            tone: statusTone(provenanceSummary.complete_n > 0 ? "PASS" : "WARN"),
            rows: [
              { label: "Eligible", value: numberText(provenanceSummary.engine_eligible_n, 0) },
              { label: "Complete", value: numberText(provenanceSummary.complete_n, 0) },
              { label: "By Source", value: joinList((provenanceSummary.by_execution_source || []).map((row) => `${row.key}:${row.count}`)) },
              { label: "By Overlay", value: joinList((provenanceSummary.by_pine_overlay_role || []).map((row) => `${row.key}:${row.count}`)) },
            ],
            table: {
              columns: [
                { key: "collection", label: "Collection" },
                { key: "eligible", label: "Eligible" },
                { key: "complete", label: "Complete" },
                { key: "source", label: "Source" },
                { key: "overlay", label: "Overlay" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(provenanceSummary.by_collection, (row) => ({
                collection: compactText(row.collection),
                eligible: numberText(row.eligible_n, 0),
                complete: numberText(row.complete_n, 0),
                source: numberText(row.with_execution_source_n, 0),
                overlay: numberText(row.with_pine_overlay_role_n, 0),
                open: buildLink("Audit", buildAuditUrl({ focus: "provenance", collection: row.collection })),
              }), 4),
            },
            notes: [
              focusedCollection ? `focused collection: ${focusedCollection}` : null,
              focusedSource ? `focused source: ${focusedSource}` : null,
            ].filter(Boolean),
          },
        ],
      },
      {
        title: "Market-Level Evidence",
        description: "parity가 어디서 깨지는지 market 단위로 내려갑니다.",
        columns: 2,
        cards: [
          {
            title: "Market Parity",
            tone: "warn",
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "comparable", label: "Observed" },
                { key: "match", label: "Match" },
                { key: "mismatch", label: "Mismatch" },
                { key: "rate", label: "Parity" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(paritySummary.by_market_parity, (row) => ({
                market: compactText(row.key),
                comparable: numberText(row.comparable_n, 0),
                match: numberText(row.match_n, 0),
                mismatch: numberText(row.mismatch_n, 0),
                rate: toDisplayPercent(row.parity_rate, 0),
                open: buildLink("Report", buildReportUrl(row.key)),
              }), 6),
            },
          },
          {
            title: "Execution Source Breakdown",
            tone: "dim",
            table: {
              columns: [
                { key: "key", label: "Source" },
                { key: "count", label: "Count" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(provenanceSummary.by_execution_source, (row) => ({
                key: compactText(row.key),
                count: numberText(row.count, 0),
                open: buildLink(
                  row.key === "SERVER_PRIMARY" ? "Phase D" : "Audit",
                  row.key === "SERVER_PRIMARY" ? "/dashboard/server-primary" : buildAuditUrl({ focus: "execution-source", source: row.key }),
                ),
              }), 6),
            },
          },
        ],
      },
      {
        title: "Recent Runtime Rows",
        description: "최근 dataset row를 바로 보여줍니다. 빈 recent cache 대신 현재 운영 흔적을 먼저 확인합니다.",
        columns: 2,
        cards: [
          {
            title: "Dataset Preview",
            tone: "dim",
            rows: [
              { label: "Rows", value: numberText(dataset.summary.row_n || dataset.summary.rows_n || dataset.rows.length, 0) },
              { label: "Focus Source", value: compactText(focusedSource || "all") },
              { label: "Focus Collection", value: compactText(focusedCollection || "dataset_latest") },
              { label: "Meaning", value: "recent runtime evidence across drop/missed/fallback rows" },
            ],
            table: {
              columns: [
                { key: "at", label: "At" },
                { key: "market", label: "Market" },
                { key: "type", label: "Type" },
                { key: "event", label: "Event" },
                { key: "reason", label: "Reason" },
                { key: "open", label: "Open" },
              ],
              rows: buildRecentRuntimeRows(dataset, 6),
            },
          },
          {
            title: "Interpretation",
            tone: "warn",
            rows: [
              { label: "Recent Cache", value: "signals/signals_dropped/order_intents are currently sparse in local cache" },
              { label: "Fallback SOT", value: "best_self_evolution_dataset_latest.json" },
              { label: "Why", value: "Execution page should still show recent runtime evidence even when cache shards are empty" },
              { label: "Next Jump", value: "/dashboard/report?mode=weekly&market=<market>" },
            ],
          },
        ],
      },
    ],
  });
}

function buildServerPrimaryViewModel() {
  const acceptanceWatch = loadLatestArtifact("best_self_evolution_server_primary_acceptance_watch_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const sourceMode = buildSourceModeText(stageAutopilot);
  return localizeViewModel({
    active: "server-primary",
    title: "전환 진행",
    hero: {
      eyebrow: "서버 우선 전환",
      title: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      detail: sourceMode.value,
      tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
      pills: [
        { label: "Configured", value: numberText(acceptanceWatch.summary.configured_server_primary_markets_n, 0), tone: "dim" },
        { label: "Executed", value: `${numberText(acceptanceWatch.summary.executed_n, 0)}/${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`, tone: "warn" },
        { label: "Disagreement", value: numberText(acceptanceWatch.summary.disagreement_rate || 0, 2), tone: "ok" },
        { label: "Rollback", value: numberText(acceptanceWatch.summary.rollback_trigger_n, 0), tone: "ok" },
      ],
      actions: [{ label: "Execution", href: "/dashboard/execution", tone: "ghost" }],
    },
    metrics: [
      { label: "Markets", value: joinList(acceptanceWatch.summary.configured_server_primary_markets || []), meta: compactText(sourceMode.value), tone: "dim" },
      { label: "Observed", value: numberText(acceptanceWatch.summary.observed_n, 0), meta: compactText(acceptanceWatch.summary.phase_d_reason), tone: "warn" },
      { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0), meta: `min ${numberText(acceptanceWatch.summary.acceptance_min_executed, 0)}`, tone: "warn" },
      { label: "Realized", value: numberText(acceptanceWatch.summary.realized_n, 0), meta: `disagreement ${numberText((acceptanceWatch.summary.disagreement_rate || 0) * 100, 1)}%`, tone: "ok" },
    ],
    sections: [
      {
        title: "Operator Strip",
        description: "Phase D에서 운영자가 먼저 보는 acceptance 기준입니다.",
        columns: 3,
        cards: [
          {
            title: "Phase D Gate",
            tone: statusTone(acceptanceWatch.summary.phase_d_status || acceptanceWatch.summary.phase_d_reason),
            rows: [
              { label: "Status", value: compactText(acceptanceWatch.summary.phase_d_status || "PENDING") },
              { label: "Reason", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
              { label: "Apply Pass", value: acceptanceWatch.summary.apply_pass ? "YES" : "NO" },
              { label: "Ready", value: acceptanceWatch.summary.phase_d_ready ? "YES" : "NO" },
            ],
          },
          {
            title: "Current Market",
            tone: "warn",
            rows: [
              { label: "Markets", value: joinList(acceptanceWatch.summary.configured_server_primary_markets || []) },
              { label: "Observed", value: numberText(acceptanceWatch.summary.observed_n, 0) },
              { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0) },
              { label: "Realized", value: numberText(acceptanceWatch.summary.realized_n, 0) },
            ],
          },
          {
            title: "Expand Rule",
            tone: "dim",
            rows: [
              { label: "Min Executed", value: numberText(acceptanceWatch.summary.min_executed_n || acceptanceWatch.summary.acceptance_min_executed, 0) },
              { label: "Max Disagreement", value: numberText(((acceptanceWatch.summary.max_disagreement_rate || acceptanceWatch.summary.acceptance_max_disagreement_rate) || 0) * 100, 1) + "%" },
              { label: "Max Rollback", value: numberText(acceptanceWatch.summary.max_rollback_trigger_n || acceptanceWatch.summary.acceptance_max_rollback_trigger_n, 0) },
              { label: "Gap", value: numberText(Math.max(0, (acceptanceWatch.summary.min_executed_n || acceptanceWatch.summary.acceptance_min_executed || 0) - (acceptanceWatch.summary.executed_n || 0)), 0) },
            ],
          },
        ],
      },
      {
        title: "Acceptance Threshold",
        description: "시장별 evidence와 가드레일입니다.",
        columns: 2,
        cards: [
          {
            title: "Current Evidence",
            tone: statusTone(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason),
            rows: [
              { label: "Reason", value: compactText(acceptanceWatch.summary.phase_d_reason || acceptanceWatch.summary.acceptance_reason) },
              { label: "Observed", value: numberText(acceptanceWatch.summary.observed_n, 0) },
              { label: "Executed", value: numberText(acceptanceWatch.summary.executed_n, 0) },
              { label: "Realized", value: numberText(acceptanceWatch.summary.realized_n, 0) },
            ],
          },
          {
            title: "Thresholds",
            tone: "dim",
            rows: [
              { label: "Min Executed", value: numberText(acceptanceWatch.summary.acceptance_min_executed || acceptanceWatch.summary.min_executed_n, 0) },
              { label: "Max Disagreement", value: numberText(((acceptanceWatch.summary.acceptance_max_disagreement_rate != null ? acceptanceWatch.summary.acceptance_max_disagreement_rate : acceptanceWatch.summary.max_disagreement_rate) || 0) * 100, 1) + "%" },
              { label: "Max Rollback", value: numberText(acceptanceWatch.summary.acceptance_max_rollback_trigger_n != null ? acceptanceWatch.summary.acceptance_max_rollback_trigger_n : acceptanceWatch.summary.max_rollback_trigger_n, 0) },
              { label: "Ready", value: acceptanceWatch.summary.acceptance_ready || acceptanceWatch.summary.phase_d_ready ? "YES" : "NO" },
            ],
          },
          {
            title: "Market Evidence",
            tone: "warn",
            table: {
              columns: [
                { key: "market", label: "Market" },
                { key: "executed", label: "Executed" },
                { key: "realized", label: "Realized" },
                { key: "disagreement", label: "Disagreement" },
                { key: "rollback", label: "Rollback" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(acceptanceWatch.rows, (row) => ({
                market: compactText(row.market),
                executed: numberText(row.executed_n, 0),
                realized: numberText(row.realized_n, 0),
                disagreement: toDisplayPercent(row.pine_shadow_disagreement_rate, 1),
                rollback: numberText(row.rollback_trigger_n, 0),
                open: buildLink("Report", buildReportUrl(row.market)),
              }), 6),
            },
          },
        ],
      },
    ],
  });
}

function buildAuditViewModel(query = {}) {
  const loopMonitor = loadLatestArtifact("best_self_evolution_loop_monitor_latest.json");
  const objectiveSupervisor = loadLatestArtifact("objective_supervisor_latest.json");
  const watchdog = loadLatestArtifact("automation_watchdog_latest.json");
  const stageAutopilot = loadLatestArtifact("stage_autopilot_latest.json");
  const dataset = loadLatestArtifact("best_self_evolution_dataset_latest.json");
  const parity = loadLatestArtifact("best_self_evolution_canonical_engine_parity_latest.json");
  const provenance = loadLatestArtifact("best_self_evolution_canonical_engine_provenance_latest.json");
  const focus = String(query.focus || "").trim();
  const collection = String(query.collection || "").trim();
  const source = String(query.source || "").trim();
  return localizeViewModel({
    active: "audit",
    title: "기록 점검",
    hero: {
      eyebrow: "기록과 증거",
      title: compactText(loopMonitor.summary.overall_status),
      detail: `${compactText(loopMonitor.summary.cycle_id)} · blockers ${joinList(loopMonitor.summary.critical_blockers || [])}`,
      tone: statusTone(loopMonitor.summary.overall_status),
      pills: [
        { label: "Cycle", value: loopMonitor.summary.cycle_consistent ? "CONSISTENT" : "MISMATCH", tone: statusTone(loopMonitor.summary.cycle_consistent ? "PASS" : "FAIL") },
        { label: "Fresh", value: `${numberText(loopMonitor.summary.fresh_loop_n, 0)}/${numberText(loopMonitor.summary.loop_n, 0)}`, tone: "ok" },
        { label: "Watchdog", value: compactText(watchdog.display && watchdog.display.verdict), tone: statusTone(watchdog.display && watchdog.display.verdict) },
        { label: "Stage Eval", value: compactText(stageAutopilot.display && stageAutopilot.display.evaluation_cycle_id), tone: "dim" },
      ],
    },
    metrics: [
      { label: "Current Cycle", value: compactText(loopMonitor.summary.cycle_id), meta: compactText(loopMonitor.summary.overall_status), tone: statusTone(loopMonitor.summary.overall_status) },
      { label: "Critical Blockers", value: numberText(loopMonitor.summary.critical_blocker_n, 0), meta: joinList(loopMonitor.summary.critical_blockers || []), tone: loopMonitor.summary.critical_blocker_n > 0 ? "bad" : "ok" },
      { label: "Watchdog", value: compactText(watchdog.display && watchdog.display.scheduler_mode), meta: `issues ${numberText(watchdog.display && watchdog.display.issue_count, 0)}`, tone: statusTone(watchdog.display && watchdog.display.verdict) },
      { label: "Supervisor", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.verdict), meta: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause), tone: statusTone(objectiveSupervisor.display && objectiveSupervisor.display.verdict) },
    ],
    sections: [
      {
        title: "Operator Strip",
        description: "cycle health, blocker, wrapper rule을 운영자 strip으로 올립니다.",
        columns: 3,
        cards: [
          {
            title: "Cycle Health",
            tone: statusTone(loopMonitor.summary.overall_status),
            rows: [
              { label: "Cycle Consistent", value: loopMonitor.summary.cycle_consistent ? "YES" : "NO" },
              { label: "Fresh", value: `${numberText(loopMonitor.summary.fresh_loop_n, 0)}/${numberText(loopMonitor.summary.loop_n, 0)}` },
              { label: "Stale", value: numberText(loopMonitor.summary.stale_artifact_n, 0) },
              { label: "Mismatch", value: numberText(loopMonitor.summary.cycle_mismatch_n, 0) },
            ],
          },
          {
            title: "Current Blocker",
            tone: loopMonitor.summary.critical_blocker_n > 0 ? "bad" : "ok",
            rows: [
              { label: "Supervisor", value: compactText(objectiveSupervisor.display && objectiveSupervisor.display.root_cause) },
              { label: "Critical", value: joinList(loopMonitor.summary.critical_blockers || []) },
              { label: "Ready Candidate", value: compactText(loopMonitor.summary.ready_candidate_id) },
              { label: "Overall", value: compactText(loopMonitor.summary.overall_status) },
            ],
          },
          {
            title: "Artifact Timeline",
            tone: "dim",
            table: {
              columns: [
                { key: "artifact", label: "Artifact" },
                { key: "generated", label: "Generated" },
                { key: "status", label: "Status" },
              ],
              rows: [
                { artifact: "dataset", generated: compactText(dataset.raw && dataset.raw.generated_at_kst), status: numberText(dataset.summary.rows_n, 0) },
                { artifact: "parity", generated: compactText(parity.raw && parity.raw.generated_at_kst), status: `${numberText(parity.summary.source_parity_match_n, 0)}/${numberText(parity.summary.shadow_observed_n, 0)}` },
                { artifact: "provenance", generated: compactText(provenance.raw && provenance.raw.generated_at_kst), status: `${numberText(provenance.summary.complete_n, 0)}/${numberText(provenance.summary.engine_eligible_n, 0)}` },
                { artifact: "loop_monitor", generated: compactText(loopMonitor.raw && loopMonitor.raw.generated_at_kst), status: compactText(loopMonitor.summary.overall_status) },
              ],
            },
          },
        ],
      },
      {
        title: "Critical Loops",
        description: "현재 cycle의 각 loop row를 직접 읽습니다.",
        columns: 2,
        cards: [
          {
            title: "Loop Rows",
            tone: statusTone(loopMonitor.summary.overall_status),
            table: {
              columns: [
                { key: "loop", label: "Loop" },
                { key: "status", label: "Status" },
                { key: "fresh", label: "Fresh" },
                { key: "reason", label: "Reason" },
                { key: "open", label: "Open" },
              ],
              rows: buildRowsPreview(loopMonitor.rows, (row) => ({
                loop: compactText(row.loop),
                status: compactText(row.status),
                fresh: row.fresh ? "YES" : "NO",
                reason: compactText(row.reason, 56),
                open: buildLink("Open", buildLoopHref(row.loop)),
              }), 10),
            },
          },
          {
            title: "Stage Autopilot Caveat",
            tone: "warn",
            rows: [
              { label: "cycle_id", value: compactText(stageAutopilot.display && stageAutopilot.display.cycle_id) },
              { label: "evaluation_cycle_id", value: compactText(stageAutopilot.display && stageAutopilot.display.evaluation_cycle_id) },
              { label: "loop monitor source", value: compactText(stageAutopilot.display && stageAutopilot.display.self_evolution_loop_monitor && stageAutopilot.display.self_evolution_loop_monitor.source) },
              { label: "interpretation", value: "main cycle + post-loop re-evaluation" },
            ],
            notes: [
              "stage_autopilot latest는 post-loop 재평가를 덮어쓸 수 있습니다.",
              "cycle 판단은 loop_monitor와 함께 읽어야 합니다.",
            ],
          },
        ],
      },
      {
        title: "Focused Drill-Through",
        description: "실행/기록 점검 화면에서 선택한 집중 대상을 그대로 보여줍니다.",
        columns: 2,
        cards: [
          {
            title: "Focused Target",
            tone: focus ? "warn" : "dim",
            rows: [
              { label: "Focus", value: compactText(focus || "none") },
              { label: "Collection", value: compactText(collection || "-") },
              { label: "Source", value: compactText(source || "-") },
              { label: "Interpretation", value: focus ? "query-scoped drill-through" : "open from Execution tables to focus a target" },
            ],
          },
          {
            title: "Next Jump",
            tone: "dim",
            rows: [
              { label: "Execution", value: "/dashboard/execution" },
              { label: "Deployment", value: "/dashboard/deployment" },
              { label: "Phase D", value: "/dashboard/server-primary" },
              { label: "Report", value: "/dashboard/report?mode=weekly" },
            ],
          },
        ],
      },
    ],
  });
}

function buildControlPlaneRouteModel(pageKey, query = {}) {
  const key = String(pageKey || "mission").toLowerCase();
  if (key === "recovery") return buildRecoveryViewModel();
  if (key === "deployment") return buildDeploymentViewModel();
  if (key === "execution") return buildExecutionViewModel(query);
  if (key === "server-primary") return buildServerPrimaryViewModel();
  if (key === "audit") return buildAuditViewModel(query);
  return buildMissionControlViewModel();
}

module.exports = {
  buildMissionControlViewModel,
  buildRecoveryViewModel,
  buildDeploymentViewModel,
  buildExecutionViewModel,
  buildServerPrimaryViewModel,
  buildAuditViewModel,
  buildControlPlaneRouteModel,
  __test: {
    hasArtifactContent,
    buildFallbackArtifactCandidates,
    listDailyArtifactFiles,
    loadLatestArtifact,
  },
};
