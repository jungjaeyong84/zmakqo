"use strict";

// 2026-04-27 Stage C — productionEntryRoute 가 leverage 후보를 어디서
// 추출하는지 single source of truth 로 굳힌다. caller chain (entryIntent →
// openclawDecision.canonical_evidence_summary → signalIntent → env) 우선순위가
// 깨지면 Stage D 의 prod env flip 시점에 SL/TP1 가격이 raw vs normalized
// 사이를 silently 오갈 수 있어 회귀 위험.
//
// 안전 계약:
//   - 모든 후보 비면 null (protectionModel 은 silent → raw mode).
//   - Number(...) > 0 만 받는다 (NaN/0/음수 → skip).

const assert = require("assert");

const path = require.resolve("../v2/productionEntryRoute");
delete require.cache[path];
const { resolveProductionEntryLeverage } = require("../v2/productionEntryRoute");

// (A) 모든 후보 비어있음 → null.
{
  assert.strictEqual(resolveProductionEntryLeverage({}), null, "(A) 모든 입력 비면 null");
  assert.strictEqual(
    resolveProductionEntryLeverage({ entryIntent: {}, bundle: {}, env: {} }),
    null,
    "(A) 빈 객체도 null"
  );
}

// (B) entryIntent.leverage 우선 (가장 높은 우선순위).
{
  const lev = resolveProductionEntryLeverage({
    entryIntent: { leverage: 3 },
    bundle: { openclawDecision: { leverage: 5 }, signalIntent: { leverage: 7 } },
    env: { V2_FUTURES_DEFAULT_LEVERAGE: "9" },
  });
  assert.strictEqual(lev, 3, "(B) entryIntent.leverage 가 최우선");
}

// (C) entryIntent.futures_leverage 도 동일 슬롯에서 인식.
{
  const lev = resolveProductionEntryLeverage({
    entryIntent: { futures_leverage: 2 },
    bundle: { openclawDecision: { leverage: 5 } },
  });
  assert.strictEqual(lev, 2, "(C) futures_leverage alias");
}

// (D) entryIntent 비면 openclawDecision.leverage.
{
  const lev = resolveProductionEntryLeverage({
    entryIntent: {},
    bundle: { openclawDecision: { leverage: 4 } },
  });
  assert.strictEqual(lev, 4, "(D) openclawDecision.leverage fallback");
}

// (E) openclawDecision.canonical_evidence_summary.leverage.
{
  const lev = resolveProductionEntryLeverage({
    bundle: {
      openclawDecision: {
        canonical_evidence_summary: { leverage: 6 },
      },
    },
  });
  assert.strictEqual(lev, 6, "(E) canonical_evidence_summary.leverage fallback");
}

// (F) signalIntent.leverage fallback.
{
  const lev = resolveProductionEntryLeverage({
    bundle: { signalIntent: { leverage: 2 } },
  });
  assert.strictEqual(lev, 2, "(F) signalIntent.leverage fallback");
}

// (G) env V2_FUTURES_DEFAULT_LEVERAGE fallback.
{
  const lev = resolveProductionEntryLeverage({
    env: { V2_FUTURES_DEFAULT_LEVERAGE: "2" },
  });
  assert.strictEqual(lev, 2, "(G) env V2_FUTURES_DEFAULT_LEVERAGE fallback");
}

// (H) env DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE alias.
{
  const lev = resolveProductionEntryLeverage({
    env: { DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE: "3" },
  });
  assert.strictEqual(lev, 3, "(H) DONBEOLJA_ alias");
}

// (I) 0 / 음수 / NaN / 빈 문자열 → skip 후 다음 후보로.
{
  const lev = resolveProductionEntryLeverage({
    entryIntent: { leverage: 0 },
    bundle: { openclawDecision: { leverage: -1 }, signalIntent: { leverage: "" } },
    env: { V2_FUTURES_DEFAULT_LEVERAGE: "abc" },
  });
  assert.strictEqual(lev, null, "(I) 잘못된 값들 모두 skip → null");

  const lev2 = resolveProductionEntryLeverage({
    entryIntent: { leverage: 0 },
    bundle: { openclawDecision: { leverage: -1 } },
    env: { V2_FUTURES_DEFAULT_LEVERAGE: "5" },
  });
  assert.strictEqual(lev2, 5, "(I) skip 후 env 후보 적중");
}

// (J) string number 도 인식.
{
  const lev = resolveProductionEntryLeverage({
    entryIntent: { leverage: "2" },
  });
  assert.strictEqual(lev, 2, "(J) string '2' → 2");
}

// (K) integration: runV2ProductionEntryRoute 가 leverage 를 kernel 로 전달하는지
//     mock kernel 로 검증 (entry path entire propagation).
{
  const path2 = require.resolve("../v2/productionEntryRoute");
  delete require.cache[path2];
  const { runV2ProductionEntryRoute } = require("../v2/productionEntryRoute");

  const captured = { kernelArgs: null };
  const fakeKernel = async (args) => {
    captured.kernelArgs = args;
    return Object.freeze({
      ok: false,
      reason: "TEST_KERNEL_STUB",
      submitterResult: null,
      kernelAudit: null,
    });
  };
  const fakeFinalize = async () => Object.freeze({ ok: true, reason: "STUB_FINALIZED" });
  const fakeClaim = async () => Object.freeze({
    ok: true, claimed: true, replay: false, reason: "STUB_CLAIMED",
    openclaw_execution_claim_id: "STUB_CLAIM",
    openclaw_execution_permit_id: "STUB_PERMIT",
  });
  const fakeFindBundle = async () => Object.freeze({
    ok: true, replay: false, reason: "STUB_NOT_FOUND",
    openclaw_decision_bundle_hash: "HASH",
    existing_execution_audit: null,
  });
  const fakeValidate = () => Object.freeze({ ok: true, reason: "STUB_VALIDATED" });
  const fakeFindRecent = async () => Object.freeze({ ok: true, rows: [], context: { symbol: "BTCUSDT" } });
  const fakeCooldown = () => Object.freeze({ ok: true, reason: "STUB_NO_COOLDOWN" });
  const fakeAudit = async () => Object.freeze({ ok: true, reason: "STUB_AUDIT_OK" });

  const fakeRouter = (b) => Object.freeze({
    ok: true,
    reason: "STUB_ROUTED",
    entryIntent: {
      entry_intent_id: "EI__TEST",
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
      V2_FUTURES_DEFAULT_LEVERAGE: "2",
    },
    bundle: {
      openclawDecision: {
        openclaw_decision_id: "OD__TEST",
        openclaw_decision_bundle_hash: "HASH",
        canonical_evidence_summary: { signal_criteria: {}, ml_ai_signal_proposal: {} },
      },
      signalIntent: { signal_intent_id: "SI__TEST", symbol: "BTCUSDT", side: "LONG" },
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
    assert.ok(captured.kernelArgs, "(K) runEntryKernel 이 호출되어야 함");
    assert.strictEqual(
      captured.kernelArgs.leverage,
      2,
      "(K) runEntryKernel 이 resolveProductionEntryLeverage 결과를 받음"
    );
    console.log("V2_PRODUCTION_ENTRY_LEVERAGE_RESOLVE_TEST_OK");
  }).catch((err) => {
    console.error("(K) integration test failed:", err);
    process.exitCode = 1;
    throw err;
  });
}
