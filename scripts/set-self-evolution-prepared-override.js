#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
} = require("./lib/automation-utils");
const {
  extractPineStrategyId,
  normalizePreparedOverride,
} = require("../src/utils/selfEvolutionPreparedOverride");
const { updateLatestGeneratedPine } = require("./lib/pine-file-ops");

loadLocalEnv();

const RUNTIME_PATH = path.join(OPS_RUNTIME_DIR, "self_evolution_prepared_override.json");
const DAILY_PATH = path.join(OPS_DAILY_DIR, "self_evolution_prepared_override_latest.json");
const WEEKLY_HISTORY_PATH = path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json");
const DEFAULT_FILE = path.join(path.resolve(__dirname, ".."), "code", "donbeolja_latest_generated.pine.txt");

function latestWeekMeta() {
  const history = readJsonRawSafe(WEEKLY_HISTORY_PATH, null);
  const rows = Array.isArray(history && history.weeks) ? history.weeks : [];
  return rows.length ? rows[rows.length - 1] : {};
}

function main() {
  const nowMeta = nowKstMeta();
  const latestWeek = latestWeekMeta();
  const preparedFilePath = path.resolve(process.argv[2] || DEFAULT_FILE);
  const preparedStrategyId = process.argv[3] || extractPineStrategyId(preparedFilePath);
  if (!preparedStrategyId) {
    throw new Error("PREPARED_STRATEGY_ID_NOT_FOUND");
  }
  const latestGeneratedFilePath = updateLatestGeneratedPine(preparedFilePath)
    || path.join(path.dirname(preparedFilePath), "donbeolja_latest_generated.pine.txt");
  const payload = {
    ok: true,
    enabled: true,
    created_at_kst: nowMeta.kst,
    created_at_iso: new Date(nowMeta.nowMs).toISOString(),
    override_source: "MANUAL",
    prepared_reason: "MANUAL_PREPARED_OVERRIDE",
    target_candidate_id: String(latestWeek.recommended_patch_id || "").trim() || "AUTO_CORE_REGIME_TIGHTEN",
    display_candidate_id: String(latestWeek.display_recommended_patch_id || "").trim() || "AUTO_LONG_SHORT_REGIME_TIGHTEN",
    prepared_file_path: preparedFilePath,
    prepared_strategy_id: preparedStrategyId,
    latest_generated_file_path: latestGeneratedFilePath,
    prepared_stage_ready: true,
    ready_for_manual_paste: true,
  };
  const normalized = normalizePreparedOverride(payload);
  if (!normalized.active) {
    throw new Error("PREPARED_OVERRIDE_INVALID");
  }
  writeJson(RUNTIME_PATH, payload);
  writeJson(DAILY_PATH, payload);
  console.log(JSON.stringify({
    ok: true,
    runtime_path: RUNTIME_PATH,
    latest_path: DAILY_PATH,
    prepared_strategy_id: preparedStrategyId,
    prepared_file_path: preparedFilePath,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SELF_EVOLUTION_PREPARED_OVERRIDE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
