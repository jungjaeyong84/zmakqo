"use strict";

const fs = require("fs");
const path = require("path");

function strategyIdToEngineVersion(strategyId) {
  const match = String(strategyId || "").match(/_v(\d+\.\d+\.\d+\.\d+)$/i);
  return match ? match[1] : null;
}

function prependCsvValue(raw, value) {
  const target = String(value || "").trim();
  const rows = String(raw || "")
    .split(",")
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  if (!target) return rows.join(",");
  return Array.from(new Set([target, ...rows])).join(",");
}

function replaceOrAppendEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  const suffix = text.endsWith("\n") ? "" : "\n";
  return `${text}${suffix}${line}\n`;
}

function syncEnvText(text, { strategyId, engineVersion }) {
  let next = String(text || "");
  next = replaceOrAppendEnvLine(next, "DONBEOLJA_STRATEGY_ID", strategyId);
  next = replaceOrAppendEnvLine(next, "ENGINE_VERSION", engineVersion);
  const allowedMatch = next.match(/^WEBHOOK_ALLOWED_STRATEGY_IDS=(.*)$/m);
  const nextAllowed = prependCsvValue(allowedMatch ? allowedMatch[1] : "", strategyId);
  next = replaceOrAppendEnvLine(next, "WEBHOOK_ALLOWED_STRATEGY_IDS", nextAllowed);
  return next;
}

function syncJsText(text, { strategyId, engineVersion }) {
  let next = String(text || "");
  next = next.replace(/ENGINE_VERSION:\s*"[^"]*"/g, `ENGINE_VERSION: "${engineVersion}"`);
  next = next.replace(/DONBEOLJA_STRATEGY_ID:\s*"[^"]*"/g, `DONBEOLJA_STRATEGY_ID: "${strategyId}"`);
  next = next.replace(/WEBHOOK_ALLOWED_STRATEGY_IDS:\s*"([^"]*)"/g, (_m, csv) => {
    return `WEBHOOK_ALLOWED_STRATEGY_IDS: "${prependCsvValue(csv, strategyId)}"`;
  });
  return next;
}

function syncCloudBuildText(text, { strategyId, engineVersion }) {
  let next = String(text || "");
  next = next.replace(/DONBEOLJA_STRATEGY_ID=[^;"]+/g, `DONBEOLJA_STRATEGY_ID=${strategyId}`);
  next = next.replace(/ENGINE_VERSION=[^;"]+/g, `ENGINE_VERSION=${engineVersion}`);
  next = next.replace(/WEBHOOK_ALLOWED_STRATEGY_IDS=([^;"]+)/g, (_m, csv) => {
    return `WEBHOOK_ALLOWED_STRATEGY_IDS=${prependCsvValue(csv, strategyId)}`;
  });
  return next;
}

function syncTextByPath(filePath, text, { strategyId, engineVersion }) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  if (normalized.endsWith("/cloudbuild.yaml")) {
    return syncCloudBuildText(text, { strategyId, engineVersion });
  }
  if (normalized.endsWith("/ecosystem.config.js")) {
    return syncJsText(text, { strategyId, engineVersion });
  }
  return syncEnvText(text, { strategyId, engineVersion });
}

function syncStrategyRuntimeFiles({ rootDir = process.cwd(), strategyId } = {}) {
  const engineVersion = strategyIdToEngineVersion(strategyId);
  if (!strategyId || !engineVersion) {
    throw new Error("INVALID_STRATEGY_ID_FOR_SYNC");
  }
  const targets = [
    path.join(rootDir, ".env"),
    path.join(rootDir, "ops", ".env.runtime.local"),
    path.join(rootDir, "ecosystem.config.js"),
    path.join(rootDir, "cloudbuild.yaml"),
  ];
  const changed = [];
  for (const filePath of targets) {
    if (!fs.existsSync(filePath)) continue;
    const before = fs.readFileSync(filePath, "utf8");
    const after = syncTextByPath(filePath, before, { strategyId, engineVersion });
    if (after !== before) {
      fs.writeFileSync(filePath, after, "utf8");
      changed.push(filePath);
    }
  }
  return {
    strategyId,
    engineVersion,
    changed,
  };
}

module.exports = {
  strategyIdToEngineVersion,
  prependCsvValue,
  syncEnvText,
  syncJsText,
  syncCloudBuildText,
  syncStrategyRuntimeFiles,
};
