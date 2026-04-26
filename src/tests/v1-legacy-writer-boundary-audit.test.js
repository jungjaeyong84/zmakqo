"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const paperRunnerFile = path.join(root, "src", "engine", "paperBinanceRunner.js");
const legacyWriterFile = path.join(root, "src", "engine", "legacy", "v1ExchangeWriters.js");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function assertLegacyBoundaryExists() {
  const text = read(legacyWriterFile);
  assert.ok(text.includes("LEGACY_V1_DEAD_CODE boundary"), "legacy writer boundary marker is missing");
  for (const name of [
    "placeFuturesMarketOrder",
    "placeFuturesStopMarketOrder",
    "placeFuturesTakeProfitMarketOrder",
    "cancelFuturesOpenOrders",
    "placeFuturesEntryMakerFirst",
  ]) {
    assert.ok(text.includes(name), `legacy writer boundary must export ${name}`);
  }
}

function assertPaperRunnerUsesBoundary() {
  const text = read(paperRunnerFile);
  assert.ok(
    text.includes('require("./legacy/v1ExchangeWriters")'),
    "paperBinanceRunner must import V1 exchange writers from the legacy boundary"
  );

  const privateImport = text.match(/require\("\.\.\/exchanges\/binanceFuturesPrivate"\);/);
  assert.ok(privateImport, "paperBinanceRunner binanceFuturesPrivate import block is missing");
  const blockStart = text.lastIndexOf("const {", privateImport.index);
  const block = text.slice(blockStart, privateImport.index);
  for (const forbidden of [
    "placeFuturesMarketOrder",
    "placeFuturesStopMarketOrder",
    "placeFuturesTakeProfitMarketOrder",
    "cancelFuturesOpenOrders",
  ]) {
    assert.ok(
      !block.includes(forbidden),
      `paperBinanceRunner must not import ${forbidden} directly from binanceFuturesPrivate`
    );
  }

  const makerImport = text.match(/require\("\.\.\/services\/binanceMakerFirstEntry"\);/);
  assert.ok(makerImport, "paperBinanceRunner binanceMakerFirstEntry import block is missing");
  const makerBlockStart = text.lastIndexOf("const {", makerImport.index);
  const makerBlock = text.slice(makerBlockStart, makerImport.index);
  assert.ok(
    !makerBlock.includes("placeFuturesEntryMakerFirst"),
    "paperBinanceRunner must not import placeFuturesEntryMakerFirst directly from binanceMakerFirstEntry"
  );
}

function assertBoundaryLoads() {
  const writers = require("../engine/legacy/v1ExchangeWriters");
  for (const name of [
    "placeFuturesMarketOrder",
    "placeFuturesStopMarketOrder",
    "placeFuturesTakeProfitMarketOrder",
    "cancelFuturesOpenOrders",
    "placeFuturesEntryMakerFirst",
  ]) {
    assert.strictEqual(typeof writers[name], "function", `${name} must be a function`);
  }
}

function main() {
  assertLegacyBoundaryExists();
  assertPaperRunnerUsesBoundary();
  assertBoundaryLoads();
}

main();
console.log("V1_LEGACY_WRITER_BOUNDARY_AUDIT_TEST_OK");
