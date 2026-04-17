"use strict";

// Phase A contract tests for the OpenClaw Decision Agent.
// Run fully sequentially — the in-memory evidence ledger is a shared
// module-level buffer, so async IIFEs interleaving would produce
// non-deterministic counts.

const assert = require("assert");

const evidenceLedger = require("../services/openclawEvidenceLedger");
const narrativeReasoner = require("../services/openclawNarrativeReasoner");
const agent = require("../services/openclawDecisionAgent");

const FLAG_KEYS = [
  "OPENCLAW_AGENT_ENABLED",
  "OPENCLAW_AGENT_SHADOW_ENABLED",
  "OPENCLAW_AGENT_APPLY_ENABLED",
  "OPENCLAW_NARRATIVE_ENABLED",
  "OPENCLAW_ML_GATE_ENABLED",
  "OPENCLAW_EVIDENCE_LEDGER_FIRESTORE",
];

function envSnapshot(keys) {
  const snap = {};
  for (const k of keys) snap[k] = process.env[k];
  return snap;
}

function envRestore(snap) {
  for (const [k, v] of Object.entries(snap)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function run() {
  // -------- Narrative reasoner: disabled-by-default ------------------
  {
    const prev = envSnapshot(FLAG_KEYS);
    try {
      delete process.env.OPENCLAW_NARRATIVE_ENABLED;
      const [sig, pos, ret] = await Promise.all([
        narrativeReasoner.reasonAboutSignal({ symbol: "BTCUSDT" }),
        narrativeReasoner.reasonAboutPosition({ symbol: "BTCUSDT" }),
        narrativeReasoner.reasonAboutFailurePatterns({ trades: [] }),
      ]);
      for (const row of [sig, pos, ret]) {
        assert.strictEqual(row.disabled, true, "narrative must be disabled by default");
      }
    } finally { envRestore(prev); }
  }

  // -------- Narrative reasoner: stub behaviour when enabled ---------
  {
    const prev = envSnapshot(FLAG_KEYS);
    try {
      process.env.OPENCLAW_NARRATIVE_ENABLED = "1";
      const sig = await narrativeReasoner.reasonAboutSignal({
        exchange: "BINANCEFUT", symbol: "BTCUSDT", side: "LONG", qtyPct: 0.5,
      });
      assert.strictEqual(sig.disabled, false);
      assert.strictEqual(sig.role, narrativeReasoner.ROLES.SIGNAL_DECIDER);
      assert.ok(sig.prompt_hash && sig.prompt_hash.length === 16);
      assert.ok(sig.response && typeof sig.response === "object");
      assert.ok(sig.timeout_ms >= narrativeReasoner.MIN_TIMEOUT_MS);

      const pos = await narrativeReasoner.reasonAboutPosition({ symbol: "BTCUSDT", positionSnapshot: {} });
      assert.strictEqual(pos.role, narrativeReasoner.ROLES.POSITION_CONDUCTOR);

      const ret = await narrativeReasoner.reasonAboutFailurePatterns({ trades: [] });
      assert.strictEqual(ret.role, narrativeReasoner.ROLES.RETROSPECT);
    } finally { envRestore(prev); }
  }

  // -------- Safety-rail clamp in narrative response -----------------
  {
    const over = narrativeReasoner.clampResponse({ accept: true, scale: 2.5, confidence: 1.5 });
    assert.strictEqual(over.scale, 1, "scale > 1 must be clamped to 1");
    assert.strictEqual(over.confidence, 1, "confidence > 1 clamps");
    const widen = narrativeReasoner.clampResponse({ proposal: "widen_sl", confidence: 0.9 });
    assert.ok(widen.safety_rail_violations.includes("WIDEN_SL_PROPOSED"));
    const bumpQty = narrativeReasoner.clampResponse({ proposal: "increase_qty", confidence: 0.9 });
    assert.ok(bumpQty.safety_rail_violations.includes("INCREASE_QTY"));
    const ok = narrativeReasoner.clampResponse({ accept: true, scale: 0.7, confidence: 0.8 });
    assert.strictEqual(ok.scale, 0.7);
    assert.strictEqual(ok.confidence, 0.8);
    assert.deepStrictEqual(ok.safety_rail_violations, []);
  }

  // -------- Evidence ledger: schema + buffer + filter ---------------
  {
    evidenceLedger.__test.resetLedgerForTest();
    const prev = envSnapshot(FLAG_KEYS);
    try {
      delete process.env.OPENCLAW_EVIDENCE_LEDGER_FIRESTORE;
      const res = await evidenceLedger.writeEvidenceRecord({
        kind: "signal_decider",
        symbol: "BTCUSDT",
        exchange: "binancefut",
        intent: "entry",
        inputs: { foo: "bar" },
        predictions: { rule: { accept: true, scale: 1, reasons: ["PASS"] } },
        composite: { accept: true, scale: 1, reason_trace: ["RULE:PASS"] },
      });
      assert.ok(res.ok);
      const record = res.record;
      assert.strictEqual(record.kind, "SIGNAL_DECIDER");
      assert.strictEqual(record.exchange, "BINANCEFUT");
      assert.strictEqual(record.symbol, "BTCUSDT");
      assert.strictEqual(record.intent, "ENTRY");
      assert.strictEqual(record.schema_version, 1);
      assert.ok(record.decision_id && record.decision_id.startsWith("DEC__"));
      assert.strictEqual(record.outcome, null);

      const recent = evidenceLedger.getRecentEvidence({ kind: "signal_decider", limit: 5 });
      assert.strictEqual(recent.length, 1);
      assert.strictEqual(recent[0].decision_id, record.decision_id);
    } finally { envRestore(prev); }
  }

  // -------- composeVotes invariants ---------------------------------
  {
    // Rule HARD block → composite rejects regardless of ML / narrative.
    const hardBlock = agent.composeVotes({
      ruleVote: { accept: false, reasons: ["OPENCLAW_EXECUTOR_SAME_SIDE_CLUSTER_BLOCK"] },
      mlVote: { accept: true, tp1_probability: 0.9, stubbed: false },
      narrativeVote: { disabled: false, response: { accept: true, scale: 1, confidence: 0.95 } },
    });
    assert.strictEqual(hardBlock.accept, false);
    assert.strictEqual(hardBlock.scale, 0);

    // Rule pass + narrative veto → composite rejects.
    const narrativeVeto = agent.composeVotes({
      ruleVote: { accept: true, qty_pct_final: 0.5, reasons: [], raw_reason: "OPENCLAW_EXECUTOR_OK" },
      mlVote: null,
      narrativeVote: { disabled: false, response: { accept: false, scale: 0, confidence: 0.8 } },
    });
    assert.strictEqual(narrativeVeto.accept, false);
    assert.ok(narrativeVeto.reason_trace.includes("NARRATIVE_VETO"));

    // Narrative scale reduction.
    const reduce = agent.composeVotes({
      ruleVote: { accept: true, qty_pct_final: 0.5, reasons: [], raw_reason: "OPENCLAW_EXECUTOR_OK" },
      mlVote: null,
      narrativeVote: {
        disabled: false,
        shadow_only: false,
        response: narrativeReasoner.clampResponse({ accept: true, scale: 0.4, confidence: 0.7 }),
      },
    });
    assert.strictEqual(reduce.accept, true);
    assert.ok(reduce.scale <= 0.4 + 1e-9 && reduce.scale >= agent.__test.SCALE_MIN);
    assert.ok(reduce.reason_trace.some((r) => r.startsWith("NARRATIVE_SCALE_REDUCE:")));

    // Narrative cannot amplify even if it slips past the clamp.
    const amplifyAttempt = agent.composeVotes({
      ruleVote: { accept: true, qty_pct_final: 0.5, reasons: [], raw_reason: "OPENCLAW_EXECUTOR_OK" },
      mlVote: null,
      narrativeVote: { disabled: false, response: { accept: true, scale: 1.8, confidence: 0.99 } },
    });
    assert.strictEqual(amplifyAttempt.accept, true);
    assert.ok(amplifyAttempt.scale <= agent.__test.SCALE_MAX);
  }

  // -------- decideOnSignal DEFAULT is pass-through ------------------
  {
    evidenceLedger.__test.resetLedgerForTest();
    const prev = envSnapshot(FLAG_KEYS);
    try {
      for (const k of FLAG_KEYS) delete process.env[k];
      const path = require.resolve("../services/openclawExecutionAuthority");
      const saved = require.cache[path];
      require.cache[path] = {
        ...saved,
        exports: {
          evaluateOpenClawExecutionAuthority: async () => ({
            ok: true,
            reason: "OPENCLAW_EXECUTOR_OK",
            qtyPctFinal: 0.5,
            featuresPatch: {},
          }),
        },
      };
      try {
        delete require.cache[require.resolve("../services/openclawDecisionAgent")];
        const fresh = require("../services/openclawDecisionAgent");
        const result = await fresh.decideOnSignal({
          exchange: "BINANCEFUT",
          symbol: "BTCUSDT",
          intent: "ENTRY",
          side: "BUY",
          qtyPct: 0.5,
          features: {},
          stage: "TEST",
        });
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.qtyPctFinal, 0.5);
        assert.strictEqual(result._agent_applied, false);
        assert.strictEqual(result._agent_shadow, false);
        assert.strictEqual(
          evidenceLedger.getRecentEvidence({ limit: 5 }).length,
          0,
          "defaults must not write evidence"
        );
      } finally {
        require.cache[path] = saved;
        delete require.cache[require.resolve("../services/openclawDecisionAgent")];
      }
    } finally { envRestore(prev); }
  }

  // -------- shadow mode: production path unchanged, evidence written -
  {
    evidenceLedger.__test.resetLedgerForTest();
    const prev = envSnapshot(FLAG_KEYS);
    try {
      process.env.OPENCLAW_AGENT_SHADOW_ENABLED = "1";
      delete process.env.OPENCLAW_AGENT_APPLY_ENABLED;
      delete process.env.OPENCLAW_AGENT_ENABLED;
      delete process.env.OPENCLAW_NARRATIVE_ENABLED;
      delete process.env.OPENCLAW_ML_GATE_ENABLED;
      const path = require.resolve("../services/openclawExecutionAuthority");
      const saved = require.cache[path];
      require.cache[path] = {
        ...saved,
        exports: {
          evaluateOpenClawExecutionAuthority: async () => ({
            ok: true,
            reason: "OPENCLAW_EXECUTOR_OK",
            qtyPctFinal: 0.5,
            featuresPatch: {},
          }),
        },
      };
      try {
        delete require.cache[require.resolve("../services/openclawDecisionAgent")];
        const fresh = require("../services/openclawDecisionAgent");
        const result = await fresh.decideOnSignal({
          exchange: "BINANCEFUT",
          symbol: "BTCUSDT",
          intent: "ENTRY",
          side: "BUY",
          qtyPct: 0.5,
          features: {},
          stage: "TEST",
        });
        assert.strictEqual(result._agent_applied, false,
          "shadow mode must NOT change production path");
        assert.strictEqual(result._agent_shadow, true);
        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.qtyPctFinal, 0.5);
        assert.ok(result._agent_decision_id && result._agent_decision_id.startsWith("DEC__"));
        assert.ok(result._agent_composite && typeof result._agent_composite === "object");

        const recent = evidenceLedger.getRecentEvidence({ kind: "SIGNAL_DECIDER", limit: 5 });
        assert.strictEqual(recent.length, 1);
        assert.strictEqual(recent[0].decision_id, result._agent_decision_id);
      } finally {
        require.cache[path] = saved;
        delete require.cache[require.resolve("../services/openclawDecisionAgent")];
      }
    } finally {
      envRestore(prev);
      evidenceLedger.__test.resetLedgerForTest();
    }
  }

  // -------- clampScale bounds ---------------------------------------
  {
    const min = agent.__test.SCALE_MIN;
    const max = agent.__test.SCALE_MAX;
    assert.strictEqual(agent.clampScale(0.0001), min);
    assert.strictEqual(agent.clampScale(5), max);
    assert.strictEqual(agent.clampScale(NaN), 1);
  }

  console.log("OPENCLAW_DECISION_AGENT_TEST_OK");
}

run().catch((err) => {
  console.error("OPENCLAW_DECISION_AGENT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
