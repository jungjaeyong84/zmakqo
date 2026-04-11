require("dotenv").config();

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

const { createApp } = require("./src/server/app");

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
});
