"use strict";

// Regression guard for the 2026-04-20 ETHUSDT "signal dropped / server signal
// 미생성 주원인: Cannot access 'nextMeta' before initialization" incident.
//
// Root cause: inside the live-execution branch of paperBinanceRunner.js, the
// call site that builds `nativeProtectionMetaPatch` was passing `posMeta:
// nextMeta` — but `nextMeta` is a `let` declared hundreds of lines BELOW in
// the same enclosing block (the live-fill application section). Because `let`
// hoists a TDZ binding for the whole block, that reference threw
// "Cannot access 'nextMeta' before initialization" at runtime, the signal
// generation aborted, and webhooks got dropped with no fills.
//
// The correct value at that call site is the OUTER `posMeta` function
// parameter, which is always in scope. This test asserts:
//   (a) That specific anti-pattern (`posMeta: nextMeta,` appearing BEFORE the
//       first `let nextMeta = mergeMeta(posMeta,` declaration in the live
//       branch) does not re-enter the file.
//   (b) `buildNativeProtectionMetaPatch` is still being called — we're not
//       accidentally deleting the call itself.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "engine", "paperBinanceRunner.js");
const source = fs.readFileSync(SRC, "utf8");
const lines = source.split("\n");

// (a) For every `posMeta: nextMeta` reference, walk backwards line-by-line.
//     The nearest preceding boundary wins:
//       - if we hit a `let/var/const nextMeta = …` first → declaration is in
//         scope, the reference is safe;
//       - if we hit a top-level `function …` / `async function …` first →
//         we've crossed the enclosing function start without seeing a
//         declaration, so the reference is TDZ-reachable within that
//         function and must be fixed.
//     This is a coarse approximation of JS scope, but it catches the real
//     incident pattern: a `let nextMeta = …` declared WAY below a reference
//     in the same function.
// Strip `// …` line comments before searching so the test doesn't flag its
// own documentation of the anti-pattern inside code comments.
function stripLineComment(line) {
  // Naïve: cut at the first `//` that isn't inside a string literal. Good
  // enough for this file — we don't have regex literals containing `//`.
  const idx = line.indexOf("//");
  return idx >= 0 ? line.slice(0, idx) : line;
}

const usageLineIdxs = [];
for (let i = 0; i < lines.length; i += 1) {
  if (/\bposMeta\s*:\s*nextMeta\b/.test(stripLineComment(lines[i]))) {
    usageLineIdxs.push(i);
  }
}

const DECL_RE = /\b(?:let|var|const)\s+nextMeta\s*=/;
const FN_START_RE = /^(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/;

const offendingLines = [];
for (const useIdx of usageLineIdxs) {
  let verdict = null; // "SAFE" | "TDZ"
  for (let j = useIdx - 1; j >= 0; j -= 1) {
    if (DECL_RE.test(lines[j])) { verdict = "SAFE"; break; }
    if (FN_START_RE.test(lines[j])) { verdict = "TDZ"; break; }
  }
  if (verdict === "TDZ") offendingLines.push(useIdx + 1);
}

assert.deepStrictEqual(
  offendingLines,
  [],
  `TDZ REGRESSION: \`posMeta: nextMeta\` at line(s) ${offendingLines.join(", ")} — ` +
  `no enclosing \`let/var/const nextMeta = …\` declaration precedes the reference ` +
  `within the same function, so it will throw "Cannot access 'nextMeta' before ` +
  `initialization" at runtime and drop the signal. Pass the outer \`posMeta\` ` +
  `parameter instead (shorthand \`posMeta,\`).`
);

// (b) Confirm the native-protection patch builder is still being invoked from
// the live branch — otherwise we've accidentally deleted the call while
// fixing the TDZ.
const callSiteRegex = /nativeProtectionMetaPatch\s*=\s*buildNativeProtectionMetaPatch\s*\(/;
assert.ok(
  callSiteRegex.test(source),
  "expected `nativeProtectionMetaPatch = buildNativeProtectionMetaPatch(` to still exist; " +
  "the live branch must continue to capture the native-protection state from liveResult"
);

console.log("PAPER_BINANCE_RUNNER_NEXTMETA_TDZ_TEST_OK");
