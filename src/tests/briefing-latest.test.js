"use strict";

const assert = require("assert");
const briefingRoute = require("../routes/briefing.latest.routes");

const { __test } = briefingRoute || {};

function run() {
  assert.ok(__test, "__test export missing");
  assert.strictEqual(typeof __test.inferRowTf, "function", "inferRowTf export missing");
  assert.strictEqual(typeof __test.buildBriefingSummary, "function", "buildBriefingSummary export missing");
  assert.strictEqual(typeof __test.selectKpiLatestRows, "function", "selectKpiLatestRows export missing");

  assert.strictEqual(
    __test.inferRowTf({ tf: "15m" }, "KPI_LATEST__BINANCEFUT__BTCUSDT__60m"),
    "15m"
  );

  assert.strictEqual(
    __test.inferRowTf({}, "KPI_LATEST__BINANCEFUT__BTCUSDT__15m"),
    "15m"
  );

  const mockDocs = [
    {
      id: "KPI_LATEST__BINANCEFUT__BTCUSDT__60m",
      data() { return { market: "BTCUSDT", exchange: "BINANCEFUT", kpi: { status: "GREEN" } }; },
    },
    {
      id: "KPI_LATEST__BINANCEFUT__BTCUSDT__15m",
      data() { return { market: "BTCUSDT", exchange: "BINANCEFUT", tf: "15m", kpi: { status: "YELLOW" } }; },
    },
  ];
  const mockSnap = {
    forEach(fn) {
      mockDocs.forEach(fn);
    },
  };
  const selected = __test.selectKpiLatestRows({ snap: mockSnap, exchange: "BINANCEFUT", execTf: "15m" });
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].market, "BTCUSDT");
  assert.strictEqual(selected[0].tf, "15m");
  assert.strictEqual(selected[0].kpi.status, "YELLOW");

  const onlyInconclusive = __test.buildBriefingSummary({
    execTf: "15m",
    marketsExpected: ["BTCUSDT", "ETHUSDT"],
    rows: [
      { market: "BTCUSDT", tf: "15m", kpi: { status: "INCONCLUSIVE", n: 4, ev: null, win_rate: null } },
      { market: "ETHUSDT", tf: "15m", kpi: { status: "INCONCLUSIVE", n: 8, ev: null, win_rate: null } },
    ],
  });
  assert.ok(onlyInconclusive.summary_ko.includes("현재 15m KPI"));
  assert.ok(onlyInconclusive.summary_ko.includes("보류 2개"));
  assert.ok(onlyInconclusive.summary_lines_ko.some((line) => line.includes("표본 축적")));

  const mixed = __test.buildBriefingSummary({
    execTf: "15m",
    marketsExpected: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
    rows: [
      { market: "BTCUSDT", tf: "15m", kpi: { status: "GREEN", n: 24, ev: 0.0123, win_rate: 0.66 } },
      { market: "ETHUSDT", tf: "15m", kpi: { status: "YELLOW", n: 21, ev: 0.004, win_rate: 0.61 } },
    ],
  });
  assert.ok(mixed.summary_ko.includes("양호 1개"));
  assert.ok(mixed.summary_ko.includes("주의 1개"));
  assert.ok(mixed.summary_lines_ko.some((line) => line.includes("1개는 아직 15m 최신 KPI가 없습니다")));
  assert.ok(mixed.summary_lines_ko.some((line) => line.includes("평균 기대값")));
}

try {
  run();
  console.log("BRIEFING_LATEST_TEST_OK");
} catch (err) {
  console.error("BRIEFING_LATEST_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
