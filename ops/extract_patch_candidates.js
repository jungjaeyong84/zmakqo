/**
 * Extract Patch Candidate Triggers v0 from report.json
 * Input: /tmp/donbeolja_report.json (or env REPORT_JSON)
 * Output: JSON array of triggered candidates
 */
const fs = require("fs");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function main() {
  const path = process.env.REPORT_JSON || "/tmp/donbeolja_report.json";
  if (!fs.existsSync(path)) {
    console.log(JSON.stringify({ ok:false, error:"REPORT_JSON_NOT_FOUND", path }, null, 2));
    process.exit(1);
  }

  const r = readJson(path);
  const meta = r.meta || {};
  const range = (meta.range || {});
  const expected = Array.isArray(r.markets_expected) ? r.markets_expected : [];
  const pos = Array.isArray(r.position_snapshot) ? r.position_snapshot : [];
  const kpi = r.kpi_summary || {};
  const fills = Array.isArray(r.fills) ? r.fills : [];

  const candidates = [];

  // T1: 시장 누락(관측 결손)
  {
    const posMkts = new Set(pos.map(x => x.market).filter(Boolean));
    const missing = expected.filter(m => m && !posMkts.has(m));
    if (missing.length > 0) {
      candidates.push({
        trigger_id: "T1",
        evidence: { markets_expected: expected, position_markets: Array.from(posMkts), missing },
        hypothesis: "관측 스냅샷의 시장 커버리지가 기대 목록을 충족하지 않는다.",
        proposed_patch: "src/routes/report.pack.token.routes.js (position_snapshot 수집/market 키 정규화)",
        rollback_condition: "다음 주간 팩에서 missing 길이 0 유지",
      });
    }
  }

  // T2: 포지션/바 타임 불일치(시계 흔들림)
  {
    const ms = pos.map(x => Number(x.bar_close_time_utc_ms)).filter(Number.isFinite);
    if (ms.length >= 2) {
      const max = Math.max(...ms);
      const min = Math.min(...ms);
      const diff = max - min;
      const interval = 60 * 60 * 1000;
      if (diff > interval) {
        candidates.push({
          trigger_id: "T2",
          evidence: { bar_close_ms_min: min, bar_close_ms_max: max, diff_ms: diff, interval_ms: interval },
          hypothesis: "시장별 기준 봉 시각이 정렬되지 않아 동일성/리포트 해석이 흔들린다.",
          proposed_patch: "src/storage/* (bar snapshot / cursor / market loop 정렬)",
          rollback_condition: "diff_ms <= interval_ms 유지",
        });
      }
    }
  }

  // T3: 거래 표본 부족 지속(KPI INCONCLUSIVE 고착)
  {
    const trades = Number(kpi.trades_approx);
    if (!Number.isFinite(trades) || trades <= 0) {
      candidates.push({
        trigger_id: "T3",
        evidence: { trades_approx: kpi.trades_approx ?? null, fills_new: kpi.fills_new ?? null, range },
        hypothesis: "거래 표본이 부족해 KPI가 장기간 INCONCLUSIVE로 고착될 가능성이 있다.",
        proposed_patch: "src/routes/scheduler.routes.js (sell-watch/kpi-batch cadence 및 표본 축적 루프)",
        rollback_condition: "주간 trades_approx >= 3 달성",
      });
    }
  }

  // T4: exec_price_source 불일치(체결 모델 흔들림)
  {
    const srcs = fills.map(x => x.exec_price_source).filter(Boolean);
    const uniqSrcs = uniq(srcs);
    const bad = uniqSrcs.filter(s => s !== "BAR_OPEN");
    if (bad.length > 0) {
      candidates.push({
        trigger_id: "T4",
        evidence: { exec_price_sources: uniqSrcs, unexpected: bad },
        hypothesis: "체결 가격 소스가 기대 모델(BAR_OPEN)에서 이탈했다.",
        proposed_patch: "src/paper/* (exec_price_source 설정/next_open 적용 지점)",
        rollback_condition: "다음 주간 팩에서 unexpected 길이 0 유지",
      });
    }
  }

  // T5: SELL만 존재(비정상 편향)
  {
    const sides = fills.map(x => String(x.side || "").toUpperCase()).filter(Boolean);
    const uniqSides = uniq(sides);
    if (fills.length > 0 && uniqSides.length === 1 && uniqSides[0] === "SELL") {
      candidates.push({
        trigger_id: "T5",
        evidence: { fills_len: fills.length, sides: uniqSides, range },
        hypothesis: "관측된 fill이 SELL로만 구성되어 진입/청산 흐름이 편향되었을 가능성이 있다.",
        proposed_patch: "src/paper/engine + signals pipeline (ENTRY 기록/의도 생성 여부 확인)",
        rollback_condition: "주간 팩에서 BUY/SELL 양쪽 관측 또는 fills_len=0",
      });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    report_path: path,
    generated_at: new Date().toISOString(),
    range,
    kpi_summary: kpi,
    candidates,
  }, null, 2));
}

main();
