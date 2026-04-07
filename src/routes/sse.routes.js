const express = require("express");
const router = express.Router();
const { getFirestore } = require("../storage/firestore");

// Track connected clients
const clients = new Set();
const MAX_CLIENTS = 50;

router.get("/api/sse/dashboard", (req, res) => {
  if (clients.size >= MAX_CLIENTS) {
    return res.status(503).json({ error: "Too many connections" });
  }

  const exchange = String(req.query.exchange || "BINANCEFUT").toUpperCase();

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no", // nginx proxy buffering off
  });

  clients.add(res);
  let lastTs = "";

  // Send initial data immediately
  fetchDashboardData(exchange).then((data) => {
    if (data) {
      lastTs = data.ts;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  });

  // Poll Firestore every 12 seconds and push changes
  const interval = setInterval(async () => {
    try {
      const data = await fetchDashboardData(exchange);
      if (data && data.ts !== lastTs) {
        lastTs = data.ts;
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    } catch (_) {}
  }, 12000);

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => {
    try { res.write(":\n\n"); } catch (_) {}
  }, 30000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(interval);
    clearInterval(heartbeat);
    clients.delete(res);
  });
});

async function fetchDashboardData(exchange) {
  try {
    const db = getFirestore();

    // Latest 3 signals
    const signalsSnap = await db.collection("signals")
      .where("exchange", "==", exchange)
      .orderBy("created_at", "desc")
      .limit(3)
      .get();
    const signals = signalsSnap.docs.map((d) => {
      const data = d.data();
      return {
        symbol: data.symbol_or_pair_id || data.symbol || null,
        event: data.event || null,
        entry_grade: (data.features_json && data.features_json.entry_grade) || null,
        source: (data.features_json && data.features_json.canonical_engine_candidate_source) || "SERVER",
        created_at: data.created_at || null,
        status: data.exec_plan ? (data.exec_plan.status || null) : null,
      };
    });

    // Latest 3 fills
    const fillsSnap = await db.collection("fills_paper")
      .where("exchange", "==", exchange)
      .orderBy("created_at", "desc")
      .limit(3)
      .get();
    const fills = fillsSnap.docs.map((d) => {
      const data = d.data();
      return {
        symbol: data.symbol || data.symbol_or_pair_id || null,
        event: data.event || null,
        exec_price: data.exec_price || null,
        created_at: data.created_at || null,
      };
    });

    // Active positions count
    const posSnap = await db.collection("positions_paper")
      .where("exchange", "==", exchange)
      .where("status", "==", "ACTIVE")
      .get();

    return {
      ok: true,
      ts: new Date().toISOString(),
      signals,
      fills,
      active_positions: posSnap.size,
    };
  } catch (e) {
    return { ok: false, ts: new Date().toISOString(), error: e.message, signals: [], fills: [], active_positions: 0 };
  }
}

// Graceful shutdown
function closeAllSSE() {
  for (const client of clients) {
    try { client.end(); } catch (_) {}
  }
  clients.clear();
}

module.exports = router;
module.exports.closeAllSSE = closeAllSSE;
