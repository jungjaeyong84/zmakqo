"use strict";

// 2026-04-27 Stage L — reconciler stale-threshold breach emitter contract.
//   - emit only when (active=false AND last refresh >= 30min ago).
//   - threshold env override: RECONCILER_FLAT_STALE_THRESHOLD_MS.
//   - kill switch env: RECONCILER_FLAT_STALE_OBSERVE=0.
//   - missing/invalid timestamps → silent (false negative 허용).
//   - emit fail-safety (best-effort, surveillance never throws).

const assert = require("assert");

const path = require.resolve("../services/binancePositionReconciler");
delete require.cache[path];
const { __test } = require("../services/binancePositionReconciler");
const { emitFlatStaleThresholdBreachAlert, buildFlatMetaProjection } = __test;

const HOUR = 60 * 60 * 1000;
const NOW = 1700000000000;

// (A) 기본 — refresh 시점이 30분+ 전이면 emit.
{
  const captured = [];
  const fired = emitFlatStaleThresholdBreachAlert(
    {
      symbol: "LINKUSDT",
      native_protection_refresh_at_ms: NOW - (45 * 60 * 1000),
      native_protection_side: "SHORT",
    },
    { now: NOW, emit: (l) => captured.push(JSON.parse(l)) },
  );
  assert.strictEqual(fired, true);
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].event, "reconciler_flat_stale_breach");
  assert.strictEqual(captured[0].symbol, "LINKUSDT");
  assert.strictEqual(captured[0].position_side, "SHORT");
  assert.strictEqual(captured[0].stale_age_ms, 45 * 60 * 1000);
  assert.strictEqual(captured[0].threshold_ms, 30 * 60 * 1000);
}

// (B) refresh 시점이 30분 미만이면 silent.
{
  const captured = [];
  const fired = emitFlatStaleThresholdBreachAlert(
    { native_protection_refresh_at_ms: NOW - (10 * 60 * 1000) },
    { now: NOW, emit: (l) => captured.push(l) },
  );
  assert.strictEqual(fired, false);
  assert.strictEqual(captured.length, 0);
}

// (C) refresh timestamp 없음 → silent.
{
  const captured = [];
  const fired = emitFlatStaleThresholdBreachAlert(
    { symbol: "LINKUSDT" },
    { now: NOW, emit: (l) => captured.push(l) },
  );
  assert.strictEqual(fired, false);
}

// (D) threshold env override.
{
  const captured = [];
  emitFlatStaleThresholdBreachAlert(
    { native_protection_refresh_at_ms: NOW - (10 * 60 * 1000) },
    { now: NOW, thresholdMs: 5 * 60 * 1000, emit: (l) => captured.push(JSON.parse(l)) },
  );
  assert.strictEqual(captured.length, 1, "(D) lower threshold → emits");
  assert.strictEqual(captured[0].threshold_ms, 5 * 60 * 1000);
}

// (E) observe=false kill switch.
{
  const captured = [];
  const fired = emitFlatStaleThresholdBreachAlert(
    { native_protection_refresh_at_ms: NOW - HOUR },
    { now: NOW, observe: false, emit: (l) => captured.push(l) },
  );
  assert.strictEqual(fired, false);
  assert.strictEqual(captured.length, 0);
}

// (F) emit throw 해도 swallow.
{
  const fired = emitFlatStaleThresholdBreachAlert(
    { native_protection_refresh_at_ms: NOW - HOUR },
    { now: NOW, emit: () => { throw new Error("emit blew up"); } },
  );
  assert.strictEqual(fired, true, "(F) emit throw 무시, true 반환");
}

// (G) 잘못된 meta (null / non-object) → silent.
{
  assert.strictEqual(emitFlatStaleThresholdBreachAlert(null, { now: NOW }), false);
  assert.strictEqual(emitFlatStaleThresholdBreachAlert("string", { now: NOW }), false);
}

// (H) buildFlatMetaProjection 통합 — 30분+ stale meta 가 들어오면 emit 자동.
{
  const origWarn = console.warn;
  const captured = [];
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    const next = buildFlatMetaProjection({
      symbol: "LINKUSDT",
      native_protection_refresh_at_ms: Date.now() - (40 * 60 * 1000),
    });
    assert.strictEqual(next.exchange_projection_in_sync, true, "(H) cleanup 정상");
  } finally {
    console.warn = origWarn;
  }
  const matched = captured.filter((line) => line.includes("RECONCILER_FLAT_STALE_BREACH"));
  assert.strictEqual(matched.length, 1, "(H) 통합 시 emit 1회");
}

console.log("RECONCILER_FLAT_STALE_BREACH_TEST_OK");
