#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const { getCachedRecentByCreatedAt } = require("./lib/firestore-recent-cache");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  writeJson,
  writeText,
} = require("./lib/automation-utils");

const DEFAULT_LIMIT = Math.max(3000, Number(process.env.ANALYTICS_CACHE_DEFAULT_LIMIT || 30000));
const FILL_LIMIT = Math.max(DEFAULT_LIMIT * 2, Number(process.env.ANALYTICS_CACHE_FILLS_LIMIT || (DEFAULT_LIMIT * 2)));
const PAGE_SIZE = Math.max(500, Number(process.env.ANALYTICS_CACHE_PAGE_SIZE || 1000));

function renderMarkdown({ nowMeta, collections }) {
  const lines = [];
  lines.push("# Analytics Local Cache Refresh");
  lines.push("");
  lines.push(`- 실행 시각: ${nowMeta.kst}`);
  lines.push("");
  lines.push("## 컬렉션");
  for (const row of collections) {
    lines.push(`- ${row.name}: ${row.filePath} / cached=${row.count} / returned=${row.returned} / new=${row.fetched_new} / overlap=${row.overlap_fetched} / source=${row.source}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  loadLocalEnv();
  const nowMeta = nowKstMeta();
  const [signals, drops, fills, intents] = await Promise.all([
    getCachedRecentByCreatedAt("signals", { limit: DEFAULT_LIMIT, maxDocs: DEFAULT_LIMIT, overlapDocs: 400, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("signals_dropped", { limit: DEFAULT_LIMIT, maxDocs: DEFAULT_LIMIT, overlapDocs: 400, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("fills_paper", { limit: FILL_LIMIT, maxDocs: FILL_LIMIT, overlapDocs: 800, pageSize: PAGE_SIZE, refresh: true }),
    getCachedRecentByCreatedAt("order_intents_paper", { limit: FILL_LIMIT, maxDocs: FILL_LIMIT, overlapDocs: 800, pageSize: PAGE_SIZE, refresh: true }),
  ]);

  const collections = [
    { name: "signals", ...signals.meta },
    { name: "signals_dropped", ...drops.meta },
    { name: "fills_paper", ...fills.meta },
    { name: "order_intents_paper", ...intents.meta },
  ];

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    collections,
  };

  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_analytics_local_cache_refresh.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_analytics_local_cache_refresh.md`);
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown({ nowMeta, collections }));
  copyLatest(jsonPath, path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.json"));
  copyLatest(mdPath, path.join(OPS_DAILY_DIR, "analytics_local_cache_refresh_latest.md"));
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("refresh-analytics-local-cache failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

