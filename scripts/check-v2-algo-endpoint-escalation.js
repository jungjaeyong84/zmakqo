#!/usr/bin/env node
"use strict";

const {
  updateAlgoEndpointDegradationState,
  buildAlgoEndpointDegradationDocPath,
} = require("../src/v2/algoEndpointDegradationState");

function createMemoryFirestore() {
  const docs = new Map();
  let chain = Promise.resolve();
  function ref(path) {
    return {
      path,
      async get() {
        const data = docs.get(path);
        return { exists: data !== undefined, data: () => ({ ...(data || {}) }) };
      },
      async set(payload, options = {}) {
        const previous = options && options.merge === true ? (docs.get(path) || {}) : {};
        docs.set(path, { ...previous, ...payload });
      },
    };
  }
  return {
    docs,
    doc(path) {
      return ref(path);
    },
    collection(name) {
      return { doc: (id) => ref(`${name}/${id}`) };
    },
    runTransaction(fn) {
      const run = chain.then(async () => fn({
        async get(docRef) {
          const data = docs.get(docRef.path);
          return { exists: data !== undefined, data: () => ({ ...(data || {}) }) };
        },
        set(docRef, payload, options = {}) {
          const previous = options && options.merge === true ? (docs.get(docRef.path) || {}) : {};
          docs.set(docRef.path, { ...previous, ...payload });
        },
      }));
      chain = run.catch(() => {});
      return run;
    },
  };
}

async function evaluateAlgoEndpointEscalation({ env = process.env, symbol = "LINKUSDT" } = {}) {
  const blockers = [];
  const checks = [];
  const db = createMemoryFirestore();
  const baseMs = Date.parse("2026-04-26T00:00:00.000Z");
  const mergedEnv = {
    DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADATION_STATE_ENABLED: "1",
    DONBEOLJA_V2_ALGO_ENDPOINT_DEGRADED_CRIT_AFTER_MS: "600000",
    ...env,
  };

  const warn = await updateAlgoEndpointDegradationState({
    db,
    env: mergedEnv,
    symbol,
    endpointUnavailable: true,
    note: "ALGO_ENDPOINT_UNAVAILABLE",
    nowMs: () => baseMs,
  });
  const warnOk = warn.ok === true && warn.severity === "WARN" && warn.status === "DEGRADED";
  checks.push(Object.freeze({ id: "first_unavailable_warn", ok: warnOk }));
  if (!warnOk) blockers.push("ALGO_ENDPOINT_ESCALATION:FIRST_UNAVAILABLE_NOT_WARN");

  const crit = await updateAlgoEndpointDegradationState({
    db,
    env: mergedEnv,
    symbol,
    endpointUnavailable: true,
    note: "ALGO_ENDPOINT_UNAVAILABLE",
    nowMs: () => baseMs + 601000,
  });
  const critOk = crit.ok === true && crit.severity === "CRIT" && crit.escalated === true && crit.duration_ms >= 600000;
  checks.push(Object.freeze({ id: "persistent_unavailable_crit", ok: critOk }));
  if (!critOk) blockers.push("ALGO_ENDPOINT_ESCALATION:PERSISTENT_UNAVAILABLE_NOT_CRIT");

  const recovered = await updateAlgoEndpointDegradationState({
    db,
    env: mergedEnv,
    symbol,
    endpointUnavailable: false,
    nowMs: () => baseMs + 620000,
  });
  const recoveryOk = recovered.ok === true && recovered.status === "RECOVERED" && recovered.recovered === true;
  checks.push(Object.freeze({ id: "recovery_recorded", ok: recoveryOk }));
  if (!recoveryOk) blockers.push("ALGO_ENDPOINT_ESCALATION:RECOVERY_NOT_RECORDED");

  const docPath = buildAlgoEndpointDegradationDocPath({ exchange: "BINANCEFUT", symbol });
  const latest = db.docs.get(docPath) || {};
  const evidenceOk = latest.status === "RECOVERED" && latest.duration_ms >= 600000;
  checks.push(Object.freeze({ id: "evidence_persisted", ok: evidenceOk }));
  if (!evidenceOk) blockers.push("ALGO_ENDPOINT_ESCALATION:EVIDENCE_NOT_PERSISTED");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_ALGO_ENDPOINT_ESCALATION_PASS"
      : "V2_ALGO_ENDPOINT_ESCALATION_BLOCKED",
    blockers: Object.freeze(blockers),
    checks: Object.freeze(checks),
    doc_path: docPath,
    final_status: latest.status || null,
  });
}

async function main(env = process.env) {
  const result = await evaluateAlgoEndpointEscalation({ env });
  const out = JSON.stringify(result);
  if (result.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_ALGO_ENDPOINT_ESCALATION_THROWN",
      blockers: ["ALGO_ENDPOINT_ESCALATION:CHECK_THROWN"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = { main, evaluateAlgoEndpointEscalation, __test: { createMemoryFirestore } };
}
