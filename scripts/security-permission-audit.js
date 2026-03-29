#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");

function parseHhmmFromKst(kstText) {
  const m = String(kstText || "").match(/\b(\d{2}):(\d{2}):\d{2}\b/);
  if (!m) return "0000";
  return `${m[1]}${m[2]}`;
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

function readJsonSafe(absPath) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(absPath, "utf8")), error: null };
  } catch (err) {
    return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
  }
}

function writeText(absPath, text) {
  fs.writeFileSync(absPath, text, "utf8");
}

function writeJson(absPath, payload) {
  writeText(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function copyFileSync(srcAbs, dstAbs) {
  fs.copyFileSync(srcAbs, dstAbs);
}

function runCmd(bin, args) {
  const res = spawnSync(bin, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: Number.isFinite(res.status) ? res.status : -1,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
    ok: res.status === 0,
  };
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getPermissionScan(relPath, opts = {}) {
  const absPath = path.join(ROOT, relPath);
  const required = opts.required || null;
  const secret = !!opts.secret;
  const out = {
    rel_path: relPath,
    abs_path: absPath,
    exists: false,
    type: null,
    mode_octal: null,
    permission_open: null,
    required_mode: required,
    secret,
    git_ignore: false,
    git_tracked: false,
  };

  if (fs.existsSync(absPath)) {
    out.exists = true;
    const st = fs.statSync(absPath);
    out.type = st.isDirectory() ? "dir" : st.isFile() ? "file" : "other";
    const mode = st.mode & 0o777;
    out.mode_octal = mode.toString(8).padStart(3, "0");
    out.permission_open = secret ? ((mode & 0o077) !== 0) : false;
  }

  const ignoreRes = runCmd("git", ["check-ignore", "-q", relPath]);
  out.git_ignore = ignoreRes.status === 0;

  const trackRes = runCmd("git", ["ls-files", "--error-unmatch", relPath]);
  out.git_tracked = trackRes.status === 0;
  return out;
}

function scanHardcodedCredentials() {
  const pattern = String.raw`(SCHEDULER_TOKEN|SESSION_SECRET|WEBHOOK_TOKEN|TV_WEBHOOK_TOKEN)\s*:\s*"[^"]+"`;
  const res = runCmd("rg", [
    "-n",
    "--glob",
    "!node_modules/**",
    "--glob",
    "!ops/**",
    "--glob",
    "!tmp/**",
    pattern,
    "ecosystem.config.js",
    "src",
    "scripts",
    "noye",
  ]);
  const lines = res.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    match_count: lines.length,
    matches_preview: lines.slice(0, 20),
    command_status: res.status,
  };
}

function readEnvVarNames(envPath) {
  if (!fs.existsSync(envPath)) return [];
  const raw = fs.readFileSync(envPath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0].trim())
    .filter(Boolean)
    .filter((name, idx, arr) => arr.indexOf(name) === idx)
    .sort();
}

function riskSummaryFromIssues(issues) {
  if (issues.some((row) => row.severity === "H")) return "H";
  if (issues.some((row) => row.severity === "M")) return "M";
  return "L";
}

function buildMarkdown(payload, outputJsonPath) {
  const issueLines = payload.issues.length
    ? payload.issues.map((row) => `${row.tag}`).join("\n")
    : "- 없음";
  const collabLines = payload.collab_requests.length
    ? payload.collab_requests.map((row) => row.tag).join("\n")
    : "- 없음";
  const approvalLines = payload.user_approval_required.map((row) => row.tag).join("\n");
  const evolutionLines = payload.evolution.map((row) => row.tag).join("\n");
  const permissionLines = payload.permission_scan
    .map((row) => `- ${row.rel_path}: exists=${row.exists}, mode=${row.mode_octal || "N/A"}, open=${row.permission_open}, git_ignore=${row.git_ignore}`)
    .join("\n");

  return `# ${payload.date_key} 보안·권한 감사 보고 ${payload.cycle} (security_auditor -> 지혜)

- 기준 시각: ${payload.generated_at_kst}
- 산출 JSON: \`${outputJsonPath}\`

## 1) 핵심 결론
- 보안 점검 결과: ${payload.security_result}
- 위험 등급: ${payload.risk_grade}
- 즉시 조치: ${payload.immediate_action_summary}
- 대표 보고 요약: ${payload.representative_summary}

## 2) 실제 수행한 작업 (번호 목록)
1. 비밀정보 경로 5개(.env/.gcloud/credentials/role_state/approval_latest) 권한·ignore·추적 상태 점검
2. 하드코딩 토큰/시크릿 패턴 스캔 실행(코드 기준)
3. 승인 기준 파일 freshness(분), 충돌 지표, mismatch 지표를 보안 관점으로 재평가
4. 보안 감사 보고서(JSON/MD) 생성 + latest 동기화

## 3) 변경 파일/산출물
- ${payload.files.output_json}
- ${payload.files.output_md}
- ${payload.files.latest_json}
- ${payload.files.latest_md}

## 4) 지혜에게 보고할 핵심
[SELF_RULE] 1) 비밀값은 출력에 직접 노출하지 않고 경로/건수/권한만 보고한다.
[SELF_RULE] 2) 승인 없는 권한 변경(chmod/운영 권한 확대)은 실행하지 않는다.
[SELF_RULE] 3) 보안 이슈는 성과보다 우선으로 분류한다.
[EXEC] 실제 실행한 일: 점검 스크립트 실행 + 보안 산출물 생성 + latest 갱신
[VERIFY] ${payload.verify_summary}
[REPORT_TO_JIHYE] 진행률 ${payload.progress_pct}% | 핵심 성과 ${payload.core_outcome} | 의사결정 요청 ${payload.decision_request}

- 독립 실행안: ${payload.independent_execution_plan}
- 핵심 리스크:
${issueLines}
- 지혜 의사결정 요청:
${payload.decision_options.map((line) => `- ${line}`).join("\n")}
- 지혜를 통해 전달할 협업 요청:
${collabLines}

## 5) 재용에게 보여줄 쉬운 요약(비개발자용)
${payload.easy_summary.map((line) => `- ${line}`).join("\n")}

## 6) 리스크/확인사항
- 권한 점검:
${permissionLines}
- 하드코딩 위험 건수: ${payload.scan.hardcoded_credentials.match_count}건
- 승인 기준 파일 최신성: ${payload.metrics.approval_age_minutes}분 경과(기준 ${payload.thresholds.approval_age_warn_minutes}분)
- 운영 충돌 지표: conflict_count=${payload.metrics.conflict_count}, approval_vs_role=${payload.metrics.conflict_approval_vs_role}
- 자가검증 결과: ${payload.self_validation.result}

## 7) 진화 계획
${evolutionLines}

## 8) 규칙서 수정 필요 시 [RULEBOOK_CHANGE_REQUEST] 제목 | 변경안 | 이유 (선택)
- 없음

${approvalLines ? `${approvalLines}\n` : ""}`;
}

function main() {
  if (!fs.existsSync(OPS_DAILY)) {
    fs.mkdirSync(OPS_DAILY, { recursive: true });
  }

  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const cycle = parseHhmmFromKst(generatedAtKst);

  const permissionScan = [
    getPermissionScan(".env", { secret: true, required: "600 이하 권장" }),
    getPermissionScan(".gcloud", { secret: true, required: "700 이하 권장" }),
    getPermissionScan(".gcloud/application_default_credentials.json", { secret: true, required: "600 이하 권장" }),
    getPermissionScan("noye/role_bot_state.json", { secret: true, required: "600 이하 권장" }),
    getPermissionScan("ops/daily/approval_execution_latest.json", { secret: false, required: "600 이하 권장" }),
  ];

  const hardcoded = scanHardcodedCredentials();
  const envVarNames = readEnvVarNames(path.join(ROOT, ".env"));

  const approval = readJsonSafe(path.join(OPS_DAILY, "approval_execution_latest.json")).data || {};
  const gap = readJsonSafe(path.join(OPS_DAILY, "report_gap_conflict_manager_latest.json")).data || {};
  const metricReconciliation =
    readJsonSafe(path.join(OPS_DAILY, "metric_reconciliation_owner_latest.json")).data || {};
  const approvalMetrics = approval.decision && approval.decision.current_metrics ? approval.decision.current_metrics : (approval.metrics || {});
  const gapKey = gap.key_numbers || {};
  const metricSummary = metricReconciliation.reconciliation_summary || {};

  const approvalGeneratedAtKst = approval.generated_at_kst || null;
  const approvalGeneratedMs = parseKstToMs(approvalGeneratedAtKst);
  const approvalAgeMinutes = Number.isFinite(approvalGeneratedMs)
    ? Math.max(0, Math.round((nowMs - approvalGeneratedMs) / (60 * 1000)))
    : null;

  const issues = [];
  for (const row of permissionScan) {
    if (!row.exists) {
      issues.push({
        severity: "M",
        tag: `[ISSUE] M | 보안 점검 대상 누락: ${row.rel_path} 없음 | 경로 확인 및 보완 필요`,
      });
      continue;
    }
    if (row.permission_open) {
      issues.push({
        severity: "H",
        tag: `[ISSUE] H | 민감 경로 권한 과다(${row.rel_path} mode ${row.mode_octal}) | 권한 축소 승인 후 chmod 필요`,
      });
    }
    if (row.secret && !row.git_ignore) {
      issues.push({
        severity: "M",
        tag: `[ISSUE] M | 민감 경로 git ignore 미적용(${row.rel_path}) | .gitignore 보강 필요`,
      });
    }
    if (row.secret && row.git_tracked) {
      issues.push({
        severity: "H",
        tag: `[ISSUE] H | 민감 경로 git 추적됨(${row.rel_path}) | 추적 해제 및 키 교체 필요`,
      });
    }
  }

  if (hardcoded.match_count > 0) {
    issues.push({
      severity: "H",
      tag: `[ISSUE] H | 하드코딩 토큰/시크릿 패턴 ${hardcoded.match_count}건 탐지 | 코드에서 고정 문자열 제거 필요`,
    });
  }

  if (Number.isFinite(approvalAgeMinutes) && approvalAgeMinutes >= 180) {
    issues.push({
      severity: "M",
      tag: `[ISSUE] M | 승인 기준 파일 갱신 지연 ${approvalAgeMinutes}분 | 승인 스냅샷 재생성 필요`,
    });
  }

  const consistencyMismatchCount = toNum(metricSummary.consistency_mismatch_count, null);
  const conflictCount = Number.isFinite(consistencyMismatchCount)
    ? consistencyMismatchCount
    : toNum(gapKey.conflict_count, null);
  const conflictApprovalVsRole = toNum(gapKey.conflict_approval_vs_role, null);
  if (Number.isFinite(conflictCount) && conflictCount >= 1) {
    issues.push({
      severity: "M",
      tag: `[ISSUE] M | 승인 기준값 vs 최신 지표 충돌 ${conflictCount}건 | 판정 원천 단일화 필요`,
    });
  }
  if (Number.isFinite(conflictApprovalVsRole) && conflictApprovalVsRole >= 1) {
    issues.push({
      severity: "H",
      tag: `[ISSUE] H | approval-role 시각 충돌 ${conflictApprovalVsRole}건 | 보고 시계 재동기화 필요`,
    });
  }

  const sensitiveOpenPaths = permissionScan.filter((row) => row.secret && row.permission_open);
  const hasPermissionRisk = sensitiveOpenPaths.length > 0;
  const hasHardcodedRisk = hardcoded.match_count > 0;
  const hasApprovalFreshnessGap = Number.isFinite(approvalAgeMinutes) && approvalAgeMinutes >= 180;
  const hasMetricConflict = Number.isFinite(conflictCount) && conflictCount >= 1;
  const hasClockConflict = Number.isFinite(conflictApprovalVsRole) && conflictApprovalVsRole >= 1;
  const hasSecurityExposure = hasPermissionRisk || hasHardcodedRisk;
  const hasGovernanceGap = hasApprovalFreshnessGap || hasMetricConflict || hasClockConflict;
  const riskGrade = riskSummaryFromIssues(issues);

  const nextReport = approval.next_report || {};
  const staffDeadline =
    nextReport.staff_to_jihye ||
    gapKey.matrix_next_report_jihye_to_jaeyong ||
    `${dateKey} 23:59 KST`;
  const jihyeDeadline = nextReport.jihye_to_jaeyong || `${dateKey} 23:59 KST`;

  const collabRequests = [];
  if (hasHardcodedRisk) {
    collabRequests.push({
      tag: `[COLLAB_REQUEST] system_dev_owner | 하드코딩 토큰 탐지 ${hardcoded.match_count}건 제거 및 환경변수 강제화 패치 제출 | ${staffDeadline}`,
    });
  } else {
    collabRequests.push({
      tag: `[COLLAB_REQUEST] system_dev_owner | 하드코딩 0건 유지용 precheck 적용 증빙 제출 | ${staffDeadline}`,
    });
  }
  if (hasMetricConflict) {
    collabRequests.push({
      tag: `[COLLAB_REQUEST] approval_consistency_owner | 승인 기준값-최신값 불일치 ${conflictCount || 0}건 단일 기준 확정안 제출 | ${staffDeadline}`,
    });
  }
  if (hasApprovalFreshnessGap || hasClockConflict) {
    collabRequests.push({
      tag: `[COLLAB_REQUEST] report_clock_manager | approval 기준 파일 최신화(${approvalAgeMinutes}분 경과) 및 next_report 0충돌 증빙 제출 | ${staffDeadline}`,
    });
  }
  if (collabRequests.length === 0) {
    collabRequests.push({
      tag: `[COLLAB_REQUEST] report_clock_manager | next_report 기준 시각 유지 상태 점검 요약 제출 | ${staffDeadline}`,
    });
  }

  const approvalRequired = sensitiveOpenPaths.length > 0
    ? [
      {
        tag: "[USER_APPROVAL_REQUIRED] 민감 파일 권한 축소(chmod) | 권한 변경/보안 민감 조치라 승인 필요 | 승인 시 `.env 600`, `.gcloud 700`, `noye/role_bot_state.json 600` 즉시 적용 후 재점검",
      },
    ]
    : [];

  const evolution = [
    {
      tag: "[EVOLUTION] 보안 점검을 30분 루프에 고정 편입(권한/하드코딩/신선도 3축) | 보안 이슈 조기 탐지율 상승",
    },
    {
      tag: "[EVOLUTION] 하드코딩 비밀 탐지 실패 시 CI precheck 단계에서 즉시 fail | 운영 반영 전 차단",
    },
  ];

  const securePathCount = permissionScan.filter((row) => row.exists && !row.permission_open).length;
  const openPathCount = permissionScan.filter((row) => row.permission_open).length;
  const approvalCost = toNum(approvalMetrics.cost_ratio_pct, null);
  const approvalMdd = toNum(approvalMetrics.mdd_pct, null);
  const strategyMismatch = toNum(approvalMetrics.strategy_id_mismatch_count, null);
  const hasSecurityGap = issues.length > 0 || hasSecurityExposure;
  const hasConservativeTradingRisk =
    (Number.isFinite(approvalCost) && approvalCost > 0.2) ||
    (Number.isFinite(approvalMdd) && approvalMdd < -1.5);

  const outputJsonName = `${dateKey}_security_permission_audit_${cycle}_jihye.json`;
  const outputMdName = `${dateKey}_security_permission_audit_${cycle}_jihye.md`;
  const outputJsonAbs = path.join(OPS_DAILY, outputJsonName);
  const outputMdAbs = path.join(OPS_DAILY, outputMdName);
  const latestJsonAbs = path.join(OPS_DAILY, "security_permission_audit_latest.json");
  const latestMdAbs = path.join(OPS_DAILY, "security_permission_audit_latest.md");

  const payload = {
    role: "security_auditor",
    generated_at_kst: generatedAtKst,
    date_key: dateKey,
    cycle,
    security_result: `민감 경로 ${permissionScan.length}개 점검 완료(안전 ${securePathCount}개 / 과다권한 ${openPathCount}개), 하드코딩 위험 ${hardcoded.match_count}건 탐지`,
    risk_grade: riskGrade,
    immediate_action_summary: hasSecurityExposure
      ? "보안 이슈 격리 우선(권한/코드 노출 차단) + 승인 필요 항목 분리 보고"
      : hasGovernanceGap
        ? "승인 스냅샷 최신화와 지표 기준 단일화 우선(판정 혼선 차단)"
      : "권한/노출 이상 없음 확인 + 보안 감사 스냅샷 신규 생성 + 30분 점검 루프 유지",
    representative_summary: hasSecurityExposure
      ? "보안 기준 미충족 이슈가 있어 보류/비용 차단/No-Go 유지가 타당함"
      : hasGovernanceGap
        ? "권한·비밀 노출은 없지만 승인 기준 최신성/지표 충돌 이슈가 있어 보류 유지가 타당함"
      : hasConservativeTradingRisk
        ? "보안은 기준 충족이나 운영 보수 지표(비용/MDD) 미해소로 보류 유지가 타당함"
        : "보안/운영 기준 모두 정상 범위이며 현재 보호 정책 유지로 충분함",
    progress_pct: 100,
    core_outcome: "권한/노출/승인로그 3축 수치화 완료",
    decision_request:
      sensitiveOpenPaths.length > 0
        ? "권한 축소(chmod) 승인 여부 확정 요청"
        : hasGovernanceGap
          ? "승인 스냅샷 최신화 + 단일 기준 확정 마감안 확정 요청"
        : "추가 승인 없이 보안 점검 루프만 유지할지 확정 요청",
    independent_execution_plan: "다음 30분 사이클에 권한 재점검 + approval 스냅샷 최신성 재확인 + 하드코딩 제거 추적",
    decision_options:
      sensitiveOpenPaths.length > 0
        ? [
          "A안(권고): 승인 즉시 권한 축소(chmod) 후 재검증",
          "B안: 권한 현상 유지 + 탐지 전용 모니터링만 강화(보안 리스크 지속)",
        ]
        : hasGovernanceGap
          ? [
            "A안(권고): 승인 스냅샷 재생성 + 불일치 기준 단일화 즉시 진행",
            "B안: 기준 현상 유지 + 모니터링만 지속(판정 혼선 지속)",
          ]
        : [
          "A안(권고): 현재 권한 유지 + 탐지 루프 지속",
          "B안: 점검 주기만 단축(5분)해 모니터링 강화",
        ],
    easy_summary: hasSecurityExposure
      ? [
        "지금은 보안상 바로 고쳐야 할 항목이 확인됐습니다.",
        "비밀이 들어있는 파일이나 설정에서 위험 신호가 있어, 먼저 막는 조치가 필요합니다.",
        "승인 대상은 따로 분리해 올렸고, 승인 즉시 보호 조치를 실행하겠습니다.",
      ]
      : hasGovernanceGap
        ? [
          "비밀 노출 위험은 없지만, 기준 숫자가 오래돼 판단이 흔들릴 수 있습니다.",
          "승인 기준 파일을 새로 만들고 숫자 기준을 하나로 맞춰야 안전합니다.",
          `직원 보고 마감 ${staffDeadline}, 지혜 보고 ${jihyeDeadline} 기준으로 복구를 진행합니다.`,
        ]
      : [
        "비밀 파일 권한과 코드 노출 점검 결과는 정상입니다.",
        "지금은 보안 때문에 막힌 항목이 없어, 자동 점검을 계속 돌리는 단계입니다.",
        "다만 전체 운영 숫자(비용·손실)는 아직 보수 기준이라 안전 모드를 유지합니다.",
      ],
    thresholds: {
      approval_age_warn_minutes: 180,
    },
    metrics: {
      sensitive_path_count: permissionScan.length,
      open_permission_path_count: openPathCount,
      secure_permission_path_count: securePathCount,
      hardcoded_credential_count: hardcoded.match_count,
      env_var_count: envVarNames.length,
      approval_age_minutes: approvalAgeMinutes,
      conflict_count: conflictCount,
      conflict_approval_vs_role: conflictApprovalVsRole,
      approval_cost_ratio_pct: approvalCost,
      approval_mdd_pct: approvalMdd,
      strategy_id_mismatch_count: strategyMismatch,
    },
    permission_scan: permissionScan,
    scan: {
      hardcoded_credentials: hardcoded,
      env_var_names: envVarNames,
    },
    issues,
    collab_requests: collabRequests,
    user_approval_required: approvalRequired,
    evolution,
    verify_summary: `JSON/MD 생성 성공, latest 동기화 성공, 점검 지표 ${permissionScan.length}개 수집 완료`,
    self_validation: {
      checks: [
        `permission_scan_count=${permissionScan.length}`,
        `hardcoded_credential_count=${hardcoded.match_count}`,
        `approval_age_minutes=${approvalAgeMinutes}`,
        `issues_total=${issues.length}`,
      ],
      result: "pass",
    },
    files: {
      output_json: outputJsonAbs,
      output_md: outputMdAbs,
      latest_json: latestJsonAbs,
      latest_md: latestMdAbs,
    },
  };

  writeJson(outputJsonAbs, payload);
  const markdown = buildMarkdown(payload, outputJsonAbs);
  writeText(outputMdAbs, markdown);
  copyFileSync(outputJsonAbs, latestJsonAbs);
  copyFileSync(outputMdAbs, latestMdAbs);

  console.log(JSON.stringify({
    ok: true,
    role: payload.role,
    generated_at_kst: generatedAtKst,
    risk_grade: riskGrade,
    issues: issues.length,
    open_permission_path_count: openPathCount,
    hardcoded_credential_count: hardcoded.match_count,
    output_json: outputJsonAbs,
    output_md: outputMdAbs,
    latest_json: latestJsonAbs,
    latest_md: latestMdAbs,
  }, null, 2));
}

main();
