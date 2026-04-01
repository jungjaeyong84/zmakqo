"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function normalizeStrategyId(strategyId = "", engineVersion = "") {
  const rawId = String(strategyId || "").trim();
  if (rawId) return rawId;
  const rawVersion = String(engineVersion || "").trim();
  return rawVersion ? `donbeolja_v${rawVersion}` : "";
}

function buildCurrentVersionPineCandidates({ repoRoot, strategyId = "", engineVersion = "" } = {}) {
  const root = String(repoRoot || "").trim();
  const normalizedId = normalizeStrategyId(strategyId, engineVersion);
  const candidates = [];
  if (root && normalizedId) {
    candidates.push(path.join(root, "code", `${normalizedId}_TV_IMPORT_FINAL.pine.txt`));
    candidates.push(path.join(root, "code", `${normalizedId}_PRODUCTION_CANDIDATE.pine.txt`));
    candidates.push(path.join(root, "code", `${normalizedId}_SIGNAL_REDESIGN.pine.txt`));
    candidates.push(path.join(root, "code", `${normalizedId}.pine.txt`));
  }
  if (root) {
    candidates.push(path.join(root, "code", "donbeolja.pine.txt"));
  }
  return candidates;
}

function resolveCurrentVersionPineSource({ repoRoot, strategyId = "", engineVersion = "" } = {}) {
  const candidates = buildCurrentVersionPineCandidates({ repoRoot, strategyId, engineVersion });
  for (const filePath of candidates) {
    if (filePath && fs.existsSync(filePath)) {
      return {
        ok: true,
        strategy_id: normalizeStrategyId(strategyId, engineVersion) || null,
        source_file_path: filePath,
        tried_candidates: candidates,
      };
    }
  }
  return {
    ok: false,
    strategy_id: normalizeStrategyId(strategyId, engineVersion) || null,
    source_file_path: null,
    tried_candidates: candidates,
  };
}

function sha256File(filePath) {
  const target = String(filePath || "").trim();
  if (!target || !fs.existsSync(target)) return null;
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function syncCurrentVersionPineAlias({ sourceFilePath, latestFilePath } = {}) {
  const source = String(sourceFilePath || "").trim();
  const latest = String(latestFilePath || "").trim();
  if (!source || !fs.existsSync(source)) {
    return {
      ok: false,
      synced: false,
      latest_file_path: latest || null,
      source_sha256: null,
      latest_sha256: latest ? sha256File(latest) : null,
      reason: "SOURCE_FILE_MISSING",
    };
  }
  const sourceHash = sha256File(source);
  const latestHashBefore = latest ? sha256File(latest) : null;
  const needsSync = !latest || !fs.existsSync(latest) || sourceHash !== latestHashBefore;
  if (needsSync) {
    fs.copyFileSync(source, latest);
  }
  return {
    ok: true,
    synced: needsSync,
    latest_file_path: latest || null,
    source_sha256: sourceHash,
    latest_sha256: latest ? sha256File(latest) : null,
    reason: needsSync ? "SYNCED" : "UNCHANGED",
  };
}

module.exports = {
  normalizeStrategyId,
  buildCurrentVersionPineCandidates,
  resolveCurrentVersionPineSource,
  sha256File,
  syncCurrentVersionPineAlias,
};
