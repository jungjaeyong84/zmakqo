#!/usr/bin/env node
"use strict";

const { backfillLatestPositionReadModel } = require("../src/services/positionReadModelBackfill");

async function main() {
  const dryRun = String(process.env.POSITION_READ_MODEL_BACKFILL_DRY_RUN || "0").trim() === "1";
  const exchange = String(process.env.POSITION_READ_MODEL_BACKFILL_EXCHANGE || "").trim() || null;
  const pageSize = Number(process.env.POSITION_READ_MODEL_BACKFILL_PAGE_SIZE || 1000);
  const maxDocs = Number(process.env.POSITION_READ_MODEL_BACKFILL_MAX_DOCS || 0);
  const result = await backfillLatestPositionReadModel({
    exchange,
    pageSize,
    maxDocs,
    dryRun,
  });
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
