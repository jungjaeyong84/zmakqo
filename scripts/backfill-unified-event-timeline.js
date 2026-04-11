#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runUnifiedEventTimelineBackfill } = require("../src/services/unifiedEventBackfill");

async function main() {
  const result = await runUnifiedEventTimelineBackfill({
    pageSize: process.env.UNIFIED_EVENT_BACKFILL_PAGE_SIZE || null,
    maxDocsPerCollection: process.env.UNIFIED_EVENT_BACKFILL_MAX_DOCS_PER_COLLECTION || null,
    dryRun: String(process.env.UNIFIED_EVENT_BACKFILL_DRY_RUN || "").trim() === "1",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("backfill-unified-event-timeline failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
