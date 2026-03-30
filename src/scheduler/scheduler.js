'use strict';
const { getSystemSettingsCached, getSystemSettingsForProvider } = require("../storage/settings");
const { getEffectiveExchangesSettings, getMultiExchangesSettings } = require("../utils/exchangeSettings");
const { normalizeProviderId } = require("../utils/providerUtils");
const { TF_60M } = require("../config/frozen");
const { tfToMs, defaultMarketsFromEnv, normalizeTf, defaultExecTfFromEnv, defaultTfAllowlistFromEnv } = require("../utils/marketConfig");
const env = require("../config/env");
const { sendAlert } = require("../utils/alerts");
const {
  nowUtcMs,
  clamp,
  normalizeIntervalMs,
} = require("./helpers");
const {
  autoWeeklyEnabled,
  weeklyWindowBounds,
  isWeeklyWindow,
  computeWeeklyRangeUtcISO,
  maybeAutoWeeklyClose,
} = require("./autoWeekly");
const {
  autoEvalEnabled,
  autoEvalCheckMs,
  autoEvalMaxAgeMs,
  maybeAutoEvalLatest,
} = require("./autoEval");
const {
  autoSelfEvolutionEnabled,
  autoSelfEvolutionCheckMs,
  autoSelfEvolutionMaxAgeMs,
  maybeAutoSelfEvolutionLoop,
} = require("./autoSelfEvolution");
const {
  autoAiAllocationEnabled,
  autoAiAllocationCheckMs,
  maybeAutoAiAllocation,
} = require("./autoAi");
const { maybeAutoReinvest } = require("./autoReinvest");
const { syncBinanceFuturesFills } = require("../services/binanceFuturesFillsSync");
const { syncBinanceFuturesFundingFees } = require("../services/binanceFuturesFundingSync");
const {
  refreshLatestBarSnapshot,
  computeGateForMarket,
  runOneMarket,
  buildRunId,
  pickTf,
} = require("./marketRunner");
const { ensureExitWorkerOffIfIdle } = require("../services/exitWorkerScale");
const { auditBinanceExitIntegrity } = require("../services/exitIntegrityAudit");
// NOTE: keep top-level free of debug-only markers to avoid runtime errors.

// normalizeProviderId is centralized in providerUtils.

function initialExchangeLabel() {
  const raw = process.env.EXCHANGE_PROVIDERS;
  if (!raw) return "BINANCEFUT";
  const list = String(raw)
    .split(/[\n,]/)
    .map((s) => normalizeProviderId(s, ""))
    .filter(Boolean);
  return list.length ? list.join("+") : "BINANCEFUT";
}

const { toOverallStatus } = require("../utils/overall");

function parseNonBlockingExchanges() {
  const raw = String(process.env.GATE_NON_BLOCKING_EXCHANGES || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => normalizeProviderId(s, ""))
    .filter(Boolean);
}

function filterTelegramChannels(raw) {
  return String(raw || "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((v) => /^telegram:|^tg:|^telegram:\/\//i.test(v))
    .join(",");
}

function resolveExitIntegrityAlertChannel(sys = {}) {
  const envChannel = String(process.env.EXIT_INTEGRITY_ALERT_CHANNEL || "").trim();
  const sysChannel = String(sys && sys.alert_channel || "").trim();
  const fallbackChatId = String(process.env.TELEGRAM_CHAT_ID || "").trim();
  const fallbackChannel = fallbackChatId ? `telegram:${fallbackChatId}` : "";
  const merged = envChannel || sysChannel || fallbackChannel;
  const telegramOnly = filterTelegramChannels(merged);
  return telegramOnly || merged;
}

function computeOverallTradingMode(overallGate, executionEnabled = true) {
  if (!executionEnabled) {
    return { trading_mode: "HALTED", reason: "EXECUTION_DISABLED" };
  }

  if (!overallGate || overallGate === "UNKNOWN") {
    return { trading_mode: "HALTED", reason: "GATE_UNKNOWN" };
  }

  const status =
    typeof overallGate === "string"
      ? overallGate
      : overallGate.overall_status || overallGate.status;

  if (status === "PASS" || status === "OK") {
    return { trading_mode: "ENTRY_ALLOWED", reason: "GATE_PASS" };
  }

  if (status === "FAIL_SOFT") {
    return { trading_mode: "ENTRY_ALLOWED", reason: "GATE_FAIL_SOFT" };
  }

  if (status === "FAIL_HARD") {
    return { trading_mode: "HALTED", reason: "GATE_FAIL_HARD" };
  }

  return { trading_mode: "HALTED", reason: "GATE_FAIL_UNKNOWN" };
}

function summarizeHealth(markets = []) {
  const out = {
    total: Array.isArray(markets) ? markets.length : 0,
    gateFail: 0,
    snapshotFail: 0,
    snapshotSignalFail: 0,
    lagMaxMs: null,
    lagMaxMarket: null,
    oldestBarMs: null,
    oldestMarket: null,
    samples: [],
  };

  if (!Array.isArray(markets)) return out;

  for (const m of markets) {
    const status = String(m && m.gate && m.gate.status || "").toUpperCase();
    if (status && status !== "PASS") {
      out.gateFail += 1;
      if (out.samples.length < 3) {
        out.samples.push(`${m.exchange || "NA"}:${m.market || "NA"}:${status}`);
      }
    }

    const lag = Number(m && (m.lag_ms ?? (m.gate && m.gate.metrics && m.gate.metrics.lagMs)));
    if (Number.isFinite(lag) && (out.lagMaxMs === null || lag > out.lagMaxMs)) {
      out.lagMaxMs = lag;
      out.lagMaxMarket = `${m.exchange || "NA"}:${m.market || "NA"}`;
    }

    const barMs = Number(m && m.bar_close_time_utc_ms);
    if (Number.isFinite(barMs) && (out.oldestBarMs === null || barMs < out.oldestBarMs)) {
      out.oldestBarMs = barMs;
      out.oldestMarket = `${m.exchange || "NA"}:${m.market || "NA"}`;
    }

    if (m && m.snapshot_refresh && m.snapshot_refresh.ok === false && !m.snapshot_refresh.skipped) {
      out.snapshotFail += 1;
    }
    if (m && m.snapshot_refresh_signal && m.snapshot_refresh_signal.ok === false && !m.snapshot_refresh_signal.skipped) {
      out.snapshotSignalFail += 1;
    }
  }

  return out;
}

function pollMs() {
  const v = Number(env.scheduler.pollMs || 300000);
  return Number.isFinite(v) && v > 0 ? v : 300000;
}

function graceMs() {
  const v = Number(env.scheduler.graceMs || 15000);
  return Number.isFinite(v) && v >= 0 ? v : 15000;
}

function computeMaxLagMs(tf) {
  const maxLag = Number(env.gate.maxLagMs);
  if (Number.isFinite(maxLag) && maxLag > 0) return maxLag;
  const tfMs = tfToMs(tf);
  if (!Number.isFinite(tfMs) || tfMs <= 0) return 6 * 60 * 1000;
  return Math.max(6 * 60 * 1000, Math.round(tfMs * 1.1));
}

function paperEnabled() {
  return env.paper.enabled === true;
}

async function loadSystemSettings() {
  const res = await getSystemSettingsCached(5000);
  const data = res && res.data ? res.data : {};
  const enabled = data.scheduler_enabled !== false;
  const intervalMs = normalizeIntervalMs(data.scheduler_interval_sec, pollMs());
  const reinvestRatio = clamp(data.reinvest_ratio, 0, 1);

  return {
    enabled,
    intervalMs,
    timezone: data.timezone || "Asia/Seoul",
    retry_max: Number.isFinite(Number(data.retry_max)) ? Number(data.retry_max) : 0,
    log_level: data.log_level || "INFO",
    alert_channel: data.alert_channel || "",
    execution_mode: String(data.execution_mode || "PAPER").toUpperCase(),
    live_enabled: data.live_enabled === true,
    live_dry_run: data.live_dry_run === true,
    reinvest_enabled: data.reinvest_enabled === true,
    reinvest_ratio: Number.isFinite(reinvestRatio) ? reinvestRatio : 0.5,
  };
}

function createScheduler() {
  const defaultSignalTf = normalizeTf((defaultTfAllowlistFromEnv() || [TF_60M])[0]) || TF_60M;
  const state = {
    exchange: initialExchangeLabel(),
    tf: defaultSignalTf,
    signal_tf: defaultSignalTf,
    exec_tf: defaultExecTfFromEnv(),
    running: false,
    state: "IDLE",
    lastTick: null,
    timer: null,
    lastHealthAlertAt: null,
    lastHealthAlertKey: null,
    lastExitIntegrityAlertAt: null,
    lastExitIntegrityAlertKey: null,
  };

  async function tick({ runId } = {}) {
    const now = nowUtcMs();
    const started_at = new Date(now).toISOString();
    const sys = await loadSystemSettings();
    state.pollMs = sys.intervalMs;
    state.state = state.running ? "RUNNING" : state.state;
    const execModeGlobal = String(sys.execution_mode || "PAPER").toUpperCase();
    const executionEnabledGlobal = execModeGlobal === "PAPER"
      ? paperEnabled()
      : (execModeGlobal === "LIVE" ? !!sys.live_enabled : true);

    if (!sys.enabled) {
      state.state = "PAUSED";
      const exchangeLabel = String(state.exchange || "BINANCEFUT").toUpperCase();
      const lastTick = {
        runId: runId || `RUN__${exchangeLabel}__${Date.now()}`,
        started_at,
        finished_at: new Date(nowUtcMs()).toISOString(),
        exchange: exchangeLabel,
        tf: state.tf,
        exec_tf: state.exec_tf,
        overall_gate: "SKIPPED",
        overall_gate_str: "SKIPPED",
        trading_mode: { trading_mode: "HALTED", reason: "SCHEDULER_DISABLED" },
        markets: [],
        errors: [],
        skipped: true,
        skip_reason: "SCHEDULER_DISABLED",
        execution_mode: execModeGlobal,
        execution_enabled: executionEnabledGlobal,
      };
      state.lastTick = lastTick;
      return { ok: true, skipped: true, reason: "SCHEDULER_DISABLED" };
    }

    const multi = await getMultiExchangesSettings(5000);
    const exchanges = Array.isArray(multi.exchanges) ? multi.exchanges : [];
    const exchangeLabel = exchanges.length
      ? exchanges.map((x) => x.provider).join("+")
      : String(state.exchange || "BINANCEFUT").toUpperCase();
    state.exchange = exchangeLabel;
    if (!exchanges.length) {
      state.state = "PAUSED";
      const lastTick = {
        runId: runId || `RUN__${exchangeLabel}__${Date.now()}`,
        started_at,
        finished_at: new Date(nowUtcMs()).toISOString(),
        exchange: exchangeLabel,
        tf: state.tf,
        exec_tf: state.exec_tf,
        overall_gate: "SKIPPED",
        overall_gate_str: "SKIPPED",
        trading_mode: { trading_mode: "HALTED", reason: "EXCHANGE_DISABLED" },
        markets: [],
        errors: [],
        skipped: true,
        skip_reason: "EXCHANGE_DISABLED",
        execution_mode: execModeGlobal,
        execution_enabled: executionEnabledGlobal,
      };
      state.lastTick = lastTick;
      return { ok: true, skipped: true, reason: "EXCHANGE_DISABLED" };
    }

    const errors = [];

    const marketResults = [];
    const exchangeResults = [];
    for (const exCfg of exchanges) {
      const exId = String(exCfg.provider || "BINANCEFUT").toUpperCase();
      if (exCfg.enabled === false) continue;
      const sysEx = await getSystemSettingsForProvider(exId, 5000);
      const sysData = (sysEx && sysEx.data) ? sysEx.data : {};
      const execMode = String(sysData.execution_mode || "PAPER").toUpperCase();
      const executionEnabled = execMode === "PAPER"
        ? paperEnabled()
        : (execMode === "LIVE" ? !!sysData.live_enabled : true);
      const signalTf = pickTf({ stateTf: state.signal_tf || state.tf, tfAllowlist: exCfg.tf_allowlist });
      const execTf = normalizeTf(exCfg.exec_tf || defaultExecTfFromEnv()) || signalTf;
      state.tf = signalTf;
      state.signal_tf = signalTf;
      state.exec_tf = execTf;
      const markets = Array.isArray(exCfg.markets) && exCfg.markets.length
        ? exCfg.markets
        : defaultMarketsFromEnv(exId);
      const results = [];
      for (const market of markets) {
        try {
          const r = await runOneMarket({
            exchange: exId,
            market,
            signalTf,
            execTf,
            nowMs: now,
            runIdHint: runId,
            executionEnabled,
            executionMode: execMode,
          });
          results.push(r);
          marketResults.push(r);
          if (r && r.error) errors.push({ exchange: exId, market, error: r.error });
        } catch (e) {
          const msg = (e && e.message) ? e.message : String(e);
          errors.push({ exchange: exId, market, error: msg });
          const failed = { exchange: exId, market, symbol_or_pair_id: market, tf: signalTf, exec_tf: execTf, ok: false, error: msg };
          results.push(failed);
          marketResults.push(failed);
        }
      }
      let fillsSync = null;
      let fundingSync = null;
      if (exId === "BINANCEFUT") {
        try {
          fillsSync = await syncBinanceFuturesFills({
            markets,
            execTf,
            executionMode: execMode,
            liveEnabled: executionEnabled,
          });
        } catch (e) {
          fillsSync = { ok: false, error: (e && e.message) ? e.message : String(e) };
          errors.push({ exchange: exId, market: "__FILLS_SYNC__", error: fillsSync.error });
        }
        try {
          fundingSync = await syncBinanceFuturesFundingFees({
            markets,
            executionMode: execMode,
            liveEnabled: executionEnabled,
          });
        } catch (e) {
          fundingSync = { ok: false, error: (e && e.message) ? e.message : String(e) };
          errors.push({ exchange: exId, market: "__FUNDING_SYNC__", error: fundingSync.error });
        }
      }
      exchangeResults.push({
        exchange: exId,
        tf: signalTf,
        exec_tf: execTf,
        markets: results,
        fills_sync: fillsSync,
        funding_sync: fundingSync,
      });
    }

    // overall gate aggregation (best-effort + stable output)
    let overallGate = null;
    try {
      const nonBlocking = parseNonBlockingExchanges();
      const filtered = nonBlocking.length
        ? marketResults.filter((m) => {
            const ex = String(m && m.exchange || "").toUpperCase();
            if (!nonBlocking.includes(ex)) return true;
            const s = toOverallStatus(m && m.gate);
            return s !== "FAIL_SOFT";
          })
        : marketResults;
      const inputs = filtered.length ? filtered : marketResults;
      overallGate = toOverallStatus(inputs.map((m) => m.gate).filter(Boolean));
    } catch (e) {
      overallGate = {
        gate_version: "v0.2.0",
        status: "FAIL",
        severity: "HARD",
        reasonCodes: ["OVERALL_GATE_EXCEPTION"],
        metrics: { markets: marketResults.length },
        ok: false,
        overall_status: "FAIL_HARD",
      };
      errors.push({ market: "__OVERALL__", error: (e && e.message) ? e.message : String(e) });
    }

    const overallGateStr = String(
      (typeof overallGate === "string"
        ? overallGate
        : (overallGate && (overallGate.overall_status || overallGate.overallStatus || overallGate.status))) ||
        "UNKNOWN"
    ).toUpperCase();

    const health = summarizeHealth(marketResults);
    const hasIssues = (health.gateFail + health.snapshotFail + health.snapshotSignalFail) > 0;
    console.log(
      `[health] run=${runId || "NA"} overall=${overallGateStr} ` +
      `gate_fail=${health.gateFail}/${health.total} ` +
      `snapshot_fail=${health.snapshotFail} snapshot_signal_fail=${health.snapshotSignalFail} ` +
      `lag_max_ms=${health.lagMaxMs ?? "NA"} lag_max_mkt=${health.lagMaxMarket ?? "NA"} ` +
      `oldest_bar_ms=${health.oldestBarMs ?? "NA"} oldest_mkt=${health.oldestMarket ?? "NA"} ` +
      (hasIssues && health.samples.length ? `samples=${health.samples.join(",")}` : "samples=OK")
    );

    const alertChannel = String(sys.alert_channel || "").trim();
    const alertIntervalMs = Number(process.env.ALERT_MIN_INTERVAL_MS || (15 * 60 * 1000));
    if (health.gateFail > 0 && alertChannel) {
      const key = [
        overallGateStr,
        health.gateFail,
        health.total,
        health.lagMaxMs ?? "NA",
        health.oldestBarMs ?? "NA",
        health.samples.join("|"),
      ].join("|");
      const lastAt = Number(state.lastHealthAlertAt);
      const elapsed = Number.isFinite(lastAt) ? (now - lastAt) : null;
      const shouldSend =
        !state.lastHealthAlertKey ||
        state.lastHealthAlertKey !== key ||
        (Number.isFinite(elapsed) && elapsed >= alertIntervalMs);
      if (shouldSend) {
        const title = `DONBEOLJA health alert: gate_fail ${health.gateFail}/${health.total}`;
        const body =
          `overall=${overallGateStr}\n` +
          `lag_max_ms=${health.lagMaxMs ?? "NA"} lag_max_mkt=${health.lagMaxMarket ?? "NA"}\n` +
          `oldest_bar_ms=${health.oldestBarMs ?? "NA"} oldest_mkt=${health.oldestMarket ?? "NA"}\n` +
          `snapshot_fail=${health.snapshotFail} snapshot_signal_fail=${health.snapshotSignalFail}\n` +
          `samples=${health.samples.length ? health.samples.join(",") : "OK"}`;
        const res = await sendAlert({ channel: alertChannel, title, body, severity: "WARN" });
        if (!res.ok) {
          const errors = (res.results || [])
            .filter((r) => r && r.error)
            .map((r) => ({ type: r.type, error: r.error }));
          console.warn("[health_alert_fail]", { ok: res.ok, errors });
        }
        state.lastHealthAlertAt = now;
        state.lastHealthAlertKey = key;
      }
    } else if (health.gateFail === 0) {
      state.lastHealthAlertAt = null;
      state.lastHealthAlertKey = null;
    }

    let exitIntegrity = null;
    try {
      const runExitIntegrityAudit = Array.isArray(exchanges) && exchanges.includes("BINANCEFUT");
      if (runExitIntegrityAudit && String(process.env.EXIT_INTEGRITY_AUDIT_ENABLED || "1") !== "0") {
        exitIntegrity = await auditBinanceExitIntegrity();
        const issueCount = Number(exitIntegrity && exitIntegrity.issue_count) || 0;
        const activeCount = Number(exitIntegrity && exitIntegrity.active_market_count) || 0;
        console.log(
          `[exit_integrity] run=${runId || "NA"} issues=${issueCount} active=${activeCount} ` +
          `ok=${exitIntegrity && exitIntegrity.ok === true ? "1" : "0"}`
        );
        const alertChannel = resolveExitIntegrityAlertChannel(sys);
        const alertIntervalMs = Math.max(10000, Number(process.env.EXIT_INTEGRITY_ALERT_MIN_INTERVAL_MS || 60000));
        if (issueCount > 0 && alertChannel) {
          const top = Array.isArray(exitIntegrity.issues) ? exitIntegrity.issues.slice(0, 5) : [];
          const key = top.map((x) => `${x.symbol}:${x.code}`).join("|");
          const lastAt = Number(state.lastExitIntegrityAlertAt);
          const elapsed = Number.isFinite(lastAt) ? (now - lastAt) : null;
          const shouldSend =
            !state.lastExitIntegrityAlertKey ||
            state.lastExitIntegrityAlertKey !== key ||
            (Number.isFinite(elapsed) && elapsed >= alertIntervalMs);
          if (shouldSend) {
            const title = `DONBEOLJA exit 무결성 경고 ${issueCount}건`;
            const body = top.map((x) => `${x.symbol} ${x.code} ${x.detail}`).join("\n");
            const res = await sendAlert({ channel: alertChannel, title, body, severity: "WARN" });
            if (!res.ok) {
              const errors = (res.results || []).filter((r) => r && r.error).map((r) => ({ type: r.type, error: r.error }));
              console.warn("[exit_integrity_alert_fail]", { ok: res.ok, errors });
            }
            state.lastExitIntegrityAlertAt = now;
            state.lastExitIntegrityAlertKey = key;
          }
        } else if (issueCount === 0) {
          state.lastExitIntegrityAlertAt = null;
          state.lastExitIntegrityAlertKey = null;
        }
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      exitIntegrity = { ok: false, reason: "EXIT_INTEGRITY_AUDIT_FAIL", error: msg };
      errors.push({ exchange: "BINANCEFUT", market: "__EXIT_INTEGRITY__", error: msg });
    }

    // trading mode derived from overall gate
    const trading_mode = computeOverallTradingMode(overallGateStr, executionEnabledGlobal);

    const weeklyAuto = await maybeAutoWeeklyClose({ exchanges });
    const evalAuto = await maybeAutoEvalLatest({ exchanges });
    const selfEvolutionAuto = await maybeAutoSelfEvolutionLoop();
    const aiAuto = await maybeAutoAiAllocation();
    const sysBinance = await getSystemSettingsForProvider("BINANCEFUT", 5000);
    const reinvestAuto = await maybeAutoReinvest({ exchanges, sys: (sysBinance && sysBinance.data) ? sysBinance.data : sys });
    let exitWorkerScale = null;
    try {
      exitWorkerScale = await ensureExitWorkerOffIfIdle({ reason: "SCHEDULER_IDLE_CHECK" });
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      exitWorkerScale = { ok: false, reason: "EXIT_WORKER_SCALE_FAIL", error: msg };
      errors.push({ exchange: "BINANCEFUT", market: "__EXIT_WORKER_SCALE__", error: msg });
    }

    const finished_at = new Date(nowUtcMs()).toISOString();
    const lastTick = {
      runId: runId || `RUN__${exchangeLabel}__${state.exec_tf || state.tf}__${Date.now()}`,
      started_at,
      finished_at,
      exchange: exchangeLabel,
      tf: state.tf,
      exec_tf: state.exec_tf,
      overall_gate: overallGate,
      overall_gate_str: overallGateStr,
      trading_mode,
      markets: marketResults,
      exchanges: exchangeResults,
      errors,
      weekly_auto: weeklyAuto,
      eval_auto: evalAuto,
      self_evolution_auto: selfEvolutionAuto,
      ai_auto: aiAuto,
      reinvest_auto: reinvestAuto,
      exit_integrity: exitIntegrity,
      exit_worker_scale: exitWorkerScale,
      execution_mode: execModeGlobal,
      execution_enabled: executionEnabledGlobal,
    };

    state.lastTick = lastTick;

    return {
      ok: errors.length === 0,
      runId: lastTick.runId,
      started_at,
      finished_at,
      exchange: exchangeLabel,
      tf: state.tf,
      exec_tf: state.exec_tf,

      // stable fields used by clients
      overall_gate: overallGateStr,
      overall_status: overallGateStr,
      trading_mode,
      execution_mode: execModeGlobal,
      execution_enabled: executionEnabledGlobal,

      // detail for debugging
      overall_gate_detail: overallGate,

      markets: marketResults,
      exchanges: exchangeResults,
      errors,
      eval_auto: evalAuto,
      self_evolution_auto: selfEvolutionAuto,
      ai_auto: aiAuto,
      reinvest_auto: reinvestAuto,
      exit_integrity: exitIntegrity,
      exit_worker_scale: exitWorkerScale,
    };
  }

  function start() {
    if (state.running) return { ok: true, running: true, pollMs: state.pollMs || pollMs(), note: "already_running" };

    state.running = true;
    state.state = "RUNNING";

    const loop = async () => {
      if (!state.running) return;
      try {
        await tick({ runId: `RUN__${state.exchange}__${state.tf}__${Date.now()}` });
      } catch (err) {
        console.warn("[SCHEDULER_LOOP_FAIL]", err?.message || err);
      } finally {
        if (state.running) state.timer = setTimeout(loop, state.pollMs || pollMs());
      }
    };

    state.timer = setTimeout(loop, 0);
    return { ok: true, running: true, pollMs: state.pollMs || pollMs() };
  }

  function stop() {
    state.running = false;
    state.state = "IDLE";
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    return { ok: true, running: false };
  }

  function status() {
    const envLabel = initialExchangeLabel();
    const exchangeLabel = process.env.EXCHANGE_PROVIDERS ? envLabel : state.exchange;
    return {
      exchange: exchangeLabel,
      tf: state.tf,
      signal_tf: state.signal_tf || state.tf,
      exec_tf: state.exec_tf || null,
      paperEnabled: paperEnabled(),
      state: state.state,
      running: state.running,
      lastTick: state.lastTick,
      pollMs: state.pollMs || pollMs(),
      graceMs: graceMs(),
    };
  }

  function configure({ exchange, tf } = {}) {
    if (exchange) state.exchange = String(exchange).toUpperCase();
    if (tf) state.tf = String(tf);
    return status();
  }

  return {
    tick,
    start,
    stop,
    status,
    configure,
  };
}

module.exports = {
  createScheduler,
};
