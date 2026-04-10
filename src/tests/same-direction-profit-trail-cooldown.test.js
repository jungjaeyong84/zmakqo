"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(
    typeof __test.resolveSameDirectionTrailProfitCooldownConfig,
    "function",
    "resolveSameDirectionTrailProfitCooldownConfig export missing"
  );
  assert.strictEqual(
    typeof __test.buildSameDirectionTrailProfitCooldownMetaPatch,
    "function",
    "buildSameDirectionTrailProfitCooldownMetaPatch export missing"
  );
  assert.strictEqual(
    typeof __test.buildSameDirectionTrailProfitObservationPayload,
    "function",
    "buildSameDirectionTrailProfitObservationPayload export missing"
  );
  assert.strictEqual(
    typeof __test.buildSameDirectionTrailProfitLegacyResetMetaPatch,
    "function",
    "buildSameDirectionTrailProfitLegacyResetMetaPatch export missing"
  );
  assert.strictEqual(
    typeof __test.resolveSameDirectionTrailProfitCooldownBlock,
    "function",
    "resolveSameDirectionTrailProfitCooldownBlock export missing"
  );
  assert.strictEqual(
    typeof __test.resolveSameDirectionTrailProfitCooldownSnapshot,
    "function",
    "resolveSameDirectionTrailProfitCooldownSnapshot export missing"
  );
  assert.strictEqual(
    typeof __test.loadSameDirectionTrailProfitObservationSafe,
    "function",
    "loadSameDirectionTrailProfitObservationSafe export missing"
  );

  const cfg = __test.resolveSameDirectionTrailProfitCooldownConfig({
    same_direction_trail_profit_cooldown_enabled: true,
    same_direction_trail_profit_cooldown_ms: 4 * 60 * 60 * 1000,
  });
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.cooldownMs, 4 * 60 * 60 * 1000);

  const patch = __test.buildSameDirectionTrailProfitCooldownMetaPatch({
    event: "EXIT_TRAIL_1P",
    realizedPnlQuote: 12.5,
    positionSide: "LONG",
    exitWallMs: Date.parse("2026-03-14T10:00:00Z"),
    source: "INTENT_FILL",
  });
  assert.strictEqual(patch.same_direction_trail_profit_exit_dir, "LONG");
  assert.strictEqual(patch.same_direction_trail_profit_exit_event, "EXIT_TRAIL_1P");
  assert.strictEqual(patch.same_direction_trail_profit_exit_realized_pnl, 12.5);

  const observationPayload = __test.buildSameDirectionTrailProfitObservationPayload(patch);
  assert.deepStrictEqual(observationPayload, {
    exit_dir: "LONG",
    exit_wall_ms: Date.parse("2026-03-14T10:00:00Z"),
    exit_event: "EXIT_TRAIL_1P",
    realized_pnl: 12.5,
    source: "INTENT_FILL",
  });

  assert.deepStrictEqual(__test.buildSameDirectionTrailProfitLegacyResetMetaPatch(), {
    same_direction_trail_profit_exit_dir: null,
    same_direction_trail_profit_exit_wall_ms: null,
    same_direction_trail_profit_exit_event: null,
    same_direction_trail_profit_exit_realized_pnl: null,
    same_direction_trail_profit_exit_source: null,
  });

  const blocked = __test.resolveSameDirectionTrailProfitCooldownBlock({
    cfg,
    posMeta: patch,
    intentDir: "LONG",
    eventRefMs: Date.parse("2026-03-14T13:59:59Z"),
  });
  assert.ok(blocked, "same direction before 4h should be blocked");
  assert.strictEqual(blocked.exit_dir, "LONG");

  const oppositeAllowed = __test.resolveSameDirectionTrailProfitCooldownBlock({
    cfg,
    posMeta: patch,
    intentDir: "SHORT",
    eventRefMs: Date.parse("2026-03-14T11:00:00Z"),
  });
  assert.strictEqual(oppositeAllowed, null, "opposite direction must remain allowed");

  const afterCooldown = __test.resolveSameDirectionTrailProfitCooldownBlock({
    cfg,
    posMeta: patch,
    intentDir: "LONG",
    eventRefMs: Date.parse("2026-03-14T14:00:00Z"),
  });
  assert.strictEqual(afterCooldown, null, "same direction after cooldown expiry must be allowed");

  const mergedSnapshot = __test.resolveSameDirectionTrailProfitCooldownSnapshot({
    posMeta: {
      same_direction_trail_profit_exit_dir: "LONG",
      same_direction_trail_profit_exit_wall_ms: Date.parse("2026-03-14T09:00:00Z"),
      same_direction_trail_profit_exit_event: "EXIT_TRAIL_OLD",
    },
    observation: {
      same_direction_trail_profit: {
        exit_dir: "SHORT",
        exit_wall_ms: Date.parse("2026-03-14T11:00:00Z"),
        exit_event: "EXIT_TRAIL_NEW",
        realized_pnl: 8.5,
        source: "BINANCE_USER_TRADES",
      },
    },
  });
  assert.strictEqual(mergedSnapshot.same_direction_trail_profit_exit_dir, "SHORT");
  assert.strictEqual(mergedSnapshot.same_direction_trail_profit_exit_event, "EXIT_TRAIL_NEW");
  assert.strictEqual(mergedSnapshot.same_direction_trail_profit_exit_realized_pnl, 8.5);
  const observationOnlySnapshot = __test.resolveSameDirectionTrailProfitCooldownSnapshot({
    posMeta: {
      same_direction_trail_profit_exit_dir: "LONG",
      same_direction_trail_profit_exit_wall_ms: Date.parse("2026-03-14T09:00:00Z"),
      same_direction_trail_profit_exit_event: "EXIT_TRAIL_OLD",
    },
    observation: {
      same_direction_trail_profit: {
        exit_dir: "SHORT",
        exit_wall_ms: Date.parse("2026-03-14T11:00:00Z"),
        exit_event: "EXIT_TRAIL_NEW",
        realized_pnl: 8.5,
        source: "BINANCE_USER_TRADES",
      },
    },
    observationOnly: true,
  });
  assert.strictEqual(observationOnlySnapshot.same_direction_trail_profit_exit_dir, "SHORT");
  assert.strictEqual(observationOnlySnapshot.same_direction_trail_profit_exit_event, "EXIT_TRAIL_NEW");

  const disabledObservation = __test.loadSameDirectionTrailProfitObservationSafe({
    enabled: false,
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
  });
  assert.ok(disabledObservation && typeof disabledObservation.then === "function", "helper should remain async");

  const nonProfitPatch = __test.buildSameDirectionTrailProfitCooldownMetaPatch({
    event: "EXIT_TRAIL_1P",
    realizedPnlQuote: -1,
    positionSide: "LONG",
    exitWallMs: Date.parse("2026-03-14T10:00:00Z"),
  });
  assert.strictEqual(nonProfitPatch, null, "losing trail exits must not arm same-direction cooldown");
}

try {
  run();
  console.log("SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN_TEST_OK");
} catch (err) {
  console.error("SAME_DIRECTION_PROFIT_TRAIL_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
