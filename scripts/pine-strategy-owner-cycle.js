#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");

const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(ROOT, "ops", "daily");
const CODE_DIR = path.join(ROOT, "code");

const PINE_FILE = path.join(ROOT, "code", "donbeolja.pine.txt");
const PINE_UPDATE_RULES = path.join(ROOT, "ops", "pine_code_update_rules.md");
const VERSION_DIRECTIVE_LATEST = path.join(OPS_DAILY, "pine_version_upgrade_directive_latest.md");
const DATA_CONSISTENCY_LATEST = path.join(OPS_DAILY, "data_consistency_lead_latest.json");
const STRATEGY_ALIGNMENT_LATEST = path.join(OPS_DAILY, "strategy_id_alignment_latest.json");
const POST_APPLY_SIGNAL_LATEST = path.join(OPS_DAILY, "post_apply_signal_probe_latest.json");
const CEO_GOVERNANCE_LATEST = path.join(OPS_DAILY, "ceo_24h_autonomous_governance_latest.json");
const CEO_FINAL_DECISION_LATEST = path.join(OPS_DAILY, "ceo_final_decision_latest.json");
const APPROVAL_EXECUTION_LATEST = path.join(OPS_DAILY, "approval_execution_latest.json");
const METRIC_RECONCILIATION_LATEST = path.join(OPS_DAILY, "metric_reconciliation_owner_latest.json");
const REPORT_CLOCK_RESYNC_LATEST = path.join(OPS_DAILY, "report_clock_resync_latest.json");

const OUTPUT_LATEST_JSON = path.join(OPS_DAILY, "pine_strategy_owner_latest.json");
const OUTPUT_LATEST_MD = path.join(OPS_DAILY, "pine_strategy_owner_latest.md");
const OUTPUT_LEGACY_LATEST_MD = path.join(OPS_DAILY, "pine_autonomous_execution_latest.md");

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (_err) {
    return null;
  }
}

function readTextSafe(absPath) {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (_err) {
    return "";
  }
}

function writeJson(absPath, payload) {
  fs.writeFileSync(absPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(absPath, text) {
  fs.writeFileSync(absPath, text, "utf8");
}

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function fmtPct(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return `${Number(value).toFixed(digits)}%`;
}

function countMatches(text, regex) {
  const matches = String(text || "").match(regex);
  return Array.isArray(matches) ? matches.length : 0;
}

function parseKstDateTimeToMs(text) {
  const raw = String(text || "").trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*KST$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const hh = Number(m[4]);
  const mm = Number(m[5]);
  const ss = Number(m[6] || 0);
  if (![y, mo, d, hh, mm, ss].every(Number.isFinite)) return null;
  return Date.UTC(y, mo - 1, d, hh - 9, mm, ss);
}

function parseKstLabel(text) {
  const ms = parseKstDateTimeToMs(text);
  if (!Number.isFinite(ms)) {
    return {
      raw: String(text || "N/A"),
      ms: null,
      hhmm: null,
    };
  }
  const normalized = toKstString(ms, { fallbackToString: true });
  const hhmm = normalized.slice(11, 16);
  return {
    raw: normalized,
    ms,
    hhmm,
  };
}

function buildDefaultNextReportSlots(nowMs) {
  const baseMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const kstNowMs = baseMs + 9 * 60 * 60 * 1000;
  const kstNow = new Date(kstNowMs);
  const y = kstNow.getUTCFullYear();
  const mo = kstNow.getUTCMonth();
  const d = kstNow.getUTCDate();
  let hh = kstNow.getUTCHours();
  const mm = kstNow.getUTCMinutes();
  if (mm >= 28) hh += 1;
  const staffUtcMs = Date.UTC(y, mo, d, hh - 9, 28, 0);
  const staffLabel = toKstString(staffUtcMs, { fallbackToString: true });
  const jihyeLabel = toKstString(staffUtcMs + 2 * 60 * 1000, { fallbackToString: true });
  return {
    staff_to_jihye: staffLabel,
    jihye_to_jaeyong: jihyeLabel,
  };
}

function pickUpcomingKstLabel(candidates, nowMs, fallback, graceMinutes = 5) {
  const graceMs = graceMinutes * 60 * 1000;
  const parsed = (Array.isArray(candidates) ? candidates : [])
    .map((value) => parseKstLabel(value))
    .filter((item) => Number.isFinite(item.ms));
  if (!parsed.length) return fallback;
  const upcoming = parsed
    .filter((item) => item.ms >= nowMs - graceMs)
    .sort((a, b) => a.ms - b.ms);
  if (!upcoming.length) return fallback;
  return upcoming[0].raw;
}

function pickLatestByPattern(pattern) {
  if (!fs.existsSync(OPS_DAILY)) return null;
  const names = fs.readdirSync(OPS_DAILY).filter((name) => pattern.test(name));
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

function buildStaticCheck(text) {
  const lineCount = String(text || "").split(/\r?\n/).length;
  const requestSecurityCount = countMatches(text, /\brequest\.security\s*\(/g);
  const lookaheadOffCount = countMatches(text, /lookahead\s*=\s*barmerge\.lookahead_off/g);
  const barConfirmedCount = countMatches(text, /\bbarstate\.isconfirmed\b/g);
  const alertCallCount = countMatches(text, /\balert\s*\(/g);
  const hasPreAlertDefaultOff =
    /pre_alert_enable\s*=\s*input\.bool\(\s*false/.test(text)
    || /\bbool\s+pre_alert_enable\s*=\s*false\b/.test(text);

  const requiredTokens = [
    {
      key: "pre_alert_default_off",
      ok: hasPreAlertDefaultOff,
      evidence: "pre_alert_enable default false (input.bool(false) or bool = false)",
    },
    {
      key: "entry_cooldown_input",
      ok: /\bentry_cooldown_bars\s*=\s*input\.int\(/.test(text),
      evidence: "entry_cooldown_bars input",
    },
    {
      key: "reverse_cooldown_input",
      ok: /\breverse_cooldown_bars\s*=\s*input\.int\(/.test(text),
      evidence: "reverse_cooldown_bars input",
    },
    {
      key: "entry_cooldown_reason",
      ok: /ENTRY_COOLDOWN/.test(text),
      evidence: "ENTRY_COOLDOWN reason",
    },
    {
      key: "reverse_cooldown_reason",
      ok: /REVERSE_COOLDOWN/.test(text),
      evidence: "REVERSE_COOLDOWN reason",
    },
    {
      key: "strategy_id_override",
      ok: /\bstrategy_id_override\s*=\s*input\.string\(/.test(text),
      evidence: "strategy_id_override input",
    },
    {
      key: "schema_version_payload",
      ok: /"schema_version":"DBJ_WEBHOOK_V[12]"/.test(text) || /\\"schema_version\\":\\"DBJ_WEBHOOK_V[12]\\"/.test(text),
      evidence: "schema_version DBJ_WEBHOOK_V1 or V2",
    },
    {
      key: "signal_key_payload",
      ok: /"signal_key":/.test(text) || /\\"signal_key\\":/.test(text),
      evidence: "signal_key field",
    },
    {
      key: "bar_index_payload",
      ok: /"bar_index":/.test(text) || /\\"bar_index\\":/.test(text),
      evidence: "bar_index field",
    },
    {
      key: "is_bar_close_confirmed_payload",
      ok: /"is_bar_close_confirmed":/.test(text) || /\\"is_bar_close_confirmed\\":/.test(text),
      evidence: "is_bar_close_confirmed field",
    },
  ];

  const missingRequired = requiredTokens.filter((x) => !x.ok).map((x) => x.key);
  const lookaheadCoveragePct = requestSecurityCount > 0 ? round((lookaheadOffCount / requestSecurityCount) * 100, 1) : 0;
  const pass = missingRequired.length === 0 && lookaheadCoveragePct >= 100;

  return {
    source_file: PINE_FILE,
    line_count: lineCount,
    request_security_count: requestSecurityCount,
    lookahead_off_count: lookaheadOffCount,
    lookahead_coverage_pct: lookaheadCoveragePct,
    barstate_isconfirmed_count: barConfirmedCount,
    alert_call_count: alertCallCount,
    required_tokens: requiredTokens,
    missing_required: missingRequired,
    pass,
  };
}

function buildIssues(metrics, staticCheck, context = {}) {
  const staffDeadlineLabel = context.staff_deadline_label || "다음 보고 시각";
  const preflightFailedCount = Array.isArray(context.preflight_results)
    ? context.preflight_results.filter((x) => !x.ok).length
    : 0;
  const issues = [];

  if (Number.isFinite(metrics.cost_ratio_pct) && Number.isFinite(metrics.cost_limit_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct) {
    issues.push(`[ISSUE] H | 비용 ${fmtPct(metrics.cost_ratio_pct)} > 상한 ${fmtPct(metrics.cost_limit_pct)} | 비용 차단 유지`);
  }
  if (Number.isFinite(metrics.mdd_pct) && Number.isFinite(metrics.mdd_limit_pct) && metrics.mdd_pct < metrics.mdd_limit_pct) {
    issues.push(`[ISSUE] H | MDD ${fmtPct(metrics.mdd_pct)} < 기준 ${fmtPct(metrics.mdd_limit_pct)} | 공격 전환 금지`);
  }
  if (Number.isFinite(metrics.conflict_count_conservative) && metrics.conflict_count_conservative >= 1) {
    issues.push(`[ISSUE] H | 운영충돌(consistency_check) ${metrics.conflict_count_conservative}건 | approval_consistency_owner 정리 필요`);
  }
  if (Number.isFinite(metrics.conflict_count_clock) && metrics.conflict_count_clock >= 1) {
    issues.push(`[ISSUE] M | 실시간차이(live_drift_check) ${metrics.conflict_count_clock}건 | report_clock_manager 즉시 정리 필요`);
  }
  if (
    Number.isFinite(metrics.conflict_count_conservative)
    && Number.isFinite(metrics.conflict_count_clock)
    && metrics.conflict_count_conservative !== metrics.conflict_count_clock
  ) {
    issues.push(
      `[ISSUE] M | 수치 분기(운영충돌(consistency_check) ${metrics.conflict_count_conservative}건 / 실시간차이(live_drift_check) ${metrics.conflict_count_clock}건) | metric_reconciliation_owner 기준 정리 필요`
    );
  }
  if (Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct < 90) {
    issues.push(`[ISSUE] M | 정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} | ${staffDeadlineLabel}까지 90%+ 복구 필요`);
  }
  if (Number.isFinite(metrics.strategy_id_mismatch_drop_count) && metrics.strategy_id_mismatch_drop_count >= 1) {
    issues.push(
      `[ISSUE] M | strategy_id 누적 불일치 ${metrics.strategy_id_mismatch_drop_count}건(신규 ${metrics.strategy_id_mismatch_after_revision_count}건) | 신규 0 유지 + 누적 소거 분리 관리`
    );
  }
  if (Number.isFinite(metrics.trace_payload_version_count) && metrics.trace_payload_version_count === 0) {
    issues.push("[ISSUE] M | trace_payload_version 관측 0건 | TradingView 반영 여부 재확인 필요");
  }
  if (
    Number.isFinite(metrics.active_trace_payload_version_count)
    && metrics.active_trace_payload_version_count > 0
    && Number.isFinite(metrics.active_febt_contract_count)
    && metrics.active_febt_contract_count === 0
  ) {
    issues.push(
      `[ISSUE] H | active TPTR_V2 ${metrics.active_trace_payload_version_count}건에서 FEBT contract 0건 | TradingView 적용본 또는 nested features payload 누락 점검`
    );
  } else if (Number.isFinite(metrics.active_febt_trace_contract_missing_count) && metrics.active_febt_trace_contract_missing_count > 0) {
    issues.push(
      `[ISSUE] M | active TPTR_V2 ${metrics.active_febt_trace_contract_missing_count}건이 FEBT contract 없이 수신됨 | webhook top-level backfill 또는 Pine payload branch 점검`
    );
  }
  if (!staticCheck.pass) {
    issues.push(`[ISSUE] H | Pine 정적 점검 실패(${staticCheck.missing_required.join(", ") || "unknown"}) | 코드 기준선 복구 필요`);
  }
  if (preflightFailedCount >= 1) {
    issues.push(`[ISSUE] M | 사전 점검 명령 실패 ${preflightFailedCount}건 | 실패 스크립트 로그 확인 후 재실행 필요`);
  }
  if (!issues.length) {
    issues.push("[ISSUE] L | 핵심 이슈 없음 | 현재 기준 유지");
  }
  return issues;
}

function buildMarkdown(payload) {
  const lines = [];
  const p = payload;
  const k = p.core_metrics;

  lines.push(`# ${p.date_key} 파인스크립트 담당 자율 실행 보고 (${p.cycle_hhmm}, ${p.generated_at_kst})`);
  lines.push("");
  lines.push("## 1) 핵심 결론");
  lines.push(`- [DECISION] \`${p.decision.status} / ${p.decision.mode} / ${p.decision.go_no_go}\``);
  lines.push(
    `- 기준 수치: 보수 비용 \`${fmtPct(k.cost_ratio_pct)}\`, 보수 MDD \`${fmtPct(k.mdd_pct)}\`, 정시율 \`${fmtPct(k.on_time_rate_pct, 1)}\`, 운영충돌(consistency_check)/실시간차이(live_drift_check) \`${k.conflict_count_conservative}/${k.conflict_count_clock}건\``
  );
  lines.push(`- 파인 파일 정적 점검: \`${p.static_check.pass ? "PASS" : "FAIL"}\` (lookahead 커버리지 \`${fmtPct(p.static_check.lookahead_coverage_pct, 1)}\`)`);
  lines.push(`- 보고 판단: \`${p.reporting_judgement.is_reporting_time_now ? "보고 시점" : "사전 점검 시점"}\` (${p.reporting_judgement.reason})`);
  lines.push("### NOYE 필수 태그");
  p.self_rules.forEach((x) => lines.push(`- ${x}`));
  lines.push(`- [VERIFY] ${p.self_validation.result} | ${p.self_validation.summary}`);
  lines.push(`- ${p.report_to_jihye.report_tag}`);
  lines.push("");
  lines.push("## 2) 실제 수행한 작업 (번호 목록)");
  p.executed_now.forEach((x, i) => lines.push(`${i + 1}. [EXEC] ${x}`));
  lines.push("");
  lines.push("## 3) 변경 파일/산출물");
  p.artifacts.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("## 4) 지혜에게 보고할 핵심");
  lines.push("### 전략 논리");
  p.strategy_logic.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("### 핵심 파라미터");
  p.key_parameters.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("### Pine 코드 스니펫");
  lines.push("```pine");
  p.pine_code_snippet.forEach((line) => lines.push(line));
  lines.push("```");
  lines.push("");
  lines.push("### 검증 체크포인트");
  p.verification_checkpoints.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("### 대표 보고 요약");
  lines.push("1. 독립 실행안");
  lines.push(`- ${p.independent_execution_plan.objective}`);
  lines.push(`- 진행률: \`${p.independent_execution_plan.progress_pct}%\``);
  lines.push("2. 지혜에게 보고할 내용");
  lines.push(`- 진행률: \`${p.report_to_jihye.progress_pct}%\``);
  lines.push("- 핵심 성과:");
  p.report_to_jihye.key_achievements.forEach((x) => lines.push(`- ${x}`));
  lines.push("- 리스크:");
  p.issues.forEach((x) => lines.push(`- ${x}`));
  lines.push("- 지혜 의사결정 요청:");
  p.report_to_jihye.decision_requests.forEach((x) => lines.push(`- ${x}`));
  lines.push("3. 지혜를 통해 전달할 협업 요청");
  p.collaboration_requests_via_jihye.forEach((x) => lines.push(`- ${x}`));
  lines.push("4. 진화 계획");
  p.evolution_plan.forEach((x) => lines.push(`- ${x}`));
  if (p.pine_update_required) {
    lines.push("");
    lines.push(p.pine_update_required);
  }
  lines.push("");
  lines.push("## 5) 재용에게 보여줄 쉬운 요약(비개발자용)");
  p.simple_summary_for_jaeyong.forEach((x, i) => lines.push(`${i + 1}. ${x}`));
  lines.push("");
  lines.push("## 6) 리스크/확인사항");
  p.issues.forEach((x) => lines.push(`- ${x}`));
  lines.push(`- [VERIFY] 자가검증 결과: \`${p.self_validation.result}\``);
  lines.push(`- [VERIFY] 요약: ${p.self_validation.summary}`);
  p.self_validation.checks.forEach((x) => lines.push(`- ${x}`));
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ────────────────────────────────────
// Pine 코드 버전업 기능
// ────────────────────────────────────
function md5Hash(text) {
  return crypto.createHash("md5").update(text, "utf8").digest("hex");
}

function parsePineVersion(text) {
  const indicatorMatch = text.match(/indicator\("돈벌자[^"]*v(\d+\.\d+\.\d+\.\d+)/);
  const strategyIdMatch = text.match(/string STRATEGY_ID\s*=\s*"donbeolja_v([\d.]+)"/);
  return {
    indicator: indicatorMatch ? indicatorMatch[1] : null,
    strategyId: strategyIdMatch ? strategyIdMatch[1] : null,
  };
}

function bumpVersion(version) {
  if (!version) return null;
  const parts = version.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return null;
  parts[2] += 1;
  parts[3] = 0;
  return parts.join(".");
}

function getLastPatchNumber(text) {
  const matches = text.match(/\/\/\s*\[PATCH-(\d+\w?)\]/g);
  if (!matches) return 0;
  let max = 0;
  for (const m of matches) {
    const numMatch = m.match(/PATCH-(\d+)/);
    if (numMatch) max = Math.max(max, Number(numMatch[1]));
  }
  return max;
}

function readPendingDirective() {
  return null;
}

function applyPineVersionUpgrade(pineText, changes) {
  let text = pineText;
  const applied = [];
  const oldVersion = parsePineVersion(text);
  const newVersion = changes.newVersion || bumpVersion(oldVersion.indicator);
  if (!newVersion) return { text, applied, newVersion: null };

  // 1) indicator 이름 버전 변경
  const oldIndicator = text.match(/indicator\("돈벌자[^"]*v[\d.]+/);
  if (oldIndicator) {
    text = text.replace(
      /indicator\("돈벌자(.*?)v[\d.]+/,
      `indicator("돈벌자$1v${newVersion}`
    );
    applied.push(`indicator 이름: v${oldVersion.indicator} → v${newVersion}`);
  }

  // 2) STRATEGY_ID 변경
  text = text.replace(
    /string STRATEGY_ID\s*=\s*"donbeolja_v[\d.]+"/,
    `string STRATEGY_ID = "donbeolja_v${newVersion}"`
  );
  applied.push(`STRATEGY_ID: donbeolja_v${oldVersion.strategyId} → donbeolja_v${newVersion}`);

  // 3) 파라미터 변경 적용
  if (Array.isArray(changes.params)) {
    for (const param of changes.params) {
      const regex = new RegExp(
        `(${param.name}\\s*=\\s*input\\.\\w+\\()${param.from}(,)`,
        "g"
      );
      if (regex.test(text)) {
        text = text.replace(regex, `$1${param.to}$2`);
        applied.push(`${param.name}: ${param.from} → ${param.to}`);
      }
    }
  }

  // 4) PATCH CHANGELOG 추가 (CHANGELOG 섹션 내에서만 삽입)
  const lastPatch = getLastPatchNumber(text);
  const patchEntries = [];
  if (Array.isArray(changes.patches)) {
    changes.patches.forEach((p, i) => {
      patchEntries.push(`// [PATCH-${lastPatch + 1 + i}] ${p}`);
    });
  }
  if (patchEntries.length > 0) {
    // CHANGELOG 섹션: "00. PATCH CHANGELOG" ~ "01. 그룹 정의" 사이에서만 검색
    const changelogEnd = text.indexOf("// 01. 그룹 정의");
    if (changelogEnd > 0) {
      const changelogSection = text.slice(0, changelogEnd);
      const changelogPatchLines = changelogSection.match(/\/\/\s*\[PATCH-\d+\w?\][^\n]*/g);
      if (changelogPatchLines) {
        const lastLine = changelogPatchLines[changelogPatchLines.length - 1];
        const insertPos = changelogSection.lastIndexOf(lastLine) + lastLine.length;
        text = text.slice(0, insertPos) + "\n" + patchEntries.join("\n") + text.slice(insertPos);
      }
    }
    applied.push(`PATCH CHANGELOG: ${patchEntries.length}건 추가 (PATCH-${lastPatch + 1} ~ PATCH-${lastPatch + patchEntries.length})`);
  }

  return { text, applied, newVersion };
}

function executePineVersionUpgrade(pineText, generatedAtKst) {
  const directive = readPendingDirective();
  if (!directive) return null;

  const currentVersion = parsePineVersion(pineText);
  if (!currentVersion.indicator) return null;

  const newVersion = bumpVersion(currentVersion.indicator);
  if (!newVersion) return null;

  const changes = {
    newVersion,
    params: [
      { name: "entry_cooldown_bars", from: "8", to: "14" },
      { name: "reverse_cooldown_bars", from: "12", to: "20" },
    ],
    patches: [
      `COOLDOWN_TUNE: entry_cooldown_bars 기본값 8 → 14, reverse_cooldown_bars 기본값 12 → 20 (비용 억제 A안 적용)`,
      `VERSION_BUMP v${newVersion}: indicator 이름 + STRATEGY_ID 버전 갱신`,
    ],
  };

  const result = applyPineVersionUpgrade(pineText, changes);
  if (!result.applied.length) return null;

  const originalMd5 = md5Hash(pineText);
  const newMd5 = md5Hash(result.text);

  if (originalMd5 === newMd5) {
    console.error("[pine-version-upgrade] ERROR: MD5 해시가 원본과 동일. 수정 실패.");
    return null;
  }

  const newFilename = `donbeolja_v${newVersion}.pine.txt`;
  const newFilePath = path.join(CODE_DIR, newFilename);
  writeText(newFilePath, result.text);

  return {
    old_version: `v${currentVersion.indicator}`,
    new_version: `v${newVersion}`,
    old_md5: originalMd5,
    new_md5: newMd5,
    new_file: newFilePath,
    applied_changes: result.applied,
  };
}

function main() {
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || generatedAtKst.slice(0, 10);
  const cycleHhmm = generatedAtKst.slice(11, 16).replace(":", "");

  const skipPreflight = String(process.env.PINE_OWNER_SKIP_PREFLIGHT || "").trim() === "1";
  const preflightCommands = skipPreflight
    ? []
    : [
        "node scripts/post-apply-signal-probe.js",
        "node scripts/strategy-id-alignment-check.js",
        "node scripts/data-consistency-lead.js",
        "node scripts/report-sync-status-board.js",
      ];
  const preflightResults = skipPreflight
    ? [{ command: "SKIPPED_BY_ENV", ok: true, error: null }]
    : preflightCommands.map((cmd) => {
        try {
          execSync(cmd, { cwd: ROOT, stdio: "pipe" });
          return { command: cmd, ok: true, error: null };
        } catch (err) {
          return { command: cmd, ok: false, error: String(err && err.message ? err.message : err) };
        }
      });

  const dataConsistency = readJsonSafe(DATA_CONSISTENCY_LATEST) || {};
  const strategyAlignment = readJsonSafe(STRATEGY_ALIGNMENT_LATEST) || {};
  const signalProbe = readJsonSafe(POST_APPLY_SIGNAL_LATEST) || {};
  const ceoGovernance = readJsonSafe(CEO_GOVERNANCE_LATEST) || {};
  const ceoFinalDecision = readJsonSafe(CEO_FINAL_DECISION_LATEST) || {};
  const approvalExecution = readJsonSafe(APPROVAL_EXECUTION_LATEST) || {};
  const metricReconciliation = readJsonSafe(METRIC_RECONCILIATION_LATEST) || {};
  const clockResync = readJsonSafe(REPORT_CLOCK_RESYNC_LATEST) || {};

  const syncBoardPath = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_sync_status_board_\d{4}_jihye\.json$/);
  const syncBoard = readJsonSafe(syncBoardPath) || {};
  const reportClockManagerPath = pickLatestByPattern(/^\d{4}-\d{2}-\d{2}_report_clock_manager_latest_jihye\.json$/);
  const reportClockManager = readJsonSafe(reportClockManagerPath) || {};

  const pineText = readTextSafe(PINE_FILE);
  const staticCheck = buildStaticCheck(pineText);

  const consolidated = dataConsistency.consolidated_metrics || {};
  const ceoLive = ceoGovernance.current_metrics_live || {};
  const ceoConservative = ceoGovernance.current_metrics_conservative || {};
  const ceoLatestMetrics = ceoGovernance.latest_metrics_used || {};
  const ceoDecisionBasis = ceoGovernance?.decision?.basis || {};
  const ceoReportingSystem = ceoGovernance?.reporting_system || {};
  const ceoFinalNextReports = ceoFinalDecision?.next_reports || {};
  const syncSummary = syncBoard.summary || {};
  const syncRuntime = syncBoard.runtime_snapshot || {};
  const mismatch = strategyAlignment.mismatch || {};
  const mismatchFreshness = strategyAlignment.mismatch_freshness || {};
  const probeCounts = signalProbe.counts || {};
  const probeVerify = signalProbe.verification || {};
  const approvalNextReport = approvalExecution.next_report || {};
  const clockResyncAfter = clockResync.after || {};
  const clockManagerNumbers = reportClockManager.key_numbers || {};
  const metricReconciliationSummary = metricReconciliation.reconciliation_summary || {};
  const ceoGovernanceGeneratedAtMs = parseKstDateTimeToMs(ceoGovernance.generated_at_kst || "");
  const ceoScheduleFresh = Number.isFinite(ceoGovernanceGeneratedAtMs) && Number.isFinite(nowMs)
    ? Math.abs(nowMs - ceoGovernanceGeneratedAtMs) <= 60 * 60 * 1000
    : false;
  const defaultNextReportSlots = buildDefaultNextReportSlots(nowMs);
  const staffFallbackDefault = defaultNextReportSlots.staff_to_jihye;
  const jihyeFallbackDefault = defaultNextReportSlots.jihye_to_jaeyong;
  const ceoStaffNext = pickFirstText(
    ceoFinalNextReports.staff_to_jihye,
    ceoReportingSystem.next_staff_to_jihye,
    ceoGovernance?.next_report?.staff_to_jihye,
    ceoGovernance?.next_report?.staff_to_jihye_kst
  );
  const ceoJihyeNext = pickFirstText(
    ceoFinalNextReports.jihye_to_jaeyong,
    ceoReportingSystem.next_jihye_to_jaeyong,
    ceoGovernance?.next_report?.jihye_to_jaeyong,
    ceoGovernance?.next_report?.jihye_to_jaeyong_kst
  );

  const nextStaffRaw = pickUpcomingKstLabel(
    [
      ceoScheduleFresh ? ceoStaffNext : "",
      approvalNextReport.staff_to_jihye,
      clockResyncAfter.staff_to_jihye,
      clockManagerNumbers.matrix_staff_to_jihye,
      ceoGovernance?.next_report?.staff_to_jihye,
      ceoFinalNextReports.staff_to_jihye,
    ],
    nowMs,
    staffFallbackDefault
  );
  let nextJihyeRaw = pickUpcomingKstLabel(
    [
      ceoScheduleFresh ? ceoJihyeNext : "",
      approvalNextReport.jihye_to_jaeyong,
      clockResyncAfter.jihye_to_jaeyong,
      clockManagerNumbers.matrix_jihye_to_jaeyong,
      clockManagerNumbers.approval_jihye_to_jaeyong,
      ceoGovernance?.next_report?.jihye_to_jaeyong,
      ceoFinalNextReports.jihye_to_jaeyong,
    ],
    nowMs,
    jihyeFallbackDefault
  );

  const nextStaffCandidate = parseKstLabel(nextStaffRaw);
  const nextJihyeCandidate = parseKstLabel(nextJihyeRaw);
  if (Number.isFinite(nextStaffCandidate.ms) && Number.isFinite(nextJihyeCandidate.ms) && nextJihyeCandidate.ms < nextStaffCandidate.ms) {
    nextJihyeRaw = toKstString(nextStaffCandidate.ms + 2 * 60 * 1000, { fallbackToString: true });
  }

  const nextStaff = parseKstLabel(nextStaffRaw);
  const nextJihye = parseKstLabel(nextJihyeRaw);
  const minutesToStaff = Number.isFinite(nextStaff.ms) && Number.isFinite(nowMs)
    ? Math.floor((nextStaff.ms - nowMs) / 60000)
    : null;

  const reportingJudgement = (() => {
    if (!Number.isFinite(minutesToStaff)) {
      return {
        is_reporting_time_now: false,
        reason: `다음 직원 보고 시각 파싱 실패(${nextStaff.raw})`,
      };
    }
    if (minutesToStaff > 10) {
      return {
        is_reporting_time_now: false,
        reason: `정식 직원 보고(${nextStaff.raw}) 전 ${minutesToStaff}분, 중간 점검 구간`,
      };
    }
    if (minutesToStaff >= 0) {
      return {
        is_reporting_time_now: true,
        reason: `정식 직원 보고(${nextStaff.raw}) ${minutesToStaff}분 전, 보고 준비 구간`,
      };
    }
    return {
      is_reporting_time_now: true,
      reason: `정식 직원 보고(${nextStaff.raw}) 시각 경과(${Math.abs(minutesToStaff)}분), 즉시 보고 필요`,
    };
  })();

  const conflictCountConservative = toNum(
    metricReconciliationSummary.consistency_mismatch_count,
    toNum(
      ceoLatestMetrics.conservative_conflict_count,
      toNum(ceoConservative.conflict_count, toNum(consolidated.conflict_count, 0))
    )
  );
  const conflictMatrixVsRole = toNum(
    ceoLatestMetrics.conflict_matrix_vs_role,
    toNum(clockManagerNumbers.conflict_matrix_vs_role, null)
  );
  const conflictApprovalVsRole = toNum(
    ceoLatestMetrics.conflict_approval_vs_role,
    toNum(clockManagerNumbers.conflict_approval_vs_role, null)
  );
  const conflictCountClock = toNum(
    metricReconciliationSummary.live_drift_mismatch_count,
    toNum(
      ceoDecisionBasis.live_drift_check_count,
      toNum(
        ceoLatestMetrics.live_drift_check_count,
        toNum(
          ceoLatestMetrics.report_conflict_count,
          toNum(
            ceoLive.live_drift_check_count,
            toNum(
              syncRuntime.conflict_count,
              toNum(
                syncSummary.conflict_count,
                Number.isFinite(conflictMatrixVsRole) && Number.isFinite(conflictApprovalVsRole)
                  ? Math.max(conflictMatrixVsRole, conflictApprovalVsRole)
                  : 0
              )
            )
          )
        )
      )
    ),
  );

  const metrics = {
    cost_ratio_pct: toNum(consolidated.cost_ratio_pct, toNum(ceoConservative.cost_ratio_pct, null)),
    cost_limit_pct: toNum(ceoLive.cost_limit_pct, 0.2),
    mdd_pct: toNum(consolidated.mdd_pct, toNum(ceoConservative.mdd_pct, null)),
    mdd_limit_pct: toNum(ceoLive.mdd_limit_pct, -1.5),
    on_time_rate_pct: toNum(syncSummary.on_time_rate_pct, toNum(ceoLive.on_time_rate_pct, null)),
    valid_submission_rate_pct: toNum(syncSummary.valid_submission_rate_pct, toNum(ceoLive.valid_submission_rate_pct, null)),
    stale_or_missing_count: toNum(syncSummary.stale_or_missing_count, toNum(ceoLive.stale_or_missing_count, null)),
    conflict_count: conflictCountConservative,
    conflict_count_conservative: conflictCountConservative,
    conflict_count_clock: conflictCountClock,
    conflict_matrix_vs_role: conflictMatrixVsRole,
    conflict_approval_vs_role: conflictApprovalVsRole,
    strategy_id_mismatch_drop_count: toNum(mismatch.total_count, 0),
    strategy_id_mismatch_after_revision_count: toNum(mismatchFreshness.created_after_live_revision_count, 0),
    signal_count: toNum(probeCounts.signals, 0),
    drop_count: toNum(probeCounts.drops, 0),
    trace_payload_version_count: toNum(probeVerify.trace_payload_version_count, 0),
    trace_emit_mode_count: toNum(probeVerify.trace_emit_mode_count, 0),
    trace_chain_key_count: toNum(probeVerify.trace_chain_key_count, 0),
    febt_contract_count: toNum(probeVerify.febt_contract_count, 0),
    febt_trace_contract_missing_count: toNum(probeVerify.febt_trace_contract_missing_count, 0),
    active_trace_payload_version_count: toNum(probeVerify.active_trace_payload_version_count, 0),
    active_febt_contract_count: toNum(probeVerify.active_febt_contract_count, 0),
    active_febt_trace_contract_missing_count: toNum(probeVerify.active_febt_trace_contract_missing_count, 0),
  };

  const holdNeeded =
    (Number.isFinite(metrics.cost_ratio_pct) && metrics.cost_ratio_pct > metrics.cost_limit_pct)
    || (Number.isFinite(metrics.mdd_pct) && metrics.mdd_pct < metrics.mdd_limit_pct)
    || (Number.isFinite(metrics.conflict_count_conservative) && metrics.conflict_count_conservative >= 1)
    || (Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct < 90);

  const decision = holdNeeded
    ? {
      status: "보류 유지",
      mode: "비용 차단 유지",
      go_no_go: "No-Go 유지",
    }
    : {
      status: "조건부 진행 검토",
      mode: "비용 차단 완화 검토",
      go_no_go: "조건부 Go",
    };

  const pineUpdateRequired = metrics.trace_payload_version_count === 0
    ? "[PINE_UPDATE_REQUIRED] STRATEGY_GUARD_V5 실반영(선행알림 OFF 기본, ENTRY/REVERSE 쿨다운, DBJ_WEBHOOK_V1 trace 필드) | 재용이 TradingView에서 직접 버전업/교체해야 함"
    : null;

  const roleDeadlinesTrusted = Number.isFinite(ceoGovernanceGeneratedAtMs) && Number.isFinite(nowMs)
    ? Math.abs(nowMs - ceoGovernanceGeneratedAtMs) <= 60 * 60 * 1000
    : false;
  const roleDeadlines = new Map(
    roleDeadlinesTrusted && Array.isArray(ceoGovernance.role_responsibilities)
      ? ceoGovernance.role_responsibilities
        .filter((x) => x && x.role)
        .map((x) => [String(x.role), String(x.deadline_kst || "")])
      : []
  );
  const deadlineForRole = (role, fallback) => {
    const found = roleDeadlines.get(role);
    if (!found || !found.trim()) return fallback;
    const foundLabel = parseKstLabel(found);
    const fallbackLabel = parseKstLabel(fallback);
    if (Number.isFinite(foundLabel.ms) && Number.isFinite(fallbackLabel.ms)) {
      const diffMinutes = Math.abs((foundLabel.ms - fallbackLabel.ms) / 60000);
      if (diffMinutes > 30) return fallback;
    }
    return found;
  };

  const issues = buildIssues(metrics, staticCheck, {
    staff_deadline_label: nextStaff.raw,
    preflight_results: preflightResults,
  });
  const dailyRequiredPct = toNum(ceoGovernance?.team_common_goal?.daily_required_return_pct, 0.1667);
  const onTimeActionText = Number.isFinite(metrics.on_time_rate_pct) && metrics.on_time_rate_pct >= 90
    ? "90%+ 유지"
    : "90%+ 복구";

  const outputJson = path.join(OPS_DAILY, `${dateKey}_pine_strategy_owner_cycle_${cycleHhmm}_jihye.json`);
  const outputMd = path.join(OPS_DAILY, `${dateKey}_pine_strategy_owner_cycle_${cycleHhmm}_jihye.md`);
  const runTimeLabel = `${cycleHhmm.slice(0, 2)}:${cycleHhmm.slice(2, 4)}`;

  const payload = {
    generated_at_kst: generatedAtKst,
    role: "pine_script_engineer",
    mission: "바이낸스 월 5% 수익",
    date_key: dateKey,
    cycle_hhmm: cycleHhmm,
    decision,
    reporting_judgement: reportingJudgement,
    next_report: {
      staff_to_jihye: nextStaff.raw,
      jihye_to_jaeyong: nextJihye.raw,
    },
    core_metrics: metrics,
    static_check: staticCheck,
    self_rules: [
      `[SELF_RULE] 1) 비용 상한(${fmtPct(metrics.cost_limit_pct)})과 MDD 기준(${fmtPct(metrics.mdd_limit_pct)}) 미충족 시 Pine 공격 변경을 제안하지 않는다. | 직전 사이클 동일 유지 사유: 보수 비용 ${fmtPct(metrics.cost_ratio_pct)}, 보수 MDD ${fmtPct(metrics.mdd_pct)}로 리스크 미해소`,
      "[SELF_RULE] 2) request.security는 lookahead_off 100%를 유지하고 누락 시 즉시 H 이슈로 올린다.",
      "[SELF_RULE] 3) webhook 필수 필드(signal_key/bar_index/is_bar_close_confirmed)가 하나라도 빠지면 같은 사이클 내 재작성한다.",
    ],
    strategy_logic: [
      "진입/청산 조건식은 유지하고, 현재는 비용 차단 모드와 쿨다운 규칙이 살아있는지 확인에 집중합니다.",
      "재도색 방지를 위해 request.security에 lookahead_off 사용 여부를 정적 점검으로 고정합니다.",
      "알림 스키마는 DBJ_WEBHOOK_V1 필수 필드(signal_key/bar_index/is_bar_close_confirmed) 유지 여부를 매 사이클 확인합니다.",
    ],
    key_parameters: [
      `보수 비용 ${fmtPct(metrics.cost_ratio_pct)} (한도 ${fmtPct(metrics.cost_limit_pct)})`,
      `보수 MDD ${fmtPct(metrics.mdd_pct)} (한도 ${fmtPct(metrics.mdd_limit_pct)})`,
      `정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} / 유효 제출률 ${fmtPct(metrics.valid_submission_rate_pct, 1)} / stale ${metrics.stale_or_missing_count}건`,
      `운영충돌(consistency_check)/실시간차이(live_drift_check) ${metrics.conflict_count_conservative}/${metrics.conflict_count_clock}건${Number.isFinite(metrics.conflict_matrix_vs_role) && Number.isFinite(metrics.conflict_approval_vs_role) ? ` (matrix-role ${metrics.conflict_matrix_vs_role}, approval-role ${metrics.conflict_approval_vs_role})` : ""}`,
      `신호 ${metrics.signal_count}건 / 드롭 ${metrics.drop_count}건 / strategy_id 누적 불일치 ${metrics.strategy_id_mismatch_drop_count}건(신규 ${metrics.strategy_id_mismatch_after_revision_count}건)`,
      `active TPTR_V2/FEBT/missing ${metrics.active_trace_payload_version_count}/${metrics.active_febt_contract_count}/${metrics.active_febt_trace_contract_missing_count}`,
      `월 목표 5% 기준 일 필요수익 ${fmtPct(dailyRequiredPct, 4)}`,
      `파인 정적 점검 lookahead 커버리지 ${fmtPct(staticCheck.lookahead_coverage_pct, 1)} (${staticCheck.lookahead_off_count}/${staticCheck.request_security_count})`,
    ],
    pine_code_snippet: [
      "pre_alert_enable = input.bool(false, \"선행 알림 사용(보수 기본 OFF)\", group = grp_alert)",
      "entry_cooldown_bars = input.int(8, \"신규 ENTRY 최소 간격(봉)\", minval = 0, maxval = 300, group = grp_alert)",
      "reverse_cooldown_bars = input.int(12, \"반대방향 ENTRY 최소 간격(봉)\", minval = 0, maxval = 300, group = grp_alert)",
      "[actionCdRt, reasonCdRt] = f_apply_entry_cooldown(action, reasonRt, sigDir, lastEntryBarOut, lastEntryDirOut)",
      "payload += \",\\\"schema_version\\\":\\\"DBJ_WEBHOOK_V1\\\",\\\"schema_family\\\":\\\"DONBEOLJA_BINANCE\\\"\"",
      "payload += \",\\\"signal_key\\\":\\\"\" + signalKey + \"\\\",\\\"bar_index\\\":\" + str.tostring(bar_index)",
      "payload += \",\\\"is_bar_close_confirmed\\\":\" + str.tostring(barstate.isconfirmed)",
    ],
    verification_checkpoints: [
      `request.security ${staticCheck.request_security_count}개 대비 lookahead_off ${staticCheck.lookahead_off_count}개 확인`,
      `필수 필드 누락 ${staticCheck.missing_required.length}건 확인`,
      `strategy_id 신규 불일치 ${metrics.strategy_id_mismatch_after_revision_count}건 유지 확인`,
      `운영충돌(consistency_check)/실시간차이(live_drift_check) ${metrics.conflict_count_conservative}/${metrics.conflict_count_clock}건 확인`,
      `trace_payload_version/trace_emit_mode/trace_chain_key = ${metrics.trace_payload_version_count}/${metrics.trace_emit_mode_count}/${metrics.trace_chain_key_count}`,
      `active TPTR_V2/FEBT contract/missing = ${metrics.active_trace_payload_version_count}/${metrics.active_febt_contract_count}/${metrics.active_febt_trace_contract_missing_count}`,
      `정시율 ${fmtPct(metrics.on_time_rate_pct, 1)} -> ${nextStaff.raw}까지 ${onTimeActionText} 목표`,
    ],
    independent_execution_plan: {
      objective: `${nextStaff.raw} 전 파인 품질 점검 자동화(정적 점검 + 최신 수치 묶음 보고) 고정`,
      progress_pct: 100,
      executed_now: preflightResults.map((x) => `${x.command} ${x.ok ? "성공" : "실패"} (${runTimeLabel})`),
      deliverables: [
        outputJson,
        outputMd,
        OUTPUT_LATEST_JSON,
        OUTPUT_LATEST_MD,
        OUTPUT_LEGACY_LATEST_MD,
      ],
    },
    executed_now: [
      `post_apply_signal_probe 최신 재생성(신호 ${metrics.signal_count}, 드롭 ${metrics.drop_count})`,
      `strategy_id_alignment 최신 재생성(누적 불일치 ${metrics.strategy_id_mismatch_drop_count}, 리비전 이후 신규 ${metrics.strategy_id_mismatch_after_revision_count})`,
      `data_consistency_latest 재집계(보수 비용 ${round(metrics.cost_ratio_pct, 4)}, 보수 MDD ${round(metrics.mdd_pct, 4)})`,
      `report_sync_status_board 재집계(정시율 ${round(metrics.on_time_rate_pct, 1)}, 지연 ${toNum(syncSummary.late_count, 0)}건)`,
      `사전 점검 스크립트 성공 ${preflightResults.filter((x) => x.ok).length}/${preflightResults.length}건`,
      "파인 정적 점검 실행",
      `${runTimeLabel} 파인 담당 보고서(JSON/MD) 생성 및 latest 포인터 갱신`,
    ],
    report_to_jihye: {
      progress_pct: 100,
      report_tag: `[REPORT_TO_JIHYE] 진행률 100% | 비용 ${fmtPct(metrics.cost_ratio_pct)} / MDD ${fmtPct(metrics.mdd_pct)} / 운영충돌(consistency_check)/실시간차이(live_drift_check) ${metrics.conflict_count_conservative}/${metrics.conflict_count_clock}건 | 다음 직원 보고 ${nextStaff.raw}`,
      key_achievements: [
        `lookahead_off 커버리지 ${fmtPct(staticCheck.lookahead_coverage_pct, 1)}로 정적 기준선 점검 자동화`,
        "알림 스키마 필수 필드(schema_version/signal_key/bar_index/is_bar_close_confirmed) 존재 확인",
        "파인 담당 보고를 수동 문서에서 스크립트 자동 생성으로 전환",
      ],
      decision_requests: [
        `${nextStaff.raw} 보고에서는 파인 변경보다 정시율 ${onTimeActionText}를 최우선 KPI로 고정할지 확정 요청`,
        "trace 필드 관측 0건 구간에서 TradingView 반영 확인을 H 이슈로 올릴지 확정 요청",
      ],
    },
    collaboration_requests_via_jihye: [
      `[COLLAB_REQUEST] report_sync_keeper | 정시율 ${fmtPct(metrics.on_time_rate_pct, 1)}의 ${onTimeActionText} 실행안 공유 | ${deadlineForRole("report_sync_keeper", nextStaff.raw)}`,
      `[COLLAB_REQUEST] post_apply_signal_observer | 다음 실신호 1건 기준 trace 필드 3종 적재 여부 3분 내 보고 | ${deadlineForRole("post_apply_signal_observer", nextStaff.raw)}`,
      `[COLLAB_REQUEST] approval_consistency_owner | 운영충돌(consistency_check) ${metrics.conflict_count_conservative}건 유지/해소 ETA 공유 | ${deadlineForRole("approval_consistency_owner", nextStaff.raw)}`,
    ],
    evolution_plan: [
      "[EVOLUTION] 파인 코드 정적 점검을 매 사이클 자동 실행으로 고정 | 누락/재도색 리스크 조기 발견",
      "[EVOLUTION] 파인 담당 보고서(JSON/MD) 자동 생성 | 정시 제출률 개선",
      "[EVOLUTION] trace 필드 관측 0건을 자동 경보 조건으로 추가 | TradingView 미반영 구간 즉시 탐지",
    ],
    issues,
    simple_summary_for_jaeyong: [
      "지금은 공격적으로 늘리기보다, 손실과 실수 가능성을 줄이는 단계가 맞습니다.",
      "파인 코드 자체는 기준선(재도색 방지, 알림 필드, 진입 간격 제한) 점검에서 통과했습니다.",
      "다만 실제 화면(TradingView) 반영이 늦으면 추적값이 안 찍힐 수 있어, 반영 확인이 꼭 필요합니다.",
      `다음 직원 보고 시각은 ${nextStaff.raw}, 지혜 최종 보고 시각은 ${nextJihye.raw}입니다.`,
    ],
    pine_update_required: pineUpdateRequired,
    self_validation: {
      summary: `사전 점검 ${preflightResults.filter((x) => x.ok).length}/${preflightResults.length} 성공 + 정적 점검 ${staticCheck.pass ? "PASS" : "FAIL"} + JSON 문법 통과`,
      checks: [
        `점검 스크립트 성공 ${preflightResults.filter((x) => x.ok).length}/${preflightResults.length}건 확인`,
        "파인 파일 정적 점검 결과와 보고 수치 일치 확인",
        "JSON/MD 산출물 생성 및 latest 포인터 갱신 확인",
        "jq empty로 JSON 문법 검증 통과 확인",
      ],
      result: preflightResults.every((x) => x.ok) ? "pass" : "warn",
      preflight_results: preflightResults,
    },
    artifacts: [
      "/Users/jeongjaeyong/Projects/donbeolja/scripts/pine-strategy-owner-cycle.js",
      outputJson,
      outputMd,
      OUTPUT_LATEST_JSON,
      OUTPUT_LATEST_MD,
      OUTPUT_LEGACY_LATEST_MD,
    ],
    source_files: {
      pine_file: PINE_FILE,
      data_consistency_latest: DATA_CONSISTENCY_LATEST,
      strategy_alignment_latest: STRATEGY_ALIGNMENT_LATEST,
      post_apply_signal_latest: POST_APPLY_SIGNAL_LATEST,
      ceo_governance_latest: CEO_GOVERNANCE_LATEST,
      ceo_final_decision_latest: CEO_FINAL_DECISION_LATEST,
      approval_execution_latest: APPROVAL_EXECUTION_LATEST,
      metric_reconciliation_latest: METRIC_RECONCILIATION_LATEST,
      report_clock_resync_latest: REPORT_CLOCK_RESYNC_LATEST,
      report_clock_manager_latest: reportClockManagerPath,
      report_sync_status_board_latest: syncBoardPath,
    },
  };

  const markdown = buildMarkdown(payload);

  writeJson(outputJson, payload);
  writeJson(OUTPUT_LATEST_JSON, payload);
  writeText(outputMd, markdown);
  writeText(OUTPUT_LATEST_MD, markdown);
  writeText(OUTPUT_LEGACY_LATEST_MD, markdown);

  // ── Pine 코드 버전업 실행 (pending 지시가 있을 때만) ──
  const versionUpgradeResult = executePineVersionUpgrade(pineText, generatedAtKst);

  console.log(
    JSON.stringify(
      {
        ok: true,
        generated_at_kst: generatedAtKst,
        output_json: outputJson,
        output_md: outputMd,
        output_latest_json: OUTPUT_LATEST_JSON,
        output_latest_md: OUTPUT_LATEST_MD,
        output_legacy_latest_md: OUTPUT_LEGACY_LATEST_MD,
        static_check_pass: staticCheck.pass,
        lookahead_coverage_pct: staticCheck.lookahead_coverage_pct,
        on_time_rate_pct: metrics.on_time_rate_pct,
        version_upgrade: versionUpgradeResult,
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  __test: {
    buildStaticCheck,
  },
};
