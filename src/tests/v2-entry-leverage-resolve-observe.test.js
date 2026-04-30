"use strict";

// 2026-04-27 Stage F — V2 production entry 가 caller chain 에서 leverage 를
// 흘렸는지 매 entry 시점 1회 surveillance. Stage A~D 직후 prod 에 leverage
// 가 silent 로 빠지는 회귀 (e.g. openclaw schema 변경, signalAuthorityRouter
// 단계 누락) 를 즉시 1줄 warn 으로 노출.
//
// 안전 계약:
//   - resolved>1 → silent (정상 path).
//   - resolved===null 또는 resolved<=1 → mode=MISSING|LEVERAGE_LE_ONE 1회 warn.
//   - `V2_ENTRY_LEVERAGE_RESOLVE_OBSERVE=0` env kill switch.
//   - 후보 값 자체는 노출 안 함 (어떤 슬롯이 채워져 있었는지만 boolean).

const assert = require("assert");

function reload() {
  const path = require.resolve("../v2/productionEntryRoute");
  delete require.cache[path];
  return require("../v2/productionEntryRoute");
}

// (A) resolved>1 → silent (정상).
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  const ret = observeProductionEntryLeverageResolve({
    resolved: 2,
    entryIntent: { entry_intent_id: "EI__A", symbol: "BTCUSDT", side: "LONG" },
    bundle: { openclawDecision: { openclaw_decision_id: "OD__A" } },
    env: {},
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(ret, null, "(A) resolved>1 → null 반환");
  assert.strictEqual(captured.length, 0, "(A) emit 0회");
}

// (B) resolved===null → mode=MISSING 1회 emit.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: null,
    entryIntent: { entry_intent_id: "EI__B", symbol: "ETHUSDT", side: "LONG" },
    bundle: { openclawDecision: { openclaw_decision_id: "OD__B" } },
    env: {},
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    side: "LONG",
    entryIntentId: "EI__B",
    openclawDecisionId: "OD__B",
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1, "(B) emit 1회");
  const ev = captured[0];
  assert.strictEqual(ev.event, "v2_entry_leverage_missing");
  assert.strictEqual(ev.mode, "MISSING");
  assert.strictEqual(ev.resolved, null);
  assert.strictEqual(ev.exchange, "BINANCEFUT");
  assert.strictEqual(ev.symbol, "ETHUSDT");
  assert.strictEqual(ev.side, "LONG");
  assert.strictEqual(ev.entry_intent_id, "EI__B");
  assert.strictEqual(ev.openclaw_decision_id, "OD__B");
  assert.strictEqual(ev.candidate_presence.entry_intent, false);
  assert.strictEqual(ev.candidate_presence.openclaw_decision, false);
  assert.strictEqual(ev.candidate_presence.canonical_evidence, false);
  assert.strictEqual(ev.candidate_presence.signal_intent, false);
  assert.strictEqual(ev.candidate_presence.env_v2_futures_default, false);
  assert.strictEqual(ev.candidate_presence.env_donbeolja_v2_futures_default, false);
  assert.ok(typeof ev.observed_at === "string" && ev.observed_at.length > 0);
}

// (C) resolved===1 → mode=LEVERAGE_LE_ONE.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: 1,
    entryIntent: { leverage: 1 },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1, "(C) leverage=1 도 emit");
  assert.strictEqual(captured[0].mode, "LEVERAGE_LE_ONE");
  assert.strictEqual(captured[0].resolved, 1);
  assert.strictEqual(captured[0].candidate_presence.entry_intent, true, "(C) entry_intent slot present");
}

// (D) resolved===0 → mode=MISSING (Number.isFinite && >0 아님).
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: 0,
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].mode, "MISSING", "(D) 0 은 MISSING");
}

// (E) candidate_presence — openclaw_decision.leverage=2 인데 resolver 가 다른 이유로 null
//     리턴한 시나리오 (e.g. caller chain bug). 슬롯 present 가 표시.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: null,
    bundle: {
      openclawDecision: {
        leverage: 2,
        canonical_evidence_summary: { leverage: 2 },
      },
      signalIntent: { leverage: 2 },
    },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].candidate_presence.openclaw_decision, true);
  assert.strictEqual(captured[0].candidate_presence.canonical_evidence, true);
  assert.strictEqual(captured[0].candidate_presence.signal_intent, true);
  assert.strictEqual(captured[0].candidate_presence.entry_intent, false);
}

// (F) env candidate — V2_FUTURES_DEFAULT_LEVERAGE present 만 표시.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: null,
    env: { V2_FUTURES_DEFAULT_LEVERAGE: "2" },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1);
  assert.strictEqual(captured[0].candidate_presence.env_v2_futures_default, true);
  assert.strictEqual(captured[0].candidate_presence.env_donbeolja_v2_futures_default, false);
}

// (G) env candidate — DONBEOLJA_ alias 도 표시.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: null,
    env: { DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE: "3" },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured[0].candidate_presence.env_v2_futures_default, false);
  assert.strictEqual(captured[0].candidate_presence.env_donbeolja_v2_futures_default, true);
}

// (H) kill switch — V2_ENTRY_LEVERAGE_RESOLVE_OBSERVE=0 → emit 0회.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  const ret = observeProductionEntryLeverageResolve({
    resolved: null,
    env: { V2_ENTRY_LEVERAGE_RESOLVE_OBSERVE: "0" },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(ret, null);
  assert.strictEqual(captured.length, 0, "(H) kill switch 동작");
}

// (I) kill switch — true / on / yes 도 인식 후 default-on 유지.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  observeProductionEntryLeverageResolve({
    resolved: null,
    env: { V2_ENTRY_LEVERAGE_RESOLVE_OBSERVE: "on" },
    emit: (p) => captured.push(p),
  });
  assert.strictEqual(captured.length, 1, "(I) on/true → emit 정상");
}

// (J) NaN, 빈 문자열, 음수 — 모두 MISSING (Number.isFinite&&>0 아님).
{
  const { observeProductionEntryLeverageResolve } = reload();
  const captured = [];
  for (const r of [NaN, "", -1, "abc"]) {
    observeProductionEntryLeverageResolve({ resolved: r, emit: (p) => captured.push(p) });
  }
  assert.strictEqual(captured.length, 4);
  for (const ev of captured) {
    assert.ok(ev.mode === "MISSING" || ev.mode === "LEVERAGE_LE_ONE");
  }
}

// (K) emit 미제공 시 throw 안 함 (default console.warn 으로 fallback).
{
  const { observeProductionEntryLeverageResolve } = reload();
  const origWarn = console.warn;
  const captured = [];
  console.warn = (...args) => { captured.push(args.join(" ")); };
  try {
    observeProductionEntryLeverageResolve({ resolved: null });
  } finally {
    console.warn = origWarn;
  }
  assert.strictEqual(captured.length, 1, "(K) default emit 1회");
  const parsed = JSON.parse(captured[0]);
  assert.strictEqual(parsed.event, "v2_entry_leverage_missing");
}

// (K2) emit 이 throw 해도 entry path 깨지지 않음 — surveillance 는 best-effort.
{
  const { observeProductionEntryLeverageResolve } = reload();
  const ret = observeProductionEntryLeverageResolve({
    resolved: null,
    emit: () => { throw new Error("emit blew up"); },
  });
  // Should not throw; payload still returned for inspection.
  assert.ok(ret && ret.event === "v2_entry_leverage_missing", "(K2) emit throw 무시, payload 정상 반환");
}

// (L) production resolver — runtime env default is authoritative over stale
// upstream leverage hints. This prevents old signal/openclaw payloads with
// leverage=2 from overriding the deployed V2_FUTURES_DEFAULT_LEVERAGE=3
// discovery contract.
{
  const { __test } = reload();
  const resolved = __test.resolveProductionEntryLeverage({
    entryIntent: { leverage: 2, futures_leverage: 2 },
    bundle: {
      openclawDecision: {
        leverage: 2,
        futures_leverage: 2,
        canonical_evidence_summary: { leverage: 2, futures_leverage: 2 },
      },
      signalIntent: { leverage: 2, futures_leverage: 2 },
    },
    env: {
      V2_FUTURES_DEFAULT_LEVERAGE: "3",
      DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "3",
    },
  });
  assert.strictEqual(resolved, 3, "(L) env default 3 overrides stale upstream 2");
}

// (M) production resolver — env default is still capped by the account max.
{
  const { __test } = reload();
  const resolved = __test.resolveProductionEntryLeverage({
    entryIntent: { leverage: 5 },
    env: {
      V2_FUTURES_DEFAULT_LEVERAGE: "5",
      DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "3",
    },
  });
  assert.strictEqual(resolved, 3, "(M) max account leverage caps env default");
}

// (N) integration — runV2ProductionEntryRoute 가 leverage 누락 시 missing emit.
{
  const path = require.resolve("../v2/productionEntryRoute");
  delete require.cache[path];
  const { runV2ProductionEntryRoute } = require(path);
  const captured = [];
  const origWarn = console.warn;
  console.warn = (...args) => { captured.push(args.join(" ")); };

  const fakeKernel = async () => Object.freeze({
    ok: false, reason: "STUB", submitterResult: null, kernelAudit: null,
  });
  const fakeFinalize = async () => Object.freeze({ ok: true, reason: "STUB" });
  const fakeClaim = async () => Object.freeze({
    ok: true, claimed: true, replay: false, reason: "STUB",
    openclaw_execution_claim_id: "STUB_CLAIM",
    openclaw_execution_permit_id: "STUB_PERMIT",
  });
  const fakeFindBundle = async () => Object.freeze({
    ok: true, replay: false, reason: "STUB", openclaw_decision_bundle_hash: "HASH",
    existing_execution_audit: null,
  });
  const fakeValidate = () => Object.freeze({ ok: true, reason: "STUB" });
  const fakeFindRecent = async () => Object.freeze({ ok: true, rows: [], context: { symbol: "BTCUSDT" } });
  const fakeCooldown = () => Object.freeze({ ok: true, reason: "STUB" });
  const fakeAudit = async () => Object.freeze({ ok: true, reason: "STUB" });
  const fakeRouter = () => Object.freeze({
    ok: true, reason: "STUB",
    entryIntent: {
      entry_intent_id: "EI__L",
      symbol: "BTCUSDT",
      side: "LONG",
      decision_mode: "PAPER",
    },
  });

  return runV2ProductionEntryRoute({
    db: null,
    env: {
      DONBEOLJA_V2_ENABLED: "1",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_CANARY_ONLY: "0",
      // V2_FUTURES_DEFAULT_LEVERAGE 의도적으로 누락 → missing emit 트리거.
    },
    bundle: {
      openclawDecision: {
        openclaw_decision_id: "OD__L",
        openclaw_decision_bundle_hash: "HASH",
        canonical_evidence_summary: { signal_criteria: {}, ml_ai_signal_proposal: {} },
      },
      signalIntent: { signal_intent_id: "SI__L", symbol: "BTCUSDT", side: "LONG" },
      signalCriteria: { setup_gate: {}, trigger_gate: {} },
      featureSnapshot: { feature_values: {}, snapshot_at: new Date().toISOString() },
      mlAiSignalProposal: { symbol: "BTCUSDT", side: "LONG" },
    },
    entryTransport: {},
    protectionTransports: {},
    executionPermit: { openclaw_execution_permit_id: "PERMIT" },
    worldState: { world_state_hash: "WS_HASH" },
    routeEntryIntentFromOpenClaw: fakeRouter,
    runEntryKernel: fakeKernel,
    persistExecutionAudit: fakeAudit,
    validateExecutionPermit: fakeValidate,
    findExistingBundleExecution: fakeFindBundle,
    claimExecution: fakeClaim,
    finalizeExecutionClaim: fakeFinalize,
    findRecentSameDirectionExecutionsFn: fakeFindRecent,
    evaluateSameDirectionCooldown: fakeCooldown,
  }).then(() => {
    console.warn = origWarn;
    const matched = captured
      .map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter((row) => row && row.event === "v2_entry_leverage_missing");
    assert.strictEqual(matched.length, 1, "(N) leverage 누락 → 1회 emit");
    assert.strictEqual(matched[0].symbol, "BTCUSDT");
    assert.strictEqual(matched[0].side, "LONG");
    assert.strictEqual(matched[0].entry_intent_id, "EI__L");
    assert.strictEqual(matched[0].openclaw_decision_id, "OD__L");
    console.log("V2_ENTRY_LEVERAGE_RESOLVE_OBSERVE_TEST_OK");
  }).catch((err) => {
    console.warn = origWarn;
    console.error("(N) integration failed:", err);
    process.exitCode = 1;
    throw err;
  });
}
