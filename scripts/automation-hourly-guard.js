#!/usr/bin/env node
/* eslint-disable no-console */

const path = require("path");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  loadLocalEnv,
  ensureDir,
  writeJson,
  writeText,
  copyLatest,
  nowKstMeta,
  docCreatedMs,
  execJson,
  sendKoreanTelegramSummary,
  ensureExchangeApiKeys,
} = require("./lib/automation-utils");
const { getFirestore } = require("../src/storage/firestore");
const { auditBinanceExitIntegrity } = require("../src/services/exitIntegrityAudit");
const { resolveStatPhysFeatures } = require("../src/utils/statPhysFeatures");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);

const SERVICE = process.env.CLOUD_RUN_SERVICE || "donbeolja";

async function readRecentCollection(collectionName, { exchange = "BINANCEFUT", limit = 200 } = {}) {
  const db = getFirestore();
  try {
    const snap = await db.collection(collectionName).where("exchange", "==", exchange).orderBy("created_at", "desc").limit(limit).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (_err) {
    try {
      const snap = await db.collection(collectionName).where("exchange", "==", exchange).limit(limit).get();
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    } catch (err2) {
      return [{ _query_error: err2 && err2.message ? String(err2.message) : "QUERY_FAILED" }];
    }
  }
}

function getRecent(items, sinceMs) {
  return (Array.isArray(items) ? items : []).filter((row) => {
    if (row && row._query_error) return false;
    const ms = docCreatedMs(row);
    return ms && ms >= sinceMs;
  });
}

function readCloudLogMatches(filter, limit = 100) {
  const cmd = [
    "gcloud logging read",
    `'resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\" AND ${filter}'`,
    "--freshness=90m",
    `--limit=${limit}`,
    "--format=json",
  ].join(" ");
  const res = execJson(cmd, { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
  if (!res.ok) return { ok: false, error: res.error, rows: [] };
  return { ok: true, rows: Array.isArray(res.data) ? res.data : [] };
}

function pct(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function summarizePhysics(rows = []) {
  const stateCounts = { ORDERED: 0, MIXED: 0, DISORDERED: 0, CRITICAL: 0, UNKNOWN: 0 };
  const sums = {
    entropy: 0,
    coherence: 0,
    transitionRisk: 0,
    fieldAlignment: 0,
    domainWallDensity: 0,
    susceptibility: 0,
    freeEnergy: 0,
  };
  const counts = {
    entropy: 0,
    coherence: 0,
    transitionRisk: 0,
    fieldAlignment: 0,
    domainWallDensity: 0,
    susceptibility: 0,
    freeEnergy: 0,
  };
  let countedN = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row._query_error) continue;
    const phys = resolveStatPhysFeatures(row);
    const hasAny = [
      phys.entropy,
      phys.coherence,
      phys.transitionRisk,
      phys.fieldAlignment,
      phys.domainWallDensity,
      phys.susceptibility,
      phys.freeEnergy,
    ].some((v) => Number.isFinite(v)) || String(phys.state || "").trim() !== "";
    if (!hasAny) continue;
    countedN += 1;
    const state = String(phys.state || "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
    stateCounts[state] = (stateCounts[state] || 0) + 1;
    if (Number.isFinite(phys.entropy)) {
      sums.entropy += phys.entropy;
      counts.entropy += 1;
    }
    if (Number.isFinite(phys.coherence)) {
      sums.coherence += phys.coherence;
      counts.coherence += 1;
    }
    if (Number.isFinite(phys.transitionRisk)) {
      sums.transitionRisk += phys.transitionRisk;
      counts.transitionRisk += 1;
    }
    if (Number.isFinite(phys.fieldAlignment)) {
      sums.fieldAlignment += phys.fieldAlignment;
      counts.fieldAlignment += 1;
    }
    if (Number.isFinite(phys.domainWallDensity)) {
      sums.domainWallDensity += phys.domainWallDensity;
      counts.domainWallDensity += 1;
    }
    if (Number.isFinite(phys.susceptibility)) {
      sums.susceptibility += phys.susceptibility;
      counts.susceptibility += 1;
    }
    if (Number.isFinite(phys.freeEnergy)) {
      sums.freeEnergy += phys.freeEnergy;
      counts.freeEnergy += 1;
    }
  }
  const averages = {
    entropy: counts.entropy > 0 ? (sums.entropy / counts.entropy) : null,
    coherence: counts.coherence > 0 ? (sums.coherence / counts.coherence) : null,
    transitionRisk: counts.transitionRisk > 0 ? (sums.transitionRisk / counts.transitionRisk) : null,
    fieldAlignment: counts.fieldAlignment > 0 ? (sums.fieldAlignment / counts.fieldAlignment) : null,
    domainWallDensity: counts.domainWallDensity > 0 ? (sums.domainWallDensity / counts.domainWallDensity) : null,
    susceptibility: counts.susceptibility > 0 ? (sums.susceptibility / counts.susceptibility) : null,
    freeEnergy: counts.freeEnergy > 0 ? (sums.freeEnergy / counts.freeEnergy) : null,
  };
  const aggregate = resolveStatPhysFeatures({
    sp_entropy_score: averages.entropy,
    sp_coherence_score: averages.coherence,
    sp_transition_risk: averages.transitionRisk,
    sp_field_alignment: averages.fieldAlignment,
    sp_domain_wall_density: averages.domainWallDensity,
    sp_susceptibility: averages.susceptibility,
    sp_free_energy: averages.freeEnergy,
  });
  return {
    sampled_n: Array.isArray(rows) ? rows.length : 0,
    counted_n: countedN,
    state: aggregate.state || null,
    display_state: aggregate.display_state,
    state_counts: stateCounts,
    critical_rate: countedN > 0 ? ((stateCounts.CRITICAL || 0) / countedN) : null,
    disordered_rate: countedN > 0 ? ((stateCounts.DISORDERED || 0) / countedN) : null,
    ordered_rate: countedN > 0 ? ((stateCounts.ORDERED || 0) / countedN) : null,
    mixed_rate: countedN > 0 ? ((stateCounts.MIXED || 0) / countedN) : null,
    entropy: averages.entropy,
    coherence: averages.coherence,
    transition_risk: averages.transitionRisk,
    field_alignment: averages.fieldAlignment,
    domain_wall_density: averages.domainWallDensity,
    susceptibility: averages.susceptibility,
    free_energy: averages.freeEnergy,
  };
}

async function main() {
  const meta = nowKstMeta();
  await ensureExchangeApiKeys("BINANCEFUT");
  const sinceMs = meta.nowMs - (90 * 60 * 1000);
  const ops = require("./lib/automation-utils").readJsonSafe(path.join(OPS_DAILY_DIR, "system_ops_check_latest.json"), {});
  const align = require("./lib/automation-utils").readJsonSafe(path.join(OPS_DAILY_DIR, "strategy_id_alignment_latest.json"), {});

  const [integrity, signals, dropped, gates, intents] = await Promise.all([
    auditBinanceExitIntegrity({ includeFlat: false }),
    readRecentCollection("signals"),
    readRecentCollection("signals_dropped"),
    readRecentCollection("gate_events"),
    readRecentCollection("order_intents_paper"),
  ]);

  const recentSignals = getRecent(signals, sinceMs);
  const recentDropped = getRecent(dropped, sinceMs);
  const recentGates = getRecent(gates, sinceMs);
  const recentIntents = getRecent(intents, sinceMs);
  const signalPhysics = summarizePhysics(recentSignals);
  const dropPhysics = summarizePhysics(recentDropped);

  const gatePass = recentGates.filter((row) => String(row.status || "").toUpperCase() === "PASS").length;
  const gateFail = recentGates.filter((row) => String(row.status || "").toUpperCase() !== "PASS").length;
  const intentFailures = recentIntents.filter((row) => {
    const status = String(row.status || "").toUpperCase();
    const reason = String(row.status_reason || row.cancel_reason || "").toUpperCase();
    return status === "CANCELED" || reason.includes("FAILED") || reason.includes("EXCEPTION");
  });
  const staleOnly = recentSignals.filter((row) => String(row.reason || "").includes("PINE_DROP_STALE_POS_TO_ENTRY")).length;

  const lifecycleFailures = readCloudLogMatches('(textPayload:\"SIGNAL_LIFECYCLE_ALERT_SEND_FAIL\" OR textPayload:\"SIGNAL_LIFECYCLE_ALERT_SKIP\")');
  const immediateProcess = readCloudLogMatches('textPayload:\"WEBHOOK_IMMEDIATE_PROCESS\"');
  const immediateFailures = (immediateProcess.rows || []).filter((row) => {
    const text = String(row.textPayload || row.jsonPayload?.message || "");
    return text.includes("WEBHOOK_IMMEDIATE_PROCESS") && !text.includes('"status":"OK"');
  });

  const findings = [];
  if (!integrity.ok || Number(integrity.issue_count || 0) > 0) {
    findings.push(`보호주문 무결성 이상 ${integrity.issue_count || 0}건`);
  }
  if (gatePass > 0 && (recentSignals.length + recentDropped.length) === 0) {
    findings.push(`게이트 PASS ${gatePass}건인데 저장 신호/드롭 기록 없음`);
  }
  if ((lifecycleFailures.rows || []).length > 0) {
    findings.push(`텔레그램 신호 알림 실패 또는 스킵 ${(lifecycleFailures.rows || []).length}건`);
  }
  if (immediateFailures.length > 0) {
    findings.push(`즉시 실행 실패 또는 비정상 종료 ${immediateFailures.length}건`);
  }
  if (intentFailures.length > 0) {
    findings.push(`최근 90분 주문 intent 실패 ${intentFailures.length}건`);
  }
  if (signalPhysics.counted_n >= 6 && Number(signalPhysics.critical_rate || 0) >= 0.30) {
    findings.push(`최근 90분 저장 신호 시장물리 CRITICAL 비중 ${pct(signalPhysics.critical_rate, 0)} (${signalPhysics.counted_n}건 기준)`);
  } else if (signalPhysics.counted_n >= 8 && Number(signalPhysics.disordered_rate || 0) >= 0.50) {
    findings.push(`최근 90분 저장 신호 시장물리 DISORDERED 비중 ${pct(signalPhysics.disordered_rate, 0)} (${signalPhysics.counted_n}건 기준)`);
  }
  if (dropPhysics.counted_n >= 6 && Number(dropPhysics.critical_rate || 0) >= 0.45) {
    findings.push(`최근 90분 드롭 시장물리 CRITICAL 비중 ${pct(dropPhysics.critical_rate, 0)} (${dropPhysics.counted_n}건 기준)`);
  } else if (dropPhysics.counted_n >= 8 && Number(dropPhysics.disordered_rate || 0) >= 0.60) {
    findings.push(`최근 90분 드롭 시장물리 DISORDERED 비중 ${pct(dropPhysics.disordered_rate, 0)} (${dropPhysics.counted_n}건 기준)`);
  }

  const status = findings.length ? (findings.some((line) => line.includes("보호주문")) ? "치명" : "주의") : "정상";
  const impact = findings.length
    ? (status === "치명" ? "실포지션 보호나 즉시 실행 경로에 영향 가능" : "신호 저장/알림/즉시 실행 품질에 영향 가능")
    : "즉시 조치가 필요한 운영 이상 없음";
  const action = findings.length
    ? (status === "치명"
      ? "보호주문 누락 또는 worker 경로를 우선 확인"
      : "최근 90분 신호/드롭/텔레그램/즉시실행 로그를 점검")
    : "없음";

  const report = {
    generated_at_kst: meta.kst,
    generated_at_ms: meta.nowMs,
    exchange: "BINANCEFUT",
    service: SERVICE,
    status,
    integrity,
    recent_counts: {
      signals: recentSignals.length,
      dropped: recentDropped.length,
      gate_pass: gatePass,
      gate_non_pass: gateFail,
      stale_reason_signals: staleOnly,
      intent_failures: intentFailures.length,
      lifecycle_failures: (lifecycleFailures.rows || []).length,
      immediate_process_failures: immediateFailures.length,
    },
    physics: {
      signals: signalPhysics,
      dropped: dropPhysics,
    },
    system_error_count_24h:
      Number.isFinite(Number(ops.error_count)) ? Number(ops.error_count)
        : (Number.isFinite(Number(align.conservative_metrics && align.conservative_metrics.error_count_24h))
          ? Number(align.conservative_metrics.error_count_24h)
          : null),
    findings,
    impact,
    action,
  };

  const baseName = `${meta.dateKey}_${meta.hhmm}_hourly_trading_guard`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${baseName}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "hourly_trading_guard_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "hourly_trading_guard_latest.md");
  writeJson(jsonPath, report);
  writeText(
    mdPath,
    [
      `# Trading Hourly Guard`,
      ``,
      `- 생성 시각: ${meta.kst}`,
      `- 상태: ${status}`,
      `- 최근 90분 신호: ${recentSignals.length}건 / 드롭: ${recentDropped.length}건 / Gate PASS: ${gatePass}건`,
      `- 시장물리(신호): ${signalPhysics.display_state || "정보 없음"} / critical ${pct(signalPhysics.critical_rate, 0)} / disorder ${pct(signalPhysics.disordered_rate, 0)} / free ${pct(signalPhysics.free_energy)}`,
      `- 시장물리(드롭): ${dropPhysics.display_state || "정보 없음"} / critical ${pct(dropPhysics.critical_rate, 0)} / disorder ${pct(dropPhysics.disordered_rate, 0)} / free ${pct(dropPhysics.free_energy)}`,
      `- 보호주문 감사: ok=${integrity.ok} / issue_count=${integrity.issue_count || 0}`,
      `- 핵심 발견:`,
      ...(findings.length ? findings.map((line) => `  - ${line}`) : ["  - 정상"]),
      `- 영향도: ${impact}`,
      `- 지금 필요한 조치: ${action}`,
      ``,
    ].join("\n")
  );
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);

  const alertResult = await sendKoreanTelegramSummary({
    title: `[시간별 운영 점검] ${status}`,
    severity: status === "치명" ? "WARN" : "INFO",
    sections: [
      {
        header: "현재 상태",
        lines: [
          findings.length ? findings[0] : "정상",
          `신호 ${recentSignals.length} / 드롭 ${recentDropped.length} / Gate PASS ${gatePass}`,
          `보호주문 이슈 ${integrity.issue_count || 0}건`,
          `시스템 오류 24h ${Number.isFinite(Number(report.system_error_count_24h)) ? Number(report.system_error_count_24h) : "N/A"}건`,
        ],
      },
      {
        header: "시장 물리",
        lines: [
          `신호 ${signalPhysics.display_state || "정보 없음"} / critical ${pct(signalPhysics.critical_rate, 0)} / disorder ${pct(signalPhysics.disordered_rate, 0)} / free ${pct(signalPhysics.free_energy)}`,
          `드롭 ${dropPhysics.display_state || "정보 없음"} / critical ${pct(dropPhysics.critical_rate, 0)} / disorder ${pct(dropPhysics.disordered_rate, 0)} / free ${pct(dropPhysics.free_energy)}`,
        ],
      },
      {
        header: "핵심",
        lines: findings.slice(1, 3).length ? findings.slice(1, 3) : ["즉시 이상 없음"],
      },
      { header: "조치", lines: [action] },
    ],
  });
  if (!alertResult || (alertResult.ok !== true && alertResult.skipped !== true)) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alertResult || {})}`);
  }

  console.log(JSON.stringify({ ok: true, status, jsonPath, mdPath, alert: alertResult }, null, 2));
}

main().catch((err) => {
  console.error("automation-hourly-guard failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
