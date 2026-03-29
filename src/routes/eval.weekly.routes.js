const express = require("express");
const router = express.Router();

const { getFirestore } = require("../storage/firestore");
const { computeSignalEval, summariseSignalRows } = require("../services/signalEval");
const {
  TF_15M,
  BAR_INTERVAL_MS_15M,
  SIGNAL_EVAL_VERSION,
  SIGNAL_EVAL_HORIZON_BARS,
  SIGNAL_KPI_MIN_N,
  SIGNAL_KPI_MIN_EVAL_N,
  SIGNAL_KPI_KEEP_WR,
  SIGNAL_KPI_KEEP_EV,
  SIGNAL_KPI_HARD_STREAK,
  SIGNAL_KPI_DROP_WR,
  SIGNAL_KPI_DROP_EV,
  SCHEMA_VERSION,
} = require("../config/frozen");
const { isoWeek } = require("../utils/overall");
const {
  getMarketsExpected,
  getEffectiveExchangesSettings,
  getMultiExchangesSettings,
  getExchangeSettingsForProvider,
} = require("../utils/exchangeSettings");
const { alignBarCloseMs } = require("../utils/alignBarCloseMs");
const { tfToMs, normalizeTf } = require("../utils/marketConfig");
const { normalizeEvalExchange, evalDocId, evalLatestId } = require("../utils/evalDoc");

function allowLocalBypass() {
  return String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
}

function requireSchedulerToken(req, res, next) {
  if (allowLocalBypass()) return next();

  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok: false, error: "SCHEDULER_TOKEN_NOT_SET" });
  if (!token || token !== expected) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  return next();
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function toMs(x) {
  if (x == null) return null;
  const n = toNum(x);
  if (n != null) return n;
  const ms = Date.parse(String(x));
  return Number.isFinite(ms) ? ms : null;
}
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function parseMarketsFromSettings(exchange) {
  const ex = normalizeEvalExchange(exchange || "");
  const multi = await getMultiExchangesSettings(2000);
  if (multi && Array.isArray(multi.exchanges)) {
    const found = multi.exchanges.find((x) => String(x.provider || "").toUpperCase() === ex);
    if (found && Array.isArray(found.markets) && found.markets.length) return found.markets;
  }
  const markets = await getMarketsExpected(2000);
  return markets && markets.length ? markets : null;
}

function parseMarketsFromBody(body) {
  const v = body?.markets;
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === "string") {
    return v
      .split(",")
      .map((x) => String(x).trim())
      .filter(Boolean);
  }
  return null;
}

function makeSnapshotId(exchange, symbol_or_pair_id, tf, barCloseMs) {
  return `${String(exchange).toUpperCase()}__${String(symbol_or_pair_id)}__${String(tf)}__${Number(barCloseMs)}`;
}

function shouldReplaceEvalLatest(existing, nextPayload) {
  if (!existing || typeof existing !== "object") return true;
  const nextToMs = Number(nextPayload && nextPayload.range && nextPayload.range.to_ms);
  const curToMs = Number(existing && existing.range && existing.range.to_ms);
  if (Number.isFinite(nextToMs) && Number.isFinite(curToMs)) {
    return nextToMs >= curToMs;
  }
  const nextGenMs = Date.parse(String(nextPayload && (nextPayload.generated_at || nextPayload.created_at) || ""));
  const curGenMs = Date.parse(String(existing && (existing.generated_at || existing.created_at) || ""));
  if (Number.isFinite(nextGenMs) && Number.isFinite(curGenMs)) return nextGenMs >= curGenMs;
  return true;
}

router.post("/scheduler/eval-weekly", requireSchedulerToken, async (req, res) => {
  try {
    const db = getFirestore();

    // ---------- 1) 입력(주차/기간/마켓) ----------
    const nowMs = Date.now();

    const fromMs = toMs(req?.body?.from) ?? toMs(req?.body?.since) ?? nowMs - 7 * 24 * 60 * 60 * 1000;
    const toMsV = toMs(req?.body?.to) ?? nowMs;

    if (!Number.isFinite(fromMs) || !Number.isFinite(toMsV) || fromMs >= toMsV) {
      return res.status(400).json({
        ok: false,
        error: "INVALID_RANGE",
        detail: { from: req?.body?.from, to: req?.body?.to, fromMs, toMs: toMsV },
      });
    }

    const requestedWeek = String(req?.body?.week || "").trim();
    const week = requestedWeek || isoWeek(new Date(toMsV));

    const exCfg = await getEffectiveExchangesSettings(2000);
    const exchangeWanted = normalizeEvalExchange(req?.body?.exchange || process.env.EXCHANGE || exCfg.provider || "BINANCEFUT");
    const markets = parseMarketsFromBody(req.body) ?? await parseMarketsFromSettings(exchangeWanted);
    const exRuntimeCfg = await getExchangeSettingsForProvider(exchangeWanted, 2000);
    const tfAllow = Array.isArray(exRuntimeCfg && exRuntimeCfg.tf_allowlist) ? exRuntimeCfg.tf_allowlist : [];
    const tfWanted = normalizeTf(req?.body?.tf || (exRuntimeCfg && exRuntimeCfg.exec_tf) || (tfAllow && tfAllow[0]) || TF_15M) || TF_15M;
    const intervalMs = tfToMs(tfWanted) || BAR_INTERVAL_MS_15M;

    // ---------- 2) 신호 로드 ----------
    // Firestore 인덱스 최소화를 위해 넉넉히 가져온 뒤 범위 필터링.
    const signalsSnap = await db
      .collection("signals")
      .orderBy("bar_close_time_utc_ms", "desc")
      .limit(Number(process.env.SIGNALS_EVAL_FETCH_LIMIT || 8000))
      .get();

    const rawSignals = [];
    for (const doc of signalsSnap.docs) {
      const s = { id: doc.id, ...doc.data() };

      const rawBarCloseMs =
        toNum(s.bar_close_time_utc_ms) ??
        toMs(s.bar_close_time_utc) ??
        toNum(s.created_at_ms) ??
        toMs(s.created_at);

      const ex = String(s.exchange || exchangeWanted).toUpperCase();
      if (ex !== exchangeWanted) continue;

      const tf = String(s.tf || tfWanted);
      if (tf !== tfWanted) continue;

      const barCloseMs = alignBarCloseMs(ex, tf, rawBarCloseMs);
      if (!Number.isFinite(barCloseMs)) continue;
      if (barCloseMs < fromMs || barCloseMs >= toMsV) continue;

      const sym = String(s.symbol_or_pair_id || s.symbol || s.market || "").trim();
      if (!sym) continue;

      if (markets && markets.length > 0 && !markets.includes(sym)) continue;

      rawSignals.push({ ...s, exchange: ex, tf, symbol_or_pair_id: sym, bar_close_time_utc_ms: barCloseMs });
    }

    // ---------- 3) bars_snapshots 정밀 로드(문서 ID 기반) ----------
    // 평가에 필요한 것은 각 signal의 entry(close@barCloseMs)와 exit(close@futureMs) 2개 지점이다.
    const snapshotIds = new Set();
    for (const s of rawSignals) {
      const barCloseMs = toNum(s.bar_close_time_utc_ms);
      if (!Number.isFinite(barCloseMs)) continue;
      const futureMs = barCloseMs + SIGNAL_EVAL_HORIZON_BARS * intervalMs;
      snapshotIds.add(makeSnapshotId(s.exchange, s.symbol_or_pair_id, s.tf, barCloseMs));
      snapshotIds.add(makeSnapshotId(s.exchange, s.symbol_or_pair_id, s.tf, futureMs));
    }

    const barsSnapshots = [];
    const idsArr = Array.from(snapshotIds);

    // getAll() 인자 개수/크기 제한을 고려해 chunk.
    const chunks = chunk(idsArr, Number(process.env.BARS_GETALL_CHUNK || 250));
    for (const idsChunk of chunks) {
      const refs = idsChunk.map((id) => db.collection("bars_snapshots").doc(id));
      // Firestore: db.getAll(ref1, ref2, ...)
      const snaps = await db.getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists) continue;
        barsSnapshots.push({ id: snap.id, ...snap.data() });
      }
    }

    // ---------- 4) 평가 ----------
    const evalResult = computeSignalEval({
      signals: rawSignals,
      barsSnapshots,
      horizonBars: SIGNAL_EVAL_HORIZON_BARS,
      intervalMs,
      groupKeyFn: (sig, meta) => {
        const ex = String(sig.exchange || exchangeWanted).toUpperCase();
        const sym = String(sig.symbol_or_pair_id || sig.symbol || sig.market || "").trim();
        const tf = String(sig.tf || tfWanted);
        return [ex, sym, tf, meta.side, meta.group, meta.subtype].join("__");
      },
    });

    const rawRows = evalResult.rawRows || [];
    const diagnostics = evalResult.diagnostics || {};
    const perKeyRows = summariseSignalRows({ rawRows });

    const signal_kpi_A = perKeyRows.map((r) => ({
      exchange: r.exchange,
      symbol: r.symbol_or_pair_id,
      tf: r.tf,
      side: r.side,
      group: r.group,
      subtype: r.subtype,
      n: r.n,
      eval_n: r.eval_n,
      win_rate: r.win_rate,
      ev: r.ev_dir_ret_pct,
      horizon_bars: SIGNAL_EVAL_HORIZON_BARS,
    }));

    const perKeySummary = {
      rows_n: perKeyRows.length,
      n_total: perKeyRows.reduce((a, b) => a + Number(b.n || 0), 0),
      eval_n_total: perKeyRows.reduce((a, b) => a + Number(b.eval_n || 0), 0),
    };

    // ---------- 5) 결론(결정) 생성(고정 KPI 기준) ----------
    const decisionRows = [];
    const decisions = {
      kpi_min_n: SIGNAL_KPI_MIN_N,
      keep: [],
      drop: [],
      tune: [],
      need_data: [],
    };

    for (const r of perKeyRows) {
      const n = Number(r.n || 0);
      const evalN = Number(r.eval_n || 0);
      const wr = Number(r.win_rate || 0);
      const ev = Number(r.ev_dir_ret_pct || 0);

      let decision = "NEED_DATA";
      let decision_reason = "INSUFFICIENT_N";

      if (n >= SIGNAL_KPI_MIN_N && evalN >= SIGNAL_KPI_MIN_EVAL_N) {
        if (wr >= SIGNAL_KPI_KEEP_WR && ev >= SIGNAL_KPI_KEEP_EV) {
          decision = "KEEP";
          decision_reason = "MEETS_KEEP";
        } else if (wr <= SIGNAL_KPI_DROP_WR && ev <= SIGNAL_KPI_DROP_EV) {
          decision = "DROP";
          decision_reason = "BELOW_DROP";
        } else {
          decision = "NEED_DATA";
          decision_reason = "IN_BETWEEN";
        }
      }

      const row = {
        exchange: r.exchange,
        symbol_or_pair_id: r.symbol_or_pair_id,
        tf: r.tf,
        side: r.side,
        group: r.group,
        subtype: r.subtype,
        n,
        eval_n: evalN,
        win_rate: wr,
        ev: ev,
        decision,
        decision_reason,
      };
      decisionRows.push(row);

      if (decision === "KEEP") decisions.keep.push(row);
      else if (decision === "DROP") decisions.drop.push(row);
      else decisions.need_data.push(row);
    }

    // ---------- 6) 저장(eval_weekly + eval_latest) ----------
    const payload = {
      eval_id: week,
      week,
      exchange: exchangeWanted,
      created_at: new Date().toISOString(),
      generated_at: new Date().toISOString(),
      schema_version: SCHEMA_VERSION,
      version: SIGNAL_EVAL_VERSION,
      tf: tfWanted,
      horizon_bars: SIGNAL_EVAL_HORIZON_BARS,

      // 기간/대상
      range: {
        from_ms: fromMs,
        to_ms: toMsV,
        from: new Date(fromMs).toISOString(),
        to: new Date(toMsV).toISOString(),
      },
      universe: {
        exchange: exchangeWanted,
        tf: tfWanted,
        markets: markets || [],
      },

      // 고정 KPI
      kpi: {
        horizon_bars: SIGNAL_EVAL_HORIZON_BARS,
        bar_interval_ms_60m: intervalMs,
        bar_interval_ms_15m: intervalMs,
        bar_interval_ms: intervalMs,
        bar_interval_tf: tfWanted,
        min_n: SIGNAL_KPI_MIN_N,
        min_eval_n: SIGNAL_KPI_MIN_EVAL_N,
        keep_wr: SIGNAL_KPI_KEEP_WR,
        keep_ev: SIGNAL_KPI_KEEP_EV,
        drop_wr: SIGNAL_KPI_DROP_WR,
        drop_ev: SIGNAL_KPI_DROP_EV,
        hard_streak: SIGNAL_KPI_HARD_STREAK,
      },

      // 데이터 수
      signals_n: rawSignals.length,
      bars_n: barsSnapshots.length,
      scanned: rawSignals.length,
      streams: perKeyRows.length,

      // 산출물
      diagnostics,
      signal_kpi_A,
      per_key_summary: perKeySummary,
      decisions,
      decision_rows: decisionRows,
    };

    await db.collection("eval_weekly").doc(evalDocId(exchangeWanted, week)).set(payload, { merge: true });
    const latestRef = db.collection("eval_latest").doc(evalLatestId(exchangeWanted));
    const latestSnap = await latestRef.get();
    const latestCurrent = latestSnap.exists ? (latestSnap.data() || {}) : null;
    if (shouldReplaceEvalLatest(latestCurrent, payload)) {
      await latestRef.set(
        { ...payload, eval_id: "latest", exchange: exchangeWanted },
        { merge: true }
      );
    }

    return res.json({ ok: true, week, payload });
  } catch (err) {
    console.error("[eval-weekly] error", err);
    return res.status(500).json({ ok: false, error: "EVAL_WEEKLY_FAILED", detail: String(err?.message || err) });
  }
});

module.exports = router;
module.exports.__test = {
  shouldReplaceEvalLatest,
};
