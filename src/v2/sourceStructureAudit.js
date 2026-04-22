"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function maskNonCode(source) {
  const text = String(source || "");
  let out = "";
  let mode = "code";
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (mode === "line_comment") {
      if (ch === "\n") {
        mode = "code";
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }
    if (mode === "block_comment") {
      if (ch === "*" && next === "/") {
        out += "  ";
        i += 1;
        mode = "code";
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (mode === "string") {
      if (ch === "\\") {
        out += " ";
        if (i + 1 < text.length) {
          out += text[i + 1] === "\n" ? "\n" : " ";
          i += 1;
        }
        continue;
      }
      if (ch === quote) {
        out += " ";
        mode = "code";
        quote = null;
      } else {
        out += ch === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      out += "  ";
      i += 1;
      mode = "line_comment";
      continue;
    }
    if (ch === "/" && next === "*") {
      out += "  ";
      i += 1;
      mode = "block_comment";
      continue;
    }
    if (ch === "\"" || ch === "'" || ch === "`") {
      out += " ";
      mode = "string";
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function findMatchingBrace(masked, openIndex) {
  if (masked[openIndex] !== "{") return -1;
  let depth = 0;
  for (let i = openIndex; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function findFunctionBodyOpen(masked, startIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  for (let i = startIndex; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    else if (ch === "[") bracketDepth += 1;
    else if (ch === "]" && bracketDepth > 0) bracketDepth -= 1;
    else if (ch === "{" && parenDepth === 0 && bracketDepth === 0) return i;
  }
  return -1;
}

function findFunctionRange(source, functionName) {
  const text = String(source || "");
  const name = trimOrNull(functionName);
  if (!name) return null;
  const masked = maskNonCode(text);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:async\\s+)?function\\s+${escaped}\\s*\\(`, "m"),
    new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?(?:function\\s*)?\\(`, "m"),
    new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:async\\s*)?[A-Za-z0-9_$]+\\s*=>`, "m"),
  ];
  let match = null;
  for (const pattern of patterns) {
    match = pattern.exec(masked);
    if (match) break;
  }
  if (!match) return null;
  const open = findFunctionBodyOpen(masked, match.index);
  if (open < 0) return null;
  const close = findMatchingBrace(masked, open);
  if (close < 0) return null;
  return Object.freeze({ start: match.index, open, end: close + 1 });
}

function sliceFunctionBlock(source, functionName) {
  const text = String(source || "");
  const range = findFunctionRange(text, functionName);
  return range ? text.slice(range.start, range.end) : "";
}

function hasCallExpression(source, callee) {
  const name = trimOrNull(callee);
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\s*\\(`).test(maskNonCode(source));
}

function countCallExpressions(source, callee) {
  const name = trimOrNull(callee);
  if (!name) return 0;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(maskNonCode(source).matchAll(new RegExp(`\\b${escaped}\\s*\\(`, "g"))).length;
}

function functionCalls(source, functionName, callees = []) {
  const block = sliceFunctionBlock(source, functionName);
  return Object.freeze(Object.fromEntries((Array.isArray(callees) ? callees : []).map((callee) => [callee, hasCallExpression(block, callee)])));
}

function functionCallsAll(source, functionName, callees = []) {
  const evidence = functionCalls(source, functionName, callees);
  return Object.values(evidence).every((ok) => ok === true);
}

function hasCodePattern(source, pattern) {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(String(pattern || ""));
  return regex.test(maskNonCode(source));
}

module.exports = {
  trimOrNull,
  maskNonCode,
  findFunctionRange,
  sliceFunctionBlock,
  hasCallExpression,
  countCallExpressions,
  functionCalls,
  functionCallsAll,
  hasCodePattern,
  __test: {
    findMatchingBrace,
    findFunctionBodyOpen,
  },
};
