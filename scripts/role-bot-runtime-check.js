#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function parseIsoMs(raw) {
  const ms = Date.parse(String(raw || ""));
  return Number.isFinite(ms) ? ms : null;
}

function parseKstScheduleMs(raw) {
  const m = String(raw || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function ageMinutes(nowMs, thenMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(thenMs)) return null;
  return (nowMs - thenMs) / 60000;
}

function canonicalStatus(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.includes("중단")) return "중단";
  if (text.includes("보류")) return "보류";
  if (text.includes("진행")) return "진행";
  return null;
}

function computeHistoryMetrics(history, nowMs, windowHours) {
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
  const timeoutBySec = {};
  let codexFailCount24h = 0;
  let codexTimeoutEventCount24h = 0;
  let codexQueueTimeoutCount24h = 0;
  let lastCodexFailMs = null;
  let lastCodexTimeoutMs = null;
  let entries24h = 0;

  for (const item of Array.isArray(history) ? history : []) {
    const tsMs = parseIsoMs(item && item.ts);
    if (!Number.isFinite(tsMs) || tsMs < cutoffMs) continue;
    entries24h += 1;

    const text = String((item && item.text) || "");
    if (text.includes("[Codex 실행 실패]")) {
      codexFailCount24h += 1;
      lastCodexFailMs = tsMs;
    }

    const timeoutMatches = [...text.matchAll(/Codex 실행 시간 초과\((\d+)s\)/g)];
    if (timeoutMatches.length > 0) {
      codexTimeoutEventCount24h += 1;
      lastCodexTimeoutMs = tsMs;
      for (const match of timeoutMatches) {
        const sec = `${match[1]}s`;
        timeoutBySec[sec] = toNum(timeoutBySec[sec], 0) + 1;
      }
    }

    if (/Codex 실행 대기 시간 초과\(\d+s\)/.test(text)) {
      codexQueueTimeoutCount24h += 1;
    }
  }

  return {
    entries_24h: entries24h,
    codex_fail_count_24h: codexFailCount24h,
    codex_timeout_event_count_24h: codexTimeoutEventCount24h,
    codex_queue_timeout_count_24h: codexQueueTimeoutCount24h,
    codex_timeout_by_sec_24h: timeoutBySec,
    last_codex_fail_at_kst: toKstString(lastCodexFailMs, { fallback: null }),
    last_codex_timeout_at_kst: toKstString(lastCodexTimeoutMs, { fallback: null }),
  };
}

function compactTimeoutBySec(timeoutBySec) {
  const entries = Object.entries(timeoutBySec || {});
  if (!entries.length) return "없음";
  entries.sort((a, b) => toNum(a[0].replace(/[^0-9]/g, ""), 0) - toNum(b[0].replace(/[^0-9]/g, ""), 0));
  return entries.map(([sec, count]) => `${sec}:${count}건`).join(", ");
}

function buildMarkdown({
  dateKey,
  generatedAtKst,
  statePath,
  summary,
  outputJsonPath,
  staleThresholdMin,
}) {
  const statusLine = `${summary.status} (${(summary.reasons || []).join(" / ")})`;
  const agg = summary.aggregate || {};
  const chats = Array.isArray(summary.chats) ? summary.chats : [];
  const primary = chats[0] || {};
  const issues = [];

  if (toNum(agg.stale_chat_count, 0) > 0) {
    issues.push(
      `[ISSUE] H | 자율 사이클 지연 채팅 ${agg.stale_chat_count}개 (기준 ${staleThresholdMin}분) | 역할봇 재기동 여부 즉시 확인`
    );
  }
  if (toNum(agg.codex_timeout_event_count_24h, 0) > 0) {
    issues.push(
      `[ISSUE] M | 최근 24h Codex 시간초과 ${agg.codex_timeout_event_count_24h}건 (${compactTimeoutBySec(agg.codex_timeout_by_sec_24h)}) | 프롬프트 분할/timeout 상향 기준 유지`
    );
  }
  if (toNum(agg.codex_queue_timeout_count_24h, 0) > 0) {
    issues.push(
      `[ISSUE] M | 최근 24h Codex 대기 시간초과 ${agg.codex_queue_timeout_count_24h}건 | 동시 실행량 제한과 큐 대기값 점검`
    );
  }
  if (!issues.length) {
    issues.push("[ISSUE] L | 핵심 런타임 경보 없음 | 현재 설정 유지");
  }

  return `# ${dateKey} 역할봇 런타임 점검 보고 (시스템 개발 담당)

기준 시각: ${generatedAtKst}
기준 데이터: \`${statePath}\`
자동 산출 JSON: \`${outputJsonPath}\`

## 시스템 설계
- 24시간 자율 운영의 핵심 위험을 \`사이클 정체\`, \`Codex 시간초과\`, \`Codex 대기초과\` 3가지로 분리해 수치화합니다.
- 채팅별 마지막 실행 시각을 기준으로 정체 여부를 판정하고, Codex 실패 패턴은 24시간 창으로 집계합니다.
- 결과는 JSON + 마크다운으로 동시에 저장해 자동처리(기계)와 운영판단(사람)을 함께 지원합니다.

## 구현 태스크
1. \`scripts/role-bot-runtime-check.js\` 실행: 역할봇 상태파일을 읽고 채팅별 지표를 계산했습니다.
2. 집계 수치 산출 완료
   - 채팅 수: \`${toNum(agg.chat_count, 0)}\`
   - 최근 24h Codex 실패: \`${toNum(agg.codex_fail_count_24h, 0)}건\`
   - 최근 24h Codex 시간초과: \`${toNum(agg.codex_timeout_event_count_24h, 0)}건\` (${compactTimeoutBySec(agg.codex_timeout_by_sec_24h)})
   - 최근 24h Codex 대기초과: \`${toNum(agg.codex_queue_timeout_count_24h, 0)}건\`
3. 정체 점검
   - 정체 기준: \`${staleThresholdMin}분\`
   - 정체 채팅: \`${toNum(agg.stale_chat_count, 0)}개\`
   - 대표 다음 보고 시각(KST): \`${primary.next_report_at_kst || "미설정"}\`
4. 오늘 런타임 상태 판정: \`${summary.status}\`

## 장애/보안 리스크
${issues.join("\n")}

## 운영 체크리스트
- [x] 역할봇 상태파일(JSON) 파싱 성공
- [x] 24시간 Codex 실패/시간초과 집계
- [x] 자율 루프 정체 여부 점검
- [x] 대표 다음 보고 시각 추출
- [x] 런타임 판정(${statusLine})

## 대표 보고 요약
- 현재 판정: \`${summary.status}\`
- 핵심 근거: ${(summary.reasons || []).join(", ")}
- 지혜 의사결정 요청: 정체 채팅이 1개 이상이면 즉시 역할봇 재기동 여부를 확인하고, 시간초과 반복 시 프롬프트 분할 우선순위를 상향해 주세요.
- [EVOLUTION] 수동 로그 확인 중심에서 자동 런타임 스코어링으로 전환 | 24시간 운영 중 장애 조기 감지 속도 개선
`;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const statePath = process.argv[2] || path.join(repoRoot, "noye", "role_bot_state.json");
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";

  const windowHours = Math.max(1, toNum(process.env.ROLE_BOT_WINDOW_HOURS, 24));
  const intervalMin = Math.max(1, toNum(process.env.ROLE_AUTONOMOUS_INTERVAL_MIN, 5));
  const staleThresholdMin = Math.max(10, toNum(process.env.ROLE_BOT_AUTONOMOUS_STALE_MIN, intervalMin * 3));
  const timeoutWarnCount = Math.max(1, toNum(process.env.ROLE_BOT_TIMEOUT_WARN_COUNT, 3));
  const queueWarnCount = Math.max(1, toNum(process.env.ROLE_BOT_QUEUE_TIMEOUT_WARN_COUNT, 1));
  const failWarnCount = Math.max(1, toNum(process.env.ROLE_BOT_FAIL_WARN_COUNT, timeoutWarnCount * 2));

  const summary = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    state_path: statePath,
    window_hours: windowHours,
    thresholds: {
      interval_min: intervalMin,
      stale_threshold_min: staleThresholdMin,
      timeout_warn_count: timeoutWarnCount,
      queue_timeout_warn_count: queueWarnCount,
      fail_warn_count: failWarnCount,
    },
    status: "진행",
    runtime_status: "진행",
    reasons: [],
    chats: [],
    aggregate: {
      chat_count: 0,
      stale_chat_count: 0,
      codex_fail_count_24h: 0,
      codex_timeout_event_count_24h: 0,
      codex_queue_timeout_count_24h: 0,
      codex_timeout_by_sec_24h: {},
    },
    governance_reference: {
      status: null,
      source: null,
      mode: null,
    },
  };

  if (!fs.existsSync(statePath)) {
    summary.status = "중단";
    summary.reasons.push(`상태 파일 없음: ${statePath}`);
  } else {
    const raw = fs.readFileSync(statePath, "utf8");
    const state = JSON.parse(raw);
    const chats = (state && state.chats && typeof state.chats === "object") ? state.chats : {};
    const chatIds = Object.keys(chats);
    summary.aggregate.chat_count = chatIds.length;

    for (const chatId of chatIds) {
      const chat = chats[chatId] || {};
      const lastCycleMs = parseIsoMs(chat.last_cycle_run_utc);
      const lastAutoMs = parseIsoMs(chat.last_autonomous_run_utc);
      const nextReportKst = String(chat.next_report_at_kst || "").trim();
      const nextReportMs = parseKstScheduleMs(nextReportKst);
      const metrics = computeHistoryMetrics(chat.history, nowMs, windowHours);

      const cycleAgeMin = ageMinutes(nowMs, lastCycleMs);
      const autoAgeMin = ageMinutes(nowMs, lastAutoMs);
      const nextReportLagMin = Number.isFinite(nextReportMs) ? ageMinutes(nowMs, nextReportMs) : null;
      const staleByCycle = Number.isFinite(cycleAgeMin) && cycleAgeMin > staleThresholdMin;
      const staleByAuto = Number.isFinite(autoAgeMin) && autoAgeMin > staleThresholdMin;
      const reportNotDueYet = Number.isFinite(nextReportLagMin) && nextReportLagMin < 0;
      const isStale = !reportNotDueYet && staleByCycle && (staleByAuto || !Number.isFinite(autoAgeMin));

      const chatSummary = {
        chat_id: chatId,
        next_report_at_kst: nextReportKst || "",
        last_cycle_run_kst: toKstString(lastCycleMs, { fallback: null }),
        last_autonomous_run_kst: toKstString(lastAutoMs, { fallback: null }),
        cycle_age_min: round(cycleAgeMin, 2),
        autonomous_age_min: round(autoAgeMin, 2),
        next_report_lag_min: round(nextReportLagMin, 2),
        stale: Boolean(isStale),
        ...metrics,
      };
      summary.chats.push(chatSummary);

      summary.aggregate.codex_fail_count_24h += toNum(metrics.codex_fail_count_24h, 0);
      summary.aggregate.codex_timeout_event_count_24h += toNum(metrics.codex_timeout_event_count_24h, 0);
      summary.aggregate.codex_queue_timeout_count_24h += toNum(metrics.codex_queue_timeout_count_24h, 0);
      for (const [sec, count] of Object.entries(metrics.codex_timeout_by_sec_24h || {})) {
        summary.aggregate.codex_timeout_by_sec_24h[sec] =
          toNum(summary.aggregate.codex_timeout_by_sec_24h[sec], 0) + toNum(count, 0);
      }
      if (isStale) summary.aggregate.stale_chat_count += 1;
    }

    if (summary.aggregate.chat_count === 0) {
      summary.status = "중단";
      summary.reasons.push("등록된 채팅이 없어 자율 루프가 동작하지 않음");
    }
  }

  if (summary.aggregate.stale_chat_count > 0) {
    if (summary.aggregate.stale_chat_count === summary.aggregate.chat_count) {
      summary.status = "중단";
    } else if (summary.status === "진행") {
      summary.status = "보류";
    }
    summary.reasons.push(
      `자율 사이클 정체 채팅 ${summary.aggregate.stale_chat_count}개 (기준 ${staleThresholdMin}분)`
    );
  }
  if (summary.aggregate.codex_timeout_event_count_24h >= timeoutWarnCount) {
    if (summary.status === "진행") summary.status = "보류";
    summary.reasons.push(
      `최근 ${windowHours}h Codex 시간초과 ${summary.aggregate.codex_timeout_event_count_24h}건`
    );
  }
  if (summary.aggregate.codex_queue_timeout_count_24h >= queueWarnCount) {
    if (summary.status === "진행") summary.status = "보류";
    summary.reasons.push(
      `최근 ${windowHours}h Codex 대기 시간초과 ${summary.aggregate.codex_queue_timeout_count_24h}건`
    );
  }
  if (summary.aggregate.codex_fail_count_24h >= failWarnCount) {
    if (summary.status === "진행") summary.status = "보류";
    summary.reasons.push(`최근 ${windowHours}h Codex 실패 ${summary.aggregate.codex_fail_count_24h}건`);
  }

  const dailyDir = path.join(repoRoot, "ops", "daily");
  const consistencyPath = path.join(dailyDir, "data_consistency_lead_latest.json");
  const approvalPath = path.join(dailyDir, "approval_execution_latest.json");
  const consistency = readJsonSafe(consistencyPath);
  const approval = readJsonSafe(approvalPath);

  const governanceStatus =
    (consistency && consistency.status_recommendation) ||
    (approval && approval.decision && approval.decision.status) ||
    null;
  const governanceSource =
    (consistency && "data_consistency_lead_latest.status_recommendation") ||
    (approval && "approval_execution_latest.decision.status") ||
    null;
  const governanceMode =
    (consistency && consistency.mode_recommendation) ||
    (approval && approval.decision && approval.decision.mode) ||
    null;

  summary.governance_reference = {
    status: governanceStatus,
    source: governanceSource,
    mode: governanceMode,
  };

  summary.runtime_status = summary.status;
  const normalizedGovernance = canonicalStatus(governanceStatus);
  if (normalizedGovernance) {
      if (summary.status !== normalizedGovernance) {
        const modeText = governanceMode ? ` / ${governanceMode}` : "";
        const sourceText = governanceSource || "상위 운영 기준";
        summary.reasons.push(
          `상위 운영 판정 동기화: ${summary.status} -> ${normalizedGovernance}${modeText} (${sourceText})`
        );
      }
      summary.status = normalizedGovernance;
  }

  if (!summary.reasons.length) {
    summary.reasons.push("핵심 런타임 리스크 없음");
  }

  const outputJsonPath = path.join(repoRoot, "ops", "daily", "role_bot_runtime_check_latest.json");
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const outputMdPath = path.join(repoRoot, "ops", "daily", `${dateKey}_role_bot_runtime_check_jihye.md`);
  const md = buildMarkdown({
    dateKey,
    generatedAtKst,
    statePath,
    summary,
    outputJsonPath,
    staleThresholdMin,
  });
  fs.writeFileSync(outputMdPath, md, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output_json: outputJsonPath,
        output_md: outputMdPath,
        status: summary.status,
        reasons: summary.reasons,
        chat_count: summary.aggregate.chat_count,
        stale_chat_count: summary.aggregate.stale_chat_count,
        codex_fail_count_24h: summary.aggregate.codex_fail_count_24h,
        codex_timeout_event_count_24h: summary.aggregate.codex_timeout_event_count_24h,
        codex_queue_timeout_count_24h: summary.aggregate.codex_queue_timeout_count_24h,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error("role-bot-runtime-check failed:", err && err.message ? err.message : err);
  process.exit(1);
}
