"use strict";

// P3-08 / P3-11 — fail-closed env guard.
//
// Several runtime guards default to fail-closed for safety (ML serving,
// operational ops, exit integrity, etc.). An operator can opt back into
// fail-open behaviour by exporting the relevant `..._FAIL_CLOSED=0` env,
// which is sometimes necessary during migrations but should never go
// unnoticed in production. This helper emits a single-line WARN the first
// time the process reads such an env so the change is visible in logs.
//
// The warnings are per-process and per-env-name so we never spam.

const warned = new Set();

function isFailOpenExplicit(value) {
  const s = String(value == null ? "" : value).trim().toLowerCase();
  return s === "0" || s === "false" || s === "no" || s === "off";
}

function warnIfFailClosedDisabled(envName, { context = null } = {}) {
  const name = String(envName || "").trim();
  if (!name) return false;
  if (warned.has(name)) return false;
  const value = process.env[name];
  if (!isFailOpenExplicit(value)) return false;
  warned.add(name);
  const payload = {
    event: "FAIL_CLOSED_ENV_DISABLED",
    env: name,
    value: String(value),
    context: context || null,
    at: new Date().toISOString(),
  };
  console.warn(`[FAIL_CLOSED_ENV_DISABLED] ${JSON.stringify(payload)}`);
  return true;
}

function resetForTest() {
  warned.clear();
}

module.exports = {
  warnIfFailClosedDisabled,
  isFailOpenExplicit,
  __test: {
    resetForTest,
  },
};
