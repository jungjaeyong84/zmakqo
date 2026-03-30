#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  loadLocalEnv,
  ensureDir,
  readJsonRawSafe,
  writeJson,
  writeText,
  formatSignedPct,
  formatSignedNumber,
  nowKstMeta,
  sendKoreanTelegramSummary,
  resolveBaseUrlInfo,
  kstStartOfTodayUtcMs,
  toIso,
} = require("./lib/automation-utils");
const {
  updateLatestGeneratedPine,
  openPineFileForReview,
} = require("./lib/pine-file-ops");
const { defaultExecTfFromEnv, normalizeTf } = require("../src/utils/marketConfig");

loadLocalEnv();
ensureDir(OPS_DAILY_DIR);

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_HISTORY_PATH = path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json");
const MONTHLY_HISTORY_PATH = path.join(OPS_DAILY_DIR, "monthly_pine_upgrade_history.json");
const WEEKLY_GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
const WEEKLY_PACK_DOWNLOAD_TIMEOUT_SEC = Math.max(30, Number(process.env.WEEKLY_PACK_DOWNLOAD_TIMEOUT_SEC || 120));
const WEEKLY_OCTOPUS_TIMEOUT_MS = Math.max(60_000, Number(process.env.WEEKLY_OCTOPUS_TIMEOUT_MS || 300_000));
const REQUIRED_QA_ARTIFACTS = Object.freeze({
  qaData: "qa/data_quality_report.json",
  qaReplay: "qa/deterministic_replay_report.json",
});
const CHANGE_CONTROL_LATEST_PATH = resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json");
const CODEX_PATCH_REVIEW_LATEST_PATH = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");
const OBJECTIVE_RETROSPECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json");
const SELF_EVOLUTION_OBJECTIVE_SUPERVISOR_LATEST_PATH = resolveLatestArtifactPath("best_self_evolution_objective_supervisor_latest.json", "objective_supervisor_latest.json");
const SELF_EVOLUTION_CANDIDATES_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json");
const CODEX_PATCH_REVIEW_MAX_AGE_HOURS = Math.max(6, Number(process.env.CODEX_PATCH_REVIEW_MAX_AGE_HOURS || 36));

function parsePineBaseInfo() {
  const basePath = path.join(REPO_ROOT, "code", "donbeolja.pine.txt");
  const raw = fs.readFileSync(basePath, "utf8");
  const versionMatch = raw.match(/v(\d+\.\d+\.\d+\.\d+)/);
  const strategyMatch = raw.match(/STRATEGY_ID\s*=\s*\"([^\"]+)\"/);
  return {
    path: basePath,
    raw,
    version: versionMatch ? versionMatch[1] : null,
    strategyId: strategyMatch ? strategyMatch[1] : null,
  };
}

function incrementVersion(version) {
  const parts = String(version || "").split(".").map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error("INVALID_BASE_VERSION");
  parts[3] += 1;
  return parts.join(".");
}

function monthKeyFromIso(iso) {
  return String(iso || "").slice(0, 7);
}

function dateKeyFromIso(iso) {
  return String(iso || "").slice(0, 10);
}

function downloadPack({ baseUrl, fromIso, toIso, outPath }) {
  const tf = normalizeTf(String(
    process.env.IMPROVEMENT_PACK_TF ||
    defaultExecTfFromEnv() ||
    process.env.EXCHANGE_TF_ALLOWLIST ||
    "15m"
  ).split(",")[0].trim()) || defaultExecTfFromEnv() || "15m";
  const url = `${baseUrl}/api/report/improvement-pack?level=STANDARD&pack_ver=v1&exchange=BINANCEFUT&tf=${encodeURIComponent(tf)}&from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`;
  execFileSync("curl", [
    "-L",
    "--fail",
    "--connect-timeout",
    "10",
    "--max-time",
    String(WEEKLY_PACK_DOWNLOAD_TIMEOUT_SEC),
    "-o",
    outPath,
    url,
  ], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return {
    zipPath: outPath,
    request_url: url,
    tf,
  };
}

function readZipJsonWithStatus(zipPath, innerPath, fallback = null) {
  try {
    const raw = execFileSync("unzip", ["-p", zipPath, innerPath], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      ok: true,
      innerPath,
      data: JSON.parse(raw),
      error: null,
    };
  } catch (err) {
    return {
      ok: false,
      innerPath,
      data: fallback,
      error: err && err.message ? String(err.message) : "ZIP_JSON_READ_FAILED",
    };
  }
}

function readZipJson(zipPath, innerPath, fallback = null) {
  return readZipJsonWithStatus(zipPath, innerPath, fallback).data;
}

function qaGateStatus(pack) {
  const dq = pack.qaData || {};
  const det = pack.qaReplay || {};
  const artifacts = (pack && pack.artifacts && typeof pack.artifacts === "object") ? pack.artifacts : {};
  const integrity = dq.integrity || {};
  const summary = dq.summary || {};
  const autoRepair = dq.auto_repair || {};
  const matchPct = Number(det.match_pct);
  const joinRate = Number(integrity.join_rate);
  const labelJoin = Number(integrity.label_join_rate);
  const tradeLink = Number(integrity.trade_entry_event_link_rate);
  const missingRequiredArtifacts = Object.entries(REQUIRED_QA_ARTIFACTS)
    .filter(([key]) => !(artifacts[key] && artifacts[key].ok === true))
    .map(([, innerPath]) => innerPath);
  const qaArtifactErrors = Object.entries(REQUIRED_QA_ARTIFACTS)
    .filter(([key]) => artifacts[key] && artifacts[key].ok !== true && artifacts[key].error)
    .map(([key, innerPath]) => `${innerPath}: ${artifacts[key].error}`);
  const fail = (
    missingRequiredArtifacts.length > 0
    || qaArtifactErrors.length > 0
    || Number(summary.missing || 0) > 0
    || Number(summary.duplicate || 0) > 0
    || Number(summary.misaligned || 0) > 0
    || (Number.isFinite(matchPct) && matchPct < 1)
    || (Number.isFinite(joinRate) && joinRate < 0.99)
    || (Number.isFinite(labelJoin) && labelJoin < 0.99)
    || (Number.isFinite(tradeLink) && tradeLink < 0.99)
  );
  return {
    pass: !fail,
    required_artifacts_ok: missingRequiredArtifacts.length === 0,
    missing_required_artifacts: missingRequiredArtifacts,
    artifact_errors: qaArtifactErrors,
    join_rate: joinRate,
    label_join_rate: labelJoin,
    trade_link_rate: tradeLink,
    deterministic_match_pct: matchPct,
    delayed: Number(summary.delayed || 0),
    summary,
    auto_repair: {
      attempted: autoRepair.attempted === true,
      before_missing: Number(autoRepair.before_missing || 0),
      after_missing: Number(autoRepair.after_missing || 0),
      recovered_missing: Number(autoRepair.recovered_missing || 0),
      attempted_markets_n: Array.isArray(autoRepair.attempted_markets) ? autoRepair.attempted_markets.length : 0,
      repaired_markets_n: Array.isArray(autoRepair.repaired_markets) ? autoRepair.repaired_markets.length : 0,
      error_count: Array.isArray(autoRepair.errors) ? autoRepair.errors.length : 0,
    },
  };
}

function normalizeKpis(overall = {}) {
  const trades = Number(overall.trades_n || 0);
  const ev = Number(overall.ev);
  return {
    trades_n: trades,
    win_rate: Number(overall.win_rate),
    ev,
    net_proxy: Number.isFinite(ev) && Number.isFinite(trades) ? ev * trades : null,
    worst: Number(overall.worst),
    p10: Number(overall.p10),
    mdd: Number(overall.mdd),
  };
}

function toSignalMap(rows = []) {
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.signal_type) continue;
    out.set(String(row.signal_type), row);
  }
  return out;
}

function isDirectionalSharedCandidate(changes, registryMap) {
  const normalized = [];
  const seen = new Set();
  for (const row of changes) {
    if (!row || !row.key) continue;
    const key = String(row.key);
    const newValue = row.new_value;
    if (/_long$/i.test(key)) {
      const mate = key.replace(/_long$/i, "_short");
      const mateReg = registryMap.get(mate);
      if (!mateReg) return { ok: false, changes: [], reason: `OPPOSITE_KEY_MISSING:${mate}` };
      for (const nextKey of [key, mate]) {
        if (seen.has(nextKey)) continue;
        const reg = registryMap.get(nextKey);
        if (!reg) return { ok: false, changes: [], reason: `REGISTRY_MISSING:${nextKey}` };
        normalized.push({ key: nextKey, old_value: reg.default_value, new_value: newValue });
        seen.add(nextKey);
      }
      continue;
    }
    if (/_short$/i.test(key)) {
      const mate = key.replace(/_short$/i, "_long");
      const mateReg = registryMap.get(mate);
      if (!mateReg) return { ok: false, changes: [], reason: `OPPOSITE_KEY_MISSING:${mate}` };
      for (const nextKey of [mate, key]) {
        if (seen.has(nextKey)) continue;
        const reg = registryMap.get(nextKey);
        if (!reg) return { ok: false, changes: [], reason: `REGISTRY_MISSING:${nextKey}` };
        normalized.push({ key: nextKey, old_value: reg.default_value, new_value: newValue });
        seen.add(nextKey);
      }
      continue;
    }
    if (seen.has(key)) continue;
    normalized.push({ key, old_value: row.old_value, new_value: row.new_value });
    seen.add(key);
  }
  return { ok: true, changes: normalized, reason: null };
}

function generateHeuristicCandidate(pack, registryMap) {
  const rows = Array.isArray(pack.kpiBySignal) ? pack.kpiBySignal : [];
  const primaryRows = rows.filter((row) => {
    const signalType = String(row && row.signal_type || "").toUpperCase();
    return signalType === "LONG" || signalType === "SHORT";
  });
  const primary = primaryRows
    .slice()
    .sort((a, b) => Number(a.fill_rate || 0) - Number(b.fill_rate || 0))[0];

  if (primary && Number(primary.fill_rate) < 0.3 && registryMap.has("pre_real_wave_conf_min")) {
    const reg = registryMap.get("pre_real_wave_conf_min");
    return {
      key: "pre_real_wave_conf_min",
      old_value: Number(reg.default_value),
      new_value: Number(reg.default_value) + 0.02,
      rationale: "LONG/SHORT 단일 진입 체결 효율이 낮아 공용 수량 프로파일 wave threshold를 소폭 상향",
    };
  }
  if (primary && Number(primary.fill_rate) < 0.2 && registryMap.has("gap_early_base")) {
    const reg = registryMap.get("gap_early_base");
    return {
      key: "gap_early_base",
      old_value: Number(reg.default_value),
      new_value: Number(reg.default_value) + 2,
      rationale: "LONG/SHORT 단일 진입 체결 효율이 낮아 공용 진입 gap을 소폭 확대",
    };
  }
  return null;
}

function buildCandidateRows(pack, previousPack, registryMap) {
  const proposal = pack.patchBundle || {};
  const conservative = proposal.proposals && proposal.proposals.conservative;
  const aggressive = proposal.proposals && proposal.proposals.aggressive;
  const rows = [];

  if (conservative && Array.isArray(conservative.changed_keys) && conservative.changed_keys.length) {
    const normalized = isDirectionalSharedCandidate(conservative.changed_keys, registryMap);
    rows.push({
      patch_id: conservative.patch_id || "conservative",
      source: "patch_bundle_conservative",
      safe: !!(conservative.validation && conservative.validation.ok && normalized.ok),
      reason: normalized.ok ? "conservative proposal mirrored symmetrically" : normalized.reason,
      changes: normalized.ok ? normalized.changes : [],
      expected_effect: conservative.expected_effect || {},
      rollback: conservative.guardrails || [],
    });
  }

  if (aggressive && Array.isArray(aggressive.changed_keys) && aggressive.changed_keys.length) {
    const normalized = isDirectionalSharedCandidate(aggressive.changed_keys, registryMap);
    rows.push({
      patch_id: aggressive.patch_id || "aggressive",
      source: "patch_bundle_aggressive",
      safe: false,
      reason: aggressive.validation && aggressive.validation.errors ? aggressive.validation.errors.join(", ") : (normalized.reason || "unsafe"),
      changes: normalized.ok ? normalized.changes : [],
      expected_effect: aggressive.expected_effect || {},
      rollback: aggressive.guardrails || [],
    });
  }

  const heuristic = generateHeuristicCandidate(pack, registryMap);
  if (heuristic) {
    rows.push({
      patch_id: `${dateKeyFromIso(pack.range.from_utc || "")}_shared_heuristic_v1`,
      source: "heuristic_shared_threshold",
      safe: true,
      reason: heuristic.rationale,
      changes: [{ key: heuristic.key, old_value: heuristic.old_value, new_value: heuristic.new_value }],
      expected_effect: {},
      rollback: [
        "OOS win_rate가 baseline 대비 3%p 이상 하락",
        "OOS EV가 baseline 대비 감소",
        "worst 또는 p10가 baseline 대비 악화",
        "fill_rate가 30% 이상 감소",
      ],
    });
  }

  return rows.slice(0, 3);
}

function detectProblemSignals(pack) {
  return (Array.isArray(pack.kpiBySignal) ? pack.kpiBySignal : [])
    .filter((row) => !String(row.signal_type || "").startsWith("EXIT_"))
    .sort((a, b) => Number(a.ev || 0) - Number(b.ev || 0))
    .slice(0, 5);
}

function compareOverall(current, previous) {
  return {
    win_rate_delta: Number(current.win_rate) - Number(previous.win_rate),
    ev_delta: Number(current.ev) - Number(previous.ev),
    net_delta: Number(current.net_proxy) - Number(previous.net_proxy),
  };
}

function evaluatePreviousChange(deltas) {
  const bad = [
    Number(deltas.win_rate_delta) < -0.03,
    Number(deltas.ev_delta) < 0,
    Number(deltas.net_delta) < 0,
  ].filter(Boolean).length;
  const good = [
    Number(deltas.win_rate_delta) > 0.03,
    Number(deltas.ev_delta) > 0,
    Number(deltas.net_delta) > 0,
  ].filter(Boolean).length;
  if (bad >= 2) return "harmful";
  if (good >= 2) return "effective";
  return "mixed";
}

function readHistory(filePath, key) {
  const data = readJsonRawSafe(filePath, {});
  if (!data || typeof data !== "object") return [];
  const rows = Array.isArray(data[key]) ? data[key] : [];
  return rows;
}

function writeHistory(filePath, key, nextRow) {
  const data = readJsonRawSafe(filePath, {});
  const rows = Array.isArray(data[key]) ? data[key] : [];
  const filtered = rows.filter((row) => row && row.week_key !== nextRow.week_key);
  filtered.push(nextRow);
  filtered.sort((a, b) => String(a.week_key).localeCompare(String(b.week_key)));
  writeJson(filePath, { [key]: filtered });
  return filtered;
}

function deriveTrend(rows) {
  const recent = rows.slice(-3);
  if (recent.length < 2) return "mixed";
  const flags = recent.map((row) => String(row.assessment || "mixed"));
  const good = flags.filter((x) => x === "effective").length;
  const bad = flags.filter((x) => x === "harmful").length;
  if (good >= 2) return "improved";
  if (bad >= 2) return "degraded";
  return "mixed";
}

function buildMonthlyRows(weeklyRows) {
  const byMonth = new Map();
  for (const row of weeklyRows) {
    const monthKey = String(row.month_key || "");
    if (!monthKey) continue;
    if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
    byMonth.get(monthKey).push(row);
  }
  const out = [];
  for (const [monthKey, rows] of byMonth.entries()) {
    rows.sort((a, b) => String(a.week_key).localeCompare(String(b.week_key)));
    out.push({
      month_key: monthKey,
      weeks: rows.map((row) => row.week_key),
      latest_overall: rows[rows.length - 1].overall,
      month_to_date_trend: deriveTrend(rows),
    });
  }
  out.sort((a, b) => String(a.month_key).localeCompare(String(b.month_key)));
  return out;
}

function applyInputChange(text, change, registryMap) {
  const reg = registryMap.get(change.key);
  if (!reg || !reg.code_anchor || !Number.isFinite(Number(reg.code_anchor.line_start))) {
    const abstractPatched = applyAbstractSharedChange(text, change);
    if (abstractPatched != null) return abstractPatched;
    throw new Error(`ANCHOR_MISSING:${change.key}`);
  }
  const lines = text.split(/\r?\n/);
  const idx = Number(reg.code_anchor.line_start) - 1;
  if (!lines[idx] || !lines[idx].includes(change.key)) {
    throw new Error(`ANCHOR_LINE_MISMATCH:${change.key}`);
  }
  const newValue = typeof change.new_value === "string" ? `"${change.new_value}"` : String(change.new_value);
  const replaced = lines[idx].replace(/(input\.\w+\()\s*([^,]+)(,)/, `$1${newValue}$3`);
  if (replaced === lines[idx]) throw new Error(`INPUT_REPLACE_FAILED:${change.key}`);
  lines[idx] = replaced;
  return lines.join("\n");
}

function patchNumberLiteral(text, pattern, delta) {
  let replaced = false;
  const out = String(text || "").replace(pattern, (_match, prefix, num, suffix = "") => {
    replaced = true;
    return `${prefix}${Number(num) + Number(delta)}${suffix}`;
  });
  return replaced ? out : null;
}

function applyAbstractSharedChange(text, change = {}) {
  const key = String(change.key || "").trim();
  const delta = Number(
    Object.prototype.hasOwnProperty.call(change, "new_value")
      ? change.new_value
      : (Object.prototype.hasOwnProperty.call(change, "next") ? change.next : NaN)
  );
  if (!key || !Number.isFinite(delta)) return null;
  if (key === "shared_regime_transition_confirmation") {
    return patchNumberLiteral(
      text,
      /(bool\s+_regime_ok_core\s*=\s*_regime_for_core\s*==\s*"trend"\s+or\s+\(_regime_for_core\s*==\s*"transition"\s+and\s+math\.abs\(score\)\s*>=\s*)(\d+)(\))/,
      delta
    );
  }
  if (key === "entry_core_score_abs" || key === "shared_core_score_floor") {
    return patchNumberLiteral(
      text,
      /(bf_core_score_min\s*=\s*input\.int\()(\d+)(,\s*"CORE 점수 최소")/,
      delta
    );
  }
  if (key === "shared_early_score_floor") {
    return patchNumberLiteral(
      text,
      /(bf_early_score_min\s*=\s*input\.int\()(\d+)(,\s*"LONG\/SHORT 기본 점수 최소")/,
      delta
    );
  }
  return null;
}

function updateVersionInPine(text, newVersion) {
  let out = text.replace(/v\d+\.\d+\.\d+\.\d+/m, `v${newVersion}`);
  out = out.replace(/STRATEGY_ID\s*=\s*\"donbeolja_v\d+\.\d+\.\d+\.\d+\"/, `STRATEGY_ID = "donbeolja_v${newVersion}"`);
  return out;
}

function createVersionedPine(baseInfo, candidate, registryMap, dryRun = false) {
  const nextVersion = incrementVersion(baseInfo.version);
  const nextFilePath = path.join(REPO_ROOT, "code", `donbeolja_v${nextVersion}.pine.txt`);
  let nextText = baseInfo.raw;
  for (const change of candidate.changes) {
    nextText = applyInputChange(nextText, change, registryMap);
  }
  nextText = updateVersionInPine(nextText, nextVersion);
  if (!dryRun) fs.writeFileSync(nextFilePath, nextText, "utf8");
  return { nextVersion, nextFilePath };
}

function markdownSection(title, lines) {
  return [`${title}`, ...lines.map((line) => `${line}`), ""].join("\n");
}

function readChangeControlLatest() {
  return readJsonRawSafe(CHANGE_CONTROL_LATEST_PATH, null);
}

function readWeeklyGovernanceLatest() {
  const data = readJsonRawSafe(WEEKLY_GOVERNANCE_LATEST_PATH, null);
  if (!data || typeof data !== "object") return null;
  return {
    filePath: WEEKLY_GOVERNANCE_LATEST_PATH,
    objectiveConfig: data.objective || null,
    currentObjective: data.current && data.current.objective ? data.current.objective : null,
    previousObjective: data.previous && data.previous.objective ? data.previous.objective : null,
  };
}

function readCodexPatchReviewLatest() {
  const data = readJsonRawSafe(CODEX_PATCH_REVIEW_LATEST_PATH, null);
  if (!data || typeof data !== "object") return null;
  let fresh = false;
  try {
    const st = fs.statSync(CODEX_PATCH_REVIEW_LATEST_PATH);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    fresh = Number.isFinite(ageHours) && ageHours <= CODEX_PATCH_REVIEW_MAX_AGE_HOURS;
  } catch (_err) {
    fresh = false;
  }
  return {
    filePath: CODEX_PATCH_REVIEW_LATEST_PATH,
    fresh,
    verdict: String(data.verdict || "HOLD").toUpperCase(),
    recommendedCandidateId: String(data.recommended_candidate_id || "").trim() || null,
    recommendedRollbackFilePath: String(data.recommended_rollback_file_path || "").trim() || null,
    confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
    reason: String(data.reason || data.summary || "N/A"),
    raw: data,
  };
}

function readObjectiveRetrospectiveLatest() {
  const data = readJsonRawSafe(OBJECTIVE_RETROSPECTIVE_LATEST_PATH, null);
  if (!data || typeof data !== "object") return null;
  return {
    filePath: OBJECTIVE_RETROSPECTIVE_LATEST_PATH,
    daily: data.periods && data.periods.DAILY ? data.periods.DAILY : null,
    weekly: data.periods && data.periods.WEEKLY ? data.periods.WEEKLY : null,
    monthly: data.periods && data.periods.MONTHLY ? data.periods.MONTHLY : null,
  };
}

function readSelfEvolutionObjectiveSupervisorLatest() {
  const data = readJsonRawSafe(SELF_EVOLUTION_OBJECTIVE_SUPERVISOR_LATEST_PATH, null);
  if (!data || typeof data !== "object") return null;
  const raw = data.raw && typeof data.raw === "object" ? data.raw : data;
  return {
    filePath: SELF_EVOLUTION_OBJECTIVE_SUPERVISOR_LATEST_PATH,
    raw,
    verdict: String(raw.verdict || "HOLD").toUpperCase(),
    reason: String(raw.reason || "").trim() || null,
    promotion: raw.promotion && typeof raw.promotion === "object" ? raw.promotion : null,
  };
}

function readSelfEvolutionCandidatesLatest() {
  const data = readJsonRawSafe(SELF_EVOLUTION_CANDIDATES_LATEST_PATH, null);
  if (!data || typeof data !== "object") return null;
  return {
    filePath: SELF_EVOLUTION_CANDIDATES_LATEST_PATH,
    rows: Array.isArray(data.rows) ? data.rows : [],
    summary: data.summary && typeof data.summary === "object" ? data.summary : null,
  };
}

function buildSelfEvolutionRecoveryWeeklyCandidate({ objectiveSupervisor = null, candidatesReport = null } = {}) {
  const promotion = objectiveSupervisor && objectiveSupervisor.promotion && typeof objectiveSupervisor.promotion === "object"
    ? objectiveSupervisor.promotion
    : null;
  if (!promotion || promotion.ready !== true || promotion.recovery_mode !== true) return null;
  const candidateId = String(promotion.candidate_id || "").trim();
  if (!candidateId) return null;
  const rows = candidatesReport && Array.isArray(candidatesReport.rows) ? candidatesReport.rows : [];
  const row = rows.find((item) => String(item && item.candidate_id || "").trim() === candidateId);
  if (!row || !Array.isArray(row.changes) || row.changes.length === 0) return null;
  return {
    patch_id: String(row.display_candidate_id || row.candidate_id || candidateId).trim(),
    source: `self_evolution:${String(row.source || "RECOVERY").trim() || "RECOVERY"}`,
    safe: true,
    reason: String(promotion.reason || objectiveSupervisor.reason || row.status || "AUTONOMOUS_RECOVERY_PROMOTION").trim(),
    changes: row.changes.map((change) => ({
      ...change,
      old_value: Object.prototype.hasOwnProperty.call(change, "old_value") ? change.old_value : change.current,
      new_value: Object.prototype.hasOwnProperty.call(change, "new_value") ? change.new_value : change.next,
    })),
  };
}

function buildOctopusTaskPrompt({ currentQa, previousQa, currentOverall, previousOverall, deltas, previousChangeAssessment, problemSignals, candidates, baseInfo, currentPack, previousPack, weeklyGovernance, objectiveRetrospective }) {
  const safeIds = candidates.filter((row) => row.safe).map((row) => row.patch_id);
  const candidateText = candidates.map((row) => [
    `- patch_id: ${row.patch_id}`,
    `  source: ${row.source}`,
    `  safe: ${row.safe}`,
    `  reason: ${row.reason || "N/A"}`,
    ...(row.changes || []).map((change) => `  change: ${change.key} ${change.old_value} -> ${change.new_value}`),
  ].join("\n")).join("\n");
  const problemText = problemSignals.map((row) => `- ${row.signal_type}: win_rate=${row.win_rate}, ev=${row.ev}, fill_rate=${row.fill_rate}`).join("\n");
  return [
    "You are reviewing a weekly Pine upgrade decision for DONBEOLJA.",
    "Constraints:",
    "- Only use long/short shared changes. Do not recommend long-only or short-only optimization.",
    "- Choose one safe patch_id from the allowed list or return hold.",
    "- Prefer HOLD if QA is weak, deltas are mixed, or evidence is insufficient.",
    "- Return valid JSON only with fields: provider, workflow, verdict, recommended_patch_id, confidence, summary, findings, recommendations, assumptions.",
    "",
    `Allowed patch_ids: ${safeIds.length ? safeIds.join(", ") : "hold only"}`,
    `Base pine version: ${baseInfo.version}`,
    `Current range: ${currentPack.range.from_utc} -> ${currentPack.range.to_utc}`,
    `Previous range: ${previousPack.range.from_utc} -> ${previousPack.range.to_utc}`,
    `Current QA pass: ${currentQa.pass}`,
    `Previous QA pass: ${previousQa.pass}`,
    `Current overall: trades=${currentOverall.trades_n}, win_rate=${currentOverall.win_rate}, ev=${currentOverall.ev}, net_proxy=${currentOverall.net_proxy}`,
    `Previous overall: trades=${previousOverall.trades_n}, win_rate=${previousOverall.win_rate}, ev=${previousOverall.ev}, net_proxy=${previousOverall.net_proxy}`,
    `Deltas: win_rate=${deltas.win_rate_delta}, ev=${deltas.ev_delta}, net=${deltas.net_delta}`,
    `Shared objective: win_rate>=${weeklyGovernance && weeklyGovernance.objectiveConfig ? weeklyGovernance.objectiveConfig.min_win_rate : 0.6}, net>0, EV>0, monthly_run_rate_krw>=${weeklyGovernance && weeklyGovernance.objectiveConfig ? weeklyGovernance.objectiveConfig.min_monthly_net_krw : 1500000}`,
    `Current governance objective: ${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"} / monthly_run_rate_krw=${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.monthly_run_rate_krw : "N/A"}`,
    `Previous governance objective: ${weeklyGovernance && weeklyGovernance.previousObjective ? weeklyGovernance.previousObjective.verdict : "N/A"} / monthly_run_rate_krw=${weeklyGovernance && weeklyGovernance.previousObjective ? weeklyGovernance.previousObjective.monthly_run_rate_krw : "N/A"}`,
    `Daily retrospective: ${objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.objective ? objectiveRetrospective.daily.objective.verdict : "N/A"} / net=${objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.realized_trades ? objectiveRetrospective.daily.realized_trades.net_pnl_quote : "N/A"} / executed=${objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.entry_cohort ? objectiveRetrospective.daily.entry_cohort.executed_n : "N/A"}`,
    `Weekly retrospective: ${objectiveRetrospective && objectiveRetrospective.weekly && objectiveRetrospective.weekly.objective ? objectiveRetrospective.weekly.objective.verdict : "N/A"} / net=${objectiveRetrospective && objectiveRetrospective.weekly && objectiveRetrospective.weekly.realized_trades ? objectiveRetrospective.weekly.realized_trades.net_pnl_quote : "N/A"}`,
    `Monthly retrospective: ${objectiveRetrospective && objectiveRetrospective.monthly && objectiveRetrospective.monthly.objective ? objectiveRetrospective.monthly.objective.verdict : "N/A"} / net=${objectiveRetrospective && objectiveRetrospective.monthly && objectiveRetrospective.monthly.realized_trades ? objectiveRetrospective.monthly.realized_trades.net_pnl_quote : "N/A"}`,
    `Previous change assessment: ${previousChangeAssessment}`,
    "",
    "Problem signals:",
    problemText || "- none",
    "",
    "Candidates:",
    candidateText || "- none",
  ].join("\n");
}

function runWeeklyOctopus({ meta, currentQa, previousQa, currentOverall, previousOverall, deltas, previousChangeAssessment, problemSignals, candidates, baseInfo, currentPack, previousPack, weeklyGovernance, objectiveRetrospective }) {
  const taskPath = path.join(OPS_DAILY_DIR, `${meta.dateKey}_weekly_pine_upgrade_octopus_task.md`);
  writeText(taskPath, buildOctopusTaskPrompt({ currentQa, previousQa, currentOverall, previousOverall, deltas, previousChangeAssessment, problemSignals, candidates, baseInfo, currentPack, previousPack, weeklyGovernance, objectiveRetrospective }));
  const res = spawnSync("node", [
    path.join("scripts", "codex-octopus.js"),
    "--workflow", "pine-upgrade",
    "--title", `${meta.dateKey} weekly pine upgrade`,
    "--prompt-file", taskPath,
  ], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 8,
    timeout: WEEKLY_OCTOPUS_TIMEOUT_MS,
  });
  const rawOut = String(res.stdout || "");
  const rawErr = String(res.stderr || "");
  let parsed = null;
  try {
    parsed = JSON.parse(rawOut.trim() || "null");
  } catch (_err) {
    parsed = null;
  }
  let summary = null;
  if (parsed && parsed.summary_json) {
    summary = readJsonRawSafe(parsed.summary_json, null);
  }
  return {
    ok: res.status === 0 && !res.error,
    exit_code: res.status,
    stdout: rawOut,
    stderr: rawErr,
    timeout: !!(res.error && res.error.code === "ETIMEDOUT"),
    error: res.error && res.error.message ? String(res.error.message) : null,
    parsed,
    summary,
    taskPath,
  };
}

async function main() {
  const meta = nowKstMeta();
  const dryRun = String(process.env.DRY_RUN || process.env.AUTO_TEST || "").trim() === "1";
  const baseUrlInfo = await resolveBaseUrlInfo();
  const baseUrl = baseUrlInfo.url;
  const todayStartMs = kstStartOfTodayUtcMs(meta.nowMs);
  const currentFromMs = todayStartMs - (7 * DAY_MS);
  const previousFromMs = todayStartMs - (14 * DAY_MS);
  const currentRange = { from_utc: toIso(currentFromMs), to_utc: toIso(todayStartMs) };
  const previousRange = { from_utc: toIso(previousFromMs), to_utc: toIso(currentFromMs) };
  const currentZip = path.join("/tmp", `weekly-current-${Date.now()}.zip`);
  const previousZip = path.join("/tmp", `weekly-previous-${Date.now()}.zip`);
  const currentDownload = downloadPack({ baseUrl, fromIso: currentRange.from_utc, toIso: currentRange.to_utc, outPath: currentZip });
  const previousDownload = downloadPack({ baseUrl, fromIso: previousRange.from_utc, toIso: previousRange.to_utc, outPath: previousZip });

  const loadPack = (download) => {
    const zipPath = download && download.zipPath ? download.zipPath : download;
    const metaArtifact = readZipJsonWithStatus(zipPath, "meta/meta.json", {});
    const qaDataArtifact = readZipJsonWithStatus(zipPath, REQUIRED_QA_ARTIFACTS.qaData, {});
    const qaReplayArtifact = readZipJsonWithStatus(zipPath, REQUIRED_QA_ARTIFACTS.qaReplay, {});
    const overallArtifact = readZipJsonWithStatus(zipPath, "analysis/kpi_overall.json", {});
    const kpiBySignalArtifact = readZipJsonWithStatus(zipPath, "analysis/kpi_by_signal.json", []);
    const kpiByMarketArtifact = readZipJsonWithStatus(zipPath, "analysis/kpi_by_market.json", []);
    const kpiByRegimeArtifact = readZipJsonWithStatus(zipPath, "analysis/kpi_by_regime.json", []);
    const walkforwardArtifact = readZipJsonWithStatus(zipPath, "analysis/walkforward_summary.json", {});
    const patchBundleArtifact = readZipJsonWithStatus(zipPath, "analysis/patch_bundle_proposal.json", {});
    const registryArtifact = readZipJsonWithStatus(zipPath, "mapping/pine_input_registry.json", {});
    return {
      zipPath,
      request_url: download && download.request_url ? download.request_url : null,
      base_url: baseUrl,
      base_url_source: baseUrlInfo.source,
      artifacts: {
        meta: metaArtifact,
        qaData: qaDataArtifact,
        qaReplay: qaReplayArtifact,
        overall: overallArtifact,
        kpiBySignal: kpiBySignalArtifact,
        kpiByMarket: kpiByMarketArtifact,
        kpiByRegime: kpiByRegimeArtifact,
        walkforward: walkforwardArtifact,
        patchBundle: patchBundleArtifact,
        registry: registryArtifact,
      },
      meta: metaArtifact.data,
      qaData: qaDataArtifact.data,
      qaReplay: qaReplayArtifact.data,
      overall: overallArtifact.data,
      kpiBySignal: kpiBySignalArtifact.data,
      kpiByMarket: kpiByMarketArtifact.data,
      kpiByRegime: kpiByRegimeArtifact.data,
      walkforward: walkforwardArtifact.data,
      patchBundle: patchBundleArtifact.data,
      registry: registryArtifact.data,
    };
  };

  const currentPack = loadPack(currentDownload);
  const previousPack = loadPack(previousDownload);
  currentPack.range = currentPack.meta.range || currentRange;
  previousPack.range = previousPack.meta.range || previousRange;

  const currentQa = qaGateStatus(currentPack);
  const previousQa = qaGateStatus(previousPack);
  const currentOverall = normalizeKpis(currentPack.overall);
  const previousOverall = normalizeKpis(previousPack.overall);
  const deltas = compareOverall(currentOverall, previousOverall);
  const previousChangeAssessment = evaluatePreviousChange(deltas);
  const registryMap = new Map(
    (Array.isArray(currentPack.registry.registry) ? currentPack.registry.registry : []).map((row) => [String(row.var_name), row])
  );
  const candidates = buildCandidateRows(currentPack, previousPack, registryMap);
  const changeControl = readChangeControlLatest();
  const weeklyGovernance = readWeeklyGovernanceLatest();
  const objectiveRetrospective = readObjectiveRetrospectiveLatest();
  const codexPatchReview = readCodexPatchReviewLatest();
  const selfEvolutionObjectiveSupervisor = readSelfEvolutionObjectiveSupervisorLatest();
  const selfEvolutionCandidates = readSelfEvolutionCandidatesLatest();
  const problemSignals = detectProblemSignals(currentPack);
  const baseInfo = parsePineBaseInfo();
  const octopusResult = runWeeklyOctopus({ meta, currentQa, previousQa, currentOverall, previousOverall, deltas, previousChangeAssessment, problemSignals, candidates, baseInfo, currentPack, previousPack, weeklyGovernance, objectiveRetrospective });
  const weeklyRows = readHistory(WEEKLY_HISTORY_PATH, "weeks");

  const weekKey = `${dateKeyFromIso(currentPack.range.from_utc)}__${dateKeyFromIso(currentPack.range.to_utc)}`;
  const nextHistoryRow = {
    week_key: weekKey,
    month_key: monthKeyFromIso(currentPack.range.to_utc),
    range: currentPack.range,
    zip_path: null,
    previous_zip_path: null,
    current_pack_request_url: currentPack.request_url,
    previous_pack_request_url: previousPack.request_url,
    pack_base_url: baseUrl,
    pack_base_url_source: baseUrlInfo.source,
    qa_pass: currentQa.pass,
    overall: currentOverall,
    previous_overall: previousOverall,
    shared_objective_verdict: weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : null,
    shared_objective_pass: weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.pass === true : null,
    shared_monthly_run_rate_krw: weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.monthly_run_rate_krw : null,
    shared_monthly_target_krw: weeklyGovernance && weeklyGovernance.objectiveConfig ? weeklyGovernance.objectiveConfig.min_monthly_net_krw : null,
    retrospective_daily_verdict: objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.objective ? objectiveRetrospective.daily.objective.verdict : null,
    retrospective_weekly_verdict: objectiveRetrospective && objectiveRetrospective.weekly && objectiveRetrospective.weekly.objective ? objectiveRetrospective.weekly.objective.verdict : null,
    retrospective_monthly_verdict: objectiveRetrospective && objectiveRetrospective.monthly && objectiveRetrospective.monthly.objective ? objectiveRetrospective.monthly.objective.verdict : null,
    deltas,
    assessment: previousChangeAssessment,
    recommended_patch_id: null,
    change_control_verdict: changeControl && changeControl.verdict ? changeControl.verdict : null,
    created_file_path: null,
    latest_generated_file_path: null,
    rollback_source_file_path: null,
    rollback_prepared: false,
  };

  let recommendation = "hold";
  let chosenCandidate = null;
  let rollbackPrepared = false;
  let rollbackSourceFilePath = null;
  const safeCandidates = candidates.filter((row) => row.safe && Array.isArray(row.changes) && row.changes.length >= 1);
  const recoveryPromotionCandidate = buildSelfEvolutionRecoveryWeeklyCandidate({
    objectiveSupervisor: selfEvolutionObjectiveSupervisor,
    candidatesReport: selfEvolutionCandidates,
  });
  const promotionCandidateId = changeControl && changeControl.auto_promotion && changeControl.auto_promotion.ready
    ? String(changeControl.auto_promotion.candidate_id || "").trim()
    : (recoveryPromotionCandidate ? String(recoveryPromotionCandidate.patch_id || "").trim() : "");
  const rollbackCandidatePath = changeControl && changeControl.auto_rollback && changeControl.auto_rollback.ready
    ? String(changeControl.auto_rollback.rollback_file_path || "").trim()
    : "";
  const recoveryPromotionActive = Boolean(recoveryPromotionCandidate);
  const codexVerdict = codexPatchReview ? String(codexPatchReview.verdict || "HOLD").toUpperCase() : "HOLD";
  const codexPromotionApproved = recoveryPromotionActive
    ? true
    : !promotionCandidateId
    ? true
    : Boolean(codexPatchReview
      && codexPatchReview.fresh === true
      && codexVerdict === "PROMOTE"
      && codexPatchReview.recommendedCandidateId === promotionCandidateId);
  const codexRollbackApproved = !rollbackCandidatePath
    ? true
    : Boolean(codexPatchReview
      && codexPatchReview.fresh === true
      && codexVerdict === "ROLLBACK"
      && (!codexPatchReview.recommendedRollbackFilePath || codexPatchReview.recommendedRollbackFilePath === rollbackCandidatePath));
  const octopusProviders = Array.isArray(octopusResult.summary && octopusResult.summary.providers) ? octopusResult.summary.providers : [];
  const octopusUnavailable = !octopusResult.ok
    || !octopusResult.summary
    || (octopusProviders.length > 0 && octopusProviders.every((row) => String(row.status || "").toUpperCase() === "UNAVAILABLE"));
  if (!rollbackCandidatePath && (recoveryPromotionCandidate || (currentQa.pass && previousQa.pass && previousChangeAssessment !== "harmful" && safeCandidates.length))) {
    const octopusPatchId = String(octopusResult.summary && octopusResult.summary.recommended_patch_id || "hold").trim();
    const octopusVerdict = String(octopusResult.summary && octopusResult.summary.overall_verdict || "HOLD").toUpperCase();
    if (promotionCandidateId) {
      if (codexPromotionApproved) {
        chosenCandidate = safeCandidates.find((row) => row.patch_id === promotionCandidateId)
          || (recoveryPromotionCandidate && recoveryPromotionCandidate.patch_id === promotionCandidateId ? recoveryPromotionCandidate : null)
          || null;
      }
    } else if (octopusUnavailable) {
      if (codexPatchReview && codexPatchReview.fresh === true && codexVerdict === "PROMOTE" && codexPatchReview.recommendedCandidateId) {
        chosenCandidate = safeCandidates.find((row) => row.patch_id === codexPatchReview.recommendedCandidateId) || null;
      }
      if (!chosenCandidate) chosenCandidate = safeCandidates[0] || null;
    } else {
      if (octopusVerdict === "APPROVE" && octopusPatchId && octopusPatchId !== "hold") {
        chosenCandidate = safeCandidates.find((row) => row.patch_id === octopusPatchId) || null;
      }
      if (!chosenCandidate && octopusVerdict === "APPROVE" && safeCandidates.length === 1) {
        chosenCandidate = safeCandidates[0];
      }
      if (!chosenCandidate && codexPatchReview && codexPatchReview.fresh === true && codexVerdict === "PROMOTE" && codexPatchReview.recommendedCandidateId) {
        chosenCandidate = safeCandidates.find((row) => row.patch_id === codexPatchReview.recommendedCandidateId) || null;
      }
    }
    if (chosenCandidate) recommendation = chosenCandidate.patch_id;
  }
  nextHistoryRow.recommended_patch_id = recommendation;

  let createdFile = null;
  let latestGeneratedFilePath = null;
  let openResult = null;
  if (rollbackCandidatePath && codexRollbackApproved && !dryRun && fs.existsSync(rollbackCandidatePath)) {
    rollbackPrepared = true;
    rollbackSourceFilePath = rollbackCandidatePath;
    latestGeneratedFilePath = updateLatestGeneratedPine(rollbackCandidatePath);
    openResult = openPineFileForReview(rollbackCandidatePath);
  } else if (chosenCandidate && !dryRun) {
    createdFile = createVersionedPine(baseInfo, chosenCandidate, registryMap, false);
    latestGeneratedFilePath = updateLatestGeneratedPine(createdFile.nextFilePath);
    openResult = openPineFileForReview(createdFile.nextFilePath);
  }
  nextHistoryRow.created_file_path = createdFile ? createdFile.nextFilePath : null;
  nextHistoryRow.latest_generated_file_path = latestGeneratedFilePath;
  nextHistoryRow.rollback_source_file_path = rollbackSourceFilePath;
  nextHistoryRow.rollback_prepared = rollbackPrepared;

  const weeklyHistory = writeHistory(WEEKLY_HISTORY_PATH, "weeks", nextHistoryRow);
  const monthlyRows = buildMonthlyRows(weeklyHistory);
  writeJson(MONTHLY_HISTORY_PATH, { months: monthlyRows });

  const multiWeekTrend = deriveTrend(weeklyHistory);
  const monthTrend = (monthlyRows.find((row) => row.month_key === nextHistoryRow.month_key) || {}).month_to_date_trend || "mixed";

  const reportPath = path.join(OPS_DAILY_DIR, `${meta.dateKey}_weekly_pine_upgrade.md`);
  const topProblems = problemSignals.map((row) => `- ${row.signal_type}: win_rate=${row.win_rate == null ? "N/A" : `${(row.win_rate * 100).toFixed(1)}%`}, EV=${row.ev == null ? "N/A" : row.ev.toFixed(4)}, fill_rate=${row.fill_rate == null ? "N/A" : `${(row.fill_rate * 100).toFixed(1)}%`}`);
  const candidateLines = candidates.flatMap((row, idx) => {
    const changes = (row.changes || []).map((change) => {
      const reg = registryMap.get(change.key);
      const anchor = reg && reg.code_anchor ? `line ${reg.code_anchor.line_start}` : "line ?";
      return `  - ${change.key}: ${change.old_value} -> ${change.new_value} (${anchor})`;
    });
    return [
      `${idx + 1}. ${row.patch_id} [${row.safe ? "safe" : "hold"}]`,
      `  - 출처: ${row.source}`,
      `  - 근거: ${row.reason || "N/A"}`,
      ...changes,
      ...(Array.isArray(row.rollback) ? row.rollback.slice(0, 4).map((x) => `  - 롤백: ${x}`) : []),
    ];
  });
  const report = [
    markdownSection("(I) 베이스라인 요약", [
      `- QA: ${currentQa.pass ? "PASS" : "FAIL"} / deterministic=${currentQa.deterministic_match_pct} / join=${currentQa.join_rate}`,
      `- pack source: ${baseUrlInfo.source} / ${baseUrl}`,
      `- QA artifacts: ${currentQa.required_artifacts_ok ? "OK" : `MISSING(${currentQa.missing_required_artifacts.join(", ")})`}`,
      `- overall trades=${currentOverall.trades_n}, win_rate=${formatSignedPct(currentOverall.win_rate)}, EV=${formatSignedPct(currentOverall.ev)}, net_proxy=${formatSignedNumber(currentOverall.net_proxy, 4)}`,
      `- shared objective: win>=${weeklyGovernance && weeklyGovernance.objectiveConfig ? `${(Number(weeklyGovernance.objectiveConfig.min_win_rate || 0) * 100).toFixed(0)}%` : "60%"} / net>0 / EV>0 / monthly_run_rate_krw>=${weeklyGovernance && weeklyGovernance.objectiveConfig ? weeklyGovernance.objectiveConfig.min_monthly_net_krw : 1500000}`,
      `- governance current=${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"} / monthly_run_rate_krw=${weeklyGovernance && weeklyGovernance.currentObjective && weeklyGovernance.currentObjective.monthly_run_rate_krw != null ? weeklyGovernance.currentObjective.monthly_run_rate_krw : "N/A"}`,
      `- governance previous=${weeklyGovernance && weeklyGovernance.previousObjective ? weeklyGovernance.previousObjective.verdict : "N/A"} / monthly_run_rate_krw=${weeklyGovernance && weeklyGovernance.previousObjective && weeklyGovernance.previousObjective.monthly_run_rate_krw != null ? weeklyGovernance.previousObjective.monthly_run_rate_krw : "N/A"}`,
      `- retrospective daily=${objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.objective ? objectiveRetrospective.daily.objective.verdict : "N/A"} / weekly=${objectiveRetrospective && objectiveRetrospective.weekly && objectiveRetrospective.weekly.objective ? objectiveRetrospective.weekly.objective.verdict : "N/A"} / monthly=${objectiveRetrospective && objectiveRetrospective.monthly && objectiveRetrospective.monthly.objective ? objectiveRetrospective.monthly.objective.verdict : "N/A"}`,
      `- worst=${formatSignedPct(currentOverall.worst)}, p10=${formatSignedPct(currentOverall.p10)}, mdd=${formatSignedPct(currentOverall.mdd)}`,
      `- auto_repair: attempted=${currentQa.auto_repair.attempted ? "yes" : "no"}, missing ${currentQa.auto_repair.before_missing} -> ${currentQa.auto_repair.after_missing}, recovered=${currentQa.auto_repair.recovered_missing}, repaired_markets=${currentQa.auto_repair.repaired_markets_n}, errors=${currentQa.auto_repair.error_count}`,
      ...(currentQa.artifact_errors.length ? currentQa.artifact_errors.map((line) => `- artifact_error: ${line}`) : []),
    ]),
    markdownSection("(I-a) 직전 주 대비 변화", [
      `- win_rate delta=${formatSignedPct(deltas.win_rate_delta)}`,
      `- EV delta=${formatSignedPct(deltas.ev_delta)}`,
      `- net_proxy delta=${formatSignedNumber(deltas.net_delta, 4)}`,
      `- 직전 변경 평가는 ${previousChangeAssessment}`,
    ]),
    markdownSection("(I-b) 누적 추세 판단", [
      `- 최근 다주 추세: ${multiWeekTrend}`,
    ]),
    markdownSection("(I-c) 월간 누적 판단", [
      `- 월간 누적 추세: ${monthTrend}`,
      `- Octopus: ${octopusResult.ok ? String(octopusResult.summary && octopusResult.summary.overall_verdict || "HOLD") : (octopusResult.timeout ? `TIMEOUT(${WEEKLY_OCTOPUS_TIMEOUT_MS}ms)` : `FAILED(${octopusResult.exit_code ?? "N/A"})`)}`,
    ]),
    markdownSection("(II) 신호별 문제 TOP 5", topProblems.length ? topProblems : ["- 데이터 부족"]),
    markdownSection("(III) 패치 후보 3개", candidateLines.length ? candidateLines : ["- 안전한 공통 후보 없음"]),
    markdownSection("(IV) 이번 주 추천 패치 1개 + 롤백 기준 + 검증 체크리스트", [
      `- 추천: ${chosenCandidate ? chosenCandidate.patch_id : "hold"}`,
      `- 이유: ${rollbackPrepared ? "change control rollback ready로 이전 안전 파일 준비" : (chosenCandidate ? (promotionCandidateId ? "change control auto-promotion 승인 후보" : "long/short 공통 변경 + Octopus 승인 통과") : "QA 또는 전주 대비 악화 또는 Octopus 보류로 신규 패치 보류")}`,
      `- 공통성: ${chosenCandidate ? "모든 변경 키가 long/short 대칭 또는 공통 입력" : "신규 코드 생성 없음"}`,
      `- Octopus 추천: ${octopusResult.summary ? `${octopusResult.summary.recommended_patch_id || "hold"} / ${octopusResult.summary.overall_verdict}` : "unavailable"}`,
      `- Change control: ${changeControl && changeControl.verdict ? changeControl.verdict : "N/A"} / promotion ${changeControl && changeControl.auto_promotion && changeControl.auto_promotion.reason ? changeControl.auto_promotion.reason : "N/A"} / rollback ${changeControl && changeControl.auto_rollback && changeControl.auto_rollback.reason ? changeControl.auto_rollback.reason : "N/A"}`,
      `- Codex patch review: ${codexPatchReview ? `${codexPatchReview.verdict}${codexPatchReview.fresh ? "" : " (stale)"}` : "N/A"} / ${codexPatchReview ? codexPatchReview.reason : "N/A"}`,
      ...(chosenCandidate && Array.isArray(chosenCandidate.rollback) ? chosenCandidate.rollback.map((x) => `- 롤백 기준: ${x}`) : ["- 롤백 기준: OOS EV 하락, win_rate 3%p 이상 하락, worst/p10 악화 시 즉시 보류"]),
    ]),
    markdownSection("(IV-a) 생성 파일 준비 상태", createdFile ? [
      `- 새 버전 파일: ${createdFile.nextFilePath}`,
      `- latest alias: ${latestGeneratedFilePath || "N/A"}`,
      `- 자동 열기: ${openResult && openResult.ok ? `OK / ${openResult.method}` : `FAIL / ${openResult && openResult.error ? openResult.error : "UNKNOWN"}`}`,
    ] : rollbackPrepared ? [
      `- 롤백 파일: ${rollbackSourceFilePath}`,
      `- latest alias: ${latestGeneratedFilePath || "N/A"}`,
      `- 자동 열기: ${openResult && openResult.ok ? `OK / ${openResult.method}` : `FAIL / ${openResult && openResult.error ? openResult.error : "UNKNOWN"}`}`,
    ] : [
      "- 신규 파일 생성 없음",
    ]),
    markdownSection("(V) 추가 데이터 요청 5개 이내", [
      "- false_negative / NEG_SAMPLE 팩",
      "- zz/ev/ichi/vol 관련 non-null feature export",
      "- 4개 이상 OOS window가 있는 장기 팩",
      "- 실제 runtime input snapshot과 pine input 대응표",
      "- 최근 4주 개선팩 보관본",
    ]),
  ].join("\n");
  writeText(reportPath, report);

  const weeklyAlertResult = await sendKoreanTelegramSummary({
    title: `[주간 파인 수정 검토] ${currentQa.pass ? "분석 완료" : "보류"}`,
    severity: currentQa.pass ? "INFO" : "WARN",
    sections: [
      { header: "이번 주 결론", lines: [currentQa.pass ? (chosenCandidate ? `${chosenCandidate.patch_id} 권고` : "보류") : "QA FAIL로 보류"] },
      { header: "변경 안전 장치", lines: [`${changeControl && changeControl.verdict ? changeControl.verdict : "N/A"} / 승격 ${changeControl && changeControl.auto_promotion && changeControl.auto_promotion.reason ? changeControl.auto_promotion.reason : "N/A"} / 롤백 ${changeControl && changeControl.auto_rollback && changeControl.auto_rollback.reason ? changeControl.auto_rollback.reason : "N/A"}`] },
      { header: "Codex 검토", lines: [codexPatchReview ? `${codexPatchReview.verdict}${codexPatchReview.fresh ? "" : " (최신 아님)"} / ${codexPatchReview.reason}` : "정보 없음"] },
      { header: "데이터 출처", lines: [`${baseUrlInfo.source} / ${baseUrl}`] },
      { header: "지난주 대비 변화", lines: [`승률 ${formatSignedPct(deltas.win_rate_delta)}, EV ${formatSignedPct(deltas.ev_delta)}, 순손익 ${formatSignedNumber(deltas.net_delta, 4)}`] },
      { header: "공통 목표", lines: [
        `현재 ${weeklyGovernance && weeklyGovernance.currentObjective ? weeklyGovernance.currentObjective.verdict : "N/A"} / 월간페이스 ${weeklyGovernance && weeklyGovernance.currentObjective && weeklyGovernance.currentObjective.monthly_run_rate_krw != null ? weeklyGovernance.currentObjective.monthly_run_rate_krw : "N/A"} KRW`,
        `목표 월간 순수익 ${weeklyGovernance && weeklyGovernance.objectiveConfig ? weeklyGovernance.objectiveConfig.min_monthly_net_krw : 1500000} KRW`,
        `회고 daily=${objectiveRetrospective && objectiveRetrospective.daily && objectiveRetrospective.daily.objective ? objectiveRetrospective.daily.objective.verdict : "N/A"} / weekly=${objectiveRetrospective && objectiveRetrospective.weekly && objectiveRetrospective.weekly.objective ? objectiveRetrospective.weekly.objective.verdict : "N/A"} / monthly=${objectiveRetrospective && objectiveRetrospective.monthly && objectiveRetrospective.monthly.objective ? objectiveRetrospective.monthly.objective.verdict : "N/A"}`,
      ] },
      { header: "자동 복구 결과", lines: [`누락 ${currentQa.auto_repair.before_missing} -> ${currentQa.auto_repair.after_missing}, 복구 ${currentQa.auto_repair.recovered_missing}, 손본 시장 ${currentQa.auto_repair.repaired_markets_n}개, 오류 ${currentQa.auto_repair.error_count}건`] },
      { header: "최근 누적 추세", lines: [`다주=${multiWeekTrend}, 월간=${monthTrend}`] },
      { header: "핵심 개선 또는 악화 포인트", lines: topProblems.slice(0, 5).map((line) => line.replace(/^- /, "")) },
      { header: "이번 주 권고", lines: [chosenCandidate ? `${chosenCandidate.patch_id} / long-short 공통 변경만 사용` : "hold 또는 rollback candidate"] },
      { header: "롤백 주의점", lines: [chosenCandidate && chosenCandidate.rollback && chosenCandidate.rollback[0] ? chosenCandidate.rollback[0] : "실전 성과가 나빠지면 이번 변경은 보류 또는 롤백합니다."] },
      ...(createdFile ? [{ header: "준비된 Pine 파일", lines: [createdFile.nextFilePath, latestGeneratedFilePath || "N/A", openResult && openResult.ok ? `자동 열기 완료 / ${openResult.method}` : "자동 열기 실패"] }] : []),
      ...(rollbackPrepared ? [{ header: "준비된 롤백 파일", lines: [rollbackSourceFilePath || "N/A", latestGeneratedFilePath || "N/A", openResult && openResult.ok ? `자동 열기 완료 / ${openResult.method}` : "자동 열기 실패"] }] : []),
    ],
  });
  if (!weeklyAlertResult || (weeklyAlertResult.ok !== true && !(weeklyAlertResult.skipped && weeklyAlertResult.reason === "SKIP_ALERT"))) {
    throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(weeklyAlertResult || {})}`);
  }

  if (createdFile) {
    const createdAlertResult = await sendKoreanTelegramSummary({
      title: "[주간 파인 파일 준비 완료] 새 버전 생성",
      severity: "INFO",
      sections: [
        { header: "준비 완료", lines: [`트레이딩뷰에 붙여넣을 새 버전은 v${createdFile.nextVersion} 입니다.`] },
        { header: "파일 경로", lines: [createdFile.nextFilePath] },
        { header: "항상 최신 파일", lines: [latestGeneratedFilePath || "정보 없음"] },
        { header: "파일 열기 상태", lines: [openResult && openResult.ok ? `정상 / ${openResult.method}` : `실패 / ${openResult && openResult.error ? openResult.error : "원인 불명"}`] },
        { header: "이번 권고 ID", lines: [chosenCandidate.patch_id] },
      ],
    });
    if (!createdAlertResult || (createdAlertResult.ok !== true && !(createdAlertResult.skipped && createdAlertResult.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(createdAlertResult || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    qa_pass: currentQa.pass,
    pack_source: {
      source: baseUrlInfo.source,
      url: baseUrl,
    },
    recommendation,
    multiWeekTrend,
    monthTrend,
    createdFile,
    rollbackPrepared,
    rollbackSourceFilePath,
    latestGeneratedFilePath,
    openResult,
    reportPath,
    alert: weeklyAlertResult,
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("automation-weekly-pine-upgrade failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      readZipJsonWithStatus,
      qaGateStatus,
      buildSelfEvolutionRecoveryWeeklyCandidate,
      applyInputChange,
    },
  };
}
