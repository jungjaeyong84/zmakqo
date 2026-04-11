const express = require("express");
const path = require("path");
const fs = require("fs");
const JSZip = require("jszip");
const { getFirestore } = require("../storage/firestore");
const { SIGNAL_MAPPING_VERSION } = require("../services/signalMapping");
const { getAiSettingsForProvider } = require("../storage/settings");
const { getMarketsExpected, getEffectiveExchangesSettings, getMultiExchangesSettings, getRiskBudgetForProvider } = require("../utils/exchangeSettings");
const { inferExchangeFromMarket } = require("../utils/marketExchange");
const { isLiveDocForExchange } = require("../utils/liveOnly");
const { resolvePositionBudgetUsedKrw } = require("../utils/budgetUsageView");
const { listExchangePositionReadViews } = require("../services/positionReadModel");

const router = express.Router();

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function quant(arr, q) {
  const a = (arr || []).filter((x) => typeof x === "number").slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = Math.floor((a.length - 1) * q);
  return a[idx];
}
function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function writeJson(fp, obj) {
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2), "utf8");
}
function mean(arr) {
  if (!arr || !arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
async function getMarketsFromSettings(exchange) {
  const ex = String(exchange || "").trim().toUpperCase();
  const multi = await getMultiExchangesSettings(2000);
  if (multi && Array.isArray(multi.exchanges)) {
    const found = multi.exchanges.find((x) => String(x.provider || "").toUpperCase() === ex);
    if (found && Array.isArray(found.markets) && found.markets.length) return found.markets;
  }
  return getMarketsExpected(2000);
}

async function computeBudgetSnapshot(db, markets, exchange) {
  const out = { enabled: false, total_max_krw: null, total_used_krw: null, total_used_pct: null, per_market: [], unit: null };
  try {
    const rbRes = await getRiskBudgetForProvider(exchange || "BINANCEFUT", 0);
    const rb = rbRes && rbRes.data ? rbRes.data : null;
    if (!rb || rb.enabled !== true) return out;

    const unit = String(rb.unit || (String(exchange || "").includes("BINANCE") ? "USDT" : "KRW")).toUpperCase();
    const byMarket = (rb.by_market && typeof rb.by_market === "object") ? rb.by_market : {};
    const defaultMax = Number(rb.default_max_krw || 0);
    const totalMaxRaw = Number(rb.total_max_krw || 0);

    const readPositions = await listExchangePositionReadViews({ exchange });
    const posByMarket = {};
    for (const x of readPositions) {
      const posId = String(x && (x.pos_id || x.id) || "");
      if (!posId.startsWith("POS__")) continue;
      const ex = String(x.exchange || "").toUpperCase();
      if (ex && exchange && ex !== exchange) continue;
      if (!isLiveDocForExchange(exchange, x)) continue;
      const mk = x.symbol_or_pair_id || x.symbol;
      if (!mk) continue;
      posByMarket[mk] = x;
    }

    let totalUsed = 0;
    let sumMax = 0;
    const per = (markets || []).map((m) => {
      const pos = posByMarket[m] || {};
      const maxKrw = Number(byMarket[m] || defaultMax || 0);
      const used = resolvePositionBudgetUsedKrw({ exchange, position: pos, budgetMaxKrw: maxKrw });
      if (used != null) totalUsed += used;
      if (maxKrw > 0) sumMax += maxKrw;
      return { market: m, budget_max_krw: (maxKrw > 0 ? maxKrw : null), budget_used_krw: used };
    });

    const totalMaxEffective = (totalMaxRaw > 0) ? totalMaxRaw : (sumMax > 0 ? sumMax : null);
    const totalUsedPct = (totalMaxEffective && totalMaxEffective > 0) ? (totalUsed / totalMaxEffective) : null;

    return {
      enabled: true,
      total_max_krw: totalMaxEffective,
      total_used_krw: totalUsed,
      total_used_pct: totalUsedPct,
      total_max_source: (totalMaxRaw > 0) ? "total_max_krw" : "sum_by_market",
      per_market: per,
      unit,
    };
  } catch (_) {
    return out;
  }
}

function isoWeekIdUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year, week };
}

function isoWeekKeyFromMs(ms) {
  const id = isoWeekIdUTC(new Date(Number(ms)));
  const wk = String(id.week).padStart(2, "0");
  return `${id.year}W${wk}`;
}

async function collectFillsByCreatedAtScan(db, limitDocs = 50000, exchange) {
  const col = db.collection("fills_paper");
  const snap = await col.orderBy("created_at", "desc").limit(limitDocs).get();
  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const mk = x.symbol || x.symbol_or_pair_id || x.market || "";
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (exchange && (!exResolved || exResolved !== exchange)) return;
    if (!isLiveDocForExchange(exchange, x)) return;
    out.push({ id: d.id, ...x });
  });
  return out;
}

function mkSignalId(f, ms, idx) {
  const base = String(f.market || f.symbol || "UNK");
  const t = (ms === null || ms === undefined) ? "" : String(ms);
  return String(f.signal_id || f.snapshot_id || f.order_id || (base + "__" + t + "__" + String(idx)));
}

function mkSubtype(f) {
  const r = String(f.signal_reason || "");
  if (!r) return "UNKNOWN";
  return r;
}

function mkRegime(f) {
  const r = String(f.regime || "");
  if (!r) return "UNKNOWN";
  return r;
}

function mkRet(f) {
  const r1 = num(f.realized_pnl_pct);
  if (typeof r1 === "number") return r1;
  const r2 = num(f.pnl_pct);
  if (typeof r2 === "number") return r2;
  const rq = num(f.realized_pnl_quote);
  const pq = num(f.pnl_quote);
  if (typeof rq === "number" && rq !== 0) return null;
  if (typeof pq === "number" && pq !== 0) return null;
  return null;
}

function mkKeepDrop(f) {
  return { keep: true, drop: false };
}

async function collectDropFiltersSnapshot(db, limitDocs = 2000, exchange) {
  const snap = await db
    .collection("filters_drop")
    .orderBy("updated_at", "desc")
    .limit(limitDocs)
    .get();

  const rows = [];
  let latestWeek = null;
  let latestWeekNum = null;

  snap.forEach((d) => {
    const x = d.data() || {};
    const ex = String(x.exchange || "").toUpperCase();
    const mk = x.market || x.symbol_or_pair_id || x.symbol || "";
    const exResolved = ex || inferExchangeFromMarket(mk);
    if (exchange && (!exResolved || exResolved !== exchange)) return;
    rows.push({ id: d.id, ...x });
    const week = String(x.week || "").trim();
    const m = /^([0-9]{4})W([0-9]{2})$/.exec(week);
    if (m) {
      const n = Number(m[1]) * 100 + Number(m[2]);
      if (latestWeekNum === null || n > latestWeekNum) {
        latestWeekNum = n;
        latestWeek = week;
      }
    }
  });

  return {
    snapshot_id: `FILTERS_DROP_SNAP__${Date.now()}`,
    generated_at: new Date().toISOString(),
    count: rows.length,
    truncated: rows.length >= limitDocs,
    latest_week: latestWeek,
    mode: String(process.env.DROP_FILTERS_MODE || "record"),
    rows,
  };
}

function buildWeekRanges(fromMs, toMsVal, weeksBack) {
  const ranges = [];
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < weeksBack; i++) {
    const wTo = toMsVal - i * weekMs;
    const wFrom = wTo - weekMs;
    ranges.push({ idx: i, name: `weekly_w${i}`, fromMs: wFrom, toMsVal: wTo });
  }
  return ranges;
}

function kpiFromSignalRows(rows) {
  const rets = rows.map((r) => (typeof r.ret === "number" ? r.ret : null)).filter((x) => typeof x === "number");
  const fills_n = rows.length;
  const win_rate = rets.length ? (rets.filter((x) => x > 0).length / rets.length) : null;
  const ev = rets.length ? mean(rets) : null;
  const avg_return = rets.length ? mean(rets) : null;
  const worst_return = rets.length ? Math.min.apply(null, rets) : null;
  const p10 = quant(rets, 0.10);
  const p50 = quant(rets, 0.50);
  const p90 = quant(rets, 0.90);
  const keep_n = rows.filter((r) => r.keep === true).length;
  const drop_n = rows.filter((r) => r.drop === true).length;
  const keep_rate = fills_n ? (keep_n / fills_n) : null;
  return { fills_n, win_rate, ev, avg_return, worst_return, p10, p50, p90, keep_n, drop_n, keep_rate };
}

function subtypeSummaryFromAll(rowsAll) {
  const agg = {};
  for (const r of rowsAll) {
    const st = String(r.subtype || "UNKNOWN");
    const rg = String(r.regime || "UNKNOWN");
    const key = st + "||" + rg;
    if (!agg[key]) agg[key] = { subtype: st, regime: rg, n: 0, wins: 0, rets: [] };
    const g = agg[key];
    g.n += 1;
    if (typeof r.ret === "number") {
      if (r.ret > 0) g.wins += 1;
      g.rets.push(r.ret);
    }
  }
  const rows = Object.values(agg).map((g) => {
    const win_rate = g.n ? (g.wins / g.n) : null;
    const ev = g.rets.length ? mean(g.rets) : null;
    const worst = g.rets.length ? Math.min.apply(null, g.rets) : null;
    const p10 = quant(g.rets, 0.10);
    const p50 = quant(g.rets, 0.50);
    const p90 = quant(g.rets, 0.90);
    return { subtype: g.subtype, regime: g.regime, n: g.n, win_rate, ev, worst, p10, p50, p90 };
  }).sort((a, b) => (b.n || 0) - (a.n || 0));
  return { schema: "subtype_summary_v1", subtypes: {}, rows };
}

router.get("/api/report/pack-v4-plus", async (req, res) => {
  try {
    const __allowLocal = String(process.env.ALLOW_LOCAL_NO_OAUTH || "0") === "1";
    if (!__allowLocal) {
      if (!req.isAuthenticated || !req.isAuthenticated()) return res.redirect("/login");
    }

    const weeks_back = Math.max(1, Math.min(26, Number(req.query.weeks_back || 8)));
    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const fromMs = toMs(from);
    const toMsVal = toMs(to);
    if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
      return res.status(400).json({ ok: false, error: "BAD_RANGE" });
    }

    const db = getFirestore();
    const exCfg = await getEffectiveExchangesSettings(2000);
    const exchange = exCfg.provider || "BINANCEFUT";
    const markets = await getMarketsFromSettings(exchange);
    const budgetSnapshot = await computeBudgetSnapshot(db, markets, exchange);
    const aiSettings = (await getAiSettingsForProvider(exchange || "BINANCEFUT", 2000)).data || null;

    const tmpRoot = path.join("/tmp", `donbeolja_pack_v4_plus_${Date.now()}`);
    const derivedDir = path.join(tmpRoot, "derived");
    const weeksDir = path.join(tmpRoot, "weeks");
    ensureDir(derivedDir);
    ensureDir(weeksDir);

    const wk = buildWeekRanges(fromMs, toMsVal, weeks_back);
    for (const w of wk) ensureDir(path.join(weeksDir, w.name));

    const allFills = await collectFillsByCreatedAtScan(db, 50000, exchange);
    const filtersSnapshot = await collectDropFiltersSnapshot(
      db,
      Number(process.env.FILTERS_DROP_SNAPSHOT_LIMIT || 2000),
      exchange
    );
    writeJson(path.join(derivedDir, "filters_drop_snapshot.json"), filtersSnapshot);
    const weekKey = isoWeekKeyFromMs(toMsVal);

    const kpiSeries = [];
    const rowsAll = [];

    for (const w of wk) {
      const wkDir = path.join(weeksDir, w.name);

      const rows = [];
      let idx = 0;

      for (const f of allFills) {
        const cMs = Date.parse(String(f.created_at || ""));
        if (!Number.isFinite(cMs)) continue;
        if (cMs < w.fromMs || cMs >= w.toMsVal) continue;

        const m = String(f.market || f.symbol || "");
        if (markets.length && m && !markets.includes(m)) continue;

        const ms = num(f.exec_bar_close_time_utc_ms);
        const signal_id = mkSignalId(f, ms, idx);

        const ret = mkRet(f);
        const subtype = mkSubtype(f);
        const regime = mkRegime(f);
        const kd = mkKeepDrop(f);

        rows.push({
          signal_id,
          market: m || null,
          side: f.side || null,
          run_id: f.run_id || null,
          snapshot_id: f.snapshot_id || null,
          order_id: f.order_id || null,
          exec_bar_close_time_utc_ms: (typeof ms === "number" ? ms : null),
          exec_price_source: f.exec_price_source || "LEGACY",
          notional_krw: (f.notional_krw != null ? f.notional_krw : f.notional),
          budget_max_krw: f.budget_max_krw ?? null,
          budget_used_krw: f.budget_used_krw ?? null,
          qty_fraction: f.qty_fraction ?? null,
          budget_total_max_krw: budgetSnapshot.total_max_krw ?? null,
          budget_total_used_krw: budgetSnapshot.total_used_krw ?? null,
          budget_total_used_pct: budgetSnapshot.total_used_pct ?? null,
          signal_reason: f.signal_reason || null,
          signal_strength: f.signal_strength ?? null,
          subtype,
          regime,
          ret,
          pnl_quote: f.pnl_quote ?? null,
          realized_pnl_quote: f.realized_pnl_quote ?? null,
          keep: kd.keep,
          drop: kd.drop,
          mode: f.mode || null
        });

        idx += 1;
      }

      writeJson(path.join(wkDir, "signal_rows.json"), { rows });

      const kpi = kpiFromSignalRows(rows);
      kpiSeries.push({ week: w.name, ...kpi });

      const rep = {
        meta: {
          generated_at: new Date().toISOString(),
          range: { from_ms: w.fromMs, to_ms: w.toMsVal },
          week_key: isoWeekKeyFromMs(w.toMsVal),
          week_index: w.name,
          filters_snapshot_id: filtersSnapshot.snapshot_id,
          signal_mapping_version: SIGNAL_MAPPING_VERSION,
          ai_settings: aiSettings,
          budget_snapshot: budgetSnapshot,
        },
        fills: [],
        kpi_summary: {
          fills_new: rows.length,
          sells_new: rows.filter((r) => String(r.side || "").toUpperCase() === "SELL").length,
          trades_approx: rows.filter((r) => String(r.side || "").toUpperCase() === "SELL").length,
          markets_in_fills: Array.from(new Set(rows.map((r) => r.market).filter(Boolean)))
        },
        integrity: {
          note: "signal_rows derived directly from fills_paper(created_at scan), includes LEGACY",
          markets_expected: markets
        }
      };
      writeJson(path.join(wkDir, "report.json"), rep);

      for (const r of rows) rowsAll.push(r);
    }

    const header = ["week","fills_n","win_rate","ev","avg_return","worst_return","p10","p50","p90","keep_n","drop_n","keep_rate"].join(",");
    const lines = [header];
    for (const row of kpiSeries) {
      const vals = [
        row.week,
        row.fills_n ?? "",
        (typeof row.win_rate === "number" ? row.win_rate : ""),
        (typeof row.ev === "number" ? row.ev : ""),
        (typeof row.avg_return === "number" ? row.avg_return : ""),
        (typeof row.worst_return === "number" ? row.worst_return : ""),
        (typeof row.p10 === "number" ? row.p10 : ""),
        (typeof row.p50 === "number" ? row.p50 : ""),
        (typeof row.p90 === "number" ? row.p90 : ""),
        row.keep_n ?? "",
        row.drop_n ?? "",
        (typeof row.keep_rate === "number" ? row.keep_rate : "")
      ];
      lines.push(vals.join(","));
    }
    fs.writeFileSync(path.join(derivedDir, "kpi_timeseries.csv"), lines.join("\n"), "utf8");
    writeJson(path.join(derivedDir, "kpi_timeseries.json"), { rows: kpiSeries });

    const w0 = kpiSeries.find((x) => x.week === "weekly_w0") || {};
    const w1 = kpiSeries.find((x) => x.week === "weekly_w1") || {};
    const diff = {
      schema: "kpi_diff_w0_vs_w1",
      from,
      to,
      delta: {
        fills_n: (typeof w0.fills_n === "number" && typeof w1.fills_n === "number") ? (w0.fills_n - w1.fills_n) : null,
        win_rate: (typeof w0.win_rate === "number" && typeof w1.win_rate === "number") ? (w0.win_rate - w1.win_rate) : null,
        ev: (typeof w0.ev === "number" && typeof w1.ev === "number") ? (w0.ev - w1.ev) : null,
        worst_return: (typeof w0.worst_return === "number" && typeof w1.worst_return === "number") ? (w0.worst_return - w1.worst_return) : null,
        p10: (typeof w0.p10 === "number" && typeof w1.p10 === "number") ? (w0.p10 - w1.p10) : null
      }
    };
    writeJson(path.join(derivedDir, "kpi_diff_w0_vs_w1.json"), diff);

    const subtypeSummary = subtypeSummaryFromAll(rowsAll);
    subtypeSummary.weeks_back = weeks_back;
    subtypeSummary.from = from;
    subtypeSummary.to = to;
    writeJson(path.join(derivedDir, "subtype_summary.json"), subtypeSummary);

    const meta = {
      schema: "donbeolja_pack_v4_plus",
      generated_at: new Date().toISOString(),
      range: { from, to },
      weeks_back,
      week_key: weekKey,
      markets_expected: markets,
      filters_snapshot_id: filtersSnapshot.snapshot_id,
      filters_latest_week: filtersSnapshot.latest_week,
      drop_filters_mode: filtersSnapshot.mode,
      signal_mapping_version: SIGNAL_MAPPING_VERSION,
    };
    writeJson(path.join(tmpRoot, "meta.json"), meta);

    const prompt = [
      "📌 DONBEOLJA 리포트 분석 요청(팩트 기반)",
      "",
      "1) 목적",
      "- 돈벌자 지표 최근 수정의 성과/리스크 영향 판단",
      "- 전주 대비 변화(승률/EV/표본/편향/꼬리위험) 정량 비교",
      "- 어떤 신호를 어떻게 수정할지(규칙/파라미터) 제안 포함",
      "",
      "2) 입력",
      `- 기간: from=${from} to=${to}`,
      `- ZIP: /api/report/pack-v4-plus?weeks_back=${weeks_back}&from=...&to=...`,
      "",
      "3) ZIP에서 반드시 참조할 파일",
      "- derived/kpi_timeseries.csv",
      "- derived/kpi_diff_w0_vs_w1.json",
      "- derived/subtype_summary.json",
      "- derived/filters_drop_snapshot.json",
      "- weeks/weekly_w0/signal_rows.json",
      "- weeks/weekly_w1/signal_rows.json",
      "",
      "4) 비교 지표(전주 대비)",
      "- 승률(win_rate), EV, avg_return, worst_return, p10/p50/p90",
      "- fills_n, keep/drop 비율",
      "- subtype(특히 VERIFY_*)별 표본수/성과/편향",
      "",
      "5) 수정 대상 신호(후보 3개로 제한)",
      "- entry: signal_strength 컷 / VERIFY_* 처리 방식",
      "- exit: regime별 손절/익절 컷",
      "- drop: tail(worst/p10) 악화 서브타입 컷",
      "",
      "6) 산출(한글, 단정문)",
      "- 전주 대비 요약(수치 5개 이상)",
      "- 리스크 변화(하방 꼬리/표본 안정성) 판단",
      "- 수정안 판정: 유효/무효 중 1개",
      "- 수정 제안 3개(각 1줄 규칙)",
      "- 다음 액션 1~3개(순서)",
      "",
      "7) 판정 규칙(강제)",
      "- EV↓ 또는 win_rate↓ + fills_n↓ 이면 수정 무효",
      "- EV↑ + p10 개선 + fills_n 유지/증가이면 수정 유효",
      "- VERIFY_* eval_n 쏠림 50% 이상이면 편향 경고",
      "- worst_return 10%p 이상 악화이면 리스크 악화"
    ].join("\n");
    fs.writeFileSync(path.join(tmpRoot, "prompt_ko.txt"), prompt, "utf8");

    const outer = new JSZip();
    outer.file("meta.json", fs.readFileSync(path.join(tmpRoot, "meta.json")));
    outer.file("prompt_ko.txt", fs.readFileSync(path.join(tmpRoot, "prompt_ko.txt")));

    outer.folder("derived").file("kpi_timeseries.csv", fs.readFileSync(path.join(derivedDir, "kpi_timeseries.csv")));
    outer.folder("derived").file("kpi_timeseries.json", fs.readFileSync(path.join(derivedDir, "kpi_timeseries.json")));
    outer.folder("derived").file("kpi_diff_w0_vs_w1.json", fs.readFileSync(path.join(derivedDir, "kpi_diff_w0_vs_w1.json")));
    outer.folder("derived").file("subtype_summary.json", fs.readFileSync(path.join(derivedDir, "subtype_summary.json")));
    outer.folder("derived").file("filters_drop_snapshot.json", fs.readFileSync(path.join(derivedDir, "filters_drop_snapshot.json")));

    for (const w of wk) {
      const wkDir = path.join(weeksDir, w.name);
      const wkFolder = outer.folder(`weeks/${w.name}`);
      wkFolder.file("report.json", fs.readFileSync(path.join(wkDir, "report.json")));
      wkFolder.file("signal_rows.json", fs.readFileSync(path.join(wkDir, "signal_rows.json")));
    }
    // COVERAGE_JSON_V1
    // 목적: weeks/weekly_w*/(report.json, signal_rows.json) 존재/row수를 ZIP에 포함
    try {
      const coverage = {
        schema: "coverage_v1",
        generated_at: new Date().toISOString(),
        range: { from, to },
        weeks_back,
        weeks: []
      };

      for (const w of wk) {
        const wkDir = path.join(weeksDir, w.name);
        const repFp = path.join(wkDir, "report.json");
        const srFp  = path.join(wkDir, "signal_rows.json");

        const repExists = fs.existsSync(repFp);
        const srExists  = fs.existsSync(srFp);

        let srN = 0;
        if (srExists) {
          try {
            const obj = JSON.parse(fs.readFileSync(srFp, "utf8"));
            const rows = (obj && Array.isArray(obj.rows)) ? obj.rows : [];
            srN = rows.length;
          } catch (_) {}
        }

        coverage.weeks.push({
          week: w.name,
          report_json: repExists,
          signal_rows_json: srExists,
          signal_rows_n: srN
        });
      }

      const covFp = path.join(derivedDir, "coverage.json");
      fs.writeFileSync(covFp, JSON.stringify(coverage, null, 2), "utf8");

      // ZIP에 포함
      try {
        outer.folder("derived").file("coverage.json", fs.readFileSync(covFp));
      } catch (_) {}
    } catch (_) {}



    const buf = await outer.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="donbeolja_pack_v4_plus_${Date.now()}.zip"`);
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).send("PACK_V4_PLUS_ERROR: " + (e && e.message ? e.message : String(e)));
  }
});

module.exports = router;

// ALLOW_LEGACY_FILLS_V1
