const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const https = require("https");
const JSZip = require("jszip");

// Token gate (same as other scheduler endpoints)
function requireSchedulerToken(req, res, next) {
  const expected = String(process.env.SCHEDULER_TOKEN || "");
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");
  if (!expected) return res.status(500).json({ ok: false, error: "SERVER_MISCONFIG", message: "SCHEDULER_TOKEN not set" });
  if (token !== expected) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}

function httpGetBuffer(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) return resolve(buf);
        reject(new Error(`HTTP_${res.statusCode}: ${buf.toString("utf8").slice(0, 300)}`));
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
}

function computeWeeklyRangeUtcISO(nowMs = Date.now()) {
  const end = new Date(nowMs);
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: start.toISOString(), to: end.toISOString() };
}

function extractCandidates(report) {
  const meta = report.meta || {};
  const range = meta.range || {};
  const expected = Array.isArray(report.markets_expected) ? report.markets_expected : [];
  const pos = Array.isArray(report.position_snapshot) ? report.position_snapshot : [];
  const kpi = report.kpi_summary || {};
  const fills = Array.isArray(report.fills) ? report.fills : [];

  const candidates = [];

  // T1: missing markets in position_snapshot
  {
    const posMkts = new Set(pos.map(x => x.market).filter(Boolean));
    const missing = expected.filter(m => m && !posMkts.has(m));
    if (missing.length > 0) {
      candidates.push({
        trigger_id: "T1",
        evidence: { markets_expected: expected, position_markets: Array.from(posMkts), missing },
        hypothesis: "관측 스냅샷의 시장 커버리지가 기대 목록을 충족하지 않는다.",
        proposed_patch: "report.pack.token.routes.js (position_snapshot 수집/market 키 정규화)",
        rollback_condition: "다음 주간 팩에서 missing 길이 0 유지",
      });
    }
  }

  // T2: bar_close misalignment
  {
    const ms = pos.map(x => Number(x.bar_close_time_utc_ms)).filter(Number.isFinite);
    if (ms.length >= 2) {
      const diff = Math.max(...ms) - Math.min(...ms);
      const interval = 60 * 60 * 1000;
      if (diff > interval) {
        candidates.push({
          trigger_id: "T2",
          evidence: { bar_close_ms_min: Math.min(...ms), bar_close_ms_max: Math.max(...ms), diff_ms: diff, interval_ms: interval },
          hypothesis: "시장별 기준 봉 시각이 정렬되지 않아 동일성/리포트 해석이 흔들린다.",
          proposed_patch: "report.pack.token.routes.js (bars_snapshots time alignment)",
          rollback_condition: "diff_ms <= interval_ms 유지",
        });
      }
    }
  }

  // T3: insufficient trades
  {
    const trades = Number(kpi.trades_approx);
    if (!Number.isFinite(trades) || trades <= 0) {
      candidates.push({
        trigger_id: "T3",
        evidence: { trades_approx: kpi.trades_approx ?? null, fills_new: kpi.fills_new ?? null, range },
        hypothesis: "거래 표본이 부족해 KPI가 장기간 INCONCLUSIVE로 고착될 가능성이 있다.",
        proposed_patch: "scheduler cadence (sell-watch/kpi-batch) & sampling loop",
        rollback_condition: "주간 trades_approx >= 3 달성",
      });
    }
  }

  // T4: exec_price_source mismatch
  {
    const srcs = uniq(fills.map(x => x.exec_price_source).filter(Boolean));
    const bad = srcs.filter(s => s !== "BAR_OPEN");
    if (bad.length > 0) {
      candidates.push({
        trigger_id: "T4",
        evidence: { exec_price_sources: srcs, unexpected: bad },
        hypothesis: "체결 가격 소스가 기대 모델(BAR_OPEN)에서 이탈했다.",
        proposed_patch: "paper engine (next_open / exec_price_source)",
        rollback_condition: "다음 주간 팩에서 unexpected 길이 0 유지",
      });
    }
  }

  // T5: SELL-only fills
  {
    const sides = uniq(fills.map(x => String(x.side || "").toUpperCase()).filter(Boolean));
    if (fills.length > 0 && sides.length === 1 && sides[0] === "SELL") {
      candidates.push({
        trigger_id: "T5",
        evidence: { fills_len: fills.length, sides, range },
        hypothesis: "관측된 fill이 SELL로만 구성되어 진입/청산 흐름이 편향되었을 가능성이 있다.",
        proposed_patch: "signals pipeline (ENTRY 기록/의도 생성 여부 확인)",
        rollback_condition: "주간 팩에서 BUY/SELL 양쪽 관측 또는 fills_len=0",
      });
    }
  }

  return { range, kpi_summary: kpi, candidates };
}

function generateProposalMarkdown(week, generatedAt, range, candidates) {
  let md = `# Patch Proposal ${week}\n\n`;
  md += `Generated at: ${generatedAt}\n\n`;
  md += `## Summary\n`;
  md += `- Candidates: ${candidates.length}\n`;
  md += `- Range: ${range.from} ~ ${range.to}\n\n`;

  for (const c of candidates) {
    md += `---\n`;
    md += `## ${c.trigger_id}\n\n`;
    md += `**Hypothesis**\n\n${c.hypothesis}\n\n`;
    md += `**Evidence**\n\`\`\`json\n${JSON.stringify(c.evidence, null, 2)}\n\`\`\`\n\n`;
    md += `**Proposed Patch**\n\n- ${c.proposed_patch}\n\n`;
    md += `**Rollback Condition**\n\n- ${c.rollback_condition}\n\n`;
  }
  return md;
}

// POST /scheduler/patch-suggest
// Cloud Run-safe: no bash/zip/unzip/git dependencies. Uses /api/report/pack + JSZip.
router.post("/scheduler/patch-suggest", requireSchedulerToken, async (req, res) => {
  const start = Date.now();
  const token = String(req.get("x-scheduler-token") || req.get("X-Scheduler-Token") || "");

  try {
    const input = req.body || {};
    const mode = String(input.mode || "weekly").toLowerCase();
    const exchange = String(input.exchange || "").trim();
    const from = String(input.from || "").trim();
    const to = String(input.to || "").trim();

    const baseUrl = String(process.env.BASE_URL || "https://donbeolja-350958953672.asia-northeast3.run.app");
    const range = (from && to) ? { from, to } : computeWeeklyRangeUtcISO(Date.now());
    const qp = new URLSearchParams({
      mode,
      from: range.from,
      to: range.to,
    });
    if (exchange) qp.set("exchange", exchange);
    if (input.week) qp.set("week", String(input.week));
    const packUrl = `${baseUrl}/api/report/pack?${qp.toString()}`;

    // 1) fetch zip
    const zipBuf = await httpGetBuffer(packUrl, { "x-scheduler-token": token });

    // 2) extract report.json
    const zip = await JSZip.loadAsync(zipBuf);
    const reportTxt = await zip.file("report.json").async("string");
    const report = JSON.parse(reportTxt);

    // 3) write evidence files (optional but useful)
    const outReport = "/tmp/donbeolja_report.json";
    const outCandidates = "/tmp/donbeolja_patch_candidates.json";
    fs.writeFileSync(outReport, JSON.stringify(report, null, 2), "utf8");

    const week = String(input.week || isoWeek(new Date()));
    const generatedAt = new Date().toISOString();

    const extracted = extractCandidates(report);
    const payload = { ok: true, generated_at: generatedAt, week, report_path: outReport, ...extracted };
    fs.writeFileSync(outCandidates, JSON.stringify(payload, null, 2), "utf8");

    // 4) proposal markdown saved to /tmp (repo root not writable on Cloud Run)
    const proposalPath = `/tmp/PATCH_PROPOSAL_${week}.md`;
    const md = generateProposalMarkdown(week, generatedAt, extracted.range, extracted.candidates);
    fs.writeFileSync(proposalPath, md, "utf8");

    return res.json({
      ok: true,
      runtime_ms: Date.now() - start,
      week,
      candidates_count: extracted.candidates.length,
      candidates_path: outCandidates,
      proposal_path: proposalPath,
      note: "node-only patch_suggest executed",
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "PATCH_SUGGEST_FAILED",
      message: e.message,
      runtime_ms: Date.now() - start,
    });
  }
});

module.exports = router;
