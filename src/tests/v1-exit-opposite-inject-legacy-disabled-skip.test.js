"use strict";

// 2026-04-29 — V1 EXIT_OPPOSITE_SIGNAL injection skip test.
//
// Background: in V2 discovery canary mode the V1 paperBinanceRunner
// signal loop injects EXIT_OPPOSITE_SIGNAL whenever an opposite-side
// signal arrives on a held position. With
// `DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=1` the V1 executor then refuses
// the resulting order with reason
// `V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED`, producing a
// drop alert on every bar that carries the opposite-direction signal
// while the position itself never moves. The fix is to skip the V1
// inject entirely under that flag; opposite-flip handling becomes a
// V2 responsibility post-cutover.
//
// This test pins the structural invariant: the V2-discovery signal
// loop must check `liveCfg.legacy_runtime_disabled` *before* the
// transitionApplicable inject branch, must clear the
// opposite_transition_* meta, must emit the structured
// `v1_exit_opposite_inject_skipped_v2_legacy_disabled` log, and must
// `continue` without pushing the EXIT_OPPOSITE_SIGNAL signal.

const assert = require("assert");
const fs = require("fs");

function findExitOppositeInjectRegion(src) {
  // The V1 EXIT_OPPOSITE_SIGNAL inject sits inside the V1 paperBinanceRunner
  // signals loop (it dispatches both V1 and V2-discovery flows).
  // Anchor on the first `event: "EXIT_OPPOSITE_SIGNAL"` push and walk
  // backward ~120 lines to capture the surrounding context.
  const injectAnchor = `event: "EXIT_OPPOSITE_SIGNAL"`;
  const injectIdx = src.indexOf(injectAnchor);
  assert.ok(injectIdx > 0, "expected at least one EXIT_OPPOSITE_SIGNAL inject site");
  // Walk back to capture ~3000 chars of preceding context (sufficient
  // for the guard branch inserted directly above the injects).
  const regionStart = Math.max(0, injectIdx - 3000);
  // Walk forward to capture all 3 inject sites (reduce / confirm /
  // unconditional) — they live within the same ~2000-char block.
  const regionEnd = Math.min(src.length, injectIdx + 3000);
  return src.slice(regionStart, regionEnd);
}

function run() {
  const src = fs.readFileSync(require.resolve("../engine/paperBinanceRunner"), "utf8");
  const body = findExitOppositeInjectRegion(src);

  // (A) The skip branch must exist in the V2-discovery loop body.
  const skipMarker = "v1OppositeInjectionDisabled";
  assert.ok(
    body.includes(skipMarker),
    "(A) v1OppositeInjectionDisabled guard must exist in V2-discovery signal loop"
  );

  // (B) The guard must check legacy_runtime_disabled exactly.
  assert.ok(
    body.includes("liveCfg && liveCfg.legacy_runtime_disabled === true"),
    "(B) guard must read liveCfg.legacy_runtime_disabled === true"
  );

  // (C) When the guard fires, transition meta must be cleared so a
  //     V2 takeover starts from a clean state.
  const skipBlockStart = body.indexOf("if (v1OppositeInjectionDisabled) {");
  assert.ok(skipBlockStart >= 0, "(C) skip branch entry not found");
  const skipBlockEnd = body.indexOf("continue;", skipBlockStart);
  assert.ok(skipBlockEnd > skipBlockStart, "(C) skip branch must end with `continue`");
  const skipBlockText = body.slice(skipBlockStart, skipBlockEnd);
  for (const field of [
    "opposite_transition_dir",
    "opposite_transition_event",
    "opposite_transition_until_ms",
    "opposite_transition_stage",
    "opposite_transition_seen_ms",
  ]) {
    assert.ok(
      skipBlockText.includes(`metaUpdates.${field} = null;`),
      `(C) skip branch must clear metaUpdates.${field}`
    );
  }

  // (D) The skip branch must emit the structured log so operators can
  //     distinguish "intentionally skipped" from "actually fired".
  assert.ok(
    skipBlockText.includes("v1_exit_opposite_inject_skipped_v2_legacy_disabled"),
    "(D) skip branch must emit the structured event name"
  );

  // (E) The guard must run BEFORE the existing `transitionApplicable`
  //     branch — otherwise the V1 inject still happens before the
  //     guard gets a chance to skip it.
  const guardIdx = body.indexOf("if (v1OppositeInjectionDisabled) {");
  const transitionIdx = body.indexOf("if (transitionApplicable) {");
  assert.ok(transitionIdx >= 0, "(E) transitionApplicable branch must exist");
  assert.ok(
    guardIdx < transitionIdx,
    "(E) v1OppositeInjectionDisabled guard must precede transitionApplicable branch"
  );

  // (F) The skip branch must NOT push EXIT_OPPOSITE_SIGNAL onto signals.
  //     We assert this by structural absence of `signals.push` inside
  //     the skip block.
  assert.ok(
    !skipBlockText.includes("signals.push"),
    "(F) skip branch must NOT push EXIT_OPPOSITE_SIGNAL"
  );
}

try {
  run();
  console.log("V1_EXIT_OPPOSITE_INJECT_LEGACY_DISABLED_SKIP_TEST_OK");
} catch (err) {
  console.error("V1_EXIT_OPPOSITE_INJECT_LEGACY_DISABLED_SKIP_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
