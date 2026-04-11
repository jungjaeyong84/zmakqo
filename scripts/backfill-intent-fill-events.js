"use strict";

const { runIntentFillEventBackfill } = require("../src/services/intentFillEventBackfill");

async function main() {
  const dryRun = String(process.env.INTENT_FILL_EVENT_BACKFILL_DRY_RUN || "").trim() === "1";
  const maxDocsPerCollection = Number(process.env.INTENT_FILL_EVENT_BACKFILL_MAX_DOCS_PER_COLLECTION);
  const pageSize = Number(process.env.INTENT_FILL_EVENT_BACKFILL_PAGE_SIZE);
  const result = await runIntentFillEventBackfill({
    dryRun,
    maxDocsPerCollection: Number.isFinite(maxDocsPerCollection) ? maxDocsPerCollection : Infinity,
    pageSize: Number.isFinite(pageSize) ? pageSize : 200,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
