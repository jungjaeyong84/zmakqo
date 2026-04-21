#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { tfToMs } = require("../src/utils/marketConfig");
const {
  OPENCLAW_CRON_ARTIFACT_MAP,
  OPENCLAW_CRON_JOBS,
  OPENCLAW_SCHEDULER_SOT,
} = require("./lib/openclaw-cron-manifest");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  REPO_ROOT,
  copyLatest,
  ensureDir,
  execJson,
  execText,
  loadLocalEnv,
  nowKstMeta,
  readJsonSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);
ensureDir(OPS_RUNTIME_DIR);

const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "automation_watchdog_latest.md");
const STATE_PATH = path.join(OPS_RUNTIME_DIR, "automation_watchdog_state.json");
const DATA_BACKFILL_SCRIPT = path.join(REPO_ROOT, "ops", "launchd", "run_data_backfill_recovery.sh");
const DATA_BACKFILL_LATEST_JSON = path.join(OPS_DAILY_DIR, "data_backfill_recovery_latest.json");
const DATA_BACKFILL_MIN_INTERVAL_MS = 30 * 60 * 1000;
const SCHEDULER_RECOVERY_MIN_INTERVAL_MS = 10 * 60 * 1000;
const OPENCLAW_AUTH_RECOVERY_MIN_INTERVAL_MS = Math.max(
  60 * 1000,
  parseNumber(process.env.AUTOMATION_WATCHDOG_OPENCLAW_AUTH_RECOVERY_MIN_INTERVAL_MS, 10 * 60 * 1000)
);
const OPENCLAW_AUTH_RECOVERY_ALWAYS_ON = parseBoolean(
  process.env.AUTOMATION_WATCHDOG_OPENCLAW_AUTH_RECOVERY_ALWAYS_ON,
  true
);
const STATUS_SUPPRESSION_MAX_CONSECUTIVE_ERRORS = Math.max(
  0,
  parseNumber(process.env.AUTOMATION_WATCHDOG_STATUS_SUPPRESSION_MAX_CONSEC_ERRORS, 0)
);

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}

const ARTIFACT_SPECS = Object.freeze([
  { name: "analytics_local_cache_refresh", filePath: path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json"), maxAgeHours: 4, severity: "WARN" },
  { name: "openclaw_hourly_cycle", filePath: path.join(OPS_DAILY_DIR, "openclaw_hourly_cycle_latest.json"), maxAgeHours: 2, severity: "FAIL" },
  { name: "v2_repair_queue_canary", filePath: path.join(OPS_DAILY_DIR, "v2_repair_queue_canary_latest.json"), maxAgeHours: 0.25, severity: "FAIL" },
  { name: "v2_repair_queue_operational_canary", filePath: path.join(OPS_DAILY_DIR, "v2_repair_queue_operational_canary_latest.json"), maxAgeHours: 0.25, severity: "FAIL" },
  { name: "v2_repair_queue_canary_preflight", filePath: path.join(OPS_DAILY_DIR, "v2_repair_queue_canary_preflight_latest.json"), maxAgeHours: 0.25, severity: "FAIL" },
  { name: "v2_repair_queue_service", filePath: path.join(OPS_DAILY_DIR, "v2_repair_queue_service_latest.json"), maxAgeHours: 0.25, severity: "FAIL" },
  { name: "openclaw_daily_cycle", filePath: path.join(OPS_DAILY_DIR, "openclaw_daily_cycle_latest.json"), maxAgeHours: 30, severity: "FAIL" },
  { name: "objective_retrospective", filePath: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"), maxAgeHours: 30, severity: "FAIL" },
  // Objective supervisor/stage autopilot now run inside daily cycle; freshness should follow daily cadence.
  { name: "objective_supervisor", filePath: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), maxAgeHours: 30, severity: "FAIL" },
  { name: "stage_autopilot", filePath: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"), maxAgeHours: 30, severity: "FAIL" },
  { name: "filter_shadow_canary", filePath: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"), maxAgeHours: 12, severity: "WARN" },
  // This artifact is produced by the weekly governance lane, not the hourly/daily cron path.
  { name: "weekly_filter_governance", filePath: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"), maxAgeHours: 192, severity: "WARN" },
  { name: "ev_tp1_threshold_tune", filePath: resolveLatestArtifactPath("ev_composite_threshold_tune_latest.json", "ev_tp1_threshold_tune_latest.json"), maxAgeHours: 96, severity: "WARN" },
  { name: "wait_one_bar_tune", filePath: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"), maxAgeHours: 144, severity: "WARN" },
  { name: "codex_weekly_patch_engine", filePath: path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"), maxAgeHours: 192, severity: "WARN" },
]);

const AUTOMATION_SEVERITY_BY_LABEL = Object.freeze({
  "com.jeongjaeyong.donbeolja.objectiveretrospective": "FAIL",
  "com.jeongjaeyong.donbeolja.objectivesupervisor": "FAIL",
  "com.jeongjaeyong.donbeolja.v2repairqueue": "FAIL",
  "com.jeongjaeyong.donbeolja.rollbackmonitor": "FAIL",
  "com.jeongjaeyong.donbeolja.stageautopilot": "FAIL",
  "com.jeongjaeyong.donbeolja.signaldataintegrity": "FAIL",
  "com.jeongjaeyong.donbeolja.analyticscache": "WARN",
  "com.jeongjaeyong.donbeolja.stageoutcomeledgers": "WARN",
  "com.jeongjaeyong.donbeolja.codexweeklypatch": "WARN",
  "com.jeongjaeyong.donbeolja.filtershadowcanary": "WARN",
  "com.jeongjaeyong.donbeolja.hourlyguard": "WARN",
  "com.jeongjaeyong.donbeolja.mlfilterpolicy": "WARN",
  "com.jeongjaeyong.donbeolja.evtp1tune": "WARN",
  "com.jeongjaeyong.donbeolja.waitonebartune": "WARN",
  "com.jeongjaeyong.donbeolja.weeklyfilters": "WARN",
  "com.jeongjaeyong.donbeolja.weeklypine": "WARN",
  "com.jeongjaeyong.donbeolja.automationwatchdog": "WARN",
});

const AUTOMATION_SPECS = Object.freeze(
  OPENCLAW_CRON_JOBS.map((job) => ({
    job_id: job.job_id,
    label: job.label,
    name: job.name,
    wrapper: job.wrapper,
    owner: job.owner || "openclaw",
    criticality: job.criticality || "HIGH",
    produces_artifact: job.produces_artifact || null,
    artifact_sla_hours: Number(job.artifact_sla_hours || 0) || null,
    depends_on: Array.isArray(job.depends_on) ? job.depends_on : [],
    recovery_strategy: job.recovery_strategy || null,
    scheduler_sot: job.scheduler_sot || OPENCLAW_SCHEDULER_SOT,
    severity: AUTOMATION_SEVERITY_BY_LABEL[job.label] || "WARN",
  }))
);

function ageHoursFromStat(stat) {
  return (Date.now() - Number(stat.mtimeMs || 0)) / (60 * 60 * 1000);
}

function assessArtifact(spec) {
  if (!fs.existsSync(spec.filePath)) {
    return {
      ...spec,
      exists: false,
      fresh: false,
      ageHours: null,
      issueCode: `${spec.name.toUpperCase()}_MISSING`,
      issueSeverity: spec.severity,
    };
  }
  const st = fs.statSync(spec.filePath);
  const ageHours = ageHoursFromStat(st);
  const fresh = Number.isFinite(ageHours) && ageHours <= spec.maxAgeHours;
  return {
    ...spec,
    exists: true,
    fresh,
    ageHours,
    mtimeMs: Number(st.mtimeMs || 0),
    issueCode: fresh ? null : `${spec.name.toUpperCase()}_STALE`,
    issueSeverity: fresh ? null : spec.severity,
  };
}

function parseLaunchctlList(text) {
  const out = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    const label = parts[parts.length - 1];
    const lastExitRaw = parts[parts.length - 2];
    const pidRaw = parts[parts.length - 3];
    const pid = pidRaw === "-" ? null : Number(pidRaw);
    const lastExit = lastExitRaw === "-" ? null : Number(lastExitRaw);
    out.set(label, {
      label,
      pid: Number.isFinite(pid) ? pid : null,
      lastExit: Number.isFinite(lastExit) ? lastExit : null,
    });
  }
  return out;
}

function parseOpenClawCronList(payload) {
  const out = new Map();
  const jobs = Array.isArray(payload && payload.jobs) ? payload.jobs : [];
  for (const job of jobs) {
    const name = String(job && job.name || "").trim();
    if (!name) continue;
    out.set(name, job);
  }
  return out;
}

function assessSchedulerJob(spec, cronRows) {
  const row = cronRows.get(spec.name);
  if (!row) {
    return {
      ...spec,
      scheduler: spec.scheduler_sot || OPENCLAW_SCHEDULER_SOT,
      configured: false,
      enabled: false,
      cronId: null,
      lastStatus: null,
      nextRunAtMs: null,
      issueCode: `${spec.name}_MISSING`,
      issueSeverity: spec.severity,
    };
  }
  const enabled = row.enabled === true;
  const lastStatus = String(row && row.state && (row.state.lastStatus || row.state.lastRunStatus) || "").trim() || null;
  const consecutiveErrors = Number(row && row.state && row.state.consecutiveErrors || 0);
  const lastErrorReason = String(row && row.state && row.state.lastErrorReason || "").trim() || null;
  const lastError = String(row && row.state && row.state.lastError || "").trim() || null;
  const badStatus = Boolean(lastStatus) && !["ok", "not-delivered"].includes(String(lastStatus).toLowerCase());
  let issueCode = null;
  let issueSeverity = null;
  if (!enabled) {
    issueCode = `${spec.name}_DISABLED`;
    issueSeverity = spec.severity;
  } else if (badStatus || consecutiveErrors > 0) {
    issueCode = `${spec.name}_STATUS_${String(lastStatus || "ERROR").toUpperCase()}`;
    issueSeverity = spec.severity;
  }
  return {
    ...spec,
    scheduler: spec.scheduler_sot || OPENCLAW_SCHEDULER_SOT,
    configured: true,
    enabled,
    cronId: String(row.id || "").trim() || null,
    lastStatus,
    consecutiveErrors,
    lastErrorReason,
    lastError,
    nextRunAtMs: Number(row && row.state && row.state.nextRunAtMs || 0) || null,
    issueCode,
    issueSeverity,
  };
}

function assessLaunchdPresence(spec, launchctlRows) {
  const row = launchctlRows.get(spec.label);
  if (!row) {
    return {
      ...spec,
      loaded: false,
      pid: null,
      lastExit: null,
      issueCode: `${spec.label}_MISSING`,
      issueSeverity: spec.severity,
    };
  }
  const badExit = Number.isFinite(row.lastExit) && row.lastExit !== 0;
  return {
    ...spec,
    loaded: true,
    pid: row.pid,
    lastExit: row.lastExit,
    issueCode: badExit ? `${spec.label}_EXIT_${row.lastExit}` : null,
    issueSeverity: badExit ? spec.severity : null,
  };
}

function reconcileSchedulerRowsWithArtifacts(rows, artifacts) {
  const artifactFresh = new Map(
    (Array.isArray(artifacts) ? artifacts : [])
      .map((row) => [String(row && row.name || "").trim(), row && row.fresh === true])
  );
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const name = String(row && row.name || "").trim();
    const artifactName = (
      String(row && row.produces_artifact || "").trim().replace(/_latest\.json$/i, "")
      || OPENCLAW_CRON_ARTIFACT_MAP[name]
      || null
    );
    if (!artifactName) return row;
    const isFresh = artifactFresh.get(artifactName) === true;
    const issueCode = String(row && row.issueCode || "");
    const consecutiveErrors = Number(row && row.consecutiveErrors || 0);
    const suppressionAllowed = consecutiveErrors <= STATUS_SUPPRESSION_MAX_CONSECUTIVE_ERRORS;
    if (isFresh && issueCode.includes("_STATUS_") && suppressionAllowed) {
      return {
        ...row,
        issueCode: null,
        issueSeverity: null,
        statusSuppressedByFreshArtifact: true,
      };
    }
    if (isFresh && issueCode.includes("_STATUS_") && !suppressionAllowed) {
      return {
        ...row,
        statusSuppressionDeniedByConsecutiveErrors: true,
      };
    }
    return row;
  });
}

function parseBoolean(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseIsoMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function resolveSchedulerBaseUrl() {
  const fromEnv = String(
    process.env.AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL
    || process.env.SCHEDULER_BASE_URL
    || ""
  ).trim();
  // Default changed 2026-04-18: production runtime now lives on Cloud Run
  // (donbeolja service), not on localhost:3000. Previously this fell
  // back to 127.0.0.1:3000 which caused SCHEDULER_STATUS_UNREACHABLE
  // every time the watchdog was spawned from a context that didn't
  // source run_automation_watchdog.sh (e.g. openclaw-hourly-cycle
  // invoking the script directly via `node scripts/...`). Setting the
  // explicit env var still wins; local dev can still override via
  // AUTOMATION_WATCHDOG_SCHEDULER_BASE_URL=http://127.0.0.1:3000.
  const cloudRunDefault = "https://donbeolja-350958953672.asia-northeast3.run.app";
  const base = fromEnv || cloudRunDefault;
  return base.replace(/\/+$/, "");
}

function resolveSchedulerTimeoutMs() {
  return Math.max(500, parseNumber(process.env.AUTOMATION_WATCHDOG_SCHEDULER_TIMEOUT_MS, 5000));
}

function shouldRestartLocalServer() {
  return parseBoolean(process.env.AUTOMATION_WATCHDOG_RESTART_LOCAL_SERVER, true);
}

function localServerLaunchdLabel() {
  return String(process.env.AUTOMATION_WATCHDOG_SERVER_LABEL || "com.jeongjaeyong.donbeolja.server").trim();
}

function computeSchedulerSlaMs({ signalTf, pollMs } = {}) {
  const tfMs = tfToMs(signalTf);
  const factor = Math.max(1, parseNumber(process.env.AUTOMATION_WATCHDOG_SCHEDULER_SLA_FACTOR, 1.8));
  const graceMs = Math.max(0, parseNumber(process.env.AUTOMATION_WATCHDOG_SCHEDULER_SLA_GRACE_MS, 2 * 60 * 1000));
  const minMs = Math.max(60 * 1000, parseNumber(process.env.AUTOMATION_WATCHDOG_SCHEDULER_SLA_MIN_MS, 15 * 60 * 1000));
  if (Number.isFinite(tfMs) && tfMs > 0) {
    return Math.max(minMs, Math.round(tfMs * factor) + graceMs);
  }
  const poll = Number.isFinite(Number(pollMs)) ? Number(pollMs) : minMs;
  return Math.max(minMs, (poll * 3) + graceMs);
}

function httpRequestJson({ method = "GET", url, headers = {}, body = null, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(String(url || ""));
    } catch (_err) {
      resolve({ ok: false, statusCode: null, data: null, error: "INVALID_URL" });
      return;
    }
    const transport = parsedUrl.protocol === "https:" ? https : http;
    const req = transport.request({
      method,
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers,
      timeout: Math.max(500, Number(timeoutMs) || 5000),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_err) {
          data = null;
        }
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({
          ok,
          statusCode: res.statusCode || null,
          data,
          raw: text,
          error: ok ? null : `HTTP_${res.statusCode || "ERR"}`,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("REQUEST_TIMEOUT"));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        statusCode: null,
        data: null,
        raw: "",
        error: err && err.message ? String(err.message) : "REQUEST_FAILED",
      });
    });
    if (body != null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function fetchSchedulerStatus({ baseUrl, token, timeoutMs }) {
  const url = `${String(baseUrl || "").replace(/\/+$/, "")}/scheduler/status`;
  const headers = {};
  if (token) headers["x-scheduler-token"] = token;
  const res = await httpRequestJson({ method: "GET", url, headers, timeoutMs });
  return {
    ...res,
    baseUrl: String(baseUrl || ""),
  };
}

async function triggerSchedulerTick({ baseUrl, token, timeoutMs }) {
  const url = `${String(baseUrl || "").replace(/\/+$/, "")}/scheduler/tick`;
  const headers = {
    "content-type": "application/json",
  };
  if (token) headers["x-scheduler-token"] = token;
  const res = await httpRequestJson({ method: "POST", url, headers, body: "{}", timeoutMs });
  const tickResult = res && res.data && typeof res.data === "object" ? res.data : null;
  const ok = !!(res.ok && tickResult && tickResult.ok === true);
  return {
    ...res,
    ok,
    runId: tickResult && (tickResult.run_id || tickResult.runId) || null,
    reason: ok ? null : (
      tickResult && (tickResult.error || tickResult.message)
      ? String(tickResult.error || tickResult.message)
      : (res.error || "SCHEDULER_TICK_FAILED")
    ),
  };
}

function restartLocalServerLaunchd() {
  const label = localServerLaunchdLabel();
  if (!label) {
    return { ok: false, label: null, command: null, error: "SERVER_LABEL_MISSING" };
  }
  if (typeof process.getuid !== "function") {
    return { ok: false, label, command: null, error: "UID_UNAVAILABLE" };
  }
  const uid = String(process.getuid());
  const command = `launchctl kickstart -k gui/${uid}/${label}`;
  const res = execText(command, { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 });
  return {
    ok: !!res.ok,
    label,
    command,
    error: res.ok ? null : String(res.error || "LAUNCHCTL_KICKSTART_FAILED"),
  };
}

function assessSchedulerTickSla(statusRes) {
  const nowMs = Date.now();
  const base = {
    name: "scheduler_tick_sla",
    severity: "PASS",
    configuredSeverity: "FAIL",
    checkedAtMs: nowMs,
    baseUrl: statusRes && statusRes.baseUrl || null,
    issueCode: null,
    issueSeverity: null,
    reachable: false,
    statusCode: statusRes && statusRes.statusCode || null,
    signalTf: null,
    pollMs: null,
    lastTickMs: null,
    lastTickIso: null,
    ageMs: null,
    slaMs: null,
    schedulerManagedExternally: null,
    running: null,
  };

  if (!statusRes || !statusRes.ok) {
    const code = statusRes && statusRes.statusCode === 401
      ? "SCHEDULER_STATUS_UNAUTHORIZED"
      : (statusRes && statusRes.statusCode === 404 ? "SCHEDULER_STATUS_NOT_FOUND" : "SCHEDULER_STATUS_UNREACHABLE");
    return {
      ...base,
      severity: "FAIL",
      issueCode: code,
      issueSeverity: "FAIL",
      error: statusRes && statusRes.error ? String(statusRes.error) : "STATUS_REQUEST_FAILED",
    };
  }

  const payload = statusRes.data && typeof statusRes.data === "object" ? statusRes.data : null;
  const scheduler = payload && payload.scheduler && typeof payload.scheduler === "object" ? payload.scheduler : null;
  const runtime = payload && payload.runtime && typeof payload.runtime === "object" ? payload.runtime : null;
  const lastTick = scheduler && scheduler.lastTick && typeof scheduler.lastTick === "object" ? scheduler.lastTick : null;
  const signalTf = scheduler && (scheduler.signal_tf || scheduler.tf) || null;
  const pollMs = scheduler && scheduler.pollMs != null ? Number(scheduler.pollMs) : null;
  const schedulerManagedExternally = runtime && runtime.scheduler_managed_externally === true;
  const running = scheduler && scheduler.running === true;
  const lastTickMs = parseIsoMs(
    (lastTick && (lastTick.finished_at || lastTick.started_at))
    || ""
  );
  const slaMs = computeSchedulerSlaMs({ signalTf, pollMs });
  const ageMs = Number.isFinite(lastTickMs) ? (nowMs - lastTickMs) : null;

  let issueCode = null;
  let issueSeverity = null;
  if (!lastTick || !Number.isFinite(lastTickMs)) {
    issueCode = "SCHEDULER_LAST_TICK_MISSING";
    issueSeverity = "FAIL";
  } else if (Number.isFinite(ageMs) && ageMs > slaMs) {
    issueCode = "SCHEDULER_TICK_STALE";
    issueSeverity = "FAIL";
  } else if (schedulerManagedExternally !== true && running !== true) {
    issueCode = "SCHEDULER_NOT_RUNNING";
    issueSeverity = "WARN";
  }

  return {
    ...base,
    severity: issueSeverity || "PASS",
    reachable: true,
    signalTf: signalTf || null,
    pollMs: Number.isFinite(pollMs) ? pollMs : null,
    lastTickMs: Number.isFinite(lastTickMs) ? lastTickMs : null,
    lastTickIso: Number.isFinite(lastTickMs) ? new Date(lastTickMs).toISOString() : null,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    slaMs,
    schedulerManagedExternally,
    running,
    issueCode,
    issueSeverity,
  };
}

function shouldAttemptSchedulerRecovery(previous, issueSignature) {
  if (!issueSignature) return false;
  const lastAttemptMs = Number(previous && previous.last_scheduler_recovery_attempt_ms || 0);
  const lastSignature = String(previous && previous.last_scheduler_recovery_issue_signature || "");
  const nowMs = Date.now();
  if (!lastAttemptMs || (nowMs - lastAttemptMs) >= SCHEDULER_RECOVERY_MIN_INTERVAL_MS) return true;
  return lastSignature !== issueSignature;
}

async function attemptSchedulerRecovery({ baseUrl, token, timeoutMs }) {
  const actions = [];
  const firstTick = await triggerSchedulerTick({ baseUrl, token, timeoutMs });
  actions.push({
    id: "scheduler_tick_force",
    ok: !!firstTick.ok,
    statusCode: firstTick.statusCode || null,
    runId: firstTick.runId || null,
    reason: firstTick.reason || null,
  });
  if (firstTick.ok) {
    return { attempted: true, ok: true, reason: "TICK_RECOVERED", actions };
  }

  if (!shouldRestartLocalServer()) {
    return { attempted: true, ok: false, reason: "TICK_FAILED_RESTART_DISABLED", actions };
  }

  const restart = restartLocalServerLaunchd();
  actions.push({
    id: "local_server_kickstart",
    ok: !!restart.ok,
    label: restart.label || null,
    reason: restart.error || null,
  });
  if (!restart.ok) {
    return { attempted: true, ok: false, reason: "TICK_FAILED_RESTART_FAILED", actions };
  }

  await new Promise((resolve) => setTimeout(resolve, Math.max(500, parseNumber(process.env.AUTOMATION_WATCHDOG_RESTART_WAIT_MS, 3000))));
  const secondTick = await triggerSchedulerTick({ baseUrl, token, timeoutMs });
  actions.push({
    id: "scheduler_tick_retry",
    ok: !!secondTick.ok,
    statusCode: secondTick.statusCode || null,
    runId: secondTick.runId || null,
    reason: secondTick.reason || null,
  });
  return {
    attempted: true,
    ok: !!secondTick.ok,
    reason: secondTick.ok ? "TICK_RECOVERED_AFTER_RESTART" : "TICK_FAILED_AFTER_RESTART",
    actions,
  };
}

function isOpenClawAuthFailureRow(row) {
  if (!row || row.scheduler !== "OPENCLAW_CRON") return false;
  const status = String(row.lastStatus || "").trim().toLowerCase();
  const reason = String(row.lastErrorReason || "").trim().toLowerCase();
  const msg = String(row.lastError || "").trim().toLowerCase();
  if (status !== "error") return false;
  if (reason === "auth") return true;
  if (msg.includes("oauth token refresh failed")) return true;
  if (msg.includes("failed to refresh")) return true;
  return false;
}

function shouldAttemptOpenClawAuthRecovery(previous, signature) {
  if (!signature) return false;
  const lastAttemptMs = Number(previous && previous.last_openclaw_auth_recovery_attempt_ms || 0);
  const lastSignature = String(previous && previous.last_openclaw_auth_recovery_issue_signature || "");
  const nowMs = Date.now();
  if (!lastAttemptMs || (nowMs - lastAttemptMs) >= OPENCLAW_AUTH_RECOVERY_MIN_INTERVAL_MS) return true;
  return lastSignature !== signature;
}

function attemptOpenClawAuthRecovery({ rows = [] } = {}) {
  const actions = [];
  const doctor = execText("openclaw doctor --fix", { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  actions.push({
    id: "openclaw_doctor_fix",
    ok: !!doctor.ok,
    reason: doctor.ok ? null : String(doctor.error || "OPENCLAW_DOCTOR_FIX_FAILED"),
  });
  const gateway = execText("openclaw gateway install --force", { cwd: REPO_ROOT, maxBuffer: 4 * 1024 * 1024 });
  actions.push({
    id: "openclaw_gateway_install_force",
    ok: !!gateway.ok,
    reason: gateway.ok ? null : String(gateway.error || "OPENCLAW_GATEWAY_INSTALL_FAILED"),
  });
  for (const row of rows) {
    if (!row || !row.cronId) continue;
    const runRes = execJson(`openclaw cron run ${row.cronId} --expect-final --timeout 180000`, {
      cwd: REPO_ROOT,
      maxBuffer: 8 * 1024 * 1024,
    });
    actions.push({
      id: `openclaw_cron_run_${row.name || row.cronId}`,
      ok: !!runRes.ok,
      cronId: row.cronId,
      reason: runRes.ok ? null : String(runRes.error || "OPENCLAW_CRON_RUN_FAILED"),
    });
  }

  const cronRes = execJson("openclaw cron list --json", { cwd: REPO_ROOT, maxBuffer: 8 * 1024 * 1024 });
  if (!cronRes.ok) {
    return {
      attempted: true,
      ok: false,
      reason: "OPENCLAW_CRON_LIST_FAILED",
      actions,
      cronRes: null,
    };
  }
  const cronRows = parseOpenClawCronList(cronRes.data);
  let recovered = true;
  for (const row of rows) {
    if (!row || !row.name) continue;
    const live = cronRows.get(row.name);
    const st = String(live && live.state && (live.state.lastStatus || live.state.lastRunStatus) || "").trim().toLowerCase();
    const errN = Number(live && live.state && live.state.consecutiveErrors || 0);
    if (!(st === "ok" && errN === 0)) {
      recovered = false;
      break;
    }
  }
  return {
    attempted: true,
    ok: recovered,
    reason: recovered ? "OPENCLAW_AUTH_RECOVERED" : "OPENCLAW_AUTH_STILL_DEGRADED",
    actions,
    cronRes: cronRes.data,
  };
}

function buildIssueSignature(artifactRows, agentRows, extraRows = []) {
  const issues = [];
  for (const row of artifactRows) {
    if (row.issueCode) issues.push(`${row.issueSeverity}:${row.issueCode}`);
  }
  for (const row of agentRows) {
    if (row.issueCode) issues.push(`${row.issueSeverity}:${row.issueCode}`);
  }
  for (const row of extraRows) {
    if (row && row.issueCode) issues.push(`${row.issueSeverity}:${row.issueCode}`);
  }
  return issues.sort().join("|");
}

function computeVerdict(artifactRows, agentRows, extraRows = []) {
  const severities = [...artifactRows, ...agentRows, ...extraRows]
    .map((row) => row.issueSeverity)
    .filter(Boolean);
  if (severities.includes("FAIL")) return "FAIL";
  if (severities.includes("WARN")) return "WARN";
  return "PASS";
}

function normalizeRecoveryMode(raw) {
  const mode = String(raw || "").trim().toUpperCase();
  if (mode === "DETECT_ONLY" || mode === "REPORT_ONLY" || mode === "RECOVER_AND_REPORT") {
    return mode;
  }
  return "REPORT_ONLY";
}

function isRecoveryExecutionAllowed(mode, rawAllow) {
  if (normalizeRecoveryMode(mode) !== "RECOVER_AND_REPORT") return false;
  const flag = String(rawAllow || "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes" || flag === "on";
}

function buildSnapshot(artifactRows, agentRows, extraRows = []) {
  const issues = [
    ...artifactRows.filter((row) => row.issueCode).map((row) => ({ severity: row.issueSeverity, code: row.issueCode })),
    ...agentRows.filter((row) => row.issueCode).map((row) => ({ severity: row.issueSeverity, code: row.issueCode })),
    ...extraRows.filter((row) => row && row.issueCode).map((row) => ({ severity: row.issueSeverity, code: row.issueCode })),
  ];
  return {
    verdict: computeVerdict(artifactRows, agentRows, extraRows),
    issues,
    issueCount: issues.length,
    issueSignature: buildIssueSignature(artifactRows, agentRows, extraRows),
  };
}

function readArtifactReport(filePath) {
  return readJsonSafe(filePath, null);
}

function buildDataBackfillTriggers(artifactRows) {
  const triggers = [];
  for (const row of artifactRows) {
    if (!["analytics_local_cache_refresh", "signal_data_integrity", "stage_outcome_ledgers"].includes(row.name)) continue;
    if (row.issueCode) triggers.push(row.issueCode);
  }
  const integrityRow = artifactRows.find((row) => row.name === "signal_data_integrity");
  const integrityData = integrityRow && integrityRow.exists ? readArtifactReport(integrityRow.filePath) : null;
  if (integrityData && String(integrityData.verdict || "").trim().toUpperCase() === "WARN") {
    triggers.push("SIGNAL_DATA_INTEGRITY_WARN");
  }
  return Array.from(new Set(triggers));
}

function summarizeBackfillRecovery(report) {
  if (!report || typeof report !== "object") return null;
  const steps = Array.isArray(report.steps) ? report.steps : [];
  return {
    generated_at_kst: report.generated_at_kst || null,
    reason: String(report.reason || "").trim() || null,
    verdict: String(report.verdict || "").trim() || null,
    succeeded_n: Number(report.succeeded_n || 0),
    total_n: Number(report.total_n || 0),
    failed_step: (steps.find((row) => !row.ok) || {}).id || null,
    completed_steps: steps.filter((row) => row && row.ok).map((row) => String(row.id || "").trim()).filter(Boolean),
  };
}

function shouldAttemptBackfill(previous, triggerSignature) {
  if (!triggerSignature) return false;
  const lastAttemptMs = Number(previous && previous.last_backfill_attempt_ms || 0);
  const lastSignature = String(previous && previous.last_backfill_issue_signature || "");
  const nowMs = Date.now();
  if (!lastAttemptMs || (nowMs - lastAttemptMs) >= DATA_BACKFILL_MIN_INTERVAL_MS) return true;
  return lastSignature !== triggerSignature;
}

function renderMarkdown(report) {
  const preRecovery = report.pre_recovery || {
    verdict: report.verdict,
    issueCount: report.issue_count,
    issueSignature: report.issue_signature,
  };
  const postRecovery = report.post_recovery || null;
  const lines = [
    "# Automation Watchdog",
    "",
    `- 실행 시각: ${report.generated_at_kst}`,
    `- recovery_mode: ${report.recovery_mode || "REPORT_ONLY"}`,
    `- verdict: ${preRecovery.verdict}`,
    `- issue_count: ${preRecovery.issueCount}`,
  ];
  if (report.data_backfill_recovery && report.data_backfill_recovery.attempted) {
    lines.push(`- data_backfill_recovery: ${report.data_backfill_recovery.ok ? "OK" : `FAIL (${report.data_backfill_recovery.error})`}`);
    lines.push(`- backfill_reason: ${report.data_backfill_recovery.reason || "N/A"}`);
    if (report.data_backfill_recovery.summary) {
      lines.push(`- backfill_steps: ${report.data_backfill_recovery.summary.succeeded_n}/${report.data_backfill_recovery.summary.total_n}`);
      lines.push(`- backfill_latest: ${report.data_backfill_recovery.summary.generated_at_kst || "N/A"}`);
    }
    if (postRecovery) {
      lines.push(`- pre_recovery_verdict: ${preRecovery.verdict} (${preRecovery.issueCount})`);
      lines.push(`- post_recovery_verdict: ${postRecovery.verdict} (${postRecovery.issueCount})`);
    }
  }
  if (report.scheduler_tick_recovery && report.scheduler_tick_recovery.attempted) {
    lines.push(`- scheduler_tick_recovery: ${report.scheduler_tick_recovery.ok ? "OK" : "FAIL"}`);
    lines.push(`- scheduler_tick_recovery_reason: ${report.scheduler_tick_recovery.reason || "N/A"}`);
    lines.push(`- scheduler_tick_recovery_steps: ${Array.isArray(report.scheduler_tick_recovery.actions) ? report.scheduler_tick_recovery.actions.length : 0}`);
  }
  if (report.openclaw_auth_recovery && report.openclaw_auth_recovery.attempted) {
    lines.push(`- openclaw_auth_recovery: ${report.openclaw_auth_recovery.ok ? "OK" : "FAIL"}`);
    lines.push(`- openclaw_auth_recovery_reason: ${report.openclaw_auth_recovery.reason || "N/A"}`);
    lines.push(`- openclaw_auth_recovery_steps: ${Array.isArray(report.openclaw_auth_recovery.actions) ? report.openclaw_auth_recovery.actions.length : 0}`);
    lines.push(`- openclaw_auth_affected_jobs: ${Array.isArray(report.openclaw_auth_recovery.affected_jobs) && report.openclaw_auth_recovery.affected_jobs.length ? report.openclaw_auth_recovery.affected_jobs.join(", ") : "none"}`);
  }
  lines.push("", "## Artifacts");
  for (const row of report.artifacts) {
    lines.push(`- ${row.name}: ${row.exists ? (row.fresh ? "fresh" : "stale") : "missing"} / age=${row.ageHours == null ? "N/A" : row.ageHours.toFixed(2)}h / max=${row.maxAgeHours}h`);
  }
  lines.push(`- scheduler_mode: ${report.scheduler_mode || "UNKNOWN"}`);
  lines.push("", "## Automation Scheduler");
  for (const row of report.scheduler_jobs || []) {
    lines.push(`- ${row.name}: ${row.configured ? (row.enabled ? "enabled" : "disabled") : "missing"} / last=${row.lastStatus || "N/A"} / next=${row.nextRunAtMs == null ? "N/A" : row.nextRunAtMs}`);
  }
  lines.push("", "## Scheduler Tick SLA");
  const sla = report.scheduler_tick_sla || {};
  lines.push(`- status: ${sla.issueCode ? `${sla.issueSeverity || "FAIL"} / ${sla.issueCode}` : "PASS"}`);
  lines.push(`- base_url: ${sla.baseUrl || "N/A"} / http_status=${sla.statusCode == null ? "N/A" : sla.statusCode}`);
  lines.push(`- signal_tf: ${sla.signalTf || "N/A"} / poll_ms=${sla.pollMs == null ? "N/A" : sla.pollMs}`);
  lines.push(`- last_tick: ${sla.lastTickIso || "N/A"} / age_ms=${sla.ageMs == null ? "N/A" : sla.ageMs} / sla_ms=${sla.slaMs == null ? "N/A" : sla.slaMs}`);
  if (report.scheduler_tick_sla_post_recovery) {
    const slaPost = report.scheduler_tick_sla_post_recovery || {};
    lines.push(`- post_recovery: ${slaPost.issueCode ? `${slaPost.issueSeverity || "FAIL"} / ${slaPost.issueCode}` : "PASS"} / age_ms=${slaPost.ageMs == null ? "N/A" : slaPost.ageMs}`);
  }
  lines.push("", "## Legacy Launchd (diagnostic only)");
  for (const row of report.launchd_legacy || []) {
    lines.push(`- ${row.label}: ${row.loaded ? "loaded" : "missing"} / exit=${row.lastExit == null ? "N/A" : row.lastExit} / pid=${row.pid == null ? "-" : row.pid}`);
  }
  lines.push("", "## Issues");
  if (report.issues.length) {
    for (const row of report.issues) lines.push(`- [${row.severity}] ${row.code}`);
  } else {
    lines.push("- none");
  }
  if (postRecovery && Array.isArray(report.issues_post_recovery)) {
    lines.push("", "## Post Recovery Issues");
    if (report.issues_post_recovery.length) {
      for (const row of report.issues_post_recovery) lines.push(`- [${row.severity}] ${row.code}`);
    } else {
      lines.push("- none");
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const meta = nowKstMeta();
  const cronRes = execJson("openclaw cron list --json");
  const launchctlRes = execText("launchctl list");
  const launchctlRows = parseLaunchctlList(launchctlRes.ok ? launchctlRes.text : "");
  const cronRows = parseOpenClawCronList(cronRes.ok ? cronRes.data : null);
  const schedulerMode = cronRes.ok ? "OPENCLAW_CRON" : "LAUNCHD_FALLBACK";
  const previous = readJsonSafe(STATE_PATH, { last_verdict: "PASS", last_issue_signature: "" }) || { last_verdict: "PASS", last_issue_signature: "" };
  const recoveryMode = normalizeRecoveryMode(process.env.AUTOMATION_WATCHDOG_RECOVERY_MODE || "REPORT_ONLY");
  const recoveryAllowed = isRecoveryExecutionAllowed(recoveryMode, process.env.AUTOMATION_WATCHDOG_ALLOW_RECOVERY);

  const artifactRows = ARTIFACT_SPECS.map(assessArtifact);
  let schedulerRows = AUTOMATION_SPECS.map((spec) => (
    schedulerMode === "OPENCLAW_CRON"
      ? assessSchedulerJob(spec, cronRows)
      : assessLaunchdPresence(spec, launchctlRows)
  ));
  schedulerRows = reconcileSchedulerRowsWithArtifacts(schedulerRows, artifactRows);
  const launchdLegacyRows = AUTOMATION_SPECS.map((spec) => assessLaunchdPresence(spec, launchctlRows));

  const schedulerBaseUrl = resolveSchedulerBaseUrl();
  const schedulerTimeoutMs = resolveSchedulerTimeoutMs();
  const schedulerToken = String(process.env.SCHEDULER_TOKEN || "").trim();
  const schedulerStatusPre = await fetchSchedulerStatus({
    baseUrl: schedulerBaseUrl,
    token: schedulerToken || null,
    timeoutMs: schedulerTimeoutMs,
  });
  const schedulerTickSla = assessSchedulerTickSla(schedulerStatusPre);
  const preSnapshot = buildSnapshot(artifactRows, schedulerRows, [schedulerTickSla]);
  const openClawAuthFailureRows = schedulerRows.filter((row) => isOpenClawAuthFailureRow(row));
  const openClawAuthIssueSignature = openClawAuthFailureRows
    .map((row) => `${row.name || row.label || "UNKNOWN"}:${row.cronId || "NO_ID"}`)
    .sort()
    .join("|");
  const allowOpenClawAuthRecovery = recoveryAllowed || OPENCLAW_AUTH_RECOVERY_ALWAYS_ON;

  let postArtifactRows = artifactRows;
  let postSchedulerRows = schedulerRows;
  let postSchedulerTickSla = schedulerTickSla;
  let postSnapshot = null;
  let openclawAuthRecovery = {
    mode: recoveryMode,
    allowed: allowOpenClawAuthRecovery,
    attempted: false,
    ok: null,
    reason: null,
    affected_jobs: openClawAuthFailureRows.map((row) => row.name),
    actions: [],
  };

  let backfillRecovery = {
    mode: recoveryMode,
    allowed: recoveryAllowed,
    attempted: false,
    ok: null,
    reason: null,
    error: null,
    summary: null,
  };
  const backfillTriggers = buildDataBackfillTriggers(artifactRows);
  const backfillTriggerSignature = backfillTriggers.sort().join("|");
  if (recoveryAllowed && shouldAttemptBackfill(previous, backfillTriggerSignature) && fs.existsSync(DATA_BACKFILL_SCRIPT)) {
    const recoveryRes = execText(`DATA_BACKFILL_REASON='${backfillTriggerSignature}' '${DATA_BACKFILL_SCRIPT}'`, {
      cwd: REPO_ROOT,
      maxBuffer: 30 * 1024 * 1024,
    });
    const latestRecovery = summarizeBackfillRecovery(readArtifactReport(DATA_BACKFILL_LATEST_JSON));
    backfillRecovery = {
      mode: recoveryMode,
      allowed: recoveryAllowed,
      attempted: true,
      ok: !!recoveryRes.ok,
      reason: backfillTriggerSignature,
      error: recoveryRes.ok ? null : String(recoveryRes.error || "BACKFILL_EXEC_FAILED"),
      summary: latestRecovery,
    };
    postArtifactRows = ARTIFACT_SPECS.map(assessArtifact);
    postSchedulerRows = AUTOMATION_SPECS.map((spec) => (
      schedulerMode === "OPENCLAW_CRON"
        ? assessSchedulerJob(spec, cronRows)
        : assessLaunchdPresence(spec, launchctlRows)
    ));
    postSchedulerRows = reconcileSchedulerRowsWithArtifacts(postSchedulerRows, postArtifactRows);
  }

  if (allowOpenClawAuthRecovery && openClawAuthFailureRows.length > 0 && shouldAttemptOpenClawAuthRecovery(previous, openClawAuthIssueSignature)) {
    openclawAuthRecovery = attemptOpenClawAuthRecovery({ rows: openClawAuthFailureRows });
    if (openclawAuthRecovery && openclawAuthRecovery.cronRes) {
      const refreshedCronRows = parseOpenClawCronList(openclawAuthRecovery.cronRes);
      postSchedulerRows = AUTOMATION_SPECS.map((spec) => (
        schedulerMode === "OPENCLAW_CRON"
          ? assessSchedulerJob(spec, refreshedCronRows)
          : assessLaunchdPresence(spec, launchctlRows)
      ));
      postSchedulerRows = reconcileSchedulerRowsWithArtifacts(postSchedulerRows, postArtifactRows);
    }
  }

  const schedulerIssueSignature = schedulerTickSla && schedulerTickSla.issueCode
    ? `SLA:${schedulerTickSla.issueCode}`
    : "";
  let schedulerTickRecovery = {
    mode: recoveryMode,
    allowed: recoveryAllowed,
    attempted: false,
    ok: null,
    reason: null,
    actions: [],
  };
  if (recoveryAllowed && shouldAttemptSchedulerRecovery(previous, schedulerIssueSignature)) {
    if (schedulerTickSla && schedulerTickSla.issueCode) {
      schedulerTickRecovery = await attemptSchedulerRecovery({
        baseUrl: schedulerBaseUrl,
        token: schedulerToken || null,
        timeoutMs: schedulerTimeoutMs,
      });
      const schedulerStatusPost = await fetchSchedulerStatus({
        baseUrl: schedulerBaseUrl,
        token: schedulerToken || null,
        timeoutMs: schedulerTimeoutMs,
      });
      postSchedulerTickSla = assessSchedulerTickSla(schedulerStatusPost);
    }
  }

  const anyRecoveryAttempted = Boolean(backfillRecovery.attempted || schedulerTickRecovery.attempted || openclawAuthRecovery.attempted);
  if (anyRecoveryAttempted) {
    postSnapshot = buildSnapshot(postArtifactRows, postSchedulerRows, [postSchedulerTickSla]);
  }

  const report = {
    generated_at_kst: meta.kst,
    scheduler_mode: schedulerMode,
    scheduler_ok: !!cronRes.ok,
    recovery_mode: recoveryMode,
    recovery_allowed: recoveryAllowed,
    verdict: preSnapshot.verdict,
    issue_count: preSnapshot.issueCount,
    issue_signature: preSnapshot.issueSignature,
    scheduler_status_probe: {
      base_url: schedulerBaseUrl,
      timeout_ms: schedulerTimeoutMs,
      token_present: !!schedulerToken,
      status_code: schedulerStatusPre && schedulerStatusPre.statusCode || null,
      ok: !!(schedulerStatusPre && schedulerStatusPre.ok),
    },
    data_backfill_recovery: backfillRecovery,
    openclaw_auth_recovery: openclawAuthRecovery,
    scheduler_tick_recovery: schedulerTickRecovery,
    scheduler_tick_sla: schedulerTickSla,
    scheduler_tick_sla_post_recovery: anyRecoveryAttempted ? postSchedulerTickSla : null,
    artifacts: artifactRows,
    scheduler_jobs: schedulerRows,
    launchd_legacy: launchdLegacyRows,
    artifacts_post_recovery: anyRecoveryAttempted ? postArtifactRows : null,
    scheduler_jobs_post_recovery: anyRecoveryAttempted ? postSchedulerRows : null,
    issues: preSnapshot.issues,
    issues_post_recovery: postSnapshot ? postSnapshot.issues : null,
    pre_recovery: preSnapshot,
    post_recovery: postSnapshot,
    previous: previous,
  };

  const base = `${meta.dateKey}_${meta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_automation_watchdog.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_automation_watchdog.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  const shouldAlert = recoveryMode !== "DETECT_ONLY"
    && (preSnapshot.verdict !== "PASS" || String(previous.last_verdict || "") !== "PASS");
  if (shouldAlert) {
    const alertResult = await sendKoreanTelegramSummary({
      title: `[자동화 상태 점검] ${preSnapshot.verdict}`,
      severity: preSnapshot.verdict === "FAIL" ? "WARN" : "INFO",
      dedupeKey: `automation_watchdog:${preSnapshot.verdict}:${preSnapshot.issueSignature || "PASS"}`,
      dedupeWindowSec: 6 * 60 * 60,
      dedupeFingerprint: JSON.stringify({ verdict: preSnapshot.verdict, issueSignature: preSnapshot.issueSignature }),
      sections: [
        {
          header: "전체 상태",
          lines: [
            `자동화 전체 상태는 ${preSnapshot.verdict} 입니다.`,
            `문제가 잡힌 항목은 ${preSnapshot.issueCount}건입니다.`,
            `복구 모드는 ${recoveryMode} 입니다.`,
          ],
        },
        {
          header: "핵심 이슈",
          lines: preSnapshot.issues.length ? preSnapshot.issues.slice(0, 6).map((row) => `[${row.severity}] ${row.code}`) : ["지금은 바로 조치할 이슈가 없습니다."],
        },
        {
          header: "스케줄러 Tick SLA",
          lines: [
            `상태: ${schedulerTickSla.issueCode ? `${schedulerTickSla.issueSeverity || "FAIL"} / ${schedulerTickSla.issueCode}` : "PASS"}`,
            `기준 URL: ${schedulerBaseUrl}`,
            `최근 tick: ${schedulerTickSla.lastTickIso || "정보 없음"} / age_ms=${schedulerTickSla.ageMs == null ? "정보 없음" : schedulerTickSla.ageMs} / sla_ms=${schedulerTickSla.slaMs == null ? "정보 없음" : schedulerTickSla.slaMs}`,
          ],
        },
        ...(backfillRecovery && backfillRecovery.attempted ? [{
          header: "백필 복구",
          lines: [
            `복구 발동 이유: ${backfillRecovery.reason || "정보 없음"}`,
            `복구 결과: ${backfillRecovery.ok ? "정상적으로 끝났습니다." : `실패했습니다. (${backfillRecovery.error || "원인 불명"})`}`,
            `완료된 단계 수: ${backfillRecovery.summary ? `${backfillRecovery.summary.succeeded_n}/${backfillRecovery.summary.total_n}` : "정보 없음"}`,
            `복구 전 verdict: ${preSnapshot.verdict} (${preSnapshot.issueCount}건)`,
            ...(postSnapshot ? [`복구 후 verdict: ${postSnapshot.verdict} (${postSnapshot.issueCount}건)`] : []),
            ...(backfillRecovery.summary && backfillRecovery.summary.failed_step ? [`실패한 단계: ${backfillRecovery.summary.failed_step}`] : []),
          ],
        }] : []),
        ...(schedulerTickRecovery && schedulerTickRecovery.attempted ? [{
          header: "스케줄러 자동 복구",
          lines: [
            `복구 결과: ${schedulerTickRecovery.ok ? "정상적으로 끝났습니다." : "복구에 실패했습니다."}`,
            `복구 사유: ${schedulerTickRecovery.reason || "정보 없음"}`,
            ...((schedulerTickRecovery.actions || []).slice(0, 4).map((row) => `${row.id}: ${row.ok ? "OK" : `FAIL (${row.reason || "오류"})`}`)),
            ...(postSnapshot ? [`복구 후 verdict: ${postSnapshot.verdict} (${postSnapshot.issueCount}건)`] : []),
          ],
        }] : []),
        ...(openclawAuthRecovery && openclawAuthRecovery.attempted ? [{
          header: "OpenClaw 인증 복구",
          lines: [
            `대상 잡 수: ${Array.isArray(openclawAuthRecovery.affected_jobs) ? openclawAuthRecovery.affected_jobs.length : 0}`,
            `복구 결과: ${openclawAuthRecovery.ok ? "정상적으로 끝났습니다." : "복구에 실패했습니다."}`,
            `복구 사유: ${openclawAuthRecovery.reason || "정보 없음"}`,
            ...((openclawAuthRecovery.actions || []).slice(0, 6).map((row) => `${row.id}: ${row.ok ? "OK" : `FAIL (${row.reason || "오류"})`}`)),
            ...(postSnapshot ? [`복구 후 verdict: ${postSnapshot.verdict} (${postSnapshot.issueCount}건)`] : []),
          ],
        }] : []),
      ],
    });
    if (!alertResult || (alertResult.ok !== true && !alertResult.skipped && !(alertResult.skipped && alertResult.reason === "DEDUPED"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alertResult || {})}`);
    }
  }

  writeJson(STATE_PATH, {
    last_verdict: preSnapshot.verdict,
    last_issue_signature: preSnapshot.issueSignature,
    last_backfill_attempt_ms: backfillRecovery && backfillRecovery.attempted ? Date.now() : Number(previous.last_backfill_attempt_ms || 0),
    last_backfill_issue_signature: backfillRecovery && backfillRecovery.attempted ? backfillTriggerSignature : String(previous.last_backfill_issue_signature || ""),
    last_scheduler_recovery_attempt_ms: schedulerTickRecovery && schedulerTickRecovery.attempted ? Date.now() : Number(previous.last_scheduler_recovery_attempt_ms || 0),
    last_scheduler_recovery_issue_signature: schedulerTickRecovery && schedulerTickRecovery.attempted ? schedulerIssueSignature : String(previous.last_scheduler_recovery_issue_signature || ""),
    last_openclaw_auth_recovery_attempt_ms: openclawAuthRecovery && openclawAuthRecovery.attempted ? Date.now() : Number(previous.last_openclaw_auth_recovery_attempt_ms || 0),
    last_openclaw_auth_recovery_issue_signature: openclawAuthRecovery && openclawAuthRecovery.attempted ? openClawAuthIssueSignature : String(previous.last_openclaw_auth_recovery_issue_signature || ""),
    last_generated_at_kst: meta.kst,
  });

  // Keep server_signal_runtime_latest in sync with the most recent watchdog verdict.
  const runtimeRefresh = execText(`'${process.execPath}' '${path.join(REPO_ROOT, "scripts", "report-server-signal-runtime.js")}'`, {
    cwd: REPO_ROOT,
    maxBuffer: 4 * 1024 * 1024,
  });

  console.log(JSON.stringify({
    ok: true,
    verdict: preSnapshot.verdict,
    issue_count: preSnapshot.issueCount,
    runtime_refresh_ok: !!runtimeRefresh.ok,
    jsonPath,
    mdPath,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-automation-watchdog failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    __test: {
      ARTIFACT_SPECS,
      AUTOMATION_SPECS,
      parseLaunchctlList,
      parseOpenClawCronList,
      assessSchedulerJob,
      assessLaunchdPresence,
      reconcileSchedulerRowsWithArtifacts,
      computeVerdict,
      buildIssueSignature,
      normalizeRecoveryMode,
      isRecoveryExecutionAllowed,
      buildSnapshot,
      computeSchedulerSlaMs,
      assessSchedulerTickSla,
      shouldAttemptSchedulerRecovery,
      isOpenClawAuthFailureRow,
      shouldAttemptOpenClawAuthRecovery,
    },
  };
}
