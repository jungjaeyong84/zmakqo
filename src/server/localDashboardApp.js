const express = require("express");
const fs = require("fs");
const path = require("path");

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const OPS_RUNTIME_DIR = path.resolve(__dirname, "../../ops/runtime");
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const VIEWS_DIR = path.resolve(__dirname, "../views");

const PATHS = {
  bootstrap: path.join(OPS_DAILY_DIR, "v3_paper_bootstrap_latest.json"),
  lane: path.join(OPS_DAILY_DIR, "v3_paper_lane_latest.json"),
  entry: path.join(OPS_DAILY_DIR, "v3_paper_entry_ledger_latest.json"),
  exit: path.join(OPS_DAILY_DIR, "v3_paper_exit_ledger_latest.json"),
  performance: path.join(OPS_DAILY_DIR, "v3_paper_performance_latest.json"),
  validation: path.join(OPS_DAILY_DIR, "v3_paper_validation_latest.json"),
  cycleLog: path.join(OPS_RUNTIME_DIR, "v3_paper_cycle.out.log"),
  entryLedger: path.join(OPS_RUNTIME_DIR, "v3_paper_entry_ledger.jsonl"),
  exitLedger: path.join(OPS_RUNTIME_DIR, "v3_paper_exit_ledger.jsonl"),
};

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function readJsonLinesSafe(filePath, limit = 100) {
  try {
    return fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => String(line || "").trim())
      .filter(Boolean)
      .slice(limit * -1)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (_error) {
          return null;
        }
      })
      .filter((row) => row && typeof row === "object");
  } catch (_error) {
    return [];
  }
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value, digits = 0) {
  const num = asNumber(value);
  if (num === null) return "-";
  return num.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value, digits = 1) {
  const num = asNumber(value);
  if (num === null) return "-";
  return `${formatNumber(num, digits)}%`;
}

function formatR(value, digits = 2) {
  const num = asNumber(value);
  if (num === null) return "-";
  return `${num > 0 ? "+" : ""}${formatNumber(num, digits)}R`;
}

function formatPnlPercent(value, digits = 2) {
  const num = asNumber(value);
  if (num === null) return "-";
  return `${num > 0 ? "+" : ""}${formatNumber(num, digits)}%`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function formatAgo(value) {
  if (!value) return "-";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return "-";
  const diff = Date.now() - ms;
  if (diff < 0) return "방금";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "방금";
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function rankEntries(mapLike, limit = 5) {
  return Object.entries(mapLike || {})
    .map(([label, value]) => ({ label, value: Number(value || 0) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function buildExitBySignalId(exitLedgerRows = []) {
  const latestBySignalId = new Map();
  for (const row of Array.isArray(exitLedgerRows) ? exitLedgerRows : []) {
    const signalId = String(row && row.signal_id || "").trim();
    if (!signalId) continue;
    const closedAt = Date.parse(String(row && row.closed_at || ""));
    const previous = latestBySignalId.get(signalId);
    if (!previous || (Number.isFinite(closedAt) && closedAt >= previous.__closedAtMs)) {
      latestBySignalId.set(signalId, Object.freeze({
        ...row,
        __closedAtMs: Number.isFinite(closedAt) ? closedAt : 0,
      }));
    }
  }
  return latestBySignalId;
}

function buildRecentEntryFlow(entryLedgerRows = [], exitLedgerRows = [], limit = 6) {
  const exitBySignalId = buildExitBySignalId(exitLedgerRows);
  return entryLedgerRows
    .slice(limit * -1)
    .reverse()
    .map((entryRow) => {
      const signalId = String(entryRow && entryRow.signal_id || "").trim();
      const exitRow = signalId ? exitBySignalId.get(signalId) : null;
      const currentStatus = exitRow ? "CLOSED" : String(entryRow && entryRow.status || "").trim().toUpperCase() || "OPEN";
      const statusDetail = exitRow
        ? `${currentStatus} · ${String(exitRow.exit_event || "").trim() || "-"}`
        : currentStatus;
      return Object.freeze({
        ...entryRow,
        current_status: currentStatus,
        status_detail: statusDetail,
        closed_at: exitRow ? exitRow.closed_at || null : null,
        exit_event: exitRow ? exitRow.exit_event || null : null,
      });
    });
}

function toneByNumber(value) {
  const num = asNumber(value);
  if (num === null || num === 0) return "neutral";
  return num > 0 ? "up" : "down";
}

function validationLabel(value) {
  const code = String(value || "").toUpperCase();
  if (code === "READY_FOR_RUNTIME_LANE_REVIEW") return "검토 가능";
  if (code === "WAIT_LIVE_SEED_MIX_EXPANSION") return "live seed 확장";
  if (code === "WAIT_PAPER_SAMPLE_ACCUMULATION") return "paper 누적 중";
  if (code === "PAPER_SAMPLE_FAILS_QUALITY") return "품질 미달";
  if (code === "WAIT_BOOTSTRAP_EXPANSION") return "표본 부족";
  return code || "확인 중";
}

function computeHealth(latestCycle, recentSteps) {
  if (!latestCycle) {
    return {
      tone: "warn",
      label: "데이터 없음",
      detail: "v3 paper cycle 완료 로그를 아직 찾지 못했습니다.",
    };
  }
  const lastTs = Date.parse(String(latestCycle.ts || ""));
  const ageMinutes = Number.isFinite(lastTs) ? (Date.now() - lastTs) / 60000 : null;
  const failedStep = (recentSteps || []).find((row) => Number(row && row.rc) !== 0);
  if (failedStep) {
    return {
      tone: "bad",
      label: "사이클 오류",
      detail: `${failedStep.step || "step"} 단계 rc=${failedStep.rc}`,
    };
  }
  if (ageMinutes !== null && ageMinutes > 10) {
    return {
      tone: "warn",
      label: "갱신 지연",
      detail: `마지막 완료 ${Math.round(ageMinutes)}분 전`,
    };
  }
  return {
    tone: "ok",
    label: "정상",
    detail: `마지막 완료 ${formatAgo(latestCycle.ts)}`,
  };
}

function buildLocalDashboardView() {
  const bootstrap = readJsonSafe(PATHS.bootstrap, {});
  const lane = readJsonSafe(PATHS.lane, {});
  const entry = readJsonSafe(PATHS.entry, {});
  const exit = readJsonSafe(PATHS.exit, {});
  const performance = readJsonSafe(PATHS.performance, {});
  const validation = readJsonSafe(PATHS.validation, {});
  const cycleRows = readJsonLinesSafe(PATHS.cycleLog, 80);
  const entryLedgerRows = readJsonLinesSafe(PATHS.entryLedger, 20);
  const exitLedgerRows = readJsonLinesSafe(PATHS.exitLedger, 20);

  const recentSteps = cycleRows.filter((row) => row && row.step).slice(-8);
  const latestCycle = [...cycleRows].reverse().find((row) => row && row.event === "V3_PAPER_CYCLE_DONE") || null;
  const health = computeHealth(latestCycle, recentSteps);

  const overviewCards = [
    {
      label: "런타임 상태",
      value: health.label,
      note: (validation && validation.recommendation_text) || health.detail,
      tone: health.tone,
    },
    {
      label: "허용 승률",
      value: formatPercent(bootstrap.retained_metrics && bootstrap.retained_metrics.win_rate_pct, 2),
      note: `${formatNumber(bootstrap.retained_sample_n)} samples`,
      tone: (bootstrap.target_hit ? "up" : "neutral"),
    },
    {
      label: "기대값",
      value: formatNumber(bootstrap.retained_metrics && bootstrap.retained_metrics.expectancy_usdt, 4),
      note: "USDT / trade",
      tone: toneByNumber(bootstrap.retained_metrics && bootstrap.retained_metrics.expectancy_usdt),
    },
    {
      label: "오늘 종료",
      value: formatNumber(performance.today_closed_trade_n),
      note: `Net ${formatR(performance.today_metrics_r && performance.today_metrics_r.net, 2)}`,
      tone: toneByNumber(performance.today_metrics_r && performance.today_metrics_r.net),
    },
  ];

  const pipeline = [
    {
      label: "신호 필터",
      updatedAt: lane.generated_at,
      primary: `${formatNumber(lane.allowed_signal_n)} 허용`,
      secondary: `${formatNumber(lane.blocked_signal_n)} 차단`,
    },
    {
      label: "진입 원장",
      updatedAt: entry.generated_at,
      primary: `${formatNumber(entry.open_position_n)} 보유`,
      secondary: `${formatNumber(entry.appended_entry_n)} 신규`,
    },
    {
      label: "청산 원장",
      updatedAt: exit.generated_at,
      primary: `${formatNumber(exit.appended_exit_n)} 청산`,
      secondary: `${formatNumber(exit.remaining_open_position_n)} 잔여`,
    },
    {
      label: "성과 집계",
      updatedAt: performance.generated_at,
      primary: `${formatPercent(performance.all_time_metrics_r && performance.all_time_metrics_r.win_rate_pct, 1)} 승률`,
      secondary: `${formatR(performance.all_time_metrics_r && performance.all_time_metrics_r.expectancy, 2)} 기대값`,
    },
  ];

  const retainedMetrics = bootstrap.retained_metrics || {};
  const baselineMetrics = bootstrap.baseline_metrics || {};
  const topCohorts = Array.isArray(bootstrap.retained_top_cohorts) ? bootstrap.retained_top_cohorts.slice(0, 4) : [];
  const blockedReasons = rankEntries(lane.blocked_reason_counts, 5);
  const removedReasons = rankEntries(bootstrap.removed_reason_counts, 5);
  const openPositions = Array.isArray(performance.open_positions) ? performance.open_positions.slice(0, 6) : [];
  const recentExits = Array.isArray(performance.recent_exits)
    ? performance.recent_exits.slice(0, 6)
    : exitLedgerRows.slice(-6).reverse();
  const recentEntries = buildRecentEntryFlow(entryLedgerRows, exitLedgerRows, 6);

  const validationBootstrapGate = validation.bootstrap_gate || {};
  const validationPaperGate = validation.paper_gate || {};
  const validationSummary = Array.isArray(validation.summary_lines) ? validation.summary_lines : [];
  const validationReadiness = String(validation.readiness || "WAIT_BOOTSTRAP_EXPANSION").toUpperCase();

  pipeline.push({
    label: "표본 검증",
    updatedAt: validation.generated_at,
    primary: validationLabel(validationReadiness),
    secondary: `bootstrap ${Number(validationBootstrapGate.remaining_to_min_n || 0)} / paper ${Number(validationPaperGate.remaining_to_min_n || 0)}`,
  });

  return {
    generatedAt: new Date().toISOString(),
    header: {
      title: "DONBEOLJA 로컬 대시보드",
      subtitle: "로컬 v3 paper runtime만 단순하게 본다.",
      refreshNote: "45초 자동 새로고침",
    },
    health,
    overviewCards,
    validation: {
      readiness: validationReadiness,
      readinessLabel: validationLabel(validationReadiness),
      recommendationText: String(validation.recommendation_text || "validation 데이터를 계산 중입니다."),
      bootstrapGate: validationBootstrapGate,
      paperGate: validationPaperGate,
      summaryLines: validationSummary,
    },
    snapshot: {
      recommendation: String(bootstrap.recommendation || "NO_DATA").toUpperCase(),
      targetHit: Boolean(bootstrap.target_hit),
      latestCycleAt: latestCycle && latestCycle.ts ? latestCycle.ts : null,
      strategyId: bootstrap.strategy_id || "-",
    },
    pipeline,
    bootstrap: {
      generatedAt: bootstrap.generated_at || null,
      retained: {
        sampleN: formatNumber(retainedMetrics.sample_n),
        winRate: formatPercent(retainedMetrics.win_rate_pct, 2),
        expectancy: formatNumber(retainedMetrics.expectancy_usdt, 4),
        profitFactor: formatNumber(retainedMetrics.profit_factor, 2),
        netPnl: formatNumber(retainedMetrics.net_pnl_usdt, 4),
      },
      baseline: {
        sampleN: formatNumber(baselineMetrics.sample_n),
        winRate: formatPercent(baselineMetrics.win_rate_pct, 2),
        expectancy: formatNumber(baselineMetrics.expectancy_usdt, 4),
        profitFactor: formatNumber(baselineMetrics.profit_factor, 2),
        netPnl: formatNumber(baselineMetrics.net_pnl_usdt, 4),
      },
      topCohorts,
      removedReasons,
    },
    flow: {
      allowedSignals: formatNumber(lane.allowed_signal_n),
      blockedSignals: formatNumber(lane.blocked_signal_n),
      openPositions: formatNumber(entry.open_position_n),
      recentEntries,
      blockedReasons,
    },
    performance: {
      generatedAt: performance.generated_at || null,
      today: {
        trades: formatNumber(performance.today_closed_trade_n),
        winRate: formatPercent(performance.today_metrics_r && performance.today_metrics_r.win_rate_pct, 1),
        netR: formatR(performance.today_metrics_r && performance.today_metrics_r.net, 2),
      },
      allTime: {
        trades: formatNumber(performance.all_time_metrics_r && performance.all_time_metrics_r.sample_n),
        winRate: formatPercent(performance.all_time_metrics_r && performance.all_time_metrics_r.win_rate_pct, 1),
        expectancy: formatR(performance.all_time_metrics_r && performance.all_time_metrics_r.expectancy, 2),
      },
      openPositions,
      recentExits,
    },
    cycle: {
      latestCycle,
      recentSteps,
    },
    helpers: {
      formatDateTime,
      formatAgo,
      formatPnlPercent,
      formatR,
      formatPercent,
      toneByNumber,
    },
  };
}

function createLocalDashboardApp() {
  const app = express();
  app.set("views", VIEWS_DIR);
  app.set("view engine", "ejs");
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: "5m" }));

  app.get("/healthz", (_req, res) => {
    return res.json({ ok: true, mode: "desktop-local-dashboard" });
  });

  app.get("/api/local-dashboard", (_req, res) => {
    return res.json({ ok: true, data: buildLocalDashboardView() });
  });

  app.get(["/", "/dashboard/home"], (_req, res) => {
    return res.render("local-dashboard-clean", buildLocalDashboardView());
  });

  app.use((_req, res) => {
    return res.redirect("/dashboard/home");
  });

  return app;
}

module.exports = {
  createApp: createLocalDashboardApp,
  createLocalDashboardApp,
  buildLocalDashboardView,
  __test: {
    buildExitBySignalId,
    buildRecentEntryFlow,
  },
};
