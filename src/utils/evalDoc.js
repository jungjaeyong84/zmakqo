const { normalizeTf } = require("./marketConfig");

function normalizeEvalExchange(raw) {
  const ex = String(raw || "").trim().toUpperCase();
  if (!ex) return "BINANCEFUT";
  if (ex.includes("BINANCE")) return "BINANCEFUT";
  return "BINANCEFUT";
}

function evalDocId(exchange, week) {
  return `EVAL__${normalizeEvalExchange(exchange)}__${String(week).trim()}`;
}

function evalLatestId(exchange) {
  return `latest__${normalizeEvalExchange(exchange)}`;
}

function normalizeEvalTf(raw, fallback = "15m") {
  const direct = normalizeTf(raw);
  if (direct) return direct;
  const fb = normalizeTf(fallback);
  if (fb) return fb;
  return fallback === undefined ? "15m" : "";
}

function inferTfFromIntervalMs(raw) {
  const ms = Number(raw);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms === 15 * 60 * 1000) return "15m";
  if (ms === 30 * 60 * 1000) return "30m";
  if (ms === 60 * 60 * 1000) return "60m";
  return "";
}

function resolveEvalDocTf(doc) {
  const explicitTf = normalizeEvalTf(
    doc && (
      doc.tf
      || (doc.universe && doc.universe.tf)
      || (doc.data && doc.data.tf)
      || (doc.data && doc.data.universe && doc.data.universe.tf)
    ),
    ""
  );
  const intervalTf = normalizeEvalTf(
    doc && (
      (doc.kpi && (doc.kpi.bar_interval_tf || inferTfFromIntervalMs(doc.kpi.bar_interval_ms)))
      || (doc.data && doc.data.kpi && (doc.data.kpi.bar_interval_tf || inferTfFromIntervalMs(doc.data.kpi.bar_interval_ms)))
    ),
    ""
  );

  if (intervalTf && explicitTf && intervalTf !== explicitTf) return intervalTf;
  return intervalTf || explicitTf || "";
}

function matchesEvalTf(doc, expectedTf) {
  const tfExpected = normalizeEvalTf(expectedTf, "15m");
  const tfDoc = resolveEvalDocTf(doc);
  if (!tfDoc || !tfExpected) return false;
  return tfDoc === tfExpected;
}

module.exports = {
  normalizeEvalExchange,
  evalDocId,
  evalLatestId,
  normalizeEvalTf,
  resolveEvalDocTf,
  matchesEvalTf,
};
