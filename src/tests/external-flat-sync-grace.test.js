const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

assert.strictEqual(typeof __test.resolveRecentExternalFlatSyncGuard, "function", "resolveRecentExternalFlatSyncGuard export missing");
assert.strictEqual(typeof __test.shouldCleanupExternalFlatOrders, "function", "shouldCleanupExternalFlatOrders export missing");

const nowMs = Date.parse("2026-04-05T05:00:25.200Z");

{
  const out = __test.resolveRecentExternalFlatSyncGuard({
    active: false,
    prevActive: true,
    prevPos: { updated_at: "2026-04-05T05:00:17.706Z" },
    prevMeta: {
      intent: "ENTRY",
      native_protection_refresh_context: "ENTRY",
      native_protection_refresh_status: "OK",
      native_protection_refresh_at_ms: Date.parse("2026-04-05T05:00:17.598Z"),
      last_fill_intent: "INTENT__BINANCEFUT__SOLUSDT__15m__1775365200000__SHORT",
    },
    syncEventMs: nowMs,
    nowMs,
  });
  assert.strictEqual(out.defer, true);
  assert.strictEqual(out.reason, "RECENT_ENTRY_GRACE");
}

{
  const out = __test.resolveRecentExternalFlatSyncGuard({
    active: false,
    prevActive: true,
    prevPos: { updated_at: "2026-04-05T04:58:17.706Z" },
    prevMeta: {
      intent: "ENTRY",
      native_protection_refresh_context: "ENTRY",
      native_protection_refresh_status: "OK",
      native_protection_refresh_at_ms: Date.parse("2026-04-05T04:58:17.598Z"),
      last_fill_intent: "INTENT__BINANCEFUT__SOLUSDT__15m__1775365200000__SHORT",
    },
    syncEventMs: nowMs,
    nowMs,
  });
  assert.strictEqual(out.defer, false);
  assert.strictEqual(out.reason, "ENTRY_GRACE_EXPIRED");
}

{
  const out = __test.resolveRecentExternalFlatSyncGuard({
    active: false,
    prevActive: true,
    prevPos: { updated_at: "2026-04-05T05:00:17.706Z" },
    prevMeta: { intent: "EXIT" },
    syncEventMs: nowMs,
    nowMs,
  });
  assert.strictEqual(out.defer, false);
  assert.strictEqual(out.reason, "NO_RECENT_ENTRY_SIGNAL");
}

{
  const out = __test.shouldCleanupExternalFlatOrders({
    active: false,
    prevActive: true,
    liveCfg: { apiKey: "k", apiSecret: "s" },
  });
  assert.strictEqual(out, true);
}

{
  const out = __test.shouldCleanupExternalFlatOrders({
    active: false,
    prevActive: false,
    liveCfg: { apiKey: "k", apiSecret: "s" },
  });
  assert.strictEqual(out, false);
}

{
  const out = __test.shouldCleanupExternalFlatOrders({
    active: true,
    prevActive: true,
    liveCfg: { apiKey: "k", apiSecret: "s" },
  });
  assert.strictEqual(out, false);
}

console.log("EXTERNAL_FLAT_SYNC_GRACE_TEST_OK");
