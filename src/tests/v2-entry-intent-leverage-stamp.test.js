"use strict";

// 2026-04-27 Stage J — surveillance (Stage F) caught CANARY entry intents
// flowing without any leverage value. Production entry route's
// resolveProductionEntryLeverage relied on env fallback which (a) wasn't
// set in prod and (b) hid caller-chain breakage from analysts. Now
// resolveEntryIntentFromOpenClaw stamps `leverage` + `futures_leverage`
// onto the entry intent itself from signal_intent / openclaw_decision /
// canonical_evidence_summary / signal_criteria, so the missing-leverage
// surveillance fires only when EVERY upstream slot is empty.
//
// 안전 계약:
//   - 위 4개 source 어디든 leverage>0 이 있으면 그 값을 stamp.
//   - 우선순위: signal_intent → openclaw_decision → evidence → signal_criteria.
//   - 후보 모두 비어있으면 entryIntent.leverage = null 유지 (stage F 가 잡음).
//   - signalIntent.futures_leverage / decision.futures_leverage alias 도 인식.

const assert = require("assert");

const path = require.resolve("../v2/signalAuthorityRouter");
delete require.cache[path];
const { resolveEntryIntentLeverage } = require("../v2/signalAuthorityRouter");

// (A) 모든 source 비어있음 → null.
{
  assert.strictEqual(resolveEntryIntentLeverage({}), null, "(A) empty");
  assert.strictEqual(
    resolveEntryIntentLeverage({ signalIntent: {}, openclawDecision: {} }),
    null,
    "(A) empty objects"
  );
}

// (B) signalIntent.leverage 우선.
{
  const lev = resolveEntryIntentLeverage({
    signalIntent: { leverage: 3 },
    openclawDecision: { leverage: 5, canonical_evidence_summary: { leverage: 7 } },
  });
  assert.strictEqual(lev, 3, "(B) signalIntent.leverage 최우선");
}

// (C) signalIntent.futures_leverage alias.
{
  const lev = resolveEntryIntentLeverage({
    signalIntent: { futures_leverage: 2 },
    openclawDecision: { leverage: 5 },
  });
  assert.strictEqual(lev, 2, "(C) signalIntent.futures_leverage alias");
}

// (D) decision.leverage fallback.
{
  const lev = resolveEntryIntentLeverage({
    signalIntent: {},
    openclawDecision: { leverage: 4 },
  });
  assert.strictEqual(lev, 4, "(D) openclawDecision.leverage fallback");
}

// (E) canonical_evidence_summary.leverage fallback.
{
  const lev = resolveEntryIntentLeverage({
    openclawDecision: { canonical_evidence_summary: { leverage: 6 } },
  });
  assert.strictEqual(lev, 6, "(E) evidence.leverage");
}

// (F) signal_criteria.leverage 가장 깊은 fallback.
{
  const lev = resolveEntryIntentLeverage({
    openclawDecision: {
      canonical_evidence_summary: { signal_criteria: { leverage: 5 } },
    },
  });
  assert.strictEqual(lev, 5, "(F) signal_criteria.leverage");
}

// (G) 0 / 음수 / NaN / 빈 문자열 → 다음 candidate 로 skip.
{
  const lev = resolveEntryIntentLeverage({
    signalIntent: { leverage: 0, futures_leverage: -1 },
    openclawDecision: {
      leverage: "",
      futures_leverage: "abc",
      canonical_evidence_summary: { leverage: 2 },
    },
  });
  assert.strictEqual(lev, 2, "(G) skip 후 evidence 적중");
}

// (H) string number 도 인식.
{
  const lev = resolveEntryIntentLeverage({
    signalIntent: { leverage: "3" },
  });
  assert.strictEqual(lev, 3, "(H) string '3' → 3");
}

// (I) integration — minimal hand-rolled bundle to exercise the stamp.
//     (Using existing fixtures pulls a heavier graph; this isolates the
//      leverage-stamp behaviour cleanly.)
{
  const path2 = require.resolve("../v2/signalAuthorityRouter");
  delete require.cache[path2];
  const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");

  function buildBundle({ signalLeverage = null, decisionLeverage = null } = {}) {
    const signalIntent = {
      signal_intent_id: "SIGINTV2__SERVER_NATIVE__SOLUSDT__LONG__abcd1234",
      signal_source_mode: "SERVER_NATIVE",
      signal_lineage_id: "LINEAGE__SOL__J",
      symbol: "SOLUSDT",
      side: "LONG",
      quality_score: 0.77,
      decision_status: "APPROVED",
      budget_check_result: "PASS",
      min_order_check_result: "PASS",
    };
    if (signalLeverage !== null) signalIntent.leverage = signalLeverage;
    const openclawDecision = {
      openclaw_decision_id: "OCDV2__CANARY__APPROVE_ENTRY__abcd1234",
      signal_intent_id: signalIntent.signal_intent_id,
      decision_mode: "CANARY",
      recommended_action: "APPROVE_ENTRY",
      approved: true,
      policy_scope: "SOL_15M",
      strategy_filter_name: "HTF_DIRECTION_ALIGNMENT",
      strategy_filter_verdict: "PASS",
      strategy_filter_reason: "HTF_DIRECTION_ALIGNED",
      strategy_filter_result: {
        filter_name: "HTF_DIRECTION_ALIGNMENT",
        verdict: "PASS",
        reason: "HTF_DIRECTION_ALIGNED",
      },
      canonical_evidence_summary: {
        signal_criteria: {
          criteria_profile: "DEFAULT",
          entry_grade: "A",
          trigger_type: "BREAKOUT",
          setup_gate: { ok: true, reason: "OK" },
          trigger_gate: { ok: true, reason: "OK" },
        },
        market_data_quality: {
          ok: true,
          reason: "V2_MARKET_DATA_QUALITY_PASS",
          blockers: [],
          metrics: { symbol: "SOLUSDT", spread_bps: 2 },
        },
        ml_ai_signal_proposal: { proposal_verdict: "APPROVE", quality_score: 0.77 },
      },
    };
    if (decisionLeverage !== null) openclawDecision.leverage = decisionLeverage;
    return { signalIntent, openclawDecision };
  }

  // (I-1) 모든 source 비면 entryIntent.leverage = null.
  const routed1 = resolveEntryIntentFromOpenClaw(buildBundle());
  assert.strictEqual(routed1.ok, true, "(I-1) ok");
  assert.strictEqual(routed1.entryIntent.leverage, null, "(I-1) leverage=null");
  assert.strictEqual(routed1.entryIntent.futures_leverage, null);

  // (I-2) signalIntent.leverage stamp.
  const routed2 = resolveEntryIntentFromOpenClaw(buildBundle({ signalLeverage: 2 }));
  assert.strictEqual(routed2.ok, true, "(I-2) ok");
  assert.strictEqual(routed2.entryIntent.leverage, 2, "(I-2) leverage=2");
  assert.strictEqual(routed2.entryIntent.futures_leverage, 2);

  // (I-3) decision.leverage fallback.
  const routed3 = resolveEntryIntentFromOpenClaw(buildBundle({ decisionLeverage: 4 }));
  assert.strictEqual(routed3.entryIntent.leverage, 4, "(I-3) decision fallback");
}

console.log("V2_ENTRY_INTENT_LEVERAGE_STAMP_TEST_OK");
