#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { replayDecisionTimelineV2 } = require("../src/services/decisionReplayV2");
const { KST_OFFSET_MS, toKstString } = require("../src/utils/timeKst");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, String(text || ""), "utf8");
}

function copyLatest(sourcePath, latestPath) {
  ensureDir(path.dirname(latestPath));
  fs.copyFileSync(sourcePath, latestPath);
}

function nowKstMeta(nowMs = Date.now()) {
  const k = new Date(nowMs + KST_OFFSET_MS);
  const pad2 = (n) => String(n).padStart(2, "0");
  return {
    nowMs,
    kst: toKstString(nowMs),
    dateKey: `${k.getUTCFullYear()}-${pad2(k.getUTCMonth() + 1)}-${pad2(k.getUTCDate())}`,
    hhmm: `${pad2(k.getUTCHours())}${pad2(k.getUTCMinutes())}`,
  };
}

function renderMarkdown(payload = {}) {
  const counts = payload.counts || {};
  return [
    "# Decision Replay V2",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- exchange: ${payload.exchange || "N/A"} / symbol: ${payload.symbol || "N/A"}`,
    `- timeline_n: ${payload.timeline_n != null ? payload.timeline_n : "N/A"}`,
    `- decisions: ${counts.decisions_n != null ? counts.decisions_n : "N/A"} / intents: ${counts.intents_n != null ? counts.intents_n : "N/A"} / fills: ${counts.fills_n != null ? counts.fills_n : "N/A"} / position_mutations: ${counts.position_mutations_n != null ? counts.position_mutations_n : "N/A"}`,
    `- latest_position_summary: ${payload.latest_position_summary ? JSON.stringify(payload.latest_position_summary) : "N/A"}`,
  ].join("\n") + "\n";
}

async function main() {
  const exchange = String(process.env.REPLAY_EXCHANGE || "BINANCEFUT").trim().toUpperCase();
  const symbol = String(process.env.REPLAY_SYMBOL || "").trim().toUpperCase();
  if (!symbol) throw new Error("REPLAY_SYMBOL_REQUIRED");
  const windowHours = Math.max(1, Number(process.env.REPLAY_WINDOW_HOURS || 24));
  const limitPerCollection = Math.max(50, Number(process.env.REPLAY_LIMIT_PER_COLLECTION || 500));
  const nowMeta = nowKstMeta();
  const fromMs = nowMeta.nowMs - (windowHours * 60 * 60 * 1000);
  const payload = {
    generated_at_kst: nowMeta.kst,
    ...(await replayDecisionTimelineV2({
      exchange,
      symbol,
      fromMs,
      toMs: nowMeta.nowMs,
      limitPerCollection,
    })),
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_decision_replay_v2_${exchange}_${symbol}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, `decision_replay_v2_${exchange}_${symbol}_latest.json`);
  const latestMd = path.join(OPS_DAILY_DIR, `decision_replay_v2_${exchange}_${symbol}_latest.md`);
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_md: latestMd, timeline_n: payload.timeline_n }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_DECISION_REPLAY_V2_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main };
