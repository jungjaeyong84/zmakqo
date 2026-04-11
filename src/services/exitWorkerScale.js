"use strict";

const { getFirestore } = require("../storage/firestore");
const { getExchangeSettingsForProvider } = require("../utils/exchangeSettings");
const { listExchangePositionReadViews } = require("./positionReadModel");

const DYNAMIC_SCALE_ENABLED = String(process.env.TICK_EXIT_DYNAMIC_SCALE_ENABLED || "1") !== "0";
const EXIT_WORKER_SERVICE = String(process.env.EXIT_WORKER_SERVICE || "donbeolja-exit-worker").trim();
const EXIT_WORKER_REGION = String(process.env.EXIT_WORKER_REGION || "asia-northeast3").trim();
const EXIT_WORKER_PROJECT = String(
  process.env.EXIT_WORKER_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || ""
).trim();
const IDLE_OFF_MINUTES = Math.max(1, Math.floor(Number(process.env.TICK_EXIT_IDLE_OFF_MINUTES || 20)));
const OFF_HYSTERESIS_MINUTES = Math.max(1, Math.floor(Number(process.env.TICK_EXIT_OFF_HYSTERESIS_MINUTES || 10)));
const SCALE_STATE_DOC = "runtime/tick_exit_scale_state";
const ON_MIN_INSTANCES = Math.max(1, Math.floor(Number(process.env.TICK_EXIT_WORKER_MIN_ON || 1)));
const OFF_MIN_INSTANCES = 0;
const ACCESS_TOKEN_TTL_BUFFER_MS = 10 * 1000;
const TOKEN_ENDPOINT = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const SCALE_PATCH_RETRY_MAX = Math.max(1, Math.floor(Number(process.env.TICK_EXIT_SCALE_PATCH_RETRY_MAX || 3)));
const SCALE_PATCH_RETRY_BACKOFF_MS = Math.max(50, Math.floor(Number(process.env.TICK_EXIT_SCALE_PATCH_RETRY_BACKOFF_MS || 120)));

let tokenCache = { token: null, expiresAt: 0 };
let lastScaleActionAt = 0;
let lastScaleActionTo = null;

function nowMs() {
  return Date.now();
}

function isRunnable() {
  if (!DYNAMIC_SCALE_ENABLED) return false;
  if (!EXIT_WORKER_PROJECT || !EXIT_WORKER_REGION || !EXIT_WORKER_SERVICE) return false;
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRunConflictError(err) {
  const msg = String((err && err.message) || err || "").toUpperCase();
  return msg.includes("RUN_SERVICE_PATCH_FAIL_409") || msg.includes("CONFLICT FOR RESOURCE");
}

async function fetchAccessToken() {
  const now = nowMs();
  if (tokenCache.token && Number.isFinite(tokenCache.expiresAt) && (now + ACCESS_TOKEN_TTL_BUFFER_MS) < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "GET",
    headers: { "Metadata-Flavor": "Google" },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GCP_METADATA_TOKEN_FAIL_${res.status}: ${text.slice(0, 200)}`);
  const json = text ? JSON.parse(text) : null;
  const token = String(json && json.access_token || "");
  const expiresIn = Number(json && json.expires_in);
  if (!token) throw new Error("GCP_METADATA_TOKEN_EMPTY");
  tokenCache = {
    token,
    expiresAt: now + (Number.isFinite(expiresIn) ? (expiresIn * 1000) : 300000),
  };
  return token;
}

function runServiceUrl() {
  const project = encodeURIComponent(EXIT_WORKER_PROJECT);
  const region = encodeURIComponent(EXIT_WORKER_REGION);
  const service = encodeURIComponent(EXIT_WORKER_SERVICE);
  return `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${service}`;
}

function parseJsonSafe(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

function extractMinInstanceCount(serviceJson) {
  const serviceMinRaw = Number(serviceJson && serviceJson.scaling && serviceJson.scaling.minInstanceCount);
  const templateMinRaw = Number(serviceJson && serviceJson.template && serviceJson.template.scaling && serviceJson.template.scaling.minInstanceCount);
  if (Number.isFinite(serviceMinRaw)) return { value: Math.max(0, Math.round(serviceMinRaw)), source: "service.scaling.minInstanceCount" };
  if (Number.isFinite(templateMinRaw)) return { value: Math.max(0, Math.round(templateMinRaw)), source: "template.scaling.minInstanceCount" };
  return { value: 0, source: "default_zero" };
}

function isLatestTrafficTarget(target) {
  if (!target || typeof target !== "object") return false;
  const type = String(target.type || "").toUpperCase();
  const latestRevision = target.latestRevision === true;
  return latestRevision || type === "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST";
}

function needsTrafficLatestRepair(serviceJson) {
  const traffic = Array.isArray(serviceJson && serviceJson.traffic) ? serviceJson.traffic : [];
  if (traffic.length !== 1) return true;
  const first = traffic[0] || {};
  const percent = Number(first.percent);
  if (!Number.isFinite(percent) || Math.round(percent) !== 100) return true;
  return !isLatestTrafficTarget(first);
}

async function fetchWorkerServiceState() {
  const token = await fetchAccessToken();
  const res = await fetch(runServiceUrl(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RUN_SERVICE_GET_FAIL_${res.status}: ${text.slice(0, 300)}`);
  const json = parseJsonSafe(text) || {};
  const extracted = extractMinInstanceCount(json);
  return { minInstanceCount: extracted.value, minSource: extracted.source, raw: json };
}

async function patchWorkerMinInstances(minInstanceCount) {
  const desired = Math.max(0, Math.round(Number(minInstanceCount) || 0));
  const token = await fetchAccessToken();
  const patchSteps = [
    {
      mode: "SERVICE_SCALING",
      updateMask: "scaling.min_instance_count",
      body: { scaling: { minInstanceCount: desired } },
    },
    {
      // Fallback for older API behavior. This path creates a new revision.
      mode: "TEMPLATE_SCALING_FALLBACK",
      updateMask: "template.scaling.min_instance_count",
      body: { template: { scaling: { minInstanceCount: desired } } },
    },
  ];

  let lastErr = null;
  for (const step of patchSteps) {
    const url = runServiceUrl() + `?update_mask=${encodeURIComponent(step.updateMask)}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(step.body),
    });
    const text = await res.text();
    if (res.ok) {
      lastScaleActionAt = nowMs();
      lastScaleActionTo = desired;
      return { ok: true, desired, mode: step.mode, operation: parseJsonSafe(text) };
    }

    const errMsg = `RUN_SERVICE_PATCH_FAIL_${res.status}: ${String(text || "").slice(0, 400)}`;
    lastErr = new Error(errMsg);

    // Only fall back on schema-level incompatibility errors.
    const upper = String(text || "").toUpperCase();
    const fallbackCandidate = res.status === 400 && (
      upper.includes("UNKNOWN FIELD") ||
      upper.includes("CANNOT FIND FIELD") ||
      upper.includes("INVALID JSON PAYLOAD")
    );
    if (!fallbackCandidate) break;
  }

  throw lastErr || new Error("RUN_SERVICE_PATCH_FAIL_UNKNOWN");
}

async function patchWorkerTrafficToLatest() {
  const token = await fetchAccessToken();
  const url = runServiceUrl() + "?update_mask=traffic";
  const body = {
    traffic: [
      {
        type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
        percent: 100,
      },
    ],
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RUN_TRAFFIC_PATCH_FAIL_${res.status}: ${String(text || "").slice(0, 400)}`);
  return { ok: true, operation: parseJsonSafe(text) };
}

async function countActiveBinancePositions() {
  const exCfg = await getExchangeSettingsForProvider("BINANCEFUT", 5000);
  const markets = Array.isArray(exCfg && exCfg.markets) ? exCfg.markets : [];
  const positions = await listExchangePositionReadViews({
    exchange: "BINANCEFUT",
    limit: 500,
  }).catch(() => []);
  let count = 0;
  let scanned = 0;
  for (const pos of positions) {
    scanned += 1;
    const size = Number(pos.size_pct);
    const state = String(pos.position_state || pos.state || "").toUpperCase();
    if (Number.isFinite(size) && size > 0 && state !== "FLAT") count += 1;
  }
  return { count, marketCount: markets.length, scanned };
}

async function readScaleState() {
  const db = getFirestore();
  const snap = await db.doc(SCALE_STATE_DOC).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function writeScaleState(patch = {}) {
  const db = getFirestore();
  await db.doc(SCALE_STATE_DOC).set({
    ...patch,
    updated_at: new Date().toISOString(),
  }, { merge: true });
}

async function ensureMinInstances(desired, reason) {
  if (lastScaleActionTo === desired && (nowMs() - lastScaleActionAt) < 5000) {
    return { ok: true, changed: false, desired, current: desired, reason: `${reason || "NO_REASON"}_RECENT_SAME_TARGET` };
  }

  const current = await fetchWorkerServiceState();
  if (needsTrafficLatestRepair(current.raw)) {
    await patchWorkerTrafficToLatest();
  }
  if (current.minInstanceCount === desired) {
    return { ok: true, changed: false, desired, current: current.minInstanceCount, reason };
  }

  let changed = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= SCALE_PATCH_RETRY_MAX; attempt += 1) {
    try {
      changed = await patchWorkerMinInstances(desired);
      break;
    } catch (e) {
      lastErr = e;
      if (!isRunConflictError(e) || attempt >= SCALE_PATCH_RETRY_MAX) break;
      try {
        const latest = await fetchWorkerServiceState();
        if (latest.minInstanceCount === desired) {
          return {
            ok: true,
            changed: false,
            desired,
            current: latest.minInstanceCount,
            reason: `${reason || "NO_REASON"}_CONFLICT_RECONCILED`,
          };
        }
      } catch (_) {
        // ignore read error and continue retry
      }
      await sleep(SCALE_PATCH_RETRY_BACKOFF_MS * attempt);
    }
  }
  if (!changed) throw lastErr || new Error("RUN_SERVICE_PATCH_FAIL_UNKNOWN");

  await writeScaleState({
    last_scale_reason: reason || null,
    last_scale_to: desired,
    last_scale_action_at_ms: nowMs(),
  });
  return { ok: true, changed: true, desired, current: current.minInstanceCount, reason, operation: changed.operation || null };
}

async function ensureExitWorkerOn({ reason } = {}) {
  if (!isRunnable()) return { ok: false, skipped: true, reason: "DYNAMIC_SCALE_DISABLED_OR_MISCONFIGURED" };
  await writeScaleState({
    last_active_ms: nowMs(),
    last_scale_reason: reason || "ENTRY_ACTIVITY",
  });
  return ensureMinInstances(ON_MIN_INSTANCES, reason || "ENTRY_ACTIVITY");
}

async function ensureExitWorkerOffIfIdle({ reason } = {}) {
  if (!isRunnable()) return { ok: false, skipped: true, reason: "DYNAMIC_SCALE_DISABLED_OR_MISCONFIGURED" };

  const now = nowMs();
  const active = await countActiveBinancePositions();
  const state = await readScaleState();
  const lastActiveMsRaw = Number(state.last_active_ms);
  const lastOffMsRaw = Number(state.last_off_ms);
  const lastActiveMs = Number.isFinite(lastActiveMsRaw) ? lastActiveMsRaw : now;
  const lastOffMs = Number.isFinite(lastOffMsRaw) ? lastOffMsRaw : 0;
  const idleOffMs = IDLE_OFF_MINUTES * 60 * 1000;
  const offHysteresisMs = OFF_HYSTERESIS_MINUTES * 60 * 1000;

  if (active.count > 0) {
    await writeScaleState({
      last_active_ms: now,
      active_positions: active.count,
      active_markets: active.marketCount,
    });
    return ensureMinInstances(ON_MIN_INSTANCES, reason || "ACTIVE_POSITION");
  }

  await writeScaleState({
    active_positions: active.count,
    active_markets: active.marketCount,
  });

  if ((now - lastActiveMs) < idleOffMs) {
    return { ok: true, changed: false, desired: ON_MIN_INSTANCES, current: ON_MIN_INSTANCES, reason: "IDLE_GRACE" };
  }
  if ((now - lastOffMs) < offHysteresisMs) {
    return { ok: true, changed: false, desired: OFF_MIN_INSTANCES, current: OFF_MIN_INSTANCES, reason: "OFF_HYSTERESIS" };
  }
  const result = await ensureMinInstances(OFF_MIN_INSTANCES, reason || "IDLE_OFF");
  await writeScaleState({ last_off_ms: now });
  return result;
}

module.exports = {
  ensureExitWorkerOn,
  ensureExitWorkerOffIfIdle,
  __test: {
    countActiveBinancePositions,
    isRunnable,
  },
};
