#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const APPROVAL_PATH = path.join(OPS_DAILY, "approval_execution_latest.json");
const ROLE_STATE_PATH = path.join(ROOT, "noye", "role_bot_state.json");
const SLOT_MINUTES = 30;
const STAFF_LEAD_MINUTES = 2;

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function writeJson(absPath, payload) {
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function parseKstToMs(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s*KST)?$/);
  if (!m) return null;
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]) - 9,
    Number(m[5]),
    Number(m[6] || "0"),
    0
  );
}

function formatKst(rawMs) {
  return `${toKstString(rawMs, { fallbackToString: true }).slice(0, 16)} KST`;
}

function formatKstPlain(rawMs) {
  return toKstString(rawMs, { fallbackToString: true }).slice(0, 16);
}

function pickLatestMatrixPath() {
  if (!fs.existsSync(OPS_DAILY)) return null;
  const names = fs
    .readdirSync(OPS_DAILY)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_governance_reporting_matrix_.*_jihye\.json$/.test(name));
  if (!names.length) return null;

  let chosen = null;
  let chosenMs = -Infinity;
  for (const name of names) {
    const abs = path.join(OPS_DAILY, name);
    let mtimeMs = null;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch (_err) {
      continue;
    }
    if (mtimeMs > chosenMs) {
      chosen = abs;
      chosenMs = mtimeMs;
    }
  }
  return chosen;
}

function ceilToNextSlotMs(nowMs, slotMinutes) {
  const slotMs = Math.max(1, slotMinutes) * 60000;
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const kstMs = nowMs + kstOffsetMs;
  const nextKstMs = Math.ceil(kstMs / slotMs) * slotMs;
  return nextKstMs - kstOffsetMs;
}

function rollForwardToFutureSlotMs(baseMs, nowMs, slotMinutes) {
  if (!Number.isFinite(baseMs)) return null;
  const slotMs = Math.max(1, slotMinutes) * 60000;
  let target = baseMs;
  while (target <= nowMs + 60000) target += slotMs;
  return target;
}

function buildMarkdown(payload) {
  const before = payload.before;
  const after = payload.after;
  const checks = payload.self_validation.checks.map((x) => `- ${x}`).join("\n");
  const issues = payload.issues.length ? payload.issues.join("\n") : "- 없음";
  const evolutions = payload.evolution.map((x) => `- ${x}`).join("\n");

  return `# ${payload.date_key} report_clock_resync_${payload.cycle} (report_clock_manager)

1) 핵심 결론
- 역할봇/대표 보고 시각 충돌을 30분 체계로 즉시 재동기화했습니다.
- 적용 결과: staff->지혜 \`${after.staff_to_jihye}\`, 지혜->재용 \`${after.jihye_to_jaeyong}\`, 역할봇 \`${after.role_bot_next_report_at}\`.
- 적용 전 충돌 기준값: matrix \`${before.matrix_jihye_to_jaeyong}\`, approval \`${before.approval_jihye_to_jaeyong}\`, role_bot \`${before.role_bot_next_report_at}\`.

2) 실제 수행한 작업 (번호 목록)
1. 최신 거버넌스 매트릭스 파일 자동 탐색 및 로드
2. 승인 최신본/역할봇 상태 파일에서 next_report 시각 파싱
3. 과거 시각(지난 보고 시각)을 현재 기준 다음 30분 슬롯으로 롤포워드
4. matrix/approval/role_bot 3개 파일 동시 갱신
5. 재로딩 검증으로 파일 간 일치 여부 확인

3) 변경 파일/산출물
- \`${payload.artifacts.output_json_dated}\`
- \`${payload.artifacts.output_md_dated}\`
- \`${payload.artifacts.output_json_latest}\`
- \`${payload.artifacts.output_md_latest}\`
- \`${payload.updated_paths.matrix}\`
- \`${payload.updated_paths.approval}\`
- \`${payload.updated_paths.role_state}\`

4) 지혜에게 보고할 핵심
- 진행률: 100%
- 핵심 성과: report 시각 소스 3종 일치화 완료
- 리스크:
${issues}

5) 재용에게 보여줄 쉬운 요약(비개발자용)
- 보고 시간이 서로 안 맞던 문제를 지금 즉시 같은 시간으로 맞췄습니다.
- 다음 보고는 30분 기준으로 자동 연결되게 정리했습니다.

6) 리스크/확인사항
- 자가검증:
${checks}
- 자가검증 결과: ${payload.self_validation.result}

진화 계획
${evolutions}
`;
}

function main() {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const nowKst = toKstString(nowMs, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const cycle = nowKst.slice(11, 16).replace(":", "");

  const matrixPath = pickLatestMatrixPath();
  const matrix = matrixPath ? readJsonSafe(matrixPath) : null;
  const approval = readJsonSafe(APPROVAL_PATH);
  const roleState = readJsonSafe(ROLE_STATE_PATH);

  if (!matrixPath || !matrix) {
    throw new Error("governance reporting matrix latest 파일을 찾지 못했습니다.");
  }
  if (!approval) {
    throw new Error("approval_execution_latest.json 로드 실패");
  }
  if (!roleState || !roleState.chats || typeof roleState.chats !== "object") {
    throw new Error("role_bot_state.json 로드 실패 또는 chats 누락");
  }

  const roleChatIds = Object.keys(roleState.chats);
  const roleChat0 = roleChatIds.length ? roleState.chats[roleChatIds[0]] : {};

  const before = {
    matrix_staff_to_jihye: matrix?.report_system?.next_report?.staff_to_jihye || null,
    matrix_jihye_to_jaeyong: matrix?.report_system?.next_report?.jihye_to_jaeyong || null,
    approval_staff_to_jihye: approval?.next_report?.staff_to_jihye || null,
    approval_jihye_to_jaeyong: approval?.next_report?.jihye_to_jaeyong || null,
    role_bot_next_report_at: roleChat0?.next_report_at_kst || null,
  };

  const candidateFromApproval = parseKstToMs(before.approval_jihye_to_jaeyong);
  const candidateFromMatrix = parseKstToMs(before.matrix_jihye_to_jaeyong);
  const baseCandidateMs = Number.isFinite(candidateFromApproval)
    ? candidateFromApproval
    : Number.isFinite(candidateFromMatrix)
    ? candidateFromMatrix
    : null;
  const rolledMs = rollForwardToFutureSlotMs(baseCandidateMs, nowMs, SLOT_MINUTES);
  const targetJihyeMs = Number.isFinite(rolledMs) ? rolledMs : ceilToNextSlotMs(nowMs + 60000, SLOT_MINUTES);
  const targetStaffMs = targetJihyeMs - STAFF_LEAD_MINUTES * 60000;

  const targetJihyeKst = formatKst(targetJihyeMs);
  const targetStaffKst = formatKst(targetStaffMs);
  const targetRoleKst = formatKstPlain(targetJihyeMs);

  matrix.report_system = matrix.report_system || {};
  matrix.report_system.next_report = matrix.report_system.next_report || {};
  matrix.report_system.next_report.staff_to_jihye = targetStaffKst;
  matrix.report_system.next_report.jihye_to_jaeyong = targetJihyeKst;
  matrix.report_clock_sync_note = `report_clock_manager 동기화 반영: ${targetStaffKst} / ${targetJihyeKst}`;

  approval.next_report = approval.next_report || {};
  approval.next_report.staff_to_jihye = targetStaffKst;
  approval.next_report.jihye_to_jaeyong = targetJihyeKst;
  approval.report_clock_sync_note = `report_clock_manager 동기화 반영: ${targetStaffKst} / ${targetJihyeKst}`;

  for (const chatId of roleChatIds) {
    const chat = roleState.chats[chatId] || {};
    chat.next_report_at_kst = targetRoleKst;
    chat.next_report_reason = "report_clock_manager 30분 체계 자동 동기화";
    roleState.chats[chatId] = chat;
  }

  writeJson(matrixPath, matrix);
  writeJson(APPROVAL_PATH, approval);
  writeJson(ROLE_STATE_PATH, roleState);

  const verifyMatrix = readJsonSafe(matrixPath) || {};
  const verifyApproval = readJsonSafe(APPROVAL_PATH) || {};
  const verifyRoleState = readJsonSafe(ROLE_STATE_PATH) || {};
  const verifyRoleChatIds =
    verifyRoleState && verifyRoleState.chats && typeof verifyRoleState.chats === "object"
      ? Object.keys(verifyRoleState.chats)
      : [];
  const verifyRoleChat0 = verifyRoleChatIds.length ? verifyRoleState.chats[verifyRoleChatIds[0]] : {};

  const after = {
    staff_to_jihye: verifyMatrix?.report_system?.next_report?.staff_to_jihye || null,
    jihye_to_jaeyong: verifyMatrix?.report_system?.next_report?.jihye_to_jaeyong || null,
    approval_staff_to_jihye: verifyApproval?.next_report?.staff_to_jihye || null,
    approval_jihye_to_jaeyong: verifyApproval?.next_report?.jihye_to_jaeyong || null,
    role_bot_next_report_at: verifyRoleChat0?.next_report_at_kst || null,
  };

  const checks = [];
  let result = "pass";

  if (after.staff_to_jihye === targetStaffKst && after.jihye_to_jaeyong === targetJihyeKst) {
    checks.push("matrix next_report 동기화 확인");
  } else {
    checks.push("matrix next_report 동기화 실패");
    result = "fail";
  }

  if (
    after.approval_staff_to_jihye === targetStaffKst
    && after.approval_jihye_to_jaeyong === targetJihyeKst
  ) {
    checks.push("approval next_report 동기화 확인");
  } else {
    checks.push("approval next_report 동기화 실패");
    result = "fail";
  }

  if (after.role_bot_next_report_at === targetRoleKst) {
    checks.push("role_bot_state next_report 동기화 확인");
  } else {
    checks.push("role_bot_state next_report 동기화 실패");
    result = "fail";
  }

  const issues = [];
  if (result !== "pass") {
    issues.push("[ISSUE] H | report 시각 동기화 일부 실패 | 파일 권한/경로 확인 필요");
  } else {
    issues.push("[ISSUE] L | 동기화 완료 후 후속 재집계 필요 | sync/reliability/clock 스크립트 재실행");
  }

  const payload = {
    generated_at_kst: nowKst,
    date_key: dateKey,
    cycle,
    role: "report_clock_manager",
    action: "next_report_30m_resync",
    slot_minutes: SLOT_MINUTES,
    staff_lead_minutes: STAFF_LEAD_MINUTES,
    source_priority: [
      "approval_execution_latest.next_report.jihye_to_jaeyong",
      "governance_reporting_matrix_latest.report_system.next_report.jihye_to_jaeyong",
      "now 기준 다음 30분 슬롯",
    ],
    before,
    after,
    updated_paths: {
      matrix: matrixPath,
      approval: APPROVAL_PATH,
      role_state: ROLE_STATE_PATH,
    },
    issues,
    evolution: [
      "[EVOLUTION] 고정 시각(01:30/09:00) 충돌 대응에서 현재시각 기준 30분 슬롯 자동 롤포워드로 전환 | 시각 충돌 재발 감소",
      "[EVOLUTION] matrix/approval/role_state 3개 파일을 한 번에 동기화 | 후속 점검 지표 일치도 개선",
    ],
    self_validation: {
      checks,
      result,
    },
    artifacts: {},
  };

  const datedJson = path.join(OPS_DAILY, `${dateKey}_report_clock_resync_${cycle}_jihye.json`);
  const datedMd = path.join(OPS_DAILY, `${dateKey}_report_clock_resync_${cycle}_jihye.md`);
  const latestJson = path.join(OPS_DAILY, "report_clock_resync_latest.json");
  const latestMd = path.join(OPS_DAILY, "report_clock_resync_latest.md");
  payload.artifacts = {
    output_json_dated: datedJson,
    output_md_dated: datedMd,
    output_json_latest: latestJson,
    output_md_latest: latestMd,
  };

  const markdown = buildMarkdown(payload);
  writeJson(datedJson, payload);
  writeJson(latestJson, payload);
  fs.writeFileSync(datedMd, `${markdown}\n`, "utf8");
  fs.writeFileSync(latestMd, `${markdown}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: result === "pass",
        role: payload.role,
        action: payload.action,
        generated_at_kst: payload.generated_at_kst,
        after: payload.after,
        output_json_dated: datedJson,
        output_md_dated: datedMd,
        output_json_latest: latestJson,
        output_md_latest: latestMd,
        self_validation_result: result,
      },
      null,
      2
    )
  );
}

try {
  main();
} catch (err) {
  console.error("report-clock-resync failed:", err && err.message ? err.message : err);
  process.exit(1);
}
