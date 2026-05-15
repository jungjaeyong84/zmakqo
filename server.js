require("dotenv").config();

// 2026-04-27 Stage K — install global process crash handlers as the
// FIRST thing after dotenv so any subsequent unhandled async error or
// sync throw surfaces with a structured stack instead of an opaque
// signal-6 SIGABRT in Cloud Logging.
try {
  const { installProcessCrashHandlers } = require("./src/utils/processCrashHandler");
  installProcessCrashHandlers();
} catch (_) {
  // Best-effort: never fail boot just because the crash handler module
  // couldn't be required.
}

try {
  if (process.stdin && process.stdin.on) {
    process.stdin.on("error", () => {});
  }
} catch (_) {}
// STDIN_EIO_GUARD_V1

try {
  const mode = String(process.env.SCHEDULER_ENV_CHECK || "off").toLowerCase();
  if (mode !== "off" && mode !== "0") {
    const { checkSchedulerEnv, formatSchedulerEnvReport } = require("./src/utils/schedulerEnvCheck");
    const result = checkSchedulerEnv(process.env);
    const report = formatSchedulerEnvReport(result);
    for (const line of report.lines) console.log(line);
    if (result.errors.length && (mode === "1" || mode === "error" || mode === "strict")) {
      process.exit(1);
    }
  }
} catch (e) {
  console.log("[WARN] Scheduler env check failed:", e && e.message ? e.message : String(e));
}

// 2026-04-20 senior-audit H1: fail-closed production startup guard for
// the custom undici dispatcher.  In production the
// `EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1` escape hatch must never be
// honoured — leaving it set reverts egress to the global fetch() pool,
// which is the exact pattern that caused the 2026-04-19 ETHUSDT
// silent-hang blackout.  The deploy gate catches this env when it
// leaks through Cloud Build, but cannot see a Cloud Run service env
// that was set AFTER the build passed gate.  This guard runs on every
// boot and crash-loops the container with a distinctive error marker
// so the revision fails its Cloud Run health check and auto-rolls-
// back.  Non-prod processes (unit tests, local dev) are unaffected.
try {
  const { assertEgressProductionStartupGuard } = require("./src/utils/egressProxy");
  assertEgressProductionStartupGuard();
} catch (e) {
  console.error("[FATAL] Egress production startup guard tripped:",
    e && e.message ? e.message : String(e));
  process.exit(1);
}

const isDesktopMode = String(process.env.DESKTOP_MODE || "0") === "1";
const { createApp } = isDesktopMode
  ? require("./src/server/localDashboardApp")
  : require("./src/server/app");

const app = createApp();

// ✅ Cloud Run은 PORT env를 반드시 사용해야 함 (기본 8080)
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);

  try {
    const { logDeployOnce } = require("./src/services/devChangeLog");
    logDeployOnce().catch(() => {});
  } catch (e) {
    console.log("[WARN] dev change log failed:", e && e.message ? e.message : String(e));
  }

  if (isDesktopMode) {
    console.log("[BOOT] Desktop mode detected; runtime trading loops skipped");
  } else {
    try {
      const { startBinanceTickExitLoop } = require("./src/services/binanceTickExit");
      const result = startBinanceTickExitLoop();
      if (result && result.running) {
        console.log(`[BOOT] Binance tick exit loop started (${result.intervalMs}ms)`);
      } else if (result && result.skipped) {
        console.log(`[BOOT] Binance tick exit loop skipped (${result.reason || "DISABLED"})`);
      }
    } catch (e) {
      console.log("[WARN] Binance tick exit start failed:", e && e.message ? e.message : String(e));
    }

    try {
      const { startBinanceUserDataStream } = require("./src/services/binanceUserDataStream");
      startBinanceUserDataStream({ enabled: true }).then((result) => {
        if (result && result.ok) {
          console.log("[BOOT] Binance user-data stream started");
        } else if (result && result.skipped) {
          console.log(`[BOOT] Binance user-data stream skipped (${result.reason || "DISABLED"})`);
        }
      }).catch(() => {});
    } catch (e) {
      console.log("[WARN] Binance user-data stream start failed:", e && e.message ? e.message : String(e));
    }
  }
});
