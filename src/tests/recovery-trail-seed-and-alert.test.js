"use strict";

// 2026-04-18 regression guard for the three TP1-recovery fixes:
//   Fix #1: recovery path emits a late trade-execution alert (guard
//           refined 2026-04-19 — see shouldDispatchTp1RecoveryAlert tests
//           at the bottom of this file).
//   Fix #2: recovery seeds trail_high (LONG) / trail_low (SHORT) from the
//           current mark price so the next tick starts trailing from a
//           real waterline instead of null.
//   Fix #3: BE floor condition in tick-exit dropped the `!_trailEnabled`
//           gate — verified indirectly via buildSimplifiedExitShadowView
//           behaviour and the runner-floor signalEngine tests.

const assert = require("assert");
const reconciler = require("../services/binancePositionReconciler");
const recoverSimplifiedExitV2RunnerMetaFromQtyReduction =
  (reconciler.__test && reconciler.__test.recoverSimplifiedExitV2RunnerMetaFromQtyReduction)
  || reconciler.recoverSimplifiedExitV2RunnerMetaFromQtyReduction;
const shouldDispatchTp1RecoveryAlert =
  reconciler.shouldDispatchTp1RecoveryAlert
  || (reconciler.__test && reconciler.__test.shouldDispatchTp1RecoveryAlert);
const buildFlatMetaProjection =
  reconciler.__test && reconciler.__test.buildFlatMetaProjection;

function baseInput(overrides = {}) {
  // Qty numbers chosen so the shadow plan agrees with the observed
  // drop: entry 1.56 × TP1_QTY 0.5 = TP1 fill 0.78, leaving runner 0.78.
  // If you change TP_P1_QTY below, recompute: fill = entry × ratio.
  return {
    meta: {
      simplified_exit_v2_enabled: true,
      entry_qty_base: 1.56,
      entry_qty_abs: 1.56,
      exit_rules_override: {
        SL: -0.0165,
        TP_P1: 0.0165,
        TP_P1_QTY: 0.5,
        RUNNER_MIN_PROFIT_PCT: 0.003,
        TRAIL_PCT: 0.01,
      },
      canonical_exit_stage: "BREAKEVEN",
    },
    positionSide: "LONG",
    qtyBase: 0.78,
    previousQtyBase: 1.56,
    entryPrice: 643.04,
    stopOrder: { orderId: "S1", triggerPrice: 637.74 },
    tpOrder: null, // crucial — once TP1 fills, the TP order is gone
    ...overrides,
  };
}

(function run() {
  // ── Fix #2a: LONG recovery seeds trail_high from currentMarkPrice ─
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput(),
      currentMarkPrice: 648.28,
    });
    assert.ok(out && out.meta, "recovery must return meta on qualifying qty drop");
    assert.strictEqual(out.meta.tp_p1_done, true);
    assert.strictEqual(out.meta.trail_active, true);
    assert.strictEqual(out.meta.tp_p1_source, "EXCHANGE_QTY_REDUCTION_RECOVERY");
    assert.strictEqual(out.meta.trail_high, 648.28,
      "LONG trail_high must be seeded from currentMarkPrice");
    assert.strictEqual(out.meta.trail_low, null,
      "SHORT-only field stays null for LONG position");
    assert.ok(Number.isFinite(out.meta.trail_high_at_ms),
      "trail_high_at_ms must be set when seed fires");
    assert.strictEqual(out.meta.tp_p1_recovery_trigger,
      "EXCHANGE_QTY_REDUCTION_RECOVERY",
      "recovery marker must be set so downstream alert dispatcher can detect");
    assert.strictEqual(out.meta.tp_p1_recovery_seeded_price, 648.28);
  }

  // ── Fix #2b: SHORT recovery seeds trail_low ──────────────────────
  {
    const shortInput = baseInput({ positionSide: "SHORT" });
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...shortInput,
      currentMarkPrice: 640.00,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_low, 640.00,
      "SHORT trail_low must be seeded from currentMarkPrice");
    assert.strictEqual(out.meta.trail_high, null,
      "LONG-only field stays null for SHORT position");
  }

  // ── Fix #2c: missing mark price falls back to entry price ────────
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput(),
      currentMarkPrice: null,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_high, 643.04,
      "LONG trail_high falls back to entry price when mark price missing");
    assert.strictEqual(out.meta.tp_p1_recovery_seeded_price, 643.04);
  }

  // ── Fix #2d: non-recovery case (already done) returns null ───────
  {
    const doneInput = baseInput({
      meta: {
        ...baseInput().meta,
        tp_p1_done: true, // already flagged — recovery must no-op
      },
    });
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...doneInput,
      currentMarkPrice: 648.28,
    });
    assert.strictEqual(out, null,
      "recovery must return null when tp_p1_done is already true");
  }

  // ── Fix #2e: existing trail_high is not lowered by a stale seed ──
  // If a prior tick established trail_high=650 and now mark price dips
  // to 648, the recovery helper must NOT lower the watermark.
  {
    const out = recoverSimplifiedExitV2RunnerMetaFromQtyReduction({
      ...baseInput({
        meta: { ...baseInput().meta, trail_high: 650.0 },
      }),
      currentMarkPrice: 648.28,
    });
    assert.ok(out && out.meta);
    assert.strictEqual(out.meta.trail_high, 650.0,
      "trail_high must not regress below a previously recorded watermark");
  }

  // ════════════════════════════════════════════════════════════════════
  // Fix #1 (guard refined 2026-04-19): shouldDispatchTp1RecoveryAlert
  //
  // Context: 2026-04-19 SOLUSDT TP1 (07:23:09Z) fired the recovery path
  // on a fresh lifecycle, but stale `tp_p1_recovery_alert_sent_at` from
  // yesterday's (2026-04-18T11:40:48Z) position was still persisted on
  // the Firestore meta document. The original `!alreadyAlerted` truthy
  // check suppressed the Telegram dispatch — operator received zero
  // notification that TP1 had hit.
  //
  // The guard now compares the alert timestamp against the per-event
  // `tp_p1_recovery_observed_at` marker: a stale alert from before the
  // current observation must NOT suppress a fresh dispatch.
  // ════════════════════════════════════════════════════════════════════
  assert.strictEqual(typeof shouldDispatchTp1RecoveryAlert, "function",
    "shouldDispatchTp1RecoveryAlert must be exported (named or via __test)");

  // Fix #1a: first-time recovery transition with no prior marker → fire
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: "2026-04-19T07:23:09.000Z",
        // tp_p1_recovery_alert_sent_at absent — never alerted
      },
    });
    assert.strictEqual(result, true,
      "first-time recovery with no alert marker must dispatch");
  }

  // Fix #1b: stale marker from a previous lifecycle + fresh observation → fire
  //          (this is the exact SOLUSDT 2026-04-19 regression)
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at:  "2026-04-19T07:23:09.000Z",
        tp_p1_recovery_alert_sent_at: "2026-04-18T11:40:48.567Z",
      },
    });
    assert.strictEqual(result, true,
      "stale alert marker (prior lifecycle) must NOT suppress fresh dispatch");
  }

  // Fix #1c: fresh marker after observation → skip (per-event idempotency)
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at:  "2026-04-19T07:23:09.000Z",
        tp_p1_recovery_alert_sent_at: "2026-04-19T07:23:10.123Z",
      },
    });
    assert.strictEqual(result, false,
      "alert timestamp after observation means we already fired for this event");
  }

  // Fix #1d: marker equals observation → skip (same event, no re-fire)
  {
    const ts = "2026-04-19T07:23:09.000Z";
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: ts,
        tp_p1_recovery_alert_sent_at: ts,
      },
    });
    assert.strictEqual(result, false,
      "equal timestamps count as already-alerted for the current event");
  }

  // Fix #1e: observation missing but marker present → conservative skip
  //          (can't prove staleness, avoid double-firing on crash loops)
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_alert_sent_at: "2026-04-18T11:40:48.567Z",
        // tp_p1_recovery_observed_at absent
      },
    });
    assert.strictEqual(result, false,
      "missing observed_at + present marker: conservative skip to avoid double-fire");
  }

  // Fix #1f: prev already done → not a transition, never fire
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: true },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: "2026-04-19T07:23:09.000Z",
      },
    });
    assert.strictEqual(result, false,
      "already-done prev meta means this tick did not cross the TP1 boundary");
  }

  // Fix #1g: no recovery trigger → not the recovery path, skip
  //          (normal TP1 fills use the userTrade alert path, not this one)
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        // tp_p1_recovery_trigger absent — this was a normal userTrade fill
        tp_p1_recovery_observed_at: "2026-04-19T07:23:09.000Z",
      },
    });
    assert.strictEqual(result, false,
      "without recovery_trigger this is not the recovery alert path");
  }

  // Fix #1h: cur.tp_p1_done false → nothing happened, skip
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: false,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: "2026-04-19T07:23:09.000Z",
      },
    });
    assert.strictEqual(result, false,
      "tp_p1_done=false on current meta means no transition to alert on");
  }

  // Fix #1i: null prevMeta (brand-new position document) + fresh recovery → fire
  {
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: null,
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: "2026-04-19T07:23:09.000Z",
      },
    });
    assert.strictEqual(result, true,
      "null prevMeta is treated as tp_p1_done=false — first-time fire");
  }

  // Fix #1j: numeric-epoch timestamps are accepted (engine occasionally writes ms)
  {
    const observedMs = Date.parse("2026-04-19T07:23:09.000Z");
    const staleAlertMs = Date.parse("2026-04-18T11:40:48.567Z");
    const result = shouldDispatchTp1RecoveryAlert({
      prevMeta: { tp_p1_done: false },
      meta: {
        tp_p1_done: true,
        tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
        tp_p1_recovery_observed_at: observedMs,
        tp_p1_recovery_alert_sent_at: staleAlertMs,
      },
    });
    assert.strictEqual(result, true,
      "numeric-epoch timestamps must compare correctly (stale < fresh)");
  }

  // ════════════════════════════════════════════════════════════════════
  // Fix #1 follow-up (2026-04-19 quality audit): lifecycle cleanup.
  //
  // The quality audit on PR #15 surfaced a narrower second-order edge:
  // if the PRIOR lifecycle had a recovery-path TP1 but the alert never
  // fired (alert_sent_at null, e.g. runner crashed between guard and
  // dispatch), and the NEXT lifecycle hits TP1 via the normal fills-sync
  // path (tp_p1_recovery_trigger therefore not re-set this time), the
  // guard would still see the stale trigger from yesterday and could
  // double-fire (fills-sync primary + recovery late alert).
  //
  // Root-cause fix: clear the whole tp_p1_recovery_* marker family on
  // FLAT so no stale state bleeds across position lifecycles.  This
  // aligns the recovery markers with the same-class family PR #8/#10/
  // #11/#12 (set-once markers surviving lifecycles).
  // ════════════════════════════════════════════════════════════════════
  assert.strictEqual(typeof buildFlatMetaProjection, "function",
    "buildFlatMetaProjection must be exported in __test");

  {
    const dirty = {
      tp_p1_done: true,
      tp_p1_recovery_trigger: "EXCHANGE_QTY_REDUCTION_RECOVERY",
      tp_p1_recovery_observed_at: "2026-04-18T11:40:48.000Z",
      tp_p1_recovery_seeded_price: 102.34,
      tp_p1_recovery_alert_sent_at: "2026-04-18T11:40:48.567Z",
      // belt-and-suspenders: also confirm neighboring fields still clear
      trail_high: 648.28,
      trail_active: true,
    };
    const flat = buildFlatMetaProjection(dirty);
    assert.strictEqual(flat.tp_p1_done, false,
      "existing FLAT cleanup still flips tp_p1_done to false");
    assert.strictEqual(flat.trail_active, false,
      "existing FLAT cleanup still flips trail_active to false");
    assert.strictEqual(flat.tp_p1_recovery_trigger, null,
      "recovery_trigger must be cleared on FLAT (PR #15 audit follow-up)");
    assert.strictEqual(flat.tp_p1_recovery_observed_at, null,
      "recovery_observed_at must be cleared on FLAT");
    assert.strictEqual(flat.tp_p1_recovery_seeded_price, null,
      "recovery_seeded_price must be cleared on FLAT");
    assert.strictEqual(flat.tp_p1_recovery_alert_sent_at, null,
      "recovery_alert_sent_at must be cleared on FLAT");
  }

  console.log("RECOVERY_TRAIL_SEED_AND_ALERT_TEST_OK");
})();
