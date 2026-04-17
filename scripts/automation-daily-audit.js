#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  loadLocalEnv,
  ensureDir,
  readJsonSafe,
  writeJson,
  writeText,
  copyLatest,
  nowKstMeta,
  formatSignedPct,
  execJson,
  sendKoreanTelegramSummary,
  ensureExchangeApiKeys,
} = require("./lib/automation-utils");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const { loadSystemOpsLatestSync } = require("./lib/system-ops-runtime");
const { getFirestore } = require("../src/storage/firestore");
const { auditBinanceExitIntegrity } = require("../src/services/exitIntegrityAudit");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (_err) {
    return false;
  }
}

function parseDateMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function parseRevisionCreateMs(row) {
  const candidate = row && (
    row.createTime ||
    row.create_time ||
    row.create_time_iso ||
    (row.metadata && row.metadata.creationTimestamp) ||
    (row.metadata && row.metadata.createTime)
  );
  return parseDateMs(candidate);
}

function round(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

function formatSignedPp(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%p`;
}

function formatSignedMetricPct(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function findPreviousDailyAuditReport(currentDateKey) {
  try {
    const names = fs.readdirSync(OPS_DAILY_DIR)
      .filter((name) => /^\d{4}-\d{2}-\d{2}_daily_trading_audit\.json$/.test(name))
      .filter((name) => !name.startsWith(`${currentDateKey}_`))
      .sort()
      .reverse();
    if (!names.length) return null;
    return path.join(OPS_DAILY_DIR, names[0]);
  } catch (_err) {
    return null;
  }
}

function runScript(cmd) {
  try {
    execSync(cmd, { cwd: REPO_ROOT, stdio: "inherit", encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err && err.message ? String(err.message) : "SCRIPT_FAILED" };
  }
}

function buildSystemOpsPrereportCommands() {
  return [
    {
      command: "node scripts/report-best-self-evolution-execution-quality.js",
      errorCode: "EXECUTION_QUALITY_REPORT_FAILED",
    },
    {
      command: "node scripts/report-signal-lineage-health.js",
      errorCode: "SIGNAL_LINEAGE_HEALTH_FAILED",
    },
    {
      command: "node scripts/report-openclaw-policy-authority.js",
      errorCode: "OPENCLAW_POLICY_AUTHORITY_FAILED",
    },
    {
      command: "node scripts/report-trail-runner-floor-audit.js",
      errorCode: "TRAIL_RUNNER_FLOOR_AUDIT_FAILED",
    },
    {
      command: "node scripts/report-binance-exit-qty-contract-audit.js",
      errorCode: "BINANCE_EXIT_QTY_CONTRACT_AUDIT_FAILED",
    },
    {
      command: "node scripts/report-tp1-fail-closed-events.js",
      errorCode: "TP1_FAIL_CLOSED_REPORT_FAILED",
    },
  ];
}

function buildTp1FailClosedQuarantineLines(ops = {}) {
  const tp1 = ops && typeof ops.tp1_fail_closed === "object" ? ops.tp1_fail_closed : {};
  if (!Number.isFinite(Number(tp1.quarantine_candidate_n)) || Number(tp1.quarantine_candidate_n) < 1) return [];
  const candidates = Array.isArray(tp1.quarantine_candidates) ? tp1.quarantine_candidates.slice(0, 3) : [];
  const headline = `TP1 quarantine 후보 ${Number(tp1.quarantine_candidate_n)}개 / repeat ${Number.isFinite(Number(tp1.repeat_symbol_n)) ? Number(tp1.repeat_symbol_n) : 0}개`;
  if (!candidates.length) return [headline];
  return [
    headline,
    `상위 ${candidates.map((item) => `${item.symbol}(${item.count},${item.severity})`).join(", ")}`,
  ];
}

function runDailySystemOpsCheck() {
  const snapshotPath = path.join(REPO_ROOT, "noye", "binance_snapshot_latest.json");
  const reportPath = path.join(REPO_ROOT, "noye", "report.md");
  const refresh = runScript("node scripts/refresh-noye-runtime-inputs.js");
  if (!refresh.ok) {
    return {
      ok: false,
      skipped: false,
      error: `NOYE_REFRESH_FAILED:${refresh.error}`,
      snapshotPath,
      reportPath,
    };
  }
  if (!fileExists(snapshotPath) || !fileExists(reportPath)) {
    return {
      ok: false,
      skipped: true,
      error: "MISSING_INPUT_FILES",
      snapshotPath,
      reportPath,
    };
  }
  for (const step of buildSystemOpsPrereportCommands()) {
    const result = runScript(step.command);
    if (!result.ok) {
      return {
        ok: false,
        skipped: false,
        error: `${step.errorCode}:${result.error}`,
        snapshotPath,
        reportPath,
      };
    }
  }
  return runScript(`node scripts/daily-system-ops-check.js ${JSON.stringify(snapshotPath)} ${JSON.stringify(reportPath)}`);
}

function parsePineVersion() {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "code", "donbeolja.pine.txt"), "utf8");
  const titleMatch = raw.match(/v(\d+\.\d+\.\d+\.\d+)/);
  const stratMatch = raw.match(/STRATEGY_ID\s*=\s*\"([^\"]+)\"/);
  return {
    pine_version: titleMatch ? titleMatch[1] : null,
    strategy_id: stratMatch ? stratMatch[1] : null,
  };
}

function describeService(service, region = "asia-northeast3") {
  return execJson(
    `gcloud run services describe ${service} --region ${region} --format=json`,
    { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }
  );
}

function pickEnv(parsed, key) {
  const env = ((((parsed || {}).data || {}).spec || {}).template || {}).spec || {};
  const container = (Array.isArray(env.containers) ? env.containers[0] : null) || {};
  const list = Array.isArray(container.env) ? container.env : [];
  const found = list.find((row) => row && row.name === key);
  return found && Object.prototype.hasOwnProperty.call(found, "value") ? found.value : null;
}

async function countExpiredPendingIntents() {
  const db = getFirestore();
  const nowMs = Date.now();
  try {
    const snap = await db.collection("order_intents_paper").where("status", "==", "PENDING").get();
    let total = 0;
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const expires = Number(data.expires_at_ms);
      if (Number.isFinite(expires) && expires < nowMs) total += 1;
    });
    return total;
  } catch (_err) {
    return null;
  }
}

function listRecentBuilds() {
  const sinceIso = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString();
  return execJson(
    `gcloud builds list --filter='createTime>=\"${sinceIso}\"' --format=json`,
    { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }
  );
}

function listRevisions(service) {
  return execJson(
    `gcloud run revisions list --service ${service} --region asia-northeast3 --format=json`,
    { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 }
  );
}

function countRecentRevisions(rows, sinceMs) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((row) => {
    const createdMs = parseRevisionCreateMs(row);
    return Number.isFinite(createdMs) && createdMs >= sinceMs;
  }).length;
}

function artifactImageCount() {
  return execJson(
    "gcloud artifacts docker images list asia-northeast3-docker.pkg.dev/donbeolja-dev/cloud-run-source-deploy/donbeolja --include-tags --format=json",
    { cwd: REPO_ROOT, maxBuffer: 20 * 1024 * 1024 }
  );
}

function buildBestFebtDailyAuditLine(contract = {}) {
  return `mode ${contract.mode || "N/A"} / tightening ${contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${contract.recovery_priority ? "FIRST" : "NORMAL"} / replacement ${contract.projected_replacement_ratio != null ? Number(contract.projected_replacement_ratio).toFixed(2) : "N/A"} / count ${contract.projected_count_ratio_global != null ? `${Number(contract.projected_count_ratio_global).toFixed(2)}x` : "N/A"} / delta ${contract.projected_net_signal_delta_n != null ? contract.projected_net_signal_delta_n : "N/A"}`;
}

async function main() {
  const meta = nowKstMeta();
  await ensureExchangeApiKeys("BINANCEFUT");
  const bestFebtContext = readBestFebtSupervisorContext(meta.nowMs);
  const bestFebtContract = bestFebtContext && bestFebtContext.contract && typeof bestFebtContext.contract === "object"
    ? bestFebtContext.contract
    : {};
  const filterLayers = bestFebtContext
    && bestFebtContext.objectiveSupervisor
    && bestFebtContext.objectiveSupervisor.filter_layers
    && typeof bestFebtContext.objectiveSupervisor.filter_layers === "object"
      ? bestFebtContext.objectiveSupervisor.filter_layers
      : null;
  const runA = runDailySystemOpsCheck();
  const runB = runScript("node scripts/strategy-id-alignment-check.js");
  const ops = loadSystemOpsLatestSync({ fallbackPath: path.join(OPS_DAILY_DIR, "system_ops_check_latest.json") });
  const align = readJsonSafe(path.join(OPS_DAILY_DIR, "strategy_id_alignment_latest.json"), {});
  const previousAuditPath = findPreviousDailyAuditReport(meta.dateKey);
  const previousAudit = previousAuditPath ? readJsonSafe(previousAuditPath, {}) : {};
  const pine = parsePineVersion();
  const live = describeService("donbeolja");
  const liveEnv = {
    strategy_id: pickEnv(live, "DONBEOLJA_STRATEGY_ID"),
    allowed_ids: pickEnv(live, "WEBHOOK_ALLOWED_STRATEGY_IDS"),
    tf_allowlist: pickEnv(live, "EXCHANGE_TF_ALLOWLIST"),
    exec_tf: pickEnv(live, "EXCHANGE_EXEC_TF"),
    ai_corr_tf: pickEnv(live, "SIGNAL_AI_CORR_TF"),
  };

  const [integrity, expiredPending, builds, revisionsMain, revisionsEgress, revisionsExit, artifacts] = await Promise.all([
    auditBinanceExitIntegrity({ includeFlat: false }),
    countExpiredPendingIntents(),
    Promise.resolve(listRecentBuilds()),
    Promise.resolve(listRevisions("donbeolja")),
    Promise.resolve(listRevisions("donbeolja-egress")),
    Promise.resolve(listRevisions("donbeolja-exit-worker")),
    Promise.resolve(artifactImageCount()),
  ]);

  const todayBuildCount = Array.isArray(builds.data) ? builds.data.length : null;
  const revisionsSinceMs = Date.now() - (24 * 60 * 60 * 1000);
  const revisionCount24h = [revisionsMain, revisionsEgress, revisionsExit]
    .map((res) => countRecentRevisions(res.data, revisionsSinceMs))
    .reduce((a, b) => a + b, 0);
  const artifactCount = Array.isArray(artifacts.data) ? artifacts.data.length : null;
  const opsGeneratedMs = parseDateMs(ops.generated_at_iso) || parseDateMs(ops.generated_at_kst);
  const opsAgeHours = Number.isFinite(opsGeneratedMs)
    ? round((meta.nowMs - opsGeneratedMs) / (60 * 60 * 1000), 2)
    : null;
  const opsFresh = Number.isFinite(opsGeneratedMs) && ((meta.nowMs - opsGeneratedMs) <= (36 * 60 * 60 * 1000));
  const prevOps = previousAudit && previousAudit.ops_summary ? previousAudit.ops_summary : {};
  const prevOpsFresh = prevOps && prevOps.fresh === true;
  const dayOverDayAvailable = (
    opsFresh
    && prevOpsFresh
    && Number.isFinite(Number(ops.net_pnl_pct))
    && Number.isFinite(Number(prevOps.net_pnl_pct))
    && Number.isFinite(Number(ops.cost_ratio_pct))
    && Number.isFinite(Number(prevOps.cost_ratio_pct))
  );
  const dayOverDay = {
    available: dayOverDayAvailable,
    previous_report_path: previousAuditPath || null,
    net_pnl_pct_delta_pp: dayOverDayAvailable ? round(Number(ops.net_pnl_pct) - Number(prevOps.net_pnl_pct), 4) : null,
    cost_ratio_pct_delta_pp: dayOverDayAvailable ? round(Number(ops.cost_ratio_pct) - Number(prevOps.cost_ratio_pct), 4) : null,
    reason: dayOverDayAvailable ? null : (!opsFresh ? "OPS_SOURCE_STALE" : (!prevOpsFresh ? "PREVIOUS_DATA_STALE" : "PREVIOUS_DATA_UNAVAILABLE")),
  };

  const driftFindings = [];
  if (!opsFresh) {
    driftFindings.push(`system_ops_check_latest 원본이 stale (${opsAgeHours == null ? "N/A" : opsAgeHours}h)`);
  }
  if (previousAuditPath && !prevOpsFresh) {
    driftFindings.push("전일 비교 원본이 stale 또는 미검증 상태");
  }
  if (pine.strategy_id && liveEnv.strategy_id && pine.strategy_id !== liveEnv.strategy_id) {
    driftFindings.push(`Pine STRATEGY_ID(${pine.strategy_id})와 실서비스(${liveEnv.strategy_id}) 불일치`);
  }
  if (pine.strategy_id && liveEnv.allowed_ids && !String(liveEnv.allowed_ids).includes(pine.strategy_id)) {
    driftFindings.push(`실서비스 허용 전략 ID 목록에 ${pine.strategy_id} 없음`);
  }
  if (Number.isFinite(expiredPending) && expiredPending > 0) {
    driftFindings.push(`만료된 PENDING intent ${expiredPending}건`);
  }
  if (Number(integrity.issue_count || 0) > 0) {
    driftFindings.push(`포지션/보호주문 정합성 이슈 ${integrity.issue_count || 0}건`);
  } else if (!integrity.ok) {
    driftFindings.push(`포지션/보호주문 정합성 감사 실패 또는 미완료${integrity.reason ? ` (${integrity.reason})` : ""}`);
  }
  if (Number.isFinite(todayBuildCount) && todayBuildCount >= 5) {
    driftFindings.push(`최근 24시간 Cloud Build ${todayBuildCount}회로 비용 churn 가능`);
  }
  if (Number.isFinite(revisionCount24h) && revisionCount24h >= 6) {
    driftFindings.push(`최근 24시간 Cloud Run 새 리비전 ${revisionCount24h}개`);
  }
  driftFindings.push(...buildTp1FailClosedQuarantineLines(ops));

  const status = driftFindings.length ? "주의" : "정상";
  const report = {
    generated_at_kst: meta.kst,
    script_runs: {
      daily_system_ops_check: runA,
      strategy_id_alignment_check: runB,
    },
    pine,
    live_env: liveEnv,
    ops_summary: {
      status: ops.status || null,
      net_pnl_pct: ops.net_pnl_pct ?? null,
      cost_ratio_pct: ops.cost_ratio_pct ?? null,
      error_count_24h: Number.isFinite(Number(ops.error_count)) ? Number(ops.error_count) : null,
      generated_at_kst: ops.generated_at_kst || null,
      age_hours: opsAgeHours,
      fresh: opsFresh,
      reasons: Array.isArray(ops.reasons) ? ops.reasons : [],
    },
    strategy_alignment: {
      decision: align.decision || null,
      mismatch_total_count: align.mismatch && align.mismatch.total_count || null,
      mismatch_guard_count: align.mismatch && align.mismatch.guard_count || null,
    },
    integrity: {
      ok: integrity.ok,
      issue_count: integrity.issue_count || 0,
      active_market_count: integrity.active_market_count || 0,
      reason: integrity.reason || null,
    },
    drift: {
      expired_pending_intents: expiredPending,
      cloud_builds_last_24h: todayBuildCount,
      cloud_run_revisions_last_24h: revisionCount24h,
      artifact_image_count: artifactCount,
    },
    best_febt_tuning_contract: bestFebtContract,
    filter_layers: filterLayers,
    day_over_day: dayOverDay,
    findings: driftFindings,
  };

  const baseName = `${meta.dateKey}_daily_trading_audit`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${baseName}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "daily_trading_audit_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "daily_trading_audit_latest.md");
  writeJson(jsonPath, report);
  writeText(
    mdPath,
    [
      "# Trading Daily Audit",
      "",
      `- 생성 시각: ${meta.kst}`,
      `- 상태: ${status}`,
      `- 오늘 상태: ${ops.status || "N/A"} / 순손익 ${formatSignedMetricPct(ops.net_pnl_pct ?? NaN)} / 비용비율 ${formatSignedMetricPct(ops.cost_ratio_pct ?? NaN)}`,
      `- 전일 대비: ${dayOverDay.available ? `순손익 ${formatSignedPp(dayOverDay.net_pnl_pct_delta_pp)} / 비용비율 ${formatSignedPp(dayOverDay.cost_ratio_pct_delta_pp)}` : `보류 (${dayOverDay.reason})`}`,
      `- 원본 지표 시각: ${ops.generated_at_kst || "N/A"} / fresh=${opsFresh ? "yes" : "no"}`,
      `- 전략 정렬: ${align.decision || "N/A"} / mismatch ${align.mismatch && align.mismatch.total_count != null ? align.mismatch.total_count : "N/A"}건`,
      `- 보호주문 감사: ${Number(integrity.issue_count || 0) > 0 ? `ok=${integrity.ok} / issue_count=${integrity.issue_count || 0}` : (integrity.ok ? "정상" : `실패 또는 미완료${integrity.reason ? ` (${integrity.reason})` : ""}`)}`,
      ...buildTp1FailClosedQuarantineLines(ops).map((line) => `- ${line}`),
      `- Drift: expired intents=${expiredPending == null ? "N/A" : expiredPending}, builds24h=${todayBuildCount == null ? "N/A" : todayBuildCount}, revisions24h=${revisionCount24h}, artifactImages=${artifactCount == null ? "N/A" : artifactCount}`,
      `- BEST/FEBT 계약: ${buildBestFebtDailyAuditLine(bestFebtContract)}`,
      `- 감독관 필터 계층: ${filterLayers ? Object.keys(filterLayers).length : 0}개`,
      `- 핵심 이상:`,
      ...(driftFindings.length ? driftFindings.map((line) => `  - ${line}`) : ["  - 정상"]),
      "",
    ].join("\n")
  );
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  const alertResult = await sendKoreanTelegramSummary({
    title: `[일일 운영 점검] ${status}`,
    severity: status === "주의" ? "WARN" : "INFO",
    sections: [
      {
        header: "오늘 상태",
        lines: [
          `운영 ${ops.status || "N/A"} / 전략정렬 ${align.decision || "N/A"}`,
          `순손익 ${formatSignedMetricPct(ops.net_pnl_pct ?? NaN)} / 비용비율 ${formatSignedMetricPct(ops.cost_ratio_pct ?? NaN)}`,
          dayOverDay.available
            ? `전일 대비 순손익 ${formatSignedPp(dayOverDay.net_pnl_pct_delta_pp)} / 비용 ${formatSignedPp(dayOverDay.cost_ratio_pct_delta_pp)}`
            : `전일 대비 보류 (${dayOverDay.reason})`,
          Number(integrity.issue_count || 0) > 0
            ? `보호주문 이슈 ${integrity.issue_count || 0}건`
            : (integrity.ok ? "보호주문 감사 정상" : `보호주문 감사 실패/미완료${integrity.reason ? ` (${integrity.reason})` : ""}`),
          `시스템 오류 24h ${Number.isFinite(Number(ops.error_count)) ? Number(ops.error_count) : "N/A"}건`,
          ...buildTp1FailClosedQuarantineLines(ops),
        ],
      },
      {
        header: "운영비용",
        lines: [
          `Build 24h ${todayBuildCount == null ? "N/A" : todayBuildCount}회 / 리비전 24h ${revisionCount24h}개`,
        ],
      },
      {
        header: "BEST/FEBT 계약",
        lines: [
          buildBestFebtDailyAuditLine(bestFebtContract),
          `감독관 필터 계층 ${filterLayers ? Object.keys(filterLayers).length : 0}개 / objective ${bestFebtContract.objective_verdict || "N/A"}`,
        ],
      },
      {
        header: "핵심",
        lines: driftFindings.slice(0, 5).length ? driftFindings.slice(0, 5) : ["정상"],
      },
      {
        header: "조치",
        lines: [driftFindings.length ? "위 핵심 이상부터 순서대로 정리" : "없음"],
      },
    ],
  });
  if (!alertResult || (alertResult.ok !== true && alertResult.skipped !== true)) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alertResult || {})}`);
  }

  console.log(JSON.stringify({ ok: true, status, jsonPath, mdPath, alert: alertResult }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-daily-audit failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      buildBestFebtDailyAuditLine,
      buildSystemOpsPrereportCommands,
      buildTp1FailClosedQuarantineLines,
    },
  };
}
