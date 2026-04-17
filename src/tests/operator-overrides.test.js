"use strict";

// Regression test for the Phase 3d operator override mechanism.
// The override must only take effect when the file exists, parses cleanly,
// and carries a future `expires_at_iso`. Missing / expired / malformed
// entries must fall back to default behaviour.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const overrides = require("../utils/operatorOverrides");

function tempPath(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "operator-override-"));
  return path.join(dir, name);
}

function writeOverride(p, payload) {
  fs.writeFileSync(p, JSON.stringify(payload), "utf8");
}

// ---------- Missing file ---------------------------------------------------
(() => {
  overrides.__test.resetForTest();
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: "/tmp/does-not-exist.json" });
  assert.strictEqual(ctx.active, false);
  assert.strictEqual(ctx.expired || false, false);
})();

// ---------- Expired override ----------------------------------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("expired.json");
  writeOverride(p, {
    expires_at_iso: new Date(Date.now() - 60_000).toISOString(),
    quarantine_hard_block_relaxed: true,
    market_qty_scales: { AXSUSDT: 1.2 },
    operator: "nobody",
    reason: "test",
  });
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, false);
  assert.strictEqual(ctx.expired, true);
  assert.strictEqual(ctx.reason, "EXPIRED");
  assert.strictEqual(overrides.shouldRelaxQuarantineHardBlock(ctx), false);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "AXSUSDT"), null);
})();

// ---------- Override without expires_at_iso (rejected) --------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("no_expiry.json");
  writeOverride(p, {
    quarantine_hard_block_relaxed: true,
  });
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, false, "override with no expiry must never activate");
  assert.strictEqual(ctx.expired, true);
  assert.strictEqual(ctx.reason, "NO_EXPIRY");
})();

// ---------- Parse error ---------------------------------------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("corrupt.json");
  fs.writeFileSync(p, "{not json");
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, false);
  assert.strictEqual(ctx.parseError, true);
})();

// ---------- Happy path — quarantine relax ----------------------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("active.json");
  const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  writeOverride(p, {
    expires_at_iso: expires,
    quarantine_hard_block_relaxed: true,
    operator: "jihye",
    reason: "sample_acquisition_for_recovery",
  });
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, true);
  assert.strictEqual(ctx.expired, false);
  assert.strictEqual(ctx.quarantine_hard_block_relaxed, true);
  assert.strictEqual(ctx.reason, "sample_acquisition_for_recovery");
  assert.strictEqual(ctx.operator, "jihye");
  assert.strictEqual(overrides.shouldRelaxQuarantineHardBlock(ctx), true);
  // Second call still returns true, but the one-shot log has been emitted.
  assert.strictEqual(overrides.shouldRelaxQuarantineHardBlock(ctx), true);
})();

// ---------- Happy path — market scale override ----------------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("scale.json");
  writeOverride(p, {
    expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    market_qty_scales: { AXSUSDT: 1.25, btcusdt: 0.5 },
    operator: "jihye",
    reason: "axs_rescue",
  });
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, true);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "AXSUSDT"), 1.25);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "btcusdt"), 0.5);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "ETHUSDT"), null,
    "markets outside the override map must not receive any scale");
  // Invalid / missing market → null, not crash.
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, null), null);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, ""), null);
})();

// ---------- Safety clamp — scale > 2 is dropped ---------------------------
(() => {
  overrides.__test.resetForTest();
  const p = tempPath("danger.json");
  writeOverride(p, {
    expires_at_iso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    market_qty_scales: { AXSUSDT: 5, BTCUSDT: 1.5 },
  });
  const ctx = overrides.resolveOperatorOverrideContext({ filePath: p });
  assert.strictEqual(ctx.active, true);
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "AXSUSDT"), null,
    "scale > 2 must be dropped by the safety clamp");
  assert.strictEqual(overrides.resolveMarketQtyScaleOverride(ctx, "BTCUSDT"), 1.5);
})();

console.log("OPERATOR_OVERRIDES_TEST_OK");
