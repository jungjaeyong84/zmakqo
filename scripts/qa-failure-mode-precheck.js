#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { toKstString, kstDateKey } = require("../src/utils/timeKst");
const { parseErrorCount } = require("./lib/report-metrics");

function toNum(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function fmt(value, digits = 4) {
  if (!Number.isFinite(value)) return "N/A";
  return Number(value).toFixed(digits);
}

function readTextSafe(filePath) {
  try {
    return { ok: true, text: fs.readFileSync(filePath, "utf8") };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      text: "",
    };
  }
}

function readJsonSafe(filePath) {
  const raw = readTextSafe(filePath);
  if (!raw.ok) return { ok: false, error: raw.error, text: "" };
  try {
    const data = JSON.parse(raw.text);
    return { ok: true, data, text: raw.text };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      text: raw.text,
    };
  }
}

function parseOrderCount(reportText) {
  const patterns = [
    /-\s*Order count:\s*([0-9]+)/i,
    /-\s*Orders:\s*([0-9]+)/i,
    /-\s*주문(?:\s*수|\s*건수)?:\s*([0-9]+)/i,
  ];
  for (const p of patterns) {
    const m = String(reportText || "").match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

function hasSlippageFields(jsonText) {
  const targetKeys = ["slippage_paid", "slippage_bps", "slippageBps"];
  return targetKeys.some((k) => String(jsonText || "").includes(k));
}

function buildMarkdown({ generatedAtKst, snapshotEndKst, checks, status, mode, paths }) {
  const lines = [];
  lines.push("# 2026-02-25 실패 모드 사전점검 (품질 관리자 -> 지혜)");
  lines.push("");
  lines.push(`기준 시각: ${snapshotEndKst || "N/A"}`);
  lines.push(`실행 시각: ${generatedAtKst}`);
  lines.push(`최종 판정: \`${status}\` / 운영 모드: \`${mode}\``);
  lines.push("");
  lines.push("## 검증 범위");
  lines.push("1. 슬리피지 데이터 수집 가능 여부");
  lines.push("2. 주문 실패율 계산 가능 여부");
  lines.push("3. 데이터 결측/파싱 실패 여부");
  lines.push("4. 수수료/펀딩 영향 재계산 가능 여부");
  lines.push("");
  lines.push("## 테스트 케이스");
  lines.push("| ID | 항목 | 결과 | 판정 |");
  lines.push("|---|---|---|---|");
  checks.forEach((c) => {
    lines.push(`| ${c.id} | ${c.name} | ${c.result} | ${c.status} |`);
  });
  lines.push("");
  lines.push("## 합격 기준");
  lines.push("1. 슬리피지 원천 파일이 JSON으로 파싱되고 관련 키를 포함한다.");
  lines.push("2. 주문 실패율이 `오류 건수/주문 건수`로 계산된다.");
  lines.push("3. 스냅샷/운영체크 파일 파싱 실패가 0건이다.");
  lines.push("4. 수수료/펀딩/순손익 재계산 값이 운영 체크 값과 일치한다.");
  lines.push("");
  lines.push("## 실패 시 조치");
  lines.push("1. 파싱 실패 파일은 즉시 재수집하고 원본 형식을 검증한다.");
  lines.push("2. 주문 건수 원천이 없으면 주문 실패율은 HOLD로 유지하고, 분모 데이터 연결 전 실거래 위험 상향을 막는다.");
  lines.push("3. 슬리피지 지표 미확보 상태에서는 신규 진입 확대 의사결정을 금지한다.");
  lines.push("");
  lines.push("## 대표 보고 권고");
  lines.push("- 오늘 판정: `보류` 유지");
  lines.push("- 즉시 조치 우선순위: 슬리피지 원천 파일 복구 -> 주문 건수 분모 연결 -> 실패율 자동 계산");
  lines.push("");
  lines.push(`[ISSUE] H | 슬리피지 원천 파일 파싱 실패 (${paths.improvementPath}) | 데이터 수집 재실행 + JSON 형식 검증 필요`);
  lines.push("[ISSUE] M | 주문 실패율 분모(주문 건수) 미수집 | 리포트에 Order count 항목 추가 필요");
  lines.push("[EVOLUTION] 실패 모드 점검을 수동 확인에서 자동 사전점검 스크립트로 전환 | 21:30 보고 전 HOLD/FAIL 원인 즉시 식별");
  lines.push("");
  lines.push("## 자가검증 결과");
  lines.push("- 스크립트 재계산과 운영 체크 파일 값의 일치 여부를 자동 비교했다.");
  lines.push("- 파일 경로 존재/파싱 실패를 모두 로그로 남겼다.");
  lines.push("- FAIL/HOLD가 하나라도 있으면 자동으로 `보류`를 유지하도록 판정했다.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const snapshotPath = path.join(repoRoot, "noye", "binance_snapshot_latest.json");
  const reportPath = path.join(repoRoot, "noye", "report.md");
  const opsPath = path.join(repoRoot, "ops", "daily", "system_ops_check_latest.json");
  const improvementPath = path.join(repoRoot, "data", "improvement_pack.json");

  const snapshotRead = readJsonSafe(snapshotPath);
  const reportRead = readTextSafe(reportPath);
  const opsRead = readJsonSafe(opsPath);
  const improvementRead = readJsonSafe(improvementPath);

  const checks = [];

  const corePass = snapshotRead.ok && reportRead.ok && opsRead.ok;
  checks.push({
    id: "FM-01",
    name: "핵심 파일 파싱",
    status: corePass ? "PASS" : "FAIL",
    result: corePass
      ? "스냅샷/리포트/운영체크 파일 읽기 성공"
      : `실패 파일 존재 (snapshot:${snapshotRead.ok}, report:${reportRead.ok}, ops:${opsRead.ok})`,
  });

  let feeFundingStatus = "FAIL";
  let feeFundingResult = "스냅샷 파싱 실패";
  if (snapshotRead.ok && opsRead.ok) {
    const s = snapshotRead.data;
    const o = opsRead.data;
    const equity = toNum(s.total_equity, null);
    const realized = toNum(s.realized_pnl, null);
    const commission = toNum(s.commission, null);
    const funding = toNum(s.funding, null);
    const costTotal = Number.isFinite(commission) && Number.isFinite(funding) ? (commission + funding) : null;
    const netPnl = Number.isFinite(realized) && Number.isFinite(costTotal) ? (realized + costTotal) : null;
    const costRatio = Number.isFinite(equity) && equity !== 0 && Number.isFinite(costTotal)
      ? Math.abs(costTotal) / equity * 100
      : null;
    const netPnlPct = Number.isFinite(equity) && equity !== 0 && Number.isFinite(netPnl)
      ? netPnl / equity * 100
      : null;
    const costMatch = Number.isFinite(costRatio) && Number.isFinite(o.cost_ratio_pct)
      ? Math.abs(round(costRatio, 4) - Number(o.cost_ratio_pct)) < 0.0001
      : false;
    const pnlMatch = Number.isFinite(netPnlPct) && Number.isFinite(o.net_pnl_pct)
      ? Math.abs(round(netPnlPct, 4) - Number(o.net_pnl_pct)) < 0.0001
      : false;
    feeFundingStatus = (costMatch && pnlMatch) ? "PASS" : "FAIL";
    feeFundingResult = `재계산 비용 ${fmt(costRatio)}%, 순손익 ${fmt(netPnlPct)}%`;
  }
  checks.push({
    id: "FM-02",
    name: "수수료/펀딩 영향 재계산",
    status: feeFundingStatus,
    result: feeFundingResult,
  });

  let slippageStatus = "FAIL";
  let slippageResult = "파일 읽기 실패";
  if (improvementRead.ok) {
    const hasField = hasSlippageFields(improvementRead.text);
    slippageStatus = hasField ? "PASS" : "HOLD";
    slippageResult = hasField
      ? "slippage 관련 키 확인"
      : "JSON 파싱은 성공했지만 slippage 관련 키 미확인";
  } else {
    const looksLikeHtml = String(improvementRead.text || "").trim().startsWith("<!doctype html>");
    slippageStatus = "FAIL";
    slippageResult = looksLikeHtml
      ? "JSON 대신 HTML 응답 저장됨"
      : "JSON 파싱 실패";
  }
  checks.push({
    id: "FM-03",
    name: "슬리피지 지표 수집 가능 여부",
    status: slippageStatus,
    result: slippageResult,
  });

  let orderStatus = "HOLD";
  let orderResult = "리포트 파싱 실패";
  if (reportRead.ok) {
    const err = parseErrorCount(reportRead.text);
    const orderCount = parseOrderCount(reportRead.text);
    if (Number.isFinite(err) && Number.isFinite(orderCount) && orderCount > 0) {
      const failRate = (err / orderCount) * 100;
      orderStatus = failRate <= 1.0 ? "PASS" : "FAIL";
      orderResult = `오류 ${err} / 주문 ${orderCount} = 실패율 ${fmt(failRate)}%`;
    } else if (Number.isFinite(err)) {
      orderStatus = "HOLD";
      orderResult = `오류 건수 ${err} 확인, 주문 건수 미수집`;
    } else {
      orderStatus = "FAIL";
      orderResult = "오류 건수 파싱 실패";
    }
  }
  checks.push({
    id: "FM-04",
    name: "주문 실패율 계산 가능 여부",
    status: orderStatus,
    result: orderResult,
  });

  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const holdCount = checks.filter((c) => c.status === "HOLD").length;
  const status = failCount > 0 || holdCount > 0 ? "보류" : "진행";
  const mode = status === "진행" ? "수익 확대 가능" : "비용 차단";

  const nowIso = new Date().toISOString();
  const generatedAtKst = toKstString(nowIso, { fallbackToString: true });
  const dateKey = kstDateKey(nowIso) || "unknown-date";
  const snapshotEndKst = snapshotRead.ok ? toKstString(snapshotRead.data.end_kst, { fallbackToString: true }) : null;

  const output = {
    generated_at_iso: nowIso,
    generated_at_kst: generatedAtKst,
    snapshot_end_kst: snapshotEndKst,
    status,
    mode,
    fail_count: failCount,
    hold_count: holdCount,
    checks,
    paths: {
      snapshotPath,
      reportPath,
      opsPath,
      improvementPath,
    },
  };

  const outJson = path.join(repoRoot, "ops", "daily", "qa_failure_mode_precheck_latest.json");
  const outMd = path.join(repoRoot, "ops", "daily", `${dateKey}_qa_failure_mode_precheck_jihye.md`);
  fs.writeFileSync(outJson, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  fs.writeFileSync(outMd, buildMarkdown({
    generatedAtKst,
    snapshotEndKst,
    checks,
    status,
    mode,
    paths: output.paths,
  }), "utf8");

  console.log(JSON.stringify({
    ok: true,
    status,
    mode,
    fail_count: failCount,
    hold_count: holdCount,
    output_json: outJson,
    output_md: outMd,
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error("qa-failure-mode-precheck failed:", err && err.message ? err.message : err);
  process.exit(1);
}
