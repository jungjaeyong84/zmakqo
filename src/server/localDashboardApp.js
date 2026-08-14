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

const OPS_RUNTIME_DIR = path.resolve(__dirname, "../../ops/runtime");

const PATHS = {
  v6: path.join(OPS_DAILY_DIR, "v6_paper_latest.json"),
  v6Ledger: path.join(OPS_RUNTIME_DIR, "v6_paper_ledger.jsonl"),
  funding: path.join(OPS_DAILY_DIR, "v3_funding_monitor_latest.json"),
  v4perf: path.join(OPS_DAILY_DIR, "v4_paper_performance_latest.json"),
  flow: path.join(OPS_DAILY_DIR, "v5_flow_collector_latest.json"),
  deadman: path.join(OPS_DAILY_DIR, "v3_deadman_latest.json"),
};

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

// The v6 ledger is append-only: a position is written OPEN, then written again
// CLOSED under the SAME id. Reading it naively double-counts every settled
// trade — once as open, once as closed. Latest row per id wins.
function readJsonLines(filePath) {
  let raw;
  try { raw = fs.readFileSync(filePath, "utf8"); } catch (_error) { return []; }
  const latest = new Map();
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.id) latest.set(row.id, row);
    } catch (_error) { /* a torn final line must not blank the page */ }
  }
  return [...latest.values()];
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

// Prices span six orders of magnitude across this universe (BTC ~64000,
// GALA ~0.0017). A fixed decimal count collapses the low end: GALA's take
// profit 0.001725 and stop 0.001662 BOTH render as "0.0017" at four places,
// so the two brackets look identical on screen. Scale the precision to the
// magnitude instead — enough significant digits that a 1.25% move is always
// visible.
function formatPrice(value) {
  const num = asNumber(value);
  if (num === null) return "-";
  const abs = Math.abs(num);
  if (abs === 0) return "0";
  const decimals = abs >= 1000 ? 2 : abs >= 1 ? 4 : Math.min(12, Math.ceil(-Math.log10(abs)) + 4);
  return num.toLocaleString("ko-KR", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
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

// The page had six sections and long explanatory prose. That is fine for an
// audit trail and wrong for a thing you glance at. This build puts the ONE
// lane under active test at the top at full size, compresses everything else
// to a single line each, and drops the retired-v3 history entirely — it is in
// git and in the commit messages, not something to re-read daily.
function buildV6Lane(v6, ledgerRows) {
  const r = (v6 && v6.realised) || null;
  const cfg = (v6 && v6.config) || {};
  const bt = (v6 && v6.backtest_expectation) || {};
  const minN = Number(v6 && v6.min_closed_for_verdict) || 100;
  const closed = Number(v6 && v6.closed_n) || 0;

  const open = ledgerRows.filter((x) => x.status === "OPEN")
    .sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))
    .slice(0, 8);
  const recent = ledgerRows.filter((x) => x.status === "CLOSED")
    .sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at))
    .slice(0, 8);

  const verdict = String((v6 && v6.verdict) || "NO_DATA");
  const label = verdict === "ACCUMULATING" ? "표본 쌓는 중"
    : verdict === "POSITIVE_SIGNIFICANT" ? "유의하게 플러스"
      : verdict === "POSITIVE_NOT_SIGNIFICANT" ? "플러스지만 유의하지 않음"
        : verdict === "NEGATIVE" ? "마이너스" : verdict;

  return {
    generatedAt: (v6 && v6.generated_at) || null,
    config: cfg,
    daysRunning: Number(v6 && v6.days_running) || 0,
    openN: Number(v6 && v6.open_n) || 0,
    closedN: closed,
    minN,
    progressPct: Math.min(100, Math.round((closed / minN) * 100)),
    verdict,
    verdictLabel: label,
    tone: verdict === "POSITIVE_SIGNIFICANT" ? "up" : verdict === "NEGATIVE" ? "down" : "neutral",
    realised: r,
    leverage: asNumber(cfg.leverage),
    caps: (v6 && v6.caps) || null,
    // Segmented by selection policy: the pre-cap sample must not silently
    // drive the verdict once caps exist.
    byPolicy: Array.isArray(v6 && v6.by_policy) ? v6.by_policy.filter((p) => p.closed_n > 0) : [],
    policyVersion: asNumber(v6 && v6.policy_version),
    costScenarios: Array.isArray(v6 && v6.cost_scenarios) ? v6.cost_scenarios : [],
    breakevenFillRate: v6 && v6.breakeven_fill_rate !== undefined ? v6.breakeven_fill_rate : undefined,
    sampleReq: (v6 && v6.sample_requirement) || null,
    tpPct: asNumber(cfg.tp_equity_pct),
    slPct: asNumber(cfg.sl_equity_pct),
    // the backtest number is carried so drift shows in BOTH directions
    expectedAnnPct: asNumber(bt.out_of_sample_ann_pct),
    // t, not the return: see the template comment. The return reads as a
    // forecast; the t-stat is what actually bounds the claim.
    expectedT: asNumber(bt.out_of_sample_t),
    expectedNote: bt.note || null,
    open,
    recent,
    errors: Array.isArray(v6 && v6.errors) ? v6.errors : [],
  };
}

function buildLocalDashboardView() {
  const v6 = readJsonSafe(PATHS.v6, {});
  const funding = readJsonSafe(PATHS.funding, {});
  const v4perf = readJsonSafe(PATHS.v4perf, {});
  const flow = readJsonSafe(PATHS.flow, {});
  const deadman = readJsonSafe(PATHS.deadman, {});

  const health = computeHealth(deadman);
  const carry = buildCarryLane(funding);
  const v4 = buildV4Lane(v4perf);
  const flowLane = buildFlowLane(flow);
  const backup = backupSummary();
  const v6Lane = buildV6Lane(v6, readJsonLines(PATHS.v6Ledger));

  // One status strip, four facts, no prose.
  const strip = [
    { label: "시스템", value: health.label, tone: health.tone },
    { label: "실거래", value: "0원", tone: "ok" },
    { label: "캐리", value: carry.isDormant ? "대기" : "수확 가능", tone: carry.isDormant ? "neutral" : "up" },
    { label: "데이터", value: `${formatNumber(flowLane.bankedSpanDays, 0)}일`, tone: "neutral" },
  ];

  // Everything that is not the lane under test gets one line.
  const others = [
    { name: "v4 크로스섹셔널", state: `${formatNumber(v4.days)}일 / ${formatNumber(v4.minDays)}일`, note: "시장중립 · 누적 중", at: v4.generatedAt },
    { name: "펀딩 캐리", state: carry.best ? `최고 ${formatSigned(carry.best.excess_pct)}` : "-", note: carry.isDormant ? "무위험 대비 미달 → 대기" : "수확 조건 충족", at: carry.generatedAt },
    { name: "flow 수집기", state: `${formatNumber(flowLane.bankedSpanDays, 0)}일 확보`, note: "백필 불가 · 하루 2회", at: flowLane.generatedAt },
    { name: "백업 · 데드맨", state: `${formatNumber(backup.count)}개 · ${(deadman.healthy || []).length}개 감시`, note: (deadman.stale || []).length ? "심박 정지 있음" : "이상 없음", at: backup.latestAt },
  ];

  return {
    generatedAt: new Date().toISOString(),
    header: { title: "DONBEOLJA", refreshNote: "60초 자동 새로고침" },
    health,
    strip,
    v6: v6Lane,
    others,
    helpers: { formatDateTime, formatAgo, formatNumber, formatPercent, formatSigned, formatPrice },
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
    buildV6Lane,
  },
};
