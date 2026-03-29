"use strict";

function toPositiveInt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Math.floor(n);
}

function parseErrorCount(reportText) {
  const text = String(reportText || "");
  if (!text.trim()) return null;

  const patterns = [
    /-\s*Error count\s*:\s*([0-9]+)/i,
    /Errors?\s*\(24h\)\s*:\s*([0-9]+)/i,
    /핵심\s*오류\s*[: ]\s*([0-9]+)\s*건/i,
    /오류(?:\s*건수|\s*수)?\s*:\s*([0-9]+)/i,
    /"error_count"\s*:\s*([0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = toPositiveInt(match[1]);
    if (parsed !== null) return parsed;
  }

  if (/no\s+recent\s+errors?/i.test(text)) return 0;
  if (/오류\s*없음/i.test(text)) return 0;

  return null;
}

module.exports = {
  parseErrorCount,
};
