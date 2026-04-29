"use strict";

// 2026-04-29 — Server-native initial signal kill-switch test.
//
// Pin the structural invariant that paperBinanceRunner's
// loadServerNativeInitialSignals respects the
// DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED env flag and bails
// out with an empty array (and a structured kill-switch log) BEFORE
// any bar fetch / strategy evaluation runs.
//
// Why: this builder was the actual production entry-firing path that
// triggered DOGEUSDT 00:46 UTC LONG → trail-after-TP1 chop → force-exit.
// Without this kill-switch we cannot safely deploy the downstream
// fixes (RECENT_ENTRY_GRACE + trail-after-TP1 inhibit) without
// re-firing the same chop.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "engine", "paperBinanceRunner.js"),
  "utf8"
);

// (A) The function definition must contain the env check.
const fnIdx = src.indexOf("async function loadServerNativeInitialSignals(");
assert.ok(fnIdx > 0, "(A) loadServerNativeInitialSignals function not found");

// (B) Capture the body window (next 3000 chars after the signature).
const fnBodyWindow = src.slice(fnIdx, fnIdx + 3000);

// (C) The env flag must be read from process.env.
assert.ok(
  fnBodyWindow.includes("DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED"),
  "(C) loadServerNativeInitialSignals must read DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED env"
);

// (D) The check must accept the standard truthy tokens.
for (const truthy of ['"1"', '"true"', '"yes"', '"on"']) {
  assert.ok(
    fnBodyWindow.includes(truthy),
    `(D) kill-switch must accept ${truthy} as truthy`
  );
}

// (E) The kill-switch branch must emit a structured log so we can
//     verify in production that the flag is actually engaged.
assert.ok(
  fnBodyWindow.includes("server_native_initial_signals_disabled_by_env"),
  "(E) kill-switch branch must emit server_native_initial_signals_disabled_by_env log"
);

// (F) The kill-switch branch must return an empty array, not call
//     buildServerNativeInitialSignals.
const killSwitchIdx = fnBodyWindow.indexOf("server_native_initial_signals_disabled_by_env");
const buildIdx = fnBodyWindow.indexOf("buildServerNativeInitialSignals");
assert.ok(
  killSwitchIdx > 0 && buildIdx > 0,
  "(F) anchors not found"
);
assert.ok(
  killSwitchIdx < buildIdx,
  "(F) kill-switch branch must precede buildServerNativeInitialSignals call (early return)"
);

// (G) cloudbuild.yaml must pin _DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED
//     and pipe it through the deploy --set-env-vars.
const cloudbuild = fs.readFileSync(
  path.join(__dirname, "..", "..", "cloudbuild.yaml"),
  "utf8"
);
assert.ok(
  cloudbuild.includes("_DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED:"),
  "(G) cloudbuild.yaml substitutions must include _DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED"
);
assert.ok(
  cloudbuild.includes("DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED=$_DONBEOLJA_SERVER_NATIVE_INITIAL_SIGNALS_DISABLED"),
  "(G) cloudbuild.yaml deploy --set-env-vars must forward the kill-switch env"
);

console.log("SERVER_NATIVE_INITIAL_SIGNAL_KILL_SWITCH_TEST_OK");
