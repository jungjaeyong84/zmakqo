// src/storage/barsSnapshots.js
const { getFirestore } = require("./firestore");
const { getSystemSettingsCached } = require("./settings");
const { sendAlert } = require("../utils/alerts");
const { tfToMs, defaultExecTfFromEnv } = require("../utils/marketConfig");

const FALLBACK_ALERT_MIN_INTERVAL_MS = Number(
  process.env.FALLBACK_ALERT_MIN_INTERVAL_MS || process.env.ALERT_MIN_INTERVAL_MS || (15 * 60 * 1000)
);
const BARS_RECENT_WINDOW_ALERT_ENABLED = String(process.env.BARS_RECENT_WINDOW_ALERT || "0") === "1";
const BARS_QUERY_DEBUG = String(process.env.BARS_QUERY_DEBUG || "0") === "1";
const fallbackAlertState = new Map();

function nowIso() {
  return new Date().toISOString();
}

function makeSnapshotId({ exchange, symbol, tf, barCloseTimeUtcMs }) {
  return `${exchange}__${symbol}__${tf}__${barCloseTimeUtcMs}`;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeSummary(bar) {
  const o = toNum(bar.open);
  const h = toNum(bar.high);
  const l = toNum(bar.low);
  const c = toNum(bar.close);
  const v = toNum(bar.volume);

  let ret = null;
  let range = null;

  if (o !== null && c !== null && o !== 0) ret = (c - o) / o;
  if (h !== null && l !== null) range = h - l;

  return { ret, range, volume: v };
}

function shouldSendFallbackAlert(key, nowMs) {
  const last = Number(fallbackAlertState.get(key));
  if (Number.isFinite(last) && (nowMs - last) < FALLBACK_ALERT_MIN_INTERVAL_MS) {
    return false;
  }
  fallbackAlertState.set(key, nowMs);
  if (fallbackAlertState.size > 500) {
    for (const [k, v] of fallbackAlertState) {
      if (!Number.isFinite(v) || (nowMs - v) > FALLBACK_ALERT_MIN_INTERVAL_MS) {
        fallbackAlertState.delete(k);
      }
    }
  }
  return true;
}

async function maybeSendFallbackAlert({ exchange, symbol, tf, fallbackType, total, returned }) {
  const fb = String(fallbackType || "");
  if (fb === "recent_window" && !BARS_RECENT_WINDOW_ALERT_ENABLED) return;
  const now = Date.now();
  const key = `${exchange}__${symbol}__${tf}__${fallbackType}`;
  if (!shouldSendFallbackAlert(key, now)) return;

  let sys = null;
  try {
    sys = await getSystemSettingsCached(30_000);
  } catch (_) {
    return;
  }
  const alertChannel = String(sys && sys.data && sys.data.alert_channel || "").trim();
  if (!alertChannel) return;

  const title = `DONBEOLJA bars fallback: ${fallbackType}`;
  const body =
    `exchange=${exchange}\n` +
    `symbol=${symbol}\n` +
    `tf=${tf}\n` +
    `returned=${returned}\n` +
    `seen=${Number.isFinite(total) ? total : "NA"}`;
  const severity = fb === "limited_scan" ? "WARN" : "INFO";
  sendAlert({ channel: alertChannel, title, body, severity }).catch((e) => {
    console.warn("[bars_fallback_alert_fail]", { error: e?.message || String(e) });
  });
}

/**
 * 최신 1봉 스냅샷 저장 (idempotent)
 */
async function upsertBarSnapshot({
  runId,
  exchange,
  symbol,
  tf,
  barCloseTimeUtc,
  barCloseTimeUtcMs,
  bar,
} = {}) {
  const db = getFirestore();
  const id = makeSnapshotId({ exchange, symbol, tf, barCloseTimeUtcMs });
  const ref = db.collection("bars_snapshots").doc(id);

  const payload = {
    snapshot_id: id,
    run_id: runId || null,
    exchange,
    symbol,
    tf,
    bar_close_time_utc: barCloseTimeUtc || null,
    bar_close_time_utc_ms: Number(barCloseTimeUtcMs),

    // 원본은 1봉만 저장
    ohlcv_json: {
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      closeTimeUtc: bar.closeTimeUtc,
    },

    derived_summary: safeSummary(bar),
    created_at: nowIso(),
  };

  // 동일 snapshot_id면 overwrite(최신화)해도 무방
  await ref.set(payload, { merge: true });
  return payload;
}

/**
 * 특정 마켓/TF의 최근 N개 bars 조회
 * @param {Object} opts - { exchange, symbol, tf, limit }
 * @returns {Array} bars 배열 (오래된 것부터 정렬)
 */
function resolveQueryBarsScanLimit({ limit, hardLimit, scanHeadroom } = {}) {
  const rawLimit = Number(limit) || 200;
  const cap = Number.isFinite(Number(hardLimit)) ? Number(hardLimit) : rawLimit;
  const limitSafe = Math.max(1, Math.min(rawLimit, cap));
  const headroomRaw = Number(scanHeadroom);
  const effectiveHeadroom = Number.isFinite(headroomRaw) && headroomRaw >= 0
    ? Math.floor(headroomRaw)
    : 12;
  return {
    limitSafe,
    cap,
    scanLimit: Math.max(limitSafe, Math.min(cap, limitSafe + effectiveHeadroom)),
  };
}

async function queryBars({ exchange, symbol, tf, limit = 200 } = {}) {
  const db = getFirestore();
  const { limitSafe, scanLimit } = resolveQueryBarsScanLimit({
    limit,
    hardLimit: process.env.BARS_SNAPSHOT_MAX_LIMIT || 3000,
    scanHeadroom: process.env.BARS_SNAPSHOT_CONFIRMED_SCAN_HEADROOM,
  });
  // Binance often returns the current in-progress candle whose close time
  // is still in the future. queryBars() must return confirmed-only bars,
  // so the storage query needs a small headroom above the requested limit;
  // otherwise the future candle consumes one slot and callers that ask for
  // 220 confirmed bars can get stuck at 219 forever.
  // Document ID prefix query (index-free)
  // ID format: EXCHANGE__SYMBOL__TF__TIMESTAMP
  const ex = exchange || "BINANCEFUT";
  const t = tf || defaultExecTfFromEnv() || "15m";
  const prefix = `${ex}__${symbol}__${t}__`;
  const nowMs = Date.now();
  const tfMs = tfToMs(t);
  const recentCount = Math.max(10, Number(limitSafe) || 0);
  const recentWindowMs = Number.isFinite(tfMs)
    ? (tfMs * recentCount)
    : (7 * 24 * 60 * 60 * 1000);
  const recentStartMs = Number.isFinite(nowMs - recentWindowMs) ? Math.max(0, Math.floor(nowMs - recentWindowMs)) : 0;

  // startAt/endAt을 사용하여 prefix로 시작하는 문서들만 가져오기
  const baseQueryAsc = db
    .collection("bars_snapshots")
    .orderBy("__name__")  // Document ID로 정렬
    .startAt(prefix)
    .endAt(prefix + "\uf8ff");  // Unicode 최대값으로 범위 끝 지정

  let snapshot = null;
  let fallbackLimited = false;
  let fallbackRecent = false;
  let fallbackLimitToLast = false;

  // Primary path: latest N via asc + limitToLast (stable and low noise).
  try {
    snapshot = await baseQueryAsc.limitToLast(scanLimit).get();
  } catch (_) {
    snapshot = null;
  }

  if (!snapshot || snapshot.empty) {
    try {
      // Secondary path: narrow recent-window scan.
      snapshot = await db
        .collection("bars_snapshots")
        .orderBy("__name__")
        .startAt(prefix + String(recentStartMs))
        .endAt(prefix + "\uf8ff")
        .limit(scanLimit)
        .get();
      fallbackRecent = true;
    } catch (_) {
      snapshot = null;
    }
  }

  if (!snapshot || snapshot.empty) {
    try {
      // Tertiary path: descending range query.
      snapshot = await db
        .collection("bars_snapshots")
        .orderBy("__name__", "desc")
        .startAt(prefix + "\uf8ff")
        .endAt(prefix)
        .limit(scanLimit)
        .get();
      fallbackLimitToLast = true;
    } catch (_) {
      // Last resort: bounded scan.
      snapshot = await baseQueryAsc.limit(scanLimit).get();
      fallbackLimited = true;
    }
  }

  if (snapshot.empty) {
    return [];
  }

  // Document들을 bars로 변환하고 timestamp로 정렬
  const bars = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    const ohlcv = data.ohlcv_json || {};
    const createdAt = data.created_at || null;
    const createdAtMs = createdAt ? Date.parse(String(createdAt)) : null;

    const ts = Number(data.bar_close_time_utc_ms);
    // Skip future (in-progress) bars to keep confirmed-only bars.
    if (!Number.isFinite(ts) || ts > nowMs) return;

    bars.push({
      open: ohlcv.open,
      high: ohlcv.high,
      low: ohlcv.low,
      close: ohlcv.close,
      volume: ohlcv.volume,
      closeTimeUtc: data.bar_close_time_utc,
      closeTimeUtcMs: data.bar_close_time_utc_ms,
      created_at: createdAt,
      created_at_ms: Number.isFinite(createdAtMs) ? createdAtMs : null,
      timestamp: ts,
      // 간편 표기법
      t: data.bar_close_time_utc,
      o: ohlcv.open,
      h: ohlcv.high,
      l: ohlcv.low,
      c: ohlcv.close,
      v: ohlcv.volume,
    });
  });

  // timestamp로 정렬 (최신 것부터)
  bars.sort((a, b) => b.timestamp - a.timestamp);

  // Optional debug log
  if (BARS_QUERY_DEBUG && bars.length > 0) {
    console.log(`[queryBars] ${symbol}: Found ${bars.length} bars, latest 3:`);
    bars.slice(0, 3).forEach((b, i) => {
      console.log(`  [${i}] ${b.closeTimeUtc} (${b.timestamp})`);
    });
  }

  // Limit and return in ascending order (old -> new).
  const sliced = bars.slice(0, limitSafe).reverse();
  if (fallbackRecent && BARS_QUERY_DEBUG) {
    console.log(`[queryBars] fallback recent window used for ${symbol} (${bars.length} -> ${sliced.length})`);
  } else if (fallbackLimitToLast && BARS_QUERY_DEBUG) {
    console.log(`[queryBars] fallback limitToLast used for ${symbol} (${bars.length} -> ${sliced.length})`);
  } else if (fallbackLimited) {
    console.log(`[queryBars] fallback limited scan used for ${symbol} (${bars.length} -> ${sliced.length})`);
  }
  if (fallbackRecent || fallbackLimitToLast || fallbackLimited) {
    const fallbackType = fallbackRecent ? "recent_window" : (fallbackLimitToLast ? "limit_to_last" : "limited_scan");
    void maybeSendFallbackAlert({
      exchange: ex,
      symbol,
      tf: t,
      fallbackType,
      total: bars.length,
      returned: sliced.length,
    });
  }
  return sliced;
}

module.exports = {
  upsertBarSnapshot,
  queryBars,
  __test: {
    resolveQueryBarsScanLimit,
  },
};
