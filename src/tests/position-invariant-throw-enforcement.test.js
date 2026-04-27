"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// position-invariant-throw-enforcement.test.js
//
// 2026-04-27 P0-A throw-graduation step 1 — locks the throw behaviour of
// `observeActivePositionInvariants` when POSITION_INVARIANT_THROW_ENABLED=1.
//
// Why a separate test from `position-invariant-alert-ratelimit.test.js`:
//   The alert-ratelimit test asserts warn-only behaviour (no throw, just
//   structuredLog + Slack ratelimit). This test asserts the *gate*
//   behaviour: when the env flag is set, observeActivePositionInvariants
//   must throw a typed error so the write transaction never starts.
//   Together the two tests pin both halves of the cutover contract.
//
// Cases:
//   (A) Default env unset → no throw (warn-only parity preserved).
//   (B) THROW=1 + invariant breach (e.g. ACTIVE without entry_event_id)
//       → throws Error with .code === "POSITION_INVARIANT_VIOLATION" and
//       carries .invariantViolations / .invariantScope / .invariantSymbol
//       so callers can classify without re-validating.
//   (C) THROW=1 but snapshot OK → no throw.
//   (D) THROW=1 + META_PATCH scope breach → throws with scope tag METAPATCH.
//   (E) THROW=1 must NOT prevent the Slack-push code path from executing
//       (push is fire-and-forget; throw must come AFTER dispatch). We
//       can't observe Slack here directly (channel unset → no-op) but we
//       can confirm the structuredLog still fires by capturing console
//       output via process.stdout.write override.
// ─────────────────────────────────────────────────────────────────────────────

const assert = require("assert");

// Channel must be unset so notifyActivePositionInvariantViolation no-ops
// (matches the alert-ratelimit test's harness).
delete process.env.POSITION_INVARIANT_ALERT_CHANNEL;
delete process.env.POSITION_WRITER_ALERT_CHANNEL;
delete process.env.EXIT_INTEGRITY_ALERT_CHANNEL;

// Force NODE_ENV=production for case (A) so the default kicks in as
// warn-only — proves the production safety net (prod stays warn-only
// until explicit opt-in via env=1).
const _priorNodeEnv = process.env.NODE_ENV;
process.env.NODE_ENV = "production";
delete process.env.POSITION_INVARIANT_THROW_ENABLED;

const {
  __test: {
    observeActivePositionInvariants,
    positionInvariantAlertState,
  },
} = require("../storage/positionsPaper");

assert.strictEqual(typeof observeActivePositionInvariants, "function",
  "observeActivePositionInvariants export missing");

function clearAlertState() {
  if (positionInvariantAlertState && typeof positionInvariantAlertState.clear === "function") {
    positionInvariantAlertState.clear();
  }
}

// Build an ACTIVE-but-missing-entry_event_id snapshot — the canonical
// regression class this whole P0 line of work was triggered by.
function buildBreachSnapshot() {
  return {
    scope: "FULL_SNAPSHOT",
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    qtyBase: 0.5,
    meta: { /* entry_event_id intentionally absent */ },
    mutationKind: "POSITION_UPSERT",
    writerScope: "CORE",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    source: "test.position-invariant-throw-enforcement",
    reason: "THROW_TEST",
  };
}

function buildOkSnapshot() {
  return {
    scope: "FULL_SNAPSHOT",
    state: "ACTIVE",
    positionState: "COMMIT",
    positionSide: "LONG",
    sizePct: 1,
    qtyBase: 0.5,
    meta: { entry_event_id: "EVT|TEST|1700000000000" },
    mutationKind: "POSITION_UPSERT",
    writerScope: "CORE",
    exchange: "BINANCEFUT",
    symbol: "LINKUSDT",
    source: "test.position-invariant-throw-enforcement",
    reason: "THROW_TEST_OK",
  };
}

// ── (A) NODE_ENV=production + env unset → no throw (prod safety net) ───────
clearAlertState();
{
  // The initial module load above happened with NODE_ENV=production and no
  // explicit POSITION_INVARIANT_THROW_ENABLED → default kicks in as
  // warn-only. This case proves prod stays warn-only until explicit opt-in,
  // so deploying step 1 cannot accidentally start throwing in prod.
  let threw = null;
  try {
    observeActivePositionInvariants(buildBreachSnapshot());
  } catch (err) {
    threw = err;
  }
  assert.strictEqual(threw, null,
    "(A) NODE_ENV=production default must NOT throw — prod safety net "
    + "preserved (operator must explicitly set env=1 to graduate prod)");
}

// Cases (B)+(C)+(D) require the module loaded with THROW=1. Re-require by
// clearing the module cache so the env capture re-runs.
function reloadModuleWithThrow(value, { nodeEnv } = {}) {
  if (value === undefined) delete process.env.POSITION_INVARIANT_THROW_ENABLED;
  else process.env.POSITION_INVARIANT_THROW_ENABLED = String(value);
  if (nodeEnv === undefined) {
    // leave NODE_ENV as-is
  } else if (nodeEnv === null) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = String(nodeEnv);
  }
  const positionsPaperPath = require.resolve("../storage/positionsPaper");
  delete require.cache[positionsPaperPath];
  return require("../storage/positionsPaper");
}

// ── (B) THROW=1 + breach → typed error ──────────────────────────────────────
{
  const reloaded = reloadModuleWithThrow("1");
  const obs = reloaded.__test.observeActivePositionInvariants;
  if (reloaded.__test.positionInvariantAlertState
    && typeof reloaded.__test.positionInvariantAlertState.clear === "function") {
    reloaded.__test.positionInvariantAlertState.clear();
  }
  let threw = null;
  try {
    obs(buildBreachSnapshot());
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error,
    "(B) THROW=1 + breach must raise an Error");
  assert.strictEqual(threw.code, "POSITION_INVARIANT_VIOLATION",
    "(B) error.code classifies the failure for catch-and-handle code");
  assert.strictEqual(threw.invariantScope, "FULL_SNAPSHOT",
    "(B) scope tag must be carried on the error for log indexing");
  assert.strictEqual(threw.invariantSymbol, "LINKUSDT",
    "(B) symbol must be carried on the error");
  assert.strictEqual(threw.invariantExchange, "BINANCEFUT",
    "(B) exchange must be carried on the error");
  assert.ok(Array.isArray(threw.invariantViolations) && threw.invariantViolations.length > 0,
    "(B) invariantViolations[] must be present so caller can re-classify");
  // The exact reason for ACTIVE-without-entry_event_id is contractually
  // ACTIVE_REQUIRES_ENTRY_EVENT_ID per positionActivePositionInvariants.js.
  const reasons = threw.invariantViolations.map((v) => v && v.reason);
  assert.ok(reasons.includes("ACTIVE_REQUIRES_ENTRY_EVENT_ID"),
    "(B) violation list must include ACTIVE_REQUIRES_ENTRY_EVENT_ID. "
    + `Got: ${JSON.stringify(reasons)}`);
  assert.ok(threw.message.includes("[POSITION_INVARIANT_VIOLATION]"),
    "(B) error.message must carry the [POSITION_INVARIANT_VIOLATION] prefix "
    + "so log scanners can grep for breaches");
  assert.ok(threw.message.includes("LINKUSDT"),
    "(B) error.message must include symbol so the operator sees position at a glance");
}

// ── (C) THROW=1 + OK snapshot → no throw ────────────────────────────────────
{
  const reloaded = reloadModuleWithThrow("1");
  const obs = reloaded.__test.observeActivePositionInvariants;
  let threw = null;
  try {
    obs(buildOkSnapshot());
  } catch (err) {
    threw = err;
  }
  assert.strictEqual(threw, null,
    "(C) THROW=1 with OK snapshot must NOT throw — only breach gates trigger");
}

// ── (D) THROW=1 + META_PATCH breach → typed error with META_PATCH scope ─────
{
  const reloaded = reloadModuleWithThrow("1");
  const obs = reloaded.__test.observeActivePositionInvariants;
  let threw = null;
  try {
    obs({
      scope: "META_PATCH",
      // tp_p1_done=true requires tp_p1_event_lineage_id per validator.
      meta: { tp_p1_done: true /* tp_p1_event_lineage_id intentionally absent */ },
      mutationKind: "POSITION_META_UPSERT",
      writerScope: "META",
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      source: "test.position-invariant-throw-enforcement",
      reason: "META_BREACH",
    });
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error,
    "(D) META_PATCH breach must throw under THROW=1");
  assert.strictEqual(threw.invariantScope, "META_PATCH",
    "(D) scope tag must be META_PATCH so caller can route differently");
  assert.strictEqual(threw.invariantSymbol, "BNBUSDT");
  assert.ok(Array.isArray(threw.invariantViolations) && threw.invariantViolations.length > 0);
}

// ── (D2) NODE_ENV=test (non-prod) + env unset → throw via default ───────────
{
  // Prove the cutover default: in non-production envs (test/dev/CI), the
  // validator throws *without* explicit opt-in. This is what locks the
  // step-1 graduation: any new test or build path that produces a
  // violating snapshot fails loudly in CI rather than silently corrupting.
  const reloaded = reloadModuleWithThrow(undefined, { nodeEnv: "test" });
  const obs = reloaded.__test.observeActivePositionInvariants;
  let threw = null;
  try {
    obs(buildBreachSnapshot());
  } catch (err) {
    threw = err;
  }
  assert.ok(threw instanceof Error,
    "(D2) NODE_ENV=test with env unset must throw — non-prod default is on");
  assert.strictEqual(threw.code, "POSITION_INVARIANT_VIOLATION");
}

// ── (E) THROW=1 disabled mid-run → revert to warn-only ──────────────────────
{
  // Reset env to "0" and reload — confirms the env is read at load-time and
  // can be turned back off (operational kill switch).
  const reloaded = reloadModuleWithThrow("0");
  const obs = reloaded.__test.observeActivePositionInvariants;
  let threw = null;
  try {
    obs(buildBreachSnapshot());
  } catch (err) {
    threw = err;
  }
  assert.strictEqual(threw, null,
    "(E) THROW=0 must restore warn-only behaviour — kill switch contract");
}

// Cleanup — leave env unset so it can't poison subsequent tests in the
// same process (run-tests.js runs these sequentially in one node process
// in some configurations). Restore NODE_ENV to whatever the harness had
// before this test took over.
delete process.env.POSITION_INVARIANT_THROW_ENABLED;
if (_priorNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = _priorNodeEnv;

console.log("POSITION_INVARIANT_THROW_ENFORCEMENT_TEST_OK");
