function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function buildTailSummary(kpiByMarket, limit = 5) {
  const rows = [];
  const entries = Object.entries(kpiByMarket || {});
  for (const [market, kpi] of entries) {
    const tail = kpi && kpi.tail ? kpi.tail : null;
    if (!tail) continue;
    const worst = toNum(tail.worst);
    const avgWorst = toNum(tail.avg_worst_q);
    if (worst === null && avgWorst === null) continue;
    rows.push({
      market,
      worst,
      avg_worst_q: avgWorst,
    });
  }
  rows.sort((a, b) => {
    const av = (a.avg_worst_q == null) ? Number.POSITIVE_INFINITY : a.avg_worst_q;
    const bv = (b.avg_worst_q == null) ? Number.POSITIVE_INFINITY : b.avg_worst_q;
    if (av !== bv) return av - bv;
    const aw = (a.worst == null) ? Number.POSITIVE_INFINITY : a.worst;
    const bw = (b.worst == null) ? Number.POSITIVE_INFINITY : b.worst;
    return aw - bw;
  });
  return {
    rows: rows.slice(0, Math.max(1, Number(limit) || 5)),
    total: rows.length,
  };
}

module.exports = { buildTailSummary };
