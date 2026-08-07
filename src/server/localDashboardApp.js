const express = require("express");
const fs = require("fs");
const path = require("path");

// 2026-08-07 — rewritten for the post-v3 system.
//
// This dashboard used to read the v3 paper lane and nothing else. That lane
// was retired: the book ran 64% short and weekly win rate regressed on BTC's
// weekly return at R2 = 0.705, so its "edge" was market beta. Its artifacts
// are still on disk but frozen, and a dashboard that keeps rendering frozen
// numbers as if they were live is worse than one that shows nothing — it
// invites decisions from stale data.
//
// So the page now shows the lanes that are ACTUALLY RUNNING, and shows the
// retired one explicitly labelled as retired, with the number that killed it.
//
// Live lanes:
//   funding carry  — the only mechanism that survived every control. Contractual
//                    income, not prediction. Currently dormant by design.
//   v4 paper       — cross-sectional, accumulating toward 90-day criteria.
//   v5 flow        — banks the 30-day /futures/data window so history can grow.
//   infrastructure — deadman heartbeats, ledger backups.

const OPS_DAILY_DIR = path.resolve(__dirname, "../../ops/daily");
const OPS_BACKUP_DIR = path.resolve(__dirname, "../../ops/backup");
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const VIEWS_DIR = path.resolve(__dirname, "../views");

const PATHS = {
  funding: path.join(OPS_DAILY_DIR, "v3_funding_monitor_latest.json"),
  v4perf: path.join(OPS_DAILY_DIR, "v4_paper_performance_latest.json"),
  v4lane: path.join(OPS_DAILY_DIR, "v4_paper_latest.json"),
  flow: path.join(OPS_DAILY_DIR, "v5_flow_collector_latest.json"),
  deadman: path.join(OPS_DAILY_DIR, "v3_deadman_latest.json"),
  // retired, rendered as history only
  v3perf: path.join(OPS_DAILY_DIR, "v3_paper_performance_latest.json"),
  v3validation: path.join(OPS_DAILY_DIR, "v3_paper_validation_latest.json"),
};

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function asNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatNumber(value, digits = 0) {
  const num = asNumber(value);
  if (num === null) return "-";
  return num.toLocaleString("ko-KR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value, digits = 2) {
  const num = asNumber(value);
  if (num === null) return "-";
  return `${formatNumber(num, digits)}%`;
}

function formatSigned(value, digits = 2, suffix = "%p") {
  const num = asNumber(value);
  if (num === null) return "-";
  return `${num > 0 ? "+" : ""}${formatNumber(num, digits)}${suffix}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms)) return String(value);
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
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

function toneByNumber(value) {
  const num = asNumber(value);
  if (num === null || num === 0) return "neutral";
  return num > 0 ? "up" : "down";
}

// Health comes from the deadman rather than from any single lane's log: it is
// the one artifact whose whole job is knowing whether the others are alive.
function computeHealth(deadman) {
  if (!deadman || !Array.isArray(deadman.healthy)) {
    return { tone: "warn", label: "확인 불가", detail: "데드맨 아티팩트를 읽지 못했습니다." };
  }
  const stale = Array.isArray(deadman.stale) ? deadman.stale : [];
  if (stale.length) {
    return {
      tone: "bad",
      label: `${stale.length}개 심박 정지`,
      detail: stale.map((s) => s.name).join(", "),
    };
  }
  return {
    tone: "ok",
    label: "정상",
    detail: `${deadman.healthy.length}개 레인 심박 확인 · ${formatAgo(deadman.generated_at)}`,
  };
}

function backupSummary() {
  try {
    const files = fs.readdirSync(OPS_BACKUP_DIR)
      .filter((f) => f.endsWith(".tar.gz"))
      .map((f) => ({ f, t: fs.statSync(path.join(OPS_BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!files.length) return { count: 0, latestAt: null, latestName: null };
    return { count: files.length, latestAt: new Date(files[0].t).toISOString(), latestName: files[0].f };
  } catch (_error) {
    return { count: 0, latestAt: null, latestName: null };
  }
}

function buildCarryLane(funding) {
  const menu = (funding && funding.carry_menu) || {};
  const verdict = String(menu.verdict || "NO_DATA").toUpperCase();
  const sources = Array.isArray(menu.sources) ? menu.sources : [];
  const hot = Array.isArray(funding && funding.hot) ? funding.hot : [];
  const perSymbol = Object.entries((funding && funding.per_symbol) || {})
    .map(([symbol, d]) => ({
      symbol,
      apyPct: asNumber(d && d.apy_pct),
      events: asNumber(d && d.events),
      negativeEvents: asNumber(d && d.negative_events),
    }))
    .sort((a, b) => (b.apyPct || 0) - (a.apyPct || 0));

  // Lookup keyed by kind|symbol over EVERY source, not a truncated slice — an
  // earlier version sliced to 6 and silently dropped XRP's excess, which then
  // rendered as "-" as if the number did not exist.
  const bySymbol = new Map();
  for (const s of sources) bySymbol.set(`${s.kind}|${s.symbol}`, s);

  // The menu carries two distinct carry mechanisms and they are NOT
  // interchangeable: funding is perpetual and re-prices every 8h, while basis
  // is a dated future that converges at delivery by arbitrage. Showing only
  // funding hid four real sources.
  const fundingSources = sources.filter((s) => s.kind === "funding");
  const basisSources = sources.filter((s) => s.kind === "basis");

  return {
    generatedAt: (funding && funding.generated_at) || null,
    verdict,
    verdictLabel: verdict === "HOLD_RISK_FREE" ? "대기 — 무위험 보유"
      : verdict === "HARVEST" ? "수확 가능"
        : verdict,
    // dormant is the CORRECT state when carry is thin; it is not a failure
    isDormant: verdict === "HOLD_RISK_FREE",
    alertApyPct: asNumber(funding && funding.alert_apy_pct),
    windowDays: asNumber(funding && funding.window_days),
    best: sources.length ? sources[0] : null,
    sources,
    fundingSources,
    basisSources,
    excessFor: (kind, symbol) => bySymbol.get(`${kind}|${symbol}`) || null,
    hot,
    perSymbol,
  };
}

function buildV4Lane(v4perf) {
  const variants = Object.entries((v4perf && v4perf.variants) || {}).map(([name, s]) => ({
    name,
    days: asNumber(s.days),
    annPct: asNumber(s.ann_return_pct_maker),
    excessPct: asNumber(s.excess_return_pct),
    excessSharpe: asNumber(s.excess_sharpe),
    volPct: asNumber(s.annualized_vol_pct),
    maxDdPct: asNumber(s.max_drawdown_pct),
    equity: asNumber(s.equity_maker),
    verdict: String(s.verdict || "-"),
  }));
  const criteria = (v4perf && v4perf.criteria) || {};
  const minDays = asNumber(criteria.min_days) || 90;
  const days = variants.length ? Math.max(...variants.map((v) => v.days || 0)) : 0;
  return {
    generatedAt: (v4perf && v4perf.generated_at) || null,
    variants,
    criteria,
    days,
    minDays,
    progressPct: Math.min(100, Math.round((days / minDays) * 100)),
  };
}

function buildFlowLane(flow) {
  return {
    generatedAt: (flow && flow.generated_at) || null,
    rowsTotal: asNumber(flow && flow.rows_total),
    rowsAppended: asNumber(flow && flow.rows_appended),
    symbols: asNumber(flow && flow.symbols),
    bankedSpanDays: asNumber(flow && flow.banked_span_days),
    earliest: (flow && flow.earliest) || null,
    latest: (flow && flow.latest) || null,
    failures: Array.isArray(flow && flow.failures) ? flow.failures : [],
    // the API only ever serves ~30d; anything past that exists solely because
    // this collector wrote it down
    apiHorizonDays: 30,
  };
}

function buildLocalDashboardView() {
  const funding = readJsonSafe(PATHS.funding, {});
  const v4perf = readJsonSafe(PATHS.v4perf, {});
  const flow = readJsonSafe(PATHS.flow, {});
  const deadman = readJsonSafe(PATHS.deadman, {});
  const v3perf = readJsonSafe(PATHS.v3perf, {});
  const v3validation = readJsonSafe(PATHS.v3validation, {});

  const health = computeHealth(deadman);
  const carry = buildCarryLane(funding);
  const v4 = buildV4Lane(v4perf);
  const flowLane = buildFlowLane(flow);
  const backup = backupSummary();

  const overviewCards = [
    {
      label: "시스템 상태",
      value: health.label,
      note: health.detail,
      tone: health.tone,
    },
    {
      label: "캐리 판정",
      value: carry.verdictLabel,
      note: carry.best
        ? `최고 ${carry.best.symbol} ${formatPercent(carry.best.annualized_net_pct)} (무위험 대비 ${formatSigned(carry.best.excess_pct)})`
        : "캐리 데이터 없음",
      tone: carry.isDormant ? "neutral" : "up",
    },
    {
      label: "실거래 노출",
      value: "0 USDT",
      note: "전 레인 페이퍼 · 주문 경로 없음",
      tone: "ok",
    },
    {
      label: "flow 데이터 확보",
      value: `${formatNumber(flowLane.bankedSpanDays, 0)}일`,
      note: `API는 ${flowLane.apiHorizonDays}일까지만 제공 · ${formatNumber(flowLane.rowsTotal)}행`,
      tone: (flowLane.bankedSpanDays || 0) > flowLane.apiHorizonDays ? "up" : "neutral",
    },
  ];

  const lanes = [
    {
      key: "carry",
      label: "펀딩 캐리",
      role: "주력",
      state: carry.isDormant ? "대기 중" : "수확 가능",
      updatedAt: carry.generatedAt,
      note: "계약상 수령 — 예측 불필요",
      tone: carry.isDormant ? "neutral" : "up",
    },
    {
      key: "v4",
      label: "v4 크로스섹셔널",
      role: "관찰",
      state: `${formatNumber(v4.days)}일 / ${formatNumber(v4.minDays)}일`,
      updatedAt: v4.generatedAt,
      note: "시장중립 · 90일 기준 누적 중",
      tone: "neutral",
    },
    {
      key: "flow",
      label: "v5 flow 수집기",
      role: "데이터",
      state: `${formatNumber(flowLane.bankedSpanDays, 0)}일 확보`,
      updatedAt: flowLane.generatedAt,
      note: "백필 불가 — 멈추면 영구 손실",
      tone: flowLane.failures.length ? "warn" : "ok",
    },
    {
      key: "infra",
      label: "인프라",
      role: "보호",
      state: `백업 ${formatNumber(backup.count)}개`,
      updatedAt: backup.latestAt,
      note: `데드맨 ${(deadman.healthy || []).length}개 감시`,
      tone: "ok",
    },
  ];

  const v3paperGate = (v3validation && v3validation.paper_gate) || {};
  const retired = {
    label: "v3 방향성 레인",
    retiredOn: "2026-08-07",
    reason: "주간 승률의 71%를 BTC 방향이 설명 (R2=0.705). 우위가 아니라 시장 베타였음.",
    finalTrades: asNumber(v3paperGate.closed_trade_n),
    finalWinRate: asNumber(v3paperGate.win_rate_pct),
    finalExpectancyR: asNumber(v3paperGate.expectancy_r),
    finalGrossExpectancyR: asNumber(v3paperGate.gross_expectancy_r),
    lastUpdated: (v3perf && v3perf.generated_at) || null,
  };

  return {
    generatedAt: new Date().toISOString(),
    header: {
      title: "DONBEOLJA",
      subtitle: "현재 가동 중인 레인만 표시합니다.",
      refreshNote: "60초 자동 새로고침",
    },
    health,
    overviewCards,
    lanes,
    carry,
    v4,
    flow: flowLane,
    deadman: {
      generatedAt: (deadman && deadman.generated_at) || null,
      healthy: Array.isArray(deadman.healthy) ? deadman.healthy : [],
      stale: Array.isArray(deadman.stale) ? deadman.stale : [],
    },
    backup,
    retired,
    helpers: { formatDateTime, formatAgo, formatNumber, formatPercent, formatSigned, toneByNumber },
  };
}

function createLocalDashboardApp() {
  const app = express();
  app.set("views", VIEWS_DIR);
  app.set("view engine", "ejs");
  app.use(express.static(PUBLIC_DIR, { index: false, maxAge: "5m" }));

  app.get("/healthz", (_req, res) => res.json({ ok: true, mode: "desktop-local-dashboard" }));

  app.get("/api/local-dashboard", (_req, res) => res.json({ ok: true, data: buildLocalDashboardView() }));

  app.get(["/", "/dashboard/home"], (_req, res) => res.render("local-dashboard-clean", buildLocalDashboardView()));

  app.use((_req, res) => res.redirect("/dashboard/home"));

  return app;
}

module.exports = {
  createApp: createLocalDashboardApp,
  createLocalDashboardApp,
  buildLocalDashboardView,
  __test: {
    computeHealth,
    buildCarryLane,
    buildV4Lane,
    buildFlowLane,
  },
};
