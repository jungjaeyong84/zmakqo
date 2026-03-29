const express = require("express");
const JSZip = require("jszip");

const router = express.Router();

function toMs(v) {
  const t = Date.parse(String(v || ""));
  return Number.isFinite(t) ? t : null;
}

function addDaysIso(iso, days) {
  const ms = toMs(iso);
  if (ms === null) return null;
  return new Date(ms + days * 24 * 60 * 60 * 1000).toISOString();
}

function getWeeksBack(req) {
  const n = Number(req.query.weeks_back);
  if (!Number.isFinite(n)) return 8;
  if (n < 2) return 2;
  if (n > 24) return 24;
  return Math.floor(n);
}

async function fetchZipBuffer(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`FETCH_FAIL ${res.status} ${url} ${txt.slice(0, 120)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

router.get("/api/report/pack-v4", async (req, res) => {
  try {
    const weeks_back = getWeeksBack(req);

    const from = String(req.query.from || "");
    const to = String(req.query.to || "");
    const fromMs = toMs(from);
    const toMsVal = toMs(to);

    if (fromMs === null || toMsVal === null || toMsVal <= fromMs) {
      return res.status(400).json({ ok: false, error: "BAD_RANGE", message: "from/to must be valid ISO and to > from" });
    }

    const base = `${req.protocol}://${req.get("host")}`;
    const exchange = String(req.query.exchange || "").trim();

    const outer = new JSZip();
    const derived = outer.folder("derived");
    const weeks = outer.folder("weeks");

    const kpi_ts_rows = [];
    const meta = {
      schema: "donbeolja_pack_v4",
      generated_at: new Date().toISOString(),
      weeks_back,
      range: { from, to },
      base_url: base,
      note: "pack-v4 = weeks_back times v2 pack + derived summaries"
    };

    for (let i = 0; i < weeks_back; i++) {
      const wFrom = addDaysIso(from, -7 * i);
      const wTo = addDaysIso(to, -7 * i);
      if (!wFrom || !wTo) throw new Error("RANGE_SHIFT_FAIL");

      const qp = new URLSearchParams({
        from: wFrom,
        to: wTo,
      });
      if (exchange) qp.set("exchange", exchange);
      const packUrl = `${base}/api/report/pack?${qp.toString()}`;

      const buf = await fetchZipBuffer(packUrl);
      const inner = await JSZip.loadAsync(buf);

      const folder = weeks.folder(`weekly_w${i}`);

      const names = Object.keys(inner.files || {});
      for (const name of names) {
        const f = inner.files[name];
        if (!f || f.dir) continue;
        const content = await f.async("nodebuffer");
        folder.file(name, content);
      }

      let reportJsonText = null;
      if (inner.file("report.json")) reportJsonText = await inner.file("report.json").async("string");

      let signalRowsText = null;
      if (inner.file("signal_rows.json")) signalRowsText = await inner.file("signal_rows.json").async("string");

      const row = {
        week_index: i,
        from: wFrom,
        to: wTo,
        report_ok: Boolean(reportJsonText),
        signal_rows_ok: Boolean(signalRowsText),
        fills_n: null,
        sells_n: null,
        trades_n: null,
        win_rate: null,
        ev: null,
        worst_return: null
      };

      if (reportJsonText) {
        try {
          const r = JSON.parse(reportJsonText);
          const counts = r && r.counts ? r.counts : null;
          if (counts) {
            row.fills_n = (typeof counts.fills_new === "number") ? counts.fills_new : null;
            row.sells_n = (typeof counts.sells_new === "number") ? counts.sells_new : null;
            row.trades_n = (typeof counts.trades_approx === "number") ? counts.trades_approx : null;
          }
          const trade_kpi = r && r.trade_kpi ? r.trade_kpi : null;
          if (trade_kpi) {
            row.win_rate = (typeof trade_kpi.win_rate === "number") ? trade_kpi.win_rate : null;
            row.ev = (typeof trade_kpi.ev === "number") ? trade_kpi.ev : null;
          }
          const pnls = (r && Array.isArray(r.closed_trade_pnls)) ? r.closed_trade_pnls : [];
          if (pnls.length) {
            let worst = pnls[0];
            for (const x of pnls) if (typeof x === "number" && x < worst) worst = x;
            row.worst_return = worst;
          }
        } catch (_) {}
      }

      kpi_ts_rows.push(row);
    }

    derived.file("kpi_timeseries.json", JSON.stringify({ meta, rows: kpi_ts_rows }, null, 2));

    const w0 = kpi_ts_rows[0] || null;
    const w1 = kpi_ts_rows[1] || null;
    const diff = {
      schema: "kpi_diff_w0_vs_w1",
      from: (w0 && w0.from) || null,
      to: (w0 && w0.to) || null,
      baseline_from: (w1 && w1.from) || null,
      baseline_to: (w1 && w1.to) || null,
      delta: {
        fills_n: (w0 && w1 && typeof w0.fills_n === "number" && typeof w1.fills_n === "number") ? (w0.fills_n - w1.fills_n) : null,
        trades_n: (w0 && w1 && typeof w0.trades_n === "number" && typeof w1.trades_n === "number") ? (w0.trades_n - w1.trades_n) : null,
        win_rate: (w0 && w1 && typeof w0.win_rate === "number" && typeof w1.win_rate === "number") ? (w0.win_rate - w1.win_rate) : null,
        ev: (w0 && w1 && typeof w0.ev === "number" && typeof w1.ev === "number") ? (w0.ev - w1.ev) : null,
        worst_return: (w0 && w1 && typeof w0.worst_return === "number" && typeof w1.worst_return === "number") ? (w0.worst_return - w1.worst_return) : null
      }
    };
    derived.file("kpi_diff_w0_vs_w1.json", JSON.stringify(diff, null, 2));

    const prompt = [
      "📌 DONBEOLJA 리포트 분석 요청(팩트 기반)",
      "",
      "1) 목적",
      "- 돈벌자 지표 최근 수정의 성과/리스크 영향 판단",
      "- 전주 대비 변화(승률/EV/표본/편향/꼬리위험) 정량 비교",
      "- 어떤 신호를 어떻게 수정할지(규칙/파라미터) 제안 포함",
      "",
      "2) 입력",
      `- 기준 기간: from=${from} to=${to}`,
      `- ZIP: /api/report/pack-v4?weeks_back=${weeks_back}&from=...&to=...`,
      "",
      "3) 반드시 사용하는 파일",
      "- derived/kpi_timeseries.json",
      "- derived/kpi_diff_w0_vs_w1.json",
      "- weeks/weekly_w0/report.json",
      "- weeks/weekly_w0/signal_rows.json",
      "- weeks/weekly_w1/report.json",
      "- weeks/weekly_w1/signal_rows.json",
      "",
      "4) 비교 지표(전주 대비)",
      "- win_rate, EV, fills_n/trades_n, worst_return",
      "- signal_rows.json 기반: subtype별 성과/편향(특히 VERIFY_*)",
      "",
      "5) 수정 대상 신호(후보 3개로 제한)",
      "- entry: signal_strength 컷 / VERIFY_* 분리",
      "- exit: regime별 손절/익절 컷",
      "- drop: worst/p10 발생 신호의 subtype/strength 컷",
      "",
      "6) 산출(한글, 단정문)",
      "- 전주 대비 요약(수치 5개 이상)",
      "- 리스크 변화(하방 꼬리) 및 표본 안정성",
      "- 수정안 판정: 유효/무효 중 1개",
      "- 수정 제안: 신호/파라미터 3개(각 1줄 규칙)",
      "- 다음 액션 1~3개(순서)",
      "",
      "7) 판정 규칙(강제)",
      "- EV↓ 또는 win_rate↓ + fills_n↓ 이면 수정 무효",
      "- EV↑ + worst_return 개선 + fills_n 유지/증가이면 수정 유효",
      "- 8주 시계열에서 EV/승률이 1주만 튀면 우연으로 판정",
      "- worst_return 10%p 이상 악화이면 리스크 악화"
    ].join("\n");
    outer.file("prompt_ko.txt", prompt);
    outer.file("meta.json", JSON.stringify(meta, null, 2));

    const outBuf = await outer.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="donbeolja_pack_v4_${Date.now()}.zip"`);
    return res.status(200).send(outBuf);
  } catch (e) {
    return res.status(500).send("PACK_V4_ERROR: " + (e && e.message ? e.message : String(e)));
  }
});

module.exports = router;
