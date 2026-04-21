"use strict";

const path = require("path");

function normalizePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function hasForbiddenPattern(content, pattern) {
  return pattern.test(String(content || ""));
}

const DEFAULT_RULES = Object.freeze([
  Object.freeze({
    code: "V2_ENTRY_RAW_MARKET_ORDER_WRITER_FORBIDDEN",
    description: "Only binanceEntryOrderTransport may bind Binance MARKET entry writes in V2.",
    pattern: /\bplaceFuturesMarketOrder\b/,
    allowedFiles: Object.freeze([
      "src/v2/binanceEntryOrderTransport.js",
    ]),
  }),
  Object.freeze({
    code: "V2_ENTRY_PROTECTION_RUNNER_DIRECT_CALL_FORBIDDEN",
    description: "Only entrySubmitter may call runV2EntryProtectionActivation outside its implementation file.",
    pattern: /\brunV2EntryProtectionActivation\b/,
    allowedFiles: Object.freeze([
      "src/v2/entryProtectionRunner.js",
      "src/v2/entrySubmitter.js",
      "src/v2/entryBoundaryAudit.js",
    ]),
  }),
]);

function relativeToRoot(filePath, rootDir = process.cwd()) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  return normalizePath(path.relative(resolvedRoot, resolvedFile));
}

function auditV2EntryBoundaries({ files = [], rootDir = process.cwd(), rules = DEFAULT_RULES } = {}) {
  const violations = [];
  for (const file of Array.isArray(files) ? files : []) {
    const filePath = trimOrNull(file && file.path);
    if (!filePath) continue;
    const rel = normalizePath(file.relativePath || relativeToRoot(filePath, rootDir));
    const content = String(file.content || "");
    for (const rule of rules) {
      if (!hasForbiddenPattern(content, rule.pattern)) continue;
      const allowed = Array.isArray(rule.allowedFiles) ? rule.allowedFiles.map(normalizePath) : [];
      if (allowed.includes(rel)) continue;
      violations.push(Object.freeze({
        code: rule.code,
        file: rel,
        description: rule.description,
        allowed_files: Object.freeze(allowed),
      }));
    }
  }
  return Object.freeze({
    ok: violations.length === 0,
    checked_file_n: Array.isArray(files) ? files.length : 0,
    violation_n: violations.length,
    violations: Object.freeze(violations),
  });
}

module.exports = {
  DEFAULT_RULES,
  auditV2EntryBoundaries,
  __test: {
    normalizePath,
    trimOrNull,
    hasForbiddenPattern,
    relativeToRoot,
  },
};
