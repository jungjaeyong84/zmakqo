const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");
const {
  resolveExchangeFromReq,
  resolveRuntimeMarketsForExchange,
  resolveExecTfForExchange,
} = require("../utils/resolveExchange");
const { inferKpiLatestTf, selectKpiLatestRows } = require("../utils/kpiLatestView");
const { defaultExecTfFromEnv } = require("../utils/marketConfig");

function normalizeKpiStatus(raw) {
  const s = String(raw || "INCONCLUSIVE").trim().toUpperCase();
  return s || "INCONCLUSIVE";
}

function meanFinite(values) {
  const nums = (values || []).map(Number).filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function fmtPctRatio(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${(n * 100).toFixed(2)}%`;
}

function fmtEv(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(4);
}

function buildBriefingSummary({ rows = [], execTf = "15m", marketsExpected = [] } = {}) {
  const expectedCount = Array.isArray(marketsExpected) ? marketsExpected.length : 0;
  const observedCount = Array.isArray(rows) ? rows.length : 0;
  const missingCount = Math.max(0, expectedCount - observedCount);
  if (!observedCount) {
    return {
      summary_ko: `현재 ${execTf} KPI는 아직 생성되지 않았습니다.`,
      summary_lines_ko: [
        `현재 운영 타임프레임은 ${execTf}인데, 브리핑에 표시할 최신 KPI 행이 없습니다.`,
        "평가 스케줄이 아직 돌지 않았거나 최신 스냅샷이 비어 있을 가능성이 큽니다.",
      ],
      status_counts: {
        GREEN: 0,
        YELLOW: 0,
        RED: 0,
        INCONCLUSIVE: 0,
      },
    };
  }

  const counts = {
    GREEN: 0,
    YELLOW: 0,
    RED: 0,
    INCONCLUSIVE: 0,
  };

  for (const row of rows) {
    const st = normalizeKpiStatus(row && row.kpi && row.kpi.status);
    if (counts[st] == null) counts.INCONCLUSIVE += 1;
    else counts[st] += 1;
  }

  const finiteEvRows = rows.filter((row) => Number.isFinite(Number(row && row.kpi && row.kpi.ev)));
  const finiteWinRows = rows.filter((row) => Number.isFinite(Number(row && row.kpi && row.kpi.win_rate)));
  const avgEv = meanFinite(finiteEvRows.map((row) => row.kpi.ev));
  const avgWin = meanFinite(finiteWinRows.map((row) => row.kpi.win_rate));

  let summary = `현재 ${execTf} KPI는 ${observedCount}개 마켓 기준`;
  const statusFragments = [];
  if (counts.GREEN) statusFragments.push(`양호 ${counts.GREEN}개`);
  if (counts.YELLOW) statusFragments.push(`주의 ${counts.YELLOW}개`);
  if (counts.RED) statusFragments.push(`경고 ${counts.RED}개`);
  if (counts.INCONCLUSIVE) statusFragments.push(`보류 ${counts.INCONCLUSIVE}개`);
  if (statusFragments.length) summary += ` ${statusFragments.join(", ")} 상태입니다.`;
  else summary += " 집계 상태를 아직 분류할 수 없습니다.";

  const details = [];
  if (counts.INCONCLUSIVE === observedCount) {
    details.push("모든 마켓이 보류 상태라서 지금은 방향 판단보다 표본 축적이 우선입니다.");
  } else if (counts.RED > 0) {
    details.push("경고 상태 마켓이 있어 진입보다 KPI 열화 원인을 먼저 확인하는 편이 맞습니다.");
  } else if (counts.GREEN > 0 || counts.YELLOW > 0) {
    details.push("현재는 일부 마켓에서 읽을 수 있는 KPI가 생겼지만, 시장별 편차를 같이 봐야 합니다.");
  }
  if (missingCount > 0) {
    details.push(`대상 마켓 ${expectedCount}개 중 ${missingCount}개는 아직 ${execTf} 최신 KPI가 없습니다.`);
  }
  if (avgEv != null || avgWin != null) {
    const avgFragments = [];
    if (avgEv != null) avgFragments.push(`평균 기대값 ${fmtEv(avgEv)}`);
    if (avgWin != null) avgFragments.push(`평균 승률 ${fmtPctRatio(avgWin)}`);
    details.push(`수치가 나온 마켓 기준 ${avgFragments.join(", ")}입니다.`);
  }

  return {
    summary_ko: summary,
    summary_lines_ko: details,
    status_counts: counts,
  };
}

router.get("/api/briefing/latest", async (req, res) => {
  try {
    const db = getFirestore();
    const { exchange } = await resolveExchangeFromReq(req, 2000);
    const execTf = await resolveExecTfForExchange(exchange, defaultExecTfFromEnv() || "15m", 2000);
    const marketsExpected = await resolveRuntimeMarketsForExchange(exchange, 2000);
    const want = new Set(marketsExpected);

    const snap = await db.collection("kpi_latest").get();
    const rows = selectKpiLatestRows({ snap, exchange, execTf }).filter((row) => want.has(row.market));
    let maxComputedAt = null;
    for (const row of rows) {
      if (!row.computed_at) continue;
      const ms = Date.parse(String(row.computed_at));
      if (!Number.isFinite(ms)) continue;
      if (!maxComputedAt || ms > maxComputedAt) maxComputedAt = ms;
    }

    rows.sort((a, b) => String(a.market).localeCompare(String(b.market)));
    const summary = buildBriefingSummary({ rows, execTf, marketsExpected });

    return res.json({
      ok: true,
      markets_expected: marketsExpected,
      exchange,
      exec_tf: execTf,
      count: rows.length,
      computed_at: maxComputedAt ? new Date(maxComputedAt).toISOString() : null,
      summary_ko: summary.summary_ko,
      summary_lines_ko: summary.summary_lines_ko,
      status_counts: summary.status_counts,
      rows,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "BRIEFING_LATEST_ERROR", message: e.message });
  }
});

module.exports = router;
module.exports.__test = {
  inferRowTf: (row, docId) => inferKpiLatestTf(docId, row),
  buildBriefingSummary,
  selectKpiLatestRows,
};
