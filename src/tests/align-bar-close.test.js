"use strict";

const assert = require("assert");
const { alignBarCloseMs, resolveAlignMode, alignWithMode } = require("../utils/alignBarCloseMs");

function run() {
  const prevMode = process.env.BAR_ALIGN_MODE_BINANCEFUT;
  try {
    delete process.env.BAR_ALIGN_MODE_BINANCEFUT;
    assert.strictEqual(resolveAlignMode("BINANCEFUT"), "FLOOR");
    assert.strictEqual(alignWithMode(1001, 1000, "FLOOR"), 1000);
    assert.strictEqual(alignWithMode(1501, 1000, "ROUND"), 2000);
    assert.strictEqual(alignWithMode(1001, 1000, "CEIL"), 2000);

    process.env.BAR_ALIGN_MODE_BINANCEFUT = "ROUND";
    assert.strictEqual(resolveAlignMode("BINANCEFUT"), "ROUND");
    assert.strictEqual(alignBarCloseMs("BINANCEFUT", "1m", 90_001), 120_000);

    process.env.BAR_ALIGN_MODE_BINANCEFUT = "FLOOR";
    assert.strictEqual(alignBarCloseMs("BINANCEFUT", "1m", 90_001), 60_000);
    assert.strictEqual(alignBarCloseMs("KIWOOM", "1m", 90_001), 90_001);
    console.log("ALIGN_BAR_CLOSE_TEST_OK");
  } finally {
    if (prevMode == null) delete process.env.BAR_ALIGN_MODE_BINANCEFUT;
    else process.env.BAR_ALIGN_MODE_BINANCEFUT = prevMode;
  }
}

run();
