function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function computeUnrealized(close, avg, positionSide) {
  const c = toNum(close);
  const a = toNum(avg);
  if (c === null || a === null || a <= 0) return null;
  const side = String(positionSide || "").toUpperCase();
  if (side === "SHORT") return (a - c) / a;
  return (c - a) / a;
}

// markets: [{ position:{state,size_pct,avg_price}, close, unrealized_pnl_pct, kpi:{status} }]
function computeOverall(markets) {
  const ms = Array.isArray(markets) ? markets : [];

  const statuses = ms.map(x => {
    const st = x && x.kpi && x.kpi.status ? String(x.kpi.status).toUpperCase() : "INCONCLUSIVE";
    return st;
  });

  // ACTIVE only weighted unrealized
  let active_cnt = 0, size_sum = 0, uw_sum = 0;
  for (const x of ms) {
    const pos = x && x.position ? x.position : null;
    const st = pos && pos.state ? String(pos.state).toUpperCase() : "";
    const size = toNum(pos && pos.size_pct);
    const u = toNum(x && x.unrealized_pnl_pct);
    if (st === "ACTIVE" && size !== null && size > 0) {
      active_cnt += 1;
      size_sum += size;
      if (u !== null) uw_sum += (u * size);
    }
  }
  const unrealized_weighted = (size_sum > 0) ? (uw_sum / size_sum) : null;

  // Status priority: RED/FAIL > YELLOW/WARN > INCONCLUSIVE > GREEN
  let status = "INCONCLUSIVE";
  if (statuses.some(x => x === "RED" || x === "FAIL")) status = "RED";
  else if (statuses.some(x => x === "YELLOW" || x === "WARN")) status = "YELLOW";
  else if (statuses.length > 0 && statuses.every(x => x === "GREEN" || x === "PASS")) status = "GREEN";
  else status = "INCONCLUSIVE";

  let action = "⏸ 데이터 축적 중 · 관망";
  if (status === "RED") action = "🚫 신규 진입 금지 · 전략 변경 금지";
  else if (status === "YELLOW") action = "⚠️ 관망 유지 · 변경 보류";
  else if (status === "GREEN") action = "✅ 조건 충족 · 신규 진입 검토 가능";

  return { status, action, active_cnt, size_sum, unrealized_weighted };
}

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}W${String(weekNo).padStart(2, "0")}`;
}

module.exports = { toNum, computeUnrealized, computeOverall, toOverallStatus, isoWeek };


function toOverallStatus(input) {
  // 배열 입력: market gate 리스트를 overall status 문자열로 집계
  if (Array.isArray(input)) {
    if (input.length === 0) return "UNKNOWN";

    let seenUnknown = false;
    let seenSoftFail = false;

    for (const g of input) {
      const s = toOverallStatus(g);

      if (s === "FAIL_HARD") return "FAIL_HARD";
      if (s === "FAIL_SOFT") seenSoftFail = true;
      if (s === "UNKNOWN") seenUnknown = true;
    }

    if (seenSoftFail) return "FAIL_SOFT";
    if (seenUnknown) return "UNKNOWN";
    return "PASS";
  }

  if (input == null) return "UNKNOWN";

  if (typeof input === "string") {
    const s = input.trim().toUpperCase();
    if (s.includes("FAIL_HARD")) return "FAIL_HARD";
    if (s.includes("FAIL_SOFT")) return "FAIL_SOFT";
    if (s === "PASS" || s === "OK") return "PASS";
    if (s.includes("FAIL")) return "FAIL_HARD";
    return "UNKNOWN";
  }

  // object gate
  const overall = String(input.overall_status || input.overallStatus || "").toUpperCase();
  const status = String(input.status || "").toUpperCase();
  const severity = String(input.severity || "").toUpperCase();
  const ok = input.ok === true;

  if (overall === "PASS" || overall === "OK") return "PASS";
  if (overall === "FAIL_HARD") return "FAIL_HARD";
  if (overall === "FAIL_SOFT") return "FAIL_SOFT";

  if (ok || status === "PASS" || status === "OK") return "PASS";
  if (severity === "HARD") return "FAIL_HARD";
  if (severity === "SOFT") return "FAIL_SOFT";
  if (status === "FAIL") return "FAIL_HARD";

  return "UNKNOWN";
}
