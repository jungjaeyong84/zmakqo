"use strict";

const { fetchPositionEvents } = require("../storage/positionEvents");

function replayPositionEventsFromRows(rows = []) {
  const ordered = (Array.isArray(rows) ? rows : [])
    .slice()
    .sort((a, b) => Number(a.sequence_ms || 0) - Number(b.sequence_ms || 0));
  let snapshot = null;
  for (const row of ordered) {
    if (row && row.after_snapshot && typeof row.after_snapshot === "object") {
      snapshot = row.after_snapshot;
    }
  }
  return {
    replayed_n: ordered.length,
    latest_snapshot: snapshot,
    latest_event: ordered.length ? ordered[ordered.length - 1] : null,
  };
}

async function replayPositionEvents({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limit = 500,
} = {}) {
  const rows = await fetchPositionEvents({ exchange, symbol, fromMs, toMs, limit });
  return {
    exchange: String(exchange || "").toUpperCase(),
    symbol: String(symbol || "").toUpperCase(),
    ...replayPositionEventsFromRows(rows),
  };
}

module.exports = {
  replayPositionEvents,
  __test: {
    replayPositionEventsFromRows,
  },
};
