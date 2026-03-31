// src/server/app.js
const express = require("express");
const session = require("express-session");
const passport = require("passport");
const path = require("path");

const healthRoutes = require("../routes/health.routes");
const dataRoutes = require("../routes/data.routes");
const debugRoutes = require("../routes/debug.routes");
const authRoutes = require("../routes/auth.routes");
const uiRoutes = require("../routes/ui.routes");
const createWebhookRoutes = require("../routes/webhook.routes");

const reportRoutes = require("../routes/report.routes");
const reportPreviewRoutes = require("../routes/report.preview.routes");
const reportLatestRoutes = require("../routes/report.latest.routes");
const reportPackRoutes = require("../routes/report.pack.routes");
const reportPackV4Routes = require("../routes/report.pack.v4.routes");
const reportPackV4PlusRoutes = require("../routes/report.pack.v4plus.routes");
const improvementPackRoutes = require("../routes/report.improvement-pack.routes");
const reportInterpretRoutes = require("../routes/report.interpret.routes");

const settingsRoutes = require("../routes/settings.routes");
const auditRoutes = require("../routes/audit.routes");

const createPipelineRoutes = require("../routes/pipeline.routes");
const createSystemRoutes = require("../routes/system.routes");
const createSchedulerRoutes = require("../routes/scheduler.routes");
const schedulerReportRoutes = require("../routes/scheduler.report.routes");
const createDashboardRoutes = require("../routes/dashboard.routes");
const createPricesRoutes = require("../routes/prices.routes");
const accountRoutes = require("../routes/account.routes");
const createStateRoutes = require("../routes/state.routes");
const dashboardHomeRoutes = require("../routes/dashboard.home.routes");
const dashboardControlRoutes = require("../routes/dashboard.control.routes");
const dashboardAnalysisRoutes = require("../routes/dashboard.analysis.routes");
const dashboardReportRoutes = require("../routes/dashboard.report.routes");
const dashboardBriefingRoutes = require("../routes/dashboard.briefing.routes");
const dashboardEvalRoutes = require("../routes/dashboard.eval.routes");
const dashboardJournalRoutes = require("../routes/dashboard.journal.routes");
const dashboardAiRoutes = require("../routes/dashboard.ai.routes");
const dashboardSettingsRoutes = require("../routes/dashboard.settings.routes");
const dashboardRiskRoutes = require("../routes/dashboard.risk.routes");
const dashboardProfitRoutes = require("../routes/dashboard.profit.routes");
const dashboardCashflowRoutes = require("../routes/dashboard.cashflow.routes");
const createTradingActionsRoutes = require("../routes/trading.actions.routes");

const briefingRoutes = require("../routes/briefing.routes");
const briefingLatestRoutes = require("../routes/briefing.latest.routes");
const patchSuggestRoutes = require("../routes/patch.suggest.routes");
const egressProxyRoutes = require("../routes/egress.proxy.routes");

const weeklyCloseRoutes = require("../routes/weekly.close.routes");
const evalWeeklyRoutes = require("../routes/eval.weekly.routes");
const rulesPromoteRoutes = require("../routes/rules.promote.routes");
const evalLatestRoutes = require("../routes/eval.latest.routes");
const evalWeeksRoutes = require("../routes/eval.weeks.routes");
const rulesSummaryRoutes = require("../routes/rules.summary.routes");
const weeklyRunsRoutes = require("../routes/weekly.runs.routes");
const backfillBarsRoutes = require("../routes/backfill.bars.routes");
const dropSyncRoutes = require("../routes/filters.drop.sync.routes");
const dropListRoutes = require("../routes/filters.drop.list.routes");

const createRiskRoutes = require("../routes/risk.routes");

const { createStateMachine } = require("../state/machine");

const schedulerModule = require("../scheduler/scheduler");
const createScheduler =
  typeof schedulerModule === "function"
    ? schedulerModule
    : schedulerModule.createScheduler;

const { setupGoogleAuth } = require("../auth/google");
const { FirestoreSessionStore } = require("../storage/sessionStore");

// --- ensureAuthMaybe ---
// UI pages: allow local, allow scheduler token, else require authenticated session.
const ensureAuthMaybe = (req, res, next) => {
  const publicUiEnabled = String(process.env.PUBLIC_UI_NO_AUTH || "0") === "1";
  if (publicUiEnabled && String(req.method || "").toUpperCase() === "GET") {
    const path = String(req.path || "");
    const uiAllowed = [
      "/dashboard/home",
      "/dashboard/mission",
      "/dashboard/recovery",
      "/dashboard/deployment",
      "/dashboard/execution",
      "/dashboard/server-primary",
      "/dashboard/audit",
      "/dashboard/analysis",
      "/dashboard/report",
      "/dashboard/eval",
      "/dashboard/briefing",
      "/dashboard/profit",
      "/dashboard/cashflow",
      "/dashboard/state",
    ];
    const apiAllowed = [
      "/api/eval/latest",
      "/api/report/latest",
      "/api/report/preview",
      "/api/briefing/latest",
    ];
    const uiMatch = uiAllowed.some((p) => path === p || path.startsWith(p + "/"));
    const apiMatch = apiAllowed.includes(path);
    if (uiMatch || apiMatch) return next();
  }
  // 1) 로컬에서 OAuth 미구성 상태면 기본적으로 인증을 생략
  const isLocalRuntime =
    process.env.RUNTIME_MODE === "local" || process.env.NODE_ENV !== "production";

  const isDevPlaceholder = (v) => {
    const s = String(v || "").trim();
    if (!s) return true;
    return s.toUpperCase() === "REPLACE_ME" || s.toUpperCase() === "CHANGE_ME";
  };

  const oauthMissing =
    isDevPlaceholder(process.env.GOOGLE_CLIENT_ID) ||
    isDevPlaceholder(process.env.GOOGLE_CLIENT_SECRET);

  if (isLocalRuntime && oauthMissing) return next();

  // 2) 명시적 로컬 무인증 옵션
  if (String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1") return next();

  // 3) 스케줄러 토큰(서버 간 호출)
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (expected && token === expected) return next();

  // 4) 그 외는 Google OAuth 세션 필요
  if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
  return next();
};

function createApp() {
  const app = express();
  const publicDir = path.resolve(__dirname, "../../public");

  // Cloud Run proxy 안정화
  app.set("trust proxy", 1);

  // body parser
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));

  // view engine (EJS)
  app.set("views", __dirname + "/../views");
  app.set("view engine", "ejs");

  // Static assets
  app.use(
    express.static(publicDir, {
      index: false,
      extensions: false,
      maxAge: "1h",
    })
  );

  // Google OAuth Strategy 등록 (passport)
  setupGoogleAuth();

  const isLocalRuntime =
    process.env.RUNTIME_MODE === "local" || process.env.NODE_ENV !== "production";

  // 세션 설정
  let cookieSecure = process.env.SESSION_COOKIE_SECURE === "true";
  const cookieSameSiteRaw = String(process.env.SESSION_COOKIE_SAMESITE || "").trim().toLowerCase();
  let cookieSameSite = cookieSameSiteRaw || (cookieSecure ? "none" : "lax");
  if (cookieSameSite === "none") {
    cookieSecure = true;
  }
  const sessionSecret =
    process.env.SESSION_SECRET || (isLocalRuntime ? "local_dev_secret" : null);

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required in production");
  }

  const sessionStoreMode = String(process.env.SESSION_STORE || "").trim().toLowerCase();
  const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
  const useFirestoreStore = sessionStoreMode === "firestore";
  const sessionStore = useFirestoreStore
    ? new FirestoreSessionStore({ ttlMs: sessionTtlMs })
    : undefined;

  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      proxy: true,
      cookie: {
        httpOnly: true,
        secure: cookieSecure,
        sameSite: cookieSameSite,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  const isEgressOnly = String(process.env.EGRESS_PROXY_ONLY || "0") === "1";

  if (isEgressOnly) {
    app.use("/", healthRoutes);
    app.use("/", egressProxyRoutes);
    return app;
  }

  // State machine / Scheduler
  const stateMachine = createStateMachine();

  if (typeof createScheduler !== "function") {
    throw new Error("createScheduler is not a function. Check src/scheduler/scheduler.js export.");
  }
  const scheduler = createScheduler({ stateMachine });
  app.locals.scheduler = scheduler;

  if (isLocalRuntime && String(process.env.SCHEDULER_AUTOSTART || "0") === "1") {
    scheduler.start();
    console.log("[BOOT] Scheduler auto-start enabled (local)");
  }

  // ─────────────────────────────────────────
  // 공개 라우트(로그인 불필요)
  // ─────────────────────────────────────────
  app.use("/", healthRoutes);
  app.use("/", authRoutes);
  app.use("/data", dataRoutes);
  app.use("/", dataRoutes);
  // UX: 루트는 계기반으로 연결
  app.get("/", (req, res) => res.redirect("/dashboard/home"));

  // Webhook(신호 저장): 내부 토큰/검증은 routes에서 처리
  app.use("/", createWebhookRoutes());

  // Read-only risk proxy + price proxy (public)
  app.use("/", createRiskRoutes());
  app.use("/", createPricesRoutes());

  // Scheduler routes: 토큰 보호는 routes 내부에서 처리
  app.use("/", createSchedulerRoutes(scheduler));
  app.use("/", dropSyncRoutes);
  app.use("/", backfillBarsRoutes);
  app.use("/", rulesPromoteRoutes);
  app.use("/", evalWeeklyRoutes);
  app.use("/", weeklyCloseRoutes);
  app.use("/", schedulerReportRoutes);
  app.use("/", reportInterpretRoutes);
  app.use("/", briefingRoutes);
  app.use("/", patchSuggestRoutes);

  // ✅ 중요: /scheduler/*가 라우팅 미스나면 UI(/login)로 흘러가지 않게 전용 404
  app.use("/scheduler", (req, res) => {
    return res.status(404).json({
      ok: false,
      error: "SCHEDULER_ROUTE_NOT_FOUND",
      path: req.path,
      method: req.method,
    });
  });

  // 로컬 전용 디버그
  if (isLocalRuntime) {
    app.use("/", debugRoutes);
  }

  // ─────────────────────────────────────────
  // 보호 라우트(로그인 필요 또는 scheduler token)
  // ─────────────────────────────────────────
  app.use("/", ensureAuthMaybe, evalLatestRoutes);
  app.use("/", ensureAuthMaybe, evalWeeksRoutes);
  app.use("/", ensureAuthMaybe, weeklyRunsRoutes);
  app.use("/", ensureAuthMaybe, rulesSummaryRoutes);
  app.use("/", ensureAuthMaybe, dropListRoutes);

  app.use("/", ensureAuthMaybe, briefingLatestRoutes);
  app.use("/", ensureAuthMaybe, improvementPackRoutes);

  app.use("/", ensureAuthMaybe, createSystemRoutes(stateMachine, scheduler));
  app.use("/", ensureAuthMaybe, createPipelineRoutes(stateMachine));
  app.use("/", ensureAuthMaybe, accountRoutes);
  app.use("/", ensureAuthMaybe, createTradingActionsRoutes());

  // Dashboard pages
  app.use("/", ensureAuthMaybe, createDashboardRoutes(stateMachine, scheduler));
  app.use("/", ensureAuthMaybe, createStateRoutes());
  app.use("/", ensureAuthMaybe, dashboardHomeRoutes);
  app.use("/", ensureAuthMaybe, dashboardControlRoutes);
  app.use("/", ensureAuthMaybe, dashboardAnalysisRoutes);
  app.use("/", ensureAuthMaybe, dashboardReportRoutes);
  app.use("/", ensureAuthMaybe, dashboardEvalRoutes);
  app.use("/", ensureAuthMaybe, dashboardBriefingRoutes);
  app.use("/", ensureAuthMaybe, dashboardProfitRoutes);
  app.use("/", ensureAuthMaybe, dashboardCashflowRoutes);
  app.use("/", ensureAuthMaybe, dashboardJournalRoutes);
  app.use("/", ensureAuthMaybe, dashboardAiRoutes);
  app.use("/", ensureAuthMaybe, dashboardSettingsRoutes);
  app.use("/", ensureAuthMaybe, dashboardRiskRoutes);

  // Reports (UI download, packs)
  app.use("/", ensureAuthMaybe, reportRoutes);
  app.use("/", ensureAuthMaybe, reportPreviewRoutes);
  app.use("/", ensureAuthMaybe, reportLatestRoutes);
  app.use("/", ensureAuthMaybe, reportPackRoutes);
  app.use("/", ensureAuthMaybe, reportPackV4Routes);
  app.use("/", ensureAuthMaybe, reportPackV4PlusRoutes);

  // Settings API: routes 내부에서 세션/토큰 gate. (JSON 401 유지)
  app.use("/", settingsRoutes);
  // Audit API: routes 내부에서 세션/토큰 gate. (JSON 401 유지)
  app.use("/", auditRoutes);

  // Legacy UI routes (auth handled inside)
  app.use("/", uiRoutes);

  // 기본 404(JSON)
  app.use((req, res) => {
    return res.status(404).json({ ok: false, error: "NOT_FOUND" });
  });

  return app;
}

module.exports = { createApp, ensureAuthMaybe };
