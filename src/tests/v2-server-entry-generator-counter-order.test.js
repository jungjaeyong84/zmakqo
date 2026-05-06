"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "engine", "paperBinanceRunner.js"),
  "utf8"
);

function assertCounterDeclaredBeforeGeneratorBlock(functionName) {
  const fnIdx = src.indexOf(`async function ${functionName}(`);
  assert.ok(fnIdx > 0, `${functionName} not found`);

  const nextFnIdx = src.indexOf("async function ", fnIdx + 1);
  const fnBody = nextFnIdx > fnIdx ? src.slice(fnIdx, nextFnIdx) : src.slice(fnIdx);
  const declIdx = fnBody.indexOf("let directHandoffGeneratedN = 0;");
  const genIdx = fnBody.indexOf("if (v2EntryGeneratorEnabled) {");

  assert.ok(declIdx > 0, `${functionName}: directHandoffGeneratedN declaration missing`);
  assert.ok(genIdx > 0, `${functionName}: v2EntryGeneratorEnabled block missing`);
  assert.ok(
    declIdx < genIdx,
    `${functionName}: direct handoff counters must be declared before the generator block to avoid TDZ ReferenceError`
  );
}

assertCounterDeclaredBeforeGeneratorBlock("runPaperBinanceForBar");
assertCounterDeclaredBeforeGeneratorBlock("runPaperFuturesForBar");

console.log("V2_SERVER_ENTRY_GENERATOR_COUNTER_ORDER_TEST_OK");
