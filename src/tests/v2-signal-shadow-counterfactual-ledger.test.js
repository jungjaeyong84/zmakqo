"use strict";

const assert = require("assert");
const ledger = require("../v2/signalShadowCounterfactualLedger");

const T0 = 1_700_000_000_000;
const BAR_15M_MS = 15 * 60 * 1000;

function makeFakeFirestore() {
  const docs = new Map();
  function makeDocRef(path) {
    return {
      path,
      async get() {
        const data = docs.get(path);
        return {
          exists: data !== undefined,
          data() {
            return data ? JSON.parse(JSON.stringify(data)) : null;
          },
        };
      },
      async set(payload, opts = {}) {
        if (opts.merge === true) {
          const prev = docs.get(path) || {};
          docs.set(path, { ...prev, ...payload });
        } else {
          docs.set(path, { ...payload });
        }
      },
    };
  }
  function makeCollection(name) {
    const filters = [];
    let limitN = null;
    const q = {
      where(field, op, value) {
        filters.push({ field, op, value });
        return q;
      },
      limit(n) {
        limitN = n;
        return q;
      },
      async get() {
        let results = [];
        for (const [path, data] of docs.entries()) {
          if (!path.startsWith(`${name}/`)) continue;
          const ok = filters.every((f) => {
            const v = data[f.field];
            if (f.op === "==") return v === f.value;
            if (f.op === "<=") return Number(v) <= Number(f.value);
            return true;
          });
          if (ok) {
            results.push({
              id: path.split("/").pop(),
              data() { return JSON.parse(JSON.stringify(data)); },
            });
          }
        }
        if (limitN !== null) results = results.slice(0, limitN);
        return { docs: results };
      },
    };
    return q;
  }
  return {
    doc(path) { return makeDocRef(path); },
    collection(name) {
      const q = makeCollection(name);
      q.doc = (id) => makeDocRef(`${name}/${id}`);
      return q;
    },
    __dump() { return new Map(docs); },
  };
}

(function exportsPresent() {
  const expected = [
    "COLLECTION_NAME",
    "DEFAULT_HORIZON_BARS",
    "STATUS_PENDING",
    "STATUS_CLOSED",
    "STATUS_EXPIRED",
    "resolveCounterfactualLedgerPolicy",
    "buildFilterCombinationHash",
    "buildCounterfactualDocId",
    "buildCounterfactualDocPath",
    "extractFilterSetsFromShadowDecision",
    "buildPendingRecord",
    "evaluatePendingExpiry",
    "closeRecordFromKlines",
    "buildExpiredUpdate",
    "recordCounterfactualEvaluation",
    "closeCounterfactualRecord",
    "walkPendingCounterfactuals",
  ];
  for (const key of expected) {
    assert.ok(ledger[key] !== undefined, `MISSING_EXPORT:${key}`);
  }
})();

(function policyDefaults() {
  const p = ledger.resolveCounterfactualLedgerPolicy({});
  assert.strictEqual(p.enabled, false, "DEFAULT_DISABLED");
  assert.strictEqual(p.horizon_bars, 24, "DEFAULT_HORIZON_BARS");
  assert.strictEqual(p.bar_interval_ms, 15 * 60 * 1000, "DEFAULT_BAR_MS");
  assert.strictEqual(p.max_age_ms, 7 * 24 * 60 * 60 * 1000, "DEFAULT_MAX_AGE");
})();

(function policyHonorsEnv() {
  const p = ledger.resolveCounterfactualLedgerPolicy({
    DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1",
    DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_HORIZON_BARS: "12",
  });
  assert.strictEqual(p.enabled, true);
  assert.strictEqual(p.horizon_bars, 12);
})();

(function filterCombinationHashStable() {
  const a = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["B", "A"],
    would_pass_filter_set: ["X"],
  });
  const b = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["A", "B"],
    would_pass_filter_set: ["X"],
  });
  assert.strictEqual(a, b, "HASH_ORDER_INDEPENDENT");
  const c = ledger.buildFilterCombinationHash({
    would_block_filter_set: ["A"],
    would_pass_filter_set: ["X"],
  });
  assert.notStrictEqual(a, c, "HASH_DIFFERS_BY_SET_CONTENT");
})();

(function extractFilterSetsFromShadowDecision() {
  const decision = {
    shadow_verdict: "WOULD_BLOCK",
    filters: [
      { id: "BTC_1H_TREND_ALT_LONG", status: "WOULD_BLOCK", would_block: true },
      { id: "MULTI_TF_1H_ALIGNMENT", status: "WOULD_PASS", would_block: false },
      { id: "VOLATILITY_CHAOS_30M", status: "INSUFFICIENT_EVIDENCE", would_block: false },
      { id: "COST_ADJUSTED_EDGE", status: "NOT_APPLICABLE" },
    ],
  };
  const sets = ledger.extractFilterSetsFromShadowDecision(decision);
  assert.deepStrictEqual([...sets.would_block_filter_set], ["BTC_1H_TREND_ALT_LONG"]);
  assert.deepStrictEqual([...sets.would_pass_filter_set], ["MULTI_TF_1H_ALIGNMENT"]);
  assert.deepStrictEqual([...sets.insufficient_evidence_filter_set], ["VOLATILITY_CHAOS_30M"]);
})();

(function buildPendingRecordEnforcesRequiredFields() {
  assert.throws(() => ledger.buildPendingRecord({
    side: "LONG",
    candle_close_ms: T0,
    now_ms: T0,
  }), /SYMBOL_REQUIRED/);
  assert.throws(() => ledger.buildPendingRecord({
    symbol: "BTCUSDT",
    candle_close_ms: T0,
    now_ms: T0,
  }), /SIDE_REQUIRED/);
  assert.throws(() => ledger.buildPendingRecord({
    symbol: "BTCUSDT",
    side: "LONG",
    now_ms: T0,
  }), /CANDLE_CLOSE_MS_REQUIRED/);
})();

(function buildPendingRecordShape() {
  const out = ledger.buildPendingRecord({
    symbol: "btcusdt",
    side: "buy",
    candle_close_ms: T0,
    ref_price: 50000,
    signal_id: "sig_1",
    signal_verdict: "PASS",
    shadow_filter_decision: {
      shadow_verdict: "WOULD_PASS",
      filters: [
        { id: "BTC_1H_TREND_ALT_LONG", status: "NOT_APPLICABLE" },
        { id: "MULTI_TF_1H_ALIGNMENT", status: "WOULD_PASS", would_block: false },
        { id: "VOLATILITY_CHAOS_30M", status: "WOULD_PASS", would_block: false },
        { id: "COST_ADJUSTED_EDGE", status: "WOULD_PASS", would_block: false },
      ],
    },
    horizon_bars: 24,
    bar_interval_ms: BAR_15M_MS,
    now_ms: T0,
  });
  assert.strictEqual(out.record.symbol, "BTCUSDT", "SYMBOL_NORMALIZED");
  assert.strictEqual(out.record.side, "LONG", "SIDE_NORMALIZED");
  assert.strictEqual(out.record.signal_verdict, "PASS");
  assert.strictEqual(out.record.shadow_verdict, "WOULD_PASS");
  assert.strictEqual(out.record.status, "PENDING");
  assert.strictEqual(out.record.horizon_close_ms, T0 + 24 * BAR_15M_MS);
  assert.ok(out.doc_id.startsWith("BTCUSDT__"), "DOC_ID_HAS_SYMBOL");
  assert.strictEqual(out.doc_path, `v2__signal_shadow_counterfactuals/${out.doc_id}`);
})();

(function evaluatePendingExpiryTransitions() {
  const horizonCloseMs = T0 + 24 * BAR_15M_MS;
  const before = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizonCloseMs, created_at_ms: T0 },
    now_ms: T0 + 60_000,
  });
  assert.strictEqual(before.action, "WAIT", "BEFORE_HORIZON_WAIT");
  const at = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizonCloseMs, created_at_ms: T0 },
    now_ms: horizonCloseMs + 1,
  });
  assert.strictEqual(at.action, "CLOSE", "HORIZON_REACHED_CLOSE");
  const expired = ledger.evaluatePendingExpiry({
    pending: { status: "PENDING", horizon_close_ms: horizonCloseMs, created_at_ms: T0 },
    now_ms: T0 + 8 * 24 * 60 * 60 * 1000,
    max_age_ms: 7 * 24 * 60 * 60 * 1000,
  });
  assert.strictEqual(expired.action, "EXPIRE", "MAX_AGE_EXPIRE");
  const closed = ledger.evaluatePendingExpiry({
    pending: { status: "CLOSED", horizon_close_ms: horizonCloseMs, created_at_ms: T0 },
    now_ms: horizonCloseMs + 1,
  });
  assert.strictEqual(closed.action, "SKIP", "CLOSED_SKIP");
})();

(function closeRecordFromKlinesLong() {
  const pending = {
    side: "LONG",
    ref_price: 100,
    candle_close_ms: T0,
    horizon_close_ms: T0 + 24 * BAR_15M_MS,
    bar_interval_ms: BAR_15M_MS,
  };
  const klines = [
    [T0, 100, 105, 99, 104],
    [T0 + BAR_15M_MS, 104, 110, 103, 108],
    [T0 + 2 * BAR_15M_MS, 108, 109, 95, 96],
  ];
  const update = ledger.closeRecordFromKlines({ pending, klines, now_ms: T0 + 4 * BAR_15M_MS });
  assert.strictEqual(update.status, "CLOSED");
  assert.strictEqual(update.bar_n_observed, 3);
  assert.ok(Math.abs(update.mfe_pct - 0.1) < 1e-9, `MFE_LONG=${update.mfe_pct}`);
  assert.ok(Math.abs(update.mae_pct - 0.05) < 1e-9, `MAE_LONG=${update.mae_pct}`);
  assert.ok(Math.abs(update.exit_close_pct - (-0.04)) < 1e-9, `EXIT_LONG=${update.exit_close_pct}`);
})();

(function closeRecordFromKlinesShort() {
  const pending = {
    side: "SHORT",
    ref_price: 100,
    candle_close_ms: T0,
    horizon_close_ms: T0 + 24 * BAR_15M_MS,
    bar_interval_ms: BAR_15M_MS,
  };
  const klines = [
    [T0, 100, 102, 95, 96],
    [T0 + BAR_15M_MS, 96, 97, 90, 92],
  ];
  const update = ledger.closeRecordFromKlines({ pending, klines, now_ms: T0 + 4 * BAR_15M_MS });
  assert.ok(Math.abs(update.mfe_pct - 0.1) < 1e-9, `MFE_SHORT=${update.mfe_pct}`);
  assert.ok(Math.abs(update.mae_pct - 0.02) < 1e-9, `MAE_SHORT=${update.mae_pct}`);
  assert.ok(Math.abs(update.exit_close_pct - 0.08) < 1e-9, `EXIT_SHORT=${update.exit_close_pct}`);
})();

(function closeRecordFromKlinesNoData() {
  const update = ledger.closeRecordFromKlines({
    pending: { side: "LONG", ref_price: 100, candle_close_ms: T0, horizon_close_ms: T0 + BAR_15M_MS },
    klines: [],
    now_ms: T0 + BAR_15M_MS,
  });
  assert.strictEqual(update.status, "CLOSED");
  assert.strictEqual(update.bar_n_observed, 0);
  assert.strictEqual(update.mfe_pct, null);
  assert.strictEqual(update.mae_pct, null);
  assert.strictEqual(update.exit_close_pct, null);
  assert.strictEqual(update.close_reason, "NO_KLINES");
})();

(async function recordCounterfactualEvaluationDisabled() {
  const result = await ledger.recordCounterfactualEvaluation({
    db: makeFakeFirestore(),
    env: {},
    symbol: "BTCUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 50000,
    shadow_filter_decision: { shadow_verdict: "WOULD_PASS", filters: [] },
    now_ms: T0,
  });
  assert.strictEqual(result.ok, true, "DISABLED_OK");
  assert.strictEqual(result.written, false, "DISABLED_NO_WRITE");
  assert.strictEqual(result.reason, "LEDGER_DISABLED");
})();

(async function recordCounterfactualEvaluationWritesWhenEnabled() {
  const db = makeFakeFirestore();
  const result = await ledger.recordCounterfactualEvaluation({
    db,
    env: { DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" },
    symbol: "BTCUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 50000,
    signal_verdict: "PASS",
    shadow_filter_decision: {
      shadow_verdict: "WOULD_PASS",
      filters: [
        { id: "BTC_1H_TREND_ALT_LONG", status: "NOT_APPLICABLE" },
        { id: "MULTI_TF_1H_ALIGNMENT", status: "WOULD_PASS", would_block: false },
      ],
    },
    now_ms: T0,
  });
  assert.strictEqual(result.ok, true, "ENABLED_OK");
  assert.strictEqual(result.written, true, "ENABLED_WROTE");
  const dump = db.__dump();
  const stored = dump.get(`v2__signal_shadow_counterfactuals/${result.doc_id}`);
  assert.ok(stored, "RECORD_PRESENT");
  assert.strictEqual(stored.status, "PENDING");
  assert.strictEqual(stored.symbol, "BTCUSDT");
  assert.strictEqual(stored.side, "LONG");
  assert.deepStrictEqual([...stored.would_pass_filter_set], ["MULTI_TF_1H_ALIGNMENT"]);
})();

(async function recordCounterfactualEvaluationIdempotentOnAlreadyClosed() {
  const db = makeFakeFirestore();
  const env = { DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" };
  const args = {
    db,
    env,
    symbol: "BTCUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 50000,
    shadow_filter_decision: { shadow_verdict: "WOULD_PASS", filters: [] },
    now_ms: T0,
  };
  const first = await ledger.recordCounterfactualEvaluation(args);
  assert.strictEqual(first.written, true);
  const ref = db.doc(`v2__signal_shadow_counterfactuals/${first.doc_id}`);
  await ref.set({ status: "CLOSED" }, { merge: true });
  const second = await ledger.recordCounterfactualEvaluation(args);
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.written, false, "ALREADY_CLOSED_NOT_OVERWRITTEN");
  assert.strictEqual(second.reason, "LEDGER_ALREADY_CLOSED");
})();

(async function walkPendingCounterfactualsClosesPastHorizon() {
  const db = makeFakeFirestore();
  const env = {
    DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1",
    DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_HORIZON_BARS: "2",
  };
  await ledger.recordCounterfactualEvaluation({
    db,
    env,
    symbol: "BTCUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 100,
    shadow_filter_decision: { shadow_verdict: "WOULD_BLOCK", filters: [{ id: "X", status: "WOULD_BLOCK", would_block: true }] },
    now_ms: T0,
  });
  await ledger.recordCounterfactualEvaluation({
    db,
    env,
    symbol: "ETHUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 200,
    shadow_filter_decision: { shadow_verdict: "WOULD_PASS", filters: [{ id: "Y", status: "WOULD_PASS", would_block: false }] },
    now_ms: T0,
  });
  let fetchN = 0;
  const result = await ledger.walkPendingCounterfactuals({
    db,
    env,
    fetchKlines: async ({ symbol, candle_close_ms, horizon_close_ms, bar_interval_ms }) => {
      fetchN += 1;
      assert.ok(symbol === "BTCUSDT" || symbol === "ETHUSDT", `SYMBOL_PASSED:${symbol}`);
      const ref = symbol === "BTCUSDT" ? 100 : 200;
      return [
        [candle_close_ms, ref, ref * 1.05, ref * 0.99, ref * 1.04],
        [candle_close_ms + bar_interval_ms, ref * 1.04, ref * 1.06, ref, ref * 1.02],
      ];
    },
    now_ms: T0 + 3 * BAR_15M_MS,
  });
  assert.strictEqual(result.ok, true, "WALK_OK");
  assert.strictEqual(result.processed_n, 2, "BOTH_PROCESSED");
  assert.strictEqual(fetchN, 2, "FETCH_CALLED_PER_DOC");
  for (const r of result.results) {
    assert.strictEqual(r.action, "CLOSE", `ACTION_CLOSE:${r.doc_id}`);
    assert.strictEqual(r.update.status, "CLOSED");
    assert.strictEqual(r.update.bar_n_observed, 2);
  }
})();

(async function walkPendingCounterfactualsExpiresStaleRecords() {
  const db = makeFakeFirestore();
  const env = { DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" };
  await ledger.recordCounterfactualEvaluation({
    db,
    env,
    symbol: "BTCUSDT",
    side: "LONG",
    candle_close_ms: T0,
    ref_price: 100,
    shadow_filter_decision: { shadow_verdict: "WOULD_PASS", filters: [] },
    now_ms: T0,
  });
  let fetchN = 0;
  const result = await ledger.walkPendingCounterfactuals({
    db,
    env,
    fetchKlines: async () => {
      fetchN += 1;
      return [];
    },
    now_ms: T0 + 8 * 24 * 60 * 60 * 1000,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.processed_n, 1);
  assert.strictEqual(fetchN, 0, "NO_FETCH_FOR_EXPIRED");
  assert.strictEqual(result.results[0].action, "EXPIRE", "EXPIRE_ACTION");
  assert.strictEqual(result.results[0].update.status, "EXPIRED");
})();

console.log(JSON.stringify({
  ok: true,
  reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_TEST_OK",
}));
