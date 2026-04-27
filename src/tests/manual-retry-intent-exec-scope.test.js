"use strict";

// 2026-04-28 senior audit — orphan test rewired into CI. The previous
// version asserted lexical proximity within the first 1400 chars of the
// `executeIntentList` block; that heuristic broke once Stage J/X added
// scope plumbing between declaration and first use. The TDZ contract
// being verified here is: `manualRetryIntent` and `manualRetryQtyBase`
// must be declared with `const` *before* any reference inside the
// `executeIntentList` arrow body. We now check that explicitly via
// declaration-index < first-usage-index, which is the actual safety
// property (lexical proximity is irrelevant — only ordering matters).

const assert = require("assert");
const fs = require("fs");

function findArrowFunctionBody(src, anchor) {
  const start = src.indexOf(anchor);
  assert.ok(start >= 0, `${anchor} not found`);
  const braceStart = src.indexOf("{", start);
  let depth = 0;
  for (let i = braceStart; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${anchor}: no matching close brace`);
}

function run() {
  const src = fs.readFileSync(require.resolve("../engine/paperBinanceRunner"), "utf8");
  const body = findArrowFunctionBody(src, "const executeIntentList = async (intentsList) => {");

  const declIntentIdx = body.indexOf("const manualRetryIntent = intentIsEntry && isManualRetryFeatures(it.features_json);");
  assert.ok(declIntentIdx >= 0, "executeIntentList must declare manualRetryIntent (it.features_json)");

  const declQtyIdx = body.indexOf("const manualRetryQtyBase = manualRetryIntent ? resolveManualRetryQtyBase(it.features_json) : null;");
  assert.ok(declQtyIdx >= 0, "executeIntentList must declare manualRetryQtyBase before live execution");

  // Every textual usage of the variable name must come *after* the
  // declaration. The declaration string starts with `const ` (6 chars)
  // before the identifier, so the first identifier occurrence equals the
  // declaration's start + len("const ").
  const constLen = "const ".length;
  const firstIntentUse = body.indexOf("manualRetryIntent");
  assert.strictEqual(firstIntentUse, declIntentIdx + constLen, "manualRetryIntent referenced before declaration (TDZ risk)");

  const firstQtyUse = body.indexOf("manualRetryQtyBase");
  assert.strictEqual(firstQtyUse, declQtyIdx + constLen, "manualRetryQtyBase referenced before declaration (TDZ risk)");
}

try {
  run();
  console.log("MANUAL_RETRY_INTENT_EXEC_SCOPE_TEST_OK");
} catch (err) {
  console.error("MANUAL_RETRY_INTENT_EXEC_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
