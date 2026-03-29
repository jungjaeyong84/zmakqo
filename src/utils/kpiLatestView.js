"use strict";

const { inferExchangeFromMarket } = require("./marketExchange");
const { normalizeProviderId } = require("./providerUtils");

function inferKpiLatestTf(docId, row) {
  const tf = String((row && row.tf) || "").trim();
  if (tf) return tf;
  const parts = String(docId || "").split("__");
  return parts.length ? String(parts[parts.length - 1] || "").trim() || null : null;
}

function normalizeExchange(rawExchange, market) {
  return normalizeProviderId(String(rawExchange || "").trim() || inferExchangeFromMarket(market || ""));
}

function selectKpiLatestRows({ snap, exchange, execTf } = {}) {
  const exchangeNorm = normalizeProviderId(exchange || "");
  const tfNorm = String(execTf || "").trim();
  const rows = [];
  if (!snap || typeof snap.forEach !== "function") return rows;

  snap.forEach((d) => {
    const x = d.data() || {};
    const market = String(x.market || "").trim();
    if (!market) return;
    const rowExchange = normalizeExchange(x.exchange, market);
    if (exchangeNorm && rowExchange && rowExchange !== exchangeNorm) return;
    const rowTf = inferKpiLatestTf(d.id, x);
    if (tfNorm && String(rowTf || "").trim() !== tfNorm) return;
    rows.push({
      id: d.id,
      market,
      exchange: rowExchange || null,
      tf: rowTf || null,
      kpi: x.kpi || null,
      computed_at: x.computed_at || null,
      updated_at: x.updated_at || null,
      source: x.source || null,
    });
  });

  return rows;
}

function buildKpiLatestByMarket({ snap, exchange, execTf } = {}) {
  const rows = selectKpiLatestRows({ snap, exchange, execTf });
  const byMarket = {};
  for (const row of rows) {
    byMarket[row.market] = {
      kpi: row.kpi || null,
      computed_at: row.computed_at || null,
      updated_at: row.updated_at || null,
      tf: row.tf || null,
      source: row.source || null,
    };
  }
  return byMarket;
}

module.exports = {
  inferKpiLatestTf,
  selectKpiLatestRows,
  buildKpiLatestByMarket,
};
