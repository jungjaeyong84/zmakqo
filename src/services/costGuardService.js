const { getFirestore } = require("../storage/firestore");

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(v, fallback = 0, min = 0) {
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, n);
}

function nowIso() {
  return new Date().toISOString();
}

function buildSinceIso(lookbackMin) {
  const mins = toInt(lookbackMin, 15, 1);
  const ms = Date.now() - (mins * 60 * 1000);
  return new Date(ms).toISOString();
}

async function fetchJson(url, opts = {}) {
  const timeoutMs = toInt(opts.timeoutMs, 15000, 1000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: opts.headers || {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    const txt = await res.text();
    let json = null;
    try {
      json = txt ? JSON.parse(txt) : {};
    } catch (_) {
      json = { raw: txt };
    }
    if (!res.ok) {
      const msg = (json && (json.error?.message || json.message)) || txt || `HTTP_${res.status}`;
      throw new Error(msg);
    }
    return json || {};
  } finally {
    clearTimeout(timer);
  }
}

async function getMetadataAccessToken() {
  const tokenResp = await fetchJson(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    {
      headers: { "Metadata-Flavor": "Google" },
      timeoutMs: 5000,
    }
  );
  const token = String(tokenResp && tokenResp.access_token || "");
  if (!token) throw new Error("NO_METADATA_ACCESS_TOKEN");
  return token;
}

async function gcpPostJson(url, body, timeoutMs = 20000) {
  const token = await getMetadataAccessToken();
  return fetchJson(url, {
    method: "POST",
    timeoutMs,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

function parseBqScalar(resp) {
  const rows = Array.isArray(resp && resp.rows) ? resp.rows : [];
  if (!rows.length) return 0;
  const first = rows[0];
  const fields = Array.isArray(first && first.f) ? first.f : [];
  if (!fields.length) return 0;
  const raw = fields[0] && fields[0].v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function queryTodayFirestoreCostKrw({ projectId, billingExportTable }) {
  const query =
    `SELECT COALESCE(ROUND(SUM(cost),2), 0) AS cost_krw ` +
    `FROM \`${billingExportTable}\` ` +
    `WHERE sku.description IN ('Cloud Firestore Read Ops Seoul','Cloud Firestore Internet Data Transfer Out from APAC to APAC') ` +
    `AND DATE(usage_start_time, 'Asia/Seoul') = CURRENT_DATE('Asia/Seoul')`;

  const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`;
  const resp = await gcpPostJson(url, { query, useLegacySql: false, timeoutMs: 20000 }, 30000);
  return parseBqScalar(resp);
}

async function countLogs({ projectId, filter, pageSize = 1000, maxPages = 20 }) {
  let total = 0;
  let token = "";
  for (let i = 0; i < maxPages; i += 1) {
    const body = {
      resourceNames: [`projects/${projectId}`],
      filter,
      pageSize,
      pageToken: token || undefined,
      orderBy: "timestamp desc",
    };
    const resp = await gcpPostJson("https://logging.googleapis.com/v2/entries:list", body, 30000);
    const entries = Array.isArray(resp && resp.entries) ? resp.entries : [];
    total += entries.length;
    token = String(resp && resp.nextPageToken || "");
    if (!token) break;
  }
  return total;
}

async function applyForceOpenUntil({ forceOpenMs, reason, context }) {
  const db = getFirestore();
  const ref = db.collection("settings").doc("system");
  const nowMs = Date.now();
  const targetUntilMs = nowMs + toInt(forceOpenMs, 15 * 60 * 1000, 60 * 1000);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? (snap.data() || {}) : {};
    const curUntilMs = toNum(cur.signals_fallback_force_open_until_ms, 0);
    const nextUntilMs = Math.max(curUntilMs, targetUntilMs);
    tx.set(ref, {
      signals_fallback_force_open_until_ms: nextUntilMs,
      signals_fallback_force_open_reason: reason || "COST_GUARD",
      signals_fallback_force_open_context: context || {},
      signals_fallback_force_open_updated_at: nowIso(),
    }, { merge: true });
    return { nextUntilMs };
  });

  return out;
}

async function runCostGuard({
  projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || "donbeolja-dev",
  serviceName = process.env.K_SERVICE || process.env.COST_GUARD_SERVICE || "donbeolja",
  billingExportTable = process.env.BILLING_EXPORT_TABLE || "donbeolja-dev.billing_export.gcp_billing_export_v1_01AF2F_588FE2_BCA6B7",
  dayThresholdKrw = process.env.DAY_THRESHOLD_KRW || 5000,
  fallbackSpikeCount = process.env.FALLBACK_SPIKE_COUNT || 30,
  queryBarsFallbackSpikeCount = process.env.QUERY_BARS_FALLBACK_SPIKE_COUNT || 30,
  lookbackMin = process.env.LOOKBACK_MIN || 15,
  forceOpenMs = process.env.COST_GUARD_FORCE_OPEN_MS || 15 * 60 * 1000,
  applyProtection = true,
} = {}) {
  const p = String(projectId || "").trim();
  const svc = String(serviceName || "").trim();
  if (!p) throw new Error("PROJECT_ID_REQUIRED");
  if (!svc) throw new Error("SERVICE_NAME_REQUIRED");

  const threshold = toNum(dayThresholdKrw, 5000);
  const fallbackThreshold = toInt(fallbackSpikeCount, 30, 1);
  const queryBarsThreshold = toInt(queryBarsFallbackSpikeCount, 30, 1);
  const lookback = toInt(lookbackMin, 15, 1);
  const sinceIso = buildSinceIso(lookback);

  const [todayCostKrw, fallbackCount, queryBarsFallbackCount] = await Promise.all([
    queryTodayFirestoreCostKrw({ projectId: p, billingExportTable }),
    countLogs({
      projectId: p,
      filter:
        `resource.type="cloud_run_revision" ` +
        `AND resource.labels.service_name="${svc}" ` +
        `AND timestamp>="${sinceIso}" ` +
        `AND (jsonPayload.event="signals_fallback_used" OR textPayload:"signals_fallback_used")`,
    }),
    countLogs({
      projectId: p,
      filter:
        `resource.type="cloud_run_revision" ` +
        `AND resource.labels.service_name="${svc}" ` +
        `AND timestamp>="${sinceIso}" ` +
        `AND textPayload:"[queryBars] fallback"`,
    }),
  ]);

  const fallbackHot = (fallbackCount >= fallbackThreshold) || (queryBarsFallbackCount >= queryBarsThreshold);
  const shouldProtect = (todayCostKrw >= threshold) && fallbackHot;

  const summary = {
    ok: true,
    project_id: p,
    service: svc,
    since_iso: sinceIso,
    day_threshold_krw: threshold,
    today_firestore_cost_krw: todayCostKrw,
    fallback_spike_threshold: fallbackThreshold,
    fallback_count: fallbackCount,
    query_bars_fallback_spike_threshold: queryBarsThreshold,
    query_bars_fallback_count: queryBarsFallbackCount,
    should_protect: shouldProtect,
    applied: false,
  };

  if (!shouldProtect || !applyProtection) return summary;

  const applied = await applyForceOpenUntil({
    forceOpenMs,
    reason: "COST_GUARD",
    context: {
      project_id: p,
      service: svc,
      since_iso: sinceIso,
      cost_krw: todayCostKrw,
      fallback_count: fallbackCount,
      query_bars_fallback_count: queryBarsFallbackCount,
      day_threshold_krw: threshold,
    },
  });

  return {
    ...summary,
    applied: true,
    force_open_until_ms: applied.nextUntilMs,
    force_open_until_iso: new Date(applied.nextUntilMs).toISOString(),
  };
}

module.exports = {
  runCostGuard,
};

