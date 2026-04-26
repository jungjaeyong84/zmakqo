#!/usr/bin/env node
"use strict";

const { createBinanceLiquidationStreamCollector } = require("../src/v2/binanceLiquidationStreamCollector");

async function main() {
  const collector = createBinanceLiquidationStreamCollector({ env: process.env });
  const started = collector.start();
  console.log(JSON.stringify({
    ok: started.ok === true,
    reason: started.reason,
    state: collector.state(),
  }));
  if (started.reason === "LIQUIDATION_STREAM_DISABLED") return;

  const shutdown = () => {
    const stopped = collector.stop();
    console.log(JSON.stringify({ ok: true, reason: stopped.reason, state: collector.state() }));
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    reason: "V2_LIQUIDATION_STREAM_COLLECTOR_FAILED",
    error: error && error.message ? error.message : String(error),
  }));
  process.exit(1);
});
