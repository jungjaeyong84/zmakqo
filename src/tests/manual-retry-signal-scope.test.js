"use strict";

// 2026-04-28 senior audit — orphan test rewired into CI. The previous
// version asserted lexical proximity within the first 400 chars of the
// signal loop; that heuristic broke once intermediate plumbing grew.
// The TDZ contract being verified here is: `manualRetryIntent` must be
// declared with `const` *before* any reference inside the
// `for (const s of signals)` body. We now check declaration-index ===
// first-usage-index, which is the actual safety property.

const assert = require("assert");
const fs = require("fs");

function findForBlocks(src, anchor) {
  const blocks = [];
  let cursor = 0;
  while (cursor < src.length) {
    const start = src.indexOf(anchor, cursor);
    if (start < 0) break;
    const braceStart = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) throw new Error(`${anchor}: no matching close brace`);
    blocks.push(src.slice(start, end + 1));
    cursor = end + 1;
  }
  return blocks;
}

function run() {
  const src = fs.readFileSync(require.resolve("../engine/paperBinanceRunner"), "utf8");
  const blocks = findForBlocks(src, "for (const s of signals) {");
  assert.ok(blocks.length >= 1, "signal loop must exist");

  // The V1 paperBinanceRunner signal loop (first occurrence) is the
  // manual-retry execution path; it must declare manualRetryIntent
  // before any usage. The V2 discovery loop (second occurrence) routes
  // to productionEntryRoute and does not consume manualRetryIntent —
  // skip it intentionally.
  const v1Body = blocks[0];
  const declIdx = v1Body.indexOf("const manualRetryIntent = intentIsEntry && isManualRetryFeatures(s.features");
  assert.ok(declIdx >= 0, "V1 signal loop must declare manualRetryIntent before use");
  const firstUse = v1Body.indexOf("manualRetryIntent");
  assert.strictEqual(firstUse, declIdx + "const ".length, "manualRetryIntent referenced before declaration (TDZ risk)");

  // V2 loop must NOT reference manualRetryIntent at all (it routes to
  // productionEntryRoute which has its own retry plumbing).
  if (blocks.length >= 2) {
    const v2Body = blocks[1];
    assert.strictEqual(
      v2Body.indexOf("manualRetryIntent"),
      -1,
      "V2 signal loop should not reference V1 manualRetryIntent (route boundary leak)"
    );
  }
}

try {
  run();
  console.log("MANUAL_RETRY_SIGNAL_SCOPE_TEST_OK");
} catch (err) {
  console.error("MANUAL_RETRY_SIGNAL_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
