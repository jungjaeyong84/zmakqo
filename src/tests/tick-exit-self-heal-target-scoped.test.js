"use strict";

// 2026-04-19 regression guard for PR2 (fix/burst-self-heal-target-scoped):
//
// The target-burst self-heal used to run the wide 12-symbol sweep even
// when the runner specifically asked for a single symbol.  On slow
// egress windows this is what pushed burst runs past their 75s
// timeout — the SOLUSDT 2026-04-19 observation (TP1 at 07:23:09Z, first
// BE-raise decision at 07:42:10Z — a 19-minute gap) came from that
// pattern.
//
// This test pins down the scoping contract so a future refactor
// doesn't silently drop targetSymbols on the floor.

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

async function run() {
  const oldEnv = {
    BINANCE_LIVE_STATE_SELF_HEAL_ENABLED: process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED,
    BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS: process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS,
  };

  process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED = "1";
  process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS = "300000";
  __test.clearSelfHealCooldown();

  try {
    // ── Case A: target-scoped burst forwards targetSymbols ─────────
    {
      const calls = [];
      const runSelfHeal = async (args) => {
        calls.push(args);
        return { ok: true, scanned: args && Array.isArray(args.symbols) ? args.symbols.length : 0 };
      };
      const result = await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal,
        targetSymbols: ["SOLUSDT"],
      });
      assert.strictEqual(result.ok, true, "target-scoped self-heal returns ok");
      assert.strictEqual(result.target_scoped, true, "result flags scoped=true");
      assert.deepStrictEqual(result.target_symbols, ["SOLUSDT"],
        "result echoes back normalized target symbols");
      assert.strictEqual(calls.length, 1, "selfHeal called exactly once");
      assert.deepStrictEqual(calls[0].symbols, ["SOLUSDT"],
        "runSelfHeal receives the target symbols array (the main PR2 fix)");
      assert.strictEqual(calls[0].maxPositions, 1,
        "maxPositions capped at symbol count to prevent wide sweep");
      assert.strictEqual(String(calls[0].reason || "").endsWith("_TARGET_SCOPED"), true,
        "reason is tagged _TARGET_SCOPED so downstream audit distinguishes scope");
    }

    // ── Case B: target-scoped bypasses cooldown ────────────────────
    // If the last wide self-heal was 10s ago (well within the 5min
    // cooldown), a target-scoped call for a specific symbol must
    // still run — cooldown only throttles shotgun scans.
    {
      __test.clearSelfHealCooldown();
      const runSelfHealWide = async () => ({ ok: true });
      await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal: runSelfHealWide,
        // no targetSymbols → wide sweep → this sets the cooldown clock
      });

      let scopedCallCount = 0;
      const runSelfHealScoped = async (args) => {
        scopedCallCount += 1;
        return { ok: true, symbols: args.symbols };
      };
      const scoped = await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal: runSelfHealScoped,
        targetSymbols: ["BTCUSDT"],
      });
      assert.strictEqual(scoped.ok, true, "scoped runs despite wide cooldown active");
      assert.notStrictEqual(scoped.reason, "COOLDOWN",
        "scoped call must NOT short-circuit on cooldown");
      assert.strictEqual(scopedCallCount, 1, "scoped self-heal invoked once");
    }

    // ── Case C: wide sweep still honors cooldown ───────────────────
    // PR2 is a target-mode unlock; it must NOT change wide-sweep
    // throttling.  Pin this down.
    {
      __test.clearSelfHealCooldown();
      let wideCallCount = 0;
      const runSelfHealWide = async () => {
        wideCallCount += 1;
        return { ok: true };
      };
      await __test.runTickExitSelfHealPhase({ cooldownMs: 300000, runSelfHeal: runSelfHealWide });
      const second = await __test.runTickExitSelfHealPhase({ cooldownMs: 300000, runSelfHeal: runSelfHealWide });
      assert.strictEqual(second.reason, "COOLDOWN",
        "wide sweep still short-circuits on cooldown (unchanged from pre-PR2)");
      assert.strictEqual(wideCallCount, 1, "wide cooldown suppresses the second call");
    }

    // ── Case D: scoped does NOT advance wide cooldown clock ────────
    // If scoped advanced the cooldown, a target-burst for SOL would
    // silently starve the next wide sweep.  Defend against that.
    {
      __test.clearSelfHealCooldown();
      const runSelfHealScoped = async () => ({ ok: true });
      await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal: runSelfHealScoped,
        targetSymbols: ["SOLUSDT"],
      });
      let wideCallCount = 0;
      const runSelfHealWide = async () => {
        wideCallCount += 1;
        return { ok: true };
      };
      const wideAfter = await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal: runSelfHealWide,
      });
      assert.strictEqual(wideAfter.ok, true, "wide sweep runs after scoped");
      assert.notStrictEqual(wideAfter.reason, "COOLDOWN",
        "scoped call must NOT have pinned the cooldown clock");
      assert.strictEqual(wideCallCount, 1, "wide sweep was actually invoked");
    }

    // ── Case E: empty/whitespace targetSymbols degrade to wide sweep ──
    {
      __test.clearSelfHealCooldown();
      const calls = [];
      const runSelfHeal = async (args) => {
        calls.push(args);
        return { ok: true };
      };
      await __test.runTickExitSelfHealPhase({
        cooldownMs: 300000,
        runSelfHeal,
        targetSymbols: ["", "   ", null],
      });
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].symbols, null,
        "all-empty input normalizes to null (wide sweep)");
    }
  } finally {
    __test.clearSelfHealCooldown();
    for (const [key, value] of Object.entries(oldEnv)) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  }
}

run()
  .then(() => console.log("TICK_EXIT_SELF_HEAL_TARGET_SCOPED_TEST_OK"))
  .catch((err) => {
    console.error("TICK_EXIT_SELF_HEAL_TARGET_SCOPED_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
